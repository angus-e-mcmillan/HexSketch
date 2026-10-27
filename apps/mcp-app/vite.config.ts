import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { thirdPartyLicenses } from '../../tools/build/third-party-licenses.ts';
import { RING_ROWS } from '../../packages/naming/src/rings.ts';

/**
 * The editor as one self-contained HTML file, served as an MCP Apps resource.
 * Chats show it in a sandboxed frame that may load nothing from elsewhere, so
 * the script and styles are written into the page.
 */
function singleFile(): Plugin {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return {
    name: 'single-file',
    enforce: 'post',
    generateBundle(_, bundle) {
      const page = bundle['index.html'];
      if (!page || page.type !== 'asset') throw new Error('single-file: no index.html');
      // The licences of the bundled npm packages travel inside the page ("--" can't appear in a comment).
      const notices = thirdPartyLicenses(bundle).replace(/--/g, '- -');
      let html = String(page.source).replace(/^<!doctype html>/i, (d) => `${d}\n<!--\nHexSketch (c) 2026 Angus McMillan. Business Source License 1.1: https://github.com/angus-e-mcmillan/HexSketch/blob/main/LICENSE\n\n${notices}-->`);
      for (const [file, out] of Object.entries(bundle)) {
        if (out.type === 'chunk') {
          // "</script" inside the code would end the inline script early. With every import inlined, Vite
          // leaves its preload list placeholder unfilled: there is nothing to preload, which undefined says.
          const code = out.code.replace(/<\/script/gi, '<\\/script').replace(/\b__VITE_PRELOAD__\b/g, 'void 0');
          html = html.replace(new RegExp(`<script[^>]*src="[^"]*${escape(file)}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
          delete bundle[file];
        } else if (file.endsWith('.css')) {
          html = html.replace(new RegExp(`<link[^>]*href="[^"]*${escape(file)}"[^>]*>`), () => `<style>${String(out.source)}</style>`);
          delete bundle[file];
        }
      }
      // The ring parents as data, not code, gzipped (a seventh of the size): unpacked once the editor is up (src/rings-later.ts).
      const rings = gzipSync(JSON.stringify(RING_ROWS), { level: 9 }).toString('base64');
      html = html.replace(/<\/body>/i, () => `<script type="application/octet-stream" id="ring-parents">${rings}</script>\n</body>`);
      if (/<script[^>]*\ssrc=|<link[^>]*stylesheet/.test(html)) throw new Error('single-file: something was left outside the page');
      page.source = html;
    },
  };
}

export default defineConfig({
  base: './',
  resolve: { alias: { '@hexsketch/naming/rings': fileURLToPath(new URL('./src/rings-later.ts', import.meta.url)) } },
  plugins: [singleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    assetsInlineLimit: 1e9,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
