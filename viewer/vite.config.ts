import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'wasm-mime-type',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith('.wasm')) {
            res.setHeader('Content-Type', 'application/wasm');
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    open: true,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm', '@ifc-lite/wasm'],
  },
  assetsInclude: ['**/*.wasm'],
});
