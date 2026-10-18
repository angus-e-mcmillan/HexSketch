import { isElementSymbol, perceiveRings, type AtomId, type Bond, type BondDisplay, type BondId, type BondOrder, type Molecule } from '@hexsketch/core';
import type { AtomAction, BondAction } from './hotkeys.ts';
import { SPROUTS } from './hotkeys.ts';
import { cyclicDirection, kekulize, largestGapBisector, linearDirection, ringVertices, DEFAULT_BOND_ANGLE } from './placement.ts';

/** Bond tool flavours, as on ChemDraw's tool palette. */
export type BondKind = 'single' | 'double' | 'triple' | 'wedge' | 'hash' | 'bold' | 'wavy' | 'dashed' | 'hashedPlain';

export function bondProps(kind: BondKind): { order: BondOrder; display: BondDisplay } {
  switch (kind) {
    case 'double': return { order: 2, display: 'plain' };
    case 'triple': return { order: 3, display: 'plain' };
    case 'wedge': return { order: 1, display: 'wedgeBegin' };
    case 'hash': return { order: 1, display: 'hashBegin' };
    case 'bold': return { order: 1, display: 'bold' };
    case 'wavy': return { order: 1, display: 'wavy' };
    case 'dashed': return { order: 1, display: 'dashed' };
    case 'hashedPlain': return { order: 1, display: 'hash' };
    default: return { order: 1, display: 'plain' };
  }
}

/** Atom at (x, y) within `tol`, if any: used to merge a new end onto an existing atom. */
export function atomNear(mol: Molecule, x: number, y: number, tol: number, exclude?: AtomId): AtomId | null {
  let best: AtomId | null = null, bestD = tol;
  for (const a of mol.atoms()) {
    if (a.id === exclude) continue;
    const d = Math.hypot(a.x - x, a.y - y);
    if (d <= bestD) { bestD = d; best = a.id; }
  }
  return best;
}

/** Add a bond from `from` in direction `angle`; reuses an atom already sitting at the new end. */
export function sproutBond(mol: Molecule, from: AtomId, angle: number, L: number, kind: BondKind = 'single'): { atom: AtomId; bond: BondId } {
  const a = mol.atom(from);
  const x = a.x + L * Math.cos(angle), y = a.y + L * Math.sin(angle);
  const existing = atomNear(mol, x, y, L * 0.25, from);
  const end = existing ?? mol.addAtom({ element: 'C', x, y }).id;
  const already = mol.bondBetween(from, end);
  if (already) return { atom: end, bond: already.id };
  const bond = mol.addBond({ begin: from, end, ...bondProps(kind) });
  return { atom: end, bond: bond.id };
}

/** Click on empty canvas with a bond tool: a bond starting at the click, at -30 degrees. */
export function bondFromPoint(mol: Molecule, x: number, y: number, L: number, kind: BondKind, angle = DEFAULT_BOND_ANGLE) {
  const start = atomNear(mol, x, y, L * 0.25) ?? mol.addAtom({ element: 'C', x, y }).id;
  return sproutBond(mol, start, angle, L, kind);
}

/** Click on an atom with a bond tool. */
export function bondFromAtom(mol: Molecule, atom: AtomId, L: number, kind: BondKind, chainAngle = 120) {
  return sproutBond(mol, atom, cyclicDirection(mol, atom, chainAngle), L, kind);
}

/**
 * Click on an existing bond with a bond tool. With the plain tool a single
 * bond becomes double and a double bond cycles its second line
 * Left -> Center -> Right -> Left (measured). Stereo tools apply their
 * display, and clicking the same stereo bond again flips its direction.
 */
export function clickBond(mol: Molecule, id: BondId, kind: BondKind): void {
  const b = mol.bond(id);
  if (kind === 'single') {
    if (b.order === 1) { b.order = 2; b.display = 'plain'; b.doubleBondPosition = 'auto'; return; }
    if (b.order === 2) {
      b.doubleBondPosition = b.doubleBondPosition === 'left' ? 'center' : b.doubleBondPosition === 'center' ? 'right' : 'left';
      return;
    }
    b.order = 1; b.display = 'plain'; return;
  }
  const props = bondProps(kind);
  if (kind === 'wedge' || kind === 'hash') {
    const want = props.display;
    const flipped: BondDisplay = want === 'wedgeBegin' ? 'wedgeEnd' : 'hashEnd';
    if (b.order === 1 && b.display === want) { b.display = flipped; return; }
    if (b.order === 1 && b.display === flipped) { b.display = want; return; }
  }
  b.order = props.order;
  b.display = props.display;
  if (props.order === 2) b.doubleBondPosition = 'auto';
}

/** Add a ring of `size` centred at a point, first vertex straight up (measured for benzene). */
export function ringAtPoint(mol: Molecule, cx: number, cy: number, size: number, aromatic: boolean, L: number) {
  const verts = ringVertices(cx, cy, size, L);
  const atoms = verts.map((v) => atomNear(mol, v.x, v.y, L * 0.25) ?? mol.addAtom({ element: 'C', x: v.x, y: v.y }).id);
  return closeRing(mol, atoms, aromatic);
}

function closeRing(mol: Molecule, atoms: AtomId[], aromatic: boolean, prefer?: BondId) {
  const bonds: BondId[] = [];
  for (let i = 0; i < atoms.length; i++) {
    const a = atoms[i]!, b = atoms[(i + 1) % atoms.length]!;
    bonds.push((mol.bondBetween(a, b) ?? mol.addBond({ begin: a, end: b })).id);
  }
  if (aromatic) kekulize(mol, atoms, bonds, prefer);
  return { atoms, bonds };
}

/**
 * Ring tool on an atom: the atom becomes a ring vertex and the ring extends
 * outward, centre one circumradius away along the free direction (for a
 * terminal atom, straight along its bond, as measured).
 */
export function ringOnAtom(mol: Molecule, atom: AtomId, size: number, aromatic: boolean, L: number) {
  const a = mol.atom(atom);
  const angles = mol.neighbours(atom).map((n) => Math.atan2(mol.atom(n).y - a.y, mol.atom(n).x - a.x));
  const dir = angles.length === 0 ? -Math.PI / 2 + Math.PI : angles.length === 1 ? angles[0]! + Math.PI : largestGapBisector(angles);
  const R = L / (2 * Math.sin(Math.PI / size));
  const cx = a.x + R * Math.cos(dir), cy = a.y + R * Math.sin(dir);
  const verts = ringVertices(cx, cy, size, L, dir + Math.PI);
  const atoms = verts.map((v, i) => (i === 0 ? atom : atomNear(mol, v.x, v.y, L * 0.25) ?? mol.addAtom({ element: 'C', x: v.x, y: v.y }).id));
  return closeRing(mol, atoms, aromatic);
}

/**
 * Ring tool on a bond: fuse a ring sharing that bond, on the side with fewer
 * substituents, centre one inradius from the bond midpoint (measured).
 */
export function ringOnBond(mol: Molecule, bond: BondId, size: number, aromatic: boolean) {
  const b = mol.bond(bond);
  const p = mol.atom(b.begin), q = mol.atom(b.end);
  const L = Math.hypot(q.x - p.x, q.y - p.y);
  const ux = (q.x - p.x) / L, uy = (q.y - p.y) / L;
  const nx = uy, ny = -ux; // left normal
  let left = 0, right = 0;
  for (const end of [b.begin, b.end]) {
    const e = mol.atom(end);
    for (const n of mol.neighbours(end)) {
      if (n === b.begin || n === b.end) continue;
      const s = (mol.atom(n).x - e.x) * nx + (mol.atom(n).y - e.y) * ny;
      if (s > 1e-6) left++; else if (s < -1e-6) right++;
    }
  }
  // Ring rings already sharing this bond take that side too.
  for (const r of perceiveRings(mol)) {
    if (!r.bonds.includes(bond)) continue;
    const cx = r.atoms.reduce((s, a) => s + mol.atom(a).x, 0) / r.atoms.length;
    const cy = r.atoms.reduce((s, a) => s + mol.atom(a).y, 0) / r.atoms.length;
    if ((cx - p.x) * nx + (cy - p.y) * ny > 0) left += 2; else right += 2;
  }
  // A lone bond takes the ring on its right, walking begin -> end (measured: hotkey 6 on a bond drawn upward).
  const side = left > right ? -1 : left < right ? 1 : -1;
  const inradius = L / (2 * Math.tan(Math.PI / size));
  const cx = (p.x + q.x) / 2 + side * nx * inradius, cy = (p.y + q.y) / 2 + side * ny * inradius;
  // Walk the ring starting at `end`, so that begin->end is one edge.
  const startAngle = Math.atan2(q.y - cy, q.x - cx);
  const R = L / (2 * Math.sin(Math.PI / size));
  const step = (2 * Math.PI) / size;
  const toward = Math.atan2(p.y - cy, p.x - cx);
  // Walk away from `begin`: if one step backwards lands on it, go forwards.
  const dirSign = Math.abs(normAngle(startAngle - step - toward)) < 1e-3 ? 1 : -1;
  const atoms: AtomId[] = [b.end];
  for (let i = 1; i < size - 1; i++) {
    const t = startAngle + dirSign * step * i;
    const x = cx + R * Math.cos(t), y = cy + R * Math.sin(t);
    atoms.push(atomNear(mol, x, y, L * 0.25) ?? mol.addAtom({ element: 'C', x, y }).id);
  }
  atoms.push(b.begin);
  return closeRing(mol, atoms, aromatic, bond);
}

const normAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Interpret a label typed or hot-keyed onto an atom. */
export function applyLabel(mol: Molecule, atom: AtomId, text: string): void {
  const a = mol.atom(atom);
  a.explicitHydrogens = null;
  if (text === 'D') { a.element = 'H'; a.isotope = 2; a.label = null; return; }
  if (isElementSymbol(text)) { a.element = text; a.label = null; a.isotope = null; return; }
  // Abbreviations (Me, Ph, OMe, CO2Me ...) and generics (R, X, ?) become nicknames.
  a.element = 'C';
  a.label = text;
}

/** Apply an atom hotkey; returns where ChemDraw's hotspot goes next. */
export function applyAtomAction(mol: Molecule, atom: AtomId, action: AtomAction, L: number, chainAngle = 120): AtomId {
  switch (action.kind) {
    case 'label': applyLabel(mol, atom, action.text); return atom;
    case 'charge': mol.atom(atom).charge += action.delta; return atom;
    case 'sprout': return sprout(mol, atom, action.value, L, chainAngle);
    case 'attachmentPoint':
    case 'atomNumber':
      return atom; // display-only features, not yet modelled
  }
}

/** What a magic sprout sees at the hotspot: how many bonds, and whether any is multiple (aromatic). */
type Site = 'bare' | 'primary' | 'secondary' | 'tertiary' | 'unsaturated';
function siteOf(mol: Molecule, atom: AtomId): Site {
  if (mol.incidentBonds(atom).some((b) => mol.bond(b).order !== 1)) return 'unsaturated';
  const deg = mol.neighbours(atom).length;
  return deg === 0 ? 'bare' : deg === 1 ? 'primary' : deg === 2 ? 'secondary' : 'tertiary';
}

const DEG = Math.PI / 180;

/**
 * Magic sprouts (hotkeys 0-9, a, z, v, u, k, K), following ChemDraw's help and
 * Magic Hotkeys Cheat Sheet. Returns the new hotspot: the atom the next key
 * acts on (the far end of the new chain, or the far vertex of a new ring).
 */
function sprout(mol: Molecule, h: AtomId, value: number, L: number, chainAngle: number): AtomId {
  const kind = SPROUTS[value];
  const site = siteOf(mol, h);
  const angleTo = (from: AtomId, to: AtomId) => Math.atan2(mol.atom(to).y - mol.atom(from).y, mol.atom(to).x - mol.atom(from).x);
  const add = (from: AtomId, angle: number, bond: BondKind = 'single') => sproutBond(mol, from, angle, L, bond);
  const toO = (r: { atom: AtomId; bond: BondId }) => { mol.atom(r.atom).element = 'O'; mol.bond(r.bond).order = 2; };
  // On a primary atom the two free zigzag positions: `zig` continues the chain, `up` is the other.
  const zigzag = (x: AtomId) => {
    const back = angleTo(x, mol.neighbours(x)[0]!);
    const zig = linearDirection(mol, x, chainAngle);
    const opts = [back + chainAngle * DEG, back - chainAngle * DEG];
    const up = opts.reduce((p, q) => (Math.abs(normAngle(q - zig)) > Math.abs(normAngle(p - zig)) ? q : p));
    return { back, zig, up };
  };
  // Tertiary, aromatic or bare: a C-C bond first, then the group on its end.
  const bridge = () => add(h, cyclicDirection(mol, h, chainAngle)).atom;
  const onPrimary = (fn: (x: AtomId) => AtomId) => fn(site === 'primary' ? h : bridge());
  // New ring through x; the hotspot goes floor(n/2) vertices round from x,
  // anticlockwise on screen (measured: 7 then 9 on PhB puts the CMe2 next to the lower ring atom).
  const ring = (x: AtomId, size: number, aromatic: boolean) => {
    const r = ringOnAtom(mol, x, size, aromatic, L);
    const cx = r.atoms.reduce((s, a) => s + mol.atom(a).x, 0) / size, cy = r.atoms.reduce((s, a) => s + mol.atom(a).y, 0) / size;
    const at = (a: AtomId) => Math.atan2(mol.atom(a).y - cy, mol.atom(a).x - cx);
    const want = at(x) - Math.floor(size / 2) * (2 * Math.PI / size);
    return r.atoms.reduce((p, q) => (Math.abs(normAngle(at(q) - want)) < Math.abs(normAngle(at(p) - want)) ? q : p));
  };
  // Two new bonds splitting the free gap of a secondary atom, 30 degrees either
  // side of its bisector; the hotspot takes the clockwise one (measured, and as on the cheat sheet).
  const pair = (x: AtomId) => {
    const mid = largestGapBisector(mol.neighbours(x).map((n) => angleTo(x, n)));
    return [mid - 30 * DEG, mid + 30 * DEG] as const;
  };

  switch (kind) {
    case 'methylCyclic': return add(h, cyclicDirection(mol, h, chainAngle)).atom;
    case 'methylLinear': return add(h, linearDirection(mol, h, chainAngle)).atom;
    case 'methylidene': return add(h, cyclicDirection(mol, h, chainAngle), 'double').atom;
    case 'alkyne': {
      const nbrs = mol.neighbours(h);
      const dir = nbrs.length === 1 ? angleTo(h, nbrs[0]!) + Math.PI : cyclicDirection(mol, h, chainAngle);
      return add(h, dir, 'triple').atom;
    }
    case 'carbonyl': {
      // Secondary: C=O on the hotspot. Otherwise an acetyl: hotspot (or a new carbon) becomes the C=O.
      if (site === 'secondary') { toO(add(h, cyclicDirection(mol, h, chainAngle))); return h; }
      return onPrimary((x) => { const z = zigzag(x); toO(add(x, z.up)); return add(x, z.zig).atom; });
    }
    case 'phenyl': return onPrimary((x) => ring(x, 6, true));
    case 'cyclohexyl': case 'cyclopentyl': case 'cyclopropyl': case 'cyclobutyl': {
      const size = { cyclohexyl: 6, cyclopentyl: 5, cyclopropyl: 3, cyclobutyl: 4 }[kind];
      // Secondary: spiro ring on the hotspot.
      return site === 'secondary' ? ring(h, size, false) : onPrimary((x) => ring(x, size, false));
    }
    case 'wedge': case 'hashedWedge': {
      const bond: BondKind = kind === 'wedge' ? 'wedge' : 'hash';
      if (site === 'secondary') return add(h, cyclicDirection(mol, h, chainAngle), bond).atom;
      if (site === 'tertiary') {
        // Vertical, on whichever side is further from the existing bonds (measured: up on a ring fusion carbon).
        const angles = mol.neighbours(h).map((n) => angleTo(h, n));
        const clearance = (d: number) => Math.min(...angles.map((a) => Math.abs(normAngle(a - d))));
        return add(h, clearance(-Math.PI / 2) >= clearance(Math.PI / 2) ? -Math.PI / 2 : Math.PI / 2, bond).atom;
      }
      return onPrimary((x) => { const z = zigzag(x); add(x, z.up, bond); return add(x, z.zig).atom; });
    }
    case 'dimethyl': {
      if (site === 'secondary') { const [p, q] = pair(h); add(h, p); return add(h, q).atom; }
      return onPrimary((x) => { const z = zigzag(x); add(x, z.up); return add(x, z.zig).atom; });
    }
    case 'tBu': {
      if (site === 'secondary') { const [p, q] = pair(h); add(h, p, 'wedge'); return add(h, q, 'hash').atom; }
      return onPrimary((x) => {
        const back = angleTo(x, mol.neighbours(x)[0]!);
        add(x, back + Math.PI / 2); add(x, back - Math.PI / 2);
        return add(x, back + Math.PI).atom;
      });
    }
    case 'sulfonyl': return onPrimary((x) => {
      const z = zigzag(x);
      mol.atom(x).element = 'S'; mol.atom(x).label = null;
      const next = add(x, z.zig).atom;
      const [p, q] = pair(x);
      toO(add(x, p)); toO(add(x, q));
      return next;
    });
    default: return add(h, cyclicDirection(mol, h, chainAngle)).atom;
  }
}

/** Apply a bond hotkey; returns where the hotspot goes next (the far bond of a fused ring, else this bond). */
export function applyBondAction(mol: Molecule, bond: BondId, action: BondAction): BondId {
  const b: Bond = mol.bond(bond);
  switch (action.kind) {
    case 'order': b.order = action.order; if (action.order !== 1) b.display = 'plain'; return bond;
    case 'doublePosition': if (b.order === 2) b.doubleBondPosition = action.position; return bond;
    case 'front': return bond;
    case 'fuseRing': {
      if (action.size < 3) return bond;
      // The ring's bonds run from this bond's end round to its begin; the opposite one is half way.
      const r = ringOnBond(mol, bond, action.size, false);
      return r.bonds[Math.max(0, Math.floor(action.size / 2) - 1)]!;
    }
    case 'display': {
      const map: Record<string, BondDisplay> = {
        dashed: 'dashed', hash: 'hash', bold: 'bold', wavy: 'wavy', wedge: 'wedgeBegin', hashedWedge: 'hashBegin',
        tautomeric: 'dashed', doubleBold: 'bold',
      };
      b.order = action.display === 'tautomeric' ? 1.5 : 1;
      b.display = map[action.display] ?? 'plain';
      return bond;
    }
  }
}

/** Delete atoms and bonds, then drop any carbons left with no bonds. */
export function erase(mol: Molecule, atoms: Iterable<AtomId>, bonds: Iterable<BondId>): void {
  const touched = new Set<AtomId>();
  for (const b of bonds) {
    if (!mol.hasBond(b)) continue;
    const bd = mol.bond(b);
    touched.add(bd.begin); touched.add(bd.end);
    mol.removeBond(b);
  }
  for (const a of atoms) mol.removeAtom(a);
  for (const a of touched) {
    if (mol.hasAtom(a) && mol.neighbours(a).length === 0 && mol.atom(a).element === 'C' && mol.atom(a).label === null) mol.removeAtom(a);
  }
}
