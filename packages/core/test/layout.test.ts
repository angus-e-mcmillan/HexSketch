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

test('a trans double bond in a large ring is drawn trans', () => {
  // Round a polygon every ring bond is cis, so a macrocycle's E double bond was drawn Z: another compound.
  // Read back from the drawing, each must be what the SMILES said.
  const cases = [
    'C1CCCCC/C=C/CCCCC1', 'C1CCCCC/C=C\\CCCCC1', 'C1CCC/C=C/CC1', 'C1CCCC/C=C/C=C/CCCC1', 'C1CCCC/C=C/C=C\\CCCC1',
    'C[C@H]1C/C=C/CCCCCCC(=O)O1', 'C1CCCC/C=C/C=C/C=C/CCCCCC1', 'CC1=C/CCCCCCCC\\C=C(C)\\CCC/1',
  ];
  for (const smiles of cases) {
    const mol = parseSmiles(smiles);
    const want = [...mol.bonds()].map((b) => ezLabel(mol, b.id)).filter(Boolean).join('');
    assert.ok(want.length > 0, smiles);
    layout2D(mol);
    perceiveStereoFromGeometry(mol);
    assert.equal([...mol.bonds()].map((b) => ezLabel(mol, b.id)).filter(Boolean).join(''), want, smiles);
    // Every bond still the standard length.
    for (const b of mol.bonds()) {
      const p = mol.atom(b.begin), q = mol.atom(b.end);
      assert.ok(Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - 18.43) < 0.05, `${smiles}: bond length`);
    }
  }
});

test('a crowded cage atom still gets a wedge that shows its configuration', () => {
  // Vincristine and batrachotoxin each have a centre whose first-choice bond can carry neither a wedge nor a hash.
  for (const smiles of ['CC[C@@]1(C[C@@H]2C[C@@](C3=C(CCN(C2)C1)C4=CC=CC=C4N3)(C5=C(C=C6C(=C5)[C@]78CCN9[C@H]7[C@@](C=CC9)([C@H]([C@@]([C@@H]8N6C=O)(C(=O)OC)O)OC(=O)C)CC)OC)C(=O)OC)O', 'CC1=CNC(=C1C(=O)O[C@@H](C)C2=CC[C@@]34[C@@]2(C[C@H]([C@@]56C3=CC[C@H]7[C@@]5(CC[C@](C7)(O6)O)C)O)CN(CCO4)C)C', 'C1CN2CC3=CCO[C@H]4CC(=O)N5[C@H]6[C@H]4[C@H]3C[C@H]2[C@@]61C7=CC=CC=C75']) {
    const mol = parseSmiles(smiles);
    const want = [...mol.atoms()].map((a) => rsLabel(mol, a.id));
    layout2D(mol);
    perceiveStereoFromGeometry(mol);
    assert.deepEqual([...mol.atoms()].map((a) => rsLabel(mol, a.id)), want, smiles);
  }
});

test('crowded atoms are drawn apart: a chain keeps its zigzag through CF2 and gem-dimethyl carbons', () => {
  const closest = (smiles: string) => {
    const mol = parseSmiles(smiles);
    layout2D(mol);
    const at = [...mol.atoms()];
    let least = Infinity;
    for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) least = Math.min(least, Math.hypot(at[i]!.x - at[j]!.x, at[i]!.y - at[j]!.y));
    return least / 18.43;
  };
  // Perfluorooctanoic acid, pinacol, phenytoin, 1-phenylcyclohexanecarboxylic acid, a trityl ether, decachlorodiphenyl ether.
  for (const smiles of ['OC(=O)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F', 'OC(C)(C)C(C)(C)O', 'CCC(C)(C)CCC(C)(C)CC',
    'C1=CC=C(C=C1)C2(C(=O)NC(=O)N2)C3=CC=CC=C3', 'OC(=O)C1(CCCCC1)c1ccccc1', 'COC(c1ccccc1)(c1ccccc1)c1ccccc1',
    'C1(=C(C(=C(C(=C1Cl)Cl)Cl)Cl)Cl)OC2=C(C(=C(C(=C2Cl)Cl)Cl)Cl)Cl']) {
    assert.ok(closest(smiles) > 0.5, `${smiles}: closest atoms ${closest(smiles).toFixed(2)} bond lengths apart`);
  }
  // The backbone of a perfluoro chain is still a zigzag: every C-C-C angle 120 degrees.
  const mol = parseSmiles('FC(F)(F)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F');
  layout2D(mol);
  const carbons = [...mol.atoms()].filter((a) => a.element === 'C');
  for (let i = 1; i + 1 < carbons.length; i++) {
    const [p, c, n] = [carbons[i - 1]!, carbons[i]!, carbons[i + 1]!];
    const angle = Math.abs(Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(n.y - c.y, n.x - c.x)) * 180 / Math.PI;
    assert.ok(Math.abs(Math.min(angle, 360 - angle) - 120) < 1, `C-C-C angle ${angle.toFixed(0)}`);
  }
});
