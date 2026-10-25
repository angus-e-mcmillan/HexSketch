import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initWasm, Resvg } from '@resvg/resvg-wasm';
import type { Rasterizer } from '@hexsketch/agent';

/**
 * PNG for Node: resvg (WebAssembly) with Liberation Sans, which has
 * Helvetica's and Arial's metrics, so labels sit where HexSketch measured
 * them. No system fonts are read, so a PNG comes out the same on every machine.
 */

const FACES = ['Regular', 'Bold', 'Italic', 'BoldItalic'];
let fonts: Promise<Uint8Array[]> | null = null;

function load(): Promise<Uint8Array[]> {
  fonts ??= (async () => {
    await initWasm(readFileSync(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')));
    // Next to dist/ (or src/): the package's fonts folder.
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fonts');
    return FACES.map((f) => new Uint8Array(readFileSync(join(dir, `LiberationSans-${f}.ttf`))));
  })();
  return fonts;
}

/** SVG to PNG at `scale` pixels per point. */
export const rasterize: Rasterizer = async (svg, scale) => {
  const fontBuffers = await load();
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Liberation Sans', sansSerifFamily: 'Liberation Sans' },
  });
  return resvg.render().asPng();
};
