/**
 * The chemist's rule for a drawing: a product is never turned or flipped
 * against the starting material it comes from, and where two starting
 * materials cannot both be followed, it follows the largest.
 *
 * The case is the benchmark's own reaction-4, a Mitsunobu of Boc-pyrrolidinol
 * (13 atoms) with 4-cyanophenol (9): the product used to come out 136 degrees
 * from the Boc-pyrrolidinol, following the smaller phenol instead.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commonCore, drawnOut, readStructure } from '../../../packages/agent/src/index.ts';
import type { Molecule } from '../../../packages/core/src/index.ts';
import { prepare } from '../../../packages/hexsketch/src/toolkit.ts';
import { loadQuestions } from '../questions.ts';

/** How far (degrees) `part` is turned against `ref`, over the atoms they share; null when they share too little. */
function turnAgainst(ref: Molecule, part: Molecule): number | null {
  const map = commonCore(ref, part)[0];
  if (!map || map.size < 6) return null;
  const pairs = [...map].map(([r, t]) => [ref.atom(r), part.atom(t)] as const);
  const mid = (k: 0 | 1) => ({ x: pairs.reduce((s, p) => s + p[k].x, 0) / pairs.length, y: pairs.reduce((s, p) => s + p[k].y, 0) / pairs.length });
  const a = mid(0), b = mid(1);
  let sxx = 0, sxy = 0;
  for (const [p, q] of pairs) { const px = p.x - a.x, py = p.y - a.y, qx = q.x - b.x, qy = q.y - b.y; sxx += px * qx + py * qy; sxy += px * qy - py * qx; }
  return (Math.atan2(sxy, sxx) * 180) / Math.PI;
}

const only = (mol: Molecule, ids: readonly number[]): Molecule => {
  const part = mol.clone();
  for (const a of mol.atoms()) if (!ids.includes(a.id)) part.removeAtom(a.id);
  return part;
};

test('a product follows the largest starting material, as the chemist draws it', async (t) => {
  const q = loadQuestions().find((x) => x.id === 'reaction-4');
  if (!q?.drawing) return t.skip('the paper is not built here');
  const before = await readStructure(q.drawing);
  const { update } = await prepare({ structure: q.key.kind === 'structure' ? q.key.smiles : '' }, before.mol, q.drawing);
  assert.ok(update.structure, 'the product was drawn');
  const product = drawnOut((await readStructure(update.structure)).mol, before.style);
  const materials = drawnOut(before.mol, before.style);
  const [largest, smaller] = materials.fragments().sort((a, b) => b.length - a.length);
  assert.ok(largest && smaller && largest.length > smaller.length, 'two starting materials, one larger');

  const turn = turnAgainst(only(materials, largest), product);
  assert.ok(turn !== null, 'the product keeps enough of the largest starting material to compare');
  assert.ok(Math.abs(turn) < 30, `the product is turned ${turn.toFixed(0)} degrees from the largest starting material`);
});
