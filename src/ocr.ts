/* ============================================================
 * 內建 OCR（Tesseract.js，由 CDN 載入、瀏覽器端執行）
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
  'recognizing text': 'AI 文字辨識中…',
}

/** OCR 一次辨識（建立 worker → 辨識 → 釋放） */
export async function ocrRecognize(
  imageDataUrl: string,
  lang = 'chi_tra+eng',
  onProgress?: OCRProgress,
): Promise<Extracted> {
  const T = await loadTesseract()
  const worker = await T.createWorker(lang, 1, {
    logger: (m: { status?: string; progress?: number }) => {
      if (!onProgress || !m.status) return
      const label = STAGE_TEXT[m.status] ?? '處理中…'
      onProgress(label, typeof m.progress === 'number' ? m.progress : 0)
    },
  })
  try {
    const ret = await worker.recognize(imageDataUrl)
    const text: string = ret?.data?.text ?? ''
    const fields = extractFields(text)
    fields.rawText = text
    return fields
  } finally {
    worker.terminate().catch(() => {})
  }
}
