/**
 * The hard set: questions picked because models get them wrong, with the
 * question in a mix of representations (IUPAC names, trivial names, SMILES).
 * prep.ts turns these into hard.jsonl and checks every key two ways:
 *
 * - IUPAC names: OPSIN must parse the name to the same structure as the SMILES
 *   written here (two independent routes to the same answer).
 * - Trivial names: the SMILES and formula are PubChem's (CID given), and
 *   HexSketch's formula for the SMILES must equal PubChem's. Re-fetch them all
 *   from PubChem with `prep.ts --pubchem`.
 * - Reactions: the product's IUPAC name must parse (OPSIN) to the SMILES.
 *
 * `pilot` marks about half of each kind for a first, cheaper run.
 */

/** IUPAC name → SMILES. Traps: von Baeyer and spiro names, fusion locants, indicated hydrogen, replacement names. */
export const NAME2SMILES: [id: string, name: string, smiles: string, pilot: boolean][] = [
  ['fenchone', '1,3,3-trimethylbicyclo[2.2.1]heptan-2-one', 'CC12CCC(C2)C(C)(C)C1=O', true], // not camphor's 1,7,7
  ['naphthalic-anhydride', '1H,3H-benzo[de]isochromene-1,3-dione', 'O=C1OC(=O)c2cccc3cccc1c23', true],
  ['thienopyridine', '4-chlorothieno[3,2-c]pyridine', 'Clc1nccc2sccc12', true],
  ['amantadine', 'tricyclo[3.3.1.1^{3,7}]decan-1-amine', 'NC12CC3CC(CC(C3)C1)C2', false],
  ['triglyme', '2,5,8,11-tetraoxadodecane', 'COCCOCCOCCOC', true],
  ['benzoxazinone', '6-methoxy-2H-1,4-benzoxazin-3(4H)-one', 'COc1ccc2OCC(=O)Nc2c1', false],
  ['imidazopyridine', '3-bromoimidazo[1,2-a]pyridine-6-carbonitrile', 'N#Cc1ccc2ncc(Br)n2c1', true],
  ['aminocyclopentane', '(1R,3S)-3-aminocyclopentane-1-carboxylic acid', 'N[C@@H]1C[C@@H](CC1)C(=O)O', false],
  ['trienal', '(2E,4Z,6E)-octa-2,4,6-trienal', 'O=C/C=C/C=C\\C=C\\C', true],
  ['azaspiro', '2-azaspiro[3.3]heptane-6-carboxylic acid', 'OC(=O)C1CC2(C1)CNC2', false],
  ['quinolizinone', '4H-quinolizin-4-one', 'O=c1cccc2ccccn12', false],
  ['quinuclidinone', '1-azabicyclo[2.2.2]octan-3-one', 'O=C1CN2CCC1CC2', false],
];

/** SMILES → IUPAC name, graded by OPSIN. The name is one that parses to the SMILES, so a correct name exists. */
export const SMILES2NAME: [id: string, smiles: string, name: string, pilot: boolean][] = [
  ['carbamazepine', 'NC(=O)N1c2ccccc2C=Cc2ccccc21', '5H-dibenzo[b,f]azepine-5-carboxamide', true],
  ['azaindole', 'Brc1cnc2[nH]ccc2c1', '5-bromo-1H-pyrrolo[2,3-b]pyridine', true],
  ['dioxaspiro', 'O=C1CCC2(CC1)OCCO2', '1,4-dioxaspiro[4.5]decan-8-one', false],
  ['camphor', 'C[C@@]12CC[C@@H](C1(C)C)CC2=O', '(1R,4R)-1,7,7-trimethylbicyclo[2.2.1]heptan-2-one', true],
  ['dienoic-acid', 'C/C=C/C=C\\C(=O)O', '(2Z,4E)-hexa-2,4-dienoic acid', true],
  ['pyrazolopyrimidine', 'Nc1ccnc2ccnn12', 'pyrazolo[1,5-a]pyrimidin-7-amine', false],
  ['quinuclidinol', 'O[C@H]1CN2CCC1CC2', '(3R)-1-azabicyclo[2.2.2]octan-3-ol', false],
  ['cyano-oxo-acid', 'OC(=O)CC(=O)CC#N', '4-cyano-3-oxobutanoic acid', false],
  ['norharmane', 'c1ccc2c(c1)[nH]c1cnccc12', '9H-pyrido[3,4-b]indole', true],
];

/** Trivial name → SMILES with every stereocentre (PubChem's SMILES and formula). */
export const COMMON2SMILES: [name: string, cid: number, smiles: string, formula: string, pilot: boolean][] = [
  ['strychnine', 441071, 'C1CN2CC3=CCO[C@H]4CC(=O)N5[C@H]6[C@H]4[C@H]3C[C@H]2[C@@]61C7=CC=CC=C75', 'C21H22N2O2', true],
  ['morphine', 5288826, 'CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O', 'C17H19NO3', true],
  ['quinine', 3034034, 'COC1=CC2=C(C=CN=C2C=C1)[C@H]([C@@H]3C[C@@H]4CCN3C[C@@H]4C=C)O', 'C20H24N2O2', false],
  ['cocaine', 446220, 'CN1[C@H]2CC[C@@H]1[C@H]([C@H](C2)OC(=O)C3=CC=CC=C3)C(=O)OC', 'C17H21NO4', true],
  ['artemisinin', 68827, 'C[C@@H]1CC[C@H]2[C@H](C(=O)O[C@H]3[C@@]24[C@H]1CC[C@](O3)(OO4)C)C', 'C15H22O5', false],
  ['paclitaxel', 36314, 'CC1=C2[C@H](C(=O)[C@@]3([C@H](C[C@@H]4[C@]([C@H]3[C@@H]([C@@](C2(C)C)(C[C@@H]1OC(=O)[C@@H]([C@H](C5=CC=CC=C5)NC(=O)C6=CC=CC=C6)O)O)OC(=O)C7=CC=CC=C7)(CO4)OC(=O)C)O)C)OC(=O)C', 'C47H51NO14', true],
  ['oseltamivir', 65028, 'CCC(CC)O[C@@H]1C=C(C[C@@H]([C@H]1NC(=O)C)N)C(=O)OCC', 'C16H28N2O4', false],
  ['atorvastatin', 60823, 'CC(C)C1=C(C(=C(N1CC[C@H](C[C@H](CC(=O)O)O)O)C2=CC=C(C=C2)F)C3=CC=CC=C3)C(=O)NC4=CC=CC=C4', 'C33H35FN2O5', false],
  ['sucrose', 5988, 'C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O', 'C12H22O11', true],
  ['dexamethasone', 5743, 'C[C@@H]1C[C@H]2[C@@H]3CCC4=CC(=O)C=C[C@@]4([C@]3([C@H](C[C@@]2([C@]1(C(=O)CO)O)C)O)F)C', 'C22H29FO5', false],
  ['ezetimibe', 150311, 'C1=CC(=CC=C1[C@@H]2[C@H](C(=O)N2C3=CC=C(C=C3)F)CC[C@@H](C4=CC=C(C=C4)F)O)O', 'C24H21F2NO3', true],
  ['erythromycin A', 12560, 'CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O', 'C37H67NO13', false],
];

/**
 * Trivial name → systematic name with R/S. Traps: L-cysteine is R, threonine
 * and isoleucine have two centres, (−)-menthol and (−)-ephedrine have to be
 * known by their rotation. `avoid` is the trivial name itself, which OPSIN
 * would parse too: an answer containing it is marked wrong.
 */
export const COMMON2NAME: [name: string, cid: number, smiles: string, formula: string, iupac: string, avoid: string, pilot: boolean][] = [
  ['L-cysteine', 5862, 'C([C@@H](C(=O)O)N)S', 'C3H7NO2S', '(2R)-2-amino-3-sulfanylpropanoic acid', 'cysteine', true],
  ['L-threonine', 6288, 'C[C@H]([C@@H](C(=O)O)N)O', 'C4H9NO3', '(2S,3R)-2-amino-3-hydroxybutanoic acid', 'threonine', true],
  ['L-isoleucine', 6306, 'CC[C@H](C)[C@@H](C(=O)O)N', 'C6H13NO2', '(2S,3S)-2-amino-3-methylpentanoic acid', 'isoleucine', false],
  ['(−)-menthol', 16666, 'C[C@@H]1CC[C@H]([C@@H](C1)O)C(C)C', 'C10H20O', '(1R,2S,5R)-5-methyl-2-(propan-2-yl)cyclohexan-1-ol', 'menthol', true],
  ['(−)-ephedrine', 9294, 'C[C@@H]([C@@H](C1=CC=CC=C1)O)NC', 'C10H15NO', '(1R,2S)-2-(methylamino)-1-phenylpropan-1-ol', 'ephedrine', false],
  ['captopril', 44093, 'C[C@H](CS)C(=O)N1CCC[C@H]1C(=O)O', 'C9H15NO3S', '(2S)-1-[(2S)-2-methyl-3-sulfanylpropanoyl]pyrrolidine-2-carboxylic acid', 'captopril', false],
];

/** Trivial name → molecular formula, for large natural products (PubChem's formula). */
export const FORMULA: [name: string, cid: number, formula: string, pilot: boolean][] = [
  ['vancomycin', 14969, 'C66H75Cl2N9O24', true],
  ['cyclosporin A', 5284373, 'C62H111N11O12', true],
  ['sirolimus (rapamycin)', 5284616, 'C51H79NO13', false],
  ['cyanocobalamin (vitamin B12)', 166596686, 'C63H88CoN14O14P', true],
  ['chlorophyll a', 12085802, 'C55H72MgN4O5', false],
  ['amphotericin B', 5280965, 'C47H73NO17', true],
  ['tacrolimus', 445643, 'C44H69NO12', false],
  ['bryostatin 1', 5280757, 'C47H68O17', false],
];

/** SMILES → molecular formula: counting atoms (above all hydrogens) in a long SMILES. Unnamed in the question. */
export const SMILES2FORMULA: [id: string, cid: number, smiles: string, formula: string, pilot: boolean][] = [
  ['ritonavir', 392622, 'CC(C)C1=NC(=CS1)CN(C)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](CC2=CC=CC=C2)C[C@@H]([C@H](CC3=CC=CC=C3)NC(=O)OCC4=CN=CS4)O', 'C37H48N6O5S2', true],
  ['venetoclax', 49846579, 'CC1(CCC(=C(C1)C2=CC=C(C=C2)Cl)CN3CCN(CC3)C4=CC(=C(C=C4)C(=O)NS(=O)(=O)C5=CC(=C(C=C5)NCC6CCOCC6)[N+](=O)[O-])OC7=CN=C8C(=C7)C=CN8)C', 'C45H50ClN7O7S', true],
  ['remdesivir', 121304016, 'CCC(CC)COC(=O)[C@H](C)N[P@](=O)(OC[C@@H]1[C@H]([C@H]([C@](O1)(C#N)C2=CC=C3N2N=CN=C3N)O)O)OC4=CC=CC=C4', 'C27H35N6O8P', false],
  ['digoxin', 2724385, 'C[C@@H]1[C@H]([C@H](C[C@@H](O1)O[C@@H]2[C@H](O[C@H](C[C@@H]2O)O[C@@H]3[C@H](O[C@H](C[C@@H]3O)O[C@H]4CC[C@]5([C@@H](C4)CC[C@@H]6[C@@H]5C[C@H]([C@]7([C@@]6(CC[C@@H]7C8=CC(=O)OC8)O)C)O)C)C)C)O)O', 'C41H64O14', true],
  ['saquinavir', 441243, 'CC(C)(C)NC(=O)[C@@H]1C[C@@H]2CCCC[C@@H]2CN1C[C@H]([C@H](CC3=CC=CC=C3)NC(=O)[C@H](CC(=O)N)NC(=O)C4=NC5=CC=CC=C5C=C4)O', 'C38H50N6O5', false],
  ['lapatinib', 208908, 'CS(=O)(=O)CCNCC1=CC=C(O1)C2=CC3=C(C=C2)N=CN=C3NC4=CC(=C(C=C4)OCC5=CC(=CC=C5)F)Cl', 'C29H26ClFN4O4S', false],
];

/**
 * Reactions where the obvious answer is wrong: stereochemistry (inversion,
 * meso products), regiochemistry (Hofmann vs Zaitsev, Baeyer–Villiger
 * migration, the Diels–Alder "para" rule) and rearrangements. Some give the
 * starting material as SMILES. `stereo`: graded as the stereoisomer.
 */
export const REACTIONS: [id: string, prompt: string, product: string, smiles: string, stereo: boolean, pilot: boolean][] = [
  ['sn2-azide', '(R)-2-Bromobutane is heated with sodium azide in DMF. What is the product, with its stereochemistry?', '(2S)-2-azidobutane', 'CC[C@H](C)N=[N+]=[N-]', true, true],
  ['mitsunobu', 'The alcohol C[C@@H](O)CC is treated with 4-nitrobenzoic acid, triphenylphosphine and DIAD in THF. What is the ester formed, with its stereochemistry?', '(2S)-butan-2-yl 4-nitrobenzoate', 'CC[C@H](C)OC(=O)c1ccc([N+](=O)[O-])cc1', true, true],
  ['bromination-meso', '(E)-But-2-ene is treated with bromine in dichloromethane. What is the product, with its stereochemistry?', '(2R,3S)-2,3-dibromobutane', 'C[C@@H](Br)[C@H](C)Br', true, true],
  ['dihydroxylation-meso', '(Z)-But-2-ene is treated with a catalytic amount of OsO4 and N-methylmorpholine N-oxide in aqueous acetone. What is the product, with its stereochemistry?', '(2R,3S)-butane-2,3-diol', 'C[C@@H](O)[C@H](C)O', true, false],
  ['baeyer-villiger', '2-Methylcyclohexan-1-one is treated with mCPBA in dichloromethane. What is the major product?', '7-methyloxepan-2-one', 'CC1CCCCC(=O)O1', false, true],
  ['hofmann-e2', '2-Bromo-2-methylbutane is heated with potassium tert-butoxide in tert-butanol. What is the major alkene?', '2-methylbut-1-ene', 'C=C(C)CC', false, true],
  ['favorskii', '2-Chlorocyclohexan-1-one is treated with sodium methoxide in methanol. What is the product?', 'methyl cyclopentanecarboxylate', 'COC(=O)C1CCCC1', false, false],
  ['birch', 'Anisole is treated with sodium in liquid ammonia with ethanol. What is the product?', '1-methoxycyclohexa-1,4-diene', 'COC1=CCC=CC1', false, false],
  ['robinson', 'CC1C(=O)CCCC1=O is treated with but-3-en-2-one and a base, and the Michael adduct is then heated with acid. What is the product?', '8a-methyl-3,4,8,8a-tetrahydronaphthalene-1,6(2H,7H)-dione', 'CC12CCC(=O)C=C1CCCC2=O', false, false],
  ['claisen', 'Allyl phenyl ether is heated to 200 °C. What is the product?', '2-(prop-2-en-1-yl)phenol', 'C=CCc1ccccc1O', false, true],
  ['pinacol', '2,3-Dimethylbutane-2,3-diol is heated with sulfuric acid. What is the product?', '3,3-dimethylbutan-2-one', 'CC(=O)C(C)(C)C', false, false],
  ['diels-alder-para', 'Isoprene (2-methylbuta-1,3-diene) and methyl acrylate are heated together. What is the major Diels–Alder adduct?', 'methyl 4-methylcyclohex-3-ene-1-carboxylate', 'COC(=O)C1CCC(C)=CC1', false, false],
];
