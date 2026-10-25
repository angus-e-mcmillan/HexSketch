import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * THIRD_PARTY_LICENSES.txt: the licence of every npm package bundled into
 * dist (the MCP SDK and what it uses), as their licences require the notices
 * to travel with the code. HexSketch's own packages are not under
 * node_modules once resolved, so they are not listed.
 */
function thirdPartyLicenses(): Plugin {
  return {
    name: 'third-party-licenses',
    generateBundle(_, bundle) {
      const dirs = new Set<string>();
      for (const out of Object.values(bundle)) {
        if (out.type !== 'chunk') continue;
        for (const id of Object.keys(out.modules)) {
          // CommonJS wrappers are virtual modules: "\0" in front, "?commonjs-..." after.
          const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id.replace(/^\0/, '').replace(/\?.*$/, ''));
          if (m) dirs.add(m[1]!);
        }
      }
      const sections = [...dirs].map((dir) => {
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
        const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
        if (!file) throw new Error(`No licence file in bundled package ${pkg.name}`);
        return `${pkg.name} ${pkg.version} (${pkg.license ?? 'see below'})\n\n${readFileSync(join(dir, file), 'utf8').trim()}`;
      }).sort();
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES.txt',
        source: `Third-party code bundled into this package\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`,
      });
    },
  };
}

// The published package: one platform-neutral library (index), the Node PNG
// rasterizer (png) and the command (cli), which includes the MCP server.
// HexSketch's own packages and the MCP SDK are bundled in; Node built-ins and
// resvg stay outside.
export default defineConfig({
  plugins: [thirdPartyLicenses()],
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
