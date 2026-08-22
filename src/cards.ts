/* ============================================================
 * 名片匣：搜尋、分類篩選、詳情、編輯、匯出（vCard / CSV / JSON）
 * ============================================================ */

import { Card, CATEGORY_DEFS, CATEGORY_MAP, CategoryId } from './types'
import { deleteCard, getAllCards, saveCard } from './store'
import {
  cardFormHTML,
  categoryBadge,
  confirmDialog,
  debounce,
  esc,
  fmtDate,
  icon,
  openModal,
  readCardForm,
  toast,
} from './components'

let cards: Card[] = []
let query = ''
let filterCat: CategoryId | 'all' = 'all'
let sortBy: 'new' | 'name' | 'company' = 'new'

export async function refreshCards(): Promise<number> {
  cards = await getAllCards()
  return cards.length
}

export async function renderCards(root: HTMLElement): Promise<void> {
  await refreshCards()
  root.innerHTML = `
  <section class="page cards-page">
    <div class="cards-toolbar card">
      <div class="search-box">
        ${icon('search', 16)}
        <input id="cardSearch" type="search" placeholder="搜尋姓名、公司、電話、Email、備註…" value="${esc(query)}">
      </div>
      <div class="toolbar-right">
        <select id="cardSort" class="sort-select">
          <option value="new">最新加入</option>
          <option value="name">姓名排序</option>
          <option value="company">公司排序</option>
        </select>
        <div class="export-menu">
          <button class="btn btn-ghost btn-sm" id="btnExport">${icon('download', 15)} 匯出 <span class="caret">▾</span></button>
          <div class="export-drop" hidden>
            <button data-exp="vcf">${icon('cards', 15)} 全部名片 vCard (.vcf)</button>
            <button data-exp="csv">${icon('text', 15)} CSV 試算表 (.csv)</button>
            <button data-exp="json">${icon('download', 15)} 備份 JSON (.json)</button>
          </div>
        </div>
      </div>
    </div>
    <div class="cat-chips" id="catChips"></div>
    <div class="cards-grid" id="cardsGrid"></div>
    <div class="empty" id="cardsEmpty" hidden></div>
  </section>`

  const searchEl = root.querySelector<HTMLInputElement>('#cardSearch')!
  searchEl.addEventListener('input', debounce(() => {
    query = searchEl.value.trim()
    renderGrid(root)
  }, 160))
  const sortEl = root.querySelector<HTMLSelectElement>('#cardSort')!
  sortEl.value = sortBy
  sortEl.addEventListener('change', () => {
    sortBy = sortEl.value as typeof sortBy
    renderGrid(root)
  })

  // 匯出選單
  const expBtn = root.querySelector<HTMLButtonElement>('#btnExport')!
  const expDrop = root.querySelector<HTMLElement>('.export-drop')!
  expBtn.addEventListener('click', (e) => {
    e.stopPropagation()
    expDrop.hidden = !expDrop.hidden
  })
  document.addEventListener('click', () => (expDrop.hidden = true), { once: true })
  expDrop.querySelectorAll<HTMLButtonElement>('[data-exp]').forEach((b) =>
    b.addEventListener('click', () => {
      expDrop.hidden = true
      const kind = b.dataset.exp as 'vcf' | 'csv' | 'json'
      if (kind === 'vcf') exportVcf(cards)
      if (kind === 'csv') exportCsv(cards)
      if (kind === 'json') exportJson(cards)
    }),
  )

  renderChips(root)
  renderGrid(root)
}

function renderChips(root: HTMLElement): void {
  const counts = new Map<string, number>()
  for (const c of cards) counts.set(c.category, (counts.get(c.category) || 0) + 1)
  const box = root.querySelector('#catChips')!
  const chip = (id: string, label: string, n: number, active: boolean) =>
    `<button class="chip ${active ? 'active' : ''}" data-cat="${id}">${esc(label)} <b>${n}</b></button>`
  let html = chip('all', '🗂 全部', cards.length, filterCat === 'all')
  for (const def of CATEGORY_DEFS) {
    const n = counts.get(def.id) || 0
    if (n) html += chip(def.id, `${def.icon} ${def.label}`, n, filterCat === def.id)
  }
  box.innerHTML = html
  box.querySelectorAll<HTMLButtonElement>('.chip').forEach((b) =>
    b.addEventListener('click', () => {
      filterCat = (b.dataset.cat === 'all' ? 'all' : b.dataset.cat) as CategoryId | 'all'
      renderChips(root)
      renderGrid(root)
    }),
  )
}

function matches(c: Card): boolean {
  if (filterCat !== 'all' && c.category !== filterCat) return false
  if (!query) return true
  const hay = [c.name, c.title, c.company, c.department, c.address, c.website, c.notes, ...c.phones, ...c.emails, ...c.tags]
    .join(' ')
    .toLowerCase()
  return query
    .toLowerCase()
    .split(/\s+/)
    .every((q) => hay.includes(q))
}

function renderGrid(root: HTMLElement): void {
  const grid = root.querySelector('#cardsGrid')!
  const empty = root.querySelector<HTMLElement>('#cardsEmpty')!
  const list = cards.filter(matches).sort((a, b) => {
    if (sortBy === 'name') return (a.name || 'zz').localeCompare(b.name || 'zz', 'zh-Hant')
    if (sortBy === 'company') return (a.company || 'zz').localeCompare(b.company || 'zz', 'zh-Hant')
    return b.createdAt - a.createdAt
  })
  grid.innerHTML = list.map((c) => tileHTML(c)).join('')
  grid.querySelectorAll<HTMLButtonElement>('.card-tile').forEach((el) =>
    el.addEventListener('click', () => {
      const card = cards.find((x) => x.id === el.dataset.id)
      if (card) openDetail(card, root)
    }),
  )
  if (!list.length) {
    empty.hidden = false
    empty.innerHTML = cards.length
      ? `<div class="empty-ic">${icon('search', 26)}</div><h3>沒有符合條件的名片</h3><p>換個關鍵字或分類試試</p>`
      : `<div class="empty-ic">${icon('cards', 26)}</div><h3>名片匣還是空的</h3><p>到「掃描」頁拍一張名片，自動擷取欄位並歸類</p>`
  } else {
    empty.hidden = true
  }
}

function tileHTML(c: Card): string {
  const def = CATEGORY_MAP[c.category] || CATEGORY_MAP.other
  return `
  <button class="card-tile" data-id="${esc(c.id)}">
    <span class="tile-img">
      ${c.imageCropped ? `<img src="${esc(c.imageCropped)}" alt="${esc(c.name || c.company)}" loading="lazy">` : `<span class="tile-img-fallback">${def.icon}</span>`}
    </span>
    <span class="tile-body">
      <strong class="tile-name">${esc(c.name || c.company || '未命名')}</strong>
      <span class="tile-sub">${esc(c.title || c.company || '')}</span>
      <span class="tile-foot">
        <span class="mini-badge" data-cat="${esc(def.id)}">${def.icon} ${esc(def.label)}</span>
        <time>${fmtDate(c.createdAt)}</time>
      </span>
    </span>
  </button>`
}

/* ---------- 詳情 ---------- */
function infoRow(ic: string, label: string, valueHtml: string, valClass = ''): string {
  if (!valueHtml) return ''
  return `<div class="info-row"><span class="info-ic">${icon(ic, 15)}</span><div class="info-main"><small>${esc(label)}</small><div class="${valClass}">${valueHtml}</div></div></div>`
}

function copyBtn(text: string): string {
  return `<button class="icon-btn copy-btn" data-copy="${esc(text)}" title="複製">${icon('copy', 13)}</button>`
}

export function openDetail(c: Card, listRoot?: HTMLElement): void {
  const telHref = (p: string) => `tel:${p.replace(/[^\d+]/g, '')}`
  const web = c.website ? (/^https?:/i.test(c.website) ? c.website : `https://${c.website}`) : ''
  const mapQ = encodeURIComponent(`${c.address || ''} ${c.company || ''}`.trim())
  const html = `
  <div class="detail">
    <div class="detail-head">
      <div class="detail-imgs">
        ${c.imageCropped ? `<img id="dtImg" src="${esc(c.imageCropped)}" alt="名片">` : ''}
        ${c.imageOriginal ? `<button class="img-toggle" id="dtImgToggle" title="切換原圖">${icon('image', 14)}</button>` : ''}
      </div>
      <div class="detail-info">
        <div class="detail-title">
          <div>
            <h2>${esc(c.name || '未命名')}</h2>
            ${c.title ? `<p class="detail-pos">${esc(c.title)}</p>` : ''}
            ${c.company ? `<p class="detail-org">${icon('building', 14)} ${esc(c.company)}${c.department ? ` · ${esc(c.department)}` : ''}</p>` : ''}
          </div>
          ${categoryBadge(c.category)}
        </div>
        <div class="detail-rows">
          ${infoRow('user', '姓名', esc(c.name))}
          ${c.phones.map((p) => infoRow('phone', '電話', `<a href="${telHref(p)}">${esc(p)}</a> ${copyBtn(p)}`, 'val-line')).join('')}
          ${c.faxes.map((f) => infoRow('phone', '傳真', `<span>${esc(f)}</span> ${copyBtn(f)}`, 'val-line')).join('')}
          ${c.emails.map((e) => infoRow('mail', 'Email', `<a href="mailto:${esc(e)}">${esc(e)}</a> ${copyBtn(e)}`, 'val-line')).join('')}
          ${infoRow('globe', '網址', web ? `<a href="${esc(web)}" target="_blank" rel="noopener">${esc(c.website)}</a> ${copyBtn(c.website)}` : '')}
          ${infoRow('pin', '地址', c.address ? `<a href="https://maps.google.com/?q=${mapQ}" target="_blank" rel="noopener">${esc(c.address)}</a> ${copyBtn(c.address)}` : '')}
          ${c.tags.length ? infoRow('tag', '標籤', c.tags.map((t) => `<span class="tag-pill">${esc(t)}</span>`).join(' ')) : ''}
          ${infoRow('text', '備註', esc(c.notes).replace(/\n/g, '<br>'))}
        </div>
        ${c.rawText ? `<details class="raw-text"><summary>${icon('text', 13)} 原始辨識文字</summary><pre>${esc(c.rawText)}</pre></details>` : ''}
      </div>
    </div>
    <div class="modal-actions detail-actions">
      <button class="btn btn-ghost btn-sm" id="dtEdit">${icon('edit', 14)} 編輯</button>
      <button class="btn btn-ghost btn-sm" id="dtVcf">${icon('download', 14)} vCard</button>
      ${'share' in navigator ? `<button class="btn btn-ghost btn-sm" id="dtShare">${icon('share', 14)} 分享</button>` : ''}
      <span class="spacer"></span>
      <button class="btn btn-danger btn-sm" id="dtDel">${icon('trash', 14)} 刪除</button>
    </div>
  </div>`

  const m = openModal(html, 'modal-lg')
  const box = m.box

  box.querySelectorAll('.copy-btn').forEach((b) =>
    b.addEventListener('click', async () => {
      const t = (b as HTMLElement).dataset.copy || ''
      try {
        await navigator.clipboard.writeText(t)
        toast('已複製到剪貼簿', 'ok')
      } catch {
        toast('複製失敗，請手動選取', 'err')
      }
    }),
  )

  const imgToggle = box.querySelector('#dtImgToggle')
  if (imgToggle) {
    const img = box.querySelector('#dtImg') as HTMLImageElement
    imgToggle.addEventListener('click', () => {
      const showingOrig = img.src === c.imageOriginal
      img.src = showingOrig ? c.imageCropped : c.imageOriginal!
      imgToggle.classList.toggle('active', !showingOrig)
    })
  }

  box.querySelector('#dtEdit')!.addEventListener('click', () => openEdit(c, m, listRoot))
  box.querySelector('#dtVcf')!.addEventListener('click', () => exportVcf([c]))
  const shareBtn = box.querySelector('#dtShare')
  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const lines = [c.name, c.title, c.company, ...c.phones, ...c.emails].filter(Boolean).join('\n')
      try {
        if (c.imageCropped && navigator.canShare?.({ files: [await dataUrlToFile(c.imageCropped, 'card.jpg')] })) {
          const file = await dataUrlToFile(c.imageCropped, `名片-${c.name || c.company}.jpg`)
          await navigator.share({ text: lines, files: [file] })
        } else {
          await navigator.share({ title: c.name || c.company, text: lines })
        }
      } catch {
        /* 使用者取消 */
      }
    })
  }
  box.querySelector('#dtDel')!.addEventListener('click', async () => {
    const ok = await confirmDialog('刪除名片？', `確定要刪除「${c.name || c.company}」？此動作無法復原。`, { danger: true, okText: '刪除' })
    if (!ok) return
    await deleteCard(c.id)
    m.close()
    toast('已刪除', 'ok')
    if (listRoot) await renderCards(listRoot)
  })
}

function openEdit(c: Card, parent: { close: () => void }, listRoot?: HTMLElement): void {
  const m = openModal(`
    <div class="edit-modal">
      <h3>${icon('edit', 17)} 編輯名片</h3>
      ${c.imageCropped ? `<img class="edit-thumb" src="${esc(c.imageCropped)}" alt="">` : ''}
      ${cardFormHTML(c)}
      <div class="modal-actions">
        <button class="btn btn-ghost" data-close>取消</button>
        <button class="btn btn-primary" id="edSave">${icon('check', 15)} 儲存</button>
      </div>
    </div>`, 'modal-lg')
  m.box.querySelector('#edSave')!.addEventListener('click', async () => {
    const data = readCardForm(m.box)
    if (!data) return
    const updated: Card = { ...c, ...data, updatedAt: Date.now() } as Card
    await saveCard(updated)
    toast('已更新', 'ok')
    m.close()
    parent.close()
    if (listRoot) await renderCards(listRoot)
  })
}

/* ---------- 匯出 ---------- */
async function dataUrlToFile(dataUrl: string, name: string): Promise<File> {
  const r = await fetch(dataUrl)
  const blob = await r.blob()
  return new File([blob], name, { type: blob.type })
}

function download(content: string | Blob, filename: string, mime = 'text/plain'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: `${mime};charset=utf-8` }) : content
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

const stamp = (): string => new Date().toISOString().slice(0, 10)

export function exportVcf(list: Card[]): void {
  if (!list.length) return toast('沒有名片可匯出', 'err')
  const vesc = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,')
  const vcard = (c: Card) =>
    [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${vesc(c.name)};;;;`,
      `FN:${vesc(c.name || c.company)}`,
      c.company ? `ORG:${vesc(c.company)};${vesc(c.department)}` : '',
      c.title ? `TITLE:${vesc(c.title)}` : '',
      ...c.phones.map((p, i) => `TEL;TYPE=${/09\d{8}|9\d{8}/.test(p.replace(/\D/g, '')) ? 'CELL' : 'WORK,VOICE'}:${vesc(p)}`),
      ...c.faxes.map((f) => `TEL;TYPE=FAX:${vesc(f)}`),
      ...c.emails.map((e) => `EMAIL;TYPE=WORK:${vesc(e)}`),
      c.website ? `URL:${vesc(c.website)}` : '',
      c.address ? `ADR;TYPE=WORK:;;${vesc(c.address)};;;;` : '',
      `NOTE:${vesc([`分類:${CATEGORY_MAP[c.category]?.label || '其他'}`, ...c.tags, c.notes].filter(Boolean).join(' | '))}`,
      'END:VCARD',
    ]
      .filter(Boolean)
      .join('\r\n')
  download(list.map(vcard).join('\r\n'), `名片匣-${stamp()}.vcf`, 'text/vcard')
  toast(`已匯出 ${list.length} 張名片（vCard）`, 'ok')
}

export function exportCsv(list: Card[]): void {
  if (!list.length) return toast('沒有名片可匯出', 'err')
  const header = ['姓名', '職稱', '公司', '部門', '電話', '傳真', 'Email', '網址', '地址', '分類', '標籤', '備註', '加入日期']
  const row = (c: Card) =>
    [
      c.name,
      c.title,
      c.company,
      c.department,
      c.phones.join('、'),
      c.faxes.join('、'),
      c.emails.join('、'),
      c.website,
      c.address,
      CATEGORY_MAP[c.category]?.label || '其他',
      c.tags.join('、'),
      c.notes,
      fmtDate(c.createdAt),
    ].map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  download('\uFEFF' + [header.join(','), ...list.map(row)].join('\r\n'), `名片匣-${stamp()}.csv`, 'text/csv')
  toast(`已匯出 ${list.length} 張名片（CSV）`, 'ok')
}

export function exportJson(list: Card[]): void {
  if (!list.length) return toast('沒有名片可匯出', 'err')
  download(JSON.stringify({ app: 'ai-card-manager', version: 1, exportedAt: Date.now(), cards: list }, null, 2), `名片匣備份-${stamp()}.json`, 'application/json')
  toast('已匯出備份 JSON', 'ok')
}
