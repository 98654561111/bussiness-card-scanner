/* ============================================================
 * 共用 UI 元件：圖示、Toast、Modal、確認框、名片表單
 * ============================================================ */

import { Card, CATEGORY_DEFS, CategoryId, CATEGORY_MAP } from './types'

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/* ---------- SVG 圖示（feather 風格） ---------- */
const ICON_PATHS: Record<string, string> = {
  camera:
    '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  cards:
    '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  rotate: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
  trash:
    '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
  share:
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  sparkles:
    '<path d="M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9L19 15z"/>',
  phone:
    '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  mail: '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  building: '<rect x="4" y="2" width="16" height="20" rx="2"/><line x1="9" y1="22" x2="9" y2="18"/><line x1="15" y1="22" x2="15" y2="18"/><line x1="8" y1="6" x2="8" y2="8"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="16" y1="6" x2="16" y2="8"/><line x1="8" y1="11" x2="8" y2="13"/><line x1="12" y1="11" x2="12" y2="13"/><line x1="16" y1="11" x2="16" y2="13"/>',
  user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  tag: '<path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.83z"/><line x1="7" y1="7" x2="7.01" y2="7"/>',
  chevron: '<polyline points="9 18 15 12 9 6"/>',
  text: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  chat: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
}

export function icon(name: string, size = 18): string {
  const p = ICON_PATHS[name] || ICON_PATHS.cards
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`
}

/* ---------- Toast ---------- */
export function toast(message: string, type: 'ok' | 'err' | 'info' = 'info'): void {
  const root = document.getElementById('toasts')!
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.innerHTML = `${icon(type === 'ok' ? 'check' : type === 'err' ? 'close' : 'sparkles', 16)}<span>${esc(message)}</span>`
  root.appendChild(el)
  setTimeout(() => el.classList.add('show'), 10)
  setTimeout(() => {
    el.classList.remove('show')
    setTimeout(() => el.remove(), 350)
  }, 2800)
}

/* ---------- Modal ---------- */
export interface ModalHandle {
  root: HTMLDivElement
  box: HTMLDivElement
  close: () => void
}

export function openModal(content: string, cls = ''): ModalHandle {
  const root = document.getElementById('modal-root')!
  const overlay = document.createElement('div')
  overlay.className = 'modal-overlay'
  overlay.innerHTML = `<div class="modal-box ${esc(cls)}" role="dialog" aria-modal="true">${content}</div>`
  root.appendChild(overlay)
  requestAnimationFrame(() => overlay.classList.add('show'))
  const close = () => {
    overlay.classList.remove('show')
    setTimeout(() => overlay.remove(), 220)
  }
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close()
  })
  overlay.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', close))
  return { root: overlay, box: overlay.querySelector('.modal-box') as HTMLDivElement, close }
}

/* ---------- 確認框 ---------- */
export function confirmDialog(title: string, message: string, opts: { danger?: boolean; okText?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="confirm">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost" data-no>取消</button>
          <button class="btn ${opts.danger ? 'btn-danger' : 'btn-primary'}" data-yes>${esc(opts.okText || '確定')}</button>
        </div>
      </div>`, 'modal-sm')
    m.box.querySelector('[data-no]')!.addEventListener('click', () => {
      m.close()
      resolve(false)
    })
    m.box.querySelector('[data-yes]')!.addEventListener('click', () => {
      m.close()
      resolve(true)
    })
  })
}

/* ---------- 分類 ---------- */
export function categoryBadge(cat: string): string {
  const def = CATEGORY_MAP[cat] || CATEGORY_MAP.other
  return `<span class="cat-badge" data-cat="${esc(def.id)}">${def.icon} ${esc(def.label)}</span>`
}

/* ---------- 名片編輯表單 ---------- */
export interface FormCardData {
  name?: string
  title?: string
  company?: string
  department?: string
  phones?: string[]
  faxes?: string[]
  emails?: string[]
  website?: string
  address?: string
  category?: string
  tags?: string[]
  notes?: string
}

const listToStr = (v?: string[]) => (v || []).join('、')

export function cardFormHTML(d: FormCardData): string {
  const catOptions = CATEGORY_DEFS.map(
    (c) => `<option value="${c.id}" ${c.id === (d.category || 'other') ? 'selected' : ''}>${c.icon} ${c.label}</option>`,
  ).join('')
  return `
  <div class="form-grid">
    <label class="field"><span>姓名 *</span><input name="name" type="text" value="${esc(d.name || '')}" placeholder="例：陳志明" autocomplete="off"></label>
    <label class="field"><span>職稱</span><input name="title" type="text" value="${esc(d.title || '')}" placeholder="例：軟體工程師"></label>
    <label class="field span2"><span>公司 / 組織</span><input name="company" type="text" value="${esc(d.company || '')}" placeholder="例：澄澈科技股份有限公司"></label>
    <label class="field"><span>部門</span><input name="department" type="text" value="${esc(d.department || '')}" placeholder="例：研發部"></label>
    <label class="field"><span>分類</span><select name="category">${catOptions}</select></label>
    <label class="field span2"><span>電話 <small>（多個以「、」分隔）</small></span><input name="phones" type="text" value="${esc(listToStr(d.phones))}" placeholder="例：02-8765-4321、0912-345-678"></label>
    <label class="field span2"><span>傳真</span><input name="faxes" type="text" value="${esc(listToStr(d.faxes))}"></label>
    <label class="field span2"><span>Email</span><input name="emails" type="text" value="${esc(listToStr(d.emails))}" placeholder="例：ming@example.com"></label>
    <label class="field span2"><span>網址</span><input name="website" type="text" value="${esc(d.website || '')}" placeholder="www.example.com"></label>
    <label class="field span2"><span>地址</span><input name="address" type="text" value="${esc(d.address || '')}"></label>
    <label class="field span2"><span>標籤 <small>（逗號分隔）</small></span><input name="tags" type="text" value="${esc((d.tags || []).join(', '))}" placeholder="例：供應商, 展場認識"></label>
    <label class="field span2"><span>備註</span><textarea name="notes" rows="2">${esc(d.notes || '')}</textarea></label>
  </div>`
}

const splitList = (s: string): string[] =>
  s
    .split(/[,，、;；\n]+/)
    .map((x) => x.trim())
    .filter(Boolean)

export function readCardForm(box: HTMLElement): Partial<Card> | null {
  const get = (name: string): HTMLInputElement => box.querySelector(`[name="${name}"]`) as HTMLInputElement
  const data: Partial<Card> = {
    name: get('name').value.trim(),
    title: get('title').value.trim(),
    company: get('company').value.trim(),
    department: get('department').value.trim(),
    phones: splitList(get('phones').value),
    faxes: splitList(get('faxes').value),
    emails: splitList(get('emails').value),
    website: get('website').value.trim(),
    address: get('address').value.trim(),
    category: get('category').value as CategoryId,
    tags: splitList(get('tags').value.replace(/,/g, ',')),
    notes: (box.querySelector('[name="notes"]') as HTMLTextAreaElement).value.trim(),
  }
  if (!data.name && !data.company) {
    toast('請至少填寫「姓名」或「公司」其中一項', 'err')
    get('name').focus()
    return null
  }
  return data
}

export function debounce<T extends (...args: any[]) => void>(fn: T, ms: number): (...args: Parameters<T>) => void {
  let t: ReturnType<typeof setTimeout>
  return (...args: Parameters<T>) => {
    clearTimeout(t)
    t = setTimeout(() => fn(...args), ms)
  }
}

export function fmtDate(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}
