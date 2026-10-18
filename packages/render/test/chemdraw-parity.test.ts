/**
 * Rendering parity with ChemDraw 20.1.
 *
 * tools/visual/reference/chemdraw-fixtures.svg is ChemDraw's own SVG export of
 * the calibration fixture (tools/visual/fixtures.ts) in the house style. We
 * render the same fixture and require every bond polygon and label to land
 * within 0.1 pt of ChemDraw's. Regenerate the reference with ChemDraw if the
 * fixture changes; never loosen the tolerance to make a regression pass.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_STYLE } from '@hexsketch/core';
import { depict, type Primitive } from '../src/index.ts';
import { buildFixture } from '../../../tools/visual/fixtures.ts';

type P = { x: number; y: number };
const TOLERANCE = 0.1;

const refPath = fileURLToPath(new URL('../../../tools/visual/reference/chemdraw-fixtures.svg', import.meta.url));
const ref = readFileSync(refPath, 'utf8');

/** ChemDraw writes twentieths of a point; text carries a viewBox shift we undo. */
function referencePolygons(): P[][] {
  const out: P[][] = [];
  for (const m of ref.matchAll(/<path stroke="none"[^>]*?d="([^"]*)"/g)) {
    const pts = [...m[1]!.matchAll(/([-\d.]+),([-\d.]+)/g)].map((q) => ({ x: +q[1]! / 20, y: +q[2]! / 20 }));
    if (pts.length > 1 && pts[0]!.x === pts.at(-1)!.x && pts[0]!.y === pts.at(-1)!.y) pts.pop();
    out.push(pts);
  }
  return out;
}

function referenceTexts(): { text: string; x: number; y: number }[] {
  const shift = /<path[^>]*?matrix\(0\.05 0 0 0\.05 ([-\d.]+) ([-\d.]+)\)/.exec(ref)!;
  const sx = -Number(shift[1]), sy = -Number(shift[2]);
  return [...ref.matchAll(/<text[^>]*?matrix\(([^)]*)\)[^>]*>\s*([^<]*)<\/text>/g)].map((m) => {
    const parts = m[1]!.split(/\s+/).map(Number);
    return { text: m[2]!.trim(), x: parts[4]! + sx, y: parts[5]! + sy };
  });
}

const segDist = (p: P, a: P, b: P) => {
  const ax = b.x - a.x, ay = b.y - a.y, L = ax * ax + ay * ay;
  const t = L === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * ax + (p.y - a.y) * ay) / L));
  return Math.hypot(p.x - a.x - t * ax, p.y - a.y - t * ay);
};
const toBoundary = (p: P, poly: P[]) => Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length]!)));
const hausdorff = (a: P[], b: P[]) => Math.max(...a.map((p) => toBoundary(p, b)), ...b.map((p) => toBoundary(p, a)));
const centroid = (pts: P[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });

const dep = depict(buildFixture(DEFAULT_STYLE), DEFAULT_STYLE);
const mine = dep.primitives.filter((p): p is Extract<Primitive, { kind: 'polygon' }> => p.kind === 'polygon').map((p) => p.points);

test('same number of filled shapes as ChemDraw', () => {
  assert.equal(mine.length, referencePolygons().length);
});

test('every bond polygon within 0.1 pt of ChemDraw', () => {
  const failures: string[] = [];
  for (const poly of referencePolygons()) {
    const c = centroid(poly);
    const nearest = mine.reduce((best, m) => {
      const mc = centroid(m), bc = centroid(best);
      return Math.hypot(mc.x - c.x, mc.y - c.y) < Math.hypot(bc.x - c.x, bc.y - c.y) ? m : best;
    });
    const d = hausdorff(poly, nearest);
    if (d > TOLERANCE) failures.push(`${d.toFixed(3)} pt at (${c.x.toFixed(1)}, ${c.y.toFixed(1)})`);
  }
  assert.deepEqual(failures, []);
});

test('every label run within 0.1 pt of ChemDraw', () => {
  const runs = dep.primitives.filter((p): p is Extract<Primitive, { kind: 'text' }> => p.kind === 'text').map((p) => p.run);
  const failures: string[] = [];
  for (const t of referenceTexts()) {
    const nearest = runs.reduce((best, r) => (Math.hypot(r.x - t.x, r.y - t.y) < Math.hypot(best.x - t.x, best.y - t.y) ? r : best));
    const d = Math.hypot(nearest.x - t.x, nearest.y - t.y);
    if (d > TOLERANCE || !t.text.startsWith(nearest.text)) failures.push(`${t.text} off by ${d.toFixed(3)} pt`);
  }
  assert.deepEqual(failures, []);
});
