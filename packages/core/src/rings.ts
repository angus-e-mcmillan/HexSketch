import type { AtomId, BondId, Molecule } from './model.ts';

export interface Ring {
  /** Atoms in cyclic order. */
  atoms: AtomId[];
  /** Bonds in the same cyclic order: bonds[i] joins atoms[i] and atoms[i+1]. */
  bonds: BondId[];
}

/**
 * Smallest ring through every ring bond.
 *
 * For each bond we look for the shortest path between its two atoms that does
 * not use the bond itself; that path plus the bond is the smallest ring the
 * bond belongs to. Duplicates are merged. This is not a full SSSR (it can miss
 * an envelope ring in cage systems) but it is exactly what depiction needs:
 * every ring bond gets the ring it should draw its double bond inside.
 */
export function perceiveRings(mol: Molecule): Ring[] {
  const rings: Ring[] = [];
  const seen = new Set<string>();

  for (const bond of mol.bonds()) {
    const path = shortestPathAvoiding(mol, bond.begin, bond.end, bond.id);
    if (!path) continue;
    const key = [...path].sort((a, b) => a - b).join(',');
    if (seen.has(key)) continue;
    seen.add(key);

    const bonds: BondId[] = [];
    for (let i = 0; i < path.length; i++) {
      const a = path[i]!;
      const b = path[(i + 1) % path.length]!;
      bonds.push(mol.bondBetween(a, b)!.id);
    }
    rings.push({ atoms: path, bonds });
  }
  return rings;
}

function shortestPathAvoiding(mol: Molecule, from: AtomId, to: AtomId, skip: BondId): AtomId[] | null {
  const prev = new Map<AtomId, AtomId>();
  prev.set(from, from);
  const queue: AtomId[] = [from];
  while (queue.length) {
    const current = queue.shift()!;
    if (current === to) break;
    for (const bondId of mol.incidentBonds(current)) {
      if (bondId === skip) continue;
      const next = mol.otherAtom(mol.bond(bondId), current);
      if (prev.has(next)) continue;
      prev.set(next, current);
      queue.push(next);
    }
  }
  if (!prev.has(to)) return null;
  const path: AtomId[] = [];
  for (let a = to; a !== from; a = prev.get(a)!) path.push(a);
  path.push(from);
  return path.reverse();
}

/** Index rings by bond, smallest first, so the depiction can pick the right side. */
export function ringsByBond(rings: readonly Ring[]): Map<BondId, Ring[]> {
  const out = new Map<BondId, Ring[]>();
  for (const ring of rings) {
    for (const b of ring.bonds) {
      const list = out.get(b) ?? [];
      list.push(ring);
      out.set(b, list);
    }
  }
  for (const list of out.values()) list.sort((a, b) => a.atoms.length - b.atoms.length);
  return out;
}
