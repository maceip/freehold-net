import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
      },
    },
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      // Discovery server WebSocket — live MPC node topology
      '/ws': {
        target: 'ws://127.0.0.1:5880',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
