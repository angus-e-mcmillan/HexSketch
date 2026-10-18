/**
 * Structure > Clean Up Structure, HexSketch's way: fix bond lengths, angles and
 * ring shapes while keeping the drawing as the user arranged it.
 *
 * ChemDraw 20.1's Clean Up (tried on deliberately messy
 * structures) reaches ideal geometry over one or two passes but may turn a
 * fragment by several degrees or even mirror it (salicylic acid flipped on the
 * second pass). HexSketch keeps the orientation instead: it relaxes
 * the drawing from its own coordinates towards ideal distances and then
 * rotates the result back onto the original (rotation only, never a mirror
 * image). Only if that cannot produce clean geometry (a tangled drawing) does
 * it fall back to a fresh layout, aligned as closely as possible to the original.
 */
import { assignWedges, layout2D } from './layout.ts';
import { Molecule, type AtomId } from './model.ts';
import { perceiveRings } from './rings.ts';
import { ezLabel, perceiveStereoFromGeometry, rsLabel } from './stereo.ts';

type Pt = { x: number; y: number };
interface Constraint { i: AtomId; j: AtomId; d: number; w: number }

/** Clean up every fragment of `mol` that contains one of `atoms` (all fragments if omitted). */
export function cleanUpStructure(mol: Molecule, L: number, atoms?: Iterable<AtomId>): void {
  const chosen = atoms ? new Set(atoms) : null;
  // Stereo as drawn, to keep it.
  const probe = mol.clone();
  perceiveStereoFromGeometry(probe);
  const probeIds = [...probe.atoms()].map((a) => a.id);
  const ids = [...mol.atoms()].map((a) => a.id);
  const toProbe = new Map(ids.map((id, i) => [id, probeIds[i]!]));
  const fromProbe = new Map(probeIds.map((id, i) => [id, ids[i]!]));
  const want = new Map<AtomId, { order: AtomId[]; anticlockwise: boolean }>();
  for (const a of probe.atoms()) {
    if (a.chirality) want.set(fromProbe.get(a.id)!, { order: a.chirality.order.map((x) => (x === -1 ? -1 : fromProbe.get(x)!)), anticlockwise: a.chirality.anticlockwise });
  }
  const rsBefore = new Map(ids.map((id) => [id, rsLabel(probe, toProbe.get(id)!)]));
  const ezBefore = new Map([...mol.bonds()].map((b) => [b.id, ezLabel(mol, b.id)]));

  for (const frag of mol.fragments()) {
    if (chosen && !frag.some((a) => chosen.has(a))) continue;
    if (frag.length < 2) continue;
    const original = new Map(frag.map((id) => [id, { x: mol.atom(id).x, y: mol.atom(id).y }]));
    relax(mol, frag, L);
    alignTo(mol, frag, original, false);
    if (!acceptable(mol, frag, L, ezBefore)) {
      // Tangled beyond repair: a fresh layout, turned (or if need be mirrored) to match the original.
      freshLayout(mol, frag, L, original);
    }
  }
  // Keep each stereocentre's configuration: redo wedges where the geometry now reads differently.
  const after = mol.clone();
  perceiveStereoFromGeometry(after);
  const afterIds = [...after.atoms()].map((a) => a.id);
  const changed = ids.some((id, i) => rsBefore.get(id) !== null && rsLabel(after, afterIds[i]!) !== rsBefore.get(id));
  if (changed && want.size) assignWedges(mol, want);
}

/** Pull bonds to L, angles to their ideal values and rings to regular polygons, starting from the drawing. */
function relax(mol: Molecule, frag: AtomId[], L: number) {
  const inFrag = new Set(frag);
  const pos = new Map(frag.map((id) => [id, { x: mol.atom(id).x, y: mol.atom(id).y }]));
  const cons: Constraint[] = [];
  for (const b of mol.bonds()) if (inFrag.has(b.begin)) cons.push({ i: b.begin, j: b.end, d: L, w: 1 });

  // Rings: every pair at regular-polygon distance (small and medium rings).
  const rings = perceiveRings(mol).filter((r) => inFrag.has(r.atoms[0]!));
  const ringPair = new Map<string, number>(); // "a,b" (neighbours of a centre) -> ring size
  for (const r of rings) {
    const n = r.atoms.length;
    for (let k = 0; k < n; k++) {
      const a = r.atoms[k]!, b = r.atoms[(k + 2) % n]!, c = r.atoms[(k + 1) % n]!;
      ringPair.set(`${c}|${Math.min(a, b)},${Math.max(a, b)}`, Math.min(n, ringPair.get(`${c}|${Math.min(a, b)},${Math.max(a, b)}`) ?? Infinity));
    }
    if (n > 8) continue;
    const R = L / (2 * Math.sin(Math.PI / n));
    for (let p = 0; p < n; p++) for (let q = p + 2; q < n; q++) {
      if (p === 0 && q === n - 1) continue;
      const steps = Math.min(q - p, n - (q - p));
      cons.push({ i: r.atoms[p]!, j: r.atoms[q]!, d: 2 * R * Math.sin((Math.PI * steps) / n), w: 0.8 });
    }
  }

  // Angles at each atom, as 1-3 distances between angularly adjacent neighbours (keeps the drawn order).
  for (const c of frag) {
    const nb = mol.neighbours(c);
    if (nb.length < 2) continue;
    const pc = pos.get(c)!;
    const sorted = [...nb].sort((a, b) => Math.atan2(pos.get(a)!.y - pc.y, pos.get(a)!.x - pc.x) - Math.atan2(pos.get(b)!.y - pc.y, pos.get(b)!.x - pc.x));
    const gaps = sorted.map((a, k) => {
      const b = sorted[(k + 1) % sorted.length]!;
      const ga = Math.atan2(pos.get(a)!.y - pc.y, pos.get(a)!.x - pc.x), gb = Math.atan2(pos.get(b)!.y - pc.y, pos.get(b)!.x - pc.x);
      let g = gb - ga;
      while (g <= 0) g += 2 * Math.PI;
      return { a, b, drawn: g, ring: ringPair.get(`${c}|${Math.min(a, b)},${Math.max(a, b)}`) };
    });
    const linear = nb.length === 2 && (mol.incidentBonds(c).some((b) => mol.bond(b).order === 3) || mol.incidentBonds(c).filter((b) => mol.bond(b).order === 2).length === 2);
    let targets: number[];
    if (nb.length === 2) {
      if (linear) targets = [Math.PI, Math.PI];
      else {
        const ringGap = gaps.findIndex((g) => g.ring);
        const inner = ringGap >= 0 ? ((gaps[ringGap]!.ring! - 2) * Math.PI) / gaps[ringGap]!.ring! : (2 * Math.PI) / 3;
        // The smaller drawn gap takes the ideal angle, so a zigzag keeps its direction.
        const small = ringGap >= 0 ? ringGap : gaps[0]!.drawn <= gaps[1]!.drawn ? 0 : 1;
        targets = [0, 0];
        targets[small] = inner;
        targets[1 - small] = 2 * Math.PI - inner;
      }
    } else {
      const fixed = gaps.map((g) => (g.ring ? ((g.ring - 2) * Math.PI) / g.ring : null));
      const used = fixed.reduce((s: number, x) => s + (x ?? 0), 0);
      const free = fixed.filter((x) => x === null).length;
      const share = free ? Math.max(0.3, (2 * Math.PI - used) / free) : 0;
      targets = fixed.map((x) => x ?? share);
    }
    gaps.forEach((g, k) => {
      const t = targets[k]!;
      if (t > Math.PI + 1e-6) return; // reflex gaps follow from the others
      cons.push({ i: g.a, j: g.b, d: 2 * L * Math.sin(t / 2), w: g.ring ? 0.6 : 0.5 });
    });
  }

  // Constraint projection (Gauss-Seidel), alternating sweep direction to avoid bias.
  for (let it = 0; it < 600; it++) {
    const list = it % 2 ? cons : [...cons].reverse();
    for (const k of list) {
      const p = pos.get(k.i)!, q = pos.get(k.j)!;
      const dx = q.x - p.x, dy = q.y - p.y;
      const d = Math.hypot(dx, dy) || 1e-6;
      const f = ((d - k.d) / d) * 0.5 * k.w;
      p.x += dx * f; p.y += dy * f;
      q.x -= dx * f; q.y -= dy * f;
    }
  }
  for (const [id, p] of pos) { mol.atom(id).x = p.x; mol.atom(id).y = p.y; }
}

/** Rotate (and, if allowed, mirror) the fragment about its centroid to best match `original`, then put it back in place. */
function alignTo(mol: Molecule, frag: AtomId[], original: Map<AtomId, Pt>, allowMirror: boolean): { mirrored: boolean; rms: number } {
  const cen = (get: (id: AtomId) => Pt) => {
    let x = 0, y = 0;
    for (const id of frag) { const p = get(id); x += p.x; y += p.y; }
    return { x: x / frag.length, y: y / frag.length };
  };
  const co = cen((id) => original.get(id)!), cn = cen((id) => mol.atom(id));
  let best = { mirrored: false, rms: Infinity, th: 0 };
  for (const m of allowMirror ? [1, -1] : [1]) {
    let sxx = 0, sxy = 0;
    for (const id of frag) {
      const a = mol.atom(id), o = original.get(id)!;
      const px = a.x - cn.x, py = m * (a.y - cn.y), qx = o.x - co.x, qy = o.y - co.y;
      sxx += px * qx + py * qy; sxy += px * qy - py * qx;
    }
    const th = Math.atan2(sxy, sxx);
    let rms = 0;
    for (const id of frag) {
      const a = mol.atom(id), o = original.get(id)!;
      const px = a.x - cn.x, py = m * (a.y - cn.y);
      const rx = px * Math.cos(th) - py * Math.sin(th), ry = px * Math.sin(th) + py * Math.cos(th);
      rms += (rx - (o.x - co.x)) ** 2 + (ry - (o.y - co.y)) ** 2;
    }
    rms = Math.sqrt(rms / frag.length);
    if (rms < best.rms) best = { mirrored: m < 0, rms, th };
  }
  const m = best.mirrored ? -1 : 1;
  for (const id of frag) {
    const a = mol.atom(id);
    const px = a.x - cn.x, py = m * (a.y - cn.y);
    a.x = co.x + px * Math.cos(best.th) - py * Math.sin(best.th);
    a.y = co.y + px * Math.sin(best.th) + py * Math.cos(best.th);
  }
  return { mirrored: best.mirrored, rms: best.rms };
}

/** Good enough: bonds within 3% of L, no crossing bonds, double bonds keep their E/Z. */
function acceptable(mol: Molecule, frag: AtomId[], L: number, ezBefore: Map<number, string | null>): boolean {
  const inFrag = new Set(frag);
  const bonds = [...mol.bonds()].filter((b) => inFrag.has(b.begin));
  for (const b of bonds) {
    const p = mol.atom(b.begin), q = mol.atom(b.end);
    if (Math.abs(Math.hypot(p.x - q.x, p.y - q.y) - L) > 0.03 * L) return false;
    const was = ezBefore.get(b.id);
    if (was && ezLabel(mol, b.id) !== was) return false;
  }
  for (let i = 0; i < bonds.length; i++) for (let j = i + 1; j < bonds.length; j++) {
    const a = bonds[i]!, b = bonds[j]!;
    if (a.begin === b.begin || a.begin === b.end || a.end === b.begin || a.end === b.end) continue;
    if (segmentsCross(mol.atom(a.begin), mol.atom(a.end), mol.atom(b.begin), mol.atom(b.end))) return false;
  }
  // No two atoms on top of each other.
  for (let i = 0; i < frag.length; i++) for (let j = i + 1; j < frag.length; j++) {
    const p = mol.atom(frag[i]!), q = mol.atom(frag[j]!);
    if (Math.hypot(p.x - q.x, p.y - q.y) < 0.35 * L) return false;
  }
  return true;
}

function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const o = (p: Pt, q: Pt, r: Pt) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

/** Fall back: lay the fragment out afresh and fit it onto the original drawing. */
function freshLayout(mol: Molecule, frag: AtomId[], L: number, original: Map<AtomId, Pt>) {
  const sub = new Molecule();
  const toSub = new Map<AtomId, AtomId>(), toMain = new Map<AtomId, AtomId>();
  for (const id of frag) { const n = sub.addAtom({ ...mol.atom(id), chirality: null }).id; toSub.set(id, n); toMain.set(n, id); }
  for (const id of frag) {
    const ch = mol.atom(id).chirality;
    if (ch) sub.atom(toSub.get(id)!).chirality = { order: ch.order.map((x) => (x === -1 ? -1 : toSub.get(x)!)), anticlockwise: ch.anticlockwise };
  }
  const bondMap = new Map<number, number>();
  for (const b of mol.bonds()) {
    if (!toSub.has(b.begin)) continue;
    const nb = sub.addBond({ ...b, begin: toSub.get(b.begin)!, end: toSub.get(b.end)!, ez: b.ez ? { ref: [toSub.get(b.ez.ref[0])!, toSub.get(b.ez.ref[1])!], cis: b.ez.cis } : null });
    bondMap.set(nb.id, b.id);
  }
  perceiveStereoFromGeometry(sub);
  layout2D(sub, L);
  for (const a of sub.atoms()) { const t = mol.atom(toMain.get(a.id)!); t.x = a.x; t.y = a.y; }
  for (const b of sub.bonds()) { const t = mol.bond(bondMap.get(b.id)!); if (t.order === 1) t.display = b.display; }
  alignTo(mol, frag, original, true);
}
