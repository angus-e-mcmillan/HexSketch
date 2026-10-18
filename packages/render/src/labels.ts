import type { AtomId, DrawingStyle, Molecule } from '@hexsketch/core';
import { fontMetrics, roundInk } from './fonts.ts';
import type { Rect, Vec } from './geometry.ts';

/** 'unraised' is superscript-sized but sits on the baseline (a stacked charge). */
export type RunKind = 'normal' | 'sub' | 'sup' | 'unraised';

export interface GlyphRun {
  text: string;
  kind: RunKind;
  /** Left edge of the run's first glyph. */
  x: number;
  /** Baseline. */
  y: number;
  size: number;
}

/** Region a bond must stay out of; already inflated by the margin width. */
export type ClipShape =
  | { kind: 'rect'; rect: Rect }
  | { kind: 'superellipse'; cx: number; cy: number; rx: number; ry: number; n: number };

export interface AtomLabel {
  atom: AtomId;
  runs: GlyphRun[];
  clip: ClipShape[];
  bounds: Rect;
}

export type HydrogenSide = 'right' | 'left' | 'above' | 'below';

/*
 * Label metrics, all measured from ChemDraw 20.1's SVG export of a known
 * fixture (house style, Helvetica Bold 11):
 *   baseline sits 0.36 em below the atom centre for every capital;
 *   the clip box for square capitals is the advance width by 0.72 em tall;
 *   subscripts are 0.75 size, dropped 0.23 em;
 *   stacked lines (NH with H below) are separated by 0.12 em of clear space.
 */
const BASELINE_DROP = 0.36;
const CLIP_CAP = 0.72;
const SUB_SCALE = 0.75;
const SUB_DROP = 0.23;
const SUP_SCALE = 0.75;
const SUP_RISE = 0.42;
const LINE_GAP = 0.12;
/** Ink top of a capital, and of a stacked charge sign, for line stepping. */
const CAP_ASCENT = 0.718;
const CHARGE_ASCENT = 0.484;
/** Superellipse exponent fitted to ChemDraw's clipping of diagonal bonds at O. */
const ROUND_EXPONENT = 2.3;

export function needsLabel(mol: Molecule, id: AtomId, style: DrawingStyle): boolean {
  const atom = mol.atom(id);
  if (atom.label !== null) return true;
  if (atom.element !== 'C') return true;
  if (atom.isotope !== null || atom.charge !== 0 || atom.radical !== 0) return true;
  const degree = mol.neighbours(id).length;
  if (degree === 0) return true;
  if (degree === 1 && style.showTerminalCarbonLabels) return true;
  return false;
}

/**
 * Where implicit hydrogens go, following ChemDraw: to the right unless a bond
 * leaves within 60 degrees of horizontal-right, then left unless that side is
 * occupied too, then below, then above.
 */
export function hydrogenSide(mol: Molecule, id: AtomId): HydrogenSide {
  const atom = mol.atom(id);
  const angles = mol.neighbours(id).map((n) => {
    const b = mol.atom(n);
    return Math.atan2(b.y - atom.y, b.x - atom.x);
  });
  if (angles.length === 0) return 'right';
  const occupied = (centre: number, half: number) => angles.some((a) => Math.abs(angleDiff(a, centre)) < half);
  const SIXTY = Math.PI / 3;
  if (!occupied(0, SIXTY)) return 'right';
  if (!occupied(Math.PI, SIXTY)) return 'left';
  if (!occupied(Math.PI / 2, SIXTY)) return 'below'; // screen y grows downward
  if (!occupied(-Math.PI / 2, SIXTY)) return 'above';
  return 'right';
}

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

interface Token { text: string; kind: RunKind }

function chargeText(q: number): string {
  if (q === 0) return '';
  const mag = Math.abs(q) === 1 ? '' : String(Math.abs(q));
  return `${mag}${q > 0 ? '+' : '−'}`;
}

/** Split a nickname like "CO2Me" into runs, subscripting digits. */
function tokenizeNickname(label: string): Token[] {
  return (label.match(/\d+|\D+/g) ?? []).map((part) => ({ text: part, kind: /^\d+$/.test(part) ? 'sub' : 'normal' }));
}

/** Reverse a nickname to read outward when attached from the right: CO2Me -> MeO2C. */
function reverseNickname(tokens: Token[]): Token[] {
  const groups: Token[][] = [];
  for (const t of tokens) {
    if (t.kind === 'sub' && groups.length) groups[groups.length - 1]!.push(t);
    else for (const chunk of t.text.match(/[A-Z][a-z]*|[^A-Z]+/g) ?? [t.text]) groups.push([{ text: chunk, kind: 'normal' }]);
  }
  return groups.reverse().flat();
}

const runSize = (size: number, kind: RunKind) => (kind === 'normal' ? size : size * (kind === 'sub' ? SUB_SCALE : SUP_SCALE));

/**
 * Lay out the label for one atom.
 *
 * The anchor glyph (the element symbol, or the attaching group of a nickname)
 * is centred horizontally on the atom by its advance width, and the baseline
 * sits 0.36 em below the atom centre. Both match ChemDraw to 0.01 pt.
 */
export function layoutLabel(mol: Molecule, id: AtomId, style: DrawingStyle): AtomLabel {
  const atom = mol.atom(id);
  const size = style.labelSize;
  const bold = style.labelBold;
  const metrics = fontMetrics(bold);
  const adv = (ch: string, s: number) => ((metrics.widths[ch] ?? metrics.defaultWidth) * s) / 1000;
  const baseline = atom.y + BASELINE_DROP * size;

  const side = hydrogenSide(mol, id);
  const hCount = style.hideImplicitHydrogens ? 0 : mol.implicitHydrogens(id);

  let main: Token[];
  let anchorIndex = 0;
  if (atom.label !== null) {
    main = tokenizeNickname(atom.label);
    if (side === 'left') {
      main = reverseNickname(main);
      anchorIndex = main.length - 1;
      while (anchorIndex > 0 && main[anchorIndex]!.kind !== 'normal') anchorIndex--;
    }
  } else {
    main = [];
    if (atom.isotope !== null) main.push({ text: String(atom.isotope), kind: 'sup' });
    anchorIndex = main.length;
    main.push({ text: atom.element, kind: 'normal' });
  }

  const hTokens: Token[] = [];
  if (hCount > 0 && atom.label === null) {
    hTokens.push({ text: 'H', kind: 'normal' });
    if (hCount > 1) hTokens.push({ text: String(hCount), kind: 'sub' });
  }
  const chargeTokens: Token[] = atom.charge !== 0 ? [{ text: chargeText(atom.charge), kind: 'sup' }] : [];
  const stacked = side === 'above' || side === 'below';

  // Lines of tokens, first line carries the anchor.
  const lines: Token[][] = [];
  if (side === 'left') {
    lines.push([...hTokens, ...main, ...chargeTokens]);
    anchorIndex += hTokens.length;
  } else if (side === 'right') {
    lines.push([...main, ...hTokens, ...chargeTokens]);
  } else {
    lines.push(main);
    if (hTokens.length) lines.push(hTokens);
    if (chargeTokens.length) {
      // ChemDraw stacks a carbocation as C / H / + ; with no H the charge rides on the symbol.
      if (hTokens.length) lines.push(chargeTokens);
      else lines[0] = [...main, ...chargeTokens];
    }
  }
  if (side === 'above') lines.reverse();

  const runs: GlyphRun[] = [];
  const clip: ClipShape[] = [];
  const m = style.marginWidth;

  const tokenWidth = (t: Token) => [...t.text].reduce((w, ch) => w + adv(ch, runSize(size, t.kind)), 0);

  const placeLine = (tokens: Token[], startX: number, base: number) => {
    let x = startX;
    for (const t of tokens) {
      const s = runSize(size, t.kind);
      const y = t.kind === 'sub' ? base + size * SUB_DROP : t.kind === 'sup' ? base - size * SUP_RISE : base;
      runs.push({ text: t.text, kind: t.kind, x, y, size: s });
      for (const ch of t.text) {
        const a = adv(ch, s);
        const ink = roundInk(ch, bold);
        if (ink) {
          const [ix0, iy0, ix1, iy1] = ink.map((v) => (v * s) / 1000) as [number, number, number, number];
          clip.push({
            kind: 'superellipse',
            cx: x + (ix0 + ix1) / 2, cy: y - (iy0 + iy1) / 2,
            rx: (ix1 - ix0) / 2 + m, ry: (iy1 - iy0) / 2 + m, n: ROUND_EXPONENT,
          });
        } else {
          clip.push({ kind: 'rect', rect: { x0: x - m, y0: y - CLIP_CAP * s - m, x1: x + a + m, y1: y + m } });
        }
        x += a;
      }
    }
  };

  // First line: anchor glyph centred on the atom.
  const first = side === 'above' ? lines[lines.length - 1]! : lines[0]!;
  let before = 0;
  for (let i = 0; i < anchorIndex; i++) before += tokenWidth(first[i]!);
  const anchorGlyph = first[anchorIndex]!.text[0]!;
  const startX = atom.x - adv(anchorGlyph, size) / 2 - before;

  if (!stacked) {
    placeLine(first, startX, baseline);
  } else {
    // Variable line spacing: clear gap of 0.12 em between one line's ink
    // bottom and the next line's cap top. Each extra line is centred on its
    // own first glyph under the symbol, as ChemDraw does.
    const order = side === 'below' ? lines : [...lines].reverse();
    let base = baseline;
    order.forEach((tokens, i) => {
      if (i === 0) { placeLine(tokens, startX, base); return; }
      const prev = order[i - 1]!;
      const prevDescent = prev.some((t) => [...t.text].some((ch) => roundInk(ch, bold))) ? 0.019 * size : 0;
      const isCharge = tokens[0]!.kind === 'sup';
      const ascent = isCharge ? CHARGE_ASCENT * runSize(size, 'sup') : CAP_ASCENT * size;
      const step = prevDescent + LINE_GAP * size + ascent;
      base = side === 'below' ? base + step : base - step;
      // Stacked lines share the first line's left edge (ChemDraw LabelJustification="Left").
      placeLine(isCharge ? tokens.map((t) => ({ ...t, kind: 'unraised' as RunKind })) : tokens, startX, base);
    });
  }

  let bounds: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const c of clip) {
    const r = c.kind === 'rect' ? c.rect : { x0: c.cx - c.rx, y0: c.cy - c.ry, x1: c.cx + c.rx, y1: c.cy + c.ry };
    bounds = { x0: Math.min(bounds.x0, r.x0), y0: Math.min(bounds.y0, r.y0), x1: Math.max(bounds.x1, r.x1), y1: Math.max(bounds.y1, r.y1) };
  }
  return { atom: id, runs, clip, bounds };
}

export function insideClip(shapes: readonly ClipShape[], p: Vec): boolean {
  return shapes.some((s) => insideShape(s, p));
}

function insideShape(s: ClipShape, p: Vec): boolean {
  if (s.kind === 'rect') return p.x >= s.rect.x0 && p.x <= s.rect.x1 && p.y >= s.rect.y0 && p.y <= s.rect.y1;
  return Math.abs((p.x - s.cx) / s.rx) ** s.n + Math.abs((p.y - s.cy) / s.ry) ** s.n <= 1;
}

/**
 * Parameter t in [0,1] at which segment a->b leaves the union of shapes,
 * assuming it starts inside them. Returns 0 if a is outside all shapes.
 */
export function exitParameter(shapes: readonly ClipShape[], a: Vec, b: Vec): number {
  let t = 0;
  for (let guard = 0; guard < 16; guard++) {
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    let advanced = false;
    for (const s of shapes) {
      if (!insideShape(s, p)) continue;
      const e = shapeExit(s, a, b, t);
      if (e > t + 1e-9) { t = e; advanced = true; }
    }
    if (!advanced) break;
  }
  return Math.min(1, t);
}

function shapeExit(s: ClipShape, a: Vec, b: Vec, from: number): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  if (s.kind === 'rect') {
    let tExit = Infinity;
    if (dx !== 0) tExit = Math.min(tExit, Math.max((s.rect.x0 - a.x) / dx, (s.rect.x1 - a.x) / dx));
    if (dy !== 0) tExit = Math.min(tExit, Math.max((s.rect.y0 - a.y) / dy, (s.rect.y1 - a.y) / dy));
    return tExit;
  }
  // Superellipse: bisect for the boundary crossing beyond `from`.
  let lo = from, hi = from;
  const at = (t: number) => ({ x: a.x + dx * t, y: a.y + dy * t });
  while (insideShape(s, at(hi)) && hi < 4) hi += 0.25;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (insideShape(s, at(mid))) lo = mid; else hi = mid;
  }
  return hi;
}
