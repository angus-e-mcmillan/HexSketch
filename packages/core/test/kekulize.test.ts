/** Rings drawn as a circle, read as alternating double bonds. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMass, kekulize, parseSmiles, readCdxmlDocument, readMolfile, writeMolfile, writeSmiles } from '../src/index.ts';

/** The structure as ChemDraw saves a delocalised ring: every ring bond Order="1.5". */
function circled(smiles: string): string {
  const m = parseSmiles(smiles);
  const ids = [...m.atoms()].map((a) => a.id);
  const Z: Record<string, number> = { B: 5, C: 6, N: 7, O: 8, F: 9, S: 16, Cl: 17 };
  const nodes = [...m.atoms()].map((a, i) => `<n id="${i + 1}" p="${100 + 30 * a.x} ${100 + 30 * a.y}" Element="${Z[a.element] ?? 6}"${a.charge ? ` Charge="${a.charge}"` : ''}/>`).join('');
  const bonds = [...m.bonds()].map((b) => `<b B="${ids.indexOf(b.begin) + 1}" E="${ids.indexOf(b.end) + 1}" Order="${b.order === 3 ? 3 : 1.5}"/>`).join('');
  return `<?xml version="1.0"?><CDXML><page><fragment>${nodes}${bonds}</fragment></page></CDXML>`;
}

test('a ChemDraw circle is read as a ring of alternating double bonds, not as a saturated ring', () => {
  // Read as they stand, order-1.5 bonds count as single and benzene becomes cyclohexane.
  const mol = readCdxmlDocument(circled('c1ccccc1')).mol;
  assert.equal(computeMass(mol).formulaWithCharge, 'C6H6');
  assert.deepEqual([...mol.bonds()].map((b) => b.order).sort(), [1, 1, 1, 2, 2, 2]);
});

test('the lone pair of a pyrrole-type ring stays a lone pair, and a heteroatom takes a double bond only where it must', () => {
  for (const [smiles, formula] of [['c1ccncc1', 'C5H5N'], ['c1cc[nH]c1', 'C4H5N'], ['c1cnc[nH]1', 'C3H4N2'], ['c1ccsc1', 'C4H4S'], ['c1ccoc1', 'C4H4O'], ['c1ccc2ccccc2c1', 'C10H8'], ['c1ccc2[nH]ccc2c1', 'C8H7N'], ['O=c1cc[nH]cc1', 'C5H5NO']] as const) {
    assert.equal(computeMass(readCdxmlDocument(circled(smiles)).mol).formulaWithCharge, formula, smiles);
  }
});

test('an aromatic molfile (bond type 4) is kekulized too', () => {
  const mol = readMolfile(writeMolfile(parseSmiles('c1ccccc1')).replace(/^(.{6}.{3})  2/gm, '$1  4'));
  assert.equal(computeMass(mol).formulaWithCharge, 'C6H6');
});

test('a fragment no arrangement fits is left as it was, rather than guessed at', () => {
  // Three carbons in a row, every bond delocalised: one of them can never find a partner.
  const xml = '<?xml version="1.0"?><CDXML><page><fragment><n id="1" p="0 0" Element="6"/><n id="2" p="30 0" Element="6"/><n id="3" p="60 0" Element="6"/><b B="1" E="2" Order="1.5"/><b B="2" E="3" Order="1.5"/></fragment></page></CDXML>';
  const mol = readCdxmlDocument(xml).mol;
  assert.equal([...mol.bonds()].filter((b) => b.order === 1.5).length, 2, 'left delocalised, not turned into a wrong structure');
  assert.equal(kekulize(mol), 0);
});

test('a structure with no delocalised bonds is untouched', () => {
  const mol = parseSmiles('CC(=O)OC');
  const before = [...mol.bonds()].map((b) => b.order);
  assert.equal(kekulize(mol), 0);
  assert.deepEqual([...mol.bonds()].map((b) => b.order), before);
  assert.equal(writeSmiles(mol), 'CC(=O)OC');
});
