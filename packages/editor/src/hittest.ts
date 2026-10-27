import { distanceToObject, insideShape, objectPolylines, type AtomId, type BondId, type DocObject, type DrawingStyle, type Molecule } from '@hexsketch/core';
import { captionBounds, isMethyl } from '@hexsketch/render';
import type { Depiction } from '@hexsketch/render';

export type Hit = { kind: 'atom'; id: AtomId } | { kind: 'bond'; id: BondId } | { kind: 'object'; id: number } | { kind: 'none' };

/**
 * What is under the pointer. Atoms win over bonds, as in ChemDraw: within
 * 30% of a bond length of an atom centre (or inside its label) the atom is hit;
 * otherwise a bond within 20% of a bond length of its axis.
 */
export function hitTest(mol: Molecule, dep: Depiction | null, x: number, y: number, L: number): Hit {
  let bestAtom: AtomId | null = null, bestA = L * 0.3;
  for (const a of mol.atoms()) {
    const d = Math.hypot(a.x - x, a.y - y);
    // A methyl's "Me" is picked like the line end it stands for, so its bond stays easy to click.
    const label = dep && !isMethyl(mol, a.id, dep.style) ? dep.labels.get(a.id) : undefined;
    const inLabel = label && x >= label.bounds.x0 && x <= label.bounds.x1 && y >= label.bounds.y0 && y <= label.bounds.y1;
    if (inLabel && d < bestA + L) { bestAtom = a.id; bestA = Math.min(bestA, d); continue; }
    if (d <= bestA) { bestA = d; bestAtom = a.id; }
  }
  if (bestAtom !== null) return { kind: 'atom', id: bestAtom };

  let bestBond: BondId | null = null, bestB = L * 0.2;
  for (const b of mol.bonds()) {
    const p = mol.atom(b.begin), q = mol.atom(b.end);
    const dx = q.x - p.x, dy = q.y - p.y, len2 = dx * dx + dy * dy;
    const t = len2 ? ((x - p.x) * dx + (y - p.y) * dy) / len2 : 0;
    if (t < 0.15 || t > 0.85) continue;
    const d = Math.hypot(x - (p.x + t * dx), y - (p.y + t * dy));
    if (d <= bestB) { bestB = d; bestBond = b.id; }
  }
  return bestBond !== null ? { kind: 'bond', id: bestBond } : { kind: 'none' };
}

/** Atoms and bonds wholly inside a rectangle (marquee selection). */
export function inRect(mol: Molecule, x0: number, y0: number, x1: number, y1: number) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)];
  const [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const atoms = new Set<AtomId>();
  for (const a of mol.atoms()) if (a.x >= ax && a.x <= bx && a.y >= ay && a.y <= by) atoms.add(a.id);
  const bonds = new Set<BondId>();
  for (const b of mol.bonds()) if (atoms.has(b.begin) && atoms.has(b.end)) bonds.add(b.id);
  return { atoms, bonds };
}

/** Even-odd point-in-polygon, for the lasso. */
export function inLasso(mol: Molecule, poly: { x: number; y: number }[]) {
  const inside = (x: number, y: number) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i]!, b = poly[j]!;
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  const atoms = new Set<AtomId>();
  for (const a of mol.atoms()) if (inside(a.x, a.y)) atoms.add(a.id);
  const bonds = new Set<BondId>();
  for (const b of mol.bonds()) if (atoms.has(b.begin) && atoms.has(b.end)) bonds.add(b.id);
  return { atoms, bonds };
}

/** Arrow or drawing element (within 4 pt of its outline, or inside a filled shape) or caption (inside its box) under the pointer. */
export function hitObject(objects: readonly DocObject[], style: DrawingStyle, x: number, y: number): number | null {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]!;
    if (o.kind === 'text') {
      const b = captionBounds(o, style);
      if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1) return o.id;
    } else {
      if (distanceToObject(o, { x, y }) <= 4 + style.lineWidth) return o.id;
      if (o.kind === 'shape' && o.fill !== 'none' && insideShape(o, { x, y })) return o.id;
    }
  }
  return null;
}

/** Objects wholly inside a rectangle. */
export function objectsInRect(objects: readonly DocObject[], style: DrawingStyle, x0: number, y0: number, x1: number, y1: number): Set<number> {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)], [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const inside = (x: number, y: number) => x >= ax && x <= bx && y >= ay && y <= by;
  const out = new Set<number>();
  for (const o of objects) {
    if (o.kind !== 'text' ? objectPolylines(o).flat().every((p) => inside(p.x, p.y))
      : (() => { const b = captionBounds(o, style); return inside(b.x0, b.y0) && inside(b.x1, b.y1); })()) out.add(o.id);
  }
  return out;
}
