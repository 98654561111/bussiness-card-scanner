/* ============================================================
 * Canvas 影像工具（瀏覽器端）
 * ============================================================ */

import { DetectResult, Pt, Quad, detectCardQuad, quadMovement, quadOutputSize, warpPerspective } from './core'

export { quadMovement }
export type { Quad }

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w))
  c.height = Math.max(1, Math.round(h))
  return c
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.onload = () => res(img)
    img.onerror = () => rej(new Error('圖片載入失敗'))
    img.src = src
  })
}

/** 任意影像來源 → canvas（限制最大邊長） */
export function sourceToCanvas(
  src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  maxDim = Infinity,
): HTMLCanvasElement {
  const sw =
    src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : src.width
  const sh =
    src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : src.height
  const scale = Math.min(1, maxDim / Math.max(sw, sh || 1))
  const c = makeCanvas(sw * scale, sh * scale)
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0, c.width, c.height)
  return c
}

export function canvasToDataUrl(c: HTMLCanvasElement, quality = 0.87): string {
  return c.toDataURL('image/jpeg', quality)
}

export interface Detection extends DetectResult {
  /** 偵測當下的 canvas 尺寸 */
  size: { w: number; h: number }
}

/** 在縮小的影像上偵測名片，回傳「原始座標」的四邊形 */
export function detectOnSource(
  src: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
  smallDim = 460,
): Detection | null {
  const sw =
    src instanceof HTMLVideoElement ? src.videoWidth : src instanceof HTMLImageElement ? src.naturalWidth : src.width
  const sh =
    src instanceof HTMLVideoElement ? src.videoHeight : src instanceof HTMLImageElement ? src.naturalHeight : src.height
  if (!sw || !sh) return null
  const scale = Math.min(1, smallDim / Math.max(sw, sh))
  const small = makeCanvas(sw * scale, sh * scale)
  const sctx = small.getContext('2d', { willReadFrequently: true })!
  sctx.drawImage(src, 0, 0, small.width, small.height)
  const data = sctx.getImageData(0, 0, small.width, small.height)
  const res = detectCardQuad(small.width, small.height, data.data)
  if (!res) return null
  const inv = 1 / scale
  const quad = res.quad.map((p) => ({
    x: Math.max(0, Math.min(sw - 1, p.x * inv)),
    y: Math.max(0, Math.min(sh - 1, p.y * inv)),
  })) as Quad
  return { quad, conf: res.conf, size: { w: sw, h: sh } }
}

/** 依四邊形裁切 + 透視校正，回傳 canvas */
export function cropByQuad(src: HTMLCanvasElement, quad: Quad, maxDim = 1300): HTMLCanvasElement {
  const { w, h } = quadOutputSize(quad, maxDim)
  const ctx = src.getContext('2d', { willReadFrequently: true })!
  const imgData = ctx.getImageData(0, 0, src.width, src.height)
  const out = warpPerspective(src.width, src.height, imgData.data, quad, w, h)
  const c = makeCanvas(w, h)
  const octx = c.getContext('2d')!
  const outData = octx.createImageData(w, h)
  outData.data.set(out)
  octx.putImageData(outData, 0, 0)
  return c
}

/** 90 度旋轉 dataURL 圖片 */
export async function rotateDataUrl(dataUrl: string, deg: 90 | 180 | 270): Promise<string> {
  const img = await loadImage(dataUrl)
  const swap = deg === 90 || deg === 270
  const c = makeCanvas(swap ? img.naturalHeight : img.naturalWidth, swap ? img.naturalWidth : img.naturalHeight)
  const ctx = c.getContext('2d')!
  ctx.translate(c.width / 2, c.height / 2)
  ctx.rotate((deg * Math.PI) / 180)
  ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
  return canvasToDataUrl(c, 0.9)
}

/** 檔案 → dataURL */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(r.result as string)
    r.onerror = () => rej(new Error('檔案讀取失敗'))
    r.readAsDataURL(file)
  })
}

/** 對圖片做自動偵測 + 裁切；偵測失敗時退回整張圖（內縮 2%） */
export async function autoCropDataUrl(
  dataUrl: string,
  maxOriginal = 1800,
): Promise<{ cropped: string; original: string; quad: Quad | null; conf: number; rect: { w: number; h: number } }> {
  const img = await loadImage(dataUrl)
  const originalCanvas = sourceToCanvas(img, maxOriginal)
  const original = canvasToDataUrl(originalCanvas, 0.85)
  const det = detectOnSource(originalCanvas, 480)
  if (det && det.conf >= 0.35) {
    const croppedCanvas = cropByQuad(originalCanvas, det.quad)
    return {
      cropped: canvasToDataUrl(croppedCanvas, 0.88),
      original,
      quad: det.quad,
      conf: det.conf,
      rect: { w: originalCanvas.width, h: originalCanvas.height },
    }
  }
  return {
    cropped: original,
    original,
    quad: null,
    conf: 0,
    rect: { w: originalCanvas.width, h: originalCanvas.height },
  }
}

/** 在 overlay canvas 上畫出偵測框 */
export function drawQuadOverlay(
  canvas: HTMLCanvasElement,
  quad: Quad | null,
  opts: { stable?: boolean; label?: string } = {},
): void {
  const ctx = canvas.getContext('2d')!
  const { width: W, height: H } = canvas
  ctx.clearRect(0, 0, W, H)
  if (!quad) return
  const color = opts.stable ? '#22c55e' : '#fbbf24'
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(2, W / 220)
  ctx.lineJoin = 'round'
  ctx.shadowColor = 'rgba(0,0,0,.45)'
  ctx.shadowBlur = 6
  ctx.beginPath()
  quad.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
  ctx.closePath()
  ctx.stroke()
  ctx.shadowBlur = 0
  ctx.fillStyle = opts.stable ? 'rgba(34,197,94,.12)' : 'rgba(251,191,36,.08)'
  ctx.fill()
  // 角點
  const r = Math.max(4, W / 130)
  for (const p of quad) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = color
    ctx.fill()
    ctx.lineWidth = 2
    ctx.strokeStyle = '#fff'
    ctx.stroke()
  }
  if (opts.label) {
    ctx.font = `600 ${Math.max(12, W / 26)}px "Noto Sans TC", sans-serif`
    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.fillText(opts.label, W / 2, quad[0].y - 12 > 18 ? quad[0].y - 12 : H - 14)
  }
  ctx.restore()
}

export function pointInQuad(p: Pt, q: Quad, tol = 0): boolean {
  let s = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (i === 0) s = Math.sign(cross)
    else if (Math.sign(cross) !== s && Math.abs(cross) > tol) return false
  }
  return true
}
