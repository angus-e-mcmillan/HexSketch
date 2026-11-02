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
export const HAZARD_DISCLAIMER = 'Screening rules only, not a safety assessment: check the SDS, and test thermal stability (DSC) before heating or scaling up anything energetic.';

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
  { name: 'azide', patterns: ['N=[N+]=[N-]', 'N=N#N', '[N-][N+]#N'], inherent: true, nitrogenRich: true },
  { name: 'diazo group', patterns: ['C=[N+]=[N-]', '[C-][N+]#N', 'C=N#N'], inherent: true, nitrogenRich: true },
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
      out.push({ kind: 'energetic', level: 'danger', title: `Primary explosive: heavy-metal ${names[0]}`, detail: `Heavy-metal ${names[0]}s detonate on friction, shock or heat, even in small amounts. They also form unseen in drains and on metal spatulas.`, atoms });
      continue;
    }
    if (C === 0 && !elements.includes('H') && names.every((n) => n === 'azide')) continue; // sodium azide and the like: toxic, listed below
    if (C === 0 && names.every((n) => n === 'nitrate' || n === 'perchlorate or chlorate') && !(N > (names.includes('nitrate') ? found.length : 0) && H > 0)) {
      out.push({ kind: 'reactive', level: 'warning', title: `Strong oxidiser: ${what}`, detail: 'Keep away from organic material and reducing agents: mixtures can burn violently or explode.', atoms });
      continue;
    }

    const n = found.length;
    const reasons: string[] = [];
    let level: HazardLevel = found.some((f) => f.group.inherent) ? 'warning' : 'note';

    if (found.some((f) => f.group.nitrogenRich) && N > 0) {
      const ratio = (C + O) / N;
      if (ratio < 1) { level = 'danger'; reasons.push(`(C + O)/N = ${num(ratio)}, below 1: should never be isolated`); }
      else if (ratio < 3) { level = worse(level, 'warning'); reasons.push(`(C + O)/N = ${num(ratio)}, below 3: make and store only small amounts, in solution, cold`); }
    }
    const perGroup = C / n;
    if (perGroup < 6) {
      const tooFew = perGroup < 3 && (n > 1 || found.some((f) => f.group.inherent) || C <= 2);
      level = worse(level, tooFew ? 'danger' : 'warning');
      reasons.push(`${num(perGroup)} carbon${perGroup === 1 ? '' : 's'} per energetic group, fewer than the six the rule of six asks for`);
    }
    if (mass.molecularWeight > 0) {
      const ob = (-1600 * (2 * C + H / 2 - O)) / mass.molecularWeight;
      if (ob > -100) {
        // Above −100% like most detonating explosives; one nitro group in a big molecule is a thermal hazard rather than an explosive.
        const explosive = n > 1 || perGroup < 6 || found.some((f) => f.group.inherent);
        level = worse(level, explosive ? 'danger' : 'warning');
        reasons.push(`oxygen balance ${pct(ob)}, above −100% like most explosives`);
      } else if (ob > -200) {
        level = worse(level, found.some((f) => f.group.inherent) ? 'warning' : 'note');
        reasons.push(`oxygen balance ${pct(ob)}, above the −200% the UN screening clears`);
      }
    }
    if (!reasons.length && level === 'note') continue; // a nitro group or tetrazole in a large molecule that passes every rule

    const titles: Record<HazardLevel, string> = { danger: 'Likely explosive', warning: 'Energetic', note: 'Energetic group' };
    const why = reasons.length ? `${reasons.join('; ')}.` : `${capital(what)}: energetic whatever the rest of the molecule, though this one passes the (C + O)/N, rule-of-six and oxygen-balance checks. Avoid heat, shock and distilling to dryness.`;
    out.push({ kind: 'energetic', level, title: `${titles[level]}: ${what}`, detail: `${capital(why)}${level === 'note' ? ' Probably safe in normal use, but test thermal stability before heating or scaling up.' : ''}`, atoms });
  }
  return out;
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// --------------------------------------------------- toxic and reactive compounds

interface Listed { smiles: string; name: string; kind: HazardKind; level: HazardLevel; why: string }

/** Whole compounds, matched exactly (one fragment of a drawing, or all the ions of a salt). */
const COMPOUNDS: Listed[] = [
  { smiles: 'O=C(Cl)Cl', name: 'phosgene', kind: 'toxic', level: 'danger', why: 'Highly toxic gas; lung damage can appear hours later. Triphosgene or CDI are safer to handle.' },
  { smiles: 'ClC(=O)OC(Cl)(Cl)Cl', name: 'diphosgene', kind: 'toxic', level: 'danger', why: 'Toxic liquid that releases phosgene.' },
  { smiles: 'O=C(OC(Cl)(Cl)Cl)OC(Cl)(Cl)Cl', name: 'triphosgene', kind: 'toxic', level: 'warning', why: 'A solid, but releases phosgene with nucleophiles, moisture or heat: handle in a fume hood.' },
  { smiles: 'C#N', name: 'hydrogen cyanide', kind: 'toxic', level: 'danger', why: 'Highly toxic, volatile gas.' },
  { smiles: '[C-]#N', name: 'cyanide', kind: 'toxic', level: 'danger', why: 'Highly toxic; acid releases hydrogen cyanide gas. Keep bleach or a basic quench for waste and spills.' },
  { smiles: 'C[Si](C)(C)C#N', name: 'trimethylsilyl cyanide', kind: 'toxic', level: 'danger', why: 'Releases hydrogen cyanide with water or alcohols.' },
  { smiles: 'CC(C)(O)C#N', name: 'acetone cyanohydrin', kind: 'toxic', level: 'danger', why: 'Releases hydrogen cyanide readily.' },
  { smiles: 'BrC#N', name: 'cyanogen bromide', kind: 'toxic', level: 'danger', why: 'Highly toxic and volatile; releases hydrogen cyanide.' },
  { smiles: 'F', name: 'hydrogen fluoride', kind: 'toxic', level: 'danger', why: 'Burns penetrate the skin painlessly at first and can be fatal: keep calcium gluconate gel at hand.' },
  { smiles: '[N-]=[N+]=[N-]', name: 'azide salt', kind: 'toxic', level: 'warning', why: 'Highly toxic. With acid it gives hydrazoic acid (toxic and explosive); with heavy metals, and with dichloromethane, it gives explosive azides.' },
  { smiles: 'NN', name: 'hydrazine', kind: 'toxic', level: 'warning', why: 'Toxic and carcinogenic; anhydrous hydrazine is also unstable. Use the hydrate where possible.' },
  { smiles: 'COS(=O)(=O)OC', name: 'dimethyl sulfate', kind: 'toxic', level: 'danger', why: 'Potent alkylating agent, toxic and carcinogenic; symptoms can be delayed. Destroy excess with aqueous ammonia.' },
  { smiles: 'COS(=O)(=O)C(F)(F)F', name: 'methyl triflate', kind: 'toxic', level: 'danger', why: 'Very potent alkylating agent, toxic by inhalation.' },
  { smiles: 'COS(=O)(=O)F', name: 'methyl fluorosulfonate', kind: 'toxic', level: 'danger', why: 'Very potent alkylating agent; inhalation has been fatal.' },
  { smiles: 'CI', name: 'iodomethane', kind: 'toxic', level: 'warning', why: 'Volatile alkylating agent, suspected carcinogen.' },
  { smiles: 'O=[Os](=O)(=O)=O', name: 'osmium tetroxide', kind: 'toxic', level: 'danger', why: 'Volatile and highly toxic; the vapour damages the eyes. Use catalytic amounts, or K2OsO4 as a non-volatile source.' },
  { smiles: 'S=C=S', name: 'carbon disulfide', kind: 'toxic', level: 'warning', why: 'Neurotoxic, and ignites around 90 °C, from a hot plate or steam pipe.' },
  { smiles: 'c1ccccc1', name: 'benzene', kind: 'toxic', level: 'warning', why: 'Carcinogen: use toluene instead where possible.' },
  { smiles: '[C-]#[O+]', name: 'carbon monoxide', kind: 'toxic', level: 'danger', why: 'Toxic, odourless gas: use a CO detector.' },
  { smiles: 'S', name: 'hydrogen sulfide', kind: 'toxic', level: 'danger', why: 'Toxic gas that soon deadens the sense of smell, so the smell is no warning.' },
  { smiles: 'ClCl', name: 'chlorine', kind: 'toxic', level: 'warning', why: 'Toxic, corrosive gas.' },
  { smiles: 'BrBr', name: 'bromine', kind: 'toxic', level: 'warning', why: 'Toxic, corrosive and volatile: handle in a fume hood and keep thiosulfate at hand.' },
  { smiles: 'C=CC=O', name: 'acrolein', kind: 'toxic', level: 'danger', why: 'Highly toxic, volatile lachrymator.' },
  { smiles: 'CN=C=O', name: 'methyl isocyanate', kind: 'toxic', level: 'danger', why: 'Highly toxic, volatile.' },
  { smiles: 'COCCl', name: 'chloromethyl methyl ether (MOMCl)', kind: 'toxic', level: 'danger', why: 'Carcinogen, often containing the more potent bis(chloromethyl) ether: make it in situ or use another protecting group.' },
  { smiles: 'ClCOCCl', name: 'bis(chloromethyl) ether', kind: 'toxic', level: 'danger', why: 'Potent carcinogen.' },
  { smiles: 'CN(C)P(=O)(N(C)C)N(C)C', name: 'HMPA', kind: 'toxic', level: 'warning', why: 'Carcinogen: DMPU often works instead.' },
  { smiles: 'C1CO1', name: 'ethylene oxide', kind: 'toxic', level: 'danger', why: 'Toxic, carcinogenic and very flammable gas.' },
  { smiles: 'C=CC#N', name: 'acrylonitrile', kind: 'toxic', level: 'warning', why: 'Toxic and carcinogenic.' },
  { smiles: 'C=[N+]=[N-]', name: 'diazomethane', kind: 'toxic', level: 'danger', why: 'Highly toxic as well as explosive: avoid ground-glass joints and scratched glass. Trimethylsilyldiazomethane is safer for methyl esters.' },
  { smiles: 'CC(C)(C)[Li]', name: 'tert-butyllithium', kind: 'reactive', level: 'danger', why: 'Ignites in air: transfer by cannula or syringe under inert gas, with a fire extinguisher (class D) and quench at hand.' },
  { smiles: '[H-].[Na+]', name: 'sodium hydride', kind: 'reactive', level: 'warning', why: 'Reacts with water to give hydrogen, which can ignite. With DMF, DMAc or DMSO it can run away on heating.' },
  { smiles: '[H-].[K+]', name: 'potassium hydride', kind: 'reactive', level: 'warning', why: 'Reacts violently with water; the dry powder can ignite in air.' },
  { smiles: '[NaH]', name: 'sodium hydride', kind: 'reactive', level: 'warning', why: 'Reacts with water to give hydrogen, which can ignite. With DMF, DMAc or DMSO it can run away on heating.' },
  { smiles: '[KH]', name: 'potassium hydride', kind: 'reactive', level: 'warning', why: 'Reacts violently with water; the dry powder can ignite in air.' },
  { smiles: '[Li+].[AlH4-]', name: 'lithium aluminium hydride', kind: 'reactive', level: 'warning', why: 'Reacts violently with water: quench slowly at 0 °C (the Fieser work-up).' },
];

/** Groups that make a compound toxic, wherever they are in it. */
const TOXIC_GROUPS: { patterns: string[]; name: string; level: HazardLevel; why: string; accept?: (m: Molecule, map: Map<AtomId, AtomId>, pattern: Molecule) => boolean }[] = [
  // The nitroso nitrogen has only its two neighbours (a nitramine's has three).
  { patterns: ['NN=O'], name: 'N-nitrosamine', level: 'warning', why: 'Probable human carcinogens, controlled as impurities in medicines.', accept: (m, map, p) => [...map.entries()].every(([pa, ta]) => p.atom(pa).element !== 'N' || p.neighbours(pa).length !== 2 || (m.neighbours(ta).length === 2 && m.atom(ta).charge === 0)) },
  { patterns: ['N=C=O'], name: 'isocyanate', level: 'warning', why: 'Toxic and a respiratory sensitiser.' },
  { patterns: ['ClCCNCCCl'], name: 'nitrogen mustard', level: 'danger', why: 'Vesicant alkylating agent; some are Schedule 1 chemicals under the Chemical Weapons Convention.' },
  { patterns: ['ClCCSCCCl'], name: 'sulfur mustard', level: 'danger', why: 'Vesicant alkylating agent; a Schedule 1 chemical under the Chemical Weapons Convention.' },
  { patterns: ['P(=O)F', 'P(=S)F'], name: 'phosphorus fluoride ester', level: 'danger', why: 'May be a potent acetylcholinesterase inhibitor; this class includes nerve agents controlled under the Chemical Weapons Convention.' },
  { patterns: ['COS(=O)(=O)'], name: 'alkyl sulfonate or sulfate ester', level: 'warning', why: 'Alkylating agent: a potential genotoxic impurity.' },
  { patterns: ['C[Hg]'], name: 'organomercury compound', level: 'danger', why: 'Extremely toxic; dimethylmercury passes through standard gloves.' },
  { patterns: ['C[Sn](C)C'], name: 'trialkyltin compound', level: 'warning', why: 'Toxic, and hard to remove from products.' },
];

/** Elements whose compounds are toxic whatever their form. */
const TOXIC_ELEMENTS: { element: string; level: HazardLevel; why: string }[] = [
  { element: 'Hg', level: 'danger', why: 'Mercury compounds are highly toxic.' },
  { element: 'Tl', level: 'danger', why: 'Thallium compounds are highly toxic, with delayed symptoms.' },
  { element: 'Cd', level: 'danger', why: 'Cadmium compounds are toxic and carcinogenic.' },
  { element: 'As', level: 'danger', why: 'Arsenic compounds are toxic and carcinogenic.' },
  { element: 'Be', level: 'danger', why: 'Beryllium compounds are toxic and carcinogenic.' },
  { element: 'Pb', level: 'warning', why: 'Lead compounds are toxic.' },
  { element: 'Se', level: 'warning', why: 'Selenium compounds are toxic; hydrogen selenide is highly toxic.' },
];

/** Reactive atoms: pyrophoric organometallics and alkali metals. */
function reactiveAtoms(m: Molecule): Hazard[] {
  const out: Hazard[] = [];
  for (const a of m.atoms()) {
    const carbons = m.neighbours(a.id).filter((n) => m.atom(n).element === 'C').length;
    const bonded = m.neighbours(a.id).length;
    if (a.element === 'Li' && carbons) out.push({ kind: 'reactive', level: 'warning', title: 'Pyrophoric: organolithium', detail: 'Can ignite in air (t-BuLi does): handle under inert gas.', atoms: [a.id] });
    else if (a.element === 'Al' && carbons >= 2) out.push({ kind: 'reactive', level: 'danger', title: 'Pyrophoric: alkylaluminium', detail: 'Ignites in air and reacts violently with water.', atoms: [a.id] });
    else if (a.element === 'Zn' && carbons >= 2) out.push({ kind: 'reactive', level: 'danger', title: 'Pyrophoric: dialkylzinc', detail: 'Ignites in air and reacts violently with water.', atoms: [a.id] });
    else if (a.element === 'B' && carbons === 3 && bonded === 3) out.push({ kind: 'reactive', level: 'warning', title: 'Pyrophoric: trialkylborane', detail: 'Can ignite in air (Et3B does): handle under inert gas.', atoms: [a.id] });
    else if (['Li', 'Na', 'K', 'Cs'].includes(a.element) && !bonded && a.charge === 0 && !m.implicitHydrogens(a.id) && !a.explicitHydrogens) out.push({ kind: 'reactive', level: 'warning', title: `Water-reactive: ${a.element} metal`, detail: 'Reacts violently with water, giving hydrogen that can ignite.', atoms: [a.id] });
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
      const label = entry.kind === 'toxic' ? (entry.level === 'danger' ? 'Highly toxic' : 'Toxic') : (entry.level === 'danger' ? 'Pyrophoric' : 'Reactive');
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
      out.push({ kind: 'toxic', level: 'danger', title: 'Highly toxic: chromium(VI)', detail: 'Chromium(VI) reagents (CrO3, dichromate, PCC, Jones) are carcinogenic: Dess–Martin, Swern or TEMPO oxidations avoid them.', atoms: [a.id] });
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
  { names: ['CH2N2', 'diazomethane'], level: 'danger', kind: 'energetic', title: 'Explosive and highly toxic: diazomethane', why: 'Use a dedicated kit without ground-glass joints, behind a shield; TMSCHN2 is safer for methyl esters.' },
  { names: ['NaN3', 'HN3', 'sodium azide'], level: 'warning', kind: 'toxic', title: 'Toxic, and forms explosive azides: sodium azide', why: 'Never with acid (hydrazoic acid), heavy metals or dichloromethane (diazidomethane); check the product azide against (C + O)/N ≥ 3.' },
  { names: ['TMSN3', 'DPPA'], level: 'warning', kind: 'energetic', title: 'Azide reagent', why: 'Gives organic azides: check the product against (C + O)/N ≥ 3 and the rule of six.' },
  { names: ['HNO3', 'nitric acid', 'NO2BF4', 'fuming nitric acid'], level: 'warning', kind: 'energetic', title: 'Nitration: exothermic', why: 'Mixed-acid nitrations can run away: add slowly with cooling and watch the temperature. Each nitro group added makes the product more energetic.' },
  { names: ['HF', 'HF·pyridine', 'HF·py', 'Olah\'s reagent', 'Et3N·3HF'], level: 'danger', kind: 'toxic', title: 'Hydrogen fluoride', why: 'HF burns are painless at first and can be fatal: keep calcium gluconate gel at hand and use plastic ware.' },
  { names: ['NaCN', 'KCN', 'CuCN', 'Zn(CN)2', 'TMSCN', 'HCN', 'acetone cyanohydrin'], level: 'danger', kind: 'toxic', title: 'Cyanide', why: 'Acid releases hydrogen cyanide: keep the reaction and its work-up basic, and quench waste with bleach.' },
  { names: ['COCl2', 'phosgene', 'diphosgene', 'triphosgene'], level: 'danger', kind: 'toxic', title: 'Phosgene or a phosgene source', why: 'Work in a fume hood with a phosgene indicator; CDI is a safer alternative for many couplings.' },
  { names: ['OsO4', 'K2OsO4'], level: 'danger', kind: 'toxic', title: 'Osmium', why: 'OsO4 is volatile and highly toxic: use catalytic amounts and quench with sodium sulfite or thiosulfate.' },
  { names: ['Me2SO4', 'dimethyl sulfate', 'MeOTf', 'methyl triflate', 'Meerwein\'s salt'], level: 'danger', kind: 'toxic', title: 'Potent alkylating agent', why: 'Toxic and carcinogenic: destroy excess with aqueous ammonia.' },
  { names: ['MeI', 'CH3I'], level: 'warning', kind: 'toxic', title: 'Iodomethane', why: 'Volatile alkylating agent, suspected carcinogen.' },
  { names: ['t-BuLi', 'tBuLi', 'tert-BuLi', 'AlMe3', 'Me3Al', 'AlEt3', 'Et2Zn', 'ZnEt2', 'Et3B'], level: 'danger', kind: 'reactive', title: 'Pyrophoric reagent', why: 'Ignites in air: transfer under inert gas by syringe or cannula, with a class D extinguisher at hand.' },
  { names: ['n-BuLi', 'nBuLi', 'BuLi', 's-BuLi', 'sBuLi'], level: 'warning', kind: 'reactive', title: 'Organolithium', why: 'Reacts violently with water and can ignite: handle under inert gas.' },
  { names: ['LiAlH4', 'LAH'], level: 'warning', kind: 'reactive', title: 'Lithium aluminium hydride', why: 'Reacts violently with water: quench slowly at 0 °C (Fieser work-up).' },
  { names: ['H2O2', 'mCPBA', 'm-CPBA', 'TBHP', 't-BuOOH', 'peracetic acid', 'AcOOH', 'DMDO', 'Oxone'], level: 'warning', kind: 'energetic', title: 'Peroxide', why: 'Oxidants that can decompose violently, especially when concentrated or heated: quench before work-up and never distil to dryness.' },
  { names: ['DEAD', 'DIAD'], level: 'warning', kind: 'energetic', title: 'Azodicarboxylate', why: 'Shock- and heat-sensitive when neat (DEAD especially): use as a solution.' },
  { names: ['CrO3', 'PCC', 'PDC', 'K2Cr2O7', 'Na2Cr2O7', 'Jones reagent', 'Jones'], level: 'danger', kind: 'toxic', title: 'Chromium(VI)', why: 'Carcinogenic: Dess–Martin, Swern or TEMPO oxidations avoid it.' },
  { names: ['HMPA'], level: 'warning', kind: 'toxic', title: 'HMPA', why: 'Carcinogen: DMPU often works instead.' },
  { names: ['benzene', 'C6H6'], level: 'warning', kind: 'toxic', title: 'Benzene', why: 'Carcinogen: use toluene instead where possible.' },
  { names: ['CS2'], level: 'warning', kind: 'toxic', title: 'Carbon disulfide', why: 'Neurotoxic, and ignites around 90 °C.' },
  { names: ['MOMCl', 'MOM-Cl'], level: 'danger', kind: 'toxic', title: 'Chloromethyl methyl ether', why: 'Carcinogen: make it in situ or use another protecting group.' },
  { names: ['Hg(OAc)2', 'HgCl2', 'HgO', 'Hg(OTf)2'], level: 'danger', kind: 'toxic', title: 'Mercury salt', why: 'Highly toxic: collect all mercury waste separately.' },
  { names: ['Bu3SnH', 'nBu3SnH', 'Bu3SnCl', 'Me3SnCl'], level: 'warning', kind: 'toxic', title: 'Organotin', why: 'Toxic and hard to remove from products; tris(trimethylsilyl)silane can often replace Bu3SnH.' },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let reagentPatterns: { entry: (typeof REAGENTS)[number]; re: RegExp }[] | null = null;

/** Hazards in reagent and condition text ("NaH, DMF, 0 °C"). */
export function reagentHazards(text: string): Hazard[] {
  reagentPatterns ??= REAGENTS.map((entry) => ({ entry, re: new RegExp(`(?<![A-Za-z0-9-])(?:${entry.names.map(escape).join('|')})(?![a-z0-9(])`) }));
  const out: Hazard[] = [];
  for (const { entry, re } of reagentPatterns) if (re.test(text)) out.push({ kind: entry.kind, level: entry.level, title: entry.title, detail: entry.why, atoms: [] });
  // Sodium hydride is common and safe enough alone; with DMF, DMAc or DMSO it has run away many times.
  if (/(?<![A-Za-z])NaH(?![A-Za-z0-9])/.test(text) && /(?<![A-Za-z])(DMF|DMAc|DMA|DMSO)(?![A-Za-z])/.test(text)) {
    out.push({ kind: 'reactive', level: 'warning', title: 'NaH with DMF, DMAc or DMSO', detail: 'This combination has caused runaway reactions and explosions on heating: keep it cold and small, or use another base or solvent.', atoms: [] });
  }
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}

/** One line for a hazard, for tool replies and copied text. */
export const hazardLine = (h: Hazard) => `${h.title}. ${h.detail}`;
