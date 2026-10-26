import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Molecule, type BondDisplay } from '../src/model.ts';
import { ezLabel, perceiveStereoFromGeometry, rsLabel } from '../src/stereo.ts';
import { parseSmiles } from '../src/smiles.ts';

const L = 18.43;

/** L-alanine as ChemDraw lays it out: NH2 straight down on a wedge, CH3 up-left, COOH up-right. */
function alanine(display: BondDisplay) {
  const mol = new Molecule();
  const ca = mol.addAtom({ element: 'C', x: 0, y: 0 });
  const n = mol.addAtom({ element: 'N', x: 0, y: L });
  const me = mol.addAtom({ element: 'C', x: -0.866 * L, y: -0.5 * L });
  const c = mol.addAtom({ element: 'C', x: 0.866 * L, y: -0.5 * L });
  const o1 = mol.addAtom({ element: 'O', x: 0.866 * L, y: -1.5 * L });
  const o2 = mol.addAtom({ element: 'O', x: 1.732 * L, y: 0 });
  mol.addBond({ begin: ca.id, end: n.id, display });
  mol.addBond({ begin: ca.id, end: me.id });
  mol.addBond({ begin: ca.id, end: c.id });
  mol.addBond({ begin: c.id, end: o1.id, order: 2 });
  mol.addBond({ begin: c.id, end: o2.id });
  return { mol, centre: ca.id };
}

test('wedge geometry: ChemDraw-drawn L-alanine is S, its hashed mirror is R', () => {
  const w = alanine('wedgeBegin');
  perceiveStereoFromGeometry(w.mol);
  assert.equal(rsLabel(w.mol, w.centre), 'S');
  const h = alanine('hashBegin');
  perceiveStereoFromGeometry(h.mol);
  assert.equal(rsLabel(h.mol, h.centre), 'R');
});

test('a wedge whose narrow end is elsewhere does not define this centre', () => {
  const w = alanine('wedgeEnd'); // narrow end at N, not at the alpha carbon
  perceiveStereoFromGeometry(w.mol);
  assert.equal(rsLabel(w.mol, w.centre), null);
});

test('double bonds: zigzag but-2-ene is E, U-shape is Z', () => {
  const build = (lastX: number, lastY: number) => {
    const mol = new Molecule();
    const a = mol.addAtom({ element: 'C', x: 0, y: 0 });
    const b = mol.addAtom({ element: 'C', x: 0.866 * L, y: -0.5 * L });
    const c = mol.addAtom({ element: 'C', x: 1.732 * L, y: 0 });
    const d = mol.addAtom({ element: 'C', x: lastX, y: lastY });
    mol.addBond({ begin: a.id, end: b.id });
    const db = mol.addBond({ begin: b.id, end: c.id, order: 2 });
    mol.addBond({ begin: c.id, end: d.id });
    perceiveStereoFromGeometry(mol);
    return ezLabel(mol, db.id);
  };
  assert.equal(build(2.598 * L, -0.5 * L), 'E');   // zigzag
  assert.equal(build(1.732 * L, L), 'Z');           // U-shape: CH3 straight down from C3
  assert.equal(build(2.598 * L, 0.5 * L), null, 'substituent on the bond axis: no descriptor');
});

/** Labels at every stereocentre, as "atom index:R" in SMILES atom order. */
const labels = (smi: string) => {
  const mol = parseSmiles(smi);
  return [...mol.atoms()].map((a, i) => [i, rsLabel(mol, a.id)] as const).filter(([, l]) => l).map(([i, l]) => `${i}${l}`).join(' ');
};

test('CIP: branches of equal atoms are compared in rank order (agrees with RDKit)', () => {
  // Each disagreed before siblings were ordered by their own branches.
  assert.equal(labels('CC1=C2C(=O)O[C@H](c3ccoc3)[C@]2(C)CCC1'), '6S 12R');
  assert.equal(labels('CC1=C(C#N)[C@H](c2ccco2)C(C#N)=C(N)S1'), '5S');
  assert.equal(labels('NC(=O)c1sc2c(c1N)C=N[C@H]1CCCN21'), '11R');
  assert.equal(labels('Cc1ccccc1[C@@H]1[C@H](C#N)[C@@]12C(N)=NN=C2O'), '7S 8S 11R');
});

test('CIP: sulfoxides have a lone pair as the lowest substituent; no duplicates across P=O', () => {
  assert.equal(labels('C[S@](=O)c1ccccc1'), '1S');
  assert.equal(labels('C[S@@](=O)c1ccccc1'), '1R');
  assert.equal(labels('CCO[P@@]1(=O)CCCCN1Cc1ccccc1'), '3S');
});
