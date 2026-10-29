import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync, crc32 } from 'node:zlib';
import { computeMass, payloadFromPng, decodePayload, parsePattern, parseSmiles, substructureMatches, sameStructure, substructureMappings, writeMolfile, writeCdxml, layout2D, DEFAULT_STYLE } from '@hexsketch/core';
import { alignByMaps, analyze, PROTECTING_GROUPS, arrangeForArrows, disconnectionMarks, highlighted, highlightPlaces, imbalance, schemeBalance, compare, convert, detectFormat, electronArrows, labelPlaces, link, name, orientLike, placeLabels, readStructure, render, scheme, validate } from '../src/index.ts';

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

test('a retrosynthesis is one drawing: the analysis, then the forward route below it', async () => {
  const r = {
    stages: ['CC(=O)[NH:1][c:2]1ccccc1', 'CC(=O)Cl.Nc1ccccc1'],
    arrows: [{ type: 'retrosynthetic' as const }],
    then: [{ stages: ['CC(=O)Cl.Nc1ccccc1', 'CC(=O)Nc1ccccc1'], arrows: [{ reagents: 'Et3N', conditions: 'CH2Cl2, 0 °C' }] }],
  };
  const s = await scheme(r);
  const arrows = s.objects.filter((o) => o.kind === 'arrow') as { tail: { x: number; y: number }; head: { x: number; y: number } }[];
  // Two arrows, one per scheme, the second on a row below the first; nothing joins the two schemes.
  assert.equal(arrows.length, 2);
  assert.ok(arrows[1]!.tail.y > arrows[0]!.tail.y);
  assert.equal(s.mol.fragments().length, 6);
  // The forward route starts at the left again, below the target, with no arrow into it.
  const left = (f: number) => Math.min(...s.mol.fragments()[f]!.map((id) => s.mol.atom(id).x));
  assert.ok(Math.abs(left(3) - left(0)) < s.style.bondLength);
  // Only the forward arrow is checked for balance (HCl is not drawn), and reported against its scheme.
  assert.deepEqual((await schemeBalance(r)).map((b) => [b.scheme, b.step]), [[2, 1]]);
  await assert.rejects(scheme({ stages: ['CCO', 'CC=O'], then: [{ stages: ['CC=O'] }] }), /Scheme 2: A scheme needs at least two stages/);
});

test('a peptide from SMILES is drawn N to C, backbone flat, wedges on the side chains', async () => {
  // Leu-enkephalin written from the C-terminus: drawn from the N-terminus all the same.
  const s = await readStructure('CC(C)C[C@H](NC(=O)[C@H](Cc1ccccc1)NC(=O)CNC(=O)CNC(=O)[C@@H](N)Cc1ccc(O)cc1)C(=O)O');
  const L = s.style.bondLength, atoms = [...s.mol.atoms()];
  const amine = atoms.find((a) => a.element === 'N' && s.mol.neighbours(a.id).length === 1)!;
  const acid = atoms.find((a) => a.element === 'C' && s.mol.neighbours(a.id).filter((n) => s.mol.atom(n).element === 'O').length === 2)!;
  assert.ok(amine.x < acid.x - 10 * L);
  // The amide nitrogens lie on one line, give or take the zigzag.
  const amides = atoms.filter((a) => a.element === 'N' && s.mol.neighbours(a.id).length === 2).map((a) => a.y);
  assert.ok(Math.max(...amides) - Math.min(...amides) < L);
  // Every wedge leaves its stereocentre for a side chain, not for the backbone's N or C=O.
  const wedges = [...s.mol.bonds()].filter((b) => b.display !== 'plain');
  assert.equal(wedges.length, 3);
  for (const b of wedges) {
    const centre = s.mol.atom(b.display.endsWith('Begin') ? b.begin : b.end), other = s.mol.atom(b.display.endsWith('Begin') ? b.end : b.begin);
    assert.equal(centre.chirality !== null, true);
    assert.equal(other.element, 'C');
    assert.ok(!s.mol.neighbours(other.id).some((n) => s.mol.atom(n).element === 'O' && s.mol.bondBetween(other.id, n)!.order === 2));
  }
  assert.equal((await analyze(s)).formula, 'C28H37N5O7');
  // Matched to a drawing the other way round, it still runs N to C.
  const flipped = s.mol.clone();
  for (const a of flipped.atoms()) a.x = -a.x;
  const again = await readStructure('CC(C)C[C@H](NC(=O)[C@H](Cc1ccccc1)NC(=O)CNC(=O)CNC(=O)[C@@H](N)Cc1ccc(O)cc1)C(=O)O');
  orientLike(again, flipped);
  const n2 = [...again.mol.atoms()].find((a) => a.element === 'N' && again.mol.neighbours(a.id).length === 1)!;
  assert.ok(n2.x < Math.min(...[...again.mol.atoms()].map((a) => a.x)) + 3 * L);
});

test('a highlight marks one place: where it fits best, the one asked for, or every one', async () => {
  const s = await readStructure('CC(=O)Oc1ccccc1C(=O)O');
  // "C(=O)O" is in the ester and the acid; it fits the acid, with nothing on its O.
  const places = highlightPlaces(s.mol, 'C(=O)O');
  assert.equal(places.length, 2);
  const [best] = highlighted(s.mol, { smiles: 'C(=O)O' });
  assert.equal(best!.atoms.length, 3);
  assert.ok(best!.atoms.some((id) => s.mol.atom(id).element === 'O' && s.mol.neighbours(id).length === 1 && s.mol.bondBetween(id, s.mol.neighbours(id)[0]!)!.order === 1));
  // Occurrences count left to right.
  const x = (p: { atoms: number[] }[]) => Math.min(...p[0]!.atoms.map((id) => s.mol.atom(id).x));
  assert.ok(x(highlighted(s.mol, { smiles: 'C(=O)O', occurrence: 1 })) < x(highlighted(s.mol, { smiles: 'C(=O)O', occurrence: 2 })));
  assert.equal(highlighted(s.mol, { smiles: 'C(=O)O', every: true }).length, 2);
  assert.equal(highlighted(s.mol, { smiles: 'C(=O)O', occurrence: 3 }).length, 0);
  // A residue: Phe, not the Tyr whose ring the pattern also matches.
  const enk = await readStructure('N[C@@H](Cc1ccc(O)cc1)C(=O)NCC(=O)NCC(=O)N[C@@H](Cc1ccccc1)C(=O)N[C@@H](CC(C)C)C(=O)O');
  const [phe] = highlighted(enk.mol, { smiles: 'NC(Cc1ccccc1)C(=O)' });
  const phenol = [...enk.mol.atoms()].find((a) => a.element === 'O' && enk.mol.neighbours(a.id).length === 1 && enk.mol.atom(enk.mol.neighbours(a.id)[0]!).element === 'C' && enk.mol.neighbours(enk.mol.neighbours(a.id)[0]!).length === 3)!;
  assert.ok(!phe!.atoms.includes(enk.mol.neighbours(phenol.id)[0]!));
});

test('protecting groups are drawn as their abbreviations, and read in full', async () => {
  // Boc-Phe-OBn: Boc and Bn abbreviated; Phe's own benzyl stays drawn out.
  const smiles = 'CC(C)(C)OC(=O)N[C@@H](Cc1ccccc1)C(=O)OCc1ccccc1';
  const s = await readStructure(smiles, { abbreviate: true });
  assert.deepEqual([...s.mol.atoms()].filter((a) => a.label).map((a) => a.label).sort(), ['Bn', 'Boc']);
  assert.equal([...s.mol.atoms()].filter((a) => !a.label && a.element === 'C').length, 9);
  // Names, formulas and SMILES see every atom.
  const full = await readStructure(smiles);
  assert.equal((await analyze(s)).formula, (await analyze(full)).formula);
  assert.equal((await compare(s, full)).same, true);
  assert.equal(computeMass(s.mol).formula, computeMass(full.mol).formula);
  // Through CDXML (how a drawing reaches the editor) the labels stay.
  const back = await readStructure(await convert(s, 'cdxml'));
  assert.deepEqual([...back.mol.atoms()].filter((a) => a.label).map((a) => a.label).sort(), ['Bn', 'Boc']);
  // Only when asked; and never over atom-map numbers a mechanism's arrows may need.
  assert.equal([...full.mol.atoms()].some((a) => a.label), false);
  const mapped = await readStructure('CC(C)(C)OC(=O)[NH:1]C.[C:2](C)(C)(C)O', { abbreviate: true });
  assert.equal([...mapped.mol.atoms()].filter((a) => a.label).length, 1);
  // N-benzyl (a drug's, say) and a TBS chloride reagent stay drawn out.
  for (const x of ['CN(C)Cc1ccccc1', 'Cl[Si](C)(C)C(C)(C)C']) assert.equal([...(await readStructure(x, { abbreviate: true })).mol.atoms()].some((a) => a.label), false);
  // Every group, on each atom it protects: abbreviated, with the formula and structure it stands for.
  for (const g of PROTECTING_GROUPS) {
    for (const on of g.on) {
      const smi = `CC${on === 'N' ? 'N' : on}${g.smiles}`;
      const a = await readStructure(smi, { abbreviate: true }), b = await readStructure(smi);
      assert.deepEqual([...a.mol.atoms()].filter((x) => x.label).map((x) => x.label), [g.label], `${g.label} on ${on}`);
      assert.equal(computeMass(a.mol).formula, computeMass(b.mol).formula, `${g.label} formula`);
      assert.equal((await compare(a, b)).same, true, `${g.label} expands`);
    }
  }
});

test('scheme arrows stay a usual length: long text wraps, centred on the shaft', async () => {
  const s = await scheme({ stages: ['CCO', 'CC=O'], arrows: [{ reagents: 'Et2NH (3 equiv), KI (cat.), K2CO3', conditions: 'toluene, reflux, 4 h, then aqueous workup\n80%' }] });
  const L = s.style.bondLength;
  const arrow = s.objects.find((o) => o.kind === 'arrow') as { tail: { x: number }; head: { x: number } };
  assert.ok(arrow.head.x - arrow.tail.x <= 6 * L + 1e-6);
  const texts = s.objects.filter((o) => o.kind === 'text') as { x: number; text: string }[];
  assert.ok(texts[0]!.text.split('\n').length >= 2);
  // Bracketed amounts stay whole.
  assert.ok(texts[0]!.text.split('\n').some((l) => l.includes('(3 equiv)')));
  // Left of the arrow's middle, by half the head.
  for (const t of texts) assert.ok(t.x < (arrow.tail.x + arrow.head.x) / 2 && t.x > (arrow.tail.x + arrow.head.x) / 2 - L);
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

test('a mechanism step keeps its atoms where the step before had them', async () => {
  const { smilesAtomMaps } = await import('@hexsketch/core');
  const before = await readStructure('C[C:2]([OH:1])([O-:3])[O:4]C');
  const after = await readStructure('C[C:2](=[O:3])[OH:1].[O-:4]C');
  const L = after.style.bondLength;
  assert.equal(alignByMaps(after.mol, before.mol, L), true);
  const at = (s: typeof before, n: number) => s.mol.atom(smilesAtomMaps(s.mol).get(n)!);
  // The reacting carbon stays exactly put; its neighbours move only as far as the new geometry needs.
  const moved = (n: number) => Math.hypot(at(after, n).x - at(before, n).x, at(after, n).y - at(before, n).y);
  assert.ok(moved(2) < 0.01 * L);
  for (const n of [1, 3]) assert.ok(moved(n) < 0.6 * L, `atom ${n} stays near`);
  // The methoxide that left sits clear of the acid, not on top of where it was bonded.
  const gap = Math.min(...[1, 2, 3].map((n) => Math.hypot(at(after, n).x - at(after, 4).x, at(after, n).y - at(after, 4).y)));
  assert.ok(gap >= 1.5 * L - 0.01);
  // Moved whole: every bond keeps its length.
  for (const b of after.mol.bonds()) {
    const p = after.mol.atom(b.begin), q = after.mol.atom(b.end);
    assert.ok(Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - L) < 0.01 * L);
  }
  assert.equal(alignByMaps(after.mol, (await readStructure('CCO')).mol, L), false);
});

test('retrosynthesis: disconnections are marked across their bonds, and steps are balanced', async () => {
  const s = await readStructure('c1ccccc1[C:1](=O)[NH:2]C');
  const [mark] = disconnectionMarks(s.mol, s.style, [[1, 2]]);
  assert.ok(mark?.kind === 'shape' && mark.line === 'wavy');
  assert.throws(() => disconnectionMarks(s.mol, s.style, [[2, 9]]), /no atom has map number 9/);
  const plain = (await readStructure('CCO')).mol;
  assert.throws(() => disconnectionMarks(plain, s.style, [[1, 2]]), /map numbers/);
  // Fischer esterification balances with its water, and says so when the water is left out.
  assert.deepEqual(await schemeBalance({ stages: ['CC(=O)O.OC', 'CC(=O)OC.O'] }), []);
  assert.deepEqual(await schemeBalance({ stages: ['CC(=O)O.OC', 'CC(=O)OC'] }), [{ step: 1, unbalanced: 'H2O on the left is not on the right' }]);
  assert.deepEqual(await schemeBalance({ stages: ['CC(=O)O', 'CCO'], arrows: [{ type: 'retrosynthetic' }] }), []);
  const x = imbalance((await readStructure('[OH-].CBr')).mol, (await readStructure('CO')).mol);
  assert.deepEqual(x, { lost: 'Br', gained: '', charge: 1 });
});
