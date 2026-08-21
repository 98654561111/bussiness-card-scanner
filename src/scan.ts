/* ============================================================
 * 掃描頁：即時邊緣偵測 → 自動裁切 → AI 辨識 → 自動歸類 → 儲存
 * ============================================================ */

import { Card, Extracted, Settings } from './types'
import { loadSettings, saveCard, saveSettings, uid } from './store'
import { ocrRecognize } from './ocr'
import { engineLabel, llmRecognize } from './llm'
import { categorize } from './extract'
import {
  autoCropDataUrl,
  canvasToDataUrl,
  cropByQuad,
  detectOnSource,
  drawQuadOverlay,
  fileToDataUrl,
  loadImage,
  makeCanvas,
  rotateDataUrl,
  sourceToCanvas,
} from './vision/canvas'
import { Quad, quadMovement } from './vision/core'
import { cardFormHTML, esc, icon, openModal, readCardForm, toast } from './components'

/* ---------- 狀態 ---------- */
interface ScanState {
  mode: 'idle' | 'live' | 'review'
  stream: MediaStream | null
  original: string
  cropped: string
  quad: Quad | null
  rect: { w: number; h: number }
  conf: number
  extracted: Extracted | null
  busy: boolean
  useOriginal: boolean
  lastQuad: Quad | null
  stableTicks: number
  stableSince: number
  raf: number
}

const state: ScanState = {
  mode: 'idle',
  stream: null,
  original: '',
  cropped: '',
  quad: null,
  rect: { w: 0, h: 0 },
  conf: 0,
  extracted: null,
  busy: false,
  useOriginal: false,
  lastQuad: null,
  stableTicks: 0,
  stableSince: 0,
  raf: 0,
}

let settings: Settings = loadSettings()
let sampleIdx = 0
let onSaved: (() => void) | null = null

export function setScanRefreshCb(cb: () => void): void {
  onSaved = cb
}

/** 離開頁面 / 切分頁時清理 */
export function teardownScan(): void {
  stopCamera()
  if (state.raf) cancelAnimationFrame(state.raf)
  state.raf = 0
}

function stopCamera(): void {
  if (state.stream) {
    state.stream.getTracks().forEach((t) => t.stop())
    state.stream = null
  }
}

/* ---------- 畫面 ---------- */
export function renderScan(root: HTMLElement): void {
  settings = loadSettings()
  root.innerHTML = `
  <section class="page scan-page">
    <div class="scan-stage card" id="scanStage">
      ${idleHTML()}
    </div>
    <div class="scan-tips">
      ${icon('sparkles', 14)} 小技巧：把名片放在深色桌面或白紙上，對比越清楚，自動裁切越精準。
    </div>
  </section>`
  wireIdle(root)
}

function idleHTML(): string {
  return `
  <div class="scan-idle">
    <div class="scan-hero">
      <div class="scan-hero-icon">${icon('camera', 30)}</div>
      <h2>掃描名片</h2>
      <p>即時偵測邊緣、自動裁切，AI 一次搞定姓名、電話、公司與分類</p>
    </div>
    <div class="scan-choices">
      <button class="choice" data-act="camera">
        <span class="choice-ic">${icon('camera', 22)}</span>
        <strong>開啟相機</strong>
        <small>即時偵測名片邊緣</small>
      </button>
      <button class="choice" data-act="upload">
        <span class="choice-ic">${icon('upload', 22)}</span>
        <strong>上傳圖片</strong>
        <small>從相簿挑一張名片照</small>
      </button>
      <button class="choice" data-act="sample">
        <span class="choice-ic">${icon('image', 22)}</span>
        <strong>載入範例</strong>
        <small>沒名片？試試示範卡</small>
      </button>
    </div>
    <input type="file" id="fileInput" accept="image/*" hidden>
  </div>`
}

function wireIdle(root: HTMLElement): void {
  root.querySelector<HTMLDivElement>('#scanStage')!.innerHTML = idleHTML()
  const stage = root.querySelector<HTMLElement>('#scanStage')!
  stage.querySelectorAll<HTMLElement>('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act
      if (act === 'camera') startCamera(stage)
      if (act === 'upload') root.querySelector<HTMLInputElement>('#fileInput')?.click()
      if (act === 'sample') void loadSample(stage)
    })
  })
  const fi = root.querySelector<HTMLInputElement>('#fileInput')
  if (fi) {
    fi.addEventListener('change', async () => {
      const f = fi.files?.[0]
      fi.value = ''
      if (f) await handleUpload(stage, f)
    })
  }
}

/* ---------- 相機 ---------- */
function friendlyCamError(e: unknown): string {
  const err = e as DOMException
  if (err?.name === 'NotAllowedError') return '相機權限被拒絕，請在瀏覽器允許相機權限，或改用「上傳圖片」'
  if (err?.name === 'NotFoundError') return '找不到相機裝置，請改用「上傳圖片」'
  if (err?.name === 'NotReadableError') return '相機被其他程式占用中，請關閉後重試'
  return `無法開啟相機（${err?.message || '未知錯誤'}），可改用「上傳圖片」`
}

async function startCamera(stage: HTMLElement): Promise<void> {
  if (!navigator.mediaDevices?.getUserMedia) {
    toast('此瀏覽器不支援相機，請改用上傳圖片', 'err')
    return
  }
  try {
    stopCamera()
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1440 } },
      audio: false,
    })
  } catch (e) {
    toast(friendlyCamError(e), 'err')
    return
  }
  state.mode = 'live'
  state.lastQuad = null
  state.stableTicks = 0
  stage.innerHTML = `
  <div class="cam-wrap">
    <video id="camVideo" playsinline muted autoplay></video>
    <canvas class="cam-overlay" id="camOverlay"></canvas>
    <div class="cam-status" id="camStatus">${icon('search', 14)} 偵測名片邊緣中…</div>
    <div class="cam-flash" id="camFlash"></div>
  </div>
  <div class="cam-controls">
    <label class="switch-row"><input type="checkbox" id="tgCrop" ${settings.autoCrop ? 'checked' : ''}><span class="switch"></span>自動裁切</label>
    <button class="shutter" id="btnShutter" title="拍攝"><span></span></button>
    <label class="switch-row"><input type="checkbox" id="tgAuto" ${settings.autoShutter ? 'checked' : ''}><span class="switch"></span>自動拍攝</label>
  </div>
  <div class="cam-sub">
    <button class="btn btn-ghost btn-sm" id="btnUpload2">${icon('upload', 15)} 上傳</button>
    <button class="btn btn-ghost btn-sm" id="btnStop">${icon('close', 15)} 關閉相機</button>
  </div>
  <input type="file" id="fileInput2" accept="image/*" hidden>`

  const video = stage.querySelector<HTMLVideoElement>('#camVideo')!
  video.srcObject = state.stream
  try {
    await video.play()
  } catch {
    /* 自動播放失敗由使用者互動觸發 */
  }

  const tgCrop = stage.querySelector<HTMLInputElement>('#tgCrop')!
  tgCrop.addEventListener('change', () => {
    settings.autoCrop = tgCrop.checked
    persistSettingsLite()
  })
  const tgAuto = stage.querySelector<HTMLInputElement>('#tgAuto')!
  tgAuto.addEventListener('change', () => {
    settings.autoShutter = tgAuto.checked
    persistSettingsLite()
  })
  stage.querySelector('#btnShutter')!.addEventListener('click', () => void shutter(stage))
  stage.querySelector('#btnStop')!.addEventListener('click', () => {
    stopCamera()
    state.mode = 'idle'
    wireIdle(document.querySelector('.scan-page') as HTMLElement)
  })
  const fi2 = stage.querySelector<HTMLInputElement>('#fileInput2')!
  stage.querySelector('#btnUpload2')!.addEventListener('click', () => fi2.click())
  fi2.addEventListener('change', async () => {
    const f = fi2.files?.[0]
    fi2.value = ''
    if (f) {
      stopCamera()
      await handleUpload(document.querySelector('.scan-page') as HTMLElement, f)
    }
  })

  startDetectLoop(stage, video)
}

function persistSettingsLite(): void {
  saveSettings(settings)
}

let lastDetectAt = 0
function startDetectLoop(stage: HTMLElement, video: HTMLVideoElement): void {
  const overlay = stage.querySelector<HTMLCanvasElement>('#camOverlay')!
  const status = stage.querySelector<HTMLElement>('#camStatus')!
  const flash = stage.querySelector<HTMLElement>('#camFlash')!

  const loop = () => {
    if (state.mode !== 'live' || !state.stream) return
    state.raf = requestAnimationFrame(loop)
    const now = performance.now()
    if (now - lastDetectAt < 340) return
    lastDetectAt = now
    if (!video.videoWidth) return

    // 偵測（detectOnSource 內部會縮圖）
    const det = detectOnSource(video, 380)

    // overlay 尺寸 = 顯示尺寸；影片以 contain 置中
    const box = overlay.parentElement!.getBoundingClientRect()
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    overlay.width = Math.round(box.width * dpr)
    overlay.height = Math.round(box.height * dpr)
    const dispScale = Math.min(box.width / video.videoWidth, box.height / video.videoHeight)
    const dx = (box.width - video.videoWidth * dispScale) / 2
    const dy = (box.height - video.videoHeight * dispScale) / 2

    if (det) {
      const dispQuad = det.quad.map((p) => ({
        x: (p.x * dispScale + dx) * dpr,
        y: (p.y * dispScale + dy) * dpr,
      })) as Quad
      const mv = quadMovement(det.quad, state.lastQuad)
      state.stableTicks = mv < 0.03 ? state.stableTicks + 1 : 0
      state.lastQuad = det.quad
      const stable = state.stableTicks >= 3
      drawQuadOverlay(overlay, dispQuad, { stable, label: stable ? '已鎖定 ✓' : undefined })
      status.innerHTML = stable
        ? `${icon('check', 14)} 已鎖定名片邊緣${settings.autoShutter ? '，自動拍攝中…' : '，按下快門'}`
        : `${icon('search', 14)} 偵測邊緣中…（信心 ${Math.round(det.conf * 100)}%）`
      status.classList.toggle('ok', stable)
      // 自動拍攝：穩定 1.2 秒後觸發
      if (stable) {
        if (!state.stableSince) state.stableSince = now
        if (settings.autoShutter && now - state.stableSince > 1200 && !state.busy) {
          state.stableSince = 0
          flash.classList.add('go')
          setTimeout(() => flash.classList.remove('go'), 220)
          void shutter(stage, true)
        }
      } else {
        state.stableSince = 0
      }
    } else {
      state.stableTicks = 0
      state.stableSince = 0
      state.lastQuad = null
      drawQuadOverlay(overlay, null)
      status.innerHTML = `${icon('search', 14)} 未偵測到名片，請加強名片與背景對比`
      status.classList.remove('ok')
    }
  }
  state.raf = requestAnimationFrame(loop)
}

async function shutter(stage: HTMLElement, fromAuto = false): Promise<void> {
  const video = stage.querySelector<HTMLVideoElement>('#camVideo')
  if (!video || !video.videoWidth) return
  state.busy = true
  try {
    if (!fromAuto) {
      const flash = stage.querySelector('#camFlash')
      flash?.classList.add('go')
      setTimeout(() => flash?.classList.remove('go'), 220)
    }
    if (navigator.vibrate) navigator.vibrate(28)
    const canvas = sourceToCanvas(video, 1920)
    const shot = canvasToDataUrl(canvas, 0.9)
    // lastQuad 是視訊原生座標，換算成快照 canvas 座標
    const qScale = canvas.width / video.videoWidth
    const quad =
      settings.autoCrop && state.lastQuad
        ? (state.lastQuad.map((p) => ({ x: p.x * qScale, y: p.y * qScale })) as Quad)
        : null
    stopCamera()
    await enterReview(shot, quad)
  } finally {
    state.busy = false
  }
}

/* ---------- 上傳 / 範例 ---------- */
async function handleUpload(root: HTMLElement, file: File): Promise<void> {
  if (!file.type.startsWith('image/')) {
    toast('請選擇圖片檔', 'err')
    return
  }
  const url = await fileToDataUrl(file)
  await enterReview(url)
}

const SAMPLES = ['samples/card-tech.svg', 'samples/card-finance.svg', 'samples/card-design.svg']

async function loadSample(stage: HTMLElement): Promise<void> {
  stage.innerHTML = `<div class="scan-loading">${icon('sparkles', 20)} 產生範例名片照…</div>`
  try {
    const dataUrl = await makeSamplePhoto()
    sampleIdx++
    await enterReview(dataUrl)
  } catch (e: any) {
    toast(`範例產生失敗：${e?.message || e}`, 'err')
    renderScan(document.querySelector('.view') as HTMLElement)
  }
}

/** 合成範例照片：桌面照 + 隨機旋轉的名片 SVG */
async function makeSamplePhoto(): Promise<string> {
  const cardPath = SAMPLES[sampleIdx % SAMPLES.length]
  const [deskB64, cardSvg] = await Promise.all([
    fetch('samples/desk.jpg')
      .then((r) => r.blob())
      .then((b) => fileToDataUrl(new File([b], 'desk.jpg', { type: 'image/jpeg' }))),
    fetch(cardPath).then((r) => r.text()),
  ])
  const desk = await loadImage(deskB64)
  const cardUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(cardSvg)}`
  const card = await loadImage(cardUrl)

  const W = 1280
  const H = 960
  const c = makeCanvas(W, H)
  const ctx = c.getContext('2d')!
  ctx.drawImage(desk, 0, 0, W, H)

  const angle = (Math.random() * 14 - 7) * (Math.PI / 180)
  const cw = W * (0.56 + Math.random() * 0.06)
  const ch = (cw / card.naturalWidth) * card.naturalHeight
  const cx = W / 2 + (Math.random() * 60 - 30)
  const cy = H / 2 + (Math.random() * 40 - 20)

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(angle)
  ctx.shadowColor = 'rgba(0,0,0,.35)'
  ctx.shadowBlur = 26
  ctx.shadowOffsetY = 10
  ctx.fillStyle = '#fff'
  ctx.fillRect(-cw / 2, -ch / 2, cw, ch)
  ctx.shadowColor = 'transparent'
  ctx.drawImage(card, -cw / 2, -ch / 2, cw, ch)
  ctx.restore()

  // 輕微雜訊，模擬實拍
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(${Math.random() > 0.5 ? 255 : 0},${Math.random() > 0.5 ? 255 : 0},${
      Math.random() > 0.5 ? 255 : 0
    },0.03)`
    ctx.fillRect(Math.random() * W, Math.random() * H, 2, 2)
  }
  return canvasToDataUrl(c, 0.92)
}

/* ---------- 檢視 / 辨識 ---------- */
async function enterReview(shotDataUrl: string, knownQuad?: Quad | null): Promise<void> {
  state.mode = 'review'
  state.original = ''
  state.cropped = ''
  state.extracted = null
  state.useOriginal = false

  const root = document.querySelector('.view') as HTMLElement
  root.innerHTML = `
  <section class="page scan-page">
    <div class="card review-card">
      <div class="review-head">
        <h2>${icon('crop', 18)} 自動裁切</h2>
        <div class="review-actions">
          <button class="btn btn-ghost btn-sm" id="rvRotate">${icon('rotate', 14)} 旋轉</button>
          <button class="btn btn-ghost btn-sm" id="rvCrop">${icon('crop', 14)} 手動裁切</button>
          <button class="btn btn-ghost btn-sm" id="rvUseOrig">用原圖</button>
          <button class="btn btn-ghost btn-sm" id="rvRetake">${icon('camera', 14)} 重拍</button>
        </div>
      </div>
      <div class="review-img-wrap" id="rvImgWrap">
        <div class="scan-loading">${icon('sparkles', 20)} 偵測名片邊緣、自動裁切中…</div>
      </div>
      <div class="crop-meta" id="rvMeta"></div>

      <div class="divider"></div>

      <div class="recog" id="recogBox">
        <button class="btn btn-primary btn-lg" id="btnRecog">${icon('sparkles', 18)} 開始 AI 辨識</button>
        <div class="engine-note" id="engineNote"></div>
        <div class="progress-wrap" id="progWrap" hidden>
          <div class="progress-bar"><i id="progBar"></i></div>
          <span class="progress-text" id="progText">處理中…</span>
        </div>
      </div>

      <form class="review-form" id="reviewForm" hidden>
        ${cardFormHTML({})}
        <div class="modal-actions">
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost" id="btnDiscard">捨棄</button>
          <button type="button" class="btn btn-primary" id="btnSave">${icon('check', 16)} 儲存至名片匣</button>
        </div>
      </form>
    </div>
  </section>`

  // 顯示裁切結果
  const imgWrap = root.querySelector<HTMLElement>('#rvImgWrap')!
  let autoRes = await autoCropDataUrl(shotDataUrl)
  if (knownQuad) {
    // 用即時偵測到的框重裁（座標基準相同：原圖未縮放前，這裡原圖=video 全解析度）
    const img = await loadImage(shotDataUrl)
    const canvas = sourceToCanvas(img, 1920)
    if (Math.abs(canvas.width - img.naturalWidth) < 2 && Math.abs(canvas.height - img.naturalHeight) < 2) {
      const cropped = cropByQuad(canvas, knownQuad)
      autoRes = {
        cropped: canvasToDataUrl(cropped, 0.88),
        original: canvasToDataUrl(canvas, 0.85),
        quad: knownQuad,
        conf: 0.9,
        rect: { w: canvas.width, h: canvas.height },
      }
    }
  }
  state.original = autoRes.original
  state.cropped = autoRes.cropped
  state.quad = autoRes.quad
  state.rect = autoRes.rect
  state.conf = autoRes.conf

  imgWrap.innerHTML = `<img id="rvImg" src="${state.cropped}" alt="裁切後的名片">`
  const meta = root.querySelector<HTMLElement>('#rvMeta')!
  meta.innerHTML = autoRes.quad
    ? `<span class="pill pill-ok">${icon('check', 13)} 已自動裁切 · 信心 ${Math.round(autoRes.conf * 100)}%</span><span class="pill">亦可旋轉或手動調整</span>`
    : `<span class="pill pill-warn">${icon('crop', 13)} 未偵測到明確邊緣，已使用原圖</span><span class="pill">可手動調整四個角</span>`

  root.querySelector<HTMLElement>('#engineNote')!.innerHTML =
    `辨識引擎：<b>${esc(engineLabel(settings))}</b>` +
    (settings.engine === 'builtin' ? '' : '（失敗時自動改用內建 OCR）')

  // 工具列
  root.querySelector('#rvRotate')!.addEventListener('click', async () => {
    const cur = state.useOriginal ? state.original : state.cropped
    const rotated = await rotateDataUrl(cur, 90)
    if (state.useOriginal) state.original = rotated
    else state.cropped = rotated
    ;(root.querySelector('#rvImg') as HTMLImageElement).src = rotated
  })
  root.querySelector('#rvCrop')!.addEventListener('click', () => openManualCrop())
  root.querySelector('#rvUseOrig')!.addEventListener('click', () => {
    state.useOriginal = !state.useOriginal
    const img = root.querySelector('#rvImg') as HTMLImageElement
    img.src = state.useOriginal ? state.original : state.cropped
    ;(root.querySelector('#rvUseOrig') as HTMLElement).textContent = state.useOriginal ? '用裁切圖' : '用原圖'
  })
  root.querySelector('#rvRetake')!.addEventListener('click', () => {
    state.mode = 'idle'
    renderScan(root)
    const stage = document.querySelector('#scanStage') as HTMLElement
    void startCamera(stage)
  })
  root.querySelector('#btnDiscard')!.addEventListener('click', () => {
    state.mode = 'idle'
    renderScan(root)
  })
  root.querySelector('#btnRecog')!.addEventListener('click', () => void recognize(root))
  root.querySelector('#btnSave')!.addEventListener('click', () => void saveReview(root))
}

/* ---------- 手動裁切編輯器 ---------- */
function openManualCrop(): void {
  const src = state.useOriginal ? state.original : state.original || state.cropped
  const baseQuad =
    state.quad ||
    ((): Quad => {
      const { w, h } = state.rect
      return [
        { x: w * 0.06, y: h * 0.06 },
        { x: w * 0.94, y: h * 0.06 },
        { x: w * 0.94, y: h * 0.94 },
        { x: w * 0.06, y: h * 0.94 },
      ]
    })()

  const m = openModal(`
    <div class="crop-editor">
      <h3>${icon('crop', 17)} 手動裁切 — 拖曳四個角對齊名片</h3>
      <div class="crop-canvas-wrap"><canvas id="cropCanvas"></canvas></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="cropDone">${icon('check', 15)} 確定裁切</button>
      </div>
    </div>`, 'modal-lg')

  const canvas = m.box.querySelector<HTMLCanvasElement>('#cropCanvas')!
  const wrap = m.box.querySelector('.crop-canvas-wrap') as HTMLElement
  let quad: Quad = baseQuad.map((p) => ({ ...p })) as Quad
  let dispQuad: Quad

  void (async () => {
    const img = await loadImage(state.original || state.cropped)
    const fit = () => {
      const maxW = Math.min(wrap.clientWidth || 640, 760)
      const scale = Math.min(maxW / img.naturalWidth, 520 / img.naturalHeight, 1)
      canvas.width = Math.round(img.naturalWidth * scale)
      canvas.height = Math.round(img.naturalHeight * scale)
      dispQuad = quad.map((p) => ({ x: p.x * scale, y: p.y * scale })) as Quad
      draw(scale)
    }
    const draw = (scale: number) => {
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      // 半透明遮罩
      ctx.save()
      ctx.fillStyle = 'rgba(15,18,40,.55)'
      ctx.beginPath()
      ctx.rect(0, 0, canvas.width, canvas.height)
      ctx.moveTo(dispQuad[0].x, dispQuad[0].y)
      dispQuad.forEach((p, i) => (i === 0 ? ctx.lineTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.fill('evenodd')
      ctx.restore()
      ctx.strokeStyle = '#22c55e'
      ctx.lineWidth = 2
      ctx.beginPath()
      dispQuad.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)))
      ctx.closePath()
      ctx.stroke()
      dispQuad.forEach((p) => {
        ctx.beginPath()
        ctx.arc(p.x, p.y, 9, 0, Math.PI * 2)
        ctx.fillStyle = '#22c55e'
        ctx.fill()
        ctx.lineWidth = 3
        ctx.strokeStyle = '#fff'
        ctx.stroke()
      })
      quad = dispQuad.map((p) => ({ x: p.x / scale, y: p.y / scale })) as Quad
    }
    fit()

    let dragIdx = -1
    const pos = (e: PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect()
      return { x: e.clientX - r.left, y: e.clientY - r.top }
    }
    const scaleNow = () => canvas.width / img.naturalWidth
    canvas.addEventListener('pointerdown', (e) => {
      const p = pos(e)
      let best = -1
      let bd = 30
      dispQuad.forEach((q, i) => {
        const d = Math.hypot(q.x - p.x, q.y - p.y)
        if (d < bd) {
          bd = d
          best = i
        }
      })
      dragIdx = best
      if (dragIdx >= 0) {
        canvas.setPointerCapture(e.pointerId)
        e.preventDefault()
      }
    })
    canvas.addEventListener('pointermove', (e) => {
      if (dragIdx < 0) return
      const p = pos(e)
      dispQuad[dragIdx] = { x: p.x, y: p.y }
      draw(scaleNow())
    })
    canvas.addEventListener('pointerup', () => (dragIdx = -1))

    m.box.querySelector('#cropDone')!.addEventListener('click', async () => {
      const src2 = sourceToCanvas(img, 1920)
      const s = src2.width / img.naturalWidth
      const q = quad.map((p) => ({ x: p.x * s, y: p.y * s })) as Quad
      const cropped = cropByQuad(src2, q)
      state.cropped = canvasToDataUrl(cropped, 0.88)
      state.quad = q
      state.useOriginal = false
      m.close()
      const imgEl = document.querySelector('#rvImg') as HTMLImageElement
      if (imgEl) imgEl.src = state.cropped
      const meta = document.querySelector('#rvMeta') as HTMLElement
      if (meta) meta.innerHTML = `<span class="pill pill-ok">${icon('check', 13)} 已手動裁切</span>`
    })
  })()
}

/* ---------- AI 辨識 ---------- */
function setProgress(root: HTMLElement, visible: boolean, text = '', ratio = -1): void {
  const wrap = root.querySelector<HTMLElement>('#progWrap')!
  const bar = root.querySelector<HTMLElement>('#progBar')!
  const label = root.querySelector<HTMLElement>('#progText')!
  wrap.hidden = !visible
  label.textContent = text
  if (ratio >= 0) bar.style.width = `${Math.round(ratio * 100)}%`
}

async function recognize(root: HTMLElement): Promise<void> {
  if (state.busy) return
  state.busy = true
  const img = state.useOriginal ? state.original : state.cropped
  const btn = root.querySelector<HTMLButtonElement>('#btnRecog')!
  btn.disabled = true
  setProgress(root, true, '準備辨識…', 0.05)

  const fillForm = (ex: Extracted) => {
    state.extracted = ex
    const form = root.querySelector<HTMLElement>('#reviewForm')!
    form.hidden = false
    form.innerHTML = `${cardFormHTML(ex)}
      <div class="modal-actions">
        <span class="spacer"></span>
        <button type="button" class="btn btn-ghost" id="btnDiscard">捨棄</button>
        <button type="button" class="btn btn-primary" id="btnSave">${icon('check', 16)} 儲存至名片匣</button>
      </div>`
    form.querySelector('#btnDiscard')!.addEventListener('click', () => {
      state.mode = 'idle'
      renderScan(root)
    })
    form.querySelector('#btnSave')!.addEventListener('click', () => void saveReview(root))
    form.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  try {
    let ex: Extracted | null = null
    if (settings.engine !== 'builtin') {
      try {
        setProgress(root, true, `傳送圖片給 ${engineLabel(settings)}…`, 0.2)
        ex = await llmRecognize(img, settings)
        setProgress(root, true, 'AI 辨識完成', 1)
      } catch (e: any) {
        toast(`視覺 AI 辨識失敗：${e?.message || e}，自動改用內建 OCR`, 'err')
      }
    }
    if (!ex) {
      setProgress(root, true, '內建 AI OCR 啟動…', 0.1)
      ex = await ocrRecognize(img, settings.ocrLang, (stage, p) => {
        setProgress(root, true, stage, p)
      })
      setProgress(root, true, '剖析欄位與自動歸類…', 1)
    }
    // 若 AI 沒給分類 → 用規則自動歸類
    if (!ex.category) ex.category = categorize(ex.company || '', ex.title || '', ex.rawText || '')
    fillForm(ex)
    toast('辨識完成！請確認欄位後儲存', 'ok')
  } catch (e: any) {
    toast(`辨識失敗：${e?.message || e}`, 'err')
  } finally {
    state.busy = false
    btn.disabled = false
    setProgress(root, false)
  }
}

async function saveReview(root: HTMLElement): Promise<void> {
  const form = root.querySelector<HTMLElement>('#reviewForm')!
  const data = readCardForm(form)
  if (!data) return
  const now = Date.now()
  const card: Card = {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    name: data.name || '',
    title: data.title || '',
    company: data.company || '',
    department: data.department || '',
    phones: data.phones || [],
    faxes: data.faxes || [],
    emails: data.emails || [],
    website: data.website || '',
    address: data.address || '',
    category: (data.category as Card['category']) || 'other',
    tags: data.tags || [],
    notes: data.notes || '',
    rawText: state.extracted?.rawText || '',
    source: settings.engine !== 'builtin' && state.extracted?.rawText?.includes('視覺 AI') ? 'llm' : 'ocr',
    imageCropped: state.cropped,
    imageOriginal: state.original,
    confidence: state.conf,
  }
  await saveCard(card)
  toast(`已儲存「${card.name || card.company}」至名片匣`, 'ok')
  state.mode = 'idle'
  state.extracted = null
  onSaved?.()
}
