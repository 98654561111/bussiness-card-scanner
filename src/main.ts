/* ============================================================
 * AI 名片管家 — 主程式（分頁路由）
 * ============================================================ */

import './styles.css'
import { renderScan, setScanRefreshCb, teardownScan } from './scan'
import { refreshCards, renderCards } from './cards'
import { renderDashboard } from './dashboard'
import { renderSettings } from './settings'
import { icon } from './components'

type TabId = 'scan' | 'cards' | 'insights' | 'settings'

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: 'scan', label: '掃描', icon: 'camera' },
  { id: 'cards', label: '名片匣', icon: 'cards' },
  { id: 'insights', label: '洞察', icon: 'chart' },
  { id: 'settings', label: '設定', icon: 'gear' },
]

let current: TabId = 'scan'

function navHTML(cls: string): string {
  return TABS.map(
    (t) => `<button class="nav-btn" data-tab="${t.id}">${icon(t.icon, 20)}<span>${t.label}</span>${t.id === 'cards' ? '<i class="nav-count" id="navCount" hidden></i>' : ''}</button>`,
  ).join('')
}

async function updateCount(): Promise<void> {
  const n = await refreshCards()
  document.querySelectorAll('#navCount').forEach((el) => {
    const badge = el as HTMLElement
    badge.hidden = n === 0
    badge.textContent = String(n > 99 ? '99+' : n)
  })
}

async function switchTab(tab: TabId): Promise<void> {
  if (current === tab) return
  teardownScan()
  current = tab
  if (location.hash !== `#/${tab}`) history.replaceState(null, '', `#/${tab}`)
  renderNav()
  const view = document.getElementById('view')!
  if (tab === 'scan') renderScan(view)
  if (tab === 'cards') await renderCards(view)
  if (tab === 'insights') await renderDashboard(view)
  if (tab === 'settings') await renderSettings(view)
  window.scrollTo({ top: 0 })
}

function renderNav(): void {
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.tab === current)
  })
}

function boot(): void {
  const top = document.getElementById('topnav')!
  top.innerHTML = navHTML('top')
  const bottom = document.getElementById('tabbar')!
  bottom.innerHTML = navHTML('bottom')
  document.querySelectorAll('.nav-btn').forEach((b) =>
    b.addEventListener('click', () => void switchTab((b as HTMLElement).dataset.tab as TabId)),
  )

  setScanRefreshCb(async () => {
    await updateCount()
    await switchTab('cards')
  })

  const hash = location.hash.replace('#/', '') as TabId
  current = TABS.some((t) => t.id === hash) ? hash : 'scan'
  renderNav()
  const view = document.getElementById('view')!
  if (current === 'scan') renderScan(view)
  else if (current === 'cards') void renderCards(view)
  else if (current === 'insights') void renderDashboard(view)
  else void renderSettings(view)
  void updateCount()

  window.addEventListener('hashchange', () => {
    const h = location.hash.replace('#/', '') as TabId
    if (TABS.some((t) => t.id === h) && h !== current) void switchTab(h)
  })
  // 名片資料變動時更新徽章（批次掃描、助理等）
  window.addEventListener('bcs:cards-updated', () => void updateCount())
  // 離開頁面時關相機
  window.addEventListener('pagehide', teardownScan)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && current !== 'scan') teardownScan()
  })
}

boot()
