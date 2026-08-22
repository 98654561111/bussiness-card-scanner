/* ============================================================
 * 設定頁：AI 引擎、API Key、OCR 語言、資料管理
 * ============================================================ */

import { Card, EngineId, OCR_LANGS, Settings } from './types'
import { clearAllCards, getAllCards, importCards, loadSettings, saveSettings } from './store'
import { testConnection } from './llm'
import { esc, icon, toast, confirmDialog, openModal } from './components'
import { exportCsv, exportJson, refreshCards } from './cards'

export async function renderSettings(root: HTMLElement): Promise<void> {
  const s = loadSettings()
  const count = (await getAllCards()).length

  root.innerHTML = `
  <section class="page settings-page">
    <div class="card set-card">
      <h2>${icon('text', 18)} 辨識引擎</h2>
      <p class="set-desc">內建引擎可直接離線使用，不需任何設定；若要更精準的欄位擷取，可設定 API Key 使用雲端視覺模型辨識。</p>
      <div class="engine-grid">
        <label class="engine-opt">
          <input type="radio" name="engine" value="builtin" ${s.engine === 'builtin' ? 'checked' : ''}>
          <div>
            <strong>內建辨識引擎</strong>
            <small>瀏覽器離線執行，免設定</small>
          </div>
          <span class="engine-tag">免費</span>
        </label>
        <label class="engine-opt">
          <input type="radio" name="engine" value="openai" ${s.engine === 'openai' ? 'checked' : ''}>
          <div>
            <strong>OpenAI 相容 API</strong>
            <small>GPT-4o / GPT-4.1 等視覺模型</small>
          </div>
        </label>
        <label class="engine-opt">
          <input type="radio" name="engine" value="gemini" ${s.engine === 'gemini' ? 'checked' : ''}>
          <div>
            <strong>Google Gemini</strong>
            <small>Gemini 2.0 Flash 視覺模型</small>
          </div>
        </label>
        <label class="engine-opt">
          <input type="radio" name="engine" value="custom" ${s.engine === 'custom' ? 'checked' : ''}>
          <div>
            <strong>自訂 OCR 服務</strong>
            <small>自架 CnOCR / PaddleOCR（附伺服器腳本）</small>
          </div>
          <span class="engine-tag">自架</span>
        </label>
      </div>

      <div class="provider-fields" id="openaiFields" ${s.engine !== 'openai' ? 'hidden' : ''}>
        <div class="form-grid">
          <label class="field span2"><span>API Base URL <small>（填到 /v1 即可，不用含 /chat/completions；需為 https://）</small></span><input id="oaUrl" type="text" value="${esc(s.openai.baseUrl)}" placeholder="https://api.openai.com/v1"></label>
          <label class="field"><span>API Key</span><input id="oaKey" type="password" value="${esc(s.openai.apiKey)}" placeholder="sk-…" autocomplete="off"></label>
          <label class="field"><span>模型</span><input id="oaModel" type="text" value="${esc(s.openai.model)}" placeholder="gpt-4o-mini" list="oaModels">
            <datalist id="oaModels">
              <option value="gpt-4o-mini"></option><option value="gpt-4o"></option><option value="gpt-4.1-mini"></option><option value="gpt-4.1"></option>
            </datalist>
          </label>
        </div>
      </div>

      <div class="provider-fields" id="customFields" ${s.engine !== 'custom' ? 'hidden' : ''}>
        <div class="form-grid">
          <label class="field span2"><span>OCR 服務網址 <small>（搭配 repo 內 server/cnocr_server.py，本機預設 http://localhost:8000；https 頁面無法連 http 服務，請在本機開啟 App）</small></span><input id="csUrl" type="text" value="${esc(s.custom.baseUrl)}" placeholder="http://localhost:8000"></label>
        </div>
      </div>

      <div class="provider-fields" id="geminiFields" ${s.engine !== 'gemini' ? 'hidden' : ''}>
        <div class="form-grid">
          <label class="field span2"><span>API Base URL <small>（需為 https://）</small></span><input id="gmUrl" type="text" value="${esc(s.gemini.baseUrl)}" placeholder="https://generativelanguage.googleapis.com/v1beta"></label>
          <label class="field"><span>API Key</span><input id="gmKey" type="password" value="${esc(s.gemini.apiKey)}" placeholder="AIza…" autocomplete="off"></label>
          <label class="field"><span>模型</span><input id="gmModel" type="text" value="${esc(s.gemini.model)}" placeholder="gemini-2.0-flash" list="gmModels">
            <datalist id="gmModels">
              <option value="gemini-2.0-flash"></option><option value="gemini-2.5-flash"></option><option value="gemini-2.5-pro"></option>
            </datalist>
          </label>
        </div>
      </div>

      <div class="set-row-actions">
        <button class="btn btn-ghost" id="btnTest">${icon('check', 15)} 測試連線</button>
        <button class="btn btn-primary" id="btnSaveSettings">${icon('check', 15)} 儲存設定</button>
      </div>
      <p class="privacy-note">🔒 API Key 只會存在你自己的瀏覽器（localStorage），不會上傳到任何其他地方。</p>
    </div>

    <div class="card set-card">
      <h2>${icon('camera', 18)} 掃描與拍攝</h2>
      <div class="form-grid">
        <label class="field"><span>自動拍攝模式</span>
          <select id="capMode">
            <option value="manual" ${s.captureMode === 'manual' ? 'selected' : ''}>手動（自己按快門）</option>
            <option value="stable" ${s.captureMode === 'stable' ? 'selected' : ''}>穩定即拍（邊緣穩定 1.2 秒）</option>
            <option value="best" ${s.captureMode === 'best' ? 'selected' : ''}>最佳時機（穩定＋清晰＋構圖評分）</option>
          </select>
        </label>
        <label class="field"><span>連續掃描</span>
          <select id="contScan">
            <option value="off" ${!s.continuousScan ? 'selected' : ''}>關閉（每張確認後儲存）</option>
            <option value="on" ${s.continuousScan ? 'selected' : ''}>開啟（自動存檔並連續拍）</option>
          </select>
        </label>
        <label class="field"><span>即時自動裁切</span>
          <select id="autoCropSet">
            <option value="on" ${s.autoCrop ? 'selected' : ''}>開啟</option>
            <option value="off" ${!s.autoCrop ? 'selected' : ''}>關閉</option>
          </select>
        </label>
      </div>
    </div>

    <div class="card set-card">
      <h2>${icon('text', 18)} OCR 語言（內建引擎）</h2>
      <div class="form-grid">
        <label class="field"><span>名片語言</span>
          <select id="ocrLang">
            ${OCR_LANGS.map((l) => `<option value="${l.id}" ${s.ocrLang === l.id ? 'selected' : ''}>${l.label}</option>`).join('')}
          </select>
        </label>
      </div>
    </div>

    <div class="card set-card">
      <h2>${icon('cards', 18)} 資料管理</h2>
      <p class="set-desc">目前共有 <b>${count}</b> 張名片，資料儲存於本機瀏覽器。</p>
      <div class="set-row-actions wrap">
        <button class="btn btn-ghost" id="btnExpJson">${icon('download', 15)} 備份 JSON</button>
        <button class="btn btn-ghost" id="btnExpCsv">${icon('download', 15)} 匯出 CSV</button>
        <button class="btn btn-ghost" id="btnImport">${icon('upload', 15)} 匯入 JSON</button>
        <button class="btn btn-danger" id="btnClear">${icon('trash', 15)} 清空所有名片</button>
      </div>
      <input type="file" id="importFile" accept="application/json,.json" hidden>
    </div>
  </section>`

  const readForm = (): Settings => {
    const engine = (root.querySelector<HTMLInputElement>('input[name="engine"]:checked')?.value || 'builtin') as EngineId
    return {
      engine,
      openai: {
        baseUrl: (root.querySelector('#oaUrl') as HTMLInputElement)?.value.trim() || 'https://api.openai.com/v1',
        apiKey: (root.querySelector('#oaKey') as HTMLInputElement)?.value.trim() || '',
        model: (root.querySelector('#oaModel') as HTMLInputElement)?.value.trim() || 'gpt-4o-mini',
      },
      gemini: {
        baseUrl:
          (root.querySelector('#gmUrl') as HTMLInputElement)?.value.trim() ||
          'https://generativelanguage.googleapis.com/v1beta',
        apiKey: (root.querySelector('#gmKey') as HTMLInputElement)?.value.trim() || '',
        model: (root.querySelector('#gmModel') as HTMLInputElement)?.value.trim() || 'gemini-2.0-flash',
      },
      custom: {
        baseUrl: (root.querySelector('#csUrl') as HTMLInputElement)?.value.trim() || 'http://localhost:8000',
      },
      ocrLang: (root.querySelector('#ocrLang') as HTMLSelectElement).value,
      autoCrop: (root.querySelector('#autoCropSet') as HTMLSelectElement).value === 'on',
      captureMode: (root.querySelector('#capMode') as HTMLSelectElement).value as Settings['captureMode'],
      continuousScan: (root.querySelector('#contScan') as HTMLSelectElement).value === 'on',
    }
  }

  root.querySelectorAll<HTMLInputElement>('input[name="engine"]').forEach((r) =>
    r.addEventListener('change', () => {
      const v = (root.querySelector('input[name="engine"]:checked') as HTMLInputElement).value
      root.querySelector<HTMLElement>('#openaiFields')!.hidden = v !== 'openai'
      root.querySelector<HTMLElement>('#geminiFields')!.hidden = v !== 'gemini'
      root.querySelector<HTMLElement>('#customFields')!.hidden = v !== 'custom'
    }),
  )

  root.querySelector('#btnSaveSettings')!.addEventListener('click', () => {
    saveSettings(readForm())
    toast('設定已儲存', 'ok')
  })

  root.querySelector('#btnTest')!.addEventListener('click', async (e) => {
    const btn = e.currentTarget as HTMLButtonElement
    saveSettings(readForm())
    btn.disabled = true
    btn.textContent = '測試中…'
    const r = await testConnection(readForm())
    btn.disabled = false
    btn.innerHTML = `${icon('check', 15)} 測試連線`
    toast(r.message, r.ok ? 'ok' : 'err')
  })

  root.querySelector('#btnExpJson')!.addEventListener('click', async () => {
    exportJson(await getAllCards())
  })
  root.querySelector('#btnExpCsv')!.addEventListener('click', async () => {
    exportCsv(await getAllCards())
  })

  const importFile = root.querySelector<HTMLInputElement>('#importFile')!
  root.querySelector('#btnImport')!.addEventListener('click', () => importFile.click())
  importFile.addEventListener('change', async () => {
    const f = importFile.files?.[0]
    importFile.value = ''
    if (!f) return
    try {
      const parsed = JSON.parse(await f.text())
      const list: Card[] = Array.isArray(parsed) ? parsed : parsed.cards
      if (!Array.isArray(list)) throw new Error('格式不正確')
      const n = await importCards(list)
      await refreshCards()
      toast(`成功匯入 ${n} 張名片`, 'ok')
    } catch (err: any) {
      toast(`匯入失敗：${err?.message || err}`, 'err')
    }
  })

  root.querySelector('#btnClear')!.addEventListener('click', async () => {
    const ok = await confirmDialog('清空所有名片？', `將刪除全部 ${count} 張名片與圖片，建議先備份 JSON。此動作無法復原。`, {
      danger: true,
      okText: '全部刪除',
    })
    if (!ok) return
    await clearAllCards()
    await refreshCards()
    await renderSettings(root)
    toast('已清空所有名片', 'ok')
  })
}
