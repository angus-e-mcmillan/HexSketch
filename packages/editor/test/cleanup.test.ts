/**
 * Clean Up keeps orientation while fixing lengths,
 * angles and rings, unlike ChemDraw 20.1, which on the same input turns
 * fragments and mirrored salicylic acid (fixtures exported from ChemDraw).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cleanUpStructure, ezLabel, Molecule, parseSmiles, layout2D, perceiveStereoFromGeometry, readCdxml, readCdxmlObjects, rsLabel } from '@hexsketch/core';
import { Editor } from '../src/index.ts';

const FIX = new URL('../../../tools/visual/fixtures/', import.meta.url);
const L = 18.4;

function geometry(m: Molecule) {
  const lengths = [...m.bonds()].map((b) => Math.hypot(m.atom(b.begin).x - m.atom(b.end).x, m.atom(b.begin).y - m.atom(b.end).y));
  const angles: number[] = [];
  for (const a of m.atoms()) {
    const nb = m.neighbours(a.id);
    const ang = nb.map((n) => Math.atan2(m.atom(n).y - a.y, m.atom(n).x - a.x)).sort((x, y) => x - y);
    ang.forEach((t, i) => { let g = (i + 1 < ang.length ? ang[i + 1]! : ang[0]! + 2 * Math.PI) - t; if (nb.length === 2 && g > Math.PI) g = 2 * Math.PI - g; if (nb.length > 1) angles.push(g * 180 / Math.PI); });
  }
  return { lengths, angles };
}

/** Best-fit rotation (degrees) and whether a mirror image fits better, fragment by fragment. */
function orientation(a: Molecule, b: Molecule, frag: number[]) {
  const fit = (mir: number) => {
    const P = frag.map((i) => a.atom(i)), Q = frag.map((i) => b.atom(i));
    const c = (pts: { x: number; y: number }[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
    const cp = c(P), cq = c(Q);
    let sxx = 0, sxy = 0;
    P.forEach((p, i) => { const q = Q[i]!; const px = p.x - cp.x, py = mir * (p.y - cp.y); sxx += px * (q.x - cq.x) + py * (q.y - cq.y); sxy += px * (q.y - cq.y) - py * (q.x - cq.x); });
    const th = Math.atan2(sxy, sxx);
    let r = 0;
    P.forEach((p, i) => { const q = Q[i]!; const px = p.x - cp.x, py = mir * (p.y - cp.y); r += (px * Math.cos(th) - py * Math.sin(th) - (q.x - cq.x)) ** 2 + (px * Math.sin(th) + py * Math.cos(th) - (q.y - cq.y)) ** 2; });
    return { th: th * 180 / Math.PI, rms: Math.sqrt(r / P.length), shift: Math.hypot(cq.x - cp.x, cq.y - cp.y) };
  };
  return { plain: fit(1), mirror: fit(-1) };
}

test('CDXML with several fragments reads every fragment (regression)', () => {
  const m = readCdxml(readFileSync(new URL('cleanup-input.cdxml', FIX), 'utf8'));
  assert.equal(m.fragments().length, 4);
  assert.equal(m.atomCount, 36);
});

test('ChemDraw highlight, ring fill and colour read from ChemDraw’s own export', () => {
  const xml = readFileSync(new URL('chemdraw-colors.cdxml', FIX), 'utf8');
  const m = readCdxml(xml);
  assert.deepEqual(m.ringFills.map((f) => [f.atoms.length, f.color]), [[6, '#4f9d9d']]);
  const o = [...m.atoms()].find((a) => a.element === 'O')!;
  assert.equal(o.color, '#7e2b0e', 'Other #2 of the default palette');
  assert.equal(o.highlight, '#00ff00');
  assert.equal([...m.bonds()].filter((b) => b.highlight).length, 1);
  void readCdxmlObjects;
});

test('Clean Up fixes lengths and angles but keeps each fragment where and how it was drawn', () => {
  const before = readCdxml(readFileSync(new URL('cleanup-input.cdxml', FIX), 'utf8'));
  const after = before.clone();
  cleanUpStructure(after, L);
  const g = geometry(after);
  assert.ok(g.lengths.every((x) => Math.abs(x - L) < 0.02 * L), `lengths ${Math.min(...g.lengths).toFixed(2)}-${Math.max(...g.lengths).toFixed(2)}`);
  assert.ok(g.angles.every((x) => Math.abs(x - 120) < 2 || Math.abs(x - 108) < 2 || Math.abs(x - 90) < 2), `angles ${[...new Set(g.angles.map(Math.round))].join(',')}`);
  const ids = [...before.atoms()].map((a) => a.id), ids2 = [...after.atoms()].map((a) => a.id);
  for (const frag of before.fragments()) {
    const o = orientation(before, after, frag.map((id) => id));
    void ids; void ids2;
    assert.ok(Math.abs(o.plain.th) < 0.5, `rotated by ${o.plain.th.toFixed(2)} degrees`);
    assert.ok(o.plain.shift < 0.5, `moved by ${o.plain.shift.toFixed(2)} pt`);
    assert.ok(o.plain.rms <= o.mirror.rms, 'not mirrored');
  }
  // ChemDraw on the same input, for the record: it mirrors salicylic acid (fragment 1).
  const cd = readCdxml(readFileSync(new URL('cleanup-chemdraw.cdxml', FIX), 'utf8'));
  const f1 = before.fragments()[1]!;
  const o = orientation(before, cd, f1);
  assert.ok(o.mirror.rms < o.plain.rms, 'ChemDraw mirrored it (HexSketch deliberately does not)');
});

test('Clean Up keeps stereocentres and double-bond geometry', () => {
  // (R)-2-butanol with a wedge, and (E)-2-pentene, both distorted.
  const ed = new Editor();
  const m = parseSmiles('C[C@@H](O)CC.C/C=C/CC');
  layout2D(m, L);
  let k = 1;
  for (const a of m.atoms()) { a.x += 4 * Math.sin(k * 1.7); a.y += 4 * Math.cos(k * 2.3); k++; }
  ed.doc.replace(m);
  const probe = ed.doc.mol.clone(); perceiveStereoFromGeometry(probe);
  const rs = [...probe.atoms()].map((a) => rsLabel(probe, a.id));
  const ez = [...ed.doc.mol.bonds()].map((b) => ezLabel(ed.doc.mol, b.id));
  ed.cleanUp();
  const after = ed.doc.mol.clone(); perceiveStereoFromGeometry(after);
  assert.deepEqual([...after.atoms()].map((a) => rsLabel(after, a.id)), rs);
  assert.deepEqual([...ed.doc.mol.bonds()].map((b) => ezLabel(ed.doc.mol, b.id)), ez);
  const g = geometry(ed.doc.mol);
  assert.ok(g.lengths.every((x) => Math.abs(x - L) < 0.02 * L));
});

test('a tangled drawing falls back to a fresh layout fitted to the original', () => {
  // Cyclohexane with two atoms swapped: bonds cross.
  const m = parseSmiles('C1CCCCC1C');
  layout2D(m, L);
  const [a, , c] = [...m.atoms()];
  [a!.x, c!.x] = [c!.x, a!.x]; [a!.y, c!.y] = [c!.y, a!.y];
  cleanUpStructure(m, L);
  const g = geometry(m);
  assert.ok(g.lengths.every((x) => Math.abs(x - L) < 0.02 * L), `lengths ${g.lengths.map((x) => x.toFixed(1)).join(' ')}`);
});
