import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles, writeSmiles } from '../src/smiles.ts';
import { sameStructure } from '../src/isomorphism.ts';
import { computeMass } from '../src/formula.ts';

const CASES: [string, string, string][] = [
  ['aspirin', 'CC(=O)Oc1ccccc1C(=O)O', 'C9H8O4'],
  ['caffeine', 'Cn1cnc2c1c(=O)n(C)c(=O)n2C', 'C8H10N4O2'],
  ['pyrrole', 'c1cc[nH]c1', 'C4H5N'],
  ['pyridine', 'c1ccncc1', 'C5H5N'],
  ['furan', 'c1ccoc1', 'C4H4O'],
  ['thiophene', 'c1ccsc1', 'C4H4S'],
  ['naphthalene', 'c1ccc2ccccc2c1', 'C10H8'],
  ['indole', 'c1ccc2[nH]ccc2c1', 'C8H7N'],
  ['ammonium', '[NH4+]', 'H4N+'],
  ['acetate', 'CC(=O)[O-]', 'C2H3O2-'],
  ['dimethyl sulfone', 'CS(=O)(=O)C', 'C2H6O2S'],
  ['13C methanol', '[13CH3]O', 'CH4O'],
  ['chloroform', 'ClC(Cl)Cl', 'CHCl3'],
  ['benzonitrile', 'N#Cc1ccccc1', 'C7H5N'],
  ['L-alanine (stereo ignored)', 'C[C@@H](C(=O)O)N', 'C3H7NO2'],
  ['ring closure %10', 'C%10CCCCC%10', 'C6H12'],
  ['two parts', 'O.O', 'H4O2'],
];

for (const [name, smi, formula] of CASES) {
  test(`parse ${name}`, () => {
    const mol = parseSmiles(smi);
    assert.equal(computeMass(mol).formulaWithCharge, formula);
  });
  test(`round-trip ${name}`, () => {
    const mol = parseSmiles(smi);
    const again = parseSmiles(writeSmiles(mol));
    assert.ok(sameStructure(mol, again), `${smi} -> ${writeSmiles(mol)}`);
  });
}

test('different Kekule forms are the same structure', () => {
  assert.ok(sameStructure(parseSmiles('C1=CC=CC=C1'), parseSmiles('C1C=CC=CC=1')));
  assert.ok(sameStructure(parseSmiles('c1ccc2ccccc2c1'), parseSmiles('C1=CC=C2C=CC=CC2=C1')));
});

test('isomers are not the same structure', () => {
  assert.ok(!sameStructure(parseSmiles('C1=CCC=CC1'), parseSmiles('C1=CC=CCC1')), '1,4- vs 1,3-cyclohexadiene');
  assert.ok(!sameStructure(parseSmiles('CCCO'), parseSmiles('CC(C)O')), 'propanol isomers');
  assert.ok(!sameStructure(parseSmiles('Oc1ccccc1C'), parseSmiles('Oc1ccc(C)cc1')), 'cresol isomers');
  assert.ok(!sameStructure(parseSmiles('CC#C'), parseSmiles('C=C=C')), 'propyne vs allene');
});

test('bad SMILES are rejected with a message', () => {
  assert.throws(() => parseSmiles('C1CC'), /unclosed ring/);
  assert.throws(() => parseSmiles('C[Xx]'), /unknown element/);
  assert.throws(() => parseSmiles('c1cccc1'), /kekulize/);
  assert.throws(() => parseSmiles('CCCC('), /unclosed branch/);
  assert.throws(() => parseSmiles('CC)C'), /unmatched "\)"/);
});

/**
 * The same compound with the same configuration at every recorded centre and
 * double bond, under some atom mapping. Compares the chirality and ez records
 * directly, so it also checks centres CIP leaves unlabelled (ring cis/trans).
 */
async function sameStereo(a: import('../src/model.ts').Molecule, b: import('../src/model.ts').Molecule): Promise<boolean> {
  const { isomorphisms } = await import('../src/isomorphism.ts');
  const parity = (from: number[], to: number[]) => {
    const p = from.map((x) => to.indexOf(x)); let s = 0;
    for (let i = 0; i < p.length; i++) while (p[i] !== i) { const j = p[i]!; [p[i], p[j]] = [p[j]!, p[i]!]; s++; }
    return s % 2;
  };
  const centres = [...a.atoms()].filter((x) => x.chirality).length, bonds = [...a.bonds()].filter((x) => x.ez).length;
  if (centres !== [...b.atoms()].filter((x) => x.chirality).length || bonds !== [...b.bonds()].filter((x) => x.ez).length) return false;
  for (const map of isomorphisms(a, b)) {
    const m = (id: number) => (id === -1 ? -1 : map.get(id)!);
    const chiralOk = [...a.atoms()].every((x) => {
      if (!x.chirality) return true;
      const y = b.atom(m(x.id)).chirality;
      if (!y) return false;
      const mapped = x.chirality.order.map(m);
      if (!mapped.every((n) => y.order.includes(n))) return false;
      return (x.chirality.anticlockwise !== (parity(mapped, y.order) === 1)) === y.anticlockwise;
    });
    const ezOk = [...a.bonds()].every((x) => {
      if (!x.ez) return true;
      const y = b.bondBetween(m(x.begin), m(x.end))!;
      if (!y.ez) return false;
      const [r0, r1] = y.begin === m(x.begin) ? [m(x.ez.ref[0]), m(x.ez.ref[1])] : [m(x.ez.ref[1]), m(x.ez.ref[0])];
      return (x.ez.cis !== (r0 !== y.ez.ref[0]) !== (r1 !== y.ez.ref[1])) === y.ez.cis;
    });
    if (chiralOk && ezOk) return true;
  }
  return false;
}

const STEREO = [
  'C[C@@H](C(=O)O)N', 'C[C@H](C(=O)O)N', 'N[C@@H](C)C(=O)O', '[C@@H](F)(Cl)Br', 'F[C@](Cl)(Br)I',
  'F/C=C/F', 'F/C=C\\F', 'C(/F)=C/F', 'C/C=C/C=C/C', 'C/C=C\\C=C/C', 'OC(=O)/C=C\\C(=O)O',
  'C[C@H]1CC[C@@H](C)CC1', 'C[C@H]1CC[C@H](C)CC1', 'O[C@@H]1[C@H](O)[C@@H](O)[C@H](O)[C@@H](O)[C@H]1O',
  'C[C@@]12CC[C@H]3[C@@H](CC=C4C[C@@H](O)CC[C@]34C)[C@@H]1CC[C@@H]2O',
];

for (const smi of STEREO) {
  test(`stereo survives writing ${smi}`, async () => {
    const { rsLabel, ezLabel } = await import('../src/stereo.ts');
    const mol = parseSmiles(smi);
    const out = writeSmiles(mol);
    assert.ok(await sameStereo(mol, parseSmiles(out)), `${smi} -> ${out}`);
    const labelled = [...mol.atoms()].some((a) => rsLabel(mol, a.id)) || [...mol.bonds()].some((b) => ezLabel(mol, b.id));
    if (labelled) assert.match(out, /@|\/|\\/, `${smi} -> ${out} has no stereo marks`);
  });
  test(`stereo survives drawing and writing ${smi}`, async () => {
    const { layout2D } = await import('../src/layout.ts');
    const mol = parseSmiles(smi);
    layout2D(mol);
    // As the editor holds a drawing: wedges and coordinates, nothing recorded.
    for (const a of mol.atoms()) a.chirality = null;
    for (const b of mol.bonds()) b.ez = null;
    const out = writeSmiles(mol);
    assert.ok(await sameStereo(parseSmiles(smi), parseSmiles(out)), `${smi} -> ${out}`);
  });
}

test('ring cis and trans stay apart through drawing and writing', async () => {
  const { layout2D } = await import('../src/layout.ts');
  const drawn = (smi: string) => { const m = parseSmiles(smi); layout2D(m); for (const a of m.atoms()) a.chirality = null; return writeSmiles(m); };
  const cis = drawn('C[C@H]1CC[C@@H](C)CC1'), trans = drawn('C[C@H]1CC[C@H](C)CC1');
  assert.ok(await sameStereo(parseSmiles('C[C@H]1CC[C@@H](C)CC1'), parseSmiles(cis)), cis);
  assert.ok(await sameStereo(parseSmiles('C[C@H]1CC[C@H](C)CC1'), parseSmiles(trans)), trans);
  assert.ok(!(await sameStereo(parseSmiles(cis), parseSmiles(trans))), `${cis} vs ${trans}`);
});

test('a drawing without wedges writes no tetrahedral stereo', async () => {
  const { layout2D } = await import('../src/layout.ts');
  const mol = parseSmiles('CC(N)C(=O)O');
  layout2D(mol);
  assert.doesNotMatch(writeSmiles(mol), /@/);
});

test('non-stereogenic double bonds get no marks', async () => {
  const { layout2D } = await import('../src/layout.ts');
  for (const smi of ['CC(C)=CC', 'C=CC', 'CC(=O)C']) {
    const mol = parseSmiles(smi);
    layout2D(mol);
    assert.doesNotMatch(writeSmiles(mol), /\/|\\/, smi);
  }
});

test('substructures are found whichever way the double bonds are drawn', async () => {
  const { substructureMatches } = await import('../src/isomorphism.ts');
  const aspirin = parseSmiles('CC(=O)Oc1ccccc1C(=O)O');
  // The acid and the ester both have C(=O)O.
  assert.equal(substructureMatches(parseSmiles('C(=O)O'), aspirin).length, 2);
  // Only the acid's carbon sits on the ring (the ester joins it through O).
  assert.equal(substructureMatches(parseSmiles('OC(=O)c1ccccc1'), aspirin).length, 1);
  assert.equal(substructureMatches(parseSmiles('C1=CC=CC=C1'), aspirin).length, 1);
  assert.equal(substructureMatches(parseSmiles('N'), aspirin).length, 0);
  const m = substructureMatches(parseSmiles('CC(=O)O'), aspirin);
  assert.ok(m.every((x) => x.atoms.length === 4 && x.bonds.length === 3));
  // Chains stay out of aromatic rings; the isobutyl group is found once in ibuprofen.
  const ibuprofen = parseSmiles('CC(C)Cc1ccc(cc1)C(C)C(=O)O');
  assert.equal(substructureMatches(parseSmiles('CC(C)C'), ibuprofen).length, 1);
  assert.equal(substructureMatches(parseSmiles('CC(C)C'), ibuprofen)[0]!.atoms.length, 4);
  // Bond orders count outside rings: the ester's C(=O)OC is not in the acid.
  assert.equal(substructureMatches(parseSmiles('C(=O)OC'), ibuprofen).length, 0);
  // Aspirin's ester oxygen sits on the ring: an aryl ester, not C(=O)OC (aliphatic C).
  assert.equal(substructureMatches(parseSmiles('C(=O)OC'), aspirin).length, 0);
  assert.equal(substructureMatches(parseSmiles('CC(=O)Oc1ccccc1'), aspirin).length, 1);
  // Five-membered heteroaromatics, and fused rings whichever bond the drawing makes double.
  assert.equal(substructureMatches(parseSmiles('c1cc[nH]c1'), parseSmiles('c1ccc2[nH]ccc2c1')).length, 1);
  assert.equal(substructureMatches(parseSmiles('c1ccccc1'), parseSmiles('C1=CC2=CC=CC=C2C=C1')).length, 2);
  // Charges count where the fragment has one.
  assert.equal(substructureMatches(parseSmiles('[O-]'), parseSmiles('CC(=O)[O-]')).length, 1);
  assert.equal(substructureMatches(parseSmiles('[O-]'), parseSmiles('CC(=O)O')).length, 0);
});
