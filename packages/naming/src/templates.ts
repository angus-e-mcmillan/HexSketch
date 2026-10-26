/**
 * Ring parents with fixed IUPAC numbering. Each SMILES lists atoms in locant
 * order (atom i gets locants[i]); the matcher tries every automorphism-
 * equivalent mapping and keeps the lowest-locant one. Names follow ChemDraw's
 * choices (tetrahydrofuran rather than oxolane).
 */
export interface RingTemplate {
  name: string;
  /** Substituent form stem: "pyridin" -> pyridin-2-yl. */
  yl: string;
  smiles: string;
  locants: string[];
  /** Indicated hydrogen when the NH sits at this locant, e.g. 1H-pyrrole. */
  indicatedH?: string;
  /** Retained name for the substituent attached at locant 1 (phenyl for benzene). */
  ylRetained?: string;
  aromatic: boolean;
  /**
   * A fully unsaturated (mancude) parent whose partly or fully saturated forms
   * are named with hydro prefixes: 4,5,6,7-tetrahydro-1,3-benzothiazole.
   * Set for every aromatic parent except benzene, below.
   */
  mancude?: boolean;
  /** The fully saturated name, when it is not just hydro prefixes on this one (1,4-dithiepane). */
  saturated?: string;
  /** Generated parents (rings.ts) give atoms and ring bonds instead of a SMILES, in locant order. */
  skeleton?: { elements: string[]; bonds: [number, number][] };
}

const seq = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));

export const TEMPLATES: RingTemplate[] = [
  { name: 'benzene', yl: 'phenyl', ylRetained: 'phenyl', smiles: 'c1ccccc1', locants: seq(6), aromatic: true },
  { name: 'pyridine', yl: 'pyridin', smiles: 'n1ccccc1', locants: seq(6), aromatic: true },
  { name: 'pyrimidine', yl: 'pyrimidin', smiles: 'n1cnccc1', locants: seq(6), aromatic: true },
  { name: 'pyrazine', yl: 'pyrazin', smiles: 'n1ccncc1', locants: seq(6), aromatic: true },
  { name: 'pyridazine', yl: 'pyridazin', smiles: 'n1ncccc1', locants: seq(6), aromatic: true },
  { name: 'furan', yl: 'furan', smiles: 'o1cccc1', locants: seq(5), aromatic: true },
  { name: 'thiophene', yl: 'thiophen', smiles: 's1cccc1', locants: seq(5), aromatic: true },
  { name: 'pyrrole', yl: 'pyrrol', smiles: '[nH]1cccc1', locants: seq(5), indicatedH: '1', aromatic: true },
  { name: 'imidazole', yl: 'imidazol', smiles: '[nH]1cncc1', locants: seq(5), indicatedH: '1', aromatic: true },
  { name: 'pyrazole', yl: 'pyrazol', smiles: '[nH]1nccc1', locants: seq(5), indicatedH: '1', aromatic: true },
  { name: 'oxazole', yl: 'oxazol', smiles: 'o1cncc1', locants: seq(5), aromatic: true },
  { name: 'thiazole', yl: 'thiazol', smiles: 's1cncc1', locants: seq(5), aromatic: true },
  { name: 'isoxazole', yl: 'isoxazol', smiles: 'o1nccc1', locants: seq(5), aromatic: true },
  { name: 'isothiazole', yl: 'isothiazol', smiles: 's1nccc1', locants: seq(5), aromatic: true },
  { name: 'naphthalene', yl: 'naphthalen', smiles: 'c1cccc2ccccc12', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: true },
  { name: 'quinoline', yl: 'quinolin', smiles: 'n1cccc2ccccc12', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: true },
  { name: 'isoquinoline', yl: 'isoquinolin', smiles: 'c1nccc2ccccc12', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: true },
  { name: 'indole', yl: 'indol', smiles: '[nH]1ccc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], indicatedH: '1', aromatic: true },
  { name: 'benzofuran', yl: 'benzofuran', smiles: 'o1ccc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], aromatic: true },
  { name: 'benzo[b]thiophene', yl: 'benzo[b]thiophen', smiles: 's1ccc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], aromatic: true },
  { name: 'benzimidazole', yl: 'benzimidazol', smiles: '[nH]1cnc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], indicatedH: '1', aromatic: true },
  { name: 'benzoxazole', yl: 'benzoxazol', smiles: 'o1cnc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], aromatic: true },
  { name: 'benzothiazole', yl: 'benzothiazol', smiles: 's1cnc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], aromatic: true },
  { name: 'piperidine', yl: 'piperidin', smiles: 'N1CCCCC1', locants: seq(6), aromatic: false },
  { name: 'piperazine', yl: 'piperazin', smiles: 'N1CCNCC1', locants: seq(6), aromatic: false },
  { name: 'morpholine', yl: 'morpholin', smiles: 'O1CCNCC1', locants: seq(6), aromatic: false },
  { name: 'pyrrolidine', yl: 'pyrrolidin', smiles: 'N1CCCC1', locants: seq(5), aromatic: false },
  { name: 'tetrahydrofuran', yl: 'tetrahydrofuran', smiles: 'O1CCCC1', locants: seq(5), aromatic: false },
  { name: 'tetrahydro-2H-pyran', yl: 'tetrahydro-2H-pyran', smiles: 'O1CCCCC1', locants: seq(6), aromatic: false },
  { name: 'tetrahydrothiophene', yl: 'tetrahydrothiophen', smiles: 'S1CCCC1', locants: seq(5), aromatic: false },
  { name: 'azetidine', yl: 'azetidin', smiles: 'N1CCC1', locants: seq(4), aromatic: false },
  { name: 'aziridine', yl: 'aziridin', smiles: 'N1CC1', locants: seq(3), aromatic: false },
  { name: 'oxirane', yl: 'oxiran', smiles: 'O1CC1', locants: seq(3), aromatic: false },
  { name: 'oxetane', yl: 'oxetan', smiles: 'O1CCC1', locants: seq(4), aromatic: false },
  { name: '1,3-dioxolane', yl: '1,3-dioxolan', smiles: 'O1COCC1', locants: seq(5), aromatic: false },
  { name: '1,4-dioxane', yl: '1,4-dioxan', smiles: 'O1CCOCC1', locants: seq(6), aromatic: false },
  { name: 'thiomorpholine', yl: 'thiomorpholin', smiles: 'S1CCNCC1', locants: seq(6), aromatic: false },
  { name: 'azepane', yl: 'azepan', smiles: 'N1CCCCCC1', locants: seq(7), aromatic: false },
  { name: '1,4-diazepane', yl: '1,4-diazepan', smiles: 'N1CCNCCC1', locants: seq(7), aromatic: false },
  { name: 'imidazolidine', yl: 'imidazolidin', smiles: 'N1CNCC1', locants: seq(5), aromatic: false },
  { name: 'oxazolidine', yl: 'oxazolidin', smiles: 'O1CNCC1', locants: seq(5), aromatic: false },
  { name: 'thiazolidine', yl: 'thiazolidin', smiles: 'S1CNCC1', locants: seq(5), aromatic: false },
  { name: '1,3-dioxane', yl: '1,3-dioxan', smiles: 'O1COCCC1', locants: seq(6), aromatic: false },
  { name: '2,3-dihydrofuran', yl: '2,3-dihydrofuran', smiles: 'O1CCC=C1', locants: seq(5), aromatic: false },
  { name: '2,5-dihydrofuran', yl: '2,5-dihydrofuran', smiles: 'O1CC=CC1', locants: seq(5), aromatic: false },
  { name: '3,4-dihydro-2H-pyran', yl: '3,4-dihydro-2H-pyran', smiles: 'O1CCCC=C1', locants: seq(6), aromatic: false },
  { name: '1,4-dihydropyridine', yl: '1,4-dihydropyridin', smiles: 'N1C=CCC=C1', locants: seq(6), aromatic: false },
  { name: 'quinoxaline', yl: 'quinoxalin', smiles: 'n1ccnc2ccccc12', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: true },
  { name: 'quinazoline', yl: 'quinazolin', smiles: 'n1cncc2ccccc12', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: true },
  { name: 'indazole', yl: 'indazol', smiles: '[nH]1ncc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], indicatedH: '1', aromatic: true },
  { name: 'benzo[d][1,3]dioxole', yl: 'benzo[d][1,3]dioxol', smiles: 'O1COc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], aromatic: true },
  { name: 'fluorene', yl: 'fluoren', smiles: 'c1cccc2-c3ccccc3Cc12', locants: ['1', '2', '3', '4', '4a', '4b', '5', '6', '7', '8', '8a', '9', '9a'], indicatedH: '9', aromatic: true },
  { name: 'indoline', yl: 'indolin', smiles: 'N1CCc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], aromatic: true },
  { name: 'isoindoline', yl: 'isoindolin', smiles: 'C1NCc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], aromatic: true },
  { name: '1,2,3,4-tetrahydroquinoline', yl: '1,2,3,4-tetrahydroquinolin', smiles: 'N1CCCc2ccccc12', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: true },
  { name: '1,2,3,4-tetrahydroisoquinoline', yl: '1,2,3,4-tetrahydroisoquinolin', smiles: 'C1NCCc2ccccc12', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: true },
  { name: 'chromane', yl: 'chroman', smiles: 'O1CCCc2ccccc12', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: true },
  { name: '2,3-dihydrobenzofuran', yl: '2,3-dihydrobenzofuran', smiles: 'O1CCc2ccccc12', locants: ['1', '2', '3', '3a', '4', '5', '6', '7', '7a'], aromatic: true },
  { name: '1,3,2-dioxaborolane', yl: '1,3,2-dioxaborolan', smiles: 'O1BOCC1', locants: seq(5), aromatic: false },
  { name: 'decahydronaphthalene', yl: 'decahydronaphthalen', smiles: 'C1CCC2CCCCC2C1', locants: ['1', '2', '3', '4', '4a', '5', '6', '7', '8', '8a'], aromatic: false },
];

/** Parents named by hydro prefixes when partly saturated (benzene's are cycloalkenes). */
const HYDRO_PARENTS = new Set(['pyridine', 'pyrimidine', 'pyrazine', 'pyridazine', 'furan', 'thiophene', 'pyrrole', 'imidazole', 'pyrazole',
  'oxazole', 'thiazole', 'isoxazole', 'isothiazole', 'naphthalene', 'quinoline', 'isoquinoline', 'indole', 'benzofuran', 'benzo[b]thiophene',
  'benzimidazole', 'benzoxazole', 'benzothiazole', 'quinoxaline', 'quinazoline', 'indazole', 'fluorene']);
for (const t of TEMPLATES) if (HYDRO_PARENTS.has(t.name)) t.mancude = true;
