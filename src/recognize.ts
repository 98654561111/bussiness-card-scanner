/* ============================================================
 * 共用辨識管線：圖片 → （視覺 AI / OCR）→ 结构化欄位 → Card
 * 單張掃描與批次掃描共用
 * ============================================================ */

import { Card, Extracted, Settings } from './types'
import { ocrRecognize } from './ocr'
import { llmRecognize } from './llm'
import { categorize } from './extract'
import { uid } from './store'

export type RecProgress = (stage: string, ratio: number) => void

export interface RecognizeResult {
  ex: Extracted
  usedLLM: boolean
  /** 視覺 AI 失敗時的錯誤訊息（已自動退回內建 OCR） */
  llmError?: string
}

/** 辨識一張名片圖片：優先視覺 AI（有設 Key 時），失敗自動退回內建 OCR */
export async function recognizeCardImage(
  imageDataUrl: string,
  settings: Settings,
  onProgress?: RecProgress,
): Promise<RecognizeResult> {
  if (settings.engine !== 'builtin') {
    try {
      onProgress?.('傳送圖片給 AI 模型…', 0.2)
      const ex = await llmRecognize(imageDataUrl, settings)
      onProgress?.('AI 辨識完成', 1)
      if (!ex.category) ex.category = categorize(ex.company || '', ex.title || '', '')
      return { ex, usedLLM: true }
    } catch (e: any) {
      const llmError = e?.message || String(e)
      onProgress?.('視覺 AI 失敗，改用內建 OCR…', 0.1)
      const ex = await ocrPath(imageDataUrl, settings, onProgress)
      return { ex, usedLLM: false, llmError }
    }
  }
  const ex = await ocrPath(imageDataUrl, settings, onProgress)
  return { ex, usedLLM: false }
}

async function ocrPath(imageDataUrl: string, settings: Settings, onProgress?: RecProgress): Promise<Extracted> {
  const ex = await ocrRecognize(imageDataUrl, settings.ocrLang, (stage, p) => onProgress?.(stage, p))
  if (!ex.category) ex.category = categorize(ex.company || '', ex.title || '', ex.rawText || '')
  onProgress?.('剖析欄位與自動歸類…', 1)
  return ex
}

export interface CardImages {
  cropped: string
  original: string
  conf?: number
}

/** 辨識結果 + 圖片 → 可儲存的 Card */
export function buildCard(ex: Extracted, images: CardImages, usedLLM: boolean): Card {
  const now = Date.now()
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    name: ex.name || '',
    title: ex.title || '',
    company: ex.company || '',
    department: ex.department || '',
    phones: ex.phones || [],
    faxes: ex.faxes || [],
    emails: ex.emails || [],
    website: ex.website || '',
    address: ex.address || '',
    category: (ex.category as Card['category']) || 'other',
    tags: ex.tags || [],
    notes: ex.notes || '',
    rawText: ex.rawText || '',
    source: usedLLM ? 'llm' : 'ocr',
    imageCropped: images.cropped,
    imageOriginal: images.original,
    confidence: images.conf,
  }
}
