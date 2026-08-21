# AI 名片管家 · Business Card Scanner

掃描名片 → **AI 自動辨識** → **自動裁切 / 自動歸類** → 名片匣統一管理的網頁應用程式（支援手機與桌面）。

## ✨ 功能

### 📷 即時掃描（自動裁切）
- 開啟相機後**即時偵測名片邊緣**（純瀏覽器實作的 Sobel 邊緣偵測 + 連通區塊 + 凸包四邊形擷取）
- 邊緣穩定時顯示綠色「已鎖定 ✓」框，拍攝後自動做**透視校正裁切**（Homography），歪著拍也能轉正
- 可開啟「**自動拍攝**」：邊緣穩定 1.2 秒後自動快門，連按都不用按
- 沒相機？可**上傳圖片**或**載入範例名片**（App 會即時合成隨機角度的示範照片）
- 偵測不到邊緣時可用**手動裁切編輯器**（拖曳四個角）

### 🤖 AI 辨識（拍照傳給 AI）
- **內建引擎（免設定、離線）**：Tesseract.js OCR（繁中/簡中/英/日可選）+ 規則式欄位剖析
  - 自動擷取：姓名、職稱、公司、部門、電話／手機／傳真（含分機）、Email、網址、地址
- **視覺 AI 引擎（可選）**：把名片照片直接傳給 AI 模型，擷取更精準
  - 支援 **OpenAI 相容 API**（GPT-4o / GPT-4.1…，可自訂 Base URL）與 **Google Gemini**
  - API Key 只存在自己的瀏覽器，設定期提供「測試連線」
  - 視覺 AI 失敗時自動 fallback 到內建 OCR

### 🏷️ 自動歸類
- 依公司 / 職稱 / 名片內容自動分類：科技、金融、不動產、醫療、教育、製造、貿易、餐飲、法律、設計、營建、物流、其他（13 類）
- AI 標籤建議 + 自訂標籤

### 🗂️ 名片匣管理
- 關鍵字搜尋（姓名 / 公司 / 電話 / Email / 備註）、分類篩選、排序
- 名片詳情：原圖 / 裁切圖切換、一鍵撥號、Email、開地圖、複製欄位
- 編輯、刪除、分享（Web Share API，可分享名片圖 + 聯絡資訊）
- 匯出：**vCard (.vcf)** 可直接匯入手機通訊錄、**CSV**（Excel）、**JSON** 備份 / 匯入

## 🚀 執行

```bash
npm install
npm run dev     # 開發伺服器（需要 HTTPS/localhost 才能使用相機）
npm test        # 單元測試（邊緣偵測、透視校正、欄位剖析、自動歸類）
npm run build   # 正式建置到 dist/

# E2E 驗證（選用：合成名片照 → 偵測 → 裁切 → OCR → 剖析）
npm i --no-save sharp tesseract.js   # 沙盒離線時 OCR 段會自動略過
npx tsx test/e2e.ts
```

> 相機即時預覽需要 HTTPS 或 localhost 環境（瀏覽器安全規範）。

## 🛠️ 技術

- **前端**：TypeScript + Vite，無框架、零執行期依賴
- **電腦視覺**：自製輕量管線 — 灰階 → Sobel 梯度 → 自適應二值化 → 形態學膨脹 → 連通區塊 → 凸包 → Douglas–Peucker 四邊形簡化 → 最小外接矩形備援 → 單應矩陣透視校正（雙線性取樣）
- **OCR**：Tesseract.js（CDN 載入，瀏覽器端執行）
- **視覺 AI**：OpenAI 相容 /chat/completions（vision）與 Gemini generateContent，回傳嚴格 JSON
- **儲存**：IndexedDB（localStorage 後備），圖片以 dataURL 內嵌，完全離線優先

## 📁 結構

```
src/
├── main.ts            # 入口、分頁路由
├── scan.ts            # 掃描頁（相機、即時偵測、辨識流程、手動裁切）
├── cards.ts           # 名片匣（列表、詳情、編輯、匯出 vCard/CSV/JSON）
├── settings.ts        # 設定（AI 引擎、API Key、資料管理）
├── extract.ts         # OCR 文字 → 欄位剖析 + 自動歸類
├── ocr.ts             # Tesseract.js 封裝
├── llm.ts             # OpenAI / Gemini 視覺辨識
├── store.ts           # IndexedDB 儲存
├── components.ts      # 共用 UI（modal、toast、表單、圖示）
├── types.ts           # 型別與分類字典
└── vision/
    ├── core.ts        # 純數學視覺核心（可 Node 單元測試）
    └── canvas.ts      # Canvas 工具
test/run.ts            # 單元測試
public/samples/        # 範例名片（SVG）+ 示範桌面照
```
