import { elementBySymbol, parseSmiles, sameStructure, type AtomId, type Molecule } from '@hexsketch/core';

/**
 * Names that are not built from a carbon skeleton: small molecules (water,
 * ammonia, sulfuric acid), the inorganic ions of everyday salts
 * (tetrafluoroborate, hydrogen carbonate, permanganate) and metal cations.
 * Each is the name a chemist writes and one OPSIN reads back to the same
 * structure. A few dozen entries, so reagents drawn beside a scheme get a
 * name without the weight of a compound dictionary.
 */

/** Whole molecules and ions, as SMILES and name. An ion's charge is its SMILES's. */
const SPECIES: readonly (readonly [string, string])[] = [
  // Small molecules.
  ['O', 'water'], ['N', 'ammonia'], ['[H][H]', 'dihydrogen'], ['O=O', 'dioxygen'], ['N#N', 'dinitrogen'],
  ['FF', 'difluorine'], ['ClCl', 'dichlorine'], ['BrBr', 'dibromine'], ['II', 'diiodine'], ['ICl', 'iodine monochloride'],
  ['F', 'hydrogen fluoride'], ['Cl', 'hydrogen chloride'], ['Br', 'hydrogen bromide'], ['I', 'hydrogen iodide'],
  ['S', 'hydrogen sulfide'], ['OO', 'hydrogen peroxide'], ['NN', 'hydrazine'], ['NO', 'hydroxylamine'], ['P', 'phosphane'], ['[SiH4]', 'silane'],
  ['[C-]#[O+]', 'carbon monoxide'], ['O=C=O', 'carbon dioxide'], ['S=C=S', 'carbon disulfide'], ['C#N', 'hydrogen cyanide'], ['O=C(Cl)Cl', 'phosgene'],
  ['[O-][O+]=O', 'ozone'], ['C=[N+]=[N-]', 'diazomethane'], ['O=S=O', 'sulfur dioxide'], ['O=S(=O)=O', 'sulfur trioxide'], ['O=[Se]=O', 'selenium dioxide'],
  ['OS(=O)(=O)O', 'sulfuric acid'], ['OS(=O)O', 'sulfurous acid'], ['O[N+](=O)[O-]', 'nitric acid'], ['ON=O', 'nitrous acid'],
  ['OP(=O)(O)O', 'phosphoric acid'], ['OP(O)O', 'phosphorous acid'], ['OB(O)O', 'boric acid'], ['OC(=O)O', 'carbonic acid'],
  ['OCl', 'hypochlorous acid'], ['OCl(=O)(=O)=O', 'perchloric acid'], ['OI(=O)(=O)=O', 'periodic acid'],
  ['NS(N)(=O)=O', 'sulfamide'], ['NS(=O)(=O)O', 'sulfamic acid'], ['NC(N)=N', 'guanidine'], ['NC(N)=S', 'thiourea'],
  ['B', 'borane'], ['FB(F)F', 'trifluoroborane'], ['ClB(Cl)Cl', 'trichloroborane'], ['BrB(Br)Br', 'tribromoborane'],
  ['ClP(Cl)Cl', 'trichlorophosphane'], ['BrP(Br)Br', 'tribromophosphane'], ['ClP(Cl)(Cl)(Cl)Cl', 'phosphorus pentachloride'],
  ['O=P(Cl)(Cl)Cl', 'phosphoryl trichloride'], ['O=S(Cl)Cl', 'thionyl chloride'], ['O=S(=O)(Cl)Cl', 'sulfuryl dichloride'],
  ['O=[Os](=O)(=O)=O', 'osmium tetroxide'],
  // Anions.
  ['[H-]', 'hydride'], ['[O-2]', 'oxide'], ['[S-2]', 'sulfide'], ['[SH-]', 'hydrosulfide'], ['[O-]O', 'hydroperoxide'], ['[NH2-]', 'amide'],
  ['[BH4-]', 'borohydride'], ['[AlH4-]', 'aluminium hydride'], ['F[B-](F)(F)F', 'tetrafluoroborate'], ['F[P-](F)(F)(F)(F)F', 'hexafluorophosphate'],
  ['F[Sb-](F)(F)(F)(F)F', 'hexafluoroantimonate'], ['[C-]#N', 'cyanide'], ['[N-]=[N+]=[N-]', 'azide'], ['[S-]C#N', 'thiocyanate'], ['[O-]C#N', 'cyanate'],
  ['[O-][N+](=O)[O-]', 'nitrate'], ['[O-]N=O', 'nitrite'], ['[O-]S(=O)(=O)[O-]', 'sulfate'], ['OS(=O)(=O)[O-]', 'hydrogen sulfate'],
  ['[O-]S([O-])=O', 'sulfite'], ['OS([O-])=O', 'hydrogen sulfite'], ['[O-]S(=O)(=S)[O-]', 'thiosulfate'],
  ['[O-]C([O-])=O', 'carbonate'], ['OC([O-])=O', 'hydrogen carbonate'],
  ['[O-]P([O-])([O-])=O', 'phosphate'], ['OP([O-])([O-])=O', 'hydrogen phosphate'], ['OP(O)([O-])=O', 'dihydrogen phosphate'],
  ['[O-]Cl', 'hypochlorite'], ['[O-]Cl=O', 'chlorite'], ['[O-]Cl(=O)=O', 'chlorate'], ['[O-]Cl(=O)(=O)=O', 'perchlorate'], ['[O-]I(=O)(=O)=O', 'periodate'],
  ['[O-][Mn](=O)(=O)=O', 'permanganate'], ['[O-][Ru](=O)(=O)=O', 'perruthenate'], ['[O-][Cr](=O)(=O)Cl', 'chlorochromate'],
  ['[O-][Cr](=O)(=O)[O-]', 'chromate'], ['[O-][Cr](=O)(=O)O[Cr](=O)(=O)[O-]', 'dichromate'], ['I[I-]I', 'triiodide'],
  ['c1cc[cH-]c1', 'cyclopenta-2,4-dien-1-ide'], ['[C-]#C', 'ethynide'],
  // Cations.
  ['[OH3+]', 'oxonium'], ['O=[N+]=O', 'nitronium'], ['N#[O+]', 'nitrosonium'],
];

interface Entry { mol: Molecule; name: string; charge: number }
let index: Map<string, Entry[]> | null = null;

/** Elements and total hydrogens: enough to find the few entries worth comparing in full. */
function key(mol: Molecule, atoms: readonly AtomId[]): string {
  const counts = new Map<string, number>();
  let h = 0, q = 0;
  for (const id of atoms) {
    const a = mol.atom(id);
    if (a.element === 'H' && a.isotope === null) h++; else counts.set(a.element, (counts.get(a.element) ?? 0) + 1);
    h += mol.implicitHydrogens(id);
    q += a.charge;
  }
  return `${[...counts].sort().map(([e, n]) => e + n).join('')}H${h}q${q}`;
}

function entries(): Map<string, Entry[]> {
  if (index) return index;
  index = new Map();
  for (const [smiles, name] of SPECIES) {
    const mol = parseSmiles(smiles);
    const ids = [...mol.atoms()].map((a) => a.id);
    const k = key(mol, ids);
    const charge = ids.reduce((t, id) => t + mol.atom(id).charge, 0);
    (index.get(k) ?? index.set(k, []).get(k)!).push({ mol, name, charge });
  }
  return index;
}

/** A small molecule or inorganic ion by name, with its charge; null when it is not one of them. */
export function speciesName(mol: Molecule, atoms: readonly AtomId[]): { name: string; charge: number } | null {
  const hits = entries().get(key(mol, atoms));
  if (!hits) return null;
  const keep = new Set(atoms);
  const part = mol.clone();
  for (const a of mol.atoms()) if (!keep.has(a.id)) part.removeAtom(a.id);
  // Labelled isotopes and radicals are not these compounds.
  if ([...part.atoms()].some((a) => a.isotope !== null || a.radical)) return null;
  for (const e of hits) if (sameStructure(part, e.mol)) return { name: e.name, charge: e.charge };
  return null;
}

/** Metals named as cations and in organometallic compounds (tin, silicon and boron are named as hydrides instead). */
const METAL_Z = new Set([3, 4, 11, 12, 13, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 37, 38, 39, 40, 41, 42, 44, 45, 46, 47, 48, 49,
  55, 56, 57, 58, 59, 60, 62, 63, 64, 70, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83]);
/** Metals with one usual charge, written without it: sodium, magnesium, aluminium, zinc, silver. */
const ONE_CHARGE = new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Be', 'Mg', 'Ca', 'Sr', 'Ba', 'Al', 'Zn', 'Ag', 'Cd', 'Sc', 'Y', 'La']);
const SPELLING: Readonly<Record<string, string>> = { Al: 'aluminium', Cs: 'caesium' };
const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];

export const isMetal = (element: string): boolean => METAL_Z.has(elementBySymbol(element)?.z ?? 0);
export const metalName = (element: string): string => SPELLING[element] ?? elementBySymbol(element)!.name.toLowerCase();

/** A metal ion: "sodium", "iron(III)", "palladium(II)". */
export function metalCation(element: string, charge: number): string {
  return ONE_CHARGE.has(element) || charge < 1 || charge > 8 ? metalName(element) : `${metalName(element)}(${ROMAN[charge]})`;
}
