import { defineConfig, type Plugin } from 'vite';
import { thirdPartyLicenses } from '../../tools/build/third-party-licenses.ts';

/** dist/THIRD_PARTY_LICENSES.txt: the licences of the npm packages bundled into dist. */
function licenseFile(): Plugin {
  return {
    name: 'third-party-licenses',
    generateBundle(_, bundle) {
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_LICENSES.txt', source: thirdPartyLicenses(bundle) });
    },
  };
}

// The published package: one platform-neutral library (index), the Node PNG
// rasterizer (png) and the command (cli), which includes the MCP server.
// HexSketch's own packages and the MCP SDK are bundled in; Node built-ins and
// resvg stay outside.
export default defineConfig({
  plugins: [licenseFile()],
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
