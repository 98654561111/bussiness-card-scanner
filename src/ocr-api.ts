/* ============================================================
 * 自訂 OCR 服務連接器（CnOCR / PaddleOCR 等）
 * 搭配附帶的 server/cnocr_server.py 使用：
 *   pip install cnocr fastapi uvicorn python-multipart
 *   uvicorn cnocr_server:app --port 8000
 * 之後在設定頁填 http://localhost:8000 即可
 * ============================================================ */

import { Extracted } from './types'
import { extractFields } from './extract'
import { cleanBaseUrl } from './llm'

export interface OcrLine {
  text: string
  score?: number
}

/** 寬鬆解析各種 OCR 服務的回覆格式 */
export function parseOcrResponse(data: any): OcrLine[] {
  if (data == null) return []
  // 純字串
  if (typeof data === 'string') return data.split('\n').map((t) => ({ text: t.trim() })).filter((l) => l.text)
  // 我們 server 的格式：{ lines: [{text, score}] }
  if (Array.isArray(data.lines)) return normLines(data.lines)
  if (Array.isArray(data.results)) return normLines(data.results)
  // CnOCR 原生輸出：[[box, text, score], ...]
  if (Array.isArray(data) && data.length && Array.isArray(data[0])) {
    return data
      .map((row: any[]) => {
        const strs = row.filter((c) => typeof c === 'string') as string[]
        const nums = row.filter((c) => typeof c === 'number') as number[]
        // PaddleOCR: [box, (text, score)]
        const text = strs[strs.length - 1] ?? ''
        const score = nums.length ? nums[nums.length - 1] : undefined
        return { text: String(text || '').trim(), score }
      })
      .filter((l) => l.text)
  }
  // { text: "..." } 單欄位
  if (typeof data.text === 'string') return data.text.split('\n').map((t: string) => ({ text: t.trim() })).filter((l: OcrLine) => l.text)
  return []
}

function normLines(arr: any[]): OcrLine[] {
  return arr
    .map((it) => {
      if (typeof it === 'string') return { text: it.trim() }
      if (it && typeof it === 'object') {
        const text = String(it.text ?? it.content ?? it.rec_text ?? '').trim()
        const score = Number(it.score ?? it.rec_score ?? it.confidence ?? NaN)
        return { text, score: Number.isFinite(score) ? score : undefined }
      }
      return { text: '' }
    })
    .filter((l) => l.text)
}

/** 呼叫自訂 OCR 服務辨識一張名片圖 */
export async function customOcrRecognize(imageDataUrl: string, baseUrl: string): Promise<Extracted> {
  const url = `${cleanBaseUrl(baseUrl)}/ocr`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 60000)
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: imageDataUrl }),
      signal: ctrl.signal,
    })
  } catch (e: any) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') throw new Error('OCR 服務逾時（60 秒）')
    throw new Error(
      `無法連線到 OCR 服務（${url}）。請確認服務已啟動；若透過 https 頁面連 http 服務會被瀏覽器封鎖，請在本機 localhost 開啟 App`,
    )
  }
  clearTimeout(timer)
  if (!res.ok) {
    let detail = ''
    try {
      detail = (await res.text()).slice(0, 120)
    } catch {
      /* ignore */
    }
    throw new Error(`OCR 服務回傳錯誤 ${res.status}${detail ? `：${detail}` : ''}`)
  }
  const data = await res.json()
  const lines = parseOcrResponse(data)
  // 過濾信心度極低的行
  const good = lines.filter((l) => (l.score ?? 1) >= 0.25)
  const text = (good.length ? good : lines).map((l) => l.text).join('\n')
  if (!text.trim()) throw new Error('OCR 服務沒有辨識出任何文字')
  const ex = extractFields(text)
  ex.rawText = text
  return ex
}

/** 測試自訂 OCR 服務連線 */
export async function testCustomOcr(baseUrl: string): Promise<{ ok: boolean; message: string }> {
  const url = `${cleanBaseUrl(baseUrl)}/health`
  try {
    const res = await fetch(url, { method: 'GET' })
    if (res.ok) return { ok: true, message: 'OCR 服務連線成功' }
    // 沒有 /health 也可能正常（只實作 /ocr）
    if (res.status === 404) return { ok: true, message: '已連線（服務未提供 /health，將以 /ocr 實測）' }
    return { ok: false, message: `OCR 服務回傳 ${res.status}` }
  } catch (e: any) {
    return {
      ok: false,
      message: `無法連線：${e?.message || e}（服務需啟動 CORS；https 頁面連 http 服務會被封鎖）`,
    }
  }
}
