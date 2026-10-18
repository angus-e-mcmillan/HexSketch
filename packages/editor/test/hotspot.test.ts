/**
 * Magic hotkeys and the hotspot, checked against ChemDraw's Atom Hotkeys help
 * page and its Magic Hotkeys Cheat Sheet (Help > Shortcuts and Hotkeys),
 * including the two worked key sequences printed on the sheet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles, sameStructure } from '@hexsketch/core';
import { Editor, ringOnAtom } from '../src/index.ts';
import type { AtomId, Molecule } from '@hexsketch/core';

const ringOnAtomForTest = (mol: Molecule, atom: AtomId) => ringOnAtom(mol, atom, 6, true, 18.43);

const same = (ed: Editor, smiles: string) => sameStructure(ed.doc.mol, parseSmiles(smiles));
const AWAY = { x: 900, y: 900 };
/** Read through a function so TypeScript does not narrow across key presses. */
const spotKind = (ed: Editor) => ed.hotspot?.kind;

/** One bond drawn by clicking empty canvas; returns its two atoms. */
function bond(ed: Editor) {
  ed.pointerDown({ x: 100, y: 100 }); ed.pointerUp({ x: 100, y: 100 });
  return [...ed.doc.mol.atoms()];
}
/** Type keys with the mouse off the molecule; arrows written as in the cheat sheet. */
function type(ed: Editor, keys: string) {
  ed.pointerMove(AWAY);
  const arrows: Record<string, string> = { '←': 'ArrowLeft', '→': 'ArrowRight', '↑': 'ArrowUp', '↓': 'ArrowDown' };
  for (const k of keys) ed.key(arrows[k] ?? k);
}
function hoverKey(ed: Editor, atom: { x: number; y: number }, key: string) {
  ed.pointerMove(atom); ed.key(key);
}

test('2 on a chain end makes that carbon the C=O of an acetyl (no extra carbon)', () => {
  const ed = new Editor();
  const [, end] = bond(ed);
  hoverKey(ed, end!, '2');
  assert.ok(same(ed, 'CC(C)=O'), 'acetone, not butanone');
  assert.equal(ed.doc.mol.atom(end!.id).element, 'C');
  assert.equal(ed.doc.mol.incidentBonds(end!.id).filter((b) => ed.doc.mol.bond(b).order === 2).length, 1, 'C=O sits on the hovered carbon');
});

test('2 on a secondary carbon puts C=O on it; on an aromatic carbon a C-C then acetyl', () => {
  const ed = new Editor();
  const [, end] = bond(ed);
  hoverKey(ed, end!, '1');
  hoverKey(ed, end!, '2');
  assert.ok(same(ed, 'CC(C)=O'));

  const ar = new Editor();
  ar.setTool({ kind: 'ring', size: 6, aromatic: true });
  ar.pointerDown({ x: 200, y: 200 }); ar.pointerUp({ x: 200, y: 200 });
  hoverKey(ar, [...ar.doc.mol.atoms()][0]!, '2');
  assert.ok(same(ar, 'CC(=O)c1ccccc1'), 'acetophenone: the new carbon becomes the C=O');
});

test('3 on a chain end makes it the ipso carbon of a phenyl; on a ring carbon a C-C first', () => {
  const ed = new Editor();
  const [, end] = bond(ed);
  hoverKey(ed, end!, '3');
  assert.ok(same(ed, 'Cc1ccccc1'), 'toluene, not ethylbenzene');

  const sec = new Editor();
  const [, e2] = bond(sec);
  hoverKey(sec, e2!, '1');
  hoverKey(sec, e2!, '3');
  assert.ok(same(sec, 'CC(C)c1ccccc1'), 'cumene: the new carbon is the ipso carbon');
});

test('6/7/v/u build the ring on a chain end, spiro on a secondary carbon', () => {
  for (const [key, primary, spiro] of [['6', 'CC1CCCCC1', 'CC1(C)CCCCC1'], ['7', 'CC1CCCC1', 'CC1(C)CCCC1'], ['v', 'CC1CC1', 'CC1(C)CC1'], ['u', 'CC1CCC1', 'CC1(C)CCC1']] as const) {
    const ed = new Editor();
    const [, end] = bond(ed);
    hoverKey(ed, end!, key);
    assert.ok(same(ed, primary), `${key} on a chain end`);
    const sp = new Editor();
    const [, e2] = bond(sp);
    hoverKey(sp, e2!, '1');
    hoverKey(sp, e2!, key);
    assert.ok(same(sp, spiro), `${key} on a secondary carbon`);
  }
});

/** Hover an atom or bond, then move the mouse off the molecule: it stays the hotspot. */
function setHotspot(ed: Editor, at: { x: number; y: number }) {
  ed.pointerMove(at); ed.pointerMove(AWAY);
}

test('hovering sets the hotspot; keys typed over it leave it there, keys typed away move it on', () => {
  const ed = new Editor();
  const [, end] = bond(ed);
  hoverKey(ed, end!, '1');
  ed.pointerMove(AWAY);
  assert.deepEqual(ed.hotspot, { kind: 'atom', id: end!.id }, 'key typed while hovering: hotspot stays on the hovered atom');
  type(ed, '11o');
  assert.ok(same(ed, 'CC(C)CO'), 'both later keys build from the hovered atom, then on along the new chain');
  assert.ok(ed.render().svg.includes('class="hotspot"'), 'green dot drawn');
  const spot = ed.hotspot!;
  ed.key('x');
  assert.ok(spot.kind === 'atom' && [ed.doc.mol.atom(spot.id).element, ed.doc.mol.atom(spot.id).label].includes('X'), 'x labels the hotspot atom (measured), it does not switch tools');
  ed.key('z', { meta: true });
  ed.key('Escape');
  assert.equal(ed.hotspot, null);
  ed.key('x');
  assert.deepEqual(ed.tool, { kind: 'bond', bond: 'single' }, 'with no hotspot keys switch tools again');
});

test('arrows step atom -> bond -> atom and always move (measured on PhBpin in ChemDraw)', () => {
  const ed = new Editor();
  ed.setTool({ kind: 'ring', size: 6, aromatic: true });
  ed.pointerDown({ x: 200, y: 200 }); ed.pointerUp({ x: 200, y: 200 });
  ed.setTool({ kind: 'bond', bond: 'single' });
  const atoms = [...ed.doc.mol.atoms()];
  const upperRight = atoms.filter((a) => a.x > 200 + 1).reduce((p, q) => (q.y < p.y ? q : p));
  setHotspot(ed, upperRight);
  type(ed, '1B79');
  assert.equal(spotKind(ed), 'atom');
  type(ed, '←');
  assert.equal(spotKind(ed), 'bond', 'first step lands on a bond');
  type(ed, '←←←o');
  assert.ok(same(ed, 'CC1(C)CCB(c2ccccc2)O1'), 'O lands next to B, as in ChemDraw');
  const o = ed.hotspot!;
  type(ed, '↓');
  assert.equal(spotKind(ed), 'bond');
  type(ed, '↓');
  assert.deepEqual(ed.hotspot, o, 'Down from the B-O bond goes back to O: nothing lies below');
});

test('cheat sheet: H2N-C then 42n152o←←←←↓↓1P gives Ala-Phe (replayed in ChemDraw)', () => {
  const ed = new Editor();
  const [start, end] = bond(ed);
  hoverKey(ed, start!, 'n');
  setHotspot(ed, end!);
  type(ed, '42n152o←←←←↓↓1P');
  const mol = ed.doc.mol;
  const ph = [...mol.atoms()].find((a) => a.label === 'Ph');
  assert.ok(ph, 'Ph placed on the side-chain carbon');
  // Expand Ph into a ring to check the whole skeleton.
  const full = mol.clone();
  full.atom(ph!.id).label = null;
  ringOnAtomForTest(full, ph!.id);
  assert.ok(sameStructure(full, parseSmiles('CC(N)C(=O)NC(Cc1ccccc1)C(=O)O')), 'Ala-Phe skeleton');
});

test('cheat sheet: bond then 6↑↑←2←←↓6↓2→→→2→↑↑4 gives the Wieland-Miescher ketone (replayed in ChemDraw)', () => {
  const ed = new Editor();
  ed.pointerDown({ x: 200, y: 240 }); ed.pointerMove({ x: 200, y: 215 }); ed.pointerMove({ x: 200, y: 200 }); ed.pointerUp({ x: 200, y: 200 });
  const b = [...ed.doc.mol.bonds()][0]!;
  const p = ed.doc.mol.atom(b.begin), q = ed.doc.mol.atom(b.end);
  assert.ok(Math.abs(p.x - q.x) < 0.01, 'vertical bond');
  setHotspot(ed, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  assert.equal(spotKind(ed), 'bond');
  type(ed, '6↑↑←2←←↓6↓2→→→2→↑↑4');
  assert.ok(same(ed, 'CC12CCC(=O)C=C1CCCC2=O'), 'Wieland-Miescher ketone');
});
