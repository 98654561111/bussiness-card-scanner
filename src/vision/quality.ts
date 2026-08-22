/* ============================================================
 * 畫面品質評估（純數學、可在 Node 測試）
 * 清晰度（Laplacian 變異數）、亮度、對比 → 自動拍攝時機評分
 * ============================================================ */

export interface FrameQuality {
  /** 清晰度 0~1（Laplacian 變異數，對數正規化） */
  sharpness: number
  /** 平均亮度 0~1 */
  brightness: number
  /** 對比 0~1 */
  contrast: number
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

/** 計算一幀的畫面品質（建議輸入已縮小的影像，如 160x120） */
export function frameQuality(w: number, h: number, rgba: Uint8ClampedArray): FrameQuality {
  const n = w * h
  const gray = new Uint8Array(n)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const j = i * 4
    const g = (rgba[j] * 299 + rgba[j + 1] * 587 + rgba[j + 2] * 114) / 1000
    gray[i] = g
    sum += g
  }
  const mean = sum / n
  let varr = 0
  for (let i = 0; i < n; i++) varr += (gray[i] - mean) * (gray[i] - mean)
  const std = Math.sqrt(varr / n)

  // Laplacian 變異數（清晰度指標）
  let lapSum = 0
  let lapSum2 = 0
  let cnt = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w]
      lapSum += lap
      lapSum2 += lap * lap
      cnt++
    }
  }
  const lapMean = lapSum / Math.max(1, cnt)
  const lapVar = Math.max(0, lapSum2 / Math.max(1, cnt) - lapMean * lapMean)
  const sharpness = clamp01(Math.log10(1 + lapVar) / 2.4)
  return { sharpness, brightness: mean / 255, contrast: clamp01(std / 70) }
}

/** 鐘形函數：v 在 [lo, hi] 內為 1，往外 soft 距離衰減到 0 */
function bell(v: number, lo: number, hi: number, soft: number): number {
  if (v < lo) return clamp01((v - (lo - soft)) / soft)
  if (v > hi) return clamp01(((hi + soft) - v) / soft)
  return 1
}

export interface CaptureInput {
  /** 邊緣穩定度 0~1（1 = 幾乎不動） */
  stability: number
  /** 名片佔畫面比例（quadArea / 畫面積），無偵測為 null */
  quadRatio: number | null
  quality: FrameQuality
}

export interface CaptureEval {
  /** 綜合拍攝時機分數 0~1 */
  score: number
  /** 改善建議（最多 2 條） */
  hints: string[]
  /** 是否為理想拍攝時機 */
  ready: boolean
}

/**
 * 綜合評估自動拍攝時機。
 * 權重：穩定 35% + 構圖 25% + 清晰 25% + 亮度 15%
 */
export function evaluateCapture(cond: CaptureInput): CaptureEval {
  const hints: string[] = []
  const { stability, quadRatio, quality } = cond

  const sStab = clamp01(stability)
  if (sStab < 0.6) hints.push('拿穩一點')

  let sFrame = 0.5
  if (quadRatio != null) {
    sFrame = bell(quadRatio, 0.22, 0.62, 0.12)
    if (quadRatio < 0.2) hints.push('再靠近一點')
    else if (quadRatio > 0.75) hints.push('拿遠一點，整張名片入鏡')
  }

  const sSharp = clamp01(quality.sharpness * 1.4)
  if (quality.sharpness < 0.45) hints.push('有點模糊')

  let sBright = 1
  if (quality.brightness < 0.22) {
    sBright = clamp01((quality.brightness - 0.05) / 0.17)
    hints.push('光線太暗')
  } else if (quality.brightness > 0.88) {
    sBright = clamp01((1.02 - quality.brightness) / 0.14)
    hints.push('光線太亮')
  }

  const score = clamp01(sStab * 0.35 + sFrame * 0.25 + sSharp * 0.25 + sBright * 0.15)
  return { score, hints: hints.slice(0, 2), ready: score >= 0.72 && hints.length === 0 }
}
