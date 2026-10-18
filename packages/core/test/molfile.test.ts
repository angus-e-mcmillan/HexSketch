import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles } from '../src/smiles.ts';
import { layout2D } from '../src/layout.ts';
import { readMolfile, writeMolfile } from '../src/molfile.ts';
import { sameStructure } from '../src/isomorphism.ts';
import { perceiveStereoFromGeometry, rsLabel } from '../src/stereo.ts';

test('molfile V2000 round trip keeps structure, charges, geometry and wedge meaning', () => {
  for (const smi of ['CC(=O)Oc1ccccc1C(=O)O', 'C[N+](C)(C)C.[Cl-]', 'N[C@@H](C)C(=O)O', 'O=[N+]([O-])c1ccccc1']) {
    const mol = parseSmiles(smi);
    layout2D(mol, 18.43);
    perceiveStereoFromGeometry(mol);
    const want = [...mol.atoms()].map((a) => rsLabel(mol, a.id)).join();
    const text = writeMolfile(mol, 18.43, smi);
    assert.match(text.split('\n')[3]!, /V2000$/);
    const back = readMolfile(text, 18.43);
    assert.ok(sameStructure(mol, back), smi);
    perceiveStereoFromGeometry(back);
    assert.equal([...back.atoms()].map((a) => rsLabel(back, a.id)).join(), want, `${smi}: wedge meaning`);
    const a0 = [...mol.atoms()][0]!, b0 = [...back.atoms()][0]!;
    const a1 = [...mol.atoms()][1]!, b1 = [...back.atoms()][1]!;
    assert.ok(Math.abs(Math.hypot(a0.x - a1.x, a0.y - a1.y) - Math.hypot(b0.x - b1.x, b0.y - b1.y)) < 0.01, 'distances preserved');
  }
});

test('reads a hand-written molfile with an M CHG block', () => {
  const text = [
    'acetate', '  test', '',
    '  4  3  0  0  0  0  0  0  0  0999 V2000',
    '    0.0000    0.0000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.2990    0.7500    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0',
    '    1.2990    2.2500    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '    2.5981    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0', '  2  3  2  0', '  2  4  1  0',
    'M  CHG  1   4  -1', 'M  END', '',
  ].join('\n');
  const mol = readMolfile(text);
  assert.ok(sameStructure(mol, parseSmiles('CC(=O)[O-]')));
});
