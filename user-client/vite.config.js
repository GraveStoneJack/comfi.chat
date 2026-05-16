import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname),
  base: '/',
  build: {
    outDir: path.resolve(__dirname, '../user-dist'),
    emptyOutDir: true
  },
  server: {
    port: 5174,
    proxy: {
      '/api': 'http://localhost:10000'
    }
  }
});
