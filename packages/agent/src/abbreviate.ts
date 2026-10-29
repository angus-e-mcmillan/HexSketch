import { parsePattern, smilesAtomMaps, substructureMappings, type AtomId, type Molecule } from '@hexsketch/core';

/**
 * Protecting groups drawn as chemists write them (Boc, Fmoc, TBS...) rather
 * than in full: the group, as SMILES from the atom bonded to the rest, and
 * the elements it may protect there. Bn and PMB only on oxygen, so a Phe
 * side chain or an N-benzyl drug keeps its ring. Every label is one Expand
 * Label draws out again (and names, formulas and SMILES read in full).
 */
export const PROTECTING_GROUPS: readonly { label: string; smiles: string; on: string[] }[] = [
  { label: 'Fmoc', smiles: 'C(=O)OCC1c2ccccc2-c2ccccc12', on: ['N', 'O'] },
  { label: 'Pbf', smiles: 'S(=O)(=O)c1c(C)c(C)c2OC(C)(C)Cc2c1C', on: ['N'] },
  { label: 'Trt', smiles: 'C(c1ccccc1)(c1ccccc1)c1ccccc1', on: ['N', 'O', 'S'] },
  { label: 'TBDPS', smiles: '[Si](c1ccccc1)(c1ccccc1)C(C)(C)C', on: ['O', 'N'] },
  { label: 'Cbz', smiles: 'C(=O)OCc1ccccc1', on: ['N', 'O'] },
  { label: 'TIPS', smiles: '[Si](C(C)C)(C(C)C)C(C)C', on: ['O', 'N'] },
  { label: 'PMB', smiles: 'Cc1ccc(OC)cc1', on: ['O'] },
  { label: 'Troc', smiles: 'C(=O)OCC(Cl)(Cl)Cl', on: ['N', 'O'] },
  { label: 'Boc', smiles: 'C(=O)OC(C)(C)C', on: ['N', 'O'] },
  { label: 'TBS', smiles: '[Si](C)(C)C(C)(C)C', on: ['O', 'N'] },
  { label: 'Alloc', smiles: 'C(=O)OCC=C', on: ['N', 'O'] },
  { label: 'TES', smiles: '[Si](CC)(CC)CC', on: ['O', 'N'] },
  { label: 'Bn', smiles: 'Cc1ccccc1', on: ['O'] },
  { label: 'THP', smiles: 'C1CCCCO1', on: ['O'] },
  { label: 'TMS', smiles: '[Si](C)(C)C', on: ['O', 'N'] },
  { label: 'tBu', smiles: 'C(C)(C)C', on: ['O', 'S'] },
  { label: 'MOM', smiles: 'COC', on: ['O'] },
];
const patterns = PROTECTING_GROUPS.map((g) => ({ ...g, pattern: parsePattern(g.smiles) }));

/**
 * Replace each protecting group in a laid-out structure by one atom labelled
 * with its abbreviation, where the group began (so it points the way the
 * group did). A group counts only when it is all there and nothing else hangs
 * on it, it hangs on an atom it protects, and it carries no atom-map number
 * or charge (a mechanism's arrows may need its atoms). Returns how many were
 * abbreviated.
 */
export function abbreviateGroups(mol: Molecule): number {
  const mapped = new Set(smilesAtomMaps(mol).values());
  const taken = new Set<AtomId>();
  let n = 0;
  for (const g of patterns) {
    if (g.pattern.atomCount >= mol.atomCount) continue;
    const head = g.pattern.atoms().next().value!.id;
    for (const m of substructureMappings(g.pattern, mol, 200)) {
      const inGroup = new Set(m.atoms);
      const first = m.map.get(head)!;
      if (m.atoms.some((id) => taken.has(id) || mapped.has(id) || mol.atom(id).charge || mol.atom(id).label !== null)) continue;
      const outside = (id: AtomId) => mol.neighbours(id).filter((x) => !inGroup.has(x));
      if (m.atoms.some((id) => id !== first && outside(id).length)) continue;
      const on = outside(first);
      if (on.length !== 1 || !g.on.includes(mol.atom(on[0]!).element)) continue;
      for (const id of m.atoms) taken.add(id);
      for (const id of m.atoms) if (id !== first) mol.removeAtom(id);
      const a = mol.atom(first);
      a.label = g.label;
      a.explicitHydrogens = null;
      n++;
    }
  }
  return n;
}
