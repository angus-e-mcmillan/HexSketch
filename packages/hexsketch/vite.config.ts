import { defineConfig } from 'vite';

// The published package: one platform-neutral library (index), the Node PNG
// rasterizer (png) and the command (cli). HexSketch's own packages are bundled
// in; Node built-ins and resvg stay outside.
export default defineConfig({
  build: {
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: { index: 'src/index.ts', png: 'src/png.ts', cli: 'src/cli.ts' },
      formats: ['es'],
    },
    rollupOptions: {
      external: [/^node:/, '@resvg/resvg-wasm'],
      output: {
        // Chunks stay next to the entries, so png.js finds ../fonts.
        chunkFileNames: '[name]-[hash].js',
        banner: (chunk) => (chunk.name === 'cli' ? '#!/usr/bin/env node' : ''),
      },
    },
  },
});
