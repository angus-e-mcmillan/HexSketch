/**
 * Comparing two large structures must finish. Proving a pair the same is quick -- the first
 * mapping ends it -- but proving a pair different means exhausting the search, and two
 * seventy-atom molecules that agree nearly everywhere once took three minutes to separate. The
 * benchmark marks thousands of answers, most of them wrong ones, so that cost lands on every run.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles } from '../src/smiles.ts';
import { sameStructure } from '../src/isomorphism.ts';

// Euonyminol octaacetate's dihydroxylation substrate, and the product of a model that got it wrong:
// a sixty-nine atom cage against a sixty-seven atom one, sharing everything but the reaction site.
const a = 'COCO[C@@H]1C2[C@H]3OC(C)(C)O[C@H]3[C@]3(CO[Si](C)(C)C(C)(C)C)[C@@H](O[Si](C)(C)C(C)(C)C)[C@@H](O[Si](C)(C)C(C)(C)C)[C@H](O)[C@](C)(O)[C@@]13O[C@@]2(C)CO[Si](c1ccccc1)(c1ccccc1)C(C)(C)C';
const b = 'COCO[C@@H]1C2[C@H]3OC(C)(C)O[C@H]3[C@]3(CO[Si](C)(C)C(C)(C)C)[C@@H](O[Si](C)(C)C(C)(C)C)[C@@H](O[Si](C)(C)C(C)(C)C)C=C(C)[C@@]13O[C@@]2(C)CO[Si](c1ccccc1)(c1ccccc1)C(C)(C)C';

test('two large structures that differ are separated promptly, not after an exhaustive search', () => {
  const x = parseSmiles(a), y = parseSmiles(b);
  const started = Date.now();
  assert.equal(sameStructure(x, y), false);
  const seconds = (Date.now() - started) / 1000;
  assert.ok(seconds < 20, `took ${seconds.toFixed(1)} s to tell them apart`);
});

test('and a large structure still compares equal to itself', () => {
  assert.ok(sameStructure(parseSmiles(a), parseSmiles(a)));
  assert.ok(sameStructure(parseSmiles(b), parseSmiles(b)));
});
