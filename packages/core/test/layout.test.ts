import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles } from '../src/smiles.ts';
import { layout2D } from '../src/layout.ts';
import { ezLabel, perceiveStereoFromGeometry, rsLabel } from '../src/stereo.ts';
import type { Molecule } from '../src/model.ts';

const L = 18.43;
const SMILES = [
  'CC(C)Cc1ccc(C(C)C(=O)O)cc1', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'c1ccc2ccccc2c1', 'C1CCC2C(C1)CCC1C2CCC2CCCC21',
  'C1CCC2(C1)CCCC2', 'c1ccc(-c2ccccc2)cc1', 'CCCCCCCCCC(=O)O', 'CC(C)(C)C(C)(C)C', 'OC(=O)C(O)(CC(=O)O)CC(=O)O',
  'CC1=C(C(=O)OC)C(c2ccccc2)C(C(=O)OC)=C(C)N1', 'c1ccc2cc3ccccc3cc2c1',
];

function labels(mol: Molecule): string {
  const out: string[] = [];
  for (const a of mol.atoms()) { const l = rsLabel(mol, a.id); if (l) out.push(`${a.id}${l}`); }
  for (const b of mol.bonds()) { const l = ezLabel(mol, b.id); if (l) out.push(`${b.id}${l}`); }
  return out.sort().join(' ');
}

test('layout: bonds at the standard length, no atoms on top of each other', () => {
  for (const smi of SMILES) {
    const mol = parseSmiles(smi);
    layout2D(mol, L);
    for (const b of mol.bonds()) {
      const p = mol.atom(b.begin), q = mol.atom(b.end);
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      assert.ok(Math.abs(d - L) < 0.05 * L, `${smi}: bond length ${d.toFixed(2)}`);
    }
    const atoms = [...mol.atoms()];
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
      const d = Math.hypot(atoms[i]!.x - atoms[j]!.x, atoms[i]!.y - atoms[j]!.y);
      assert.ok(d > 0.5 * L, `${smi}: atoms ${atoms[i]!.id} and ${atoms[j]!.id} only ${d.toFixed(2)} apart`);
    }
  }
});

test('layout keeps stereochemistry: wedges and alkene geometry mean what the SMILES meant', () => {
  const STEREO = ['N[C@@H](C)C(=O)O', 'N[C@H](C)C(=O)O', 'N[C@@H]([C@@H](C)O)C(=O)O', 'C/C=C/C(=O)O', 'C/C=C\\C(=O)O',
    'O[C@@H]1CCCC[C@H]1O', 'C[C@H](N)c1ccccc1', 'C/C=C/C=C\\CC', 'CC[C@@H](C)[C@H](N)C(=O)O'];
  for (const smi of STEREO) {
    const mol = parseSmiles(smi);
    const before = labels(mol);
    layout2D(mol, L);
    perceiveStereoFromGeometry(mol); // forget the SMILES stereo; read it back from the drawing
    assert.equal(labels(mol), before, smi);
  }
});
