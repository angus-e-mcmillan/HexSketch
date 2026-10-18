import type { Depiction, Primitive } from './layout.ts';
import { fontFamily } from './fonts.ts';

/**
 * Vector PDF of a depiction, for Word (ChemDraw puts PDF on the Mac
 * pasteboard for the same reason: it stays sharp at any zoom and in print).
 * Labels use the PDF base-14 fonts Helvetica and Helvetica-Bold, so nothing
 * is embedded and files are a few kilobytes.
 */
export function toPdf(dep: Depiction, opts: { padding?: number } = {}): Uint8Array {
  const pad = opts.padding ?? 3;
  const { x0, y0, x1, y1 } = dep.bounds;
  const W = x1 - x0 + 2 * pad, H = y1 - y0 + 2 * pad;
  const X = (x: number) => (x - x0 + pad).toFixed(3);
  const Y = (y: number) => (H - (y - y0 + pad)).toFixed(3);
  const ops: string[] = ['0 g 0 G', '1 J 1 j'.replace('1 J', '0 J')];

  const pathOps = (d: string): string[] => {
    const out: string[] = [];
    for (const m of d.matchAll(/([MLCZ])([^MLCZ]*)/g)) {
      const nums = [...m[2]!.matchAll(/-?[\d.]+(?:e-?\d+)?/g)].map((n) => Number(n[0]));
      const pts: string[] = [];
      for (let i = 0; i + 1 < nums.length; i += 2) pts.push(`${X(nums[i]!)} ${Y(nums[i + 1]!)}`);
      if (m[1] === 'M') out.push(`${pts[0]} m`);
      else if (m[1] === 'L') pts.forEach((p) => out.push(`${p} l`));
      else if (m[1] === 'C') for (let i = 0; i + 2 < pts.length; i += 3) out.push(`${pts[i]} ${pts[i + 1]} ${pts[i + 2]} c`);
      else if (m[1] === 'Z') out.push('h');
    }
    return out;
  };

  const rgb = (h: string) => [1, 3, 5].map((i) => (parseInt(h.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
  // Backgrounds (highlights, ring fills) first, then everything else in order.
  for (const p of dep.primitives) if (p.background) emit(p);
  for (const p of dep.primitives) if (!p.background) emit(p);

  function emit(p: Primitive) {
    const c = p.color ? rgb(p.color) : '0 0 0';
    // Shaded fills have no gradient here: a lighter tint of the colour stands in.
    const fc = p.kind === 'fillPath' && p.shade ? rgb(tint(p.color ?? '#000000')) : c;
    ops.push(`${fc} rg ${c} RG`);
    const dash = 'dash' in p && p.dash ? `[${p.dash.map((d) => d.toFixed(2)).join(' ')}] 0 d` : '[] 0 d';
    const cap = 'cap' in p && p.cap === 'round' ? '1 J' : '0 J';
    switch (p.kind) {
      case 'polygon':
        ops.push(`${X(p.points[0]!.x)} ${Y(p.points[0]!.y)} m`, ...p.points.slice(1).map((q) => `${X(q.x)} ${Y(q.y)} l`), 'h f');
        break;
      case 'fillPath':
        ops.push(...pathOps(p.d), 'f');
        break;
      case 'line':
        ops.push(`${p.width.toFixed(3)} w`, cap, dash, `${X(p.a.x)} ${Y(p.a.y)} m ${X(p.b.x)} ${Y(p.b.y)} l S`, '[] 0 d 0 J');
        break;
      case 'path':
        ops.push(`${p.width.toFixed(3)} w`, cap, dash, ...pathOps(p.d), 'S', '[] 0 d 0 J');
        break;
      case 'circle': {
        const k = 0.5523 * p.r, cx = p.c.x, cy = p.c.y, r = p.r;
        ops.push(`${p.width.toFixed(3)} w`, `${X(cx + r)} ${Y(cy)} m`,
          `${X(cx + r)} ${Y(cy + k)} ${X(cx + k)} ${Y(cy + r)} ${X(cx)} ${Y(cy + r)} c`,
          `${X(cx - k)} ${Y(cy + r)} ${X(cx - r)} ${Y(cy + k)} ${X(cx - r)} ${Y(cy)} c`,
          `${X(cx - r)} ${Y(cy - k)} ${X(cx - k)} ${Y(cy - r)} ${X(cx)} ${Y(cy - r)} c`,
          `${X(cx + k)} ${Y(cy - r)} ${X(cx + r)} ${Y(cy - k)} ${X(cx + r)} ${Y(cy)} c`, 'S');
        break;
      }
      case 'text': {
        const bold = p.caption ? !!p.bold || dep.style.captionFont.toLowerCase().includes('bold') : dep.style.labelBold;
        // Standard 14 fonts: F1-F4 Helvetica, F5-F8 Times, F9-F12 Courier (regular, bold, oblique, bold oblique).
        const fam = fontFamily(p.caption ? p.font ?? dep.style.captionFont : dep.style.labelFont);
        const font = `F${(fam === 'times' ? 5 : fam === 'courier' ? 9 : 1) + (bold ? 1 : 0) + (p.italic ? 2 : 0)}`;
        ops.push(`BT /${font} ${p.run.size.toFixed(3)} Tf ${X(p.run.x)} ${Y(p.run.y)} Td (${pdfString(p.run.text)}) Tj ET`);
        break;
      }
    }
  }

  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W.toFixed(3)} ${H.toFixed(3)}] /Resources << /Font << ${PDF_FONTS.map((_, i) => `/F${i + 1} ${i + 5} 0 R`).join(' ')} >> >> /Contents 4 0 R >>`,
    `<< /Length ${byteLength(content)} >>\nstream\n${content}\nendstream`,
    ...PDF_FONTS.map((name) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`),
  ];
  let out = '%PDF-1.4\n%âãÏÓ\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(byteLength(out)); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return latin1(out);
}

/** Halfway from a colour to white. */
function tint(h: string): string {
  return '#' + [1, 3, 5].map((i) => Math.round((parseInt(h.slice(i, i + 2), 16) + 255) / 2).toString(16).padStart(2, '0')).join('');
}

/** WinAnsi-safe PDF string literal; U+2212 minus becomes an en dash, which reads as a minus. */
function pdfString(s: string): string {
  return s.replace(/−/g, '–').replace(/[\\()]/g, (c) => `\\${c}`)
    .replace(/[^\x20-\x7e -ÿ–]/g, '?').replace(/–/g, '\\226');
}

const byteLength = (s: string) => latin1(s).length;
function latin1(s: string): Uint8Array {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

const PDF_FONTS = [
  'Helvetica', 'Helvetica-Bold', 'Helvetica-Oblique', 'Helvetica-BoldOblique',
  'Times-Roman', 'Times-Bold', 'Times-Italic', 'Times-BoldItalic',
  'Courier', 'Courier-Bold', 'Courier-Oblique', 'Courier-BoldOblique',
];
