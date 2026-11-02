import type { AtomId, Molecule } from './model.ts';
import { computeMass } from './formula.ts';
import { isomorphisms, parsePattern, substructureMappings } from './isomorphism.ts';
import { parseSmiles } from './smiles.ts';

/**
 * Hazard screening for a drawn structure: groups that can make a compound
 * explosive, and compounds that are highly toxic or react violently. These
 * are the quick structural rules chemists use before making something, not a
 * safety assessment: the message always says to check the SDS, and to test
 * thermal stability (DSC) before heating or scaling up anything energetic.
 *
 * Energetic compounds are judged by three published rules of thumb, each per
 * compound (ions of a salt together):
 * - (C + O)/N, the ratio of carbon and oxygen atoms to nitrogen atoms, for
 *   azides and other nitrogen-rich groups (Smith, Open-Chain Nitrogen
 *   Compounds, 1966; Bräse et al., Angew. Chem. Int. Ed. 2005, 44, 5188):
 *   below 1, never isolate; 1 to 3, make and keep only small amounts; 3 or
 *   more, usually safe to isolate.
 * - The rule of six: at least six carbons per energetic group.
 * - Oxygen balance, OB% = −1600 (2C + H/2 − O) / MW: the oxygen a compound
 *   has, or lacks, to burn itself to CO2 and water. The UN screening
 *   procedure (Manual of Tests and Criteria, Appendix 6) clears a compound
 *   with an energetic group only if its OB is below −200%; most detonating
 *   explosives are above −100%.
 */

export type HazardLevel = 'danger' | 'warning' | 'note';
export type HazardKind = 'energetic' | 'toxic' | 'reactive';

export interface Hazard {
  kind: HazardKind;
  level: HazardLevel;
  /** A few words: "Likely explosive: methyl azide group", "Highly toxic: phosgene". */
  title: string;
  /** Why, in a sentence or two, with the numbers behind it. */
  detail: string;
  /** The atoms concerned (empty for hazards found in reagent text). */
  atoms: AtomId[];
}

const RANK: Record<HazardLevel, number> = { danger: 0, warning: 1, note: 2 };
const worse = (a: HazardLevel, b: HazardLevel): HazardLevel => (RANK[a] <= RANK[b] ? a : b);

/** What every message ends with. */
export const HAZARD_DISCLAIMER = 'Screening rules only: check the SDS.';

// ------------------------------------------------------------- energetic groups

interface Group {
  name: string;
  /** SMILES patterns; uncharged pattern atoms match any charge. Alternatives cover how the group may be written. */
  patterns: string[];
  /** Hazardous whatever the rest of the molecule: at least a warning. */
  inherent?: boolean;
  /** A nitrogen-rich group, judged by (C + O)/N. */
  nitrogenRich?: boolean;
}

/**
 * Energetic ("explosophore") groups, after Bretherick's Handbook of Reactive
 * Chemical Hazards and the UN list (Manual of Tests and Criteria, Table A6.1).
 * Earlier entries win where groups overlap (a nitrate ester is not also a nitro group).
 */
const GROUPS: Group[] = [
  {
    name: 'sulfonyl azide', patterns: ['S(=O)(=O)N=[N+]=[N-]', 'S(=O)(=O)N=N#N'], inherent: true, nitrogenRich: true,
    // Green et al., Org. Process Res. Dev. 2020, 24, 67: about twice the decomposition energy of a diazo compound.
  },
  { name: 'azide', patterns: ['N=[N+]=[N-]', 'N=N#N', '[N-][N+]#N'], inherent: true, nitrogenRich: true },
  {
    name: 'diazo group', patterns: ['C=[N+]=[N-]', '[C-][N+]#N', 'C=N#N'], inherent: true, nitrogenRich: true,
    // Green et al., 2020: many donor–acceptor diazo compounds are impact-sensitive, onsets from about 60 °C.
  },
  { name: 'diazonium group', patterns: ['c[N+]#N', 'C[N+]#N'], inherent: true, nitrogenRich: true },
  { name: 'nitrate', patterns: ['O[N+](=O)[O-]', 'ON(=O)=O'], inherent: true },
  { name: 'nitramine', patterns: ['N[N+](=O)[O-]', 'NN(=O)=O'], inherent: true },
  { name: 'nitro group', patterns: ['[N+](=O)[O-]', 'N(=O)=O'] },
  { name: 'perchlorate or chlorate', patterns: ['OCl(=O)(=O)=O', 'OCl(=O)=O'], inherent: true },
  { name: 'peroxide', patterns: ['OO'], inherent: true },
  { name: 'azodicarboxylate', patterns: ['O=CN=NC=O'], inherent: true },
  { name: 'fulminate or nitrile oxide', patterns: ['C#[N+][O-]'], inherent: true },
  { name: 'metal acetylide', patterns: ['C#C[Cu]', 'C#C[Ag]', 'C#C[Hg]'], inherent: true },
  { name: 'tetrazole', patterns: ['c1nn[nH]n1', 'c1n[nH]nn1'], nitrogenRich: true },
  { name: 'triazene', patterns: ['N=NN'], nitrogenRich: true },
];

/** Metals whose azides, acetylides and fulminates are primary explosives. */
const HEAVY_METALS = new Set(['Pb', 'Ag', 'Cu', 'Hg', 'Cd', 'Zn', 'Ba', 'Tl', 'Au', 'Pt', 'Pd', 'Ni', 'Co']);

let compiled: { group: Group; patterns: Molecule[] }[] | null = null;
const groups = () => (compiled ??= GROUPS.map((group) => ({ group, patterns: group.patterns.map((p) => parsePattern(p)) })));

/** A compound: one neutral structure, or all the ions of a salt together. */
function compounds(mol: Molecule): AtomId[][] {
  const neutral: AtomId[][] = [];
  const ions: AtomId[] = [];
  for (const ids of mol.fragments()) {
    if (ids.some((id) => mol.atom(id).charge !== 0)) {
      const charge = ids.reduce((s, id) => s + mol.atom(id).charge, 0);
      if (charge !== 0) { ions.push(...ids); continue; }
    }
    neutral.push(ids);
  }
  return ions.length ? [...neutral, ions] : neutral;
}

function part(mol: Molecule, ids: AtomId[]): Molecule {
  if (ids.length === mol.atomCount) return mol;
  const keep = new Set(ids);
  const out = mol.clone();
  for (const a of mol.atoms()) if (!keep.has(a.id)) out.removeAtom(a.id);
  return out;
}

const pct = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(Math.round(n))}%`;
const num = (n: number) => (Math.round(n * 100) / 100).toString();

function energetic(mol: Molecule): Hazard[] {
  const out: Hazard[] = [];
  for (const ids of compounds(mol)) {
    const m = part(mol, ids);
    const taken = new Set<AtomId>();
    const found: { group: Group; atoms: AtomId[] }[] = [];
    for (const { group, patterns } of groups()) {
      for (const p of patterns) {
        for (const hit of substructureMappings(p, m, 100)) {
          if (hit.atoms.some((id) => taken.has(id))) continue;
          for (const id of hit.atoms) taken.add(id);
          found.push({ group, atoms: hit.atoms });
        }
      }
    }
    if (!found.length) continue;

    const mass = computeMass(m);
    const count = (el: string) => mass.counts.get(el) ?? 0;
    const C = count('C'), H = count('H'), N = count('N'), O = count('O');
    const elements = [...mass.counts.keys()];
    const names = [...new Set(found.map((f) => f.group.name))];
    const atoms = found.flatMap((f) => f.atoms);
    const what = names.join(', ');

    // Salts of an energetic anion with metal cations: inorganic, judged on their own.
    const organic = C > 0 || (N > 0 && H > 0 && elements.every((e) => ['C', 'H', 'N', 'O', 'Cl'].includes(e)));
    const azideOrAcetylide = names.some((n) => n === 'azide' || n === 'metal acetylide' || n === 'fulminate or nitrile oxide');
    if (!organic && elements.some((e) => HEAVY_METALS.has(e)) && azideOrAcetylide) {
      out.push({ kind: 'energetic', level: 'danger', title: `Primary explosive: heavy-metal ${names[0]}`, detail: 'Shock- and friction-sensitive.', atoms });
      continue;
    }
    if (C === 0 && !elements.includes('H') && names.every((n) => n === 'azide')) continue; // sodium azide and the like: toxic, listed below
    if (C === 0 && names.every((n) => n === 'nitrate' || n === 'perchlorate or chlorate') && !(N > (names.includes('nitrate') ? found.length : 0) && H > 0)) {
      out.push({ kind: 'reactive', level: 'warning', title: `Strong oxidiser: ${what}`, detail: 'Keep from organics.', atoms });
      continue;
    }

    const n = found.length;
    const reasons: string[] = [];
    let level: HazardLevel = found.some((f) => f.group.inherent) ? 'warning' : 'note';

    if (found.some((f) => f.group.nitrogenRich) && N > 0) {
      const ratio = (C + O) / N;
      if (ratio < 1) { level = 'danger'; reasons.push(`(C + O)/N ${num(ratio)}`); }
      else if (ratio < 3) { level = worse(level, 'warning'); reasons.push(`(C + O)/N ${num(ratio)}`); }
    }
    const perGroup = C / n;
    if (perGroup < 6) {
      const tooFew = perGroup < 3 && (n > 1 || found.some((f) => f.group.inherent) || C <= 2);
      level = worse(level, tooFew ? 'danger' : 'warning');
      reasons.push(`${num(perGroup)} C per group`);
    }
    if (mass.molecularWeight > 0) {
      const ob = (-1600 * (2 * C + H / 2 - O)) / mass.molecularWeight;
      if (ob > -100) {
        // Above −100% like most detonating explosives; one nitro group in a big molecule is a thermal hazard rather than an explosive.
        const explosive = n > 1 || perGroup < 6 || found.some((f) => f.group.inherent);
        level = worse(level, explosive ? 'danger' : 'warning');
        reasons.push(`oxygen balance ${pct(ob)}`);
      } else if (ob > -200) {
        level = worse(level, found.some((f) => f.group.inherent) ? 'warning' : 'note');
        reasons.push(`oxygen balance ${pct(ob)}`);
      }
    }
    if (!reasons.length && level === 'note') continue; // a nitro group or tetrazole in a large molecule that passes every rule

    const titles: Record<HazardLevel, string> = { danger: 'Likely explosive', warning: 'Energetic', note: 'Energetic group' };
    const why = reasons.length ? `${reasons.join(', ')}.` : 'Energetic group.';
    out.push({ kind: 'energetic', level, title: `${titles[level]}: ${what}`, detail: capital(why), atoms });
  }
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --------------------------------------------------- toxic and reactive compounds

interface Listed { smiles: string; name: string; kind: HazardKind; level: HazardLevel; why: string }

/** Whole compounds, matched exactly (one fragment of a drawing, or all the ions of a salt). */
const COMPOUNDS: Listed[] = [
  { smiles: 'O=C(Cl)Cl', name: 'phosgene', kind: 'toxic', level: 'danger', why: 'Highly toxic gas.' },
  { smiles: 'ClC(=O)OC(Cl)(Cl)Cl', name: 'diphosgene', kind: 'toxic', level: 'danger', why: 'Releases phosgene.' },
  { smiles: 'O=C(OC(Cl)(Cl)Cl)OC(Cl)(Cl)Cl', name: 'triphosgene', kind: 'toxic', level: 'warning', why: 'Releases phosgene.' },
  { smiles: 'C#N', name: 'hydrogen cyanide', kind: 'toxic', level: 'danger', why: 'Highly toxic gas.' },
  { smiles: '[C-]#N', name: 'cyanide', kind: 'toxic', level: 'danger', why: 'Acid releases HCN.' },
  { smiles: 'C[Si](C)(C)C#N', name: 'trimethylsilyl cyanide', kind: 'toxic', level: 'danger', why: 'Releases HCN with water.' },
  { smiles: 'CC(C)(O)C#N', name: 'acetone cyanohydrin', kind: 'toxic', level: 'danger', why: 'Releases HCN.' },
  { smiles: 'BrC#N', name: 'cyanogen bromide', kind: 'toxic', level: 'danger', why: 'Releases HCN.' },
  { smiles: 'F', name: 'hydrogen fluoride', kind: 'toxic', level: 'danger', why: 'Severe burns: keep calcium gluconate at hand.' },
  { smiles: '[N-]=[N+]=[N-]', name: 'azide salt', kind: 'toxic', level: 'warning', why: 'Never with acid, heavy metals or DCM.' },
  { smiles: 'NN', name: 'hydrazine', kind: 'toxic', level: 'warning', why: 'Toxic, carcinogenic.' },
  { smiles: 'COS(=O)(=O)OC', name: 'dimethyl sulfate', kind: 'toxic', level: 'danger', why: 'Potent alkylating agent.' },
  { smiles: 'COS(=O)(=O)C(F)(F)F', name: 'methyl triflate', kind: 'toxic', level: 'danger', why: 'Potent alkylating agent.' },
  { smiles: 'COS(=O)(=O)F', name: 'methyl fluorosulfonate', kind: 'toxic', level: 'danger', why: 'Potent alkylating agent.' },
  { smiles: 'CI', name: 'iodomethane', kind: 'toxic', level: 'note', why: 'Alkylating agent.' },
  { smiles: 'O=[Os](=O)(=O)=O', name: 'osmium tetroxide', kind: 'toxic', level: 'danger', why: 'Volatile, highly toxic.' },
  { smiles: 'S=C=S', name: 'carbon disulfide', kind: 'toxic', level: 'warning', why: 'Ignites around 90 °C.' },
  { smiles: 'c1ccccc1', name: 'benzene', kind: 'toxic', level: 'warning', why: 'Carcinogen.' },
  { smiles: '[C-]#[O+]', name: 'carbon monoxide', kind: 'toxic', level: 'danger', why: 'Toxic, odourless gas.' },
  { smiles: 'S', name: 'hydrogen sulfide', kind: 'toxic', level: 'danger', why: 'Toxic gas.' },
  { smiles: 'ClCl', name: 'chlorine', kind: 'toxic', level: 'warning', why: 'Toxic, corrosive gas.' },
  { smiles: 'BrBr', name: 'bromine', kind: 'toxic', level: 'warning', why: 'Toxic, corrosive.' },
  { smiles: 'C=CC=O', name: 'acrolein', kind: 'toxic', level: 'danger', why: 'Highly toxic lachrymator.' },
  { smiles: 'CN=C=O', name: 'methyl isocyanate', kind: 'toxic', level: 'danger', why: 'Highly toxic.' },
  { smiles: 'COCCl', name: 'chloromethyl methyl ether (MOMCl)', kind: 'toxic', level: 'danger', why: 'Carcinogen.' },
  { smiles: 'ClCOCCl', name: 'bis(chloromethyl) ether', kind: 'toxic', level: 'danger', why: 'Potent carcinogen.' },
  { smiles: 'CN(C)P(=O)(N(C)C)N(C)C', name: 'HMPA', kind: 'toxic', level: 'warning', why: 'Carcinogen.' },
  { smiles: 'C1CO1', name: 'ethylene oxide', kind: 'toxic', level: 'danger', why: 'Toxic, carcinogenic gas.' },
  { smiles: 'C=CC#N', name: 'acrylonitrile', kind: 'toxic', level: 'warning', why: 'Toxic, carcinogenic.' },
  { smiles: 'C=[N+]=[N-]', name: 'diazomethane', kind: 'toxic', level: 'danger', why: 'Also explosive.' },
  { smiles: 'C[Si](C)(C)C=[N+]=[N-]', name: 'trimethylsilyldiazomethane', kind: 'toxic', level: 'danger', why: 'Fatal by inhalation.' },
  { smiles: 'NO', name: 'hydroxylamine', kind: 'energetic', level: 'warning', why: 'Explosive when concentrated or heated.' },
  { smiles: 'On1nnc2ccccc21', name: 'HOBt', kind: 'energetic', level: 'warning', why: 'Explosive when anhydrous.' },
  { smiles: 'On1nnc2cccnc21', name: 'HOAt', kind: 'energetic', level: 'warning', why: 'Potentially explosive.' },
  { smiles: 'CC(C)(C)[Li]', name: 'tert-butyllithium', kind: 'reactive', level: 'danger', why: 'Ignites in air.' },
  { smiles: '[H-].[Na+]', name: 'sodium hydride', kind: 'reactive', level: 'note', why: 'Reacts with water.' },
  { smiles: '[H-].[K+]', name: 'potassium hydride', kind: 'reactive', level: 'warning', why: 'Reacts violently with water.' },
  { smiles: '[NaH]', name: 'sodium hydride', kind: 'reactive', level: 'note', why: 'Reacts with water.' },
  { smiles: '[KH]', name: 'potassium hydride', kind: 'reactive', level: 'warning', why: 'Reacts violently with water.' },
  { smiles: '[Li+].[AlH4-]', name: 'lithium aluminium hydride', kind: 'reactive', level: 'note', why: 'Reacts violently with water.' },
];

/** Groups that make a compound toxic, wherever they are in it. */
const TOXIC_GROUPS: { patterns: string[]; name: string; level: HazardLevel; why: string; accept?: (m: Molecule, map: Map<AtomId, AtomId>, pattern: Molecule) => boolean }[] = [
  // The nitroso nitrogen has only its two neighbours (a nitramine's has three).
  { patterns: ['NN=O'], name: 'N-nitrosamine', level: 'warning', why: 'Probable carcinogen.', accept: (m, map, p) => [...map.entries()].every(([pa, ta]) => p.atom(pa).element !== 'N' || p.neighbours(pa).length !== 2 || (m.neighbours(ta).length === 2 && m.atom(ta).charge === 0)) },
  { patterns: ['N=C=O'], name: 'isocyanate', level: 'warning', why: 'Sensitiser.' },
  { patterns: ['ClCCNCCCl'], name: 'nitrogen mustard', level: 'danger', why: 'Vesicant; CWC-controlled class.' },
  { patterns: ['ClCCSCCCl'], name: 'sulfur mustard', level: 'danger', why: 'Vesicant; CWC Schedule 1.' },
  { patterns: ['P(=O)F', 'P(=S)F'], name: 'phosphorus fluoride ester', level: 'danger', why: 'Possible nerve-agent class (CWC).' },
  { patterns: ['COS(=O)(=O)'], name: 'alkyl sulfonate or sulfate ester', level: 'warning', why: 'Alkylating agent (genotoxic impurity).' },
  { patterns: ['C[Hg]'], name: 'organomercury compound', level: 'danger', why: 'Extremely toxic.' },
  { patterns: ['C[Sn](C)C'], name: 'trialkyltin compound', level: 'warning', why: 'Toxic.' },
];

/** Elements whose compounds are toxic whatever their form. */
const TOXIC_ELEMENTS: { element: string; level: HazardLevel; why: string }[] = [
  { element: 'Hg', level: 'danger', why: 'Highly toxic.' },
  { element: 'Tl', level: 'danger', why: 'Highly toxic.' },
  { element: 'Cd', level: 'danger', why: 'Toxic, carcinogenic.' },
  { element: 'As', level: 'danger', why: 'Toxic, carcinogenic.' },
  { element: 'Be', level: 'danger', why: 'Toxic, carcinogenic.' },
  { element: 'Pb', level: 'warning', why: 'Toxic.' },
  { element: 'Se', level: 'warning', why: 'Toxic.' },
];

/** Reactive atoms: pyrophoric organometallics and alkali metals. */
function reactiveAtoms(m: Molecule): Hazard[] {
  const out: Hazard[] = [];
  for (const a of m.atoms()) {
    const carbons = m.neighbours(a.id).filter((n) => m.atom(n).element === 'C').length;
    const bonded = m.neighbours(a.id).length;
    if (a.element === 'Li' && carbons) out.push({ kind: 'reactive', level: 'note', title: 'Reactive: organolithium', detail: 'Reacts with water and air.', atoms: [a.id] });
    else if (a.element === 'Al' && carbons >= 2) out.push({ kind: 'reactive', level: 'danger', title: 'Pyrophoric: alkylaluminium', detail: 'Ignites in air.', atoms: [a.id] });
    else if (a.element === 'Zn' && carbons >= 2) out.push({ kind: 'reactive', level: 'danger', title: 'Pyrophoric: dialkylzinc', detail: 'Ignites in air.', atoms: [a.id] });
    else if (a.element === 'B' && carbons === 3 && bonded === 3) out.push({ kind: 'reactive', level: 'warning', title: 'Pyrophoric: trialkylborane', detail: 'Can ignite in air.', atoms: [a.id] });
    else if (['Li', 'Na', 'K', 'Cs'].includes(a.element) && !bonded && a.charge === 0 && !m.implicitHydrogens(a.id) && !a.explicitHydrogens) out.push({ kind: 'reactive', level: 'warning', title: `Water-reactive: ${a.element} metal`, detail: 'Reacts violently with water.', atoms: [a.id] });
  }
  return out;
}

let listed: { entry: Listed; mol: Molecule }[] | null = null;
let toxicGroups: { entry: (typeof TOXIC_GROUPS)[number]; patterns: Molecule[] }[] | null = null;

function toxic(mol: Molecule): Hazard[] {
  listed ??= COMPOUNDS.map((entry) => ({ entry, mol: parseSmiles(entry.smiles) }));
  toxicGroups ??= TOXIC_GROUPS.map((entry) => ({ entry, patterns: entry.patterns.map((p) => parsePattern(p)) }));
  const out: Hazard[] = [];
  const named = new Set<AtomId>();
  // Each neutral fragment, and the salt as a whole.
  const candidates = [...mol.fragments(), ...compounds(mol).filter((ids) => ids.some((id) => mol.atom(id).charge !== 0))];
  for (const ids of candidates) {
    const m = part(mol, ids);
    for (const { entry, mol: ref } of listed) {
      if (ids.some((id) => named.has(id))) break;
      if (isomorphisms(ref, m).next().done) continue;
      for (const id of ids) named.add(id);
      const label = entry.kind === 'toxic' ? (entry.level === 'danger' ? 'Highly toxic' : 'Toxic') : entry.kind === 'energetic' ? (entry.level === 'danger' ? 'Likely explosive' : 'Energetic') : (entry.level === 'danger' ? 'Pyrophoric' : 'Reactive');
      out.push({ kind: entry.kind, level: entry.level, title: `${label}: ${entry.name}`, detail: entry.why, atoms: ids });
    }
  }
  for (const { entry, patterns } of toxicGroups) {
    const atoms = new Set<AtomId>();
    for (const p of patterns) for (const hit of substructureMappings(p, mol, 50)) if (!hit.atoms.some((id) => named.has(id)) && (entry.accept?.(mol, hit.map, p) ?? true)) for (const id of hit.atoms) atoms.add(id);
    if (atoms.size) out.push({ kind: 'toxic', level: entry.level, title: `${entry.level === 'danger' ? 'Highly toxic' : 'Toxic'}: ${entry.name}`, detail: entry.why, atoms: [...atoms] });
  }
  for (const { element, level, why } of TOXIC_ELEMENTS) {
    const atoms = [...mol.atoms()].filter((a) => a.element === element && !named.has(a.id)).map((a) => a.id);
    if (atoms.length && !out.some((h) => h.atoms.includes(atoms[0]!))) out.push({ kind: 'toxic', level, title: `${level === 'danger' ? 'Highly toxic' : 'Toxic'}: ${element} compound`, detail: why, atoms });
  }
  for (const a of mol.atoms()) {
    if (a.element === 'Cr' && mol.neighbours(a.id).filter((n) => mol.atom(n).element === 'O' && mol.bondBetween(a.id, n)!.order === 2).length >= 2) {
      out.push({ kind: 'toxic', level: 'danger', title: 'Highly toxic: chromium(VI)', detail: 'Carcinogen.', atoms: [a.id] });
    }
  }
  return [...out, ...reactiveAtoms(mol).filter((h) => !h.atoms.some((id) => named.has(id)))];
}

/**
 * Every hazard found in a drawing, worst first. Give the drawing with its
 * abbreviations drawn out (an "N3" label is an azide only once drawn out).
 */
export function hazardsOf(mol: Molecule): Hazard[] {
  if (!mol.atomCount) return [];
  const found = [...energetic(mol), ...toxic(mol)];
  // One entry per kind of hazard (two azide ions are one azide salt), with all their atoms.
  const merged: Hazard[] = [];
  for (const h of found) {
    const same = merged.find((m) => m.title === h.title);
    if (same) same.atoms = [...new Set([...same.atoms, ...h.atoms])];
    else merged.push({ ...h });
  }
  return merged.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

// ----------------------------------------------------------------- reagent text

/**
 * Reagents written as text (above or below a reaction arrow), as chemists
 * write them. Case matters ("HF", not "hf"), and each must stand alone, so
 * "NaH" is not found in "NaHCO3".
 */
const REAGENTS: { names: string[]; level: HazardLevel; kind: HazardKind; title: string; why: string }[] = [
  { names: ['CH2N2', 'diazomethane'], level: 'danger', kind: 'energetic', title: 'Diazomethane', why: 'Explosive and highly toxic.' },
  { names: ['TMSCHN2', 'TMS-diazomethane', 'TMSdiazomethane', 'trimethylsilyldiazomethane'], level: 'danger', kind: 'toxic', title: 'Highly toxic: trimethylsilyldiazomethane', why: 'Fatal by inhalation.' },
  { names: ['TsN3', 'MsN3', 'NsN3', 'p-ABSA', 'pABSA', 'tosyl azide', 'mesyl azide'], level: 'warning', kind: 'energetic', title: 'Sulfonyl azide (diazo transfer)', why: 'Energetic: keep well below its decomposition onset.' },
  { names: ['TfN3', 'triflyl azide'], level: 'danger', kind: 'energetic', title: 'Triflyl azide', why: 'Explosive: never isolate.' },
  { names: ['HOBt', 'HOAt', 'HATU', 'HBTU', 'HCTU', 'TBTU', 'PyBOP'], level: 'note', kind: 'energetic', title: 'Benzotriazole coupling reagent', why: 'Some potentially explosive; HATU, HBTU, HCTU are sensitisers.' },
  { names: ['NH2OH', 'hydroxylamine'], level: 'note', kind: 'energetic', title: 'Hydroxylamine', why: 'Explosive when concentrated or heated.' },
  { names: ['Raney Ni', 'Raney nickel', 'Raney-Ni', 'Ra-Ni'], level: 'warning', kind: 'reactive', title: 'Raney nickel', why: 'Pyrophoric when dry.' },
  { names: ['NaN3', 'HN3', 'sodium azide'], level: 'warning', kind: 'toxic', title: 'Sodium azide', why: 'Never with acid, heavy metals or DCM.' },
  { names: ['TMSN3', 'DPPA'], level: 'warning', kind: 'energetic', title: 'Azide reagent', why: 'Check the product azide.' },
  { names: ['HNO3', 'nitric acid', 'NO2BF4', 'fuming nitric acid'], level: 'warning', kind: 'energetic', title: 'Nitration: exothermic', why: 'Exothermic: can run away.' },
  { names: ['HF', 'HF·pyridine', 'HF·py', 'Olah\'s reagent', 'Et3N·3HF'], level: 'danger', kind: 'toxic', title: 'Hydrogen fluoride', why: 'Severe burns: keep calcium gluconate at hand.' },
  { names: ['NaCN', 'KCN', 'CuCN', 'Zn(CN)2', 'TMSCN', 'HCN', 'acetone cyanohydrin'], level: 'danger', kind: 'toxic', title: 'Cyanide', why: 'Keep basic: acid releases HCN.' },
  { names: ['COCl2', 'phosgene', 'diphosgene', 'triphosgene'], level: 'danger', kind: 'toxic', title: 'Phosgene or a phosgene source', why: 'Highly toxic.' },
  { names: ['OsO4', 'K2OsO4'], level: 'danger', kind: 'toxic', title: 'Osmium', why: 'Volatile, highly toxic.' },
  { names: ['Me2SO4', 'dimethyl sulfate', 'MeOTf', 'methyl triflate', 'Meerwein\'s salt'], level: 'danger', kind: 'toxic', title: 'Potent alkylating agent', why: 'Toxic, carcinogenic.' },
  { names: ['MeI', 'CH3I'], level: 'note', kind: 'toxic', title: 'Iodomethane', why: 'Alkylating agent.' },
  { names: ['t-BuLi', 'tBuLi', 'tert-BuLi', 'AlMe3', 'Me3Al', 'AlEt3', 'Et2Zn', 'ZnEt2', 'Et3B'], level: 'danger', kind: 'reactive', title: 'Pyrophoric reagent', why: 'Ignites in air.' },
  { names: ['n-BuLi', 'nBuLi', 'BuLi', 's-BuLi', 'sBuLi'], level: 'note', kind: 'reactive', title: 'Organolithium', why: 'Reacts with water and air.' },
  { names: ['LiAlH4', 'LAH'], level: 'note', kind: 'reactive', title: 'Lithium aluminium hydride', why: 'Reacts violently with water.' },
  { names: ['H2O2', 'mCPBA', 'm-CPBA', 'TBHP', 't-BuOOH', 'peracetic acid', 'AcOOH', 'DMDO', 'Oxone'], level: 'note', kind: 'energetic', title: 'Peroxide', why: 'Oxidant: never concentrate to dryness.' },
  { names: ['DEAD', 'DIAD'], level: 'note', kind: 'energetic', title: 'Azodicarboxylate', why: 'Shock-sensitive when neat.' },
  { names: ['CrO3', 'PCC', 'PDC', 'K2Cr2O7', 'Na2Cr2O7', 'Jones reagent', 'Jones'], level: 'danger', kind: 'toxic', title: 'Chromium(VI)', why: 'Carcinogen.' },
  { names: ['HMPA'], level: 'warning', kind: 'toxic', title: 'HMPA', why: 'Carcinogen.' },
  { names: ['benzene', 'C6H6'], level: 'warning', kind: 'toxic', title: 'Benzene', why: 'Carcinogen.' },
  { names: ['CS2'], level: 'warning', kind: 'toxic', title: 'Carbon disulfide', why: 'Ignites around 90 °C.' },
  { names: ['MOMCl', 'MOM-Cl'], level: 'danger', kind: 'toxic', title: 'Chloromethyl methyl ether', why: 'Carcinogen.' },
  { names: ['Hg(OAc)2', 'HgCl2', 'HgO', 'Hg(OTf)2'], level: 'danger', kind: 'toxic', title: 'Mercury salt', why: 'Highly toxic.' },
  { names: ['Bu3SnH', 'nBu3SnH', 'Bu3SnCl', 'Me3SnCl'], level: 'note', kind: 'toxic', title: 'Organotin', why: 'Toxic.' },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let reagentPatterns: { entry: (typeof REAGENTS)[number]; re: RegExp }[] | null = null;

/** Hazards in reagent and condition text ("NaH, DMF, 0 °C"). */
export function reagentHazards(text: string): Hazard[] {
  reagentPatterns ??= REAGENTS.map((entry) => ({ entry, re: new RegExp(`(?<![A-Za-z0-9-])(?:${entry.names.map(escape).join('|')})(?![a-z0-9(])`) }));
  const out: Hazard[] = [];
  for (const { entry, re } of reagentPatterns) if (re.test(text)) out.push({ kind: entry.kind, level: entry.level, title: entry.title, detail: entry.why, atoms: [] });
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

// ------------------------------------------------------- dangerous combinations

/** What is present, drawn as a structure or written as text: the halves of the pairs below. */
type Tag = 'NaH' | 'amide or sulfoxide solvent' | 'azide salt' | 'halogenated solvent' | 'DMF' | 'DMSO' | 'POCl3' | 'acid chloride reagent' | 'DMSO activator' | 'HNO3' | 'Ac2O';
const TAG_TEXT: Record<Tag, RegExp> = {
  'NaH': /(?<![A-Za-z])(NaH|sodium hydride)(?![A-Za-z0-9])/,
  'amide or sulfoxide solvent': /(?<![A-Za-z])(DMF|DMAc|DMA|DMSO|NMP|dimethylformamide|dimethylacetamide|dimethyl sulfoxide)(?![A-Za-z])/i,
  'azide salt': /(?<![A-Za-z])(NaN3|KN3|LiN3|HN3|Bu4NN3|TBAN3|n-Bu4NN3|sodium azide|hydrazoic acid)(?![A-Za-z0-9])/,
  'halogenated solvent': /(?<![A-Za-z])(DCM|CH2Cl2|CHCl3|CDCl3|CD2Cl2|chloroform|dichloromethane|methylene chloride)(?![A-Za-z0-9])/i,
  'DMF': /(?<![A-Za-z])(DMF|dimethylformamide)(?![A-Za-z])/i,
  'DMSO': /(?<![A-Za-z])(DMSO|dimethyl sulfoxide)(?![A-Za-z])/i,
  'POCl3': /(?<![A-Za-z])(POCl3|phosphorus oxychloride|phosphoryl chloride)(?![A-Za-z0-9])/i,
  'acid chloride reagent': /(?<![A-Za-z])(SOCl2|\(COCl\)2|oxalyl chloride|thionyl chloride)(?![A-Za-z0-9])/i,
  'DMSO activator': /(?<![A-Za-z])(\(COCl\)2|oxalyl chloride|TFAA|Tf2O|SOCl2|thionyl chloride|AcCl|acetyl chloride|cyanuric chloride)(?![A-Za-z0-9])/i,
  'HNO3': /(?<![A-Za-z])(HNO3|nitric acid)(?![A-Za-z0-9])/i,
  'Ac2O': /(?<![A-Za-z])(Ac2O|acetic anhydride)(?![A-Za-z0-9])/i,
};
const TAG_SMILES: Record<Tag, string[]> = {
  'NaH': ['[H-].[Na+]', '[NaH]'],
  'amide or sulfoxide solvent': ['CN(C)C=O', 'CC(=O)N(C)C', 'CS(C)=O', 'CN1CCCC1=O'],
  'azide salt': ['[N-]=[N+]=[N-]', 'N=[N+]=[N-]'],
  'halogenated solvent': ['ClCCl', 'ClC(Cl)Cl'],
  'DMF': ['CN(C)C=O'],
  'DMSO': ['CS(C)=O'],
  'POCl3': ['ClP(Cl)(Cl)=O'],
  'acid chloride reagent': ['ClS(Cl)=O', 'ClC(=O)C(=O)Cl'],
  'DMSO activator': ['ClC(=O)C(=O)Cl', 'O=C(OC(=O)C(F)(F)F)C(F)(F)F', 'ClS(Cl)=O'],
  'HNO3': ['O[N+](=O)[O-]', 'ON(=O)=O'],
  'Ac2O': ['CC(=O)OC(C)=O'],
};
/**
 * Dangerous combinations. Sources: NaH, Yang et al., Org. Process Res. Dev.
 * 2019, 23, 2210; azide and DCM, Conrow and Dean, Org. Process Res. Dev. 2008,
 * 12, 1285; acetyl nitrate, Andreozzi et al., 2002; Vilsmeier, Org. Process
 * Res. Dev. 2002, 6, 922; DMCC, Stare et al., Org. Process Res. Dev. 2009, 13,
 * 857; activated DMSO, Org. Process Res. Dev. 2020, 24, 916.
 */
const PAIRS: { tags: Tag[]; level: HazardLevel; kind: HazardKind; title: string; detail: string }[] = [
  { tags: ['NaH', 'amide or sulfoxide solvent'], level: 'warning', kind: 'reactive', title: 'NaH with DMF, DMAc or DMSO', detail: 'Can run away.' },
  { tags: ['azide salt', 'halogenated solvent'], level: 'danger', kind: 'energetic', title: 'Azide salt with DCM or chloroform', detail: 'Forms explosive di- and triazidomethane.' },
  { tags: ['HNO3', 'Ac2O'], level: 'danger', kind: 'energetic', title: 'HNO3 with Ac2O', detail: 'Forms explosive acetyl nitrate.' },
  { tags: ['POCl3', 'DMF'], level: 'warning', kind: 'reactive', title: 'Vilsmeier reagent (POCl3 with DMF)', detail: 'Thermal hazard: add POCl3 to the substrate.' },
  { tags: ['acid chloride reagent', 'DMF'], level: 'note', kind: 'toxic', title: 'SOCl2 or (COCl)2 with DMF', detail: 'Traces of DMCC, a carcinogen.' },
  { tags: ['DMSO activator', 'DMSO'], level: 'warning', kind: 'reactive', title: 'Activated DMSO (Swern-type)', detail: 'Exothermic: keep cold.' },
];

let tagMols: { tag: Tag; mol: Molecule }[] | null = null;

/** The tags present in a drawing's structures and in its text. */
function tagsOf(mol: Molecule, text: string): Set<Tag> {
  tagMols ??= (Object.entries(TAG_SMILES) as [Tag, string[]][]).flatMap(([tag, list]) => list.map((smi) => ({ tag, mol: parseSmiles(smi) })));
  const found = new Set<Tag>();
  for (const [tag, re] of Object.entries(TAG_TEXT) as [Tag, RegExp][]) if (re.test(text)) found.add(tag);
  const pieces = [...mol.fragments(), ...compounds(mol).filter((ids) => ids.some((id) => mol.atom(id).charge !== 0))].map((ids) => part(mol, ids));
  // Each structure, and the salt as a whole (NaH is two ions; an azide salt is the azide ion among them).
  for (const m of pieces) {
    for (const { tag, mol: ref } of tagMols) if (!found.has(tag) && !isomorphisms(ref, m).next().done) found.add(tag);
  }
  return found;
}

/**
 * Everything to warn about in a drawing: its structures (abbreviations drawn
 * out), the reagents written as text, and dangerous pairs from either, such
 * as NaH drawn and DMF written below the arrow. One entry per hazard, worst first.
 */
export function screenHazards(mol: Molecule, text = ''): Hazard[] {
  const tags = tagsOf(mol, text);
  const pairs: Hazard[] = PAIRS.filter((p) => p.tags.every((t) => tags.has(t))).map((p) => ({ kind: p.kind, level: p.level, title: p.title, detail: p.detail, atoms: [] }));
  const all = [...pairs, ...hazardsOf(mol), ...(text ? reagentHazards(text) : [])];
  return all.filter((h, i) => all.findIndex((x) => x.title === h.title) === i).sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** Worth interrupting the user for: a danger or a warning, not a note. */
export const alarming = (h: Hazard) => h.level !== 'note';

/** One line for a hazard, for tool replies and copied text. */
export const hazardLine = (h: Hazard) => `${h.title}. ${h.detail}`;
