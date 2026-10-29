/**
 * Peptides in three-letter code: parsing, properties, Expand Label and
 * recognition of the expanded structure, checked against OPSIN where it can
 * read the names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMass, makeCaption, parsePeptide, parseSmiles, peptideMolecule, peptideName, recognisePeptide, sameStructure } from '@hexsketch/core';
import { nameMolecule } from '@hexsketch/naming';
import { captionBounds } from '@hexsketch/render';
import { opsinAvailable, opsinToSmiles } from '../../naming/src/opsin.ts';
import { Editor } from '../src/index.ts';

test('parsing: termini optional, D-, N-methyl and side-chain protection; plain words are not peptides', () => {
  assert.deepEqual(parsePeptide('H-Ala-Gly-OH')!.residues.map((r) => r.code), ['Ala', 'Gly']);
  const p = parsePeptide('Ac-D-Lys(Boc)-MeLeu-Asp(OtBu)-NH2')!;
  assert.equal(p.nTerm, 'Ac');
  assert.equal(p.cTerm, 'NH2');
  assert.deepEqual(p.residues.map((r) => [r.code, r.d, r.nMe, r.protection]), [['Lys', true, false, 'Boc'], ['Leu', false, true, null], ['Asp', false, false, 'tBu']]);
  assert.equal(parsePeptide('Ala-Gly')!.nTerm, 'H', 'termini default to H- and -OH');
  for (const bad of ['Ala', 'H-Xyz-OH', 'H-Lys(Foo)-OH', 'H-Gly(Boc)-OH', 'Boc-OMe', 'heat, 2 h', 'H-Ala--Gly-OH']) assert.equal(parsePeptide(bad), null, bad);
});

test('formula and mass of written peptides', () => {
  // A lone atom carrying the sequence as its label, as typed with the text tool on an atom.
  const f = (t: string) => { const m = parseSmiles('C'); [...m.atoms()][0]!.label = t; return computeMass(m).formula; };
  assert.equal(f('H-Ala-Gly-OH'), 'C5H10N2O3');
  assert.equal(f('H-Asp-Phe-OMe'), 'C14H18N2O5', 'aspartame');
  assert.equal(f('Fmoc-Lys(Boc)-OH'), 'C26H32N2O6');
  assert.equal(f('H-Arg(Pbf)-OH'), 'C19H30N4O5S');
  assert.equal(f('H-Cys-Tyr-Ile-Gln-Asn-Cys-Pro-Leu-Gly-NH2'), 'C43H68N12O12S2', 'oxytocin, reduced');
  const ed = new Editor();
  ed.doc.objects.push(makeCaption(100, 100, 'H-Ala-Gly-OH'));
  assert.equal(ed.mass?.formula, 'C5H10N2O3', 'a caption in three-letter code is analysed');
  assert.ok(Math.abs(ed.mass!.molecularWeight - 146.146) < 0.01);
  assert.equal(nameMolecule(ed.analysisMolecule()).name, 'L-alanylglycine');
});

test('Expand Label: caption becomes the structure, which is named back from its wedges (L and D)', () => {
  for (const [text, name] of [['H-Ala-Gly-OH', 'L-alanylglycine'], ['H-D-Ala-Phe-OH', 'D-alanyl-L-phenylalanine'], ['Ac-Lys-Pro-NH2', 'N-acetyl-L-lysyl-L-prolinamide'], ['H-Thr-D-Ile-OH', 'L-threonyl-D-isoleucine']] as const) {
    const ed = new Editor();
    ed.doc.objects.push(makeCaption(100, 100, text));
    assert.equal(ed.expandLabels(), 1);
    assert.equal(ed.doc.objects.length, 0, 'caption replaced');
    assert.ok(sameStructure(ed.doc.mol, parseSmiles(peptideMoleculeSmiles(text))));
    assert.equal(nameMolecule(ed.doc.mol).name, name, text);
  }
});

test('Expand Label on atoms: a lone peptide label, and abbreviations drawn out in place', () => {
  const ed = new Editor();
  ed.pointerDown({ x: 100, y: 100 }); ed.pointerUp({ x: 100, y: 100 });
  const [, end] = [...ed.doc.mol.atoms()];
  ed.pointerMove(end!); ed.key('P');
  assert.equal(ed.doc.mol.atom(end!.id).label, 'Ph');
  ed.pointerMove({ x: 500, y: 500 });
  ed.doc.edit((m) => { m.addAtom({ element: 'C', x: 300, y: 300, label: 'Boc-Gly-OMe' }); });
  assert.equal(ed.expandLabels(), 2);
  assert.ok(sameStructure(ed.doc.mol, parseSmiles('Cc1ccccc1.COC(=O)CNC(=O)OC(C)(C)C')));
  // A protected peptide gets a systematic name when the namer has one (OPSIN can check it), else its sequence.
  assert.equal(nameMolecule(ed.doc.mol).name, 'toluene · methyl 2-((tert-butoxycarbonyl)amino)acetate');
});

test('recognition finds the sequence of a drawn peptide and refuses lookalikes', () => {
  const p = recognisePeptide(parseSmiles('CC(=O)N[C@@H](CCCCNC(=O)OC(C)(C)C)C(=O)N1CCC[C@H]1C(=O)OC'))!;
  assert.ok(p);
  assert.equal(p.nTerm, 'Ac'); assert.equal(p.cTerm, 'OMe');
  assert.deepEqual(p.residues.map((r) => `${r.d ? 'D-' : ''}${r.code}${r.protection ? `(${r.protection})` : ''}`), ['Lys(Boc)', 'Pro']);
  assert.equal(recognisePeptide(parseSmiles('CC(=O)NCCC(=O)O')), null, 'not built from known residues');
  assert.equal(recognisePeptide(parseSmiles('N[C@@H]([C@H](C)O)C(=O)O')), null, 'allo-threonine is not threonine');
  // Drawn by hand with wedges at Ca only: Ile's side-chain centre is unknown, so is its configuration.
  const partly = recognisePeptide(parseSmiles('N[C@@H](C)C(=O)N[C@@H](C(C)CC)C(=O)O'))!;
  assert.deepEqual(partly.residues.map((r) => [r.code, !!r.stereoUnknown]), [['Ala', false], ['Ile', true]]);
  // OPSIN reads "isoleucine" as L-isoleucine, so the name is the systematic one, citing only what was drawn.
  assert.equal(peptideName(partly), null);
  assert.equal(nameMolecule(parseSmiles('N[C@@H](C)C(=O)N[C@@H](C(C)CC)C(=O)O')).name, '(S)-2-(((S)-2-aminopropanoyl)amino)-3-methylpentanoic acid');
});

test('expanded peptides have no overlapping atoms (prolines kink the chain)', () => {
  for (const t of ['H-Ala-Gly-Phe-Lys-Leu-OH', 'Boc-Lys(Z)-Pro-D-Ala-Ser(tBu)-OMe', 'Fmoc-Trp-Hyp-Ile-Thr-NH2', 'H-pGlu-His-Pro-NH2', 'H-Pro-Pro-Pro-Pro-OH', 'Fmoc-Cys(Trt)-Arg(Pbf)-His(Trt)-OH']) {
    const L = 18.43;
    const m = peptideMolecule(parsePeptide(t)!, L);
    const atoms = [...m.atoms()];
    let worst = Infinity;
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
      if (m.bondBetween(atoms[i]!.id, atoms[j]!.id)) continue;
      worst = Math.min(worst, Math.hypot(atoms[i]!.x - atoms[j]!.x, atoms[i]!.y - atoms[j]!.y));
    }
    assert.ok(worst > 0.55 * L, `${t}: closest non-bonded atoms ${(worst / L).toFixed(2)} L`);
  }
});

test('peptide names parse back (OPSIN) to the same structure', { skip: !opsinAvailable() && 'OPSIN/Java not available' }, () => {
  const texts = ['H-Ala-Gly-Phe-OH', 'Ac-Lys-Pro-NH2', 'H-Trp-D-Leu-Thr-OH', 'H-Asp-Phe-OMe', 'H-Gly-Ser-Glu-OH', 'H-Cys-Tyr-Ile-Gln-Asn-Cys-Pro-Leu-Gly-NH2', 'H-Sar-Nle-Orn-OH'];
  const names = texts.map((t) => peptideName(parsePeptide(t)!)!);
  const back = opsinToSmiles(names);
  texts.forEach((t, i) => assert.ok(back[i] && sameStructure(parseSmiles(back[i]!), parseSmiles(peptideMoleculeSmiles(t))), `${t} -> ${names[i]} -> ${back[i]}`));
});

/** Worst bond-length error and closest non-bonded pair, both in bond lengths. */
function quality(m: Molecule, L: number) {
  let bond = 0, close = Infinity;
  for (const b of m.bonds()) bond = Math.max(bond, Math.abs(Math.hypot(m.atom(b.begin).x - m.atom(b.end).x, m.atom(b.begin).y - m.atom(b.end).y) - L) / L);
  const atoms = [...m.atoms()];
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    if (!m.bondBetween(atoms[i]!.id, atoms[j]!.id)) close = Math.min(close, Math.hypot(atoms[i]!.x - atoms[j]!.x, atoms[i]!.y - atoms[j]!.y) / L);
  }
  return { bond, close };
}

const LONG = ['H-Ala-Gly-Phe-OH', 'Boc-Lys(Z)-Pro-D-Ala-Ser(tBu)-Phe-Leu-OMe', 'H-Cys-Tyr-Ile-Gln-Asn-Cys-Pro-Leu-Gly-NH2', 'H-Tyr-Gly-Gly-Phe-Met-Arg-Arg-Val-Arg-Pro-Lys-Leu-Lys-Trp-Asp-OH'];

test('Clean Up leaves an expanded peptide where it is and tidies a hand-drawn one without folding it', () => {
  const L = 18.43;
  for (const t of LONG) {
    const m = peptideMolecule(parsePeptide(t)!, L);
    const tidy = m.clone();
    cleanUpStructure(tidy, L);
    let moved = 0;
    for (const a of m.atoms()) moved = Math.max(moved, Math.hypot(a.x - tidy.atom(a.id).x, a.y - tidy.atom(a.id).y) / L);
    assert.ok(moved < 2, `${t}: Clean Up of the expanded drawing moved an atom ${moved.toFixed(2)} L`);
    // Wobbled as by hand: lengths and angles off by up to 40%.
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
    const drawn = m.clone();
    for (const a of drawn.atoms()) { a.x += rnd() * 0.4 * L; a.y += rnd() * 0.4 * L; }
    const before = [...drawn.atoms()].map((a) => ({ x: a.x, y: a.y }));
    cleanUpStructure(drawn, L);
    const q = quality(drawn, L);
    assert.ok(q.bond < 0.03, `${t}: bond off by ${(q.bond * 100).toFixed(1)}%`);
    assert.ok(q.close > 0.55, `${t}: non-bonded atoms ${q.close.toFixed(2)} L apart`);
    const drift = [...drawn.atoms()].reduce((s, a, i) => s + Math.hypot(a.x - before[i]!.x, a.y - before[i]!.y), 0) / drawn.atomCount / L;
    assert.ok(drift < 0.6, `${t}: atoms moved ${drift.toFixed(2)} L on average (orientation lost?)`);
    assert.equal(nameMolecule(drawn).name, nameMolecule(m).name, `${t}: stereochemistry kept`);
  }
});

test('Clean Up redraws a tangled peptide as its backbone zigzag', () => {
  const L = 18.43;
  const m = peptideMolecule(parsePeptide('H-Cys-Tyr-Ile-Gln-Asn-Cys-Pro-Leu-Gly-NH2')!, L);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  for (const a of m.atoms()) { a.x = 100 + rnd() * 8 * L; a.y = 100 + rnd() * 8 * L; }
  for (const b of m.bonds()) b.display = 'plain';
  cleanUpStructure(m, L);
  const q = quality(m, L);
  assert.ok(q.bond < 0.03 && q.close > 0.55, `bond ${(q.bond * 100).toFixed(1)}%, closest ${q.close.toFixed(2)} L`);
});

test('recognition gives up quickly on a near miss among symmetric protecting groups', () => {
  // allo-Thr (not Thr) with three Trt groups: every phenyl flip used to be tried, freezing the page.
  const smi = peptideSmiles(parsePeptide('Boc-Ser(tBu)-Cys(Trt)-His(Trt)-Asn(Trt)-Thr(tBu)-OtBu')!).replace('[C@@H](C)O', '[C@H](C)O');
  const t0 = performance.now();
  assert.equal(recognisePeptide(parseSmiles(smi)), null);
  assert.ok(performance.now() - t0 < 1000, `took ${(performance.now() - t0).toFixed(0)} ms`);
});

test('a pasted peptide is drawn as its zigzag and lands on the page', () => {
  const ed = new Editor();
  const text = 'H-Tyr-Gly-Gly-Phe-Met-Arg-Arg-Val-Arg-Pro-Lys-Leu-Lys-Trp-Asp-OH';
  ed.insertLaidOut(parseSmiles(peptideMoleculeSmiles(text)), { x: 100, y: 100 });
  const q = quality(ed.doc.mol, ed.L);
  assert.ok(q.close > 0.55, `closest ${q.close.toFixed(2)} L`);
  assert.ok([...ed.doc.mol.atoms()].every((a) => a.x > 0 && a.y > 0), 'nothing above or left of the page');
  assert.equal(nameMolecule(ed.doc.mol).name, peptideName(parsePeptide(text)!));
  // Expand Label near the corner of the page, on a caption and on an atom label.
  for (const kind of ['caption', 'atom'] as const) {
    const e2 = new Editor();
    if (kind === 'caption') e2.doc.objects.push(makeCaption(5, 5, text));
    else e2.doc.edit((m) => { m.addAtom({ element: 'C', x: 5, y: 5, label: text }); });
    assert.equal(e2.expandLabels(), 1);
    assert.ok([...e2.doc.mol.atoms()].every((a) => a.x > 0 && a.y > 0), `${kind}: nothing above or left of the page`);
  }
});

test("a peptide's long name stays on the page", () => {
  const ed = new Editor();
  ed.nameOf = (m) => nameMolecule(m).name;
  ed.doc.objects.push(makeCaption(5, 60, 'Boc-Lys(Z)-Pro-D-Ala-Ile-OMe'));
  assert.equal(ed.expandLabels(), 1);
  ed.hover = { kind: 'atom', id: [...ed.doc.mol.atoms()][0]!.id };
  assert.ok(ed.toggleAnalysis('name'));
  const c = ed.doc.objects.find((o): o is Caption => o.kind === 'text' && !!o.analysis)!;
  assert.match(c.text, /^methyl \(2S,3S\)-2-\(\(\(R\)-2-/);
  assert.ok(captionBounds(c, ed.doc.style).x0 >= 0, 'name starts on the page');
});

test('a peptide typed as an atom label is analysed, named and expands', () => {
  const ed = new Editor();
  ed.doc.edit((m) => { m.addAtom({ element: 'C', x: 200, y: 200 }); });
  const id = [...ed.doc.mol.atoms()][0]!.id;
  ed.setLabel(id, 'Ac-Lys-Pro-NH2');
  assert.equal(ed.doc.mol.atom(id).label, 'Ac-Lys-Pro-NH2');
  assert.equal(ed.mass?.formula, 'C13H24N4O3');
  assert.equal(nameMolecule(ed.doc.mol).name, 'N-acetyl-L-lysyl-L-prolinamide');
  ed.hover = { kind: 'atom', id };
  assert.equal(ed.expandLabels(), 1);
  assert.equal(ed.mass?.formula, 'C13H24N4O3');
  assert.equal(nameMolecule(ed.doc.mol).name, 'N-acetyl-L-lysyl-L-prolinamide');
});

import { cleanUpStructure, peptideSmiles, type Caption, type Molecule } from '@hexsketch/core';
function peptideMoleculeSmiles(t: string) { return peptideSmiles(parsePeptide(t)!); }
