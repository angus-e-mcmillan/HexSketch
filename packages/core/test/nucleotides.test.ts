import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutAsOligo, oligoMolecule, oligoSmiles, oligoText, parseOligo, recogniseOligo } from '../src/nucleotides.ts';
import { sequenceCounts, sequenceMolecule, isSequence } from '../src/sequences.ts';
import { parseSmiles } from '../src/smiles.ts';
import { sameStereoisomer, sameStructure } from '../src/isomorphism.ts';
import { computeMass } from '../src/formula.ts';
import { layout2D } from '../src/layout.ts';

const L = 18.43;

test('oligonucleotide sequences: what is read, and what is left as plain text', () => {
  const text = (s: string) => { const o = parseOligo(s); return o ? oligoText(o) : null; };
  assert.equal(text("5'-ACGT-3'"), "5'-d(ACGT)-3'");
  assert.equal(text('d(GATC)'), "5'-d(GATC)-3'");
  assert.equal(text('r(ACGU)'), "5'-r(ACGU)-3'");
  assert.equal(text("5'-AUGC-3'"), "5'-r(AUGC)-3'", 'U and no T: RNA');
  assert.equal(text("5′-pTT-3′"), "5'-pd(TT)-3'", 'typographic primes, 5′-phosphate');
  assert.equal(text("5'-TTp-3'"), "5'-d(TT)p-3'");
  assert.equal(text("5'-mA*mC*dG*dT-3'"), "5'-mA*mC*dG*dT-3'");
  assert.equal(text("5'-A-C-G-T-3'"), "5'-d(ACGT)-3'");
  // No ends and no d( ) or r( ): a word, not a sequence. An unknown letter or a dangling link: not one either.
  for (const s of ['ACGT', 'CAT', 'd(AXG)', "5'-ACGT", "5'-AC*-3'", 'TAG-3\'', 'H-Ala-Gly-OH']) assert.equal(parseOligo(s), null, s);
  assert.ok(isSequence('H-Ala-Gly-OH') && isSequence('d(AT)') && !isSequence('ACGT'));
});

test('an oligonucleotide is built as the natural stereoisomer', () => {
  // Reference structures written independently (as OPSIN gives them for these names).
  const same = (seq: string, smiles: string) => assert.ok(sameStereoisomer(parseSmiles(oligoSmiles(parseOligo(seq)!)), parseSmiles(smiles)), seq);
  same('d(T)', '[C@@H]1(C[C@H](O)[C@@H](CO)O1)N1C(=O)NC(=O)C(C)=C1'); // thymidine
  same('d(G)', '[C@@H]1(C[C@H](O)[C@@H](CO)O1)N1C=NC=2C(=O)NC(N)=NC12'); // 2'-deoxyguanosine
  same('r(C)', '[C@@H]1([C@H](O)[C@H](O)[C@@H](CO)O1)N1C(=O)N=C(N)C=C1'); // cytidine
  same("5'-mU-3'", 'CO[C@H]1[C@@H](O[C@@H]([C@H]1O)CO)N1C(=O)NC(=O)C=C1'); // 2'-O-methyluridine
  same("5'-fU-3'", 'F[C@H]1[C@@H](O[C@@H]([C@H]1O)CO)N1C(=O)NC(=O)C=C1'); // 2'-deoxy-2'-fluorouridine
  same('d(TT)', '[C@@H]1(C[C@H](OP(=O)(O)OC[C@@H]2[C@H](C[C@@H](O2)N2C(=O)NC(=O)C(C)=C2)O)[C@@H](CO)O1)N1C(=O)NC(=O)C(C)=C1'); // thymidylyl-(3'->5')-thymidine
  same('r(AU)', '[C@@H]1([C@H](O)[C@H](OP(=O)(O)OC[C@@H]2[C@H]([C@H]([C@@H](O2)N2C(=O)NC(=O)C=C2)O)O)[C@@H](CO)O1)N1C=NC=2C(N)=NC=NC12'); // adenylyl-(3'->5')-uridine
  assert.equal(computeMass(parseSmiles(oligoSmiles(parseOligo("5'-ACGT-3'")!))).formula, 'C39H50N15O22P3');
  assert.deepEqual([...sequenceCounts('d(TT)')!].sort().join(' '), 'C,20 H,27 N,4 O,12 P,1');
});

test('an oligonucleotide is drawn as a strand: standard bonds, nothing overlapping, wedges that mean what was built', () => {
  for (const seq of ["5'-ACGT-3'", 'r(ACGU)', "5'-pTT-3'", "5'-TTp-3'", "5'-mG*mC*dA*dT-3'", "5'-fUfC-3'", "5'-GATTACAGATTACA-3'"]) {
    const o = parseOligo(seq)!;
    const mol = oligoMolecule(o, L);
    for (const b of mol.bonds()) {
      const d = Math.hypot(mol.atom(b.begin).x - mol.atom(b.end).x, mol.atom(b.begin).y - mol.atom(b.end).y);
      assert.ok(Math.abs(d - L) < 0.05, `${seq}: bond length ${d}`);
    }
    const at = [...mol.atoms()];
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) {
      assert.ok(Math.hypot(at[i]!.x - at[j]!.x, at[i]!.y - at[j]!.y) > 0.7 * L, `${seq}: atoms ${i} and ${j} too close`);
    }
    // 5' end at the top: each sugar below the one before.
    assert.ok(at[at.length - 1]!.y > at[0]!.y, seq);
    assert.ok(sameStereoisomer(mol, parseSmiles(oligoSmiles(o)), { recorded: [false, true] }), `${seq}: drawn configuration`);
    const back = recogniseOligo(mol);
    assert.equal(back && oligoText(back), oligoText(o), seq);
  }
  assert.ok(sameStructure(sequenceMolecule('d(AT)', L)!, parseSmiles(oligoSmiles(parseOligo('d(AT)')!))));
});

test('a structure that is an oligonucleotide is laid out as a strand, and others are left alone', () => {
  const mol = parseSmiles(oligoSmiles(parseOligo('d(GATC)')!));
  layout2D(mol, L);
  assert.ok(layoutAsOligo(mol, L));
  assert.ok(sameStereoisomer(mol, oligoMolecule(parseOligo('d(GATC)')!, L)));
  const ys = [...mol.atoms()].map((a) => a.y), xs = [...mol.atoms()].map((a) => a.x);
  assert.ok(Math.max(...ys) - Math.min(...ys) > 2 * (Math.max(...xs) - Math.min(...xs)), 'taller than wide');
  for (const s of ['OC[C@H]1O[C@@H](N2C=CC(=O)NC2=O)C[C@@H]1O', 'CCO', 'c1ccccc1', 'OCC1OC(N)CC1O', 'N[C@@H](C)C(=O)NCC(=O)O']) {
    const other = parseSmiles(s);
    assert.equal(layoutAsOligo(other, L), false, s);
  }
});
