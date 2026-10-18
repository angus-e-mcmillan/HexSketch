import { elementBySymbol } from './elements.ts';
import type { AtomId, BondId, Molecule } from './model.ts';

/**
 * CIP priorities and stereodescriptors.
 *
 * Ranking follows the hierarchical digraph of the CIP rules (rule 1a, atomic
 * number), exploring sphere by sphere with duplicate atoms for multiple bonds
 * and ring closures. That covers the descriptors chemists meet day to day;
 * rules 3-5 (like/unlike, pseudo-asymmetry) are not implemented, so a centre
 * that needs them is left without a descriptor rather than mislabelled.
 */

const H = -1;
const z = (mol: Molecule, id: AtomId) => (id === H ? 1 : elementBySymbol(mol.atom(id).element)?.z ?? 0);

interface Node { atom: AtomId; z: number; dup: boolean; from: AtomId; path: Set<AtomId> }

function children(mol: Molecule, n: Node): Node[] {
  if (n.dup) return [0, 0, 0].map(() => ({ atom: H, z: 0, dup: true, from: n.atom, path: n.path }));
  if (n.atom === H) return [];
  const out: Node[] = [];
  for (const b of mol.incidentBonds(n.atom)) {
    const bd = mol.bond(b);
    const y = mol.otherAtom(bd, n.atom);
    const extra = Math.max(0, Math.round(bd.order) - 1);
    if (y === n.from) {
      // Multiple bond back to the parent: its duplicates hang here.
      for (let i = 0; i < extra; i++) out.push({ atom: y, z: z(mol, y), dup: true, from: n.atom, path: n.path });
      continue;
    }
    if (n.path.has(y)) { out.push({ atom: y, z: z(mol, y), dup: true, from: n.atom, path: n.path }); continue; }
    const path = new Set(n.path); path.add(y);
    out.push({ atom: y, z: z(mol, y), dup: false, from: n.atom, path });
    for (let i = 0; i < extra; i++) out.push({ atom: y, z: z(mol, y), dup: true, from: n.atom, path: n.path });
  }
  const hs = mol.implicitHydrogens(n.atom);
  for (let i = 0; i < hs; i++) out.push({ atom: H, z: 1, dup: false, from: n.atom, path: n.path });
  return out;
}

/** Compare two branches from `centre`: positive if a outranks b, 0 if indistinguishable. */
function compareBranches(mol: Molecule, centre: AtomId, a: AtomId, b: AtomId): number {
  const root = (x: AtomId): Node => ({ atom: x, z: z(mol, x), dup: false, from: centre, path: new Set([centre, x]) });
  let fa: Node[] = [root(a)], fb: Node[] = [root(b)];
  if (fa[0]!.z !== fb[0]!.z) return fa[0]!.z - fb[0]!.z;
  for (let depth = 0; depth < 40; depth++) {
    const expand = (front: Node[]) => front.map((n) => children(mol, n).sort((p, q) => q.z - p.z));
    const ea = expand(fa), eb = expand(fb);
    for (let i = 0; i < Math.max(ea.length, eb.length); i++) {
      const sa = (ea[i] ?? []).map((n) => n.z), sb = (eb[i] ?? []).map((n) => n.z);
      for (let k = 0; k < Math.max(sa.length, sb.length); k++) {
        const d = (sa[k] ?? -1) - (sb[k] ?? -1);
        if (d !== 0) return d;
      }
    }
    fa = ea.flat(); fb = eb.flat();
    if (!fa.length && !fb.length) return 0;
  }
  return 0;
}

/** Neighbours of `centre` (implicit H as -1), highest priority first; null if any two tie. */
export function cipOrder(mol: Molecule, centre: AtomId, exclude: AtomId[] = []): AtomId[] | null {
  const nbrs: AtomId[] = mol.neighbours(centre).filter((n) => !exclude.includes(n));
  for (let i = 0; i < mol.implicitHydrogens(centre); i++) nbrs.push(H);
  const sorted = [...nbrs].sort((p, q) => -compareBranches(mol, centre, p, q));
  for (let i = 0; i + 1 < sorted.length; i++) if (compareBranches(mol, centre, sorted[i]!, sorted[i + 1]!) === 0) return null;
  return sorted;
}

function permutationParity(from: AtomId[], to: AtomId[]): number {
  const idx = from.map((x) => to.indexOf(x));
  let swaps = 0;
  const p = [...idx];
  for (let i = 0; i < p.length; i++) while (p[i] !== i) { const j = p[i]!; [p[i], p[j]] = [p[j]!, p[i]!]; swaps++; }
  return swaps % 2;
}

/** R or S for a tetrahedral centre with a recorded configuration, or null. */
export function rsLabel(mol: Molecule, centre: AtomId): 'R' | 'S' | null {
  const ch = mol.atom(centre).chirality;
  if (!ch || ch.order.length !== 4) return null;
  const pri = cipOrder(mol, centre);
  if (!pri || pri.length !== 4) return null;
  // Reference arrangement [d, a, b, c] with "anticlockwise" seen from d is R.
  const ref = [pri[3]!, pri[0]!, pri[1]!, pri[2]!];
  if (new Set(ch.order).size !== 4 || !ch.order.every((x) => ref.includes(x))) return null;
  const odd = permutationParity(ch.order, ref) === 1;
  return ch.anticlockwise !== odd ? 'R' : 'S';
}

/** E or Z for a double bond with a recorded configuration, or null if not stereogenic. */
export function ezLabel(mol: Molecule, bond: BondId): 'E' | 'Z' | null {
  const b = mol.bond(bond);
  if (b.order !== 2 || !b.ez) return null;
  const pa = cipOrder(mol, b.begin, [b.end]);
  const pb = cipOrder(mol, b.end, [b.begin]);
  if (!pa || !pb || !pa.length || !pb.length || pa[0] === H && pa.length > 1 && false) return null;
  const topA = pa[0]!, topB = pb[0]!;
  if (topA === H || topB === H) return null;
  // ez.cis refers to ref atoms; flip once for each end where the top-priority atom is not the ref.
  let cis = b.ez.cis;
  if (topA !== b.ez.ref[0]) cis = !cis;
  if (topB !== b.ez.ref[1]) cis = !cis;
  return cis ? 'Z' : 'E';
}

/**
 * Derive chirality and double-bond configurations from 2D coordinates and
 * wedge/hash bonds, as drawn in the editor. Replaces anything recorded.
 */
export function perceiveStereoFromGeometry(mol: Molecule): void {
  for (const a of mol.atoms()) a.chirality = null;
  const L = averageBondLength(mol);
  for (const a of mol.atoms()) {
    const nbrs = mol.neighbours(a.id);
    if (nbrs.length < 3 || nbrs.length + mol.implicitHydrogens(a.id) !== 4) continue;
    const zOf = new Map<AtomId, number>();
    let any = false;
    for (const b of mol.incidentBonds(a.id)) {
      const bd = mol.bond(b);
      const other = mol.otherAtom(bd, a.id);
      const narrowHere = (bd.display === 'wedgeBegin' || bd.display === 'hashBegin') ? bd.begin === a.id
        : (bd.display === 'wedgeEnd' || bd.display === 'hashEnd') ? bd.end === a.id : false;
      if (!narrowHere) continue;
      zOf.set(other, (bd.display.startsWith('wedge') ? 1 : -1) * 0.8 * L);
      any = true;
    }
    if (!any) continue;
    // Right-handed coordinates: x right, y up (screen y flipped), z toward the viewer.
    const vec = (id: AtomId) => { const b = mol.atom(id); return [b.x - a.x, -(b.y - a.y), zOf.get(id) ?? 0] as [number, number, number]; };
    const order: AtomId[] = [...nbrs];
    const vs = order.map(vec);
    if (order.length === 3) {
      const unit = vs.map((v) => { const l = Math.hypot(...v) || 1; return v.map((c) => c / l); });
      const h: [number, number, number] = [0, 1, 2].map((k) => -(unit[0]![k]! + unit[1]![k]! + unit[2]![k]!)) as [number, number, number];
      if (Math.hypot(h[0], h[1]) < 1e-6 && Math.abs(h[2]) < 1e-6) continue;
      order.unshift(H);
      vs.unshift(h);
    }
    const [v0, v1, v2, v3] = vs as [number, number, number][];
    const sub = (p: number[], q: number[]) => [p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!];
    const crs = (p: number[], q: number[]) => [p[1]! * q[2]! - p[2]! * q[1]!, p[2]! * q[0]! - p[0]! * q[2]!, p[0]! * q[1]! - p[1]! * q[0]!];
    const dt = (p: number[], q: number[]) => p[0]! * q[0]! + p[1]! * q[1]! + p[2]! * q[2]!;
    const normal = crs(sub(v2!, v1!), sub(v3!, v1!));
    const centroid = [0, 1, 2].map((k) => (v1![k]! + v2![k]! + v3![k]!) / 3);
    const s = dt(normal, sub(v0!, centroid));
    if (Math.abs(s) < 1e-9) continue;
    a.chirality = { order, anticlockwise: s > 0 };
  }

  for (const b of mol.bonds()) {
    b.ez = null;
    if (b.order !== 2 || b.display === 'either') continue;
    if (inSmallRing(mol, b.begin, b.end)) continue;
    const ra = mol.neighbours(b.begin).find((n) => n !== b.end);
    const rb = mol.neighbours(b.end).find((n) => n !== b.begin);
    if (ra === undefined || rb === undefined) continue;
    const A = mol.atom(b.begin), B = mol.atom(b.end);
    const len2 = (B.x - A.x) ** 2 + (B.y - A.y) ** 2;
    // Normalised cross product; near-collinear substituents carry no geometry.
    const side = (p: AtomId) => {
      const P = mol.atom(p);
      const c = ((B.x - A.x) * (P.y - A.y) - (B.y - A.y) * (P.x - A.x)) / len2;
      return Math.abs(c) < 0.02 ? 0 : Math.sign(c);
    };
    const sa = side(ra), sb = side(rb);
    if (!sa || !sb) continue;
    b.ez = { ref: [ra, rb], cis: sa === sb };
  }
}

function averageBondLength(mol: Molecule): number {
  let t = 0, n = 0;
  for (const b of mol.bonds()) { const p = mol.atom(b.begin), q = mol.atom(b.end); t += Math.hypot(p.x - q.x, p.y - q.y); n++; }
  return n ? t / n : 1;
}

/** Is a-b in a ring of fewer than 8 atoms (where E/Z is not cited)? */
function inSmallRing(mol: Molecule, a: AtomId, b: AtomId): boolean {
  const dist = new Map<AtomId, number>([[a, 0]]);
  const q = [a];
  while (q.length) {
    const x = q.shift()!;
    const d = dist.get(x)!;
    if (d >= 7) continue;
    for (const y of mol.neighbours(x)) {
      if (x === a && y === b) continue;
      if (!dist.has(y)) { dist.set(y, d + 1); q.push(y); }
    }
  }
  return (dist.get(b) ?? Infinity) < 7;
}
