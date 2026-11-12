/** Which bond carries the wedge at a stereocentre whose every bond is a ring bond. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readStructure } from '../../agent/src/index.ts';
import { perceiveRings } from '../src/index.ts';

test('a fused stereocentre marks the larger ring and leaves the smaller one flat', async () => {
  // Every bond at a ring-fusion carbon is a ring bond, so one of them has to carry the wedge. A
  // chemist keeps the five-membered ring flat and shows the configuration on the bonds into the six.
  const mol = (await readStructure('O=C3C[C@@H]2OCC(C1=CC(F)=C(F)C(F)=C1)N[C@H]2C3', { format: 'smiles' })).mol;
  const rings = perceiveRings(mol);
  const holding = (u: number, v: number) => rings.filter((r) => {
    const i = r.atoms.indexOf(u), j = r.atoms.indexOf(v);
    return i >= 0 && j >= 0 && (Math.abs(i - j) === 1 || Math.abs(i - j) === r.atoms.length - 1);
  });
  const marked = [...mol.bonds()].filter((b) => b.display !== 'plain');
  assert.equal(marked.length, 2, 'both stereocentres are shown');
  for (const b of marked) {
    const held = holding(b.begin, b.end);
    assert.equal(held.length, 1, 'never the bond the two rings share');
    assert.equal(held[0]!.atoms.length, 6, 'the mark is on the larger ring, so the smaller stays flat');
  }
});
