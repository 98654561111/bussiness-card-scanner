/* ============================================================
 * 內建 OCR 引擎（二）：PaddleOCR PP-OCRv5（@ocr-web/core）
 * 純瀏覽器端、onnxruntime-web + WASM，支援中 / 英 / 日 / 繁中
 * 單一模型一次辨識，中文準確度明顯優於 Tesseract
 * 模型與字典自 jsDelivr CDN 載入（CORS 友好），WASM 走 CDN
 * ============================================================ */

import { Extracted } from './types'
import { extractFields } from './extract'

export type OCRProgress = (stage: string, progress: number) => void

const ORT_WASM_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.25.0/dist/'

let engineP: Promise<any> | null = null
let failedOnce = false

async function getEngine(): Promise<any> {
  if (engineP) return engineP
  engineP = (async () => {
    const [{ OcrEngine }, models] = await Promise.all([
      import('@ocr-web/core'),
      import('@ocr-web/models-ppocrv5'),
    ])
    // 單執行緒 WASM：不需要 SharedArrayBuffer / COOP-COEP 標頭
    return OcrEngine.create({
      models: {
        detection: (models as any).ppocrV5.detection,
        recognition: (models as any).ppocrV5.recognition,
      },
      dictionary: (models as any).ppocrV5.dictionary,
      wasmPaths: ORT_WASM_CDN,
      numThreads: 1,
    })
  })()
  return engineP
}

/** 釋放 PP-OCRv5 引擎（批次結束 / 離開頁面時呼叫） */
export function paddleDispose(): void {
  if (engineP) {
    engineP.then((e) => e?.dispose?.()).catch(() => {})
    engineP = null
  }
  failedOnce = false
}

/** PP-OCRv5 辨識（引擎實例快取重用，模型只下載一次） */
export async function paddleRecognize(imageDataUrl: string, onProgress?: OCRProgress): Promise<Extracted> {
  if (failedOnce) throw new Error('PaddleOCR 引擎已失敗，請改用其他辨識引擎')
  onProgress?.('載入 PP-OCRv5 模型（首次較慢）…', 0.1)
  let engine: any
  try {
    engine = await getEngine()
  } catch (e: any) {
    failedOnce = true
    engineP = null
    throw new Error(`無法啟動 PaddleOCR 引擎：${e?.message || e}`)
  }
  onProgress?.('PP-OCRv5 文字辨識中…', 0.5)
  const result = await engine.recognize(imageDataUrl)
  const text: string =
    (result && (result.fullText || (result.lines || []).map((l: any) => l.text).join('\n'))) || ''
  if (!text.trim()) throw new Error('PaddleOCR 沒有辨識出任何文字')
  const fields = extractFields(text)
  fields.rawText = text
  onProgress?.('剖析欄位與自動歸類…', 1)
  return fields
}
