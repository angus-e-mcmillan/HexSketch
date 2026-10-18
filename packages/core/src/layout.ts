import type { AtomId, Molecule } from './model.ts';
import { perceiveRings, type Ring } from './rings.ts';
import { perceiveStereoFromGeometry } from './stereo.ts';

/**
 * 2D coordinate generation in ChemDraw's style: regular rings (benzene with a
 * vertex up), trans zigzag chains whose first bond leaves at -30 degrees,
 * substituents in the widest free gap, fused rings built outward across
 * shared bonds. A final pass removes clashes by flipping branches about
 * rotatable bonds. Coordinates are points, y down, bond length L.
 */

type P = { x: number; y: number };
const DEG = Math.PI / 180;
const ang = (a: P, b: P) => Math.atan2(b.y - a.y, b.x - a.x);
const norm = (t: number) => { while (t <= -Math.PI) t += 2 * Math.PI; while (t > Math.PI) t -= 2 * Math.PI; return t; };

export function layout2D(mol: Molecule, L = 18.43): void {
  const rings = perceiveRings(mol);
  const ringSystems = systemsOf(mol, rings);
  const sysOf = new Map<AtomId, number>();
  ringSystems.forEach((s, i) => s.atoms.forEach((a) => sysOf.set(a, i)));
  const pos = new Map<AtomId, P>();
  const placedSys = new Set<number>();
  const turn = new Map<AtomId, number>();

  let offsetX = 0;
  for (const fragment of mol.fragments()) {
    const local = new Map<AtomId, P>();
    // Seed: the largest ring system in the fragment, else one end of the longest chain.
    const fragSys = [...new Set(fragment.map((a) => sysOf.get(a)).filter((x): x is number => x !== undefined))];
    const queue: AtomId[] = [];
    if (fragSys.length) {
      const seed = fragSys.sort((a, b) => ringSystems[b]!.atoms.length - ringSystems[a]!.atoms.length)[0]!;
      for (const [id, p] of layoutRingSystem(mol, ringSystems[seed]!, L)) local.set(id, p);
      placedSys.add(seed);
      queue.push(...ringSystems[seed]!.atoms);
    } else {
      const start = longestPathEnd(mol, fragment);
      local.set(start, { x: 0, y: 0 });
      queue.push(start);
    }

    while (queue.length) {
      const x = queue.shift()!;
      const px = local.get(x)!;
      const kids = mol.neighbours(x).filter((n) => !local.has(n));
      if (!kids.length) continue;
      const placedNbrs = mol.neighbours(x).filter((n) => local.has(n));
      // Heavier branches take the straightest directions.
      kids.sort((a, b) => subtreeSize(mol, b, x, local) - subtreeSize(mol, a, x, local));
      const dirs = childDirections(mol, x, placedNbrs, kids, local, turn);
      kids.forEach((k, i) => {
        const t = dirs[i]!;
        const target = { x: px.x + L * Math.cos(t), y: px.y + L * Math.sin(t) };
        const s = sysOf.get(k);
        if (s !== undefined && !placedSys.has(s)) {
          // Attach a whole ring system rigidly: k at target, system centre further out along t.
          const sys = layoutRingSystem(mol, ringSystems[s]!, L);
          const c = centroid([...sys.values()]);
          const pk = sys.get(k)!;
          const rot = t - ang(c, pk) + Math.PI; // make centre->k point back at x
          for (const [id, p] of sys) {
            const dx = p.x - pk.x, dy = p.y - pk.y;
            local.set(id, { x: target.x + dx * Math.cos(rot) - dy * Math.sin(rot), y: target.y + dx * Math.sin(rot) + dy * Math.cos(rot) });
          }
          placedSys.add(s);
          queue.push(...ringSystems[s]!.atoms);
        } else if (!local.has(k)) {
          local.set(k, target);
          queue.push(k);
        }
      });
    }

    resolveClashes(mol, fragment, local, L);
    orientHorizontally(local);
    // Lay fragments out left to right.
    const xs = [...local.values()].map((p) => p.x);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    for (const [id, p] of local) pos.set(id, { x: p.x - minX + offsetX, y: p.y });
    offsetX += maxX - minX + 2 * L;
  }
  // Keep recorded stereo (from SMILES or a file) before coordinates replace it.
  const wantChiral = new Map([...mol.atoms()].filter((a) => a.chirality).map((a) => [a.id, { ...a.chirality! }]));
  const wantEz = new Map([...mol.bonds()].filter((b) => b.ez).map((b) => [b.id, { ...b.ez! }]));
  for (const [id, p] of pos) { const a = mol.atom(id); a.x = p.x; a.y = p.y; }
  enforceDoubleBondGeometry(mol, wantEz);
  assignWedges(mol, wantChiral);
}

/**
 * Turn a fragment so its long axis lies horizontal, in 60 degree steps: that
 * keeps hexagons vertex-up and chain bonds on ChemDraw's 30 degree grid.
 */
function orientHorizontally(pos: Map<AtomId, P>): void {
  const ps = [...pos.values()];
  if (ps.length < 3) return;
  const c = centroid(ps);
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of ps) { const dx = p.x - c.x, dy = p.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (Math.abs(sxx - syy) < 1e-6 && Math.abs(sxy) < 1e-6) return;
  let best = 0, bestErr = Infinity;
  for (const k of [0, 1, -1, 2, -2, 3]) {
    const r = k * 60 * DEG;
    let t = norm(axis + r);
    if (t > Math.PI / 2) t -= Math.PI; else if (t < -Math.PI / 2) t += Math.PI;
    const err = Math.abs(t) + Math.abs(k) * 1e-3; // prefer no rotation on ties
    if (err < bestErr - 1e-6) { bestErr = err; best = r; }
  }
  if (!best) return;
  const cos = Math.cos(best), sin = Math.sin(best);
  for (const [id, p] of pos) {
    const dx = p.x - c.x, dy = p.y - c.y;
    pos.set(id, { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos });
  }
}

/** Make drawn cis/trans agree with recorded geometry, mirroring one side of the bond if needed. */
function enforceDoubleBondGeometry(mol: Molecule, want: Map<number, { ref: [AtomId, AtomId]; cis: boolean }>): void {
  for (const [bondId, ez] of want) {
    const b = mol.bond(bondId);
    const A = mol.atom(b.begin), B = mol.atom(b.end);
    const side = (id: AtomId) => { const P = mol.atom(id); return Math.sign((B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x)); };
    if (!mol.hasAtom(ez.ref[0]) || !mol.hasAtom(ez.ref[1])) continue;
    const cisNow = side(ez.ref[0]) === side(ez.ref[1]);
    if (cisNow === ez.cis || inRing(mol, b.begin, b.end)) continue;
    // Mirror the smaller side (everything beyond the end atom) across the bond axis.
    const beyondEnd = sideOf(mol, b.end, b.begin);
    const beyondBegin = sideOf(mol, b.begin, b.end);
    const flip = beyondEnd.size <= beyondBegin.size ? beyondEnd : beyondBegin;
    const pos = new Map([...flip].map((id) => [id, { x: mol.atom(id).x, y: mol.atom(id).y }]));
    mirror(flip, { x: A.x, y: A.y }, { x: B.x, y: B.y }, pos);
    for (const [id, p] of pos) { mol.atom(id).x = p.x; mol.atom(id).y = p.y; }
  }
}

/**
 * Put a wedge or hash on one bond of each recorded stereocentre so the drawing
 * means the same configuration: try a wedge, compare the configuration it
 * implies with the recorded one, and use a hash instead if they disagree.
 */
export function assignWedges(mol: Molecule, want: Map<AtomId, { order: AtomId[]; anticlockwise: boolean }>): void {
  const parity = (from: AtomId[], to: AtomId[]) => {
    const p = from.map((x) => to.indexOf(x));
    let swaps = 0;
    for (let i = 0; i < p.length; i++) while (p[i] !== i) { const j = p[i]!; [p[i], p[j]] = [p[j]!, p[i]!]; swaps++; }
    return swaps % 2;
  };
  const used = new Set<number>();
  for (const [centre, ch] of want) {
    // Prefer an acyclic bond to a terminal-ish neighbour that is not itself a stereocentre.
    const candidates = mol.incidentBonds(centre)
      .filter((b) => mol.bond(b).order === 1 && !used.has(b))
      .sort((x, y) => score(y) - score(x));
    function score(b: number) {
      const n = mol.otherAtom(mol.bond(b), centre);
      return (inRing(mol, centre, n) ? 0 : 4) + (want.has(n) ? 0 : 2) + (mol.neighbours(n).length === 1 ? 1 : 0);
    }
    const bondId = candidates[0];
    if (bondId === undefined) continue;
    const b = mol.bond(bondId);
    const narrowAtBegin = b.begin === centre;
    for (const kind of ['wedge', 'hash'] as const) {
      b.display = kind === 'wedge' ? (narrowAtBegin ? 'wedgeBegin' : 'wedgeEnd') : (narrowAtBegin ? 'hashBegin' : 'hashEnd');
      perceiveStereoFromGeometry(mol);
      const got = mol.atom(centre).chirality;
      if (got && got.order.length === 4 && ch.order.every((x) => got.order.includes(x))) {
        const same = (got.anticlockwise === ch.anticlockwise) === (parity(got.order, ch.order) === 0);
        if (same) break;
      }
    }
    used.add(bondId);
  }
  // Leave the recorded configurations in place for callers that read them.
  for (const [id, ch] of want) mol.atom(id).chirality = ch;
}

interface RingSystem { atoms: AtomId[]; rings: Ring[] }

function systemsOf(mol: Molecule, rings: Ring[]): RingSystem[] {
  const out: RingSystem[] = [];
  const used = new Set<number>();
  rings.forEach((r, i) => {
    if (used.has(i)) return;
    const members = [i]; used.add(i);
    const atoms = new Set(r.atoms);
    for (let k = 0; k < members.length; k++) {
      rings.forEach((r2, j) => {
        if (used.has(j)) return;
        if (r2.atoms.some((a) => atoms.has(a))) { used.add(j); members.push(j); r2.atoms.forEach((a) => atoms.add(a)); }
      });
    }
    out.push({ atoms: [...atoms], rings: members.map((m) => rings[m]!) });
  });
  void mol;
  return out;
}

/** Regular polygons, fused outward across shared edges, spiro rings off a shared atom. */
function layoutRingSystem(mol: Molecule, sys: RingSystem, L: number): Map<AtomId, P> {
  const p = new Map<AtomId, P>();
  const rings = [...sys.rings].sort((a, b) => b.atoms.length - a.atoms.length);
  const first = rings.find((r) => r.atoms.length === 6) ?? rings[0]!;
  polygon(first.atoms, { x: 0, y: 0 }, L, -Math.PI / 2).forEach((q, i) => p.set(first.atoms[i]!, q));
  const done = new Set<Ring>([first]);
  for (let guard = 0; guard < rings.length * 3 && done.size < rings.length; guard++) {
    for (const r of rings) {
      if (done.has(r)) continue;
      const placed = r.atoms.filter((a) => p.has(a));
      if (!placed.length) continue;
      const n = r.atoms.length;
      const R = L / (2 * Math.sin(Math.PI / n));
      const existingCentre = centroid([...p.values()]);
      if (placed.length === 1) {
        // Spiro: ring continues outward from the shared atom.
        const a = placed[0]!;
        const out = ang(existingCentre, p.get(a)!);
        const c = { x: p.get(a)!.x + R * Math.cos(out), y: p.get(a)!.y + R * Math.sin(out) };
        const k = r.atoms.indexOf(a);
        polygon(rotateTo(r.atoms, k), c, L, out + Math.PI).forEach((q, i) => { const id = rotateTo(r.atoms, k)[i]!; if (!p.has(id)) p.set(id, q); });
      } else {
        // Fused (or bridged): build the polygon on a shared edge, away from what exists.
        const k = r.atoms.findIndex((a, i) => p.has(a) && p.has(r.atoms[(i + 1) % n]!));
        if (k < 0) continue;
        const a = r.atoms[k]!, b = r.atoms[(k + 1) % n]!;
        const pa = p.get(a)!, pb = p.get(b)!;
        const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
        const nrm = { x: -(pb.y - pa.y) / L, y: (pb.x - pa.x) / L };
        const inr = L / (2 * Math.tan(Math.PI / n));
        const side = (mid.x + nrm.x - existingCentre.x) ** 2 + (mid.y + nrm.y - existingCentre.y) ** 2 > (mid.x - nrm.x - existingCentre.x) ** 2 + (mid.y - nrm.y - existingCentre.y) ** 2 ? 1 : -1;
        const c = { x: mid.x + side * nrm.x * inr, y: mid.y + side * nrm.y * inr };
        // Walk the ring from b onward, stepping round the centre away from a.
        const start = ang(c, pb), step = 2 * Math.PI / n;
        const dirSign = Math.abs(norm(start - step - ang(c, pa))) < 1e-3 ? 1 : -1;
        for (let i = 1; i < n - 1; i++) {
          const id = r.atoms[(k + 1 + i) % n]!;
          if (p.has(id)) continue;
          const t = start + dirSign * step * i;
          p.set(id, { x: c.x + R * Math.cos(t), y: c.y + R * Math.sin(t) });
        }
      }
      done.add(r);
    }
  }
  // Anything still unplaced (unusual bridged systems): park near the centroid.
  const c = centroid([...p.values()]);
  sys.atoms.forEach((a, i) => { if (!p.has(a)) p.set(a, { x: c.x + (i % 3) * L * 0.5, y: c.y + L * 0.5 }); });
  void mol;
  return p;
}

const rotateTo = <T>(arr: T[], k: number) => [...arr.slice(k), ...arr.slice(0, k)];

function polygon(atoms: AtomId[], c: P, L: number, start: number): P[] {
  const n = atoms.length;
  const R = L / (2 * Math.sin(Math.PI / n));
  return atoms.map((_, i) => ({ x: c.x + R * Math.cos(start + (2 * Math.PI * i) / n), y: c.y + R * Math.sin(start + (2 * Math.PI * i) / n) }));
}

function centroid(ps: P[]): P {
  return { x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length };
}

/** Directions for unplaced neighbours of x, ChemDraw style. */
function childDirections(mol: Molecule, x: AtomId, placed: AtomId[], kids: AtomId[], pos: Map<AtomId, P>, turn: Map<AtomId, number>): number[] {
  const px = pos.get(x)!;
  if (!placed.length) {
    // Chain start: first bond at -30 degrees; further kids spread round.
    return kids.map((_, i) => -30 * DEG + i * (2 * Math.PI / Math.max(kids.length, 3)));
  }
  const linear = mol.incidentBonds(x).some((b) => mol.bond(b).order === 3)
    || mol.incidentBonds(x).filter((b) => mol.bond(b).order === 2).length === 2;
  if (placed.length === 1) {
    const back = ang(px, pos.get(placed[0]!)!);
    if (linear && kids.length === 1) return [norm(back + Math.PI)];
    if (kids.length === 1) {
      // Trans zigzag: turn the opposite way from the parent.
      const parentTurn = turn.get(placed[0]!) ?? 1;
      const t = -parentTurn;
      turn.set(x, t);
      return [norm(back + t * 120 * DEG)];
    }
    if (kids.length === 2) { turn.set(x, 1); return [norm(back + 120 * DEG), norm(back - 120 * DEG)]; }
    return kids.map((_, i) => norm(back + (90 + 90 * i) * DEG));
  }
  // Two or more placed neighbours (ring atoms): spread kids evenly in the widest gap.
  const angles = placed.map((n) => ang(px, pos.get(n)!)).sort((a, b) => a - b);
  let gapStart = 0, gap = -1;
  angles.forEach((a, i) => {
    const b = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
    if (b - a > gap) { gap = b - a; gapStart = a; }
  });
  if (kids.length === 1) return [norm(gapStart + gap / 2)];
  const spread = Math.min(gap / (kids.length + 1), 60 * DEG);
  const mid = gapStart + gap / 2;
  return kids.map((_, i) => norm(mid + (i - (kids.length - 1) / 2) * spread));
}

function subtreeSize(mol: Molecule, start: AtomId, from: AtomId, placed: Map<AtomId, P>): number {
  const seen = new Set([from, start]);
  const stack = [start];
  while (stack.length) { const a = stack.pop()!; for (const n of mol.neighbours(a)) if (!seen.has(n) && !placed.has(n)) { seen.add(n); stack.push(n); } }
  return seen.size - 1;
}

function longestPathEnd(mol: Molecule, fragment: AtomId[]): AtomId {
  const far = (s: AtomId) => {
    const d = new Map<AtomId, number>([[s, 0]]);
    const q = [s];
    while (q.length) { const x = q.shift()!; for (const y of mol.neighbours(x)) if (!d.has(y)) { d.set(y, d.get(x)! + 1); q.push(y); } }
    return [...d.entries()].sort((a, b) => b[1] - a[1])[0]![0];
  };
  return far(far(fragment[0]!));
}

/** Flip branches about rotatable bonds until no two atoms sit on top of each other. */
function resolveClashes(mol: Molecule, fragment: AtomId[], pos: Map<AtomId, P>, L: number): void {
  const minD = 0.55 * L;
  const clashes = () => {
    const out: [AtomId, AtomId][] = [];
    for (let i = 0; i < fragment.length; i++) for (let j = i + 1; j < fragment.length; j++) {
      const a = fragment[i]!, b = fragment[j]!;
      const pa = pos.get(a)!, pb = pos.get(b)!;
      if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < minD && !mol.bondBetween(a, b)) out.push([a, b]);
    }
    return out;
  };
  for (let iter = 0; iter < 30; iter++) {
    const cs = clashes();
    if (!cs.length) return;
    const [a, b] = cs[0]!;
    const path = shortestPath(mol, a, b);
    let fixed = false;
    // Try each rotatable bond on the path: mirror the side containing b across that bond's axis.
    for (let i = 0; i + 1 < path.length && !fixed; i++) {
      const u = path[i]!, v = path[i + 1]!;
      const bond = mol.bondBetween(u, v)!;
      if (bond.order !== 1 || inRing(mol, u, v)) continue;
      const side = sideOf(mol, v, u);
      if (side.has(a)) continue;
      const before = cs.length;
      const saved = new Map([...side].map((id) => [id, pos.get(id)!]));
      mirror(side, pos.get(u)!, pos.get(v)!, pos);
      if (clashes().length < before) fixed = true; else for (const [id, p] of saved) pos.set(id, p);
    }
    if (!fixed) return;
  }
}

function mirror(ids: Set<AtomId>, a: P, b: P, pos: Map<AtomId, P>) {
  const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
  for (const id of ids) {
    const p = pos.get(id)!;
    const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
    const fx = a.x + t * dx, fy = a.y + t * dy;
    pos.set(id, { x: 2 * fx - p.x, y: 2 * fy - p.y });
  }
}

function sideOf(mol: Molecule, start: AtomId, blocked: AtomId): Set<AtomId> {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length) { const x = stack.pop()!; for (const y of mol.neighbours(x)) if (y !== blocked && !seen.has(y)) { seen.add(y); stack.push(y); } }
  return seen;
}

function shortestPath(mol: Molecule, a: AtomId, b: AtomId): AtomId[] {
  const prev = new Map<AtomId, AtomId>([[a, a]]);
  const q = [a];
  while (q.length) { const x = q.shift()!; if (x === b) break; for (const y of mol.neighbours(x)) if (!prev.has(y)) { prev.set(y, x); q.push(y); } }
  if (!prev.has(b)) return [];
  const path = [b];
  while (path[path.length - 1] !== a) path.push(prev.get(path[path.length - 1]!)!);
  return path.reverse();
}

function inRing(mol: Molecule, u: AtomId, v: AtomId): boolean {
  const seen = new Set([u]);
  const stack = [u];
  while (stack.length) {
    const x = stack.pop()!;
    for (const y of mol.neighbours(x)) {
      if (x === u && y === v) continue;
      if (y === v) return true;
      if (!seen.has(y)) { seen.add(y); stack.push(y); }
    }
  }
  return false;
}
