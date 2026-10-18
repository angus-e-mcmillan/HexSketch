import {
  perceiveRings, ringsByBond,
  type AtomId, type Bond, type BondId, type DocObject, type DrawingStyle, type Molecule, type Ring,
} from '@hexsketch/core';
import { depictObjects } from './objects.ts';
import { textWidth } from './fonts.ts';
import {
  add, dist, dot, lerp, lineIntersection, normalize, perp, scale, sub, vec, type Rect, type Vec,
} from './geometry.ts';
import { exitParameter, layoutLabel, needsLabel, type AtomLabel, type GlyphRun } from './labels.ts';

export interface Owner { atom?: AtomId; bond?: BondId; object?: number }

/**
 * Drawing primitives. `color` overrides the foreground colour; `background`
 * primitives (highlights, ring fills) are painted before everything else.
 */
interface Paint { color?: string; background?: boolean }
export type Primitive =
  | ({ kind: 'polygon'; points: Vec[]; owner: Owner } & Paint)
  | ({ kind: 'line'; a: Vec; b: Vec; width: number; owner: Owner; dash?: number[]; cap?: 'round' } & Paint)
  | ({ kind: 'path'; d: string; width: number; owner: Owner; dash?: number[]; join?: 'miter' | 'round'; cap?: 'round' } & Paint)
  | ({ kind: 'circle'; c: Vec; r: number; width: number; owner: Owner } & Paint)
  | ({ kind: 'fillPath'; d: string; owner: Owner; shade?: boolean } & Paint)
  | ({ kind: 'text'; run: GlyphRun; owner: Owner; caption?: boolean; bold?: boolean; italic?: boolean; font?: string } & Paint);

/** Highlight band width as a fraction of bond length (measured from ChemDraw's help artwork). */
const HIGHLIGHT_WIDTH = 0.5;

export interface Depiction {
  primitives: Primitive[];
  labels: Map<AtomId, AtomLabel>;
  bounds: Rect;
  style: DrawingStyle;
}

/*
 * Geometry rules, each measured from ChemDraw 20.1 SVG exports of fixtures in
 * three styles (house style; thin lines; long bonds with wide spacing):
 *
 *  - Bonds are filled polygons. At an unlabelled atom each bond's end is cut
 *    where its edges meet the edges of its angular neighbours, so corners
 *    tile into sharp mitres with no overlap.
 *  - Parallel-line spacing d = max(bondSpacing% x bondLength, 2.5 x lineWidth):
 *    ChemDraw never lets the clear gap drop below 1.5 line widths.
 *  - An offset line is trimmed at each end by d / tan(theta/2), theta being the
 *    angle to the neighbouring bond on that side (0 when collinear).
 *  - Label clipping is computed on the bond axis; every parallel line of the
 *    bond is cut on the same perpendicular.
 *  - Solid wedge: lineWidth wide at the narrow atom, 1.5 x boldWidth at its
 *    visible wide end.
 *  - Hashed wedge: first hash's inner edge sits hashSpacing from the narrow
 *    atom, last hash's outer edge on the visible end, evenly spaced between.
 *  - Wavy: semicircles of nominal 2.25 pt diameter, n + 1/2 of them, stretched
 *    to fit; stroked at the line width rounded to twips.
 */
const WEDGE_WIDE = 1.5;
const MIN_GAP_LINE_WIDTHS = 2.5;
const WAVE_DIAMETER = 2.25;
const AROMATIC_CIRCLE_FRACTION = 0.72;
const MITRE_LIMIT = 4;

interface Side { a: Vec; b: Vec }
interface BodyEnd { atom: AtomId; dir: Vec; plus: Side; minus: Side }

interface Ctx {
  mol: Molecule;
  style: DrawingStyle;
  labels: Map<AtomId, AtomLabel>;
  ringsOf: Map<BondId, Ring[]>;
  out: Primitive[];
  spacing: number;
  /** Polygon bodies that take part in mitre joins, by atom. */
  joins: Map<AtomId, BodyEnd[]>;
  bodies: { bond: BondId; begin: AtomId; end: AtomId; a: Vec; b: Vec; ha: number; hb: number; cutA: boolean; cutB: boolean }[];
}

export function depict(mol: Molecule, style: DrawingStyle, objects: readonly DocObject[] = []): Depiction {
  const labels = new Map<AtomId, AtomLabel>();
  for (const atom of mol.atoms()) {
    if (needsLabel(mol, atom.id, style)) labels.set(atom.id, layoutLabel(mol, atom.id, style));
  }
  const rings = perceiveRings(mol);
  const ctx: Ctx = {
    mol, style, labels,
    ringsOf: ringsByBond(rings),
    out: [],
    spacing: Math.max((style.bondSpacing / 100) * style.bondLength, MIN_GAP_LINE_WIDTHS * style.lineWidth),
    joins: new Map(),
    bodies: [],
  };

  const aromaticRings = rings.filter((r) => r.bonds.every((b) => mol.bond(b).order === 1.5));
  const aromaticBonds = new Set(aromaticRings.flatMap((r) => r.bonds));

  for (const bond of mol.bonds()) drawBond(ctx, bond, aromaticBonds.has(bond.id));
  emitBodies(ctx);
  for (const ring of aromaticRings) drawAromaticCircle(ctx, ring);

  for (const atom of mol.atoms()) {
    const label = labels.get(atom.id);
    if (label) for (const run of label.runs) ctx.out.push({ kind: 'text', run, owner: { atom: atom.id } });
  }
  // Colors menu: bonds take their own colour, atom labels the atom's.
  for (const p of ctx.out) {
    if (p.owner.bond !== undefined) { const c = mol.bond(p.owner.bond).color; if (c) p.color = c; }
    else if (p.owner.atom !== undefined) { const c = mol.atom(p.owner.atom).color; if (c) p.color = c; }
  }
  const back = backgrounds(mol, style, labels, rings);
  const prims = [...back, ...ctx.out, ...depictObjects(objects, style)];
  return { primitives: prims, labels, bounds: boundsOf(prims, labels, style), style };
}

/**
 * Ring Fill Colors and Highlight Colors, painted behind the structure: ring
 * interiors to the bond centrelines, opaque round-capped bands along
 * highlighted bonds, and a rounded box behind each highlighted label (a disc
 * at a bare carbon).
 */
function backgrounds(mol: Molecule, style: DrawingStyle, labels: Map<AtomId, AtomLabel>, rings: Ring[]): Primitive[] {
  const out: Primitive[] = [];
  for (const fill of mol.ringFills) {
    if (!fill.atoms.every((a) => mol.hasAtom(a))) continue;
    const closed = fill.atoms.every((a, i) => mol.bondBetween(a, fill.atoms[(i + 1) % fill.atoms.length]!));
    if (!closed) continue;
    out.push({ kind: 'polygon', points: fill.atoms.map((a) => vec(mol.atom(a).x, mol.atom(a).y)), owner: {}, color: fill.color, background: true });
  }
  void rings;
  const w = HIGHLIGHT_WIDTH * style.bondLength;
  for (const b of mol.bonds()) {
    if (!b.highlight) continue;
    const p = mol.atom(b.begin), q = mol.atom(b.end);
    out.push({ kind: 'line', a: vec(p.x, p.y), b: vec(q.x, q.y), width: w, cap: 'round', owner: { bond: b.id }, color: b.highlight, background: true });
  }
  for (const a of mol.atoms()) {
    if (!a.highlight) continue;
    const l = labels.get(a.id);
    if (l) {
      const pad = 0.12 * style.bondLength, r = Math.min(0.25 * style.bondLength, (l.bounds.y1 - l.bounds.y0) / 2 + pad);
      out.push({ kind: 'fillPath', d: roundRectPath(l.bounds.x0 - pad, l.bounds.y0 - pad, l.bounds.x1 + pad, l.bounds.y1 + pad, r), owner: { atom: a.id }, color: a.highlight, background: true });
    } else {
      out.push({ kind: 'fillPath', d: roundRectPath(a.x - w / 2, a.y - w / 2, a.x + w / 2, a.y + w / 2, w / 2), owner: { atom: a.id }, color: a.highlight, background: true });
    }
  }
  return out;
}

/** Rounded rectangle as M/L/C commands (PDF-friendly). */
function roundRectPath(x0: number, y0: number, x1: number, y1: number, r: number): string {
  const k = 0.5523 * r, g = (n: number) => Math.round(n * 100) / 100;
  return `M ${g(x0 + r)},${g(y0)} L ${g(x1 - r)},${g(y0)} C ${g(x1 - r + k)},${g(y0)} ${g(x1)},${g(y0 + r - k)} ${g(x1)},${g(y0 + r)} `
    + `L ${g(x1)},${g(y1 - r)} C ${g(x1)},${g(y1 - r + k)} ${g(x1 - r + k)},${g(y1)} ${g(x1 - r)},${g(y1)} `
    + `L ${g(x0 + r)},${g(y1)} C ${g(x0 + r - k)},${g(y1)} ${g(x0)},${g(y1 - r + k)} ${g(x0)},${g(y1 - r)} `
    + `L ${g(x0)},${g(y0 + r)} C ${g(x0)},${g(y0 + r - k)} ${g(x0 + r - k)},${g(y0)} ${g(x0 + r)},${g(y0)} Z`;
}

const pos = (ctx: Ctx, id: AtomId): Vec => {
  const a = ctx.mol.atom(id);
  return vec(a.x, a.y);
};

/** Axis parameters [t0, t1] of the visible part of bond begin->end. */
function axisClip(ctx: Ctx, from: AtomId, to: AtomId): [number, number] | null {
  const a = pos(ctx, from), b = pos(ctx, to);
  const la = ctx.labels.get(from), lb = ctx.labels.get(to);
  const t0 = la ? exitParameter(la.clip, a, b) : 0;
  const t1 = lb ? 1 - exitParameter(lb.clip, b, a) : 1;
  return t1 - t0 > 1e-3 ? [t0, t1] : null;
}

function neighbourDirs(ctx: Ctx, atom: AtomId, except: AtomId): Vec[] {
  const p = pos(ctx, atom);
  return ctx.mol.neighbours(atom).filter((n) => n !== except).map((n) => normalize(sub(pos(ctx, n), p)));
}

/** Register a polygon body (single line, bold, wedge) that joins at unlabelled atoms. */
function addBody(ctx: Ctx, bond: Bond, begin: AtomId, end: AtomId, ha: number, hb: number) {
  const clip = axisClip(ctx, begin, end);
  if (!clip) return;
  const p = pos(ctx, begin), q = pos(ctx, end);
  const a = lerp(p, q, clip[0]), b = lerp(p, q, clip[1]);
  const cutA = !ctx.labels.has(begin), cutB = !ctx.labels.has(end);
  ctx.bodies.push({ bond: bond.id, begin, end, a, b, ha, hb, cutA, cutB });
  const u = normalize(sub(q, p));
  const n = perp(u);
  const plus: Side = { a: add(a, scale(n, ha)), b: add(b, scale(n, hb)) };
  const minus: Side = { a: sub(a, scale(n, ha)), b: sub(b, scale(n, hb)) };
  const push = (atom: AtomId, e: BodyEnd) => {
    const list = ctx.joins.get(atom) ?? [];
    list.push(e);
    ctx.joins.set(atom, list);
  };
  if (cutA) push(begin, { atom: begin, dir: u, plus, minus });
  // Seen from the end atom the bond runs backwards, so its sides swap.
  if (cutB) push(end, { atom: end, dir: scale(u, -1), plus: { a: minus.b, b: minus.a }, minus: { a: plus.b, b: plus.a } });
}

/**
 * Emit every registered body as a polygon, cutting ends at unlabelled atoms
 * against angular neighbours. Edge "plus" is the left-hand side (perp of the
 * direction away from the atom), which faces decreasing screen angle.
 */
function emitBodies(ctx: Ctx) {
  const endPoints = (atom: AtomId, dir: Vec, plus: Side, minus: Side): { onPlus: Vec; centre: Vec | null; onMinus: Vec } => {
    const list = ctx.joins.get(atom) ?? [];
    const o = pos(ctx, atom);
    const butt = { onPlus: plus.a, centre: null, onMinus: minus.a };
    if (list.length < 2) return butt;
    const ang = (v: Vec) => Math.atan2(v.y, v.x);
    const sorted = [...list].sort((x, y) => ang(x.dir) - ang(y.dir));
    const i = sorted.findIndex((e) => e.dir === dir);
    if (i < 0) return butt;
    const next = sorted[(i + 1) % sorted.length]!; // increasing angle
    const prev = sorted[(i - 1 + sorted.length) % sorted.length]!;
    const meet = (mine: Side, theirs: Side, fallback: Vec) => {
      const hit = lineIntersection(mine.a, sub(mine.b, mine.a), theirs.a, sub(theirs.b, theirs.a));
      const limit = MITRE_LIMIT * Math.max(dist(mine.a, o), dist(theirs.a, o), 0.5);
      return hit && dist(hit, o) <= limit ? hit : fallback;
    };
    // The minus side faces increasing angle (towards `next`), whose plus side faces back.
    const onMinus = meet(minus, next.plus, minus.a);
    const onPlus = meet(plus, prev.minus, plus.a);
    return { onPlus, centre: o, onMinus };
  };

  for (const body of ctx.bodies) {
    const p = pos(ctx, body.begin), q = pos(ctx, body.end);
    const u = normalize(sub(q, p));
    const n = perp(u);
    const plus: Side = { a: add(body.a, scale(n, body.ha)), b: add(body.b, scale(n, body.hb)) };
    const minus: Side = { a: sub(body.a, scale(n, body.ha)), b: sub(body.b, scale(n, body.hb)) };

    const startEnd = body.cutA
      ? endPoints(body.begin, (ctx.joins.get(body.begin) ?? []).find((e) => sameBody(e, plus))?.dir ?? u, plus, minus)
      : { onPlus: plus.a, centre: null, onMinus: minus.a };
    const revPlus: Side = { a: minus.b, b: minus.a };
    const revMinus: Side = { a: plus.b, b: plus.a };
    const finish = body.cutB
      ? endPoints(body.end, (ctx.joins.get(body.end) ?? []).find((e) => sameBody(e, revPlus))?.dir ?? scale(u, -1), revPlus, revMinus)
      : { onPlus: revPlus.a, centre: null, onMinus: revMinus.a };

    // Walk: begin plus -> end (its minus side is our plus) -> end centre -> end plus (our minus) -> begin minus -> begin centre.
    const pts: Vec[] = [startEnd.onPlus, finish.onMinus];
    if (finish.centre) pts.push(finish.centre);
    pts.push(finish.onPlus, startEnd.onMinus);
    if (startEnd.centre) pts.push(startEnd.centre);
    ctx.out.push({ kind: 'polygon', points: dedupe(pts), owner: { bond: body.bond } });
  }
}

function sameBody(e: BodyEnd, side: Side): boolean {
  return Math.abs(e.plus.a.x - side.a.x) < 1e-9 && Math.abs(e.plus.a.y - side.a.y) < 1e-9;
}

function dedupe(pts: Vec[]): Vec[] {
  return pts.filter((p, i) => i === 0 || dist(p, pts[i - 1]!) > 1e-6);
}

function drawBond(ctx: Ctx, bond: Bond, aromatic: boolean) {
  const { style } = ctx;
  const p = pos(ctx, bond.begin);
  const q = pos(ctx, bond.end);
  const u = normalize(sub(q, p));
  const hw = style.lineWidth / 2;

  if (bond.order === 1 || (bond.order === 1.5 && aromatic)) {
    switch (bond.display) {
      case 'wedgeBegin': return drawWedge(ctx, bond, bond.begin, bond.end);
      case 'wedgeEnd': return drawWedge(ctx, bond, bond.end, bond.begin);
      case 'hashBegin': return drawHash(ctx, bond, bond.begin, bond.end);
      case 'hashEnd': return drawHash(ctx, bond, bond.end, bond.begin);
      case 'bold': return addBody(ctx, bond, bond.begin, bond.end, style.boldWidth / 2, style.boldWidth / 2);
      case 'wavy': return drawWavy(ctx, bond);
      case 'dashed': {
        const clip = axisClip(ctx, bond.begin, bond.end);
        if (clip) ctx.out.push({ kind: 'line', a: lerp(p, q, clip[0]), b: lerp(p, q, clip[1]), width: style.lineWidth, owner: { bond: bond.id }, dash: [style.hashSpacing, style.hashSpacing] });
        return;
      }
      default: return addBody(ctx, bond, bond.begin, bond.end, hw, hw);
    }
  }

  if (bond.order === 1.5) {
    addBody(ctx, bond, bond.begin, bond.end, hw, hw);
    const side = chooseSide(ctx, bond, p, u);
    offsetLine(ctx, bond, p, q, u, side === 'center' ? 1 : side, [style.hashSpacing, style.hashSpacing]);
    return;
  }
  if (bond.order === 2) {
    if (bond.display === 'either') return drawCrossed(ctx, bond, p, q, u);
    const side = chooseSide(ctx, bond, p, u);
    if (side === 'center') return centredLines(ctx, bond, p, q, u, [-0.5, 0.5]);
    addBody(ctx, bond, bond.begin, bond.end, hw, hw);
    offsetLine(ctx, bond, p, q, u, side);
    return;
  }
  if (bond.order === 3) {
    addBody(ctx, bond, bond.begin, bond.end, hw, hw);
    offsetLine(ctx, bond, p, q, u, 1);
    offsetLine(ctx, bond, p, q, u, -1);
    return;
  }
  centredLines(ctx, bond, p, q, u, [-1.5, -0.5, 0.5, 1.5]);
}

/** Pick the side for a double bond's second line, as ChemDraw does automatically. */
function chooseSide(ctx: Ctx, bond: Bond, p: Vec, u: Vec): 1 | -1 | 'center' {
  const n = perp(u);
  if (bond.doubleBondPosition === 'center') return 'center';
  if (bond.doubleBondPosition === 'left') return 1;
  if (bond.doubleBondPosition === 'right') return -1;

  const rings = ctx.ringsOf.get(bond.id);
  if (rings && rings.length) {
    const score = (r: Ring) => r.bonds.filter((b) => ctx.mol.bond(b).order === 2).length;
    const ranked = [...rings].sort((a, b) => score(b) - score(a) || a.atoms.length - b.atoms.length);
    const best = ranked[0]!;
    const sideOf = (r: Ring) => (dot(sub(centroid(ctx, r), p), n) >= 0 ? 1 : -1);
    // A fused bond tied between two equally good rings goes to the left-hand
    // side of begin->end, as ChemDraw does for naphthalene.
    const tied = ranked.filter((r) => score(r) === score(best) && r.atoms.length === best.atoms.length);
    if (tied.length > 1 && new Set(tied.map(sideOf)).size > 1) return 1;
    return sideOf(best);
  }

  const nb = neighbourDirs(ctx, bond.begin, bond.end);
  const ne = neighbourDirs(ctx, bond.end, bond.begin);
  if ((nb.length === 0 && ctx.labels.has(bond.begin)) || (ne.length === 0 && ctx.labels.has(bond.end))) return 'center';
  if (nb.length === 0 && ne.length === 0) return 'center';

  let left = 0, right = 0;
  for (const d of [...nb, ...ne]) {
    const s = dot(d, n);
    if (s > 1e-6) left++;
    else if (s < -1e-6) right++;
  }
  if (left === right) return left === 0 ? 'center' : 1;
  return left > right ? 1 : -1;
}

function centroid(ctx: Ctx, ring: Ring): Vec {
  let x = 0, y = 0;
  for (const a of ring.atoms) { const p = pos(ctx, a); x += p.x; y += p.y; }
  return vec(x / ring.atoms.length, y / ring.atoms.length);
}

/** Butt-ended rectangle for a parallel line from a to b. */
function rectLine(ctx: Ctx, a: Vec, b: Vec, owner: Owner) {
  const n = scale(perp(normalize(sub(b, a))), ctx.style.lineWidth / 2);
  ctx.out.push({ kind: 'polygon', points: [add(a, n), add(b, n), sub(b, n), sub(a, n)], owner });
}

/** Inner line of an offset double bond, or an outer line of a triple. */
function offsetLine(ctx: Ctx, bond: Bond, p: Vec, q: Vec, u: Vec, side: 1 | -1, dash?: number[]) {
  const d = ctx.spacing;
  const n = scale(perp(u), side);
  const len = dist(p, q);
  const clip = axisClip(ctx, bond.begin, bond.end);
  if (!clip) return;

  const trim = (atom: AtomId, other: AtomId, toward: Vec): number => {
    if (ctx.labels.has(atom)) return 0;
    // Neighbours on this side, or collinear (which trims nothing).
    const all = neighbourDirs(ctx, atom, other);
    const dirs = all.filter((v) => dot(v, n) > -1e-6);
    // Measured: with no neighbour on this side (far-side neighbours only, or a
    // bare terminal CH2) ChemDraw runs the line right up to the atom.
    void all;
    if (!dirs.length) return 0;
    let best = Infinity;
    for (const v of dirs) best = Math.min(best, Math.acos(Math.max(-1, Math.min(1, dot(v, toward)))));
    return best >= Math.PI - 1e-6 ? 0 : d / Math.tan(best / 2);
  };

  const t0 = Math.max(clip[0], trim(bond.begin, bond.end, u) / len);
  const t1 = Math.min(clip[1], 1 - trim(bond.end, bond.begin, scale(u, -1)) / len);
  if (t1 - t0 <= 1e-3) return;
  const a = add(lerp(p, q, t0), scale(n, d));
  const b = add(lerp(p, q, t1), scale(n, d));
  if (dash) ctx.out.push({ kind: 'line', a, b, width: ctx.style.lineWidth, owner: { bond: bond.id }, dash });
  else rectLine(ctx, a, b, { bond: bond.id });
}

/**
 * Lines symmetric about the bond axis (C=O). At an unlabelled end with other
 * bonds each line runs on to the neighbouring bond's centreline on its side,
 * which is exactly where ChemDraw stops them.
 */
function centredLines(ctx: Ctx, bond: Bond, p: Vec, q: Vec, u: Vec, offsets: number[]) {
  const n = perp(u);
  const clip = axisClip(ctx, bond.begin, bond.end);
  if (!clip) return;
  for (const k of offsets) {
    const off = scale(n, k * ctx.spacing);
    let a = add(lerp(p, q, clip[0]), off);
    let b = add(lerp(p, q, clip[1]), off);
    a = meetNeighbour(ctx, bond.begin, bond.end, add(p, off), u, n, k) ?? a;
    b = meetNeighbour(ctx, bond.end, bond.begin, add(q, off), scale(u, -1), n, k) ?? b;
    rectLine(ctx, a, b, { bond: bond.id });
  }
}

function meetNeighbour(ctx: Ctx, atom: AtomId, other: AtomId, start: Vec, along: Vec, n: Vec, k: number): Vec | null {
  if (ctx.labels.has(atom)) return null;
  const origin = pos(ctx, atom);
  const dirs = neighbourDirs(ctx, atom, other).filter((v) => Math.sign(dot(v, n)) === Math.sign(k));
  if (!dirs.length) return null;
  const v = dirs.sort((x, y) => dot(y, along) - dot(x, along))[0]!;
  const hit = lineIntersection(start, along, origin, v);
  return hit && dot(sub(hit, origin), v) >= 0 ? hit : null;
}

function drawCrossed(ctx: Ctx, bond: Bond, p: Vec, q: Vec, u: Vec) {
  const n = perp(u);
  const h = ctx.spacing / 2;
  const clip = axisClip(ctx, bond.begin, bond.end);
  if (!clip) return;
  const a = lerp(p, q, clip[0]), b = lerp(p, q, clip[1]);
  rectLine(ctx, add(a, scale(n, h)), sub(b, scale(n, h)), { bond: bond.id });
  rectLine(ctx, sub(a, scale(n, h)), add(b, scale(n, h)), { bond: bond.id });
}

function drawWedge(ctx: Ctx, bond: Bond, narrow: AtomId, wide: AtomId) {
  addBody(ctx, bond, narrow, wide, ctx.style.lineWidth / 2, (WEDGE_WIDE * ctx.style.boldWidth) / 2);
}

function drawHash(ctx: Ctx, bond: Bond, narrow: AtomId, wide: AtomId) {
  const { style } = ctx;
  const p = pos(ctx, narrow), q = pos(ctx, wide);
  const clip = axisClip(ctx, narrow, wide);
  if (!clip) return;
  const len = dist(p, q);
  const u = normalize(sub(q, p));
  const n = perp(u);
  const lw = style.lineWidth;
  const sEnd = clip[1] * len;                 // distance of the visible wide end from the narrow atom
  const first = style.hashSpacing + lw / 2;   // centre of the hash nearest the narrow atom
  const last = sEnd - lw / 2;                 // centre of the outermost hash
  if (last <= first) return;
  const count = Math.floor((last - first) / style.hashSpacing) + 1;
  const pitch = count > 1 ? (last - first) / (count - 1) : 0;

  // Envelope: full width at the visible end, narrowing toward the stereocentre.
  const wideW = WEDGE_WIDE * style.boldWidth;
  const narrowW = Math.min(lw, Math.max(0, 1.24 * lw - 0.85));
  const width = (s: number) => narrowW + (wideW - narrowW) * (s / sEnd);

  for (let i = 0; i < count; i++) {
    const s = first + i * pitch;
    const s0 = s - lw / 2, s1 = s + lw / 2;
    const c0 = add(p, scale(u, s0)), c1 = add(p, scale(u, s1));
    const h0 = width(s0) / 2, h1 = width(s1) / 2;
    ctx.out.push({
      kind: 'polygon',
      points: [add(c0, scale(n, h0)), add(c1, scale(n, h1)), sub(c1, scale(n, h1)), sub(c0, scale(n, h0))],
      owner: { bond: bond.id },
    });
  }
}

function drawWavy(ctx: Ctx, bond: Bond) {
  const p = pos(ctx, bond.begin), q = pos(ctx, bond.end);
  const clip = axisClip(ctx, bond.begin, bond.end);
  if (!clip) return;
  const len = dist(p, q);
  const u = normalize(sub(q, p));
  const n = perp(u);
  const strokeW = Math.round(ctx.style.lineWidth * 20) / 20;
  const start = lerp(p, q, clip[0]);
  const span = (clip[1] - clip[0]) * len - (ctx.labels.has(bond.end) ? 0 : strokeW / 2);
  const halves = Math.max(1, Math.round(span / WAVE_DIAMETER - 0.5)) + 0.5;
  const diameter = span / halves;
  const r = diameter / 2;
  const K = 0.5523 * r; // cubic Bezier quarter-circle handle

  const f = (v: Vec) => `${(Math.round(v.x * 100) / 100)},${(Math.round(v.y * 100) / 100)}`;
  const at = (s: number, side: number) => add(add(start, scale(u, s)), scale(n, side));
  let d = `M ${f(start)}`;
  const quarters = Math.round(halves * 2);
  for (let i = 0; i < quarters; i++) {
    const half = Math.floor(i / 2);
    const sign = half % 2 === 0 ? -1 : 1; // first bump on the clockwise side, as measured
    const s0 = half * diameter;
    if (i % 2 === 0) {
      // From the axis up to the crest.
      d += ` C ${f(at(s0, sign * K))} ${f(at(s0 + r - K, sign * r))} ${f(at(s0 + r, sign * r))}`;
    } else {
      d += ` C ${f(at(s0 + r + K, sign * r))} ${f(at(s0 + diameter, sign * K))} ${f(at(s0 + diameter, 0))}`;
    }
  }
  ctx.out.push({ kind: 'path', d, width: strokeW, owner: { bond: bond.id } });
}

function drawAromaticCircle(ctx: Ctx, ring: Ring) {
  const c = centroid(ctx, ring);
  let inradius = Infinity;
  for (let i = 0; i < ring.atoms.length; i++) {
    const a = pos(ctx, ring.atoms[i]!), b = pos(ctx, ring.atoms[(i + 1) % ring.atoms.length]!);
    inradius = Math.min(inradius, dist(c, lerp(a, b, 0.5)));
  }
  ctx.out.push({ kind: 'circle', c, r: inradius * AROMATIC_CIRCLE_FRACTION, width: ctx.style.lineWidth, owner: {} });
}

function boundsOf(prims: Primitive[], labels: Map<AtomId, AtomLabel>, style: DrawingStyle): Rect {
  let r: Rect = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  const grow = (p: Vec, m = 0) => {
    r = { x0: Math.min(r.x0, p.x - m), y0: Math.min(r.y0, p.y - m), x1: Math.max(r.x1, p.x + m), y1: Math.max(r.y1, p.y + m) };
  };
  for (const pr of prims) {
    if (pr.kind === 'line') { grow(pr.a, pr.width / 2); grow(pr.b, pr.width / 2); }
    else if (pr.kind === 'polygon') pr.points.forEach((p) => grow(p));
    else if (pr.kind === 'circle') grow(pr.c, pr.r + pr.width);
    else if (pr.kind === 'path') for (const m of pr.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) grow(vec(+m[1]!, +m[2]!), pr.width);
    else if (pr.kind === 'fillPath') for (const m of pr.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)) grow(vec(+m[1]!, +m[2]!));
    else if (pr.kind === 'text' && pr.caption) {
      grow(vec(pr.run.x, pr.run.y - pr.run.size * 0.75));
      grow(vec(pr.run.x + textWidth(pr.run.text, pr.run.size, !!pr.bold), pr.run.y + pr.run.size * 0.25));
    }
  }
  void style;
  for (const l of labels.values()) { grow(vec(l.bounds.x0, l.bounds.y0)); grow(vec(l.bounds.x1, l.bounds.y1)); }
  if (!Number.isFinite(r.x0)) r = { x0: 0, y0: 0, x1: 0, y1: 0 };
  return r;
}
