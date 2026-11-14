import { perceiveRings, type AtomId, type BondId, type Molecule } from '@hexsketch/core';

/**
 * Where ChemDraw puts new atoms. Every rule here was measured on ChemDraw 20.1.
 * Angles are screen angles in
 * radians: 0 points right, positive turns clockwise because y grows downward.
 */

const DEG = Math.PI / 180;
export const DEFAULT_BOND_ANGLE = -30 * DEG;
/** Fixed Angles: drags snap to multiples of 15 degrees. */
export const SNAP = 15 * DEG;

const norm = (a: number) => {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
};

export function snapAngle(a: number): number {
  return norm(Math.round(a / SNAP) * SNAP);
}

function neighbourAngles(mol: Molecule, id: AtomId): number[] {
  const a = mol.atom(id);
  return mol.neighbours(id).map((n) => {
    const b = mol.atom(n);
    return Math.atan2(b.y - a.y, b.x - a.x);
  });
}

/**
 * Bisector of the largest angular gap; ties go to the first gap in ascending
 * angle order. `inside` names gaps not to use while another is free: the
 * inside of a ring, where a substituent is never drawn (on a seven-ring the
 * inside is the widest gap there is).
 */
export function largestGapBisector(angles: number[], inside: [number, number][] = []): number {
  const sorted = angles.map(norm).sort((x, y) => x - y);
  const same = (x: number, y: number) => Math.abs(norm(x - y)) < 1e-6;
  const isInside = (a: number, b: number) => inside.some(([p, q]) => (same(a, p) && same(b, q)) || (same(a, q) && same(b, p)));
  const pick = (skipInside: boolean) => {
    let best: number | null = null, bestGap = -Infinity;
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i]!;
      const b = i + 1 < sorted.length ? sorted[i + 1]! : sorted[0]! + 2 * Math.PI;
      const gap = b - a;
      // A ring's inside is the gap under 180 degrees between its two bonds.
      if (skipInside && gap < Math.PI && isInside(a, b)) continue;
      if (gap > bestGap + 1e-6) { bestGap = gap; best = a + gap / 2; }
    }
    return best;
  };
  return norm(pick(inside.length > 0) ?? pick(false) ?? -1);
}

/**
 * Direction of a bond added by clicking an atom with a bond tool ("cyclic
 * mode", also hotkey 0). Degree 0: the default angle. Degree 1: the existing
 * bond rotated by +120 degrees, so repeated clicks curl round like a ring.
 * Higher degree: the bisector of the largest free gap.
 */
export function cyclicDirection(mol: Molecule, id: AtomId, chainAngle = 120, newOrder = 1): number {
  const angles = neighbourAngles(mol, id);
  if (angles.length === 0) return DEFAULT_BOND_ANGLE;
  if (angles.length === 1) return straightOn(mol, id, newOrder) ?? norm(angles[0]! + chainAngle * DEG);
  return largestGapBisector(angles, ringInteriors(mol, id));
}

/**
 * An atom with two double bonds or a triple bond is linear: a bond added to
 * the end of a triple bond, or a second double bond to the end of a double
 * bond (an allene, a ketene, an isocyanate), goes straight on. Null otherwise.
 */
function straightOn(mol: Molecule, id: AtomId, newOrder: number): number | null {
  const bonds = mol.incidentBonds(id);
  if (bonds.length !== 1) return null;
  const order = mol.bond(bonds[0]!).order;
  if (!(order === 3 || newOrder === 3 || (order === 2 && newOrder === 2))) return null;
  return norm(neighbourAngles(mol, id)[0]! + Math.PI);
}

/** The directions from a ring atom that point into a ring it is in: between its two bonds of that ring. */
function ringInteriors(mol: Molecule, id: AtomId): [number, number][] {
  const out: [number, number][] = [];
  const a = mol.atom(id);
  for (const ring of perceiveRings(mol)) {
    const i = ring.atoms.indexOf(id);
    if (i < 0) continue;
    const n = ring.atoms.length;
    const [p, q] = [ring.atoms[(i + n - 1) % n]!, ring.atoms[(i + 1) % n]!].map((x) => Math.atan2(mol.atom(x).y - a.y, mol.atom(x).x - a.x)) as [number, number];
    out.push([norm(p), norm(q)]);
  }
  return out;
}

/**
 * "Linear mode" (hotkey 1): continue a chain as a zigzag. On a degree-1 atom
 * the new bond goes 120 degrees from the existing one, on the side away from
 * the grandparent so the chain stays trans; otherwise as cyclic mode.
 */
export function linearDirection(mol: Molecule, id: AtomId, chainAngle = 120, newOrder = 1): number {
  const angles = neighbourAngles(mol, id);
  if (angles.length !== 1) return cyclicDirection(mol, id, chainAngle, newOrder);
  const straight = straightOn(mol, id, newOrder);
  if (straight !== null) return straight;
  const parent = mol.neighbours(id)[0]!;
  const back = angles[0]!;
  const options = [norm(back + chainAngle * DEG), norm(back - chainAngle * DEG)];
  const grand = mol.neighbours(parent).filter((n) => n !== id);
  // No chain context: take the option cyclic mode does not, giving a zigzag.
  if (!grand.length) return options[1]!;
  // Trans: pick the option on the opposite side of the parent->id axis from the grandparent.
  const p = mol.atom(parent), a = mol.atom(id), g = mol.atom(grand[0]!);
  const axis = { x: a.x - p.x, y: a.y - p.y };
  const side = (x: number, y: number) => Math.sign(axis.x * (y - p.y) - axis.y * (x - p.x));
  const gSide = side(g.x, g.y);
  for (const o of options) {
    const q = { x: a.x + Math.cos(o), y: a.y + Math.sin(o) };
    if (side(q.x, q.y) !== gSide) return o;
  }
  return options[0]!;
}

export interface RingSpec {
  size: number;
  aromatic: boolean;
}

/** Vertices of a regular ring with side `L`, centred at (cx, cy), first vertex at `startAngle`. */
export function ringVertices(cx: number, cy: number, size: number, L: number, startAngle = -Math.PI / 2) {
  const R = L / (2 * Math.sin(Math.PI / size));
  return Array.from({ length: size }, (_, i) => {
    const t = startAngle + (2 * Math.PI * i) / size;
    return { x: cx + R * Math.cos(t), y: cy + R * Math.sin(t) };
  });
}

/**
 * Apply alternating double bonds around a six-ring as ChemDraw does: for a
 * free-standing benzene, double bonds on the edges whose midpoints point to
 * 180, 60 and -60 degrees; when fused, start so that existing double bonds
 * are respected and the shared bond takes part.
 */
export function kekulize(mol: Molecule, ringAtoms: AtomId[], ringBonds: BondId[], prefer?: BondId): void {
  const n = ringBonds.length;
  if (n % 2 !== 0) {
    // Cyclopentadiene and friends: alternate from the first edge, leaving the last pair single.
    for (let i = 0; i < n - 1; i += 2) mol.bond(ringBonds[i]!).order = 2;
    return;
  }
  const hasExternalDouble = (atom: AtomId, ringBond: BondId) =>
    mol.incidentBonds(atom).some((b) => b !== ringBond && !ringBonds.includes(b) && mol.bond(b).order === 2);

  const tryPhase = (phase: number): boolean => {
    for (let i = 0; i < n; i++) {
      if (i % 2 !== phase) continue;
      const b = mol.bond(ringBonds[i]!);
      if (hasExternalDouble(b.begin, b.id) || hasExternalDouble(b.end, b.id)) return false;
    }
    return true;
  };

  let phase = 0;
  // Prefer the phase that keeps a pre-existing ring double bond, else the
  // one geometry dictates (edge midpoint at 180 degrees for a fresh ring).
  const existing = ringBonds.findIndex((b) => mol.bond(b).order === 2);
  const preferred = prefer !== undefined ? ringBonds.indexOf(prefer) : -1;
  if (existing >= 0) phase = existing % 2;
  // A fused ring puts a double bond on the shared edge when it can (measured).
  else if (preferred >= 0 && tryPhase(preferred % 2)) phase = preferred % 2;
  else {
    const cx = ringAtoms.reduce((s, a) => s + mol.atom(a).x, 0) / ringAtoms.length;
    const cy = ringAtoms.reduce((s, a) => s + mol.atom(a).y, 0) / ringAtoms.length;
    const midAngle = (b: BondId) => {
      const bd = mol.bond(b), p = mol.atom(bd.begin), q = mol.atom(bd.end);
      return Math.atan2((p.y + q.y) / 2 - cy, (p.x + q.x) / 2 - cx);
    };
    const leftEdge = ringBonds.findIndex((b) => Math.abs(Math.abs(midAngle(b)) - Math.PI) < 0.05);
    if (leftEdge >= 0) phase = leftEdge % 2;
  }
  if (!tryPhase(phase)) phase = 1 - phase;
  if (!tryPhase(phase)) return;
  ringBonds.forEach((b, i) => { mol.bond(b).order = i % 2 === phase ? 2 : 1; });
}
