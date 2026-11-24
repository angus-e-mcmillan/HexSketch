/**
 * The paper's source, checked as text.
 *
 * A SMILES double bond is written `/` or `\`, and in a TypeScript string a lone
 * `\` is an unknown escape: the compiler drops it without a word. So
 * `'\C=C(\C(C)=O)'` reaches the reader as `'C=C(C(C)=O)'` and the geometry the
 * chemist drew is gone, silently, with the question still reading and still
 * marking. `reaction-r10` ran that way: four backslashes eaten, the two alkenes
 * of a Hantzsch dihydropyridine synthesis left undefined.
 *
 * Nothing downstream can catch it -- the SMILES is valid either way -- so it is
 * caught here, in the only place the difference still exists.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('every backslash in the paper is doubled, so SMILES geometry survives the compiler', () => {
  const src = readFileSync(new URL('../paper.ts', import.meta.url), 'utf8');
  const bare: string[] = [];
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== '\\') continue;
    const next = src[i + 1];
    if (next === '\\') { i++; continue; }  // `\\`: a real SMILES bond, written properly
    if (next === 'n') continue;            // `\n`: a line break inside a reagent string
    const line = src.slice(0, i).split('\n').length;
    bare.push(`paper.ts:${line} has \\${next} -- write \\\\${next} if it is a SMILES bond`);
  }
  assert.deepEqual(bare, []);
});
