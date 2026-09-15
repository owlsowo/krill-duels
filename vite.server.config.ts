import { defineConfig } from 'vite';
export default defineConfig({
  publicDir: false,
  build: { target: 'es2022', ssr: 'server/index.ts', outDir: 'dist/server', minify: true,
    rollupOptions: { output: { entryFileNames: 'index.js' } } },
});
