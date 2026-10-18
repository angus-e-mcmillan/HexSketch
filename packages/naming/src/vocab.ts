/** Numerical terms and stems used in substitutive nomenclature (IUPAC 2013, P-14.2). */

const UNITS = ['', 'hen', 'do', 'tri', 'tetra', 'penta', 'hexa', 'hepta', 'octa', 'nona'];
const TENS = ['', 'deca', 'icosa', 'triaconta', 'tetraconta', 'pentaconta', 'hexaconta', 'heptaconta', 'octaconta', 'nonaconta'];

/** Alkane stem for a chain of n carbons: meth, eth, prop, but, pent ... icos, henicos ... */
export function alkaneStem(n: number): string {
  const fixed: Record<number, string> = {
    1: 'meth', 2: 'eth', 3: 'prop', 4: 'but', 5: 'pent', 6: 'hex', 7: 'hept', 8: 'oct', 9: 'non',
    10: 'dec', 11: 'undec', 20: 'icos', 21: 'henicos', 22: 'docos', 30: 'triacont',
  };
  if (fixed[n]) return fixed[n]!;
  if (n < 20) return UNITS[n - 10]!.replace(/a$/, '') + 'dec';
  const u = n % 10, t = Math.floor(n / 10);
  const unit = u === 1 ? 'hen' : UNITS[u]!;
  return (unit + TENS[t]!).replace(/a$/, '');
}

/** di, tri, tetra ... for simple prefixes and suffixes. */
export function multiplier(n: number): string {
  const m: Record<number, string> = { 1: '', 2: 'di', 3: 'tri', 4: 'tetra', 5: 'penta', 6: 'hexa', 7: 'hepta', 8: 'octa', 9: 'nona', 10: 'deca' };
  return m[n] ?? `${alkaneStem(n)}a`;
}

/** bis, tris, tetrakis ... for complex (parenthesised) prefixes. */
export function complexMultiplier(n: number): string {
  const m: Record<number, string> = { 1: '', 2: 'bis', 3: 'tris', 4: 'tetrakis', 5: 'pentakis', 6: 'hexakis' };
  return m[n] ?? `${multiplier(n)}kis`;
}

export const HALO: Record<string, string> = { F: 'fluoro', Cl: 'chloro', Br: 'bromo', I: 'iodo' };
export const HALIDE: Record<string, string> = { F: 'fluoride', Cl: 'chloride', Br: 'bromide', I: 'iodide' };

const VOWELS = /^[aeiouy]/;

/**
 * Join a parent hydride name and a suffix with IUPAC elision: the final "e"
 * of "-ane/-ene/-yne" is dropped before a suffix beginning with a vowel
 * (propan-2-ol, but keep it before a consonant: ethane-1,2-diol).
 */
export function attachSuffix(parent: string, locants: string, suffix: string): string {
  const base = VOWELS.test(suffix) && parent.endsWith('e') ? parent.slice(0, -1) : parent;
  return locants ? `${base}-${locants}-${suffix}` : `${base}${suffix}`;
}

export function joinLocants(locants: (number | string)[]): string {
  return [...locants].sort(compareLocant).join(',');
}

/** Order locants numerically, with lettered and primed locants after their number (4 < 4a < 5, N after digits). */
export function compareLocant(a: number | string, b: number | string): number {
  const key = (x: number | string) => {
    const s = String(x);
    const m = /^(\d+)([a-z]?)('*)$/.exec(s);
    // Primed locants (second ring of an assembly) sort after all unprimed ones.
    if (!m) return [1e6, s.charCodeAt(0), 0, 0] as const;
    return [m[3]!.length, Number(m[1]), m[2] ? m[2].charCodeAt(0) : 0, 0] as const;
  };
  const ka = key(a), kb = key(b);
  for (let i = 0; i < 4; i++) if (ka[i] !== kb[i]) return (ka[i] as number) - (kb[i] as number);
  return 0;
}
