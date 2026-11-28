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
    shown: { stages: ['CC(=O)c1ccc(OC)c(OC)c1', '?'], arrows: [{ reagents: 'mCPBA, CH2Cl2, rt' }] },
    answer: { structures: ['CC(=O)Oc1ccc(OC)c(OC)c1'] },
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
  {
    // From a chemist's own drawing, as were the nine after it: the answer is the product they drew.
    // Amphidinolide P (Lee, 2013). Sodium hydride closes the bromohydrin to the epoxide, inverting the carbon
    // that carried the bromide, and the other alcohol is silylated.
    id: 'reaction-r1',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['OC[C@H](CCO)Br', '?'], arrows: [{ reagents: 'NaH, TBSCl, THF' }] },
    answer: { structures: ['CC([Si](OCC[C@@H]1CO1)(C)C)(C)C'] },
  },
  {
    // Crizotinib (Pfizer). The Mitsunobu inverts the benzylic carbinol as the pyridinol takes its place.
    id: 'reaction-r2',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['ClC1=C(C(=C(C=C1)F)Cl)[C@H](C)O.[O-][N+](C=1C(=CC=CN1)O)=O', '?'], arrows: [{ reagents: 'DIAD, PPh3, toluene, 0 °C' }] },
    answer: { structures: ['ClC1=C(C(=C(C=C1)F)Cl)[C@@H](C)OC2=C(N=CC=C2)[N+](=O)[O-]'] },
  },
  {
    // Netarsudil. The Evans enolate is aminomethylated by the benzotriazolylmethyl carbamate, which
    // gives up benzotriazole: the new stereocentre is set by the auxiliary.
    id: 'reaction-r3',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['O=C(OCC1=CC=C(C=C1)CC(=O)N2C(O[C@@H](C2)CC3=CC=CC=C3)=O)C4=C(C=C(C=C4)C)C.CC(OC(NCN2N=NC1=CC=CC=C12)=O)(C)C', '?'], arrows: [{ reagents: 'LiHMDS, THF, -70 °C to -30 °C' }] },
    answer: { structures: ['O=C(OCC1=CC=C(C=C1)[C@H](C(=O)N2C(O[C@@H](C2)CC3=CC=CC=C3)=O)CNC(=O)OC(C)(C)C)C4=C(C=C(C=C4)C)C'] },
  },
  {
    // A macrocyclic peptide closed by HATU: the free amine and the acid at the ends of a chain
    // of some 100 heavy atoms meet. Bookkeeping at the size where models give out.
    id: 'reaction-r4',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['O=C(N1[C@@H](CCC1)C(NC5(C(N([C@H](C(N([C@@H](CC(N([C@H](C(N[C@H](C(N([C@H](C(N3[C@H](C(N([C@H](C(N(CC(=O)O)C)=O)CC2=CC=C(C=C2)C)CC)=O)CC3)=O)C)C)=O)[C@@H](C)CC)=O)CC(C)C)C)=O)C(N(C)C)=O)C)=O)C4CCCC4)C)=O)CCCC5)=O)[C@@H](N)CCC6=CC(=C(C(=C6)F)C(F)(F)F)F', '?'], arrows: [{ reagents: 'HATU, DIPEA, MeCN' }] },
    answer: { structures: ['O=C2N1[C@@H](CCC1)C(NC7(C(N([C@H](C(N([C@@H](CC(N([C@H](C(N[C@H](C(N([C@H](C(N5[C@H](C(N([C@H](C(N(CC(N[C@H]2CCC3=CC(=C(C(=C3)F)C(F)(F)F)F)=O)C)=O)CC4=CC=C(C=C4)C)CC)=O)CC5)=O)C)C)=O)[C@@H](C)CC)=O)CC(C)C)C)=O)C(N(C)C)=O)C)=O)C6CCCC6)C)=O)CCCC7)=O'] },
  },
  {
    // A nuphar thioalkaloid. DIBAL at -89 °C takes the ester only as far as the aldehyde, which
    // closes onto the ring's NH to the hemiaminal.
    id: 'reaction-r5',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['COC([C@]3(CC[C@H]1[C@@H](CC[C@H](N1)C=2C=COC2)C)C[C@@]4(CS3)CC[C@@]5(N(C4)C(CCC5C)C6=COC=C6)[H])=O', '?'], arrows: [{ reagents: 'i-Bu2AlH, CH2Cl2, -89 °C' }] },
    answer: { structures: ['O[C@@H]2[C@]4(CC[C@]1([C@@H](CC[C@H](N12)C=3C=COC3)C)[H])C[C@@]5(CS4)CC[C@@]6(N(C5)[C@@H](CC[C@H]6C)C7=COC=C7)[H]'] },
  },
  {
    // Glecaprevir. Ring-closing metathesis makes the macrocycle and gives off ethylene; the
    // catalyst, drawn over the arrow in the original, is named here as a chemist writes it.
    id: 'reaction-r6',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['FC(C=2C(=NC1=CC(=CC=C1N2)OC)O[C@H]4CN(C([C@@H](NC(O[C@H]3[C@H](CC=C)C3)=O)C(C)(C)C)=O)[C@@H]([C@@H]4CC)C(=O)OC)(CC=C)F', '?'], arrows: [{ reagents: 'Zhan catalyst-1B, toluene, 100 °C' }] },
    answer: { structures: ['FC3(C=2C(=NC1=CC(=CC=C1N2)OC)O[C@H]5CN(C([C@@H](NC(O[C@H]4[C@H](C/C=C/C3)C4)=O)C(C)(C)C)=O)[C@@H]([C@@H]5CC)C(=O)OC)F'] },
  },
  {
    // Cerium chloride makes the Grignard add 1,2 to the ketone, leaving the lactone and the
    // enone's double bond alone.
    id: 'reaction-r7',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['CC[Si](O[C@@]12[C@@H](CC=C(C(C1)=O)C#C[Si](C)(C)C)C(OC2=O)(C)C)(CC)CC.Br[Mg]CCC(=C)C', '?'], arrows: [{ reagents: 'CeCl3, THF, 0 °C' }] },
    answer: { structures: ['CC[Si](O[C@@]12[C@@H](CC=C([C@](C1)(O)CCC(=C)C)C#C[Si](C)(C)C)C(OC2=O)(C)C)(CC)CC'] },
  },
  {
    // An intramolecular Diels-Alder: the silyloxy diene and the tethered alkene close two rings
    // in one step, the product an isomer of the starting material.
    id: 'reaction-r8',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['C=C(C1=CC(CC1)(CC(C)(C=C)C)C)O[Si](C)(C)C(C)(C)C', '?'], arrows: [{ reagents: 'PhMe, 150 °C' }] },
    answer: { structures: ['CC([Si](OC3=C1[C@]2([C@@](CC1)(CC([C@@]2(CC3)[H])(C)C)C)[H])(C)C)(C)C'] },
  },
  {
    // Trospium chloride. The secondary amine is alkylated twice by 1,4-dichlorobutane, closing the
    // spiro pyrrolidinium: the product is a quaternary ammonium salt.
    id: 'reaction-r9',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['OC(C(OC1CC2NC(C1)CC2)=O)(C3=CC=CC=C3)C4=CC=CC=C4.ClCCCCCl', '?'], arrows: [{ reagents: 'Et3N, MeCN, 50 °C' }] },
    answer: { structures: ['OC(C(OC1CC2[N+]3(C(C1)CC2)CCCC3)=O)(C4=CC=CC=C4)C5=CC=CC=C5', '[Cl-]'] },
    also: [{ structures: ['OC(C(OC1CC2[N+]3(C(C1)CC2)CCCC3)=O)(C4=CC=CC=C4)C5=CC=CC=C5'] }],
  },
  {
    // A Hantzsch dihydropyridine, as made for clevidipine: the benzylidene ketoester and the
    // enamino ester close the ring, losing water.
    id: 'reaction-r10',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['ClC1=C(C(=CC=C1)\\C=C(\\C(C)=O)C(OC)=O)Cl.C\\C(=C\\C(OCCC#N)=O)N', '?'], arrows: [{ reagents: 'n-propanol, reflux' }] },
    answer: { structures: ['O=C(C1=C(NC(=C(C1C2=C(C(=CC=C2)Cl)Cl)C(OCCC#N)=O)C)C)OC'] },
  },
];

/**
 * The thin types, in questions/types/: the question types the paper was thinnest on,
 * drawn from Chemistry by Design (CbyD), a curated dataset of published total
 * and process syntheses (Williams et al., arXiv:2611.24996, CC-BY 4.0).
 *
 * Every reaction here is a step a chemist published, and the answer is the
 * product they drew: the chemistry is not invented, so what a model gets wrong
 * is its own. Each step was checked before it was written down -- the atoms
 * balance, and every stereocentre the step does not touch has the same
 * configuration in the product as in the starting material (a chain where the
 * dataset's own drawings disagreed on a centre was dropped, not patched).
 *
 * The questions are picked to lean on drawing rather than recall: molecules at
 * the size where bookkeeping fails (a group dropped, a fluorine lost, a
 * protecting group quietly removed), stereocentres that must be carried, and
 * answers that are several structures rather than one.
 */
export const THIN_TYPES: Spec[] = [
  // --------------------------------------------------------------- multistep
  {
    // Ritlecitinib (Pfizer). Three selectivities in a row: the acid takes the Boc
    // and leaves the Cbz, the freed amine goes to C4 of the dichloride, and the
    // hydrogenolysis takes the Cbz and the chloride together.
    id: 'multistep-d1',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['C[C@H]1CC[C@@H](NC(=O)OC(C)(C)C)CN1C(=O)OCc1ccccc1', '?'], arrows: [{ reagents: 'i. 4 M HCl, dioxane/CH2Cl2, 0 °C → rt\nii. 2,4-dichloro-7H-pyrrolo[2,3-d]pyrimidine, DIPEA, n-BuOH, 140 °C\niii. H2 (1 atm), 10% Pd/C, MeOH/THF, 25–45 °C' }] },
    answer: { sequence: ['C[C@H]1CC[C@@H](N)CN1C(=O)OCc1ccccc1', 'C[C@H]1CC[C@@H](Nc2nc(Cl)nc3[nH]ccc23)CN1C(=O)OCc1ccccc1', 'C[C@H]1CC[C@@H](Nc2ncnc3[nH]ccc23)CN1'] },
  },
  {
    // Larotrectinib (Loxo). The aryl amine is acylated, not the ring nitrogens,
    // and the carbamate is then displaced by the pyrrolidinol to the urea.
    id: 'multistep-d2',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['O=[N+]([O-])c1cnn2ccc(N3CCC[C@@H]3c3cc(F)ccc3F)nc12', '?'], arrows: [{ reagents: 'i. H2 (1 atm), 5% Pt/C, MeOH\nii. phenyl chloroformate, K2CO3, 2-MeTHF/H2O\niii. (S)-pyrrolidin-3-ol, EtOH; then H2SO4' }] },
    answer: { sequence: ['Nc1cnn2ccc(N3CCC[C@@H]3c3cc(F)ccc3F)nc12', 'O=C(Nc1cnn2ccc(N3CCC[C@@H]3c3cc(F)ccc3F)nc12)Oc1ccccc1', 'O=C(Nc1cnn2ccc(N3CCC[C@@H]3c3cc(F)ccc3F)nc12)N1CC[C@H](O)C1'] },
  },
  {
    // Avanafil (Vivus). The prolinol's nitrogen displaces the sulfone, not its own
    // alcohol; the ester is then hydrolysed and the acid coupled -- and through all
    // three the primary alcohol is left alone.
    id: 'multistep-d3',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['CCOC(=O)c1cnc(S(C)(=O)=O)nc1NCc1ccc(OC)c(Cl)c1', '?'], arrows: [{ reagents: 'i. (S)-pyrrolidin-2-ylmethanol, Et3N, THF\nii. NaOH, DMSO\niii. 2-(aminomethyl)pyrimidine, EDC·HCl, HOBt, DMF' }] },
    answer: { sequence: ['CCOC(=O)c1cnc(N2CCC[C@H]2CO)nc1NCc1ccc(OC)c(Cl)c1', 'COc1ccc(CNc2nc(N3CCC[C@H]3CO)ncc2C(=O)O)cc1Cl', 'COc1ccc(CNc2nc(N3CCC[C@H]3CO)ncc2C(=O)NCc2ncccn2)cc1Cl'] },
  },
  {
    // Lesinurad (AstraZeneca). The thiol is alkylated, and the bromine then goes on
    // the triazole's own carbon rather than the electron-rich naphthalene.
    id: 'multistep-d4',
    ask: 'Give the product of each step, in order.',
    marks: 4,
    shown: { stages: ['Sc1nncn1-c1ccc(C2CC2)c2ccccc12', '?'], arrows: [{ reagents: 'i. methyl bromoacetate, NaHCO3, DMF, 30 °C\nii. NBS, THF, 30 °C' }] },
    answer: { sequence: ['COC(=O)CSc1nncn1-c1ccc(C2CC2)c2ccccc12', 'COC(=O)CSc1nnc(Br)n1-c1ccc(C2CC2)c2ccccc12'] },
  },
  {
    // Tirbanibulin (Athenex). Three different reactions on the same ring: the bromide
    // couples, the fluoride is displaced by the acetonitrile anion, and the nitrile
    // is then taken through to the methyl ester -- the morpholine surviving the acid.
    id: 'multistep-d5',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['Brc1ccc(OCCN2CCOCC2)cc1', '?'], arrows: [{ reagents: 'i. (6-fluoropyridin-3-yl)boronic acid, Pd(PPh3)4, Na2CO3, DME/H2O, 80 °C\nii. MeCN, NaHMDS, THF, −10 °C\niii. H2SO4, MeOH, reflux' }] },
    answer: { sequence: ['Fc1ccc(-c2ccc(OCCN3CCOCC3)cc2)cn1', 'N#CCc1ccc(-c2ccc(OCCN3CCOCC3)cc2)cn1', 'COC(=O)Cc1ccc(-c2ccc(OCCN3CCOCC3)cc2)cn1'] },
  },
  {
    // Delgocitinib (Japan Tobacco). Both lactams of the spiro bis-lactam are reduced
    // to amines, the pyrrolidine then does the SNAr, and the benzyl comes off last.
    id: 'multistep-d6',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['C[C@H]1C(=O)N(Cc2ccccc2)[C@]12CCNC2=O', '?'], arrows: [{ reagents: 'i. LiAlH4, AlCl3, THF, 0 → 50 °C\nii. 4-chloro-7H-pyrrolo[2,3-d]pyrimidine, K3PO4, t-BuOH/H2O, 75 °C\niii. H2 (1 atm), 10% Pd/C, AcOH' }] },
    answer: { sequence: ['C[C@H]1CN(Cc2ccccc2)[C@]12CCNC2', 'C[C@H]1CN(Cc2ccccc2)[C@]12CCN(c1ncnc3[nH]ccc13)C2', 'C[C@H]1CN[C@]12CCN(c1ncnc3[nH]ccc13)C2'] },
  },
  {
    // Dihydroartemisinic alcohol to its methyl ester, on the way to artemisinin:
    // oxidation, oxidation, esterification, with five stereocentres and a
    // trisubstituted alkene to carry through all three and nothing else to decide.
    id: 'multistep-d7',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['CC1=C[C@@H]2[C@@H](CC1)[C@H](C)CC[C@H]2[C@@H](C)CO', '?'], arrows: [{ reagents: 'i. (COCl)2, DMSO, Et3N, CH2Cl2, −78 °C\nii. NaClO2, NaH2PO4, 2-methyl-2-butene, t-BuOH/H2O\niii. MeI, K2CO3, acetone, rt' }] },
    answer: { sequence: ['CC1=C[C@@H]2[C@@H](CC1)[C@H](C)CC[C@H]2[C@@H](C)C=O', 'CC1=C[C@@H]2[C@@H](CC1)[C@H](C)CC[C@H]2[C@@H](C)C(=O)O', 'COC(=O)[C@H](C)[C@@H]1CC[C@@H](C)[C@@H]2CCC(C)=C[C@H]21'] },
  },
  {
    // Deucravacitinib (BMS). The amidine closes to the triazole, the methyl goes on
    // the nitrogen away from the aryl, and the nitro group is reduced last.
    id: 'multistep-d8',
    ask: 'Give the product of each step, in order.',
    marks: 5,
    shown: { stages: ['COc1c(C(=O)/N=C/N(C)C)cccc1[N+](=O)[O-]', '?'], arrows: [{ reagents: 'i. hydrazine hydrate, AcOH, EtOH, rt\nii. KHMDS, MeI, THF, rt\niii. H2 (1 atm), 10% Pd/C, EtOH, rt' }] },
    answer: { sequence: ['COc1c(-c2nc[nH]n2)cccc1[N+](=O)[O-]', 'COc1c(-c2ncn(C)n2)cccc1[N+](=O)[O-]', 'COc1c(N)cccc1-c1ncn(C)n1'] },
  },

  // --------------------------------------------------------------- mechanism
  // Each is short on purpose: a mechanism that needs nine intermediates measures
  // how much a model can write before the token limit, not what it knows.
  {
    // Swern: the alkoxysulfonium salt, then the ylide takes the proton and the
    // aldehyde falls out. The cyclopropane's two centres are spectators.
    id: 'mechanism-d1',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['CCCCCCCC[C@H]1C[C@H]1CO', '?'], arrows: [{ reagents: '(COCl)2, DMSO, CH2Cl2, −78 °C; then Et3N, −78 → 23 °C' }] },
    answer: { sequence: ['CCCCCCCC[C@H]1C[C@H]1CO[S+](C)C', 'CCCCCCCC[C@H]1C[C@H]1C=O'] },
  },
  {
    // Mitsunobu: the alkoxyphosphonium keeps the carbinol's configuration, and the
    // acetate then inverts it. An ester drawn with retention is the wrong answer.
    id: 'mechanism-d2',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['C[C@@]1(CCC=O)C=C[C@H](O)CC1.CC(=O)O', '?'], arrows: [{ reagents: 'DIAD, PPh3', conditions: 'THF' }] },
    answer: { sequence: ['C[C@@]1(CCC=O)C=C[C@H](O[P+](c2ccccc2)(c2ccccc2)c2ccccc2)CC1', 'CC(=O)O[C@@H]1C=C[C@@](C)(CCC=O)CC1'] },
  },
  {
    // Vilsmeier: the arene attacks the chloroiminium, and the iminium salt is the
    // thing that survives until water hydrolyses it to the aldehyde.
    id: 'mechanism-d3',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['CCOC(=O)Cc1cc(OC)cc(OC)c1', '?'], arrows: [{ reagents: 'POCl3, DMF, rt, 19 h; then H2O' }] },
    answer: { sequence: ['CCOC(=O)Cc1cc(OC)cc(OC)c1C=[N+](C)C', 'CCOC(=O)Cc1cc(OC)cc(OC)c1C=O'] },
  },
  {
    // Krapcho: the chloride takes the methyl, not the carbonyl, and the carboxylate
    // then loses CO2. The two ring stereocentres are untouched.
    id: 'mechanism-d4',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['C=C(Br)C[C@@]12CC=C[C@@H]1CC(C(=O)OC)C(=O)C2', '?'], arrows: [{ reagents: 'NaCl, DMSO, 125 °C' }] },
    answer: { sequence: ['C=C(Br)C[C@@]12CC=C[C@@H]1CC(C(=O)[O-])C(=O)C2', 'C=C(Br)C[C@@]12CC=C[C@@H]1CCC(=O)C2'] },
  },
  {
    // Pictet-Spengler, as tadalafil is made: the iminium, then the indole's C2
    // closes onto it. Both new rings and the cis relationship come out of that step.
    id: 'mechanism-d5',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['COC(=O)[C@H](N)Cc1c[nH]c2ccccc12.O=Cc1ccc2c(c1)OCO2', '?'], arrows: [{ reagents: 'TFA, CH2Cl2' }] },
    answer: { sequence: ['COC(=O)[C@H](Cc1c[nH]c2ccccc12)[NH+]=Cc1ccc2c(c1)OCO2', 'COC(=O)[C@H]1Cc2c([nH]c3ccccc23)[C@@H](c2ccc3c(c2)OCO3)N1'] },
    // The neutral imine is the same step without the proton.
    also: [{ sequence: ['COC(=O)[C@H](Cc1c[nH]c2ccccc12)N=Cc1ccc2c(c1)OCO2', 'COC(=O)[C@H]1Cc2c([nH]c3ccccc23)[C@@H](c2ccc3c(c2)OCO3)N1'] }],
  },
  {
    // Corey-Chaykovsky: the ylide adds to the ketone and the betaine closes to the
    // epoxide. The methyl's centre is carried; the new one is left open.
    id: 'mechanism-d6',
    ask: 'Give the mechanism as each intermediate in order, ending with the product.',
    marks: 5,
    shown: { stages: ['C[C@@H](OC1CCCCO1)C(=O)c1ccc(F)cc1F', '?'], arrows: [{ reagents: 'Me3S(O)I, NaOt-Bu, THF/DMF, 20–25 °C' }] },
    answer: { sequence: ['C[C@@H](OC1CCCCO1)C([O-])(C[S+](C)(C)=O)c1ccc(F)cc1F', 'C[C@@H](OC1CCCCO1)C1(CO1)c1ccc(F)cc1F'] },
  },

  // ---------------------------------------------------------- retrosynthesis
  {
    // Mavacamten (MyoKardia), made from exactly these two. The amine is the one
    // sold; the uracil is the electrophile, at the chlorine.
    id: 'retrosynthesis-d1',
    ask: 'Give the two starting materials for a one-step synthesis of this compound.',
    marks: 5,
    shown: { stages: ['CC(C)n1c(=O)cc(N[C@@H](C)c2ccccc2)[nH]c1=O', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['CC(C)n1c(=O)cc(Cl)[nH]c1=O', 'C[C@H](N)c1ccccc1'] },
  },
  {
    // Lemborexant (Eisai). The amide is the bond to break; the quaternary centre and
    // the cyclopropane have to be drawn as they stand.
    id: 'retrosynthesis-d2',
    ask: 'Give the two starting materials for a one-step synthesis of this compound.',
    marks: 5,
    shown: { stages: ['Cc1ncc(OC[C@@]2(c3cccc(F)c3)C[C@H]2C(=O)Nc2ccc(F)cn2)c(C)n1', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['Cc1ncc(OC[C@@]2(c3cccc(F)c3)C[C@H]2C(=O)O)c(C)n1', 'Nc1ccc(F)cn1'] },
  },
  {
    // Glasdegib (Pfizer): a urea, so one half carries the carbonyl. Which amine it
    // is matters -- the ring amine, not the benzimidazole.
    id: 'retrosynthesis-d3',
    ask: 'Give the two starting materials for a one-step synthesis of this compound.',
    marks: 5,
    shown: { stages: ['CN1CC[C@@H](NC(=O)Nc2ccc(C#N)cc2)C[C@@H]1c1nc2ccccc2[nH]1', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['CN1CC[C@@H](N)C[C@@H]1c1nc2ccccc2[nH]1', 'O=C=Nc1ccc(C#N)cc1'] },
    also: [
      // The published coupling, and the carbamate that does the same job.
      { structures: ['CN1CC[C@@H](N)C[C@@H]1c1nc2ccccc2[nH]1', 'N#Cc1ccc(NC(=O)n2ccnc2)cc1'] },
      { structures: ['CN1CC[C@@H](N)C[C@@H]1c1nc2ccccc2[nH]1', 'N#Cc1ccc(NC(=O)Oc2ccccc2)cc1'] },
    ],
  },
  {
    // Abiraterone acetate (J&J). Seven stereocentres that must come through
    // untouched, and the bond to make is the biaryl-like C-C at the enol triflate.
    id: 'retrosynthesis-d4',
    ask: 'Give the two building blocks you would couple to make this compound.',
    marks: 5,
    shown: { stages: ['CC(=O)O[C@H]1CC[C@@]2(C)C(=CC[C@@H]3[C@@H]2CC[C@]2(C)C(c4cccnc4)=CC[C@@H]32)C1', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['CC(=O)O[C@H]1CC[C@@]2(C)C(=CC[C@@H]3[C@@H]2CC[C@]2(C)C(OS(=O)(=O)C(F)(F)F)=CC[C@@H]32)C1', 'OB(O)c1cccnc1'] },
    also: [
      // The published route couples the borane; the pinacol ester does as well.
      { structures: ['CC(=O)O[C@H]1CC[C@@]2(C)C(=CC[C@@H]3[C@@H]2CC[C@]2(C)C(OS(=O)(=O)C(F)(F)F)=CC[C@@H]32)C1', 'CCB(CC)c1cccnc1'] },
      { structures: ['CC(=O)O[C@H]1CC[C@@]2(C)C(=CC[C@@H]3[C@@H]2CC[C@]2(C)C(OS(=O)(=O)C(F)(F)F)=CC[C@@H]32)C1', 'CC1(C)OB(OC1(C)C)c1cccnc1'] },
    ],
  },
  {
    // Maribavir (Takeda). A glycosylation: the sugar is the electrophile at its
    // anomeric acetate, and the benzimidazole is the nucleophile.
    id: 'retrosynthesis-d5',
    ask: 'Give the two starting materials for a one-step synthesis of this compound.',
    marks: 5,
    shown: { stages: ['CC(=O)OC[C@@H]1O[C@H](n2c(Br)nc3cc(Cl)c(Cl)cc32)[C@@H](OC(C)=O)[C@H]1OC(C)=O', '?'], arrows: [{ type: 'retrosynthetic' }] },
    answer: { structures: ['CC(=O)OC[C@@H]1O[C@H](OC(C)=O)[C@@H](OC(C)=O)[C@H]1OC(C)=O', 'Brc1nc2cc(Cl)c(Cl)cc2[nH]1'] },
    // Silylated, as Vorbrüggen conditions use it.
    also: [{ structures: ['CC(=O)OC[C@@H]1O[C@H](OC(C)=O)[C@@H](OC(C)=O)[C@H]1OC(C)=O', 'C[Si](C)(C)n1c(Br)nc2cc(Cl)c(Cl)cc21'] }],
  },

  // ------------------------------------------------------------------- route
  {
    // Trelagliptin (Takeda). Two couplings end the published route: the uracil is
    // benzylated, then the chlorine is displaced by the aminopiperidine.
    id: 'route-d1',
    ask: 'Plan a synthesis of this compound from starting materials you can buy, in at most 4 steps.',
    marks: 5,
    shown: { stages: ['Cn1c(=O)cc(N2CCC[C@@H](N)C2)n(Cc2cc(F)ccc2C#N)c1=O'] },
    answer: { structures: ['Cn1c(=O)cc(Cl)[nH]c1=O', 'N#Cc1ccc(F)cc1CBr'] },
    also: [{ structures: ['Cn1c(=O)cc(Cl)n(Cc2cc(F)ccc2C#N)c1=O', 'N[C@@H]1CCCNC1'] }],
  },
  {
    // Lasmiditan (Eli Lilly). The amide on the aminopyridine is the bond that
    // counts; the benzoyl chloride and its acid are both sold.
    id: 'route-d2',
    ask: 'Plan a synthesis of this compound from starting materials you can buy, in at most 4 steps.',
    marks: 5,
    shown: { stages: ['CN1CCC(C(=O)c2cccc(NC(=O)c3c(F)cc(F)cc3F)n2)CC1'] },
    answer: { structures: ['CN1CCC(C(=O)c2cccc(N)n2)CC1', 'O=C(Cl)c1c(F)cc(F)cc1F'] },
    also: [{ structures: ['CN1CCC(C(=O)c2cccc(N)n2)CC1', 'O=C(O)c1c(F)cc(F)cc1F'] }],
  },
  {
    // Pitolisant (Bioprojet): one ether between two alcohols, so one of them has to
    // be activated first. The published route mesylates the benzylic side.
    id: 'route-d3',
    ask: 'Plan a synthesis of this compound from starting materials you can buy, in at most 3 steps.',
    marks: 5,
    shown: { stages: ['Clc1ccc(CCCOCCCN2CCCCC2)cc1'] },
    // Either half may carry the leaving group, and a chloride or a bromide does
    // the job a mesylate does: Sonnet made the compound in one step from the
    // alcohol and 1-chloro-3-piperidinopropane, which is this disconnection.
    answer: { structures: ['CS(=O)(=O)OCCCc1ccc(Cl)cc1', 'OCCCN1CCCCC1'] },
    also: [
      { structures: ['ClCCCc1ccc(Cl)cc1', 'OCCCN1CCCCC1'] },
      { structures: ['BrCCCc1ccc(Cl)cc1', 'OCCCN1CCCCC1'] },
      { structures: ['OCCCc1ccc(Cl)cc1', 'CS(=O)(=O)OCCCN1CCCCC1'] },
      { structures: ['OCCCc1ccc(Cl)cc1', 'ClCCCN1CCCCC1'] },
      { structures: ['OCCCc1ccc(Cl)cc1', 'BrCCCN1CCCCC1'] },
    ],
  },

  // --------------------------------------------------------------- structure
  {
    // Orlistat's beta-lactone fragment: three centres, all to be inverted, with the
    // strained ring and two chains to redraw around them.
    id: 'structure-d1',
    ask: 'Draw the enantiomer of this compound.',
    marks: 3,
    shown: { stages: ['CCCCCCCCCCC[C@@H](O)C[C@@H]1OC(=O)[C@H]1CCCCCC'] },
    answer: { structures: ['CCCCCCCCCCC[C@H](O)C[C@H]1OC(=O)[C@@H]1CCCCCC'] },
  },
  {
    // One group added, and everything else to be kept: three centres, a diene whose
    // geometry is drawn, and a PMB ether that is not the alcohol to protect.
    id: 'structure-d2',
    ask: 'Protect the primary alcohol as its tert-butyldimethylsilyl ether. Give the protected compound.',
    marks: 2,
    shown: { stages: ['C=C/C=C\\[C@H](C)[C@H](OCc1ccc(OC)cc1)[C@@H](C)CO'] },
    answer: { structures: ['C=C/C=C\\[C@H](C)[C@H](OCc1ccc(OC)cc1)[C@@H](C)CO[Si](C)(C)C(C)(C)C'] },
  },
  {
    // Sotagliflozin, three acetates off a thioglycoside: five stereocentres, and the
    // S-methyl is not an acetate.
    id: 'structure-d3',
    ask: 'Draw the compound you get by removing all three acetyl groups.',
    marks: 3,
    shown: { stages: ['CCOc1ccc(Cc2cc([C@@H]3O[C@H](SC)[C@@H](OC(C)=O)[C@H](OC(C)=O)[C@H]3OC(C)=O)ccc2Cl)cc1'] },
    answer: { structures: ['CCOc1ccc(Cc2cc([C@@H]3O[C@H](SC)[C@@H](O)[C@H](O)[C@H]3O)ccc2Cl)cc1'] },
  },
  {
    // The methyl ester, not the aryl methyl ether, on a tetracycle from a codeine route.
    id: 'structure-d4',
    ask: 'Draw the carboxylic acid formed when the methyl ester is hydrolysed.',
    marks: 2,
    shown: { stages: ['COC(=O)C[C@]12c3c4ccc(OC)c3O[C@H]1[C@H](O)CC[C@H]2C=C4'] },
    answer: { structures: ['OC(=O)C[C@]12c3c4ccc(OC)c3O[C@H]1[C@H](O)CC[C@H]2C=C4'] },
  },
  {
    // Triclabendazole: the sulfide to the sulfone, the ring NH left as it is.
    id: 'structure-d5',
    ask: 'Draw the sulfone formed by oxidising the sulfide.',
    marks: 2,
    shown: { stages: ['CSc1nc2cc(Oc3cccc(Cl)c3Cl)c(Cl)cc2[nH]1'] },
    answer: { structures: ['CS(=O)(=O)c1nc2cc(Oc3cccc(Cl)c3Cl)c(Cl)cc2[nH]1'] },
  },

  // ---------------------------------------------------------------- analysis
  {
    // Seven of the ring atoms are stereocentres; the gem-dimethyl carbon, which looks
    // like one on the page, is not.
    id: 'analysis-d1',
    ask: 'Which atoms are stereocentres?',
    marks: 3,
    shown: { stages: ['CC1(C)CC[C@H](O)[C@]2(C)[C@H]3Cc4occc4C(=O)[C@@H]3[C@@H](O)[C@H](O)[C@@]12O'] },
    // The numbers only name the atoms; an answer may number them in any order.
    answer: { atoms: 'CC1(C)CC[C@H:6](O)[C@:2]2(C)[C@H:3]3Cc4occc4C(=O)[C@@H:4]3[C@@H:5](O)[C@H:7](O)[C@@:1]12O' },
  },
  {
    // Four hydroxyls and amides on the page: the phenol is the acidic one, not the
    // hemiaminal next to the ring nitrogen.
    id: 'analysis-d2',
    ask: 'Which hydroxyl is the most acidic?',
    marks: 3,
    shown: { stages: ['CN1C(=O)[C@]2(CCCN2C(=O)C(F)(F)F)[C@@H](c2cccc(O)c2)[C@@H]1O'] },
    answer: { atoms: 'CN1C(=O)[C@]2(CCCN2C(=O)C(F)(F)F)[C@@H](c2cccc([OH:1])c2)[C@@H]1O' },
  },
  {
    // Centhaquine: three nitrogens, and the one that is not on an aryl ring or in
    // the quinoline is the base.
    id: 'analysis-d3',
    ask: 'Which nitrogen is the most basic?',
    marks: 3,
    shown: { stages: ['Cc1cccc(N2CCN(CCc3ccc4ccccc4n3)CC2)c1'] },
    answer: { atoms: 'Cc1cccc(N2CC[N:1](CCc3ccc4ccccc4n3)CC2)c1' },
  },
  {
    // Taxinine K: nine. Confirmed two ways -- the nine markers in the SMILES, and HexSketch's own
    // CIP namer, which independently assigns nine descriptors:
    // (1R,2R,3R,4R,7S,9R,10R,11R,14R)-...-4,14,15,15-tetramethyl-... C15 is the trap, a
    // quaternary carbon bearing two methyls, so it is not a centre and must not be counted.
    id: 'analysis-d4',
    ask: 'How many stereocentres does this compound have?',
    marks: 3,
    shown: { stages: ['C=C1[C@@H](O)CC[C@@]2(C)[C@@H](OC(C)=O)[C@H](OC(C)=O)[C@@]34[C@@H](C)C(=O)C[C@@H]([C@@H](OC(C)=O)[C@@]132)C4(C)C'] },
    answer: { written: '9' },
  },
  {
    // The vinyl iodide of a cephalotaxine route: one alkene whose geometry is drawn.
    id: 'analysis-d5',
    ask: 'Is the alkene E or Z?',
    marks: 2,
    shown: { stages: ['COc1ccc(CCN2CCC[C@@]2(C=O)C/C=C\\I)cc1OC'] },
    answer: { written: 'Z / (Z) / cis' },
  },

  // ------------------------------------------------------------------ hazard
  // The hazard is a property of the reagents and the solvent, not of the product:
  // the chemistry is ordinary, published chemistry, and what is being asked is
  // whether a model says the thing a colleague would say before the fume hood opens.
  {
    // HMPA as the co-solvent for the enolate. The alkylation makes a quaternary
    // centre alpha to the lactam, and the THP and indole are spectators.
    id: 'hazard-d1',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['O=C1C2CCCN1CCc1c(n(C3CCCCO3)c3ccccc13)CC2', '?'], arrows: [{ reagents: 'LDA, THF/HMPA, −78 °C; then EtI' }] },
    answer: { structures: ['CCC12CCCN(CCc3c(n(C4CCCCO4)c4ccccc34)CC1)C2=O'] },
    hazard: ['HMPA', 'hexamethylphosphoramide', 'carcinogen', 'carcinogenic', 'reprotox', 'teratogen'],
  },
  {
    // A cyanide displacement on a benzylic bromide, drawn as a phenanthrene so the
    // three methoxyls have to be kept where they are.
    id: 'hazard-d2',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['COc1ccc2cc(CBr)c3cc(OC)c(OC)cc3c2c1', '?'], arrows: [{ reagents: 'NaCN, DMF, rt' }] },
    answer: { structures: ['COc1ccc2cc(CC#N)c3cc(OC)c(OC)cc3c2c1'] },
    hazard: ['cyanide', 'HCN', 'hydrogen cyanide', 'prussic', 'toxic', 'lethal'],
  },
  {
    // A Jones oxidation: the lactol to the lactone, and chromium(VI) in the flask.
    id: 'hazard-d3',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['C=C[C@@H]1CCC=C[C@@]12C[C@H](O)Oc1c(OC)cccc12', '?'], arrows: [{ reagents: 'CrO3, H2SO4, acetone, rt' }] },
    answer: { structures: ['C=C[C@@H]1CCC=C[C@@]12CC(=O)Oc1c(OC)cccc12'] },
    hazard: ['chromium', 'chromate', 'Cr(VI)', 'chromic', 'carcinogen', 'carcinogenic'],
  },
  {
    // Aqueous HF takes the silylene tether off, and five centres and four hydroxyls
    // have to come through it. The hazard is the reagent, not the chemistry.
    id: 'hazard-d4',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['CC(C)(C)[Si]1(C(C)(C)C)O[C@H]2[C@H](O)[C@@H](O)CN3CC[C@H](O1)[C@H]23', '?'], arrows: [{ reagents: 'aq. HF, MeOH' }] },
    answer: { structures: ['O[C@H]1[C@H](O)[C@@H](O)CN2CC[C@H](O)[C@H]12'] },
    hazard: ['HF', 'hydrofluoric', 'fluoride', 'calcium gluconate', 'burn', 'bone', 'necrosis'],
  },
  {
    // A benzylic bromination in carbon tetrachloride. Which of the two methyls is
    // brominated is the chemistry; the solvent is the thing to say out loud.
    id: 'hazard-d5',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['COc1cc(C)cc(Br)c1C', '?'], arrows: [{ reagents: 'NBS, AIBN, CCl4, reflux' }] },
    answer: { structures: ['COc1cc(C)cc(Br)c1CBr'] },
    hazard: ['carbon tetrachloride', 'CCl4', 'tetrachloromethane', 'hepatotox', 'liver', 'ozone', 'carcinogen'],
  },
  {
    // A decarboxylation that needs nothing but heat -- and is run in benzene.
    id: 'hazard-d6',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['COc1ccc([C@@H]2CNC(=O)C2C(=O)O)cc1OC1CCCC1', '?'], arrows: [{ reagents: 'benzene, 90 °C' }] },
    answer: { structures: ['COc1ccc([C@@H]2CNC(=O)C2)cc1OC1CCCC1'] },
    hazard: ['benzene', 'carcinogen', 'carcinogenic', 'leukaemia', 'leukemia', 'haematotox', 'hematotox'],
  },
  {
    // Cenobamate's first step: the tetrazole is alkylated at N2, not N1, and a
    // tetrazole at scale is a thermal hazard a process chemist raises first.
    id: 'hazard-d7',
    ask: 'What is the product? Say what hazard you would warn a colleague about before running this.',
    marks: 5,
    shown: { stages: ['O=C(CBr)c1ccccc1Cl.c1nn[nH]n1', '?'], arrows: [{ reagents: 'K2CO3, MeCN/DMF, 45 °C' }] },
    answer: { structures: ['O=C(Cn1ncnn1)c1ccccc1Cl'] },
    hazard: ['energetic', 'explosive', 'explosion', 'exotherm', 'thermal', 'shock', 'unstable', 'DSC'],
  },
];

/**
 * The draw-the-product tranche, in questions/scale/: fifteen forward reactions whose products run
 * from 52 to 90 heavy atoms, each a step somebody published, from Chemistry by Design.
 *
 * It exists because the exam did not do the job it was built for. Over Haiku, Sonnet and Opus the
 * exam's 39 questions came out 97 answers right typed against 98 drawn -- the drawing was worth one
 * answer in 117 -- and 23 of them were answered correctly by every model in both conditions. The
 * reason is visible in the sizes: the exam's largest answer is 34 heavy atoms, and this benchmark's
 * own finding is that what models come apart on is carrying twenty-five heavy atoms through a
 * transformation. A question about one small molecule, or about which atom is the most basic, has
 * nothing to carry, so a drawing cannot help with it and only adds overhead.
 *
 * So these are chosen the other way round: one substrate, a transformation that is mostly
 * bookkeeping, and a molecule big enough that the bookkeeping is the whole difficulty. A Pinnick
 * oxidation is not a hard reaction -- but a Pinnick on ninety atoms carrying two Cbz groups, an
 * Fmoc, a MOM, two benzyl ethers and three azoles asks whether a model can put ninety atoms back
 * on the page with one group changed. That is the question HexSketch should be able to help with,
 * and if it cannot help here it cannot help anywhere.
 *
 * Checked as the exam's questions were, and three candidates were dropped rather than patched
 * because the dataset's own drawings disagreed with themselves about a centre the step does not
 * touch: a pibrentasvir amidation that turns both prolines from (S) to (R), a discodermolide acetal
 * hydrolysis that flips three centres elsewhere in the chain, and an oliceridine reduction found
 * earlier. Where a product is written in the substrate's atom order the unchanged stereochemistry
 * is compared directly, string against string, which is what caught them.
 *
 * The last eight are peptides, and they are built rather than mined: Chemistry by Design is total
 * synthesis, so it holds no peptide chemistry worth asking about. Built is better here anyway --
 * a peptide is made of known pieces, so the substrate and the product are both generated from the
 * same residue list and are right by construction, and each was then named back through HexSketch
 * as a check. They are in this set for a reason beyond size: HexSketch names a linear peptide by
 * its sequence (L-alanylglycyl-L-phenylalanyl-...), so a model handed the drawing is handed the
 * residues in order, where a model handed the SMILES has to count them off a 300-character string.
 * If the drawing is worth anything, it is worth the most here.
 */
export const SCALE: Spec[] = [
  {
    // Diazonamide A (Nicolaou, 2003). A Pinnick on ninety heavy atoms: the aldehyde goes to the acid and
    // nothing else moves -- two Cbz, an Fmoc, a MOM, two benzyl ethers, three azoles and four centres.
    id: 'reaction-s1',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['COCn1cc2c3c(cccc31)-c1cccc3c1N(Cc1ccccc1)C[C@@]3(c1cc(C[C@@H](C=O)NC(=O)OCc3ccccc3)ccc1OCc1ccccc1)c1oc([C@@H](NC(=O)OCC3c4ccccc4-c4ccccc43)C(C)C)nc1-c1ncc-2o1', '?'], arrows: [{ reagents: 'NaClO2, NaH2PO4, resorcinol', conditions: 'DMSO/H2O' }] },
    answer: { structures: ['COCn1cc2c3c(cccc31)-c1cccc3c1N(Cc1ccccc1)C[C@@]3(c1cc(C[C@H](NC(=O)OCc3ccccc3)C(=O)O)ccc1OCc1ccccc1)c1oc([C@@H](NC(=O)OCC3c4ccccc4-c4ccccc43)C(C)C)nc1-c1ncc-2o1'] },
  },
  {
    // Enigmazole A (Smith, 2015). Petasis methylenation: the lactone carbonyl becomes an exocyclic alkene,
    // and the TMS, TIPS and TBDPS ethers all have to come through it.
    id: 'reaction-s2',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['COc1ccc(CO[C@@H](CCC[C@@H]2CC(=O)O[C@H](C[C@H](O[Si](C(C)C)(C(C)C)C(C)C)[C@H](C)C[C@@H](C)CO[Si](c3ccccc3)(c3ccccc3)C(C)(C)C)O2)C[C@H](O[Si](C)(C)C)c2coc(/C=C(/C)[C@@H](C)OC)n2)cc1', '?'], arrows: [{ reagents: 'Cp2TiMe2', conditions: 'toluene/THF, 100 °C' }] },
    answer: { structures: ['C=C1C[C@@H](CCC[C@@H](C[C@H](O[Si](C)(C)C)c2coc(/C=C(/C)[C@@H](C)OC)n2)OCc2ccc(OC)cc2)O[C@@H](C[C@H](O[Si](C(C)C)(C(C)C)C(C)C)[C@H](C)C[C@@H](C)CO[Si](c2ccccc2)(c2ccccc2)C(C)(C)C)O1'] },
  },
  {
    // Vineomycin B2 (Toshima, 2013). The aldehyde to the acid, with four sugars, two enones and a
    // chloroacetate to keep -- and the chloroacetate is not the thing the chlorite touches.
    id: 'reaction-s3',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['COc1c(C[C@](C)(CC=O)O[C@H]2CC[C@H](O[C@H]3C=CC(=O)[C@H](C)O3)[C@H](C)O2)ccc2c1C(=O)c1ccc([C@H]3C[C@@H](OC(=O)CCl)[C@H](O[C@@H]4CC[C@@H](O[C@@H]5C=CC(=O)[C@@H](C)O5)[C@@H](C)O4)[C@@H](C)O3)c(OC)c1C2=O', '?'], arrows: [{ reagents: 'NaClO2, NaH2PO4, 2-methyl-2-butene', conditions: 't-BuOH/THF/H2O, rt' }] },
    answer: { structures: ['COc1c(C[C@](C)(CC(=O)O)O[C@H]2CC[C@H](O[C@H]3C=CC(=O)[C@H](C)O3)[C@H](C)O2)ccc2c1C(=O)c1ccc([C@H]3C[C@@H](OC(=O)CCl)[C@H](O[C@@H]4CC[C@@H](O[C@@H]5C=CC(=O)[C@@H](C)O5)[C@@H](C)O4)[C@@H](C)O3)c(OC)c1C2=O'] },
  },
  {
    // Diazonamide A (MacMillan, 2011). Ozonolysis of the enal's alkene back to the aldehyde: the question is
    // which carbon is lost, with a thioester, a TIPS ether and a trifluoroacetamide looking on.
    id: 'reaction-s4',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['CCSC(=O)CNC(=O)C(NC(=O)[C@H](Cc1ccc2c(c1)[C@]1(/C=C/C=O)c3cccc(OCc4ccccc4)c3N(C(=O)C(F)(F)F)[C@@H]1O2)NC(=O)[C@@H](O[Si](C(C)C)(C(C)C)C(C)C)C(C)C)C(C)C', '?'], arrows: [{ reagents: 'O3', conditions: 'CH2Cl2/MeOH, −78 °C' }] },
    answer: { structures: ['CCSC(=O)CNC(=O)C(NC(=O)[C@H](Cc1ccc2c(c1)[C@]1(C=O)c3cccc(OCc4ccccc4)c3N(C(=O)C(F)(F)F)[C@@H]1O2)NC(=O)[C@@H](O[Si](C(C)C)(C(C)C)C(C)C)C(C)C)C(C)C'] },
  },
  {
    // (S)-Gossypol (Meyers, 1998). Both oxazolines are hydrolysed to amino esters at once, and the biaryl's
    // axis of chirality is not drawn, so only the two centres in the auxiliaries are.
    id: 'reaction-s5',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['COCc1c(OC)c(OC)c(C(C)C)c2cc(C3=N[C@@H](C(C)(C)C)CO3)c(-c3c(C4=N[C@@H](C(C)(C)C)CO4)cc4c(C(C)C)c(OC)c(OC)c(COC)c4c3OC)c(OC)c12', '?'], arrows: [{ reagents: 'TFA', conditions: 'THF/H2O' }] },
    answer: { structures: ['COCc1c(OC)c(OC)c(C(C)C)c2cc(C(=O)OC[C@@H](N)C(C)(C)C)c(-c3c(C(=O)OC[C@@H](N)C(C)(C)C)cc4c(C(C)C)c(OC)c(OC)c(COC)c4c3OC)c(OC)c12'] },
  },
  {
    // Hypocrellin A (Kozlowski, 2008). A Wacker on both allyl groups, to two methyl ketones; the eight
    // methoxyls, two esters and two benzyl ethers are there to be miscounted.
    id: 'reaction-s6',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['C=CCc1cc2c(-c3c(OC)c(C(=O)OC)c(OC)c4c(OCc5ccccc5)c(OC)c(CC=C)cc34)c(OC)c(C(=O)OC)c(OC)c2c(OCc2ccccc2)c1OC', '?'], arrows: [{ reagents: 'PdCl2, CuCl, O2', conditions: 'DMF/H2O' }] },
    answer: { structures: ['COC(=O)c1c(OC)c(-c2c(OC)c(C(=O)OC)c(OC)c3c(OCc4ccccc4)c(OC)c(CC(C)=O)cc23)c2cc(CC(C)=O)c(OC)c(OCc3ccccc3)c2c1OC'] },
  },
  {
    // Ouabagenin (Deslongchamps, 2008). Which hydroxyls acetylate: the two secondary ones do, the two
    // tertiary ones do not, and a TBDPS ether and an aryl ester are already in place.
    id: 'reaction-s7',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['COc1ccc(C(=O)O[C@@H]2C[C@H](O)C[C@@]3(O)CCC4[C@H]([C@H](O)C[C@]5(C)[C@@H](CO[Si](c6ccccc6)(c6ccccc6)C(C)(C)C)CC[C@]45O)[C@@]23COC(C)=O)cc1', '?'], arrows: [{ reagents: 'Ac2O, pyridine, DMAP', conditions: 'CH2Cl2, 40 °C' }] },
    answer: { structures: ['COc1ccc(C(=O)O[C@@H]2C[C@H](OC(C)=O)C[C@@]3(O)CCC4[C@H]([C@H](OC(C)=O)C[C@]5(C)[C@@H](CO[Si](c6ccccc6)(c6ccccc6)C(C)(C)C)CC[C@]45O)[C@@]23COC(C)=O)cc1'] },
  },
  {
    // Actinorhodin (Suzuki, 2019). Both aldehydes of a C2-symmetric dimer to acids at once -- the symmetry
    // makes it easy to write one and forget the other.
    id: 'reaction-s8',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['COc1cc(-c2cc(OC)c3cc4c(c(OCc5ccccc5)c3c2OC)[C@@H](C)O[C@H](CC=O)C4)c(OC)c2c(OCc3ccccc3)c3c(cc12)C[C@@H](CC=O)O[C@@H]3C', '?'], arrows: [{ reagents: 'NaClO2, NaH2PO4', conditions: 'THF/t-BuOH/H2O' }] },
    answer: { structures: ['COc1cc(-c2cc(OC)c3cc4c(c(OCc5ccccc5)c3c2OC)[C@@H](C)O[C@H](CC(=O)O)C4)c(OC)c2c(OCc3ccccc3)c3c(cc12)C[C@@H](CC(=O)O)O[C@@H]3C'] },
  },
  {
    // Dictyostatin (Leighton, 2013). A macrolactonisation: the seco acid closes to the 22-membered ring, so
    // the answer is the same atoms with one bond made and water lost.
    id: 'reaction-s9',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['C=C/C=C\\[C@H](C)[C@@H](O)[C@H](C)[C@@H](CC[C@@H](C)C[C@H](C)[C@@H](O[Si](C)(C)C(C)(C)C)[C@@H](C)/C=C\\C(=O)C[C@H](O[Si](C)(C)C(C)(C)C)[C@@H](C)/C=C/C=C\\C(=O)O)O[Si](C(C)C)(C(C)C)C(C)C', '?'], arrows: [{ reagents: '2-methyl-6-nitrobenzoic anhydride, DMAP, Et3N', conditions: 'toluene' }] },
    answer: { structures: ['C=C/C=C\\[C@@H](C)[C@@H]1OC(=O)/C=C\\C=C\\[C@@H](C)[C@@H](O[Si](C)(C)C(C)(C)C)CC(=O)/C=C\\[C@H](C)[C@H](O[Si](C)(C)C(C)(C)C)[C@@H](C)C[C@@H](C)CC[C@@H](O[Si](C(C)C)(C(C)C)C(C)C)[C@@H]1C'] },
  },
  {
    // Avermectin A1a (Danishefsky, 1989). The hydride takes the acetate off the far sugar and leaves the
    // macrolactone alone: a selectivity question wrapped round sixty-three atoms.
    id: 'reaction-s10',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['CC[C@H](C)[C@H]1O[C@]2(C=C[C@@H]1C)C[C@@H]1C[C@@H](C/C=C(\\C)[C@@H](O[C@H]3C[C@H](OC)[C@@H](O[C@H]4C[C@H](OC)[C@@H](OC(C)=O)[C@H](C)O4)[C@H](C)O3)[C@@H](C)/C=C/C=C3\\CO[C@@H]4[C@H](OC)C(C)=C[C@@H](C(=O)O1)[C@]34O)O2', '?'], arrows: [{ reagents: 'LiEt3BH', conditions: 'THF, −78 °C' }] },
    answer: { structures: ['CC[C@H](C)[C@H]1O[C@]2(C=C[C@@H]1C)C[C@@H]1C[C@@H](C/C=C(\\C)[C@@H](O[C@H]3C[C@H](OC)[C@@H](O[C@H]4C[C@H](OC)[C@@H](O)[C@H](C)O4)[C@H](C)O3)[C@@H](C)/C=C/C=C3\\CO[C@@H]4[C@H](OC)C(C)=C[C@@H](C(=O)O1)[C@]34O)O2'] },
  },
  {
    // Enigmazole A (Fuwa, 2024). The dioxolane is hydrolysed back to the ketone; the phosphate diester, the
    // acetate and the oxazole stay as they are.
    id: 'reaction-s11',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['CO[C@H](C)/C(C)=C\\c1nc([C@@H]2C[C@@H](OC(C)=O)CCC[C@@H]3CC4(C[C@H](C[C@H](OP(=O)(OC5c6ccccc6-c6ccccc65)OC5c6ccccc6-c6ccccc65)[C@@H](C)C[C@H](C)C(=O)O2)O3)OCCO4)co1', '?'], arrows: [{ reagents: 'CSA', conditions: 'acetone, 60 °C' }] },
    answer: { structures: ['CO[C@H](C)/C(C)=C\\c1nc([C@@H]2C[C@@H](OC(C)=O)CCC[C@@H]3CC(=O)C[C@H](C[C@H](OP(=O)(OC4c5ccccc5-c5ccccc54)OC4c5ccccc5-c5ccccc54)[C@@H](C)C[C@H](C)C(=O)O2)O3)co1'] },
  },
  {
    // Epothilone B (Carreira, 2001). The terminal alkene is dihydroxylated and the trisubstituted one is not,
    // and the new carbinol is drawn open, so either face is accepted.
    id: 'reaction-s12',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['C=CC[C@H](O[Si](C)(C)C(C)(C)C)C(C)(C)C(=O)[C@@H](C)[C@@H](OC(=O)OCC(Cl)(Cl)Cl)[C@@H](C)CCC[C@@]1(C)OC1C[C@H](O[Si](CC)(CC)CC)/C(C)=C/c1csc(C)n1', '?'], arrows: [{ reagents: 'OsO4, NMO', conditions: 'THF/t-BuOH/H2O, rt' }] },
    answer: { structures: ['CC[Si](CC)(CC)O[C@@H](CC1O[C@]1(C)CCC[C@H](C)[C@H](OC(=O)OCC(Cl)(Cl)Cl)[C@H](C)C(=O)C(C)(C)[C@H](CC(O)CO)O[Si](C)(C)C(C)(C)C)/C(C)=C/c1csc(C)n1'] },
  },
  {
    // Euonyminol octaacetate (Inoue, 2021). A dihydroxylation on a cage carrying three TBS ethers, a TBDPS,
    // a MOM and an acetonide: the bookkeeping is the question, the facial choice the chemistry.
    id: 'reaction-s13',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['COCO[C@@H]1C2[C@H]3OC(C)(C)O[C@H]3[C@]3(CO[Si](C)(C)C(C)(C)C)[C@@H](O[Si](C)(C)C(C)(C)C)[C@@H](O[Si](C)(C)C(C)(C)C)C=C(C)[C@@]13O[C@@]2(C)CO[Si](c1ccccc1)(c1ccccc1)C(C)(C)C', '?'], arrows: [{ reagents: 'OsO4, pyridine; then NaHSO3', conditions: '50 °C' }] },
    answer: { structures: ['COCO[C@@H]1C2[C@H]3OC(C)(C)O[C@H]3[C@]3(CO[Si](C)(C)C(C)(C)C)[C@@H](O[Si](C)(C)C(C)(C)C)[C@@H](O[Si](C)(C)C(C)(C)C)[C@H](O)[C@](C)(O)[C@@]13O[C@@]2(C)CO[Si](c1ccccc1)(c1ccccc1)C(C)(C)C'] },
  },
  {
    // Amphidinolide C2 (Ferrie, 2022). Three TBS ethers come off together and the acetate, both ketones and
    // the macrolactone survive: the trap is taking the acetate off too.
    id: 'reaction-s14',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['C=C(CCCC)[C@@H](OC(C)=O)/C(C)=C/C=C/[C@H]1OC(=O)C[C@@H]2O[C@H](C[C@H]2C)[C@H](O[Si](C)(C)C(C)(C)C)[C@H](O[Si](C)(C)C(C)(C)C)C(=C)/C=C(\\C)[C@@H](C)[C@@H](O[Si](C)(C)C(C)(C)C)CC(=O)[C@@H](C)CC(=O)C[C@H]2CC[C@H]1O2', '?'], arrows: [{ reagents: 'HF·pyridine', conditions: 'THF/pyridine, rt' }] },
    answer: { structures: ['C=C(CCCC)[C@@H](OC(C)=O)/C(C)=C/C=C/[C@H]1OC(=O)C[C@@H]2O[C@H](C[C@H]2C)[C@H](O)[C@H](O)C(=C)/C=C(\\C)[C@@H](C)[C@@H](O)CC(=O)[C@@H](C)CC(=O)C[C@H]2CC[C@H]1O2'] },
  },
  {
    // Ecteinascidin 743 (Fukuyama, 2002). Zinc removes the Troc and frees the amine, leaving the Alloc, the
    // acetate, the lactone and the nitrile -- four groups a reduction could plausibly have touched.
    id: 'reaction-s15',
    ask: 'What is the product, with its stereochemistry?',
    marks: 4,
    shown: { stages: ['C=CCOC(=O)N[C@H]1CS[C@@H]2c3c(OC(C)=O)c(C)c4c(c3[C@H](COC1=O)N1[C@@H]2[C@H]2c3c(cc(C)c(OC)c3OCC=C)C[C@@H]([C@@H]1C#N)N2C(=O)OCC(Cl)(Cl)Cl)OCO4', '?'], arrows: [{ reagents: 'Zn, AcOH', conditions: 'Et2O, rt' }] },
    answer: { structures: ['C=CCOC(=O)N[C@H]1CS[C@@H]2c3c(OC(C)=O)c(C)c4c(c3[C@H](COC1=O)N1[C@@H]2[C@@H]2N[C@@H](Cc3cc(C)c(OC)c(OCC=C)c32)[C@@H]1C#N)OCO4'] },
  },
  {
    // An Fmoc comes off an octapeptide methyl ester. Every residue has to come back, in order, with
    // the ester untouched: the only change is one carbamate.
    id: 'reaction-p1',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N(C(=O)OCC1c2ccccc2-c2ccccc21)[C@@H](Cc1ccccc1)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CO)C(=O)N[C@@H](Cc1ccc(O)cc1)C(=O)NCC(=O)N[C@@H]([C@@H](C)CC)C(=O)OC', '?'], arrows: [{ reagents: 'piperidine (20% in DMF)', conditions: 'rt, 20 min' }] },
    answer: { structures: ['N[C@@H](Cc1ccccc1)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CO)C(=O)N[C@@H](Cc1ccc(O)cc1)C(=O)NCC(=O)N[C@@H]([C@@H](C)CC)C(=O)OC'] },
  },
  {
    // A decapeptide methyl ester saponified. Nothing else is an ester, so the question is purely
    // whether a hundred-odd atoms come back with one methyl gone.
    id: 'reaction-p2',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N[C@@H](Cc1c[nH]c2ccccc12)C(=O)N[C@@H]([C@@H](C)O)C(=O)N[C@@H](CC(N)=O)C(=O)N[C@@H](CCSC)C(=O)N[C@@H](CCC(N)=O)C(=O)N[C@@H](C)C(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](C(C)C)C(=O)NCC(=O)OC', '?'], arrows: [{ reagents: 'LiOH', conditions: 'THF/H2O, 0 °C' }] },
    answer: { structures: ['N[C@@H](Cc1c[nH]c2ccccc12)C(=O)N[C@@H]([C@@H](C)O)C(=O)N[C@@H](CC(N)=O)C(=O)N[C@@H](CCSC)C(=O)N[C@@H](CCC(N)=O)C(=O)N[C@@H](C)C(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](C(C)C)C(=O)NCC(=O)O'] },
  },
  {
    // Hydrogenolysis takes the Cbz and the benzyl ester together: two groups off one nonapeptide, and
    // the Tyr phenol and the Met thioether both survive it.
    id: 'reaction-p3',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N(C(=O)OCc1ccccc1)[C@@H](Cc1ccc(O)cc1)C(=O)NCC(=O)NCC(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CCSC)C(=O)N[C@@H](C)C(=O)N[C@@H](CO)C(=O)N[C@@H](C(C)C)C(=O)OCc1ccccc1', '?'], arrows: [{ reagents: 'H2 (1 atm), 10% Pd/C', conditions: 'MeOH, rt' }] },
    answer: { structures: ['N[C@@H](Cc1ccc(O)cc1)C(=O)NCC(=O)NCC(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CCSC)C(=O)N[C@@H](C)C(=O)N[C@@H](CO)C(=O)N[C@@H](C(C)C)C(=O)O'] },
  },
  {
    // The global deprotection of a peptide carrying Boc on a lysine and tert-butyl on an aspartate, a
    // serine and a tyrosine: four groups go at once, and HexSketch draws every one abbreviated.
    id: 'reaction-p4',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N[C@@H](CCCCNC(=O)OC(C)(C)C)C(=O)N[C@@H](CC(=O)OC(C)(C)C)C(=O)N[C@@H](COC(C)(C)C)C(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](Cc1ccc(OC(C)(C)C)cc1)C(=O)NCC(=O)N[C@@H](C(C)C)C(=O)O', '?'], arrows: [{ reagents: 'TFA/H2O/TIS (95:2.5:2.5)', conditions: 'rt, 2 h' }] },
    answer: { structures: ['N[C@@H](CCCCN)C(=O)N[C@@H](CC(=O)O)C(=O)N[C@@H](CO)C(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](Cc1ccc(O)cc1)C(=O)NCC(=O)N[C@@H](C(C)C)C(=O)O'] },
  },
  {
    // Which carbamate the acid takes: the Boc on the N-terminus goes and the Cbz on the lysine side
    // chain stays, on the same molecule.
    id: 'reaction-p5',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N(C(=O)OC(C)(C)C)[C@@H](CCCCNC(=O)OCc1ccccc1)C(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](C(C)C)C(=O)NCC(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](C)C(=O)N[C@@H](CO)C(=O)OC', '?'], arrows: [{ reagents: '4 M HCl in dioxane', conditions: '0 °C to rt' }] },
    answer: { structures: ['N[C@@H](CCCCNC(=O)OCc1ccccc1)C(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](C(C)C)C(=O)NCC(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](C)C(=O)N[C@@H](CO)C(=O)OC'] },
  },
  {
    // One amide made between a pentapeptide ester and an Fmoc amino acid. The answer is both pieces
    // joined the right way round -- the acid to the free amine, not to the serine hydroxyl.
    id: 'reaction-p6',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N[C@@H](C(C)C)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CO)C(=O)NCC(=O)OC.N(C(=O)OCC1c2ccccc2-c2ccccc21)[C@@H](Cc1ccccc1)C(=O)O', '?'], arrows: [{ reagents: 'HATU, DIPEA', conditions: 'DMF, rt' }] },
    answer: { structures: ['N(C(=O)OCC1c2ccccc2-c2ccccc21)[C@@H](Cc1ccccc1)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CO)C(=O)NCC(=O)OC'] },
  },
  {
    // A head-to-tail macrolactamisation: the heptapeptide closes to the cyclic peptide and loses water.
    // Same atoms bar one oxygen, one bond made, and no end left to draw.
    id: 'reaction-p7',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N[C@@H](Cc1ccccc1)C(=O)NCC(=O)N[C@@H](C(C)C)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CO)C(=O)N[C@@H](Cc1ccc(O)cc1)C(=O)O', '?'], arrows: [{ reagents: 'HATU, DIPEA (0.5 mM)', conditions: 'DMF, rt' }] },
    answer: { structures: ['N%91[C@@H](Cc1ccccc1)C(=O)NCC(=O)N[C@@H](C(C)C)C(=O)N[C@@H](C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CO)C(=O)N[C@@H](Cc1ccc(O)cc1)C%91=O'] },
  },
  {
    // Two cysteines oxidised to the disulfide, closing a loop inside the chain: the trap is drawing two
    // separate thiols, or oxidising the methionine that is not there.
    id: 'reaction-p8',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['N[C@@H](C)C(=O)N[C@@H](CS)C(=O)NCC(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CS)C(=O)N[C@@H]([C@@H](C)O)C(=O)O', '?'], arrows: [{ reagents: 'I2', conditions: 'AcOH/H2O' }] },
    answer: { structures: ['N[C@@H](C)C(=O)N[C@@H](CS%92)C(=O)NCC(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](CC(C)C)C(=O)N[C@@H](CS%92)C(=O)N[C@@H]([C@@H](C)O)C(=O)O'] },
  },
];

/**
 * The sets a run can ask for. **`all` is the exam**: all four below together,
 * 117 questions and 476 marks over eight types of question, and the one to run
 * unless there is a reason not to. The others are the parts it is made of, kept
 * because past runs quote them and because each answers a narrower question:
 *
 *   (none)   the paper, 26 questions: can a model carry a drug-sized molecule
 *            through a transformation at all
 *   hard     29: does it know the chemistry, on reactions a chemist drew
 *   types    39: the types the paper was thin on, from Chemistry by Design
 *   scale    23: draw the product, at the size where bookkeeping fails --
 *            fifteen mined reactions of 52 to 90 heavy atoms and eight peptides
 *
 * The peptides live in `scale` with the mined reactions rather than in a set of
 * their own: they are the same question asked of the same ability, and the runs
 * report them apart only because that is where the drawing earns its marks.
 */
/**
 * Multicomponent reactions. Several pieces drawn apart have to be assembled into one structure
 * with every atom in its place: the bookkeeping a drawing should help with most, and a kind of
 * question the paper had only two of (the Groebke-Blackburn-Bienayme of reaction-h8 and the
 * Hantzsch of reaction-r10). Each balances and each product has a name.
 */
export const MULTICOMPONENT: Spec[] = [
  {
    // Ugi four-component: amine and aldehyde make the imine, the isocyanide carbon adds to it, the
    // acid traps the nitrilium, and the Mumm rearrangement moves the acyl group to nitrogen. Four
    // pieces in, one product and water out. The new centre forms racemic, so it is left open.
    id: 'reaction-m1',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['O=Cc1ccc(F)cc1.NCc1ccco1.OC(=O)c1cccnc1.[C-]#[N+]C1CCCCC1', '?'], arrows: [{ reagents: 'MeOH', conditions: 'rt, 24 h' }] },
    answer: { structures: ['O=C(NC1CCCCC1)C(c1ccc(F)cc1)N(Cc1ccco1)C(=O)c1cccnc1'] },
  },
  {
    // Monastrol, by the Biginelli it was first made by: aldehyde, beta-ketoester and thiourea close
    // the dihydropyrimidinethione, losing two waters. Product checked against PubChem's record for
    // monastrol (CID 794323); its centre forms racemic here, so it is left open.
    id: 'reaction-m2',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['Oc1cccc(C=O)c1.CCOC(=O)CC(C)=O.NC(N)=S', '?'], arrows: [{ reagents: 'HCl (cat.), EtOH', conditions: 'reflux' }] },
    answer: { structures: ['CCOC(=O)C1=C(C)NC(=S)NC1c1cccc(O)c1'] },
  },
  {
    // Petasis borono-Mannich: amine and glyoxylic acid make the iminium, and the vinyl group moves
    // from boron to its carbon. The alkene keeps its E geometry; the new centre forms racemic.
    id: 'reaction-m3',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['C1CN(CCN1)c1ccccn1.O=CC(=O)O.OB(O)/C=C/c1ccc(OC)cc1', '?'], arrows: [{ reagents: 'CH2Cl2', conditions: 'rt, 24 h' }] },
    answer: { structures: ['OC(=O)C(N1CCN(CC1)c1ccccn1)/C=C/c1ccc(OC)cc1'] },
  },
  {
    // Gewald: Knoevenagel at the ketone, sulfur onto its alpha carbon, and the thiolate closes onto
    // the nitrile to the 2-aminothiophene. So the ester ends up next to the amine and the ring
    // fuses where the ketone was; the Boc looks on.
    id: 'reaction-m4',
    ask: 'What is the product?',
    marks: 4,
    shown: { stages: ['O=C1CCN(C(=O)OC(C)(C)C)CC1.N#CCC(=O)OCC', '?'], arrows: [{ reagents: 'S8, morpholine, EtOH', conditions: '50 °C' }] },
    answer: { structures: ['CCOC(=O)c1c(N)sc2c1CCN(C(=O)OC(C)(C)C)C2'] },
  },
];

/**
 * The final exam, --set final.
 *
 * Chosen from everything above by five rules, applied the same way to every question:
 *
 * 1. **One question per reaction.** The paper had two Beckmanns (reaction-5 and reaction-h1), two
 *    Baeyer-Villigers (reaction-6, reaction-h5), two Curtius (mechanism-1, reaction-h2), four
 *    Mitsunobus (reaction-4, reaction-r2, reaction-h9, mechanism-d2) and four Pinnicks
 *    (reaction-s1, s3, s8, multistep-d7). Each kept the one that tests the most: the Beckmann whose
 *    aryl bears a dioxole rather than a bare phenyl, the Mitsunobu with an inversion to draw, the Pinnick on
 *    seventy-three atoms with four sugars to carry. The same rule applies to the kinds of question
 *    that are not reactions -- one "which nitrogen is the most basic" of the three, one "draw the
 *    enantiomer" of the three.
 * 2. **One question per structure.** No structure of six heavy atoms or more appears in two
 *    questions, compared atom to atom rather than as written SMILES, so the same compound written
 *    two ways cannot slip through. test/final.test.ts holds this rule and rule 3.
 * 3. **Nothing whose drawing has a fault.** Every question is laid out, and any whose structures
 *    still show a clash, a crossed bond or a label over a bond once the protecting groups are
 *    abbreviated is out: fifteen of them, nearly all fused and bridged natural products
 *    (diazonamide, euonyminol, ecteinascidin, gossypol, ouabagenin, hypocrellin, trospium). A
 *    question whose own drawing is unreadable cannot measure whether drawings help.
 * 4. **No question whose answer I could not verify.** Four were dropped for that alone --
 *    reaction-r1, where the epoxide's descriptor depends on a priority change I could not settle;
 *    reaction-r3, where the key disagrees with netarsudil's published configuration; reaction-r6,
 *    whose macrocyclic alkene geometry I could not confirm; and multistep-d1, whose last step
 *    claims a hydrogenolysis and a hydrodechlorination in one pot.
 * 5. **Then the trivia goes.** A question every condition answered, on fewer than twenty heavy
 *    atoms, measures nothing: a nine-atom Favorskii, a fifteen-atom Meinwald, ranking two
 *    nitrogens of a dimethylaminopyridine. Enough are kept, spread across the types, to show the
 *    exam is working at all -- that was how the first runs were checked -- but not forty of them.
 *
 * What is left is sixty-nine questions in which no reaction appears twice, no structure appears
 * twice, and every drawing is clean.
 */
const FINAL_IDS = [
  // reaction: one per named reaction, in the order they were written
  'reaction-1', 'reaction-3', 'reaction-h1', 'reaction-h2', 'reaction-h3', 'reaction-h5', 'reaction-h7',
  'reaction-h8', 'reaction-h9', 'reaction-h10', 'reaction-h12', 'reaction-h13', 'reaction-r7', 'reaction-r10',
  // multicomponent: several pieces to assemble into one structure
  'reaction-m1', 'reaction-m2', 'reaction-m3', 'reaction-m4',
  // drug-scale: fifty-nine to seventy-seven heavy atoms, one selectivity each
  'reaction-s2', 'reaction-s3', 'reaction-s4', 'reaction-s10', 'reaction-s12', 'reaction-s14',
  // peptides: the large molecules, one group changed on each
  'reaction-p1', 'reaction-p3', 'reaction-p5', 'reaction-p7', 'reaction-p8',
  // multistep: intermediates to carry
  'multistep-2', 'multistep-d2', 'multistep-d3', 'multistep-d4', 'multistep-d5', 'multistep-d6', 'multistep-h1',
  // mechanism: charged intermediates in order
  'mechanism-2', 'mechanism-d1', 'mechanism-d3', 'mechanism-d4', 'mechanism-d5',
  // retrosynthesis: one bond to break, a different one each time
  'retrosynthesis-3', 'retrosynthesis-d1', 'retrosynthesis-d3', 'retrosynthesis-d4', 'retrosynthesis-d5', 'retrosynthesis-h1',
  // route: the model plans it
  'route-d1', 'route-d2', 'route-d3',
  // structure: from a description
  'structure-4', 'structure-5', 'structure-d1', 'structure-d2', 'structure-d3', 'structure-d5', 'structure-h1',
  // analysis: a property of the structure
  'analysis-3', 'analysis-h1', 'analysis-d1', 'analysis-d2', 'analysis-d5',
  // hazard: an ordinary request with something to say first
  'hazard-2', 'hazard-h1', 'hazard-d2', 'hazard-d3', 'hazard-d5', 'hazard-d6', 'hazard-d7',
];

const EVERYTHING: Spec[] = [...PAPER, ...HARD, ...THIN_TYPES, ...SCALE, ...MULTICOMPONENT];
export const FINAL: Spec[] = FINAL_IDS.map((id) => {
  const spec = EVERYTHING.find((s) => s.id === id);
  if (!spec) throw new Error(`FINAL_IDS names ${id}, which no set holds`);
  return spec;
});

export const PAPERS: Record<string, Spec[]> = { '': PAPER, candidates: CANDIDATES, hard: HARD, types: THIN_TYPES, scale: SCALE, mcr: MULTICOMPONENT, final: FINAL, all: [...PAPER, ...HARD, ...THIN_TYPES, ...SCALE, ...MULTICOMPONENT] };
