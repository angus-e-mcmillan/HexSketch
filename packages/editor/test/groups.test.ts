/** Object > Group (Cmd+G) and Ungroup (Shift+Cmd+G), as in ChemDraw. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodePayload, encodePayload, layout2D, makeArrow, Molecule, parseSmiles, readCdxmlDocument, writeCdxml, DEFAULT_STYLE } from '@hexsketch/core';
import { Editor } from '../src/index.ts';

/** Two molecules and an arrow between them. */
function scene() {
  const ed = new Editor();
  const m = new Molecule();
  const put = (smi: string, dx: number) => {
    const f = parseSmiles(smi); layout2D(f, ed.L);
    const map = new Map<number, number>();
    for (const a of f.atoms()) map.set(a.id, m.addAtom({ ...a, x: a.x + dx, y: a.y + 100, chirality: null }).id);
    for (const b of f.bonds()) m.addBond({ ...b, begin: map.get(b.begin)!, end: map.get(b.end)!, ez: null });
  };
  put('c1ccccc1', 100); put('CCO', 300);
  const arrow = makeArrow({ x: 170, y: 100 }, { x: 250, y: 100 });
  ed.doc.replace(m, [arrow]);
  ed.tool = { kind: 'select', mode: 'marquee' };
  return { ed, arrow };
}
const frags = (ed: Editor) => ed.doc.mol.fragments();
const click = (ed: Editor, x: number, y: number) => { ed.pointerDown({ x, y }); ed.pointerUp({ x, y }); };
const selectFrag = (ed: Editor, i: number) => { ed.clearSelection(); for (const a of frags(ed)[i]!) ed.selection.atoms.add(a); };

test('Cmd+G groups the selection; clicking any part selects the whole group', () => {
  const { ed, arrow } = scene();
  selectFrag(ed, 0);
  ed.selection.objects.add(arrow.id);
  assert.equal(ed.key('g', { meta: true }), true);
  assert.equal(ed.doc.groups.length, 1);
  ed.clearSelection();
  // Click an atom of the benzene: the arrow comes too, the ethanol does not.
  const a = ed.doc.mol.atom(frags(ed)[0]![0]!);
  click(ed, a.x, a.y);
  assert.ok(ed.selection.objects.has(arrow.id));
  assert.equal(ed.selection.atoms.size, 6);
  // Click the arrow: the benzene comes too.
  ed.clearSelection();
  click(ed, 190, 100);
  assert.equal(ed.selection.atoms.size, 6);
});

test('a grouped structure moves as one and stays grouped when drawn onto', () => {
  const { ed, arrow } = scene();
  selectFrag(ed, 0); ed.selection.objects.add(arrow.id);
  ed.groupSelection();
  ed.clearSelection();
  const a = ed.doc.mol.atom(frags(ed)[0]![0]!);
  click(ed, a.x, a.y);
  const x0 = arrow.tail.x;
  ed.key('ArrowRight', {});
  assert.ok(ed.doc.objects.find((o) => o.id === arrow.id)!.kind === 'arrow');
  const moved = ed.doc.objects.find((o) => o.id === arrow.id)!;
  assert.ok(moved.kind === 'arrow' && moved.tail.x > x0, 'arrow moved with the benzene');
  // Add a methyl to the benzene: the new atom belongs to the group as well.
  const ring = frags(ed).find((f) => f.length === 6)!;
  ed.doc.edit((mol) => { const at = mol.atom(ring[0]!); const c = mol.addAtom({ element: 'C', x: at.x, y: at.y - 20 }); mol.addBond({ begin: at.id, end: c.id, order: 1 }); });
  ed.clearSelection();
  const r = ed.doc.mol.atom(ring[1]!);
  click(ed, r.x, r.y);
  assert.equal(ed.selection.atoms.size, 7);
});

test('Shift+Cmd+G ungroups; undo brings the group back; deleting members dissolves it', () => {
  const { ed, arrow } = scene();
  selectFrag(ed, 0); ed.selection.objects.add(arrow.id);
  ed.groupSelection();
  assert.equal(ed.key('G', { meta: true, shift: true }), true);
  assert.equal(ed.doc.groups.length, 0);
  ed.doc.undo();
  assert.equal(ed.doc.groups.length, 1);
  // Delete the arrow: one thing left, so no group.
  ed.doc.edit((_, objects) => { objects.splice(objects.findIndex((o) => o.id === arrow.id), 1); });
  assert.equal(ed.doc.groups.length, 0);
});

test('one thing alone is not a group', () => {
  const { ed } = scene();
  selectFrag(ed, 0);
  assert.equal(ed.groupSelection(), false);
  assert.equal(ed.doc.groups.length, 0);
});

test('CDXML: groups are written as <group> and read back (files and pictures)', async () => {
  const { ed, arrow } = scene();
  selectFrag(ed, 0); ed.selection.objects.add(arrow.id);
  ed.groupSelection();
  const xml = writeCdxml(ed.doc.mol, DEFAULT_STYLE, ed.doc.objects, { groups: ed.doc.groups });
  assert.equal((xml.match(/<group /g) ?? []).length, 1);
  // The group holds the benzene fragment and the arrow, not the ethanol.
  const inner = xml.slice(xml.indexOf('<group '), xml.indexOf('</group>'));
  assert.equal((inner.match(/<fragment /g) ?? []).length, 1);
  assert.match(inner, /<arrow /);
  const back = readCdxmlDocument(xml);
  assert.equal(back.groups.length, 1);
  assert.equal(back.groups[0]!.objects.length, 1);
  assert.equal(new Set(back.groups[0]!.atoms.map((a) => back.mol.fragments().findIndex((f) => f.includes(a)))).size, 1);
  const p = await decodePayload(await encodePayload(ed.doc.mol, DEFAULT_STYLE, ed.doc.objects, ed.doc.groups));
  assert.equal(p?.groups.length, 1);
});

test('groups nest: grouping a group keeps it inside; Ungroup removes one level at a time', () => {
  const { ed, arrow } = scene();
  selectFrag(ed, 0); ed.selection.objects.add(arrow.id);
  ed.groupSelection(); // inner: benzene + arrow
  ed.selectAll();
  assert.equal(ed.key('g', { meta: true }), true); // outer: inner group + ethanol
  assert.equal(ed.doc.groups.length, 2);
  const outer = ed.doc.groups.find((g) => g.groups.length === 1)!;
  assert.equal(outer.atoms.length, 1, 'ethanol directly in the outer group');
  // Clicking the ethanol selects everything.
  ed.clearSelection();
  const eth = ed.doc.mol.atom(frags(ed)[1]![0]!);
  click(ed, eth.x, eth.y);
  assert.equal(ed.selection.atoms.size, 9);
  assert.ok(ed.selection.objects.has(arrow.id));
  // One Ungroup: the inner group is a group of its own again.
  ed.ungroupSelection();
  assert.equal(ed.doc.groups.length, 1);
  ed.clearSelection();
  click(ed, eth.x, eth.y);
  assert.equal(ed.selection.atoms.size, 1, 'ethanol is ungrouped: a click selects just the atom');
  ed.clearSelection();
  const a = ed.doc.mol.atom(frags(ed)[0]![0]!);
  click(ed, a.x, a.y);
  assert.equal(ed.selection.atoms.size, 6);
  assert.ok(ed.selection.objects.has(arrow.id), 'benzene and arrow still grouped');
});

test('a nested group left alone in its parent dissolves the parent, not itself', () => {
  const { ed, arrow } = scene();
  selectFrag(ed, 0); ed.selection.objects.add(arrow.id);
  ed.groupSelection();
  ed.selectAll();
  ed.groupSelection();
  // Delete the ethanol: the outer group holds only the inner group, so it goes.
  ed.doc.edit((mol) => { for (const id of frags(ed)[1]!) mol.removeAtom(id); });
  assert.equal(ed.doc.groups.length, 1);
  assert.equal(ed.doc.groups[0]!.objects[0], arrow.id);
});

test('CDXML: nested groups are written nested and read back with their parent', () => {
  const { ed, arrow } = scene();
  selectFrag(ed, 0); ed.selection.objects.add(arrow.id);
  ed.groupSelection();
  ed.selectAll();
  ed.groupSelection();
  const xml = writeCdxml(ed.doc.mol, DEFAULT_STYLE, ed.doc.objects, { groups: ed.doc.groups });
  const tags = (xml.match(/<\/?group\b/g) ?? []).join(' ');
  assert.equal(tags, '<group <group </group </group');
  const back = readCdxmlDocument(xml);
  assert.equal(back.groups.length, 2);
  const outer = back.groups.find((g) => g.groups.length === 1)!, inner = back.groups.find((g) => g.id === outer.groups[0])!;
  assert.equal(inner.objects.length, 1);
  assert.equal(outer.objects.length, 0);
  assert.equal(outer.atoms.length > 0 && inner.atoms.length > 0, true);
});
