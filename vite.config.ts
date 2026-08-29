import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// HTTPS 說明：
// - 部署平台（Cloudflare / e2b 閘道）會在外層以 HTTPS 連到本伺服器，後端保持 HTTP 即可
// - 若要本機直接以 HTTPS 執行（自簽憑證），用：HTTPS=true npm run dev
//   （相機 getUserMedia 需要 https 或 localhost 環境）
const useHttps = process.env.HTTPS === 'true' || process.env.HTTPS === '1'

export default defineConfig({
  plugins: useHttps ? [basicSsl()] : [],
  server: {
    https: useHttps ? {} : undefined,
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
  },
  // onnxruntime-web 以 CDN 方式載入 wasm，排除預打包可避免 dev 解析問題
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  build: {
    target: 'es2020',
  },
})
