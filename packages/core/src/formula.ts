import { elementBySymbol, hillOrder } from './elements.ts';
import { Molecule } from './model.ts';
import { parsePeptide, peptideCounts } from './peptides.ts';

export interface MassResult {
  /** Hill-notation formula, e.g. "C9H8O4". */
  formula: string;
  /** Formula with charge suffix, e.g. "C9H7O4-". */
  formulaWithCharge: string;
  /** Average molecular weight from standard atomic weights, u. */
  molecularWeight: number;
  /** Exact mass using the most abundant isotope of each element, u. */
  monoisotopicMass: number;
  /** Net formal charge over the whole structure. */
  charge: number;
  /** Element symbol to count. */
  counts: ReadonlyMap<string, number>;
  /** Elements present that have no published standard atomic weight. */
  unweighable: readonly string[];
}

/** Count every atom including implicit hydrogen. */
export function elementCounts(mol: Molecule): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (symbol: string, n: number) => {
    if (n <= 0) return;
    counts.set(symbol, (counts.get(symbol) ?? 0) + n);
  };

  for (const atom of mol.atoms()) {
    if (atom.label !== null && mol.neighbours(atom.id).length === 0) {
      // A whole peptide written as a label: "H-Ala-Gly-OH".
      const pep = peptideFormulaOf(atom.label);
      if (pep) { for (const [sym, n] of pep) add(sym, n); continue; }
    }
    if (atom.label !== null) {
      // A superatom contributes the formula its label expands to. Generic
      // labels (R, X, Ar, ?) have no formula and stay as symbols, the way
      // ChemDraw reports C2H5X.
      let parsed: Map<string, number> | null = null;
      try { parsed = parseFormula(atom.label); } catch { parsed = null; }
      if (parsed) for (const [sym, n] of parsed) add(sym, n);
      else add(atom.label, 1);
      continue;
    }
    add(atom.element, 1);
    add('H', mol.implicitHydrogens(atom.id));
  }
  return counts;
}

const peptideCache = new Map<string, Map<string, number> | null>();
function peptideFormulaOf(label: string): Map<string, number> | null {
  if (!peptideCache.has(label)) {
    const p = parsePeptide(label);
    peptideCache.set(label, p ? peptideCounts(p) : null);
  }
  return peptideCache.get(label)!;
}

export function netCharge(mol: Molecule): number {
  let q = 0;
  for (const atom of mol.atoms()) q += atom.charge;
  return q;
}

/** Render a count map in Hill notation. */
export function formatHill(counts: ReadonlyMap<string, number>): string {
  const symbols = [...counts.keys()].filter((s) => (counts.get(s) ?? 0) > 0);
  symbols.sort(hillOrder(symbols.includes('C')));
  return symbols
    .map((s) => {
      const n = counts.get(s)!;
      return n === 1 ? s : `${s}${n}`;
    })
    .join('');
}

function formatCharge(q: number): string {
  if (q === 0) return '';
  const magnitude = Math.abs(q) === 1 ? '' : String(Math.abs(q));
  return q > 0 ? `${magnitude}+` : `${magnitude}-`;
}

export function computeMass(mol: Molecule): MassResult {
  const counts = elementCounts(mol);
  const charge = netCharge(mol);

  let molecularWeight = 0;
  let monoisotopicMass = 0;
  const unweighable: string[] = [];

  for (const [symbol, n] of counts) {
    const el = elementBySymbol(symbol);
    if (!el) {
      unweighable.push(symbol);
      continue;
    }
    if (el.weight === null) unweighable.push(symbol);
    else molecularWeight += el.weight * n;
    monoisotopicMass += el.monoisotopic * n;
  }

  // An ion has lost or gained electrons; at 5 decimal places that matters for
  // exact mass but is far below the precision of an average molecular weight.
  const ELECTRON_MASS = 0.00054857990907;
  monoisotopicMass -= charge * ELECTRON_MASS;

  const formula = formatHill(counts);
  return {
    formula,
    formulaWithCharge: formula + formatCharge(charge),
    molecularWeight,
    monoisotopicMass,
    charge,
    counts,
    unweighable,
  };
}

/**
 * Parse a formula string such as "C6H5" or "Ca(OH)2" into element counts.
 * Used for superatom labels and for the formula entry field.
 */
export function parseFormula(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  const add = (sym: string, n: number) => counts.set(sym, (counts.get(sym) ?? 0) + n);

  // Common abbreviations a chemist types into a label.
  const ABBREVIATIONS: Record<string, string> = {
    Ph: 'C6H5', Bn: 'C7H7', Bz: 'C7H5O', Ac: 'C2H3O', Me: 'CH3',
    Et: 'C2H5', Pr: 'C3H7', Bu: 'C4H9', tBu: 'C4H9', iPr: 'C3H7',
    Tf: 'CF3SO2', Ts: 'C7H7SO2', Ms: 'CH3SO2', Boc: 'C5H9O2',
    Cbz: 'C8H7O2', Fmoc: 'C15H11O2', TMS: 'C3H9Si', THP: 'C5H9O',
  };
  if (ABBREVIATIONS[text]) text = ABBREVIATIONS[text]!;

  let i = 0;
  const parseGroup = (): Map<string, number> => {
    const local = new Map<string, number>();
    const addLocal = (sym: string, n: number) => local.set(sym, (local.get(sym) ?? 0) + n);

    while (i < text.length) {
      const ch = text[i]!;
      if (ch === ')') break;
      if (ch === '(') {
        i++;
        const inner = parseGroup();
        if (text[i] !== ')') throw new Error(`unbalanced parenthesis in "${text}"`);
        i++;
        const mult = readNumber();
        for (const [s, n] of inner) addLocal(s, n * mult);
        continue;
      }
      if (!/[A-Z]/.test(ch)) throw new Error(`unexpected "${ch}" in "${text}"`);

      let symbol = ch;
      i++;
      while (i < text.length && /[a-z]/.test(text[i]!)) {
        const candidate = symbol + text[i]!;
        if (!elementBySymbol(candidate)) break;
        symbol = candidate;
        i++;
      }
      if (!elementBySymbol(symbol)) throw new Error(`unknown element "${symbol}" in "${text}"`);
      addLocal(symbol, readNumber());
    }
    return local;
  };

  const readNumber = (): number => {
    let digits = '';
    while (i < text.length && /[0-9]/.test(text[i]!)) digits += text[i++]!;
    return digits === '' ? 1 : Number(digits);
  };

  const result = parseGroup();
  if (i < text.length) throw new Error(`unbalanced parenthesis in "${text}"`);
  for (const [s, n] of result) add(s, n);
  return counts;
}
