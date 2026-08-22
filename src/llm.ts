/* ============================================================
 * 視覺 AI 辨識（把名片圖片直接傳給 AI 模型擷取欄位）
 * 支援：OpenAI 相容 API（GPT-4o 等）／ Google Gemini
 * ============================================================ */

import { CATEGORY_DEFS, Extracted, Settings } from './types'

function buildPrompt(): string {
  const cats = CATEGORY_DEFS.map((c) => `${c.id}(${c.label})`).join('、')
  return `你是名片辨識專家。請仔細看這張名片圖片，擷取聯絡資訊，並「只用 JSON」回答，不要任何說明文字。
JSON 欄位：
{
  "name": "姓名（含英文並列時一起保留）",
  "title": "職稱",
  "company": "公司名稱",
  "department": "部門（沒有則空字串）",
  "phones": ["電話（含手機，保留原格式）"],
  "faxes": ["傳真"],
  "emails": ["Email"],
  "website": "網址（沒有則空字串）",
  "address": "地址",
  "category": "從以下選一個最適合的分類 id：${cats}",
  "tags": ["2~4 個簡短標籤，例如：科技業、B2B、供應鏈"],
  "notes": "其他值得備註的資訊（沒有則空字串）"
}
規則：無法辨識或沒有的欄位給空字串或空陣列；忠實照名片原文，不要推測不存在的資料。`
}

function stripDataUrl(dataUrl: string): { b64: string; mime: string } {
  const m = dataUrl.match(/^data:([^;]+);base64,(.*)$/)
  if (m) return { mime: m[1], b64: m[2] }
  return { mime: 'image/jpeg', b64: dataUrl }
}

function parseJsonLoose(text: string): any {
  let t = text.trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    return JSON.parse(t)
  } catch {
    const s = t.indexOf('{')
    const e = t.lastIndexOf('}')
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(t.slice(s, e + 1))
      } catch {
        /* fallthrough */
      }
    }
    throw new Error('AI 回覆格式無法解析')
  }
}

function httpErrorMessage(status: number, body: string): string {
  if (status === 401 || status === 403) return 'API 金鑰無效或沒有權限（請檢查設定）'
  if (status === 404) return '找不到模型或 API 位址（請檢查模型名稱 / Base URL）'
  if (status === 429) return 'API 用量超額或請求太頻繁，請稍後再試'
  let detail = ''
  try {
    const j = JSON.parse(body)
    detail = j?.error?.message || j?.message || ''
  } catch {
    /* ignore */
  }
  return `AI 服務回傳錯誤 ${status}${detail ? `：${detail.slice(0, 160)}` : ''}`
}

function normalizeExtracted(o: any): Extracted {
  const validCats = new Set<string>(CATEGORY_DEFS.map((c) => c.id))
  const arr = (v: any): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x).trim()).filter(Boolean)
      : typeof v === 'string' && v.trim()
        ? [v.trim()]
        : []
  const s = (v: any): string => (typeof v === 'string' ? v.trim() : '')
  let category = s(o.category).toLowerCase()
  if (!validCats.has(category)) category = ''
  return {
    name: s(o.name),
    title: s(o.title),
    company: s(o.company),
    department: s(o.department),
    phones: arr(o.phones),
    faxes: arr(o.faxes),
    emails: arr(o.emails),
    website: s(o.website),
    address: s(o.address),
    category,
    tags: arr(o.tags).slice(0, 6),
    notes: s(o.notes),
  }
}

function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + path
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = 90000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ctrl.signal })
  } finally {
    clearTimeout(timer)
  }
}

/* ---------- OpenAI 相容 ---------- */
async function openaiRecognize(imageDataUrl: string, s: Settings): Promise<Extracted> {
  const { baseUrl, apiKey, model } = s.openai
  if (!apiKey) throw new Error('尚未設定 OpenAI API Key，請到「設定」頁填入')
  const body = (withFormat: boolean) => ({
    model,
    temperature: 0,
    ...(withFormat ? { response_format: { type: 'json_object' as const } } : {}),
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: buildPrompt() },
          { type: 'image_url', image_url: { url: imageDataUrl } },
        ],
      },
    ],
  })
  const url = joinUrl(baseUrl, '/chat/completions')
  const doFetch = (withFormat: boolean) =>
    fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body(withFormat)),
    })
  let res = await doFetch(true)
  if (res.status === 400) {
    // 部分相容端點不支援 response_format，重試一次
    res = await doFetch(false)
  }
  if (!res.ok) throw new Error(httpErrorMessage(res.status, await res.text()))
  const json = await res.json()
  const text: string = json?.choices?.[0]?.message?.content ?? ''
  return normalizeExtracted(parseJsonLoose(text))
}

/* ---------- Gemini ---------- */
async function geminiRecognize(imageDataUrl: string, s: Settings): Promise<Extracted> {
  const { baseUrl, apiKey, model } = s.gemini
  if (!apiKey) throw new Error('尚未設定 Gemini API Key，請到「設定」頁填入')
  const { b64, mime } = stripDataUrl(imageDataUrl)
  const url = joinUrl(baseUrl, `/models/${encodeURIComponent(model)}:generateContent`)
  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: buildPrompt() }, { inline_data: { mime_type: mime, data: b64 } }],
        },
      ],
      generationConfig: { temperature: 0, responseMimeType: 'application/json' },
    }),
  })
  if (!res.ok) throw new Error(httpErrorMessage(res.status, await res.text()))
  const json = await res.json()
  const parts = json?.candidates?.[0]?.content?.parts ?? []
  const text = parts.map((p: any) => p?.text ?? '').join('')
  return normalizeExtracted(parseJsonLoose(text))
}

export async function llmRecognize(imageDataUrl: string, s: Settings): Promise<Extracted> {
  const ex = s.engine === 'gemini' ? await geminiRecognize(imageDataUrl, s) : await openaiRecognize(imageDataUrl, s)
  ex.rawText = '（由視覺 AI 模型辨識）'
  return ex
}

/* ---------- 連線測試 ---------- */
export async function testConnection(s: Settings): Promise<{ ok: boolean; message: string }> {
  try {
    if (s.engine === 'openai') {
      if (!s.openai.apiKey) return { ok: false, message: '請先填入 API Key' }
      const res = await fetchWithTimeout(joinUrl(s.openai.baseUrl, '/models'), {
        headers: { Authorization: `Bearer ${s.openai.apiKey}` },
      }, 20000)
      if (!res.ok) return { ok: false, message: httpErrorMessage(res.status, await res.text()) }
      return { ok: true, message: '連線成功，API Key 有效' }
    }
    if (s.engine === 'gemini') {
      if (!s.gemini.apiKey) return { ok: false, message: '請先填入 API Key' }
      const res = await fetchWithTimeout(joinUrl(s.gemini.baseUrl, '/models'), {
        headers: { 'x-goog-api-key': s.gemini.apiKey },
      }, 20000)
      if (!res.ok) return { ok: false, message: httpErrorMessage(res.status, await res.text()) }
      return { ok: true, message: '連線成功，API Key 有效' }
    }
    return { ok: true, message: '內建 OCR 不需要連線設定' }
  } catch (e: any) {
    return {
      ok: false,
      message: e?.name === 'AbortError' ? '連線逾時' : `連線失敗：${e?.message || '未知錯誤'}`,
    }
  }
}

export function engineLabel(s: Settings): string {
  if (s.engine === 'openai') return `雲端辨識（${s.openai.model || 'OpenAI 相容'}）`
  if (s.engine === 'gemini') return `雲端辨識（${s.gemini.model || 'Gemini'}）`
  return '內建辨識（離線）'
}

/* ---------- 文字對話（AI 助理） ---------- */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function llmChat(system: string, history: ChatMessage[], s: Settings): Promise<string> {
  if (s.engine === 'gemini') {
    const { baseUrl, apiKey, model } = s.gemini
    if (!apiKey) throw new Error('尚未設定 Gemini API Key')
    const url = joinUrl(baseUrl, `/models/${encodeURIComponent(model)}:generateContent`)
    const contents = [
      { role: 'user', parts: [{ text: system }] },
      { role: 'model', parts: [{ text: '好的，我會只根據提供的名片資料回答。' }] },
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
    ]
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({ contents, generationConfig: { temperature: 0.4, maxOutputTokens: 1024 } }),
      },
      60000,
    )
    if (!res.ok) throw new Error(httpErrorMessage(res.status, await res.text()))
    const json = await res.json()
    const parts = json?.candidates?.[0]?.content?.parts ?? []
    const text = parts.map((p: any) => p?.text ?? '').join('')
    if (!text) throw new Error('AI 沒有回覆內容')
    return text
  }
  // OpenAI 相容
  const { baseUrl, apiKey, model } = s.openai
  if (!apiKey) throw new Error('尚未設定 OpenAI API Key')
  const url = joinUrl(baseUrl, '/chat/completions')
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        messages: [{ role: 'system', content: system }, ...history],
      }),
    },
    60000,
  )
  if (!res.ok) throw new Error(httpErrorMessage(res.status, await res.text()))
  const json = await res.json()
  const text: string = json?.choices?.[0]?.message?.content ?? ''
  if (!text) throw new Error('AI 沒有回覆內容')
  return text
}
