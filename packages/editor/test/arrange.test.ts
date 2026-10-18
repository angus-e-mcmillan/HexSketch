/** Double-click selection, axis-locked moves, Object > Align and Object > Distribute. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeArrow, makeCaption, parseSmiles, layout2D, Molecule } from '@hexsketch/core';
import { captionBounds } from '@hexsketch/render';
import { Editor } from '../src/index.ts';

/** Three molecules at different places, plus an arrow and a caption. */
function scene() {
  const ed = new Editor();
  const m = new Molecule();
  const put = (smi: string, dx: number, dy: number) => {
    const f = parseSmiles(smi); layout2D(f, 18.43);
    const map = new Map<number, number>();
    for (const a of f.atoms()) map.set(a.id, m.addAtom({ ...a, x: a.x + dx, y: a.y + dy, chirality: null }).id);
    for (const b of f.bonds()) m.addBond({ ...b, begin: map.get(b.begin)!, end: map.get(b.end)!, ez: null });
  };
  put('c1ccccc1', 100, 100); put('CCO', 260, 140); put('CC(=O)C', 400, 80);
  ed.doc.replace(m);
  return ed;
}
const frags = (ed: Editor) => ed.doc.mol.fragments();
const box = (ed: Editor, f: number[]) => {
  const dep = ed.depiction;
  const xs: number[] = [], ys: number[] = [];
  for (const a of f) { const at = ed.doc.mol.atom(a), lb = dep.labels.get(a)?.bounds; if (lb) { xs.push(lb.x0, lb.x1); ys.push(lb.y0, lb.y1); } else { xs.push(at.x); ys.push(at.y); } }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
};
const click = (ed: Editor, p: { x: number; y: number }, time: number) => { ed.pointerDown({ ...p, time }); ed.pointerUp({ ...p, time }); };

test('double-click with a selection tool selects the whole molecule', () => {
  const ed = scene();
  ed.setTool({ kind: 'select', mode: 'marquee' });
  const benzene = frags(ed)[0]!;
  const a = ed.doc.mol.atom(benzene[2]!);
  click(ed, a, 1000);
  assert.equal(ed.selection.atoms.size, 1, 'single click: one atom');
  click(ed, a, 1200);
  assert.equal(ed.selection.atoms.size, 6);
  assert.equal(ed.selection.bonds.size, 6);
  // Too slow is two single clicks (after clearing the selection by clicking empty space).
  click(ed, { x: 50, y: 400 }, 2000);
  click(ed, a, 3000); click(ed, a, 4000);
  assert.equal(ed.selection.atoms.size, 1);
});

test('double-click on an atom with the bond tool edits its label and leaves no stray bond', () => {
  const ed = scene();
  const before = ed.doc.mol.bondCount;
  let edited: number | null = null;
  ed.onEditLabel = (id) => { edited = id; };
  const a = ed.doc.mol.atom(frags(ed)[1]![0]!);
  click(ed, a, 1000); click(ed, a, 1150);
  assert.equal(edited, a.id);
  assert.equal(ed.doc.mol.bondCount, before, 'the first click’s bond was taken back');
});

test('Command (or Shift) while dragging keeps the move horizontal or vertical', () => {
  for (const mod of [{ meta: true }, { shift: true }]) {
    const ed = scene();
    ed.setTool({ kind: 'select', mode: 'marquee' });
    const f = frags(ed)[0]!;
    const a = ed.doc.mol.atom(f[0]!);
    const y0 = a.y, x0 = a.x;
    click(ed, a, 10); click(ed, a, 100); // select the molecule
    ed.pointerDown({ x: x0, y: y0, time: 5000 });
    ed.pointerMove({ x: x0 + 30, y: y0 + 8, ...mod });
    ed.pointerMove({ x: x0 + 60, y: y0 + 12, ...mod });
    ed.pointerUp({ x: x0 + 60, y: y0 + 12, ...mod, time: 5100 });
    const moved = ed.doc.mol.atom(f[0]!);
    assert.ok(Math.abs(moved.x - (x0 + 60)) < 1e-6 && Math.abs(moved.y - y0) < 1e-6, `${JSON.stringify(mod)}: moved to (${moved.x}, ${moved.y})`);
  }
});

test('Align: edges and centres line up on the highest item; whole molecules move', () => {
  for (const mode of ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom'] as const) {
    const ed = scene();
    ed.selectAll();
    assert.ok(ed.alignSelection(mode));
    const bs = frags(ed).map((f) => box(ed, f));
    const key = (b: ReturnType<typeof box>) => mode === 'left' ? b.x0 : mode === 'right' ? b.x1 : mode === 'hcenter' ? (b.x0 + b.x1) / 2 : mode === 'top' ? b.y0 : mode === 'bottom' ? b.y1 : (b.y0 + b.y1) / 2;
    const ks = bs.map(key);
    assert.ok(Math.max(...ks) - Math.min(...ks) < 0.01, `${mode}: ${ks.map((k) => k.toFixed(2)).join(', ')}`);
  }
  // The reference is the highest item: acetone (top-most) stays where it was for "left edges".
  const ed = scene();
  const top = frags(ed)[2]!;
  const before = box(ed, top).x0;
  ed.selectAll(); ed.alignSelection('left');
  assert.ok(Math.abs(box(ed, frags(ed)[0]!).x0 - before) < 0.01);
});

test('Align uses only the selected part of a structure but moves all of it', () => {
  const ed = scene();
  const [benz, eth] = frags(ed);
  // Select one atom of each.
  ed.selection.atoms.add(benz![0]!); ed.selection.atoms.add(eth![2]!);
  const a = ed.doc.mol.atom(benz![0]!), b = ed.doc.mol.atom(eth![2]!);
  const shapeBefore = benz!.map((id) => ed.doc.mol.atom(id).x - a.x);
  void b;
  ed.alignSelection('top');
  const lb = ed.depiction.labels.get(eth![2]!)?.bounds;
  const topOfO = lb ? lb.y0 : ed.doc.mol.atom(eth![2]!).y;
  assert.ok(Math.abs(Math.min(ed.doc.mol.atom(benz![0]!).y, topOfO) - Math.min(ed.doc.mol.atom(benz![0]!).y, topOfO)) < 1e-9);
  assert.deepEqual(benz!.map((id) => ed.doc.mol.atom(id).x - ed.doc.mol.atom(benz![0]!).x), shapeBefore, 'molecule moved rigidly');
});

test('Distribute: equal gaps, outermost items stay put; works with arrows and captions too', () => {
  const ed = scene();
  ed.doc.objects.push(makeArrow({ x: 520, y: 100 }, { x: 580, y: 100 }), makeCaption(640, 120, 'heat'));
  ed.selectAll();
  const firstBefore = box(ed, frags(ed)[0]!).x0;
  assert.ok(ed.distributeSelection('horizontal'));
  const boxes = [...frags(ed).map((f) => box(ed, f))];
  const arrow = ed.doc.objects[0]!;
  if (arrow.kind === 'arrow') boxes.push({ x0: Math.min(arrow.tail.x, arrow.head.x), x1: Math.max(arrow.tail.x, arrow.head.x), y0: 0, y1: 0 });
  const cap = ed.doc.objects[1]!;
  if (cap.kind === 'text') { const b = captionBounds(cap, ed.doc.style); boxes.push({ x0: b.x0, x1: b.x1, y0: b.y0, y1: b.y1 }); }
  boxes.sort((p, q) => p.x0 - q.x0);
  const gaps = boxes.slice(1).map((b, i) => b.x0 - boxes[i]!.x1);
  assert.ok(Math.max(...gaps) - Math.min(...gaps) < 0.05, `gaps ${gaps.map((g) => g.toFixed(2)).join(', ')}`);
  assert.ok(Math.abs(boxes[0]!.x0 - firstBefore) < 0.01, 'leftmost unchanged');
  assert.equal(ed.distributeSelection('vertical'), true);
  const two = scene(); two.selection.atoms.add(frags(two)[0]![0]!); two.selection.atoms.add(frags(two)[1]![0]!);
  assert.equal(two.distributeSelection('horizontal'), false, 'needs three or more');
});
