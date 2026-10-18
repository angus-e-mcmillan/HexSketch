/**
 * Interaction parity with ChemDraw 20.1. Each case replays a click sequence
 * performed on real ChemDraw (house style) and checks the editor produces the
 * coordinates ChemDraw wrote to its CDXML export, to 0.02 pt.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Editor } from '../src/index.ts';

const near = (a: number, b: number, tol = 0.02) => Math.abs(a - b) <= tol;
function hasAtomAt(ed: Editor, x: number, y: number) {
  return [...ed.doc.mol.atoms()].some((a) => near(a.x, x) && near(a.y, y));
}
function click(ed: Editor, x: number, y: number) {
  ed.pointerDown({ x, y });
  ed.pointerUp({ x, y });
}
function assertAtoms(ed: Editor, expected: [number, number][]) {
  for (const [x, y] of expected) assert.ok(hasAtomAt(ed, x, y), `expected an atom at (${x}, ${y}); have ${[...ed.doc.mol.atoms()].map((a) => `(${a.x.toFixed(2)},${a.y.toFixed(2)})`).join(' ')}`);
  assert.equal(ed.doc.mol.atomCount, expected.length);
}
const bondAt = (ed: Editor, x0: number, y0: number, x1: number, y1: number) =>
  [...ed.doc.mol.bonds()].find((b) => {
    const p = ed.doc.mol.atom(b.begin), q = ed.doc.mol.atom(b.end);
    return (near(p.x, x0) && near(p.y, y0) && near(q.x, x1) && near(q.y, y1)) || (near(p.x, x1) && near(p.y, y1) && near(q.x, x0) && near(q.y, y0));
  });

/** The chain experiment: E1..E6 from the notes. */
function chainEditor() {
  const ed = new Editor();
  click(ed, 482.5, 530.5);                         // E1: empty canvas
  click(ed, 498.46, 521.29);                       // E2: end atom
  click(ed, 498.46, 502.86);                       // E3: new end
  click(ed, 498.46, 521.29);                       // E4: middle atom (degree 2)
  click(ed, 498.46, 521.29);                       // E5: same atom (degree 3)
  click(ed, 482.5, 530.5);                         // E6: first bond's begin atom
  return ed;
}

test('bond tool clicks reproduce ChemDraw chain growth', () => {
  assertAtoms(chainEditor(), [
    [482.5, 530.5], [498.46, 521.29], [498.46, 502.86], [482.5, 493.65],
    [514.41, 530.5], [514.41, 512.07], [482.5, 548.93],
  ]);
});

test('clicking a bond: single -> double, then Left -> Center -> Right -> Left', () => {
  const ed = chainEditor();
  const b = bondAt(ed, 498.46, 502.86, 482.5, 493.65)!;
  const mid = { x: (498.46 + 482.5) / 2, y: (502.86 + 493.65) / 2 };
  click(ed, mid.x, mid.y);
  assert.equal(ed.doc.mol.bond(b.id).order, 2);
  const seen: string[] = [];
  for (let i = 0; i < 4; i++) { click(ed, mid.x, mid.y); seen.push(ed.doc.mol.bond(b.id).doubleBondPosition); }
  assert.deepEqual(seen, ['left', 'center', 'right', 'left']);
  assert.equal(ed.doc.mol.bond(b.id).order, 2, 'repeated clicks never make a triple bond');
});

test('benzene on empty canvas: centred on the click, vertex up, ChemDraw Kekule pattern', () => {
  const ed = new Editor();
  ed.setTool({ kind: 'ring', size: 6, aromatic: true });
  click(ed, 612.5, 555.5);
  const mol = ed.doc.mol;
  const angles = [...mol.atoms()].map((a) => Math.round((Math.atan2(a.y - 555.5, a.x - 612.5) * 180) / Math.PI)).sort((x, y) => x - y);
  assert.deepEqual(angles, [-150, -90, -30, 30, 90, 150]);
  const doubles = [...mol.bonds()].filter((b) => b.order === 2).map((b) => {
    const p = mol.atom(b.begin), q = mol.atom(b.end);
    return Math.round((Math.atan2((p.y + q.y) / 2 - 555.5, (p.x + q.x) / 2 - 612.5) * 180) / Math.PI);
  }).map((a) => (a === -180 ? 180 : a)).sort((x, y) => x - y);
  assert.deepEqual(doubles, [-60, 60, 180]);
});

test('ring on a terminal atom and fused on a bond land where ChemDraw puts them', () => {
  const ed = chainEditor();
  ed.setTool({ kind: 'ring', size: 6, aromatic: true });
  click(ed, 514.41, 512.07);                       // ring on terminal atom 557
  const before = ed.doc.mol.atomCount;
  click(ed, 482.5, (530.5 + 548.93) / 2);          // ring fused on bond 547-559
  assert.equal(ed.doc.mol.atomCount - before, 4, 'fusing a six-ring adds four atoms');
  const atoms = [...ed.doc.mol.atoms()];
  const ringCentre = (cx: number, cy: number, r: number) =>
    atoms.filter((a) => near(Math.hypot(a.x - cx, a.y - cy), r, 0.05)).length;
  assert.equal(ringCentre(530.37, 502.86, 18.43), 6, 'ring on atom centred one circumradius along the bond');
  assert.equal(ringCentre(466.54, 539.71, 18.43), 6, 'fused ring centred one inradius from the bond, away from substituents');
  const shared = bondAt(ed, 482.5, 530.5, 482.5, 548.93)!;
  assert.equal(ed.doc.mol.bond(shared.id).order, 2, 'shared bond becomes double in the Kekule pattern');
});

test('ChemDraw hotkeys act on the hovered atom and bond', () => {
  const ed = new Editor();
  click(ed, 100, 100);
  const end = [...ed.doc.mol.atoms()][1]!;
  ed.pointerMove({ x: end.x, y: end.y });
  assert.ok(ed.key('o'));
  assert.equal(ed.doc.mol.atom(end.id).element, 'O');
  assert.ok(ed.key('O'));
  assert.equal(ed.doc.mol.atom(end.id).label, 'OMe');
  ed.key('n');
  assert.equal(ed.doc.mol.atom(end.id).element, 'N');
  ed.key('+');
  assert.equal(ed.doc.mol.atom(end.id).charge, 1);

  const bond = [...ed.doc.mol.bonds()][0]!;
  const p = ed.doc.mol.atom(bond.begin), q = ed.doc.mol.atom(bond.end);
  ed.pointerMove({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
  ed.key('2');
  assert.equal(ed.doc.mol.bond(bond.id).order, 2);
  ed.key('3');
  assert.equal(ed.doc.mol.bond(bond.id).order, 3);
  ed.key('1'); ed.key('w');
  assert.equal(ed.doc.mol.bond(bond.id).display, 'wedgeBegin');

  // Over empty canvas, once the hotspot is dismissed, the same keys switch tools.
  ed.key('Escape');
  ed.pointerMove({ x: 400, y: 400 });
  ed.key('j');
  assert.deepEqual(ed.tool, { kind: 'ring', size: 6, aromatic: true });
  ed.key('x');
  assert.deepEqual(ed.tool, { kind: 'bond', bond: 'single' });
});

test('magic sprouts: 1 zigzags, 2 adds carbonyl on a secondary carbon, 3 adds phenyl', () => {
  const ed = new Editor();
  click(ed, 100, 100);
  const [a, b] = [...ed.doc.mol.atoms()];
  ed.pointerMove({ x: b!.x, y: b!.y });
  ed.key('1');
  const c = [...ed.doc.mol.atoms()].at(-1)!;
  // Linear mode keeps the chain trans: c lies on the opposite side of a->b from nothing, i.e. continues the zigzag down-right.
  assert.ok(near(c.y, a!.y, 0.05) && c.x > b!.x, `zigzag continuation, got (${c.x.toFixed(2)}, ${c.y.toFixed(2)})`);
  ed.pointerMove({ x: b!.x, y: b!.y });
  ed.key('2');
  const o = [...ed.doc.mol.atoms()].at(-1)!;
  assert.equal(o.element, 'O');
  assert.equal(ed.doc.mol.bondBetween(b!.id, o.id)!.order, 2);
  ed.pointerMove({ x: c.x, y: c.y });
  ed.key('3');
  const ringBonds = [...ed.doc.mol.bonds()].filter((x) => x.order === 2).length;
  assert.equal(ringBonds, 4, 'one C=O plus three Kekule double bonds in the phenyl');
});

test('undo and redo restore exact states', () => {
  const ed = new Editor();
  click(ed, 100, 100);
  click(ed, 200, 200);
  assert.equal(ed.doc.mol.atomCount, 4);
  ed.key('z', { meta: true });
  assert.equal(ed.doc.mol.atomCount, 2);
  ed.key('z', { meta: true, shift: true });
  assert.equal(ed.doc.mol.atomCount, 4);
});

test('Clean Up (Shift+Cmd+K) regularises geometry in place and keeps stereo', async () => {
  const { rsLabel, perceiveStereoFromGeometry } = await import('@hexsketch/core');
  const ed = new Editor();
  const mol = ed.doc.mol;
  // A sloppily drawn L-alanine: wedge to N, bonds of uneven length and angle.
  const ca = mol.addAtom({ element: 'C', x: 300, y: 300 });
  const n = mol.addAtom({ element: 'N', x: 303, y: 324 });
  const me = mol.addAtom({ element: 'C', x: 280, y: 288 });
  const c = mol.addAtom({ element: 'C', x: 318, y: 287 });
  const o1 = mol.addAtom({ element: 'O', x: 321, y: 268 });
  const o2 = mol.addAtom({ element: 'O', x: 337, y: 296 });
  mol.addBond({ begin: ca.id, end: n.id, display: 'wedgeBegin' });
  mol.addBond({ begin: ca.id, end: me.id });
  mol.addBond({ begin: ca.id, end: c.id });
  mol.addBond({ begin: c.id, end: o1.id, order: 2 });
  mol.addBond({ begin: c.id, end: o2.id });
  perceiveStereoFromGeometry(mol);
  assert.equal(rsLabel(mol, ca.id), 'S');
  const cx = [...mol.atoms()].reduce((s, a) => s + a.x, 0) / 6;

  ed.key('k', { meta: true, shift: true });
  const m2 = ed.doc.mol;
  for (const b of m2.bonds()) {
    const p = m2.atom(b.begin), q = m2.atom(b.end);
    assert.ok(Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - ed.L) < 0.05, 'standard bond length after clean up');
  }
  const cx2 = [...m2.atoms()].reduce((s, a) => s + a.x, 0) / 6;
  assert.ok(Math.abs(cx2 - cx) < 0.01, 'stays where it was');
  perceiveStereoFromGeometry(m2);
  assert.equal(rsLabel(m2, ca.id), 'S', 'still L-alanine');
  ed.key('z', { meta: true });
  assert.equal(ed.doc.mol.atom(n.id).x, 303, 'undo restores the original drawing');
});

test('arrow tool: drags snap to 15 degrees; text tool makes captions; both undo and delete', async () => {
  const ed = new Editor();
  ed.setTool({ kind: 'arrow', arrow: 'reaction' });
  ed.pointerDown({ x: 100, y: 100 });
  ed.pointerMove({ x: 150, y: 104 });
  ed.pointerMove({ x: 200, y: 108 });
  ed.pointerUp({ x: 200, y: 108 });
  const arrow = ed.doc.objects[0];
  assert.ok(arrow && arrow.kind === 'arrow');
  assert.ok(Math.abs(arrow.head.y - 100) < 1e-9, 'a nearly horizontal drag snaps to horizontal');
  assert.ok(Math.abs(Math.hypot(arrow.head.x - 100, arrow.head.y - 100) - Math.hypot(100, 8)) < 1e-9, 'length follows the drag');

  ed.setTool({ kind: 'text' });
  let editing: number | null = null;
  ed.onEditCaption = (id) => { editing = id; };
  ed.pointerDown({ x: 120, y: 80 });
  ed.pointerUp({ x: 120, y: 80 });
  assert.ok(editing !== null, 'clicking empty canvas with the text tool opens a caption');
  ed.setCaption(editing!, 'Ac2O, pyridine');
  const cap = ed.doc.objects.find((o) => o.kind === 'text');
  assert.equal(cap && cap.kind === 'text' ? cap.text : null, 'Ac2O, pyridine');

  ed.key('z', { meta: true });
  assert.equal(ed.doc.objects.filter((o) => o.kind === 'text').length, 0, 'undo removes the caption');
  ed.key('z', { meta: true, shift: true });
  ed.selectAll();
  ed.key('Delete');
  assert.equal(ed.doc.objects.length, 0, 'select all + delete removes arrows and captions');
});

test('CDXML and alt-text payload carry arrows and captions', async () => {
  const { writeCdxml, readCdxmlObjects, makeArrow, makeCaption, Molecule, encodePayload, decodePayload, DEFAULT_STYLE } = await import('@hexsketch/core');
  const objects = [makeArrow({ x: 10, y: 20 }, { x: 80, y: 20 }, 'equilibrium'), makeCaption(15, 12, 'heat, 2 h')];
  const xml = writeCdxml(new Molecule(), DEFAULT_STYLE, objects);
  const back = readCdxmlObjects(xml);
  assert.equal(back.length, 2);
  const a = back.find((o) => o.kind === 'arrow');
  assert.ok(a && a.kind === 'arrow' && a.headEnd === 'halfLeft' && a.shaftSpacing === 400 && a.head.x === 80);
  const c = back.find((o) => o.kind === 'text');
  assert.equal(c && c.kind === 'text' ? c.text : '', 'heat, 2 h');
  const decoded = await decodePayload(await encodePayload(new Molecule(), DEFAULT_STYLE, objects));
  assert.equal(decoded?.objects.length, 2);
});

/** L-alanine drawn ChemDraw's way, wedge to NH2. */
function alanineEditor() {
  const ed = new Editor();
  const m = ed.doc.mol, L = ed.L;
  const ca = m.addAtom({ element: 'C', x: 300, y: 300 });
  const n = m.addAtom({ element: 'N', x: 300, y: 300 + L });
  const me = m.addAtom({ element: 'C', x: 300 - 0.866 * L, y: 300 - 0.5 * L });
  const c = m.addAtom({ element: 'C', x: 300 + 0.866 * L, y: 300 - 0.5 * L });
  const o1 = m.addAtom({ element: 'O', x: 300 + 0.866 * L, y: 300 - 1.5 * L });
  const o2 = m.addAtom({ element: 'O', x: 300 + 1.732 * L, y: 300 });
  m.addBond({ begin: ca.id, end: n.id, display: 'wedgeBegin' });
  m.addBond({ begin: ca.id, end: me.id });
  m.addBond({ begin: ca.id, end: c.id });
  m.addBond({ begin: c.id, end: o1.id, order: 2 });
  m.addBond({ begin: c.id, end: o2.id });
  return { ed, ca: ca.id };
}

test('Rotate 180 (Shift+Cmd+H/V) keeps stereo; Flip inverts it; Option+arrows rotate', async () => {
  const { perceiveStereoFromGeometry, rsLabel } = await import('@hexsketch/core');
  const label = (ed: Editor, id: number) => { perceiveStereoFromGeometry(ed.doc.mol); return rsLabel(ed.doc.mol, id); };
  for (const combo of ['h', 'v']) {
    const { ed, ca } = alanineEditor();
    ed.key(combo, { meta: true, shift: true });
    assert.equal(label(ed, ca), 'S', `Rotate 180 ${combo} keeps L-alanine`);
  }
  const f = alanineEditor();
  f.ed.flip('horizontal');
  assert.equal(label(f.ed, f.ca), 'R', 'a mirror image is D-alanine');

  const r = alanineEditor();
  const before = [...r.ed.doc.mol.bonds()].map((b) => { const p = r.ed.doc.mol.atom(b.begin), q = r.ed.doc.mol.atom(b.end); return Math.hypot(p.x - q.x, p.y - q.y); });
  r.ed.key('ArrowUp', { alt: true });
  const after = [...r.ed.doc.mol.bonds()].map((b) => { const p = r.ed.doc.mol.atom(b.begin), q = r.ed.doc.mol.atom(b.end); return Math.hypot(p.x - q.x, p.y - q.y); });
  after.forEach((d, i) => assert.ok(Math.abs(d - before[i]!) < 1e-9, 'rotation keeps bond lengths'));
  const n = r.ed.doc.mol.atom(r.ca + 1);
  assert.ok(n.x > 300, 'Option+Up turns counter-clockwise, swinging the NH2 below toward the right');
  assert.equal(label(r.ed, r.ca), 'S', 'rotation keeps stereo');
});

test('arrow keys nudge the selection; Cmd+E toggles fixed angles for drags', () => {
  const ed = new Editor();
  ed.pointerDown({ x: 100, y: 100 }); ed.pointerUp({ x: 100, y: 100 });
  ed.selectAll();
  const x0 = [...ed.doc.mol.atoms()][0]!.x;
  ed.key('ArrowRight');
  ed.key('ArrowRight', { shift: true });
  assert.ok(Math.abs([...ed.doc.mol.atoms()][0]!.x - (x0 + 11)) < 1e-9, '1 pt, then 10 pt with Shift');

  const ed2 = new Editor();
  ed2.key('e', { meta: true });
  assert.equal(ed2.fixedAngles, false);
  ed2.pointerDown({ x: 100, y: 100 }); ed2.pointerMove({ x: 120, y: 107 }); ed2.pointerUp({ x: 120, y: 107 });
  const [a, b] = [...ed2.doc.mol.atoms()];
  const angle = Math.atan2(b!.y - a!.y, b!.x - a!.x) * 180 / Math.PI;
  assert.ok(Math.abs(angle - Math.atan2(7, 20) * 180 / Math.PI) < 1e-6, `free angle when Fixed Angles is off (${angle.toFixed(1)})`);
});

test('Convert Structure to Name (Option+Cmd+N) puts the name under the structure', async () => {
  const { nameMolecule } = await import('@hexsketch/naming');
  const { ed } = alanineEditor();
  ed.nameOf = (m) => nameMolecule(m).name;
  ed.key('n', { meta: true, alt: true });
  const cap = ed.doc.objects.find((o) => o.kind === 'text');
  assert.ok(cap && cap.kind === 'text');
  assert.equal(cap.text, '(S)-2-aminopropanoic acid');
  const maxY = Math.max(...[...ed.doc.mol.atoms()].map((a) => a.y));
  assert.ok(cap.y > maxY, 'caption sits below the structure');
});
