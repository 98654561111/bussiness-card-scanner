/* ============================================================
 * 型別定義與分類字典
 * ============================================================ */

export type CategoryId =
  | 'tech'
  | 'finance'
  | 'realestate'
  | 'medical'
  | 'education'
  | 'manufacturing'
  | 'trade'
  | 'food'
  | 'legal'
  | 'design'
  | 'construction'
  | 'logistics'
  | 'other'

export interface CategoryDef {
  id: CategoryId
  label: string
  icon: string
  /** 自動歸類用的關鍵字（公司名、職稱、名片文字比對） */
  keywords: string[]
}

export const CATEGORY_DEFS: CategoryDef[] = [
  {
    id: 'tech',
    label: '科技 / 軟體',
    icon: '💻',
    keywords: ['科技', '軟體', '資訊', '系統', '電子', '半導體', '網路', '通訊', '雲端', '數位', 'ai', 'software', 'technology', 'tech', 'system', 'semiconductor', 'it ', 'cloud', 'data', 'internet'],
  },
  {
    id: 'finance',
    label: '金融 / 保險',
    icon: '💰',
    keywords: ['銀行', '保險', '證券', '投資', '金融', '期貨', '信託', '理財', 'bank', 'insurance', 'finance', 'financial', 'securities', 'capital', 'holdings', 'invest'],
  },
  {
    id: 'realestate',
    label: '不動產',
    icon: '🏠',
    keywords: ['房地產', '不動產', '仲介', '地產', '建設', '物業', '房屋', 'real estate', 'realty', 'realtor', 'property'],
  },
  {
    id: 'medical',
    label: '醫療 / 生技',
    icon: '🏥',
    keywords: ['醫療', '診所', '醫院', '藥局', '生技', '醫學', '牙醫', '復健', '醫師', '護理', 'medical', 'pharma', 'biotech', 'clinic', 'hospital', 'dental', 'health'],
  },
  {
    id: 'education',
    label: '教育 / 學術',
    icon: '🎓',
    keywords: ['學校', '教育', '補習', '大學', '學院', '學術', '研究', '教授', '老師', '教育', 'school', 'education', 'academy', 'university', 'college', 'learning', 'professor'],
  },
  {
    id: 'manufacturing',
    label: '製造 / 工業',
    icon: '🏭',
    keywords: ['工業', '製造', '機械', '廠', '精密', '模具', '汽車', '材料', 'manufactur', 'industrial', 'machinery', 'factory', 'precision', 'steel'],
  },
  {
    id: 'trade',
    label: '貿易 / 進出口',
    icon: '🌏',
    keywords: ['貿易', '進出口', '出口', '進口', '商行', '實業', 'trading', 'import', 'export', 'enterprise'],
  },
  {
    id: 'food',
    label: '餐飲 / 食品',
    icon: '🍽️',
    keywords: ['餐飲', '食品', '咖啡', '餐', '烘焙', '料理', '飲料', 'restaurant', 'food', 'beverage', 'café', 'cafe', 'bakery', 'catering'],
  },
  {
    id: 'legal',
    label: '法律 / 會計',
    icon: '⚖️',
    keywords: ['律師', '法律', '事務所', '會計師', '專利', 'law', 'legal', 'attorney', 'accountant', 'accounting'],
  },
  {
    id: 'design',
    label: '設計 / 行銷',
    icon: '🎨',
    keywords: ['設計', '創意', '廣告', '行銷', '媒體', '傳播', '品牌', '影像', '攝影', '工作室', 'design', 'creative', 'marketing', 'advertising', 'media', 'studio', 'brand', 'agency'],
  },
  {
    id: 'construction',
    label: '營建 / 工程',
    icon: '🏗️',
    keywords: ['營造', '工程', '營建', '建築', '裝潢', '機電', '水電', 'construction', 'engineering', 'architect', 'contractor', 'civil'],
  },
  {
    id: 'logistics',
    label: '運輸 / 物流',
    icon: '🚚',
    keywords: ['物流', '貨運', '運輸', '倉儲', '快遞', '船務', '航空', 'shipping', 'logistics', 'freight', 'express', 'transport', 'airline', 'courier'],
  },
  {
    id: 'other',
    label: '其他',
    icon: '📇',
    keywords: [],
  },
]

export const CATEGORY_MAP: Record<string, CategoryDef> = Object.fromEntries(
  CATEGORY_DEFS.map((c) => [c.id, c]),
)

export type CardSource = 'ocr' | 'llm' | 'manual' | 'import'

export interface Card {
  id: string
  createdAt: number
  updatedAt: number
  name: string
  title: string
  company: string
  department: string
  phones: string[]
  faxes: string[]
  emails: string[]
  website: string
  address: string
  category: CategoryId
  tags: string[]
  notes: string
  /** OCR 原始文字（保留方便日後重新剖析） */
  rawText: string
  source: CardSource
  /** 裁切後的名片圖（dataURL） */
  imageCropped: string
  /** 原始照片（dataURL，可為空） */
  imageOriginal?: string
  /** 邊緣偵測信心 0~1 */
  confidence?: number
}

/** 辨識結果（LLM / OCR 剖析共用格式） */
export interface Extracted {
  name?: string
  title?: string
  company?: string
  department?: string
  phones?: string[]
  faxes?: string[]
  emails?: string[]
  website?: string
  address?: string
  category?: string
  tags?: string[]
  notes?: string
  rawText?: string
}

export type EngineId = 'builtin' | 'openai' | 'gemini'

/** 自動拍攝模式 */
export type CaptureMode = 'manual' | 'stable' | 'best'

export interface LLMProviderConfig {
  baseUrl: string
  apiKey: string
  model: string
}

export interface Settings {
  /** AI 引擎：builtin=內建 OCR（離線）、openai、gemini */
  engine: EngineId
  openai: LLMProviderConfig
  gemini: LLMProviderConfig
  /** OCR 語言 */
  ocrLang: string
  /** 即時自動裁切 */
  autoCrop: boolean
  /** 自動拍攝模式：manual=手動、stable=邊緣穩定即拍、best=最佳時機 */
  captureMode: CaptureMode
  /** 連續掃描（拍完自動辨識存檔並繼續） */
  continuousScan: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  engine: 'builtin',
  openai: {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
  },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    model: 'gemini-2.0-flash',
  },
  ocrLang: 'chi_tra+eng',
  autoCrop: true,
  captureMode: 'stable',
  continuousScan: false,
}

export const OCR_LANGS: { id: string; label: string }[] = [
  { id: 'chi_tra+eng', label: '繁體中文 + 英文' },
  { id: 'chi_sim+eng', label: '簡體中文 + 英文' },
  { id: 'eng', label: '英文' },
  { id: 'jpn+eng', label: '日文 + 英文' },
]
