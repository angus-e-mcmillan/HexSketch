import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles, writeSmiles } from '../src/smiles.ts';
import { sameStructure } from '../src/isomorphism.ts';
import { computeMass } from '../src/formula.ts';

const CASES: [string, string, string][] = [
  ['aspirin', 'CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4'],
  ['caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'C8H10N4O2'],
  ['pyrrole', 'c1cc[nH]c1', 'C4H5N'],
  ['pyridine', 'c1ccncc1', 'C5H5N'],
  ['furan', 'c1ccoc1', 'C4H4O'],
  ['thiophene', 'c1ccsc1', 'C4H4S'],
  ['naphthalene', 'c1ccc2ccccc2c1', 'C10H8'],
  ['indole', 'c1ccc2[nH]ccc2c1', 'C8H7N'],
  ['ammonium', '[NH4+]', 'H4N+'],
  ['acetate', 'CC(=O)[O-]', 'C2H3O2-'],
  ['dimethyl sulfone', 'CS(=O)(=O)C', 'C2H6O2S'],
  ['13C methanol', '[13CH3]O', 'CH4O'],
  ['chloroform', 'ClC(Cl)Cl', 'CHCl3'],
  ['benzonitrile', 'N#Cc1ccccc1', 'C7H5N'],
  ['L-alanine (stereo ignored)', 'C[C@@H](C(=O)O)N', 'C3H7NO2'],
  ['ring closure %10', 'C%10CCCCC%10', 'C6H12'],
  ['two parts', 'O.O', 'H4O2'],
];

for (const [name, smi, formula] of CASES) {
  test(`parse ${name}`, () => {
    const mol = parseSmiles(smi);
    assert.equal(computeMass(mol).formulaWithCharge, formula);
  });
  test(`round-trip ${name}`, () => {
    const mol = parseSmiles(smi);
    const again = parseSmiles(writeSmiles(mol));
    assert.ok(sameStructure(mol, again), `${smi} -> ${writeSmiles(mol)}`);
  });
}

test('different Kekule forms are the same structure', () => {
  assert.ok(sameStructure(parseSmiles('C1=CC=CC=C1'), parseSmiles('C1C=CC=CC=1')));
  assert.ok(sameStructure(parseSmiles('c1ccc2ccccc2c1'), parseSmiles('C1=CC=C2C=CC=CC2=C1')));
});

test('isomers are not the same structure', () => {
  assert.ok(!sameStructure(parseSmiles('C1=CCC=CC1'), parseSmiles('C1=CC=CCC1')), '1,4- vs 1,3-cyclohexadiene');
  assert.ok(!sameStructure(parseSmiles('CCCO'), parseSmiles('CC(C)O')), 'propanol isomers');
  assert.ok(!sameStructure(parseSmiles('Oc1ccccc1C'), parseSmiles('Oc1ccc(C)cc1')), 'cresol isomers');
  assert.ok(!sameStructure(parseSmiles('CC#C'), parseSmiles('C=C=C')), 'propyne vs allene');
});

test('bad SMILES are rejected with a message', () => {
  assert.throws(() => parseSmiles('C1CC'), /unclosed ring/);
  assert.throws(() => parseSmiles('C[Xx]'), /unknown element/);
  assert.throws(() => parseSmiles('c1cccc1'), /kekulize/);
});
