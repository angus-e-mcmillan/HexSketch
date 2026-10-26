import { computeMass, formatHill, makeShape, smilesAtomMaps, type DocObject, type DrawingStyle, type Molecule } from '@hexsketch/core';

/**
 * Retrosynthesis and bookkeeping: the wavy marks that show where a target
 * is disconnected, and the atom count either side of a step, so a missing
 * byproduct or a hydrogen from nowhere is caught before the chemist sees it.
 */

/** A wavy line across each bond named by its atoms' map numbers ([[2, 3]]), as a disconnection is marked. */
export function disconnectionMarks(mol: Molecule, style: DrawingStyle, bonds: readonly number[][], color: string | null = null): DocObject[] {
  const maps = smilesAtomMaps(mol);
  if (bonds.length && !maps.size) throw new Error('Disconnections name bonds by their atoms\' map numbers: give the target as SMILES with them, e.g. "c1ccccc1[C:1](=O)[NH:2]C"');
  const L = style.bondLength;
  return bonds.map((pair, i) => {
    const where = `Disconnection ${i + 1}`;
    if (pair.length !== 2) throw new Error(`${where}: name a bond by its two atoms' map numbers, e.g. [1, 2]`);
    const [a, b] = pair.map((n) => {
      const id = maps.get(n);
      if (id === undefined) throw new Error(`${where}: no atom has map number ${n}`);
      return id;
    }) as [number, number];
    if (!mol.bondBetween(a, b)) throw new Error(`${where}: atoms ${pair[0]} and ${pair[1]} are not bonded`);
    const p = mol.atom(a), q = mol.atom(b);
    const m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const n = { x: -(q.y - p.y) / d, y: (q.x - p.x) / d };
    const h = L * 0.6;
    return makeShape('line', [{ x: m.x - n.x * h, y: m.y - n.y * h }, { x: m.x + n.x * h, y: m.y + n.y * h }], { line: 'wavy', color });
  });
}

/** What does not balance across a step: atoms only on the left (lost), only on the right (gained), and the change in charge. */
export interface Imbalance { lost: string; gained: string; charge: number }

export function imbalance(before: Molecule, after: Molecule): Imbalance | null {
  const l = computeMass(before), r = computeMass(after);
  const lost = new Map<string, number>(), gained = new Map<string, number>();
  for (const el of new Set([...l.counts.keys(), ...r.counts.keys()])) {
    const d = (l.counts.get(el) ?? 0) - (r.counts.get(el) ?? 0);
    if (d > 0) lost.set(el, d);
    else if (d < 0) gained.set(el, -d);
  }
  const charge = r.charge - l.charge;
  if (!lost.size && !gained.size && !charge) return null;
  return { lost: formatHill(lost), gained: formatHill(gained), charge };
}

/** The imbalance in words, for a tool result: "H2O on the left is not on the right". */
export function describeImbalance(x: Imbalance): string {
  const parts: string[] = [];
  if (x.lost) parts.push(`${x.lost} on the left is not on the right`);
  if (x.gained) parts.push(`${x.gained} on the right is not on the left`);
  if (x.charge) parts.push(`the charge changes by ${x.charge > 0 ? '+' : ''}${x.charge}`);
  return parts.join('; ');
}
