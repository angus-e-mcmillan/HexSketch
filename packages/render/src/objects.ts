import { arcPolyline, captionRuns, curvePolyline, formulaPieces, shapeOutline, type Arrow, type Caption, type DocObject, type DrawingStyle, type Shape } from '@hexsketch/core';
import { textWidth } from './fonts.ts';
import type { Primitive } from './layout.ts';

/*
 * Arrows, drawing elements and captions, measured from ChemDraw 20.1's SVG export:
 *  - full head: length headSize/100 x lw, notch centerSize/100 x lw back from
 *    the tip, half-width width/100 x lw; back edges are concave cubics and the
 *    shaft stops at the notch;
 *  - half head: tip pushed 2 lw past the head point on the shaft's inner edge,
 *    one barb on the outer side;
 *  - equilibrium: two shafts shaftSpacing/100 x lw apart, each half-headed.
 * Arc arrows follow the stored ellipse; the head is aimed along the chord of
 * the last head-length of arc, so it sits on the curve.
 */

type P = { x: number; y: number };
type Owner = { object: number };
const f = (n: number) => Math.round(n * 100) / 100;
const sub = (a: P, b: P) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: P) => Math.hypot(a.x, a.y);
const unit = (a: P) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const pathOf = (pts: P[], close = false) => pts.map((p, i) => `${i ? 'L' : 'M'} ${f(p.x)},${f(p.y)}`).join(' ') + (close ? ' Z' : '');

export function depictObjects(objects: readonly DocObject[], style: DrawingStyle): Primitive[] {
  const out: Primitive[] = [];
  for (const o of objects) {
    const start = out.length;
    if (o.kind === 'arrow') drawArrow(o, style, out);
    else if (o.kind === 'shape') drawShape(o, style, out);
    else drawCaption(o, style, out);
    const color = o.color;
    if (color) for (let i = start; i < out.length; i++) if (!out[i]!.color) out[i]!.color = color;
  }
  return out;
}

/** Walk back along a polyline from its end by `dist`; returns the point and the index of the segment it lies on. */
function backAlong(pts: P[], dist: number): { p: P; i: number } {
  let left = dist;
  for (let i = pts.length - 1; i > 0; i--) {
    const a = pts[i - 1]!, b = pts[i]!, l = len(sub(b, a));
    if (l >= left) { const t = left / (l || 1); return { p: { x: b.x + (a.x - b.x) * t, y: b.y + (a.y - b.y) * t }, i: i - 1 }; }
    left -= l;
  }
  return { p: pts[0]!, i: 0 };
}

/** The polyline with `dist` trimmed off its end. */
function trimEnd(pts: P[], dist: number): P[] {
  if (dist <= 0) return pts;
  const { p, i } = backAlong(pts, dist);
  return [...pts.slice(0, i + 1), p];
}

function drawArrow(a: Arrow, style: DrawingStyle, out: Primitive[]) {
  const lw = style.lineWidth;
  const owner: Owner = { object: a.id };
  const shaftW = a.line === 'bold' ? style.boldWidth : lw;
  const Lh = (a.headSize / 100) * lw, Lc = (a.centerSize / 100) * lw, W = (a.width / 100) * lw;
  const curved = !!(a.arc || a.curve);
  const pts = a.curve ? curvePolyline(a.curve, 48) : a.arc ? arcPolyline(a, 96) : [a.tail, a.head];
  if (len(sub(pts[pts.length - 1]!, pts[0]!)) < 1e-6 && !curved) return;
  // Directions at each end, aimed along the last head-length of path so arc heads sit on the curve.
  const endDir = (path: P[]) => unit(sub(path[path.length - 1]!, backAlong(path, Math.max(Lh, lw)).p));
  const rev = [...pts].reverse();
  const uHead = endDir(pts), uTail = endDir(rev);
  const left = (u: P) => ({ x: u.y, y: -u.x });

  // Retrosynthetic arrow: two shafts and an open chevron.
  if (a.headStyle === 'hollow' && a.shaftSpacing && !curved) {
    const s = ((a.shaftSpacing / 100) * lw) / 2;
    const u = uHead, n = left(u), tip = a.head;
    const A = s + Math.max(W, 1.5 * lw) + lw, Lr = A * 1.15;
    const armL = { x: tip.x - u.x * Lr + n.x * A, y: tip.y - u.y * Lr + n.y * A };
    const armR = { x: tip.x - u.x * Lr - n.x * A, y: tip.y - u.y * Lr - n.y * A };
    out.push({ kind: 'path', d: pathOf([armL, tip, armR]), width: lw, owner, join: 'miter' });
    const back = (Lr * s) / A; // where the shafts meet the arms
    for (const side of [s, -s]) {
      out.push({ kind: 'line', a: { x: a.tail.x + n.x * side, y: a.tail.y + n.y * side }, b: { x: tip.x - u.x * back + n.x * side, y: tip.y - u.y * back + n.y * side }, width: lw, owner });
    }
    return;
  }

  if (a.shaftSpacing && (a.headEnd.startsWith('half') || a.tailEnd.startsWith('half')) && !curved) {
    // Equilibrium: forward shaft on the left, reverse shaft on the right.
    const u = uHead, n = left(u);
    const at = (p: P, along: number, side: number) => ({ x: p.x + u.x * along + n.x * side, y: p.y + u.y * along + n.y * side });
    const s = ((a.shaftSpacing / 100) * lw) / 2;
    const t1 = at(a.tail, 0, s), h1 = at(a.head, 0, s);
    const t2 = at(a.tail, 0, -s), h2 = at(a.head, 0, -s);
    halfHead(h1, u, n, lw, Lh, Lc, W, out, owner);
    shaftLine(t1, at(h1, 2 * lw - Lc, 0), shaftW, a.line, owner, out);
    const back = { x: -u.x, y: -u.y };
    halfHead(t2, back, left(back), lw, Lh, Lc, W, out, owner);
    shaftLine(at(t2, Lc - 2 * lw, 0), h2, shaftW, a.line, owner, out);
    return;
  }

  let path = pts;
  if (a.headEnd !== 'none') path = trimEnd(path, head(a.head, uHead, a.headEnd, a.headStyle, lw, Lh, Lc, W, out, owner));
  if (a.tailEnd !== 'none') path = trimEnd([...path].reverse(), head(a.tail, uTail, a.tailEnd, a.headStyle, lw, Lh, Lc, W, out, owner)).reverse();
  if (curved) {
    out.push({ kind: 'path', d: pathOf(path), width: shaftW, owner, dash: a.line === 'dashed' ? dashFor(lw) : undefined, join: 'round' });
  } else {
    shaftLine(path[0]!, path[path.length - 1]!, shaftW, a.line, owner, out);
  }

  // Decorations at the middle (no-go) and near the tail (dipole).
  const mid = backAlong(pts, polyLength(pts) / 2);
  const uMid = unit(sub(pts[mid.i + 1]!, pts[mid.i]!)), nMid = left(uMid);
  if (a.nogo === 'cross') {
    const r = Math.max(Lh, 4 * lw) * 0.55;
    for (const k of [1, -1]) {
      const d = { x: (uMid.x + k * nMid.x) * r * Math.SQRT1_2, y: (uMid.y + k * nMid.y) * r * Math.SQRT1_2 };
      out.push({ kind: 'line', a: { x: mid.p.x - d.x, y: mid.p.y - d.y }, b: { x: mid.p.x + d.x, y: mid.p.y + d.y }, width: lw, owner });
    }
  } else if (a.nogo === 'hash') {
    const r = Math.max(Lh, 4 * lw) * 0.6, gap = Math.max(Lh, 4 * lw) * 0.25;
    const d = { x: (nMid.x * 0.87 + uMid.x * 0.5) * r, y: (nMid.y * 0.87 + uMid.y * 0.5) * r };
    for (const k of [-1, 1]) {
      const c = { x: mid.p.x + uMid.x * gap * k, y: mid.p.y + uMid.y * gap * k };
      out.push({ kind: 'line', a: { x: c.x - d.x, y: c.y - d.y }, b: { x: c.x + d.x, y: c.y + d.y }, width: lw, owner });
    }
  }
  if (a.dipole) {
    const at = backAlong(rev, Math.min(polyLength(pts) * 0.25, Math.max(Lh, 6 * lw)));
    const u = unit(sub(rev[at.i]!, rev[at.i + 1]!)), n = left(u), h = Math.max(W, 2 * lw);
    out.push({ kind: 'line', a: { x: at.p.x + n.x * h, y: at.p.y + n.y * h }, b: { x: at.p.x - n.x * h, y: at.p.y - n.y * h }, width: lw, owner });
  }
}

const polyLength = (pts: P[]) => pts.slice(1).reduce((s, p, i) => s + len(sub(p, pts[i]!)), 0);
const dashFor = (lw: number) => [3 * lw, 2 * lw];

function shaftLine(from: P, to: P, width: number, line: Arrow['line'], owner: Owner, out: Primitive[]) {
  if (line === 'dashed') { out.push({ kind: 'line', a: from, b: to, width, owner, dash: dashFor(width) }); return; }
  const u = unit(sub(to, from)), h = width / 2, n = { x: u.y * h, y: -u.x * h };
  out.push({ kind: 'polygon', points: [{ x: from.x + n.x, y: from.y + n.y }, { x: to.x + n.x, y: to.y + n.y }, { x: to.x - n.x, y: to.y - n.y }, { x: from.x - n.x, y: from.y - n.y }], owner });
}

/** Draw a head at `tip` pointing along `u`; returns how far back the shaft should stop. */
function head(tip: P, u: P, end: Arrow['headEnd'], styleOf: Arrow['headStyle'], lw: number, Lh: number, Lc: number, W: number, out: Primitive[], owner: Owner): number {
  const left = { x: u.y, y: -u.x };
  if (end === 'full') {
    const p = (along: number, side: number) => ({ x: tip.x - u.x * along + left.x * side, y: tip.y - u.y * along + left.y * side });
    const cA = p(Lh, W), cB = p(Lh, -W), notch = p(Lc, 0);
    if (styleOf === 'angled') {
      out.push({ kind: 'path', d: pathOf([cA, tip, cB]), width: lw, owner, join: 'miter' });
      return lw / 2;
    }
    const k = 0.438 * W; // measured: control point 0.44 W off the axis at the notch
    const d = `M ${f(tip.x)},${f(tip.y)} L ${f(cA.x)},${f(cA.y)} C ${f(cA.x)},${f(cA.y)} ${f(notch.x + left.x * k)},${f(notch.y + left.y * k)} ${f(notch.x)},${f(notch.y)} `
      + `C ${f(notch.x - left.x * k)},${f(notch.y - left.y * k)} ${f(cB.x)},${f(cB.y)} ${f(cB.x)},${f(cB.y)} Z`;
    if (styleOf === 'hollow') out.push({ kind: 'path', d, width: lw, owner, join: 'miter' });
    else out.push({ kind: 'fillPath', d, owner });
    return Lc;
  }
  if (end === 'halfLeft' || end === 'halfRight') {
    halfHead(tip, u, end === 'halfLeft' ? left : { x: -left.x, y: -left.y }, lw, Lh, Lc, W, out, owner, 0);
    return Lc;
  }
  return 0;
}

/** One-sided head; returns its tip. `push` is how far the tip sits past `head` (2 lw in equilibria). */
function halfHead(head: P, u: P, outSide: P, lw: number, Lh: number, Lc: number, W: number, out: Primitive[], owner: Owner, push = 2 * lw): P {
  // Tip on the shaft's inner edge.
  const tip = { x: head.x + u.x * push - outSide.x * lw / 2, y: head.y + u.y * push - outSide.y * lw / 2 };
  const notch = { x: tip.x - u.x * Lc, y: tip.y - u.y * Lc };
  const barbOff = W + lw * 0.065; // measured: barb 4.69 pt out from the inner edge at lw 1.53
  const barb = { x: tip.x - u.x * Lh + outSide.x * (barbOff + lw / 2), y: tip.y - u.y * Lh + outSide.y * (barbOff + lw / 2) };
  const ctrl = { x: notch.x + outSide.x * 0.53 * (barbOff + lw / 2), y: notch.y + outSide.y * 0.53 * (barbOff + lw / 2) };
  const d = `M ${f(tip.x)},${f(tip.y)} L ${f(notch.x)},${f(notch.y)} C ${f(ctrl.x)},${f(ctrl.y)} ${f(barb.x)},${f(barb.y)} ${f(barb.x)},${f(barb.y)} Z`;
  out.push({ kind: 'fillPath', d, owner });
  return tip;
}

/** Drawing elements: outline (plain, dashed, bold, wavy), fill (solid or shaded) and an optional drop shadow. */
function drawShape(o: Shape, style: DrawingStyle, out: Primitive[]) {
  const lw = style.lineWidth;
  const owner: Owner = { object: o.id };
  const width = o.line === 'bold' ? style.boldWidth : lw;
  let pts = shapeOutline(o, 96);
  if (o.shape === 'roundRect') pts = roundCorners(pts, Math.min(6 * lw, ...pts.map((p, i) => len(sub(p, pts[(i + 1) % pts.length]!)) / 2)));
  if (o.shape === 'line') {
    if (o.line === 'wavy') out.push({ kind: 'path', d: wavyPath(pts[0]!, pts[1]!, lw), width: lw, owner });
    else out.push({ kind: 'line', a: pts[0]!, b: pts[1]!, width, owner, dash: o.line === 'dashed' ? dashFor(lw) : undefined });
    return;
  }
  const d = pathOf(pts, true);
  if (o.shadow) {
    const k = 4 * lw;
    out.push({ kind: 'fillPath', d: pathOf(pts.map((p) => ({ x: p.x + k, y: p.y + k })), true), owner, color: '#000000' });
  }
  if (o.fill === 'filled') out.push({ kind: 'fillPath', d, owner });
  else if (o.fill === 'shaded') out.push({ kind: 'fillPath', d, owner, shade: true });
  else if (o.shadow) out.push({ kind: 'fillPath', d, owner, color: '#ffffff' });
  if (o.fill !== 'filled') out.push({ kind: 'path', d, width, owner, dash: o.line === 'dashed' ? dashFor(lw) : undefined, join: 'miter' });
}

function roundCorners(pts: P[], r: number): P[] {
  const out: P[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i + pts.length - 1) % pts.length]!, c = pts[i]!, next = pts[(i + 1) % pts.length]!;
    const a = unit(sub(prev, c)), b = unit(sub(next, c));
    const p0 = { x: c.x + a.x * r, y: c.y + a.y * r }, p1 = { x: c.x + b.x * r, y: c.y + b.y * r };
    for (let k = 0; k <= 6; k++) {
      const t = k / 6, s = 1 - t;
      // Quadratic Bezier with the corner as control point.
      out.push({ x: s * s * p0.x + 2 * s * t * c.x + t * t * p1.x, y: s * s * p0.y + 2 * s * t * c.y + t * t * p1.y });
    }
  }
  return out;
}

/** Semicircle waves along a line, like a wavy bond. */
function wavyPath(a: P, b: P, lw: number): string {
  const L = len(sub(b, a)), u = unit(sub(b, a)), n = { x: u.y, y: -u.x };
  const count = Math.max(1, Math.round(L / (2.25 + lw)));
  const step = L / count;
  let d = `M ${f(a.x)},${f(a.y)}`;
  for (let i = 0; i < count; i++) {
    const s = i % 2 ? -1 : 1;
    const p0 = { x: a.x + u.x * step * i, y: a.y + u.y * step * i };
    const p1 = { x: p0.x + u.x * step, y: p0.y + u.y * step };
    const k = 0.667 * step;
    d += ` C ${f(p0.x + n.x * k * s)},${f(p0.y + n.y * k * s)} ${f(p1.x + n.x * k * s)},${f(p1.y + n.y * k * s)} ${f(p1.x)},${f(p1.y)}`;
  }
  return d;
}

/** One positioned piece of caption text. */
export interface CaptionPiece {
  text: string; x: number; y: number; size: number; width: number;
  bold: boolean; italic: boolean; underline: boolean; color: string | null;
  kind: 'normal' | 'sub' | 'sup';
  /** The run's own font, if it has one (else the document caption font). */
  font?: string;
}

const SCRIPT_SCALE = 0.75, SUB_DROP = 0.23, SUP_RISE = 0.42; // as for atom labels (measured from ChemDraw)

/**
 * Lay a caption out: lines split at \n, each run in its own size and style,
 * Formula runs split into subscripts and raised charges, lines aligned on the
 * anchor (left edge, centre or right edge, as CDXML's Justification).
 */
export function layoutCaption(c: Caption, style: DrawingStyle): { pieces: CaptionPiece[]; lines: { x0: number; x1: number; top: number; bottom: number }[] } {
  const base = style.captionSize;
  const lines: Omit<CaptionPiece, 'x' | 'y'>[][] = [[]];
  for (const run of captionRuns(c)) {
    const size = run.size ?? base;
    const parts = run.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (!part) return;
      const pieces = run.script === 'formula' ? formulaPieces(part)
        : [{ text: part, kind: run.script === 'sub' ? 'sub' as const : run.script === 'sup' ? 'sup' as const : 'normal' as const }];
      for (const p of pieces) {
        const sz = p.kind === 'normal' ? size : size * SCRIPT_SCALE;
        lines[lines.length - 1]!.push({
          text: p.text, size: sz, width: textWidth(p.text, sz, !!run.bold, run.font ?? style.captionFont), kind: p.kind,
          bold: !!run.bold, italic: !!run.italic, underline: !!run.underline, color: run.color ?? null,
          ...(run.font ? { font: run.font } : {}),
        });
      }
    });
  }
  const pieces: CaptionPiece[] = [];
  const boxes: { x0: number; x1: number; top: number; bottom: number }[] = [];
  let y = c.y;
  lines.forEach((line, i) => {
    const lineSize = Math.max(base, ...line.map((p) => (p.kind === 'normal' ? p.size : p.size / SCRIPT_SCALE)));
    if (i > 0) y += lineSize * 1.2;
    const w = line.reduce((s, p) => s + p.width, 0);
    let x = c.align === 'center' ? c.x - w / 2 : c.align === 'right' ? c.x - w : c.x;
    boxes.push({ x0: x, x1: x + Math.max(w, base * 0.5), top: y - lineSize * 0.75, bottom: y + lineSize * 0.25 });
    for (const p of line) {
      const full = p.kind === 'normal' ? p.size : p.size / SCRIPT_SCALE;
      const py = p.kind === 'sub' ? y + full * SUB_DROP : p.kind === 'sup' ? y - full * SUP_RISE : y;
      pieces.push({ ...p, x, y: py });
      x += p.width;
    }
  });
  return { pieces, lines: boxes };
}

function drawCaption(c: Caption, style: DrawingStyle, out: Primitive[]) {
  const owner = { object: c.id };
  for (const p of layoutCaption(c, style).pieces) {
    out.push({
      kind: 'text',
      run: { text: p.text, kind: p.kind, x: p.x, y: p.y, size: p.size },
      owner, caption: true, bold: p.bold, italic: p.italic,
      ...(p.font ? { font: p.font } : {}),
      ...(p.color ? { color: p.color } : {}),
    });
    if (p.underline) {
      const uy = p.y + p.size * 0.12;
      out.push({ kind: 'line', a: { x: p.x, y: uy }, b: { x: p.x + p.width, y: uy }, width: Math.max(0.5, p.size * 0.06), owner, ...(p.color ? { color: p.color } : {}) });
    }
  }
}

/** Bounding box of a caption, for hit-testing and selection. */
export function captionBounds(c: Caption, style: DrawingStyle) {
  const { lines } = layoutCaption(c, style);
  return {
    x0: Math.min(...lines.map((l) => l.x0)) - 1, y0: Math.min(...lines.map((l) => l.top)),
    x1: Math.max(...lines.map((l) => l.x1)) + 1, y1: Math.max(...lines.map((l) => l.bottom)),
  };
}
