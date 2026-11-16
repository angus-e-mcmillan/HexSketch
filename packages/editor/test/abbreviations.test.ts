import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMass } from '@hexsketch/core';
import { Editor } from '../src/index.ts';

test('an abbreviation in a chain draws out: the N-methyl amide of a peptide backbone', () => {
  // C(=O)-NMe-C: "NMe" has a bond on each side, as ChemDraw writes an N-methylated residue.
  const ed = new Editor();
  ed.doc.edit((m) => {
    const c1 = m.addAtom({ element: 'C', x: 0, y: 0 }).id;
    const nme = m.addAtom({ element: 'C', x: 20, y: 0, label: 'NMe' }).id;
    const c2 = m.addAtom({ element: 'C', x: 40, y: 0 }).id;
    m.addBond({ begin: c1, end: nme, order: 1 });
    m.addBond({ begin: nme, end: c2, order: 1 });
  });
  assert.equal(ed.expandLabels(), 1);
  assert.ok([...ed.doc.mol.atoms()].every((a) => a.label === null), 'nothing left as a label');
  assert.equal(computeMass(ed.doc.mol).formula, 'C3H9N', 'CH3-N(CH3)-CH3: trimethylamine');
  // Where the first atom has no room for a second bond, the label stays: an OMe cannot sit in a chain.
  const two = new Editor();
  two.doc.edit((m) => {
    const a = m.addAtom({ element: 'C', x: 0, y: 0 }).id, o = m.addAtom({ element: 'C', x: 20, y: 0, label: 'OMe' }).id, b = m.addAtom({ element: 'C', x: 40, y: 0 }).id;
    m.addBond({ begin: a, end: o, order: 1 }); m.addBond({ begin: o, end: b, order: 1 });
  });
  assert.equal(two.expandLabels(), 0);
});

/** Ethane with `text` typed onto its second carbon. */
function typed(text: string) {
  const ed = new Editor();
  ed.doc.edit((m) => {
    const a = m.addAtom({ element: 'C', x: 0, y: 0 }).id, b = m.addAtom({ element: 'C', x: 20, y: 0 }).id;
    m.addBond({ begin: a, end: b, order: 1 });
  });
  const id = [...ed.doc.mol.atoms()][1]!.id;
  ed.setLabel(id, text);
  return { ed, atom: ed.doc.mol.atom(id), formula: computeMass(ed.analysisMolecule()).formulaWithCharge };
}

test('one atom typed with its hydrogens, isotope or charge is that atom, not a label', () => {
  // Each was kept as a label before: an "OH" that was not an oxygen, and NH3+ with no charge.
  for (const [text, element, charge, isotope, formula] of [
    ['OH', 'O', 0, null, 'CH4O'], ['HO', 'O', 0, null, 'CH4O'], ['NH2', 'N', 0, null, 'CH5N'], ['H2N', 'N', 0, null, 'CH5N'], ['H3C', 'C', 0, null, 'C2H6'],
    ['NH3+', 'N', 1, null, 'CH6N+'], ['O-', 'O', -1, null, 'CH3O-'], ['13CH3', 'C', 0, 13, 'C2H6'], ['15NH2', 'N', 0, 15, 'CH5N'], ['18F', 'F', 0, 18, 'CH3F'], ['D', 'H', 0, 2, 'CH4'],
  ] as const) {
    const { atom, formula: got } = typed(text);
    assert.equal(atom.label, null, `${text} is an atom`);
    assert.deepEqual([atom.element, atom.charge, atom.isotope], [element, charge, isotope], text);
    assert.equal(got, formula, text);
  }
});

test('Ac, Pr, Ts and Np typed on an atom are the groups, not actinium, praseodymium, tennessine and neptunium', () => {
  for (const [text, formula] of [['Ac', 'C3H6O'], ['Pr', 'C4H10'], ['Ts', 'C8H10O2S'], ['Np', 'C6H14']] as const) {
    const { atom, formula: got } = typed(text);
    assert.equal(atom.label, text);
    assert.equal(got, formula, text);
  }
  assert.equal(typed('Pd').atom.element, 'Pd');
  assert.equal(typed('Co').atom.element, 'Co');
});

test('a metal has the bonds it is drawn with and no hydrogens added', () => {
  // A drawn Pd was PdH2, Ti TiH4 and W WH6.
  for (const metal of ['Pd', 'Ti', 'W', 'Na', 'Mg', 'Fe', 'Cu', 'Zn', 'Li']) {
    const ed = new Editor();
    ed.doc.edit((m) => { m.addAtom({ element: metal, x: 0, y: 0 }); });
    assert.equal(computeMass(ed.doc.mol).formula, metal, metal);
  }
  assert.equal(typed('Pd').formula, 'CH3Pd');
  // The non-metals and metalloids still fill up.
  assert.equal(typed('Si').formula, 'CH6Si');
});

test('a label that cannot make the bonds drawn to it is marked', () => {
  const ed = new Editor();
  ed.doc.edit((m) => {
    const a = m.addAtom({ element: 'C', x: 0, y: 0 }).id, o = m.addAtom({ element: 'C', x: 20, y: 0, label: 'OMe' }).id, b = m.addAtom({ element: 'C', x: 40, y: 0 }).id;
    const n = m.addAtom({ element: 'C', x: 60, y: 0, label: 'NMe' }).id, c = m.addAtom({ element: 'C', x: 80, y: 0 }).id;
    m.addBond({ begin: a, end: o }); m.addBond({ begin: o, end: b }); m.addBond({ begin: b, end: n }); m.addBond({ begin: n, end: c });
  });
  const [, ome, , nme] = [...ed.doc.mol.atoms()].map((x) => x.id);
  assert.equal(ed.overvalent(ome!), true, 'OMe between two atoms');
  assert.equal(ed.overvalent(nme!), false, 'NMe between two atoms is fine');
});

test('labels HexSketch reads from their parts draw out', () => {
  for (const [label, formula] of [['OPiv', 'C6H12O2'], ['CH2CH2OH', 'C3H8O'], ['SO2NH2', 'CH5NO2S'], ['MeO2C', 'C3H6O2'], ['P(O)(OEt)2', 'C5H13O3P']] as const) {
    const { ed } = typed(label);
    assert.equal(ed.expandLabels(), 1, label);
    assert.ok([...ed.doc.mol.atoms()].every((a) => a.label === null));
    assert.equal(computeMass(ed.doc.mol).formula, formula, label);
  }
});
