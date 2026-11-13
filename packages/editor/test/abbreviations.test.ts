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
