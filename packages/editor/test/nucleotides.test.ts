/** Oligonucleotides typed as a sequence: analysed as a caption, drawn out by Expand Label, cleaned up as a strand. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaption, oligoSmiles, parseOligo, parseSmiles, sameStereoisomer, sameStructure } from '@hexsketch/core';
import { nameMolecule } from '@hexsketch/naming';
import { Editor } from '../src/index.ts';

test('a caption holding a sequence is analysed; Expand Label draws the strand, which keeps its sequence as its name', () => {
  const ed = new Editor();
  ed.doc.objects.push(makeCaption(100, 100, "5'-ACGT-3'"));
  assert.equal(ed.mass?.formula, 'C39H50N15O22P3');
  assert.ok(Math.abs(ed.mass!.molecularWeight - 1173.8) < 0.1);
  assert.equal(nameMolecule(ed.analysisMolecule()).name, "5'-d(ACGT)-3'");
  assert.equal(ed.expandLabels(), 1);
  assert.equal(ed.doc.objects.length, 0, 'caption replaced');
  const built = parseSmiles(oligoSmiles(parseOligo("5'-ACGT-3'")!));
  assert.ok(sameStructure(ed.doc.mol, built));
  assert.ok(sameStereoisomer(ed.doc.mol, built, { recorded: [false, true] }), 'wedges show the natural configuration');
  assert.equal(nameMolecule(ed.doc.mol).name, "5'-d(ACGT)-3'");
  // Clean Up Structure keeps it a strand: taller than wide, nothing folded onto itself.
  ed.selectAll();
  ed.cleanUp();
  const at = [...ed.doc.mol.atoms()];
  const xs = at.map((a) => a.x), ys = at.map((a) => a.y);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 2 * (Math.max(...xs) - Math.min(...xs)));
  assert.ok(sameStereoisomer(ed.doc.mol, built, { recorded: [false, true] }));
});

test('a lone atom label holding a sequence expands too; a mirror-image strand is not called by the natural sequence', () => {
  const ed = new Editor();
  ed.doc.edit((m) => { m.addAtom({ element: 'C', x: 300, y: 300, label: 'r(AUG)' }); });
  assert.equal(ed.mass?.formula, 'C29H36N12O19P2');
  assert.equal(ed.expandLabels(), 1);
  // Three units or more go by their sequence (a dinucleotide gets its systematic name).
  assert.equal(nameMolecule(ed.doc.mol).name, "5'-r(AUG)-3'");
  const mirror = parseSmiles(oligoSmiles(parseOligo('d(TTT)')!).replace(/@@?/g, (m) => (m === '@' ? '@@' : '@')));
  assert.notEqual(nameMolecule(mirror).name, "5'-d(TTT)-3'");
});
