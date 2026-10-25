import { initWasm, Resvg } from '@resvg/resvg-wasm';
import wasm from '@resvg/resvg-wasm/index_bg.wasm';
import regular from '../../../packages/hexsketch/fonts/LiberationSans-Regular.ttf';
import bold from '../../../packages/hexsketch/fonts/LiberationSans-Bold.ttf';
import italic from '../../../packages/hexsketch/fonts/LiberationSans-Italic.ttf';
import boldItalic from '../../../packages/hexsketch/fonts/LiberationSans-BoldItalic.ttf';
import type { Rasterizer } from '@hexsketch/agent';

/** PNG in the Worker, as packages/hexsketch/src/png.ts does it in Node: resvg with Liberation Sans, no system fonts. */
const fontBuffers = [regular, bold, italic, boldItalic].map((f) => new Uint8Array(f));
let ready: Promise<void> | null = null;

export const rasterize: Rasterizer = async (svg, scale) => {
  await (ready ??= initWasm(wasm));
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'zoom', value: scale },
    font: { fontBuffers, loadSystemFonts: false, defaultFontFamily: 'Liberation Sans', sansSerifFamily: 'Liberation Sans' },
  });
  return resvg.render().asPng();
};
