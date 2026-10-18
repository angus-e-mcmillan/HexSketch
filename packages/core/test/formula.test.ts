import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule } from '../src/model.ts';
import { computeMass, parseFormula, formatHill } from '../src/formula.ts';

/** Build a molecule from a tiny edge-list notation, for test readability. */
function build(elements: string[], edges: [number, number, number?][]): Molecule {
  const mol = new Molecule();
  const ids = elements.map((e, i) => mol.addAtom({ element: e, x: i * 20, y: 0 }).id);
  for (const [a, b, order] of edges) {
    mol.addBond({ begin: ids[a]!, end: ids[b]!, order: (order ?? 1) as 1 | 2 | 3 });
  }
  return mol;
}

test('methane: a bare carbon takes four implicit hydrogens', () => {
  const mol = build(['C'], []);
  const m = computeMass(mol);
  assert.equal(m.formula, 'CH4');
  assert.ok(Math.abs(m.molecularWeight - 16.043) < 0.001, `got ${m.molecularWeight}`);
  assert.ok(Math.abs(m.monoisotopicMass - 16.0313) < 0.0001, `got ${m.monoisotopicMass}`);
});

test('benzene: alternating Kekule ring', () => {
  const mol = build(
    ['C', 'C', 'C', 'C', 'C', 'C'],
    [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]],
  );
  const m = computeMass(mol);
  assert.equal(m.formula, 'C6H6');
  assert.ok(Math.abs(m.molecularWeight - 78.114) < 0.002, `got ${m.molecularWeight}`);
});

test('aspirin: formula and both masses', () => {
  // Ring C0-C5, C6(=O7)O8 carboxyl, O9-C10(=O11)C12 acetate.
  const mol = build(
    ['C','C','C','C','C','C','C','O','O','O','C','O','C'],
    [[0,1,2],[1,2,1],[2,3,2],[3,4,1],[4,5,2],[5,0,1],
     [0,6,1],[6,7,2],[6,8,1],
     [1,9,1],[9,10,1],[10,11,2],[10,12,1]],
  );
  const m = computeMass(mol);
  assert.equal(m.formula, 'C9H8O4');
  assert.ok(Math.abs(m.molecularWeight - 180.159) < 0.01, `MW got ${m.molecularWeight}`);
  assert.ok(Math.abs(m.monoisotopicMass - 180.0423) < 0.001, `mono got ${m.monoisotopicMass}`);
});

test('caffeine: nitrogen-rich heterocycle', () => {
  const mol = build(
    ['N','C','N','C','C','C','N','C','N','C','O','O','C','C'],
    // Six-ring N1-C2-N3-C4=C5-C6, imidazole C5-N7-C8=N9-C4,
    // two carbonyls, and methyls on N1, N3 and N7.
    [[0,1,1],[1,2,1],[2,3,1],[3,4,2],[4,5,1],[5,0,1],
     [4,6,1],[6,7,1],[7,8,2],[8,3,1],
     [5,10,2],[1,11,2],
     [0,12,1],[2,13,1],[6,9,1]],
  );
  const m = computeMass(mol);
  assert.equal(m.formula, 'C8H10N4O2');
  assert.ok(Math.abs(m.molecularWeight - 194.194) < 0.01, `got ${m.molecularWeight}`);
});

test('charged species get the right hydrogen count', () => {
  const ammonium = new Molecule();
  ammonium.addAtom({ element: 'N', x: 0, y: 0, charge: 1 });
  assert.equal(computeMass(ammonium).formulaWithCharge, 'H4N+');

  const amide = new Molecule();
  amide.addAtom({ element: 'N', x: 0, y: 0, charge: -1 });
  assert.equal(computeMass(amide).formulaWithCharge, 'H2N-');

  const hydroxide = new Molecule();
  hydroxide.addAtom({ element: 'O', x: 0, y: 0, charge: -1 });
  assert.equal(computeMass(hydroxide).formulaWithCharge, 'HO-');

  const hydronium = new Molecule();
  hydronium.addAtom({ element: 'O', x: 0, y: 0, charge: 1 });
  assert.equal(computeMass(hydronium).formulaWithCharge, 'H3O+');

  // Both carbocation and carbanion carry three hydrogens.
  for (const q of [1, -1]) {
    const c = new Molecule();
    c.addAtom({ element: 'C', x: 0, y: 0, charge: q });
    assert.equal(computeMass(c).counts.get('H'), 3, `carbon charge ${q}`);
  }

  // Borohydride takes four.
  const borohydride = new Molecule();
  borohydride.addAtom({ element: 'B', x: 0, y: 0, charge: -1 });
  assert.equal(computeMass(borohydride).formulaWithCharge, 'BH4-');
});

test('sulfur picks the valence that fits its bonds', () => {
  const thioether = build(['C', 'S', 'C'], [[0, 1], [1, 2]]);
  assert.equal(computeMass(thioether).formula, 'C2H6S');

  // Dimethyl sulfone: S with two methyls and two double-bonded oxygens.
  const sulfone = build(['C', 'S', 'C', 'O', 'O'], [[0, 1], [1, 2], [1, 3, 2], [1, 4, 2]]);
  assert.equal(computeMass(sulfone).formula, 'C2H6O2S');
});

test('Hill notation orders carbon, then hydrogen, then alphabetical', () => {
  assert.equal(formatHill(new Map([['O', 4], ['C', 9], ['H', 8]])), 'C9H8O4');
  // No carbon present: everything is alphabetical.
  assert.equal(formatHill(new Map([['O', 1], ['H', 2]])), 'H2O');
  // No carbon, so hydrogen sorts alphabetically rather than jumping to front.
  assert.equal(formatHill(new Map([['H', 4], ['B', 1]])), 'BH4');
  assert.equal(formatHill(new Map([['S', 1], ['O', 4], ['H', 2]])), 'H2O4S');
});

test('formula parser handles nesting, multipliers and abbreviations', () => {
  assert.deepEqual([...parseFormula('C6H5')], [['C', 6], ['H', 5]]);
  assert.deepEqual([...parseFormula('Ca(OH)2')], [['Ca', 1], ['O', 2], ['H', 2]]);
  assert.deepEqual([...parseFormula('Ph')], [['C', 6], ['H', 5]]);
  // Two-letter symbols must not be mis-split: Co is cobalt, CO is carbon monoxide.
  assert.deepEqual([...parseFormula('Co')], [['Co', 1]]);
  assert.deepEqual([...parseFormula('CO')], [['C', 1], ['O', 1]]);
  assert.throws(() => parseFormula('Xx'), /unknown element/);
  assert.throws(() => parseFormula('C(H'), /unbalanced/);
});

test('superatom labels contribute their expanded formula', () => {
  const mol = new Molecule();
  const c = mol.addAtom({ element: 'C', x: 0, y: 0 });
  const ph = mol.addAtom({ element: 'C', x: 20, y: 0, label: 'Ph' });
  mol.addBond({ begin: c.id, end: ph.id });
  // Methyl (CH3) plus phenyl (C6H5) = toluene.
  assert.equal(computeMass(mol).formula, 'C7H8');
});

test('generic labels stay in the formula and are reported as unweighable', () => {
  const mol = new Molecule();
  const c1 = mol.addAtom({ element: 'C', x: 0, y: 0 });
  const c2 = mol.addAtom({ element: 'C', x: 20, y: 0 });
  const x = mol.addAtom({ element: 'C', x: 40, y: 0, label: 'X' });
  mol.addBond({ begin: c1.id, end: c2.id });
  mol.addBond({ begin: c2.id, end: x.id });
  const m = computeMass(mol);
  assert.equal(m.formula, 'C2H5X');
  assert.deepEqual(m.unweighable, ['X']);
});
