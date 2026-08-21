/* ============================================================
 * 單元測試（Node，tsx 執行）：npm test
 * 1. 視覺核心：合成名片圖 → 邊緣偵測 → 四邊形還原 → 透視校正
 * 2. 欄位剖析：模擬 OCR 文字 → 姓名/電話/Email/公司/地址
 * 3. 自動歸類
 * ============================================================ */

import {
  Quad,
  applyH,
  detectCardQuad,
  quadArea,
  solveH,
  warpPerspective,
  Pt,
} from '../src/vision/core'
import { extractFields, categorize } from '../src/extract'

let pass = 0
let fail = 0
function ok(cond: boolean, name: string, detail = ''): void {
  if (cond) {
    pass++
    console.log(`  ✅ ${name}`)
  } else {
    fail++
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

/* ---------- 合成測試圖 ---------- */
function pointInConvexQuad(x: number, y: number, q: Quad): boolean {
  let sign = 0
  for (let i = 0; i < 4; i++) {
    const a = q[i]
    const b = q[(i + 1) % 4]
    const cross = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x)
    const s = Math.sign(cross)
    if (s === 0) continue
    if (sign === 0) sign = s
    else if (s !== sign) return false
  }
  return true
}

function synthCardImage(
  w: number,
  h: number,
  quad: Quad,
  opts: { noise?: number; cardVal?: number; bgVal?: number } = {},
): Uint8ClampedArray {
  const { noise = 8, cardVal = 245, bgVal = 95 } = opts
  const data = new Uint8ClampedArray(w * h * 4)
  const rnd = (() => {
    let seed = 42
    return () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
  })()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const inside = pointInConvexQuad(x, y, quad)
      let v = inside ? cardVal : bgVal
      // 卡片中央畫個深色方塊（模擬文字/logo，製造內部邊緣）
      if (inside) {
        const u = (x - quad[0].x) / (quad[1].x - quad[0].x)
        const vv = (y - quad[0].y) / (quad[3].y - quad[0].y)
        if (u > 0.3 && u < 0.7 && vv > 0.3 && vv < 0.7) v = 30
      }
      v += (rnd() - 0.5) * 2 * noise
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return data
}

console.log('\n== 視覺核心：名片邊緣偵測 ==')

/** 以旋轉矩形產生真值四邊形（標準名片比例） */
function rotRect(cx: number, cy: number, cw: number, ch: number, rotDeg: number): Quad {
  const r = (rotDeg * Math.PI) / 180
  const cs = Math.cos(r)
  const sn = Math.sin(r)
  const p = (dx: number, dy: number): Pt => ({ x: cx + dx * cs - dy * sn, y: cy + dx * sn + dy * cs })
  return [p(-cw / 2, -ch / 2), p(cw / 2, -ch / 2), p(cw / 2, ch / 2), p(-cw / 2, ch / 2)]
}

{
  // 微旋轉名片（比例 1.75）
  const W = 420
  const H = 320
  const truth = rotRect(210, 160, 280, 160, -4)
  const data = synthCardImage(W, H, truth)
  const res = detectCardQuad(W, H, data)
  ok(!!res, '偵測到四邊形（旋轉 -4°）')
  if (res) {
    const errs = res.quad.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y))
    const maxErr = Math.max(...errs)
    ok(maxErr < 8, `角點誤差 < 8px（實際 ${maxErr.toFixed(1)}px）`)
    ok(res.conf > 0.4, `信心度合理（${res.conf.toFixed(2)}）`)
    ok(
      res.quad[0].x + res.quad[0].y <= Math.min(...res.quad.map((p) => p.x + p.y)) + 1e-6,
      '角點順序為 TL 起始順時針',
    )
  }
}

{
  // 正向名片（比例 1.586）
  const W = 400
  const H = 300
  const truth = rotRect(200, 150, 300, 189, 0)
  const res = detectCardQuad(W, H, synthCardImage(W, H, truth))
  ok(!!res, '正向名片偵測成功')
  if (res) {
    const maxErr = Math.max(...res.quad.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)))
    ok(maxErr < 6, `正向角點誤差 < 6px（實際 ${maxErr.toFixed(1)}px）`)
  }
}

{
  // 內部有高對比色塊（模擬 logo）：仍應擴張到整張名片
  const W = 420
  const H = 320
  const truth = rotRect(210, 160, 280, 160, 0)
  const res = detectCardQuad(W, H, synthCardImage(W, H, truth))
  ok(!!res, '內含高對比方塊時仍偵測成功')
  if (res) {
    const maxErr = Math.max(...res.quad.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)))
    ok(maxErr < 10, `擴張到整張名片（誤差 ${maxErr.toFixed(1)}px）`)
  }
}

{
  // 直式名片（手機直拿拍攝）
  const W = 320
  const H = 420
  const truth = rotRect(160, 210, 160, 280, 3)
  const res = detectCardQuad(W, H, synthCardImage(W, H, truth))
  ok(!!res, '直式名片偵測成功')
  if (res) {
    const maxErr = Math.max(...res.quad.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)))
    ok(maxErr < 10, `直式角點誤差 < 10px（實際 ${maxErr.toFixed(1)}px）`)
  }
}

{
  // 整張都是均勻背景 → 應該偵測不到
  const W = 300
  const H = 200
  const data = new Uint8ClampedArray(W * H * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 128
    data[i + 3] = 255
  }
  ok(detectCardQuad(W, H, data) === null, '均勻背景回傳 null')
}

console.log('\n== 視覺核心：透視校正 ==')

{
  const truth: Quad = [
    { x: 60, y: 50 },
    { x: 362, y: 40 },
    { x: 372, y: 248 },
    { x: 54, y: 262 },
  ]
  const W = 420
  const H = 300
  const src = synthCardImage(W, H, truth)
  const out = warpPerspective(W, H, src, truth, 300, 190)
  ok(out.length === 300 * 190 * 4, '輸出尺寸正確')
  const px = (x: number, y: number) => {
    const i = (y * 300 + x) * 4
    return (out[i] + out[i + 1] + out[i + 2]) / 3
  }
  ok(px(150, 20) > 200, `校正後卡片頂部是白（${px(150, 20).toFixed(0)}）`)
  ok(px(150, 95) < 90, `校正後中央黑塊仍在中央（${px(150, 95).toFixed(0)}）`)
  // homography: 單位矩形 ↔ 四點 來回
  const rect: Quad = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ]
  const H2 = solveH(rect, truth)
  const back = rect.map((p) => applyH(H2, p.x, p.y))
  const err = Math.max(...back.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y)))
  ok(err < 1e-6, `solveH 映射精確（誤差 ${err.toExponential(1)}）`)
}

console.log('\n== 欄位剖析（模擬 OCR）==')

{
  const text = [
    '澄澈科技股份有限公司',
    'CLEARVISION TECHNOLOGY INC.',
    '陳志明 Chen Chih-Ming',
    '軟體工程師 Software Engineer',
    'TEL：02-8765-4321',
    'Mobile：0912-345-678',
    'FAX：02-8765-4322',
    'ming.chen@clearvision.com.tw',
    'www.clearvision.com.tw',
    '105 台北市松山區敦化北路 100 號 12 樓',
  ].join('\n')
  const ex: any = extractFields(text)
  ok(ex.name.includes('陳志明'), `姓名：${ex.name}`)
  ok(ex.company.includes('澄澈科技'), `公司：${ex.company}`)
  ok(ex.title.includes('工程師'), `職稱：${ex.title}`)
  ok(ex.phones.some((p: string) => p.replace(/\D/g, '') === '0287654321'), `市話：${ex.phones.join(' / ')}`)
  ok(ex.phones.some((p: string) => p.replace(/\D/g, '') === '0912345678'), `手機：${ex.phones.join(' / ')}`)
  ok(ex.faxes.some((f: string) => f.includes('4322')), `傳真：${ex.faxes.join(' / ')}`)
  ok(ex.emails.includes('ming.chen@clearvision.com.tw'), `Email：${ex.emails.join(',')}`)
  ok(ex.website.includes('clearvision.com.tw'), `網址：${ex.website}`)
  ok(ex.address.includes('松山區'), `地址：${ex.address}`)
  ok(ex.category === 'tech', `自動歸類：${ex.category}（應為 tech）`)
}

{
  const text = [
    '寶豐證券股份有限公司',
    '林雅婷 Lin Ya-Ting',
    '理財專員',
    '電話 02-2345-6789 分機 226',
    '手機 0988-777-111',
    'yating.lin@baofeng.com.tw',
    '100 台北市中正區重慶南路一段 20 號 6 樓',
  ].join('\n')
  const ex: any = extractFields(text)
  ok(ex.name === '林雅婷 Lin Ya-Ting' || ex.name.includes('林雅婷'), `姓名：${ex.name}`)
  ok(ex.title.includes('理財專員'), `職稱：${ex.title}`)
  ok(ex.category === 'finance', `自動歸類：${ex.category}（應為 finance）`)
}

{
  const text = [
    'SUNRISE CREATIVE STUDIO',
    'Emily Wang',
    'Art Director',
    '+1 (415) 555-1234',
    'emily@sunrisecreative.com',
    '350 Fifth Avenue, New York, NY 10118',
  ].join('\n')
  const ex: any = extractFields(text)
  ok(ex.name === 'Emily Wang', `英文名：${ex.name}`)
  ok(ex.company.toLowerCase().includes('sunrise'), `公司：${ex.company}`)
  ok(ex.title === 'Art Director', `職稱：${ex.title}`)
  ok(ex.phones.some((p: string) => p.replace(/\D/g, '').endsWith('5551234')), `國際電話：${ex.phones.join(' / ')}`)
  ok(ex.category === 'design', `自動歸類：${ex.category}（應為 design）`)
}

console.log('\n== 自動歸類 ==')
ok(categorize('仁愛診所', '院長', '') === 'medical', '診所 → medical')
ok(categorize('大漢建設有限公司', '', '') === 'realestate', '建設 → realestate')
ok(categorize('全球運通物流股份有限公司', '', '') === 'logistics', '物流 → logistics')
ok(categorize('隨便一家店', '', '') === 'other', '無關鍵字 → other')

console.log(`\n結果：${pass} 通過，${fail} 失敗\n`)
process.exit(fail ? 1 : 0)
