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
      const dirs = childDirections(mol, x, placedNbrs, kids, local, turn, rings);
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
  // Placing wedges reads the drawing, which gives every double bond a geometry: put back what
  // was recorded, and nothing where nothing was (a SMILES that left a double bond open).
  for (const bd of mol.bonds()) bd.ez = wantEz.get(bd.id) ?? null;
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
export function assignWedges(mol: Molecule, want: Map<AtomId, { order: AtomId[]; anticlockwise: boolean }>, prefer: ReadonlySet<AtomId> = new Set(), opts: { plainOnly?: boolean } = {}): void {
  const parity = (from: AtomId[], to: AtomId[]) => {
    const p = from.map((x) => to.indexOf(x));
    let swaps = 0;
    for (let i = 0; i < p.length; i++) while (p[i] !== i) { const j = p[i]!; [p[i], p[j]] = [p[j]!, p[i]!]; swaps++; }
    return swaps % 2;
  };
  const used = new Set<number>();
  // Which rings hold each bond, so a fused stereocentre keeps its smaller ring flat.
  const rings = perceiveRings(mol);
  const ringsOf = (u: AtomId, v: AtomId) => rings.filter((r) => {
    const i = r.atoms.indexOf(u), j = r.atoms.indexOf(v);
    if (i < 0 || j < 0) return false;
    const d = Math.abs(i - j);
    return d === 1 || d === r.atoms.length - 1;
  });
  for (const [centre, ch] of want) {
    // Prefer an acyclic bond to a terminal-ish neighbour that is not itself a stereocentre, and one in `prefer` (a side chain) to the rest.
    const candidates = mol.incidentBonds(centre)
      // `plainOnly`: in a drawing that has marks already, only an unmarked bond may take one.
      .filter((b) => mol.bond(b).order === 1 && !used.has(b) && (!opts.plainOnly || mol.bond(b).display === 'plain'))
      .sort((x, y) => score(y) - score(x));
    function score(b: number) {
      const n = mol.otherAtom(mol.bond(b), centre);
      // Where every bond is a ring bond (a fused centre), a chemist marks the larger ring and leaves
      // the smaller one flat, and never marks the bond the two rings share.
      const held = ringsOf(centre, n);
      const ringChoice = held.length === 0 ? 0 : (held.length === 1 ? 1.2 : 0) + (held[0]!.atoms.length >= 6 ? 0.6 : 0.3);
      return (inRing(mol, centre, n) ? 0 : 4) + (want.has(n) ? 0 : 2) + (mol.neighbours(n).length === 1 ? 1 : 0) + (prefer.has(n) ? 3 : 0) + ringChoice;
    }
    // The best bond that can carry the configuration: at a crowded cage atom the first choice may
    // lie where neither a wedge nor a hash reads as anything, and the next bond has to take it.
    for (const bondId of candidates) {
      const b = mol.bond(bondId);
      const before = b.display;
      const narrowAtBegin = b.begin === centre;
      let shown = false;
      for (const kind of ['wedge', 'hash'] as const) {
        b.display = kind === 'wedge' ? (narrowAtBegin ? 'wedgeBegin' : 'wedgeEnd') : (narrowAtBegin ? 'hashBegin' : 'hashEnd');
        perceiveStereoFromGeometry(mol);
        const got = mol.atom(centre).chirality;
        if (got && got.order.length === 4 && ch.order.every((x) => got.order.includes(x))) {
          shown = (got.anticlockwise === ch.anticlockwise) === (parity(got.order, ch.order) === 0);
          if (shown) break;
        }
      }
      if (shown) { used.add(bondId); break; }
      b.display = before;
    }
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
  const inSystem = new Set(sys.atoms);
  const onLargeRing = new Set<AtomId>(first.atoms.length >= 8 ? first.atoms : []);
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
        const spot = (i: number) => { const t = start + dirSign * step * i; return { x: c.x + R * Math.cos(t), y: c.y + R * Math.sin(t) }; };
        // Fused, the atoms already there sit where this polygon puts them. Where they do not, the
        // ring is a bridge across what is drawn (norbornane, quinuclidine, a morphinan): its new
        // atoms go on an arc between the two atoms they join, instead of on a polygon that lands
        // them on top of others or stretches a bond across the drawing.
        // (A ring on a macrocycle, as in a porphyrin or a corrin, keeps its polygon: the macrocycle's
        // double bonds are drawn cis round it, as they are recorded, and an arc could turn one.)
        const fits = Array.from({ length: n - 2 }, (_, j) => j + 1).every((i) => {
          const q = p.get(r.atoms[(k + 1 + i) % n]!);
          return !q || Math.hypot(q.x - spot(i).x, q.y - spot(i).y) < 0.2 * L;
        });
        if (fits || n >= 8 || placed.some((x) => onLargeRing.has(x))) {
          for (let i = 1; i < n - 1; i++) { const id = r.atoms[(k + 1 + i) % n]!; if (!p.has(id)) p.set(id, spot(i)); }
        } else {
          bridge(mol, inSystem, r.atoms, p, L);
        }
      }
      if (n >= 8) for (const x of r.atoms) onLargeRing.add(x);
      done.add(r);
    }
  }
  // Anything still unplaced (unusual bridged systems): park near the centroid.
  const c = centroid([...p.values()]);
  sys.atoms.forEach((a, i) => { if (!p.has(a)) p.set(a, { x: c.x + (i % 3) * L * 0.5, y: c.y + L * 0.5 }); });
  transInLargeRings(mol, sys, p);
  return p;
}

/**
 * The unplaced atoms of a ring that bridges atoms already drawn: each run of them on a circular
 * arc from the placed atom before it to the one after, bonds at the standard length, bulging to
 * whichever side keeps it further from everything else.
 */
function bridge(mol: Molecule, inSystem: ReadonlySet<AtomId>, ring: readonly AtomId[], p: Map<AtomId, P>, L: number): void {
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    if (!p.has(ring[i]!) || p.has(ring[(i + 1) % n]!)) continue;
    const run: AtomId[] = [];
    let j = (i + 1) % n;
    while (!p.has(ring[j]!)) { run.push(ring[j]!); j = (j + 1) % n; }
    const pa = p.get(ring[i]!)!, pb = p.get(ring[j]!)!;
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y), segs = run.length + 1;
    const others = [...p.values()];
    const place = (side: number, len: number): P[] => {
      if (d >= segs * len - 1e-6 || d < 1e-6) return run.map((_, k) => ({ x: pa.x + (pb.x - pa.x) * (k + 1) / segs, y: pa.y + (pb.y - pa.y) * (k + 1) / segs + (d < 1e-6 ? side * L * (k + 1) : 0) }));
      // The angle each bond subtends at the arc's centre: segs chords of length len spanning d.
      let lo = 1e-6, hi = 2 * Math.PI / segs;
      for (let it = 0; it < 60; it++) { const t = (lo + hi) / 2; if (Math.sin(segs * t / 2) / Math.sin(t / 2) > d / len) lo = t; else hi = t; }
      const theta = (lo + hi) / 2, rho = len / (2 * Math.sin(theta / 2)), half = segs * theta / 2;
      const nx = -(pb.y - pa.y) / d, ny = (pb.x - pa.x) / d;
      const c = { x: (pa.x + pb.x) / 2 - side * nx * rho * Math.cos(half), y: (pa.y + pb.y) / 2 - side * ny * rho * Math.cos(half) };
      const a0 = Math.atan2(pa.y - c.y, pa.x - c.x);
      // Turn from a towards b through the bulge.
      const apex = Math.atan2(side * ny, side * nx);
      const turn = Math.abs(norm(a0 + half - apex)) < Math.abs(norm(a0 - half - apex)) ? 1 : -1;
      return run.map((_, k) => ({ x: c.x + rho * Math.cos(a0 + turn * theta * (k + 1)), y: c.y + rho * Math.sin(a0 + turn * theta * (k + 1)) }));
    };
    const room = (pts: P[]) => Math.min(...pts.map((q) => Math.min(...others.map((o) => Math.hypot(o.x - q.x, o.y - q.y)))));
    // Bonds of the standard length where that leaves room. Where it does not (the third bridge of
    // bicyclo[2.2.2]octane would lie exactly on the ring it bridges), a wider arc with longer bonds,
    // as such bridges are drawn by hand.
    // A bridge atom that carries a group needs room for it too.
    const need = (run.some((x) => mol.neighbours(x).some((y) => !inSystem.has(y))) ? 1.2 : 0.6) * L;
    let pts: P[] = [], clear = -1;
    for (const stretch of [1, 1.3, 1.6, 2, 2.5]) {
      for (const side of [1, -1]) {
        const tryPts = place(side, stretch * L), r = room(tryPts);
        if (r > clear + 1e-6) { clear = r; pts = tryPts; }
      }
      if (clear >= need) break;
    }
    run.forEach((id, k) => p.set(id, pts[k]!));
  }
}

/**
 * A trans double bond in a large ring. Round a polygon every bond is cis, so a
 * macrocycle's E double bond (tacrolimus, rapamycin, a trans-cyclooctene) came
 * out drawn as Z: a different compound. One end of the bond is folded inward,
 * mirrored across the line through its two ring neighbours, which keeps every
 * bond length and puts the ring's two arms on opposite sides of the bond.
 */
function transInLargeRings(mol: Molecule, sys: RingSystem, p: Map<AtomId, P>): void {
  const inSys = new Set(sys.atoms);
  const ringDegree = (a: AtomId) => mol.neighbours(a).filter((n) => inSys.has(n)).length;
  const moved = new Set<AtomId>();
  for (const ring of sys.rings) {
    const n = ring.atoms.length;
    if (n < 8) continue;
    // Folding one bond's end can undo its neighbour's (a conjugated triene), so go round until all agree.
    for (let pass = 0; pass < 2 * n; pass++) {
      let folded = false;
      for (let i = 0; i < n && !folded; i++) {
        const a = ring.atoms[i]!, b = ring.atoms[(i + 1) % n]!;
        const bond = mol.bondBetween(a, b);
        if (!bond || bond.order !== 2 || !bond.ez) continue;
        const prev = ring.atoms[(i + n - 1) % n]!, next = ring.atoms[(i + 2) % n]!;
        // The recorded geometry is between the two reference atoms: turn it into one between the ring's arms.
        const [refA, refB] = bond.begin === a ? bond.ez.ref : [bond.ez.ref[1], bond.ez.ref[0]];
        let cis = bond.ez.cis;
        if (refA !== prev) cis = !cis;
        if (refB !== next) cis = !cis;
        const side = (x: AtomId) => { const A = p.get(a)!, B = p.get(b)!, X = p.get(x)!; return Math.sign((B.x - A.x) * (X.y - A.y) - (B.y - A.y) * (X.x - A.x)); };
        if ((side(prev) === side(next)) === cis) continue;
        // Fold an end that is only in this ring: one not folded yet first, then the one that carries less.
        const weight = (x: AtomId) => mol.neighbours(x).filter((m) => !inSys.has(m)).length;
        const pick = [{ atom: b, pivot: [a, next] as const }, { atom: a, pivot: [prev, b] as const }]
          .filter((e) => ringDegree(e.atom) === 2)
          .sort((x, y) => Number(moved.has(x.atom)) - Number(moved.has(y.atom)) || weight(x.atom) - weight(y.atom))[0];
        if (!pick) continue;
        const one = new Map([[pick.atom, p.get(pick.atom)!]]);
        mirror(new Set([pick.atom]), p.get(pick.pivot[0])!, p.get(pick.pivot[1])!, one);
        p.set(pick.atom, one.get(pick.atom)!);
        moved.add(pick.atom);
        folded = true;
      }
      if (!folded) break;
    }
  }
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
function childDirections(mol: Molecule, x: AtomId, placed: AtomId[], kids: AtomId[], pos: Map<AtomId, P>, turn: Map<AtomId, number>, rings: readonly Ring[]): number[] {
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
    if (kids.length === 3 && subtreeSize(mol, kids[0]!, x, pos) > 1 && subtreeSize(mol, kids[1]!, x, pos) === 1) {
      // A chain carrying two single atoms here (CF2, a gem-dimethyl): the chain keeps its zigzag and
      // the pair stands on the outside of the bend, 60 degrees apart. Turning the chain through a
      // right angle at each such atom, as a cross would, winds a perfluoro chain onto itself.
      // (Larger groups need the room a cross gives: the three phenyls of a trityl.)
      const t = -(turn.get(placed[0]!) ?? 1);
      turn.set(x, t);
      const out = back + t * 60 * DEG + Math.PI;
      return [norm(back + t * 120 * DEG), norm(out - 30 * DEG), norm(out + 30 * DEG)];
    }
    // A cross (tert-butyl, a sulfone, SF5): straight on first, for the heaviest.
    if (kids.length === 3) return [norm(back + Math.PI), norm(back + Math.PI / 2), norm(back - Math.PI / 2)];
    return kids.map((_, i) => norm(back + (90 + 90 * i) * DEG));
  }
  // Two or more placed neighbours (ring atoms): spread kids evenly in the widest gap that is not
  // the inside of a ring. (A ring atom reached from its substituent has three gaps of 120 degrees,
  // one of them the ring itself: a second substituent put there is drawn across the ring.)
  const around = placed.map((n) => ({ n, a: ang(px, pos.get(n)!) })).sort((p, q) => p.a - q.a);
  let gapStart = 0, gap = -1;
  for (const inside of [false, true]) {
    around.forEach((p, i) => {
      const q = around[(i + 1) % around.length]!;
      const width = i + 1 < around.length ? q.a - p.a : q.a + 2 * Math.PI - p.a;
      // The inside of a ring is the narrow side of its two bonds.
      if ((width < Math.PI - 1e-6 && rings.some((r) => r.atoms.includes(x) && r.atoms.includes(p.n) && r.atoms.includes(q.n))) !== inside) return;
      if (width > gap + 1e-9) { gap = width; gapStart = p.a; }
    });
    if (gap > 0) break;
  }
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

/**
 * Move branches until no two atoms sit on top of each other: mirror one about a rotatable
 * bond where that helps, and where no mirror image does (two crowded neighbours pointing at
 * the same spot), swing it 30 degrees aside. Where none of that helps, turn further round, and
 * turn a branch about its bond to a ring. Each clash is taken in turn, the worst first; one
 * that nothing helps is left, and the rest are still dealt with.
 */
function resolveClashes(mol: Molecule, fragment: AtomId[], pos: Map<AtomId, P>, L: number): void {
  const hard = 0.55 * L, near = 0.9 * L;
  const dist = (a: AtomId, b: AtomId) => { const p = pos.get(a)!, q = pos.get(b)!; return Math.hypot(p.x - q.x, p.y - q.y); };
  /** How crowded `side` is against everything else: the squared shortfall of each pair closer than `near`. */
  const crowding = (side: ReadonlySet<AtomId>) => {
    let sum = 0;
    for (const a of side) for (const b of fragment) {
      if (side.has(b)) continue;
      const d = dist(a, b);
      if (d < near && !mol.bondBetween(a, b)) sum += ((near - d) / L) ** 2;
    }
    return sum;
  };
  const stuck = new Set<string>();
  const swung = new Set<string>();
  const ringAtoms = new Set(perceiveRings(mol).flatMap((r) => r.atoms));
  for (let iter = 0; iter < 80; iter++) {
    let worst: [AtomId, AtomId] | null = null, least = hard;
    for (let i = 0; i < fragment.length; i++) for (let j = i + 1; j < fragment.length; j++) {
      const a = fragment[i]!, b = fragment[j]!;
      const d = dist(a, b);
      if (d < least && !mol.bondBetween(a, b) && !stuck.has(`${a}-${b}`)) { least = d; worst = [a, b]; }
    }
    if (!worst) return;
    const [a, b] = worst;
    const path = shortestPath(mol, a, b);
    /**
     * The moves to try, the ones nearest a chemist's hand first: a mirror about a rotatable bond,
     * or a 30 degree swing of a single atom or of a ring. Only where none of those helps does
     * `wide` allow the rest -- turning further round, and turning a whole branch about its bond to
     * a ring -- so every drawing the first set could straighten comes out exactly as it did.
     */
    const search = (wide: boolean): { gain: number; apply: () => void } | null => {
      let best: { gain: number; apply: () => void } | null = null;
      for (let i = 0; i + 1 < path.length; i++) {
        const u = path[i]!, v = path[i + 1]!;
        if (mol.bondBetween(u, v)!.order !== 1 || inRing(mol, u, v)) continue;
        // The smaller side moves; the pivot is the atom it hangs from.
        const sideV = sideOf(mol, v, u), sideU = sideOf(mol, u, v);
        const [side, pivot, first] = sideV.size <= sideU.size ? [sideV, u, v] : [sideU, v, u];
        const before = crowding(side);
        const saved = new Map([...side].map((id) => [id, pos.get(id)!]));
        const restore = () => { for (const [id, q] of saved) pos.set(id, q); };
        const consider = (move: () => void, cost: number) => {
          move();
          const gain = before - crowding(side) - cost;
          restore();
          if (gain > 1e-6 && (!best || gain > best.gain)) best = { gain, apply: move };
        };
        consider(() => mirror(side, pos.get(pivot)!, pos.get(first)!, pos), 0);
        // A swing bends the angle at the pivot, so it costs something and each bond swings once.
        // A single atom or a ring swings; with `wide`, so does a branch hanging off a ring atom. A
        // substituent turns about its bond to a ring freely and rigidly, and the pivot's own angles
        // are held by the ring, so swinging it puts no kink in a chain. Without that, a clash the
        // branch's own first atom is in cannot be moved at all: that atom lies on the mirror axis,
        // so no mirror image shifts it, and a substituent that childDirections aimed across a
        // fused cage stayed exactly on top of the atom it landed on.
        const key = `${pivot}-${first}`;
        const offRing = wide && ringAtoms.has(pivot) && !ringAtoms.has(first) && !inRing(mol, pivot, first);
        if ((side.size === 1 || ringAtoms.has(first) || offRing) && !swung.has(key)) {
          for (const away of wide ? [30, 60, 90, 120] : [30]) for (const sign of [1, -1]) {
            consider(() => { rotate(side, pos.get(pivot)!, sign * away * DEG, pos); swung.add(key); }, 0.04 * (away / 30));
            swung.delete(key);
          }
        }
      }
      return best;
    };
    // The wider moves are for atoms genuinely drawn on top of each other, not for a pair merely
    // sitting closer than is comfortable. Turning a branch 90 degrees to open up half a bond
    // length buys nothing and costs the conventional angles, so crowding this side of a real
    // overlap is left as the first set of moves leaves it.
    const best = search(false) ?? (least < 0.4 * L ? search(true) : null);
    if (best) best.apply();
    else stuck.add(`${a}-${b}`);
  }
}

function rotate(ids: Set<AtomId>, about: P, angle: number, pos: Map<AtomId, P>) {
  const c = Math.cos(angle), sn = Math.sin(angle);
  for (const id of ids) {
    const p = pos.get(id)!;
    const dx = p.x - about.x, dy = p.y - about.y;
    pos.set(id, { x: about.x + dx * c - dy * sn, y: about.y + dx * sn + dy * c });
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
