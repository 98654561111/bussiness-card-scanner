/* ============================================================
 * 視覺核心（純數學、無 DOM 依賴 — 可在 Node 做單元測試）
 *
 * 流程：灰階 → Sobel 邊緣 → 自適應二值化 → 膨脹 → 連通區塊
 *       → 最大區塊邊界 → 凸包 → 簡化為四邊形（名片框）
 *       → 單應矩陣(Homography) 透視校正
 * ============================================================ */

export interface Pt {
  x: number
  y: number
}

/** 四邊形，順序：左上、右上、右下、左下 */
export type Quad = [Pt, Pt, Pt, Pt]

export interface DetectResult {
  quad: Quad
  /** 信心度 0~1 */
  conf: number
}

export interface CandidateDebug {
  size: number
  reason?: string
  aspect?: number
  sizeRatio?: number
  score?: number
  quad?: Quad
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function quadArea(q: Pt[]): number {
  let a = 0
  for (let i = 0; i < q.length; i++) {
    const p = q[i]
    const n = q[(i + 1) % q.length]
    a += p.x * n.y - n.x * p.y
  }
  return Math.abs(a) / 2
}

export function ringPerimeter(pts: Pt[]): number {
  let p = 0
  for (let i = 0; i < pts.length; i++) p += dist(pts[i], pts[(i + 1) % pts.length])
  return p
}

/** Andrew 單調鏈凸包 */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return points.slice()
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y)
  const cross = (o: Pt, a: Pt, b: Pt) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  const lower: Pt[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Pt[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  lower.pop()
  upper.pop()
  return lower.concat(upper)
}

function perpDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return dist(p, a)
  return Math.abs(dy * (p.x - a.x) - dx * (p.y - a.y)) / len
}

/** Douglas–Peucker 折線簡化 */
export function simplify(points: Pt[], eps: number): Pt[] {
  if (points.length <= 2) return points.slice()
  const a = points[0]
  const b = points[points.length - 1]
  let idx = -1
  let maxD = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b)
    if (d > maxD) {
      maxD = d
      idx = i
    }
  }
  if (maxD > eps && idx > 0) {
    const left = simplify(points.slice(0, idx + 1), eps)
    const right = simplify(points.slice(idx), eps)
    return left.slice(0, left.length - 1).concat(right)
  }
  return [a, b]
}

/** 封閉環簡化：取最左上角當錨點 */
function simplifyRing(ring: Pt[], eps: number): Pt[] {
  if (ring.length < 4) return ring.slice()
  let ai = 0
  ring.forEach((p, i) => {
    if (p.x + p.y < ring[ai].x + ring[ai].y) ai = i
  })
  const opened = ring.slice(ai).concat(ring.slice(0, ai))
  opened.push(opened[0])
  const s = simplify(opened, eps)
  s.pop()
  return s
}

/** 將四點以質心角度排序，並讓起點為最接近左上者 */
export function orderQuad(pts: Pt[]): Quad {
  if (pts.length !== 4) throw new Error('orderQuad 需要 4 個點')
  const cx = pts.reduce((s, p) => s + p.x, 0) / 4
  const cy = pts.reduce((s, p) => s + p.y, 0) / 4
  const sorted = pts
    .slice()
    .sort((p, q) => Math.atan2(p.y - cy, p.x - cx) - Math.atan2(q.y - cy, q.x - cx))
  // 螢幕座標 y 向下：確定順時針（正鞋帶面積）
  let area2 = 0
  for (let i = 0; i < 4; i++) {
    const p = sorted[i]
    const n = sorted[(i + 1) % 4]
    area2 += p.x * n.y - n.x * p.y
  }
  if (area2 < 0) sorted.reverse()
  let start = 0
  let best = Infinity
  sorted.forEach((p, i) => {
    if (p.x + p.y < best) {
      best = p.x + p.y
      start = i
    }
  })
  const r = sorted.slice(start).concat(sorted.slice(0, start))
  return [r[0], r[1], r[2], r[3]]
}

/** 旋轉卡尺：凸包的最小面積外接矩形 */
export function minAreaRect(hull: Pt[]): Quad {
  let best: Quad | null = null
  let bestA = Infinity
  const m = hull.length
  for (let i = 0; i < m; i++) {
    const a = hull[i]
    const b = hull[(i + 1) % m]
    const len = dist(a, b)
    if (len < 1e-6) continue
    const ux = (b.x - a.x) / len
    const uy = (b.y - a.y) / len
    const vx = -uy
    const vy = ux
    let minU = Infinity
    let maxU = -Infinity
    let minV = Infinity
    let maxV = -Infinity
    for (const p of hull) {
      const u = (p.x - a.x) * ux + (p.y - a.y) * uy
      const v = (p.x - a.x) * vx + (p.y - a.y) * vy
      if (u < minU) minU = u
      if (u > maxU) maxU = u
      if (v < minV) minV = v
      if (v > maxV) maxV = v
    }
    const area = (maxU - minU) * (maxV - minV)
    if (area < bestA) {
      bestA = area
      const corner = (uu: number, vv: number): Pt => ({ x: a.x + ux * uu + vx * vv, y: a.y + uy * uu + vy * vv })
      best = [corner(minU, minV), corner(maxU, minV), corner(maxU, maxV), corner(minU, maxV)]
    }
  }
  if (!best) return orderQuad(hull.slice(0, 4))
  return orderQuad(best)
}

/** 四邊形向質心內縮（去掉膨脹時多抓的背景） */
export function insetQuad(q: Quad, f: number): Quad {
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  return q.map((p) => ({ x: cx + (p.x - cx) * (1 - f), y: cy + (p.y - cy) * (1 - f) })) as Quad
}

/** 兩四邊形的平均角點移動量（以對角線長度正規化） */
export function quadMovement(a: Quad | null, b: Quad | null): number {
  if (!a || !b) return Infinity
  const diag = Math.max(dist(a[0], a[2]), dist(a[1], a[3]), 1)
  let sum = 0
  for (let i = 0; i < 4; i++) sum += dist(a[i], b[i])
  return sum / 4 / diag
}

/* ---------------- 邊緣偵測（候選框評分搜尋） ---------------- */

interface MagMap {
  data: Float32Array
  w: number
  h: number
  q95: number
}

function clampI(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v
}

/** 建立模糊後的 Sobel 梯度圖 */
function buildMagMap(w: number, h: number, rgba: Uint8ClampedArray, targetW: number): MagMap {
  const sc = Math.min(1, targetW / Math.max(w, h))
  const mw = Math.max(24, Math.round(w * sc))
  const mh = Math.max(24, Math.round(h * sc))

  // 最近鄰取樣成灰階
  const gray = new Float32Array(mw * mh)
  for (let y = 0; y < mh; y++) {
    const sy = clampI(Math.round(y / sc), 0, h - 1)
    for (let x = 0; x < mw; x++) {
      const sx = clampI(Math.round(x / sc), 0, w - 1)
      const j = (sy * w + sx) * 4
      gray[y * mw + x] = (rgba[j] * 0.299 + rgba[j + 1] * 0.587 + rgba[j + 2] * 0.114)
    }
  }

  // Sobel
  const mag = new Float32Array(mw * mh)
  for (let y = 1; y < mh - 1; y++) {
    for (let x = 1; x < mw - 1; x++) {
      const i = y * mw + x
      const gx =
        -gray[i - mw - 1] - 2 * gray[i - 1] - gray[i + mw - 1] + gray[i - mw + 1] + 2 * gray[i + 1] + gray[i + mw + 1]
      const gy =
        -gray[i - mw - 1] - 2 * gray[i - mw] - gray[i - mw + 1] + gray[i + mw - 1] + 2 * gray[i + mw] + gray[i + mw + 1]
      mag[i] = Math.sqrt(gx * gx + gy * gy)
    }
  }

  // 3x3 box 模糊（分離式）
  const tmp = new Float32Array(mag.length)
  const out = new Float32Array(mag.length)
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x
      tmp[i] = (mag[i] + mag[clampI(i - 1, 0, mag.length - 1)] + mag[clampI(i + 1, 0, mag.length - 1)]) / 3
    }
  }
  for (let y = 0; y < mh; y++) {
    for (let x = 0; x < mw; x++) {
      const i = y * mw + x
      const up = clampI((y - 1) * mw + x, 0, out.length - 1)
      const dn = clampI((y + 1) * mw + x, 0, out.length - 1)
      out[i] = (tmp[i] + tmp[up] + tmp[dn]) / 3
    }
  }

  // 95 百分位（信心度正規化用）
  const HIST = 1024
  const hist = new Int32Array(HIST + 1)
  let overflow = 0
  for (let i = 0; i < out.length; i++) {
    const v = out[i] | 0
    if (v > HIST) overflow++
    else hist[v]++
  }
  const cutoff = Math.max(1, Math.round(out.length * 0.95 - overflow))
  let acc = 0
  let q95 = HIST
  for (let v = 0; v <= HIST; v++) {
    acc += hist[v]
    if (acc >= cutoff) {
      q95 = v
      break
    }
  }
  return { data: out, w: mw, h: mh, q95 }
}

function bilinear(m: MagMap, x: number, y: number): number {
  const sx = clampI(x, 0, m.w - 1)
  const sy = clampI(y, 0, m.h - 1)
  const x0 = Math.floor(sx)
  const y0 = Math.floor(sy)
  const x1 = Math.min(x0 + 1, m.w - 1)
  const y1 = Math.min(y0 + 1, m.h - 1)
  const fx = sx - x0
  const fy = sy - y0
  const d = m.data
  return (
    d[y0 * m.w + x0] * (1 - fx) * (1 - fy) +
    d[y0 * m.w + x1] * fx * (1 - fy) +
    d[y1 * m.w + x0] * (1 - fx) * fy +
    d[y1 * m.w + x1] * fx * fy
  )
}

function quadAt(cx: number, cy: number, cw: number, chh: number, rot: number): Quad {
  const cs = Math.cos(rot)
  const sn = Math.sin(rot)
  const hw = cw / 2
  const hh = chh / 2
  const p = (dx: number, dy: number): Pt => ({ x: cx + dx * cs - dy * sn, y: cy + dx * sn + dy * cs })
  return [p(-hw, -hh), p(hw, -hh), p(hw, hh), p(-hw, hh)]
}

/** 評分：邊界平均梯度（越大越好）− 內部平均梯度（越亂越扣分） */
interface EvalParts {
  boundary: number
  interior: number
  score: number
}

const SAMPLE_OFFSETS = [0, 1.5, -1.5, 3.2, -3.2]

function evalQuadParts(m: MagMap, q: Quad): EvalParts {
  let bSum = 0
  const SPE = 8 // 每邊取樣數
  for (let e = 0; e < 4; e++) {
    const a = q[e]
    const b = q[(e + 1) % 4]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len = Math.hypot(dx, dy) || 1
    const nx = -dy / len
    const ny = dx / len
    for (let s = 0; s < SPE; s++) {
      const t = (s + 0.5) / SPE
      const x = a.x + dx * t
      const y = a.y + dy * t
      let v = 0
      for (const off of SAMPLE_OFFSETS) {
        const vv = bilinear(m, x + nx * off, y + ny * off)
        if (vv > v) v = vv
      }
      bSum += v
    }
  }
  const boundary = bSum / (4 * SPE)

  let iSum = 0
  const GI = 5
  const GJ = 4
  for (let gi = 0; gi < GI; gi++) {
    const u = 0.18 + (0.64 * gi) / (GI - 1)
    for (let gj = 0; gj < GJ; gj++) {
      const v = 0.18 + (0.64 * gj) / (GJ - 1)
      const x = q[0].x + (q[1].x - q[0].x) * u + (q[3].x - q[0].x) * v + (q[2].x - q[1].x - q[3].x + q[0].x) * u * v
      const y = q[0].y + (q[1].y - q[0].y) * u + (q[3].y - q[0].y) * v + (q[2].y - q[1].y - q[3].y + q[0].y) * u * v
      iSum += bilinear(m, x, y)
    }
  }
  const interior = iSum / (GI * GJ)
  return { boundary, interior, score: boundary - 1.15 * interior }
}

interface SearchHit {
  quad: Quad
  score: number
  boundary: number
}

function quadInside(q: Quad, w: number, h: number, margin: number): boolean {
  for (const p of q) {
    if (p.x < margin || p.y < margin || p.x > w - 1 - margin || p.y > h - 1 - margin) return false
  }
  return true
}

function lin(from: number, to: number, step: number): number[] {
  const out: number[] = []
  for (let v = from; v <= to + 1e-9; v += step) out.push(v)
  return out
}

/** 綜合評分：邊界 − 內部，加上「越大越好」與「居中偏好」的輕微加權 */
function scoreQuad(m: MagMap, q: Quad): SearchHit {
  const parts = evalQuadParts(m, q)
  const areaFrac = quadArea(q) / (m.w * m.h)
  const sizeBonus = 1 + 0.4 * Math.min(1, areaFrac / 0.4)
  const cx = (q[0].x + q[1].x + q[2].x + q[3].x) / 4
  const cy = (q[0].y + q[1].y + q[2].y + q[3].y) / 4
  const centerW = 1 - 0.1 * Math.min(1, Math.hypot(cx - m.w / 2, cy - m.h / 2) / Math.hypot(m.w / 2, m.h / 2))
  return { quad: q, score: parts.score * sizeBonus * centerW, boundary: parts.boundary }
}

function tryBest(m: MagMap, aspects: number[], rots: number[], cws: number[], cxs: number[], cys: number[]): SearchHit | null {
  let best: SearchHit | null = null
  for (const aspect of aspects) {
    for (const rot of rots) {
      for (const cw of cws) {
        const ch = cw / aspect
        for (const cx of cxs) {
          for (const cy of cys) {
            const q = quadAt(cx, cy, cw, ch, rot)
            if (!quadInside(q, m.w, m.h, 1)) continue
            const hit = scoreQuad(m, q)
            if (best === null || hit.score > best.score) best = hit
          }
        }
      }
    }
  }
  return best
}

function hitParams(hit: SearchHit): { cx: number; cy: number; cw: number; rot: number; aspect: number } {
  const cx = (hit.quad[0].x + hit.quad[1].x + hit.quad[2].x + hit.quad[3].x) / 4
  const cy = (hit.quad[0].y + hit.quad[1].y + hit.quad[2].y + hit.quad[3].y) / 4
  const cw = Math.max(dist(hit.quad[0], hit.quad[1]), dist(hit.quad[3], hit.quad[2]))
  const ch = Math.max(dist(hit.quad[0], hit.quad[3]), dist(hit.quad[1], hit.quad[2]))
  const dx = hit.quad[1].x - hit.quad[0].x
  const dy = hit.quad[1].y - hit.quad[0].y
  let rot = Math.atan2(dy, dx)
  if (rot > Math.PI / 2) rot -= Math.PI
  if (rot < -Math.PI / 2) rot += Math.PI
  return { cx, cy, cw, rot, aspect: cw / Math.max(1e-6, ch) }
}

/** 全域粗搜（旋轉 ±17°、多種長寬比） */
function coarseSearch(m: MagMap): SearchHit | null {
  const rots = lin(-0.3, 0.3, 0.15)
  const cws: number[] = []
  for (let f = 0.97; f >= 0.32; f *= 0.87) cws.push(m.w * f)
  const cxs = lin(m.w * 0.14, m.w * 0.86, Math.max(7, m.w * 0.07))
  const cys = lin(m.h * 0.14, m.h * 0.86, Math.max(7, m.h * 0.09))
  return tryBest(m, [1.75, 1.45, 1.2, 0.7, 1 / 1.75], rots, cws, cxs, cys)
}

/** 局部精修（位置 / 尺寸 / 角度 / 長寬比） */
function refineSearch(m: MagMap, hit: SearchHit, rad: number): SearchHit | null {
  const p = hitParams(hit)
  const a0 = Math.max(0.45, Math.min(2.6, p.aspect / 1.22))
  const a1 = Math.max(0.45, Math.min(2.6, p.aspect * 1.22))
  const aspects = lin(a0, a1, Math.max(0.03, (a1 - a0) / 6))
  const rotSpan = Math.max(0.035, rad * 1.1)
  const rots = lin(p.rot - rotSpan, p.rot + rotSpan, Math.max(0.012, rad * 0.3))
  const cws = lin(p.cw * (1 - rad), p.cw * (1 + rad), Math.max(1, p.cw * rad * 0.3))
  const posRad = Math.max(2, p.cw * rad)
  const cxs = lin(p.cx - posRad, p.cx + posRad, Math.max(1, posRad * 0.34))
  const cys = lin(p.cy - posRad, p.cy + posRad, Math.max(1, posRad * 0.34))
  const refined = tryBest(m, aspects, rots, cws, cxs, cys)
  return refined && refined.score > hit.score * 0.75 ? refined : hit
}

/**
 * 向外擴張：若最佳框其實是名片內部的高對比圖形（logo、色塊），
 * 再做一次全域搜尋，找「包含它、且邊界夠強」的更大外框（真正的名片邊界）。
 */
function containsQuad(outer: Quad, inner: Quad): boolean {
  const sign = (ax: number, ay: number, bx: number, by: number, px: number, py: number) =>
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
  for (const p of inner) {
    const s1 = sign(outer[0].x, outer[0].y, outer[1].x, outer[1].y, p.x, p.y)
    const s2 = sign(outer[1].x, outer[1].y, outer[2].x, outer[2].y, p.x, p.y)
    const s3 = sign(outer[2].x, outer[2].y, outer[3].x, outer[3].y, p.x, p.y)
    const s4 = sign(outer[3].x, outer[3].y, outer[0].x, outer[0].y, p.x, p.y)
    const hasPos = s1 > 0 || s2 > 0 || s3 > 0 || s4 > 0
    const hasNeg = s1 < 0 || s2 < 0 || s3 < 0 || s4 < 0
    if (hasPos && hasNeg) return false
  }
  return true
}

function growOuter(m: MagMap, hit: SearchHit): SearchHit {
  const refParts = evalQuadParts(m, hit.quad)
  if (refParts.boundary < 1) return hit
  const p = hitParams(hit)
  const innerArea = quadArea(hit.quad)

  const rots = lin(p.rot - 0.22, p.rot + 0.22, 0.11)
  const cws = lin(p.cw * 1.25, m.w * 0.99, Math.max(4, p.cw * 0.13))
  const cxs = lin(m.w * 0.12, m.w * 0.88, Math.max(6, m.w * 0.06))
  const cys = lin(m.h * 0.12, m.h * 0.88, Math.max(6, m.h * 0.08))
  const aspects = Array.from(new Set([1.75, 1.586, 1.4, 1.22, 1 / 1.75, Math.round(p.aspect * 100) / 100]))

  let best: SearchHit | null = null
  for (const aspect of aspects) {
    for (const rot of rots) {
      for (const cw of cws) {
        const ch = cw / aspect
        for (const cx of cxs) {
          for (const cy of cys) {
            const q = quadAt(cx, cy, cw, ch, rot)
            if (!quadInside(q, m.w, m.h, 1)) continue
            if (quadArea(q) < innerArea * 1.45) continue
            if (!containsQuad(q, hit.quad)) continue
            const parts = evalQuadParts(m, q)
            if (parts.boundary < refParts.boundary * 0.55) continue
            const cand = scoreQuad(m, q)
            if (best === null || cand.score > best.score) best = cand
          }
        }
      }
    }
  }
  return best ?? hit
}

function cur_aspect(hit: SearchHit): number {
  return hitParams(hit).aspect
}

/**
 * 偵測畫面中的名片四邊形。
 * 策略：縮圖全域粗搜（邊界梯度 − 內部紋理）→ 向外擴張 → 提高解析度局部精修。
 */
export function detectCardQuad(
  w: number,
  h: number,
  rgba: Uint8ClampedArray,
  dbg?: CandidateDebug[],
): DetectResult | null {
  if (w * h < 400) return null

  const scales = Math.max(w, h) > 260 ? [220, 460] : [Math.max(w, h)]

  let hit: SearchHit | null = null
  let map: MagMap | null = null
  let prev: MagMap | null = null

  for (const targetW of scales) {
    map = buildMagMap(w, h, rgba, targetW)
    if (hit && prev) {
      const k = map.w / prev.w
      const p = hitParams(hit)
      const moved: SearchHit = {
        quad: hit.quad.map((pt) => ({ x: pt.x * k, y: pt.y * k })) as Quad,
        score: hit.score,
        boundary: hit.boundary,
      }
      const centered = { quad: moved.quad, score: moved.score, boundary: moved.boundary }
      hit = refineSearch(map, centered, 0.09) ?? centered
    } else {
      hit = coarseSearch(map)
      if (!hit) return null
      hit = growOuter(map, hit)
      hit = refineSearch(map, hit, 0.12)
    }
    prev = map
  }
  if (!hit || !map) return null
  // 最終細修（小步進，提升角點精度）
  hit = refineSearch(map, hit, 0.035) ?? hit

  // 映射回原圖座標
  const k = w / map.w
  const quadRaw = hit.quad.map((p) => ({ x: p.x * k, y: p.y * k })) as Quad
  const relScore = hit.score / (map.q95 + 8)
  dbg?.push({ size: hit.score, score: relScore, quad: quadRaw })

  // 信心度：分數相對全圖 95 百分位梯度
  const conf = Math.max(0, Math.min(1, relScore * 0.92))
  if (conf < 0.3) return null

  // 稍微內縮，避免吃到名片外的背景邊
  const inset = insetQuad(quadRaw, 0.008)
  const clamped = inset.map((p) => ({
    x: Math.max(0, Math.min(w - 1, p.x)),
    y: Math.max(0, Math.min(h - 1, p.y)),
  })) as Quad
  return { quad: clamped, conf }
}

/* ---------------- Homography 透視校正 ---------------- */

/** 以高斯消去解 A·x = b（方陣 n×n） */
function gaussianSolve(A: number[][], b: number[], n: number): void {
  for (let col = 0; col < n; col++) {
    // 部分樞軸
    let piv = col
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r
    if (Math.abs(A[piv][col]) < 1e-12) continue
    if (piv !== col) {
      const t = A[piv]
      A[piv] = A[col]
      A[col] = t
      const tb = b[piv]
      b[piv] = b[col]
      b[col] = tb
    }
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = A[r][col] / A[col][col]
      if (f === 0) continue
      for (let c = col; c < n; c++) A[r][c] -= f * A[col][c]
      b[r] -= f * b[col]
    }
  }
  for (let i = 0; i < n; i++) b[i] = Math.abs(A[i][i]) < 1e-12 ? 0 : b[i] / A[i][i]
}

/**
 * 解 4 對點的單應矩陣（h[8]=1），回傳 9 元素陣列（列主序），
 * 將 src 平面映射到 dst 平面。
 */
export function solveH(src: Pt[], dst: Pt[]): number[] {
  const A: number[][] = []
  const b: number[] = []
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i]
    const X = dst[i].x
    const Y = dst[i].y
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X])
    b.push(X)
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y])
    b.push(Y)
  }
  gaussianSolve(A, b, 8)
  return [...b.slice(0, 8), 1]
}

export function applyH(h: number[], x: number, y: number): Pt {
  const d = h[6] * x + h[7] * y + h[8]
  return { x: (h[0] * x + h[1] * y + h[2]) / d, y: (h[3] * x + h[4] * y + h[5]) / d }
}

/** 依四邊形輸出尺寸建議（以最長邊為準，上限 maxDim） */
export function quadOutputSize(q: Quad, maxDim = 1300): { w: number; h: number } {
  const top = dist(q[0], q[1])
  const bottom = dist(q[3], q[2])
  const left = dist(q[0], q[3])
  const right = dist(q[1], q[2])
  let w = Math.max(top, bottom)
  let h = Math.max(left, right)
  const scale = Math.min(1, maxDim / Math.max(w, h))
  w = Math.max(16, Math.round(w * scale))
  h = Math.max(16, Math.round(h * scale))
  return { w, h }
}

/**
 * 透視校正：把 src 影像中的 quad 校正成 outW×outH 的矩形（雙線性取樣）。
 */
export function warpPerspective(
  srcW: number,
  srcH: number,
  src: Uint8ClampedArray,
  quad: Quad,
  outW: number,
  outH: number,
): Uint8ClampedArray {
  const dstRect: Quad = [
    { x: 0, y: 0 },
    { x: outW - 1, y: 0 },
    { x: outW - 1, y: outH - 1 },
    { x: 0, y: outH - 1 },
  ]
  // dst -> src 的映射，直接逆向取樣
  const H = solveH(dstRect, quad)
  const out = new Uint8ClampedArray(outW * outH * 4)
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const p = applyH(H, x, y)
      const sx = Math.max(0, Math.min(srcW - 1, p.x))
      const sy = Math.max(0, Math.min(srcH - 1, p.y))
      const x0 = sx | 0
      const y0 = sy | 0
      const x1 = Math.min(x0 + 1, srcW - 1)
      const y1 = Math.min(y0 + 1, srcH - 1)
      const fx = sx - x0
      const fy = sy - y0
      const i00 = (y0 * srcW + x0) * 4
      const i10 = (y0 * srcW + x1) * 4
      const i01 = (y1 * srcW + x0) * 4
      const i11 = (y1 * srcW + x1) * 4
      const o = (y * outW + x) * 4
      for (let c = 0; c < 4; c++) {
        const v =
          src[i00 + c] * (1 - fx) * (1 - fy) +
          src[i10 + c] * fx * (1 - fy) +
          src[i01 + c] * (1 - fx) * fy +
          src[i11 + c] * fx * fy
        out[o + c] = v
      }
    }
  }
  return out
}
