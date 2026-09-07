import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    host: true,
    proxy: {
      // 개발 중에는 프런트(5173)에서 백엔드(8787)로 넘긴다.
      // 덕분에 클라이언트 코드는 항상 같은 출처의 /api 만 부르면 된다.
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
