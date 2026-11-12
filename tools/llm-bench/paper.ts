/**
 * The paper: one spec per question, the chemistry in a line or two, drawn by
 * author.ts into questions/<id>.cdxml.
 *
 * Two rules hold across the paper:
 *
 *   - **A molecule appears in one question only.** A compound met twice lets
 *     the second question be answered from the first, and makes the paper
 *     shorter than it looks. author.ts warns when a structure comes back.
 *   - **Each question tests one thing**, and the question says only what a
 *     chemist would say: it never names the bond to break, the position that
 *     reacts, or the intermediate expected.
 */
import type { SchemeArrow } from '../../packages/agent/src/index.ts';

/** The answer, drawn under "Answer" (or written after it). */
export type Answer =
  /** One structure, or several side by side in any order. */
  | { structures: string[] }
  /** Structures in order, arrows between them: a mechanism's intermediates, a sequence of products. */
  | { sequence: string[] }
  /** The structure with the atoms asked for highlighted: mark them [N:1], [N:2] (the numbers only name them). */
  | { atoms: string }
  /** The structure with 1, 2, 3 written beside the atoms, in the order asked. */
  | { ranking: string }
  /** A number ("6.7 ± 0.8") or a word ("sp2", alternatives joined by " / "). */
  | { written: string };

export interface Spec {
  /** The file name, and the type: reaction, multistep, mechanism, retrosynthesis, structure, analysis, hazard. */
  id: string;
  /** What the chemist types in the chat, without the marks. */
  ask: string;
  marks: number;
  /** What is drawn above the question, as a chemist would have it in the editor: the stages left to right, "?" where the answer goes, "A.B" for two structures in one stage. */
  shown: { stages: string[]; arrows?: SchemeArrow[] };
  answer: Answer;
  /** Other answers that are right too (the other coupling partner, a different tautomer of an intermediate). */
  also?: Answer[];
  /** Words any of which, in the reply, counts as warning of the hazard. */
  hazard?: string[];
}

export const PAPER: Spec[] = [
  // ---------------------------------------------------------------- reaction
  // Four at the size a chemist works at, then three where the answer turns on
  // which group moves: a paper of only small molecules does not tell models
  // apart, and a paper of only large ones tests bookkeeping and nothing else.
  {
    // Chemoselectivity at scale: the acid is coupled to the ring NH, and the carbamate is untouched.
    id: 'reaction-1',
    ask: 'What is the product of this coupling?',
    marks: 4,
    shown: { stages: ['CC(C)(C)OC(=O)N[C@@H](CC(=O)O)Cc1ccc(Cl)c(F)c1.FC(F)(F)c1nnc2n1CCNC2', '?'], arrows: [{ reagents: 'HATU, DIPEA', conditions: 'DMF, rt, 2 h' }] },
    answer: { structures: ['CC(C)(C)OC(=O)N[C@@H](CC(=O)N1CCn2c(C(F)(F)F)nnc2C1)Cc1ccc(Cl)c(F)c1'] },
  },
  {
    // A Suzuki on a substrate that also holds an amide and a basic amine.
    id: 'reaction-2',
    ask: 'What is the product of this coupling?',
    marks: 4,
    shown: { stages: ['Brc1ccc(cc1)C(=O)Nc1ccc(cc1)N1CCN(C)CC1.OB(O)c1cnn(C)c1', '?'], arrows: [{ reagents: 'Pd(dppf)Cl2 (5 mol%), K3PO4', conditions: 'dioxane/H2O, 90 °C' }] },
    answer: { structures: ['O=C(Nc1ccc(cc1)N1CCN(C)CC1)c1ccc(cc1)-c1cnn(C)c1'] },
  },
  {
    // SNAr at the 2-position of the pyrimidine, the only site activated for it.
    id: 'reaction-3',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['Clc1nccc(n1)-c1ccc(OC)cc1.CC(C)(C)OC(=O)N1CCNCC1', '?'], arrows: [{ reagents: 'DIPEA (2 equiv)', conditions: 'NMP, 120 °C, 16 h' }] },
    answer: { structures: ['CC(C)(C)OC(=O)N1CCN(CC1)c1nccc(n1)-c1ccc(OC)cc1'] },
  },
  {
    // A Mitsunobu: the alcohol is inverted, and the phenol is the nucleophile, not the quinoline nitrogen.
    id: 'reaction-4',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['CC(C)(C)OC(=O)N1CCC[C@@H](O)C1.Oc1ccc2ncccc2c1', '?'], arrows: [{ reagents: 'DIAD, PPh3', conditions: 'THF, 0 °C → rt' }] },
    answer: { structures: ['CC(C)(C)OC(=O)N1CCC[C@H](Oc2ccc3ncccc3c2)C1'] },
  },
  {
    // A Beckmann: the aryl migrates, not the methyl.
    id: 'reaction-5',
    ask: 'What is the major product?',
    marks: 4,
    shown: { stages: ['ON=C(C)c1ccccc1', '?'], arrows: [{ reagents: 'TsCl, pyridine', conditions: 'then H2O, reflux' }] },
    answer: { structures: ['CC(=O)Nc1ccccc1'] },
  },
  {
    // A Baeyer-Villiger: the electron-rich aryl migrates, so the oxygen ends up between it and the carbonyl.
    id: 'reaction-6',
    ask: 'What is the major product?',
    marks: 4,
    shown: { stages: ['CC(=O)c1ccc(OC)cc1', '?'], arrows: [{ reagents: 'mCPBA (1.2 equiv)', conditions: 'CH2Cl2, rt, 12 h' }] },
    answer: { structures: ['CC(=O)Oc1ccc(OC)cc1'] },
  },
  {
    // LDA takes the less hindered proton, so the methyl lands on the far side of the ring.
    id: 'reaction-7',
    ask: 'What is the major product?',
    marks: 4,
    shown: { stages: ['O=C1CCCCC1C', '?'], arrows: [{ reagents: 'LDA (1.05 equiv), THF, −78 °C; then MeI', conditions: '−78 °C → rt' }] },
    answer: { structures: ['CC1CCCC(C)C1=O'] },
  },

  // --------------------------------------------------------------- multistep
  {
    // SNAr at the fluorine para to the nitro group, then the nitro group becomes the aniline that is acylated.
    id: 'multistep-1',
    ask: 'Give the major product of each step, in order.',
    marks: 5,
    shown: { stages: ['O=[N+]([O-])c1ccc(F)c(C(=O)NC2CC2)c1', '?'], arrows: [{ reagents: 'i. 1-methylpiperazine, K2CO3, DMSO, 90 °C\nii. H2 (1 atm), 10% Pd/C, EtOH\niii. AcCl, Et3N, CH2Cl2, 0 °C' }] },
    answer: { sequence: ['O=[N+]([O-])c1ccc(N2CCN(C)CC2)c(C(=O)NC2CC2)c1', 'Nc1ccc(N2CCN(C)CC2)c(C(=O)NC2CC2)c1', 'CC(=O)Nc1ccc(N2CCN(C)CC2)c(C(=O)NC2CC2)c1'] },
  },
  {
    // Weinreb amide, Grignard, then the acid: the stereocentre is carried through, and the salt is asked for as its neutral form.
    id: 'multistep-2',
    ask: 'Give the product of each step, in order, the last as its neutral form.',
    marks: 5,
    shown: { stages: ['CC(C)(C)OC(=O)N[C@@H](Cc1cccc(c1)-c1ccccc1)C(=O)O', '?'], arrows: [{ reagents: 'i. HN(Me)OMe·HCl, HATU, DIPEA\nii. MeMgBr (3 equiv), THF, 0 °C\niii. 4 M HCl, dioxane' }] },
    answer: { sequence: ['CC(C)(C)OC(=O)N[C@@H](Cc1cccc(c1)-c1ccccc1)C(=O)N(C)OC', 'CC(C)(C)OC(=O)N[C@@H](Cc1cccc(c1)-c1ccccc1)C(C)=O', 'N[C@@H](Cc1cccc(c1)-c1ccccc1)C(C)=O'] },
  },
  {
    // Hydrogenolysis takes the Cbz and leaves the sulfonamide, and the freed amine does the SNAr.
    id: 'multistep-3',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['O=C(OCc1ccccc1)N1CCC(CC1)C(=O)Nc1ccc(cc1)S(=O)(=O)N(C)C', '?'], arrows: [{ reagents: 'i. H2 (1 atm), 10% Pd/C, MeOH\nii. 2-chloro-5-methylpyrimidine, DIPEA, NMP, 110 °C' }] },
    answer: { sequence: ['O=C(Nc1ccc(cc1)S(=O)(=O)N(C)C)C1CCNCC1', 'O=C(Nc1ccc(cc1)S(=O)(=O)N(C)C)C1CCN(CC1)c1ncc(C)cn1'] },
  },

  // --------------------------------------------------------------- mechanism
  // Both short: a mechanism that needs nine intermediates measures how much a
  // model can write before the token limit, not whether it knows the mechanism.
  {
    // A Curtius: the acyl azide, then the isocyanate, then t-butanol traps it.
    id: 'mechanism-1',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['OC(=O)C1CCOCC1', '?'], arrows: [{ reagents: 'DPPA, Et3N', conditions: 't-BuOH, reflux, 12 h' }] },
    answer: { sequence: ['O=C(N=[N+]=[N-])C1CCOCC1', 'O=C=NC1CCOCC1', 'CC(C)(C)OC(=O)NC1CCOCC1'] },
    also: [{ sequence: ['O=C([N-][N+]#N)C1CCOCC1', 'O=C=NC1CCOCC1', 'CC(C)(C)OC(=O)NC1CCOCC1'] }],
  },
  {
    // Boc removal: the cation leaves, and the carbamic acid loses CO2.
    id: 'mechanism-2',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['CC(C)(C)OC(=O)N1CCc2ccccc21', '?'], arrows: [{ reagents: 'TFA (20 equiv)', conditions: 'CH2Cl2, rt, 1 h' }] },
    answer: { sequence: ['OC(=O)N1CCc2ccccc21', 'C1Cc2ccccc2N1'] },
  },

  // ---------------------------------------------------------- retrosynthesis
  {
    // Chemoselectivity backwards: the free amine has to be masked before the coupling.
    id: 'retrosynthesis-1',
    ask: 'Give the two building blocks you would couple to make this compound, with any protecting group they need.',
    marks: 5,
    shown: { stages: ['NCC1(CC1)C(=O)N1CCN(CC1)c1ccccn1', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['CC(C)(C)OC(=O)NCC1(CC1)C(=O)O', 'c1ccc(nc1)N1CCNCC1'] },
    also: [{ structures: ['O=C(OCc1ccccc1)NCC1(CC1)C(=O)O', 'c1ccc(nc1)N1CCNCC1'] }],
  },
  {
    // No bond is named: the biaryl is the strategic one, and both halves are sold.
    id: 'retrosynthesis-2',
    ask: 'Give two starting materials you could buy for a one-step synthesis of this compound.',
    marks: 5,
    shown: { stages: ['CNC(=O)c1ccc(cc1)-c1ccc2[nH]ncc2c1', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['CNC(=O)c1ccc(Br)cc1', 'OB(O)c1ccc2[nH]ncc2c1'] },
    also: [
      { structures: ['CNC(=O)c1ccc(Br)cc1', 'CC1(C)OB(OC1(C)C)c1ccc2[nH]ncc2c1'] },
      { structures: ['CNC(=O)c1ccc(cc1)B(O)O', 'Brc1ccc2[nH]ncc2c1'] },
    ],
  },
  {
    // A secondary amine: either half may carry the carbonyl, so both pairings are right.
    id: 'retrosynthesis-3',
    ask: 'Give the two starting materials for a one-step synthesis of this compound.',
    marks: 5,
    shown: { stages: ['FC(F)(F)c1ccc(CNC2CCN(CC2)c2ncccn2)cc1', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['O=Cc1ccc(C(F)(F)F)cc1', 'NC1CCN(CC1)c1ncccn1'] },
    also: [{ structures: ['NCc1ccc(C(F)(F)F)cc1', 'O=C1CCN(CC1)c1ncccn1'] }],
  },

  // --------------------------------------------------------------- structure
  {
    // Two stereocentres, both to be inverted.
    id: 'structure-1',
    ask: 'Draw the enantiomer of this compound.',
    marks: 2,
    shown: { stages: ['CC(C)(C)OC(=O)N1C[C@@H](F)[C@@H](C1)NC(=O)c1ccc(Cl)cc1'] },
    answer: { structures: ['CC(C)(C)OC(=O)N1C[C@H](F)[C@H](C1)NC(=O)c1ccc(Cl)cc1'] },
  },
  {
    // The ring NH, not the alcohol.
    id: 'structure-2',
    ask: 'Protect the secondary amine as its Boc carbamate. Give the protected compound.',
    marks: 2,
    shown: { stages: ['OCC1CNCC1c1ccc(F)cc1'] },
    answer: { structures: ['OCC1CN(C(=O)OC(C)(C)C)CC1c1ccc(F)cc1'] },
  },
  {
    // The pyridine, not the morpholine or the amide.
    id: 'structure-3',
    ask: 'Draw the N-oxide of the pyridine nitrogen.',
    marks: 2,
    shown: { stages: ['Cc1ccc(cc1)C(=O)Nc1ccnc(N2CCOCC2)c1'] },
    answer: { structures: ['Cc1ccc(cc1)C(=O)Nc1cc[n+]([O-])c(N2CCOCC2)c1'] },
  },
  {
    id: 'structure-4',
    ask: 'This is (Z)-tamoxifen. Draw its (E)-isomer.',
    marks: 2,
    shown: { stages: ['CC\\C(C1=CC=CC=C1)=C(/C2=CC=CC=C2)C3=CC=C(OCCN(C)C)C=C3'] },
    answer: { structures: ['CC\\C(C1=CC=CC=C1)=C(\\C2=CC=CC=C2)C3=CC=C(OCCN(C)C)C=C3'] },
  },
  {
    // The ester, not the amide or the carbamate.
    id: 'structure-5',
    ask: 'Draw the carboxylic acid formed when the ethyl ester is hydrolysed.',
    marks: 2,
    shown: { stages: ['CCOC(=O)c1ccc(cc1)C(=O)N1CCN(CC1)C(=O)OC(C)(C)C'] },
    answer: { structures: ['OC(=O)c1ccc(cc1)C(=O)N1CCN(CC1)C(=O)OC(C)(C)C'] },
  },

  // ---------------------------------------------------------------- analysis
  {
    // Six nitrogens, one plainly the most basic: the N-ethyl of the piperazine.
    id: 'analysis-1',
    ask: 'Which nitrogen is the most basic?',
    marks: 3,
    shown: { stages: ['CCN1CCN(CC1)c1ccc(Nc2nccc(n2)-c2cccnc2)cc1'] },
    answer: { atoms: 'CC[N:1]1CCN(CC1)c1ccc(Nc2nccc(n2)-c2cccnc2)cc1' },
  },
  {
    id: 'analysis-2',
    ask: 'Rank the nitrogens by nucleophilicity, most nucleophilic first.',
    marks: 3,
    shown: { stages: ['CN(C)c1ccncc1'] },
    answer: { ranking: 'C[N:2](C)c1cc[n:1]cc1' },
  },
  {
    // The sulfonamide NH, not the anilide: about ten orders of magnitude apart.
    id: 'analysis-3',
    ask: 'Which NH is the most acidic?',
    marks: 3,
    shown: { stages: ['CS(=O)(=O)Nc1ccc(NC(C)=O)cc1'] },
    answer: { atoms: 'CS(=O)(=O)[NH:1]c1ccc(NC(C)=O)cc1' },
  },
  {
    id: 'analysis-4',
    ask: 'Which atoms are stereocentres?',
    marks: 3,
    shown: { stages: ['CCC(CC)O[C@@H]1C=C(C[C@@H]([C@H]1NC(=O)C)N)C(=O)OCC'] },
    answer: { atoms: 'CCC(CC)O[C@@H:1]1C=C(C[C@@H:3]([C@H:2]1NC(=O)C)N)C(=O)OCC' },
  },

  // ------------------------------------------------------------------ hazard
  {
    // Three carbons, two azides: the rule of six says this one can go off.
    id: 'hazard-1',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['BrCCCBr', '?'], arrows: [{ reagents: 'NaN3 (2.2 equiv)', conditions: 'DMSO, 60 °C, 6 h' }] },
    answer: { structures: ['[N-]=[N+]=NCCCN=[N+]=[N-]'] },
    hazard: ['explosive', 'explosion', 'explode', 'detonat', 'shock', 'energetic', 'rule of six', 'C/N'],
  },
  {
    // The acid is activated first, so the diazomethane makes a diazoketone, not the methyl ester.
    id: 'hazard-2',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['CC(C)(C)OC(=O)N[C@@H](Cc1ccccc1)C(=O)O', '?'], arrows: [{ reagents: 'i. i-BuOCOCl, NMM, THF, −15 °C\nii. TMSCHN2 (2 equiv), −15 °C → rt' }] },
    answer: { structures: ['CC(C)(C)OC(=O)N[C@@H](Cc1ccccc1)C(=O)C=[N+]=[N-]'] },
    also: [{ structures: ['CC(C)(C)OC(=O)N[C@@H](Cc1ccccc1)C(=O)[CH-][N+]#N'] }],
    hazard: ['explosive', 'explosion', 'explode', 'blast shield', 'toxic', 'carcinogen', 'TMS-diazomethane', 'trimethylsilyldiazomethane'],
  },
];

/**
 * Candidate questions, in questions/candidates/: tried on free models to see
 * whether a question is worth asking before it joins the paper. Only the ones
 * written here are drawn by author.ts (`-- --set candidates`); the rest of
 * that folder was drawn by hand and is left alone.
 */
export const CANDIDATES: Spec[] = [
  {
    // Abrocitinib, from Chemistry By Design, redrawn from the chemistry alone.
    // The accepted couplings are the published one and the four a chemist has
    // since marked viable: the pyrrolopyrimidine may be aminated before or
    // after the sulfonamide is made, and the amine may be carried in
    // protected or as the sulfonamide itself.
    id: 'route-c3',
    ask: 'Plan a synthesis of this compound from starting materials you can buy, in at most 4 steps.',
    marks: 5,
    shown: { stages: ['CCCS(=O)(=O)NC1CC(C1)N(C)C2=NC=NC=3NC=CC23'] },
    answer: { structures: ['O=C2CC(NC(=O)OCC1=CC=CC=C1)C2', 'CN'] },
    also: [
      { structures: ['CNC1CC(N)C1', 'ClC1=NC=NC=2NC=CC12'] },
      { structures: ['CNC1CC(N)C1', 'ClC1=NC=NC2=C1C=CN2S(=O)(=O)C3=CC=C(C)C=C3'] },
      // The amine already carrying its sulfonamide: three graded routes end this way.
      { structures: ['CCCS(=O)(=O)NC1CC(C1)NC', 'ClC1=NC=NC=2NC=CC12'] },
      { structures: ['CCCS(=O)(=O)NC1CC(C1)NC', 'ClC1=NC=NC2=C1C=CN2S(=O)(=O)C3=CC=C(C)C=C3'] },
      // Aminated first, the second nitrogen protected: Boc or Cbz.
      { structures: ['CC(C)(C)OC(=O)NC1CC(C1)N', 'ClC1=NC=NC=2NC=CC12'] },
      { structures: ['O=C(OCc1ccccc1)NC1CC(C1)N', 'ClC1=NC=NC=2NC=CC12'] },
    ],
  },
  {
    // Which group migrates: the aryl, not the methyl.
    id: 'reaction-c6',
    ask: 'What is the major product?',
    marks: 4,
    shown: { stages: ['ON=C(C)c1ccccc1', '?'], arrows: [{ reagents: 'TsCl, pyridine', conditions: 'then H2O, reflux' }] },
    answer: { structures: ['CC(=O)Nc1ccccc1'] },
  },
  {
    // A Baeyer-Villiger: the electron-rich aryl migrates, so the oxygen ends up between it and the carbonyl.
    id: 'reaction-c7',
    ask: 'What is the major product?',
    marks: 4,
    shown: { stages: ['CC(=O)c1ccc(OC)cc1', '?'], arrows: [{ reagents: 'mCPBA (1.2 equiv)', conditions: 'CH2Cl2, rt, 12 h' }] },
    answer: { structures: ['CC(=O)Oc1ccc(OC)cc1'] },
  },
  {
    // Two equivalents: the ketone does not survive the second.
    id: 'reaction-c8',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['COC(=O)c1ccc(Cl)cc1', '?'], arrows: [{ reagents: 'MeMgBr (2.2 equiv)', conditions: 'THF, 0 °C → rt' }] },
    answer: { structures: ['CC(C)(O)c1ccc(Cl)cc1'] },
  },
  {
    // DIBAL stops at the imine, so the workup gives the aldehyde, not the amine.
    id: 'reaction-c9',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N#Cc1cccc(Br)c1', '?'], arrows: [{ reagents: 'DIBAL-H (1.1 equiv)', conditions: 'toluene, −78 → 0 °C; then aq. HCl' }] },
    answer: { structures: ['O=Cc1cccc(Br)c1'] },
  },
  {
    // The azide opens the epoxide from the back: the two groups end up trans, and the product is racemic.
    id: 'reaction-c10',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['C1CCC2OC2C1', '?'], arrows: [{ reagents: 'NaN3, NH4Cl', conditions: 'MeOH/H2O, 65 °C' }] },
    answer: { structures: ['O[C@H]1CCCC[C@@H]1N=[N+]=[N-]'] },
    also: [{ structures: ['O[C@@H]1CCCC[C@H]1N=[N+]=[N-]'] }],
  },
  {
    // LDA takes the less hindered proton, so the methyl lands on the far side.
    id: 'reaction-c11',
    ask: 'What is the major product?',
    marks: 4,
    shown: { stages: ['O=C1CCCCC1C', '?'], arrows: [{ reagents: 'LDA (1.05 equiv), THF, −78 °C; then MeI', conditions: '−78 °C → rt' }] },
    answer: { structures: ['CC1CCCC(C)C1=O'] },
  },
  {
    // A Staudinger reduction: the azide goes, the nitro group stays.
    id: 'reaction-c12',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['[N-]=[N+]=NCc1ccc([N+](=O)[O-])cc1', '?'], arrows: [{ reagents: 'PPh3 (1.1 equiv), H2O', conditions: 'THF, rt' }] },
    answer: { structures: ['NCc1ccc([N+](=O)[O-])cc1'] },
  },
  {
    // A stabilised ylide gives the E-alkene.
    id: 'reaction-c13',
    ask: 'What is the major product, with its geometry?',
    marks: 4,
    shown: { stages: ['O=Cc1cccnc1.CCOC(=O)C=P(c1ccccc1)(c1ccccc1)c1ccccc1', '?'], arrows: [{ reagents: '', conditions: 'CH2Cl2, rt, 12 h' }] },
    answer: { structures: ['CCOC(=O)/C=C/c1cccnc1'] },
  },
  {
    // Freed, the amine closes onto the ester rather than staying as the amino ester.
    id: 'multistep-c3',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['COC(=O)CCCNC(=O)OC(C)(C)C', '?'], arrows: [{ reagents: 'i. TFA, CH2Cl2, rt\nii. Et3N, MeOH, 60 °C' }] },
    answer: { sequence: ['COC(=O)CCCN', 'O=C1CCCN1'] },
  },
  {
    // The silyl ether goes, the carbamate stays, and the alcohol is carried on to the azide.
    id: 'multistep-c4',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['CC(C)(C)[Si](C)(C)OCC1CCN(C(=O)OC(C)(C)C)C1', '?'], arrows: [{ reagents: 'i. TBAF, THF, rt\nii. MsCl, Et3N, 0 °C\niii. NaN3, DMF, 60 °C' }] },
    answer: { sequence: ['OCC1CCN(C(=O)OC(C)(C)C)C1', 'CS(=O)(=O)OCC1CCN(C(=O)OC(C)(C)C)C1', '[N-]=[N+]=NCC1CCN(C(=O)OC(C)(C)C)C1'] },
  },
  {
    // A pinacol rearrangement: the cation forms, then a methyl migrates to it.
    id: 'mechanism-c1',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['CC(C)(O)C(C)(C)O', '?'], arrows: [{ reagents: 'H2SO4 (cat.)', conditions: 'heat' }] },
    answer: { sequence: ['CC(C)(O)[C+](C)C', 'CC(=O)C(C)(C)C'] },
  },
  {
    // A Baeyer-Villiger through its Criegee intermediate.
    id: 'mechanism-c2',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['O=C1CCCC1', '?'], arrows: [{ reagents: 'mCPBA (1.2 equiv)', conditions: 'CH2Cl2, rt' }] },
    answer: { sequence: ['OC1(OOC(=O)c2cccc(Cl)c2)CCCC1', 'O=C1CCCCO1'] },
  },
  {
    id: 'analysis-c2',
    ask: 'How many stereoisomers does this compound have? Count each enantiomer and each meso form.',
    marks: 3,
    shown: { stages: ['CC(Br)C(Br)C'] },
    answer: { written: '3' },
  },
  {
    // The sulfonamide NH, not the anilide: about ten orders of magnitude apart.
    id: 'analysis-c3',
    ask: 'Which NH is the most acidic?',
    marks: 3,
    shown: { stages: ['CS(=O)(=O)Nc1ccc(NC(C)=O)cc1'] },
    answer: { atoms: 'CS(=O)(=O)[NH:1]c1ccc(NC(C)=O)cc1' },
  },
  {
    // Three fluorines four bonds away take about four units off.
    id: 'analysis-c4',
    ask: 'Estimate the pKa of the conjugate acid of this amine.',
    marks: 3,
    shown: { stages: ['FC(F)(F)CNC'] },
    answer: { written: '6.1 ± 1.2' },
  },
  {
    id: 'structure-c2',
    ask: 'Draw the tautomer that predominates.',
    marks: 2,
    shown: { stages: ['Oc1ccccn1'] },
    answer: { structures: ['O=C1C=CC=CN1'] },
  },
];

/** The papers author.ts can draw, by --set. */
/**
 * Harder chemistry: rearrangements, ring-forming reactions and functional
 * groups a chemist meets less often.
 *
 * The paper above separates models by the size of the molecule — whether they
 * can carry twenty-five heavy atoms through a transformation. These separate
 * them by whether they know the chemistry: each is a named reaction whose
 * outcome a rule decides (which group migrates, which end of an allyl system
 * the nitrogen lands on, which regiochemistry a catalyst gives), so a model
 * that knows the rule gets it and a model that pattern-matches on functional
 * groups does not. The molecules are small on purpose: nothing here is lost
 * to bookkeeping.
 */
export const HARD: Spec[] = [
  {
    // Beckmann: the group anti to the oxime OH migrates to nitrogen. Here the
    // aryl group migrates, so the product is the anilide, not the N-methyl amide.
    id: 'reaction-h1',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['CC(=NO)c1ccc2OCOc2c1', '?'], arrows: [{ reagents: 'TsCl, pyridine, CH2Cl2, 0 °C to rt' }] },
    answer: { structures: ['CC(=O)Nc1ccc2OCOc2c1'] },
  },
  {
    // Curtius: the acyl azide loses N2 to the isocyanate, the carbon that
    // migrates keeps its configuration, and t-BuOH traps it as the Boc amine.
    id: 'reaction-h2',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['OC(=O)C1(CC1)c1ccc(F)cc1', '?'], arrows: [{ reagents: 'i. DPPA, Et3N, toluene, 90 °C\nii. t-BuOH, reflux' }] },
    answer: { structures: ['CC(C)(C)OC(=O)NC1(CC1)c1ccc(F)cc1'] },
  },
  {
    // Overman: [3,3] through the trichloroacetimidate, so the nitrogen arrives
    // at the far end of the allyl system and the alkene moves to where the
    // oxygen was. An amide at the carbinol carbon is the wrong answer.
    id: 'reaction-h3',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['CC(O)/C=C/c1ccccc1', '?'], arrows: [{ reagents: 'i. NaH, Cl3CCN, CH2Cl2, 0 °C\nii. xylene, 140 °C' }] },
    answer: { structures: ['C/C=C/C(NC(=O)C(Cl)(Cl)Cl)c1ccccc1'] },
  },
  {
    // Favorskii: the cyclopropanone collapses to the ring-contracted ester.
    // Simple substitution of the chloride is the wrong answer.
    id: 'reaction-h4',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['O=C1CCCCC1Cl', '?'], arrows: [{ reagents: 'NaOMe, MeOH, 0 °C' }] },
    answer: { structures: ['COC(=O)C1CCCC1'] },
  },
  {
    // Baeyer-Villiger: the electron-rich aryl migrates in preference to methyl,
    // so the oxygen ends up between the carbonyl and the ring.
    id: 'reaction-h5',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['CC(=O)c1ccc(OC)cc1', '?'], arrows: [{ reagents: 'mCPBA, CH2Cl2, rt' }] },
    answer: { structures: ['CC(=O)Oc1ccc(OC)cc1'] },
  },
  {
    // Meinwald: the Lewis acid opens the epoxide to the benzylic cation and a
    // hydride shifts, so a 1,1-diaryl epoxide becomes the aldehyde, not the ketone.
    id: 'reaction-h6',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['C1OC1(c1ccccc1)c1ccccc1', '?'], arrows: [{ reagents: 'BF3·OEt2, CH2Cl2, -78 °C' }] },
    answer: { structures: ['O=CC(c1ccccc1)c1ccccc1'] },
  },
  {
    // Rufinamide, the anticonvulsant, made as it is made: copper gives the
    // 1,4-triazole, which is the drug. The 1,5-isomer is a different compound.
    // Product checked against PubChem's record for rufinamide.
    id: 'reaction-h7',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['[N-]=[N+]=NCc1c(F)cccc1F.NC(=O)C#C', '?'], arrows: [{ reagents: 'CuSO4·5H2O, sodium ascorbate, t-BuOH/H2O, 50 °C' }] },
    answer: { structures: ['NC(=O)c1cn(Cc2c(F)cccc2F)nn1'] },
  },
  {
    // Groebke-Blackburn-Bienayme: the three components close to the
    // imidazo[1,2-a]pyridine, the isocyanide nitrogen left as the 3-amino group.
    id: 'reaction-h8',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['Nc1ccccn1.O=Cc1ccc(Cl)cc1.CC(C)(C)[N+]#[C-]', '?'], arrows: [{ reagents: 'Sc(OTf)3 (10 mol%), MeOH, 60 °C' }] },
    answer: { structures: ['CC(C)(C)Nc1c(-c2ccc(Cl)cc2)nc2ccccn12'] },
  },
  {
    // Mitsunobu: the alcohol carbon inverts.
    id: 'reaction-h9',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['C[C@H](O)c1ccc(cc1)C#N', '?'], arrows: [{ reagents: 'phthalimide, PPh3, DIAD, THF, 0 °C to rt' }] },
    answer: { structures: ['C[C@@H](N1C(=O)c2ccccc2C1=O)c1ccc(cc1)C#N'] },
  },
  {
    // Sumatriptan by the Fischer indolisation its route is built on: the
    // aldehyde's carbons become C2 and C3, so the side chain ends up at C3 and
    // C2 is left bare. Product checked against PubChem's record for sumatriptan.
    id: 'reaction-h10',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['CNS(=O)(=O)Cc1ccc(NN)cc1.CN(C)CCCC=O', '?'], arrows: [{ reagents: 'aqueous HCl, EtOH, 80 °C' }] },
    answer: { structures: ['CNS(=O)(=O)Cc1ccc2[nH]cc(CCN(C)C)c2c1'] },
  },
  {
    // Schmidt: nitrogen inserts next to the carbonyl and the ring expands to
    // the seven-membered lactam. The ketone is symmetric about the carbonyl,
    // so which side migrates does not change the answer.
    id: 'reaction-h11',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['O=C1CCC(CC1)c1ccccc1', '?'], arrows: [{ reagents: 'NaN3, H2SO4, CHCl3, 50 °C' }] },
    answer: { structures: ['O=C1CCC(c2ccccc2)CCN1'] },
    hazard: ['azide', 'hydrazoic', 'HN3', 'explosive', 'toxic'],
  },
  {
    // Nirmatrelvir's nitrile, by the dehydration its published route uses.
    // The test is chemoselectivity: the primary amide goes, and the lactam and
    // the two secondary amides do not. Product checked against PubChem's
    // record for nirmatrelvir.
    id: 'reaction-h12',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['CC1([C@@H]2[C@H]1[C@H](N(C2)C(=O)[C@H](C(C)(C)C)NC(=O)C(F)(F)F)C(=O)N[C@@H](C[C@@H]3CCNC3=O)C(N)=O)C', '?'], arrows: [{ reagents: 'Burgess reagent, CH2Cl2, 0 °C to rt' }] },
    answer: { structures: ['CC1([C@@H]2[C@H]1[C@H](N(C2)C(=O)[C@H](C(C)(C)C)NC(=O)C(F)(F)F)C(=O)N[C@@H](C[C@@H]3CCNC3=O)C#N)C'] },
  },
  {
    // Rilpivirine's acrylonitrile, by the Heck its route uses: the alkene comes
    // out E, and the aryl bromide is the only halide that reacts. Product
    // checked against PubChem's record for rilpivirine.
    id: 'reaction-h13',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['Cc1cc(Br)cc(C)c1Nc1ccnc(Nc2ccc(C#N)cc2)n1.C=CC#N', '?'], arrows: [{ reagents: 'Pd(OAc)2, P(o-tol)3, Et3N, DMF, 120 °C' }] },
    answer: { structures: ['Cc1cc(/C=C/C#N)cc(C)c1Nc1ccnc(Nc2ccc(C#N)cc2)n1'] },
  },
  {
    // Vortioxetine in the two steps its route uses. The test is chemoselectivity
    // in the first: the iodide reacts and the bromide waits for the palladium.
    // Product checked against PubChem's record for vortioxetine.
    id: 'multistep-h1',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['Cc1ccc(S)c(C)c1.Ic1ccccc1Br', '?'], arrows: [{ reagents: 'i. CuI, K2CO3, DMF, 90 °C\nii. piperazine, Pd2(dba)3, BINAP, NaOtBu, toluene, 100 °C' }] },
    answer: { sequence: ['Cc1ccc(Sc2ccccc2Br)c(C)c1', 'Cc1ccc(Sc2ccccc2N3CCNCC3)c(C)c1'] },
  },
  {
    // Celecoxib, which is made from exactly these two in one step. The
    // regiochemistry of the pyrazole is the whole question: the other way round
    // is a different compound that failed. Both halves are sold by the drum.
    id: 'retrosynthesis-h1',
    ask: 'Give two starting materials you could buy for a one-step synthesis of this compound.',
    marks: 5,
    shown: { stages: ['Cc1ccc(cc1)-c1cc(nn1-c1ccc(cc1)S(N)(=O)=O)C(F)(F)F', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['Cc1ccc(cc1)C(=O)CC(=O)C(F)(F)F', 'NNc1ccc(cc1)S(N)(=O)=O'] },
  },
  {
    // Ciprofloxacin: the far piperazine nitrogen is the base, not the one on
    // the ring, and not the one the quinolone is built on.
    id: 'analysis-h1',
    ask: 'Which nitrogen is the most basic?',
    marks: 3,
    shown: { stages: ['OC(=O)C1=CN(C2CC2)c2cc(N3CCNCC3)c(F)cc2C1=O'] },
    answer: { atoms: 'OC(=O)C1=CN(C2CC2)c2cc(N3CC[NH:1]CC3)c(F)cc2C1=O' },
  },
  {
    // Efavirenz has one stereocentre and it is quaternary, with an alkyne on it.
    id: 'structure-h2',
    ask: 'Draw the enantiomer of this compound.',
    marks: 2,
    shown: { stages: ['C1CC1C#C[C@]2(C3=C(C=CC(=C3)Cl)NC(=O)O2)C(F)(F)F', '?'], arrows: [{ reagents: '' }] },
    answer: { structures: ['C1CC1C#C[C@@]2(C3=C(C=CC(=C3)Cl)NC(=O)O2)C(F)(F)F'] },
  },
  {
    // Sodium hydride in DMF: the combination that has run away and destroyed
    // plant, and the one a chemist is expected to flag before the methylation.
    id: 'hazard-h1',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['Oc1ccc(cc1)C(=O)N1CCOCC1', '?'], arrows: [{ reagents: 'NaH (1.2 equiv), MeI, DMF, 0 °C to rt' }] },
    answer: { structures: ['COc1ccc(cc1)C(=O)N1CCOCC1'] },
    hazard: ['sodium hydride', 'NaH', 'DMF', 'runaway', 'exotherm', 'thermal', 'decomposition'],
  },
  {
    // The sulfoximine: nitrogen is delivered to sulfur, not to carbon, and the
    // sulfur keeps four different things on it.
    id: 'structure-h1',
    ask: 'What is the product?',
    marks: 2,
    shown: { stages: ['CS(=O)c1ccccc1', '?'], arrows: [{ reagents: 'ammonium carbamate, PhI(OAc)2, MeOH, rt' }] },
    answer: { structures: ['CS(=N)(=O)c1ccccc1'] },
  },
];

export const PAPERS: Record<string, Spec[]> = { '': PAPER, candidates: CANDIDATES, hard: HARD };
