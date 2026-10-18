/**
 * Visual comparison fixtures. Writes the same molecules as CDXML (open in
 * ChemDraw) and SVG (our renderer) so the two can be compared side by side.
 *
 *   node --experimental-strip-types tools/visual/fixtures.ts <outdir>
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Molecule, DEFAULT_STYLE, writeCdxml, type AtomId, type BondInit } from '../../packages/core/src/index.ts';
import { depict, toSvg } from '../../packages/render/src/index.ts';

import type { DrawingStyle } from '../../packages/core/src/index.ts';

let L = DEFAULT_STYLE.bondLength;
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Place an atom at angle `deg` (screen coords, 0 = right, 90 = down) from atom `from`. */
function grow(mol: Molecule, from: AtomId, deg: number, element = 'C', bond: Partial<BondInit> = {}, extra = {}) {
  const a = mol.atom(from);
  const b = mol.addAtom({ element, x: a.x + L * Math.cos(rad(deg)), y: a.y + L * Math.sin(rad(deg)), ...extra });
  mol.addBond({ begin: from, end: b.id, ...bond });
  return b.id;
}

function ring(mol: Molecule, cx: number, cy: number, startDeg: number, n = 6): AtomId[] {
  const R = L / (2 * Math.sin(Math.PI / n));
  const ids: AtomId[] = [];
  for (let i = 0; i < n; i++) {
    const t = rad(startDeg + (360 / n) * i);
    ids.push(mol.addAtom({ element: 'C', x: cx + R * Math.cos(t), y: cy + R * Math.sin(t) }).id);
  }
  for (let i = 0; i < n; i++) mol.addBond({ begin: ids[i]!, end: ids[(i + 1) % n]! });
  return ids;
}

/** Build the calibration fixture: every bond and label case measured against ChemDraw. */
export function buildFixture(style: DrawingStyle = DEFAULT_STYLE): Molecule {
L = style.bondLength;
const mol = new Molecule();

// 1. Paracetamol, Kekule ring with pointy top.
{
  const r = ring(mol, 120, 90, -30);
  for (const [i, j] of [[0, 1], [2, 3], [4, 5]] as const) mol.bondBetween(r[i]!, r[j]!)!.order = 2;
  grow(mol, r[0]!, -30, 'O');
  const n = grow(mol, r[3]!, 150, 'N');
  const c = grow(mol, n, 210);
  grow(mol, c, 270, 'O', { order: 2 });
  grow(mol, c, 150);
}

// 2. 3-Cyanoacrylic acid: N#C-CH=CH-C(=O)OH, zigzag along x.
{
  const n = mol.addAtom({ element: 'N', x: 40, y: 190 }).id;
  const c1 = grow(mol, n, -30, 'C', { order: 3 });
  const c2 = grow(mol, c1, -30);
  const c3 = grow(mol, c2, 30, 'C', { order: 2 });
  const c4 = grow(mol, c3, -30);
  grow(mol, c4, -90, 'O', { order: 2 });
  grow(mol, c4, 30, 'O');
}

// 3. L-alanine: wedge from the stereocentre to NH2.
{
  const ca = mol.addAtom({ element: 'C', x: 200, y: 190 }).id;
  grow(mol, ca, 210);
  grow(mol, ca, 90, 'N', { display: 'wedgeBegin' });
  const c = grow(mol, ca, -30);
  grow(mol, c, -90, 'O', { order: 2 });
  grow(mol, c, 30, 'O');
}

// 4. Cyclohexene with a wedge to a bare methyl and a hash to OH.
{
  const r = ring(mol, 290, 90, 0);
  mol.bondBetween(r[1]!, r[2]!)!.order = 2;
  grow(mol, r[4]!, -60, 'C', { display: 'wedgeBegin' });
  grow(mol, r[5]!, 0, 'O', { display: 'hashBegin' });
}

// 5. Bold bond, wavy bond and a carbocation, on a small chain.
{
  const a = mol.addAtom({ element: 'C', x: 270, y: 200 }).id;
  const b = grow(mol, a, -30, 'C', { display: 'bold' });
  const c = grow(mol, b, 30, 'C', {}, { charge: 1 });
  grow(mol, c, -30, 'C', { display: 'wavy' });
}

// 6. Terminal vinyl on a chain: does the inner line trim at a bare CH2?
{
  const a = mol.addAtom({ element: 'C', x: 40, y: 260 }).id;
  const b = grow(mol, a, -30);
  const c = grow(mol, b, 30);
  grow(mol, c, -30, 'C', { order: 2 });
}

// 7. Furan-like five-membered ring: trim at 108 degrees, O in the ring.
{
  const r = ring(mol, 140, 260, -90, 5);
  mol.atom(r[0]!).element = 'O';
  mol.bondBetween(r[1]!, r[2]!)!.order = 2;
  mol.bondBetween(r[3]!, r[4]!)!.order = 2;
}

// 8. Naphthalene, Kekule: which ring the shared bond's second line goes into.
{
  const r1 = ring(mol, 210, 260, -30);
  const c2 = { x: 210 + 2 * L * Math.cos(Math.PI / 6), y: 260 };
  const ids = [-90, -30, 30, 90].map((deg) =>
    mol.addAtom({ element: 'C', x: c2.x + L * Math.cos(rad(deg)), y: c2.y + L * Math.sin(rad(deg)) }).id);
  mol.addBond({ begin: r1[0]!, end: ids[0]! });
  mol.addBond({ begin: ids[0]!, end: ids[1]!, order: 2 });
  mol.addBond({ begin: ids[1]!, end: ids[2]! });
  mol.addBond({ begin: ids[2]!, end: ids[3]!, order: 2 });
  mol.addBond({ begin: ids[3]!, end: r1[1]! });
  mol.bondBetween(r1[0]!, r1[1]!)!.order = 2;
  mol.bondBetween(r1[2]!, r1[3]!)!.order = 2;
  mol.bondBetween(r1[4]!, r1[5]!)!.order = 2;
}

// 9. Nicknames attached from the left and from the right.
{
  const a = mol.addAtom({ element: 'C', x: 300, y: 260 }).id;
  const b = grow(mol, a, -30);
  grow(mol, b, 30, 'C', {}, { label: 'CO2Me' });
  grow(mol, a, 150, 'C', {}, { label: 'OMe' });
}

return mol;
}

// CLI: node --experimental-strip-types tools/visual/fixtures.ts <outdir> [styleJSON] [name]
if (import.meta.url === `file://${process.argv[1]}`) {
  const style = { ...DEFAULT_STYLE, ...(process.argv[3] ? JSON.parse(process.argv[3]) : {}) };
  const mol = buildFixture(style);
  const out = process.argv[2] ?? '.';
  mkdirSync(out, { recursive: true });
  const name = process.argv[4] ?? 'fixtures';
  writeFileSync(join(out, `${name}.cdxml`), writeCdxml(mol, style));
  writeFileSync(join(out, `${name}.svg`), toSvg(depict(mol, style), { background: '#fff' }));
  console.log(`atoms=${mol.atomCount} bonds=${mol.bondCount} -> ${out}`);
}
