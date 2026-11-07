/** The LLM benchmark's grading: finding the answer line, and judging formulas and structures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalAnswer, grade, sameFormula } from '../grade.ts';
import type { Question } from '../questions.ts';

test('the last ANSWER line is the answer, without its decoration', () => {
  assert.equal(finalAnswer('Thinking...\nANSWER: CCO\nmore\nANSWER: `CC(=O)O`.'), 'CC(=O)O');
  assert.equal(finalAnswer('**ANSWER:** c1ccccc1'), 'c1ccccc1');
  assert.equal(finalAnswer('The answer is ethanol.'), null);
});

test('formulas match element by element', () => {
  assert.ok(sameFormula('C9H8O4', 'C9H8O4'));
  assert.ok(sameFormula('H8C9O4', 'C9H8O4'));
  assert.ok(sameFormula('C₉H₈O₄', 'C9H8O4'));
  assert.ok(!sameFormula('C9H10O4', 'C9H8O4'));
  assert.ok(!sameFormula('not a formula', 'C9H8O4'));
});

test('structures: connectivity, or the stereoisomer where asked', async () => {
  const q = (smiles: string, stereo: boolean): Question => ({ id: 'x', category: 'stereo', prompt: '', pilot: true, answer: { kind: 'structure', smiles, stereo } });
  assert.equal(await grade(q('C[C@H](N)C(=O)O', true), 'C[C@H](N)C(=O)O'), 'correct');
  assert.equal(await grade(q('C[C@H](N)C(=O)O', true), 'C[C@@H](N)C(=O)O'), 'stereo');
  assert.equal(await grade(q('C[C@H](N)C(=O)O', true), 'CC(N)C(=O)O'), 'stereo');
  assert.equal(await grade(q('C[C@H](N)C(=O)O', false), 'CC(N)C(=O)O'), 'correct');
  assert.equal(await grade(q('CCO', false), 'CCC'), 'wrong');
  assert.equal(await grade(q('CCO', false), 'ethanol'), 'unreadable');
  assert.equal(await grade(q('CCO', false), null), 'no-answer');
});

test('names: a trivial name the question rules out is wrong, even though OPSIN reads it', async () => {
  const q: Question = { id: 'x', category: 'common2name', prompt: '', pilot: true, answer: { kind: 'name', smiles: 'N[C@@H](CS)C(=O)O', stereo: true, avoid: 'cysteine' } };
  assert.equal(await grade(q, 'L-cysteine', 'N[C@@H](CS)C(=O)O'), 'wrong');
  assert.equal(await grade(q, '(2R)-2-amino-3-sulfanylpropanoic acid', 'N[C@@H](CS)C(=O)O'), 'correct');
  assert.equal(await grade(q, '(2S)-2-amino-3-sulfanylpropanoic acid', 'N[C@H](CS)C(=O)O'), 'stereo');
});

test('the hard set: every question is well formed', async () => {
  const { loadQuestions } = await import('../questions.ts');
  const hard = loadQuestions('hard');
  assert.equal(new Set(hard.map((q) => q.id)).size, hard.length);
  assert.ok(hard.filter((q) => q.pilot).length >= 30);
});

test('structures: any answer the examiner also accepts earns the mark', async () => {
  const q: Question = { id: 'x', category: 'reaction', prompt: '', pilot: true, answer: { kind: 'structure', smiles: 'C=C(C)CC', stereo: false, also: ['CC=C(C)C'] } };
  assert.equal(await grade(q, 'C=C(C)CC'), 'correct');
  assert.equal(await grade(q, 'CC(C)=CC'), 'correct');
  assert.equal(await grade(q, 'C=CC(C)C'), 'wrong');
});

test('sets, sequences, choices and marked answers', async () => {
  const q = (answer: Question['answer']): Question => ({ id: 'x', category: 'other', prompt: '', pilot: true, answer });
  const retro = q({ kind: 'structures', smiles: ['C1=CC=CCC1', 'O=C1OC(=O)C=C1'], stereo: false });
  assert.equal(await grade(retro, 'O=C1C=CC(=O)O1.C1CC=CC=C1'), 'correct');
  assert.equal(await grade(retro, 'C1CC=CC=C1'), 'wrong');
  assert.equal(await grade(retro, 'C1CC=CC=C1.O=C1C=CC(=O)O1.CCO'), 'wrong');
  const mech = q({ kind: 'sequence', smiles: ['CC(C)(O)[C+](C)C', 'CC(=[OH+])C(C)(C)C'], stereo: false });
  assert.equal(await grade(mech, 'CC(C)(O)C(C)(C)[OH2+] >> CC(C)(O)[C+](C)C >> CC(=[OH+])C(C)(C)C >> CC(=O)C(C)(C)C'), 'correct');
  assert.equal(await grade(mech, 'CC(=[OH+])C(C)(C)C >> CC(C)(O)[C+](C)C'), 'wrong');
  const safety = q({ kind: 'choice', letters: 'A,C' });
  assert.equal(await grade(safety, 'C, A'), 'correct');
  assert.equal(await grade(safety, 'A and C'), 'correct');
  assert.equal(await grade(safety, 'A'), 'wrong');
  assert.equal(await grade(q({ kind: 'marked', scheme: 'x' }), 'Step 1 ...'), 'ungraded');
  assert.equal(finalAnswer('Plan:\nANSWER: Step 1, nitrate.\nStep 2, reduce.', true), 'Step 1, nitrate.\nStep 2, reduce.');
});
