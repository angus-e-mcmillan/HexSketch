import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { payloadFromPng, decodePayload, parsePattern, parseSmiles, substructureMatches, sameStructure, substructureMappings, writeMolfile, writeCdxml, layout2D, DEFAULT_STYLE } from '@hexsketch/core';
import { analyze, arrangeForArrows, compare, convert, detectFormat, electronArrows, labelPlaces, link, name, orientLike, placeLabels, readStructure, render, scheme, validate } from '../src/index.ts';

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

test('scheme draws a reaction: structures, arrows, reagents above and conditions below', async () => {
  const s = await scheme({
    stages: ['c1ccccc1', 'c1ccccc1[N+](=O)[O-]', 'Nc1ccccc1'],
    arrows: [{ reagents: 'HNO3, H2SO4', conditions: '50 °C' }, { reagents: 'H2, Pd/C', conditions: 'EtOH, rt, 16 h\n95%' }],
  });
  const arrows = s.objects.filter((o) => o.kind === 'arrow');
  const texts = s.objects.filter((o) => o.kind === 'text');
  assert.equal(arrows.length, 2);
  assert.deepEqual(texts.map((t) => t.text), ['HNO3, H2SO4', '50 °C', 'H2, Pd/C', 'EtOH, rt, 16 h\n95%']);
  // Left to right: each stage clear of the arrows beside it, reagents above (screen y down) and conditions below.
  const xs = s.mol.fragments().map((ids) => ids.map((id) => s.mol.atom(id).x));
  const [a1, a2] = arrows as { tail: { x: number; y: number }; head: { x: number; y: number } }[];
  assert.ok(Math.max(...xs[0]!) < a1!.tail.x && a1!.head.x < Math.min(...xs[1]!) && Math.max(...xs[1]!) < a2!.tail.x && a2!.head.x < Math.min(...xs[2]!));
  assert.ok(texts[0]!.y < a1!.tail.y && texts[1]!.y > a1!.tail.y);
  // It reads back as the three compounds, and keeps its arrows through CDXML.
  assert.deepEqual((await analyze(s)).structures.map((x) => x.name), ['benzene', 'nitrobenzene', 'aniline']);
  const back = await readStructure(await convert(s, 'cdxml'));
  assert.equal(back.objects.filter((o) => o.kind === 'arrow').length, 2);
  // Two structures in a stage get a plus between them.
  const ester = await scheme({ stages: ['CC(=O)O.OCC', 'CC(=O)OCC.O'], arrows: [{ reagents: 'H2SO4' }] });
  assert.equal(ester.objects.filter((o) => o.kind === 'text' && o.text === '+').length, 2);
  // A long scheme wraps onto rows no wider than a page.
  const long = await scheme({ stages: ['CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'CC(C)Cc1ccc(cc1)C(C)C(=O)OC', 'CC(C)Cc1ccc(cc1)C(C)CO', 'CC(C)Cc1ccc(cc1)C(C)C=O'], arrows: [{ reagents: 'MeOH, H2SO4 (cat.)' }, { reagents: 'LiAlH4' }, { reagents: 'DMP' }] });
  const xs2 = [...long.mol.atoms()].map((a) => a.x);
  assert.ok(Math.max(...xs2) - Math.min(...xs2) <= 520);
  assert.equal(new Set(long.objects.filter((o) => o.kind === 'arrow').map((o) => Math.round((o as { tail: { y: number } }).tail.y))).size, 2);
  await assert.rejects(scheme({ stages: ['CCO'] }), /at least two stages/);
  await assert.rejects(scheme({ stages: ['CCO', 'ethanal'] }), /Stage 2: .*looks like a name/);
});

test('related structures are drawn the same way round', async () => {
  // The same compound written two ways: drawn identically (up to where it sits).
  const s = await scheme({ stages: ['OC(=O)c1ccccc1OC(C)=O', 'CC(=O)Oc1ccccc1C(=O)O'] });
  const [a, b] = s.mol.fragments();
  const shape = (ids: number[]) => {
    const atoms = ids.map((id) => s.mol.atom(id));
    const cx = atoms.reduce((t, x) => t + x.x, 0) / atoms.length, cy = atoms.reduce((t, x) => t + x.y, 0) / atoms.length;
    return atoms.map((x) => `${x.element}${Math.round(x.x - cx)},${Math.round(x.y - cy)}`).sort();
  };
  assert.deepEqual(shape(a!), shape(b!));
  // A product keeps its starting material's orientation, and its stereochemistry.
  const r = await scheme({ stages: ['CC(C)Cc1ccc(cc1)[C@H](C)C(=O)O', 'O=C(OC)[C@@H](C)c1ccc(CC(C)C)cc1'] });
  assert.deepEqual((await analyze(r)).structures.map((x) => x.name), ['(S)-2-(4-isobutylphenyl)propanoic acid', 'methyl (S)-2-(4-isobutylphenyl)propanoate']);
  // Enantiomers drawn alike keep their own configurations.
  const e = await scheme({ stages: ['C[C@H](N)C(=O)O', 'OC(=O)[C@@H](C)N'] });
  assert.deepEqual((await analyze(e)).structures.map((x) => x.name), ['(S)-2-aminopropanoic acid', '(R)-2-aminopropanoic acid']);
  // A SMILES shown in place of a drawing turns to match it.
  const before = await readStructure('CC(C)Cc1ccc(cc1)C(C)C(=O)O');
  const after = await readStructure('O=C(OC)C(C)c1ccc(CC(C)C)cc1');
  const map = substructureMappings(before.mol, after.mol, 1)[0]!.map; // the acid's atoms in the ester
  const atoms = [...before.mol.atoms()];
  // From the CH2 of the isobutyl group to the CH by the carbonyl.
  const angle = (m: typeof before.mol, p: number, q: number) => Math.atan2(m.atom(q).y - m.atom(p).y, m.atom(q).x - m.atom(p).x);
  const [ch2, ch] = [atoms[3]!.id, atoms[10]!.id];
  const turned = (m: typeof before.mol) => Math.abs(Math.atan2(Math.sin(angle(m, map.get(ch2)!, map.get(ch)!) - angle(before.mol, ch2, ch)), Math.cos(angle(m, map.get(ch2)!, map.get(ch)!) - angle(before.mol, ch2, ch))));
  orientLike(after, before.mol);
  assert.ok(turned(after.mol) < 0.2, `turned by ${turned(after.mol)} rad`);
});

test('a fragment written aromatic only matches aromatic atoms, even outside a ring', () => {
  const aspirin = parseSmiles('CC(=O)Oc1ccccc1C(=O)O');
  assert.equal(substructureMatches(parsePattern('C(=O)Oc'), aspirin).length, 1);
  assert.equal(substructureMatches(parsePattern('C(=O)OC'), aspirin).length, 0);
  assert.equal(substructureMatches(parsePattern('[nH]'), parseSmiles('c1cc[nH]c1')).length, 1);
});

test('labels sit beside their own atom, clear of bonds and of each other', async () => {
  const s = await readStructure('CC(C)Cc1ccc(cc1)C(C)C(=O)O');
  const L = s.style.bondLength;
  const labels = [{ at: 'OC(=O)', text: 'pKa ≈ 4.4' }, { at: 'CC(C)C', text: 'lipophilic' }, { at: 'N', text: 'nothing' }];
  const { objects, found } = placeLabels(s.mol, s.objects, s.style, labels);
  assert.deepEqual(found, [1, 1, 0]);
  const captions = objects.filter((o) => o.kind === 'text');
  assert.equal(captions.length, 2);
  for (const [i, c] of captions.entries()) {
    const anchor = labelPlaces(s.mol, labels[i]!.at)[0]!;
    // Nearer its own atom than any other, and within two bond lengths of it.
    const d = (a: { x: number; y: number }) => Math.hypot(a.x - c.x, a.y - (c.y - 3));
    const nearest = [...s.mol.atoms()].sort((a, b) => d(a) - d(b))[0]!;
    assert.equal(nearest.id, anchor.id, `"${c.text}" is nearest its atom`);
    assert.ok(d(anchor) < 2 * L);
  }
  // Places count left to right, and occurrence picks one.
  const diacid = await readStructure('OC(=O)c1ccccc1C(=O)O');
  const [a, b] = labelPlaces(diacid.mol, 'C(=O)O');
  assert.ok(a!.x <= b!.x);
  const second = placeLabels(diacid.mol, [], diacid.style, [{ at: 'C(=O)O', text: 'acid', occurrence: 2 }]).objects[0]!;
  assert.ok(second.kind === 'text' && Math.hypot(second.x - b!.x, second.y - b!.y) < Math.hypot(second.x - a!.x, second.y - a!.y));
});

test('curly arrows run from a lone pair or bond to an atom or bond, and species come together', async () => {
  const s = await readStructure('[OH-:1].[CH3:2][Br:3]');
  const L = s.style.bondLength;
  const { smilesAtomMaps } = await import('@hexsketch/core');
  const atom = (n: number) => s.mol.atom(smilesAtomMaps(s.mol).get(n)!);
  const steps = [{ from: [1], to: [1, 2] }, { from: [2, 3], to: [3] }];
  arrangeForArrows(s.mol, steps, L);
  // Hydroxide beside the carbon it attacks, on the side away from bromine.
  const [o, c, br] = [atom(1), atom(2), atom(3)];
  assert.ok(Math.hypot(o.x - c.x, o.y - c.y) < 2.2 * L);
  assert.ok((o.x - c.x) * (br.x - c.x) + (o.y - c.y) * (br.y - c.y) < 0);
  const arrows = electronArrows(s.mol, s.objects, s.style, steps);
  assert.equal(arrows.length, 2);
  const [attack, leave] = arrows as Extract<(typeof arrows)[number], { kind: 'arrow' }>[];
  const d = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
  // The attack leaves the hydroxide (just past its OH⁻ label) and ends at the carbon; the C–Br electrons end at bromine.
  assert.ok(d(attack!.tail, o) < 1.3 * L && d(attack!.head, c) < 0.8 * L);
  assert.ok(d(leave!.tail, { x: (c.x + br.x) / 2, y: (c.y + br.y) / 2 }) < 0.4 * L && d(leave!.head, br) < L);
  assert.equal(attack!.curve!.length, 4);
  // Fishhooks for single electrons; mistakes are explained.
  assert.equal((electronArrows(s.mol, [], s.style, [{ from: [2, 3], to: [3], electrons: 1 }])[0] as { headEnd: string }).headEnd, 'halfLeft');
  assert.throws(() => electronArrows(s.mol, [], s.style, [{ from: [1, 2], to: [2] }]), /not bonded/);
  assert.throws(() => electronArrows(s.mol, [], s.style, [{ from: [9], to: [2] }]), /no atom has map number 9/);
  const plain = await readStructure('CBr');
  assert.throws(() => electronArrows(plain.mol, [], plain.style, [{ from: [1], to: [2] }]), /atom-map numbers/);
});
