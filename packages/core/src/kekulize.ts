/**
 * Delocalised rings, as a circle, made into alternating single and double
 * bonds. ChemDraw writes such a ring as bonds of order 1.5 (CDXML
 * `Order="1.5"`, molfile bond type 4), and so do many SD files; read as they
 * stand, those bonds count as single, so benzene reads as cyclohexane and
 * every formula, mass, name and comparison after it is wrong. Drawing one
 * Kekulé form is also what a chemist wants to see.
 *
 * Which atom takes a double bond is decided as a matching over the
 * delocalised bonds: every neutral carbon with room must get one, while a
 * heteroatom or a charged atom may instead give its lone pair or its charge
 * to the ring, as the N of pyrrole does and the C+ of tropylium. A ring
 * system no matching covers (an open-ended fragment, a drawing that means
 * nothing on its own) is left as it was, rather than guessed at.
 */
import type { AtomId, Molecule } from './model.ts';
import { elementBySymbol } from './elements.ts';

/** How many more bonds an atom could take, counting each delocalised bond as one. */
function room(mol: Molecule, id: AtomId): number {
  const atom = mol.atom(id);
  if (atom.label !== null) return 0;
  const el = elementBySymbol(atom.element);
  if (!el || !el.valences.length) return 0;
  let used = atom.radical + (atom.explicitHydrogens ?? 0);
  for (const b of mol.incidentBonds(id)) { const o = mol.bond(b).order; used += o === 1.5 ? 1 : o; }
  // A charge adds a bond to carbon's neighbours either way (CH3+ and CH3- both have three);
  // elsewhere it adds one to a cation's valence (N+) and takes one from an anion's (N-).
  const valence = Math.max(...el.valences) + (atom.element === 'C' ? -Math.abs(atom.charge) : atom.charge);
  return valence - used;
}

/**
 * Turn this molecule's delocalised bonds (order 1.5) into alternating single
 * and double bonds, in place. Returns the number of double bonds made; 0 when
 * there were none to make, and the molecule is left untouched when no
 * arrangement works.
 */
export function kekulize(mol: Molecule): number {
  const delocalised = [...mol.bonds()].filter((b) => b.order === 1.5);
  if (!delocalised.length) return 0;
  const atoms = [...new Set(delocalised.flatMap((b) => [b.begin, b.end]))];
  const spare = new Map(atoms.map((id) => [id, room(mol, id)]));
  // A neutral carbon with room must take a double bond; anything else may, but need not.
  const must = new Set(atoms.filter((id) => {
    const a = mol.atom(id);
    return a.element === 'C' && a.charge === 0 && (spare.get(id) ?? 0) >= 1;
  }));
  const canTake = (id: AtomId) => (spare.get(id) ?? 0) >= 1;

  const doubled = new Set<number>();
  const taken = new Set<AtomId>();
  const left = [...must];
  const solve = (): boolean => {
    const next = left.find((id) => !taken.has(id));
    if (next === undefined) return true;
    for (const b of delocalised) {
      if (b.begin !== next && b.end !== next) continue;
      const other = b.begin === next ? b.end : b.begin;
      if (taken.has(other) || !canTake(other)) continue;
      taken.add(next); taken.add(other); doubled.add(b.id);
      if (solve()) return true;
      taken.delete(next); taken.delete(other); doubled.delete(b.id);
    }
    return false;
  };
  if (!solve()) return 0;
  for (const b of delocalised) b.order = doubled.has(b.id) ? 2 : 1;
  return doubled.size;
}
