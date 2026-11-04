import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react(),tailwind()],
  resolve: {
    alias: {
      '@contracts': resolve(import.meta.dirname, './contracts'),
      '@security': resolve(import.meta.dirname,'./src/modules/security'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
  },
});
