import { curvePolyline, makeArrow, smilesAtomMaps, type AtomId, type DocObject, type DrawingStyle, type Molecule } from '@hexsketch/core';
import { depict } from '@hexsketch/render';

/**
 * Electron-pushing (curly) arrows the AI draws on a mechanism: from a lone
 * pair or a bond to an atom or a bond, with atoms named by their atom-map
 * numbers in the SMILES ([O-:1]). HexSketch places each arrow: it leaves
 * the lone pair or bond and arrives just short of its target, bowing to the
 * side where it crosses nothing (no bonds, no atom labels, no other arrow),
 * outward from the structure where it can.
 */

export interface ElectronArrow {
  /** Atom-map numbers: [a], a lone pair on atom a; [a, b], the bond a–b. */
  from: number[];
  /** Atom-map numbers: [c], onto atom c; [c, d], into the bond c–d, existing or being made. */
  to: number[];
  /** 2 (default) for a pair, a full arrowhead; 1 for a single electron, a fishhook. */
  electrons?: 1 | 2;
  color?: string;
}

type Pt = { x: number; y: number };
interface Box { x0: number; y0: number; x1: number; y1: number }

const sub = (a: Pt, b: Pt) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Pt) => Math.hypot(a.x, a.y);
const unit = (a: Pt) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
const along = (p: Pt, u: Pt, d: number) => ({ x: p.x + u.x * d, y: p.y + u.y * d });
/** Turned by `t` radians (clockwise on screen, where y points down). */
const turn = (u: Pt, t: number) => ({ x: u.x * Math.cos(t) - u.y * Math.sin(t), y: u.x * Math.sin(t) + u.y * Math.cos(t) });

/** Where a curly arrow ends near an atom, a bond's midpoint, or a point on the way to an atom. */
type End = { kind: 'atom'; id: AtomId } | { kind: 'bond'; a: AtomId; b: AtomId };

export function electronArrows(mol: Molecule, objects: readonly DocObject[], style: DrawingStyle, arrows: readonly ElectronArrow[]): DocObject[] {
  if (!arrows.length) return [];
  const maps = smilesAtomMaps(mol);
  if (!maps.size) throw new Error('Curly arrows point at atoms by their atom-map numbers: give the structure as SMILES with them, e.g. "[OH-:1].[CH3:2][Br:3]"');
  const atomOf = (n: number, where: string) => {
    const id = maps.get(n);
    if (id === undefined) throw new Error(`${where}: no atom has map number ${n} (the structure maps ${[...maps.keys()].sort((p, q) => p - q).join(', ')})`);
    return id;
  };
  const L = style.bondLength, gap = L * 0.1;
  const labels = depict(mol, style).labels;
  const pos = (id: AtomId): Pt => mol.atom(id);
  /** From an atom's centre along u to just clear of its label (or of the bare corner). */
  const clear = (id: AtomId, u: Pt) => {
    const b = labels.get(id)?.bounds;
    if (!b) return L * 0.16;
    const a = pos(id), hw = Math.max(a.x - b.x0, b.x1 - a.x), hh = Math.max(a.y - b.y0, b.y1 - a.y);
    return Math.min(Math.abs(u.x) > 1e-9 ? hw / Math.abs(u.x) : Infinity, Math.abs(u.y) > 1e-9 ? hh / Math.abs(u.y) : Infinity) + gap;
  };
  const boxes: Box[] = [...labels.values()].map((l) => l.bounds);
  const bonds = [...mol.bonds()].map((b) => ({ b, p: pos(b.begin), q: pos(b.end) }));
  const atoms = [...mol.atoms()];
  const centre = atoms.reduce((c, a) => ({ x: c.x + a.x / atoms.length, y: c.y + a.y / atoms.length }), { x: 0, y: 0 });
  const placed: Pt[][] = [];
  for (const o of objects) if (o.kind === 'arrow' && o.curve?.length) placed.push(curvePolyline(o.curve, 16));

  /** The places an arrow can leave or reach an end, each with the direction out of it and a small cost for a poor one. */
  const ports = (e: End): { p: Pt; d: Pt; cost: number }[] => {
    if (e.kind === 'bond') {
      const p = pos(e.a), q = pos(e.b), m = mid(p, q);
      if (!mol.bondBetween(e.a, e.b)) return directions(12).map((d) => ({ p: along(m, d, L * 0.1), d, cost: 0 }));
      const u = unit(sub(q, p));
      return [turn(u, Math.PI / 2), turn(u, -Math.PI / 2)].map((d) => ({ p: along(m, d, L * 0.15), d, cost: 0 }));
    }
    const a = pos(e.id);
    const out = mol.neighbours(e.id).map((n) => unit(sub(pos(n), a)));
    return directions(12).map((d) => {
      // Not along one of its own bonds.
      const near = Math.max(-1, ...out.map((u) => u.x * d.x + u.y * d.y));
      return { p: along(a, d, clear(e.id, d)), d, cost: near > Math.cos(Math.PI / 5) ? 4 : 0 };
    });
  };

  const out: DocObject[] = [];
  arrows.forEach((arrow, i) => {
    const where = `Arrow ${i + 1}`;
    if (arrow.from.length < 1 || arrow.from.length > 2 || arrow.to.length < 1 || arrow.to.length > 2) throw new Error(`${where}: from and to each name one atom (a lone pair, an atom) or two (a bond)`);
    const from: End = arrow.from.length === 1 ? { kind: 'atom', id: atomOf(arrow.from[0]!, where) } : { kind: 'bond', a: atomOf(arrow.from[0]!, where), b: atomOf(arrow.from[1]!, where) };
    if (from.kind === 'bond' && !mol.bondBetween(from.a, from.b)) throw new Error(`${where}: atoms ${arrow.from[0]} and ${arrow.from[1]} are not bonded, so there is no bond for the electrons to come from`);
    let to: End = arrow.to.length === 1 ? { kind: 'atom', id: atomOf(arrow.to[0]!, where) } : { kind: 'bond', a: atomOf(arrow.to[0]!, where), b: atomOf(arrow.to[1]!, where) };
    // A bond being made from the atom (or bond) the electrons leave: the arrow goes to the other atom.
    if (to.kind === 'bond' && !mol.bondBetween(to.a, to.b)) {
      const inFrom = (id: AtomId) => (from.kind === 'atom' ? from.id === id : from.a === id || from.b === id);
      if (inFrom(to.a) && !inFrom(to.b)) to = { kind: 'atom', id: to.b };
      else if (inFrom(to.b) && !inFrom(to.a)) to = { kind: 'atom', id: to.a };
    }
    const ends = new Set([from, to].flatMap((e) => (e.kind === 'atom' ? [e.id] : [e.a, e.b])));
    const own = new Set([from, to].filter((e): e is Extract<End, { kind: 'bond' }> => e.kind === 'bond').map((e) => mol.bondBetween(e.a, e.b)?.id).filter((x) => x !== undefined));

    // Each end is a point and the way the curve leaves (or arrives at) it: a lone pair or an atom from any
    // side clear of its bonds, a bond square to it from either side, a bond being made from its middle.
    const tails = ports(from), heads = ports(to);
    let best: { curve: Pt[]; score: number } | null = null;
    for (const t of tails) {
      for (const h of heads) {
        const chord = len(sub(h.p, t.p));
        if (chord < L * 0.25) continue;
        for (const k of [0.45, 0.7]) {
          const reach = Math.min(L * 1.2, Math.max(L * 0.55, chord * k));
          const curve = [t.p, along(t.p, t.d, reach), along(h.p, h.d, reach), h.p];
          const score = rate(curve, t.d, h.d) + t.cost + h.cost;
          if (!best || score < best.score) best = { curve, score };
        }
      }
    }
    if (!best) throw new Error(`${where}: its ends are the same place; point it from a lone pair or bond to a different atom or bond`);
    const a = makeArrow(best.curve[0]!, best.curve[3]!, arrow.electrons === 1 ? 'radical' : 'electron');
    a.curve = best.curve;
    a.color = arrow.color ?? null;
    out.push(a);
    placed.push(curvePolyline(best.curve, 16));

    /** Lower is better: crossings first, then a clean C-shaped sweep, then shortness and bowing outward. */
    function rate(curve: Pt[], dt: Pt, dh: Pt): number {
      const line = curvePolyline(curve, 24);
      let cost = 0;
      for (let k = 1; k < line.length; k++) {
        const p = line[k - 1]!, q = line[k]!;
        for (const { b, p: x, q: y } of bonds) if (!own.has(b.id) && crosses(p, q, x, y)) cost += 10;
        for (const other of placed) for (let j = 1; j < other.length; j++) if (crosses(p, q, other[j - 1]!, other[j]!)) cost += 4;
      }
      for (const p of line.slice(2, -2)) {
        for (const b of boxes) if (p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) cost += 3;
        for (const x of atoms) if (!ends.has(x.id) && len(sub(p, x)) < L * 0.3) cost += 2;
      }
      const chord = unit(sub(curve[3]!, curve[0]!));
      // Both ends bulge to the same side of the chord (a C, not an S), leaving and arriving at a slant.
      const sideT = cross(chord, dt), sideH = cross(chord, dh);
      if (sideT * sideH < 0) cost += 4;
      const slant = (u: Pt, w: Pt) => Math.acos(Math.max(-1, Math.min(1, u.x * w.x + u.y * w.y)));
      for (const t of [slant(dt, chord), slant(dh, { x: -chord.x, y: -chord.y })]) {
        if (t < Math.PI / 6) cost += (Math.PI / 6 - t) * 4;
        if (t > (2 * Math.PI) / 3) cost += (t - (2 * Math.PI) / 3) * 4;
      }
      let length = 0;
      for (let k = 1; k < line.length; k++) length += len(sub(line[k]!, line[k - 1]!));
      cost += (length / L) * 0.4;
      // Short arrows need room for the head: at least a bond's length of curve.
      if (length < L * 1.1) cost += ((L * 1.1 - length) / L) * 8;
      const apex = line[Math.floor(line.length / 2)]!, chordMid = mid(line[0]!, line.at(-1)!);
      cost -= Math.max(-1, Math.min(0.5, (len(sub(apex, centre)) - len(sub(chordMid, centre))) / L)) * 0.6;
      return cost;
    }
  });
  return out;
}

/**
 * Bring the separate structures of a mechanism together, so an arrow from one
 * to another is short: the smaller one moves (without turning) until the atom
 * the electrons leave sits about 1.7 bonds from the atom they go to, on that
 * atom's open side and clear of everything else. Each structure moves once.
 */
export function arrangeForArrows(mol: Molecule, arrows: readonly ElectronArrow[], bondLength: number): void {
  const maps = smilesAtomMaps(mol);
  const frags = mol.fragments();
  if (frags.length < 2 || !maps.size) return;
  const fragOf = new Map<AtomId, number>();
  frags.forEach((f, i) => f.forEach((id) => fragOf.set(id, i)));
  const moved = new Set<number>();
  const L = bondLength;
  for (const arrow of arrows) {
    const src = maps.get(arrow.from[0]!);
    // The atom the electrons go to: the far one of a bond being made, else the first named.
    const dst = [...arrow.to].map((n) => maps.get(n)).find((id) => id !== undefined && fragOf.get(id) !== fragOf.get(src!));
    if (src === undefined || dst === undefined) continue;
    const fs = fragOf.get(src)!, fd = fragOf.get(dst)!;
    if (fs === fd) continue;
    // The smaller structure comes to the larger, unless that one has moved already.
    const [mover, anchor, stay] = (frags[fs]!.length <= frags[fd]!.length && !moved.has(fs)) || moved.has(fd) ? [fs, src, dst] : [fd, dst, src];
    if (moved.has(mover)) continue;
    const s = mol.atom(stay), a = mol.atom(anchor);
    const open = openDirection(mol, stay, unit(sub(a, s)));
    const others = [...mol.atoms()].filter((x) => fragOf.get(x.id) !== mover);
    const ids = frags[mover]!;
    const start = ids.map((id) => ({ id, x: mol.atom(id).x - a.x, y: mol.atom(id).y - a.y }));
    for (let d = 1.7; d < 6; d += 0.3) {
      const at = along(s, open, d * L);
      const clearOfAll = start.every((p) => others.every((o) => len(sub({ x: at.x + p.x, y: at.y + p.y }, o)) > L * 1.1));
      if (clearOfAll || d + 0.3 >= 6) {
        for (const p of start) { const x = mol.atom(p.id); x.x = at.x + p.x; x.y = at.y + p.y; }
        break;
      }
    }
    moved.add(mover);
  }
}

/** The middle of an atom's widest gap between bonds, or (for ties) the one nearest `prefer`. */
function openDirection(mol: Molecule, id: AtomId, prefer: Pt): Pt {
  const a = mol.atom(id);
  const angles = mol.neighbours(id).map((n) => Math.atan2(mol.atom(n).y - a.y, mol.atom(n).x - a.x)).sort((p, q) => p - q);
  if (!angles.length) return prefer;
  let best = prefer, bestGap = -1, bestDot = -2;
  angles.forEach((t, i) => {
    const next = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
    const gap = next - t, m = t + gap / 2, u = { x: Math.cos(m), y: Math.sin(m) };
    const dot = u.x * prefer.x + u.y * prefer.y;
    if (gap > bestGap + 0.05 || (Math.abs(gap - bestGap) <= 0.05 && dot > bestDot)) { best = u; bestGap = gap; bestDot = dot; }
  });
  return best;
}

/** n directions evenly round the circle. */
const directions = (n: number): Pt[] => Array.from({ length: n }, (_, k) => ({ x: Math.cos((2 * Math.PI * k) / n), y: Math.sin((2 * Math.PI * k) / n) }));

const mid = (a: Pt, b: Pt) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const cross = (u: Pt, w: Pt) => u.x * w.y - u.y * w.x;

function crosses(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}
