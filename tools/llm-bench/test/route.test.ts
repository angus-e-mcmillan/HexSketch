/** Marking a route the model plans itself: its parts, and the chemist's verdict. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markRoute, parseRoute } from '../route.ts';
import type { Question } from '../questions.ts';

const TARGET = 'O=C(NCc1ccc(F)cc1)C1CCN(c2ncccn2)CC1';
const q: Question = {
  id: 'route-t', type: 'route', ask: 'Plan a synthesis in at most 3 steps.', marks: 5, drawing: '', given: [TARGET], scheme: [],
  key: { kind: 'route', target: TARGET, maxSteps: 3, accepted: [['OC(=O)C1CCN(c2ncccn2)CC1', 'NCc1ccc(F)cc1'], ['Clc1ncccn1', 'O=C(NCc1ccc(F)cc1)C1CCNCC1']] },
};
const SOLD = new Set(['Clc1ncccn1', 'OC(=O)C1CCNCC1', 'NCc1ccc(F)cc1', 'CCOC(=O)C1CCNCC1']);
const sold = async (s: string) => SOLD.has(s);
const none = { routes: {} };

test('the STEP lines: reactants, product and the reagents in words', () => {
  assert.deepEqual(parseRoute('Plan...\nSTEP: CC(=O)O.NCC>>CC(=O)NCC HATU, DIPEA, DMF\n**STEP 2:** `CC(=O)NCC>>CCNCC` LiAlH4'), [
    { reactants: ['CC(=O)O', 'NCC'], product: 'CC(=O)NCC', reagents: 'HATU, DIPEA, DMF' },
    { reactants: ['CC(=O)NCC'], product: 'CCNCC', reagents: 'LiAlH4' },
  ]);
});

test('an accepted route from bought materials by known reactions earns every mark', async () => {
  const m = await markRoute(q, 'STEP: Clc1ncccn1.OC(=O)C1CCNCC1>>OC(=O)C1CCN(c2ncccn2)CC1 K2CO3, DMF\nSTEP: OC(=O)C1CCN(c2ncccn2)CC1.NCc1ccc(F)cc1>>' + TARGET + ' HATU, DIPEA', none, sold);
  assert.equal(m.valid, true); assert.equal(m.buyable, true); assert.equal(m.forward, true); assert.equal(m.accepted, true);
  assert.deepEqual(m.steps.map((s) => s.reaction), ['SNAr or Buchwald amination', 'amide coupling']);
  assert.equal(m.score, 1);
});

test('another sound route waits for the chemist, who decides its last two fifths', async () => {
  // Through the ester: the last step (aminolysis) is no accepted disconnection, and no template knows it.
  const text = 'STEP: Clc1ncccn1.CCOC(=O)C1CCNCC1>>CCOC(=O)C1CCN(c2ncccn2)CC1 DIPEA, iPrOH\nSTEP: CCOC(=O)C1CCN(c2ncccn2)CC1.NCc1ccc(F)cc1>>' + TARGET + ' AlMe3, toluene';
  const m = await markRoute(q, text, none, sold);
  assert.equal(m.valid, true); assert.equal(m.accepted, false); assert.equal(m.forward, false); assert.equal(m.pending, true);
  assert.equal(m.score, 2 / 5);
  const approved = await markRoute(q, text, { routes: { [m.id]: { viable: true } } }, sold);
  assert.equal(approved.pending, false); assert.equal(approved.score, 4 / 5);
});

test('a route that misses the target, or needs a compound no one sells, loses marks', async () => {
  const wrong = await markRoute(q, 'STEP: OC(=O)C1CCN(c2ncccn2)CC1.NCc1ccc(Cl)cc1>>O=C(NCc1ccc(Cl)cc1)C1CCN(c2ncccn2)CC1 HATU', none, sold);
  assert.equal(wrong.valid, false); assert.match(wrong.why!, /target/); assert.equal(wrong.score, 0);
  const unsold = await markRoute(q, 'STEP: OC(=O)C1CCN(c2ncccn2)CC1.NCc1ccc(F)cc1>>' + TARGET + ' HATU, DIPEA', none, sold);
  assert.deepEqual(unsold.notSold, ['OC(=O)C1CCN(c2ncccn2)CC1']); assert.equal(unsold.score, 4 / 5);
  const long = await markRoute({ ...q, key: { ...q.key, maxSteps: 1 } as Question['key'] }, 'STEP: Clc1ncccn1.OC(=O)C1CCNCC1>>OC(=O)C1CCN(c2ncccn2)CC1 K2CO3\nSTEP: OC(=O)C1CCN(c2ncccn2)CC1.NCc1ccc(F)cc1>>' + TARGET + ' HATU', none, sold);
  assert.match(long.why!, /more than 1/);
});
