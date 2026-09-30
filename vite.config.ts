import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
export default defineConfig(({ command }) => ({
  base: './',
  plugins: command === 'build' ? [viteSingleFile()] : [],
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
}));
