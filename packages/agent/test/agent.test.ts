import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { payloadFromPng, decodePayload, parseSmiles, sameStructure, writeMolfile, writeCdxml, layout2D, DEFAULT_STYLE } from '@hexsketch/core';
import { analyze, compare, convert, detectFormat, link, name, readStructure, render, validate } from '../src/index.ts';

const ASPIRIN = 'CC(=O)Oc1ccccc1C(=O)O';

test('detects SMILES, molfiles, CDXML, links and payloads', async () => {
  const mol = parseSmiles(ASPIRIN);
  layout2D(mol);
  assert.equal(detectFormat(ASPIRIN), 'smiles');
  assert.equal(detectFormat(writeMolfile(mol)), 'mol');
  assert.equal(detectFormat(writeCdxml(mol)), 'cdxml');
  assert.equal(detectFormat('https://hexsketch.com/#smiles=CCO'), 'link');
  assert.equal(detectFormat('#cdxml=abc'), 'link');
  assert.equal(detectFormat(await convert(ASPIRIN, 'link', { style: 'acs' })), 'link');
  for (const input of [ASPIRIN, writeMolfile(mol), writeCdxml(mol), await link(ASPIRIN), await convert(ASPIRIN, 'link', { style: 'hexsketch' })]) {
    assert.ok(sameStructure((await readStructure(input)).mol, mol), input.slice(0, 40));
  }
});

test('renders SVG, PDF, CDXML and MOL', async () => {
  const svg = await render(ASPIRIN);
  assert.equal(svg.mediaType, 'image/svg+xml');
  assert.match(svg.data as string, /^<svg[\s\S]*<\/svg>$/);
  assert.ok(svg.width > 50 && svg.height > 30);
  const pdf = await render(ASPIRIN, { to: 'pdf' });
  assert.equal(new TextDecoder().decode((pdf.data as Uint8Array).slice(0, 5)), '%PDF-');
  assert.match((await render(ASPIRIN, { to: 'cdxml' })).data as string, /<CDXML/);
  assert.match((await render(ASPIRIN, { to: 'mol' })).data as string, /V2000/);
});

test('PNG goes through the given rasterizer and carries the structure', async () => {
  await assert.rejects(render(ASPIRIN, { to: 'png' }), /rasterizer/);
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, c]);
  };
  const white = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])), chunk('IDAT', deflateSync(Buffer.from([0, 255, 255, 255]))), chunk('IEND', Buffer.alloc(0))]);
  let seen = '';
  const png = await render(ASPIRIN, { to: 'png', scale: 3, rasterize: (svg, scale) => { seen = `${scale}|${svg.includes('fill="#ffffff"')}`; return new Uint8Array(white); } });
  assert.equal(seen, '3|true');
  const text = payloadFromPng(png.data as Uint8Array);
  assert.ok(text?.startsWith('2-acetoxybenzoic aci'));
  assert.ok(sameStructure((await decodePayload(text!))!.mol, parseSmiles(ASPIRIN)));
});

test('names and analyses, per structure for mixtures', async () => {
  assert.deepEqual(await name(ASPIRIN), { name: '2-acetoxybenzoic acid' });
  assert.deepEqual(await name('C[C@H](N)C(=O)O'), { name: '(S)-2-aminopropanoic acid' });
  const a = await analyze(ASPIRIN);
  assert.equal(a.formula, 'C9H8O4');
  assert.equal(a.exactMass.toFixed(4), '180.0423');
  assert.equal(a.molecularWeight?.toFixed(2), '180.16');
  assert.equal(a.elementalAnalysis, 'C, 60.00; H, 4.48; O, 35.52');
  assert.equal(a.isotopes[0]!.relative, 100);
  assert.deepEqual(a.structures, []);
  const salt = await analyze('CC(=O)[O-].[Na+]');
  assert.equal(salt.name, 'sodium acetate');
  assert.deepEqual(salt.structures.map((s) => s.formula).sort(), ['C2H3O2-', 'Na+']);
});

test('abbreviations are drawn out for SMILES and names', async () => {
  const mol = parseSmiles('CC');
  layout2D(mol);
  const [, b] = [...mol.atoms()];
  b!.label = 'Ph';
  const s = await readStructure(writeCdxml(mol, DEFAULT_STYLE));
  assert.ok((await compare(s, 'Cc1ccccc1')).same);
  assert.equal((await name(s)).name, 'toluene');
});

test('converts with stereochemistry kept', async () => {
  assert.equal(await convert('C[C@H](N)C(=O)O', 'smiles'), 'C[C@H](N)C(=O)O');
  // A drawn structure: the SMILES comes from its wedges.
  const drawn = await convert(await convert('C[C@H](N)C(=O)O', 'cdxml'), 'smiles');
  assert.ok((await compare(drawn, 'N[C@@H](C)C(=O)O')).same, drawn);
  assert.ok((await compare(await convert('F/C=C/F', 'mol'), 'F/C=C/F')).same);
});

test('links: short for SMILES, full drawing otherwise', async () => {
  assert.equal(await link('CC#N'), 'https://hexsketch.com/#smiles=CC%23N');
  assert.equal(await link('CCO', { base: 'http://localhost:5174/' }), 'http://localhost:5174/#smiles=CCO');
  assert.match(await link(await convert('CCO', 'cdxml')), /^https:\/\/hexsketch\.com\/#cdxml=/);
});

test('validate reports bad input instead of throwing', async () => {
  const cases: [string, RegExp][] = [
    ['aspirin', /looks like a name/],
    ['InChI=1S/CH4/h1H4', /InChI is not supported/],
    ['c1cccc1', /kekulize.*\[nH\]/],
    ['CC1CC', /unclosed ring/],
    ['CCCC(', /unclosed branch/],
    ['', /No structure/],
  ];
  for (const [input, why] of cases) {
    const v = await validate(input);
    assert.equal(v.ok, false, input);
    assert.match(v.issues[0]!.message, why, input);
  }
});

test('validate flags impossible and unusual atoms', async () => {
  const five = await validate('C(C)(C)(C)(C)C');
  assert.equal(five.ok, false);
  assert.deepEqual(five.issues.map((i) => [i.severity, i.atom]), [['error', 1]]);
  assert.match(five.issues[0]!.message, /C \(atom 1\) has valence 5, 1 more than C allows/);

  const clf3 = await validate('FCl(F)F');
  assert.equal(clf3.ok, true);
  assert.equal(clf3.issues.find((i) => i.atom === 2)?.severity, 'warning');

  assert.match((await validate('C[CH2+]')).issues.map((i) => i.message).join('\n'), /carbocation/);
  assert.match((await validate('C[CH2]')).issues.map((i) => i.message).join('\n'), /radical|valence/);
  assert.match((await validate('CC(=O)[O-].[Na+]')).issues[0]!.message, /2 separate structures/);

  const fine = await validate('C[C@H](N)C(=O)O');
  assert.deepEqual(fine, { ok: true, issues: [], smiles: 'C[C@H](N)C(=O)O', name: '(S)-2-aminopropanoic acid', formula: 'C3H7NO2' });
});

test('compare tells stereoisomers apart across formats', async () => {
  assert.deepEqual(await compare('C[C@H](N)C(=O)O', 'N[C@@H](C)C(=O)O'), { same: true, sameConnectivity: true, smiles: ['C[C@H](N)C(=O)O', 'N[C@@H](C)C(=O)O'] });
  const enantiomer = await compare('C[C@H](N)C(=O)O', 'C[C@@H](N)C(=O)O');
  assert.deepEqual([enantiomer.same, enantiomer.sameConnectivity], [false, true]);
  const unspecified = await compare('C[C@H](N)C(=O)O', 'CC(N)C(=O)O');
  assert.deepEqual([unspecified.same, unspecified.sameConnectivity], [false, true]);
  assert.equal((await compare('F/C=C/F', 'F/C=C\\F')).same, false);
  assert.equal((await compare('C[C@H]1CC[C@@H](C)CC1', 'C[C@H]1CC[C@H](C)CC1')).same, false);
  assert.equal((await compare('CCO', 'OCC')).same, true);
  assert.equal((await compare('CCO', 'COC')).sameConnectivity, false);
  // Different Kekulé forms are the same compound.
  assert.equal((await compare('C1=CC=CC=C1', 'C1C=CC=CC=1')).same, true);
});
