/** Arrowhead geometry against ChemDraw 20.1's SVG of a default arrow (house style, lw 1.53). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, makeArrow, Molecule } from '@hexsketch/core';
import { depict } from '../src/index.ts';

test('full arrowhead: tip, corners and notch where ChemDraw puts them', () => {
  const dep = depict(new Molecule(), DEFAULT_STYLE, [makeArrow({ x: 100, y: 100 }, { x: 200, y: 100 })]);
  const head = dep.primitives.find((p) => p.kind === 'fillPath');
  assert.ok(head && head.kind === 'fillPath');
  const pts = [...head.d.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)].map((m) => ({ x: +m[1]!, y: +m[2]! }));
  const has = (x: number, y: number, tol = 0.1) => pts.some((p) => Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol);
  assert.ok(has(200, 100), 'tip at the head point');
  assert.ok(has(184.7, 103.88, 0.1) && has(184.7, 96.12, 0.1), 'corners 15.3 pt back, 3.88 pt out (ChemDraw)');
  assert.ok(has(186.61, 100, 0.05), 'notch 13.39 pt back (ChemDraw)');
  const shaft = dep.primitives.find((p) => p.kind === 'polygon');
  assert.ok(shaft && shaft.kind === 'polygon');
  assert.ok(Math.abs(Math.max(...shaft.points.map((p) => p.x)) - 186.61) < 0.06, 'shaft stops at the notch');
});
