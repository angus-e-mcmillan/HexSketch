/**
 * Atom labels are read from their parts, as a chemist reads them, so a label
 * HexSketch was never told about still has a structure, a formula and a name.
 * Before, labels were looked up whole in a short list (three lists, which did
 * not agree), and "OPiv" or "CO2Na" counted as an unknown symbol.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMass, labelStructure, parseSmiles, sameStructure, type Molecule } from '../src/index.ts';

/** A label on a methyl carbon, drawn out: compare with CH3-<expected>. */
function onMethyl(label: string): Molecule | null {
  const read = labelStructure(label, 1);
  if (!read) return null;
  const c = read.mol.addAtom({ element: 'C', x: 0, y: 0 });
  read.mol.addBond({ begin: c.id, end: read.head });
  return read.mol;
}

test('labels are read from elements, groups, counts and brackets', () => {
  const cases: [string, string][] = [
    ['OMe', 'COC'], ['CO2Me', 'CC(=O)OC'], ['CO2H', 'CC(=O)O'], ['COOH', 'CC(=O)O'], ['CHO', 'CC=O'], ['CN', 'CC#N'],
    ['NO2', 'C[N+](=O)[O-]'], ['N3', 'CN=[N+]=[N-]'], ['OPiv', 'COC(=O)C(C)(C)C'], ['OTBDPS', 'CO[Si](c1ccccc1)(c1ccccc1)C(C)(C)C'],
    ['SO2Ph', 'CS(=O)(=O)c1ccccc1'], ['SO3H', 'CS(=O)(=O)O'], ['SOMe', 'CS(=O)C'], ['OSO2Me', 'COS(=O)(=O)C'],
    ['COMe', 'CC(C)=O'], ['OCOMe', 'COC(C)=O'], ['OC(O)Me', 'COC(C)=O'], ['CONH2', 'CC(N)=O'], ['COCl', 'CC(=O)Cl'],
    ['PO(OEt)2', 'CP(=O)(OCC)OCC'], ['P(O)(OEt)2', 'CP(=O)(OCC)OCC'], ['PO3H2', 'CP(=O)(O)O'], ['B(OH)2', 'CB(O)O'],
    ['NHBoc', 'CNC(=O)OC(C)(C)C'], ['N(Me)Boc', 'CN(C)C(=O)OC(C)(C)C'], ['CH2CH2OH', 'CCCO'], ['(CH2)3CH3', 'CCCCC'],
    ['C(CH3)3', 'CC(C)(C)C'], ['CH=CH2', 'CC=C'], ['CCH', 'CC#C'], ['NCO', 'CN=C=O'], ['SCN', 'CSC#N'], ['ONO2', 'CO[N+](=O)[O-]'],
    ['C6H5', 'Cc1ccccc1'], ['C6H13', 'CCCCCCC'], ['CD3', '[2H]C([2H])([2H])C'], ['SiMe3', 'C[Si](C)(C)C'], ['SnBu3', 'C[Sn](CCCC)(CCCC)CCCC'],
    ['OtBu', 'COC(C)(C)C'], ['NHiPr', 'CNC(C)C'], ['MgBr', 'C[Mg]Br'], ['CO2Na', 'CC(=O)O[Na]'], ['CH2N3', 'CCN=[N+]=[N-]'],
    ['NMe3+', 'C[N+](C)(C)C'], ['CO2-', 'CC(=O)[O-]'], ['SO3-', 'CS(=O)(=O)[O-]'], ['N2+', 'C[N+]#N'],
  ];
  for (const [label, smiles] of cases) {
    const got = onMethyl(label);
    assert.ok(got, `${label} is read`);
    assert.ok(sameStructure(got, parseSmiles(smiles)), `${label} is ${smiles}`);
  }
});

test('a label written for the left of a structure reads the same turned round', () => {
  const pairs: [string, string][] = [
    ['MeO', 'OMe'], ['HO', 'OH'], ['H2N', 'NH2'], ['HOOC', 'COOH'], ['MeO2C', 'CO2Me'], ['EtO2C', 'CO2Et'], ['TBSO', 'OTBS'], ['BocHN', 'NHBoc'],
    ['AcHN', 'NHAc'], ['F3C', 'CF3'], ['O2N', 'NO2'], ['NC', 'CN'], ['Me3Si', 'SiMe3'], ['HOCH2', 'CH2OH'], ['HOH2C', 'CH2OH'], ['PhCH2', 'CH2Ph'], ['HO3S', 'SO3H'],
  ];
  for (const [left, right] of pairs) {
    const a = onMethyl(left), b = onMethyl(right);
    assert.ok(a && b, `${left} and ${right} are read`);
    assert.ok(sameStructure(a, b), `${left} is ${right}`);
  }
});

test('a label in a chain bonds at both ends, where it has the room', () => {
  const between = (label: string): Molecule | null => {
    const read = labelStructure(label, 2);
    if (!read) return null;
    for (const at of [read.head, read.tail]) read.mol.addBond({ begin: read.mol.addAtom({ element: 'C', x: 0, y: 0 }).id, end: at });
    return read.mol;
  };
  for (const [label, smiles] of [['NMe', 'CN(C)C'], ['CO', 'CC(C)=O'], ['SO2', 'CS(C)(=O)=O'], ['OCH2', 'COCC'], ['NHCO', 'CNC(C)=O'], ['(CH2)3', 'CCCCC'], ['O', 'COC']] as const) {
    const got = between(label);
    assert.ok(got, `${label} is read in a chain`);
    assert.ok(sameStructure(got, parseSmiles(smiles)), `C-${label}-C is ${smiles}`);
  }
  assert.equal(labelStructure('OMe', 2), null, 'OMe has one bond to make');
});

test('a formula written on its own is read as the compound', () => {
  for (const [label, smiles] of [['MeOH', 'CO'], ['Et3N', 'CCN(CC)CC'], ['EtMgBr', 'CC[Mg]Br'], ['PhMe', 'Cc1ccccc1'], ['MeCN', 'CC#N'], ['Boc2O', 'CC(C)(C)OC(=O)OC(=O)OC(C)(C)C'],
    ['TMSCl', 'C[Si](C)(C)Cl'], ['H2O', 'O'], ['HCO2H', 'OC=O'], ['CH2Cl2', 'ClCCl'], ['PhB(OH)2', 'OB(O)c1ccccc1'], ['AcOH', 'CC(=O)O']] as const) {
    const read = labelStructure(label, 0);
    assert.ok(read, `${label} is read`);
    assert.ok(sameStructure(read.mol, parseSmiles(smiles)), `${label} is ${smiles}`);
  }
});

test('what is not chemistry is not guessed at', () => {
  for (const label of ['R', 'R1', "R'", 'X', 'Ar', 'THF', 'cat.', 'NBS', 'DMF', 'hv', 'reflux']) {
    assert.equal(labelStructure(label, 1), null, `${label} on a bond`);
    assert.equal(labelStructure(label, 0), null, `${label} on its own`);
  }
});

test('a labelled atom counts in the formula as what the label stands for', () => {
  const mol = parseSmiles('c1ccccc1C');
  const methyl = [...mol.atoms()].find((a) => mol.neighbours(a.id).length === 1)!;
  for (const [label, formula] of [['OPiv', 'C11H14O2'], ['CO2Na', 'C7H5NaO2'], ['OTBDPS', 'C22H24OSi'], ['MeO2C', 'C8H8O2'], ['SO2NH2', 'C6H7NO2S']] as const) {
    methyl.label = label;
    assert.equal(computeMass(mol).formula, formula, label);
  }
});
