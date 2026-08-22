/* ============================================================
 * AI 助理：用自然語言查詢名片匣（視覺 AI Key 可用時走 LLM，
 * 否則自動退回本機關鍵字搜尋，離線也能用）
 * ============================================================ */

import { Card, CATEGORY_DEFS, CATEGORY_MAP, Settings } from './types'
import { loadSettings } from './store'
import { engineLabel, llmChat } from './llm'
import { esc, icon } from './components'

interface Msg {
  role: 'user' | 'assistant'
  text: string
  ts: number
}

const LS_KEY = 'bcs-chat-v1'
const MAX_LIST = 150

let msgs: Msg[] = loadHistory()
let busy = false

function loadHistory(): Msg[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
    if (Array.isArray(raw) && raw.length) return raw.slice(-60)
  } catch {
    /* ignore */
  }
  return [
    {
      role: 'assistant',
      ts: Date.now(),
      text:
        '你好！我是名片人脈助理，可以問我例如：\n- **科技業**有哪些聯絡人？\n- 有 **email** 的名片有幾張？\n- 列出所有**業務**職稱的人\n- 「澄澈科技」的電話是多少？',
    },
  ]
}

function saveHistory(): void {
  localStorage.setItem(LS_KEY, JSON.stringify(msgs.slice(-60)))
}

/** 名片匣 → 給 LLM 的精簡上下文 */
function buildContext(cards: Card[]): string {
  if (!cards.length) return '（名片匣目前是空的）'
  const catStat = new Map<string, number>()
  for (const c of cards) catStat.set(c.category, (catStat.get(c.category) || 0) + 1)
  const stat = `總共 ${cards.length} 張；分類統計：${[...catStat.entries()]
    .map(([k, v]) => `${(CATEGORY_MAP[k] || CATEGORY_MAP.other).label} ${v}`)
    .join('、')}`
  const list = cards
    .slice(0, MAX_LIST)
    .map(
      (c) =>
        `- ${c.name || '（未命名）'}${c.title ? `｜${c.title}` : ''}${c.company ? `｜${c.company}` : ''}｜${
          (CATEGORY_MAP[c.category] || CATEGORY_MAP.other).label
        }${c.phones.length ? `｜${c.phones.join('/')}` : ''}${c.emails.length ? `｜${c.emails.join('/')}` : ''}${
          c.tags.length ? `｜#${c.tags.join(' #')}` : ''
        }`,
    )
    .join('\n')
  const note = cards.length > MAX_LIST ? `\n（僅列出最新 ${MAX_LIST} 張，共 ${cards.length} 張）` : ''
  return `${stat}\n${list}${note}`
}

/* ---------- 本機關鍵字搜尋（離線後備） ---------- */

export function localAnswer(q: string, cards: Card[]): string {
  if (!cards.length) return '名片匣目前是空的，先去掃描幾張名片再問我吧！'
  const tokens = Array.from(new Set(q.split(/[\s,，、?？!！。]+/).filter((t) => t.length >= 2)))
  // 查詢是否直接指名某個分類（例如「科技業」「金融」→ 標籤「科技 / 軟體」「金融 / 保險」）
  const qLower = q.toLowerCase()
  let catHitId = ''
  for (const def of CATEGORY_DEFS) {
    const parts = def.label.split(/[\/\s、()（）]+/).filter((p) => p.length >= 2)
    if (qLower.includes(def.label) || qLower.includes(def.id) || parts.some((p) => qLower.includes(p))) {
      catHitId = def.id
      break
    }
  }
  const scored = cards
    .map((c) => {
      const hay = [c.name, c.title, c.company, c.department, (CATEGORY_MAP[c.category] || {}).label || '', ...c.tags, ...c.phones, ...c.emails]
        .join(' ')
        .toLowerCase()
      let s = 0
      for (const t of tokens) if (hay.includes(t.toLowerCase())) s += t.length
      if (catHitId && c.category === catHitId) s += 8
      return { c, s }
    })
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, 8)
  if (!scored.length) {
    return `本機搜尋沒有找到符合「${q}」的名片。\n提示：設定 API Key 後，我可以回答更複雜的問題（統計、分析、找關係）。`
  }
  const lines = scored.map(({ c }) => {
    const cat = (CATEGORY_MAP[c.category] || CATEGORY_MAP.other).label
    return `- **${c.name || c.company || '未命名'}**${c.title ? `（${c.title}）` : ''}${c.company ? `｜${c.company}` : ''}｜${cat}${c.phones[0] ? `｜${c.phones[0]}` : ''}`
  })
  return `找到 ${scored.length} 張符合的名片（本機搜尋模式）：\n${lines.join('\n')}`
}

/* ---------- LLM ---------- */

function hasKey(s: Settings): boolean {
  if (s.engine === 'openai') return !!s.openai.apiKey
  if (s.engine === 'gemini') return !!s.gemini.apiKey
  return false
}

async function llmAnswer(q: string, cards: Card[]): Promise<string> {
  const s = loadSettings()
  const sys = `你是「名片管家」的人脈助理，根據使用者的名片匣資料回答問題。
規則：
- 只依據下面提供的名片資料回答，絕不編造不存在的聯絡人或資訊
- 統計數字要正確（可自行加總）
- 用繁體中文回答，精簡、可用條列（- 開頭）與 **粗體** 標重點
- 若名片資料沒有相關資訊，直說沒有，並建議到「名片匣」用關鍵字搜尋
- 名片格式：姓名｜職稱｜公司｜分類｜電話｜Email｜標籤

=== 名片匣資料 ===
${buildContext(cards)}
=== 資料結束 ===`
  const history = msgs.slice(-10).map((m) => ({ role: m.role, content: m.text }))
  return await llmChat(sys, [...history, { role: 'user', content: q }], s)
}

/* ---------- 渲染 ---------- */

function md(s: string): string {
  let t = esc(s)
  t = t.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/\n/g, '<br>')
  return t
}

export function renderChatBox(container: HTMLElement, cards: Card[]): void {
  const settings = loadSettings()
  const keyReady = hasKey(settings)
  container.innerHTML = `
  <div class="card chat-card">
    <div class="chat-head">
      <div>
        <h3>${icon('chat', 16)} 人脈助理</h3>
        <small>${keyReady ? `已連接 ${esc(engineLabel(settings))}` : '本機搜尋模式（設定 API Key 後可智慧問答）'}</small>
      </div>
      <button class="btn btn-ghost btn-sm" id="chatClear" title="清除對話">${icon('trash', 13)} 清除</button>
    </div>
    <div class="chat-msgs" id="chatMsgs"></div>
    <div class="chat-input-row">
      <input id="chatInput" type="text" placeholder="例：科技業有誰？有 email 的有幾張？" autocomplete="off" maxlength="300">
      <button class="btn btn-primary chat-send" id="chatSend">${icon('send', 16)} 送出</button>
    </div>
  </div>`

  const msgsEl = container.querySelector('#chatMsgs') as HTMLElement
  const input = container.querySelector('#chatInput') as HTMLInputElement
  const sendBtn = container.querySelector('#chatSend') as HTMLButtonElement

  const renderMsgs = (typing = false) => {
    msgsEl.innerHTML =
      msgs
        .map(
          (m) =>
            `<div class="msg ${m.role}"><div class="bubble">${m.role === 'assistant' ? md(m.text) : esc(m.text)}</div></div>`,
        )
        .join('') + (typing ? '<div class="msg assistant"><div class="bubble typing"><i></i><i></i><i></i></div></div>' : '')
    msgsEl.scrollTop = msgsEl.scrollHeight
  }
  renderMsgs()

  container.querySelector('#chatClear')!.addEventListener('click', () => {
    localStorage.removeItem(LS_KEY)
    msgs = [{ role: 'assistant', ts: Date.now(), text: '對話已清除，請繼續提問！' }]
    saveHistory()
    renderMsgs()
  })

  const send = async () => {
    const q = input.value.trim()
    if (!q || busy) return
    busy = true
    sendBtn.disabled = true
    input.value = ''
    msgs.push({ role: 'user', text: q, ts: Date.now() })
    renderMsgs(true)
    let answer: string
    try {
      if (keyReady) {
        try {
          answer = await llmAnswer(q, cards)
        } catch (e: any) {
          answer = `⚠️ 雲端連線失敗（${e?.message || e}），已改用本機搜尋：\n\n${localAnswer(q, cards)}`
        }
      } else {
        answer = localAnswer(q, cards)
      }
    } finally {
      busy = false
      sendBtn.disabled = false
    }
    msgs.push({ role: 'assistant', text: answer, ts: Date.now() })
    saveHistory()
    renderMsgs()
  }
  sendBtn.addEventListener('click', () => void send())
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void send()
  })
}
