/* ============================================================
 * OCR 文字 → 結構化欄位（規則式剖析）+ 自動歸類
 * ============================================================ */

import { CATEGORY_DEFS, CategoryId, Extracted } from './types'

/* ---------- 常用姓氏（中文姓名辨識） ---------- */
const SURNAMES_2 = new Set(['歐陽', '諸葛', '司徒', '司馬', '上官', '范姜', '張簡'])
const SURNAMES_1 = new Set(
  '王李張劉陳楊趙黃周吳徐孫胡朱高林何郭馬羅梁宋鄭謝韓唐馮于董蕭程曹袁鄧許傅沈曾彭呂蘇盧蔣蔡賈丁魏薛葉閻余潘杜戴夏鍾汪田任姜范方石姚譚廖鄒熊金陸郝孔白崔康毛邱秦江史顧侯邵孟龍萬段雷錢湯尹黎易常武喬賴龔文樊溫盛林邱石郭'.split(
    '',
  ),
)

const TITLE_KEYWORDS = [
  '董事長', '副董事長', '總經理', '副總經理', '執行長', '營運長', '財務長', '技術長', '研發長', '首席',
  '總監', '協理', '處長', '副理', '經理', '襄理', '科長', '課長', '主任', '店長', '組長', '專員', '工程師',
  '設計師', '顧問', '業務', '助理', '秘書', '技師', '理專', '理財專員', '專案經理', '產品經理', '行銷',
  'CEO', 'CTO', 'CFO', 'COO', 'CIO', 'VP', 'Founder', 'Co-Founder', 'Director', 'Manager', 'Engineer',
  'Designer', 'Consultant', 'Architect', 'Accountant', 'Attorney', 'President', 'Supervisor', 'Specialist',
  'Analyst', 'Coordinator', 'Assistant', 'Sales', 'Professor', 'Doctor', 'Partner', 'Head of',
]

const COMPANY_KEYWORDS = [
  '股份有限公司', '有限公司', '公司', '集團', '控股', '事務所', '工作室', '企業', '實業', '商行', '銀行',
  '診所', '醫院', '藥局', '補習班', '基金會', '協會', '中心', '出版社', '雜誌社', 'Corporation', 'Corp',
  'Inc', 'Ltd', 'LLC', 'PLC', 'Co.,', 'Co.', 'Company', 'Group', 'Holdings', 'Bank', 'University',
  'Hospital', 'Clinic', 'Studio', 'Labs', 'Agency',
]

const INDUSTRY_KEYWORDS = [
  '科技', '軟體', '資訊', '電子', '半導體', '生技', '顧問', '設計', '工程', '貿易', '餐飲', '食品', '營造',
  '建設', '機械', '紡織', '化學', '光電', '能源', '旅遊', '運輸', '物流', '廣告', '媒體', '傳播', '教育',
  '保險', '證券', '投資', '不動產', '房地產', '製造', '印刷', '鋼鐵', '汽車', 'Communications', 'Technology',
]

const DEPT_KEYWORDS = ['部', '部門', '處', '課', '組', '中心', 'Department', 'Dept', 'Division', 'Unit', 'Team']

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr))
}

function matchAll(text: string, re: RegExp): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g')
  while ((m = r.exec(text))) out.push(m[0])
  return out
}

const LABEL_PREFIX = /^(姓名|名字|職稱|職位|頭銜|公司|公司名稱|部門|電話|市話|公司電話|手機|行動|傳真|地址|住址|信箱|電子郵件|電郵|網址|網站|分類|備註|name|title|position|company|dept|department|tel|phone|mobile|fax|add|address|e-?mail|web|website|url)\s*[:：]\s*/i

function stripLabel(line: string): string {
  return line.replace(LABEL_PREFIX, '').trim()
}

function hasCJK(s: string): boolean {
  return /[\u4e00-\u9fff]/.test(s)
}

/* ---------- 電話 ---------- */
function extractPhones(text: string): { phones: string[]; faxes: string[]; ext?: string } {
  const raw = text
  const candidates: string[] = []
  candidates.push(...matchAll(raw, /(?:\+?886[\s\-.]?|0)9\d{2}[\s\-.]?\d{3}[\s\-.]?\d{3}/g))
  candidates.push(...matchAll(raw, /(?:\+?886[\s\-.]?|0)\d{1,2}[\s\-.]?\d{4}[\s\-.]?\d{3,4}/g))
  candidates.push(...matchAll(raw, /\+\d{1,3}(?:[\s\-.()]*\d{2,4}){2,3}/g))
  candidates.push(...matchAll(raw, /(?<!\d)(?:\d{2,4}[\s\-]){2,3}\d{2,4}(?!\d)/g))

  const extM = raw.match(/(?:ext\.?|Ext\.?|EXT|#|分機|轉)\s?(\d{1,6})/)
  const ext = extM ? extM[1] : undefined

  const digitsKey = (s: string) => s.replace(/\D/g, '')
  const seen = new Set<string>()
  const phones: string[] = []
  const faxes: string[] = []
  for (const cand of candidates) {
    const key = digitsKey(cand)
    if (!key || key.length < 7 || key.length > 14 || seen.has(key)) continue
    // 找出現的那一行，判斷是否傳真
    const line = text.split('\n').find((l) => l.includes(cand)) || ''
    if (/傳真|fax|facsimile/i.test(line)) {
      seen.add(key)
      faxes.push(cand.trim())
      continue
    }
    if (/09\d{8}|8869\d{8}/.test(key)) {
      // 手機
    } else if (key.length === 7 && !/^0/.test(key)) {
      continue // 可能是地址郵遞區號或其他數字
    }
    seen.add(key)
    phones.push(cand.trim())
  }
  if (ext && phones.length) phones[phones.length - 1] = `${phones[phones.length - 1]} 分機 ${ext}`
  return { phones, faxes }
}

/* ---------- Email / 網址 ---------- */
function extractEmails(text: string): string[] {
  return uniq(
    matchAll(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g).map((s) => s.replace(/^[._-]+|[._-]+$/g, '')),
  ).filter((e) => !/[._-]$/.test(e))
}

function extractWebsites(text: string, emails: string[]): string {
  let t = text
  for (const e of emails) t = t.split(e).join(' ')
  const urls = uniq([
    ...matchAll(t, /https?:\/\/[^\s，,、）)」」]+/gi),
    ...matchAll(t, /www\.[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?:\/[^\s，,、）)」]*)?/gi),
    ...matchAll(
      t,
      /\b[A-Za-z0-9][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:com|net|org|tw|cn|io|ai|co|cc|biz|info|edu|gov|me|tv|design|tech|shop|store)(?:\/[^\s，,、）)」]*)?\b/gi,
    ),
  ])
  const cleaned = urls.map((u) => u.replace(/[.,;、）)]+$/, ''))
  return cleaned[0] || ''
}

/* ---------- 地址 ---------- */
const ADDR_TOKENS = [
  '路', '街', '段', '巷', '弄', '號', '樓', '室', '區', '市', '縣', '鎮', '村', '鄉',
  'Rd', 'Road', 'St', 'Street', 'Ave', 'Avenue', 'Blvd', 'Boulevard', 'Floor', 'F.', 'R.O.C', 'ROC', 'No.',
]

function extractAddress(lines: string[]): string {
  let best = ''
  let bestScore = 0
  for (const raw of lines) {
    const line = stripLabel(raw)
    if (!line || line.length < 6 || line.length > 90) continue
    if (/@|http|www/i.test(line)) continue
    let score = 0
    for (const tok of ADDR_TOKENS) {
      if (line.includes(tok)) score += tok.length > 2 ? 2 : 1
    }
    if (/^\d{3,6}\s/.test(line)) score += 2 // 郵遞區號開頭
    if (/^No\.?\s?\d|\d+號|\d+樓|\d+F/i.test(line)) score += 1
    if (hasCJK(line) && !/[路街巷弄號樓區市縣鎮]/.test(line) && !/Rd|St|Ave|Blvd/i.test(line)) score -= 4
    if (score > bestScore && score >= 3) {
      bestScore = score
      best = line
    }
  }
  return best
}

/* ---------- 姓名 ---------- */
function extractName(lines: string[]): { name: string; lineIndex: number } | null {
  let best: { name: string; lineIndex: number; score: number } | null = null
  lines.forEach((raw, idx) => {
    const line = stripLabel(raw)
    if (!line || line.length > 40) return
    if (/\d|@|www|http|\.com|Ext|分機/i.test(line)) return
    // 中文姓名：2~4 個漢字（可含 ·）
    const cjk = line.match(/[\u4e00-\u9fff][\u4e00-\u9fff·‧]{1,5}[\u4e00-\u9fff]/)
    if (cjk && cjk[0].replace(/[·‧]/g, '').length <= 4) {
      const seg = cjk[0]
      const surname2 = seg.slice(0, 2)
      const surname1 = seg.slice(0, 1)
      const isSurname = SURNAMES_2.has(surname2) || SURNAMES_1.has(surname1)
      if (isSurname) {
        // 不能是公司/職稱行
        if (COMPANY_KEYWORDS.some((k) => seg.includes(k)) || TITLE_KEYWORDS.some((k) => seg.includes(k))) return
        let score = 5 + seg.length
        if (idx < 5) score += 2
        const eng = line.replace(seg, '').trim()
        const nameStr = eng ? `${seg} ${eng}` : seg
        if (!best || score > best.score) best = { name: nameStr, lineIndex: idx, score }
      }
    }
    // 英文姓名：2~3 個開頭大寫字母單字
    if (!best && /^[A-Za-z][A-Za-z.'’\- ]*$/.test(line)) {
      const tokens = line.split(/\s+/)
      if (tokens.length >= 2 && tokens.length <= 4 && tokens.every((t) => /^[A-Z][a-zA-Z.'’\-]*$/.test(t) || /^(Mr|Ms|Mrs|Dr|Prof)\.?$/.test(t))) {
        if (TITLE_KEYWORDS.some((k) => line.toLowerCase().includes(k.toLowerCase()))) return
        if (COMPANY_KEYWORDS.some((k) => line.toLowerCase().includes(k.toLowerCase()))) return
        best = { name: line, lineIndex: idx, score: 3 }
      }
    }
  })
  return best ? { name: (best as { name: string; lineIndex: number }).name, lineIndex: (best as { lineIndex: number }).lineIndex } : null
}

/* ---------- 職稱 ---------- */
function extractTitle(lines: string[], skip: Set<number>): string {
  let best = ''
  let bestScore = 0
  lines.forEach((raw, idx) => {
    if (skip.has(idx)) return
    const line = stripLabel(raw)
    if (!line || line.length > 40) return
    if (/\d|@|www/i.test(line) && !/工程師|designer|engineer/i.test(line)) return
    const hits = TITLE_KEYWORDS.filter((k) => line.toLowerCase().includes(k.toLowerCase()))
    if (!hits.length) return
    const coverage = hits.reduce((s, k) => s + k.length, 0) / line.length
    let score = hits.length * 2 + coverage * 3
    if (line === hits[0] || line.length <= 14) score += 1
    if (score > bestScore) {
      bestScore = score
      best = line
    }
  })
  return best
}

/* ---------- 公司 ---------- */
function extractCompany(lines: string[], skip: Set<number>): string {
  let best = ''
  let bestScore = 0
  let bestIdx = -1
  lines.forEach((raw, idx) => {
    if (skip.has(idx)) return
    const line = stripLabel(raw)
    if (!line || line.length < 2 || line.length > 50) return
    if (/\d{4}|@|http/i.test(line)) return
    let score = 0
    for (const k of COMPANY_KEYWORDS) if (line.includes(k)) score += 4
    for (const k of INDUSTRY_KEYWORDS) if (line.includes(k)) score += 1
    // 全大寫英文行常為公司名
    if (/^[A-Z&\- .,()]+$/.test(line) && line.replace(/[^A-Za-z]/g, '').length >= 5) score += 3
    if (/^[A-Z][A-Za-z&.,\- ()]+(Inc|Ltd|Corp|Co)\.?$/.test(line)) score += 2
    if (idx < 3) score += 1 // 公司名常在最上面
    if (score > bestScore) {
      bestScore = score
      best = line
      bestIdx = idx
    }
  })
  if (best) return best
  // 後備：找第一個非姓名/電話行的短行
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    if (skip.has(i)) continue
    const line = stripLabel(lines[i])
    if (line.length >= 3 && !/\d|@/.test(line)) return line
  }
  return bestIdx >= 0 ? best : ''
}

/* ---------- 部門 ---------- */
function extractDepartment(lines: string[], skip: Set<number>): string {
  for (const raw of lines) {
    const idx = lines.indexOf(raw)
    if (skip.has(idx)) continue
    const line = stripLabel(raw)
    if (!line || line.length > 25) continue
    if (/^(?:[\u4e00-\u9fff]{2,6}(?:部|處|課|組|中心))$/.test(line)) return line
    if (/^(?:[A-Za-z ]{3,30}(?:Department|Dept\.?|Division|Team))$/.test(line)) return line
  }
  return ''
}

/* ---------- 自動歸類 ---------- */
export function categorize(...textParts: string[]): CategoryId {
  const text = textParts.filter(Boolean).join(' ').toLowerCase()
  if (!text.trim()) return 'other'
  let best: CategoryId = 'other'
  let bestScore = 0
  for (const cat of CATEGORY_DEFS) {
    if (!cat.keywords.length) continue
    let score = 0
    for (const kw of cat.keywords) {
      if (text.includes(kw)) score += kw.length >= 3 ? 2 : 1
    }
    if (score > bestScore) {
      bestScore = score
      best = cat.id
    }
  }
  return best
}

/* ---------- 主入口 ---------- */
export function extractFields(rawText: string): Extracted {
  const text = (rawText || '').replace(/\r/g, '')
  const lines = text
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l.length > 0)

  const emails = extractEmails(text)
  const website = extractWebsites(text, emails)
  const { phones, faxes } = extractPhones(text)
  const address = extractAddress(lines)

  const nameRes = extractName(lines)
  const skip = new Set<number>([nameRes?.lineIndex ?? -1])
  const title = extractTitle(lines, skip)
  if (title) skip.add(lines.findIndex((l) => l.includes(title)))
  const company = extractCompany(lines, skip)
  if (company) skip.add(lines.findIndex((l) => l.includes(company)))
  const department = extractDepartment(lines, skip)

  const name = nameRes?.name || ''
  const category = categorize(company, title, text)

  return {
    name,
    title,
    company,
    department,
    phones,
    faxes,
    emails,
    website,
    address,
    category,
    tags: [],
    rawText: text,
  }
}
