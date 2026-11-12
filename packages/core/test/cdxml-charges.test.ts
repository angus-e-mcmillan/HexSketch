/**
 * A charge, an isotope or a radical travels to ChemDraw.
 *
 * ChemDraw takes an atom's displayed label from its <t> element and writes
 * one for every atom it labels. HexSketch wrote <t> only for a superatom, so
 * a nitro group opened in ChemDraw arrived as a neutral N, an azide lost its
 * charges, and an N-oxide looked like an amine.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMass, parseSmiles, readCdxmlDocument, writeCdxml, writeSmiles, DEFAULT_STYLE } from '../src/index.ts';

const cdxml = (smiles: string) => writeCdxml(parseSmiles(smiles), DEFAULT_STYLE, []);

test('a charged atom carries its charge in the label ChemDraw reads', () => {
  const xml = cdxml('O=[N+]([O-])c1ccccc1');
  assert.match(xml, /<t><s[^>]*>N\+<\/s><\/t>/, 'the nitrogen is labelled N+');
  assert.match(xml, /<t><s[^>]*>O-<\/s><\/t>/, 'the oxygen is labelled O-');
  // The charge is still an attribute too, which is what HexSketch itself reads.
  assert.match(xml, /Charge="1"/);
  assert.match(xml, /Charge="-1"/);
});

test('an azide, an N-oxide and an ylide all keep their charges', () => {
  for (const [smiles, wanted] of [['[N-]=[N+]=NCc1ccccc1', ['N-', 'N+']], ['C[n+]1ccccc1[O-]', ['N+', 'O-']], ['C[P+](C)(C)[CH2-]', ['P+', 'CH2-']]] as const) {
    const xml = cdxml(smiles);
    for (const label of wanted) assert.match(xml, new RegExp(`<t><s[^>]*>${label.replace('+', '\\+')}</s></t>`), `${smiles}: ${label}`);
  }
});

test('a plain atom gets no label, and an isotope or a radical does', () => {
  assert.ok(!/\<t\>/.test(cdxml('CCO')), 'ethanol needs no label element');
  assert.match(cdxml('[13CH4]'), /<t><s[^>]*>13CH4<\/s><\/t>/);
  const radical = parseSmiles('C');
  radical.atom([...radical.atoms()][0]!.id).radical = 1;
  assert.match(writeCdxml(radical, DEFAULT_STYLE, []), /<t><s[^>]*>CH3\u2022<\/s><\/t>/);
});

test('HexSketch reads its own file back unchanged: the label is not mistaken for a superatom', () => {
  for (const smiles of ['O=[N+]([O-])c1ccccc1', '[N-]=[N+]=NCc1ccccc1', 'C[n+]1ccccc1[O-]', 'CC(=O)OC']) {
    const back = readCdxmlDocument(cdxml(smiles)).mol;
    assert.equal(computeMass(back).formulaWithCharge, computeMass(parseSmiles(smiles)).formulaWithCharge, smiles);
    assert.equal([...back.atoms()].filter((a) => a.label !== null).length, 0, `${smiles}: no atom became a superatom`);
    assert.ok(writeSmiles(back).length > 0);
  }
});
