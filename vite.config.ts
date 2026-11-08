/// <reference types="vitest/config" />
import { configDefaults } from 'vitest/config';
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
      '@magnus': resolve(import.meta.dirname, './src/modules/magnus'),
      '@ui': resolve(import.meta.dirname, './src/components/ui.tsx'),
      '@lib': resolve(import.meta.dirname, './src/lib'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // The PDF worker ships as .mjs, which the image's nginx serves without a JavaScript type, and
        // nosniff then stops the worker. The same file as .js is served as JavaScript.
        assetFileNames: (asset) => (asset.names.some((name) => name.endsWith('.mjs')) ? 'assets/[name]-[hash].js' : 'assets/[name]-[hash][extname]'),
      },
    },
  },
  test: {
    // e2e/ holds the Playwright end-to-end specs (npm run e2e), not unit tests.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
  server: {
    port: 5174,
    host: '0.0.0.0',
  },
});
