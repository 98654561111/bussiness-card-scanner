/* ============================================================
 * 洞察頁：人脈分析儀表板 + AI 助理（兩個子分頁）
 * 圖表為純 SVG/CSS 手工繪製，離線可用
 * ============================================================ */

import { Card, CATEGORY_MAP, CATEGORY_DEFS } from './types'
import { getAllCards } from './store'
import { esc, icon } from './components'
import { renderChatBox } from './chat'

const DONUT_COLORS = [
  '#4f46e5', '#7c3aed', '#a855f7', '#ec4899', '#f43f5e', '#f97316',
  '#f59e0b', '#eab308', '#84cc16', '#22c55e', '#14b8a6', '#06b6d4', '#94a3b8',
]

let subTab: 'charts' | 'chat' = 'charts'

export async function renderDashboard(root: HTMLElement): Promise<void> {
  const cards = await getAllCards()
  root.innerHTML = `
  <section class="page dash-page">
    <div class="seg" role="tablist">
      <button class="seg-btn" data-sub="charts">${icon('chart', 15)} 人脈圖表</button>
      <button class="seg-btn" data-sub="chat">${icon('chat', 15)} AI 助理</button>
    </div>
    <div id="dashBody"></div>
  </section>`
  const body = root.querySelector('#dashBody') as HTMLElement
  root.querySelectorAll<HTMLElement>('.seg-btn').forEach((b) =>
    b.addEventListener('click', () => {
      subTab = b.dataset.sub as 'charts' | 'chat'
      renderSub(root, body, cards)
    }),
  )
  renderSub(root, body, cards)
}

function renderSub(root: HTMLElement, body: HTMLElement, cards: Card[]): void {
  root.querySelectorAll<HTMLElement>('.seg-btn').forEach((b) => b.classList.toggle('active', b.dataset.sub === subTab))
  if (subTab === 'chat') {
    renderChatBox(body, cards)
  } else {
    renderCharts(body, cards)
  }
}

/* ---------------- 圖表 ---------------- */

function monthKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`
}

function renderCharts(body: HTMLElement, cards: Card[]): void {
  if (!cards.length) {
    body.innerHTML = `
    <div class="card empty">
      <div class="empty-ic">${icon('chart', 26)}</div>
      <h3>還沒有資料可以分析</h3>
      <p>先掃描幾張名片，這裡就會出現產業分布、新增趨勢與公司統計</p>
      <button class="btn btn-primary" onclick="location.hash='#/scan'">${icon('camera', 15)} 去掃描</button>
    </div>`
    return
  }

  /* 統計卡片 */
  const companies = new Set(cards.map((c) => (c.company || '').trim().toLowerCase()).filter(Boolean))
  const catsUsed = new Set(cards.map((c) => c.category))
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const thisMonth = cards.filter((c) => c.createdAt >= monthStart).length
  const withPhone = cards.filter((c) => c.phones.length).length
  const withEmail = cards.filter((c) => c.emails.length).length

  /* 分類分布 */
  const catCount = new Map<string, number>()
  for (const c of cards) catCount.set(c.category, (catCount.get(c.category) || 0) + 1)
  const catSorted = [...catCount.entries()].sort((a, b) => b[1] - a[1])

  /* 近 12 個月趨勢 */
  const months: { key: string; label: string; n: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({ key: monthKey(d.getTime()), label: `${d.getMonth() + 1}月`, n: 0 })
  }
  for (const c of cards) {
    const k = monthKey(c.createdAt)
    const m = months.find((x) => x.key === k)
    if (m) m.n++
  }
  const maxMonth = Math.max(1, ...months.map((m) => m.n))

  /* 公司排行 */
  const compCount = new Map<string, { n: number; label: string }>()
  for (const c of cards) {
    const key = (c.company || '').trim().toLowerCase()
    if (!key) continue
    const e = compCount.get(key)
    if (e) e.n++
    else compCount.set(key, { n: 1, label: c.company.trim() })
  }
  const topCompanies = [...compCount.values()].sort((a, b) => b.n - a.n).slice(0, 6)
  const maxComp = Math.max(1, ...topCompanies.map((c) => c.n))

  /* Donut（SVG 圓弧） */
  const total = cards.length
  const R = 15.9155 // 周長 = 100 的半徑（配合 stroke-dasharray 百分比技巧）
  let acc = 0
  const arcs = catSorted
    .map(([cat, n], i) => {
      const frac = n / total
      const dash = frac * 100
      const seg = `<circle cx="21" cy="21" r="${R}" fill="none" stroke="${DONUT_COLORS[i % DONUT_COLORS.length]}" stroke-width="5.5" stroke-dasharray="${dash.toFixed(2)} ${(100 - dash).toFixed(2)}" stroke-dashoffset="${(-acc).toFixed(2)}" pathLength="100"></circle>`
      acc += dash
      return seg
    })
    .join('')

  body.innerHTML = `
  <div class="dash-stats">
    <div class="stat-card card"><small>名片總數</small><b>${total}</b><span>${icon('cards', 13)} 張</span></div>
    <div class="stat-card card"><small>公司</small><b>${companies.size}</b><span>${icon('building', 13)} 家</span></div>
    <div class="stat-card card"><small>分類</small><b>${catsUsed.size}</b><span>${icon('tag', 13)} 類</span></div>
    <div class="stat-card card"><small>本月新增</small><b>${thisMonth}</b><span>${icon('plus', 13)} 張</span></div>
  </div>

  <div class="card dash-card">
    <h3>${icon('tag', 16)} 產業分布</h3>
    <div class="donut-wrap">
      <svg class="donut" viewBox="0 0 42 42" role="img">
        <circle cx="21" cy="21" r="${R}" fill="none" stroke="#eef0fa" stroke-width="5.5" pathLength="100"></circle>
        ${arcs}
      </svg>
      <div class="legend">
        ${catSorted
          .map(
            ([cat, n], i) => `
        <div class="legend-row">
          <i style="background:${DONUT_COLORS[i % DONUT_COLORS.length]}"></i>
          <span class="lg-label">${esc((CATEGORY_MAP[cat] || CATEGORY_MAP.other).icon)} ${esc((CATEGORY_MAP[cat] || CATEGORY_MAP.other).label)}</span>
          <b>${n}</b>
          <small>${Math.round((n / total) * 100)}%</small>
        </div>`,
          )
          .join('')}
      </div>
    </div>
  </div>

  <div class="card dash-card">
    <h3>${icon('chart', 16)} 新增趨勢（近 12 個月）</h3>
    <div class="bars">
      ${months
        .map(
          (m) => `
      <div class="bar-col" title="${esc(m.key)}：${m.n} 張">
        <span class="bar-val">${m.n || ''}</span>
        <i style="height:${Math.max(3, Math.round((m.n / maxMonth) * 100))}%"></i>
        <small>${m.label}</small>
      </div>`,
        )
        .join('')}
    </div>
  </div>

  <div class="card dash-card">
    <h3>${icon('building', 16)} 公司排行</h3>
    <div class="comp-rows">
      ${topCompanies
        .map(
          (c) => `
      <div class="comp-row" title="${esc(c.label)}：${c.n} 張">
        <span class="comp-name">${esc(c.label)}</span>
        <div class="comp-bar"><i style="width:${Math.round((c.n / maxComp) * 100)}%"></i></div>
        <b>${c.n}</b>
      </div>`,
        )
        .join('') || '<p class="muted">尚無公司資料</p>'}
    </div>
  </div>

  <div class="card dash-card">
    <h3>${icon('check', 16)} 資料完整度</h3>
    <div class="comp-rows">
      <div class="comp-row"><span class="comp-name">有電話</span><div class="comp-bar"><i style="width:${Math.round((withPhone / total) * 100)}%"></i></div><b>${Math.round((withPhone / total) * 100)}%</b></div>
      <div class="comp-row"><span class="comp-name">有 Email</span><div class="comp-bar"><i style="width:${Math.round((withEmail / total) * 100)}%"></i></div><b>${Math.round((withEmail / total) * 100)}%</b></div>
    </div>
  </div>`
}
