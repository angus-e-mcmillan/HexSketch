import type { Depiction, Primitive } from './layout.ts';
import { fontFamily } from './fonts.ts';

export interface SvgOptions {
  /** Extra space around the drawing, points. */
  padding?: number;
  /** Output scale; 1 means 1 SVG unit per point. */
  scale?: number;
  color?: string;
  background?: string | null;
  /** Extra XML inserted inside <metadata>, e.g. embedded CDXML for round-trips. */
  metadata?: string;
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function toSvg(dep: Depiction, opts: SvgOptions = {}): string {
  const pad = opts.padding ?? 4;
  const k = opts.scale ?? 1;
  const color = opts.color ?? '#000';
  const { x0, y0, x1, y1 } = dep.bounds;
  const vx = x0 - pad, vy = y0 - pad, vw = x1 - x0 + 2 * pad, vh = y1 - y0 + 2 * pad;
  const font = `${dep.style.labelFont}, Helvetica, Arial, sans-serif`;
  const weight = dep.style.labelBold ? 'bold' : 'normal';

  const body: string[] = [];
  if (opts.background) body.push(`<rect x="${f(vx)}" y="${f(vy)}" width="${f(vw)}" height="${f(vh)}" fill="${opts.background}"/>`);

  const strokes: string[] = [];
  const fills: string[] = [];
  const texts: string[] = [];
  const captions: string[] = [];
  const back: string[] = [];
  const defs: string[] = [];
  for (const p of dep.primitives) {
    if (p.background) {
      // Highlights and ring fills: painted first, each in its own colour.
      const one: string[] = [];
      emit(p, one, one, one, defs);
      back.push(...one);
    } else emit(p, strokes, fills, p.kind === 'text' && p.caption ? captions : texts, defs);
  }
  if (defs.length) body.push(`<defs>${defs.join('')}</defs>`);
  if (back.length) body.push(`<g stroke-linecap="round">${back.join('')}</g>`);

  body.push(`<g stroke="${color}" stroke-linecap="butt" fill="none">${strokes.join('')}</g>`);
  body.push(`<g fill="${color}">${fills.join('')}</g>`);
  body.push(`<g fill="${color}" font-family="${escapeXml(font)}" font-weight="${weight}">${texts.join('')}</g>`);
  if (captions.length) body.push(`<g fill="${color}" font-family="${escapeXml(fontStack(dep.style.captionFont))}" font-weight="normal" xml:space="preserve">${captions.join('')}</g>`);

  const meta = opts.metadata ? `<metadata>${opts.metadata}</metadata>` : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" ` +
    `width="${f(vw * k)}pt" height="${f(vh * k)}pt" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}">` +
    meta + body.join('') + `</svg>`
  );
}

let gradientCount = 0;

function emit(p: Primitive, strokes: string[], fills: string[], texts: string[], defs: string[]) {
  const stroke = p.color ? ` stroke="${p.color}"` : '';
  const fill = p.color ? ` fill="${p.color}"` : '';
  const dash = 'dash' in p && p.dash ? ` stroke-dasharray="${p.dash.map(f).join(' ')}"` : '';
  const cap = 'cap' in p && p.cap ? ` stroke-linecap="${p.cap}"` : '';
  const join = 'join' in p && p.join ? ` stroke-linejoin="${p.join}"` : '';
  switch (p.kind) {
    case 'line':
      strokes.push(`<line x1="${f(p.a.x)}" y1="${f(p.a.y)}" x2="${f(p.b.x)}" y2="${f(p.b.y)}" stroke-width="${f(p.width)}"${stroke}${dash}${cap}/>`);
      break;
    case 'path':
      strokes.push(`<path d="${p.d}" stroke-width="${f(p.width)}"${stroke}${dash}${cap}${join}/>`);
      break;
    case 'circle':
      strokes.push(`<circle cx="${f(p.c.x)}" cy="${f(p.c.y)}" r="${f(p.r)}" stroke-width="${f(p.width)}"${stroke}/>`);
      break;
    case 'polygon':
      fills.push(`<polygon points="${p.points.map((q) => `${f(q.x)},${f(q.y)}`).join(' ')}"${fill}/>`);
      break;
    case 'fillPath':
      if (p.shade) {
        // ChemDraw's "Shaded" fill: a highlight toward the upper left fading to the colour.
        const id = `dcShade${++gradientCount}`;
        defs.push(`<radialGradient id="${id}" cx="0.35" cy="0.3" r="0.75"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="${p.color ?? '#000000'}"/></radialGradient>`);
        fills.push(`<path d="${p.d}" fill="url(#${id})"/>`);
      } else fills.push(`<path d="${p.d}"${fill}/>`);
      break;
    case 'text':
      texts.push(`<text x="${f(p.run.x)}" y="${f(p.run.y)}" font-size="${f(p.run.size)}"${p.font ? ` font-family="${escapeXml(fontStack(p.font))}"` : ''}${fill}${p.bold ? ' font-weight="bold"' : ''}${p.italic ? ' font-style="italic"' : ''}>${escapeXml(p.run.text)}</text>`);
      break;
  }
}

/** A CSS font stack for a caption font, falling back within its family. */
function fontStack(font: string): string {
  const fam = fontFamily(font);
  return fam === 'times' ? `${font}, Times New Roman, Times, serif` : fam === 'courier' ? `${font}, Courier New, Courier, monospace` : `${font}, Helvetica, Arial, sans-serif`;
}
