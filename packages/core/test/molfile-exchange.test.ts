/**
 * Molfiles as other programs write and read them. Each of these lost
 * something before: V3000 was refused, a radical came back as the closed-shell
 * compound, a label was written as an atom symbol nothing else reads.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout2D, parseSmiles, perceiveStereoFromGeometry, readMolfile, rsLabel, sameStructure, writeMolfile, writeSmiles } from '../src/index.ts';

const drawn = (smiles: string) => { const m = parseSmiles(smiles); layout2D(m); return m; };

test('a V3000 molfile is read, with its charges, isotopes, radicals and wedges', () => {
  // L-alanine zwitterion with a 13C methyl, as RDKit writes V3000.
  const text = `
     RDKit          2D

  0  0  0  0  0  0  0  0  0  0999 V3000
M  V30 BEGIN CTAB
M  V30 COUNTS 6 5 0 0 0
M  V30 BEGIN ATOM
M  V30 1 C 1.299 0.75 0 0 MASS=13
M  V30 2 C 0 0 0 0 CFG=2
M  V30 3 N 0 -1.5 0 0 CHG=1
M  V30 4 C -1.299 0.75 0 0
M  V30 5 O -1.299 2.25 0 0
M  V30 6 O -2.598 0 0 0 CHG=-1
M  V30 END ATOM
M  V30 BEGIN BOND
M  V30 1 1 2 1 CFG=1
M  V30 2 1 2 3
M  V30 3 1 2 4
M  V30 4 2 4 5
M  V30 5 1 4 6
M  V30 END BOND
M  V30 END CTAB
M  END
`;
  const mol = readMolfile(text.slice(1));
  assert.equal(mol.atomCount, 6);
  assert.equal(writeSmiles(mol).replace(/@+/g, ''), '[13CH3][CH]([NH3+])C(=O)[O-]');
  perceiveStereoFromGeometry(mol);
  assert.match([...mol.atoms()].map((a) => rsLabel(mol, a.id)).filter(Boolean).join(), /^[RS]$/, 'the wedge is read');
});

test('radicals and unusual hydrogen counts survive', () => {
  for (const smiles of ['CC1(C)CCCC(C)(C)N1[O]', '[CH3]', 'C[CH]C', '[Pd]', '[CH2]']) {
    const mol = drawn(smiles);
    const back = readMolfile(writeMolfile(mol));
    assert.equal(writeSmiles(back), writeSmiles(mol), smiles);
  }
  const ethyl = drawn('CC');
  [...ethyl.atoms()][1]!.radical = 1;
  assert.match(writeMolfile(ethyl), /^M {2}RAD {2}1 {3}2 {3}2$/m, 'a doublet is 2 in M  RAD');
  assert.equal([...readMolfile(writeMolfile(ethyl)).atoms()][1]!.radical, 1);
});

test('more than eight isotopes or charges go on several lines', () => {
  const mol = drawn('[2H]C([2H])([2H])C([2H])([2H])C([2H])([2H])C([2H])([2H])[2H]');
  const text = writeMolfile(mol);
  const iso = text.split('\n').filter((l) => l.startsWith('M  ISO'));
  assert.equal(iso.length, 2);
  assert.match(iso[0]!, /^M {2}ISO {2}8/);
  assert.equal(writeSmiles(readMolfile(text)), writeSmiles(mol));
});

test('abbreviations are written as their atoms, generic labels as generic atoms', () => {
  const mol = drawn('CC(C)C');
  const ends = [...mol.atoms()].filter((a) => mol.neighbours(a.id).length === 1);
  ends[0]!.label = 'OTBS'; ends[1]!.label = 'CO2Me'; ends[2]!.label = 'R1';
  const text = writeMolfile(mol);
  assert.doesNotMatch(text, /OTB|CO2/, 'no label is written as an atom symbol');
  const back = readMolfile(text);
  assert.deepEqual([...back.atoms()].map((a) => a.label).filter(Boolean), ['R1']);
  const r = [...back.atoms()].find((a) => a.label)!;
  r.label = null; r.element = 'F';
  assert.ok(sameStructure(back, parseSmiles('FC(C)(O[Si](C)(C)C(C)(C)C)C(=O)OC'.replace('C(C)(O', 'C(O'))));
});

test('a crossed double bond is "either" in the file and back', () => {
  const mol = drawn('CC=CC');
  [...mol.bonds()].find((b) => b.order === 2)!.display = 'either';
  const text = writeMolfile(mol);
  assert.match(text, /^ {2}\d {2}\d {2}2 {2}3$/m);
  assert.equal([...readMolfile(text).bonds()].find((b) => b.order === 2)!.display, 'either');
});

test('stereo drawn with bold and hashed bonds is written as wedges', () => {
  const mol = drawn('N[C@@H](C)C(=O)O');
  perceiveStereoFromGeometry(mol);
  const centre = [...mol.atoms()].find((a) => a.chirality)!;
  const want = rsLabel(mol, centre.id);
  for (const b of mol.bonds()) if (b.display.startsWith('wedge')) b.display = 'bold'; else if (b.display.startsWith('hash')) b.display = 'hash';
  perceiveStereoFromGeometry(mol);
  assert.equal(rsLabel(mol, centre.id), want, 'bold or hashed says the same as the wedge did');
  const back = readMolfile(writeMolfile(mol));
  assert.ok([...back.bonds()].some((b) => /Begin|End/.test(b.display)));
  perceiveStereoFromGeometry(back);
  assert.equal([...back.atoms()].map((a) => rsLabel(back, a.id)).filter(Boolean).join(), want);
});

test('a sulfoxide keeps its configuration through a drawing', () => {
  for (const smiles of ['C[S@](=O)c1ccccc1', 'C[S@@](=O)c1ccccc1', 'CC[P@](C)c1ccccc1']) {
    const mol = parseSmiles(smiles);
    const centre = [...mol.atoms()].find((a) => a.chirality)!;
    const want = rsLabel(mol, centre.id);
    assert.match(want ?? '', /^[RS]$/);
    layout2D(mol);
    const back = readMolfile(writeMolfile(mol));
    perceiveStereoFromGeometry(back);
    assert.equal([...back.atoms()].map((a) => rsLabel(back, a.id)).filter(Boolean).join(), want, smiles);
  }
});
