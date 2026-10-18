import { altTextFor, decodePayload, payloadFromPng, pngWithPayload, parseSmiles, readCdxmlDocument, readCdxmlStyle, type DocObject, type DrawingStyle, type Molecule, type ObjectGroup } from '@hexsketch/core';

/** What a paste can bring back. */
export interface Pasted { mol: Molecule; style: DrawingStyle; objects: DocObject[]; groups: ObjectGroup[] }
import { depict, toSvg } from '@hexsketch/render';
import { nameMolecule } from '@hexsketch/naming';

/**
 * Clipboard round trip through Word, PowerPoint, Google Docs and Slides.
 *
 * Copy writes a high-resolution PNG plus HTML whose <img> carries the
 * structure in its alt text. Office and Google keep alt text when an image is
 * pasted and when it is copied back out, so pasting that image into HexSketch
 * restores the editable structure.
 */

/** Pixels per point for the PNG: crisp at the doubled paste size, even when printed. */
const PNG_SCALE = 6;
/**
 * Pictures land in documents at twice the drawing's size in points, given as
 * CSS pixels (Word and Google read <img width> as pixels at 96 per inch).
 */
const PASTE_SCALE = 2;

/**
 * Pixel budget for clipboard pictures. A page-sized drawing at 6 px/pt is
 * ~11 Mpx: seconds of work and hundreds of MB, which froze Safari when it was
 * redone after every edit. 3 Mpx keeps a full page at ~3.6 px/pt, still
 * sharp at the doubled paste size; small structures keep the full 6 px/pt.
 */
export const CLIPBOARD_MAX_PIXELS = 3e6;
/** Exports may be larger, but stay under Safari's 16.7 Mpx canvas limit. */
export const EXPORT_MAX_PIXELS = 16e6;

export async function svgToPng(svg: string, scale = PNG_SCALE, maxPixels = CLIPBOARD_MAX_PIXELS): Promise<{ blob: Blob; width: number; height: number }> {
  const m = /width="([\d.]+)pt" height="([\d.]+)pt"/.exec(svg);
  const wPt = m ? Number(m[1]) : 300, hPt = m ? Number(m[2]) : 150;
  scale = Math.max(0.5, Math.min(scale, Math.sqrt(maxPixels / Math.max(1, wPt * hPt))));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(wPt * scale);
  canvas.height = Math.ceil(hPt * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG encode failed'))), 'image/png'));
  return { blob, width: wPt, height: hPt };
}

const blobToBase64 = (b: Blob) => new Promise<string>((res) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1]!);
  r.readAsDataURL(b);
});

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/\n/g, '&#10;');

/** Everything an inserted structure needs: vector, raster, alt text, size. */
export async function structureImage(mol: Molecule, style: DrawingStyle, objects: readonly DocObject[] = [], groups: readonly ObjectGroup[] = []) {
  const svg = toSvg(depict(mol, style, objects), { padding: 3, background: '#fff' });
  const { blob: plain, width, height } = await svgToPng(svg);
  let name: string | null = null;
  try { name = nameMolecule(mol).name; } catch { name = null; }
  const alt = await altTextFor(mol, name, style, objects, groups);
  // The structure travels in the PNG too, in case the alt text is lost on the way back.
  const blob = new Blob([pngWithPayload(new Uint8Array(await plain.arrayBuffer()), alt) as BlobPart], { type: 'image/png' });
  return { svg, png: blob, pngBase64: await blobToBase64(blob), width, height, alt, name };
}

/** The HTML (PNG with the structure in its alt text) and plain text a copy puts on the clipboard. */
export async function clipboardContent(mol: Molecule, style: DrawingStyle, objects: readonly DocObject[] = [], groups: readonly ObjectGroup[] = []) {
  const img = await structureImage(mol, style, objects, groups);
  const html = `<img src="data:image/png;base64,${img.pngBase64}" width="${Math.round(img.width * PASTE_SCALE)}" height="${Math.round(img.height * PASTE_SCALE)}" alt="${escAttr(img.alt)}">`;
  return { html, plain: img.name ?? 'Chemical structure', png: img.png, alt: img.alt };
}

/**
 * Copy with the async Clipboard API. The ClipboardItem is created at once with
 * promises for its contents, which both Chrome and Safari accept even though
 * the image is still being drawn.
 */
export async function copyStructure(mol: Molecule, style: DrawingStyle, objects: readonly DocObject[] = [], groups: readonly ObjectGroup[] = []): Promise<{ png: Blob; alt: string }> {
  const content = clipboardContent(mol, style, objects, groups);
  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': content.then((c) => new Blob([c.html], { type: 'text/html' })),
      'image/png': content.then((c) => c.png),
      'text/plain': content.then((c) => new Blob([c.plain], { type: 'text/plain' })),
    }),
  ]);
  return content;
}

/** What paste handlers read from the clipboard (a DataTransfer, or a snapshot of one). */
export interface ClipboardText { getData(type: string): string }

export async function structureFromClipboard(data: ClipboardText): Promise<Pasted | null> {
  const html = data.getData('text/html');
  const text = data.getData('text/plain');
  for (const source of [html, text]) {
    if (!source) continue;
    // Alt text arrives HTML-escaped; undo the entities that can appear inside the payload marker line.
    const unescaped = source.replace(/&#10;|&#xA;/gi, '\n').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    const p = await decodePayload(unescaped);
    if (p) return p;
  }
  if (text && text.includes('<CDXML')) return { ...readCdxmlDocument(text), style: readCdxmlStyle(text) };
  return null;
}

/** Bytes of a data: URL, or null. */
function dataUrlBytes(url: string): Uint8Array | null {
  const m = /^data:image\/png;base64,(.*)$/i.exec(url.replace(/\s+/g, ''));
  if (!m) return null;
  try {
    const bin = atob(m[1]!);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch { return null; }
}

/**
 * A structure carried inside a pasted PNG: the pictures in pasted HTML
 * (Word includes the original PNG when a picture is copied with its line)
 * and pasted image files (an exported HexSketch PNG, or Google's copy).
 */
export async function structureFromImages(html: string, files: readonly Blob[]): Promise<Pasted | null> {
  const sources: (() => Promise<Uint8Array | null>)[] = [];
  for (const m of html.matchAll(/<img\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)')/gi)) {
    const src = (m[1] ?? m[2] ?? '').replace(/&amp;/g, '&');
    if (src.startsWith('data:')) sources.push(async () => dataUrlBytes(src));
    else if (src.startsWith('blob:')) sources.push(async () => { try { return new Uint8Array(await (await fetch(src)).arrayBuffer()); } catch { return null; } });
  }
  for (const f of files) if (f.type === 'image/png' || f.type === '') sources.push(async () => new Uint8Array(await f.arrayBuffer()));
  for (const read of sources) {
    const bytes = await read();
    const text = bytes && payloadFromPng(bytes);
    const p = text ? await decodePayload(text) : null;
    if (p) return p;
  }
  return null;
}

/** Plain-text SMILES (ChemDraw's Paste Special > SMILES), or null if the text isn't SMILES. */
export function smilesFromClipboard(data: ClipboardText): Molecule | null {
  const text = data.getData('text/plain').trim();
  if (!text || /\s/.test(text) || text.length > 2000) return null;
  try {
    const mol = parseSmiles(text);
    return mol.atomCount ? mol : null;
  } catch {
    return null;
  }
}
