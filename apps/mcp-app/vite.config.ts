import { defineConfig, type Plugin } from 'vite';
import { thirdPartyLicenses } from '../../tools/build/third-party-licenses.ts';

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
          // "</script" inside the code would end the inline script early.
          const code = out.code.replace(/<\/script/gi, '<\\/script');
          html = html.replace(new RegExp(`<script[^>]*src="[^"]*${escape(file)}"[^>]*></script>`), () => `<script type="module">${code}</script>`);
          delete bundle[file];
        } else if (file.endsWith('.css')) {
          html = html.replace(new RegExp(`<link[^>]*href="[^"]*${escape(file)}"[^>]*>`), () => `<style>${String(out.source)}</style>`);
          delete bundle[file];
        }
      }
      if (/<script[^>]*\ssrc=|<link[^>]*stylesheet/.test(html)) throw new Error('single-file: something was left outside the page');
      page.source = html;
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [singleFile()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    modulePreload: false,
    assetsInlineLimit: 1e9,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
