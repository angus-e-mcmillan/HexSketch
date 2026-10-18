/**
 * Recognising your own pictures when they come back without their data.
 *
 * A picture copied on its own in Word reaches a web page only as an image
 * Word has re-drawn: the structure in its alt text stays in Word's private
 * clipboard format. So each time HexSketch copies a structure, it keeps a small
 * greyscale thumbnail of the picture with the structure's data, in this
 * browser only (localStorage, never sent anywhere). A bare picture pasted
 * back is matched against those thumbnails, whatever size Word drew it at.
 */
const KEY = 'hexsketch.recentCopies';
const MAX = 40;
/** Thumbnail width in pixels; height follows the picture's aspect ratio. */
const W = 128;

interface Entry { w: number; h: number; px: string; payload: string; t: number }

/** The drawn part of an image (white margins trimmed), on a working canvas at most 800 px wide. */
async function ink(blob: Blob): Promise<{ canvas: OffscreenCanvas; x: number; y: number; w: number; h: number } | null> {
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(blob); } catch { return null; }
  const k = Math.min(1, 800 / bmp.width, 800 / bmp.height);
  const cw = Math.max(1, Math.round(bmp.width * k)), ch = Math.max(1, Math.round(bmp.height * k));
  const canvas = new OffscreenCanvas(cw, ch);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, cw, ch);
  ctx.drawImage(bmp, 0, 0, cw, ch);
  bmp.close();
  const data = ctx.getImageData(0, 0, cw, ch).data;
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const i = (y * cw + x) * 4;
    if (data[i]! + data[i + 1]! + data[i + 2]! < 3 * 235) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < x0 || y1 < y0 ? null : { canvas, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Greyscale pixels of the drawn part scaled to `w` wide (height by aspect ratio) or to `w` x `h`. */
function sample(src: NonNullable<Awaited<ReturnType<typeof ink>>>, size?: { w: number; h: number }): { w: number; h: number; px: Uint8Array } {
  const tw = size?.w ?? W, th = size?.h ?? Math.max(4, Math.min(4 * W, Math.round((W * src.h) / src.w)));
  const t = new OffscreenCanvas(tw, th);
  const tctx = t.getContext('2d', { willReadFrequently: true })!;
  tctx.fillStyle = '#fff';
  tctx.fillRect(0, 0, tw, th);
  tctx.imageSmoothingQuality = 'high';
  tctx.drawImage(src.canvas, src.x, src.y, src.w, src.h, 0, 0, tw, th);
  const td = tctx.getImageData(0, 0, tw, th).data;
  const px = new Uint8Array(tw * th);
  for (let i = 0; i < px.length; i++) px[i] = Math.round((td[i * 4]! + td[i * 4 + 1]! + td[i * 4 + 2]!) / 3);
  return { w: tw, h: th, px };
}

const toB64 = (a: Uint8Array) => { let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function load(): Entry[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem('drawchem.recentCopies') ?? '[]') as Entry[]; } catch { return []; }
}

/** Remember a picture HexSketch just put on the clipboard, with the structure it shows. */
export async function rememberCopy(png: Blob, payload: string): Promise<void> {
  const drawn = await ink(png);
  if (!drawn) return;
  const th = sample(drawn);
  const entries = load().filter((e) => e.payload !== payload);
  entries.unshift({ w: th.w, h: th.h, px: toB64(th.px), payload, t: Date.now() });
  // Drop the oldest until it fits (localStorage holds a few MB).
  for (let n = Math.min(entries.length, MAX); n > 0; n--) {
    try { localStorage.setItem(KEY, JSON.stringify(entries.slice(0, n))); return; } catch { /* too big: keep fewer */ }
  }
}

/**
 * The structure data of a remembered picture that matches this image, or
 * null. Ink-weighted difference: a changed label or bond counts, the white
 * page around it does not. A match must be clearly better than the runner-up.
 */
export async function recallCopy(image: Blob): Promise<string | null> {
  const scored = await matchScores(image);
  const best = scored[0], next = scored[1];
  if (!best || best.score > MATCH_MAX) return null;
  if (next && next.score - best.score < MATCH_MARGIN) return null;
  return best.payload;
}

/** Below this ink-weighted difference a picture counts as the same drawing... */
const MATCH_MAX = 0.35;
/** ...and the best match must beat the runner-up by this much. */
const MATCH_MARGIN = 0.05;

/** Every remembered picture of a compatible shape, best match first. */
export async function matchScores(image: Blob): Promise<{ payload: string; score: number }[]> {
  const entries = load();
  if (!entries.length) return [];
  const drawn = await ink(image);
  if (!drawn) return [];
  const probe = sample(drawn);
  const aspect = probe.h / probe.w;
  const scored: { payload: string; score: number }[] = [];
  for (const e of entries) {
    if (Math.abs(e.h / e.w - aspect) > 0.06 * aspect + 2 / e.w) continue;
    const p = sample(drawn, { w: e.w, h: e.h });
    const ref = fromB64(e.px);
    let diff = 0, ink = 0;
    for (let i = 0; i < ref.length; i++) {
      const a = 255 - ref[i]!, b = 255 - p.px[i]!;
      diff += Math.abs(a - b);
      ink += Math.max(a, b);
    }
    scored.push({ payload: e.payload, score: ink ? diff / ink : 1 });
  }
  return scored.sort((a, b) => a.score - b.score);
}
