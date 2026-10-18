/**
 * Arrows and drawing elements: drawing them with a tool, and their
 * adjustment handles, following ChemDraw's help ("Objects"): hovering an
 * arrow shows handles at its tail, head and middle; dragging the middle bends
 * a straight arrow into an arc (and re-bends an arc) with its ends fixed;
 * dragging an arc arrow's head or tail slides it round the same circle, so
 * the arc grows or shrinks without changing shape. Circles have a radius
 * handle, ovals one per axis, rectangles corner and edge handles, lines one
 * at each end.
 */
import {
  arcParam, arcParams, arcPoint, arcSense, arcThroughThree, bezierPoint, curlyControls, makeArcArrow, makeArrow, makeCurlyArrow, makeShape,
  type Arrow, type ArrowEnd, type ArrowKind, type DocObject, type Shape,
} from '@hexsketch/core';
import { snapAngle } from './placement.ts';

type Pt = { x: number; y: number };

/** What the arrow and drawing-element tools draw. */
export type ArrowTool = { kind: 'arrow'; arrow: ArrowKind; arc?: number; heads?: { head?: ArrowEnd; tail?: ArrowEnd }; curly?: boolean };
export type ShapeTool = { kind: 'shape'; shape: Shape['shape']; fill?: Shape['fill']; line?: Shape['line']; shadow?: boolean };

export type HandleName = 'tail' | 'head' | 'mid' | 'radius' | 'major' | 'minor' | 'corner' | 'from' | 'to' | 'c1' | 'c2';
export interface Handle { name: HandleName; p: Pt }

const DEG = Math.PI / 180;
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (v: Pt) => { const l = Math.hypot(v.x, v.y) || 1; return { x: v.x / l, y: v.y / l }; };

/** Build the object a drag (or, when start and end coincide, a click) with this tool makes. */
export function objectFromDrag(tool: ArrowTool | ShapeTool, x0: number, y0: number, x: number, y: number, L: number, fixedAngles = true): DocObject {
  const dragged = Math.hypot(x - x0, y - y0) >= 3;
  if (tool.kind === 'arrow') {
    if (tool.curly) {
      // Electron pushing: a curly arrow bowing to the left of travel (as ChemDraw draws it).
      const head = dragged ? { x, y } : { x: x0 + 2 * L, y: y0 };
      return makeCurlyArrow({ x: x0, y: y0 }, head, tool.arrow === 'radical' ? 'radical' : 'electron');
    }
    if (tool.arc !== undefined) {
      // Arc tools: the drag is the chord, the tool sets the sweep.
      const head = dragged ? { x, y } : { x: x0 + 3 * L, y: y0 };
      return makeArcArrow({ x: x0, y: y0 }, head, tool.arc, tool.heads);
    }
    const a = fixedAngles ? snapAngle(Math.atan2(y - y0, x - x0)) : Math.atan2(y - y0, x - x0);
    const len = dragged ? Math.max(L, Math.hypot(x - x0, y - y0)) : 3 * L;
    const ang = dragged ? a : 0;
    const arrow = makeArrow({ x: x0, y: y0 }, { x: x0 + len * Math.cos(ang), y: y0 + len * Math.sin(ang) }, tool.arrow);
    if (tool.heads?.head) arrow.headEnd = tool.heads.head;
    if (tool.heads?.tail) arrow.tailEnd = tool.heads.tail;
    return arrow;
  }
  const opts = { fill: tool.fill, line: tool.line, shadow: tool.shadow };
  const c = { x: x0, y: y0 };
  switch (tool.shape) {
    case 'circle': {
      // Circles and ovals: drag outward from the centre.
      const r = dragged ? Math.hypot(x - x0, y - y0) : L;
      return makeShape('circle', [c, { x: x0 + r, y: y0 }, { x: x0, y: y0 + r }], opts);
    }
    case 'oval': {
      const rx = dragged ? Math.max(2, Math.abs(x - x0)) : L, ry = dragged ? Math.max(2, Math.abs(y - y0)) : 0.6 * L;
      return makeShape('oval', [c, { x: x0 + rx, y: y0 }, { x: x0, y: y0 + ry }], opts);
    }
    case 'rect': case 'roundRect': {
      // Rectangles: corner to corner.
      const [ax, ay, bx, by] = dragged ? [x0, y0, x, y] : [x0 - L, y0 - L / 2, x0 + L, y0 + L / 2];
      const m = { x: (ax + bx) / 2, y: (ay + by) / 2 };
      const hx = Math.max(1, Math.abs(bx - ax) / 2), hy = Math.max(1, Math.abs(by - ay) / 2);
      return makeShape(tool.shape, [m, { x: m.x + hx, y: m.y }, { x: m.x, y: m.y + hy }], opts);
    }
    case 'line': {
      const a = fixedAngles ? snapAngle(Math.atan2(y - y0, x - x0)) : Math.atan2(y - y0, x - x0);
      const len = dragged ? Math.hypot(x - x0, y - y0) : L;
      const ang = dragged ? a : 0;
      return makeShape('line', [c, { x: x0 + len * Math.cos(ang), y: y0 + len * Math.sin(ang) }], opts);
    }
  }
}

/** Adjustment handles of an arrow or drawing element (none for captions). */
export function objectHandles(o: DocObject): Handle[] {
  if (o.kind === 'arrow' && o.curve) {
    const c = o.curve;
    const segs = Math.floor((c.length - 1) / 3);
    const mid = bezierPoint(c, Math.floor(segs / 2), segs % 2 ? 0.5 : 0);
    const hs: Handle[] = [{ name: 'tail', p: o.tail }, { name: 'mid', p: mid }, { name: 'head', p: o.head }];
    // Control points of a single-segment curve (multi-segment curves from ChemDraw keep their shape).
    if (c.length === 4) hs.push({ name: 'c1', p: c[1]! }, { name: 'c2', p: c[2]! });
    return hs;
  }
  if (o.kind === 'arrow') {
    let mid: Pt;
    if (o.arc) { const { t0, t1 } = arcParams(o); mid = arcPoint(o.arc, (t0 + t1) / 2); }
    else mid = { x: (o.tail.x + o.head.x) / 2, y: (o.tail.y + o.head.y) / 2 };
    return [{ name: 'tail', p: o.tail }, { name: 'mid', p: mid }, { name: 'head', p: o.head }];
  }
  if (o.kind === 'shape') {
    const [c, a, b] = o.points as [Pt, Pt, Pt];
    if (o.shape === 'line') return [{ name: 'from', p: o.points[0]! }, { name: 'to', p: o.points[1]! }];
    if (o.shape === 'circle') return [{ name: 'radius', p: a }];
    if (o.shape === 'oval') return [{ name: 'major', p: a }, { name: 'minor', p: b }];
    return [{ name: 'major', p: a }, { name: 'minor', p: b }, { name: 'corner', p: { x: a.x + b.x - c.x, y: a.y + b.y - c.y } }];
  }
  return [];
}

/** The handle within `tol` of a point, if any. */
export function handleAt(o: DocObject, p: Pt, tol: number): HandleName | null {
  let best: HandleName | null = null, bestD = tol;
  for (const h of objectHandles(o)) {
    const d = dist(h.p, p);
    if (d <= bestD) { bestD = d; best = h.name; }
  }
  return best;
}

/** Signed sweep nearest to `prev` among the windings of `raw` (degrees). */
function unwrapNear(raw: number, prev: number): number {
  let a = raw;
  while (a - prev > 180) a -= 360;
  while (a - prev < -180) a += 360;
  return Math.max(-359, Math.min(359, a));
}

/**
 * Drag a handle of `o` to `p`. `orig` is the object as it was when the drag
 * began; `o` is updated in place.
 */
export function dragHandle(o: DocObject, orig: DocObject, handle: HandleName, p: Pt, opts: { fixedAngles: boolean; oval?: boolean }): void {
  if (o.kind === 'arrow' && orig.kind === 'arrow' && orig.curve) { dragCurveHandle(o, orig, handle, p); return; }
  if (o.kind === 'arrow' && orig.kind === 'arrow') { dragArrowHandle(o, orig, handle, p, opts.fixedAngles, !!opts.oval); return; }
  if (o.kind !== 'shape' || orig.kind !== 'shape') return;
  const [c, a, b] = orig.points as [Pt, Pt, Pt];
  const ua = unit({ x: a.x - c.x, y: a.y - c.y }), ub = unit({ x: b.x - c.x, y: b.y - c.y });
  const along = (u: Pt) => Math.max(1, Math.abs((p.x - c.x) * u.x + (p.y - c.y) * u.y));
  switch (handle) {
    case 'from': case 'to': {
      const fixed = handle === 'from' ? orig.points[1]! : orig.points[0]!;
      let ang = Math.atan2(p.y - fixed.y, p.x - fixed.x);
      if (opts.fixedAngles) ang = snapAngle(ang);
      const len = Math.max(1, dist(p, fixed));
      const moved = { x: fixed.x + len * Math.cos(ang), y: fixed.y + len * Math.sin(ang) };
      o.points[handle === 'from' ? 0 : 1] = moved;
      return;
    }
    case 'radius': {
      const r = Math.max(1, dist(p, c));
      o.points[1] = { x: c.x + ua.x * r, y: c.y + ua.y * r };
      o.points[2] = { x: c.x + ub.x * r, y: c.y + ub.y * r };
      return;
    }
    case 'major': { const r = along(ua); o.points[1] = { x: c.x + ua.x * r, y: c.y + ua.y * r }; return; }
    case 'minor': { const r = along(ub); o.points[2] = { x: c.x + ub.x * r, y: c.y + ub.y * r }; return; }
    case 'corner': {
      // Corner handles scale length and width together.
      const corner = { x: a.x + b.x - c.x, y: a.y + b.y - c.y };
      const k = Math.max(0.05, dist(p, c) / (dist(corner, c) || 1));
      o.points[1] = { x: c.x + (a.x - c.x) * k, y: c.y + (a.y - c.y) * k };
      o.points[2] = { x: c.x + (b.x - c.x) * k, y: c.y + (b.y - c.y) * k };
      return;
    }
    default:
  }
}

/**
 * Curly arrows: drag either end (its control point follows, so the curve keeps
 * its shape near that end), either control point (any shape: tighter, looser,
 * lopsided, S-shaped), or the middle (both control points move together, so
 * the bow deepens or flattens with the ends fixed).
 */
function dragCurveHandle(o: Arrow, orig: Arrow, handle: HandleName, p: Pt) {
  const c0 = orig.curve!;
  const c = c0.map((q) => ({ ...q }));
  const last = c.length - 1;
  const move = (i: number, dx: number, dy: number) => { c[i]!.x += dx; c[i]!.y += dy; };
  if (handle === 'tail') { const dx = p.x - c0[0]!.x, dy = p.y - c0[0]!.y; move(0, dx, dy); move(1, dx, dy); }
  else if (handle === 'head') { const dx = p.x - c0[last]!.x, dy = p.y - c0[last]!.y; move(last, dx, dy); move(last - 1, dx, dy); }
  else if (handle === 'c1') c[1] = { ...p };
  else if (handle === 'c2') c[2] = { ...p };
  else if (handle === 'mid') {
    // The midpoint of a cubic moves 3/4 as far as its two control points.
    const segs = Math.floor(last / 3), s = Math.floor(segs / 2);
    const m = bezierPoint(c0, s, segs % 2 ? 0.5 : 0);
    const dx = (p.x - m.x) / 0.75, dy = (p.y - m.y) / 0.75;
    if (last === 3) { move(1, dx, dy); move(2, dx, dy); }
    else { for (let i = 1; i < last; i++) move(i, dx * 0.75, dy * 0.75); }
  }
  o.curve = c;
  o.tail = { ...c[0]! };
  o.head = { ...c[last]! };
}

/** Re-bow a curly arrow symmetrically (used when it is first drawn between atoms). */
export function rebowCurve(o: Arrow, bow: number) { o.curve = curlyControls(o.tail, o.head, bow); }

function dragArrowHandle(o: Arrow, orig: Arrow, handle: HandleName, p: Pt, fixedAngles: boolean, oval: boolean) {
  if (handle === 'mid' && oval && orig.arc) {
    // Shift-drag: squash or stretch the arc across its chord, ends fixed, so a circle becomes an oval.
    const g = orig.arc;
    const m = { x: (orig.tail.x + orig.head.x) / 2, y: (orig.tail.y + orig.head.y) / 2 };
    const u = unit({ x: orig.head.x - orig.tail.x, y: orig.head.y - orig.tail.y }), n = { x: -u.y, y: u.x };
    const { t0, t1 } = arcParams(orig);
    const midNow = arcPoint(g, (t0 + t1) / 2);
    const h0 = (midNow.x - m.x) * n.x + (midNow.y - m.y) * n.y;
    const h = (p.x - m.x) * n.x + (p.y - m.y) * n.y;
    if (Math.abs(h0) < 1e-6) return;
    let k = h / h0;
    if (k > 0) k = Math.max(0.15, Math.min(8, k)); else k = 0.15;
    const T = (q: Pt) => {
      const du = (q.x - m.x) * u.x + (q.y - m.y) * u.y, dn = (q.x - m.x) * n.x + (q.y - m.y) * n.y;
      return { x: m.x + u.x * du + n.x * dn * k, y: m.y + u.y * du + n.y * dn * k };
    };
    o.arc = { center: T(g.center), majorEnd: T(g.majorEnd), minorEnd: T(g.minorEnd), angle: g.angle };
    o.tail = { ...orig.tail }; o.head = { ...orig.head };
    return;
  }
  if (handle === 'mid') {
    // Bend through the dragged point with both ends fixed; nearly straight snaps back to straight.
    const chord = dist(orig.tail, orig.head);
    const mx = (orig.tail.x + orig.head.x) / 2, my = (orig.tail.y + orig.head.y) / 2;
    const u = unit({ x: orig.head.x - orig.tail.x, y: orig.head.y - orig.tail.y });
    const off = (p.x - mx) * -u.y + (p.y - my) * u.x;
    if (Math.abs(off) < Math.max(2, chord * 0.02)) { o.arc = null; return; }
    const g = arcThroughThree(orig.tail, p, orig.head);
    if (!g) { o.arc = null; return; }
    g.angle = Math.round(g.angle * 10) / 10;
    o.arc = g;
    o.tail = { ...orig.tail };
    o.head = arcPoint(g, arcParam(g, orig.tail) + arcSense(g) * g.angle * DEG);
    return;
  }
  if (orig.arc) {
    // Slide the end round the same circle (or ellipse): the sweep changes, the curve does not.
    const g = { ...orig.arc, center: { ...orig.arc.center }, majorEnd: { ...orig.arc.majorEnd }, minorEnd: { ...orig.arc.minorEnd } };
    const s = arcSense(g);
    const { t0, t1 } = arcParams(orig);
    const tm = arcParam(g, p);
    const prev = o.arc?.angle ?? orig.arc.angle;
    if (handle === 'head') {
      const angle = Math.round(unwrapNear((s * (tm - t0)) / DEG, prev));
      g.angle = angle;
      o.arc = g;
      o.tail = { ...orig.tail };
      o.head = arcPoint(g, t0 + s * angle * DEG);
    } else if (handle === 'tail') {
      const angle = Math.round(unwrapNear((s * (t1 - tm)) / DEG, prev));
      g.angle = angle;
      o.arc = g;
      o.head = { ...orig.head };
      o.tail = arcPoint(g, t1 - s * angle * DEG);
    }
    return;
  }
  // Straight arrow: move that end; angles snap to 15 degrees with Fixed Angles on.
  const fixed = handle === 'head' ? orig.tail : orig.head;
  let ang = Math.atan2(p.y - fixed.y, p.x - fixed.x);
  if (fixedAngles) ang = snapAngle(ang);
  const len = Math.max(4, dist(p, fixed));
  const moved = { x: fixed.x + len * Math.cos(ang), y: fixed.y + len * Math.sin(ang) };
  if (handle === 'head') o.head = moved; else o.tail = moved;
}
