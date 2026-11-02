/**
 * Chemical notation in text: splitting a run of letters into the element
 * symbols and group abbreviations it is written in (NHBoc is N, H, Boc;
 * OSEM is O, SEM), and telling a formula (NaN3, CH2Cl2, Pd(PPh3)4) from
 * other words (SN2, C3, 92%).
 */
import { elementBySymbol } from './elements.ts';
import type { TextRun } from './objects.ts';

/**
 * Abbreviations written as one word: alkyl and aryl groups, protecting
 * groups, sulfonyls and common ligands. A label is never reversed or split
 * inside one of these.
 */
export const GROUP_ABBREVIATIONS: readonly string[] = [
  'Me', 'Et', 'Pr', 'Bu', 'Ph', 'Bn', 'Bz', 'Ac', 'Ts', 'Ms', 'Tf', 'Ns', 'Cy', 'Ar', 'Ad', 'Mes', 'Tol', 'Py', 'Cp', 'Piv', 'Vin', 'All',
  'iPr', 'nPr', 'cPr', 'tBu', 'sBu', 'iBu', 'nBu', 'Hex', 'Oct', 'Dipp', 'Xyl',
  'Boc', 'Cbz', 'Fmoc', 'Alloc', 'Troc', 'Teoc', 'Trt', 'Tr', 'Mmt', 'DMT', 'DMTr', 'Pbf', 'Pmc', 'Mtt', 'Dde', 'Acm', 'Nps', 'Npys',
  'TBS', 'TBDMS', 'TBDPS', 'TIPS', 'TES', 'TMS', 'TPS', 'SEM', 'MEM', 'MOM', 'BOM', 'PMB', 'MPM', 'PMP', 'DMB', 'THP', 'EE', 'PNB', 'Nos',
  'Bpin', 'pin', 'dba', 'acac', 'cod', 'bpy', 'phen', 'dppf', 'dppe', 'dppp', 'tmeda', 'en', 'py',
];
const GROUP_SET = new Set(GROUP_ABBREVIATIONS);
const LONGEST = Math.max(...GROUP_ABBREVIATIONS.map((g) => g.length));

/**
 * Split a run of letters into element symbols and group abbreviations,
 * preferring the fewest pieces (so "Boc" stays whole, not B, O, C... which
 * case already rules out). Unknown pieces are allowed at a cost: a capital
 * with its lowercase letters ("Xyz"), else a run of capitals kept whole (an
 * abbreviation HexSketch doesn't know, never read backwards). Returns the
 * pieces, and whether every one was known.
 */
export function splitSymbols(letters: string): { pieces: string[]; known: boolean } {
  const n = letters.length;
  const best: { cost: number; prev: number; known: boolean }[] = Array.from({ length: n + 1 }, () => ({ cost: Infinity, prev: -1, known: true }));
  best[0] = { cost: 0, prev: -1, known: true };
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(best[i]!.cost)) continue;
    const take = (j: number, cost: number, known: boolean) => {
      const c = best[i]!.cost + cost;
      if (c < best[j]!.cost) best[j] = { cost: c, prev: i, known: best[i]!.known && known };
    };
    for (let j = i + 1; j <= Math.min(n, i + LONGEST); j++) {
      const piece = letters.slice(i, j);
      if (GROUP_SET.has(piece) || (piece.length <= 2 && /^[A-Z][a-z]?$/.test(piece) && elementBySymbol(piece))) take(j, 1, true);
    }
    // Unknown: a capital and its lowercase letters, or a run of capitals as one word.
    const word = /^[A-Z][a-z]+|^[A-Z]+(?![a-z])|^[A-Z]/.exec(letters.slice(i));
    // A run of capitals costs more than reading it as known symbols (COOH is C, O, O, H) but less than unknown letters one by one (SEM).
    if (word) take(i + word[0].length, word[0].length > 1 && /^[A-Z]+$/.test(word[0]) ? 2 * word[0].length - 0.5 : 4, false);
    if (/[a-z]/.test(letters[i]!)) {
      const lower = /^[a-z]+/.exec(letters.slice(i))![0];
      take(i + lower.length, 4, false);
    }
  }
  const pieces: string[] = [];
  for (let j = n; j > 0; j = best[j]!.prev) pieces.unshift(letters.slice(best[j]!.prev, j));
  return { pieces, known: best[n]!.known };
}

/** Single symbols that are formulas with a count (O2, Cl2, S8); others with a number (C3, N1) are positions. */
const ELEMENTAL = /^(H2|D2|N2|O2|O3|F2|Cl2|Br2|I2|S8|P4|C60|C70)([+\-−]|\d*[+\-−])?$/;
/** Mechanism and reaction names that look like formulas: SN2, SN1, SE2, SH2, SNAr, SRN1. */
const NOT_FORMULA = /^(S[NEHR]N?\d|SNAr|E1cb?|E[12]|AE|AN|AdE|AdN)/i;

/**
 * Whether a word is a chemical formula to set in Formula style (digits
 * lowered, charges raised): it has a count after a symbol or bracket, or a
 * charge, and every letter in it is an element or a known group.
 */
export function isFormulaWord(word: string): boolean {
  let w = word.replace(/^(n|s|t|i|tert|sec|iso)-/, '');
  if (!/[A-Za-z)\]][0-9]|[A-Za-z0-9)\]][+\-−]$/.test(w)) return false;
  if (/[%°/=_']/.test(w) || NOT_FORMULA.test(w)) return false;
  if (/^[A-Z][a-z]?\d+[+\-−]?$/.test(w) || /^[A-Z][a-z]?[+\-−]$/.test(w)) {
    // One symbol: a formula only for elements written with a count (Cl2, O2), or an ion (Na+, Cl−).
    if (/[+\-−]$/.test(w) && !/\d/.test(w)) return !!elementBySymbol(w.slice(0, -1));
    return ELEMENTAL.test(w) || (/[+\-−]$/.test(w) && !!elementBySymbol(w.replace(/\d*[+\-−]$/, '')));
  }
  // A leading count (5H2O in a hydrate) and the separators of a formula.
  w = w.replace(/^\d+/, '');
  const parts = w.split(/[\d()[\]·•.*+\-−]+/).filter(Boolean);
  if (!parts.length) return false;
  return parts.every((p) => splitSymbols(p).known);
}

/**
 * Set the formulas typed in plain text in Formula style, word by word
 * (NaN3, Et3N, CH2Cl2, NH4+), as ChemDraw's Formula style draws them. Runs
 * already given a script are left alone, and so is any word that overlaps
 * `[skipFrom, skipTo)` (the one being typed). Returns the runs unchanged
 * when there is nothing to do.
 */
export function autoFormula(runs: readonly TextRun[], skip?: [number, number]): TextRun[] {
  const out: TextRun[] = [];
  let pos = 0, changed = false;
  for (const r of runs) {
    const start = pos;
    pos += r.text.length;
    if (r.script) { out.push({ ...r }); continue; }
    let last = 0;
    for (const m of r.text.matchAll(/[^\s,;:]+/g)) {
      // A trailing full stop and an unmatched bracket around the word are not part of it.
      let w = m[0], a = m.index!;
      while (w.endsWith('.') || (w.endsWith(')') && count(w, '(') < count(w, ')'))) w = w.slice(0, -1);
      while (w.startsWith('(') && count(w, '(') > count(w, ')')) { w = w.slice(1); a++; }
      if (!w || !isFormulaWord(w)) continue;
      const b = a + w.length;
      if (skip && start + a <= skip[1] && start + b >= skip[0]) continue;
      if (a > last) out.push({ ...r, text: r.text.slice(last, a) });
      out.push({ ...r, text: w, script: 'formula' });
      last = b;
      changed = true;
    }
    if (last < r.text.length) out.push({ ...r, text: r.text.slice(last) });
  }
  return changed ? out : runs.map((r) => ({ ...r }));
}

const count = (s: string, ch: string) => s.split(ch).length - 1;
