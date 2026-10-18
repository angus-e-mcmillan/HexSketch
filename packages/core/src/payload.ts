import { readCdxmlDocument, readCdxmlStyle, writeCdxml } from './cdxml.ts';
import type { DocObject, ObjectGroup } from './objects.ts';
import type { Molecule } from './model.ts';
import { DEFAULT_STYLE, type DrawingStyle } from './style.ts';

/**
 * Editable-structure payload carried in an image's alt text, so a drawing
 * pasted into Word, PowerPoint, Google Docs or Slides can come back into
 * HexSketch for editing. The structure travels as ChemDraw-compatible CDXML,
 * deflated and base64url-encoded behind a versioned marker:
 *
 *   <chemical name>
 *
 *   HexSketch:1:<base64url(deflate-raw(CDXML))>
 *
 * The name comes first so screen readers announce something meaningful.
 */
export const PAYLOAD_MARKER = 'HexSketch:1:';
/** Markers written before the rename, still read. */
export const PAYLOAD_MARKERS = [PAYLOAD_MARKER, 'DrawChem:1:'] as const;

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Blob([new Uint8Array(data)]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Word silently empties a picture's alt text when it contains "www", "http"
 * or "cid" in any case (found on Word 16 for Mac; it seems to
 * take such text for an image link). Base64 can produce these by chance, and
 * every "...ic acid" name contains "cid". `sep` is slipped in to break each
 * run: "~" in the payload (never part of base64url; the decoder drops it), an
 * invisible word joiner in the readable name.
 */
export function breakLinkLikeRuns(s: string, sep = '~'): string {
  let out = '';
  for (const c of s) {
    // The separator itself breaks a run, so look back only over what is already written.
    const tail = (out.slice(-3) + c).toLowerCase();
    if (tail.endsWith('www') || tail === 'http' || tail.endsWith('cid')) out += sep;
    out += c;
  }
  return out;
}

const WORD_JOINER = '\u2060';

export async function encodePayload(mol: Molecule, style: DrawingStyle = DEFAULT_STYLE, objects: readonly DocObject[] = [], groups: readonly ObjectGroup[] = []): Promise<string> {
  const xml = new TextEncoder().encode(writeCdxml(mol, style, objects, { groups }));
  return PAYLOAD_MARKER + breakLinkLikeRuns(toBase64Url(await pipe(xml, new CompressionStream('deflate-raw'))));
}

/** Alt text for an inserted structure: readable name, then the payload. */
export async function altTextFor(mol: Molecule, name: string | null, style: DrawingStyle = DEFAULT_STYLE, objects: readonly DocObject[] = [], groups: readonly ObjectGroup[] = []): Promise<string> {
  return `${breakLinkLikeRuns(name ?? 'Chemical structure', WORD_JOINER)}\n\n${await encodePayload(mol, style, objects, groups)}`;
}

/** Find and decode a payload anywhere in a string (alt text, HTML, plain text). */
export async function decodePayload(text: string): Promise<{ mol: Molecule; style: DrawingStyle; objects: DocObject[]; groups: ObjectGroup[]; cdxml: string } | null> {
  const marker = PAYLOAD_MARKERS.find((k) => text.includes(k));
  if (!marker) return null;
  const m = /^[A-Za-z0-9_~-]+/.exec(text.slice(text.indexOf(marker) + marker.length));
  if (!m) return null;
  try {
    const bytes = await pipe(fromBase64Url(m[0].replace(/~/g, '')), new DecompressionStream('deflate-raw'));
    const cdxml = new TextDecoder().decode(bytes);
    const doc = readCdxmlDocument(cdxml);
    return { ...doc, style: readCdxmlStyle(cdxml), cdxml };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------- PNG carrier

/**
 * The payload also rides inside the PNG itself, as a tEXt chunk with keyword
 * "HexSketch". Word keeps the original PNG bytes in the HTML it copies (when
 * the picture is copied with its line), so the structure survives even where
 * a browser drops the alt text, and exported PNGs reopen as editable drawings.
 */
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const PNG_KEYWORD = 'HexSketch';
/** Keywords read: the current one and the one written before the rename. */
const PNG_KEYWORDS = [PNG_KEYWORD, 'DrawChem'];

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const isPng = (b: Uint8Array) => b.length > 8 && PNG_SIGNATURE.every((v, i) => b[i] === v);

/** The PNG with `text` stored in a tEXt chunk just before its image data. */
export function pngWithPayload(png: Uint8Array, text: string): Uint8Array {
  if (!isPng(png)) return png;
  const body = new TextEncoder().encode(`${PNG_KEYWORD}\0${text}`);
  const chunk = new Uint8Array(12 + body.length);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  chunk.set(new TextEncoder().encode('tEXt'), 4);
  chunk.set(body, 8);
  view.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
  // After IHDR (always the first chunk: 8 + 25 bytes).
  const at = 33;
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at));
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}

/** The HexSketch text stored in a PNG, or null. */
export function payloadFromPng(png: Uint8Array): string | null {
  if (!isPng(png)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let p = 8;
  while (p + 12 <= png.length) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(...png.subarray(p + 4, p + 8));
    if (type === 'IEND' || p + 12 + len > png.length) break;
    if (type === 'tEXt') {
      const data = png.subarray(p + 8, p + 8 + len);
      const zero = data.indexOf(0);
      if (zero > 0 && PNG_KEYWORDS.includes(new TextDecoder().decode(data.subarray(0, zero)))) return new TextDecoder().decode(data.subarray(zero + 1));
    }
    p += 12 + len;
  }
  return null;
}
