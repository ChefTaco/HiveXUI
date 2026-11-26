/// <reference types="vitest/config" />
import { configDefaults } from 'vitest/config';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

/**
 * /version.json names this build's version and the hashed entry script its index.html loads. An
 * open tab compares it with its own entry script to notice an upgrade (src/lib/version-watch.ts).
 * Derived from the bundle, so the same sources build the same file.
 */
function versionManifest(): Plugin {
  const { version } = JSON.parse(readFileSync(resolve(import.meta.dirname, 'package.json'), 'utf8')) as { version: string };
  return {
    name: 'hivexui-version-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const entry = Object.values(bundle).find((chunk) => chunk.type === 'chunk' && chunk.isEntry);
      if (!entry) this.error('No entry chunk to record in version.json');
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, entry: '/' + entry.fileName }) + '\n' });
    },
  };
}

export default defineConfig({
  root: resolve(import.meta.dirname),
  plugins: [react(), tailwind(), versionManifest()],
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
