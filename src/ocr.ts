/* ============================================================
 * 內建 OCR（Tesseract.js，由 CDN 載入、瀏覽器端執行）
 * worker 依語言快取重用（批次掃描不用每次重建）
 * ============================================================ */

import { Extracted } from './types'
import { extractFields } from './extract'

const TESSERACT_CDN = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js'

let scriptPromise: Promise<any> | null = null

function loadTesseract(): Promise<any> {
  const w = window as any
  if (w.Tesseract) return Promise.resolve(w.Tesseract)
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = TESSERACT_CDN
      s.onload = () => resolve((window as any).Tesseract)
      s.onerror = () => {
        scriptPromise = null
        reject(new Error('無法載入 OCR 引擎，請確認網路連線後重試'))
      }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

export type OCRProgress = (stage: string, progress: number) => void

const STAGE_TEXT: Record<string, string> = {
  'loading tesseract core': '下載辨識核心…',
  'initializing tesseract': '初始化辨識引擎…',
  'loading language traineddata': '下載語言模型（首次較慢）…',
  'initializing api': '準備辨識…',
  'recognizing text': '文字辨識中…',
}

let workerP: Promise<any> | null = null
let workerLang = ''
let activeProgress: OCRProgress | null = null

async function getWorker(lang: string): Promise<any> {
  const T = await loadTesseract()
  if (workerP && workerLang === lang) return workerP
  if (workerP) {
    workerP.then((w) => w.terminate()).catch(() => {})
    workerP = null
  }
  workerLang = lang
  workerP = T.createWorker(lang, 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (!activeProgress || !m.status) return
      activeProgress(STAGE_TEXT[m.status] ?? '處理中…', typeof m.progress === 'number' ? m.progress : 0)
    },
  })
  return workerP
}

/** 釋放 OCR worker（批次結束 / 離開頁面時呼叫） */
export function ocrDispose(): void {
  if (workerP) {
    workerP.then((w) => w.terminate()).catch(() => {})
    workerP = null
    workerLang = ''
  }
}

/** OCR 辨識（worker 重用） */
export async function ocrRecognize(
  imageDataUrl: string,
  lang = 'chi_tra+eng',
  onProgress?: OCRProgress,
): Promise<Extracted> {
  const worker = await getWorker(lang)
  activeProgress = onProgress ?? null
  try {
    const ret = await worker.recognize(imageDataUrl)
    const text: string = ret?.data?.text ?? ''
    const fields = extractFields(text)
    fields.rawText = text
    return fields
  } finally {
    activeProgress = null
  }
}
