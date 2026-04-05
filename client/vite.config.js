import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const backendProxy = {
  '/api': { target: 'http://localhost:3001', changeOrigin: true },
  '/socket.io': { target: 'http://localhost:3001', ws: true },
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
