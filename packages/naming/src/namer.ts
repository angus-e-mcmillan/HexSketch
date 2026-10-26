import { ezLabel, Molecule, parsePeptide, parseSmiles, peptideName, peptideText, perceiveStereoFromGeometry, recognisePeptide, rsLabel, type AtomId, type Peptide } from '@hexsketch/core';
import { analyze, SENIORITY, isAcylCarbon, isRingCation, type Analysis, type Group, type GroupKind } from './analyze.ts';
import { RING_PARENTS } from './rings.ts';
import { TEMPLATES, type RingTemplate } from './templates.ts';
import { HALIDE, HALO, alkaneStem, attachSuffix, compareLocant, complexMultiplier, multiplier } from './vocab.ts';

/** Thrown for structures outside the supported nomenclature. Never guess a name. */
export class OutOfScope extends Error {}

type Numbering = Map<AtomId, string>;

interface Parent {
  kind: 'chain' | 'ring';
  atoms: AtomId[];
  numberings: Numbering[];
  ring?: RingInfo;
}

interface RingInfo {
  kind: 'template' | 'cyclo' | 'vonbaeyer';
  /** A template parent named with hydro prefixes; each numbering's choice is in hydroOf. */
  hydro?: boolean;
  /** Added hydrogen (pyridin-2(1H)-one): ring N atoms saturated to carry an exocyclic C=O. */
  addedH?: Set<AtomId>;
  /** von Baeyer/spiro: "bicyclo[2.2.1]" or "spiro[3.5]", and total ring atoms. */
  bracket?: string;
  template?: RingTemplate;
  size: number;
  /** Cyclic order (monocycles only). */
  cycle?: AtomId[];
  heteroN: boolean; heteroO: boolean; heteroS: boolean;
  ringCount: number;
}

/** Indicated hydrogen and hydro positions of a partly saturated parent: 2,3-dihydro-1H-indole. */
interface Hydro { ih: AtomId[]; hydro: AtomId[] }
const hydroOf = new WeakMap<Numbering, Hydro>();

/** "2,3-dihydro-1H-" + "indole", or for a substituent stem "2,3-dihydro-1H-" + "inden". */
function withHydro(stem: string, h: Hydro, numbering: Numbering): string {
  const loc = (a: AtomId) => numbering.get(a)!;
  const ih = h.ih.map(loc).sort(compareLocant).map((l) => `${l}H`).join(',');
  const hy = h.hydro.length ? `${h.hydro.map(loc).sort(compareLocant).join(',')}-${multiplier(h.hydro.length)}hydro` : '';
  const ihText = ih ? `${ih}-` : '';
  const join = hy && (ihText || /^[0-9]/.test(stem)) ? '-' : '';
  return `${hy}${join}${ihText}${stem}`;
}

interface Prefix { text: string; complex: boolean; sortKey: string; at: AtomId | 'N'; /** For 'N': the carbon whose amine or amide this nitrogen is. */ nOf?: AtomId }
interface SubName { text: string; complex: boolean; sortKey: string }

const el = (mol: Molecule, id: AtomId) => mol.atom(id).element;
const locVal = (l: string) => { const m = /^(\d+)([a-z]?)/.exec(l); return m ? Number(m[1]) + (m[2] ? 0.1 * (m[2].charCodeAt(0) - 96) : 0) : 0; };
const cmpVec = (a: number[], b: number[]) => { for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!; return a.length - b.length; };
const cmpKey = (a: (number | number[])[], b: (number | number[])[]) => {
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!, y = b[i]!;
    const c = Array.isArray(x) ? cmpVec(x, y as number[]) : (x as number) - (y as number);
    if (c !== 0) return c;
  }
  return 0;
};

// ---------------------------------------------------------------- templates

interface CompiledTemplate { t: RingTemplate; mol: Molecule; cls: string[]; adj: number[][] }
let compiled: CompiledTemplate[] | null = null;

function ringClass(mol: Molecule, id: AtomId, inSystem: (x: AtomId) => boolean): string {
  const unsat = mol.incidentBonds(id).some((b) => {
    const bd = mol.bond(b);
    return bd.order >= 1.5 && bd.order <= 2 && inSystem(mol.otherAtom(bd, id));
  });
  return `${el(mol, id)}${unsat ? 'u' : 's'}`;
}

function compile(t: RingTemplate): CompiledTemplate {
  let mol: Molecule;
  if (t.skeleton) {
    mol = new Molecule();
    const ids = t.skeleton.elements.map((e) => mol.addAtom({ element: e, x: 0, y: 0 }).id);
    for (const [x, y] of t.skeleton.bonds) mol.addBond({ begin: ids[x]!, end: ids[y]! });
  } else mol = parseSmiles(t.smiles);
  const ids = [...mol.atoms()].map((a) => a.id);
  const idx = new Map(ids.map((id, i) => [id, i]));
  return {
    t, mol,
    cls: ids.map((id) => ringClass(mol, id, () => true)),
    adj: ids.map((id) => mol.neighbours(id).map((n) => idx.get(n)!)),
  };
}

function templates(): CompiledTemplate[] {
  if (!compiled) compiled = TEMPLATES.map(compile);
  return compiled;
}

/** Elements of a ring system as a sorted string: the key for finding parents to try. */
const composition = (elements: string[]) => [...elements].sort().join(' ');
let parentsByComposition: Map<string, CompiledTemplate[]> | null = null;

/** Mancude parents with these elements: the hand-written templates first, then the generated ones. */
function parentsFor(elements: string[]): CompiledTemplate[] {
  if (!parentsByComposition) {
    parentsByComposition = new Map();
    const all = [...templates().filter((ct) => ct.t.mancude), ...RING_PARENTS.map(compile)];
    for (const ct of all) {
      const key = composition([...ct.mol.atoms()].map((a) => a.element));
      const list = parentsByComposition.get(key);
      if (list) list.push(ct); else parentsByComposition.set(key, [ct]);
    }
  }
  return parentsByComposition.get(composition(elements)) ?? [];
}

/**
 * Every mapping of a template onto a ring system, as locant numberings.
 * Relaxed mode allows the "added hydrogen" pattern: an aromatic ring carbon
 * carrying an exocyclic C=O, balanced by a ring N carrying H (2-pyridone).
 */
function matchTemplate(an: Analysis, system: AtomId[], ct: CompiledTemplate, relaxed = false): Numbering[] {
  const mol = an.mol;
  if (system.length !== ct.cls.length) return [];
  const inSys = new Set(system);
  const sysNbrs = new Map(system.map((a) => [a, mol.neighbours(a).filter((n) => inSys.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id))]));
  const cls = new Map(system.map((a) => [a, ringClass(mol, a, (x) => inSys.has(x))]));
  const exoCarbonyl = (a: AtomId) => mol.incidentBonds(a).some((b) => {
    const bd = mol.bond(b), o = mol.otherAtom(bd, a);
    return bd.order === 2 && el(mol, o) === 'O' && !inSys.has(o);
  });
  const fits = (a: AtomId, want: string) => {
    const got = cls.get(a)!;
    if (got === want) return true;
    if (!relaxed) return false;
    if (want === 'Cu' && got === 'Cs' && exoCarbonyl(a)) return true;
    if (want === 'Nu' && got === 'Ns') return true;
    return false;
  };
  const out: Numbering[] = [];
  const map: AtomId[] = new Array(ct.cls.length);
  const used = new Set<AtomId>();
  const solve = (k: number) => {
    if (k === ct.cls.length) {
      out.push(new Map(map.map((a, i) => [a, ct.t.locants[i]!])));
      return;
    }
    for (const a of system) {
      if (used.has(a) || !fits(a, ct.cls[k]!) || sysNbrs.get(a)!.length !== ct.adj[k]!.length) continue;
      if (!ct.adj[k]!.every((j) => j >= k || mol.bondBetween(a, map[j]!) !== undefined)) continue;
      map[k] = a; used.add(a);
      solve(k + 1);
      used.delete(a);
    }
  };
  solve(0);
  return out;
}

/** Template mappings by elements and ring connectivity alone, ignoring bond orders. */
function matchSkeleton(an: Analysis, system: AtomId[], ct: CompiledTemplate): Numbering[] {
  const mol = an.mol;
  if (system.length !== ct.cls.length) return [];
  const inSys = new Set(system);
  const sysNbrs = new Map(system.map((a) => [a, mol.neighbours(a).filter((n) => inSys.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id))]));
  const want = ct.cls.map((c) => c.slice(0, -1));
  const out: Numbering[] = [];
  const map: AtomId[] = new Array(want.length);
  const used = new Set<AtomId>();
  const solve = (k: number) => {
    if (k === want.length) { out.push(new Map(map.map((a, i) => [a, ct.t.locants[i]!]))); return; }
    for (const a of system) {
      if (used.has(a) || el(mol, a) !== want[k] || sysNbrs.get(a)!.length !== ct.adj[k]!.length) continue;
      if (!ct.adj[k]!.every((j) => j >= k || mol.bondBetween(a, map[j]!) !== undefined)) continue;
      map[k] = a; used.add(a);
      solve(k + 1);
      used.delete(a);
    }
  };
  solve(0);
  return out;
}

/** Size of a maximum matching on `atoms` using ring bonds among them. */
function maxMatching(an: Analysis, atoms: AtomId[]): number {
  const mol = an.mol;
  const set = new Set(atoms);
  const nb = (a: AtomId) => mol.neighbours(a).filter((n) => set.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id));
  let best = 0;
  const used = new Set<AtomId>();
  const go = (i: number, size: number) => {
    if (size + Math.floor((atoms.length - i) / 2) <= best && i < atoms.length) { /* cannot beat best */ }
    if (i === atoms.length) { best = Math.max(best, size); return; }
    const a = atoms[i]!;
    if (used.has(a)) { go(i + 1, size); return; }
    used.add(a);
    for (const n of nb(a)) if (!used.has(n)) { used.add(n); go(i + 1, size + 1); used.delete(n); }
    used.delete(a);
    go(i + 1, size);
  };
  go(0, 0);
  return best;
}

/**
 * A partly or fully saturated form of a mancude template parent, named with
 * hydro prefixes and indicated hydrogen (P-31.1.4.2.4): every way of reading
 * the ring's double bonds as the parent's, less some removed in pairs.
 */
function hydroParent(an: Analysis, system: AtomId[]): { info: RingInfo; numberings: Numbering[] } | null {
  const mol = an.mol;
  const inSys = new Set(system);
  const ringNb = (a: AtomId) => mol.neighbours(a).filter((n) => inSys.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id));
  const double: [AtomId, AtomId][] = [];
  for (const b of mol.bonds()) {
    if (!inSys.has(b.begin) || !inSys.has(b.end) || !an.ringBonds.has(b.id)) continue;
    if (b.order !== 1 && b.order !== 2) return null;
    if (b.order === 2) double.push([b.begin, b.end]);
  }
  // Atoms that can carry a ring double bond in the mancude parent.
  const capable = system.filter((a) => (el(mol, a) === 'C' && ringNb(a).length <= 3) || (el(mol, a) === 'N' && ringNb(a).length === 2));
  const capSet = new Set(capable);
  if (double.some(([x, y]) => !capSet.has(x) || !capSet.has(y))) return null;
  const inDouble = new Set(double.flat());
  const rest = capable.filter((a) => !inDouble.has(a));
  const M = maxMatching(an, capable);
  const k = capable.length - 2 * M;
  const need = M - double.length;
  if (need < 0 || rest.length - 2 * need !== k) return null;
  // Indicated-hydrogen sets: k saturated atoms such that the parent with hydrogen
  // there has a Kekulé structure. The other saturated atoms are hydro prefixes,
  // in pairs but anywhere (2,5-dihydrofuran).
  const choices: AtomId[][] = [];
  const combos = (from: number, pick: AtomId[]) => {
    if (pick.length === k) {
      const left = capable.filter((a) => !pick.includes(a));
      if (maxMatching(an, left) * 2 === left.length) choices.push([...pick]);
      return;
    }
    for (let i = from; i < rest.length; i++) combos(i + 1, [...pick, rest[i]!]);
  };
  if (k > 3) return null;
  combos(0, []);
  if (!choices.length) return null;
  const hetero = (e: string) => system.some((a) => el(mol, a) === e);
  const base = { heteroN: hetero('N'), heteroO: hetero('O'), heteroS: hetero('S') };
  for (const ct of parentsFor(system.map((a) => el(mol, a)))) {
    const maps = matchSkeleton(an, system, ct);
    if (!maps.length) continue;
    const numberings: Numbering[] = [];
    for (const m of maps) for (const ih of choices) {
      const n = new Map(m);
      hydroOf.set(n, { ih, hydro: rest.filter((a) => !ih.includes(a)) });
      numberings.push(n);
    }
    const ringCount = ct.t.locants.filter((l) => /a$/.test(l)).length / 2 + 1;
    return { info: { kind: 'template', template: ct.t, hydro: true, size: system.length, ringCount, ...base }, numberings };
  }
  return null;
}

/** `addedH`: the ring's C=O is the principal ketone, so pyridin-2(1H)-one style names may be used. */
function recognizeRing(an: Analysis, system: AtomId[], addedH = false): { info: RingInfo; numberings: Numbering[] } | null {
  const mol = an.mol;
  const hetero = (e: string) => system.some((a) => el(mol, a) === e);
  const base = { heteroN: hetero('N'), heteroO: hetero('O'), heteroS: hetero('S') };
  const ringCount = (t: RingTemplate) => t.locants.filter((l) => /a$/.test(l)).length / 2 + 1;
  // A ring carrying C=O first tries the added-hydrogen form of its aromatic parent
  // (pyridin-4(1H)-one, uracil) before any hydro-prefixed parent; lactones and
  // lactams that are not aromatic in that sense fall through to the strict match.
  const sysSet = new Set(system);
  const ringCarbonyl = system.some((a) => mol.incidentBonds(a).some((b) => {
    const bd = mol.bond(b), o = mol.otherAtom(bd, a);
    return bd.order === 2 && el(mol, o) === 'O' && !sysSet.has(o);
  }));
  if (ringCarbonyl && addedH) {
    for (const ct of templates()) {
      if (!ct.t.aromatic || matchTemplate(an, system, ct).length) continue;
      const n = matchTemplate(an, system, ct, true);
      if (!n.length) continue;
      const addedH = new Set(system.filter((a) => el(mol, a) === 'N' && ringClass(mol, a, (x) => sysSet.has(x)) === 'Ns'));
      return { info: { kind: 'template', template: ct.t, size: system.length, ringCount: ringCount(ct.t), addedH, ...base }, numberings: n };
    }
  }
  for (const ct of templates()) {
    const n = matchTemplate(an, system, ct);
    if (n.length) return { info: { kind: 'template', template: ct.t, size: system.length, ringCount: ringCount(ct.t), ...base }, numberings: n };
  }
  const hydro = hydroParent(an, system);
  if (hydro) return hydro;
  // Monocyclic carbocycle (cycloalkane / cycloalkene).
  const inSys = new Set(system);
  const ringNbrs = (a: AtomId) => mol.neighbours(a).filter((n) => inSys.has(n));
  if (system.every((a) => el(mol, a) === 'C' && ringNbrs(a).length === 2)) {
    const cycle: AtomId[] = [system[0]!];
    while (cycle.length < system.length) {
      const last = cycle[cycle.length - 1]!;
      const next = ringNbrs(last).find((n) => !cycle.includes(n));
      if (next === undefined) break;
      cycle.push(next);
    }
    const n = cycle.length;
    const numberings: Numbering[] = [];
    for (let s = 0; s < n; s++) for (const dir of [1, -1]) {
      numberings.push(new Map(cycle.map((_, i) => [cycle[(s + dir * i + n * 2) % n]!, String(i + 1)])));
    }
    return { info: { kind: 'cyclo', size: n, cycle, ringCount: 1, ...base }, numberings };
  }
  return vonBaeyer(an, system, base);
}

/**
 * Spiro (two rings sharing one atom) and bicyclic von Baeyer systems (two
 * bridgeheads joined by three bridges), IUPAC P-23/P-24. Only the valid
 * von Baeyer numberings are generated; heteroatoms then decide among them.
 */
function vonBaeyer(an: Analysis, system: AtomId[], base: { heteroN: boolean; heteroO: boolean; heteroS: boolean }) {
  const mol = an.mol;
  const inSys = new Set(system);
  const nb = (a: AtomId) => mol.neighbours(a).filter((n) => inSys.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id));
  const edges = system.reduce((s2, a) => s2 + nb(a).length, 0) / 2;
  if (edges - system.length + 1 !== 2) return null; // only bicyclic systems
  if (system.some((a) => !['C', 'N', 'O', 'S'].includes(el(mol, a)))) return null;
  const deg = new Map(system.map((a) => [a, nb(a).length]));
  const numberings: Numbering[] = [];
  const add = (order: AtomId[]) => numberings.push(new Map(order.map((a, i) => [a, String(i + 1)])));

  // Walk from `start` through degree-2 atoms until reaching an atom in `stops`.
  const walk = (from: AtomId, start: AtomId, stops: Set<AtomId>): AtomId[] => {
    const path: AtomId[] = [];
    let prev = from, cur = start;
    while (!stops.has(cur)) {
      path.push(cur);
      const next = nb(cur).find((x) => x !== prev)!;
      prev = cur; cur = next;
    }
    return path;
  };

  const spiro = system.filter((a) => deg.get(a) === 4);
  if (spiro.length === 1 && system.every((a) => deg.get(a) === 2 || a === spiro[0])) {
    const sp = spiro[0]!;
    const stops = new Set([sp]);
    const rings = nb(sp).map((x) => walk(sp, x, stops));
    // Each ring appears twice (once per direction); keep the two distinct rings.
    const uniq: AtomId[][] = [];
    for (const r of rings) if (!uniq.some((u) => u.length === r.length && u.every((x) => r.includes(x)))) uniq.push(r);
    if (uniq.length !== 2) return null;
    uniq.sort((x, y) => x.length - y.length);
    const [small, large] = uniq as [AtomId[], AtomId[]];
    for (const s1 of [small, [...small].reverse()]) for (const l1 of [large, [...large].reverse()]) add([...s1, sp, ...l1]);
    const bracket = `spiro[${small.length}.${large.length}]`;
    return { info: { kind: 'vonbaeyer' as const, bracket, size: system.length, ringCount: 2, ...base }, numberings };
  }

  const heads = system.filter((a) => deg.get(a) === 3);
  if (heads.length !== 2 || !system.every((a) => deg.get(a) === 2 || heads.includes(a))) return null;
  const [h1, h2] = heads as [AtomId, AtomId];
  const stops = new Set(heads);
  const bridges: AtomId[][] = [];
  for (const x of nb(h1)) {
    if (x === h2) { bridges.push([]); continue; }
    const path = walk(h1, x, stops);
    bridges.push(path);
  }
  if (bridges.length !== 3) return null;
  const sorted = [...bridges].sort((x, y) => y.length - x.length);
  const sizes = sorted.map((b) => b.length);
  // Every valid numbering: either bridgehead first; bridges of equal size may swap roles.
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
    .filter((o) => sizes[o[0]!] === sizes[0] && sizes[o[1]!] === sizes[1] && sizes[o[2]!] === sizes[2]);
  for (const [first, last] of [[h1, h2], [h2, h1]] as const) {
    for (const o of orders) {
      const main = sorted[o[0]!]!, second = sorted[o[1]!]!, small = sorted[o[2]!]!;
      // Bridges are stored from h1; orient them from `first`.
      const fromFirst = (b: AtomId[]) => (first === h1 ? b : [...b].reverse());
      const order = [first, ...fromFirst(main), last, ...[...fromFirst(second)].reverse(), ...fromFirst(small)];
      add(order);
    }
  }
  const bracket = `bicyclo[${sizes.join('.')}]`;
  return { info: { kind: 'vonbaeyer' as const, bracket, size: system.length, ringCount: 2, ...base }, numberings };
}

/** Replacement prefixes for heteroatoms in a von Baeyer/spiro parent: "1-oxa-8-aza". */
function heteroPrefix(mol: Molecule, atoms: AtomId[], numbering: Numbering): string {
  const groups: [string, string][] = [['O', 'oxa'], ['S', 'thia'], ['N', 'aza']];
  const parts: string[] = [];
  for (const [e, word] of groups) {
    const locs = atoms.filter((a) => el(mol, a) === e).map((a) => numbering.get(a)!).sort(compareLocant);
    if (locs.length) parts.push(`${locs.join(',')}-${multiplier(locs.length)}${word}`);
  }
  // Elide the final "a" before a vowel is not needed: bicyclo/spiro start with consonants.
  return parts.join('-');
}

// ------------------------------------------------------------------- naming

export interface NameResult { name: string | null; reason?: string }

export interface NameOptions {
  /**
   * Read stereochemistry from the 2D drawing: wedges and how double bonds are
   * drawn (default). False keeps the molecule's own recorded configuration, for
   * a structure read from SMILES, whose layout says nothing about stereo.
   */
  geometry?: boolean;
}

/** Set for the duration of one nameMolecule call. */
let fromGeometry = true;

export function nameMolecule(input: Molecule, opts: NameOptions = {}): NameResult {
  fromGeometry = opts.geometry ?? true;
  try {
    const mol = ionize(input);
    const frags = mol.fragments();
    if (frags.length === 0) return { name: null, reason: 'empty' };
    if (frags.length > 1) return { name: nameMixture(mol, frags) };
    const only = simpleIon(mol, frags[0]!);
    if (only) return { name: only.name };
    return { name: nameOne(mol) };
  } catch (e) {
    if (e instanceof OutOfScope) return { name: null, reason: e.message };
    throw e;
  }
}

const METALS: Record<string, string> = {
  Li: 'lithium', Na: 'sodium', K: 'potassium', Rb: 'rubidium', Cs: 'caesium', Mg: 'magnesium', Ca: 'calcium',
  Ba: 'barium', Zn: 'zinc', Ag: 'silver', Cu: 'copper', Al: 'aluminium',
};
const ANIONS: Record<string, string> = { F: 'fluoride', Cl: 'chloride', Br: 'bromide', I: 'iodide' };
const ACID_SALT: Record<string, string> = { F: 'hydrofluoride', Cl: 'hydrochloride', Br: 'hydrobromide', I: 'hydroiodide' };

/** Treat bonds from alkali and alkaline-earth metals to O, N or S as ionic (KOtBu drawn as O-K). */
export function ionize(input: Molecule): Molecule {
  const mol = input.clone();
  for (const b of [...mol.bonds()]) {
    const [p, q] = [mol.atom(b.begin), mol.atom(b.end)];
    const metal = METALS[p.element] && !METALS[q.element] ? p : METALS[q.element] && !METALS[p.element] ? q : null;
    if (!metal || b.order !== 1) continue;
    const other = metal === p ? q : p;
    if (!['O', 'N', 'S'].includes(other.element)) continue;
    mol.removeBond(b.id);
    metal.charge += 1;
    other.charge -= 1;
  }
  return mol;
}

interface Ion { name: string; charge: number }

/** Single-atom ions and small inorganic species. */
function simpleIon(mol: Molecule, frag: AtomId[]): Ion | null {
  if (frag.length === 1) {
    const a = mol.atom(frag[0]!);
    if (METALS[a.element] && a.charge > 0) return { name: METALS[a.element]!, charge: a.charge };
    if (ANIONS[a.element] && a.charge === -1) return { name: ANIONS[a.element]!, charge: -1 };
    if (a.element === 'N' && a.charge === 1 && mol.implicitHydrogens(a.id) === 4) return { name: 'ammonium', charge: 1 };
    if (a.element === 'O' && a.charge === -1 && mol.implicitHydrogens(a.id) === 1) return { name: 'hydroxide', charge: -1 };
  }
  return null;
}

/**
 * Salts and mixtures: cations then anions with stoichiometric multipliers
 * (disodium propanedioate), acid-addition salts (amine hydrochloride);
 * anything else is listed fragment by fragment.
 */
function nameMixture(mol: Molecule, frags: AtomId[][]): string {
  const ions: Ion[] = [];
  const neutral: AtomId[][] = [];
  const acids: string[] = [];
  for (const f of frags) {
    const simple = simpleIon(mol, f);
    if (simple) { ions.push(simple); continue; }
    if (f.length === 1 && ACID_SALT[mol.atom(f[0]!).element] && mol.atom(f[0]!).charge === 0) { acids.push(ACID_SALT[mol.atom(f[0]!).element]!); continue; }
    const charge = f.reduce((s, a) => s + mol.atom(a).charge, 0);
    if (charge !== 0 && !f.every((a) => mol.atom(a).charge === 0 || isNitroAtom(mol, a))) {
      ions.push({ name: nameOne(subMolecule(mol, f)), charge });
      continue;
    }
    neutral.push(f);
  }
  const parts: string[] = [];
  if (ions.length) {
    const group = (list: Ion[]) => {
      const counts = new Map<string, number>();
      for (const i of list) counts.set(i.name, (counts.get(i.name) ?? 0) + 1);
      return [...counts].map(([name, n]) => `${n > 1 ? multiplier(n) : ''}${name}`).join(' ');
    };
    const cations = ions.filter((i) => i.charge > 0), anions = ions.filter((i) => i.charge < 0);
    parts.push([group(cations), group(anions)].filter(Boolean).join(' '));
  }
  if (neutral.length) {
    const names = neutral.map((f) => nameOne(subMolecule(mol, f)));
    if (acids.length === 1 && names.length === 1) parts.push(`${names[0]} ${acids[0]}`);
    else { parts.push(...names); parts.push(...acids.map((a) => a.replace(/^hydro/, 'hydrogen '))); }
  } else if (acids.length) {
    parts.push(...acids.map((a) => a.replace(/^hydro/, 'hydrogen ')));
  }
  return parts.join(' · ');
}

function subMolecule(mol: Molecule, atoms: AtomId[]): Molecule {
  const copy = mol.clone();
  const keep = new Set(atoms);
  for (const a of [...copy.atoms()]) if (!keep.has(a.id)) copy.removeAtom(a.id);
  return copy;
}

const SUPPORTED = new Set(['C', 'H', 'N', 'O', 'S', 'F', 'Cl', 'Br', 'I', 'Si', 'Sn', 'B', 'P']);

/** A peptide written as a label ("H-Ala-Gly-OH" on a lone atom) or drawn out in full. */
function peptideOf(mol: Molecule): Peptide | null {
  if (mol.atomCount === 1) {
    const a = [...mol.atoms()][0]!;
    return a.label ? parsePeptide(a.label) : null;
  }
  if (mol.atomCount < 7) return null;
  try { return recognisePeptide(mol); } catch { return null; }
}

function nameOne(input: Molecule): string {
  // Peptides get peptide names ("L-alanylglycine"), or their sequence when protected.
  const pep = peptideOf(input);
  // A residue name reads as L (or D); with no configuration given, name it systematically.
  if (pep && !pep.residues.some((r) => r.stereoUnknown)) {
    const n = peptideName(pep);
    if (n) return n;
    try { return nameOneSystematic(input); } catch (e) { if (e instanceof OutOfScope) return peptideText(pep); throw e; }
  }
  return nameOneSystematic(input);
}

function nameOneSystematic(input: Molecule): string {
  const mol = expandNicknames(input);
  for (const a of mol.atoms()) {
    if (!SUPPORTED.has(a.element)) throw new OutOfScope(`element ${a.element}`);
    if (a.isotope !== null) throw new OutOfScope('isotopic labelling');
    if (a.radical) throw new OutOfScope('radicals');
    if (a.charge !== 0 && !isNitroAtom(mol, a.id) && !isNamedIon(mol, a.id)) throw new OutOfScope('charged species');
  }
  if (mol.atomCount === 1 && mol.atom([...mol.atoms()][0]!.id).element !== 'C') throw new OutOfScope('single heteroatom');
  const drawn = [...mol.atoms()].some((a) => a.x !== 0 || a.y !== 0);
  if (drawn && fromGeometry) perceiveStereoFromGeometry(mol);
  const an = analyze(mol);
  const namer = new Namer(an);
  return namer.functionalClassName() ?? namer.name();
}

/** Charges we can name: carboxylate/alkoxide O-, ammonium N+. */
function isNamedIon(mol: Molecule, id: AtomId): boolean {
  const a = mol.atom(id);
  const nb = mol.neighbours(id);
  if (a.element === 'N' && a.charge === 1 && isRingCation(mol, id) && mol.atom(id).element === 'N') {
    // In a ring (-ium), or open-chain with only single bonds (azanium).
    if (perceiveRingMember(mol, id)) return true;
  }
  // Azide N=N+=N-.
  if (a.element === 'N' && a.charge === 1 && nb.length === 2 && nb.every((n) => el(mol, n) === 'N') && nb.some((n) => mol.atom(n).charge === -1)) return true;
  if (a.element === 'N' && a.charge === -1 && nb.length === 1 && mol.atom(nb[0]!).charge === 1 && el(mol, nb[0]!) === 'N') return true;
  // Oxido: O- on a cationic N (pyridine N-oxides, amine oxides).
  if (a.element === 'O' && a.charge === -1 && nb.length === 1 && el(mol, nb[0]!) === 'N' && mol.atom(nb[0]!).charge === 1) return true;
  if (a.element === 'O' && a.charge === -1) return nb.length === 1 && el(mol, nb[0]!) === 'C';
  if (a.element === 'N' && a.charge === 1) return nb.length >= 1 && nb.every((n) => el(mol, n) === 'C') && mol.incidentBonds(id).every((b) => mol.bond(b).order === 1);
  // Tetracoordinate borate (trifluoroborate salts).
  if (a.element === 'B' && a.charge === -1) return nb.length === 4;
  return false;
}

function perceiveRingMember(mol: Molecule, id: AtomId): boolean {
  // An atom is in a ring if removing one of its bonds leaves the two ends connected.
  for (const b of mol.incidentBonds(id)) {
    const other = mol.otherAtom(mol.bond(b), id);
    const seen = new Set<AtomId>([id]);
    const stack = [other];
    while (stack.length) {
      const x = stack.pop()!;
      if (seen.has(x)) continue;
      seen.add(x);
      for (const y of mol.neighbours(x)) if (!seen.has(y)) stack.push(y);
      if (x !== other && mol.neighbours(x).includes(id)) return true;
    }
  }
  return false;
}

function isNitroAtom(mol: Molecule, id: AtomId): boolean {
  const a = mol.atom(id);
  if (a.element === 'N' && a.charge === 1) {
    // Nitro N+(=O)O-, also in nitrate esters (nitrooxy) where a third O joins it.
    const oxy = mol.neighbours(id).filter((n) => el(mol, n) === 'O');
    if (oxy.length === 2 && mol.neighbours(id).length === 3) return true;
    return oxy.length === 3 && oxy.some((o) => mol.atom(o).charge === -1) && oxy.some((o) => mol.bondBetween(id, o)!.order === 2);
  }
  if (a.element === 'O' && a.charge === -1) { const n = mol.neighbours(id)[0]; return n !== undefined && isNitroAtom(mol, n); }
  return false;
}

/** Common nicknames expanded to atoms before naming. */
const NICKNAMES: Record<string, string> = {
  Me: 'C', Et: 'CC', Pr: 'CCC', iPr: 'C(C)C', Bu: 'CCCC', tBu: 'C(C)(C)C', Ph: 'c1ccccc1', Bn: 'Cc1ccccc1',
  OMe: 'OC', OEt: 'OCC', OH: 'O', NH2: 'N', CO2Me: 'C(=O)OC', CO2Et: 'C(=O)OCC', CO2H: 'C(=O)O', CF3: 'C(F)(F)F',
  NO2: 'N(=O)=O', CN: 'C#N', Ac: 'C(C)=O', OAc: 'OC(C)=O', CHO: 'C=O', NMe2: 'N(C)C', SMe: 'SC', Cbz: 'C(=O)OCc1ccccc1',
  Boc: 'C(=O)OC(C)(C)C',
};

function expandNicknames(input: Molecule): Molecule {
  const mol = input.clone();
  for (const a of [...mol.atoms()]) {
    if (a.label === null) continue;
    const smi = NICKNAMES[a.label];
    if (!smi) throw new OutOfScope(`label "${a.label}"`);
    const frag = parseSmiles(smi);
    const idMap = new Map<AtomId, AtomId>();
    for (const f of frag.atoms()) idMap.set(f.id, mol.addAtom({ ...f, x: a.x, y: a.y }).id);
    for (const b of frag.bonds()) mol.addBond({ ...b, begin: idMap.get(b.begin)!, end: idMap.get(b.end)! });
    const head = idMap.get([...frag.atoms()][0]!.id)!;
    for (const b of mol.incidentBonds(a.id)) {
      const bd = mol.bond(b);
      const other = mol.otherAtom(bd, a.id);
      if (other === head) continue;
      mol.addBond({ begin: other, end: head, order: bd.order });
    }
    mol.removeAtom(a.id);
  }
  return mol;
}

// ------------------------------------------------------------------ the namer

class Namer {
  readonly an: Analysis;
  readonly mol: Molecule;
  readonly subCache = new Map<string, SubName>();
  readonly principal: GroupKind | null;
  readonly principalGroups: Group[];
  readonly ringByAtom = new Map<AtomId, AtomId[]>();
  readonly rs = new Map<AtomId, 'R' | 'S'>();
  readonly ez = new Map<string, 'E' | 'Z'>();

  constructor(an: Analysis) {
    this.an = an;
    this.mol = an.mol;
    for (const a of an.mol.atoms()) { const l = rsLabel(an.mol, a.id); if (l) this.rs.set(a.id, l); }
    for (const b of an.mol.bonds()) {
      const l = ezLabel(an.mol, b.id);
      if (l) { this.ez.set(`${b.begin}-${b.end}`, l); this.ez.set(`${b.end}-${b.begin}`, l); }
    }
    for (const s of an.ringSystems) for (const a of s) this.ringByAtom.set(a, s);
    const kinds = new Set(an.groups.map((g) => g.kind));
    this.principal = SENIORITY.find((k) => kinds.has(k)) ?? null;
    this.principalGroups = an.groups.filter((g) => g.kind === this.principal);
  }

  /**
   * Names built around a single heteroatom centre rather than a carbon
   * parent: R-B(OH)2 boronic acids, R3P phosphanes, RBF3- borates.
   */
  functionalClassName(): string | null {
    const mol = this.mol;
    // A lone Si or Sn with no characteristic group to name: ethoxytrimethylsilane, tetrabutylstannane.
    const metalloids = [...mol.atoms()].filter((a) => a.element === 'Si' || a.element === 'Sn');
    if (metalloids.length === 1 && !this.principal && ![...mol.atoms()].some((a) => a.element === 'B' || a.element === 'P')) {
      const m = metalloids[0]!;
      const nb2 = mol.neighbours(m.id);
      if (nb2.length === 4 && mol.incidentBonds(m.id).every((b) => mol.bond(b).order === 1) && !this.an.ringAtoms.has(m.id)) {
        return `${this.groupedSubs(nb2, m.id)}${m.element === 'Si' ? 'silane' : 'stannane'}`;
      }
    }
    const centres = [...mol.atoms()].filter((a) => a.element === 'B' || a.element === 'P');
    if (centres.length !== 1) return null;
    const c = centres[0]!;
    const nbrs = mol.neighbours(c.id);
    const carbonNbrs = nbrs.filter((n) => el(mol, n) === 'C');
    if (c.element === 'B' && c.charge === 0 && carbonNbrs.length === 1 && !this.an.ringAtoms.has(c.id)) {
      const ohs = nbrs.filter((n) => el(mol, n) === 'O' && mol.neighbours(n).length === 1 && this.an.h.get(n) === 1);
      if (ohs.length === 2) {
        const R = this.substituent(carbonNbrs[0]!, c.id);
        return `${R.complex ? `(${R.text})` : R.text}boronic acid`;
      }
    }
    if (c.element === 'B' && c.charge === -1 && carbonNbrs.length === 1) {
      const fs = nbrs.filter((n) => el(mol, n) === 'F');
      if (fs.length === 3) {
        const R = this.substituent(carbonNbrs[0]!, c.id);
        // "propanoyltrifluoroborate": the way chemists write KATs, and OPSIN-parsable.
        return `${R.complex ? `(${R.text})` : R.text}trifluoroborate`;
      }
    }
    if (c.element === 'P' && nbrs.length === 3 && carbonNbrs.length === 3 && mol.incidentBonds(c.id).every((b) => mol.bond(b).order === 1)) {
      return `${this.groupedSubs(carbonNbrs, c.id)}phosphane`;
    }
    return null;
  }

  /** "tert-butyldimethyl", "triphenyl": substituents on a heteroatom centre, alphabetical, multiplied. */
  groupedSubs(atoms: readonly AtomId[], centre: AtomId): string {
    const subs = atoms.map((n) => this.substituent(n, centre));
    const counts = new Map<string, { s: SubName; n: number }>();
    for (const s2 of subs) { const e = counts.get(s2.text); if (e) e.n++; else counts.set(s2.text, { s: s2, n: 1 }); }
    // Traditional prefixes need no brackets here: tert-butyldimethylsilyl.
    const bare = (t: string) => /^(tert|sec)-[a-z]+$/.test(t);
    return [...counts.values()].sort((x, y) => x.s.sortKey.localeCompare(y.s.sortKey))
      .map(({ s: s2, n }) => (s2.complex && !bare(s2.text) ? `${complexMultiplier(n)}(${s2.text})` : `${multiplier(n)}${s2.text}`)).join('');
  }

  name(): string {
    if (this.principal === 'ester') return this.nameEster();
    if (this.principal === 'urea' && this.principalGroups.length === 1) return this.nameUrea(this.principalGroups[0]!);
    const biphenyl = this.biphenyl();
    if (biphenyl) return biphenyl;
    const best = this.chooseParent();
    return this.withStereo(best.parent.atoms, best.numbering, this.render(best.parent, best.numbering));
  }

  /**
   * Stereodescriptors for a parent or substituent skeleton, cited in front:
   * "(S)-" for a single one, "(2R,3S)-" with locants when there are several.
   */
  stereoPrefix(atoms: AtomId[], numbering: Numbering, from?: AtomId): string {
    const items: [string, string][] = [];
    const inSet = new Set(atoms);
    for (const a of atoms) { const l = this.rs.get(a); if (l) items.push([numbering.get(a)!, l]); }
    for (const b of this.mol.bonds()) {
      const l = this.ez.get(`${b.begin}-${b.end}`);
      if (!l) continue;
      if (inSet.has(b.begin) && inSet.has(b.end)) {
        const x = numbering.get(b.begin)!, y = numbering.get(b.end)!;
        items.push([compareLocant(x, y) <= 0 ? x : y, l]);
        continue;
      }
      // A double bond leaving this skeleton (=N-OH, =CH-R) is cited here, at its
      // atom in the skeleton, unless it is how this substituent hangs off a
      // carbon of the skeleton above, which cites it instead.
      const inside = inSet.has(b.begin) ? b.begin : inSet.has(b.end) ? b.end : null;
      if (inside === null) continue;
      const outside = inside === b.begin ? b.end : b.begin;
      if (outside === from && el(this.mol, from) === 'C') continue;
      items.push([numbering.get(inside)!, l]);
    }
    if (!items.length) return '';
    if (items.length === 1) return `(${items[0]![1]})`;
    items.sort((p, q) => compareLocant(p[0], q[0]));
    return `(${items.map(([l, d]) => `${l}${d}`).join(',')})`;
  }

  withStereo(atoms: AtomId[], numbering: Numbering, name: string): string {
    const prefix = this.stereoPrefix(atoms, numbering);
    return prefix ? `${prefix}-${name}` : name;
  }

  // ------------------------------------------------------------ candidates

  /** Acyclic carbons usable in chains. */
  isChainCarbon(a: AtomId): boolean {
    return el(this.mol, a) === 'C' && !this.an.ringAtoms.has(a);
  }

  chainCandidates(): Parent[] {
    const mol = this.mol;
    const carbons = [...mol.atoms()].map((a) => a.id).filter((a) => this.isChainCarbon(a));
    const out: Parent[] = [];
    const nbrs = (a: AtomId) => mol.neighbours(a).filter((n) => this.isChainCarbon(n));
    for (const s of carbons) {
      // BFS tree from s gives the unique path to every other carbon in its acyclic tree.
      const prev = new Map<AtomId, AtomId>([[s, s]]);
      const q = [s];
      while (q.length) { const x = q.shift()!; for (const y of nbrs(x)) if (!prev.has(y)) { prev.set(y, x); q.push(y); } }
      for (const t of prev.keys()) {
        if (t < s) continue;
        const path: AtomId[] = [];
        for (let x = t; x !== s; x = prev.get(x)!) path.push(x);
        path.push(s);
        path.reverse();
        out.push({
          kind: 'chain', atoms: path,
          numberings: [
            new Map(path.map((a, i) => [a, String(i + 1)])),
            new Map(path.map((a, i) => [a, String(path.length - i)])),
          ],
        });
      }
    }
    return out;
  }

  ringCandidates(): Parent[] {
    const out: Parent[] = [];
    for (const system of this.an.ringSystems) {
      const r = recognizeRing(this.an, system, this.principal === 'ketone');
      if (!r) throw new OutOfScope('ring system without a supported parent name');
      out.push({ kind: 'ring', atoms: system, numberings: r.numberings, ring: r.info });
    }
    return out;
  }

  /** Where each principal group's suffix sits on a candidate parent (null if it is not on it). */
  principalSites(p: Parent): Map<Group, AtomId> {
    const inP = new Set(p.atoms);
    const sites = new Map<Group, AtomId>();
    for (const g of this.principalGroups) {
      if (g.kind === 'amine' || g.kind === 'aminium') {
        const c = this.mol.neighbours(g.nitrogen!).find((n) => inP.has(n));
        if (c !== undefined) sites.set(g, c);
        continue;
      }
      if (p.kind === 'chain') {
        if (!inP.has(g.anchor)) continue;
        if (g.ownCarbon && g.anchor !== p.atoms[0] && g.anchor !== p.atoms[p.atoms.length - 1]) continue;
        sites.set(g, g.anchor);
      } else if (g.ownCarbon) {
        const r = this.mol.neighbours(g.anchor).find((n) => inP.has(n));
        if (r !== undefined) sites.set(g, r);
      } else if (inP.has(g.anchor)) {
        sites.set(g, g.anchor);
      }
    }
    return sites;
  }

  /** Atoms that belong to principal groups placed on this parent (not to be named as prefixes). */
  consumedBy(p: Parent, sites: Map<Group, AtomId>): Set<AtomId> {
    const out = new Set<AtomId>();
    for (const g of sites.keys()) {
      g.consumed.forEach((a) => out.add(a));
      if (p.kind === 'ring' && g.ownCarbon) out.add(g.anchor);
    }
    return out;
  }

  /** Prefixes on a parent: branches off parent atoms plus N-substituents of principal amines/amides. */
  prefixes(p: Parent, sites: Map<Group, AtomId>): Prefix[] {
    const mol = this.mol;
    const inP = new Set(p.atoms);
    const consumed = this.consumedBy(p, sites);
    const out: Prefix[] = [];
    for (const a of p.atoms) {
      for (const b of mol.incidentBonds(a)) {
        const bd = mol.bond(b);
        const n = mol.otherAtom(bd, a);
        if (inP.has(n) || consumed.has(n)) continue;
        if (bd.order === 2) { out.push({ ...this.ylidene(n, a), at: a }); continue; }
        if (bd.order !== 1) throw new OutOfScope('multiple bond leaving the parent');
        out.push({ ...this.substituent(n, a), at: a });
      }
    }
    // N-substituents of principal amines and amides.
    for (const g of sites.keys()) {
      if (!g.nitrogen) continue;
      const anchorC = g.kind === 'amine' || g.kind === 'aminium' ? sites.get(g)! : g.anchor;
      for (const n of mol.neighbours(g.nitrogen)) {
        if (n === anchorC) continue;
        out.push({ ...this.substituent(n, g.nitrogen), at: 'N', nOf: anchorC });
      }
    }
    return out;
  }

  ylidene(n: AtomId, from: AtomId): SubName {
    const mol = this.mol;
    const e = el(mol, n);
    const deg = mol.neighbours(n).length;
    if (e === 'O' && deg === 1) return { text: 'oxo', complex: false, sortKey: 'oxo' };
    if (e === 'S' && deg === 1) return { text: 'thioxo', complex: false, sortKey: 'thioxo' };
    if (e === 'N' && deg === 1) return { text: 'imino', complex: false, sortKey: 'imino' };
    if (e === 'C' && deg === 1) return { text: 'methylene', complex: false, sortKey: 'methylene' };
    if (e === 'N' && deg === 2) {
      // =N-R: hydroxyimino (oximes), methoxyimino, phenylimino, (dimethylamino)imino.
      const r = mol.neighbours(n).find((x) => x !== from)!;
      if (mol.bondBetween(n, r)!.order !== 1) throw new OutOfScope('ylidene substituent');
      const R = this.substituent(r, n);
      const text = `${R.complex ? `(${R.text})` : R.text}imino`;
      return { text, complex: true, sortKey: `${R.sortKey}imino` };
    }
    if (e === 'C') {
      if (this.an.ringAtoms.has(n)) return this.ringSubstituent(n, from, true);
      return this.alkyl(n, from, 'ylidene');
    }
    throw new OutOfScope('ylidene substituent');
  }

  chooseParent(): { parent: Parent; numbering: Numbering } {
    const candidates = [...this.ringCandidates(), ...this.chainCandidates()];
    let best: { parent: Parent; numbering: Numbering; key: (number | number[])[] } | null = null;
    for (const p of candidates) {
      const sites = this.principalSites(p);
      // Every principal group of the same kind must be expressible: count them.
      const count = sites.size;
      let pre: Prefix[];
      try { pre = this.prefixes(p, sites); } catch (e) { if (e instanceof OutOfScope) continue; throw e; }
      const ringKey = p.ring
        ? [-Number(p.ring.heteroN), -Number(p.ring.heteroO), -Number(p.ring.heteroS), -p.ring.ringCount, -p.ring.size]
        : [0, 0, 0, 0, 0];
      const { mult, dbl } = this.unsaturationAtoms(p);
      const heteroAtoms = p.ring?.kind === 'vonbaeyer' ? p.atoms.filter((a) => el(this.mol, a) !== 'C') : [];
      for (const numbering of p.numberings) {
        const key: (number | number[])[] = [
          -count,
          p.kind === 'ring' ? 0 : 1,
          ...ringKey,
          p.kind === 'chain' ? -p.atoms.length : 0,
          -mult.length,
          -dbl.length,
          heteroAtoms.map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          [...heteroAtoms].sort((a, b) => 'OSN'.indexOf(el(this.mol, a)) - 'OSN'.indexOf(el(this.mol, b))).map((a) => locVal(numbering.get(a)!)),
          (hydroOf.get(numbering)?.ih ?? []).map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          [...sites.values()].map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          (hydroOf.get(numbering)?.hydro ?? []).map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          mult.map((bond) => this.bondLocant(p, numbering, bond)).sort((x, y) => x - y),
          dbl.map((bond) => this.bondLocant(p, numbering, bond)).sort((x, y) => x - y),
          -pre.length,
          pre.filter((x) => x.at !== 'N').map((x) => locVal(numbering.get(x.at as AtomId)!)).sort((x, y) => x - y),
          [...pre].filter((x) => x.at !== 'N').sort((x, y) => x.sortKey.localeCompare(y.sortKey)).map((x) => locVal(numbering.get(x.at as AtomId)!)),
        ];
        if (!best || cmpKey(key, best.key) < 0) best = { parent: p, numbering, key };
      }
    }
    if (!best) throw new OutOfScope('no parent hydride');
    // All principal groups must sit on the parent; otherwise the name needs prefixes for some
    // of them, which we only support for the subordinate kinds.
    return best;
  }

  /** In-parent multiple bonds that become ene/yne (chains and cycloalkenes). */
  unsaturationAtoms(p: Parent): { mult: [AtomId, AtomId][]; dbl: [AtomId, AtomId][]; trip: [AtomId, AtomId][] } {
    const mult: [AtomId, AtomId][] = [], dbl: [AtomId, AtomId][] = [], trip: [AtomId, AtomId][] = [];
    if (p.kind === 'ring' && p.ring?.kind === 'template') return { mult, dbl, trip };
    const inP = new Set(p.atoms);
    for (const b of this.mol.bonds()) {
      if (!inP.has(b.begin) || !inP.has(b.end) || b.order === 1) continue;
      mult.push([b.begin, b.end]);
      if (b.order === 2) dbl.push([b.begin, b.end]);
      if (b.order === 3) trip.push([b.begin, b.end]);
    }
    return { mult, dbl, trip };
  }

  bondLocant(p: Parent, numbering: Numbering, [a, b]: [AtomId, AtomId]): number {
    const x = locVal(numbering.get(a)!), y = locVal(numbering.get(b)!);
    if (p.kind === 'ring' && p.ring?.kind !== 'vonbaeyer' && Math.abs(x - y) > 1) return Math.max(x, y);
    return Math.min(x, y);
  }

  /**
   * A double bond's locant as written: its lower end, or "1(6)" in a von Baeyer
   * or spiro system when the bond joins atoms that are not numbered in sequence.
   */
  bondLocantText(p: Parent, numbering: Numbering, bond: [AtomId, AtomId]): string {
    const x = locVal(numbering.get(bond[0])!), y = locVal(numbering.get(bond[1])!);
    if (p.kind === 'ring' && p.ring?.kind === 'vonbaeyer' && Math.abs(x - y) !== 1) return `${Math.min(x, y)}(${Math.max(x, y)})`;
    return String(this.bondLocant(p, numbering, bond));
  }

  // --------------------------------------------------------------- render

  /** Numbering being rendered (for added-hydrogen locants). */
  currentNumbering: Numbering | null = null;

  render(p: Parent, numbering: Numbering): string {
    this.currentNumbering = numbering;
    const sites = this.principalSites(p);
    const pre = this.prefixes(p, sites);
    const kind = this.principal;
    const loc = (a: AtomId) => numbering.get(a)!;
    const siteLocs = [...sites.values()].map(loc).sort(compareLocant);
    const { mult, dbl, trip } = this.unsaturationAtoms(p);

    // Retained parents (ChemDraw style).
    const retained = this.retainedParent(p, kind, sites, pre);
    const cPrefixes = pre.filter((x) => x.at !== 'N').length;
    const features = sites.size + cPrefixes + mult.length;

    // Locant omission: methane/ethane-like parents and monosubstituted symmetric rings.
    const symmetricRing = p.kind === 'ring' && (p.ring!.kind === 'cyclo' || p.ring!.template?.name === 'benzene');
    const omitAll = (p.kind === 'chain' && (p.atoms.length === 1 || (p.atoms.length === 2 && features <= 1)))
      || (symmetricRing && features <= 1 && (p.ring!.kind !== 'cyclo' || mult.length <= 1));

    const manyN = [...sites.keys()].filter((g) => g.nitrogen !== undefined).length > 1;
    const prefixText = this.prefixString(pre, numbering, omitAll, manyN);

    let parentName: string;
    const ium = kind === 'ium' ? [] : p.atoms.filter((a) => isRingCation(this.mol, a) && this.an.ringAtoms.has(a)).map(loc).sort(compareLocant);
    if (retained && !ium.length) {
      parentName = retained;
    } else {
      let hydride = this.hydrideName(p, numbering, dbl, trip, omitAll);
      if (ium.length) hydride = attachSuffix(hydride, ium.join(','), `${multiplier(ium.length)}ium`);
      parentName = this.withSuffix(p, hydride, kind, siteLocs, sites.size, omitAll);
    }
    const joiner = prefixText && /^[0-9(]/.test(parentName) ? '-' : '';
    return prefixText + joiner + parentName;
  }

  retainedParent(p: Parent, kind: GroupKind | null, sites: Map<Group, AtomId>, pre: Prefix[]): string | null {
    const g = [...sites.keys()][0];
    const benzene = p.kind === 'ring' && p.ring!.template?.name === 'benzene';
    if (benzene && sites.size === 1) {
      const nPre = pre.length;
      switch (kind) {
        case 'carboxylate': return 'benzoate';
        case 'olate': return 'phenolate';
        case 'alcohol': return 'phenol';
        case 'amine': return 'aniline';
        case 'acid': return 'benzoic acid';
        case 'aldehyde': return 'benzaldehyde';
        case 'nitrile': return 'benzonitrile';
        case 'amide': return 'benzamide';
        case 'acylHalide': return `benzoyl ${HALIDE[g!.halogen!]}`;
        default: void nPre;
      }
    }
    if (benzene && sites.size === 0 && pre.length === 1) {
      const t = pre[0]!.text;
      if (t === 'methyl') { pre.length = 0; return 'toluene'; }
      if (t === 'isopropyl') { pre.length = 0; return 'cumene'; }
      if (t === 'vinyl') { pre.length = 0; return 'styrene'; }
      if (t === 'methoxy') { pre.length = 0; return 'anisole'; }
    }
    if (p.kind === 'chain' && sites.size === 1 && g?.ownCarbon && p.atoms.length <= 2 && this.unsaturationAtoms(p).mult.length === 0) {
      const acetic = p.atoms.length === 2;
      switch (kind) {
        case 'carboxylate': return acetic ? 'acetate' : 'formate';
        case 'acid': return acetic ? 'acetic acid' : 'formic acid';
        case 'amide': return acetic ? 'acetamide' : 'formamide';
        case 'aldehyde': return acetic ? 'acetaldehyde' : 'formaldehyde';
        case 'nitrile': return acetic ? 'acetonitrile' : null;
        case 'acylHalide': return acetic ? `acetyl ${HALIDE[g.halogen!]}` : null;
        default: return null;
      }
    }
    return null;
  }

  hydrideName(p: Parent, numbering: Numbering, dbl: [AtomId, AtomId][], trip: [AtomId, AtomId][], omitAll: boolean): string {
    if (p.kind === 'ring' && p.ring!.kind === 'template') {
      const t = p.ring!.template!;
      const h = hydroOf.get(numbering);
      if (h) return withHydro(t.name, h, numbering);
      return t.indicatedH ? `${t.indicatedH}H-${t.name}` : t.name;
    }
    const n = p.kind === 'ring' ? p.ring!.size : p.atoms.length;
    const vb = p.kind === 'ring' && p.ring!.kind === 'vonbaeyer';
    const hetero = vb ? heteroPrefix(this.mol, p.atoms, numbering) : '';
    const stem = vb ? `${hetero}${hetero ? '' : ''}${p.ring!.bracket}${alkaneStem(n)}` : (p.kind === 'ring' ? 'cyclo' : '') + alkaneStem(n);
    if (!dbl.length && !trip.length) return `${stem}ane`;
    const locs = (bonds: [AtomId, AtomId][]) => bonds.map((b) => this.bondLocantText(p, numbering, b)).sort(compareLocant).join(',');
    let name = stem;
    if (dbl.length) {
      const m = multiplier(dbl.length);
      name += `${m ? 'a' : ''}${omitAll ? '' : `-${locs(dbl)}-`}${m}ene`;
    }
    if (trip.length) {
      const m = multiplier(trip.length);
      if (dbl.length) name = name.slice(0, -1); // ene -> en before yne
      else name += m ? 'a' : '';
      name += `${omitAll ? '' : `-${locs(trip)}-`}${m}yne`;
    }
    return name;
  }

  withSuffix(p: Parent, hydride: string, kind: GroupKind | null, locs: string[], count: number, omitAll: boolean): string {
    if (!kind || count === 0) return hydride;
    const m = multiplier(count);
    const ownCarbonOnRing = p.kind === 'ring' && this.principalGroups[0]!.ownCarbon;
    const terminal = p.kind === 'chain' && this.principalGroups[0]!.ownCarbon;
    const showLocs = !(omitAll || terminal) ? locs.join(',') : '';
    const g = this.principalGroups[0]!;
    const SUFFIX: Record<GroupKind, [string, string]> = {
      carboxylate: ['oate', 'carboxylate'],
      olate: ['olate', 'olate'],
      aminium: ['aminium', 'aminium'],
      acid: ['oic acid', 'carboxylic acid'],
      ester: ['oate', 'carboxylate'],
      acylHalide: [`oyl ${HALIDE[g.halogen ?? 'Cl']}`, `carbonyl ${HALIDE[g.halogen ?? 'Cl']}`],
      amide: ['amide', 'carboxamide'],
      urea: ['urea', 'urea'],
      ium: ['ium', 'ium'],
      nitrile: ['nitrile', 'carbonitrile'],
      aldehyde: ['al', 'carbaldehyde'],
      ketone: ['one', 'one'],
      alcohol: ['ol', 'ol'],
      thiol: ['thiol', 'thiol'],
      amine: ['amine', 'amine'],
    };
    const [chainForm, ringForm] = SUFFIX[kind];
    const addedH = p.kind === 'ring' ? p.ring!.addedH : undefined;
    if (addedH && addedH.size && kind === 'ketone' && this.currentNumbering) {
      const num = this.currentNumbering;
      const tmpl = p.ring!.template!;
      // NH atoms that the parent itself already has (1H-indole) are not added hydrogen.
      const hLocs = [...addedH].map((a) => num.get(a)!).filter((l) => l !== tmpl.indicatedH).sort(compareLocant);
      const base = tmpl.indicatedH ? `${tmpl.indicatedH}H-${tmpl.name}` : tmpl.name;
      return attachSuffix(base, `${locs.join(',')}(${hLocs.map((l) => `${l}H`).join(',')})`, `${m}one`);
    }
    if (ownCarbonOnRing) {
      // Carbon outside the ring: cyclohexanecarboxylic acid, pyridine-3-carboxylic acid.
      const suffix = `${m}${ringForm}`;
      return showLocs ? `${hydride}-${showLocs}-${suffix}` : `${hydride}${suffix}`;
    }
    if (kind === 'acid' || kind === 'ester' || kind === 'acylHalide' || kind === 'carboxylate') {
      // -oic acid: for di-acids the 'o' joins the multiplier: butanedioic acid.
      return attachSuffix(hydride, showLocs, `${m}${chainForm}`);
    }
    return attachSuffix(hydride, showLocs, `${m}${chainForm}`);
  }

  /** `manyN`: the parent carries several amines or amides, so N locants say whose nitrogen (N1,N1-diethyl). */
  prefixString(pre: Prefix[], numbering: Numbering, omitAll: boolean, manyN = false): string {
    // Group identical prefixes.
    const groups = new Map<string, { sub: Prefix; locs: string[] }>();
    for (const x of pre) {
      const loc = x.at === 'N' ? (manyN && x.nOf !== undefined ? `N${numbering.get(x.nOf)}` : 'N') : numbering.get(x.at)!;
      const g = groups.get(x.text);
      if (g) g.locs.push(loc); else groups.set(x.text, { sub: x, locs: [loc] });
    }
    const sorted = [...groups.values()].sort((a, b) => a.sub.sortKey.localeCompare(b.sub.sortKey) || a.sub.text.localeCompare(b.sub.text));
    let out = '';
    for (const { sub, locs } of sorted) {
      const n = locs.length;
      const body = sub.complex ? `${complexMultiplier(n)}(${sub.text})` : `${multiplier(n)}${sub.text}`;
      const nLocs = locs.filter((l) => l.startsWith('N')).sort();
      const cLocs = locs.filter((l) => !l.startsWith('N')).sort(compareLocant);
      const showC = !omitAll;
      const locStr = [...nLocs, ...(showC ? cLocs : [])].join(',');
      if (locStr) out += (out ? '-' : '') + `${locStr}-${body}`;
      else out += body;
    }
    return out;
  }

  /**
   * 1,1'-Biphenyl: two benzene rings joined by a single bond, with no
   * principal characteristic group. Locants 1-6 on one ring, 1'-6' on the
   * other, unprimed locants as low as possible.
   */
  biphenyl(): string | null {
    if (this.principal) return null;
    const mol = this.mol;
    const rings = this.ringCandidates().filter((r) => r.ring!.template?.name === 'benzene');
    if (rings.length !== 2 || this.an.ringSystems.length !== 2) return null;
    const [A, B] = rings as [Parent, Parent];
    const inA = new Set(A.atoms), inB = new Set(B.atoms);
    let link: [AtomId, AtomId] | null = null;
    for (const a of A.atoms) for (const n of mol.neighbours(a)) if (inB.has(n)) link = [a, n];
    if (!link) return null;
    const both = new Set([...A.atoms, ...B.atoms]);
    let best: { numbering: Numbering; key: (number | number[])[]; pre: Prefix[] } | null = null;
    for (const [first, second, fa, sb] of [[A, B, link[0], link[1]], [B, A, link[1], link[0]]] as const) {
      for (const n1 of first.numberings) {
        if (n1.get(fa) !== '1') continue;
        for (const n2 of second.numberings) {
          if (n2.get(sb) !== '1') continue;
          const numbering: Numbering = new Map([...n1, ...[...n2].map(([k, v]) => [k, `${v}'`] as [AtomId, string])]);
          const pre: Prefix[] = [];
          for (const a of both) for (const bnd of mol.incidentBonds(a)) {
            const bd = mol.bond(bnd);
            const n = mol.otherAtom(bd, a);
            if (both.has(n)) continue;
            if (bd.order !== 1) return null;
            pre.push({ ...this.substituent(n, a), at: a });
          }
          const val = (l: string) => locVal(l) + (l.endsWith("'") ? 100 : 0);
          const key: (number | number[])[] = [
            pre.map((x) => val(numbering.get(x.at as AtomId)!)).sort((p, q) => p - q),
            [...pre].sort((x, y) => x.sortKey.localeCompare(y.sortKey)).map((x) => val(numbering.get(x.at as AtomId)!)),
          ];
          if (!best || cmpKey(key, best.key) < 0) best = { numbering, key, pre };
        }
      }
    }
    void inA;
    if (!best) return null;
    const prefix = this.prefixString(best.pre, best.numbering, false);
    return `${prefix}${prefix ? '-' : ''}1,1'-biphenyl`;
  }

  /**
   * Substituted ureas: 1,1-dimethyl-3-phenylurea. The nitrogen with more
   * substituents is N1 (lowest locants), then the one cited first.
   */
  nameUrea(g: Group): string {
    const mol = this.mol;
    const [n1, n2] = [g.consumed[1]!, g.consumed[2]!];
    const subsOf = (n: AtomId) => mol.neighbours(n).filter((x) => x !== g.anchor).map((x) => this.substituent(x, n));
    let a = subsOf(n1), b = subsOf(n2);
    const first = (xs: SubName[]) => [...xs].sort((x, y) => x.sortKey.localeCompare(y.sortKey))[0]?.sortKey ?? '~';
    if (b.length > a.length || (b.length === a.length && first(b) < first(a))) [a, b] = [b, a];
    if (!a.length) return 'urea';
    const pre: Prefix[] = [...a.map((x) => ({ ...x, at: n1 })), ...b.map((x) => ({ ...x, at: n2 }))];
    const numbering: Numbering = new Map([[n1, '1'], [n2, '3']]);
    const text = this.prefixString(pre, numbering, false);
    return `${text}urea`;
  }

  // ------------------------------------------------------------- esters

  /** R-O-C(=O)-N (carbamate) and R-O-C(=O)-O-R (carbonate) esters. */
  carbonicEster(): string | null {
    const mol = this.mol;
    const g = this.principalGroups[0]!;
    const c = g.anchor;
    const rest = mol.neighbours(c).filter((n) => !g.consumed.includes(n));
    if (rest.length !== 1) return null;
    const x = rest[0]!;
    const alkyl = this.substituent(g.esterCarbon!, g.consumed[1]!).text;
    if (el(mol, x) === 'N' && this.an.ringAtoms.has(x)) return null;
    if (el(mol, x) === 'N' && mol.incidentBonds(x).every((b) => mol.bond(b).order === 1)) {
      const subs = mol.neighbours(x).filter((n) => n !== c).map((n) => this.substituent(n, x));
      if (subs.some(() => this.an.groups.some((gg) => gg !== g && gg.kind === 'ester'))) return null;
      const wrap = (t: SubName) => (t.complex ? `(${t.text})` : t.text);
      const nPart = subs.length === 0 ? '' : subs.length === 2 && subs[0]!.text === subs[1]!.text ? `di${wrap(subs[0]!)}`
        : [...subs].sort((p, q) => p.sortKey.localeCompare(q.sortKey)).map(wrap).join('');
      return `${alkyl} ${nPart}carbamate`;
    }
    if (el(mol, x) === 'O' && mol.neighbours(x).length === 2) {
      const r2 = mol.neighbours(x).find((n) => n !== c)!;
      if (el(mol, r2) !== 'C' || this.principalGroups.length !== 1) return null;
      const b = this.substituent(r2, x).text;
      return alkyl === b ? `di${alkyl} carbonate` : `${[alkyl, b].sort().join(' ')} carbonate`;
    }
    return null;
  }

  nameEster(): string {
    const carbonic = this.carbonicEster();
    if (carbonic) return carbonic;
    const best = this.chooseParent();
    const p = best.parent;
    const sites = this.principalSites(p);
    const esters = [...sites.keys()];
    if (!esters.length) throw new OutOfScope('ester not on the parent');
    const alkyls = esters.map((g) => this.substituent(g.esterCarbon!, g.consumed[1]!));
    if (new Set(alkyls.map((a) => a.text)).size > 1) throw new OutOfScope('esters with different alkyl groups');
    // Retained acid names give retained anion names.
    const pre = this.prefixes(p, sites);
    const benzene = p.kind === 'ring' && p.ring!.template?.name === 'benzene';
    let acid: string;
    if (benzene && sites.size === 1) acid = this.prefixString(pre, best.numbering, false) + 'benzoate';
    else if (p.kind === 'chain' && p.atoms.length <= 2 && sites.size === 1 && this.unsaturationAtoms(p).mult.length === 0) {
      const ps = this.prefixString(pre, best.numbering, false);
      acid = ps + (p.atoms.length === 2 ? 'acetate' : 'formate');
    } else acid = this.render(p, best.numbering);
    acid = this.withStereo(p.atoms, best.numbering, acid);
    const alkyl = alkyls[0]!;
    if (esters.length === 1) return `${alkyl.text} ${acid}`;
    return alkyl.complex ? `${complexMultiplier(esters.length)}(${alkyl.text}) ${acid}` : `${multiplier(esters.length)}${alkyl.text} ${acid}`;
  }

  // -------------------------------------------------------- substituents

  substituent(a: AtomId, from: AtomId): SubName {
    const key = `${a}<${from}`;
    const hit = this.subCache.get(key);
    if (hit) return hit;
    const r = this.computeSubstituent(a, from);
    this.subCache.set(key, r);
    return r;
  }

  computeSubstituent(a: AtomId, from: AtomId): SubName {
    const mol = this.mol;
    const e = el(mol, a);
    const others = mol.neighbours(a).filter((n) => n !== from);
    const simple = (text: string): SubName => ({ text, complex: false, sortKey: text });
    if (this.an.ringAtoms.has(a)) return this.ringSubstituent(a, from);
    if (HALO[e]) return simple(HALO[e]!);
    if (e === 'O') {
      if (others.length === 0) return simple(mol.atom(a).charge === -1 ? 'oxido' : 'hydroxy');
      const r = others[0]!;
      if (isAcylCarbon(mol, r)) {
        const acyl = this.substituent(r, a);
        return acyl.text === 'acetyl' ? simple('acetoxy') : { text: `${acyl.text}oxy`, complex: true, sortKey: `${acyl.sortKey}oxy` };
      }
      const R = this.substituent(r, a);
      const ALKOXY: Record<string, string> = { methyl: 'methoxy', ethyl: 'ethoxy', propyl: 'propoxy', butyl: 'butoxy', isopropyl: 'isopropoxy', phenyl: 'phenoxy', 'tert-butyl': 'tert-butoxy' };
      if (ALKOXY[R.text]) return { text: ALKOXY[R.text]!, complex: R.text === 'tert-butyl', sortKey: ALKOXY[R.text]!.replace(/^tert-/, '') };
      return { text: `${R.complex ? `(${R.text})` : R.text}oxy`, complex: true, sortKey: `${R.sortKey}oxy` };
    }
    if (e === 'Si' || e === 'Sn') {
      // Trialkylsilyl / trialkylstannyl, e.g. tert-butyldimethylsilyl, tributylstannyl.
      if (!others.every((n) => el(mol, n) === 'C' && mol.bondBetween(a, n)!.order === 1)) throw new OutOfScope(`${e} substituent`);
      const word = e === 'Si' ? 'silyl' : 'stannyl';
      const inner = others.length ? this.groupedSubs(others, a) : '';
      const text = `${inner}${word}`;
      return { text, complex: true, sortKey: text.replace(/^(tert|sec)-/, '').replace(/[^a-z]/g, '') };
    }
    if (e === 'P') {
      // (RO)2P(=O)- phosphoryl, (RO)2P(=S)- phosphorothioyl, R2P- phosphanyl.
      const dbl = others.filter((n) => mol.bondBetween(a, n)!.order === 2);
      if (dbl.length > 1 || dbl.some((n) => !['O', 'S'].includes(el(mol, n)) || mol.neighbours(n).length !== 1)) throw new OutOfScope('phosphorus substituent');
      const rest = others.filter((n) => !dbl.includes(n));
      const parts = rest.map((n) => this.substituent(n, a));
      const counts = new Map<string, { s: SubName; n: number }>();
      for (const p2 of parts) { const c2 = counts.get(p2.text); if (c2) c2.n++; else counts.set(p2.text, { s: p2, n: 1 }); }
      // Every prefix after the first in brackets: hydroxy(methoxy)phosphorothioyl.
      const inner = [...counts.values()].sort((x, y) => x.s.sortKey.localeCompare(y.s.sortKey))
        .map(({ s: s2, n }, i) => (s2.complex || (i > 0 && n === 1) ? `${complexMultiplier(n)}(${s2.text})` : `${multiplier(n)}${s2.text}`)).join('');
      const word = !dbl.length ? 'phosphanyl' : el(mol, dbl[0]!) === 'S' ? 'phosphorothioyl' : 'phosphoryl';
      const text = `${inner}${word}`;
      return { text, complex: true, sortKey: text.replace(/[^a-z]/g, '') };
    }
    if (e === 'S') {
      const oxo = others.filter((n) => el(mol, n) === 'O' && mol.bondBetween(a, n)!.order === 2).length;
      const rest = others.filter((n) => !(el(mol, n) === 'O' && mol.bondBetween(a, n)!.order === 2));
      if (rest.length === 0 && oxo === 0) return simple('mercapto');
      if (rest.length === 1) {
        const R = this.substituent(rest[0]!, a);
        const tail = oxo === 2 ? 'sulfonyl' : oxo === 1 ? 'sulfinyl' : 'thio';
        const inner = R.complex ? `(${R.text})` : R.text;
        return { text: `${inner}${tail}`, complex: true, sortKey: `${R.sortKey}${tail}` };
      }
      throw new OutOfScope('sulfur substituent');
    }
    if (e === 'N') {
      const oxy = others.filter((n) => el(mol, n) === 'O');
      if (oxy.length === 2) return simple('nitro');
      if (mol.atom(a).charge === 1) {
        // Open-chain ammonium as a prefix: trimethylazaniumyl, azaniumyl.
        if (!mol.incidentBonds(a).every((b) => mol.bond(b).order === 1)) throw new OutOfScope('nitrogen substituent');
        const inner = others.length ? this.groupedSubs(others, a) : '';
        return { text: `${inner}azaniumyl`, complex: true, sortKey: `${inner}azaniumyl`.replace(/[^a-z]/g, '') };
      }
      const dbl = others.find((n) => mol.bondBetween(a, n)!.order === 2);
      if (dbl !== undefined && el(mol, dbl) === 'O' && others.length === 1) return simple('nitroso');
      if (dbl !== undefined && el(mol, dbl) === 'N' && others.length === 1) {
        const beyond = mol.neighbours(dbl).filter((x) => x !== a);
        // -N=N+=N- azido; -N=N-R (E)-phenyldiazenyl.
        if (mol.atom(dbl).charge === 1 && beyond.length === 1 && mol.atom(beyond[0]!).charge === -1 && mol.neighbours(beyond[0]!).length === 1) return simple('azido');
        if (mol.atom(dbl).charge !== 0 || beyond.length > 1) throw new OutOfScope('nitrogen substituent');
        if (!beyond.length) return simple('diazenyl');
        const R = this.substituent(beyond[0]!, dbl);
        const ez = this.ez.get(`${a}-${dbl}`);
        const text = `${ez ? `(${ez})-` : ''}${R.complex ? `(${R.text})` : R.text}diazenyl`;
        return { text, complex: true, sortKey: `${R.sortKey}diazenyl` };
      }
      if (dbl !== undefined) {
        // -N=C<: (propan-2-ylidene)amino, benzylideneamino; -N=C=S isothiocyanato.
        if (el(mol, dbl) !== 'C' || others.length !== 1) throw new OutOfScope('nitrogen substituent');
        const cum = mol.neighbours(dbl).filter((x) => x !== a);
        if (cum.length === 1 && mol.bondBetween(dbl, cum[0]!)!.order === 2 && mol.neighbours(cum[0]!).length === 1) {
          if (el(mol, cum[0]!) === 'S') return simple('isothiocyanato');
          if (el(mol, cum[0]!) === 'O') return simple('isocyanato');
        }
        const Y = this.ylidene(dbl, a);
        return { text: `${Y.complex ? `(${Y.text})` : Y.text}amino`, complex: true, sortKey: `${Y.sortKey}amino` };
      }
      if (!mol.incidentBonds(a).every((b) => mol.bond(b).order === 1)) throw new OutOfScope('nitrogen substituent');
      // -NH-NH2 hydrazinyl; other N, O and S neighbours are named as prefixes on amino:
      // (phenylamino)amino, hydroxyamino, (methylsulfonyl)amino.
      if (others.length === 1 && el(mol, others[0]!) === 'N' && mol.neighbours(others[0]!).length === 1 && mol.atom(others[0]!).charge === 0) return simple('hydrazinyl');
      const acyl = others.find((n) => isAcylCarbon(mol, n));
      if (acyl !== undefined && others.length === 1) {
        const A = this.substituent(acyl, a);
        if (A.text === 'acetyl') return simple('acetamido');
        if (A.text === 'benzoyl') return simple('benzamido');
        return { text: `${A.complex ? `(${A.text})` : A.text}amino`, complex: true, sortKey: `${A.sortKey}amino` };
      }
      if (others.length === 0) return simple('amino');
      const subs = others.map((n) => this.substituent(n, a)).sort((x, y) => x.sortKey.localeCompare(y.sortKey));
      if (subs.length === 2 && subs[0]!.text === subs[1]!.text) {
        const s = subs[0]!;
        return { text: `di${s.complex ? `(${s.text})` : s.text}amino`, complex: true, sortKey: `di${s.sortKey}amino` };
      }
      const inner = subs.map((s, i) => (i < subs.length - 1 || s.complex) ? (s.complex || subs.length > 1 && i > 0 ? `(${s.text})` : s.text) : s.text).join('');
      const wrap0 = subs[0]!.complex ? `(${subs[0]!.text})` : subs[0]!.text;
      const text = subs.length === 1 ? `${wrap0}amino` : `${wrap0}(${subs[1]!.text})amino`;
      void inner;
      return { text, complex: true, sortKey: `${subs.map((s) => s.sortKey).join('')}amino` };
    }
    if (e !== 'C') throw new OutOfScope(`substituent on ${e}`);
    if (this.an.ringAtoms.has(a)) return this.ringSubstituent(a, from);
    return this.carbonSubstituent(a, from);
  }

  /** Acyclic carbon substituents: functional carbons first, then alkyl chains. */
  carbonSubstituent(a: AtomId, from: AtomId): SubName {
    const mol = this.mol;
    const simple = (text: string): SubName => ({ text, complex: false, sortKey: text });
    const bonds = mol.incidentBonds(a).map((b) => ({ n: mol.otherAtom(mol.bond(b), a), o: mol.bond(b).order })).filter((x) => x.n !== from);
    const dO = bonds.find((x) => x.o === 2 && el(mol, x.n) === 'O');
    const tN = bonds.find((x) => x.o === 3 && el(mol, x.n) === 'N');
    if (tN) return simple('cyano');
    if (dO) {
      const rest = bonds.filter((x) => x !== dO);
      if (rest.length === 0) return simple('formyl');
      const r = rest[0]!;
      const re = el(mol, r.n);
      if (re === 'O') {
        const beyond = mol.neighbours(r.n).filter((n) => n !== a);
        if (beyond.length === 0) return simple('carboxy');
        const R = this.substituent(beyond[0]!, r.n);
        const alk = ({ methyl: 'methoxy', ethyl: 'ethoxy', 'tert-butyl': 'tert-butoxy', benzyl: 'benzyloxy' } as Record<string, string>)[R.text] ?? `${R.complex ? `(${R.text})` : R.text}oxy`;
        return { text: `${alk}carbonyl`, complex: true, sortKey: `${alk.replace(/^tert-/, '')}carbonyl` };
      }
      if (re === 'N' && this.an.ringAtoms.has(r.n)) {
        // C(=O) on a ring nitrogen: piperidine-1-carbonyl.
        const R = this.ringSubstituent(r.n, a);
        // Swap the substituent ending for the ring's own name: piperidin-1-yl -> piperidine-1-carbonyl.
        let text = R.text === 'morpholino' ? 'morpholine-4-carbonyl' : '';
        for (const t of TEMPLATES) {
          const m = new RegExp(`${t.yl.replace(/[[\]]/g, '\\$&')}-(\\d+)-yl$`).exec(R.text);
          if (!text && m) text = R.text.slice(0, m.index) + `${t.indicatedH && !R.text.slice(0, m.index).endsWith('H-') ? '' : ''}${t.name}-${m[1]}-carbonyl`;
        }
        if (!text) text = `${R.complex ? `(${R.text})` : R.text}carbonyl`;
        return { text, complex: true, sortKey: text.replace(/[^a-z]/g, '') };
      }
      if (re === 'N') {
        const nsubs = mol.neighbours(r.n).filter((n) => n !== a);
        if (nsubs.length === 0) return simple('carbamoyl');
        const S = nsubs.map((n) => this.substituent(n, r.n));
        const text = S.length === 2 && S[0]!.text === S[1]!.text ? `di${S[0]!.text}carbamoyl` : `${S.map((s) => s.text).join('')}carbamoyl`;
        return { text, complex: true, sortKey: text };
      }
      if (HALO[re]) return { text: `${HALO[re]!.replace('o', 'o')}carbonyl`.replace(/^(\w+)o(carbonyl)$/, '$1ocarbonyl'), complex: true, sortKey: 'carbonyl' };
      if (re === 'C') {
        // Acyl: acetyl, benzoyl, or alkanoyl numbered from the carbonyl carbon.
        if (this.an.ringAtoms.has(r.n)) {
          const R = this.ringSubstituent(r.n, a);
          if (R.text === 'phenyl') return simple('benzoyl');
          return { text: `${R.complex ? `(${R.text})` : R.text}carbonyl`, complex: true, sortKey: `${R.sortKey}carbonyl` };
        }
        const chain = this.alkyl(a, from, 'oyl');
        if (chain.text === 'ethanoyl') return simple('acetyl');
        return chain;
      }
      throw new OutOfScope('acyl substituent');
    }
    return this.alkyl(a, from, 'yl');
  }

  /**
   * Alkyl (or acyl) substituent rooted at `a`: longest chain through the
   * attachment, lowest locant to the free valence, then the usual criteria.
   * Uses ChemDraw's traditional names where it does (isopropyl, tert-butyl).
   */
  alkyl(a: AtomId, from: AtomId, ending: 'yl' | 'oyl' | 'ylidene'): SubName {
    const mol = this.mol;
    const ok = (x: AtomId) => this.isChainCarbon(x) && x !== from;
    // Carbons in this substituent's acyclic tree.
    const tree = new Set<AtomId>([a]);
    const stack = [a];
    while (stack.length) {
      const x = stack.pop()!;
      for (const y of mol.neighbours(x)) if (ok(y) && !tree.has(y) && !(ending === 'oyl' && x !== a && false)) { tree.add(y); stack.push(y); }
    }
    // Paths in the tree containing `a` (for acyl, `a` must be an end).
    const paths: AtomId[][] = [];
    const pathFrom = (s: AtomId) => {
      const prev = new Map<AtomId, AtomId>([[s, s]]);
      const q = [s];
      while (q.length) { const x = q.shift()!; for (const y of mol.neighbours(x)) if (tree.has(y) && !prev.has(y)) { prev.set(y, x); q.push(y); } }
      return prev;
    };
    const ends = [...tree];
    for (const s of ends) {
      const prev = pathFrom(s);
      for (const t of ends) {
        const path: AtomId[] = [];
        for (let x = t; ; x = prev.get(x)!) { path.push(x); if (x === s) break; }
        path.reverse();
        if (!path.includes(a)) continue;
        if (ending === 'oyl' && path[0] !== a) continue;
        paths.push(path);
      }
    }
    let best: { path: AtomId[]; key: (number | number[])[]; prefixes: Prefix[] } | null = null;
    for (const path of paths) {
      const inP = new Set(path);
      const fv = path.indexOf(a) + 1;
      const pre: Prefix[] = [];
      let valid = true;
      for (const x of path) for (const b of mol.incidentBonds(x)) {
        const bd = mol.bond(b);
        const n = mol.otherAtom(bd, x);
        if (inP.has(n) || n === from) continue;
        if (ending === 'oyl' && x === a && el(mol, n) === 'O' && bd.order === 2) continue;
        try {
          if (bd.order === 2) pre.push({ ...this.ylidene(n, x), at: x });
          else if (bd.order === 1) pre.push({ ...this.substituent(n, x), at: x });
          else valid = false;
        } catch (e) { if (e instanceof OutOfScope) valid = false; else throw e; }
      }
      if (!valid) continue;
      const mult: number[] = [], dbl: number[] = [];
      for (let i = 0; i + 1 < path.length; i++) {
        const o = mol.bondBetween(path[i]!, path[i + 1]!)!.order;
        if (o > 1) { mult.push(i + 1); if (o === 2) dbl.push(i + 1); }
      }
      const key: (number | number[])[] = [-path.length, -mult.length, -dbl.length, fv, mult, dbl, -pre.length,
        pre.map((x) => path.indexOf(x.at as AtomId) + 1).sort((p, q) => p - q)];
      if (!best || cmpKey(key, best.key) < 0) best = { path, key, prefixes: pre };
    }
    if (!best) throw new OutOfScope('substituent chain');
    const { path, prefixes } = best;
    const n = path.length;
    const fv = path.indexOf(a) + 1;
    const numbering = new Map(path.map((x, i) => [x, String(i + 1)]));
    const mult: [AtomId, AtomId][] = [], dbl: [AtomId, AtomId][] = [], trip: [AtomId, AtomId][] = [];
    for (let i = 0; i + 1 < n; i++) {
      const o = mol.bondBetween(path[i]!, path[i + 1]!)!.order;
      if (o > 1) mult.push([path[i]!, path[i + 1]!]);
      if (o === 2) dbl.push([path[i]!, path[i + 1]!]);
      if (o === 3) trip.push([path[i]!, path[i + 1]!]);
    }
    const pre = this.prefixString(prefixes, numbering, false);

    // Traditional names ChemDraw uses (not where a stereocentre needs a locant).
    const sat = mult.length === 0;
    const chiralHere = path.some((x) => this.rs.has(x));
    if (ending === 'yl' && !prefixes.length && !chiralHere) {
      if (sat && n === 3 && fv === 2) return { text: 'isopropyl', complex: false, sortKey: 'isopropyl' };
      if (sat && n === 4 && fv === 2) return { text: 'sec-butyl', complex: true, sortKey: 'butyl' };
      if (n === 2 && fv === 1 && dbl.length === 1) return { text: 'vinyl', complex: false, sortKey: 'vinyl' };
      if (n === 2 && fv === 1 && trip.length === 1) return { text: 'ethynyl', complex: false, sortKey: 'ethynyl' };
      if (n === 3 && fv === 1 && dbl.length === 1 && dbl[0]![0] === path[1]) return { text: 'allyl', complex: false, sortKey: 'allyl' };
    }
    if (ending === 'yl' && sat && prefixes.length && prefixes.every((x) => x.text === 'methyl')) {
      const locs = prefixes.map((x) => numbering.get(x.at as AtomId)).sort().join(',');
      if (n === 3 && fv === 2 && locs === '2') return { text: 'tert-butyl', complex: true, sortKey: 'butyl' };
      if (n === 3 && fv === 1 && locs === '2') return { text: 'isobutyl', complex: false, sortKey: 'isobutyl' };
    }
    if (ending === 'yl' && sat && n === 1 && prefixes.length === 1 && prefixes[0]!.text === 'phenyl') return { text: 'benzyl', complex: false, sortKey: 'benzyl' };
    if (ending === 'ylidene' && n === 1 && prefixes.length === 1 && prefixes[0]!.text === 'phenyl') return { text: 'benzylidene', complex: false, sortKey: 'benzylidene' };

    const stem = alkaneStem(n);
    let hydride = stem;
    const locs = (bs: [AtomId, AtomId][]) => bs.map((b) => Math.min(Number(numbering.get(b[0])), Number(numbering.get(b[1])))).sort((x, y) => x - y).join(',');
    if (dbl.length) hydride += `${multiplier(dbl.length) ? 'a' : ''}-${locs(dbl)}-${multiplier(dbl.length)}en`;
    if (trip.length) hydride += `${dbl.length ? '' : (multiplier(trip.length) ? 'a' : '')}-${locs(trip)}-${multiplier(trip.length)}yn`;
    let core: string;
    if (ending === 'oyl') core = mult.length ? `${hydride}oyl` : `${stem}anoyl`;
    else if (ending === 'ylidene') core = n === 1 ? 'methylidene' : fv === 1 && !mult.length ? `${stem}ylidene` : !mult.length ? `${stem}an-${fv}-ylidene` : `${hydride}-${fv}-ylidene`;
    else if (fv === 1 && !mult.length) core = `${stem}yl`;
    else if (!mult.length) core = `${stem}an-${fv}-yl`;
    else core = `${hydride}-${fv}-yl`;
    const plain = pre + core;
    const stereo = this.stereoPrefix(path, numbering, from);
    const text = stereo ? `${stereo}-${plain}` : plain;
    const complex = /[0-9]/.test(text) || text.includes('(');
    return { text, complex, sortKey: plain.replace(/^(tert|sec)-/, '').replace(/[^a-z]/g, '') };
  }

  ringSubstituent(a: AtomId, from: AtomId, ylidene = false): SubName {
    const system = this.ringByAtom.get(a)!;
    if (system.includes(from)) throw new OutOfScope('ring entered from inside itself');
    const r = recognizeRing(this.an, system);
    if (!r) throw new OutOfScope('ring substituent without a supported name');
    const mol = this.mol;
    const inS = new Set(system);
    let best: { numbering: Numbering; key: (number | number[])[]; pre: Prefix[] } | null = null;
    const pre: Prefix[] = [];
    for (const x of system) for (const b of mol.incidentBonds(x)) {
      const bd = mol.bond(b);
      const n = mol.otherAtom(bd, x);
      if (inS.has(n) || (x === a && n === from)) continue;
      if (bd.order === 2) { pre.push({ ...this.ylidene(n, x), at: x }); continue; }
      if (bd.order !== 1) throw new OutOfScope('multiple bond on ring substituent');
      pre.push({ ...this.substituent(n, x), at: x });
    }
    const unsat: [AtomId, AtomId][] = [];
    if (r.info.kind !== 'template') for (const b of mol.bonds()) if (inS.has(b.begin) && inS.has(b.end) && b.order === 2) unsat.push([b.begin, b.end]);
    const ringP: Parent = { kind: 'ring', atoms: system, numberings: r.numberings, ring: r.info };
    for (const numbering of r.numberings) {
      const key: (number | number[])[] = [
        (hydroOf.get(numbering)?.ih ?? []).map((x) => locVal(numbering.get(x)!)).sort((x, y) => x - y),
        locVal(numbering.get(a)!),
        (hydroOf.get(numbering)?.hydro ?? []).map((x) => locVal(numbering.get(x)!)).sort((x, y) => x - y),
        unsat.map((u) => this.bondLocant(ringP, numbering, u)).sort((x, y) => x - y),
        pre.map((x) => locVal(numbering.get(x.at as AtomId)!)).sort((x, y) => x - y),
        [...pre].sort((x, y) => x.sortKey.localeCompare(y.sortKey)).map((x) => locVal(numbering.get(x.at as AtomId)!)),
      ];
      if (!best || cmpKey(key, best.key) < 0) best = { numbering, key, pre };
    }
    const numbering = best!.numbering;
    const preText = this.prefixString(pre, numbering, false);
    const fv = numbering.get(a)!;
    // Cationic ring nitrogens: piperidin-1-ium-4-yl.
    const iumLocs = system.filter((x) => isRingCation(mol, x)).map((x) => numbering.get(x)!).sort(compareLocant);
    const ium = iumLocs.length ? `-${iumLocs.join(',')}-${multiplier(iumLocs.length)}ium` : '';
    let core: string;
    if (r.info.kind === 'template') {
      const t = r.info.template!;
      const h = hydroOf.get(numbering);
      // A ring atom double-bonded outwards needs a saturated position: 2,3-dihydro-...-2-ylidene.
      if (ylidene && !h && t.aromatic) throw new OutOfScope('ring ylidene substituent');
      if (h) core = `${withHydro(t.yl, h, numbering)}${ium}-${fv}-yl`;
      else if (t.name === 'benzene') core = 'phenyl';
      else if (t.name === 'morpholine' && fv === '4' && !ium) core = 'morpholino';
      else core = `${t.indicatedH ? `${t.indicatedH}H-` : ''}${t.yl}${ium}-${fv}-yl`;
      if (ylidene) core += 'idene';
    } else if (r.info.kind === 'vonbaeyer') {
      const hetero = heteroPrefix(this.mol, system, numbering);
      const base2 = `${hetero}${r.info.bracket}${alkaneStem(r.info.size)}`;
      core = unsat.length
        ? `${base2}-${unsat.map((u) => this.bondLocantText(ringP, numbering, u)).sort(compareLocant).join(',')}-${multiplier(unsat.length)}en${ium}-${fv}-yl`
        : `${base2}an${ium}-${fv}-yl`;
      if (ylidene) core += 'idene';
    } else {
      const stem = `cyclo${alkaneStem(r.info.size)}`;
      if (!unsat.length) core = `${stem}yl`;
      else {
        const locs = unsat.map((u) => this.bondLocant(ringP, numbering, u)).sort((x, y) => x - y).join(',');
        const m = multiplier(unsat.length);
        core = `${stem}${m ? 'a' : ''}-${locs}-${m}en-${fv}-yl`;
      }
      if (ylidene) core += 'idene';
    }
    const plain = preText + (preText && /^[0-9]/.test(core) ? '-' : '') + core;
    const stereo = this.stereoPrefix(system, numbering, from);
    const text = stereo ? `${stereo}-${plain}` : plain;
    const complex = /[0-9]/.test(text) || text.includes('(');
    return { text, complex, sortKey: plain.replace(/[^a-z]/g, '') };
  }
}
