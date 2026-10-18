/**
 * CIP descriptors checked against OPSIN as an independent oracle: OPSIN turns
 * a stereo name into SMILES using its own CIP implementation, and our engine
 * must read back the same descriptors from that SMILES.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ezLabel, parseSmiles, rsLabel, type Molecule } from '@hexsketch/core';
import { opsinAvailable, opsinToSmiles } from '../src/opsin.ts';

const CASES: [string, string[]][] = [
  ['(S)-2-aminopropanoic acid', ['S']],
  ['(R)-2-aminopropanoic acid', ['R']],
  ['(R)-butan-2-ol', ['R']],
  ['(S)-2-chlorobutane', ['S']],
  ['(R)-2,3-dihydroxypropanal', ['R']],
  ['(2S,3R)-2-amino-3-hydroxybutanoic acid', ['R', 'S']],
  ['(R)-1-phenylethan-1-amine', ['R']],
  ['(S)-bromo(chloro)fluoromethane', ['S']],
  ['(R)-3-methylhexane', ['R']],
  ['(S)-2-methylbutan-1-ol', ['S']],
  ['(R)-1-methyl-4-(prop-1-en-2-yl)cyclohex-1-ene', ['R']],
  ['(S)-2-hydroxypropanoic acid', ['S']],
  ['(E)-but-2-ene', ['E']],
  ['(Z)-but-2-ene', ['Z']],
  ['(E)-but-2-enoic acid', ['E']],
  ['(Z)-2-chlorobut-2-ene', ['Z']],
  ['(E)-3-methylpent-2-ene', ['E']],
  ['(2E,4Z)-hexa-2,4-diene', ['E', 'Z']],
];

function labels(mol: Molecule): string[] {
  const out: string[] = [];
  for (const a of mol.atoms()) { const l = rsLabel(mol, a.id); if (l) out.push(l); }
  for (const b of mol.bonds()) { const l = ezLabel(mol, b.id); if (l) out.push(l); }
  return out.sort();
}

test('CIP descriptors agree with OPSIN', { skip: !opsinAvailable() && 'OPSIN/Java not available' }, () => {
  const smiles = opsinToSmiles(CASES.map(([n]) => n));
  const failures: string[] = [];
  CASES.forEach(([name, want], i) => {
    const smi = smiles[i];
    if (!smi) { failures.push(`${name}: OPSIN could not parse`); return; }
    const got = labels(parseSmiles(smi));
    if (got.join() !== [...want].sort().join()) failures.push(`${name} -> ${smi}: got [${got}]`);
  });
  assert.deepEqual(failures, []);
});
