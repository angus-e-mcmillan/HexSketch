/** Option+drag duplicates; Option+double-click picks up a copy that a click puts down; Drawing Settings styles. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layout2D, makeArrow, Molecule, parseSmiles, ACS_1996_STYLE, DEFAULT_PALETTE, HEXSKETCH_STYLE, PALETTES, paletteId } from '@hexsketch/core';
import { Editor } from '../src/index.ts';

function scene() {
  const ed = new Editor();
  const m = new Molecule();
  const f = parseSmiles('c1ccccc1'); layout2D(f, ed.L);
  const map = new Map<number, number>();
  for (const a of f.atoms()) map.set(a.id, m.addAtom({ ...a, x: a.x + 100, y: a.y + 100, chirality: null }).id);
  for (const b of f.bonds()) m.addBond({ ...b, begin: map.get(b.begin)!, end: map.get(b.end)!, ez: null });
  const arrow = makeArrow({ x: 170, y: 100 }, { x: 250, y: 100 });
  ed.doc.replace(m, [arrow]);
  ed.tool = { kind: 'select', mode: 'marquee' };
  return { ed, arrow };
}
const atom0 = (ed: Editor) => [...ed.doc.mol.atoms()][0]!;

test('Option+drag leaves the original and drops a copy where the drag ends', () => {
  const { ed } = scene();
  const a = atom0(ed), x0 = a.x, y0 = a.y;
  // Option+drag copies what is selected: here the whole ring.
  ed.selectStructureAt({ kind: 'atom', id: a.id });
  ed.pointerDown({ x: a.x, y: a.y, alt: true, time: 0 });
  ed.pointerMove({ x: a.x + 30, y: a.y, alt: true, time: 10 });
  assert.match(ed.render().svg, /opacity="0.45"/, 'a faint copy follows the pointer');
  ed.pointerMove({ x: a.x + 60, y: a.y + 20, alt: true, time: 15 });
  ed.pointerUp({ x: a.x + 60, y: a.y + 20, alt: true, time: 20 });
  assert.equal(ed.doc.mol.atomCount, 12);
  assert.equal(ed.doc.mol.fragments().length, 2);
  const orig = ed.doc.mol.atom(a.id);
  assert.deepEqual([orig.x, orig.y], [x0, y0], 'original untouched');
  // The copy is selected, 60 right and 20 down.
  assert.equal(ed.selection.atoms.size, 6);
  assert.ok(!ed.selection.atoms.has(a.id));
  const copy = [...ed.selection.atoms].map((id) => ed.doc.mol.atom(id));
  assert.ok(copy.some((c) => Math.abs(c.x - (x0 + 60)) < 1e-6 && Math.abs(c.y - (y0 + 20)) < 1e-6));
  ed.doc.undo();
  assert.equal(ed.doc.mol.atomCount, 6);
});

test('Option+double-click picks up a copy; a click puts it down; Option+click puts down several; Esc stops', () => {
  const { ed } = scene();
  const a = atom0(ed);
  const click = (x: number, y: number, t: number, alt = true) => { ed.pointerDown({ x, y, alt, time: t }); ed.pointerUp({ x, y, alt, time: t + 5 }); };
  click(a.x, a.y, 1000);
  click(a.x, a.y, 1100);
  assert.equal(ed.placingCopy, true);
  assert.equal(ed.doc.mol.atomCount, 6, 'nothing added yet');
  ed.pointerMove({ x: a.x + 100, y: a.y + 100 });
  assert.match(ed.render().svg, /translate\(100 100\)" opacity="0.45"/);
  // Option+click: one copy down, still carrying.
  ed.pointerDown({ x: a.x + 100, y: a.y + 100, alt: true, time: 3000 });
  ed.pointerUp({ x: a.x + 100, y: a.y + 100, alt: true, time: 3005 });
  assert.equal(ed.doc.mol.atomCount, 12);
  assert.equal(ed.placingCopy, true);
  // Plain click: the last copy, and done.
  ed.pointerMove({ x: a.x + 200, y: a.y });
  ed.pointerDown({ x: a.x + 200, y: a.y, time: 5000 });
  ed.pointerUp({ x: a.x + 200, y: a.y, time: 5005 });
  assert.equal(ed.doc.mol.atomCount, 18);
  assert.equal(ed.placingCopy, false);
  assert.equal(ed.doc.mol.fragments().length, 3);
  // Escape drops a picked-up copy without adding anything.
  click(a.x, a.y, 9000);
  click(a.x, a.y, 9100);
  assert.equal(ed.placingCopy, true);
  ed.key('Escape');
  assert.equal(ed.placingCopy, false);
  ed.pointerDown({ x: 400, y: 400, time: 12000 });
  ed.pointerUp({ x: 400, y: 400, time: 12005 });
  assert.equal(ed.doc.mol.atomCount, 18);
});

test('picking up works on objects and whole groups, with any tool', () => {
  const { ed, arrow } = scene();
  // Group the benzene with the arrow: picking up the arrow brings the benzene.
  ed.selectAll();
  ed.groupSelection();
  ed.clearSelection();
  ed.setTool({ kind: 'bond', bond: 'single' });
  const click = (x: number, y: number, t: number) => { ed.pointerDown({ x, y, alt: true, time: t }); ed.pointerUp({ x, y, alt: true, time: t + 5 }); };
  click(190, 100, 1000);
  click(190, 100, 1100);
  assert.equal(ed.placingCopy, true);
  ed.pointerDown({ x: 190, y: 300, time: 2000 });
  ed.pointerUp({ x: 190, y: 300, time: 2005 });
  assert.equal(ed.doc.objects.filter((o) => o.kind === 'arrow').length, 2);
  assert.equal(ed.doc.mol.atomCount, 12);
  assert.equal(ed.doc.groups.length, 2, 'the copy is a group of its own');
  assert.ok(ed.doc.objects.some((o) => o.kind === 'arrow' && o.id !== arrow.id && Math.abs(o.tail.y - 300) < 1e-6));
});

test('Drawing Settings: a new style scales the drawing to its bond length; undo brings both back', () => {
  const { ed } = scene();
  const xs = () => [...ed.doc.mol.atoms()].map((a) => a.x);
  const width = () => Math.max(...xs()) - Math.min(...xs());
  const w0 = width(), L0 = ed.doc.style.bondLength;
  ed.setStyle({ ...ACS_1996_STYLE, palette: ed.doc.style.palette });
  assert.equal(ed.doc.style.bondLength, 14.4);
  assert.ok(Math.abs(width() - w0 * 14.4 / L0) < 1e-6);
  ed.doc.undo();
  assert.equal(ed.doc.style.bondLength, L0);
  assert.ok(Math.abs(width() - w0) < 1e-6);
  // Leaving structures as drawn.
  ed.setStyle({ ...ed.doc.style, lineWidth: 1 }, { rescale: false });
  assert.equal(ed.doc.style.lineWidth, 1);
  assert.ok(Math.abs(width() - w0) < 1e-6);
});

test('the default palette is HexSketch’s own; the others stay selectable', () => {
  assert.equal(DEFAULT_PALETTE[0], '#e4e9f3');
  assert.equal(DEFAULT_PALETTE.at(-1), '#555785');
  assert.equal(new Set(DEFAULT_PALETTE).size, DEFAULT_PALETTE.length);
  assert.equal(paletteId(HEXSKETCH_STYLE), 'hexsketch');
  assert.deepEqual(PALETTES.map((p) => p.id), ['hexsketch', 'muted']);
});
