import type { AtomId, Molecule } from './model.ts';
import { ezLabel, perceiveStereoFromGeometry } from './stereo.ts';

/**
 * Are two structures the same compound? Compares heavy-atom graphs labelled
 * by element, charge, isotope, radical and total hydrogen count. Bond orders
 * are not compared: with fixed valences they follow from those labels up to
 * resonance, so different Kekulé forms of one aromatic compare equal while
 * genuinely different compounds (which must differ in some H count) do not.
 */
export function sameStructure(a: Molecule, b: Molecule): boolean {
  for (const _ of isomorphisms(a, b)) return true;
  return false;
}

/**
 * Every atom mapping a -> b under the same labelling as sameStructure. Lazy,
 * so callers can stop at the first mapping that satisfies extra conditions
 * (matching stereodescriptors, for instance).
 */
export function* isomorphisms(a: Molecule, b: Molecule): Generator<Map<AtomId, AtomId>> {
  if (a.atomCount !== b.atomCount || a.bondCount !== b.bondCount) return;
  const label = (m: Molecule, id: AtomId) => {
    const x = m.atom(id);
    return `${x.label ?? x.element}|${x.charge}|${x.isotope ?? ''}|${x.radical}|${m.implicitHydrogens(id)}|${m.neighbours(id).length}`;
  };
  const la = new Map([...a.atoms()].map((x) => [x.id, label(a, x.id)]));
  const lb = new Map([...b.atoms()].map((x) => [x.id, label(b, x.id)]));
  const hist = (m: Map<AtomId, string>) => [...m.values()].sort().join(';');
  if (hist(la) !== hist(lb)) return;

  const aIds = [...a.atoms()].map((x) => x.id);
  // Order atoms so each one (after the first of a component) is adjacent to an earlier one.
  const ordered: AtomId[] = [];
  const seen = new Set<AtomId>();
  for (const s of aIds) {
    if (seen.has(s)) continue;
    const queue = [s]; seen.add(s);
    while (queue.length) {
      const x = queue.shift()!; ordered.push(x);
      for (const n of a.neighbours(x)) if (!seen.has(n)) { seen.add(n); queue.push(n); }
    }
  }
  const map = new Map<AtomId, AtomId>();
  const used = new Set<AtomId>();
  const bIds = [...b.atoms()].map((x) => x.id);

  const consistent = (x: AtomId, y: AtomId) => {
    for (const nx of a.neighbours(x)) {
      const ny = map.get(nx);
      if (ny !== undefined && !b.bondBetween(y, ny)) return false;
    }
    // Count of already-mapped neighbours must agree both ways.
    let ca = 0, cb = 0;
    for (const nx of a.neighbours(x)) if (map.has(nx)) ca++;
    for (const ny of b.neighbours(y)) if (used.has(ny)) cb++;
    return ca === cb;
  };

  function* solve(k: number): Generator<Map<AtomId, AtomId>> {
    if (k === ordered.length) { yield new Map(map); return; }
    const x = ordered[k]!;
    const mappedNeighbour = a.neighbours(x).find((n) => map.has(n));
    const candidates = mappedNeighbour !== undefined ? b.neighbours(map.get(mappedNeighbour)!) : bIds;
    for (const y of candidates) {
      if (used.has(y) || la.get(x) !== lb.get(y) || !consistent(x, y)) continue;
      map.set(x, y); used.add(y);
      yield* solve(k + 1);
      map.delete(x); used.delete(y);
    }
  }
  yield* solve(0);
}

/**
 * Are two structures the same stereoisomer: the same compound, with the same
 * configuration at every specified centre and stereogenic double bond (and
 * the same ones specified)? Drawings are read from their wedges and geometry,
 * parsed SMILES from their @/@@ and / \ marks. Compares configurations
 * through the atom mapping, so ring cis/trans counts even where CIP gives no
 * R/S.
 */
export function sameStereoisomer(a: Molecule, b: Molecule): boolean {
  const prepare = (m: Molecule) => {
    const c = m.clone();
    if ([...c.atoms()].some((x) => x.x !== 0 || x.y !== 0)) perceiveStereoFromGeometry(c);
    // Geometry gives every drawn double bond a configuration; keep the ones that matter.
    for (const bd of c.bonds()) if (bd.ez && ezLabel(c, bd.id) === null) bd.ez = null;
    return c;
  };
  const pa = prepare(a), pb = prepare(b);
  const count = (m: Molecule) => `${[...m.atoms()].filter((x) => x.chirality).length}|${[...m.bonds()].filter((x) => x.ez).length}`;
  if (count(pa) !== count(pb)) return false;
  const parity = (from: AtomId[], to: AtomId[]) => {
    const p = from.map((x) => to.indexOf(x));
    let swaps = 0;
    for (let i = 0; i < p.length; i++) while (p[i] !== i) { const j = p[i]!; [p[i], p[j]] = [p[j]!, p[i]!]; swaps++; }
    return swaps % 2;
  };
  for (const map of isomorphisms(pa, pb)) {
    const m = (id: AtomId) => (id === -1 ? -1 : map.get(id)!);
    const chiralOk = [...pa.atoms()].every((x) => {
      if (!x.chirality) return true;
      const y = pb.atom(m(x.id)).chirality;
      const mapped = x.chirality.order.map(m);
      if (!y || !mapped.every((n) => y.order.includes(n))) return false;
      return (x.chirality.anticlockwise !== (parity(mapped, y.order) === 1)) === y.anticlockwise;
    });
    if (!chiralOk) continue;
    const ezOk = [...pa.bonds()].every((x) => {
      if (!x.ez) return true;
      const y = pb.bondBetween(m(x.begin), m(x.end));
      if (!y?.ez) return false;
      const [r0, r1] = y.begin === m(x.begin) ? [m(x.ez.ref[0]), m(x.ez.ref[1])] : [m(x.ez.ref[1]), m(x.ez.ref[0])];
      // Each end where the mapped reference is the other substituent flips cis/trans.
      return (x.ez.cis !== (r0 !== y.ez.ref[0]) !== (r1 !== y.ez.ref[1])) === y.ez.cis;
    });
    if (ezOk) return true;
  }
  return false;
}
