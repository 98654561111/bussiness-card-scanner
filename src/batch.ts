/* ============================================================
 * 批次掃描：一次挑多張名片圖 → 排隊自動裁切 + AI 辨識 + 自動儲存
 * ============================================================ */

import { loadSettings } from './store'
import { saveCard } from './store'
import { buildCard, recognizeCardImage } from './recognize'
import { autoCropDataUrl, fileToDataUrl } from './vision/canvas'
import { ocrDispose } from './ocr'
import { esc, icon, openModal, toast } from './components'

interface BatchItem {
  file: File
  status: 'pending' | 'working' | 'done' | 'failed' | 'cancelled'
  note: string
  thumb?: string
  cardName?: string
}

let aborted = false

export function startBatchPick(): void {
  const inp = document.createElement('input')
  inp.type = 'file'
  inp.accept = 'image/*'
  inp.multiple = true
  inp.addEventListener('change', () => {
    const files = Array.from(inp.files || []).filter((f) => f.type.startsWith('image/'))
    if (files.length) openBatchModal(files)
  })
  inp.click()
}

function itemRowHTML(it: BatchItem, idx: number): string {
  const iconOf = (): string => {
    switch (it.status) {
      case 'done':
        return '<span class="bi-ic ok">✓</span>'
      case 'failed':
        return '<span class="bi-ic err">✕</span>'
      case 'cancelled':
        return '<span class="bi-ic mute">–</span>'
      case 'working':
        return '<span class="bi-ic spin">◠</span>'
      default:
        return '<span class="bi-ic mute">•</span>'
    }
  }
  return `
  <div class="batch-item" data-idx="${idx}">
    <span class="bi-thumb">${it.thumb ? `<img src="${esc(it.thumb)}" alt="">` : icon('image', 18)}</span>
    <div class="bi-main">
      <strong class="bi-name">${esc(it.cardName || it.file.name)}</strong>
      <small class="bi-note">${esc(it.note)}</small>
    </div>
    ${iconOf()}
    ${it.status === 'failed' ? `<button class="icon-btn bi-retry" title="重試">${icon('rotate', 13)}</button>` : ''}
  </div>`
}

export function openBatchModal(files: File[]): void {
  aborted = false
  const settings = loadSettings()
  const items: BatchItem[] = files.map((f) => ({ file: f, status: 'pending', note: '排隊中' }))

  const m = openModal(`
    <div class="batch-modal">
      <h3>${icon('cards', 17)} 批次掃描（${items.length} 張）</h3>
      <div class="batch-engine">引擎：${settings.engine === 'builtin' ? '內建 AI OCR（離線）' : esc(settings.engine === 'gemini' ? `視覺 AI（${settings.gemini.model}）` : `視覺 AI（${settings.openai.model}）`)}</div>
      <div class="progress-wrap"><div class="progress-bar"><i id="batchBar"></i></div><span class="progress-text" id="batchProg">準備中…</span></div>
      <div class="batch-list" id="batchList"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost" id="batchStop">${icon('close', 14)} 停止</button>
        <span class="spacer"></span>
        <button class="btn btn-primary" id="batchDone" hidden>完成，查看名片匣</button>
      </div>
    </div>`, 'modal-lg')

  const list = m.box.querySelector('#batchList') as HTMLElement
  const bar = m.box.querySelector('#batchBar') as HTMLElement
  const prog = m.box.querySelector('#batchProg') as HTMLElement
  const stopBtn = m.box.querySelector('#batchStop') as HTMLButtonElement
  const doneBtn = m.box.querySelector('#batchDone') as HTMLButtonElement

  const renderList = () => {
    list.innerHTML = items.map((it, i) => itemRowHTML(it, i)).join('')
    list.querySelectorAll<HTMLElement>('.bi-retry').forEach((b) =>
      b.addEventListener('click', () => {
        const it = items[Number((b.closest('.batch-item') as HTMLElement).dataset.idx)]
        it.status = 'pending'
        it.note = '排隊中'
        renderList()
        void processQueue(true)
      }),
    )
  }
  renderList()

  let running = false
  const updateProgress = () => {
    const finished = items.filter((i) => i.status === 'done' || i.status === 'failed' || i.status === 'cancelled').length
    bar.style.width = `${Math.round((finished / items.length) * 100)}%`
    const ok = items.filter((i) => i.status === 'done').length
    const bad = items.filter((i) => i.status === 'failed').length
    prog.textContent = finished >= items.length ? `完成：成功 ${ok} 張${bad ? `、失敗 ${bad} 張` : ''}` : `處理中 ${finished}/${items.length}（成功 ${ok}）`
  }

  const processOne = async (it: BatchItem) => {
    it.status = 'working'
    it.note = '自動裁切中…'
    renderList()
    const dataUrl = await fileToDataUrl(it.file)
    const r = await autoCropDataUrl(dataUrl, 1800)
    it.thumb = r.cropped
    it.note = 'AI 辨識中…'
    renderList()
    const { ex, usedLLM } = await recognizeCardImage(r.cropped, settings, (stage) => {
      it.note = stage
      const el = list.querySelector(`[data-idx="${items.indexOf(it)}"] .bi-note`)
      if (el) el.textContent = stage
    })
    const card = buildCard(ex, { cropped: r.cropped, original: r.original, conf: r.conf }, usedLLM)
    await saveCard(card)
    it.cardName = card.name || card.company || it.file.name
    it.status = 'done'
    it.note = `已歸類「${card.category}」${ex.name ? '' : '（未辨識出姓名）'}`
  }

  const processQueue = async (retryOnly = false) => {
    if (running) return
    running = true
    stopBtn.disabled = false
    doneBtn.hidden = true
    try {
      for (const it of items) {
        if (aborted && it.status === 'pending') it.status = 'cancelled'
        if (retryOnly && it.status !== 'pending') continue
        if (it.status !== 'pending') continue
        if (aborted) {
          it.status = 'cancelled'
          it.note = '已取消'
          continue
        }
        try {
          await processOne(it)
        } catch (e: any) {
          it.status = 'failed'
          it.note = `失敗：${(e?.message || String(e)).slice(0, 60)}`
        }
        renderList()
        updateProgress()
      }
    } finally {
      running = false
      updateProgress()
      ocrDispose()
      const ok = items.filter((i) => i.status === 'done').length
      if (ok > 0) {
        window.dispatchEvent(new CustomEvent('bcs:cards-updated'))
        stopBtn.hidden = true
        doneBtn.hidden = false
      } else {
        stopBtn.hidden = true
        doneBtn.hidden = false
        doneBtn.textContent = '關閉'
      }
    }
  }

  stopBtn.addEventListener('click', () => {
    aborted = true
    stopBtn.disabled = true
    stopBtn.innerHTML = `${icon('close', 14)} 停止中…`
    prog.textContent = '正在停止…'
  })
  doneBtn.addEventListener('click', () => {
    m.close()
    if (location.hash !== '#/cards') location.hash = '#/cards'
  })
  m.root.addEventListener('pointerdown', (e) => {
    // 處理中關閉視窗 = 停止佇列（剩餘取消）
    if (e.target === m.root && running) {
      aborted = true
    }
  })

  void processQueue()
  updateProgress()
  toast(`批次掃描開始：${items.length} 張名片排隊處理中`, 'info')
}
