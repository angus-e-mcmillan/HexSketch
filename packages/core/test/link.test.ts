import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles } from '../src/smiles.ts';
import { sameStructure } from '../src/isomorphism.ts';
import { layout2D } from '../src/layout.ts';
import { aiSummary, readStructureLink, smilesLink, structureLink, HEXSKETCH_URL } from '../src/link.ts';
import { HEXSKETCH_STYLE } from '../src/style.ts';

const fragment = (url: string) => url.slice(url.indexOf('#'));

test('a SMILES link opens the same structure, laid out', async () => {
  // Triple bond (#), charges (+), stereo (@, /) and a two-digit ring closure (%10) all need escaping.
  for (const smi of ['CC#N', '[NH4+].[Cl-]', 'C[C@H](N)C(=O)O', 'F/C=C/F', 'C1CCCCCCCCC%10CCCCCCCCC1%10']) {
    const url = smilesLink(smi);
    assert.ok(url.startsWith(`${HEXSKETCH_URL}#smiles=`));
    const got = await readStructureLink(fragment(url));
    assert.equal(got?.kind, 'smiles', smi);
    assert.ok(sameStructure(got.mol, parseSmiles(smi)), smi);
    assert.ok([...got.mol.atoms()].some((a) => a.x !== 0 || a.y !== 0), `${smi} laid out`);
  }
});

test('SMILES typed into a link by hand, unescaped, still opens', async () => {
  for (const smi of ['CC(=O)Oc1ccccc1C(=O)O', 'C#C', '[Na+].[O-]C(=O)C', 'C1CC%12CC1.C%12']) {
    const got = await readStructureLink(`#smiles=${smi}`);
    assert.ok(got && sameStructure(got.mol, parseSmiles(smi)), smi);
  }
});

test('a drawing link round-trips structure, layout and style', async () => {
  const mol = parseSmiles('CC(C)Cc1ccc(C(C)C(=O)O)cc1');
  layout2D(mol, HEXSKETCH_STYLE.bondLength);
  const url = await structureLink(mol, HEXSKETCH_STYLE);
  assert.match(url, /^https:\/\/hexsketch\.com\/#cdxml=[A-Za-z0-9_~-]+$/);
  const got = await readStructureLink(fragment(url));
  assert.equal(got?.kind, 'drawing');
  assert.ok(sameStructure(mol, got.mol));
  assert.equal(got.style.lineWidth.toFixed(2), HEXSKETCH_STYLE.lineWidth.toFixed(2));
  const first = [...mol.atoms()][0]!, back = [...got.mol.atoms()][0]!;
  assert.ok(Math.abs(first.x - back.x) < 0.1 && Math.abs(first.y - back.y) < 0.1);
});

test('a link may carry plain CDXML text', async () => {
  const cdxml = '<?xml version="1.0"?><CDXML><page><fragment><n id="1" p="0 0"/><n id="2" p="0 0" Element="8"/><b B="1" E="2"/></fragment></page></CDXML>';
  const got = await readStructureLink(`#cdxml=${encodeURIComponent(cdxml)}`);
  assert.equal(got?.kind, 'drawing');
  assert.ok(sameStructure(got.mol, parseSmiles('CO')));
  // No coordinates in the file: laid out on open.
  assert.ok([...got.mol.atoms()].some((a) => a.x !== 0 || a.y !== 0));
});

test('fragments without a structure open nothing; broken ones say why', async () => {
  assert.equal(await readStructureLink(''), null);
  assert.equal(await readStructureLink('#'), null);
  assert.equal(await readStructureLink('#section-2'), null);
  await assert.rejects(readStructureLink('#smiles=not(a[smiles'), /SMILES/);
  await assert.rejects(readStructureLink('#smiles='), /SMILES/);
  await assert.rejects(readStructureLink('#cdxml=AAAA'), /damaged/);
  await assert.rejects(readStructureLink('#cdxml=%3CCDXML%3E%3C%2FCDXML%3E'), /no structure/);
});

test('the AI summary lists each structure with its SMILES, formula and masses', () => {
  const one = aiSummary(parseSmiles('CC(=O)Oc1ccccc1C(=O)O'), { nameOf: () => '2-acetoxybenzoic acid', link: 'https://hexsketch.com/#smiles=x' });
  assert.match(one, /^Structure from HexSketch\nName: 2-acetoxybenzoic acid\nSMILES: \S+\nFormula: C9H8O4\nExact mass: 180\.0423\nMolecular weight: 180\.16\n\nOpen and edit in HexSketch: https:\/\/hexsketch\.com\/#smiles=x$/);

  const two = aiSummary(parseSmiles('CCO.[Na+].[Cl-]'));
  assert.match(two, /^Drawing from HexSketch \(3 structures\)/);
  assert.match(two, /Structure 1\nSMILES: CCO\nFormula: C2H6O/);
  assert.match(two, /Formula: Na\+/);
  assert.doesNotMatch(two, /Name:|Open and edit/);
});

test('the AI summary carries drawn stereochemistry in its SMILES', () => {
  const alanine = parseSmiles('C[C@H](N)C(=O)O');
  layout2D(alanine);
  for (const a of alanine.atoms()) a.chirality = null; // as drawn: wedges only
  assert.match(aiSummary(alanine), /^SMILES: \S*@/m);
});
