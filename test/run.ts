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
import { localAnswer } from '../src/chat'
import { evaluateCapture, frameQuality } from '../src/vision/quality'
import { parseJsonLoose, cleanBaseUrl } from '../src/llm'

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


console.log('\n== AI 助理：本機搜尋後備 ==')

{
  const mk = (over: any) => ({
    id: 'x', createdAt: 0, updatedAt: 0, name: '', title: '', company: '', department: '',
    phones: [], faxes: [], emails: [], website: '', address: '', category: 'other' as const,
    tags: [], notes: '', rawText: '', source: 'ocr' as const, imageCropped: '', ...over,
  })
  const demo = [
    mk({ name: '陳志明', title: '軟體工程師', company: '澄澈科技', category: 'tech' }),
    mk({ name: '林雅婷', title: '理財專員', company: '寶豐證券', category: 'finance', emails: ['y@x.tw'] }),
    mk({ name: 'Emily Wang', title: 'Art Director', company: 'Sunrise Studio', category: 'design' }),
  ]
  const a1 = localAnswer('科技業', demo)
  ok(a1.includes('陳志明'), `分類查詢命中（${a1.split('\n')[0]}）`)
  const a2 = localAnswer('澄澈', demo)
  ok(a2.includes('陳志明'), '公司關鍵字命中')
  const a3 = localAnswer('找不到的東西zzz', demo)
  ok(a3.includes('沒有找到') || a3.includes('沒有'), '無結果時友善回覆')
  const a4 = localAnswer('任何', [])
  ok(a4.includes('空的'), '空名片匣提示')
}


console.log('\n== 智慧自動拍攝：畫面品質與時機評分 ==')

{
  const W = 160, H = 120
  const mk = (fn: (x: number, y: number, i: number) => number): Uint8ClampedArray => {
    const d = new Uint8ClampedArray(W * H * 4)
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const v = fn(x, y, i)
      d[i] = d[i + 1] = d[i + 2] = v
      d[i + 3] = 255
    }
    return d
  }
  const dark = mk(() => 20) // 暗且無細節
  const qDark = frameQuality(W, H, dark)
  ok(qDark.brightness < 0.15, `過暗偵測（亮度 ${qDark.brightness.toFixed(2)}）`)
  ok(qDark.sharpness < 0.3, `無細節 → 低清晰度（${qDark.sharpness.toFixed(2)}）`)

  const bright = mk(() => 250)
  ok(frameQuality(W, H, bright).brightness > 0.9, '過亮偵測')

  const sharpImg = mk((x) => (Math.floor(x / 4) % 2 ? 30 : 220)) // 高頻棋盤紋
  ok(frameQuality(W, H, sharpImg).sharpness > 0.6, '高頻細節 → 高清晰度')

  // 評分：暗 + 不穩 → 不該拍
  const bad = evaluateCapture({ stability: 0.2, quadRatio: 0.1, quality: qDark })
  ok(!bad.ready && bad.score < 0.5, `低分不觸發（${bad.score.toFixed(2)}）`)
  ok(bad.hints.length > 0, `給出改善建議（${bad.hints.join('、')}）`)

  // 評分：理想條件 → 該拍
  const good = evaluateCapture({
    stability: 1,
    quadRatio: 0.4,
    quality: { sharpness: 0.8, brightness: 0.55, contrast: 0.6 },
  })
  ok(good.ready && good.score >= 0.8, `理想條件觸發（${good.score.toFixed(2)}）`)

  // 構圖：太近 / 太遠
  ok(evaluateCapture({ stability: 1, quadRatio: 0.08, quality: { sharpness: 0.8, brightness: 0.55, contrast: 0.5 } }).hints.some((h) => h.includes('靠近')), '名片太小 → 提示靠近')
  ok(evaluateCapture({ stability: 1, quadRatio: 0.92, quality: { sharpness: 0.8, brightness: 0.55, contrast: 0.5 } }).hints.some((h) => h.includes('遠') || h.includes('入鏡')), '名片太大 → 提示拿遠')
}

console.log('\n== LLM 回覆 JSON 解析（各種模型壞習慣） ==')

{
  const j1 = parseJsonLoose('{"name":"陳志明"}')
  ok(j1.name === '陳志明', '純 JSON')
  const j2 = parseJsonLoose('```json\n{"name":"陳志明"}\n```')
  ok(j2.name === '陳志明', 'markdown 圍籬')
  const j3 = parseJsonLoose('好的，以下是結果：\n{"name":"陳志明","phones":["0912-345-678"]}\n希望有幫助！')
  ok(j3.phones[0] === '0912-345-678', '前後有說明文字')
  const j4 = parseJsonLoose('{"company":"ACME {Corp}"} 附註')
  ok(j4.company === 'ACME {Corp}', '字串內含大括號')
  try {
    parseJsonLoose('')
    ok(false, '空回覆應拋錯')
  } catch (e: any) {
    ok(String(e.message).includes('為空'), '空回覆錯誤訊息')
  }
  try {
    parseJsonLoose('抱歉，我無法辨識這張圖片。')
    ok(false, '純文字回覆應拋錯')
  } catch (e: any) {
    ok(String(e.message).includes('無法解析') && String(e.message).includes('抱歉'), '錯誤訊息包含原文節錄')
  }
}

console.log('\n== API Base URL 清理 ==')

{
  const cases: [string, string][] = [
    ['https://api.openai.com/v1', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/', 'https://api.openai.com/v1'],
    ['  https://api.openai.com/v1/  ', 'https://api.openai.com/v1'],
    ['https://api.openai.com/v1/chat/completions', 'https://api.openai.com/v1'],
    ['https://host/api/models', 'https://host/api'],
    ['https://host/v1beta/models/x:generateContent', 'https://host/v1beta/models/x'],
  ]
  let bad = 0
  for (const [inp, want] of cases) {
    const got = cleanBaseUrl(inp)
    if (got !== want) {
      bad++
      console.error(`  ❌ cleanBaseUrl(${inp}) = ${got}，預期 ${want}`)
    }
  }
  ok(bad === 0, `6 種常見輸入都正確清理（${cases.length - bad}/${cases.length}）`)
}

console.log(`\n結果：${pass} 通過，${fail} 失敗\n`)
process.exit(fail ? 1 : 0)
