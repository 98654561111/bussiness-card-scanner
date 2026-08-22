import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// 預設以 HTTPS 提供（自簽憑證）：
// - 相機（getUserMedia）等 Web API 需要安全環境（https 或 localhost）
// - 瀏覽器第一次開啟會顯示「不受信任的憑證」警告，點「繼續前往」即可
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    https: {},
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  build: {
    target: 'es2020',
  },
})
