import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendProxy = {
  '/api': { target: 'http://localhost:3001', changeOrigin: true },
  '/socket.io': {
    target: 'http://localhost:3001',
    ws: true,
    configure: (proxy) => {
      proxy.on('error', (err) => {
        // Harmless when the browser refreshes while the WS proxy is open.
        if (err.code === 'ECONNABORTED' || err.code === 'ECONNRESET') return;
        console.error('[vite] ws proxy error:', err.message);
      });
    },
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: backendProxy,
  },
  preview: {
    proxy: backendProxy,
  },
});
