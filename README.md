# 名片管家 · Business Card Scanner

掃描名片 → **自動辨識** → **自動裁切 / 自動歸類** → 名片匣統一管理的網頁應用程式（支援手機與桌面）。

## ✨ 功能

### 📷 即時掃描（自動裁切 + 智慧自動拍攝）
- 開啟相機後**即時偵測名片邊緣**（純瀏覽器實作的邊緣偵測 + 候選框評分搜尋）
- 邊緣穩定時顯示綠色「已鎖定 ✓」框，拍攝後自動做**透視校正裁切**（Homography），歪著拍也能轉正
- **智慧自動拍攝**（三種模式可選）：
  - `手動` — 自己按快門
  - `穩定即拍` — 邊緣穩定 1.2 秒自動快門
  - `最佳時機` — 綜合**穩定度＋清晰度（Laplacian 變異數）＋亮度＋構圖**評分，在分數高峰自動按下快門
- 即時**準備度分數條**與改善提示（「拿穩一點」「光線太暗」「再靠近一點」）
- **連續掃描模式**：相機不中斷，拍一張 → 自動辨識歸類存檔 → 等你換下一張 → 繼續拍，掃一疊名片不用碰手機
- 沒相機？可**上傳圖片**、**批次掃描**多張或**載入範例名片**
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

### 📦 批次掃描
- 一次挑多張名片圖 → 排隊**自動裁切 + AI 辨識 + 自動歸類儲存**
- 逐張顯示進度與結果，失敗可單張重試；OCR worker 重用加速批次

### 📊 洞察：人脈分析儀表板
- 統計卡片（總數 / 公司 / 分類 / 本月新增）
- 產業分布甜甜圈圖、近 12 個月新增趨勢、公司排行、資料完整度（純 SVG/CSS，離線可用）

### 💬 洞察：AI 人脈助理
- 自然語言問答：「科技業有誰？」「有 email 的有幾張？」「澄澈科技的電話？」
- 有設 AI Key 時走 LLM 智能問答（只依名片資料回答）；沒有 Key 自動退回**本機關鍵字搜尋**，離線也能用

## 🚀 執行

```bash
npm install
npm run dev               # 開發伺服器（http://localhost:5173；部署平台在外層已提供 HTTPS）
HTTPS=true npm run dev  # 本機 HTTPS 模式（自簽憑證，相機需要）
npm test        # 單元測試（邊緣偵測、透視校正、欄位剖析、自動歸類）
npm run build   # 正式建置到 dist/

# E2E 驗證（選用：合成名片照 → 偵測 → 裁切 → OCR → 剖析）
npm i --no-save sharp tesseract.js   # 沙盒離線時 OCR 段會自動略過
npx tsx test/e2e.ts
```

> HTTPS 說明：沙盒／部署平台（Cloudflare、e2b）會在**外層**以 HTTPS 連到伺服器，後端保持 HTTP 即可（預覽網址本身就是 https）。若在本機直接執行並需要相機（getUserMedia），用 `HTTPS=true npm run dev` 開啟自簽憑證 HTTPS，第一次瀏覽器會顯示警告，點「進階 → 繼續前往」即可。



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
├── batch.ts           # 批次掃描（多張排隊自動處理）
├── cards.ts           # 名片匣（列表、詳情、編輯、匯出 vCard/CSV/JSON）
├── dashboard.ts       # 洞察頁（人脈分析圖表 + AI 助理切換）
├── chat.ts            # AI 人脈助理（LLM 問答 + 本機搜尋後備）
├── recognize.ts       # 共用辨識管線（視覺 AI → OCR fallback → Card）
├── settings.ts        # 設定（AI 引擎、API Key、資料管理）
├── extract.ts         # OCR 文字 → 欄位剖析 + 自動歸類
├── ocr.ts             # Tesseract.js 封裝（worker 重用）
├── llm.ts             # OpenAI / Gemini 視覺辨識 + 文字對話
├── store.ts           # IndexedDB 儲存
├── components.ts      # 共用 UI（modal、toast、表單、圖示）
├── types.ts           # 型別與分類字典
└── vision/
    ├── core.ts        # 純數學視覺核心（可 Node 單元測試）
    ├── quality.ts     # 畫面品質評估（清晰度/亮度/自動拍攝評分）
    └── canvas.ts      # Canvas 工具
test/run.ts            # 單元測試（50 項）
public/samples/        # 範例名片（SVG）+ 示範桌面照
```
