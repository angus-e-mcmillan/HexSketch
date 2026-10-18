import { elementBySymbol } from './elements.ts';
import { Molecule, type AtomId, type BondOrder } from './model.ts';

/**
 * SMILES reading and writing (Daylight/OpenSMILES subset): organic-subset and
 * bracket atoms, charges, isotopes, explicit H, branches, ring closures
 * (digits and %nn), bond symbols and dot-disconnected parts. Aromatic input is
 * kekulized so the result draws the way chemists draw. Stereo marks are
 * accepted and ignored for now.
 *
 * Atoms come out without coordinates (all at 0,0); run a layout before drawing.
 */

const ORGANIC = new Set(['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I']);
const AROMATIC_ORGANIC = new Set(['b', 'c', 'n', 'o', 'p', 's']);
const DEFAULT_VALENCE: Record<string, number[]> = {
  B: [3], C: [4], N: [3, 5], O: [2], P: [3, 5], S: [2, 4, 6], F: [1], Cl: [1], Br: [1], I: [1],
};

interface ParsedAtom {
  element: string;
  aromatic: boolean;
  bracket: boolean;
  hCount: number;
  charge: number;
  isotope: number | null;
  /** '@' or '@@' from a bracket atom. */
  chiral?: '@' | '@@';
}

/** Neighbour order as written, for @/@@: atom indices, 'H' for the bracket hydrogen. */
type Written = (number | 'H')[];

export function parseSmiles(smiles: string): Molecule {
  const atoms: ParsedAtom[] = [];
  const bonds: { a: number; b: number; order: BondOrder | 'arom'; dir?: '/' | '\\' }[] = [];
  const written: Written[] = [];
  const ringOpen = new Map<number, { atom: number; order: BondOrder | null; slot: number; dir: '/' | '\\' | null }>();
  const stack: number[] = [];
  let prev = -1;
  let pendingOrder: BondOrder | null = null;
  let pendingDir: '/' | '\\' | null = null;
  let i = 0;
  const s = smiles.trim();

  const addBond = (a: number, b: number, explicit: BondOrder | null, dir: '/' | '\\' | null) => {
    const order = explicit ?? (atoms[a]!.aromatic && atoms[b]!.aromatic ? 'arom' : 1);
    bonds.push({ a, b, order, ...(dir ? { dir } : {}) });
  };

  const addAtom = (atom: ParsedAtom) => {
    atoms.push(atom);
    const idx = atoms.length - 1;
    written.push([]);
    if (prev >= 0) {
      addBond(prev, idx, pendingOrder, pendingDir);
      written[prev]!.push(idx);
      written[idx]!.push(prev);
    }
    // A bracket hydrogen comes right after the preceding atom (or first, if none).
    if (atom.bracket && atom.hCount > 0 && atom.chiral) written[idx]!.push('H');
    pendingOrder = null;
    pendingDir = null;
    prev = idx;
  };

  while (i < s.length) {
    const ch = s[i]!;
    if (ch === '(') { stack.push(prev); i++; continue; }
    if (ch === ')') { prev = stack.pop() ?? -1; i++; continue; }
    if (ch === '.') { prev = -1; pendingOrder = null; i++; continue; }
    if (ch === '-') { pendingOrder = 1; i++; continue; }
    if (ch === '=') { pendingOrder = 2; i++; continue; }
    if (ch === '#') { pendingOrder = 3; i++; continue; }
    if (ch === '$') { pendingOrder = 4; i++; continue; }
    if (ch === ':') { pendingOrder = 1.5; i++; continue; }
    if (ch === '/' || ch === '\\') { pendingDir = ch; i++; continue; }
    if (ch === '%' || /[0-9]/.test(ch)) {
      let n: number;
      if (ch === '%') { n = Number(s.slice(i + 1, i + 3)); i += 3; } else { n = Number(ch); i++; }
      const open = ringOpen.get(n);
      if (open) {
        addBond(open.atom, prev, pendingOrder ?? open.order, null);
        written[open.atom]![open.slot] = prev;
        written[prev]!.push(open.atom);
        ringOpen.delete(n);
      } else {
        written[prev]!.push(-1); // filled in when the ring closes
        ringOpen.set(n, { atom: prev, order: pendingOrder, slot: written[prev]!.length - 1, dir: pendingDir });
      }
      pendingOrder = null;
      pendingDir = null;
      continue;
    }
    if (ch === '[') {
      const end = s.indexOf(']', i);
      if (end < 0) throw new Error(`unclosed bracket atom in "${s}"`);
      addAtom(parseBracket(s.slice(i + 1, end)));
      i = end + 1;
      continue;
    }
    // Organic subset, two-letter symbols first.
    const two = s.slice(i, i + 2);
    if (two === 'Cl' || two === 'Br') {
      addAtom({ element: two, aromatic: false, bracket: false, hCount: -1, charge: 0, isotope: null });
      i += 2; continue;
    }
    if (ORGANIC.has(ch)) {
      addAtom({ element: ch, aromatic: false, bracket: false, hCount: -1, charge: 0, isotope: null });
      i++; continue;
    }
    if (AROMATIC_ORGANIC.has(ch)) {
      addAtom({ element: ch.toUpperCase(), aromatic: true, bracket: false, hCount: -1, charge: 0, isotope: null });
      i++; continue;
    }
    if (ch === '*') { addAtom({ element: 'C', aromatic: false, bracket: true, hCount: 0, charge: 0, isotope: null }); i++; continue; }
    throw new Error(`unexpected "${ch}" at ${i} in "${s}"`);
  }
  if (ringOpen.size) throw new Error(`unclosed ring bond in "${s}"`);

  // Implicit hydrogens for organic-subset atoms.
  const degreeOrder = atoms.map(() => 0);
  const degree = atoms.map(() => 0);
  for (const b of bonds) {
    const o = b.order === 'arom' ? 1 : b.order;
    degreeOrder[b.a]! += o; degreeOrder[b.b]! += o;
    degree[b.a]!++; degree[b.b]!++;
  }
  atoms.forEach((a, idx) => {
    if (a.bracket) return;
    if (a.aromatic) {
      // Aromatic atoms use their lowest normal valence with one extra bond for
      // the pi system, which leaves thiophene's s and furan's o with no H.
      a.hCount = Math.max(0, (DEFAULT_VALENCE[a.element] ?? [0])[0]! - degreeOrder[idx]! - 1);
      return;
    }
    const used = degreeOrder[idx]!;
    const v = (DEFAULT_VALENCE[a.element] ?? [0]).find((x) => x >= used) ?? used;
    a.hCount = Math.max(0, v - used);
  });

  // Kekulize aromatic bonds: a perfect matching over atoms that still need a double bond.
  const aromaticBonds = bonds.filter((b) => b.order === 'arom');
  if (aromaticBonds.length) {
    const needs = atoms.map((a, idx) => {
      if (!a.aromatic) return false;
      const valence = (DEFAULT_VALENCE[a.element] ?? [4])[0]!;
      const sigma = degreeOrder[idx]! + a.hCount - a.charge * (a.element === 'C' ? -1 : 1);
      return valence - sigma >= 1;
    });
    const matched = new Set<number>();
    const choice = new Map<(typeof bonds)[number], boolean>();
    const order = [...aromaticBonds];
    const solve = (k: number): boolean => {
      // Find first atom needing a partner.
      const atom = needs.findIndex((n, idx) => n && !matched.has(idx));
      if (atom < 0) return true;
      for (const b of order) {
        if (b.a !== atom && b.b !== atom) continue;
        const other = b.a === atom ? b.b : b.a;
        if (!needs[other] || matched.has(other)) continue;
        matched.add(atom); matched.add(other); choice.set(b, true);
        if (solve(k + 1)) return true;
        matched.delete(atom); matched.delete(other); choice.delete(b);
      }
      return false;
    };
    if (!solve(0)) throw new Error(`cannot kekulize "${s}"`);
    for (const b of aromaticBonds) b.order = choice.get(b) ? 2 : 1;
  }

  const mol = new Molecule();
  const ids: AtomId[] = atoms.map((a) =>
    mol.addAtom({
      element: a.element, x: 0, y: 0, charge: a.charge, isotope: a.isotope,
      explicitHydrogens: a.bracket ? a.hCount : null,
    }).id);
  for (const b of bonds) {
    if (mol.bondBetween(ids[b.a]!, ids[b.b]!)) continue;
    mol.addBond({ begin: ids[b.a]!, end: ids[b.b]!, order: b.order as BondOrder });
  }
  // Organic-subset atoms: pin H to the count SMILES implied, so the model agrees exactly.
  atoms.forEach((a, idx) => {
    if (!a.bracket && mol.implicitHydrogens(ids[idx]!) !== a.hCount) mol.atom(ids[idx]!).explicitHydrogens = a.hCount;
  });

  // Tetrahedral centres: neighbour order as written.
  atoms.forEach((a, idx) => {
    if (!a.chiral) return;
    const order = written[idx]!.map((w) => (w === 'H' ? -1 : ids[w as number]!));
    if (order.length === 4) mol.atom(ids[idx]!).chirality = { order, anticlockwise: a.chiral === '@' };
  });

  // Double-bond geometry from / and \: normalise each direction to read from the
  // double-bond atom outward; equal marks on both ends mean cis.
  const dirFrom = (atom: number, sub: number): string | null => {
    const b = bonds.find((x) => x.dir && ((x.a === atom && x.b === sub) || (x.a === sub && x.b === atom)));
    if (!b?.dir) return null;
    return b.a === atom ? b.dir : b.dir === '/' ? '\\' : '/';
  };
  for (const b of bonds) {
    if (b.order !== 2) continue;
    const subsA = written[b.a]!.filter((w): w is number => typeof w === 'number' && w !== b.b);
    const subsB = written[b.b]!.filter((w): w is number => typeof w === 'number' && w !== b.a);
    const da = subsA.map((x) => [x, dirFrom(b.a, x)] as const).find(([, d]) => d);
    const db = subsB.map((x) => [x, dirFrom(b.b, x)] as const).find(([, d]) => d);
    if (!da || !db) continue;
    const bond = mol.bondBetween(ids[b.a]!, ids[b.b]!)!;
    const refBegin = bond.begin === ids[b.a] ? ids[da[0]]! : ids[db[0]]!;
    const refEnd = bond.begin === ids[b.a] ? ids[db[0]]! : ids[da[0]]!;
    bond.ez = { ref: [refBegin, refEnd], cis: da[1] === db[1] };
  }
  return mol;
}

function parseBracket(body: string): ParsedAtom {
  const m = /^(\d+)?([A-Z][a-z]?|[bcnops]|se|as|\*)(@{1,2}(?:TH[12]|AL[12]|SP[123]|TB\d+|OH\d+)?)?(H\d*)?([+-]+\d*|[+-]\d+)?(?::\d+)?$/.exec(body);
  if (!m) throw new Error(`bad bracket atom [${body}]`);
  const [, iso, sym, , h, chg] = m;
  const aromatic = /^[a-z]/.test(sym!);
  const element = sym === '*' ? 'C' : aromatic ? sym![0]!.toUpperCase() + sym!.slice(1) : sym!;
  if (sym !== '*' && !elementBySymbol(element)) throw new Error(`unknown element in [${body}]`);
  let charge = 0;
  if (chg) {
    const sign = chg[0] === '+' ? 1 : -1;
    const digits = chg.slice(1).replace(/[+-]/g, '');
    charge = sign * (digits ? Number(digits) : chg.length);
  }
  const chiralMark = /^@{1,2}/.exec(m[3] ?? '')?.[0] as '@' | '@@' | undefined;
  return {
    element, aromatic, bracket: true,
    hCount: h ? (h.length > 1 ? Number(h.slice(1)) : 1) : 0,
    charge, isotope: iso ? Number(iso) : null,
    ...(chiralMark ? { chiral: chiralMark } : {}),
  };
}

/** Write a (non-canonical) Kekulé SMILES. */
export function writeSmiles(mol: Molecule): string {
  const parts: string[] = [];
  for (const fragment of mol.fragments()) parts.push(writeFragment(mol, fragment));
  return parts.join('.');
}

function writeFragment(mol: Molecule, fragment: AtomId[]): string {
  const start = fragment.reduce((best, a) => (mol.neighbours(a).length < mol.neighbours(best).length ? a : best), fragment[0]!);
  const visited = new Set<AtomId>();
  const ringBonds = new Map<number, number>(); // bond id -> ring label
  const closures = new Map<AtomId, { label: number; bond: number }[]>();
  let nextLabel = 1;

  // First pass: DFS to find ring-closure bonds.
  const order: AtomId[] = [];
  const parentBond = new Map<AtomId, number>();
  const dfs = (a: AtomId) => {
    visited.add(a); order.push(a);
    for (const bId of mol.incidentBonds(a)) {
      if (bId === parentBond.get(a)) continue;
      const n = mol.otherAtom(mol.bond(bId), a);
      if (visited.has(n)) {
        if (!ringBonds.has(bId)) {
          const label = nextLabel++;
          ringBonds.set(bId, label);
          for (const x of [a, n]) {
            const list = closures.get(x) ?? [];
            list.push({ label, bond: bId });
            closures.set(x, list);
          }
        }
        continue;
      }
      parentBond.set(n, bId);
      dfs(n);
    }
  };
  dfs(start);

  const bondSym = (order: number) => (order === 2 ? '=' : order === 3 ? '#' : order === 4 ? '$' : '');
  const written = new Set<AtomId>();
  const emit = (a: AtomId): string => {
    written.add(a);
    let out = atomToken(mol, a);
    for (const c of closures.get(a) ?? []) {
      const lab = c.label < 10 ? String(c.label) : `%${c.label}`;
      // Bond symbol goes on the opening occurrence only.
      const otherWritten = written.has(mol.otherAtom(mol.bond(c.bond), a));
      out += (otherWritten ? '' : bondSym(mol.bond(c.bond).order)) + lab;
    }
    const children = mol.incidentBonds(a).filter((b) => !ringBonds.has(b) && parentBond.get(mol.otherAtom(mol.bond(b), a)) === b);
    children.forEach((b, idx) => {
      const n = mol.otherAtom(mol.bond(b), a);
      const branch = bondSym(mol.bond(b).order) + emit(n);
      out += idx < children.length - 1 ? `(${branch})` : branch;
    });
    return out;
  };
  return emit(start);
}

function atomToken(mol: Molecule, id: AtomId): string {
  const a = mol.atom(id);
  const h = mol.implicitHydrogens(id);
  let organicH = -1;
  if (ORGANIC.has(a.element) && a.charge === 0 && a.isotope === null && a.radical === 0) {
    let used = 0;
    for (const b of mol.incidentBonds(id)) used += mol.bond(b).order;
    const v = (DEFAULT_VALENCE[a.element] ?? [0]).find((x) => x >= used) ?? used;
    organicH = v - used;
  }
  if (organicH === h) return a.element;
  let t = '[';
  if (a.isotope !== null) t += a.isotope;
  t += a.element;
  if (h > 0) t += h === 1 ? 'H' : `H${h}`;
  if (a.charge) t += (a.charge > 0 ? '+' : '-') + (Math.abs(a.charge) > 1 ? Math.abs(a.charge) : '');
  return t + ']';
}
