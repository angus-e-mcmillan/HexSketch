import { elementBySymbol, hillOrder } from './elements.ts';
import { computeMass, elementCounts, type MassResult } from './formula.ts';
import type { Molecule } from './model.ts';
import type { TextRun } from './objects.ts';

/**
 * Structure analysis written under a structure, as ChemDraw's right-click
 * Analysis menu does: one centred caption, linked to the structure, with a
 * line per chosen property in a fixed order. The numbers are ChemDraw's
 * ChemicalPropertyType codes (CDXML <chemicalproperty>), measured in ChemDraw 20.1.
 */
export const ANALYSIS_ITEMS = [
  { item: 'name', code: 1, label: 'Name' },
  { item: 'formula', code: 2, label: 'Chemical Formula' },
  { item: 'exactMass', code: 3, label: 'Exact Mass' },
  { item: 'mw', code: 4, label: 'Molecular Weight' },
  { item: 'mz', code: 5, label: 'm/z' },
  { item: 'elemental', code: 6, label: 'Elemental Analysis' },
] as const;

export type AnalysisItem = (typeof ANALYSIS_ITEMS)[number]['item'];

export const analysisCode = (item: AnalysisItem): number => ANALYSIS_ITEMS.find((x) => x.item === item)!.code;
export const analysisItemOf = (code: number): AnalysisItem | null => ANALYSIS_ITEMS.find((x) => x.code === code)?.item ?? null;

/** Items in display order (name first, elemental analysis last), without repeats. */
export function sortAnalysisItems(items: Iterable<AnalysisItem>): AnalysisItem[] {
  const set = new Set(items);
  return ANALYSIS_ITEMS.map((x) => x.item).filter((i) => set.has(i));
}

/**
 * Stable isotopes (mass, abundance) of the elements a chemist meets most,
 * from IUPAC's isotopic compositions. Elements not listed count as their
 * monoisotopic mass alone.
 */
const ISOTOPES: Record<string, [number, number][]> = {
  H: [[1.00782503207, 0.999885], [2.0141017778, 0.000115]],
  Li: [[6.015122795, 0.0759], [7.01600455, 0.9241]],
  B: [[10.012937, 0.199], [11.0093054, 0.801]],
  C: [[12, 0.9893], [13.0033548378, 0.0107]],
  N: [[14.0030740048, 0.99636], [15.0001088982, 0.00364]],
  O: [[15.99491461956, 0.99757], [16.9991317, 0.00038], [17.999161, 0.00205]],
  Mg: [[23.9850417, 0.7899], [24.98583692, 0.1], [25.982592929, 0.1101]],
  Si: [[27.9769265325, 0.92223], [28.9764947, 0.04685], [29.97377017, 0.03092]],
  S: [[31.972071, 0.9499], [32.97145876, 0.0075], [33.9678669, 0.0425], [35.96708076, 0.0001]],
  Cl: [[34.96885268, 0.7576], [36.96590259, 0.2424]],
  K: [[38.96370668, 0.932581], [39.96399848, 0.000117], [40.96182576, 0.067302]],
  Fe: [[53.9396105, 0.05845], [55.9349375, 0.91754], [56.935394, 0.02119], [57.9332756, 0.00282]],
  Cu: [[62.9295975, 0.6915], [64.9277895, 0.3085]],
  Zn: [[63.9291422, 0.4863], [65.9260334, 0.279], [66.9271273, 0.041], [67.9248442, 0.1875], [69.9253193, 0.0062]],
  Se: [[73.9224764, 0.0089], [75.9192136, 0.0937], [76.919914, 0.0763], [77.9173091, 0.2377], [79.9165213, 0.4961], [81.9166994, 0.0873]],
  Br: [[78.9183371, 0.5069], [80.9162906, 0.4931]],
  Pd: [[101.905609, 0.0102], [103.904036, 0.1114], [104.905085, 0.2233], [105.903486, 0.2733], [107.903892, 0.2646], [109.905153, 0.1172]],
  Ir: [[190.960594, 0.373], [192.9629264, 0.627]],
  Pt: [[189.959932, 0.00014], [191.961038, 0.00782], [193.9626803, 0.32967], [194.9647911, 0.33832], [195.9649515, 0.25242], [197.967893, 0.07163]],
};

const ELECTRON_MASS = 0.00054857990907;

/**
 * The isotope pattern, as ChemDraw's m/z line lists it: peaks of at least 1%
 * of the tallest, tallest first, each with its exact mass (fine structure
 * kept, so 13C and 15N peaks at the same nominal mass stay apart). Ions are
 * divided by their charge.
 */
export function isotopePattern(counts: ReadonlyMap<string, number>, charge = 0, minRelative = 0.01): { mz: number; relative: number }[] {
  type Peak = { m: number; p: number };
  const merge = (peaks: Peak[]): Peak[] => {
    peaks.sort((a, b) => a.m - b.m);
    const out: Peak[] = [];
    for (const k of peaks) {
      const last = out[out.length - 1];
      if (last && k.m - last.m < 1e-4) { last.m = (last.m * last.p + k.m * k.p) / (last.p + k.p); last.p += k.p; }
      else out.push({ ...k });
    }
    const top = Math.max(...out.map((x) => x.p));
    return out.filter((x) => x.p >= top * 1e-6);
  };
  let dist: Peak[] = [{ m: 0, p: 1 }];
  for (const [sym, n] of counts) {
    const el = elementBySymbol(sym);
    if (!el) continue;
    const iso = ISOTOPES[sym] ?? [[el.monoisotopic, 1]];
    for (let i = 0; i < n; i++) {
      const next: Peak[] = [];
      for (const d of dist) for (const [m, p] of iso) next.push({ m: d.m + m, p: d.p * p });
      dist = merge(next);
    }
  }
  const top = Math.max(...dist.map((d) => d.p));
  const z = Math.abs(charge) || 1;
  return dist
    .filter((d) => d.p / top >= minRelative - 1e-9)
    .sort((a, b) => b.p - a.p)
    .map((d) => ({ mz: (d.m - charge * ELECTRON_MASS) / z, relative: (100 * d.p) / top }));
}

/** "C, 60.00; H, 4.48; O, 35.52": percent by mass, in Hill order. */
export function elementalAnalysis(m: MassResult): string {
  const syms = [...m.counts.keys()].filter((s) => elementBySymbol(s)?.weight);
  syms.sort(hillOrder(syms.includes('C')));
  return syms.map((s) => `${s}, ${((100 * elementBySymbol(s)!.weight! * m.counts.get(s)!) / m.molecularWeight).toFixed(2)}`).join('; ');
}

/**
 * The caption runs for a structure's analysis: one line per item, labelled
 * as ChemDraw labels them ("Chemical Formula: C9H8O4" with formula
 * subscripts, "Molecular Weight: 180.1590"). The name line is the name alone.
 * Returns null when there is nothing to say (no atoms, or only a name that
 * could not be generated).
 */
export function analysisRuns(mol: Molecule, items: readonly AnalysisItem[], opts: { name?: string | null; decimals?: number } = {}): TextRun[] | null {
  if (!mol.atomCount) return null;
  const d = opts.decimals ?? 4;
  const m = computeMass(mol);
  const lines: TextRun[][] = [];
  for (const item of sortAnalysisItems(items)) {
    switch (item) {
      case 'name': if (opts.name) lines.push([{ text: opts.name }]); break;
      case 'formula': lines.push([{ text: 'Chemical Formula: ' }, { text: m.formulaWithCharge, script: 'formula' }]); break;
      case 'exactMass': lines.push([{ text: `Exact Mass: ${m.monoisotopicMass.toFixed(d)}` }]); break;
      case 'mw': if (!m.unweighable.length) lines.push([{ text: `Molecular Weight: ${m.molecularWeight.toFixed(d)}` }]); break;
      case 'mz': {
        const peaks = isotopePattern(elementCounts(mol), m.charge);
        if (peaks.length) lines.push([{ text: `m/z: ${peaks.map((k) => `${k.mz.toFixed(d)} (${k.relative.toFixed(1)}%)`).join(', ')}` }]);
        break;
      }
      case 'elemental': if (!m.unweighable.length) lines.push([{ text: `Elemental Analysis: ${elementalAnalysis(m)}` }]); break;
    }
  }
  if (!lines.length) return null;
  return lines.flatMap((l, i) => (i ? [{ text: '\n' }, ...l] : l));
}
