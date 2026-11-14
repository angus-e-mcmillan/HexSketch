import { elementBySymbol } from './elements.ts';
import { Molecule, type AtomId, type BondOrder } from './model.ts';
import { parseSmiles } from './smiles.ts';
import { layout2D } from './layout.ts';

/**
 * What an atom label stands for: "OMe", "CO2Et", "NHBoc", "OTBDPS",
 * "CH2CH2OH", "SO2Ph", "P(O)(OEt)2", and the same written the other way
 * round for the left of a structure ("MeO", "EtO2C", "BocHN", "F3C").
 *
 * A label is read as a chemist reads it: element symbols with their
 * hydrogens, the common group names (Me, Ph, Boc, TBS...), counts and
 * brackets, built into the one structure in which every atom has an ordinary
 * valence. So a label is understood from its parts, not from a list of whole
 * labels, and one HexSketch has never seen (OPiv, CO2Na, N(Me)Boc) still has
 * a formula, a name and a drawn-out form. Nothing here is taken from
 * ChemDraw's nickname files.
 */

/** Groups with one bond to make, as SMILES whose first atom makes it. */
export const GROUPS: Readonly<Record<string, string>> = {
  Me: 'C', Et: 'CC', Pr: 'CCC', nPr: 'CCC', iPr: 'C(C)C', Bu: 'CCCC', nBu: 'CCCC', tBu: 'C(C)(C)C', sBu: 'C(C)CC', iBu: 'CC(C)C',
  Pent: 'CCCCC', nPent: 'CCCCC', Hex: 'CCCCCC', nHex: 'CCCCCC', Hept: 'CCCCCCC', Oct: 'CCCCCCCC', tAm: 'C(C)(C)CC', Np: 'CC(C)(C)C',
  cPr: 'C1CC1', cBu: 'C1CCC1', cPent: 'C1CCCC1', cHex: 'C1CCCCC1', Cy: 'C1CCCCC1', Ad: 'C12CC3CC(CC(C3)C1)C2',
  Ph: 'c1ccccc1', Bn: 'Cc1ccccc1', Bzl: 'Cc1ccccc1', Tol: 'c1ccc(C)cc1', pTol: 'c1ccc(C)cc1', Mes: 'c1c(C)cc(C)cc1C', PMP: 'c1ccc(OC)cc1',
  Vin: 'C=C', Vinyl: 'C=C', All: 'CC=C', Allyl: 'CC=C',
  Ac: 'C(C)=O', Bz: 'C(=O)c1ccccc1', Piv: 'C(=O)C(C)(C)C', TFA: 'C(=O)C(F)(F)F', Tfa: 'C(=O)C(F)(F)F',
  Tf: 'S(=O)(=O)C(F)(F)F', Ts: 'S(=O)(=O)c1ccc(C)cc1', Tos: 'S(=O)(=O)c1ccc(C)cc1', Ms: 'S(=O)(=O)C', Ns: 'S(=O)(=O)c1ccccc1[N+](=O)[O-]',
  Bs: 'S(=O)(=O)c1ccc(Br)cc1', Nf: 'S(=O)(=O)C(F)(F)C(F)(F)C(F)(F)C(F)(F)F',
  Boc: 'C(=O)OC(C)(C)C', Cbz: 'C(=O)OCc1ccccc1', Z: 'C(=O)OCc1ccccc1', Fmoc: 'C(=O)OCC1c2ccccc2-c2ccccc12', Alloc: 'C(=O)OCC=C',
  Troc: 'C(=O)OCC(Cl)(Cl)Cl', Teoc: 'C(=O)OCC[Si](C)(C)C',
  TMS: '[Si](C)(C)C', TES: '[Si](CC)(CC)CC', TBS: '[Si](C)(C)C(C)(C)C', TBDMS: '[Si](C)(C)C(C)(C)C', TIPS: '[Si](C(C)C)(C(C)C)C(C)C',
  TBDPS: '[Si](c1ccccc1)(c1ccccc1)C(C)(C)C',
  PMB: 'Cc1ccc(OC)cc1', DMB: 'Cc1ccc(OC)cc1OC', Trt: 'C(c1ccccc1)(c1ccccc1)c1ccccc1', Tr: 'C(c1ccccc1)(c1ccccc1)c1ccccc1',
  DMT: 'C(c1ccccc1)(c1ccc(OC)cc1)c1ccc(OC)cc1', DMTr: 'C(c1ccccc1)(c1ccc(OC)cc1)c1ccc(OC)cc1', MMT: 'C(c1ccccc1)(c1ccccc1)c1ccc(OC)cc1',
  THP: 'C1CCCCO1', MOM: 'COC', SEM: 'COCC[Si](C)(C)C', MEM: 'COCCOC', BOM: 'COCc1ccccc1',
  Pbf: 'S(=O)(=O)c1c(C)c(C)c2OC(C)(C)Cc2c1C', Acm: 'CNC(C)=O',
  N3: 'N=[N+]=[N-]', Bpin: 'B1OC(C)(C)C(C)(C)O1', Su: 'N1C(=O)CCC1=O', Phth: 'N1C(=O)c2ccccc2C1=O', Bt: 'n1nnc2ccccc12',
};

/** Whole labels that do not follow from their parts. */
const WHOLE: Readonly<Record<string, string>> = {
  NMe: 'NC', 'N2+': '[N+]#N', NPhth: 'N1C(=O)c2ccccc2C1=O', NCO: 'N=C=O', NCS: 'N=C=S', CN: 'C#N', NC: 'C#N',
  SnBu3: '[Sn](CCCC)(CCCC)CCCC', Bu3Sn: '[Sn](CCCC)(CCCC)CCCC',
};

/** Formulas written on their own that do not read from left to right. */
const ALONE: Readonly<Record<string, string>> = {
  H2: '[H][H]', CO: '[C-]#[O+]', O2: 'O=O', N2: 'N#N', F2: 'FF', Cl2: 'ClCl', Br2: 'BrBr', I2: 'II', H2O2: 'OO', N2H4: 'NN',
  H2SO4: 'OS(=O)(=O)O', HNO3: 'O[N+](=O)[O-]', H3PO4: 'OP(=O)(O)O', NH4Cl: '[NH4+].[Cl-]', NH4OH: '[NH4+].[OH-]',
  NaHCO3: '[Na+].OC([O-])=O', KHCO3: '[K+].OC([O-])=O', Na2CO3: '[Na+].[Na+].[O-]C([O-])=O', K2CO3: '[K+].[K+].[O-]C([O-])=O',
  Cs2CO3: '[Cs+].[Cs+].[O-]C([O-])=O', NaBH4: '[Na+].[BH4-]', LiBH4: '[Li+].[BH4-]', LiAlH4: '[Li+].[AlH4-]', NaN3: '[Na+].[N-]=[N+]=[N-]',
  NaH: '[Na+].[H-]', KH: '[K+].[H-]', OsO4: 'O=[Os](=O)(=O)=O', K3PO4: '[K+].[K+].[K+].[O-]P([O-])([O-])=O', Na2SO4: '[Na+].[Na+].[O-]S([O-])(=O)=O',
  MgSO4: '[Mg+2].[O-]S([O-])(=O)=O', NaCl: '[Na+].[Cl-]', KBr: '[K+].[Br-]', KI: '[K+].[I-]', NaI: '[Na+].[I-]', LiCl: '[Li+].[Cl-]', KF: '[K+].[F-]', CsF: '[Cs+].[F-]',
};

/** Labels that stand for "some group", so have no structure: R, X, Ar... */
export const GENERIC_LABEL = /^(R\d*'*|R[a-z]|X|Y|Ar|A|Q|M|L|E|G|Nu|EWG|EDG|PG|LG|Hal|\*|\?)$/;

/** Elements that take whatever bonds they are given (no hydrogens added, any count allowed). */
const anyValence = (el: string) => { const e = elementBySymbol(el); return !e || e.valences.length === 0 || METAL.has(el); };
const METAL = new Set(['Li', 'Na', 'K', 'Rb', 'Cs', 'Mg', 'Ca', 'Sr', 'Ba', 'Al', 'Zn', 'Cu', 'Ag', 'Au', 'Hg', 'Sn', 'Pb', 'Ti', 'Zr', 'Sm', 'Ce', 'Fe', 'Pd', 'Pt', 'Ni', 'Co', 'Rh', 'Ru', 'Ir', 'Mn', 'Cr', 'Tl', 'In', 'Ga', 'Bi', 'Sb', 'Ge']);
const VALENCES: Readonly<Record<string, number[]>> = {
  H: [1], B: [3], C: [4], N: [3, 5], O: [2], F: [1], Si: [4], P: [3, 5], S: [2, 4, 6], Cl: [1], Se: [2, 4, 6], Br: [1], I: [1], As: [3, 5],
};

interface Item {
  kind: 'H' | 'atom' | 'group' | 'sub';
  /** Element symbol ('atom'), group name ('group'). */
  text: string;
  isotope?: number;
  count: number;
  /** A bracketed part: its own items. */
  items?: Item[];
  /** Bond order written before it (= or #). */
  order?: BondOrder;
}

const SUBSCRIPTS = '₀₁₂₃₄₅₆₇₈₉';
const GROUP_NAMES = Object.keys(GROUPS).sort((a, b) => b.length - a.length);

/** Split a label into its parts; null if some of it is not chemistry. */
function tokenize(label: string): { items: Item[]; charge: number } | null {
  let s = label.trim().replace(/[₀-₉]/g, (c) => String(SUBSCRIPTS.indexOf(c))).replace(/[−–]/g, '-').replace(/≡/g, '#');
  let charge = 0;
  const cm = /[+-]+$/.exec(s);
  if (cm && s.length > cm[0].length) { charge = (cm[0][0] === '+' ? 1 : -1) * cm[0].length; s = s.slice(0, -cm[0].length); }
  let i = 0;
  const parse = (depth: number): Item[] | null => {
    const out: Item[] = [];
    let order: BondOrder | undefined;
    while (i < s.length) {
      const ch = s[i]!;
      if (ch === ')') { if (depth === 0) return null; break; }
      if (ch === '=' || ch === '#') { order = ch === '=' ? 2 : 3; i++; continue; }
      if (ch === '-' || ch === ' ') { i++; continue; }
      let item: Item | null = null;
      if (ch === '(') {
        i++;
        const inner = parse(depth + 1);
        if (!inner || s[i] !== ')' || !inner.length) return null;
        i++;
        item = { kind: 'sub', text: '', count: 1, items: inner };
      } else {
        const name = GROUP_NAMES.find((g) => s.startsWith(g, i) && !/[a-z]/.test(s[i + g.length] ?? ''))
          // n-Bu, t-Bu, i-Pr, c-Hex, p-Tol written with a hyphen.
          ?? GROUP_NAMES.find((g) => /^[a-z][A-Z]/.test(g) && s.startsWith(`${g[0]}-${g.slice(1)}`, i));
        if (name) {
          i += s.startsWith(name, i) ? name.length : name.length + 1;
          item = { kind: 'group', text: name, count: 1 };
        } else if (/[A-Z]/.test(ch)) {
          let sym = ch;
          if (/[a-z]/.test(s[i + 1] ?? '') && elementBySymbol(ch + s[i + 1]!)) sym = ch + s[i + 1]!;
          if (sym === 'D' || sym === 'T') { item = { kind: 'H', text: 'H', isotope: sym === 'D' ? 2 : 3, count: 1 }; }
          else if (!elementBySymbol(sym)) return null;
          else item = { kind: sym === 'H' ? 'H' : 'atom', text: sym, count: 1 };
          i += sym.length;
        } else return null;
      }
      let digits = '';
      while (i < s.length && /[0-9]/.test(s[i]!)) digits += s[i++]!;
      if (digits) item.count = Number(digits);
      if (item.count < 1 || item.count > 20) return null;
      if (order) { item.order = order; order = undefined; }
      out.push(item);
    }
    return out;
  };
  const items = parse(0);
  if (!items || i < s.length || !items.length) return null;
  return { items, charge };
}

/** CnH2n+1 written as a formula: C2H5, C6H13; C6H5 and C6H11 are the rings. */
function formulaAlkyl(items: Item[]): Item[] {
  const out: Item[] = [];
  for (let k = 0; k < items.length; k++) {
    const a = items[k]!, h = items[k + 1];
    if (a.kind === 'atom' && a.text === 'C' && a.count > 1 && h?.kind === 'H' && !h.isotope && !a.order) {
      const n = a.count, m = h.count;
      const name = n === 6 && m === 5 ? 'Ph' : n === 6 && m === 11 ? 'Cy' : null;
      if (name) { out.push({ kind: 'group', text: name, count: 1 }); k++; continue; }
      if (m === 2 * n + 1 || m === 2 * n) {
        // A chain: n-1 CH2 then CH3 (or all CH2, for a chain that goes on).
        for (let c = 0; c < n; c++) { out.push({ kind: 'atom', text: 'C', count: 1 }); out.push({ kind: 'H', text: 'H', count: c === n - 1 && m === 2 * n + 1 ? 3 : 2 }); }
        k++; continue;
      }
    }
    out.push(a.items ? { ...a, items: formulaAlkyl(a.items) } : a);
  }
  return out;
}

interface PAtom {
  el: string; h: number; isotopeH: { isotope: number; n: number }[];
  parent: number; order: BondOrder | null;
}
interface State {
  atoms: PAtom[];
  /** Named groups hanging off atoms. */
  groups: { at: number; smiles: string; order: BondOrder | null }[];
  /** Where the chain goes on from. */
  chain: number;
  /** Inside a bracket: only atoms from here on may be attached to. */
  floor: number;
}

const cloneState = (s: State): State => ({ atoms: s.atoms.map((a) => ({ ...a, isotopeH: [...a.isotopeH] })), groups: [...s.groups], chain: s.chain, floor: s.floor });

/** Atoms a new part may attach to, likeliest first: the chain's end, then the rest from the newest. */
function candidates(s: State): number[] {
  const out: number[] = [];
  if (s.chain >= 0) out.push(s.chain);
  for (let k = s.atoms.length - 1; k >= s.floor; k--) if (k !== s.chain) out.push(k);
  return out;
}

/**
 * Every way of adding the items to the state, as a generator of finished
 * states: each part tries the likeliest atom first, and the caller keeps the
 * first reading in which all valences come out. `onto` makes the first item
 * attach to that atom (the atom a bracketed part hangs off).
 */
function* build(items: Item[], k: number, s: State, onto = -1): Generator<State> {
  if (k === items.length) { yield s; return; }
  const it = items[k]!;
  const first = s.atoms.length === 0;
  const where = onto >= 0 && k === 0 ? [onto] : candidates(s);
  const addAtom = (st: State, el: string, parent: number, order: BondOrder | null): number => {
    st.atoms.push({ el, h: 0, isotopeH: [], parent, order });
    return st.atoms.length - 1;
  };
  if (it.kind === 'H') {
    if (first) return;
    // All on one atom, likeliest first; then one each on the newest atoms (PO3H2).
    for (const c of where) {
      const st = cloneState(s);
      if (it.isotope) st.atoms[c]!.isotopeH.push({ isotope: it.isotope, n: it.count }); else st.atoms[c]!.h += it.count;
      yield* build(items, k + 1, st);
    }
    if (it.count > 1 && !it.isotope) {
      const spread = where.filter((c) => c !== s.chain).slice(0, it.count);
      if (spread.length === it.count) {
        const st = cloneState(s);
        for (const c of spread) st.atoms[c]!.h += 1;
        yield* build(items, k + 1, st);
      }
    }
    return;
  }
  if (it.kind === 'atom') {
    if (first) {
      // "O2" as the first thing is not a head atom.
      if (it.count > 1) return;
      const st = cloneState(s);
      st.chain = addAtom(st, it.text, -1, null);
      yield* build(items, k + 1, st);
      return;
    }
    for (const c of where) {
      const st = cloneState(s);
      let last = -1;
      for (let n = 0; n < it.count; n++) last = addAtom(st, it.text, c, it.order ?? null);
      // One atom carries the chain on; several (O2, F3) hang off the atom and leave the chain where it was.
      if (it.count === 1) st.chain = last;
      yield* build(items, k + 1, st);
    }
    return;
  }
  if (it.kind === 'group') {
    // A group has its one bond: it cannot start a label that goes on.
    if (first) return;
    for (const c of where) {
      const st = cloneState(s);
      for (let n = 0; n < it.count; n++) st.groups.push({ at: c, smiles: GROUPS[it.text]!, order: it.order ?? null });
      yield* build(items, k + 1, st);
    }
    return;
  }
  // A bracketed part.
  const flat: Item[] = [];
  for (let n = 0; n < it.count; n++) flat.push(...it.items!);
  if (first) { yield* build([...flat, ...items.slice(k + 1)], 0, s); return; }
  // Hanging off an atom, `count` times: C(CH3)3, P(O)(OEt)2. What is inside attaches inside.
  for (const c of where) {
    const hang = function* (st: State, n: number): Generator<State> {
      if (n === it.count) { yield st; return; }
      const inner = cloneState(st);
      inner.floor = inner.atoms.length;
      inner.chain = -1;
      for (const done of build(it.items!, 0, inner, c)) yield* hang(done, n + 1);
    };
    for (const done of hang(s, 0)) {
      const st = cloneState(done);
      st.floor = s.floor; st.chain = c;
      yield* build(items, k + 1, st);
    }
  }
  // Or along the chain: (CH2)3 is CH2CH2CH2.
  yield* build([...items.slice(0, k), ...flat, ...items.slice(k + 1)], k, s, onto);
}

const allowed = (el: string) => VALENCES[el] ?? elementBySymbol(el)?.valences ?? [];

/**
 * Bond orders that give every atom an ordinary valence, worked from the tips
 * inward: each atom's bond to its parent takes up what its own bonds and
 * hydrogens leave. Null if some atom cannot be satisfied. `tail` takes the
 * second bond of a label in a chain; `lenient` lets the head make up a
 * shortfall with hydrogens ("NMe" at the end of a bond is NHMe).
 */
function settle(s: State, bonds: number, tail: number, charge: number, carrier: number, lenient: boolean): { mol: Molecule; ids: AtomId[] } | null {
  const n = s.atoms.length;
  const kids: number[][] = s.atoms.map(() => []);
  s.atoms.forEach((a, k) => { if (a.parent >= 0) kids[a.parent]!.push(k); });
  const orderUp: number[] = new Array(n).fill(1);
  const chargeOf: number[] = new Array(n).fill(0);
  const external = (k: number) => (k === 0 ? (tail === 0 ? bonds : Math.min(bonds, 1)) : 0) + (k === tail && tail !== 0 ? 1 : 0);
  // Valences an atom may take: the element's own, or for the atom carrying the label's charge, the charged atom's.
  const options = (k: number): { v: number; q: number }[] => {
    const el = s.atoms[k]!.el;
    if (k !== carrier) return allowed(el).map((v) => ({ v, q: 0 }));
    const shift = charge > 0
      ? (['N', 'P', 'O', 'S', 'As', 'Se'].includes(el) ? 1 : ['C', 'B', 'Si'].includes(el) ? -1 : 0)
      : (['B', 'Al'].includes(el) ? 1 : ['C', 'N', 'O', 'S', 'Se', 'P'].includes(el) ? -1 : 0);
    if (!shift || Math.abs(charge) !== 1) return [];
    return [{ v: allowed(el)[0]! + shift, q: charge }];
  };
  // Five-valent nitrogen only as N=O (nitro, N-oxide), which is then written with its charges.
  const nitrogenOk = (k: number, v: number, q: number) => !(s.atoms[k]!.el === 'N' && v === 5 && q === 0) || kids[k]!.some((o) => s.atoms[o]!.el === 'O' && orderUp[o] === 2);
  const below = (k: number): number | null => {
    const a = s.atoms[k]!;
    let sum = a.h + a.isotopeH.reduce((t, x) => t + x.n, 0);
    for (const g of s.groups) if (g.at === k) sum += g.order ?? 1;
    for (const c of kids[k]!) {
      const b = below(c);
      if (b === null) return null;
      const want = s.atoms[c]!.order;
      if (anyValence(s.atoms[c]!.el)) { if (c === carrier) return null; orderUp[c] = want ?? 1; sum += orderUp[c]!; continue; }
      const ext = external(c);
      // A bond to a metal is single; double bonds only among C, N, O, S, P; triple only C-C, C-N and N-N.
      const pair = [a.el, s.atoms[c]!.el].sort().join('');
      const max = anyValence(a.el) ? 1 : ['CC', 'CN', 'NN'].includes(pair) ? 3 : [a.el, s.atoms[c]!.el].every((e) => ['C', 'N', 'O', 'S', 'P', 'Se', 'As'].includes(e)) ? 2 : 1;
      const pick = options(c).filter(({ v }) => v - b - ext >= 1 && v - b - ext <= max && (want === null || v - b - ext === want))
        .filter(({ v, q }) => nitrogenOk(c, v, q))
        .sort((x, y) => Math.abs(x.q) - Math.abs(y.q) || x.v - y.v)[0];
      if (!pick) return null;
      orderUp[c] = pick.v - b - ext;
      chargeOf[c] = pick.q;
      sum += orderUp[c]!;
    }
    return sum;
  };
  if (!n) return null;
  const b0 = below(0);
  if (b0 === null) return null;
  let headH = 0;
  const head = s.atoms[0]!;
  if (!anyValence(head.el)) {
    const ext = external(0);
    const pick = options(0).filter(({ v }) => v === b0 + ext).filter(({ v, q }) => nitrogenOk(0, v, q)).sort((x, y) => Math.abs(x.q) - Math.abs(y.q))[0];
    if (pick) chargeOf[0] = pick.q;
    else if (lenient && !charge) {
      const v = allowed(head.el).find((x) => x >= b0 + ext);
      if (v === undefined || (head.el === 'N' && v === 5)) return null;
      headH = v - b0 - ext;
    } else return null;
  }
  else if (carrier === 0) return null;

  const mol = new Molecule();
  const ids: AtomId[] = s.atoms.map((a, k) => mol.addAtom({ element: a.el, x: 0, y: 0, charge: chargeOf[k]! }).id);
  for (let k = 0; k < n; k++) {
    const a = s.atoms[k]!;
    if (a.parent >= 0) mol.addBond({ begin: ids[a.parent]!, end: ids[k]!, order: orderUp[k] as BondOrder });
    for (const x of a.isotopeH) for (let j = 0; j < x.n; j++) mol.addBond({ begin: ids[k]!, end: mol.addAtom({ element: 'H', x: 0, y: 0, isotope: x.isotope }).id });
  }
  for (const g of s.groups) {
    const frag = parseSmiles(g.smiles);
    const map = new Map<AtomId, AtomId>();
    for (const f of frag.atoms()) map.set(f.id, mol.addAtom({ ...f, x: 0, y: 0, chirality: null }).id);
    for (const fb of frag.bonds()) mol.addBond({ ...fb, begin: map.get(fb.begin)!, end: map.get(fb.end)!, ez: null });
    mol.addBond({ begin: ids[g.at]!, end: map.get([...frag.atoms()][0]!.id)!, order: g.order ?? 1 });
  }
  // Nitro and N-oxide as HexSketch draws them: N+ and O-.
  for (let k = 0; k < n; k++) {
    if (s.atoms[k]!.el !== 'N' || chargeOf[k]) continue;
    const id = ids[k]!;
    const total = mol.incidentBonds(id).reduce((t, bd) => t + mol.bond(bd).order, 0) + s.atoms[k]!.h + external(k) + (k === 0 ? headH : 0);
    if (total !== 5) continue;
    const dbl = mol.incidentBonds(id).map((bd) => mol.bond(bd)).find((bd) => bd.order === 2 && mol.atom(mol.otherAtom(bd, id)).element === 'O');
    if (!dbl) return null;
    dbl.order = 1;
    mol.atom(id).charge = 1;
    mol.atom(mol.otherAtom(dbl, id)).charge = -1;
  }
  // Check the model counts each atom's hydrogens as meant once the label's own bonds are made.
  const probe = mol.clone();
  for (let k = 0; k < n; k++) for (let e = external(k); e > 0; e--) probe.addBond({ begin: ids[k]!, end: probe.addAtom({ element: 'C', x: 0, y: 0 }).id });
  for (let k = 0; k < n; k++) {
    const a = s.atoms[k]!, id = ids[k]!;
    if (anyValence(a.el)) { mol.atom(id).explicitHydrogens = a.h; continue; }
    const want = a.h + (k === 0 ? headH : 0);
    if (probe.implicitHydrogens(id) === want) continue;
    if (external(k)) return null;
    mol.atom(id).explicitHydrogens = want;
  }
  return { mol, ids };
}

export interface LabelStructure {
  /** The atoms the label stands for; nothing has coordinates. */
  mol: Molecule;
  /** The atom that takes the label's bond (its first atom). */
  head: AtomId;
  /** For a label in a chain, the atom that takes the second bond (the head again if it takes both). */
  tail: AtomId;
}

const cache = new Map<string, LabelStructure | null>();

/**
 * The structure a label stands for, when it makes `bonds` bonds (1 for a
 * label at the end of a bond, 2 for one in a chain, 0 for a label on its
 * own). Null when the label is not chemistry HexSketch can read (R, X, Ar,
 * "cat.", a name).
 */
export function labelStructure(label: string, bonds = 1): LabelStructure | null {
  const key = `${bonds}:${label}`;
  if (!cache.has(key)) cache.set(key, read(label.trim(), bonds));
  const hit = cache.get(key)!;
  if (!hit) return null;
  // A copy each time: callers lay it out and merge it.
  const mol = hit.mol.clone();
  return { mol, head: hit.head, tail: hit.tail };
}

function read(label: string, bonds: number): LabelStructure | null {
  if (!label || GENERIC_LABEL.test(label) || bonds > 2) return null;
  if (bonds === 0 && ALONE[label]) { const mol = parseSmiles(ALONE[label]!); const head = [...mol.atoms()][0]!.id; return { mol, head, tail: head }; }
  const tk = tokenize(label);
  // A formula that is one group (C6H5) is that group.
  const single = tk && !tk.charge ? formulaAlkyl(tk.items) : [];
  const whole = WHOLE[label] ?? GROUPS[label] ?? (single.length === 1 && single[0]!.kind === 'group' && single[0]!.count === 1 ? GROUPS[single[0]!.text] : undefined);
  if (whole) {
    const mol = parseSmiles(whole);
    const head = [...mol.atoms()][0]!.id;
    // In a chain a group needs room for two bonds on its first atom: NMe yes, OMe no.
    return bonds <= 1 || mol.implicitHydrogens(head) >= 2 ? { mol, head, tail: head } : null;
  }
  const t = tk;
  if (!t) return null;
  const forward = formulaAlkyl(t.items);
  // As written, then turned round (labels on the left of a structure are written backwards).
  let variants: Item[][] = [forward, [...forward].reverse()];
  const smart = smartReverse(forward);
  if (smart) variants.push(smart);
  if (bonds === 0) {
    // A formula on its own (MeOH, Et3N, EtMgBr): the groups hang off its first atom.
    const lone = (items: Item[]) => { const k = items.findIndex((x) => x.kind === 'atom' && x.count === 1); return k > 0 && items.slice(0, k).every((x) => x.kind === 'group') ? [items[k]!, ...items.slice(0, k), ...items.slice(k + 1)] : items; };
    // HCO2H, HCHO: a leading H belongs to the atom after it.
    if (forward[0]!.kind === 'H' && forward[1]?.kind === 'atom' && forward[1].count === 1) variants.splice(1, 0, [forward[1], forward[0]!, ...forward.slice(2)]);
    variants = variants.map(lone);
    // Two groups joined: PhMe, EtPh.
    if (forward.length === 2 && forward.every((x) => x.kind === 'group' && x.count === 1)) {
      const mol = parseSmiles(GROUPS[forward[0]!.text]!);
      const head = [...mol.atoms()][0]!.id;
      const other = parseSmiles(GROUPS[forward[1]!.text]!);
      const map = new Map<AtomId, AtomId>();
      for (const f of other.atoms()) map.set(f.id, mol.addAtom({ ...f, x: 0, y: 0, chirality: null }).id);
      for (const fb of other.bonds()) mol.addBond({ ...fb, begin: map.get(fb.begin)!, end: map.get(fb.end)!, ez: null });
      mol.addBond({ begin: head, end: map.get([...other.atoms()][0]!.id)! });
      return { mol, head, tail: head };
    }
  }
  // A label on its own must come out exactly; one on a bond may make up its head with hydrogens (NMe for NHMe).
  for (const lenient of bonds === 0 ? [false] : [false, true]) for (const items of variants) {
    let tries = 0;
    for (const s of build(items, 0, { atoms: [], groups: [], chain: -1, floor: 0 })) {
      if (++tries > 300) break;
      const tails = bonds === 2 ? [...new Set([s.chain, 0, ...candidates(s)])] : [0];
      // The atom that carries the label's charge: the newest that can, O and S before N before the rest.
      const rank = (el: string) => (t.charge < 0 ? ['O', 'S', 'Se', 'B', 'Al', 'N', 'C', 'P'] : ['N', 'P', 'S', 'O', 'As', 'Se', 'C', 'B', 'Si']).indexOf(el);
      const carriers = t.charge ? s.atoms.map((_, k) => k).filter((k) => rank(s.atoms[k]!.el) >= 0).sort((x, y) => rank(s.atoms[x]!.el) - rank(s.atoms[y]!.el) || y - x) : [-1];
      for (const tail of tails) for (const carrier of carriers) {
        const got = settle(s, bonds, tail, t.charge, carrier, lenient);
        if (got) return { mol: got.mol, head: got.ids[0]!, tail: got.ids[tail]! };
      }
    }
  }
  return null;
}

/**
 * A label written for the left of a structure, turned round: "HOCH2" is
 * CH2OH, "BocHN" is NHBoc. Each atom keeps its hydrogens (written before it
 * at the start, after it otherwise) and the order of the atoms is reversed.
 */
function smartReverse(items: Item[]): Item[] | null {
  const units: Item[][] = [];
  let pendingH: Item[] = [];
  for (const it of items) {
    if (it.kind === 'H') {
      const last = units[units.length - 1];
      // H after an element belongs to it (CH2); after a group or at the start it belongs to what follows (BocHN, HO).
      if (last && last[0]!.kind === 'atom' && last[0]!.count === 1 && !pendingH.length) last.push(it);
      else pendingH.push(it);
      continue;
    }
    units.push([it, ...pendingH]);
    pendingH = [];
  }
  if (pendingH.length) return null;
  return units.reverse().flat();
}

/** The elements a label stands for (hydrogens included), or null if it is not chemistry HexSketch can read. */
export function labelCounts(label: string, bonds = 1): Map<string, number> | null {
  const s = labelStructure(label, bonds);
  if (!s) return null;
  const counts = new Map<string, number>();
  const add = (sym: string, n: number) => { if (n > 0) counts.set(sym, (counts.get(sym) ?? 0) + n); };
  for (const a of s.mol.atoms()) {
    add(a.element, 1);
    // The bonds the label makes read as hydrogens on the unattached fragment.
    const open = (a.id === s.head ? (s.tail === s.head ? bonds : Math.min(bonds, 1)) : 0) + (a.id === s.tail && s.tail !== s.head ? 1 : 0);
    add('H', s.mol.implicitHydrogens(a.id) - open);
  }
  return counts;
}

/**
 * Replace a labelled atom by the structure its label stands for, drawn out in
 * place: pointing away from the atom it hangs on, or laid between the two it
 * joins. `read` is the label's structure (labelStructure, or a file's own).
 */
export function drawOutLabel(m: Molecule, id: AtomId, read: LabelStructure, L: number): void {
  const a = m.atom(id);
  const nbrs = m.neighbours(id);
  const frag = read.mol;
  layout2D(frag, L);
  const fAtoms = [...frag.atoms()];
  const head = frag.atom(read.head);
  const rest = fAtoms.filter((p) => p.id !== head.id);
  const added = (map: Map<AtomId, AtomId>, place: (p: { x: number; y: number }) => { x: number; y: number }) => {
    for (const p of rest) map.set(p.id, m.addAtom({ ...p, ...place(p), chirality: null }).id);
    for (const b of frag.bonds()) m.addBond({ ...b, begin: map.get(b.begin)!, end: map.get(b.end)!, ez: null });
  };
  // The labelled atom becomes the group's first atom; the rest are added.
  const become = () => { a.element = head.element; a.label = null; a.charge = head.charge; a.explicitHydrogens = head.explicitHydrogens; a.isotope = head.isotope; };
  if (nbrs.length === 2 && read.tail !== read.head) {
    // A label between two atoms whose ends differ (OCH2, NHCO): its first atom to the left-hand
    // neighbour (the upper, if one is above the other), its last to the other, laid along the line between.
    const [n1, n2] = [...nbrs].sort((p, q) => (Math.abs(m.atom(p).x - m.atom(q).x) > 1e-6 ? m.atom(p).x - m.atom(q).x : m.atom(p).y - m.atom(q).y)) as [AtomId, AtomId];
    const A = m.atom(n1), B = m.atom(n2), tail = frag.atom(read.tail);
    const from = { x: A.x + (B.x - A.x) / 3, y: A.y + (B.y - A.y) / 3 }, to = { x: A.x + 2 * (B.x - A.x) / 3, y: A.y + 2 * (B.y - A.y) / 3 };
    const fx = tail.x - head.x, fy = tail.y - head.y, len = Math.hypot(fx, fy) || 1;
    const k = Math.hypot(to.x - from.x, to.y - from.y) / len, rot = Math.atan2(to.y - from.y, to.x - from.x) - Math.atan2(fy, fx);
    const cos = Math.cos(rot) * k, sin = Math.sin(rot) * k;
    const place = (p: { x: number; y: number }) => ({ x: from.x + (p.x - head.x) * cos - (p.y - head.y) * sin, y: from.y + (p.x - head.x) * sin + (p.y - head.y) * cos });
    const order = m.bondBetween(id, n2)!.order;
    m.removeBond(m.bondBetween(id, n2)!.id);
    a.x = from.x; a.y = from.y;
    become();
    const map = new Map<AtomId, AtomId>([[head.id, id]]);
    added(map, place);
    m.addBond({ begin: map.get(read.tail)!, end: n2, order });
    return;
  }
  // Point the group away from the atom it hangs on (or rightwards for a lone label).
  let dir = 0;
  if (nbrs.length) {
    // Away from the atoms it hangs on: from the one, or from between the two of a label in a chain.
    const nx = nbrs.reduce((t, n) => t + m.atom(n).x, 0) / nbrs.length, ny = nbrs.reduce((t, n) => t + m.atom(n).y, 0) / nbrs.length;
    dir = Math.atan2(a.y - ny, a.x - nx);
  }
  const cx = rest.length ? rest.reduce((s, p) => s + p.x, 0) / rest.length : head.x + 1;
  const cy = rest.length ? rest.reduce((s, p) => s + p.y, 0) / rest.length : head.y;
  // A formula on its own (MeOH, Et3N) keeps the way it was laid out.
  const rot = nbrs.length ? dir - Math.atan2(cy - head.y, cx - head.x) : 0;
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const place = (p: { x: number; y: number }) => ({ x: a.x + (p.x - head.x) * cos - (p.y - head.y) * sin, y: a.y + (p.x - head.x) * sin + (p.y - head.y) * cos });
  become();
  const map = new Map<AtomId, AtomId>([[head.id, id]]);
  added(map, place);
}
