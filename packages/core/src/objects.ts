/**
 * Non-molecule document objects: reaction arrows (straight and arc), text
 * captions and drawing elements (circles, ovals, rectangles, lines), with the
 * same parameters ChemDraw stores in CDXML so files round-trip.
 */

export type ArrowEnd = 'none' | 'full' | 'halfLeft' | 'halfRight';
import type { AnalysisItem } from './analysis.ts';

type Pt = { x: number; y: number };

/**
 * An arc arrow lies on the ellipse (a circle when the axes are equal)
 * centre + (majorEnd - centre) cos t + (minorEnd - centre) sin t. `angle` is
 * CDXML's AngularSize: head angle minus tail angle in degrees, positive
 * anticlockwise on screen (measured from ChemDraw's samples).
 */
export interface ArcGeometry { center: Pt; majorEnd: Pt; minorEnd: Pt; angle: number }

export interface Arrow {
  kind: 'arrow';
  id: number;
  tail: Pt;
  head: Pt;
  headEnd: ArrowEnd;
  tailEnd: ArrowEnd;
  /** Arrowhead size parameters, in hundredths of the line width (ChemDraw defaults 1000/875/250). */
  headSize: number;
  centerSize: number;
  width: number;
  /** Gap between the two shafts of an equilibrium or retrosynthetic arrow, hundredths of line width. */
  shaftSpacing: number;
  /** Null for a straight arrow. */
  arc: ArcGeometry | null;
  /**
   * A curly (Bézier) arrow: cubic segments as [p0, c1, c2, p1, c3, c4, p2, ...]
   * from tail to head. Null for straight and arc arrows. Saved as a CDXML <curve>.
   */
  curve?: Pt[] | null;
  line: 'plain' | 'dashed' | 'bold';
  /** ArrowheadType: solid, hollow (outline; with two shafts, a retrosynthetic arrow) or angled (open V). */
  headStyle: 'solid' | 'hollow' | 'angled';
  nogo: 'none' | 'cross' | 'hash';
  dipole: boolean;
  color: string | null;
}

/** Character styling within a caption, as ChemDraw's Text menu offers it. */
export interface TextStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  /** sub/superscript, or ChemDraw's Formula style (digits subscripted, charges raised as you type). */
  script?: 'sub' | 'sup' | 'formula';
  /** Point size; omitted means the document caption size. */
  size?: number;
  /** Font family name (Helvetica, Arial, Times New Roman, Courier New); omitted means the document caption font. */
  font?: string;
  color?: string | null;
}
export interface TextRun extends TextStyle { text: string }

export interface Caption {
  kind: 'text';
  id: number;
  /** First line's baseline; x is the left edge, centre or right edge according to `align` (as CDXML's p). */
  x: number;
  y: number;
  /** Plain text, lines separated by \n (kept in step with `runs`). */
  text: string;
  /** Styled runs; absent for plain text in the document style. */
  runs?: TextRun[];
  align?: 'left' | 'center' | 'right';
  color?: string | null;
  /**
   * Analysis written for a structure (ChemDraw's linked chemical property
   * caption): its lines are rewritten whenever the structure changes, and the
   * caption moves with it. `basis` holds the structure's atoms; `source` a
   * caption read as a peptide ("H-Ala-Gly-OH") instead.
   */
  analysis?: { items: AnalysisItem[]; basis: number[]; source?: number } | null;
}

/**
 * Object > Group: things that select and move as one. Groups nest, as in
 * ChemDraw. `atoms` name the structures directly in this group (any atom of
 * a structure brings the whole structure, so a structure drawn onto stays in
 * its group); `objects` are arrows, drawing elements and captions; `groups`
 * are the ids of groups inside this one.
 */
export interface ObjectGroup {
  id: number;
  atoms: number[];
  objects: number[];
  groups: number[];
}

export const cloneGroups = (groups: readonly ObjectGroup[]): ObjectGroup[] => groups.map((g) => ({ id: g.id, atoms: [...g.atoms], objects: [...g.objects], groups: [...(g.groups ?? [])] }));

/** Groups that are not inside another group. */
export function topGroups(groups: readonly ObjectGroup[]): ObjectGroup[] {
  const inner = new Set(groups.flatMap((g) => g.groups));
  return groups.filter((g) => !inner.has(g.id));
}

/** Everything a group holds, its inner groups included: structure atoms (one or more per structure) and objects. */
export function groupContents(groups: readonly ObjectGroup[], g: ObjectGroup): { atoms: number[]; objects: number[] } {
  const byId = new Map(groups.map((x) => [x.id, x]));
  const atoms: number[] = [], objects: number[] = [];
  const seen = new Set<number>();
  const walk = (x: ObjectGroup) => {
    if (seen.has(x.id)) return;
    seen.add(x.id);
    atoms.push(...x.atoms);
    objects.push(...x.objects);
    for (const c of x.groups) { const child = byId.get(c); if (child) walk(child); }
  };
  walk(g);
  return { atoms, objects };
}

/** The group directly above `g`, or undefined at the top. */
export const parentGroup = (groups: readonly ObjectGroup[], g: ObjectGroup): ObjectGroup | undefined => groups.find((x) => x.groups.includes(g.id));

/**
 * Drawing elements. Ovals and rectangles are stored as ChemDraw does:
 * points = [centre, majorAxisEnd, minorAxisEnd], so they can be rotated;
 * a line is points = [from, to].
 */
export interface Shape {
  kind: 'shape';
  id: number;
  shape: 'circle' | 'oval' | 'rect' | 'roundRect' | 'line';
  points: Pt[];
  fill: 'none' | 'filled' | 'shaded';
  line: 'plain' | 'dashed' | 'bold' | 'wavy';
  shadow: boolean;
  color: string | null;
}

export type DocObject = Arrow | Caption | Shape;

let nextId = 1;
export const newObjectId = () => nextId++;

/** Arrow tools on ChemDraw's Arrows palette (straight ones; arcs come from makeArcArrow). */
export type ArrowKind =
  | 'reaction' | 'equilibrium' | 'resonance' | 'retro' | 'halfLeft' | 'halfRight' | 'plainLine'
  | 'dashed' | 'bold' | 'nogo' | 'nogoHash' | 'dipole' | 'unbalanced' | 'hollowHead' | 'angledHead'
  | 'electron' | 'radical';

export function makeArrow(tail: Pt, head: Pt, kind: ArrowKind = 'reaction'): Arrow {
  const a: Arrow = {
    kind: 'arrow', id: newObjectId(), tail, head,
    headEnd: 'full', tailEnd: 'none',
    headSize: 1000, centerSize: 875, width: 250, shaftSpacing: 0,
    arc: null, line: 'plain', headStyle: 'solid', nogo: 'none', dipole: false, color: null,
  };
  switch (kind) {
    case 'equilibrium': a.headEnd = 'halfLeft'; a.tailEnd = 'halfLeft'; a.shaftSpacing = 400; break;
    case 'unbalanced': a.headEnd = 'halfLeft'; a.tailEnd = 'halfLeft'; a.shaftSpacing = 400; break;
    case 'resonance': a.tailEnd = 'full'; break;
    case 'retro': a.headStyle = 'hollow'; a.shaftSpacing = 600; a.headSize = 600; a.centerSize = 600; a.width = 150; break;
    case 'halfLeft': a.headEnd = 'halfLeft'; break;
    case 'halfRight': a.headEnd = 'halfRight'; break;
    case 'plainLine': a.headEnd = 'none'; break;
    case 'dashed': a.line = 'dashed'; break;
    case 'bold': a.line = 'bold'; a.headSize = 2000; a.centerSize = 1750; a.width = 500; break;
    case 'nogo': a.nogo = 'cross'; break;
    case 'nogoHash': a.nogo = 'hash'; break;
    case 'hollowHead': a.headStyle = 'hollow'; break;
    case 'angledHead': a.headStyle = 'angled'; break;
    case 'dipole': a.dipole = true; break;
    // Electron pushing arrows: ChemDraw's slim head (HeadSize 400, centre 400, width 200).
    case 'electron': a.headSize = 400; a.centerSize = 400; a.width = 200; break;
    case 'radical': a.headEnd = 'halfLeft'; a.headSize = 400; a.centerSize = 400; a.width = 200; break;
  }
  return a;
}

/**
 * An arc arrow on a circle through `tail` and `head` sweeping `angle`
 * degrees (positive anticlockwise on screen), as the arc tools draw it.
 */
export function makeArcArrow(tail: Pt, head: Pt, angle: number, heads: { head?: ArrowEnd; tail?: ArrowEnd } = {}): Arrow {
  const a = makeArrow(tail, head, 'reaction');
  a.headEnd = heads.head ?? 'full';
  a.tailEnd = heads.tail ?? 'none';
  a.arc = arcThrough(tail, head, angle);
  return a;
}

/**
 * A curly arrow from `tail` to `head` bowing out by `bow` (a fraction of the
 * chord; positive bows to the left of travel, i.e. upward for a left-to-right
 * arrow, as ChemDraw's electron pushing tool draws it).
 */
export function makeCurlyArrow(tail: Pt, head: Pt, kind: 'electron' | 'radical' = 'electron', bow = 0.45): Arrow {
  const a = makeArrow(tail, head, kind);
  a.curve = curlyControls(tail, head, bow);
  return a;
}

/** Control points for a symmetric bow between two points. */
export function curlyControls(p0: Pt, p3: Pt, bow: number): Pt[] {
  const dx = p3.x - p0.x, dy = p3.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len; // left of travel on screen
  const h = bow * len;
  return [{ ...p0 }, { x: p0.x + dx * 0.2 + nx * h, y: p0.y + dy * 0.2 + ny * h }, { x: p0.x + dx * 0.8 + nx * h, y: p0.y + dy * 0.8 + ny * h }, { ...p3 }];
}

/** Point on a cubic Bézier path at segment s, parameter t. */
export function bezierPoint(c: Pt[], s: number, t: number): Pt {
  const [p0, p1, p2, p3] = [c[3 * s]!, c[3 * s + 1]!, c[3 * s + 2]!, c[3 * s + 3]!];
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
    y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
  };
}

/** Points along a curly arrow from tail to head. */
export function curvePolyline(c: Pt[], perSegment = 40): Pt[] {
  const out: Pt[] = [];
  const segs = Math.floor((c.length - 1) / 3);
  for (let s = 0; s < segs; s++) for (let i = s ? 1 : 0; i <= perSegment; i++) out.push(bezierPoint(c, s, i / perSegment));
  return out;
}

/** Circle through two points with the given sweep from p to q (degrees, + anticlockwise on screen). */
export function arcThrough(p: Pt, q: Pt, angle: number): ArcGeometry {
  const theta = (angle * Math.PI) / 180;
  const chord = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const r = chord / (2 * Math.abs(Math.sin(theta / 2)) || 1);
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  // Distance from chord midpoint to centre, signed so the sweep has the requested direction.
  const h = r * Math.cos(theta / 2);
  const ux = (q.x - p.x) / chord, uy = (q.y - p.y) / chord;
  // Screen y points down: anticlockwise travel from p to q curves to the right of p->q... centre lies left of it.
  const s = angle >= 0 ? 1 : -1;
  const center = { x: mx + s * uy * h, y: my - s * ux * h };
  return { center, majorEnd: { x: center.x + r, y: center.y }, minorEnd: { x: center.x, y: center.y + r }, angle };
}

/** Circle through three points (tail, a point on the arc, head); null when they are collinear. */
export function arcThroughThree(p: Pt, m: Pt, q: Pt): ArcGeometry | null {
  const d = 2 * (p.x * (m.y - q.y) + m.x * (q.y - p.y) + q.x * (p.y - m.y));
  if (Math.abs(d) < 1e-6) return null;
  const sq = (a: Pt) => a.x * a.x + a.y * a.y;
  const cx = (sq(p) * (m.y - q.y) + sq(m) * (q.y - p.y) + sq(q) * (p.y - m.y)) / d;
  const cy = (sq(p) * (q.x - m.x) + sq(m) * (p.x - q.x) + sq(q) * (m.x - p.x)) / d;
  const r = Math.hypot(p.x - cx, p.y - cy);
  // Sweep from p through m to q, in screen terms; AngularSize is anticlockwise-positive.
  const ang = (a: Pt) => Math.atan2(-(a.y - cy), a.x - cx);
  const norm = (t: number) => ((t % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const toM = norm(ang(m) - ang(p)), toQ = norm(ang(q) - ang(p));
  const sweep = toM < toQ ? toQ : toQ - 2 * Math.PI;
  return { center: { x: cx, y: cy }, majorEnd: { x: cx + r, y: cy }, minorEnd: { x: cx, y: cy + r }, angle: (sweep * 180) / Math.PI };
}

/** Point on an arc at parameter t (radians, in the ellipse's own parameterisation). */
export function arcPoint(g: ArcGeometry, t: number): Pt {
  const a = { x: g.majorEnd.x - g.center.x, y: g.majorEnd.y - g.center.y };
  const b = { x: g.minorEnd.x - g.center.x, y: g.minorEnd.y - g.center.y };
  return { x: g.center.x + a.x * Math.cos(t) + b.x * Math.sin(t), y: g.center.y + a.y * Math.cos(t) + b.y * Math.sin(t) };
}

/** Ellipse parameter of a point (projected onto the ellipse). */
export function arcParam(g: ArcGeometry, p: Pt): number {
  const a = { x: g.majorEnd.x - g.center.x, y: g.majorEnd.y - g.center.y };
  const b = { x: g.minorEnd.x - g.center.x, y: g.minorEnd.y - g.center.y };
  const det = a.x * b.y - a.y * b.x || 1;
  const dx = p.x - g.center.x, dy = p.y - g.center.y;
  const c = (dx * b.y - dy * b.x) / det, s = (a.x * dy - a.y * dx) / det;
  return Math.atan2(s, c);
}

/**
 * Parameter direction: AngularSize is anticlockwise on screen, and the
 * parameter runs anticlockwise when minorEnd lies anticlockwise of majorEnd.
 */
export function arcSense(g: ArcGeometry): 1 | -1 {
  const a = { x: g.majorEnd.x - g.center.x, y: g.majorEnd.y - g.center.y };
  const b = { x: g.minorEnd.x - g.center.x, y: g.minorEnd.y - g.center.y };
  // Screen y is down, so a positive cross product means b is clockwise of a.
  return a.x * b.y - a.y * b.x > 0 ? -1 : 1;
}

/** Tail and head parameters of an arc arrow (head = tail + sweep). */
export function arcParams(a: Arrow): { t0: number; t1: number } {
  const g = a.arc!;
  const t0 = arcParam(g, a.tail);
  return { t0, t1: t0 + arcSense(g) * (g.angle * Math.PI) / 180 };
}

export function makeCaption(x: number, y: number, text: string, runs?: TextRun[], align: Caption['align'] = 'left'): Caption {
  const c: Caption = { kind: 'text', id: newObjectId(), x, y, text, color: null, align };
  if (runs) setCaptionRuns(c, runs);
  return c;
}

/** A caption's runs (one plain run when it has no styling). */
export function captionRuns(c: Caption): TextRun[] {
  return c.runs?.length ? c.runs : [{ text: c.text }];
}

const sameStyle = (a: TextStyle, b: TextStyle) => !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.underline === !!b.underline
  && (a.script ?? null) === (b.script ?? null) && (a.size ?? null) === (b.size ?? null) && (a.color ?? null) === (b.color ?? null)
  && (a.font ?? null) === (b.font ?? null);

/** Set a caption's runs: neighbouring runs with the same style merge, and `text` follows. Plain runs drop to plain text. */
export function setCaptionRuns(c: Caption, runs: TextRun[]): void {
  const out: TextRun[] = [];
  for (const r0 of runs) {
    if (!r0.text) continue;
    // Drop empty style keys (undefined, false, null colour) so equal styles compare equal.
    const r: TextRun = { text: r0.text };
    if (r0.bold) r.bold = true;
    if (r0.italic) r.italic = true;
    if (r0.underline) r.underline = true;
    if (r0.script) r.script = r0.script;
    if (r0.size !== undefined && r0.size !== null) r.size = r0.size;
    if (r0.color) r.color = r0.color;
    if (r0.font) r.font = r0.font;
    const last = out[out.length - 1];
    if (last && sameStyle(last, r)) last.text += r.text;
    else out.push({ ...r });
  }
  c.text = out.map((r) => r.text).join('');
  const plain = out.every((r) => sameStyle(r, {}));
  c.runs = plain ? undefined : out;
}

/**
 * ChemDraw's Formula style: digits after an element symbol or bracket are
 * subscripts (CH2Cl2, Ca(OH)2), a trailing charge is raised (NH4+, SO42−),
 * and a leading coefficient stays on the line (CuSO4·5H2O).
 */
export function formulaPieces(text: string): { text: string; kind: 'normal' | 'sub' | 'sup' }[] {
  const out: { text: string; kind: 'normal' | 'sub' | 'sup' }[] = [];
  const push = (t: string, kind: 'normal' | 'sub' | 'sup') => {
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += t; else out.push({ text: t, kind });
  };
  let i = 0;
  while (i < text.length) {
    const ch = text[i]!;
    if (/\d/.test(ch)) {
      let j = i;
      while (j < text.length && /\d/.test(text[j]!)) j++;
      const digits = text.slice(i, j);
      const prev = i > 0 ? text[i - 1]! : '';
      const charge = /[+\-−]/.test(text[j] ?? '') && (j + 1 === text.length || /[\s,;)]/.test(text[j + 1]!));
      if (!/[A-Za-z)\]]/.test(prev)) push(digits, 'normal'); // coefficient
      else if (charge) {
        // NH4+ keeps the 4 down; a lone digit before the sign (Ca2+) goes up with it.
        if (digits.length > 1) { push(digits.slice(0, -1), 'sub'); push(digits.slice(-1), 'sup'); }
        else if (/[a-z)]/.test(prev)) push(digits, 'sup'); // Ca2+, Fe3+; but NH4+ keeps its 4 down
        else push(digits, 'sub');
      } else push(digits, 'sub');
      i = j;
      continue;
    }
    if (/[+\-−]/.test(ch) && i > 0 && /[A-Za-z0-9)\]]/.test(text[i - 1]!) && (i + 1 === text.length || /[\s,;)]/.test(text[i + 1]!))) {
      push(ch === '-' ? '−' : ch, 'sup');
      i++;
      continue;
    }
    push(ch, 'normal');
    i++;
  }
  return out;
}

export function makeShape(shape: Shape['shape'], points: Pt[], opts: Partial<Pick<Shape, 'fill' | 'line' | 'shadow' | 'color'>> = {}): Shape {
  return {
    kind: 'shape', id: newObjectId(), shape, points: points.map((p) => ({ ...p })),
    fill: opts.fill ?? 'none', line: opts.line ?? 'plain', shadow: opts.shadow ?? false, color: opts.color ?? null,
  };
}

/** Every movable control point of an object, for moving, rotating and flipping it. */
export function objectPoints(o: DocObject): Pt[] {
  if (o.kind === 'arrow') {
    // tail/head are separate copies of the curve's ends, so moving all of these keeps them equal.
    if (o.curve) return [...o.curve, o.tail, o.head];
    return o.arc ? [o.tail, o.head, o.arc.center, o.arc.majorEnd, o.arc.minorEnd] : [o.tail, o.head];
  }
  if (o.kind === 'shape') return o.points;
  return [o];
}

export function cloneObjects(objects: readonly DocObject[]): DocObject[] {
  return objects.map((o) => {
    if (o.kind === 'arrow') {
      return {
        ...o, tail: { ...o.tail }, head: { ...o.head },
        arc: o.arc ? { center: { ...o.arc.center }, majorEnd: { ...o.arc.majorEnd }, minorEnd: { ...o.arc.minorEnd }, angle: o.arc.angle } : null,
        curve: o.curve ? o.curve.map((p) => ({ ...p })) : null,
      };
    }
    if (o.kind === 'shape') return { ...o, points: o.points.map((p) => ({ ...p })) };
    return { ...o, runs: o.runs?.map((r) => ({ ...r })), analysis: o.analysis ? { ...o.analysis, items: [...o.analysis.items], basis: [...o.analysis.basis] } : o.analysis };
  });
}

/** Points along an arc arrow from tail to head. */
export function arcPolyline(a: Arrow, steps = 48): Pt[] {
  const { t0, t1 } = arcParams(a);
  const n = Math.max(2, Math.ceil((steps * Math.abs(t1 - t0)) / (2 * Math.PI)) + 1);
  return Array.from({ length: n + 1 }, (_, i) => arcPoint(a.arc!, t0 + ((t1 - t0) * i) / n));
}

/** Outline of a drawing element: a closed loop for ovals and rectangles, two points for a line. */
export function shapeOutline(o: Shape, steps = 64): Pt[] {
  const [c, a, b] = o.points as [Pt, Pt, Pt];
  if (o.shape === 'line') return [o.points[0]!, o.points[1]!];
  if (o.shape === 'circle' || o.shape === 'oval') {
    const g = { center: c, majorEnd: a, minorEnd: b, angle: 360 };
    return Array.from({ length: steps }, (_, i) => arcPoint(g, (2 * Math.PI * i) / steps));
  }
  const u = { x: a.x - c.x, y: a.y - c.y }, v = { x: b.x - c.x, y: b.y - c.y };
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([i, j]) => ({ x: c.x + i! * u.x + j! * v.x, y: c.y + i! * u.y + j! * v.y }));
}

/** Polylines (open) tracing an object, for hit-testing and selection outlines. Captions have none. */
export function objectPolylines(o: DocObject): Pt[][] {
  if (o.kind === 'arrow') return [o.curve ? curvePolyline(o.curve) : o.arc ? arcPolyline(o) : [o.tail, o.head]];
  if (o.kind === 'shape') {
    const pts = shapeOutline(o);
    return [o.shape === 'line' ? pts : [...pts, pts[0]!]];
  }
  return [];
}

/** Distance from a point to an object's outline (Infinity for captions). */
export function distanceToObject(o: DocObject, p: Pt): number {
  let best = Infinity;
  for (const line of objectPolylines(o)) {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!, b = line[i + 1]!;
      const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
      const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
      best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
    }
  }
  return best;
}

/** Is p inside a closed, filled drawing element? */
export function insideShape(o: Shape, p: Pt): boolean {
  if (o.shape === 'line') return false;
  const poly = shapeOutline(o, 32);
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!, b = poly[j]!;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}
