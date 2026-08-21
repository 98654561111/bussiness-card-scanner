/* ============================================================
 * E2E 驗證（ad-hoc，不入 npm test）：
 * SVG 名片 → 合成桌面照 → 邊緣偵測 → 透視裁切 → OCR → 欄位剖析
 * 執行：npx tsx test/e2e.ts
 * ============================================================ */
import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { detectCardQuad, quadOutputSize, warpPerspective, Quad } from '../src/vision/core'
import { extractFields } from '../src/extract'

const OUT = '.test-out'
mkdirSync(OUT, { recursive: true })

/* ---- 1. 合成：桌面照 + 旋轉 5° 的名片（模擬 app 的 makeSamplePhoto）---- */
const W = 1280
const H = 960
const ANGLE = 5
const CARD_W = 760
const desk = await sharp('public/samples/desk.jpg').resize(W, H).toBuffer()
const cardPng = await sharp('public/samples/card-tech.svg')
  .resize({ width: CARD_W })
  .png()
  .toBuffer()
const cardMeta = await sharp(cardPng).metadata()
const CARD_H = cardMeta.height!
const rotated = await sharp(cardPng)
  .rotate(ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toBuffer()
const rotMeta = await sharp(rotated).metadata()
const left = Math.round((W - rotMeta.width!) / 2)
const top = Math.round((H - rotMeta.height!) / 2)
const photo = await sharp(desk)
  .composite([{ input: rotated, left, top }])
  .jpeg({ quality: 92 })
  .toBuffer()
writeFileSync(`${OUT}/photo.jpg`, photo)
console.log(`✓ 合成照片 ${W}x${H}，名片 ${CARD_W}x${CARD_H} 旋轉 ${ANGLE}°，置於 (${left}, ${top})`)

/* 名片真實四角（旋轉前中心 = (W/2, H/2)） */
const rad = (ANGLE * Math.PI) / 180
const cx = W / 2
const cy = H / 2
const rot = (x: number, y: number): { x: number; y: number } => ({
  x: cx + (x - cx) * Math.cos(rad) - (y - cy) * Math.sin(rad),
  y: cy + (x - cx) * Math.sin(rad) + (y - cy) * Math.cos(rad),
})
const truth: Quad = [
  rot(cx - CARD_W / 2, cy - CARD_H / 2),
  rot(cx + CARD_W / 2, cy - CARD_H / 2),
  rot(cx + CARD_W / 2, cy + CARD_H / 2),
  rot(cx - CARD_W / 2, cy + CARD_H / 2),
]

/* ---- 2. 偵測 + 裁切 ---- */
const { data, info } = await sharp(photo).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const pixels = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength)
const det = detectCardQuad(info.width, info.height, pixels)
if (!det) {
  console.error('❌ 偵測失敗')
  process.exit(1)
}
const errs = det.quad.map((p, i) => Math.hypot(p.x - truth[i].x, p.y - truth[i].y))
console.log(`✓ 偵測到名片，信心 ${det.conf.toFixed(2)}，角點誤差 = ${errs.map((e) => e.toFixed(1) + 'px').join(', ')}`)

const { w: ow, h: oh } = quadOutputSize(det.quad, 1100)
const warped = warpPerspective(info.width, info.height, pixels, det.quad, ow, oh)
await sharp(Buffer.from(warped.buffer), { raw: { width: ow, height: oh, channels: 4 } })
  .jpeg({ quality: 90 })
  .toFile(`${OUT}/cropped.jpg`)
console.log(`✓ 透視校正輸出 ${ow}x${oh} → .test-out/cropped.jpg`)

/* ---- 3. OCR（需要 CDN 下載語言檔；沙盒離線時自動略過） ---- */
let text = ''
try {
  await fetch('https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js', { method: 'HEAD' })
} catch {
  console.log('⚠️ 沙盒無法連線 CDN，略過真實 OCR（瀏覽器端不受影響），改用模擬文字驗證剖析')
  text = [
    '澄澈科技股份有限公司',
    'CLEARVISION TECHNOLOGY INC.',
    '陳志明 Chen Chih-Ming',
    '軟體工程師 Software Engineer',
    'TEL 02-8765-4321',
    'Mobile 0912-345-678',
    'ming.chen@clearvision.com.tw',
    'www.clearvision.com.tw',
    '105 台北市松山區敦化北路 100 號 12 樓',
  ].join('\n')
}
if (text) {
  const ex = extractFields(text)
  const checks: [boolean, string][] = [
    [ex.name.includes('陳志明'), `姓名 ${ex.name}`],
    [ex.company.includes('澄澈'), `公司 ${ex.company}`],
    [ex.emails.some((e: string) => e.includes('clearvision')), `Email ${ex.emails}`],
    [ex.category === 'tech', `分類 ${ex.category}`],
  ]
  let fail = 0
  for (const [c, label] of checks) { console.log(`${c ? '✅' : '❌'} ${label}`); if (!c) fail++ }
  console.log(fail === 0 ? '\n🎉 E2E（偵測+裁切+剖析）全部通過' : `\n⚠️ ${fail} 項未過`)
  process.exit(fail ? 1 : 0)
}
const { createWorker } = await import('tesseract.js')
const worker = await createWorker('chi_tra+eng')
try {
  const ret = await worker.recognize(`${OUT}/cropped.jpg`)
  const text: string = ret.data.text || ''
  console.log('—— OCR 結果 ——')
  console.log(text.split('\n').filter((l) => l.trim()).slice(0, 12).join('\n'))
  /* ---- 4. 欄位剖析 ---- */
  const ex: any = extractFields(text)
  console.log('—— 剖析欄位 ——')
  console.log(JSON.stringify({ ...ex, rawText: '(略)' }, null, 2))
  const checks: [boolean, string][] = [
    [ex.name.includes('陳志明'), `姓名 ${ex.name}`],
    [ex.company.includes('澄澈'), `公司 ${ex.company}`],
    [ex.emails.some((e: string) => e.includes('clearvision')), `Email ${ex.emails}`],
    [ex.phones.length > 0, `電話 ${ex.phones}`],
    [ex.category === 'tech', `分類 ${ex.category}`],
  ]
  let fail = 0
  for (const [c, label] of checks) {
    console.log(`${c ? '✅' : '❌'} ${label}`)
    if (!c) fail++
  }
  console.log(fail === 0 ? '\n🎉 E2E 全部通過' : `\n⚠️ ${fail} 項未過（OCR 品質或剖析規則需調整）`)
} finally {
  await worker.terminate()
}
