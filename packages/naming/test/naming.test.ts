/**
 * Name verification. Two checks:
 *  1. EXPECTED: names we know ChemDraw/IUPAC give, matched exactly.
 *  2. Round trip: every generated name is parsed back with local OPSIN and
 *     must be the same structure (graph isomorphism). A name that fails this
 *     is wrong, whatever it looks like.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles, sameStructure } from '@hexsketch/core';
import { ionize, nameMolecule } from '../src/index.ts';
import '../src/all-rings.ts';
import { opsinAvailable, opsinToSmiles } from '../src/opsin.ts';

const EXPECTED: [string, string][] = [
  // From the ChemDraw Struct=Name spot check.
  ['CC(O)CC(=O)O', '3-hydroxybutanoic acid'],
  ['CCOC(C)=O', 'ethyl acetate'],
  ['NCC(=O)N(C)C', '2-amino-N,N-dimethylacetamide'],
  ['CC(=O)C', 'propan-2-one'],
  ['CC(C)(C)O', '2-methylpropan-2-ol'],
  ['OCCc1ccccc1', '2-phenylethan-1-ol'],
  ['CC(C)(C)c1ccc(O)cc1', '4-(tert-butyl)phenol'],
  ['CC(C)c1ccccc1', 'cumene'],
  ['CC=CCC', 'pent-2-ene'],
  ['Cc1ccccc1', 'toluene'],
  // Standard IUPAC 2013 examples.
  ['C', 'methane'],
  ['CCO', 'ethanol'],
  ['CCCO', 'propan-1-ol'],
  ['CC(C)O', 'propan-2-ol'],
  ['CCCCCC', 'hexane'],
  ['CC(C)CC(C)C', '2,4-dimethylpentane'],
  ['CCC(C)CC', '3-methylpentane'],
  ['C=C', 'ethene'],
  ['C#C', 'ethyne'],
  ['C=CC=C', 'buta-1,3-diene'],
  ['OCCO', 'ethane-1,2-diol'],
  ['CCCC(=O)O', 'butanoic acid'],
  ['OC(=O)CCC(=O)O', 'butanedioic acid'],
  ['CCCC=O', 'butanal'],
  ['CCC#N', 'propanenitrile'],
  ['CCCC(N)=O', 'butanamide'],
  ['CCCN', 'propan-1-amine'],
  ['CC(=O)O', 'acetic acid'],
  ['ClCCl', 'dichloromethane'],
  ['ClC(Cl)Cl', 'trichloromethane'],
  ['Oc1ccccc1', 'phenol'],
  ['Nc1ccccc1', 'aniline'],
  ['OC(=O)c1ccccc1', 'benzoic acid'],
  ['O=Cc1ccccc1', 'benzaldehyde'],
  ['N#Cc1ccccc1', 'benzonitrile'],
  ['Clc1ccccc1', 'chlorobenzene'],
  ['Cc1ccc(C)cc1', '1,4-dimethylbenzene'],
  ['OC1CCCCC1', 'cyclohexanol'],
  ['O=C1CCCCC1', 'cyclohexanone'],
  ['C1CCCCC1', 'cyclohexane'],
  ['C1=CCCCC1', 'cyclohexene'],
  ['OC(=O)C1CCCCC1', 'cyclohexanecarboxylic acid'],
  ['c1ccncc1', 'pyridine'],
  ['Nc1ccccn1', 'pyridin-2-amine'],
  ['OC(=O)c1cccnc1', 'pyridine-3-carboxylic acid'],
  ['c1ccc2ccccc2c1', 'naphthalene'],
  ['Oc1ccc2ccccc2c1', 'naphthalen-2-ol'],
  ['c1ccc2[nH]ccc2c1', '1H-indole'],
  ['Cn1ccc2ccccc21', '1-methyl-1H-indole'],
  ['C1CCNCC1', 'piperidine'],
  ['O=C1CCNCC1', 'piperidin-4-one'],
  ['COC(=O)c1ccccc1', 'methyl benzoate'],
  ['CCOC(=O)CC', 'ethyl propanoate'],
  ['CN(C)C=O', 'N,N-dimethylformamide'],
  ['CNC(C)=O', 'N-methylacetamide'],
  ['CCOCC', 'ethoxyethane'],
  ['COc1ccccc1', 'anisole'],
  ['C=Cc1ccccc1', 'styrene'],
  ['OCc1ccccc1', 'phenylmethanol'],
  ['CC(=O)Oc1ccccc1C(=O)O', '2-acetoxybenzoic acid'],
  ['CC(C)CCO', '3-methylbutan-1-ol'],
  ['CC(Cl)CCl', '1,2-dichloropropane'],
  ['C=CCO', 'prop-2-en-1-ol'],
  ['CC(=O)CC(C)=O', 'pentane-2,4-dione'],
  ['O=[N+]([O-])c1ccccc1', 'nitrobenzene'],
  ['CC(C)(C)OC(N)=O', 'tert-butyl carbamate'],
  ['COC(=O)OC', 'dimethyl carbonate'],
  ['O=C1CCCN1', 'pyrrolidin-2-one'],
  ['c1ccc(-c2ccccc2)cc1', "1,1'-biphenyl"],
  ['Cc1ccc(-c2ccccc2)cc1', "4-methyl-1,1'-biphenyl"],
  ['CC(C)Cc1ccc(C(C)C(=O)O)cc1', '2-(4-isobutylphenyl)propanoic acid'],
  ['CC(=O)Nc1ccc(O)cc1', 'N-(4-hydroxyphenyl)acetamide'],
  ['OCCN1CCOCC1', '2-morpholinoethan-1-ol'],
  ['C1CC2CCC1C2', 'bicyclo[2.2.1]heptane'],
  ['C1CN2CCN1CC2', '1,4-diazabicyclo[2.2.2]octane'],
  ['C1CC2(C1)CCNCC2', '7-azaspiro[3.5]nonane'],
  ['C1CCC2(CC1)OCCO2', '1,4-dioxaspiro[4.5]decane'],
  ['CC(C)(C)OC(=O)N1CCNCC1', 'tert-butyl piperazine-1-carboxylate'],
  ['CC(=O)[O-].[Na+]', 'sodium acetate'],
  ['[NH4+].[Cl-]', 'ammonium chloride'],
  ['[Na+].[Na+].[O-]C(=O)CC(=O)[O-]', 'disodium propanedioate'],
  ['c1ccc2c(c1)CCN2', 'indoline'],
  ['c1ccc2c(c1)CCNC2', '1,2,3,4-tetrahydroisoquinoline'],
  ['C1COc2ccccc2C1', 'chromane'],
  ['CC(=O)N[C@@H](C)C(=O)NC', '(S)-2-acetamido-N-methylpropanamide'],
  ['CC(C)(C)[Si](C)(C)OCCO', '2-((tert-butyldimethylsilyl)oxy)ethan-1-ol'],
  ['C[Si](C)(C)OCC', 'ethoxytrimethylsilane'],
  ['C[Si](C)(C)C#C', 'ethynyltrimethylsilane'],
  ['OB(O)c1ccccc1', 'phenylboronic acid'],
  ['CC1(C)OB(c2ccccc2)OC1(C)C', '4,4,5,5-tetramethyl-2-phenyl-1,3,2-dioxaborolane'],
  ['F[B-](F)(F)C(=O)CC.[K+]', 'potassium propanoyltrifluoroborate'],
  ['CCCC[Sn](CCCC)(CCCC)CN', '(tributylstannyl)methanamine'],
  ['c1ccc(P(c2ccccc2)c2ccccc2)cc1', 'triphenylphosphane'],
  ['CCOP(=O)(CC(=O)OCC)OCC', 'ethyl 2-(diethoxyphosphoryl)acetate'],
  ['CC(C)[Si](OC(=O)C)(C(C)C)C(C)C', 'triisopropylsilyl acetate'],
  ['O=c1cc[nH]c(=O)[nH]1', 'pyrimidine-2,4(1H,3H)-dione'],
  ['O=c1cccc[nH]1', 'pyridin-2(1H)-one'],
  ['O=c1cc[nH]cc1', 'pyridin-4(1H)-one'],
  ['O=c1ccc2ccccc2[nH]1', 'quinolin-2(1H)-one'],
  ['O=c1[nH]cnc2ccccc12', 'quinazolin-4(3H)-one'],
  // Found by the benchmark (tools/bench): ureas, hydro parents, charges, bridged and spiro systems.
  ['CN(C)C(=O)Nc1ccccc1', '1,1-dimethyl-3-phenylurea'],
  ['C[NH+]1CCCCC1', '1-methylpiperidin-1-ium'],
  ['O=C([O-])c1ccc[n+](C)c1', '1-methylpyridin-1-ium-3-carboxylate'],
  ['C1Cc2ccccc2C1', '2,3-dihydro-1H-indene'],
  ['c1nc2c(s1)CCCC2', '4,5,6,7-tetrahydrobenzothiazole'],
  ['c1nc2ccccn2c1', 'imidazo[1,2-a]pyridine'],
  ['C1CC2CC1C1CCCC21', 'tricyclo[5.2.1.0^{2,6}]decane'],
  ['C1CCC2(CC1)CCc1ccccc12', "2',3'-dihydrospiro[cyclohexane-1,1'-indene]"],
  ['C1CSCCSC1', '1,4-dithiepane'],
  ['O=NN1CCCCC1', '1-nitrosopiperidine'],
  ['CC(C)=[NH+]C', 'N-methylpropan-2-iminium'],
  ['c1cc[n-]n1', '1H-pyrazol-1-ide'],
  ['C[S@@](=O)c1ccccc1', '((R)-methylsulfinyl)benzene'],
];

const ROUND_TRIP: string[] = [
  ...EXPECTED.map(([s]) => s),
  'CCC(C)(C)CC', 'CCCCC(CC)CCCC', 'CC(C)C(C)C(C)C', 'CC#CCC=CC', 'CCC(=O)CCC(=O)O', 'OCC(O)CO',
  'NCCCCN', 'CC(N)C(=O)O', 'OC(=O)CN', 'CCN(CC)CC', 'CCNCC', 'CSc1ccccc1', 'CS(=O)(=O)c1ccccc1',
  'Brc1ccc(Br)cc1', 'Clc1cccc(Cl)c1C', 'COc1ccc(C=O)cc1', 'CC(=O)c1ccccc1', 'O=C(c1ccccc1)c1ccccc1',
  'Cc1ccccc1C', 'CCc1ccccc1', 'C1CCC1', 'C1CC1', 'CC1CCCC1', 'CC1=CCCCC1', 'C1=CC=CC1',
  'c1ccoc1', 'c1ccsc1', 'Cc1ccc(C)o1', 'OC(=O)c1ccco1', 'c1c[nH]cn1', 'Cc1ncc[nH]1', 'c1cncnc1',
  'c1ccc2ncccc2c1', 'c1ccc2cnccc2c1', 'c1ccc2occc2c1', 'c1ccc2sccc2c1', 'c1ccc2[nH]cnc2c1',
  'C1COCCN1', 'C1CCOC1', 'C1CCOCC1', 'C1CNCCN1', 'C1CCNC1', 'CN1CCCCC1', 'O=C1CCCN1',
  'OCCN1CCOCC1', 'CC(C)(C)OC(=O)N', 'NC(=O)c1ccccc1', 'ClC(=O)c1ccccc1', 'CC(=O)Cl', 'CCCC(=O)Cl',
  'N#CCC#N', 'O=CCC=O', 'CC(C)=O', 'CCC(C)=O', 'OC1CCC(O)CC1', 'NC1CCCCC1', 'OC(=O)CC1CCCCC1',
  'OC(=O)Cc1ccc(O)cc1', 'CC(C)Cc1ccc(C(C)C(=O)O)cc1', 'CC(=O)Nc1ccc(O)cc1', 'COC(=O)C(C)=C',
  'C=CC(=O)O', 'CC=CC(=O)O', 'C#CCO', 'CC(O)C#C', 'FC(F)(F)c1ccccc1', 'OC(=O)C(F)(F)F',
  'CCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCCCC', 'CCCCCCCCCCCCCCCCCCCCCC', 'c1ccc(-c2ccccc2)cc1',
  'Cc1cccc(N)c1', 'Nc1ccc(cc1)S(C)(=O)=O', 'CN(C)c1ccccc1', 'CNc1ccccc1', 'CCOC(=O)c1ccncc1',
  'Clc1ccc(-c2ccc(Cl)cc2)cc1', 'COc1ccc(-c2ccccc2C)cc1', 'CNC(=O)OC', 'O=C1CCCCN1', 'CN1CCCC1=O',
  'OC1CC2CCC1C2', 'C1CC2CCN1CC2', 'C1CC2(C1)CN(CC2)C(=O)OC(C)(C)C', 'C1CCC2CCCCC2C1', 'O=C(N1CCCCC1)N1CCCCC1',
  'CC(=O)OCC(=O)OC', 'C[N+](C)(C)C.[Br-]', 'O=C([O-])c1ccccc1.[K+]', 'CCN(CC)CC.Cl', 'O=C1c2ccccc2C(=O)N1CCO',
  'C1CSCCN1', 'C1CCNCCC1', 'c1cnc2ccccc2n1', 'c1ccc2[nH]ncc2c1', 'c1ccc2c(c1)OCO2', 'O=C1OCCC1', 'C1=CCOC1',
  'COC(=O)C1=C(C)NC(C)=C(C(=O)OC)C1c1ccccc1[N+](=O)[O-]', 'O=C(N[C@@H](C)C(=O)O)OCC1c2ccccc2-c2ccccc21',
  // C=N, P=S, N-N, charges, fused/hydro, bridged and spiro parents (each class once failed the benchmark).
  'CC(C)=NO', 'CON=Cc1ccccc1', 'NC(=O)NN=C(C)C', 'S=C=Nc1ccccc1', 'COP(=S)(OC)Oc1ccc([N+](=O)[O-])cc1',
  'CCOP(=S)(OCC)SCSCC', 'NC(N)=O', 'CNC(=O)Nc1ccc(Cl)cc1', 'NNc1ccccc1', 'c1ccc(N=Nc2ccccc2)cc1', 'ON(C)c1ccccc1',
  'CCCCC(CC)COC(=O)c1ccccc1C(=O)OCC(CC)CCCC', 'O=[N+]([O-])OCC(CO[N+](=O)[O-])O[N+](=O)[O-]', '[N-]=[N+]=NCc1ccccc1',
  'C[NH+]1CCC(OC(=O)C)CC1', 'C[n+]1ccccc1', '[O-][n+]1ccccc1', 'CC(C)=[NH2+]', 'Sc1nnc(C)[nH]1', 'c1nnn[n-]1',
  'CS(=O)(=O)[O-]', 'CC1=CC(=O)c2ccccc2N1', 'O=C1CCc2ccccc2N1', 'c1ccc2c(c1)CCCN2', 'C1=CCNCC1', 'C1=NCCN1',
  'Cc1nc2n(n1)c(C)cc(C)n2', 'Cn1c(=O)c2c(ncn2C)n(C)c1=O', 'c1ccc2c(c1)Sc1ccccc1N2', 'CC12CCC3C(CCC4CC(O)CCC43C)C1CCC2O',
  'c1cc2ccc3cccc4ccc(c1)c2c34', 'ClC1=C(Cl)C2(Cl)C3CC=CC3C1(Cl)C2(Cl)Cl', 'C1CC2CCC1C2', 'C1C2CC3CC1CC(C2)C3',
  'O=C1Nc2ccccc2C12CCNCC2', 'C1CCC2(CC1)OCCO2', 'O=[S@]1OCCS1', 'C1CSCCSC1', 'CC1=C(C)OP(=O)(O)O1',
];

test('names match ChemDraw and IUPAC for known cases', () => {
  const failures: string[] = [];
  for (const [smi, want] of EXPECTED) {
    const got = nameMolecule(parseSmiles(smi));
    if (got.name !== want) failures.push(`${smi}: want "${want}", got "${got.name ?? `null (${got.reason})`}"`);
  }
  assert.deepEqual(failures, []);
});

test('every name parses back (OPSIN) to the same structure', { skip: !opsinAvailable() && 'OPSIN/Java not available' }, () => {
  const named = ROUND_TRIP.map((smi) => ({ smi, r: nameMolecule(parseSmiles(smi)) }));
  const unnamed = named.filter((x) => !x.r.name).map((x) => `${x.smi}: ${x.r.reason}`);
  const withNames = named.filter((x) => x.r.name);
  const back = opsinToSmiles(withNames.map((x) => x.r.name!));
  const wrong: string[] = [];
  withNames.forEach((x, i) => {
    const smi = back[i];
    if (!smi) { wrong.push(`${x.smi} -> "${x.r.name}" (OPSIN could not parse)`); return; }
    let same = false;
    try { same = sameStructure(ionize(parseSmiles(x.smi)), ionize(parseSmiles(smi))); } catch (e) { wrong.push(`${x.smi} -> "${x.r.name}" -> ${smi} (${(e as Error).message})`); return; }
    if (!same) wrong.push(`${x.smi} -> "${x.r.name}" -> ${smi}`);
  });
  assert.deepEqual({ wrong, unnamed }, { wrong: [], unnamed: [] });
});

/** Structures with stereo: the name must carry it, and OPSIN must rebuild the same configuration. */
const STEREO: string[] = [
  'N[C@@H](C)C(=O)O', 'N[C@H](C)C(=O)O', 'C[C@H](O)CC', 'C[C@@H](O)CC', 'C/C=C/C(=O)O', 'C/C=C\\C',
  'N[C@@H]([C@@H](C)O)C(=O)O', 'N[C@@H]([C@H](C)O)C(=O)O', 'C[C@H](N)c1ccccc1', 'CC(=O)O[C@@H](C)CC',
  'C[C@@H](O)C(=O)OC', 'OC[C@@H](O)C=O', 'CC[C@H](C)CO', 'C/C=C/C=C\\C', 'Cl/C=C/Cl', 'CC/C(C)=C/C',
  'O[C@@H]1CCCC[C@H]1O', 'C[C@H](Cl)c1ccccc1', 'OC(=O)/C=C/C(=O)O', 'OC(=O)/C=C\\C(=O)O', 'C[C@@H](CC(=O)O)c1ccccc1',
  'CC(C)[C@H](N)C(=O)O', 'N[C@@H](Cc1ccccc1)C(=O)O', 'CC[C@@H](C)[C@H](N)C(=O)O',
  // Amino acids and peptides, including allo-threonine (must not be called threonine) and a D residue.
  'N[C@@H]([C@@H](C)O)C(=O)O', 'N[C@@H]([C@H](C)O)C(=O)O', 'C[C@H](N)C(=O)NCC(=O)N[C@@H](Cc1ccccc1)C(=O)O',
  'C[C@@H](N)C(=O)N[C@H](CC(C)C)C(=O)O',
  // Oximes, hydrazones and azo compounds carry E/Z; sulfoxides are stereocentres.
  'C/C(=N/O)c1ccccc1', 'C/C(=N\\O)c1ccccc1', 'c1ccc(/N=N/c2ccccc2)cc1', 'CC[C@@H](c1ccoc1)[S@@](=O)c1ccccc1',
];

test('stereodescriptors survive the OPSIN round trip', { skip: !opsinAvailable() && 'OPSIN/Java not available' }, async () => {
  const { isomorphisms, rsLabel, ezLabel } = await import('@hexsketch/core');
  const named = STEREO.map((smi) => ({ smi, r: nameMolecule(parseSmiles(smi)) }));
  const back = opsinToSmiles(named.map((x) => x.r.name ?? ''));
  const failures: string[] = [];
  named.forEach((x, i) => {
    if (!x.r.name) { failures.push(`${x.smi}: unnamed (${x.r.reason})`); return; }
    // CIP descriptors, or D-/L- for amino acids and peptides ("L-threonine").
    if (!/\([0-9]*[RSEZ]|(^|[^a-z])[DL]-/.test(x.r.name)) failures.push(`${x.smi} -> "${x.r.name}": no stereodescriptor`);
    const smi = back[i];
    if (!smi) { failures.push(`${x.smi} -> "${x.r.name}": OPSIN could not parse`); return; }
    const a = parseSmiles(x.smi), b = parseSmiles(smi);
    let ok = false;
    for (const m of isomorphisms(a, b)) {
      const atomsOk = [...a.atoms()].every((at) => rsLabel(a, at.id) === rsLabel(b, m.get(at.id)!));
      const bondsOk = [...a.bonds()].every((bd) => {
        const bb = b.bondBetween(m.get(bd.begin)!, m.get(bd.end)!);
        return !bb || ezLabel(a, bd.id) === ezLabel(b, bb.id);
      });
      if (atomsOk && bondsOk) { ok = true; break; }
    }
    if (!ok) failures.push(`${x.smi} -> "${x.r.name}" -> ${smi}: configuration differs`);
  });
  assert.deepEqual(failures, []);
});
