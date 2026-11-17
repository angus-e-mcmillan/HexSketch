import { RESIDUES, isomorphisms, peptideMolecule, pseudoLabel, cipLimits, ezLabel, labelStructure, Molecule, perceiveRings, oligoSmiles, oligoText, parseOligo, parsePeptide, parseSmiles, peptideName, peptideText, perceiveStereoFromGeometry, recogniseOligo, recognisePeptide, rsLabel, sameStereoisomer, type AtomId, type Oligo, type Peptide } from '@hexsketch/core';
import { analyze, SENIORITY, isAcylCarbon, isIminium, isRingAnion, isRingCation, type Analysis, type Group, type GroupKind } from './analyze.ts';
import type { RingRow } from './rings.ts';
import { TEMPLATES, type RingTemplate } from './templates.ts';
import { HALIDE, HALO, alkaneStem, attachSuffix, compareLocant, complexMultiplier, multiplier } from './vocab.ts';
import { isMetal, metalCation, metalName, speciesName } from './simple.ts';

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
  kind: 'template' | 'cyclo' | 'vonbaeyer' | 'spiro';
  /** Two identical rings joined by a bond (1,1'-biphenyl): the name is bracketed before a locant. */
  assembly?: boolean;
  /** A template parent named with hydro prefixes; each numbering's choice is in hydroOf. */
  hydro?: boolean;
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
interface Hydro {
  ih: AtomId[]; hydro: AtomId[];
  /** No ring double bonds left (1,4-dithiepane rather than hydro prefixes). */ saturated: boolean;
  /** Added hydrogen for a ketone suffix: the 1 of quinolin-2(1H)-one. */ added?: AtomId[];
}
const hydroOf = new WeakMap<Numbering, Hydro>();
/** 0 for a numbering whose indicated hydrogen sits where it is preferred (see hydroParent), else 1. */
const prefOf = new WeakMap<Numbering, number>();

function subsets<T>(items: T[], size: number): T[][] {
  if (size === 0) return [[]];
  const out: T[][] = [];
  items.forEach((x, i) => { for (const rest of subsets(items.slice(i + 1), size - 1)) out.push([x, ...rest]); });
  return out;
}

/** "2,3-dihydro-1H-" + "indole", or for a substituent stem "2,3-dihydro-1H-" + "inden". */
function withHydro(stem: string, h: Hydro, numbering: Numbering): string {
  // (h is reassigned below for porphyrin)
  const loc = (a: AtomId) => numbering.get(a)!;
  let ih = h.ih.map(loc).sort(compareLocant).map((l) => `${l}H`).join(',');
  // The CH2 of a fused 1,3-dioxole or 1,3-dioxine goes without its indicated hydrogen, as chemists
  // write it: 5,6,7,8-tetrahydro-[1,3]dioxolo[4,5-g]isoquinoline, 4H-benzo[d][1,3]dioxine.
  if (/\[1,3\]diox(ol|in)/.test(stem)) ih = ih.split(',').filter((x) => x !== '2H').join(',');
  // Porphyrin is the 21H,23H parent itself.
  let hydro = h.hydro;
  if (/^porphyrin/.test(stem) && hydro.map(loc).sort(compareLocant).join(',') === '21,23') hydro = [];
  h = { ...h, hydro };
  // Fully saturated, the hydro prefixes need no locants: octahydro-2H-quinolizine, dihydrofuran-2(3H)-one.
  const hy = !h.hydro.length ? '' : h.saturated ? `${multiplier(h.hydro.length)}hydro` : `${h.hydro.map(loc).sort(compareLocant).join(',')}-${multiplier(h.hydro.length)}hydro`;
  const ihText = ih ? `${ih}-` : '';
  const join = hy && (ihText || /^[0-9[]/.test(stem)) ? '-' : '';
  return `${hy}${join}${ihText}${stem}`;
}

interface Prefix {
  text: string; complex: boolean; sortKey: string; at: AtomId | 'N';
  /** For 'N': the carbon whose amine or amide this nitrogen is. */ nOf?: AtomId;
  /** For 'N': the nitrogen itself, and every principal nitrogen on the same carbon (two or more: N and N'). */ nAtom?: AtomId; nGem?: AtomId[];
  /** On the far nitrogen of a hydrazide: N'. */ prime?: boolean;
}
/** `di`: bracketed but unsubstituted, so multiplied with di/tri: di(1H-imidazol-1-yl). */
interface SubName { text: string; complex: boolean; sortKey: string; di?: boolean }

/** The sort key of a prefix: its letters, italic prefixes (tert-, sec-, o-, m-, p-) and locants left out. */
const sortKeyOf = (text: string) => text.replace(/\((?:\d+[a-z]?'*)?[RSEZrs](?:,(?:\d+[a-z]?'*)?[RSEZrs])*\)-/g, '').replace(/\b(tert|sec|[omp])-/g, '').replace(/[^a-z]/g, '');

/**
 * Each amino acid with a name, as a free acid laid out for matching: its N, alpha carbon and
 * carboxyl carbon, and the alpha carbon with its side chain as a molecule of its own.
 */
interface ResidueRef { code: string; free: string; acyl: string | null; achiral: boolean; mol: Molecule; n: AtomId; ca: AtomId; c: AtomId; side: Molecule; sideMap: Map<AtomId, AtomId> }
let residueRefs: ResidueRef[] | null = null;
const PROTEINOGENIC = new Set(['Ala', 'Arg', 'Asn', 'Asp', 'Cys', 'Gln', 'Glu', 'Gly', 'His', 'Ile', 'Leu', 'Lys', 'Met', 'Phe', 'Pro', 'Ser', 'Thr', 'Trp', 'Tyr', 'Val']);
function residues(): ResidueRef[] {
  if (residueRefs) return residueRefs;
  residueRefs = [];
  for (const [code, def] of Object.entries(RESIDUES)) {
    // The amino acids of proteins only; others go by their systematic names.
    if (!def.free || !PROTEINOGENIC.has(code)) continue;
    let k = 1;
    const ph = new Map<string, number>();
    const fill = (t: string) => t.replace(/\{(\w)\}/g, (_, x: string) => String(ph.get(x) ?? (ph.set(x, k++), ph.get(x))));
    const smi = def.special ? fill(def.special.smiles) + 'O' : def.side ? `N[C@@H](${fill(def.side)})C(=O)O` : 'NCC(=O)O';
    const mol = parseSmiles(smi);
    const ids = [...mol.atoms()].map((a) => a.id);
    const [n, ca, c] = def.special ? def.special.main.map((i) => ids[i]!) : [ids[0]!, ids[1]!, ids[ids.length - 3]!];
    const side = sideChain(mol, ca!, n!, c!);
    residueRefs.push({ code, free: def.free, acyl: def.acyl?.replace(/^α-/, '') ?? null, achiral: !!def.achiral, mol, n: n!, ca: ca!, c: c!, ...side });
  }
  return residueRefs;
}

/** The alpha carbon and everything reached from it but its N and carboxyl carbon, as a molecule. */
function sideChain(mol: Molecule, ca: AtomId, n: AtomId, c: AtomId): { side: Molecule; sideMap: Map<AtomId, AtomId>; atoms: Set<AtomId> } {
  const atoms = new Set<AtomId>([ca]);
  const stack = [ca];
  while (stack.length) { const x = stack.pop()!; for (const y of mol.neighbours(x)) if (y !== n && y !== c && !atoms.has(y)) { atoms.add(y); stack.push(y); } }
  const side = mol.clone();
  // Each atom keeps the hydrogens it had, whether they were written ([C@@H]) or implied.
  for (const a of side.atoms()) a.explicitHydrogens = mol.implicitHydrogens(a.id);
  for (const a of [...side.atoms()]) if (!atoms.has(a.id)) side.removeAtom(a.id);
  return { side, sideMap: new Map([...atoms].map((x) => [x, x])), atoms };
}

/** Unbalanced if a bracket closes before it opens or is left open. */
const balanced = (t: string) => { let d = 0; for (const c of t) { if (c === '(') d++; else if (c === ')' && --d < 0) return false; } return d === 0; };

/** The acyl groups chemists keep their own names for, by systematic name. */
const ACYL: Record<string, string> = {
  propanoyl: 'propionyl', butanoyl: 'butyryl', 'prop-2-enoyl': 'acryloyl', '2-methylprop-2-enoyl': 'methacryloyl', hexadecanoyl: 'palmitoyl', octadecanoyl: 'stearoyl',
  '(Z)-octadec-9-enoyl': 'oleoyl', '2-methylpropanoyl': 'isobutyryl', '2,2-dimethylpropanoyl': 'pivaloyl',
};

/**
 * Substituent prefixes as chemists write them: p-tolyl, mesityl, 4-methoxybenzyl, phenethyl, 4-hydroxystyryl,
 * 2-hydroxyacetyl, acryloyl, 2-phenylacetamido, carboxymethyl, trimethylammonio, diphenylphosphaneyl.
 */
function chemistStyle(s: SubName): SubName {
  const t = s.text;
  const mk = (text: string, complex = true, di?: boolean): SubName => ({ text, complex, sortKey: sortKeyOf(text), ...(di ? { di } : {}) });
  const TOLYL: Record<string, string> = { '2-methylphenyl': 'o-tolyl', '3-methylphenyl': 'm-tolyl', '4-methylphenyl': 'p-tolyl' };
  if (TOLYL[t]) return mk(TOLYL[t]!, true, true);
  if (t === '2,4,6-trimethylphenyl') return mk('mesityl', false);
  if (t === '2-phenylethyl') return mk('phenethyl', false);
  if (t === 'eth-1-en-1-yl') return mk('vinyl', false);
  const vi = /^(\([EZ]\)-)?((?:[12](?:,[12])*-.+?)+)eth-1-en-1-yl$/.exec(t);
  if (vi && balanced(vi[2]!) && !/^2-(\(.*phenyl\)|phenyl)$/.test(vi[2]!)) return mk(`${vi[1] ?? ''}${vi[2]}vinyl`);
  // A substituted allyl keeps the name: 2-chloroallyl, 2,3,3-trichloroallyl.
  const al = /^((?:\d+(?:,\d+)*-[a-z]+)+)prop-2-en-1-yl$/.exec(t);
  if (al) return mk(`${al[1]}allyl`);
  if (t === '2-hydroxy-2-oxoethyl') return mk('carboxymethyl');
  if (t === 'amino(imino)methyl') return mk('carbamimidoyl', false);
  if (t === '(amino(imino)methyl)amino' || t === 'carbamimidoylamino') return mk('guanidino', false);
  if (t === 'carbamoylamino') return mk('ureido', false);
  // (Phenylamino)thioxomethyl: phenylcarbamothioyl.
  if (t === 'aminothioxomethyl') return mk('carbamothioyl', false);
  const ct = /^\((.+)amino\)thioxomethyl$/.exec(t) ?? /^thioxo\((.+)amino\)methyl$/.exec(t);
  if (ct && balanced(ct[1]!)) return mk(`${ct[1]}carbamothioyl`);
  const sa = /^\((\(.+\)|[a-z]+)sulfonyl\)amino$/.exec(t);
  if (sa && balanced(sa[1]!)) return mk(`${sa[1]}sulfonamido`);
  let mu = /^\((di)?([a-z]+|\(.+\))carbamoyl\)amino$/.exec(t);
  if (mu && balanced(mu[2]!) && !/carbamoyl/.test(mu[2]!)) return mk(`${mu[1] ? '3,3-di' : '3-'}${mu[2]}ureido`);
  if (t === 'hydroxy(oxo)-λ5-phosphanyl') return mk('hydroxyhydrophosphoryl');
  if (t === '(p-tolyl)sulfonyl' || t === 'p-tolylsulfonyl') return mk('tosyl', false);
  if (t === '3-hydroxy-3-oxopropyl') return mk('2-carboxyethyl');
  if (ACYL[t]) return mk(ACYL[t]!, false);
  if (/^(\([EZ]\)-)?3-.*prop-2-enoyl$/.test(t)) return mk(t.replace(/prop-2-enoyl$/, 'acryloyl'));
  // (4-methoxyphenyl)methyl: 4-methoxybenzyl; (4-methoxyphenyl)methylidene: 4-methoxybenzylidene.
  let m = /^(\([EZ]\)-)?\((.+)phenyl\)methyl(idene)?$/.exec(t);
  if (m && balanced(m[2]!) && (!m[1] || m[3])) return mk(`${m[1] ?? ''}${m[2]}benzyl${m[3] ? 'idene' : ''}`);
  if (t === 'phenylmethylidene') return mk('benzylidene', false);
  m = /^(\([EZ]\)-)?\(([omp])-tolyl\)methyl(idene)?$/.exec(t);
  if (m && (!m[1] || m[3])) return mk(`${m[1] ?? ''}${({ o: 2, m: 3, p: 4 } as Record<string, number>)[m[2]!]}-methylbenzyl${m[3] ? 'idene' : ''}`);
  // (E)-2-(4-hydroxyphenyl)eth-1-en-1-yl: (E)-4-hydroxystyryl.
  m = /^(\([EZ]\)-)?2-(?:\((.+)phenyl\)|phenyl)eth-1-en-1-yl$/.exec(t);
  if (m && balanced(m[2] ?? '')) return mk(`${m[1] ?? ''}${m[2] ?? ''}styryl`, true);
  // A substituted two-carbon acyl keeps "acetyl": 2-hydroxyacetyl, 2-phenylacetyl.
  if (/ethanoyl$/.test(t)) return mk(t.replace(/ethanoyl$/, 'acetyl'));
  if (/methylidene$/.test(t) && !/^(\([EZ]\)-)?methylidene$/.test(t)) return mk(t.replace(/methylidene$/, 'methylene'), s.complex);
  if (/azaniumyl$/.test(t)) return mk(t.replace(/azaniumyl$/, 'ammonio'), t !== 'azaniumyl' && s.complex);
  if (/phosphanyl$/.test(t) && !/λ/.test(t)) return mk(t.replace(/phosphanyl$/, 'phosphaneyl'), s.complex);
  return s;
}

/**
 * A ring's acyl group named from the ring: pyrazine-2-carbonyl, cyclohexanecarbonyl, 4-methoxybenzoyl,
 * (S)-pyrrolidine-2-carbonyl. Null where the ring's name gives no such form.
 */
function ringCarbonyl(yl: string): string | null {
  const m = /^(.*)phenyl$/.exec(yl);
  if (m && balanced(m[1]!)) return `${m[1]}benzoyl`;
  if (/ium|ide-|spiro/.test(yl)) return null;
  const cyc = /^(.*cyclo[a-z]+)yl$/.exec(yl);
  if (cyc && !/-\d/.test(cyc[1]!.slice(cyc[1]!.lastIndexOf('cyclo')))) return `${cyc[1]}anecarbonyl`;
  const r = /^(.*[a-z\]])-(\d+[a-z]?'*)-yl$/.exec(yl);
  if (!r) return null;
  return `${r[1]}${/(furan|pyran)$/.test(r[1]!) ? '' : 'e'}-${r[2]}-carbonyl`;
}

/** The ester word for an acyl group: acetyl, acetate; octanoyl, octanoate; benzoyl, benzoate. */
function esterWord(acyl: string): string | null {
  if (/[()\d]/.test(acyl)) return null;
  if (acyl === 'acetyl') return 'acetate';
  if (acyl === 'benzoyl') return 'benzoate';
  if (/anoyl$|enoyl$/.test(acyl)) return acyl.replace(/oyl$/, 'oate');
  const RET: Record<string, string> = { acryloyl: 'acrylate', palmitoyl: 'palmitate', stearoyl: 'stearate', methacryloyl: 'methacrylate', formyl: 'formate', carbamoyl: 'carbamate' };
  return RET[acyl] ?? null;
}

/** An acylamino prefix as one word: acetamido, 2-phenylacetamido, pentanamido, benzamido, pyrazine-2-carboxamido. */
function amido(acyl: string): string | null {
  if (/acetyl$/.test(acyl)) return acyl.replace(/acetyl$/, 'acetamido');
  if (/benzoyl$/.test(acyl)) return acyl.replace(/benzoyl$/, 'benzamido');
  if (/([a-z\]]-\d+[a-z]?'*-c|anec)arbonyl$/.test(acyl) && balanced(acyl)) return acyl.replace(/carbonyl$/, 'carboxamido');
  if (/(an|en|yn)oyl$/.test(acyl)) return acyl.replace(/oyl$/, 'amido');
  const RET: Record<string, string> = { acryloyl: 'acrylamido', palmitoyl: 'palmitamido', stearoyl: 'stearamido', methacryloyl: 'methacrylamido' };
  return RET[acyl] ?? null;
}

const el = (mol: Molecule, id: AtomId) => mol.atom(id).element;

const ALKOXY: Record<string, string> = { methyl: 'methoxy', ethyl: 'ethoxy', propyl: 'propoxy', butyl: 'butoxy', isopropyl: 'isopropoxy', phenyl: 'phenoxy', 'tert-butyl': 'tert-butoxy' };

/**
 * R-O- as a prefix. A substituted methyl, ethyl, propyl, butyl or phenyl keeps the
 * contracted form, as ChemDraw writes it: 2-hydroxyethoxy, 4-methoxyphenoxy, not ((2-hydroxyethyl)oxy).
 */
function alkoxy(R: SubName): SubName {
  if (ALKOXY[R.text]) return { text: ALKOXY[R.text]!, complex: R.text === 'tert-butyl', sortKey: ALKOXY[R.text]!.replace(/^tert-/, '') };
  if (/[-)a-z](methyl|ethyl|propyl|butyl|phenyl)$/.test(R.text)) {
    const swap = (t: string) => t.replace(/(methyl|ethyl|propyl|butyl|phenyl)$/, (m) => ALKOXY[m]!);
    return { text: swap(R.text), complex: R.complex, sortKey: swap(R.sortKey) };
  }
  // A ring with nothing on it needs no brackets: (cyclohex-1-en-1-yloxy), (pyridin-2-yloxy).
  return { text: `${wrapInner(R)}oxy`, complex: true, sortKey: `${R.sortKey}oxy` };
}

/**
 * Prefixes that cannot themselves carry a substituent, so a prefix written before them cannot be
 * read as on them. Mercapto and formyl are not among them: "aminomercapto" reads as H2N-S-.
 */
const ATOM_LIKE = /^(fluoro|chloro|bromo|iodo|nitro|nitroso|cyano|oxo|thioxo|hydroxy|azido|carboxy|carboxylato|sulfo|sulfonato|sulfino|sulfinato|isocyanato|isothiocyanato|oxido|dihydroxyamino)$/;
const TRADITIONAL = /^(tert|sec)-[a-z]+$/;
/**
 * A lone substituent inside a compound prefix (…oxy, …imino, …amino, …thio) is bracketed unless it is
 * a traditional or unsubstituted ring name that cannot be misread: tert-butylamino, pyridin-2-yloxy,
 * p-tolylimino, but (1,2,3-thiadiazol-4-yl)amino.
 */
function wrapInner(R: SubName): string {
  return R.complex && !/^(tert|sec)-(butyl|pentyl)$/.test(R.text) && !(R.di && !/^\d/.test(R.text)) ? `(${R.text})` : R.text;
}

/**
 * Prefixes cited one after another with no locants between them, already in order:
 * trichloro(vinyl)silane, chloro(methyl)diphenylsilane, ethoxydimethyl(vinyl)silane.
 * A prefix after the first goes in brackets where running it into the one before could be
 * read as one substituted group (chlorovinyl, methylphenyl); a multiplied prefix, or one
 * that cannot be substituted, needs none. A substituted prefix is always bracketed.
 */
function citeRun(items: readonly { text: string; complex: boolean; n: number; di?: boolean }[]): string {
  return items.map(({ text, complex, n }, i) => {
    if (TRADITIONAL.test(text)) return n > 1 ? `${multiplier(n)}-${text}` : i === 0 ? text : `(${text})`;
    if (complex && n === 1 && i === 0 && items.length === 1 && (items[0] as { di?: boolean }).di && !/^([omp]-|\d)/.test(text)) return text;
    if (complex) return `${complexMultiplier(n)}(${text})`;
    if (n > 1) return `${multiplier(n)}${text}`;
    return i === 0 || ATOM_LIKE.test(text) ? text : `(${text})`;
  }).join('');
}

/** Identical prefixes counted, then sorted alphabetically: the items of a citeRun. */
function countSubs(subs: readonly SubName[]): { text: string; complex: boolean; n: number; sortKey: string; di?: boolean }[] {
  const counts = new Map<string, { text: string; complex: boolean; n: number; sortKey: string; di?: boolean }>();
  for (const s of subs) { const e = counts.get(s.text); if (e) e.n++; else counts.set(s.text, { text: s.text, complex: s.complex, n: 1, sortKey: s.sortKey, di: s.di }); }
  return [...counts.values()].sort((x, y) => x.sortKey.localeCompare(y.sortKey) || x.text.localeCompare(y.text));
}

// Primed locants (the second ring of an assembly) count after every unprimed one.
const locVal = (l: string) => { const m = /^(\d+)([a-z]?)('*)/.exec(l); return m ? Number(m[1]) + (m[2] ? 0.1 * (m[2].charCodeAt(0) - 96) : 0) + 1000 * m[3]!.length : 0; };
/** Locants in order of citation (alphabetical), each prefix's own locants lowest first: the last numbering rule. */
const alphaLocs = (pre: readonly { sortKey: string; text: string; at: AtomId | 'N' }[], numbering: Numbering) =>
  pre.map((x) => ({ k: x.sortKey, t: x.text, l: locVal(numbering.get(x.at as AtomId)!) }))
    .sort((x, y) => x.k.localeCompare(y.k) || x.t.localeCompare(y.t) || x.l - y.l).map((x) => x.l);
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

/** A generated parent (rings.ts) as a template; see the row format there. */
function decodeRow([name, els, locs, extra, gaps]: RingRow): RingTemplate {
  const elements = els.match(/[A-Z][a-z]?/g)!;
  let locants: string[];
  if (locs.startsWith('!')) locants = locs.slice(1).split(' ');
  else {
    let n = 0;
    locants = [...locs].map((c) => (c === '.' ? String(++n) : `${n}${c}`));
  }
  const missing = new Set(gaps ? gaps.split(' ').map(Number) : []);
  const bonds: [number, number][] = [];
  for (let i = 0; i + 1 < elements.length; i++) if (!missing.has(i)) bonds.push([i, i + 1]);
  if (extra) for (const b of extra.split(' ')) bonds.push(b.split('.').map(Number) as [number, number]);
  return { name, yl: name.replace(/e$/, ''), smiles: '', aromatic: true, mancude: true, skeleton: { elements, bonds }, locants };
}

let parentsByComposition: Map<string, (CompiledTemplate | RingRow)[]> | null = null;
let RING_ROWS: RingRow[] = [];

/**
 * Add the generated ring parents (rings.ts, about 80 kB gzipped). Importing
 * '@hexsketch/naming/rings' does this; the web app loads it after it opens,
 * and until then names rings from the hand-written templates only.
 */
export function addRingParents(rows: RingRow[]): void {
  RING_ROWS = rows;
  parentsByComposition = null;
}

/**
 * Mancude parents with these elements: the hand-written templates first, then
 * the generated ones, each compiled the first time a ring of its make-up is named.
 */
function parentsFor(elements: string[]): CompiledTemplate[] {
  if (!parentsByComposition) {
    parentsByComposition = new Map();
    const add = (key: string, x: CompiledTemplate | RingRow) => {
      const list = parentsByComposition!.get(key);
      if (list) list.push(x); else parentsByComposition!.set(key, [x]);
    };
    for (const ct of templates()) if (ct.t.mancude) add(composition([...ct.mol.atoms()].map((a) => a.element)), ct);
    for (const row of RING_ROWS) add(composition(row[1].match(/[A-Z][a-z]?/g)!), row);
  }
  const list = parentsByComposition.get(composition(elements)) ?? [];
  for (let i = 0; i < list.length; i++) {
    const x = list[i]!;
    if (Array.isArray(x)) list[i] = compile(decodeRow(x));
  }
  return list as CompiledTemplate[];
}

/** Every mapping of a template onto a ring system, as locant numberings. */
function matchTemplate(an: Analysis, system: AtomId[], ct: CompiledTemplate): Numbering[] {
  const mol = an.mol;
  if (system.length !== ct.cls.length) return [];
  const inSys = new Set(system);
  const sysNbrs = new Map(system.map((a) => [a, mol.neighbours(a).filter((n) => inSys.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id))]));
  const cls = new Map(system.map((a) => [a, ringClass(mol, a, (x) => inSys.has(x))]));
  const fits = (a: AtomId, want: string) => cls.get(a) === want;
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

/**
 * Size of a maximum matching on `atoms` using ring bonds among them. Atoms are
 * taken in breadth-first order and subproblems memoised by the set left, so a
 * ring system (narrow, whatever its size) is quick.
 */
function maxMatching(an: Analysis, atoms: AtomId[]): number {
  const mol = an.mol;
  if (atoms.length > 52) return 0;
  const set = new Set(atoms);
  // Breadth-first order keeps the frontier, and so the memo, small.
  const order: AtomId[] = [];
  const seen = new Set<AtomId>();
  for (const s0 of atoms) {
    if (seen.has(s0)) continue;
    const q = [s0]; seen.add(s0);
    while (q.length) {
      const x = q.shift()!; order.push(x);
      for (const y of mol.neighbours(x)) if (set.has(y) && !seen.has(y) && an.ringBonds.has(mol.bondBetween(x, y)!.id)) { seen.add(y); q.push(y); }
    }
  }
  const pos = new Map(order.map((a, i) => [a, i]));
  const nbrs = order.map((a) => mol.neighbours(a).filter((y) => set.has(y) && an.ringBonds.has(mol.bondBetween(a, y)!.id)).map((y) => pos.get(y)!).filter((j) => j > pos.get(a)!));
  const bit = (i: number) => 2 ** i;
  const has = (mask: number, i: number) => Math.floor(mask / bit(i)) % 2 === 1;
  const memo = new Map<string, number>();
  // f(i, used): best matching among atoms i.. given which later atoms are already used.
  const f = (i: number, used: number): number => {
    if (i >= order.length) return 0;
    if (has(used, i)) return f(i + 1, used - bit(i));
    const key = `${i}:${used}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = f(i + 1, used);
    for (const j of nbrs[i]!) if (!has(used, j)) best = Math.max(best, 1 + f(i + 1, used + bit(j)));
    memo.set(key, best);
    return best;
  };
  return f(0, 0);
}

/**
 * A partly or fully saturated form of a mancude template parent, named with
 * hydro prefixes and indicated hydrogen (P-31.1.4.2.4): every way of reading
 * the ring's double bonds as the parent's, less some removed in pairs.
 */
function hydroParent(an: Analysis, system: AtomId[], ketoneSuffix: boolean | 'imine' = false): { info: RingInfo; numberings: Numbering[] } | null {
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
  // (A pyrylium-type O+ or S+ takes a double bond too.)
  const capable = system.filter((a) => (el(mol, a) === 'C' && ringNb(a).length <= 3) || (el(mol, a) === 'N' && ringNb(a).length === 2)
    || ((el(mol, a) === 'O' || el(mol, a) === 'S') && mol.atom(a).charge === 1 && ringNb(a).length === 2)
    // Trivalent P, As and B and tetravalent Si and Ge as N and C are: 1H-phosphole, 1H-silole, 1H-borole.
    || (['P', 'As', 'B', 'Si', 'Ge'].includes(el(mol, a)) && mol.atom(a).charge === 0 && ringNb(a).length === 2 && ringNb(a).some((b) => el(mol, b) === 'C' || el(mol, b) === 'N')
      && mol.neighbours(a).length + (an.h.get(a) ?? 0) === (['Si', 'Ge'].includes(el(mol, a)) ? 4 : 3) && mol.incidentBonds(a).every((b) => mol.bond(b).order === 1 || inSys.has(mol.otherAtom(mol.bond(b), a)))));
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
  const plain: Hydro[] = choices.map((ih) => ({ ih, hydro: rest.filter((a) => !ih.includes(a)), saturated: double.length === 0 }));
  let styles = plain;
  // A ring C=O named by the -one suffix takes no hydro prefix of its own (P-31.1.4.2.4,
  // as ChemDraw names them): its place is taken by indicated hydrogen (1,9-dihydro-6H-purin-6-one),
  // by another ketone (anthracene-9,10-dione), or else by added hydrogen (quinolin-2(1H)-one).
  // Fewest added hydrogens first; each choice must still leave the parent a Kekulé structure.
  const doubled = (x: string) => ketoneSuffix ? rest.filter((a) => el(mol, a) === 'C' && mol.incidentBonds(a).some((b) => {
    const bd = mol.bond(b);
    return bd.order === 2 && el(mol, mol.otherAtom(bd, a)) === x && !inSys.has(mol.otherAtom(bd, a));
  })) : [];
  // Thiones are the suffix only when no ketone is: 2-thioxo-...pyrimidin-4(1H)-one.
  const oxo = doubled('O');
  const ketones = ketoneSuffix === 'imine' ? doubled('N') : oxo.length ? oxo : doubled('S');
  if (ketones.length) {
    // The fewest added hydrogens for each choice of indicated hydrogen (which is chosen later: a
    // carbocycle puts it on a ketone carbon, 3H-...-3,11(2H)-dione; a heterocycle takes the fewest added).
    const best: Hydro[] = [];
    for (const ih of choices) {
      const others = rest.filter((a) => !ketones.includes(a) && !ih.includes(a));
      let fewest = Infinity;
      for (let size = 0; size <= Math.min(ketones.length, others.length, fewest); size++) {
        for (const added of subsets(others, size)) {
          const hydro = others.filter((a) => !added.includes(a));
          if (hydro.length % 2) continue;
          const left = capable.filter((a) => !ketones.includes(a) && !ih.includes(a) && !added.includes(a));
          if (maxMatching(an, left) * 2 !== left.length) continue;
          fewest = size;
          best.push({ ih, hydro, added, saturated: double.length === 0 });
        }
      }
    }
    if (best.length) styles = best;
  }
  const hetero = (e: string) => system.some((a) => el(mol, a) === e);
  const base = { heteroN: hetero('N'), heteroO: hetero('O'), heteroS: hetero('S') };
  const monocyclic = system.every((a) => ringNb(a).length === 2);
  const hw = monocyclic ? hantzschWidman(an, system) : null;
  for (const ct0 of [...parentsFor(system.map((a) => el(mol, a))), ...(hw ? [hw] : [])]) {
    // A fully saturated heteromonocycle has a name of its own: oxepane, 1,3-dithiolane, isothiazolidine, azocane.
    const sat = monocyclic && double.length === 0 && !ct0.t.saturated ? saturatedName(ct0.t.name, system.some((a) => el(mol, a) === 'N')) : null;
    const ct = sat ? compiledWithSaturated(ct0, sat) : ct0;
    const maps = matchSkeleton(an, system, ct);
    if (!maps.length) continue;
    const numberings: Numbering[] = [];
    // A ring with a name of its own when saturated takes the ketone as is: 1,4-dithiepan-6-one.
    const carbocyclic = system.every((a) => el(mol, a) === 'C');
    for (const m of maps) {
      const list = double.length === 0 && ct.t.saturated ? plain : styles;
      // Where a ketone takes the suffix, its indicated hydrogen goes on a ketone carbon (3H-...-3,17(2H)-dione,
      // 1H-isoindole-1,3(2H)-dione, 1,9-dihydro-6H-purin-6-one) unless, in a heterocycle, a lower locant
      // needs no added hydrogen (3,7-dihydro-1H-purine-2,6-dione, 1H-pyrrole-2,5-dione).
      const lowIh = (st: Hydro) => Math.min(...st.ih.map((a) => locVal(m.get(a)!)), Infinity);
      const atKetone = (st: Hydro) => st.ih.some((a) => ketones.includes(a));
      const kMin = Math.min(...list.filter(atKetone).map(lowIh), Infinity);
      // In a heterocycle, a lower locant with fewer added hydrogens wins: 7,9-dihydro-1H-purine-2,6,8(3H)-trione.
      const nAdded = (st: Hydro) => (st.added ?? []).length;
      const kFewest = Math.min(...list.filter(atKetone).map(nAdded), Infinity);
      const lowerBetter = list.some((st) => lowIh(st) < kMin && nAdded(st) < kFewest);
      const favourKetone = ketones.length > 0 && kMin < Infinity && (carbocyclic || !lowerBetter);
      for (const style of list) {
        // Porphyrin is named for its 21H,23H form; another tautomer has no porphyrin name here.
        if (ct.t.name === 'porphyrin' && !['21', '23'].every((l) => [...style.hydro, ...style.ih].some((a) => m.get(a) === l))) continue;
        const n = new Map(m);
        hydroOf.set(n, style);
        prefOf.set(n, favourKetone ? (atKetone(style) ? 0 : 1) : 0);
        numberings.push(n);
      }
    }
    if (!numberings.length) continue;
    const ringCount = ct.t.locants.filter((l) => /a$/.test(l)).length / 2 + 1;
    return { info: { kind: 'template', template: ct.t, hydro: true, size: system.length, ringCount, ...base }, numberings };
  }
  return null;
}

/** The saturated name of a heteromonocycle from its mancude one, where it has one: oxepine, oxepane. */
function saturatedName(name: string, nitrogen: boolean): string | null {
  if (/^(pyridine|pyrimidine|pyrazine|pyridazine|pyran|thiopyran|selenopyran|furan|thiophene|pyrrole)$/.test(name)) return null;
  const rules: [RegExp, string][] = [[/irine$/, 'iridine'], [/irene$/, 'irane'], [/ete$/, nitrogen ? 'etidine' : 'etane'], [/ole$/, nitrogen ? 'olidine' : 'olane'],
    [/epine$/, 'epane'], [/ocine$/, 'ocane'], [/onine$/, 'onane'], [/ecine$/, 'ecane'], [/inine$/, 'inane'], [/ine$/, nitrogen ? 'inane' : 'ane']];
  // Six-membered with only O or S: 1,4-dioxine, 1,4-dioxane.
  for (const [re, to] of rules) if (re.test(name)) return name.replace(re, to);
  return null;
}
const satCache = new Map<string, CompiledTemplate>();
function compiledWithSaturated(ct: CompiledTemplate, saturated: string): CompiledTemplate {
  const key = `${ct.t.name}|${saturated}`;
  let hit = satCache.get(key);
  if (!hit) { hit = { ...ct, t: { ...ct.t, saturated } }; satCache.set(key, hit); }
  return hit;
}

/** How a spiro union's name is built for one numbering of it. */
interface SpiroName { first: string; second: string; la: string; lb: string; hydro: AtomId[]; ih: AtomId[] }
const spiroOf = new WeakMap<Numbering, SpiroName>();

/**
 * A spiro union with a polycyclic component (P-24.5): spiro[cyclohexane-1,1'-indene],
 * 1,2-dihydrospiro[indole-3,4'-piperidine]. Components are cited in alphabetical
 * order, the first unprimed, the spiro atom as low as each allows. Two monocycles
 * are von Baeyer spiro names instead (spiro[4.5]decane).
 */
function spiroUnion(an: Analysis, system: AtomId[], base: { heteroN: boolean; heteroO: boolean; heteroS: boolean }) {
  const mol = an.mol;
  const inSys = new Set(system);
  const ringNb = (a: AtomId, within: Set<AtomId>) => mol.neighbours(a).filter((n) => within.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id));
  // A spiro atom: removing it leaves the ring system in two pieces.
  for (const sp of system) {
    if (ringNb(sp, inSys).length !== 4) continue;
    const rest = system.filter((a) => a !== sp);
    const restSet = new Set(rest);
    const parts: AtomId[][] = [];
    const seen = new Set<AtomId>();
    for (const s0 of rest) {
      if (seen.has(s0)) continue;
      const comp: AtomId[] = [];
      const stack = [s0]; seen.add(s0);
      while (stack.length) { const x = stack.pop()!; comp.push(x); for (const y of ringNb(x, restSet)) if (!seen.has(y)) { seen.add(y); stack.push(y); } }
      parts.push(comp);
    }
    if (parts.length !== 2) continue;
    const blocks = parts.map((p) => [...p, sp]);
    const ringsIn = (b: AtomId[]) => { const set = new Set(b); return b.reduce((n, a) => n + ringNb(a, set).length, 0) / 2 - b.length + 1; };
    if (blocks.every((b) => ringsIn(b) === 1)) return null; // spiro[4.5]decane
    const named = blocks.map((b) => ({ atoms: b, r: recognizeRing(an, b) }));
    if (named.some((x) => !x.r || x.r.info.kind === 'spiro')) return null;
    if ([...mol.bonds()].some((b) => b.order === 3 && an.ringBonds.has(b.id) && system.includes(b.begin))) return null;
    const nameOf = (x: (typeof named)[number], nb: Numbering): string => {
      const info = x.r!.info;
      const set = new Set(x.atoms);
      const dbl: string[] = [];
      for (const b of mol.bonds()) if (set.has(b.begin) && set.has(b.end) && an.ringBonds.has(b.id) && b.order === 2) {
        const p = locVal(nb.get(b.begin)!), q = locVal(nb.get(b.end)!);
        dbl.push(info.kind === 'vonbaeyer' && Math.abs(p - q) !== 1 ? `${Math.min(p, q)}(${Math.max(p, q)})` : String(info.kind === 'cyclo' && Math.abs(p - q) > 1 ? Math.max(p, q) : Math.min(p, q)));
      }
      dbl.sort(compareLocant);
      const enes = (stem: string) => (dbl.length ? `${stem}${multiplier(dbl.length) ? 'a' : ''}-${dbl.join(',')}-${multiplier(dbl.length)}ene` : `${stem}ane`);
      if (info.kind === 'template') return info.template!.name;
      if (info.kind === 'cyclo') return enes(`cyclo${alkaneStem(info.size)}`);
      return enes(`${heteroPrefix(mol, x.atoms, nb)}${info.bracket}${alkaneStem(info.size)}`);
    };
    const letters = (t: string) => t.replace(/[^a-z]/g, '');
    const numberings: Numbering[] = [];
    let bestKey: number[] | null = null;
    for (const nA of named[0]!.r!.numberings) for (const nB of named[1]!.r!.numberings) {
      const [A, B] = [{ x: named[0]!, n: nA }, { x: named[1]!, n: nB }];
      const [first, second] = letters(nameOf(A.x, A.n)) <= letters(nameOf(B.x, B.n)) ? [A, B] : [B, A];
      const la = first.n.get(sp)!, lb = second.n.get(sp)!;
      const key = [locVal(la), locVal(lb)];
      if (bestKey && cmpVec(key, bestKey) > 0) continue;
      if (!bestKey || cmpVec(key, bestKey) < 0) { bestKey = key; numberings.length = 0; }
      const combined: Numbering = new Map();
      for (const a of first.x.atoms) combined.set(a, first.n.get(a)!);
      for (const a of second.x.atoms) if (a !== sp) combined.set(a, `${second.n.get(a)!}'`);
      const hydro: AtomId[] = [], ih: AtomId[] = [];
      for (const part of [first, second]) {
        const h = hydroOf.get(part.n);
        if (!h) continue;
        // The spiro atom is saturated by the union itself, so it is cited in neither.
        hydro.push(...h.hydro.filter((a) => a !== sp));
        ih.push(...h.ih.filter((a) => a !== sp));
      }
      spiroOf.set(combined, { first: nameOf(first.x, first.n), second: nameOf(second.x, second.n), la, lb, hydro, ih });
      numberings.push(combined);
    }
    // Hydro prefixes come in pairs: drop readings where leaving out the spiro atom left one unpaired.
    const ok = numberings.filter((nb) => spiroOf.get(nb)!.hydro.length % 2 === 0);
    if (!ok.length) return null;
    const ringCount = blocks.reduce((n, b) => n + ringsIn(b), 0);
    return { info: { kind: 'spiro' as const, size: system.length, ringCount, ...base }, numberings: ok };
  }
  return null;
}

/** "2',3'-dihydrospiro[cyclohexane-1,1'-indene]" for one numbering of a spiro union. */
function spiroText(numbering: Numbering): string {
  const s = spiroOf.get(numbering)!;
  const loc = (a: AtomId) => numbering.get(a)!;
  const hy = s.hydro.length ? `${s.hydro.map(loc).sort(compareLocant).join(',')}-${multiplier(s.hydro.length)}hydro` : '';
  const ih = s.ih.length ? `${s.ih.map(loc).sort(compareLocant).map((l) => `${l}H`).join(',')}-` : '';
  return `${hy}${hy && ih ? '-' : ''}${ih}spiro[${s.first}-${s.la},${s.lb}'-${s.second}]`;
}

const HW_PRIORITY = ['O', 'S', 'Se', 'Te', 'N', 'P', 'As', 'Sb', 'Si', 'Ge', 'Sn', 'B'];
const HW_PREFIX: Record<string, string> = { O: 'oxa', S: 'thia', Se: 'selena', Te: 'tellura', N: 'aza', P: 'phospha', As: 'arsa', Sb: 'stiba', Si: 'sila', Ge: 'germa', Sn: 'stanna', B: 'bora' };
const hwCache = new Map<string, CompiledTemplate>();

/**
 * The mancude Hantzsch-Widman parent of a heteromonocycle of 3 to 10 atoms
 * (P-22.2.2): 1,3,2-dioxathiole, 1,4-dithiepine. Numbered from the senior
 * heteroatom (O > S > Se > N > P > Si > B), heteroatoms as low as possible.
 */
function hantzschWidman(an: Analysis, system: AtomId[]): CompiledTemplate | null {
  const mol = an.mol;
  const n = system.length;
  if (n < 3 || n > 10) return null;
  const els = system.map((a) => el(mol, a));
  if (els.some((e) => e !== 'C' && !HW_PREFIX[e]) || els.every((e) => e === 'C')) return null;
  // Cyclic order.
  const inSys = new Set(system);
  const cyc: AtomId[] = [system[0]!];
  while (cyc.length < n) {
    const last = cyc[cyc.length - 1]!;
    const next = mol.neighbours(last).find((x) => inSys.has(x) && !cyc.includes(x));
    if (next === undefined) return null;
    cyc.push(next);
  }
  const senior = HW_PRIORITY.find((e) => els.includes(e))!;
  let best: { order: string[]; key: number[] } | null = null;
  for (let s0 = 0; s0 < n; s0++) for (const dir of [1, -1]) {
    const order = cyc.map((_, i) => el(mol, cyc[(s0 + dir * i + 2 * n) % n]!));
    if (order[0] !== senior) continue;
    const hetero = order.map((e, i) => (e === 'C' ? 0 : i + 1)).filter(Boolean);
    const byPriority = HW_PRIORITY.flatMap((p) => order.map((e, i) => (e === p ? i + 1 : 0)).filter(Boolean));
    const key = [...hetero, ...byPriority];
    if (!best || cmpVec(key, best.key) < 0) best = { order, key };
  }
  const order = best!.order;
  const names = (() => {
    const cited = HW_PRIORITY.filter((e) => order.includes(e));
    const locs = cited.flatMap((e) => order.map((x, i) => (x === e ? String(i + 1) : '')).filter(Boolean));
    // The a of a prefix goes before a vowel: dithiazocane, dioxazaborocane.
    // So does the a of tetra, penta: 1,2,4,6-tetrazepine, 1,2,4,5-tetroxane.
    const prefix = cited.map((e) => `${multiplier(order.filter((x) => x === e).length)}${HW_PREFIX[e]}`.replace(/^(tetr|pent|hex|hept)a([aeiou])/, '$1$2')).reduce((acc, p) => (acc && /a$/.test(acc) && /^[aeiou]/.test(p) ? acc.slice(0, -1) : acc) + p, '');
    const last = cited[cited.length - 1]!;
    const stem = n === 3 ? (last === 'N' ? 'irine' : 'irene') : n === 4 ? 'ete' : n === 5 ? 'ole'
      : n === 6 ? (['B', 'P'].includes(last) ? 'inine' : 'ine') : n === 7 ? 'epine' : n === 8 ? 'ocine' : n === 9 ? 'onine' : 'ecine';
    const satStem = n === 3 ? (last === 'N' ? 'iridine' : 'irane') : n === 4 ? (last === 'N' ? 'etidine' : 'etane') : n === 5 ? (last === 'N' ? 'olidine' : 'olane')
      : n === 6 ? (['O', 'S', 'Se'].includes(last) ? 'ane' : 'inane') : n === 7 ? 'epane' : n === 8 ? 'ocane' : n === 9 ? 'onane' : 'ecane';
    const join = (st: string) => (/[aeiou]$/.test(prefix) && /^[aeiou]/.test(st) ? prefix.slice(0, -1) + st : prefix + st);
    // One heteroatom is at 1 and needs no locant: thiocane, azocine.
    const lead = locs.length > 1 ? `${locs.join(',')}-` : '';
    return [`${lead}${join(stem)}`, `${lead}${join(satStem)}`];
  })();
  // A six-membered ring with one O, S or Se is pyran, thiopyran or selenopyran (P-22.2.2.1.4);
  // "oxine" is not read as one.
  const pyran = n === 6 && order.filter((e) => e !== 'C').length === 1 ? ({ O: 'pyran', S: 'thiopyran', Se: 'selenopyran' } as Record<string, string>)[senior] : undefined;
  const [name, saturated] = pyran ? [pyran, undefined] : names;
  const hit = hwCache.get(name!);
  if (hit) return hit;
  const bonds: [number, number][] = order.map((_, i) => [i, (i + 1) % n] as [number, number]);
  const ct = compile({ name: name!, yl: name!.replace(/e$/, ''), saturated, smiles: '', aromatic: true, mancude: true, skeleton: { elements: order, bonds }, locants: order.map((_, i) => String(i + 1)) });
  hwCache.set(name!, ct);
  return ct;
}

/** The bridge prefix of a bridged fused parent for one numbering of it: "4,7-methano". */
const bridgeOf = new WeakMap<Numbering, string>();

/**
 * A fused parent with one or two bridges across it (P-25.4): octahydro-1H-4,7-methanoindene,
 * 3a,4,7,7a-tetrahydro-4,7-epoxyisobenzofuran, ...-4,12-methanobenzofuro[3,2-e]isoquinoline.
 * The bridge is one or two atoms (methano, ethano, epoxy, epithio); what is left must be a fused
 * system with a name. Bridgeheads take locants as low as they go; bridge atoms are numbered on from
 * the fused system's highest locant, starting beside the higher-numbered bridgehead.
 */
function bridgedFused(an: Analysis, system: AtomId[], ketoneSuffix: boolean | 'imine'): { info: RingInfo; numberings: Numbering[] } | null {
  const mol = an.mol;
  const inSys = new Set(system);
  const ringNb = (a: AtomId, within: Set<AtomId>) => mol.neighbours(a).filter((n) => within.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id));
  const NAMES: Record<string, string> = { C: 'methano', O: 'epoxy', S: 'epithio', CC: 'ethano' };
  const candidates: AtomId[][] = [];
  for (const a of system) {
    if (ringNb(a, inSys).length !== 2 || !['C', 'O', 'S'].includes(el(mol, a))) continue;
    candidates.push([a]);
    for (const b of ringNb(a, inSys)) if (b > a && el(mol, a) === 'C' && el(mol, b) === 'C' && ringNb(b, inSys).length === 2) candidates.push([a, b]);
  }
  const tryBridges = (bridges: AtomId[][]) => {
    const drop = new Set(bridges.flat());
    if (bridges.some((br) => br.some((x) => mol.incidentBonds(x).some((bd) => mol.bond(bd).order !== 1 && inSys.has(mol.otherAtom(mol.bond(bd), x)))))) return null;
    const rest = system.filter((x) => !drop.has(x));
    const restSet = new Set(rest);
    if (rest.some((x) => ringNb(x, restSet).length < 2)) return null;
    // Still one ring system, and a fused one (two rings or more).
    const seen = new Set([rest[0]!]), st = [rest[0]!];
    while (st.length) { const x = st.pop()!; for (const y of ringNb(x, restSet)) if (!seen.has(y)) { seen.add(y); st.push(y); } }
    if (seen.size !== rest.length) return null;
    const edges = rest.reduce((n, x) => n + ringNb(x, restSet).length, 0) / 2;
    if (edges - rest.length + 1 < 2) return null;
    const heads = bridges.map((br) => [br[0]!, br[br.length - 1]!].map((e, i) => ringNb(e, inSys).find((y) => restSet.has(y) && (br.length > 1 || i === 0 || y !== ringNb(e, inSys).find((z) => restSet.has(z))))!));
    if (heads.some((h) => h.some((x) => x === undefined) || h[0] === h[1])) return null;
    const subAn: Analysis = { ...an, ringSystems: an.ringSystems };
    const fused = hydroParent(subAn, rest, ketoneSuffix);
    if (!fused || fused.info.kind !== 'template') return null;
    const locNum = (l: string) => Number(/^\d+/.exec(l)![0]);
    // Lowest bridgehead locants first.
    const key = (n: Numbering) => heads.flat().map((x) => locVal(n.get(x)!)).sort((x, y) => x - y);
    let best: number[] | null = null;
    const keep: Numbering[] = [];
    for (const n of fused.numberings) {
      const k = key(n);
      const c = best ? cmpVec(k, best) : -1;
      if (c < 0) { best = k; keep.length = 0; }
      if (c <= 0) keep.push(n);
    }
    const out: Numbering[] = [];
    for (const n of keep) {
      const top = Math.max(...[...n.values()].map(locNum));
      const m = new Map(n);
      let next = top + 1;
      const order = bridges.map((br, i) => ({ br, heads: heads[i]! })).sort((x, y) => Math.max(...y.heads.map((h) => locVal(n.get(h)!))) - Math.max(...x.heads.map((h) => locVal(n.get(h)!))));
      const parts: string[] = [];
      for (const { br, heads: hd } of order) {
        // Start beside the higher-numbered bridgehead.
        const hiHead = locVal(n.get(hd[0]!)!) > locVal(n.get(hd[1]!)!) ? 0 : 1;
        const atoms = hiHead === 0 ? br : [...br].reverse();
        for (const x of atoms) m.set(x, String(next++));
        const word = NAMES[br.map((x) => el(mol, x)).join('')];
        if (!word) return null;
        parts.push(`${hd.map((h) => n.get(h)!).sort(compareLocant).join(',')}-${word}`);
      }
      hydroOf.set(m, hydroOf.get(n)!);
      bridgeOf.set(m, parts.sort().join(':') + (parts.length > 1 ? '' : ''));
      out.push(m);
    }
    if (!out.length) return null;
    // Two bridges of one kind: 1,4:5,8-dimethano.
    if (bridges.length === 2) for (const m of out) {
      const ws = bridgeOf.get(m)!.split(':').map((w) => { const k = w.lastIndexOf('-'); return [w.slice(0, k), w.slice(k + 1)] as const; });
      if (ws[0]![1] !== ws[1]![1]) return null;
      ws.sort((x, y) => compareLocant(x[0].split(',')[0]!, y[0].split(',')[0]!));
      bridgeOf.set(m, `${ws.map((w) => w[0]).join(':')}-di${ws[0]![1]}`);
    }
    return { info: { ...fused.info, size: system.length, ringCount: fused.info.ringCount + bridges.length }, numberings: out };
  };
  // The largest fused system, then the shortest bridge: 4,7-methanoindene, not 1,3-ethanopentalene.
  let best: { r: { info: RingInfo; numberings: Numbering[] }; size: number; bridge: number } | null = null;
  for (const c of candidates) {
    const r = tryBridges([c]);
    if (r && (!best || system.length - c.length > best.size || (system.length - c.length === best.size && c.length < best.bridge))) best = { r, size: system.length - c.length, bridge: c.length };
  }
  if (best) return best.r;
  // Two bridges where one does not do: 1,4:5,8-dimethanonaphthalene.
  for (let i = 0; i < candidates.length; i++) for (let j = i + 1; j < candidates.length; j++) {
    const a = candidates[i]!, b = candidates[j]!;
    if (a.length !== 1 || b.length !== 1 || a.some((x) => b.includes(x)) || mol.bondBetween(a[0]!, b[0]!)) continue;
    const r = tryBridges([a, b]);
    if (r && (!best || system.length - 2 > best.size)) best = { r, size: system.length - 2, bridge: 2 };
  }
  return best?.r ?? null;
}

/** `ketoneSuffix`: a ring C=O is the principal ketone, so its hydrogen is described as for pyridin-2(1H)-one. */
function recognizeRing(an: Analysis, system: AtomId[], ketoneSuffix: boolean | 'imine' = false): { info: RingInfo; numberings: Numbering[] } | null {
  const mol = an.mol;
  const hetero = (e: string) => system.some((a) => el(mol, a) === e);
  const base = { heteroN: hetero('N'), heteroO: hetero('O'), heteroS: hetero('S') };
  const ringCount = (t: RingTemplate) => t.locants.filter((l) => /a$/.test(l)).length / 2 + 1;
  // A hand-written hydro parent (1,4-dihydropyridine) is only its mancude parent with hydro
  // prefixes, so a ketone on it is named from that parent: pyridin-4(1H)-one.
  const ringKetone = ketoneSuffix && system.some((a) => mol.incidentBonds(a).some((b) => {
    const bd = mol.bond(b), o = mol.otherAtom(bd, a);
    return bd.order === 2 && el(mol, o) === (ketoneSuffix === 'imine' ? 'N' : 'O') && !system.includes(o);
  }));
  for (const ct of templates()) {
    // Fully saturated too (tetrahydrofuran): dihydrofuran-2(3H)-one, tetrahydro-2H-pyran-2-one.
    if (ringKetone && ct.t.name.includes('hydro')) continue;
    const n = matchTemplate(an, system, ct);
    if (n.length) return { info: { kind: 'template', template: ct.t, size: system.length, ringCount: ringCount(ct.t), ...base }, numberings: n };
  }
  const hydro = hydroParent(an, system, ketoneSuffix);
  if (hydro) return hydro;
  const bridged = bridgedFused(an, system, ketoneSuffix);
  if (bridged) return bridged;
  // A single ring: a cycloalkane or cycloalkene, or (too large for a Hantzsch-Widman name, as a
  // macrolide or a crown ether is) the same with its heteroatoms as replacement prefixes:
  // 1-oxacyclotetradecane, 1,4,7,10-tetraoxacyclododecane.
  const inSys = new Set(system);
  const ringNbrs = (a: AtomId) => mol.neighbours(a).filter((n) => inSys.has(n));
  if (system.every((a) => (el(mol, a) === 'C' || HW_PREFIX[el(mol, a)] !== undefined) && ringNbrs(a).length === 2)) {
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
  const vb = spiroUnion(an, system, base) ?? vonBaeyer(an, system, base);
  if (vb?.info.kind === 'vonbaeyer' && !RING_ROWS.length && fusedParentAwaited(an, system, vb.info.bracket!)) {
    throw new OutOfScope('fused ring system whose parent is in the generated ring parents (@hexsketch/naming/rings), not yet added');
  }
  return vb;
}

/**
 * Until the generated parents are added, an ortho-fused system of five- and larger
 * rings is declined: it has a fusion name there (purine, 1,8-naphthyridine, 1H-indene),
 * which ChemDraw gives, rather than the von Baeyer name it would get now. Small rings
 * (bicyclo[4.2.0]octa-1,3,5-triene) and bridged systems keep their von Baeyer names.
 */
function fusedParentAwaited(an: Analysis, system: AtomId[], bracket: string): boolean {
  const mol = an.mol;
  if (!/cyclo\[\d+\.\d+\.0(\.0\^\{\d+,\d+\})*\]$/.test(bracket)) return false;
  const inSys = new Set(system);
  const fusable = system.every((a) => {
    const n = mol.neighbours(a).filter((x) => inSys.has(x) && an.ringBonds.has(mol.bondBetween(a, x)!.id)).length;
    const e = el(mol, a);
    return mol.atom(a).charge === 0 && (e === 'C' || (e === 'N' && n <= 3) || ((e === 'O' || e === 'S') && n === 2));
  });
  return fusable && perceiveRings(mol).every((r) => !r.atoms.some((a) => inSys.has(a)) || r.atoms.length >= 5);
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
  if (edges - system.length + 1 > 2) return polycyclic(an, system, base);
  if (edges - system.length + 1 !== 2) return null;
  if (system.some((a) => el(mol, a) !== 'C' && HW_PREFIX[el(mol, a)] === undefined)) return null;
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
    // Rings of one size may each come first: 1,5-dioxaspiro[5.5]undecane.
    for (const [a1, b1] of small.length === large.length ? [[small, large], [large, small]] : [[small, large]]) {
      for (const s1 of [a1!, [...a1!].reverse()]) for (const l1 of [b1!, [...b1!].reverse()]) add([...s1, sp, ...l1]);
    }
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

/**
 * Polycyclic von Baeyer names (P-23.2): tricyclo[5.2.1.0^{2,6}]decane. The main
 * ring is as large as possible, then the main bridge, the main ring is divided
 * as symmetrically as possible, and the superscript locants are as low as
 * possible; secondary bridges are numbered in decreasing size, each from the
 * end nearer the higher-numbered bridgehead. Spiro unions are not covered.
 */
function polycyclic(an: Analysis, system: AtomId[], base: { heteroN: boolean; heteroO: boolean; heteroS: boolean }) {
  const mol = an.mol;
  const inSys = new Set(system);
  const nb = (a: AtomId) => mol.neighbours(a).filter((n) => inSys.has(n) && an.ringBonds.has(mol.bondBetween(a, n)!.id));
  const n = system.length;
  if (n > 32 || system.some((a) => !['C', 'N', 'O', 'S', 'P', 'Si', 'B'].includes(el(mol, a)))) return null;
  const edgeKey = (x: AtomId, y: AtomId) => (x < y ? `${x}-${y}` : `${y}-${x}`);
  const allEdges = new Set<string>();
  for (const a of system) for (const b of nb(a)) allEdges.add(edgeKey(a, b));
  const rings = allEdges.size - n + 1;

  // Simple cycles of maximum length (the main ring candidates).
  const idx = new Map(system.map((a, i) => [a, i]));
  let best = 0;
  const mains: AtomId[][] = [];
  let budget = 200000;
  const dfs = (start: AtomId, path: AtomId[], seen: Set<AtomId>) => {
    if (--budget < 0) return;
    const cur = path[path.length - 1]!;
    for (const y of nb(cur)) {
      if (y === start && path.length >= 3) {
        if (idx.get(path[1]!)! > idx.get(cur)!) continue; // each cycle once
        if (path.length > best) { best = path.length; mains.length = 0; }
        if (path.length === best) mains.push([...path]);
        continue;
      }
      if (seen.has(y) || idx.get(y)! < idx.get(start)!) continue;
      seen.add(y); path.push(y);
      dfs(start, path, seen);
      path.pop(); seen.delete(y);
    }
  };
  for (const s0 of system) dfs(s0, [s0], new Set([s0]));
  if (budget < 0 || !mains.length) return null;

  interface Cand { order: AtomId[]; sizes: number[]; sups: [number, number][] }
  const cands: Cand[] = [];
  for (const main of mains) {
    const onRing = new Set(main);
    const pos = new Map(main.map((a, i) => [a, i]));
    const L = main.length;
    // Main bridge candidates: paths between two main-ring atoms through atoms off it.
    const bridges: { u: AtomId; v: AtomId; inner: AtomId[] }[] = [];
    for (const u of main) for (const x of nb(u)) {
      if (onRing.has(x)) {
        const d = Math.abs(pos.get(u)! - pos.get(x)!);
        if (d !== 1 && d !== L - 1 && pos.get(u)! < pos.get(x)!) bridges.push({ u, v: x, inner: [] });
        continue;
      }
      const walk = (path: AtomId[], seen: Set<AtomId>) => {
        const cur = path[path.length - 1]!;
        for (const y of nb(cur)) {
          if (seen.has(y)) continue;
          if (onRing.has(y)) { if (y !== u && path.length >= 1 && pos.get(u)! < pos.get(y)!) bridges.push({ u, v: y, inner: [...path] }); continue; }
          seen.add(y); path.push(y); walk(path, seen); path.pop(); seen.delete(y);
        }
      };
      walk([x], new Set([u, x]));
    }
    if (!bridges.length) continue;
    const maxB = Math.max(...bridges.map((b) => b.inner.length));
    for (const br of bridges.filter((b) => b.inner.length === maxB)) {
      const iu = pos.get(br.u)!, iv = pos.get(br.v)!;
      const segUp: AtomId[] = [], segDown: AtomId[] = [];
      for (let i = (iu + 1) % L; i !== iv; i = (i + 1) % L) segUp.push(main[i]!);
      for (let i = (iu - 1 + L) % L; i !== iv; i = (i - 1 + L) % L) segDown.push(main[i]!);
      for (const [b1, b2] of [[br.u, br.v], [br.v, br.u]] as const) {
        // From b1: the larger segment to b2, then the smaller one back.
        const fromB1Up = b1 === br.u ? segUp : [...segDown].reverse();
        const fromB1Down = b1 === br.u ? segDown : [...segUp].reverse();
        const options = fromB1Up.length === fromB1Down.length ? [[fromB1Up, fromB1Down], [fromB1Down, fromB1Up]] : fromB1Up.length > fromB1Down.length ? [[fromB1Up, fromB1Down]] : [[fromB1Down, fromB1Up]];
        for (const [big, small] of options) {
          const inner = b1 === br.u ? br.inner : [...br.inner].reverse();
          // small runs from b1 outward; walking back from b2 to b1 is its reverse.
          const order: AtomId[] = [b1, ...big!, b2, ...[...small!].reverse(), ...inner];
          const used = new Set<string>();
          for (let i = 0; i < L; i++) used.add(edgeKey(main[i]!, main[(i + 1) % L]!));
          const chain = [br.u, ...br.inner, br.v];
          for (let i = 0; i + 1 < chain.length; i++) used.add(edgeKey(chain[i]!, chain[i + 1]!));
          const sups: [number, number][] = [];
          const sizes = [big!.length, small!.length, inner.length];
          const numbered = new Map(order.map((a, i) => [a, i + 1]));
          let ok = true;
          // Main ring and main bridge: a secondary bridge between two of them is independent.
          const mainAtoms = numbered.size;
          while (used.size < allEdges.size) {
            // Secondary bridges: paths between numbered atoms through unnumbered ones. Independent
            // bridges are numbered before dependent ones, larger before smaller, and of equal ones
            // first the bridge to the higher-numbered bridgeheads (P-23.2.5.1; as OPSIN reads them:
            // 22 is the bridge between 13 and 16 in pentacyclo[16.2.1.1^{3,6}.1^{8,11}.1^{13,16}]tetracosane).
            let pick: { x: AtomId; y: AtomId; inner: AtomId[] } | null = null;
            const rank = (x: AtomId, y: AtomId, inner: AtomId[]) => {
              const lx = numbered.get(x)!, ly = numbered.get(y)!;
              return [lx <= mainAtoms && ly <= mainAtoms ? 1 : 0, inner.length, Math.max(lx, ly), Math.min(lx, ly)];
            };
            const better = (x: AtomId, y: AtomId, inner: AtomId[]) => !pick || cmpVec(rank(x, y, inner), rank(pick.x, pick.y, pick.inner)) > 0;
            for (const x of numbered.keys()) for (const z0 of nb(x)) {
              if (used.has(edgeKey(x, z0))) continue;
              if (numbered.has(z0)) {
                if (numbered.get(x)! < numbered.get(z0)! && better(x, z0, [])) pick = { x, y: z0, inner: [] };
                continue;
              }
              const walk = (path: AtomId[], seen: Set<AtomId>) => {
                const cur = path[path.length - 1]!;
                for (const y of nb(cur)) {
                  if (seen.has(y) || used.has(edgeKey(cur, y))) continue;
                  if (numbered.has(y)) { if (y !== x && better(x, y, path)) pick = { x, y, inner: [...path] }; continue; }
                  seen.add(y); path.push(y); walk(path, seen); path.pop(); seen.delete(y);
                }
              };
              walk([z0], new Set([x, z0]));
            }
            if (!pick) { ok = false; break; }
            const { x, y, inner: pin } = pick as { x: AtomId; y: AtomId; inner: AtomId[] };
            // Number from the end nearer the higher-numbered bridgehead.
            const fromHigh = numbered.get(x)! > numbered.get(y)! ? pin : [...pin].reverse();
            for (const a of fromHigh) numbered.set(a, numbered.size + 1);
            const path = [x, ...pin, y];
            for (let i = 0; i + 1 < path.length; i++) used.add(edgeKey(path[i]!, path[i + 1]!));
            const lx = numbered.get(x)!, ly = numbered.get(y)!;
            sups.push([Math.min(lx, ly), Math.max(lx, ly)]);
            sizes.push(pin.length);
          }
          if (!ok || numbered.size !== n) continue;
          cands.push({ order: [...numbered.entries()].sort((p, q) => p[1] - q[1]).map(([a]) => a), sizes, sups });
        }
      }
    }
  }
  if (!cands.length) return null;
  // Most symmetric division of the main ring, then the lowest superscripts.
  const asym = (c: Cand) => c.sizes[0]! - c.sizes[1]!;
  const minAsym = Math.min(...cands.map(asym));
  const sym = cands.filter((c) => asym(c) === minAsym);
  const supKey = (c: Cand) => c.sups.flat().sort((p, q) => p - q);
  sym.sort((p, q) => cmpVec(supKey(p), supKey(q)));
  const top = supKey(sym[0]!);
  const chosen = sym.filter((c) => cmpVec(supKey(c), top) === 0);
  const desc = (c: Cand) => {
    const parts = c.sizes.slice(0, 3).map(String);
    // Secondary bridges are cited by decreasing size, then by their bridgehead locants, whatever order they were numbered in.
    c.sups.map((sp, i) => [c.sizes[3 + i]!, sp[0], sp[1]] as const).sort((p, q) => q[0] - p[0] || p[1] - q[1] || p[2] - q[2])
      .forEach(([size, x, y]) => parts.push(`${size}^{${x},${y}}`));
    return `${multiplier(rings)}cyclo[${parts.join('.')}]`;
  };
  const bracket = desc(chosen[0]!);
  const numberings = chosen.filter((c) => desc(c) === bracket).map((c) => new Map(c.order.map((a, i) => [a, String(i + 1)])));
  return { info: { kind: 'vonbaeyer' as const, bracket, size: n, ringCount: rings, ...base }, numberings };
}

/** Replacement prefixes for heteroatoms in a von Baeyer/spiro parent: "1-oxa-8-aza". */
function heteroPrefix(mol: Molecule, atoms: AtomId[], numbering: Numbering, monocycle = false): string {
  const groups: [string, string][] = [['O', 'oxa'], ['S', 'thia'], ['Se', 'selena'], ['N', 'aza'], ['P', 'phospha'], ['Si', 'sila'], ['B', 'bora']];
  const parts: string[] = [];
  // A ring of one heteroatom needs no locant for it: oxacyclohexadecan-2-one.
  if (monocycle && atoms.filter((a) => el(mol, a) !== 'C').length === 1) {
    const g = groups.find(([e]) => atoms.some((a) => el(mol, a) === e));
    if (g) return g[1];
  }
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
    return { name: nameFragment(mol, frags[0]!).name };
  } catch (e) {
    if (e instanceof OutOfScope) return { name: null, reason: e.message };
    throw e;
  }
}

const ANIONS: Record<string, string> = { F: 'fluoride', Cl: 'chloride', Br: 'bromide', I: 'iodide' };
const ACID_SALT: Record<string, string> = { F: 'hydrofluoride', Cl: 'hydrochloride', Br: 'hydrobromide', I: 'hydroiodide' };

/**
 * A metal's bonds to a halogen, O, N or S read as ionic, and its hydrogens as
 * hydride: KOtBu drawn O-K, TiCl4, MeMgBr and DIBAL-H are named as the salts
 * chemists call them (titanium(IV) chloride, methylmagnesium bromide). Bonds
 * to carbon stay: they are what an organometallic is named by.
 */
export function ionize(input: Molecule): Molecule {
  if (![...input.atoms()].some((a) => a.label === null && isMetal(a.element))) return input.clone();
  const mol = input.clone();
  // An ion with a name of its own is left whole: permanganate, chlorochromate, aluminum hydride.
  const whole = new Set(input.fragments().filter((f) => f.every((a) => input.atom(a).label === null) && speciesName(input, f)).flat());
  for (const b of [...mol.bonds()]) {
    const [p, q] = [mol.atom(b.begin), mol.atom(b.end)];
    if (p.label !== null || q.label !== null || whole.has(p.id)) continue;
    const metal = isMetal(p.element) && !isMetal(q.element) ? p : isMetal(q.element) && !isMetal(p.element) ? q : null;
    if (!metal || b.order !== 1) continue;
    const other = metal === p ? q : p;
    if (!['O', 'N', 'S', 'F', 'Cl', 'Br', 'I'].includes(other.element)) continue;
    mol.removeBond(b.id);
    metal.charge += 1;
    other.charge -= 1;
  }
  for (const m of [...mol.atoms()]) {
    if (m.label !== null || !isMetal(m.element) || !m.explicitHydrogens || whole.has(m.id)) continue;
    for (let i = 0; i < m.explicitHydrogens; i++) mol.addAtom({ element: 'H', x: m.x, y: m.y, charge: -1, explicitHydrogens: 0 });
    m.charge += m.explicitHydrogens;
    m.explicitHydrogens = 0;
  }
  return mol;
}

interface Ion { name: string; charge: number; /** Named as a simple ion (sodium, chloride, carbonate), not built as an organic name. */ simple?: boolean; atoms?: number }

/** One structure of a drawing: a simple ion or small molecule by its own name, else named in full. */
function nameFragment(mol: Molecule, frag: AtomId[]): Ion {
  const charge = frag.reduce((t, a) => t + mol.atom(a).charge, 0);
  const simple = simpleIon(mol, frag);
  if (simple) return { ...simple, simple: true, atoms: frag.length };
  return { name: nameOne(frag.length === mol.atomCount ? mol : subMolecule(mol, frag)), charge };
}

/** Single-atom ions, small molecules and the inorganic ions of common salts. */
function simpleIon(mol: Molecule, frag: AtomId[]): Ion | null {
  if (frag.length === 1) {
    const a = mol.atom(frag[0]!);
    if (a.label !== null) return null;
    // A labelled or radical ion is not the plain one: it is left to the checks below, which decline it.
    if (a.isotope !== null || a.radical) return null;
    if (isMetal(a.element) && a.charge >= 0 && !a.radical && a.isotope === null) return { name: a.charge ? metalCation(a.element, a.charge) : metalName(a.element), charge: a.charge };
    if (ANIONS[a.element] && a.charge === -1) return { name: ANIONS[a.element]!, charge: -1 };
    if (a.element === 'N' && a.charge === 1 && mol.implicitHydrogens(a.id) === 4) return { name: 'ammonium', charge: 1 };
    if (a.element === 'O' && a.charge === -1 && mol.implicitHydrogens(a.id) === 1) return { name: 'hydroxide', charge: -1 };
  }
  if (frag.some((a) => mol.atom(a).label !== null)) return null;
  return speciesName(mol, frag);
}

/**
 * Salts and mixtures: cations then anions (sodium carbonate, methylmagnesium
 * bromide), acid-addition salts (amine hydrochloride) and hydrates; anything
 * else is listed structure by structure.
 */
function nameMixture(mol: Molecule, frags: AtomId[][]): string {
  const ions: Ion[] = [];
  const neutral: string[] = [];
  const acids: string[] = [];
  let waters = 0;
  for (const f of frags) {
    const only = f.length === 1 ? mol.atom(f[0]!) : null;
    if (only && only.label === null && ACID_SALT[only.element] && only.charge === 0 && only.isotope === null) { acids.push(ACID_SALT[only.element]!); continue; }
    if (only && only.label === null && only.element === 'O' && only.charge === 0 && only.isotope === null && !only.radical && mol.implicitHydrogens(only.id) === 2) { waters++; continue; }
    const part = nameFragment(mol, f);
    // A zwitterion is neutral overall and named as a compound.
    if (part.charge !== 0) ions.push(part); else neutral.push(part.name);
  }
  const parts: string[] = [];
  if (ions.length) {
    // A composition name says what is there: cations and anions whose charges do not balance
    // (4 acetate with Pb2+, PdCl4 2- named as palladium(II) chloride) have none.
    const cations = ions.filter((i) => i.charge > 0), anions = ions.filter((i) => i.charge < 0);
    // Ions of one sign alone are listed as drawn, but a bare metal name ("cadmium") says nothing of its charge.
    if (ions.reduce((t, i) => t + i.charge, 0) !== 0) {
      if ((cations.length && anions.length) || cations.some((i) => i.simple && i.atoms === 1 && !i.name.includes('('))) throw new OutOfScope('charges do not balance');
      // Not a salt: each ion is listed, as each neutral structure is.
      parts.push(...ions.map((i) => i.name));
      ions.length = 0;
    }
  }
  if (ions.length) {
    const cations = ions.filter((i) => i.charge > 0), anions = ions.filter((i) => i.charge < 0);
    const kinds = (list: Ion[]) => { const c = new Map<string, number>(); for (const i of list) c.set(i.name, (c.get(i.name) ?? 0) + 1); return [...c]; };
    const ck = kinds(cations), ak = kinds(anions);
    // Beside other components the salt's own count matters: three AlH3 and a manganese atom are
    // not "aluminum hydride · manganese". Its name is for one formula unit.
    const gcd = (x: number, y: number): number => (y ? gcd(y, x % y) : x);
    if ((neutral.length || acids.length || waters) && [...ck, ...ak].reduce((g, [, n]) => gcd(g, n), 0) > 1) throw new OutOfScope('salt of several formula units beside other components');
    // A polyatomic anion is multiplied with bis, tris: bis(phosphate), as diphosphate is P2O7 4-.
    // So is one whose name starts with a multiplier (bis(tetrafluoroborate)); nitrate or thiocyanate takes di.
    const polyatomic = new Set(anions.filter((i) => i.simple && (i.atoms ?? 1) > 1 && (i.charge <= -2 || /^(di|tri|tetra|hexa)/.test(i.name))).map((i) => i.name));
    // One cation with one anion needs no count, their charges say it: sodium carbonate, calcium chloride,
    // sodium malonate. Counts are kept when there are several kinds.
    const several = ck.length > 1 || ak.length > 1;
    // (With several kinds the counts are kept: without them the formula would be lost.)
    const countCations = several, countAnions = several;
    const group = (list: [string, number][], counted: boolean) => list.map(([name, n]) => `${counted && n > 1 ? (/[ (\d]/.test(name) || polyatomic.has(name) ? `${complexMultiplier(n)}(${name})` : multiplier(n) + name) : name}`).join(' ');
    parts.push([group(ck, countCations), group(ak, countAnions)].filter(Boolean).join(' '));
  }
  if (acids.length === 1 && neutral.length === 1 && !ions.length) parts.push(`${neutral[0]} ${acids[0]}`);
  else { parts.push(...neutral); parts.push(...acids.map((a) => a.replace(/^hydro/, 'hydrogen '))); }
  let name = parts.join(' · ');
  if (waters) name = name ? `${name} ${waters > 1 ? multiplier(waters) : ''}hydrate` : waters > 1 ? `${multiplier(waters)}water` : 'water';
  return name;
}

function subMolecule(mol: Molecule, atoms: AtomId[]): Molecule {
  const copy = mol.clone();
  const keep = new Set(atoms);
  for (const a of [...copy.atoms()]) if (!keep.has(a.id)) copy.removeAtom(a.id);
  return copy;
}

const SUPPORTED = new Set(['C', 'H', 'N', 'O', 'S', 'F', 'Cl', 'Br', 'I', 'Si', 'Sn', 'B', 'P', 'Se', 'Te', 'As', 'Sb', 'Ge', 'Pb']);

/** A peptide written as a label ("H-Ala-Gly-OH" on a lone atom) or drawn out in full. */
function peptideOf(mol: Molecule): Peptide | null {
  if (mol.atomCount === 1) {
    const a = [...mol.atoms()][0]!;
    return a.label ? parsePeptide(a.label) : null;
  }
  if (mol.atomCount < 5) return null;
  try { return recognisePeptide(mol); } catch { return null; }
}

/**
 * An oligonucleotide (two units or more, in the natural configuration) written as a label or
 * drawn out: it goes by its sequence, as a peptide too long for a name does.
 */
function oligoOf(mol: Molecule): Oligo | null {
  if (mol.atomCount === 1) {
    const a = [...mol.atoms()][0]!;
    return a.label ? parseOligo(a.label) : null;
  }
  if (mol.atomCount < 30 || ![...mol.atoms()].some((a) => a.element === 'P')) return null;
  try {
    const o = recogniseOligo(mol);
    if (!o || o.units.length < 2) return null;
    // A drawing shows its configuration by its wedges; a SMILES carries it.
    const drawn = fromGeometry && [...mol.atoms()].some((a) => a.x !== 0 || a.y !== 0);
    return sameStereoisomer(parseSmiles(oligoSmiles(o)), mol, { recorded: [true, !drawn] }) ? o : null;
  } catch { return null; }
}

/**
 * Every hydrogen deuterium and nothing else labelled (a deuterated solvent): the compound's own
 * name with "-d" and their number, as ChemDraw writes it: benzene-d6, chloroform-d, methanol-d4.
 * Null when the structure is not that. Other deuterium labelling has no name here yet.
 */
function perdeuterated(input: Molecule): string | null {
  const atoms = [...input.atoms()];
  const ds = new Set(atoms.filter((a) => a.element === 'H' && a.isotope === 2 && a.charge === 0 && input.neighbours(a.id).length === 1).map((a) => a.id));
  if (!ds.size) return null;
  if (atoms.some((a) => !ds.has(a.id) && (a.isotope !== null || a.element === 'H' || input.implicitHydrogens(a.id) > 0))) return null;
  const plain = input.clone();
  for (const a of plain.atoms()) if (a.element === 'H' && a.isotope === 2) a.isotope = null;
  // Heavy water and the like are named whole, as water is.
  foldHydrogens(plain);
  const whole = speciesName(plain, [...plain.atoms()].map((a) => a.id));
  if (whole?.name === 'dihydrogen') return 'dideuterium';
  const name = whole && whole.charge === 0 ? whole.name : nameOne(plain);
  // On a name with brackets or a locant in front, the "-d" would not say plainly what it belongs to.
  if (!/^[a-z][a-z0-9, -]*$/i.test(name)) throw new OutOfScope('isotopic labelling');
  const d = (n: number) => `d${n > 1 ? n : ''}`;
  // Deuterium on carbon and on oxygen said apart where the name has a place for each: methan-d3-ol-d, acetic-d3 acid-d.
  const onO = [...ds].filter((x) => input.atom(input.neighbours(x)[0]!).element !== 'C').length, onC = ds.size - onO;
  if (onO && onC) {
    if (/ic acid$/.test(name)) return name.replace(/ic acid$/, `ic-${d(onC)} acid-${d(onO)}`);
    if (/an-?\d*-?ol$|anol$/.test(name) && !/\d/.test(name)) return name.replace(/ol$/, '').replace(/-$/, '') + `-${d(onC)}-ol-${d(onO)}`;
  }
  return `${name}-${d(ds.size)}`;
}

/** A halogen substituent carrying an isotope label (a radiotracer's 18F or 125I), written (18F)fluoro. */
const labelledHalogen = (mol: Molecule, a: { id: AtomId; element: string; isotope: number | null; charge: number }) =>
  a.isotope !== null && HALO[a.element] !== undefined && a.charge === 0 && mol.neighbours(a.id).length === 1 && mol.atom(mol.neighbours(a.id)[0]!).element === 'C';

function nameOne(input: Molecule): string {
  const deuterated = perdeuterated(input);
  if (deuterated) return deuterated;
  // Oligonucleotides and peptides are named in full where a name can be made (residues by name:
  // L-alanylglycine, (tert-butoxycarbonyl)-L-alanine), else by their sequence.
  const oligo = oligoOf(input);
  // Three units or more go by their sequence: a systematic name would run to hundreds of characters.
  if (oligo && oligo.units.length >= 3) return oligoText(oligo);
  const pep = oligo ? null : peptideOf(input);
  // A sequence written as a label is named as the structure it stands for.
  if (input.atomCount === 1 && oligo) { try { return nameOne(parseSmiles(oligoSmiles(oligo))); } catch { return oligoText(oligo); } }
  if (input.atomCount === 1 && pep) { try { return nameOne(peptideMolecule(pep)); } catch { return peptideName(pep) ?? peptideText(pep); } }
  const ox = oximeName(input);
  if (ox) return ox;
  try { return nameOneSystematic(input); } catch (e) {
    if (!(e instanceof OutOfScope)) throw e;
    if (oligo) return oligoText(oligo);
    if (pep && !pep.residues.some((r) => r.stereoUnknown)) return peptideName(pep) ?? peptideText(pep);
    throw e;
  }
}

/**
 * An oxime of a ketone or aldehyde that would be the principal group, named on it: propan-2-one oxime,
 * (E)-benzaldehyde O-methyl oxime, (Z)-1-phenylethan-1-one O-(6-fluoropyridin-2-yl) oxime. Null otherwise.
 */
function oximeName(input: Molecule): string | null {
  const mol = input.clone();
  foldHydrogens(mol);
  if ([...mol.atoms()].some((a) => a.x !== 0 || a.y !== 0) && fromGeometry) perceiveStereoFromGeometry(mol);
  const rings = perceiveRings(mol);
  const inRing = new Set(rings.flatMap((r) => r.atoms));
  const found: { c: AtomId; n: AtomId; o: AtomId; r: AtomId | null; bond: number }[] = [];
  for (const b of mol.bonds()) {
    if (b.order !== 2) continue;
    const [c, n] = el(mol, b.begin) === 'C' ? [b.begin, b.end] : [b.end, b.begin];
    if (el(mol, c) !== 'C' || el(mol, n) !== 'N' || mol.atom(n).charge || inRing.has(n)) continue;
    const o = mol.neighbours(n).find((x) => x !== c);
    if (o === undefined || mol.neighbours(n).length !== 2 || el(mol, o) !== 'O' || mol.atom(o).charge || inRing.has(o)) continue;
    const beyond = mol.neighbours(o).filter((x) => x !== n);
    if (beyond.length > 1) continue;
    found.push({ c, n, o, r: beyond[0] ?? null, bond: b.id });
  }
  if (found.length !== 1) return null;
  const { c, n, o, r, bond } = found[0]!;
  // The O-substituent must hang off the oxygen alone (no ring back into the rest).
  if (r !== null) {
    const seen = new Set<AtomId>([o]), stack = [r];
    while (stack.length) { const x = stack.pop()!; if (x === n || x === c) return null; if (seen.has(x)) continue; seen.add(x); stack.push(...mol.neighbours(x).filter((y) => !seen.has(y))); }
  }
  const ez = ezLabel(mol, bond);
  const carbonyl = mol.clone();
  if (r !== null) {
    const seen = new Set<AtomId>([o]), stack = [r];
    while (stack.length) { const x = stack.pop()!; if (seen.has(x)) continue; seen.add(x); stack.push(...carbonyl.neighbours(x).filter((y) => !seen.has(y))); }
    for (const x of seen) if (x !== o) carbonyl.removeAtom(x);
  }
  carbonyl.removeAtom(o);
  const atom = carbonyl.atom(n);
  atom.element = 'O';
  atom.explicitHydrogens = 0;
  for (const bd of carbonyl.bonds()) if ((bd.begin === c || bd.end === c) && bd.ez) bd.ez = null;
  const an = analyze(carbonyl);
  const top = SENIORITY.find((k) => an.groups.some((g) => g.kind === k));
  if ((top !== 'ketone' && top !== 'aldehyde') || an.groups.filter((g) => g.kind === top).length !== 1 || an.groups.find((g) => g.kind === top)!.anchor !== c) return null;
  let base: string;
  noWholeRetained = true;
  try { base = nameOneSystematic(carbonyl); } catch (e) { if (e instanceof OutOfScope) return null; throw e; } finally { noWholeRetained = false; }
  // Configurations of its own would have to be merged with the oxime's.
  if (ez && /\((?:\d+[a-z]?'*)?[RSEZrs](?:,[^)]*)?\)/.test(base)) return null;
  let tail = ' oxime';
  if (r !== null) {
    const sub = nameOneSystematicSubstituent(mol, r, o);
    if (!sub) return null;
    tail = ` O-${/[\d(),[\]]/.test(sub.text) ? `(${sub.text})` : sub.text} oxime`;
  }
  return `${ez ? `(${ez})-` : ''}${base}${tail}`;
}

/** The name of a group as a prefix (methyl, 6-fluoropyridin-2-yl), from a namer over the whole molecule. */
function nameOneSystematicSubstituent(mol: Molecule, a: AtomId, from: AtomId): SubName | null {
  try {
    const { bare, oxides } = withoutRingOxides(mol);
    const namer = new Namer(analyze(bare), mol, oxides);
    return namer.substituent(a, from);
  } catch (e) { if (e instanceof OutOfScope) return null; throw e; }
}

/** Explicit hydrogen atoms ([H] in SMILES) folded into their atom's hydrogen count, keeping stereo that refers to them. */
function foldHydrogens(mol: Molecule): void {
  for (const h of [...mol.atoms()]) {
    if (h.element !== 'H' || h.isotope !== null || h.charge !== 0) continue;
    const nb = mol.neighbours(h.id);
    if (nb.length !== 1) continue;
    const heavy = mol.atom(nb[0]!);
    for (const b of mol.bonds()) {
      if (b.ez) b.ez = { ref: [b.ez.ref[0] === h.id ? -1 : b.ez.ref[0], b.ez.ref[1] === h.id ? -1 : b.ez.ref[1]], cis: b.ez.cis };
    }
    for (const a of mol.atoms()) if (a.chirality?.order.includes(h.id)) a.chirality = { ...a.chirality, order: a.chirality.order.map((x) => (x === h.id ? -1 : x)) };
    const hs = mol.implicitHydrogens(heavy.id);
    mol.removeAtom(h.id);
    heavy.explicitHydrogens = hs + 1;
  }
}

function nameOneSystematic(input: Molecule): string {
  const mol = expandNicknames(input);
  foldHydrogens(mol);
  const metals = [...mol.atoms()].filter((a) => isMetal(a.element));
  for (const a of mol.atoms()) {
    if (!SUPPORTED.has(a.element) && !(metals.length === 1 && a === metals[0])) throw new OutOfScope(`element ${a.element}`);
    if (a.isotope !== null && !labelledHalogen(mol, a)) throw new OutOfScope('isotopic labelling');
    // An atom short of its valence is a radical or a carbene, however it was written.
    if (a.radical || mol.missingValence(a.id) > 0) throw new OutOfScope('radicals');
    if (!(metals.length === 1 && a === metals[0]) && !usualValence(mol, a.id)) throw new OutOfScope(`unusual valence at ${a.element}`);
  }
  // One charged atom named on itself (an onium ion, an amide base); otherwise only the charges the namer has words for.
  const charged = [...mol.atoms()].filter((a) => a.charge !== 0 && a !== metals[0] && !isNitroAtom(mol, a.id));
  const onItself = charged.length === 1 && (isOnium(mol, charged[0]!.id) || isAmideAnion(mol, charged[0]!.id));
  if (!onItself && charged.some((a) => !isNamedIon(mol, a.id))) throw new OutOfScope('charged species');
  if (metals.length === 1) return organometallic(mol, metals[0]!.id);
  const known = noWholeRetained ? null : retainedMolecule(mol);
  if (known) return known;
  if (mol.atomCount === 1 && mol.atom([...mol.atoms()][0]!.id).element !== 'C') throw new OutOfScope('single heteroatom');
  const drawn = [...mol.atoms()].some((a) => a.x !== 0 || a.y !== 0);
  if (drawn && fromGeometry) perceiveStereoFromGeometry(mol);
  const anhydride = anhydrideName(mol);
  if (anhydride) return anhydride;
  // A ring sulfur or phosphorus carrying =O is named as the ring with "oxide" added
  // (thiomorpholine 1,1-dioxide), so the ring keeps its ordinary name.
  const { bare, oxides } = withoutRingOxides(mol);
  const an = analyze(bare);
  // Two double bonds at one ring atom (a ring written C1=C=C...): the ring names here take one at most.
  for (const a of bare.atoms()) {
    if (bare.incidentBonds(a.id).filter((b) => an.ringBonds.has(b) && bare.bond(b).order === 2).length > 1) throw new OutOfScope('cumulated double bonds in a ring');
  }
  // A protonated nitrogen at a ring fusion of an unsaturated system ([NH+] in a pyrido[1,2-a]pyrimidine):
  // "-5-ium" on that parent is read as the aromatic cation, with no hydrogen there.
  for (const a of bare.atoms()) {
    if (a.element !== 'N' || a.charge !== 1 || bare.implicitHydrogens(a.id) === 0) continue;
    const ringNbrs = bare.neighbours(a.id).filter((n) => an.ringBonds.has(bare.bondBetween(a.id, n)!.id));
    if (ringNbrs.length < 3) continue;
    const seen = new Set<AtomId>([a.id]), stack = [a.id];
    while (stack.length) {
      const x = stack.pop()!;
      for (const y of bare.neighbours(x)) {
        const bd = bare.bondBetween(x, y)!;
        if (!an.ringBonds.has(bd.id)) continue;
        if (bd.order !== 1) throw new OutOfScope('protonated ring-fusion nitrogen');
        if (!seen.has(y)) { seen.add(y); stack.push(y); }
      }
    }
  }
  // A descriptor that could not be worked out (a centre in a very large fused system) is not left out
  // silently, and no time is spent on the rest of the name once one has been given up.
  const gaveUp = cipLimits.gaveUp;
  const costly = () => { if (cipLimits.gaveUp !== gaveUp) throw new OutOfScope('stereodescriptors too costly to work out'); };
  // A ring named with its oxides takes its amines, alcohols and thiols as prefixes:
  // 2,6-diamino-4-(piperidin-1-yl)pyrimidine 1-oxide, 2,7-dihydroxy-...dioxaphosphinine 2-oxide.
  let anUse = an;
  if (oxides.size) {
    const low = ['amine', 'alcohol', 'thiol'];
    const top = SENIORITY.find((k) => an.groups.some((g) => g.kind === k));
    const oxSystems = an.ringSystems.filter((sys) => sys.some((x) => oxides.has(x)));
    const onOx = (g: Group) => oxSystems.some((sys) => sys.includes(g.anchor) || bare.neighbours(g.anchor).some((y) => sys.includes(y)));
    if (top && low.includes(top) && an.groups.filter((g) => g.kind === top).every(onOx)) anUse = { ...an, groups: an.groups.filter((g) => !low.includes(g.kind)) };
  }
  const namer = new Namer(anUse, mol, oxides);
  // ... and that ring stays the parent.
  if (anUse !== an) namer.preferAtoms = new Set(an.ringSystems.find((sys) => sys.some((x) => oxides.has(x)))!);
  costly();
  namer.afterRanking = costly;
  const raw = retainedRings(namer.functionalClassName() ?? namer.name());
  // Beside a centre left unspecified, a descriptor in front would not say which centre it is.
  const openKinds = namer.openStereoKinds([...namer.mol.atoms()].map((a) => a.id));
  const name = frontLoneDescriptor(raw, openKinds);
  costly();
  // A configuration the name has no place for (a phosphane's P, an ammonium N) is not dropped silently.
  if ([...namer.rs.keys()].some((a) => !namer.cited.has(a))) throw new OutOfScope('stereocentre the name cannot cite');
  // Every isotope label is in the name, once for each labelled atom: a path that has no word for it
  // (an acyl halide, a salt) must not drop it.
  for (const a of mol.atoms()) {
    if (a.isotope === null) continue;
    const label = `-${a.isotope}${a.element}`;
    const want = [...mol.atoms()].filter((x) => x.isotope === a.isotope && x.element === a.element).length;
    if (name.split(label).length - 1 !== want) throw new OutOfScope('isotopic labelling');
  }
  // Last check on the name itself: it must carry one descriptor for each centre and each double bond that
  // has a configuration, no fewer (one dropped on the way) and no more (one cited twice).
  // (A descriptor inside "bis(...)" or "tris(...)" stands for that many.)
  let centres = 0, bonds = 0;
  const times: number[] = [];
  const TIMES: Record<string, number> = { bis: 2, tris: 3, tetrakis: 4, pentakis: 5, hexakis: 6, heptakis: 7, octakis: 8, nonakis: 9, decakis: 10 };
  const group = /^\((?:\d+[a-z]?'*)?[RSEZrs](?:,(?:\d+[a-z]?'*)?[RSEZrs])*\)/;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === ')') { times.pop(); continue; }
    if (name[i] !== '(') continue;
    const found = group.exec(name.slice(i));
    if (found) {
      const n = times.reduce((p, q) => p * q, 1);
      centres += n * (found[0].match(/[RSrs]/g) ?? []).length;
      bonds += n * (found[0].match(/[EZ]/g) ?? []).length;
      i += found[0].length - 1;
      continue;
    }
    const word = /([a-z]+)$/.exec(name.slice(0, i))?.[1] ?? '';
    times.push(Object.entries(TIMES).find(([w]) => word.endsWith(w))?.[1] ?? 1);
  }
  if (centres + namer.residueCited.size !== namer.rs.size || bonds !== namer.ez.size / 2) throw new OutOfScope('stereodescriptors do not add up');
  return name;
}

/**
 * Bridged parents chemists call by name, wherever they occur in a name: quinuclidin-3-ol, adamantan-1-ol,
 * 1,3,5,7-tetraazaadamantane, cubane. (Numbered as their von Baeyer names are.) Not where the von Baeyer
 * name carries a replacement prefix of its own (4-oxa-1-azabicyclo[2.2.2]octane).
 */
function retainedRings(name: string): string {
  const notAfterReplacement = '(?<!(?:oxa|aza|thia|sila|bora|phospha|selena)-)';
  return name
    .replace(/(?<=[a-z)])-1-azabicyclo\[2\.2\.2\]octan/g, (m, i: number, all: string) => (/(oxa|aza|thia|sila|bora|phospha|selena)$/.test(all.slice(0, i)) ? m : 'quinuclidin'))
    .replace(new RegExp(`${notAfterReplacement}(?<![a-z])1-azabicyclo\\[2\\.2\\.2\\]octan`, 'g'), 'quinuclidin')
    .replace(/(?<![a-z\]-])tricyclo\[3\.3\.1\.1\^\{3,7\}\]decan/g, 'adamantan')
    .replace(/(\d,\d,\d,\d-tetraaza)tricyclo\[3\.3\.1\.1\^\{3,7\}\]decan/g, '$1adamantan')
    .replace(/(?<![a-z\]-])pentacyclo\[4\.2\.0\.0\^\{2,5\}\.0\^\{3,8\}\.0\^\{4,7\}\]octan/g, 'cuban')
    .replace(/(quinuclidin|adamantan|cuban)(?=$|[ ),]|-\d)/g, '$1e')
    .replace(/(quinuclidin|adamantan|cuban)e-(\d+)-(yl|ol|one|amine)/g, '$1-$2-$3');
}

/** Small molecules known by name: chloroform, benzophenone, triethylamine. Matched as whole structures. */
const RETAINED_MOLECULES: [string, string][] = [
  ['ClC(Cl)Cl', 'chloroform'], ['BrC(Br)Br', 'bromoform'], ['IC(I)I', 'iodoform'], ['O=C(c1ccccc1)c1ccccc1', 'benzophenone'],
  ['O=C1C=CC(=O)C=C1', 'benzoquinone'], ['O=CC=O', 'oxalaldehyde'], ['CC(=O)C(C)=O', 'biacetyl'], ['CCN(CC)CC', 'triethylamine'],
  ['O=C/C=C/c1ccccc1', 'cinnamaldehyde'], ['NC(=O)c1cccnc1', 'nicotinamide'], ['CCCCCCCC/C=C\\CCCCCCCC(=O)O', 'oleic acid'],
  ['O=C(/C=C/c1ccccc1)c1ccccc1', '(E)-chalcone'], ['Cc1ccc(C)cc1', 'p-xylene'], ['Cc1cccc(C)c1', 'm-xylene'], ['Cc1ccccc1C', 'o-xylene'],
  ['OC(=O)c1cccnc1', 'nicotinic acid'], ['C=CC(C)=C', 'isoprene'], ['Cc1ccc(cc1)C(C)C', 'p-cymene'],
  ['Oc1cccc(O)c1', 'resorcinol'], ['Oc1ccc(O)cc1', 'hydroquinone'], ['Oc1ccccc1O', 'pyrocatechol'], ['Cc1cc(C)cc(C)c1', 'mesitylene'], ['Cc1ccccc1O', 'o-cresol'],
  ['Cc1cccc(O)c1', 'm-cresol'], ['Cc1ccc(O)cc1', 'p-cresol'], ['CC(=O)c1ccccc1', 'acetophenone'], ['CCC(=O)c1ccccc1', 'propiophenone'],
  ['OC(=O)CCCC(O)=O', 'glutaric acid'], ['OC(=O)CCCCC(O)=O', 'adipic acid'], ['CC(C)C(O)=O', 'isobutyric acid'], ['CC(=C)C(O)=O', 'methacrylic acid'],
  ['OC(=O)c1ccccc1C(O)=O', 'phthalic acid'], ['OC(=O)c1cccc(c1)C(O)=O', 'isophthalic acid'], ['OC(=O)c1ccc(cc1)C(O)=O', 'terephthalic acid'],
  ['Cc1ccccc1N', 'o-toluidine'], ['Cc1cccc(N)c1', 'm-toluidine'], ['Cc1ccc(N)cc1', 'p-toluidine'], ['Nc1ccc(cc1)-c1ccc(N)cc1', 'benzidine'],
  ['NNC(=O)c1ccncc1', 'isonicotinohydrazide'], ['N#Cc1ccccc1C#N', 'phthalonitrile'], ['NC(=O)c1ccccc1C(N)=O', 'phthalamide'], ['N#CCC#N', 'malononitrile'], ['C=CC#N', 'acrylonitrile'], ['OC(=O)C(=O)O', 'oxalic acid'],
];
let retainedMols: { mol: Molecule; name: string; formula: string }[] | null = null;
/** Set while naming the carbonyl of an oxime: its name is the systematic one. */
let noWholeRetained = false;
function retainedMolecule(mol: Molecule): string | null {
  const formula = (m: Molecule) => [...m.atoms()].map((a) => a.element).sort().join('') + [...m.atoms()].reduce((n, a) => n + m.implicitHydrogens(a.id), 0);
  retainedMols ??= RETAINED_MOLECULES.map(([smi, name]) => { const m = parseSmiles(smi); return { mol: m, name, formula: formula(m) }; });
  const f = formula(mol);
  for (const r of retainedMols) if (r.formula === f && sameStereoisomer(r.mol, mol, { recorded: [true, !fromGeometry || ![...mol.atoms()].some((a) => a.x || a.y)] })) return r.name;
  return null;
}

/**
 * A structure with one configuration in all has its descriptor in front of the whole name, wherever
 * that centre or double bond is: (S)-3-(1-methylpyrrolidin-2-yl)pyridine, (E)-5-(4-hydroxystyryl)benzene-1,3-diol.
 * In an ester or salt name, in front of the word that holds it.
 */
export function frontLoneDescriptor(name: string, open: { centre: boolean; bond: boolean } = { centre: false, bond: false }): string {
  const all = [...name.matchAll(/\((?:\d+[a-z]?'*)?[RSEZrs](?:,(?:\d+[a-z]?'*)?[RSEZrs])*\)-?/g)];
  if (all.length !== 1) return name;
  // Beside an open element of its own kind, a descriptor in front would not say which one it is.
  if (/^\([RS]\)/.test(all[0]![0]) ? open.centre : open.bond) return name;
  // An amino acid's L or D is a configuration too.
  if (/(^|[-( ])[DL]-[a-z]/.test(name)) return name;
  const m = all[0]!;
  if (!/^\([RSEZ]\)-$/.test(m[0])) return name;
  const start = name.lastIndexOf(' ', m.index) + 1;
  if (m.index === start) return name;
  // Inside bis(...) it stands for two.
  if (/(bis|tris|kis)\(/.test(name.slice(start, m.index))) return name;
  let rest = name.slice(m.index + m[0].length);
  let before = name.slice(start, m.index);
  // A word bracketed only for its descriptor loses the brackets with it: (benzylidene)amino, benzylideneamino.
  const w = /^([a-z]+)\)/.exec(rest);
  if (w && /ylidene$/.test(w[1]!) && before.endsWith('(') && /^[a-z]/.test(rest.slice(w[0].length))) { before = before.slice(0, -1); rest = w[1] + rest.slice(w[0].length); }
  return name.slice(0, start) + m[0] + before + rest;
}

/** Bonds plus hydrogens each element may have, by charge; what the names here are written for. */
const VALENCE: Readonly<Record<string, Readonly<Record<number, readonly number[]>>>> = {
  C: { 0: [4], 1: [3], [-1]: [3] }, N: { 0: [3, 5], 1: [4], [-1]: [2] }, O: { 0: [2], 1: [3], [-1]: [1] },
  S: { 0: [2, 4, 6], 1: [3], [-1]: [1] }, P: { 0: [3, 5], 1: [4] }, Si: { 0: [4] }, Sn: { 0: [4] }, B: { 0: [3], [-1]: [4] },
  F: { 0: [1] }, Cl: { 0: [1] }, Br: { 0: [1] }, I: { 0: [1], 1: [2] }, H: { 0: [1], 1: [0], [-1]: [0] },
};

/**
 * Is the atom at a valence its name can say? Tin with two bonds and no hydrogen written
 * ([Sn] in CCCC[Sn]CCCC) is not a stannane; an N(V) other than nitro, or an S(IV), S(VI) or
 * P(V) carrying hydrogen and no double bond (CC[PH2](CC)CC), is no ordinary amine, sulfide or phosphane.
 */
function usualValence(mol: Molecule, id: AtomId): boolean {
  const a = mol.atom(id);
  const allowed = VALENCE[a.element]?.[a.charge];
  if (!allowed) return VALENCE[a.element] === undefined;
  const h = mol.implicitHydrogens(id);
  const used = mol.bondOrderSum(id) + h;
  if (!allowed.includes(used)) return false;
  const double = mol.incidentBonds(id).some((b) => mol.bond(b).order === 2);
  if (a.element === 'N' && a.charge === 0 && used === 5) return mol.neighbours(id).filter((n) => el(mol, n) === 'O' && mol.bondBetween(id, n)!.order === 2).length === 2;
  if ((a.element === 'S' || a.element === 'P') && h > 0 && used > 3 && !double) return false;
  return true;
}

/**
 * An open-chain anhydride, named from its two acids: acetic anhydride, acetic
 * benzoic anhydride, trifluoromethanesulfonic anhydride. Null when the
 * molecule is not one (or has more than one), or an acid has no "... acid" name.
 */
function anhydrideName(mol: Molecule): string | null {
  const acyl = (c: AtomId, o: AtomId) => {
    const others = mol.neighbours(c).filter((n) => n !== o);
    const oxo = others.filter((n) => el(mol, n) === 'O' && mol.neighbours(n).length === 1 && mol.bondBetween(c, n)!.order === 2);
    if (el(mol, c) === 'C') return oxo.length === 1 && others.length === 2 && others.every((n) => oxo.includes(n) || el(mol, n) === 'C');
    if (el(mol, c) === 'S') return oxo.length === 2 && others.length === 3 && others.every((n) => oxo.includes(n) || el(mol, n) === 'C');
    return false;
  };
  const links = [...mol.atoms()].filter((o) => {
    if (o.element !== 'O' || o.charge !== 0) return false;
    const nb = mol.neighbours(o.id);
    return nb.length === 2 && el(mol, nb[0]!) === el(mol, nb[1]!) && nb.every((c) => acyl(c, o.id)) && !perceiveRingMember(mol, o.id);
  });
  if (links.length !== 1) return null;
  const o = links[0]!;
  const [a, b] = mol.neighbours(o.id) as [AtomId, AtomId];
  // Each half as its acid: the oxygen stays on one side, the other gets an OH of its own.
  const acids = mol.clone();
  acids.removeBond(acids.bondBetween(o.id, b)!.id);
  acids.addBond({ begin: b, end: acids.addAtom({ element: 'O', x: mol.atom(o.id).x, y: mol.atom(o.id).y }).id });
  const names: string[] = [];
  for (const f of acids.fragments()) {
    let n: string;
    try { n = nameOne(subMolecule(acids, f)); } catch (e) { if (e instanceof OutOfScope) return null; throw e; }
    // One acid group in each half: an anhydride of a diacid's one end is not named this way.
    if (!n.endsWith(' acid') || /(di|tri|tetra)(oic|carboxylic|sulfonic) acid$/.test(n)) return null;
    names.push(n.slice(0, -5));
  }
  void a;
  if (names.length !== 2) return null;
  return names[0] === names[1] ? `${names[0]} anhydride` : `${[...names].sort((x, y) => x.replace(/[^a-z]/g, '').localeCompare(y.replace(/[^a-z]/g, ''))).join(' ')} anhydride`;
}

/** The molecule without the =O on ring S, Se, P and As atoms, and how many each carried. */
function withoutRingOxides(mol: Molecule): { bare: Molecule; oxides: Map<AtomId, number> } {
  const oxides = new Map<AtomId, number>();
  const drop: AtomId[] = [];
  for (const a of mol.atoms()) {
    if (!['S', 'Se', 'P', 'As'].includes(a.element) || a.charge !== 0 || mol.neighbours(a.id).length < 3 || !perceiveRingMember(mol, a.id)) continue;
    const oxo = mol.neighbours(a.id).filter((n) => el(mol, n) === 'O' && mol.neighbours(n).length === 1 && mol.bondBetween(a.id, n)!.order === 2 && mol.atom(n).charge === 0);
    const max = a.element === 'S' || a.element === 'Se' ? 2 : 1;
    // What is left must be the ring atom at its usual valence: two bonds for S, three for P.
    const left = mol.bondOrderSum(a.id) - 2 * oxo.length;
    if (!oxo.length || oxo.length > max || left !== (max === 2 ? 2 : 3) || mol.neighbours(a.id).length - oxo.length < 2) continue;
    oxides.set(a.id, oxo.length);
    drop.push(...oxo);
  }
  // A ring N-oxide (N+ with O- on it and two ring bonds besides): pyridine 1-oxide.
  const neutral: AtomId[] = [];
  for (const a of mol.atoms()) {
    if (a.element !== 'N' || a.charge !== 1 || !perceiveRingMember(mol, a.id)) continue;
    const ox = mol.neighbours(a.id).filter((n) => el(mol, n) === 'O' && mol.neighbours(n).length === 1 && mol.atom(n).charge === -1 && mol.bondBetween(a.id, n)!.order === 1);
    if (ox.length !== 1 || mol.neighbours(a.id).length !== 3 || mol.bondOrderSum(a.id) !== 4) continue;
    oxides.set(a.id, 1);
    drop.push(ox[0]!);
    neutral.push(a.id);
  }
  if (!drop.length) return { bare: mol, oxides };
  const bare = mol.clone();
  for (const o of drop) bare.removeAtom(o);
  for (const n of neutral) bare.atom(n).charge = 0;
  return { bare, oxides };
}

/**
 * An organometallic named on its metal: butyllithium, diethylzinc, and (with
 * the halide split off as an ion) the methylmagnesium of methylmagnesium bromide.
 */
function organometallic(mol: Molecule, metal: AtomId): string {
  const nbrs = mol.neighbours(metal);
  if (!nbrs.length || !nbrs.every((n) => mol.atom(n).element === 'C' && mol.bondBetween(metal, n)!.order === 1)) throw new OutOfScope(`element ${mol.atom(metal).element}`);
  const drawn = [...mol.atoms()].some((a) => a.x !== 0 || a.y !== 0);
  if (drawn && fromGeometry) perceiveStereoFromGeometry(mol);
  const namer = new Namer(analyze(mol));
  return `${namer.groupedSubs(nbrs, metal)}${metalName(mol.atom(metal).element)}`;
}

/** Cations named on their heteroatom, with what is on it in front: trimethylsulfonium. */
const ONIUM: Readonly<Record<string, string>> = { P: 'phosphonium', S: 'sulfonium', O: 'oxonium', I: 'iodonium', As: 'arsonium', Se: 'selenonium' };

/** An open-chain onium centre: P+, S+, O+ or I+ with single bonds to carbon only. */
function isOnium(mol: Molecule, id: AtomId): boolean {
  const a = mol.atom(id);
  return a.charge === 1 && !!ONIUM[a.element] && mol.implicitHydrogens(id) === 0 && mol.neighbours(id).length >= 2
    && mol.neighbours(id).every((n) => el(mol, n) === 'C' && mol.bondBetween(id, n)!.order === 1) && !perceiveRingMember(mol, id);
}

/** An amide base's nitrogen: N- in the open chain with carbon or silicon on it (diisopropylamide, bis(trimethylsilyl)amide). */
function isAmideAnion(mol: Molecule, id: AtomId): boolean {
  const a = mol.atom(id);
  const nb = mol.neighbours(id);
  return a.element === 'N' && a.charge === -1 && nb.length >= 1 && nb.length + mol.implicitHydrogens(id) === 2 && !perceiveRingMember(mol, id)
    && nb.every((n) => (el(mol, n) === 'Si' || (el(mol, n) === 'C' && !isAcylCarbon(mol, n))) && mol.bondBetween(id, n)!.order === 1);
}

/** Charges we can name: carboxylate/alkoxide O-, ammonium N+. */
function isNamedIon(mol: Molecule, id: AtomId): boolean {
  const a = mol.atom(id);
  const nb = mol.neighbours(id);
  if ((a.element === 'O' || a.element === 'S') && a.charge === 1 && isRingCation(mol, id) && perceiveRingMember(mol, id)) return true;
  if (a.element === 'N' && a.charge === 1 && isRingCation(mol, id) && mol.atom(id).element === 'N') {
    // In a ring (-ium), or open-chain with only single bonds (azanium).
    if (perceiveRingMember(mol, id)) return true;
  }
  if (a.element === 'N' && a.charge === 1 && isIminium(mol, id)) return true;
  if (a.element === 'N' && a.charge === -1 && isRingAnion(mol, id) && perceiveRingMember(mol, id)) return true;
  if (a.element === 'S' && a.charge === -1 && nb.length === 1 && el(mol, nb[0]!) === 'C') return true;
  // Oxido on S or P: sulfonates, phosphates.
  if (a.element === 'O' && a.charge === -1 && nb.length === 1 && (el(mol, nb[0]!) === 'S' || el(mol, nb[0]!) === 'P')) return true;
  // Azide N=N+=N-.
  if (a.element === 'N' && a.charge === 1 && nb.length === 2 && nb.every((n) => el(mol, n) === 'N') && nb.some((n) => mol.atom(n).charge === -1)) return true;
  // Diazo C=N+=N-, diazonium C-N+#N and isocyanide C-N+#C-.
  if (a.element === 'N' && a.charge === 1 && nb.length === 2 && nb.some((n) => el(mol, n) === 'C' && mol.bondBetween(id, n)!.order <= 2)) {
    const end = nb.find((n) => mol.neighbours(n).length === 1 && mol.bondBetween(id, n)!.order >= 2);
    if (end !== undefined && ((el(mol, end) === 'N' && [0, -1].includes(mol.atom(end).charge)) || (el(mol, end) === 'C' && mol.atom(end).charge === -1 && mol.bondBetween(id, end)!.order === 3))) return true;
  }
  if (a.element === 'C' && a.charge === -1 && nb.length === 1 && el(mol, nb[0]!) === 'N' && mol.atom(nb[0]!).charge === 1 && mol.bondBetween(id, nb[0]!)!.order === 3) return true;
  // The end of an azide or a diazo group, whose N+ has two neighbours. (On a ring N+ it is an N-imide, which has no name here.)
  if (a.element === 'N' && a.charge === -1 && nb.length === 1 && mol.atom(nb[0]!).charge === 1 && el(mol, nb[0]!) === 'N') return mol.neighbours(nb[0]!).length === 2;
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

/** Labels (OMe, CO2Et, NHBoc...) drawn out as atoms before naming. */
function expandNicknames(input: Molecule): Molecule {
  const mol = input.clone();
  for (const a of [...mol.atoms()]) {
    if (a.label === null) continue;
    const nbrs = mol.neighbours(a.id);
    const read = labelStructure(a.label, nbrs.length);
    if (!read) throw new OutOfScope(`label "${a.label}"`);
    const idMap = new Map<AtomId, AtomId>();
    for (const f of read.mol.atoms()) idMap.set(f.id, mol.addAtom({ ...f, x: a.x, y: a.y }).id);
    for (const b of read.mol.bonds()) mol.addBond({ ...b, begin: idMap.get(b.begin)!, end: idMap.get(b.end)! });
    // A label between two atoms: its first atom to the left-hand one, its last to the other.
    const ordered = [...nbrs].sort((p, q) => (Math.abs(mol.atom(p).x - mol.atom(q).x) > 1e-6 ? mol.atom(p).x - mol.atom(q).x : mol.atom(p).y - mol.atom(q).y));
    ordered.forEach((other, i) => {
      const bd = mol.bondBetween(a.id, other)!;
      const at = idMap.get(i === 1 ? read.tail : read.head)!;
      // Keep the bond's direction, so a wedge still says the same thing.
      mol.addBond({ begin: bd.begin === a.id ? at : other, end: bd.begin === a.id ? other : at, order: bd.order, display: bd.display });
    });
    mol.removeAtom(a.id);
  }
  return mol;
}

// ------------------------------------------------------------------ the namer

class Namer {
  readonly an: Analysis;
  readonly mol: Molecule;
  readonly subCache = new Map<string, SubName | OutOfScope>();
  readonly principal: GroupKind | null;
  readonly principalGroups: Group[];
  readonly ringByAtom = new Map<AtomId, AtomId[]>();
  readonly rs = new Map<AtomId, 'R' | 'S' | 'r' | 's'>();
  readonly ez = new Map<string, 'E' | 'Z'>();
  /** Stereocentres whose descriptor some name built here cites. */
  readonly cited = new Set<AtomId>();
  /** Atoms left out of a parent's prefixes: the linker of a multiplicative name. */
  readonly excluded = new Set<AtomId>();
  /** The side chains of the residues in the name being built. */
  sides: Set<AtomId>[] = [];
  /** Stereocentres an amino acid's L or D stands for (no R or S of their own in the name). */
  readonly residueCited = new Set<AtomId>();
  /** Called after each CIP ranking made while naming, to stop when one was given up. */
  afterRanking: () => void = () => {};

  /** Ring S and P atoms named with "oxide": how many =O each carries (they are not in `mol`). */
  readonly oxides: ReadonlyMap<AtomId, number>;

  /** `full` is the molecule with every atom, where `an` is of one with ring oxides left off: configurations are read from it. */
  constructor(an: Analysis, full: Molecule = an.mol, oxides: ReadonlyMap<AtomId, number> = new Map()) {
    this.an = an;
    this.mol = an.mol;
    this.oxides = oxides;
    // The first ranking given up ends the naming: each one costs as much again.
    const gaveUp = cipLimits.gaveUp;
    const costly = () => { if (cipLimits.gaveUp !== gaveUp) throw new OutOfScope('stereodescriptors too costly to work out'); };
    for (const a of an.mol.atoms()) { const l = rsLabel(full, a.id) ?? pseudoLabel(full, a.id); costly(); if (l) this.rs.set(a.id, l); }
    for (const b of an.mol.bonds()) {
      const fb = full.bondBetween(b.begin, b.end);
      const l = fb ? ezLabel(full, fb.id) : null;
      costly();
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
    const nn = this.thiocarbamate() ?? this.hydroxylamine() ?? this.symmetricAmine() ?? this.sulfoximineName() ?? this.phosphorusAcidName() ?? this.inorganicEster() ?? this.hydrazineCarbonyl() ?? this.hydrazineName() ?? this.sulfaneName() ?? this.carbodiimideName() ?? this.cyanamideName();
    if (nn) return nn;
    const mol = this.mol;
    // An onium ion or an amide base, named on its charged atom: methyltriphenylphosphonium, diisopropylamide.
    const charged = [...mol.atoms()].filter((a) => a.charge !== 0 && !isNitroAtom(mol, a.id));
    if (charged.length === 1 && isOnium(mol, charged[0]!.id)) return `${this.centreStereo(charged[0]!.id)}${this.groupedSubs(mol.neighbours(charged[0]!.id), charged[0]!.id)}${ONIUM[charged[0]!.element]}`;
    if (charged.length === 1 && isAmideAnion(mol, charged[0]!.id)) return `${this.groupedSubs(mol.neighbours(charged[0]!.id), charged[0]!.id)}amide`;
    // ROC(=O)OC(=O)OR: di-tert-butyl dicarbonate.
    const bridge = [...mol.atoms()].filter((o) => o.element === 'O' && mol.neighbours(o.id).length === 2 && !this.an.ringAtoms.has(o.id)
      && mol.neighbours(o.id).every((c) => el(mol, c) === 'C' && isAcylCarbon(mol, c) && mol.neighbours(c).filter((x) => el(mol, x) === 'O').length === 3));
    if (bridge.length === 1) {
      const ends = mol.neighbours(bridge[0]!.id).map((c) => mol.neighbours(c).find((x) => x !== bridge[0]!.id && el(mol, x) === 'O' && mol.neighbours(x).length === 2));
      if (ends.every((x) => x !== undefined)) {
        const rs = ends.map((x) => { const r = mol.neighbours(x!).find((y) => !isAcylCarbon(mol, y)); return r === undefined || el(mol, r) !== 'C' ? null : this.substituent(r, x!); });
        if (rs.every((r) => r !== null)) {
          const [r1, r2] = rs as [SubName, SubName];
          const w = (r: SubName) => (r.complex && !/^(tert|sec)-[a-z]+$/.test(r.text) ? `(${r.text})` : r.text);
          return r1.text === r2.text ? `di${/^(tert|sec)-/.test(r1.text) ? '-' : ''}${w(r1)} dicarbonate` : `${[r1, r2].sort((x, y) => x.sortKey.localeCompare(y.sortKey)).map(w).join(' ')} dicarbonate`;
        }
      }
    }
    // A lone Si, Ge, Sn, Pb, As, Sb, Se or Te with no characteristic group to name: ethoxytrimethylsilane,
    // tributylstannane, triphenylarsane, dimethylselane; with OH on it, trimethylsilanol.
    const HYDRIDE: Record<string, [string, number]> = { Si: ['silane', 4], Ge: ['germane', 4], Sn: ['stannane', 4], Pb: ['plumbane', 4], As: ['arsane', 3], Sb: ['stibane', 3], Se: ['selane', 2], Te: ['tellane', 2] };
    const metalloids = [...mol.atoms()].filter((a) => HYDRIDE[a.element]);
    // A heterocycle elsewhere is the senior parent: 2-(diphenyl((trimethylsilyl)oxy)methyl)pyrrolidine.
    const heterocycle = [...this.an.ringAtoms].some((a) => !['C', 'Si', 'Ge', 'Sn', 'Pb', 'As', 'Sb', 'Se', 'Te'].includes(el(mol, a)));
    if (metalloids.length === 1 && !heterocycle && ![...mol.atoms()].some((a) => a.element === 'B' || a.element === 'P')) {
      const m = metalloids[0]!;
      const [hydride, v] = HYDRIDE[m.element]!;
      const nb2 = mol.neighbours(m.id);
      const oh = nb2.filter((n) => el(mol, n) === 'O' && mol.neighbours(n).length === 1 && this.an.h.get(n) === 1 && mol.atom(n).charge === 0);
      const ol = oh.length === 1 && (!this.principal || (this.principal === 'alcohol' && this.principalGroups.length === 1 && this.principalGroups[0]!.consumed.includes(oh[0]!)) || this.principalGroups.every((g) => g.anchor === oh[0] || g.consumed.includes(oh[0]!)));
      if ((!this.principal || ol) && m.charge === 0 && nb2.length + (this.an.h.get(m.id) ?? 0) === v && mol.incidentBonds(m.id).every((b) => mol.bond(b).order === 1) && !this.an.ringAtoms.has(m.id)) {
        const subs = nb2.filter((n) => !ol || n !== oh[0]);
        return `${this.centreStereo(m.id)}${subs.length ? this.groupedSubs(subs, m.id) : ''}${ol ? `${hydride.replace(/e$/, '')}ol` : hydride}`;
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
    // A borane with three carbon groups: tris(perfluorophenyl)borane, triethylborane.
    if (c.element === 'B' && c.charge === 0 && carbonNbrs.length === 3 && nbrs.length === 3 && !this.an.ringAtoms.has(c.id)) return `${this.groupedSubs(carbonNbrs, c.id)}borane`;
    if (c.element === 'B' && c.charge === -1 && carbonNbrs.length === 1) {
      const fs = nbrs.filter((n) => el(mol, n) === 'F');
      if (fs.length === 3) {
        const R = this.substituent(carbonNbrs[0]!, c.id);
        // "propanoyltrifluoroborate": the way chemists write KATs, and OPSIN-parsable.
        return `trifluoro(${R.text})borate`;
      }
    }
    if (c.element === 'P' && this.an.ringAtoms.has(c.id)) return null;
    if (c.element === 'P' && nbrs.length === 3 && carbonNbrs.length === 3 && mol.incidentBonds(c.id).every((b) => mol.bond(b).order === 1)) {
      return `${this.centreStereo(c.id)}${this.groupedSubs(carbonNbrs, c.id)}phosphane`;
    }
    if (c.element === 'P' && c.charge === 0 && nbrs.length === 4 && !this.principal) {
      const single = nbrs.filter((n) => mol.bondBetween(c.id, n)!.order === 1), dbl = nbrs.filter((n) => mol.bondBetween(c.id, n)!.order === 2);
      if (single.length === 3 && dbl.length === 1 && single.every((n) => el(mol, n) === 'C')) {
        const d = dbl[0]!;
        // R3P=O and R3P=S: triphenylphosphine oxide.
        if ((el(mol, d) === 'O' || el(mol, d) === 'S') && mol.neighbours(d).length === 1) return `${this.centreStereo(c.id)}${this.groupedSubs(single, c.id)}phosphine ${el(mol, d) === 'O' ? 'oxide' : 'sulfide'}`;
        // A Wittig ylide, R3P=CR2: methylenetriphenyl-λ5-phosphane.
        if (el(mol, d) === 'C') {
          const Y = this.ylidene(d, c.id);
          const subs = single.map((n) => this.substituent(n, c.id));
          return `${citeRun(countSubs([Y, ...subs]))}-λ5-phosphane`;
        }
      }
    }
    return null;
  }

  /**
   * An acid of phosphorus or its ester, named as one, where nothing more senior is in the structure:
   * methyl dihydrogen phosphate, trimethyl phosphate, (...)methyl tetrahydrogen triphosphate,
   * diethyl benzylphosphonate, phenylphosphonic acid, dimethylphosphinic acid, triphenyl phosphite,
   * dimethyl phosphoramidate, O,O,O-trimethyl phosphorothioate.
   */
  phosphorusAcidName(): string | null {
    const mol = this.mol;
    const ps = [...mol.atoms()].filter((a) => a.element === 'P');
    // Oxido on the phosphorus makes it an anion of the acid: methyl phosphate, methyl hydrogen phosphate;
    // with an onium elsewhere, an inner salt: 2-(trimethylammonio)ethyl ... phosphate.
    const pAnion = ps.some((p) => mol.neighbours(p.id).some((o) => el(mol, o) === 'O' && mol.atom(o).charge === -1 && mol.neighbours(o).length === 1));
    if (this.principal && ['carboxylate', 'sulfonate', 'olate', 'thiolate', 'ide', ...(pAnion ? [] : ['ium', 'iminium', 'aminium']), 'diazonium', 'acid', 'peracid', 'sulfonic', 'ester', 'sulfonateEster', 'acylHalide', 'sulfonylHalide'].includes(this.principal)) return null;
    if (!ps.length || ps.some((p) => this.an.ringAtoms.has(p.id) || p.charge !== 0)) return null;
    // Phosphorus atoms joined by O into one chain (a di- or triphosphate), every P with its =O.
    const pIds = ps.map((p) => p.id);
    const bridges = new Set<AtomId>();
    for (const p of pIds) for (const o of mol.neighbours(p)) if (el(mol, o) === 'O' && mol.neighbours(o).filter((x) => pIds.includes(x)).length === 2) bridges.add(o);
    if (pIds.length > 1 && bridges.size !== pIds.length - 1) return null;
    const dbl = (p: AtomId) => mol.neighbours(p).filter((x) => mol.bondBetween(p, x)!.order === 2);
    const esters: SubName[] = [], hs: AtomId[] = [], carbons: SubName[] = [];
    const sEsters = new Set<number>();
    let amino = 0, thio = false, anions = 0;
    for (const p of pIds) {
      const d = dbl(p);
      if (d.length > 1 || (d.length === 1 && (mol.neighbours(d[0]!).length !== 1 || !['O', 'S'].includes(el(mol, d[0]!))))) return null;
      if (d.length && el(mol, d[0]!) === 'S') { if (pIds.length > 1) return null; thio = true; }
      if (pIds.length > 1 && !d.length) return null;
      for (const x of mol.neighbours(p)) {
        if (d.includes(x) || bridges.has(x)) continue;
        if (mol.bondBetween(p, x)!.order !== 1) return null;
        const e = el(mol, x);
        if (e === 'C') { if (pIds.length > 1) return null; carbons.push(this.substituent(x, p)); continue; }
        if (e === 'N') { if (pIds.length > 1 || mol.neighbours(x).length !== 1 || mol.atom(x).charge) return null; amino++; continue; }
        const beyond = mol.neighbours(x).filter((y) => y !== p);
        if (e === 'O' && mol.atom(x).charge === -1 && !beyond.length) { anions++; continue; }
        if ((e !== 'O' && e !== 'S') || mol.atom(x).charge) return null;
        if (!beyond.length) { if (e === 'S') return null; hs.push(x); continue; }
        if (beyond.length !== 1 || el(mol, beyond[0]!) !== 'C' || isAcylCarbon(mol, beyond[0]!)) return null;
        if (e === 'S') { if (pIds.length > 1) return null; sEsters.add(esters.length); }
        esters.push(this.substituent(beyond[0]!, x));
      }
    }
    for (const p of pIds) { const rs = this.rs.get(p); if (rs) return null; }
    const n = pIds.length;
    // Esters on two phosphorus atoms of a chain: the name would not say which is where.
    if (n > 1 && esters.length > 1) return null;
    const hasDbl = dbl(pIds[0]!).length === 1;
    let acid: string;
    if (n > 1) acid = `${multiplier(n)}phosphate`;
    else if (!hasDbl) { if (carbons.length || amino || hs.length) return null; acid = 'phosphite'; }
    else if (amino === 1 && !carbons.length) acid = thio ? 'phosphoramidothioate' : 'phosphoramidate';
    else if (amino) return null;
    else if (carbons.length === 1) acid = 'phosphonate';
    else if (carbons.length === 2) acid = 'phosphinate';
    else if (carbons.length) return null;
    else acid = thio ? 'phosphorothioate' : 'phosphate';
    // S-esters add to the sulfur count: phosphorodithioate, phosphorotrithioate.
    const nS = (thio ? 1 : 0) + sEsters.size;
    if (sEsters.size) { if (carbons.length || amino || n > 1 || !hasDbl) return null; acid = `phosphoro${['', '', 'di', 'tri', 'tetra'][nS]}thioate`; thio = true; }
    const wrap = (x: SubName) => (x.complex ? `(${x.text})` : x.text);
    const cPart = carbons.length ? citeRun(countSubs(carbons)) : '';
    // An acid with no esters: phenylphosphonic acid, dimethylphosphinic acid, phosphoric acid.
    if (!esters.length) {
      if (n > 1 || thio || amino || !cPart) return null;
      // Its anion: hydrogen phenylphosphonate, phenylphosphonate.
      if (anions) return `${hs.length ? `${multiplier(hs.length)}hydrogen ` : ''}${carbons.length === 1 ? wrap(carbons[0]!) : cPart}${acid}`;
      return `${carbons.length === 1 ? wrap(carbons[0]!) : cPart}${acid.replace(/ate$/, 'ic acid')}`;
    }
    // Each ester group with the atom it is on in a thio acid: O,O-diethyl S-(2-(ethylthio)ethyl) phosphorodithioate.
    const tagged = esters.map((e, i) => ({ ...e, on: sEsters.has(i) ? 'S' : 'O' }));
    const groupsBy = new Map<string, { e: typeof tagged[number]; n: number }>();
    for (const t of tagged) { const k = `${t.on}|${t.text}`; const g = groupsBy.get(k); if (g) g.n++; else groupsBy.set(k, { e: t, n: 1 }); }
    const words: string[] = [];
    [...groupsBy.values()].sort((x, y) => x.e.sortKey.localeCompare(y.e.sortKey)).forEach(({ e: c, n: k }, i) => {
      const wrapIt = c.complex && !/^(tert|sec)-/.test(c.text);
      if (thio) { words.push(`${Array(k).fill(c.on).join(',')}-${k > 1 ? (wrapIt ? `${complexMultiplier(k)}(${c.text})` : `${multiplier(k)}${c.text}`) : wrapIt ? `(${c.text})` : c.text}`); return; }
      words.push(k > 1 ? (wrapIt ? `${complexMultiplier(k)}(${c.text})` : `${multiplier(k)}${c.text}`) : i > 0 && c.complex ? `(${c.text})` : c.text);
    });
    if (hs.length) words.push(`${thio ? 'O-' : ''}${multiplier(hs.length) || ''}hydrogen`);
    const head = carbons.length === 1 ? wrap(carbons[0]!) : cPart;
    return `${words.join(' ')} ${head}${acid}`;
  }

  /**
   * A hydrazine or diazene with nothing more senior on it, named as the parent: phenylhydrazine,
   * 1,1-dimethylhydrazine, 1-phenyl-2-(propan-2-ylidene)hydrazine, (E)-1,2-diphenyldiazene.
   */
  /**
   * Esters and amides of inorganic acids named by functional class: dimethyl sulfate, methyl sulfamate,
   * R dimethylsulfamate, dimethylcarbamic chloride, trimethyl borate, 1,1,1,3,3,3-hexamethyldisiloxane.
   */
  inorganicEster(): string | null {
    const mol = this.mol;
    const below = (k: string) => !this.principal || SENIORITY.indexOf(this.principal) > SENIORITY.indexOf(k as typeof SENIORITY[number]);
    const alkylO = (o: AtomId, from: AtomId) => {
      const r = mol.neighbours(o).filter((y) => y !== from);
      return el(mol, o) === 'O' && mol.atom(o).charge === 0 && !this.an.ringAtoms.has(o) && r.length === 1 && el(mol, r[0]!) === 'C' && !isAcylCarbon(mol, r[0]!) ? r[0]! : undefined;
    };
    const amineN = (n: AtomId, from: AtomId) => el(mol, n) === 'N' && mol.atom(n).charge === 0 && !this.an.ringAtoms.has(n)
      && mol.incidentBonds(n).every((b) => mol.bond(b).order === 1) && mol.neighbours(n).every((y) => y === from || (el(mol, y) === 'C' && !isAcylCarbon(mol, y)));
    const esterWords = (rs: SubName[]) => {
      const c = countSubs(rs.sort((x, y) => x.sortKey.localeCompare(y.sortKey)));
      return c.map((x, i) => x.n > 1 ? (x.complex ? `${complexMultiplier(x.n)}(${x.text})` : `${multiplier(x.n)}${x.text}`) : i > 0 && x.complex ? `(${x.text})` : x.text).join(' ');
    };
    // Sulfates and sulfamates: S(=O)2 with two of OR and NR2.
    const sul = [...mol.atoms()].filter((a) => a.element === 'S' && a.charge === 0 && !this.an.ringAtoms.has(a.id) && mol.neighbours(a.id).length === 4
      && mol.neighbours(a.id).filter((o) => el(mol, o) === 'O' && mol.bondBetween(a.id, o)!.order === 2 && mol.neighbours(o).length === 1).length === 2);
    if (sul.length === 1 && below('ester')) {
      const sAt = sul[0]!.id;
      const xs = mol.neighbours(sAt).filter((o) => mol.bondBetween(sAt, o)!.order === 1);
      const ors = xs.map((x) => alkylO(x, sAt)).filter((r) => r !== undefined) as AtomId[];
      const ns = xs.filter((x) => amineN(x, sAt));
      if (ors.length === 2) return `${esterWords(ors.map((r) => this.substituent(r, xs.find((x) => mol.neighbours(x).includes(r))!)))} sulfate`;
      if (ors.length === 1 && ns.length === 1) {
        const o = xs.find((x) => x !== ns[0])!;
        const nSubs = mol.neighbours(ns[0]!).filter((y) => y !== sAt).map((y) => this.substituent(y, ns[0]!));
        return `${this.substituent(ors[0]!, o).text} ${nSubs.length ? citeRun(countSubs(nSubs.sort((x, y) => x.sortKey.localeCompare(y.sortKey)))) : ''}sulfamate`;
      }
    }
    // A carbamoyl chloride: dimethylcarbamic chloride.
    if (this.principal === 'acylHalide' && this.principalGroups.length === 1) {
      const g = this.principalGroups[0]!;
      const n = mol.neighbours(g.anchor).find((y) => !g.consumed.includes(y));
      if (n !== undefined && amineN(n, g.anchor) && g.halogen) {
        const nSubs = mol.neighbours(n).filter((y) => y !== g.anchor).map((y) => this.substituent(y, n));
        return `${nSubs.length ? citeRun(countSubs(nSubs.sort((x, y) => x.sortKey.localeCompare(y.sortKey)))) : ''}carbamic ${HALIDE[g.halogen] ?? 'chloride'}`;
      }
    }
    // A borate: trimethyl borate.
    const bs = [...mol.atoms()].filter((a) => a.element === 'B');
    if (bs.length === 1 && !this.principal && bs[0]!.charge === 0 && mol.neighbours(bs[0]!.id).length === 3 && !this.an.ringAtoms.has(bs[0]!.id)) {
      const b = bs[0]!.id;
      const rs = mol.neighbours(b).map((o) => alkylO(o, b));
      if (rs.every((r) => r !== undefined)) return `${esterWords(rs.map((r) => this.substituent(r!, mol.neighbours(r!).find((y) => mol.neighbours(y).includes(b))!)))} borate`;
    }
    // A disiloxane: R3Si-O-SiR3.
    const sis = [...mol.atoms()].filter((a) => a.element === 'Si');
    if (sis.length === 2 && !this.principal) {
      const [a, b] = [sis[0]!.id, sis[1]!.id];
      const o = mol.neighbours(a).find((y) => el(mol, y) === 'O' && mol.neighbours(y).includes(b));
      if (o !== undefined && [a, b].every((x) => mol.neighbours(x).every((y) => y === o || el(mol, y) === 'C') && mol.neighbours(x).length === 4)) {
        const pre: Prefix[] = [a, b].flatMap((x) => mol.neighbours(x).filter((y) => y !== o).map((y) => ({ ...this.substituent(y, x), at: x })));
        const one = (x: AtomId) => pre.filter((p) => p.at === x).map((p) => p.sortKey).sort().join(' ');
        const [s1, s2] = one(a) <= one(b) ? [a, b] : [b, a];
        return `${this.prefixString(pre, new Map([[s1, '1'], [o, '2'], [s2, '3']]), false)}disiloxane`;
      }
    }
    return null;
  }

  /**
   * Semicarbazides, thiosemicarbazides and carbazates, named on hydrazine: hydrazinecarboxamide,
   * 2-(propan-2-ylidene)hydrazine-1-carbothioamide, methyl hydrazinecarboxylate.
   */
  hydrazineCarbonyl(): string | null {
    const mol = this.mol;
    const nns = [...mol.bonds()].filter((b) => b.order === 1 && el(mol, b.begin) === 'N' && el(mol, b.end) === 'N' && !this.an.ringAtoms.has(b.begin) && !this.an.ringAtoms.has(b.end));
    if (nns.length !== 1) return null;
    const ns = [nns[0]!.begin, nns[0]!.end];
    if (ns.some((x) => mol.atom(x).charge !== 0 || mol.incidentBonds(x).some((b) => mol.bond(b).order !== 1 && el(mol, mol.otherAtom(mol.bond(b), x)) !== 'C'))) return null;
    const acyls = ns.flatMap((n) => mol.neighbours(n).filter((c) => isAcylCarbon(mol, c) || (el(mol, c) === 'C' && mol.incidentBonds(c).some((b) => mol.bond(b).order === 2 && el(mol, mol.otherAtom(mol.bond(b), c)) === 'S' && mol.neighbours(mol.otherAtom(mol.bond(b), c)).length === 1))).map((c) => [n, c] as const));
    // With two, the carbamoyl one is the parent's suffix and the other a prefix: 2-acetyl-1-methylhydrazine-1-carboxamide.
    const amideLike = acyls.filter(([, c]) => mol.neighbours(c).some((y) => el(mol, y) === 'N' && !ns.includes(y)));
    const esterLike = acyls.filter(([, c]) => mol.neighbours(c).some((y) => el(mol, y) === 'O' && mol.bondBetween(c, y)!.order === 1));
    const pick = amideLike.length ? amideLike : esterLike;
    if (!acyls.length || acyls.length > 2 || (acyls.length === 2 && pick.length !== 1)) return null;
    const [n1, ac] = acyls.length === 2 ? pick[0]! : acyls[0]!;
    const n2 = ns.find((x) => x !== n1)!;
    const acN = mol.neighbours(ac).filter((x) => x !== n1);
    const dbl = acN.find((x) => mol.bondBetween(ac, x)!.order === 2)!;
    const x = acN.find((y) => y !== dbl);
    if (acN.length !== 2 || x === undefined || this.an.ringAtoms.has(x) || mol.atom(x).charge !== 0) return null;
    const thio = el(mol, dbl) === 'S';
    // The group on the carbonyl must be the principal one, and nothing else outranks it.
    const ours = this.principalGroups.length && this.principalGroups.every((g) => g.anchor === ac || g.consumed.includes(ac));
    if (!ours && this.principal && SENIORITY.indexOf(this.principal) <= SENIORITY.indexOf('urea')) return null;
    let suffix: string, alkyl = '';
    const pre: Prefix[] = [];
    if (el(mol, x) === 'N') {
      if (!mol.neighbours(x).every((y) => y === ac || (el(mol, y) === 'C' && !isAcylCarbon(mol, y)))) return null;
      suffix = thio ? 'carbothioamide' : 'carboxamide';
      for (const y of mol.neighbours(x)) if (y !== ac) pre.push({ ...this.substituent(y, x), at: 'N' });
    } else if (el(mol, x) === 'O' && !thio) {
      const r = mol.neighbours(x).find((y) => y !== ac);
      if (r === undefined) { if (!this.an.h.get(x)) return null; suffix = 'carboxylic acid'; }
      else { if (el(mol, r) !== 'C' || isAcylCarbon(mol, r)) return null; alkyl = `${this.substituent(r, x).text} `; suffix = 'carboxylate'; }
    } else return null;
    for (const n of ns) for (const bd of mol.incidentBonds(n).map((b) => mol.bond(b))) {
      const o = mol.otherAtom(bd, n);
      if (ns.includes(o) || o === ac) continue;
      if (el(mol, o) !== 'C' || (isAcylCarbon(mol, o) && !acyls.some(([, c]) => c === o))) return null;
      pre.push({ ...(bd.order === 2 ? this.ylidene(o, n) : this.substituent(o, n)), at: n });
    }
    const onHydrazine = pre.some((p) => p.at !== 'N');
    const numbering: Numbering = new Map([[n1, '1'], [n2, '2']]);
    const preText = this.prefixString(pre, numbering, false);
    const parent = `hydrazine${onHydrazine ? '-1-' : ''}${suffix}`;
    return `${alkyl}${preText}${preText && /^[0-9([]/.test(parent) ? '-' : ''}${parent}`;
  }

  hydrazineName(): string | null {
    const mol = this.mol;
    const nns = [...mol.bonds()].filter((b) => el(mol, b.begin) === 'N' && el(mol, b.end) === 'N' && !this.an.ringAtoms.has(b.begin) && !this.an.ringAtoms.has(b.end));
    if (nns.length !== 1) return null;
    const b = nns[0]!;
    const ns = [b.begin, b.end];
    if (ns.some((x) => mol.atom(x).charge !== 0)) return null;
    if (this.principal && !(this.principal === 'amine' && this.principalGroups.every((g) => g.nitrogen !== undefined ? ns.includes(g.nitrogen) : ns.some((x) => g.consumed.includes(x))))) return null;
    if (b.order !== 1 && b.order !== 2) return null;
    // A heterocycle on it is the senior parent: 3-hydrazineyl-6-(1H-pyrazol-1-yl)pyridazine.
    const heteroRing = (a: AtomId) => this.ringByAtom.get(a)?.some((x) => el(mol, x) !== 'C');
    if (b.order === 1 && ns.some((n) => mol.neighbours(n).some((o) => !ns.includes(o) && heteroRing(o)))) return null;
    const pre: Prefix[] = [];
    for (const n of ns) for (const bd of mol.incidentBonds(n).map((x) => mol.bond(x))) {
      const o = mol.otherAtom(bd, n);
      if (ns.includes(o)) continue;
      if (bd.order === 1) { if (el(mol, o) === 'N' || el(mol, o) === 'O' || isAcylCarbon(mol, o)) return null; pre.push({ ...this.substituent(o, n), at: n }); }
      else if (bd.order === 2 && el(mol, o) === 'C' && b.order === 1) pre.push({ ...this.ylidene(o, n), at: n });
      else return null;
    }
    if (!pre.length) return null;
    const count = (n: AtomId) => pre.filter((x) => x.at === n).length;
    const firstKey = (n: AtomId) => pre.filter((x) => x.at === n).map((x) => x.sortKey).sort()[0] ?? '~';
    const [n1, n2] = count(ns[0]!) > count(ns[1]!) || (count(ns[0]!) === count(ns[1]!) && firstKey(ns[0]!) <= firstKey(ns[1]!)) ? ns : [ns[1]!, ns[0]!];
    const numbering: Numbering = new Map([[n1!, '1'], [n2!, '2']]);
    if (b.order === 2) {
      const ez = this.ez.get(`${b.begin}-${b.end}`);
      return `${ez ? `(${ez})-` : ''}${this.prefixString(pre, numbering, false)}diazene`;
    }
    // One prefix alone needs no brackets: propan-2-ylidenehydrazine.
    if (pre.length === 1 && !pre[0]!.text.includes('(')) return `${pre[0]!.text}hydrazine`;
    return `${this.prefixString(pre, numbering, pre.length === 1)}hydrazine`;
  }

  /**
   * An open-chain sulfide with nothing more senior in the structure, named on its sulfur:
   * methyl(phenyl)sulfane, 1,2-diphenyldisulfane, 1,3-dimethyltrisulfane.
   */
  sulfaneName(): string | null {
    if (this.principal) return null;
    const mol = this.mol;
    // A ring with N or O in it is the senior parent: 4-(methylthio)pteridine.
    if ([...this.an.ringAtoms].some((a) => el(mol, a) === 'N' || el(mol, a) === 'O')) return null;
    // Diselanes and ditellanes likewise: 1,2-diphenyldiselane.
    const E = [...mol.atoms()].some((a) => a.element === 'Se') ? 'Se' : [...mol.atoms()].some((a) => a.element === 'Te') ? 'Te' : 'S';
    const word = ({ S: 'sulfane', Se: 'selane', Te: 'tellane' } as Record<string, string>)[E]!;
    const sulfide = (x: AtomId) => el(mol, x) === E && !this.an.ringAtoms.has(x) && mol.atom(x).charge === 0 && mol.neighbours(x).length === 2
      && mol.incidentBonds(x).every((b) => mol.bond(b).order === 1);
    const ss = [...mol.atoms()].filter((a) => sulfide(a.id)).map((a) => a.id);
    if (!ss.length) return null;
    // One chain of sulfur atoms, carbon at each end.
    const chain = [ss.find((x) => mol.neighbours(x).filter((y) => ss.includes(y)).length <= 1)!];
    if (chain[0] === undefined) return null;
    while (true) { const next = mol.neighbours(chain.at(-1)!).find((y) => ss.includes(y) && !chain.includes(y)); if (next === undefined) break; chain.push(next); }
    if (chain.length !== ss.length) return null;
    const ends = chain.length === 1 ? mol.neighbours(chain[0]!) : [mol.neighbours(chain[0]!).find((y) => !chain.includes(y))!, mol.neighbours(chain.at(-1)!).find((y) => !chain.includes(y))!];
    if (ends.some((c) => c === undefined || el(mol, c) !== 'C' || isAcylCarbon(mol, c) || mol.incidentBonds(c).some((b) => mol.bond(b).order === 3) || mol.incidentBonds(c).some((b) => mol.bond(b).order === 2 && el(mol, mol.otherAtom(mol.bond(b), c)) === 'S'))) return null;
    if (chain.length === 1) return `${this.groupedSubs(ends, chain[0]!)}${word}`;
    let subs = [{ ...this.substituent(ends[0]!, chain[0]!), at: chain[0]! }, { ...this.substituent(ends[1]!, chain.at(-1)!), at: chain.at(-1)! }];
    if (subs[1]!.sortKey < subs[0]!.sortKey) chain.reverse();
    subs = [{ ...this.substituent(ends[0]!, chain[0]!), at: chain[0]! }, { ...this.substituent(ends[1]!, chain.at(-1)!), at: chain.at(-1)! }];
    const numbering: Numbering = new Map(chain.map((x, i) => [x, String(i + 1)]));
    const first = numbering.get(subs[0]!.at)!;
    if (first !== '1') numbering.forEach((v, k) => numbering.set(k, String(chain.length + 1 - Number(v))));
    return `${this.prefixString(subs, numbering, false)}${multiplier(chain.length)}${word}`;
  }

  /**
   * A thiocarbamate or dithiocarbamate S-ester with nothing more senior: S-ethyl diisobutylcarbamothioate,
   * S-propyl butyl(ethyl)carbamothioate, 2-chloroallyl diethylcarbamodithioate.
   */
  thiocarbamate(): string | null {
    if (this.principal) return null;
    const mol = this.mol;
    const cs = [...mol.atoms()].filter((c) => {
      if (c.element !== 'C' || this.an.ringAtoms.has(c.id) || mol.neighbours(c.id).length !== 3) return false;
      const nb = mol.neighbours(c.id);
      return nb.some((x) => ['O', 'S'].includes(el(mol, x)) && mol.bondBetween(c.id, x)!.order === 2 && mol.neighbours(x).length === 1)
        && nb.some((x) => el(mol, x) === 'N' && !this.an.ringAtoms.has(x)) && nb.some((x) => el(mol, x) === 'S' && mol.bondBetween(c.id, x)!.order === 1 && mol.neighbours(x).length === 2);
    });
    if (cs.length !== 1) return null;
    const c = cs[0]!.id, nb = mol.neighbours(c);
    const dbl = nb.find((x) => mol.bondBetween(c, x)!.order === 2)!;
    const n = nb.find((x) => el(mol, x) === 'N')!, sx = nb.find((x) => el(mol, x) === 'S' && mol.bondBetween(c, x)!.order === 1)!;
    if (mol.atom(n).charge || !mol.incidentBonds(n).every((b) => mol.bond(b).order === 1)) return null;
    const r = mol.neighbours(sx).find((y) => y !== c)!;
    if (el(mol, r) !== 'C') return null;
    const nsubs = mol.neighbours(n).filter((y) => y !== c);
    if (nsubs.some((y) => el(mol, y) !== 'C')) return null;
    const R = this.substituent(r, sx);
    const dithio = el(mol, dbl) === 'S';
    const head = nsubs.length ? citeRun(countSubs(nsubs.map((y) => this.substituent(y, n)))) : '';
    const alkyl = dithio ? R.text : `S-${R.complex ? `(${R.text})` : R.text}`;
    return `${alkyl} ${head}carbamo${dithio ? 'dithioate' : 'thioate'}`;
  }

  /** An N-substituted hydroxylamine with nothing more senior: N-phenylhydroxylamine. */
  hydroxylamine(): string | null {
    if (this.principal) return null;
    const mol = this.mol;
    const ns = [...mol.atoms()].filter((a) => a.element === 'N' && a.charge === 0 && !this.an.ringAtoms.has(a.id) && mol.incidentBonds(a.id).every((b) => mol.bond(b).order === 1)
      && mol.neighbours(a.id).some((o) => el(mol, o) === 'O' && mol.neighbours(o).length === 1 && mol.atom(o).charge === 0));
    if (ns.length !== 1) return null;
    const n = ns[0]!.id;
    const cs = mol.neighbours(n).filter((x) => el(mol, x) !== 'O');
    if (!cs.length || cs.some((x) => el(mol, x) !== 'C') || mol.neighbours(n).length !== cs.length + 1) return null;
    const subs = countSubs(cs.map((x) => this.substituent(x, n)));
    const text = subs.length === 1 && subs[0]!.n === 2 ? `N,N-di${subs[0]!.complex ? `(${subs[0]!.text})` : subs[0]!.text}` : subs.map((x) => `N-${x.complex ? `(${x.text})` : x.text}`).join('-');
    return `${text}hydroxylamine`;
  }

  /** A secondary or tertiary amine with like groups and nothing more senior: dipropylamine, triphenylamine. */
  symmetricAmine(): string | null {
    if (this.principal !== 'amine' || this.principalGroups.length !== 1) return null;
    const mol = this.mol, n = this.principalGroups[0]!.nitrogen!;
    if (this.an.ringAtoms.has(n) || mol.atom(n).charge) return null;
    const nb = mol.neighbours(n);
    if (nb.length < 2 || nb.some((x) => el(mol, x) !== 'C')) return null;
    const subs = nb.map((x) => this.substituent(x, n));
    if (new Set(subs.map((x) => x.text)).size !== 1) return null;
    const r = subs[0]!;
    return `${r.complex ? `${complexMultiplier(nb.length)}(${r.text})` : `${multiplier(nb.length)}${r.text}`}amine`;
  }

  /** A sulfoximine with nothing more senior: imino(methyl)(phenyl)-λ6-sulfanone, methyl(methylimino)(phenyl)-λ6-sulfanone. */
  sulfoximineName(): string | null {
    if (this.principal) return null;
    const mol = this.mol;
    const ss = [...mol.atoms()].filter((a) => a.element === 'S' && !this.an.ringAtoms.has(a.id) && mol.neighbours(a.id).length === 4 && a.charge === 0);
    if (ss.length !== 1) return null;
    const sx = ss[0]!.id;
    const nb = mol.neighbours(sx);
    const o = nb.filter((x) => el(mol, x) === 'O' && mol.bondBetween(sx, x)!.order === 2 && mol.neighbours(x).length === 1);
    const n = nb.filter((x) => el(mol, x) === 'N' && mol.bondBetween(sx, x)!.order === 2 && !this.an.ringAtoms.has(x));
    const c = nb.filter((x) => el(mol, x) === 'C' && mol.bondBetween(sx, x)!.order === 1);
    if (o.length !== 1 || n.length !== 1 || c.length !== 2) return null;
    const nr = mol.neighbours(n[0]!).filter((x) => x !== sx);
    if (nr.length > 1) return null;
    const imino: SubName = nr.length ? (() => { const r = this.substituent(nr[0]!, n[0]!); const t = `${wrapInner(r)}imino`; return { text: t, complex: true, sortKey: sortKeyOf(t) }; })()
      : { text: 'imino', complex: false, sortKey: 'imino' };
    const subs = [imino, ...c.map((x) => this.substituent(x, sx))];
    const rs = this.rs.get(sx);
    if (rs) this.cited.add(sx);
    return `${rs ? `(${rs})-` : ''}${citeRun(countSubs(subs))}-λ6-sulfanone`;
  }

  /** A carbodiimide with nothing more senior: dicyclohexylmethanediimine. */
  carbodiimideName(): string | null {
    if (this.principal) return null;
    const mol = this.mol;
    const cs = [...mol.atoms()].filter((c) => c.element === 'C' && !this.an.ringAtoms.has(c.id) && mol.neighbours(c.id).length === 2
      && mol.incidentBonds(c.id).every((b) => mol.bond(b).order === 2 && el(mol, mol.otherAtom(mol.bond(b), c.id)) === 'N'));
    if (cs.length !== 1) return null;
    const c = cs[0]!.id;
    const rs = mol.neighbours(c).map((n) => mol.neighbours(n).filter((x) => x !== c));
    if (rs.some((r) => r.length !== 1 || el(mol, r[0]!) !== 'C')) return null;
    const subs = rs.map((r, i) => this.substituent(r[0]!, mol.neighbours(c)[i]!));
    return `${citeRun(countSubs(subs))}methanediimine`;
  }

  /** Cyanamide and its N-substituted forms, where nothing more senior is present: N,N-dimethylcyanamide. */
  cyanamideName(): string | null {
    const mol = this.mol;
    if (this.principal !== 'nitrile' && this.principal !== 'amine') return null;
    const nitriles = this.an.groups.filter((g) => g.kind === 'nitrile');
    if (nitriles.length !== 1 || this.an.groups.some((g) => g.kind !== 'nitrile' && g.kind !== 'amine')) return null;
    const c = nitriles[0]!.anchor;
    const n = mol.neighbours(c).find((x) => el(mol, x) === 'N' && mol.bondBetween(c, x)!.order === 1);
    if (n === undefined || this.an.ringAtoms.has(n) || mol.atom(n).charge) return null;
    if (this.an.groups.some((g) => g.kind === 'amine' && g.nitrogen !== n)) return null;
    const subs = mol.neighbours(n).filter((x) => x !== c).map((x) => this.substituent(x, n));
    if (!subs.length) return 'cyanamide';
    const counted = countSubs(subs);
    if (counted.length === 1 && counted[0]!.n === 2) return `N,N-di${counted[0]!.complex ? `(${counted[0]!.text})` : counted[0]!.text}cyanamide`;
    return `${counted.map((x) => `N-${x.complex ? `(${x.text})` : x.text}`).join('-')}cyanamide`;
  }

  /** "(R)-" for a heteroatom centre that is a stereocentre: (R)-ethyl(methyl)(phenyl)phosphane. */
  centreStereo(id: AtomId): string {
    const rs = this.rs.get(id);
    if (!rs) return '';
    this.cited.add(id);
    return `(${rs})-`;
  }

  /** "tert-butyldimethyl", "triphenyl": substituents on a heteroatom centre, alphabetical, multiplied. */
  groupedSubs(atoms: readonly AtomId[], centre: AtomId): string {
    // Traditional prefixes need no brackets here: tert-butyldimethylsilyl.
    return citeRun(countSubs(atoms.map((n) => this.substituent(n, centre))));
  }

  name(): string {
    const nitrate = this.nitrateEster();
    if (nitrate) return nitrate;
    const aa = this.aminoAcidName();
    if (aa) return aa;
    if (this.principal === 'ester' || this.principal === 'sulfonateEster') return this.nameEster();
    if (this.principal === 'urea' && this.principalGroups.length === 1) return this.nameUrea(this.principalGroups[0]!);
    const guanidine = this.guanidine();
    if (guanidine) return guanidine;
    // Two ureas in one structure: there is no rule here for which is the urea and what the other is called.
    if (this.principal === 'urea') throw new OutOfScope('more than one urea');
    const mult = this.multiplicativeName();
    if (mult) return mult;
    const best = this.chooseParent();
    return this.withStereo(best.parent.atoms, best.numbering, this.render(best.parent, best.numbering)) + this.oxideSuffix(best.parent.atoms, best.numbering);
  }

  /**
   * Identical units joined through a linker, named once and multiplied, where that gives the parent more
   * principal groups (or, with none, more of the senior ring) than any single parent:
   * (5-hydroxy-6-methylpyridine-3,4-diyl)dimethanol, 2,2'-(propane-2,2-diyl)bis(4-phenyl-4,5-dihydrooxazole),
   * 2,2'-(ethane-1,2-diylbis(oxy))bis(ethan-1-ol), 2,2',2'',2'''-(ethane-1,2-diylbis(azanetriyl))tetraacetic acid.
   */
  multiplicativeName(): string | null {
    const mol = this.mol;
    if (this.principal && !['acid', 'carboxylate', 'amide', 'nitrile', 'aldehyde', 'ketone', 'alcohol', 'thiol', 'amine'].includes(this.principal)) return null;
    let normal: { parent: Parent; numbering: Numbering };
    try { normal = this.chooseParent(); } catch (e) { if (e instanceof OutOfScope) return null; throw e; }
    const normalCount = this.principalSites(normal.parent).size;
    // Units: for each principal site the longest chain holding it alone; or rings of one name.
    const units: Parent[] = [];
    if (this.principal) {
      const chains = this.chainCandidates();
      for (const g of this.principalGroups) {
        const own = chains.filter((c) => { const st = this.principalSites(c); return st.size === 1 && st.has(g); });
        own.sort((x, y) => y.atoms.length - x.atoms.length);
        // A group's own carbon on a ring (a benzoic acid, a benzimidamide) goes with the ring.
        const onRing = g.ownCarbon && mol.neighbours(g.anchor).some((x) => this.an.ringAtoms.has(x)) && own[0]?.atoms.length === 1;
        if (own[0] && !onRing) units.push(own[0]);
        else for (const r of this.ringCandidates()) if (!r.ring?.assembly && this.principalSites(r).has(g) && !units.includes(r)) units.push(r);
      }
    } else {
      const senior = normal.parent;
      if (senior.kind !== 'ring' || senior.ring?.kind !== 'template' || senior.ring.assembly) return null;
      for (const r of this.ringCandidates()) if (!r.ring?.assembly && r.ring?.kind === 'template' && r.ring.template?.name === senior.ring.template?.name && !r.ring.hydro === !senior.ring.hydro) units.push(r);
    }
    const unique = units.filter((u, i) => units.findIndex((v) => v.atoms.length === u.atoms.length && v.atoms.every((x) => u.atoms.includes(x))) === i);
    // The largest set of units of one kind.
    const sig = (u: Parent) => `${u.kind}|${u.atoms.length}|${u.ring?.template?.name ?? ''}|${this.principalSites(u).size}`;
    const bySig = new Map<string, Parent[]>();
    for (const u of unique) bySig.set(sig(u), [...(bySig.get(sig(u)) ?? []), u]);
    const distinct = [...bySig.values()].sort((x, y) => y.length - x.length)[0] ?? [];
    if (distinct.length < 2) return null;
    if (distinct.some((u, i) => distinct.some((v, j) => j > i && u.atoms.some((x) => v.atoms.includes(x))))) return null;
    const perUnit = this.principal ? this.principalSites(distinct[0]!).size : 0;
    if (this.principal && distinct.length * perUnit <= normalCount) return null;
    // The linker: what lies on the paths between units, with whatever hangs off it.
    const inUnit = new Map<AtomId, number>();
    distinct.forEach((u, i) => u.atoms.forEach((x) => inUnit.set(x, i)));
    const path = (from: AtomId[], to: Set<AtomId>): AtomId[] | null => {
      const prev = new Map<AtomId, AtomId>(), q = [...from];
      for (const f of from) prev.set(f, f);
      while (q.length) {
        const x = q.shift()!;
        if (to.has(x)) { const out: AtomId[] = []; for (let y = prev.get(x)!; !from.includes(y); y = prev.get(y)!) out.push(y); return out; }
        for (const y of mol.neighbours(x)) if (!prev.has(y) && (!inUnit.has(y) || to.has(y))) { prev.set(y, x); q.push(y); }
      }
      return null;
    };
    const core = new Set<AtomId>();
    for (let i = 1; i < distinct.length; i++) {
      const pth = path(distinct[0]!.atoms, new Set(distinct[i]!.atoms));
      if (!pth || !pth.length) return null;
      pth.forEach((x) => core.add(x));
    }
    // Everything not reached from a unit without crossing the linker core belongs to the linker.
    const unitOf = new Map<AtomId, number>();
    distinct.forEach((u, i) => {
      const stack = [...u.atoms];
      for (const x of u.atoms) unitOf.set(x, i);
      while (stack.length) { const x = stack.pop()!; for (const y of mol.neighbours(x)) if (!core.has(y) && !unitOf.has(y)) { unitOf.set(y, i); stack.push(y); } }
    });
    if ([...unitOf.keys()].some((x) => core.has(x))) return null;
    const linker = [...mol.atoms()].map((a) => a.id).filter((x) => !unitOf.has(x));
    // The linker holds no part of a principal group (a diarylamine's N is its amine, not a linker).
    if (this.principalGroups.some((g) => g.nitrogen !== undefined && linker.includes(g.nitrogen))) return null;
    // Each unit hangs off the linker by one bond, from an atom of its parent.
    const joins: { unit: number; u: AtomId; l: AtomId }[] = [];
    for (const x of linker) for (const y of mol.neighbours(x)) if (unitOf.has(y)) joins.push({ unit: unitOf.get(y)!, u: y, l: x });
    if (joins.length !== distinct.length || new Set(joins.map((j) => j.unit)).size !== distinct.length) return null;
    if (joins.some((j) => !distinct[j.unit]!.atoms.includes(j.u) || mol.bondBetween(j.u, j.l)!.order !== 1)) return null;
    // The units must be the same: each with its attachment marked.
    const unitMol = (i: number) => {
      const m = mol.clone();
      for (const a of [...m.atoms()]) if (unitOf.get(a.id) !== i) m.removeAtom(a.id);
      const j = joins.find((x) => x.unit === i)!;
      m.addBond({ begin: j.u, end: m.addAtom({ element: 'Xe', x: 0, y: 0, explicitHydrogens: 0 }).id, order: 1 });
      return m;
    };
    const ums = distinct.map((_, i) => unitMol(i));
    const maps: Map<AtomId, AtomId>[] = [];
    for (let i = 1; i < ums.length; i++) { const it = isomorphisms(ums[0]!, ums[i]!).next(); if (it.done) return null; maps.push(it.value); }
    // Name the linker, then the first unit with the linker left out of its prefixes.
    const linkerName = this.linkerName(linker, joins.map((j) => j.l));
    if (!linkerName) return null;
    const P = distinct[0]!, j0 = joins.find((j) => j.unit === 0)!;
    this.excluded.add(j0.l);
    let unitName: string, numbering: Numbering, unitPrefixes = 0;
    try {
      const sites = this.principalSites(P);
      let best: { n: Numbering; key: (number | number[])[] } | null = null;
      for (const n of P.numberings) {
        // The unit's own groups first, then its point of attachment: 4,4'-(...)bis(chlorobenzene).
        const key = [[...sites.values()].map((x) => locVal(n.get(x)!)).sort((x, y) => x - y),
          this.prefixes(P, sites).filter((x) => x.at !== 'N').map((x) => locVal(n.get(x.at as AtomId)!)).sort((x, y) => x - y), locVal(n.get(j0.u)!)];
        if (!best || cmpKey(key, best.key) < 0) best = { n, key };
      }
      numbering = best!.n;
      unitPrefixes = this.prefixes(P, sites).length;
      unitName = this.render(P, numbering);
    } catch (e) { this.excluded.delete(j0.l); if (e instanceof OutOfScope) return null; throw e; }
    this.excluded.delete(j0.l);
    // Configurations in the unit's own parent, cited for every unit with primes; those in its prefixes
    // stand for each unit inside bis(...).
    const items: [string, string][] = [];
    const cited0 = [...this.cited].filter((x) => unitOf.get(x) === 0);
    distinct.forEach((_, i) => {
      const map = i === 0 ? new Map(P.atoms.map((x) => [x, x])) : maps[i - 1]!;
      for (const x of P.atoms) { const y = map.get(x)!; const l = this.rs.get(y); if (l) { items.push([`${numbering.get(x)}${"'".repeat(i)}`, l]); this.cited.add(y); } }
      if (i > 0) for (const x of cited0) { const y = map.get(x); if (y !== undefined) this.cited.add(y); }
    });
    if ([...mol.bonds()].some((b) => this.ez.get(`${b.begin}-${b.end}`) && unitOf.has(b.begin) && P.atoms.includes(b.begin) && P.atoms.includes(b.end))) return null;
    items.sort((x, y) => compareLocant(x[0], y[0]));
    const stereo = items.length ? `(${items.map(([l, d]) => `${l}${d}`).join(',')})-` : '';
    const n = distinct.length;
    // Propanoic acid multiplied goes by its old name: 3,3'-(...diyl)dipropionic acid.
    if (unitName === 'propanoic acid') unitName = 'propionic acid';
    const simple = !unitPrefixes && !/[\d()[\]]/.test(unitName) && !unitName.includes('-');
    const body = simple ? `${multiplier(n)}${unitName}` : `${complexMultiplier(n)}(${unitName})`;
    // A one-carbon unit, or a benzene ring with nothing else on it, needs no locants: oxydibenzene.
    const oneCarbon = (P.kind === 'chain' && P.atoms.length === 1) || unitName === 'benzene';
    const locs = oneCarbon ? '' : `${Array.from({ length: n }, (_, i) => `${numbering.get(j0.u)}${"'".repeat(i)}`).join(',')}-`;
    const bare = /^(oxy|thio|methylene|carbonyl|sulfonyl|sulfinyl|disulfanediyl)$/.test(linkerName);
    return `${stereo}${locs}${bare ? linkerName : `(${linkerName})`}${body}`;
  }

  /**
   * A linker of a multiplicative name: oxy, azanediyl, methylene, propane-2,2-diyl, ethane-1,2-diyl,
   * ethane-1,2-diylbis(oxy), (4S,5S)-2,2-dimethyl-1,3-dioxolane-4,5-diyl. `ends` are the linker atoms
   * the units hang from (repeated where two hang from one).
   */
  linkerName(atoms: AtomId[], ends: AtomId[]): string | null {
    const mol = this.mol;
    const inL = new Set(atoms);
    const valence = (x: AtomId) => ends.filter((e) => e === x).length;
    // A sulfonyl, sulfinyl or carbonyl bridge: 4,4'-sulfonyldianiline.
    const oxo = (x: AtomId) => mol.neighbours(x).filter((y) => el(mol, y) === 'O' && mol.bondBetween(x, y)!.order === 2 && mol.neighbours(y).length === 1);
    const centre = atoms.filter((x) => !(el(mol, x) === 'O' && mol.neighbours(x).length === 1));
    if (centre.length === 1 && valence(centre[0]!) >= 2 && atoms.length === 1 + oxo(centre[0]!).length) {
      const x = centre[0]!, k = oxo(x).length, e = el(mol, x);
      if (e === 'S' && k === 2) return 'sulfonyl';
      if (e === 'S' && k === 1) return 'sulfinyl';
      if (e === 'C' && k === 1) return 'carbonyl';
    }
    // Disulfanediyl: 3,3'-disulfanediyldipropanoic acid.
    if (atoms.length === 2 && atoms.every((x) => el(mol, x) === 'S' && valence(x) === 1 && mol.atom(x).charge === 0) && mol.bondBetween(atoms[0]!, atoms[1]!)?.order === 1) return 'disulfanediyl';
    // Diazene-1,2-diyl, with its E or Z.
    if (atoms.length === 2 && atoms.every((x) => el(mol, x) === 'N' && valence(x) === 1) && mol.bondBetween(atoms[0]!, atoms[1]!)?.order === 2) {
      const ez = this.ez.get(`${atoms[0]}-${atoms[1]}`);
      return `${ez ? `(${ez})-` : ''}diazene-1,2-diyl`;
    }
    if (atoms.length === 1) {
      const x = atoms[0]!, e = el(mol, x), v = valence(x);
      if (e === 'O' && v === 2) return 'oxy';
      if (e === 'S' && v === 2) return 'thio';
      if (e === 'N' && mol.atom(x).charge === 0) return v === 2 && mol.implicitHydrogens(x) === 1 ? 'azanediyl' : v === 3 ? 'azanetriyl' : null;
      if (e === 'C' && v === 2 && mol.implicitHydrogens(x) === 2) return 'methylene';
    }
    // One nitrogen all the units hang from, with groups of its own: (phenylazanediyl).
    const one = [...new Set(ends)];
    if (one.length === 1 && el(mol, one[0]!) === 'N' && mol.atom(one[0]!).charge === 0 && valence(one[0]!) === 2) {
      const x = one[0]!;
      const own = mol.neighbours(x).filter((y) => inL.has(y));
      if (own.length && own.every((y) => mol.bondBetween(x, y)!.order === 1)) return `${citeRun(countSubs(own.map((y) => this.substituent(y, x))))}azanediyl`;
    }
    // Heteroatom bridges at each end, the same at all: ethane-1,2-diylbis(oxy).
    const endSet = [...new Set(ends)];
    const bridge = endSet.every((x) => ['O', 'S', 'N'].includes(el(mol, x)) && !this.an.ringAtoms.has(x)) && new Set(endSet.map((x) => `${el(mol, x)}${valence(x)}`)).size === 1;
    if (bridge && endSet.length >= 2) {
      const coreAtoms = atoms.filter((x) => !endSet.includes(x));
      const coreEnds = endSet.map((x) => mol.neighbours(x).find((y) => inL.has(y) && !endSet.includes(y)));
      if (coreEnds.some((x) => x === undefined) || endSet.some((x) => mol.neighbours(x).filter((y) => inL.has(y)).length !== 1)) return null;
      const coreName = this.coreDiyl(coreAtoms, coreEnds as AtomId[]);
      if (!coreName) return null;
      const e = el(mol, endSet[0]!), v = valence(endSet[0]!);
      const word = e === 'O' ? 'oxy' : e === 'S' ? 'thio' : v === 1 && mol.implicitHydrogens(endSet[0]!) === 1 ? 'azanediyl' : v === 2 ? 'azanetriyl' : null;
      if (!word) return null;
      return `${coreName}${complexMultiplier(endSet.length)}(${word})`;
    }
    return this.coreDiyl(atoms, ends);
  }

  /** A ring or chain with several free valences: 1,3-dioxolane-4,5-diyl, propane-2,2-diyl, ethane-1,2-diyl. */
  coreDiyl(atoms: AtomId[], ends: AtomId[]): string | null {
    const mol = this.mol;
    const inL = new Set(atoms);
    let parent: Parent | null = null;
    const ringSys = this.an.ringSystems.find((sys) => sys.every((x) => inL.has(x)) && ends.every((e) => sys.includes(e)));
    if (ringSys) {
      const r = recognizeRing(this.an, ringSys);
      if (!r) return null;
      parent = { kind: 'ring', atoms: ringSys, numberings: r.numberings, ring: r.info };
    } else {
      if (atoms.some((x) => this.an.ringAtoms.has(x) && !ends.includes(x))) { /* rings hang off: prefixes */ }
      const carbons = atoms.filter((x) => el(mol, x) === 'C' && !this.an.ringAtoms.has(x));
      if (!ends.every((e) => carbons.includes(e))) return null;
      const chains = this.chainCandidates().filter((c) => c.atoms.every((x) => inL.has(x)) && ends.every((e) => c.atoms.includes(e)));
      chains.sort((x, y) => y.atoms.length - x.atoms.length || this.unsaturationAtoms(y).mult.length - this.unsaturationAtoms(x).mult.length);
      parent = chains[0] ?? null;
    }
    if (!parent) return null;
    const pre: Prefix[] = [];
    for (const a of parent.atoms) for (const b of mol.incidentBonds(a)) {
      const bd = mol.bond(b), n = mol.otherAtom(bd, a);
      if (parent.atoms.includes(n) || !inL.has(n)) continue;
      if (bd.order === 2) { pre.push({ ...this.ylidene(n, a), at: a }); continue; }
      if (bd.order !== 1) return null;
      pre.push({ ...this.substituent(n, a), at: a });
    }
    // Ring oxides on a linker are prefixes, as on any ring substituent: 3,12-dioxido.
    for (const x of parent.atoms) for (let i = this.oxides.get(x) ?? 0; i > 0; i--) pre.push({ text: 'oxido', complex: false, sortKey: 'oxido', at: x });
    const { dbl, trip, mult } = this.unsaturationAtoms(parent);
    let best: { n: Numbering; key: (number | number[])[] } | null = null;
    for (const n of parent.numberings) {
      const h = hydroOf.get(n);
      const key = [(h?.ih ?? []).map((x) => locVal(n.get(x)!)).sort((x, y) => x - y), ends.map((x) => locVal(n.get(x)!)).sort((x, y) => x - y),
        [...(h?.hydro ?? [])].map((x) => locVal(n.get(x)!)).sort((x, y) => x - y),
        mult.map((bd) => this.bondLocant(parent!, n, bd)).sort((x, y) => x - y), pre.map((x) => locVal(n.get(x.at as AtomId)!)).sort((x, y) => x - y)];
      if (!best || cmpKey(key, best.key) < 0) best = { n, key };
    }
    const n = best!.n;
    const preText = this.prefixString(pre, n, false);
    const hyd = this.hydrideName(parent, n, dbl, trip, false);
    const locs = ends.map((x) => n.get(x)!).sort(compareLocant);
    const stereo = this.stereoPrefix(parent.atoms, n);
    const text = `${preText}${preText && /^[0-9([]/.test(hyd) ? '-' : ''}${hyd}-${locs.join(',')}-${multiplier(locs.length)}yl`;
    return stereo ? `${stereo}-${text}` : text;
  }

  /**
   * An alpha-amino acid whose own carboxyl is the principal group, named on the amino acid with what is
   * on its nitrogen in front: (tert-butoxycarbonyl)-L-alanine, methylglycine, N-carbamimidoyl-N-methylglycine,
   * methyl (tert-butoxycarbonyl)-L-phenylalanyl-L-alaninate, ((S)-3-mercapto-2-methylpropanoyl)-L-proline.
   */
  aminoAcidName(): string | null {
    const cited = new Set(this.cited), resCited = new Set(this.residueCited);
    const name = this.aminoAcidNameInner();
    if (!name) {
      this.cited.clear(); for (const a of cited) this.cited.add(a);
      this.residueCited.clear(); for (const a of resCited) this.residueCited.add(a);
    }
    return name;
  }

  aminoAcidNameInner(): string | null {
    const kind = this.principal;
    if (kind !== 'acid' && kind !== 'ester' && kind !== 'carboxylate') return null;
    const mol = this.mol;
    const groups = this.principalGroups;
    for (const g of groups) {
      if (!g.ownCarbon) continue;
      const c = g.anchor;
      const ca = mol.neighbours(c).find((x) => el(mol, x) === 'C' && mol.bondBetween(c, x)!.order === 1);
      if (ca === undefined) continue;
      const res = this.residueAt(ca, c);
      if (!res) continue;
      const word = kind === 'acid' ? res.ref.free : res.ref.free.replace(/ic acid$/, 'ate').replace(/ine$/, 'inate').replace(/an$/, 'anate');
      this.sides = [];
      const body = this.residueText(res, word);
      if (!body) continue;
      // Every other principal group in a side chain of the residues named (glutamic acid's); another
      // ester only as a carbamate on a nitrogen (Boc).
      const inSide = (x: AtomId) => this.sides.some((sd) => sd.has(x));
      if (groups.some((h) => h !== g && !inSide(h.anchor) && !(kind === 'ester' && mol.neighbours(h.anchor).some((x) => el(mol, x) === 'N')))) continue;
      if (kind === 'ester') {
        const alkyl = this.substituent(g.esterCarbon!, g.consumed[1]!);
        return `${alkyl.text} ${body}`;
      }
      return body;
    }
    return null;
  }

  /** The amino acid an alpha carbon is part of, with its N and the configuration it has, if it is one with a name. */
  residueAt(ca: AtomId, c: AtomId): { ref: ResidueRef; n: AtomId; ca: AtomId; side: Set<AtomId>; cfg: string } | null {
    const mol = this.mol;
    if (this.an.ringAtoms.has(c)) return null;
    for (const n of mol.neighbours(ca)) {
      if (el(mol, n) !== 'N' || mol.atom(n).charge !== 0 || mol.bondBetween(ca, n)!.order !== 1) continue;
      if (!mol.incidentBonds(n).every((b) => mol.bond(b).order === 1)) continue;
      const mine = sideChain(mol, ca, n, c);
      for (const ref of residues()) {
        if (ref.side.atomCount !== mine.side.atomCount) continue;
        // Bonds from the side chain back to N (proline's ring) must be the same too.
        const backN = (m: Molecule, atoms: Iterable<AtomId>, nn: AtomId, alpha: AtomId) => [...atoms].filter((x) => x !== alpha && m.bondBetween(x, nn)).length;
        const refBack = backN(ref.mol, ref.sideMap.keys(), ref.n, ref.ca);
        if (refBack !== backN(mol, mine.atoms, n, ca)) continue;
        // Only a residue whose N is in its own ring (proline) has it in a ring.
        if (this.an.ringAtoms.has(n) && !refBack) continue;
        for (const map of isomorphisms(ref.side, mine.side)) {
          if (map.get(ref.ca) !== ca) continue;
          // Configurations: the alpha carbon gives L or D; side-chain centres must agree with it.
          let cfg = '';
          if (!ref.achiral) {
            const want = rsLabel(ref.mol, ref.ca), got = this.rs.get(ca);
            // Drawn without its configuration: the amino acid's name alone (phenylalanine).
            if (want && !got && ![...map.values()].some((y) => this.rs.get(y)) && ![...map.keys()].some((x) => x !== ref.ca && rsLabel(ref.mol, x))) return { ref, n, ca, side: mine.atoms, cfg: '' };
            if (!want || !got) return null;
            const d = want !== got;
            cfg = d ? 'D-' : 'L-';
            for (const [x, y] of map) {
              if (x === ref.ca) continue;
              const w = rsLabel(ref.mol, x), gy = this.rs.get(y);
              if ((w ?? null) === null && !gy) continue;
              if (!w || !gy || (w !== gy) !== d) return null;
            }
          } else if (this.rs.get(ca)) return null;
          return { ref, n, ca, side: mine.atoms, cfg };
        }
      }
    }
    return null;
  }

  /**
   * An amino acid with what is on its nitrogen: the residue's word with prefixes for the N's groups,
   * an aminoacyl group named as a residue in turn (L-alanyl-L-proline). Null where a group is not plain.
   */
  residueText(res: { ref: ResidueRef; n: AtomId; ca: AtomId; side: Set<AtomId>; cfg: string }, word: string): string | null {
    const mol = this.mol;
    const subs = mol.neighbours(res.n).filter((x) => x !== res.ca && !res.side.has(x));
    const parts: { text: string; complex: boolean; sortKey: string; residue?: boolean }[] = [];
    for (const x of subs) {
      // An aminoacyl group: C(=O) on another amino acid's alpha carbon.
      if (el(mol, x) === 'C' && !this.an.ringAtoms.has(x) && mol.neighbours(x).some((o) => el(mol, o) === 'O' && mol.bondBetween(x, o)!.order === 2)) {
        const ca2 = mol.neighbours(x).find((y) => y !== res.n && el(mol, y) === 'C' && mol.bondBetween(x, y)!.order === 1);
        const inner = ca2 === undefined ? null : this.residueAt(ca2, x);
        if (inner && inner.ref.acyl && !inner.side.has(res.n)) {
          const t = this.residueText(inner, inner.ref.acyl);
          if (!t) return null;
          parts.push({ text: t, complex: true, sortKey: sortKeyOf(t), residue: true });
          continue;
        }
      }
      try { parts.push(this.substituent(x, res.n)); } catch (e) { if (e instanceof OutOfScope) return null; throw e; }
    }
    for (const a of [res.ca, ...res.side]) if (this.rs.get(a)) { this.cited.add(a); this.residueCited.add(a); }
    this.sides.push(res.side);
    const tail = `${res.cfg}${word}`;
    const join = (a: string, b: string) => a + (/^([DL]|[αβ])-/.test(b) ? '-' : '') + b;
    if (!parts.length) return tail;
    if (parts.length === 1) {
      const p0 = parts[0]!;
      return join(p0.residue || !p0.complex ? p0.text : `(${p0.text})`, tail);
    }
    if (parts.some((p) => p.residue && parts.length > 1 && false)) return null;
    parts.sort((x, y) => x.sortKey.localeCompare(y.sortKey));
    if (parts.length === 2 && parts[0]!.text === parts[1]!.text) return join(`N,N-${parts[0]!.complex ? `bis(${parts[0]!.text})` : `di${parts[0]!.text}`}`, tail);
    return join(parts.map((p) => `N-${p.complex ? `(${p.text})` : p.text}`).join('-'), tail);
  }

  /** " 1,1-dioxide" for the parent's ring atoms that carry =O. */
  oxideSuffix(atoms: readonly AtomId[], numbering: Numbering): string {
    const locs = atoms.flatMap((a) => Array<string>(this.oxides.get(a) ?? 0).fill(numbering.get(a)!)).sort(compareLocant);
    return locs.length ? ` ${locs.join(',')}-${multiplier(locs.length)}oxide` : '';
  }

  /**
   * Stereodescriptors for a parent or substituent skeleton, cited in front:
   * "(S)-" for a single one, "(2R,3S)-" with locants when there are several.
   */
  stereoPrefix(atoms: AtomId[], numbering: Numbering, from?: AtomId): string {
    const items: [string, string][] = [];
    const inSet = new Set(atoms);
    for (const a of atoms) { const l = this.rs.get(a); if (l) { items.push([numbering.get(a)!, l]); this.cited.add(a); } }
    // The sulfur of a sulfinic group on this skeleton: (R)-2-methylpropane-2-sulfinamide.
    for (const g of this.principalGroups) {
      const sx = g.sulfin ? g.consumed[0]! : undefined, l = sx !== undefined ? this.rs.get(sx) : undefined;
      if (sx !== undefined && l && inSet.has(g.anchor)) { items.push([numbering.get(g.anchor)!, l]); this.cited.add(sx); }
    }
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
      // From a heteroatom of this skeleton to a carbon group (a ring N+=CH-Ar): the group cites it, as above.
      if (outside !== from && el(this.mol, inside) !== 'C' && el(this.mol, outside) === 'C' && !inSet.has(outside) && this.mol.neighbours(outside).length > 1) continue;
      items.push([numbering.get(inside)!, l]);
    }
    if (!items.length) return '';
    // A lone descriptor of its kind goes without its locant, (2S,3R,E), only where nothing else in the
    // skeleton could take it: beside a centre left unspecified, a bare "(S)" would not say which one is meant.
    // ... only beside one of its own kind: a lone (Z) cannot mean a centre.
    const open = this.openStereoKinds(atoms);
    const rs = items.filter(([, d]) => /^[RSrs]$/.test(d)).sort((p, q) => compareLocant(p[0], q[0]));
    const ez = items.filter(([, d]) => d === 'E' || d === 'Z').sort((p, q) => compareLocant(p[0], q[0]));
    const cite = (xs: [string, string][], openHere: boolean) => xs.map(([l, d]) => (xs.length === 1 && !openHere ? d : `${l}${d}`));
    return `(${[...cite(rs, open.centre), ...cite(ez, open.bond)].join(',')})`;
  }

  /** Which kinds of stereo element the skeleton holds that could have a configuration but were given none. */
  openStereoKinds(atoms: AtomId[]): { centre: boolean; bond: boolean } {
    const inSet = new Set(atoms);
    const centre = atoms.some((a) => this.openCentre(a));
    let bond = false;
    for (const b of this.mol.bonds()) if ((inSet.has(b.begin) || inSet.has(b.end)) && this.openBond(b.id)) { bond = true; break; }
    return { centre, bond };
  }

  /** Does the skeleton hold a centre or double bond that could have a configuration but was given none? */
  openStereo(atoms: AtomId[]): boolean {
    const inSet = new Set(atoms);
    if (atoms.some((a) => this.openCentre(a))) return true;
    for (const b of this.mol.bonds()) if ((inSet.has(b.begin) || inSet.has(b.end)) && this.openBond(b.id)) return true;
    return false;
  }

  // Whether an atom or a bond could have a configuration is asked for every candidate parent and
  // group, and each answer takes a CIP ranking: it is worked out once.
  #probe: Molecule | null = null;
  #smallRings: ReturnType<typeof perceiveRings> | null = null;
  readonly #openCentres = new Map<AtomId, boolean>();
  readonly #openBonds = new Map<number, boolean>();

  /** An atom with no configuration given that could have one. */
  openCentre(a: AtomId): boolean {
    const known = this.#openCentres.get(a);
    if (known !== undefined) return known;
    const mol = this.mol;
    let could = false;
    const nb = mol.neighbours(a), h = mol.implicitHydrogens(a), charge = mol.atom(a).charge;
    const e = el(mol, a);
    if (!this.rs.get(a) && (e === 'P' || e === 'S' || mol.incidentBonds(a).every((b) => mol.bond(b).order === 1))) {
      // Carbon or silicon with four different groups, a quaternary ammonium or phosphonium centre;
      // a ring nitrogen held in a three-membered ring.
      const carbon = nb.length + h === 4 && h <= 1 && (((e === 'C' || e === 'Si') && charge === 0) || ((e === 'N' || e === 'P') && charge === 1 && h === 0));
      // Phosphorus with three groups and its lone pair, or four with P=O; a sulfoxide or sulfonium sulfur.
      const hetero = h === 0 && ((e === 'P' && charge === 0 && (nb.length === 3 || nb.length === 4)) || (e === 'S' && nb.length === 3 && charge >= 0));
      const aziridine = e === 'N' && charge === 0 && nb.length === 3 && h === 0 && nb.some((x) => nb.some((y) => x !== y && mol.bondBetween(x, y)));
      if (carbon || aziridine || hetero) {
        const probe = (this.#probe ??= mol.clone());
        const before = probe.atom(a).chirality;
        probe.atom(a).chirality = { order: nb.length === 4 ? [...nb] : [nb[0]!, -1, ...nb.slice(1)], anticlockwise: true };
        could = rsLabel(probe, a) !== null;
        probe.atom(a).chirality = before;
        this.afterRanking();
      }
    }
    this.#openCentres.set(a, could);
    return could;
  }

  /** A double bond with no configuration given that could have one. */
  openBond(id: number): boolean {
    const known = this.#openBonds.get(id);
    if (known !== undefined) return known;
    const mol = this.mol;
    const b = mol.bond(id);
    let could = false;
    // A double bond in a ring of fewer than eight atoms has one form only.
    const rings = (this.#smallRings ??= perceiveRings(mol).filter((r) => r.atoms.length < 8));
    if (b.order === 2 && !this.ez.get(`${b.begin}-${b.end}`) && !rings.some((r) => r.atoms.includes(b.begin) && r.atoms.includes(b.end))) {
      const ra = mol.neighbours(b.begin).find((x) => x !== b.end), rb = mol.neighbours(b.end).find((x) => x !== b.begin);
      // C=N-H, its hydrogen not drawn, is left without a configuration, as chemists leave it.
      if (ra !== undefined && rb !== undefined) {
        const probe = (this.#probe ??= mol.clone());
        const pb = probe.bond(b.id), before = pb.ez;
        pb.ez = { ref: [ra, rb], cis: true };
        could = ezLabel(probe, b.id) !== null;
        pb.ez = before;
        this.afterRanking();
      }
    }
    this.#openBonds.set(id, could);
    return could;
  }

  withStereo(atoms: AtomId[], numbering: Numbering, name: string): string {
    const prefix = this.stereoPrefix(atoms, numbering);
    return prefix ? `${prefix}-${name}` : name;
  }

  // ------------------------------------------------------------ candidates

  /** Acyclic carbons usable in chains. */
  isChainCarbon(a: AtomId): boolean {
    const mol = this.mol;
    if (el(mol, a) !== 'C' || this.an.ringAtoms.has(a) || mol.atom(a).charge !== 0) return false;
    // The carbon of an isocyanate, isothiocyanate, cyanate or thiocyanate belongs to its prefix.
    const bs = mol.incidentBonds(a).map((b) => ({ o: mol.bond(b).order, e: el(mol, mol.otherAtom(mol.bond(b), a)) }));
    if (bs.length === 2 && bs.every((x) => x.o === 2) && bs.some((x) => x.e === 'N') && bs.some((x) => x.e === 'O' || x.e === 'S')) return false;
    if (bs.length === 2 && bs.some((x) => x.o === 3 && x.e === 'N') && bs.some((x) => x.o === 1 && (x.e === 'O' || x.e === 'S'))) return false;
    return true;
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
      const r = recognizeRing(this.an, system, this.principal === 'ketone' || (this.principal === 'imine' ? 'imine' : false));
      if (!r) throw new OutOfScope('ring system without a supported parent name');
      out.push({ kind: 'ring', atoms: system, numberings: r.numberings, ring: r.info });
    }
    // Two of the same ring joined by a bond are one parent: 1,1'-biphenyl, 2,2'-bipyridine.
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
      const asm = this.assembly(out[i]!, out[j]!);
      if (asm) out.push(asm);
    }
    // Three in a row: 1,1':4',1''-terphenyl, 2,2':6',2''-terpyridine.
    const singles = out.filter((p) => !p.ring?.assembly);
    for (const B of singles) for (const A of singles) for (const C of singles) {
      if (A === B || B === C || A.atoms[0]! >= C.atoms[0]!) continue;
      const ter = this.assembly3(A, B, C);
      if (ter) out.push(ter);
    }
    return out;
  }

  /** A ring assembly of three identical rings in a row, as a parent: primes '' on the third ring. */
  assembly3(A: Parent, B: Parent, C: Parent): Parent | null {
    const mol = this.mol;
    const t = [A, B, C].map((p) => p.ring?.template);
    if ([A, B, C].some((p) => p.ring?.kind !== 'template' || p.ring.hydro) || t.some((x) => !x || x.name !== t[0]!.name || x.indicatedH || !x.aromatic)) return null;
    const link = (P: Parent, Q: Parent) => {
      const inQ = new Set(Q.atoms);
      const ls = P.atoms.flatMap((a) => mol.neighbours(a).filter((n) => inQ.has(n)).map((n) => [a, n] as [AtomId, AtomId]));
      return ls.length === 1 && mol.bondBetween(ls[0]![0], ls[0]![1])!.order === 1 ? ls[0]! : null;
    };
    const ab = link(A, B), bc = link(B, C);
    if (!ab || !bc || link(A, C) || ab[1] === bc[0]) return null;
    let best: number[] | null = null;
    const numberings: Numbering[] = [];
    for (const [P, Q, R, pq, qr] of [[A, B, C, ab, bc], [C, B, A, [bc[1], bc[0]], [ab[1], ab[0]]]] as const) {
      for (const n1 of P.numberings) for (const n2 of Q.numberings) for (const n3 of R.numberings) {
        const key = [locVal(n1.get(pq[0])!), locVal(n2.get(pq[1])!), locVal(n2.get(qr[0])!), locVal(n3.get(qr[1])!)];
        const c = best ? cmpVec(key, best) : -1;
        if (c > 0) continue;
        if (c < 0) { best = key; numberings.length = 0; }
        numberings.push(new Map([...n1, ...[...n2].map(([k, v]) => [k, `${v}'`] as [AtomId, string]), ...[...n3].map(([k, v]) => [k, `${v}''`] as [AtomId, string])]));
      }
    }
    if (!numberings.length) return null;
    const n0 = numberings[0]!;
    const ends = [ab, bc].flat().map((x) => n0.get(x)!);
    const un = ends.find((l) => !l.includes("'"))!, dbl = ends.find((l) => l.endsWith("''"))!;
    const mids = ends.filter((l) => /[^']'$/.test(l)).sort(compareLocant);
    // The middle ring's locant beside the unprimed ring comes first.
    const first = n0.get(ab[0])!.includes("'") ? n0.get(bc[0])! : n0.get(ab[1])!;
    const second = mids.find((m) => m !== first) ?? mids[1]!;
    const body = t[0]!.name === 'benzene' ? 'phenyl' : /[[\]()]/.test(t[0]!.name) || /^\d/.test(t[0]!.name) ? `(${t[0]!.name})` : t[0]!.name;
    const fullName = `${un},${first}:${second},${dbl}-ter${body}`;
    const template: RingTemplate = { name: `[${fullName}]`, yl: `[${fullName}]`, smiles: '', locants: [], aromatic: true };
    return { kind: 'ring', atoms: [...A.atoms, ...B.atoms, ...C.atoms], numberings, ring: { ...A.ring!, template, size: A.atoms.length * 3, ringCount: (A.ring!.ringCount ?? 1) * 3, assembly: true } as RingInfo };
  }

  /**
   * A ring assembly of two identical rings joined by one single bond, as a parent: its numberings
   * put one ring's locants unprimed and the other's primed, the joined atoms as low as they go.
   */
  assembly(A: Parent, B: Parent, attach?: { a: AtomId }): Parent | null {
    const mol = this.mol;
    const ta = A.ring?.template, tb = B.ring?.template;
    if (A.ring?.kind !== 'template' || B.ring?.kind !== 'template' || !ta || !tb || ta.name !== tb.name || A.ring.hydro || B.ring.hydro) return null;
    if (ta.indicatedH || !ta.aromatic) return null;
    const inB = new Set(B.atoms);
    const links: [AtomId, AtomId][] = [];
    for (const a of A.atoms) for (const n of mol.neighbours(a)) if (inB.has(n)) links.push([a, n]);
    if (links.length !== 1 || mol.bondBetween(links[0]![0], links[0]![1])!.order !== 1) return null;
    const [la, lb] = links[0]!;
    const numberings: Numbering[] = [];
    let best = Infinity;
    for (const [first, second, fa, sb] of [[A, B, la, lb], [B, A, lb, la]] as const) {
      if (attach && !first.atoms.includes(attach.a)) continue;
      for (const n1 of first.numberings) for (const n2 of second.numberings) {
        const linkLocs = locVal(n1.get(fa)!) * 100 + locVal(n2.get(sb)!);
        if (linkLocs > best) continue;
        if (linkLocs < best) { best = linkLocs; numberings.length = 0; }
        numberings.push(new Map([...n1, ...[...n2].map(([k, v]) => [k, `${v}'`] as [AtomId, string])]));
      }
    }
    if (!numberings.length) return null;
    const n0 = numberings[0]!;
    const body = ta.name === 'benzene' ? 'phenyl' : /[[\]()]/.test(ta.name) || /^\d/.test(ta.name) ? `(${ta.name})` : ta.name;
    const name = `${n0.get(la) ?? n0.get(lb)},${n0.get(la)?.endsWith("'") ? n0.get(lb) : n0.get(lb)}-bi${body}`;
    const [l1, l2] = [n0.get(la)!, n0.get(lb)!].sort(compareLocant);
    const fullName = `${l1},${l2}-bi${body}`;
    void name;
    const template: RingTemplate = { name: `[${fullName}]`, yl: `[${fullName}]`, smiles: '', locants: [], aromatic: true };
    return { kind: 'ring', atoms: [...A.atoms, ...B.atoms], numberings, ring: { ...A.ring, template, size: A.atoms.length + B.atoms.length, ringCount: (A.ring.ringCount ?? 1) * 2, assembly: true } as RingInfo };
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
    // A chain holding none of its acids' own carbons carries them all as -carboxylic acid where that gives
    // it more of them: 2-hydroxypropane-1,2,3-tricarboxylic acid.
    if (p.kind === 'chain' && !sites.size) {
      const ext = new Map<Group, AtomId>();
      for (const g of this.principalGroups) {
        if (!g.ownCarbon || inP.has(g.anchor) || !['acid', 'carboxylate', 'ester', 'amide', 'nitrile'].includes(g.kind)) continue;
        const r = this.mol.neighbours(g.anchor).find((n) => inP.has(n));
        if (r !== undefined) ext.set(g, r);
      }
      if (ext.size >= 3) { this.externalSites.add(p); return ext; }
    }
    return sites;
  }
  readonly externalSites = new WeakSet<Parent>();

  /** Atoms that belong to principal groups placed on this parent (not to be named as prefixes). */
  consumedBy(p: Parent, sites: Map<Group, AtomId>): Set<AtomId> {
    const out = new Set<AtomId>();
    for (const g of sites.keys()) {
      g.consumed.forEach((a) => out.add(a));
      if ((p.kind === 'ring' || this.externalSites.has(p)) && g.ownCarbon) out.add(g.anchor);
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
        if (inP.has(n) || consumed.has(n) || this.excluded.has(n)) continue;
        if (bd.order === 2) { out.push({ ...this.ylidene(n, a), at: a }); continue; }
        if (bd.order !== 1) throw new OutOfScope('multiple bond leaving the parent');
        out.push({ ...this.substituent(n, a), at: a });
      }
    }
    // N-substituents of principal amines and amides.
    for (const g of sites.keys()) {
      if (!g.nitrogen) continue;
      const anchorC = g.kind === 'amine' || g.kind === 'aminium' ? sites.get(g)! : g.anchor;
      // Whose nitrogen it is, by the parent atom that carries the suffix: N1 of a ring's 1-carboxamide.
      const locAt = p.kind === 'ring' && g.ownCarbon ? sites.get(g)! : anchorC;
      // Every principal nitrogen cited at the same locant: two amines on one carbon, two carboxamides on one ring atom.
      const locOf = (o: Group) => { const c = o.kind === 'amine' || o.kind === 'aminium' ? sites.get(o)! : o.anchor; return p.kind === 'ring' && o.ownCarbon ? sites.get(o)! : c; };
      const gem = [...sites.keys()].filter((o) => o.nitrogen !== undefined && locOf(o) === locAt).map((o) => o.nitrogen!);
      for (const n of mol.neighbours(g.nitrogen)) {
        if (n === anchorC || g.consumed.includes(n)) continue;
        out.push({ ...(mol.bondBetween(g.nitrogen, n)!.order === 2 ? this.ylidene(n, g.nitrogen) : this.substituent(n, g.nitrogen)), at: 'N', nOf: locAt, nAtom: g.nitrogen, nGem: gem });
      }
      // On the far nitrogen of a hydrazide: N'-benzylidene, N',N'-dimethyl.
      if (g.nPrime !== undefined) for (const n of mol.neighbours(g.nPrime)) {
        if (n === g.nitrogen || n === g.anchor) continue;
        const sub = mol.bondBetween(g.nPrime, n)!.order === 2 ? this.ylidene(n, g.nPrime) : this.substituent(n, g.nPrime);
        out.push({ ...sub, at: 'N', nOf: locAt, prime: true });
      }
    }
    return out;
  }

  ylidene(n: AtomId, from: AtomId): SubName { return this.remembered(`${n}=${from}`, () => chemistStyle(this.computeYlidene(n, from))); }

  computeYlidene(n: AtomId, from: AtomId): SubName {
    const mol = this.mol;
    const e = el(mol, n);
    const deg = mol.neighbours(n).length;
    if (e === 'O' && deg === 1) return { text: 'oxo', complex: false, sortKey: 'oxo' };
    if (e === 'S' && deg === 1) return { text: 'thioxo', complex: false, sortKey: 'thioxo' };
    if (e === 'N' && deg === 1) return mol.atom(n).charge === 1 ? { text: 'iminio', complex: false, sortKey: 'iminio' } : { text: 'imino', complex: false, sortKey: 'imino' };
    if (e === 'C' && deg === 1) return { text: 'methylene', complex: false, sortKey: 'methylene' };
    if (e === 'N' && deg === 2 && mol.atom(n).charge === 1) {
      // =N+=N-: diazo.
      const end = mol.neighbours(n).find((x) => x !== from)!;
      if (el(mol, end) === 'N' && mol.atom(end).charge === -1 && mol.neighbours(end).length === 1) return { text: 'diazo', complex: false, sortKey: 'diazo' };
    }
    if (e === 'N' && deg === 2) {
      // =N-R: hydroxyimino (oximes), methoxyimino, phenylimino, (dimethylamino)imino.
      const r = mol.neighbours(n).find((x) => x !== from)!;
      if (mol.bondBetween(n, r)!.order !== 1) throw new OutOfScope('ylidene substituent');
      // =N-N=CR2: ((5-methylfuran-2-yl)methylene)hydrazineylidene.
      if (el(mol, r) === 'N' && mol.atom(r).charge === 0 && mol.atom(n).charge === 0 && !this.an.ringAtoms.has(r) && mol.neighbours(r).length === 2) {
        const cY = mol.neighbours(r).find((x) => x !== n && mol.bondBetween(r, x)!.order === 2 && el(mol, x) === 'C');
        if (cY !== undefined) {
          const Y = this.ylidene(cY, r);
          const text = `${Y.complex ? `(${Y.text})` : Y.text}hydrazineylidene`;
          return { text, complex: true, sortKey: sortKeyOf(text) };
        }
      }
      // =N-NH-R: 2-(thiazol-2-yl)hydrazineylidene.
      const rr = el(mol, r) === 'N' && mol.atom(r).charge === 0 && mol.atom(n).charge === 0 && mol.implicitHydrogens(r) === 1
        ? mol.neighbours(r).filter((x) => x !== n) : [];
      if (rr.length === 1 && mol.bondBetween(r, rr[0]!)!.order === 1 && !this.an.ringAtoms.has(r)) {
        const R2 = this.substituent(rr[0]!, r);
        {
          const text = `2-${R2.complex ? `(${R2.text})` : R2.text}hydrazineylidene`;
          return { text, complex: true, sortKey: sortKeyOf(text) };
        }
      }
      const R = this.substituent(r, n);
      const word = mol.atom(n).charge === 1 ? 'iminio' : 'imino';
      const text = `${wrapInner(R)}${word}`;
      return { text, complex: true, sortKey: `${R.sortKey}${word}` };
    }
    if (e === 'C') {
      if (this.an.ringAtoms.has(n)) return this.ringSubstituent(n, from, true);
      return this.alkyl(n, from, 'ylidene');
    }
    // =PR3 of a stabilised ylide: (triphenyl-λ5-phosphanylidene).
    if (e === 'P' && mol.atom(n).charge === 0 && deg === 4 && !this.an.ringAtoms.has(n)) {
      const rest = mol.neighbours(n).filter((x) => x !== from);
      if (rest.every((x) => el(mol, x) === 'C' && mol.bondBetween(n, x)!.order === 1)) {
        const text = `${this.groupedSubs(rest, n)}-λ5-phosphanylidene`;
        return { text, complex: true, sortKey: sortKeyOf(text) };
      }
    }
    throw new OutOfScope('ylidene substituent');
  }

  /** A ring that must be the parent (the one named with its oxides). */
  preferAtoms: Set<AtomId> | null = null;

  chooseParent(): { parent: Parent; numbering: Numbering } {
    let candidates = [...this.ringCandidates(), ...this.chainCandidates()];
    if (this.preferAtoms) { const pa = this.preferAtoms; const only = candidates.filter((c) => c.atoms.length === pa.size && c.atoms.every((x) => pa.has(x))); if (only.length) candidates = only; }
    let best: { parent: Parent; numbering: Numbering; key: (number | number[])[] } | null = null;
    // The best ring and the best chain, each with how many principal groups and prefixes it has.
    const bestOf: Record<'ring' | 'chain', { parent: Parent; numbering: Numbering; key: (number | number[])[]; count: number; pre: number } | null> = { ring: null, chain: null };
    for (const p of candidates) {
      const sites = this.principalSites(p);
      // Every principal group of the same kind must be expressible: count them.
      const count = sites.size;
      let pre: Prefix[];
      try { pre = this.prefixes(p, sites); } catch (e) { if (e instanceof OutOfScope) continue; throw e; }
      // Ring seniority (P-44.2.1.2): a heterocycle; one with nitrogen; else the senior heteroatom (O, then S);
      // then more rings, more ring atoms, more heteroatoms.
      const heteroCount = p.ring ? p.atoms.filter((a) => el(this.mol, a) !== 'C').length : 0;
      const ringKey = p.ring
        ? [-Number(heteroCount > 0), -Number(p.ring.heteroN), p.ring.heteroN ? 0 : -Number(p.ring.heteroO), p.ring.heteroN ? 0 : -Number(p.ring.heteroS), -p.ring.ringCount, -p.ring.size, -heteroCount,
          // Then the greater variety of heteroatoms: thiazole before pyrazole.
          -new Set(p.atoms.map((a) => el(this.mol, a)).filter((e) => e !== 'C')).size]
        : [0, 0, 0, 0, 0, 0, 0, 0];
      const { mult, dbl } = this.unsaturationAtoms(p);
      const heteroAtoms = p.ring?.kind === 'vonbaeyer' || p.ring?.kind === 'cyclo' ? p.atoms.filter((a) => el(this.mol, a) !== 'C') : [];
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
          // A carbocyclic ketone takes its indicated hydrogen on a ketone carbon; then the fewest added hydrogens.
          prefOf.get(numbering) ?? 0,
          (hydroOf.get(numbering)?.added ?? []).length,
          (hydroOf.get(numbering)?.ih ?? []).map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          [...sites.values()].map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          // Ring oxides as low as they go: pyrimidine 1-oxide.
          p.atoms.filter((a) => this.oxides.has(a)).map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          [...(hydroOf.get(numbering)?.hydro ?? []), ...(hydroOf.get(numbering)?.added ?? [])].map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          (hydroOf.get(numbering)?.added ?? []).map((a) => locVal(numbering.get(a)!)).sort((x, y) => x - y),
          mult.map((bond) => this.bondLocant(p, numbering, bond)).sort((x, y) => x - y),
          dbl.map((bond) => this.bondLocant(p, numbering, bond)).sort((x, y) => x - y),
          -pre.length,
          pre.filter((x) => x.at !== 'N').map((x) => locVal(numbering.get(x.at as AtomId)!)).sort((x, y) => x - y),
          // A group on a principal nitrogen as low as it goes: N1-(3-aminopropyl)butane-1,4-diamine,
          // N1,N1-diethyl-2,6-dinitro-...; then alphabetical order: N1-ethyl-N3-methylmalonamide.
          pre.filter((x) => x.at === 'N' && x.nOf !== undefined).map((x) => locVal(numbering.get(x.nOf!)!)).sort((x, y) => x - y),
          alphaLocs(pre.filter((x) => x.at !== 'N'), numbering),
          alphaLocs(pre.filter((x) => x.at === 'N' && x.nOf !== undefined).map((x) => ({ ...x, at: x.nOf! })), numbering),
        ];
        if (!best || cmpKey(key, best.key) < 0) best = { parent: p, numbering, key };
        const k = p.kind === 'ring' ? 'ring' : 'chain';
        if (!bestOf[k] || cmpKey(key, bestOf[k]!.key) < 0) bestOf[k] = { parent: p, numbering, key, count, pre: k === 'ring' ? pre.length : this.ringBranches(p.atoms) };
      }
    }
    if (!best) throw new OutOfScope('no parent hydride');
    // A chain with as many principal groups as the ring and more groups on it is the parent:
    // 1,2-diphenylethene, diphenylmethane, 1,2-bis(diphenylphosphaneyl)ethane.
    const r = bestOf.ring, c = bestOf.chain;
    if (r && c && best.parent === r.parent && c.count === 0 && r.count === 0 && c.pre >= 2 && c.pre > r.pre) return { parent: c.parent, numbering: c.numbering };
    // All principal groups must sit on the parent; otherwise the name needs prefixes for some
    // of them, which we only support for the subordinate kinds.
    return best;
  }

  /** A ring assembly as a substituent: [1,1'-biphenyl]-4-yl, 2'-(2H-tetrazol-5-yl)-[1,1'-biphenyl]-4-yl. */
  assemblySubstituent(a: AtomId, from: AtomId, A: Parent): SubName | null {
    const mol = this.mol;
    const inA = new Set(A.atoms);
    const partners = new Set<AtomId[]>();
    for (const x of A.atoms) for (const n of mol.neighbours(x)) if (!inA.has(n) && n !== from && this.ringByAtom.has(n)) partners.add(this.ringByAtom.get(n)!);
    const same = [...partners].filter((sys) => { const rr = recognizeRing(this.an, sys); return rr?.info.kind === 'template' && rr.info.template?.name === A.ring?.template?.name; });
    if (same.length !== 1 || same[0]!.includes(from)) return null;
    const Bsys = same[0]!;
    const rb = recognizeRing(this.an, Bsys)!;
    const B: Parent = { kind: 'ring', atoms: Bsys, numberings: rb.numberings, ring: rb.info };
    // The other ring must end the branch: no third ring of the kind on it.
    const inB = new Set(Bsys);
    for (const x of Bsys) for (const n of mol.neighbours(x)) if (!inB.has(n) && !inA.has(n) && this.ringByAtom.has(n) && recognizeRing(this.an, this.ringByAtom.get(n)!)?.info.template?.name === A.ring?.template?.name) return null;
    const asm = this.assembly(A, B, { a });
    if (!asm) return null;
    const both = new Set(asm.atoms);
    if ([...both].some((x) => this.rs.get(x))) return null;
    const pre: Prefix[] = [];
    for (const x of both) for (const b of mol.incidentBonds(x)) {
      const bd = mol.bond(b), n = mol.otherAtom(bd, x);
      if (both.has(n) || (x === a && n === from)) continue;
      if (bd.order !== 1) return null;
      pre.push({ ...this.substituent(n, x), at: x });
    }
    let best: { numbering: Numbering; key: (number | number[])[] } | null = null;
    for (const numbering of asm.numberings) {
      const key: (number | number[])[] = [locVal(numbering.get(a)!), pre.map((x) => locVal(numbering.get(x.at as AtomId)!)).sort((x, y) => x - y),
        alphaLocs(pre, numbering)];
      if (!best || cmpKey(key, best.key) < 0) best = { numbering, key };
    }
    const preText = this.prefixString(pre, best!.numbering, false);
    const text = `${preText}${preText ? '-' : ''}${asm.ring!.template!.name}-${best!.numbering.get(a)}-yl`;
    return { text, complex: true, sortKey: sortKeyOf(text) };
  }

  /** How many groups off a chain hold a ring. */
  ringBranches(chain: AtomId[]): number {
    const mol = this.mol, inChain = new Set(chain);
    let n = 0, direct = 0;
    const kinds = new Set<string>();
    for (const a of chain) for (const b of mol.neighbours(a)) {
      if (inChain.has(b)) continue;
      const seen = new Set<AtomId>([b]), stack = [b];
      let ring = false;
      while (stack.length && !ring) { const x = stack.pop()!; if (this.an.ringAtoms.has(x)) ring = true; for (const y of mol.neighbours(x)) if (!inChain.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); } }
      if (ring) { n++; direct += this.an.ringAtoms.has(b) ? 1 : 0; try { kinds.add(this.substituent(b, a).text); } catch { kinds.add(`?${b}`); } }
    }
    // Only like rings make the chain the parent: diphenylmethane, but 1-benzylpyrrolidine.
    if (kinds.size > 1) return 0;
    // A ring held directly beside one held through other atoms leaves the ring the parent:
    // 3-(1-(phenylsulfinyl)propyl)furan.
    return direct && direct < n ? 0 : n;
  }

  /** In-parent multiple bonds that become ene/yne (chains and cycloalkenes). */
  unsaturationAtoms(p: Parent): { mult: [AtomId, AtomId][]; dbl: [AtomId, AtomId][]; trip: [AtomId, AtomId][] } {
    const mult: [AtomId, AtomId][] = [], dbl: [AtomId, AtomId][] = [], trip: [AtomId, AtomId][] = [];
    if (p.kind === 'ring' && (p.ring?.kind === 'template' || p.ring?.kind === 'spiro')) return { mult, dbl, trip };
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
    const mol = this.mol;
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
    // A two-carbon chain's double or triple bond can only be in one place.
    // A unit of a multiplicative name also has its point of attachment to cite: bis(ethan-1-ol).
    const features = sites.size + cPrefixes + (p.kind === 'chain' && p.atoms.length === 2 ? 0 : mult.length)
      + (p.kind === 'chain' && p.atoms.some((a) => mol.neighbours(a).some((n) => this.excluded.has(n))) ? 1 : 0);

    // Locant omission: methane/ethane-like parents and monosubstituted symmetric rings.
    const symmetricRing = p.kind === 'ring' && ((p.ring!.kind === 'cyclo' && p.atoms.every((a) => el(this.mol, a) === 'C')) || p.ring!.template?.name === 'benzene');
    const omitAll = (p.kind === 'chain' && (p.atoms.length === 1 || (p.atoms.length === 2 && features <= 1)))
      || (symmetricRing && features <= 1 && (p.ring!.kind !== 'cyclo' || mult.length <= 1));

    const manyN = [...sites.keys()].filter((g) => g.nitrogen !== undefined).length > 1;
    let prefixText = this.prefixString(pre, numbering, omitAll, manyN, true);
    // Every hydrogen of the parent replaced by one halogen: perbromomethane, perchloroethane.
    if (pre.length >= 2 && !sites.size && new Set(pre.map((x) => x.text)).size === 1 && /^(fluoro|chloro|bromo|iodo)$/.test(pre[0]!.text)
      && p.atoms.every((a) => mol.implicitHydrogens(a) === 0)) prefixText = `per${pre[0]!.text}`;

    let parentName: string;
    const ium = kind === 'ium' ? [] : p.atoms.filter((a) => isRingCation(this.mol, a) && this.an.ringAtoms.has(a)).map(loc).sort(compareLocant);
    const ide = kind === 'ide' ? [] : p.atoms.filter((a) => isRingAnion(this.mol, a) && this.an.ringAtoms.has(a)).map(loc).sort(compareLocant);
    if (retained && !ium.length && !ide.length) {
      parentName = retained;
    } else {
      let hydride = this.hydrideName(p, numbering, dbl, trip, omitAll);
      if (ium.length) hydride = attachSuffix(hydride, ium.join(','), `${multiplier(ium.length)}ium`);
      if (ide.length) hydride = attachSuffix(hydride, ide.join(','), `${multiplier(ide.length)}ide`);
      parentName = this.withSuffix(p, hydride, kind, siteLocs, sites.size, omitAll);
      // A ring anion on the atom the indicated hydrogen would be on needs none: pyrazol-1-ide.
      const ideAt = kind === 'ide' ? siteLocs.map(String) : ide;
      if (ideAt.length === 1) parentName = parentName.replace(new RegExp(`(^|-)${ideAt[0]}H-(?=[a-z[])`), '$1');
    }
    // An assembly's name is bracketed only where a locant follows it: [1,1'-biphenyl]-4-ol, 4-methyl-1,1'-biphenyl.
    if (p.ring?.assembly && /^\[[^\]]*\]$/.test(parentName)) parentName = parentName.slice(1, -1);
    const joiner = prefixText && /^[0-9([]/.test(parentName) ? '-' : '';
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
        case 'peracid': return 'benzoperoxoic acid';
        case 'aldehyde': return 'benzaldehyde';
        case 'nitrile': return 'benzonitrile';
        case 'amide': return g?.thio ? 'benzothioamide' : g?.imid ? 'benzimidamide' : g?.hydrazide ? 'benzohydrazide' : 'benzamide';
        case 'acylHalide': return `benzoyl ${HALIDE[g!.halogen!]}`;
        default: void nPre;
      }
    }
    // Picolinic, nicotinic and isonicotinic acids and their kin, substituted or not.
    const pyridine = p.kind === 'ring' && p.ring!.template?.name === 'pyridine' && !hydroOf.get(this.currentNumbering!);
    if (pyridine && sites.size === 1 && g?.ownCarbon && this.currentNumbering && !this.excluded.size) {
      const stem = ({ '2': 'picolin', '3': 'nicotin', '4': 'isonicotin' } as Record<string, string>)[this.currentNumbering.get([...sites.values()][0]!)!];
      const w: Partial<Record<GroupKind, string>> = stem ? { acid: `${stem}ic acid`, amide: g.thio || g.imid ? undefined : g.hydrazide ? `${stem}ohydrazide` : `${stem}amide`, ester: `${stem}ate`, carboxylate: `${stem}ate`, nitrile: `${stem}onitrile` } : {};
      if (kind && w[kind]) return w[kind]!;
    }
    if (benzene && sites.size === 2 && g?.ownCarbon && this.currentNumbering && !this.excluded.size) {
      const l = [...sites.values()].map((x) => this.currentNumbering!.get(x)!).sort(compareLocant).join(',');
      const stem = ({ '1,2': 'phthal', '1,3': 'isophthal', '1,4': 'terephthal' } as Record<string, string>)[l];
      const w: Partial<Record<GroupKind, string>> = stem ? { acid: `${stem}ic acid`, amide: g.thio || g.imid || g.hydrazide ? undefined : `${stem}amide`, nitrile: `${stem}onitrile` } : {};
      if (kind && w[kind]) return w[kind]!;
    }
    if (benzene && sites.size === 0 && pre.length === 1 && !this.excluded.size) {
      const t = pre[0]!.text;
      if (t === 'methyl') { pre.length = 0; return 'toluene'; }
      if (t === 'isopropyl') { pre.length = 0; return 'cumene'; }
      if (t === 'vinyl') { pre.length = 0; return 'styrene'; }
      if (t === 'methoxy') { pre.length = 0; return 'anisole'; }
    }
    if (p.kind === 'chain' && g?.ownCarbon) {
      const { mult, dbl, trip } = this.unsaturationAtoms(p);
      const ends = new Set([p.atoms[0], p.atoms[p.atoms.length - 1]]);
      // Methacrylic and isobutyric acids and what is made from them: methyl methacrylate.
      if (!this.excluded.size && sites.size === 1 && p.atoms.length === 3 && pre.length === 1 && pre[0]!.text === 'methyl' && this.currentNumbering?.get(pre[0]!.at as AtomId) === '2' && ends.has([...sites.values()][0]!)) {
        const stem = mult.length === 1 && dbl.length === 1 ? 'methacryl' : !mult.length ? 'isobutyr' : null;
        const w: Partial<Record<GroupKind, string>> = stem ? { acid: `${stem}ic acid`, ester: `${stem}ate`, carboxylate: `${stem}ate`, amide: g.thio || g.imid || g.hydrazide ? undefined : `${stem}amide`, nitrile: `${stem}onitrile` } : {};
        if (kind && w[kind]) { pre.length = 0; return w[kind]!; }
      }
      // Prop-2-enoic acid and what is made from it, substituted or not: (E)-3-(3,4-dihydroxyphenyl)acrylic acid.
      if (sites.size === 1 && p.atoms.length === 3 && mult.length === 1 && dbl.length === 1 && !dbl[0]!.includes([...sites.values()][0]!)) {
        const w: Partial<Record<GroupKind, string>> = { acid: 'acrylic acid', amide: g.thio ? undefined : 'acrylamide', ester: 'acrylate', carboxylate: 'acrylate', nitrile: 'acrylonitrile', aldehyde: 'acrylaldehyde' };
        if (kind && w[kind]) return w[kind]!;
      }
      // Propiolic acid and what is made from it: 3-phenylpropiolamide.
      if (sites.size === 1 && p.atoms.length === 3 && mult.length === 1 && trip.length === 1 && !trip[0]!.includes([...sites.values()][0]!)) {
        const w: Partial<Record<GroupKind, string>> = { acid: 'propiolic acid', amide: g.thio || g.imid || g.hydrazide ? undefined : 'propiolamide', ester: 'propiolate', carboxylate: 'propiolate' };
        if (kind && w[kind]) return w[kind]!;
      }
      // Propionic and butyric acids and what is made from them, with nothing on the chain: ethyl propionate.
      if (sites.size === 1 && !mult.length && (p.atoms.length === 3 || p.atoms.length === 4) && !pre.some((x) => x.at !== 'N') && ends.has([...sites.values()][0]!)) {
        const stem = p.atoms.length === 3 ? 'propion' : 'butyr';
        const w: Partial<Record<GroupKind, string>> = { acid: `${stem}ic acid`, amide: g.thio || g.imid || g.hydrazide ? undefined : `${stem}amide`, ester: `${stem}ate`, carboxylate: `${stem}ate`, nitrile: `${stem}onitrile`, aldehyde: `${stem}aldehyde` };
        if (kind && w[kind]) return w[kind]!;
      }
      // The fatty acids by name, on an unbranched chain carrying nothing else: palmitamide, stearic acid.
      const fatty: Record<number, string> = { 16: 'palmit', 18: 'stear' };
      if (sites.size === 1 && !mult.length && fatty[p.atoms.length] && !pre.some((x) => x.at !== 'N') && ends.has([...sites.values()][0]!)) {
        const stem = fatty[p.atoms.length]!;
        const w: Partial<Record<GroupKind, string>> = { acid: `${stem}ic acid`, amide: g.thio ? undefined : `${stem}amide`, ester: `${stem}ate`, carboxylate: `${stem}ate` };
        if (kind && w[kind]) return w[kind]!;
      }
      // Oxalic, malonic and succinic acids and their amides, esters and nitriles, with both ends the group.
      if (sites.size === 2 && !mult.length && p.atoms.length >= 2 && p.atoms.length <= 4 && [...sites.values()].every((x) => ends.has(x)) && !g.thio) {
        const stem = ['oxal', 'malon', 'succin'][p.atoms.length - 2]!;
        const w: Partial<Record<GroupKind, string>> = { acid: `${stem}ic acid`, amide: `${stem}amide`, ester: `${stem}ate`, carboxylate: `${stem}ate`, nitrile: `${stem}onitrile` };
        if (kind && w[kind]) return w[kind]!;
      }
    }
    if (p.kind === 'chain' && sites.size === 1 && g?.ownCarbon && p.atoms.length <= 2 && this.unsaturationAtoms(p).mult.length === 0) {
      const acetic = p.atoms.length === 2;
      switch (kind) {
        case 'carboxylate': return acetic ? 'acetate' : 'formate';
        case 'acid': return acetic ? 'acetic acid' : 'formic acid';
        case 'amide': return g.thio ? null : g.imid ? (acetic ? 'acetimidamide' : 'formimidamide') : g.hydrazide ? (acetic ? 'acetohydrazide' : 'formohydrazide') : acetic ? 'acetamide' : 'formamide';
        case 'aldehyde': return acetic ? 'acetaldehyde' : 'formaldehyde';
        case 'nitrile': return acetic ? 'acetonitrile' : null;
        case 'acylHalide': return acetic ? `acetyl ${HALIDE[g.halogen!]}` : null;
        default: return null;
      }
    }
    return null;
  }

  hydrideName(p: Parent, numbering: Numbering, dbl: [AtomId, AtomId][], trip: [AtomId, AtomId][], omitAll: boolean): string {
    if (p.kind === 'ring' && p.ring!.kind === 'spiro') return spiroText(numbering);
    if (p.kind === 'ring' && p.ring!.kind === 'template') {
      const t = p.ring!.template!;
      const h = hydroOf.get(numbering);
      if (h?.saturated && t.saturated) return t.saturated;
      if (h) return withHydro((bridgeOf.get(numbering) ?? '') + t.name, h, numbering);
      return t.indicatedH ? `${t.indicatedH}H-${t.name}` : t.name;
    }
    const n = p.kind === 'ring' ? p.ring!.size : p.atoms.length;
    const vb = p.kind === 'ring' && p.ring!.kind === 'vonbaeyer';
    const hetero = p.kind === 'ring' ? heteroPrefix(this.mol, p.atoms, numbering, p.ring!.kind === 'cyclo') : '';
    const stem = vb ? `${hetero}${p.ring!.bracket}${alkaneStem(n)}` : (p.kind === 'ring' ? `${hetero}cyclo` : '') + alkaneStem(n);
    if (!dbl.length && !trip.length) return `${stem}ane`;
    const locs = (bonds: [AtomId, AtomId][]) => bonds.map((b) => this.bondLocantText(p, numbering, b)).sort(compareLocant).join(',');
    if (p.kind === 'chain' && n === 2) omitAll = true;
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
    const ownCarbonOnRing = (p.kind === 'ring' || this.externalSites.has(p)) && this.principalGroups[0]!.ownCarbon;
    const terminal = p.kind === 'chain' && !this.externalSites.has(p) && this.principalGroups[0]!.ownCarbon;
    // One group on benzene needs no locant: 4-methylbenzenesulfonyl chloride, 4-chlorobenzenethiol.
    const onBenzene = p.kind === 'ring' && p.ring!.template?.name === 'benzene' && count === 1;
    const showLocs = !(omitAll || terminal || onBenzene) ? locs.join(',') : '';
    const g = this.principalGroups[0]!;
    const SUFFIX: Record<GroupKind, [string, string]> = {
      carboxylate: ['oate', 'carboxylate'],
      sulfonate: ['sulfonate', 'sulfonate'],
      diazonium: ['diazonium', 'diazonium'],
      sulfonic: g.sulfin ? ['sulfinic acid', 'sulfinic acid'] : ['sulfonic acid', 'sulfonic acid'],
      sulfonateEster: ['sulfonate', 'sulfonate'],
      sulfonylHalide: [`sulfonyl ${g.halogen === 'N3' ? 'azide' : HALIDE[g.halogen ?? 'Cl']}`, `sulfonyl ${g.halogen === 'N3' ? 'azide' : HALIDE[g.halogen ?? 'Cl']}`],
      sulfonamide: g.sulfin ? ['sulfinamide', 'sulfinamide'] : ['sulfonamide', 'sulfonamide'],
      peracid: ['peroxoic acid', 'carboperoxoic acid'],
      olate: ['olate', 'olate'],
      aminium: ['aminium', 'aminium'],
      acid: ['oic acid', 'carboxylic acid'],
      ester: g.thio ? ['ethioate', 'carbothioate'] : ['oate', 'carboxylate'],
      acylHalide: [`oyl ${HALIDE[g.halogen ?? 'Cl']}`, `carbonyl ${HALIDE[g.halogen ?? 'Cl']}`],
      amide: g.thio ? ['thioamide', 'carbothioamide'] : g.imid ? ['imidamide', 'carboximidamide'] : g.hydrazide ? ['ehydrazide', 'carbohydrazide'] : ['amide', 'carboxamide'],
      urea: ['urea', 'urea'],
      ium: ['ium', 'ium'],
      ide: ['ide', 'ide'],
      iminium: ['iminium', 'iminium'],
      thiolate: ['thiolate', 'thiolate'],
      nitrile: ['nitrile', 'carbonitrile'],
      aldehyde: ['al', 'carbaldehyde'],
      ketone: g.thio ? ['thione', 'thione'] : ['one', 'one'],
      imine: ['imine', 'imine'],
      alcohol: ['ol', 'ol'],
      thiol: ['thiol', 'thiol'],
      amine: ['amine', 'amine'],
    };
    const [chainForm, ringForm] = SUFFIX[kind];
    const num = this.currentNumbering;
    const added = p.kind === 'ring' && (kind === 'ketone' || kind === 'imine') && num ? hydroOf.get(num)?.added : undefined;
    if (added?.length) {
      const hLocs = added.map((a) => num!.get(a)!).sort(compareLocant);
      return attachSuffix(hydride, `${locs.join(',')}(${hLocs.map((l) => `${l}H`).join(',')})`, `${m}${ringForm}`);
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
  prefixString(pre: Prefix[], numbering: Numbering, omitAll: boolean, manyN = false, parent = false): string {
    // Group identical prefixes.
    const groups = new Map<string, { sub: Prefix; locs: string[] }>();
    // Two nitrogens on one carbon (an aminal, a guanidine written as a diamine) are N and N': the one
    // with more groups, then the one whose group comes first in the alphabet, goes unprimed.
    const primes = new Map<AtomId, string>();
    const geminal = pre.filter((x) => x.at === 'N' && x.nAtom !== undefined && (x.nGem?.length ?? 0) > 1);
    // On a one-carbon parent a prefix with no locant beside an N-prefix is taken for the nitrogen's
    // too ("cyano-N-methylformamide" reads as N-cyano): there the carbon's locant is cited.
    if (omitAll && pre.some((x) => x.at === 'N') && pre.some((x) => x.at !== 'N')) omitAll = false;
    if (geminal.length) {
      const anchors = new Set(pre.filter((x) => x.at === 'N').map((x) => x.nOf));
      if (anchors.size > 1 || new Set(geminal.flatMap((x) => x.nGem!)).size > 3) throw new OutOfScope('nitrogens sharing a carbon beside others');
      const of = (n: AtomId) => geminal.filter((x) => x.nAtom === n).map((x) => x.sortKey).sort();
      const order = [...new Set(geminal.map((x) => x.nAtom!))].sort((a, b) => of(b).length - of(a).length || of(a).join(' ').localeCompare(of(b).join(' ')) || a - b);
      order.forEach((n, i) => primes.set(n, "'".repeat(i)));
    }
    for (const x of pre) {
      const loc = x.at === 'N'
        ? x.prime ? "N'" : (x.nAtom !== undefined && primes.has(x.nAtom) ? `N${primes.get(x.nAtom)}` : manyN && x.nOf !== undefined ? `N${numbering.get(x.nOf)}` : 'N')
        : numbering.get(x.at)!;
      const g = groups.get(x.text);
      if (g) g.locs.push(loc); else groups.set(x.text, { sub: x, locs: [loc] });
    }
    const sorted = [...groups.values()].sort((a, b) => a.sub.sortKey.localeCompare(b.sub.sortKey) || a.sub.text.localeCompare(b.sub.text));
    let out = '';
    // A bare imino or methylene right after a prefix that can also be a bridge (oxy, thio, sulfonyl,
    // carbonyl) is read as joined to it, brackets or not: "(benzylthio)(imino)methanamine" reads as
    // BnS-N=CH-NH2. There the locants are cited: 1-(benzylthio)-1-iminomethanamine.
    if (omitAll && sorted.some((g, i) => i > 0 && /^(imino|iminio|methylene|methylidene)$/.test(g.sub.text)
      && /(oxy|thio|sulfonyl|sulfinyl|carbonyl|imino|methylene|methylidene)$/.test(sorted[i - 1]!.sub.text))) omitAll = false;
    for (const { sub, locs } of sorted) {
      const n = locs.length;
      // With no locant between them, a prefix after another goes in brackets where it could be read as
      // carrying the one before: chloro(methoxy)methane, not chloromethoxymethane.
      const bracket = sub.complex || (omitAll && out !== '' && n === 1 && !locs[0]!.startsWith('N') && !ATOM_LIKE.test(sub.text));
      const body = n > 1 && TRADITIONAL.test(sub.text) ? `${multiplier(n)}-${sub.text}`
        : omitAll && n === 1 && pre.length === 1 && (TRADITIONAL.test(sub.text) || ((sub as { di?: boolean }).di && !/^\d/.test(sub.text) && !locs[0]!.startsWith('N') && (parent || !/^[omp]-/.test(sub.text)))) ? sub.text
        : bracket ? `${n > 1 && (sub as { di?: boolean }).di ? multiplier(n) : complexMultiplier(n)}(${sub.text})` : `${multiplier(n)}${sub.text}`;
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
    if (!a.length) return g.thio ? 'thiourea' : 'urea';
    const pre: Prefix[] = [...a.map((x) => ({ ...x, at: n1 })), ...b.map((x) => ({ ...x, at: n2 }))];
    const numbering: Numbering = new Map([[n1, '1'], [n2, '3']]);
    const text = this.prefixString(pre, numbering, false);
    return `${text}${g.thio ? 'thiourea' : 'urea'}`;
  }

  /**
   * A guanidine whose nitrogens are the principal amines, named as one, as ChemDraw does:
   * 1,1-dimethylguanidine, 2-cyano-1-methyl-3-(...)guanidine. The doubly bonded nitrogen is 2.
   * Null for anything else (a ring through the nitrogens, two guanidines, a charge).
   */
  guanidine(): string | null {
    if (this.principal !== 'amine') return null;
    const mol = this.mol;
    const centres = [...mol.atoms()].filter((a) => {
      if (a.element !== 'C' || a.charge !== 0 || this.an.ringAtoms.has(a.id)) return false;
      const nb = mol.neighbours(a.id);
      return nb.length === 3 && nb.every((n) => el(mol, n) === 'N') && nb.map((n) => mol.bondBetween(a.id, n)!.order).sort().join() === '1,1,2';
    });
    if (centres.length !== 1) return null;
    const c = centres[0]!.id;
    const ns = mol.neighbours(c);
    if (!this.principalGroups.every((g) => g.nitrogen !== undefined && ns.includes(g.nitrogen))) return null;
    if (ns.some((n) => this.an.ringAtoms.has(n) || mol.atom(n).charge !== 0)) return null;
    if (ns.some((n) => mol.neighbours(n).some((x) => x !== c && mol.bondBetween(n, x)!.order !== 1))) return null;
    const imino = ns.find((n) => mol.bondBetween(c, n)!.order === 2)!;
    // With a configuration at C=N the diamine form is used, which has a place to cite it.
    if (this.ez.has(`${c}-${imino}`)) return null;
    const [a, b] = ns.filter((n) => n !== imino) as [AtomId, AtomId];
    const subsOf = (n: AtomId) => mol.neighbours(n).filter((x) => x !== c).map((x) => this.substituent(x, n));
    const first = (xs: SubName[]) => [...xs].sort((x, y) => x.sortKey.localeCompare(y.sortKey))[0]?.sortKey ?? '~';
    // Position 1 for the amino nitrogen that carries more, then the one cited first.
    let [n1, n3] = [a, b];
    const [sa, sb] = [subsOf(a), subsOf(b)];
    if (sb.length > sa.length || (sb.length === sa.length && first(sb) < first(sa))) [n1, n3] = [b, a];
    const pre: Prefix[] = [n1, imino, n3].flatMap((n) => subsOf(n).map((x) => ({ ...x, at: n })));
    if (!pre.length) return 'guanidine';
    return `${this.prefixString(pre, new Map([[n1, '1'], [imino, '2'], [n3, '3']]), false)}guanidine`;
  }

  // ------------------------------------------------------------- esters

  /** R-O-C(=O)-N (carbamate) and R-O-C(=O)-O-R (carbonate) esters. */
  carbonicEster(): string | null {
    if (this.principal !== 'ester') return null;
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
      // ethyl nitroso(propyl)carbamate, ethyl dimethylcarbamate.
      return `${alkyl} ${citeRun(countSubs(subs))}carbamate`;
    }
    if (el(mol, x) === 'O' && mol.neighbours(x).length === 2) {
      const r2 = mol.neighbours(x).find((n) => n !== c)!;
      if (el(mol, r2) !== 'C' || this.principalGroups.length !== 1) return null;
      const b = this.substituent(r2, x);
      // dimethyl carbonate, di-tert-butyl carbonate, bis(4-methylheptyl) carbonate.
      return alkyl === b.text ? `${citeRun([{ text: b.text, complex: b.complex, n: 2 }])} carbonate` : `${[alkyl, b.text].sort().join(' ')} carbonate`;
    }
    return null;
  }

  nameEster(): string {
    const onAlcohol = this.polyolEster();
    if (onAlcohol) return onAlcohol;
    const carbonic = this.carbonicEster();
    if (carbonic) return carbonic;
    const best = this.chooseParent();
    const p = best.parent;
    const sites = this.principalSites(p);
    const esters = [...sites.keys()];
    if (!esters.length) throw new OutOfScope('ester not on the parent');
    // An S-ester's alkyl group says which atom it is on: S-methyl ethanethioate.
    const thio = esters.some((g) => g.thio);
    if (thio && esters.some((g) => !g.thio)) throw new OutOfScope('O- and S-esters together');
    const alkyls = esters.map((g) => {
      const r = this.substituent(g.esterCarbon!, g.consumed[1]!);
      return thio ? { ...r, text: `S-${r.complex ? `(${r.text})` : r.text}`, complex: false } : r;
    });
    // Retained acid names give retained anion names.
    const pre = this.prefixes(p, sites);
    const carboxylic = this.principal === 'ester';
    const benzene = p.kind === 'ring' && p.ring!.template?.name === 'benzene';
    let acid: string;
    if (carboxylic && benzene && sites.size === 1) acid = this.prefixString(pre, best.numbering, false) + (thio ? 'benzothioate' : 'benzoate');
    else if (carboxylic && !thio && p.kind === 'chain' && p.atoms.length <= 2 && sites.size === 1 && this.unsaturationAtoms(p).mult.length === 0) {
      const ps = this.prefixString(pre, best.numbering, p.atoms.length === 1);
      // A haloformate: ethyl carbonochloridate.
      const halo = p.atoms.length === 1 && pre.length === 1 ? Object.entries(HALO).find(([, w]) => w === pre[0]!.text)?.[0] : undefined;
      acid = halo ? `carbono${HALIDE[halo]!.replace(/ide$/, 'idate')}` : ps + (p.atoms.length === 2 ? 'acetate' : 'formate');
    } else acid = this.render(p, best.numbering);
    acid = this.withStereo(p.atoms, best.numbering, acid) + this.oxideSuffix(p.atoms, best.numbering);
    // Benzenedicarboxylates with nothing else on the ring are phthalates: benzyl butyl phthalate.
    if (benzene && sites.size === 2 && !pre.length && esters.length === 2) {
      const l = [...sites.values()].map((x) => best.numbering.get(x)!).sort(compareLocant).join(',');
      const w = ({ '1,2': 'phthalate', '1,3': 'isophthalate', '1,4': 'terephthalate' } as Record<string, string>)[l];
      if (w) acid = w;
    }
    if (acid === 'pyridine-3-carboxylate') acid = 'nicotinate';
    if (acid === 'pyridine-4-carboxylate') acid = 'isonicotinate';
    const alkyl = alkyls[0]!;
    if (esters.length === 1) return `${alkyl.text} ${acid}`;
    if (new Set(alkyls.map((a) => a.text)).size === 1) return alkyl.complex ? `${complexMultiplier(esters.length)}(${alkyl.text}) ${acid}` : `${multiplier(esters.length)}${alkyl.text} ${acid}`;
    // On a symmetric acid known by name the ester groups need no locants: ethyl methyl malonate.
    if (/^(oxal|malon|succin|glutar|adip|phthal|isophthal|terephthal)ate$/.test(acid)) return `${[...alkyls].sort((x, y) => x.sortKey.localeCompare(y.sortKey)).map((a) => (a.complex ? `(${a.text})` : a.text)).join(' ')} ${acid}`;
    // Different alkyl groups, each with the locant of its ester: 3-ethyl 5-methyl pyridine-3,5-dicarboxylate.
    const kinds = new Map<string, { sub: SubName; locs: string[] }>();
    esters.forEach((g, i) => {
      const loc = best.numbering.get(sites.get(g)!)!;
      const k = kinds.get(alkyls[i]!.text);
      if (k) k.locs.push(loc); else kinds.set(alkyls[i]!.text, { sub: alkyls[i]!, locs: [loc] });
    });
    const bare = (t: string) => /^(tert|sec)-[a-z]+$/.test(t);
    const words = [...kinds.values()].sort((x, y) => x.sub.sortKey.localeCompare(y.sub.sortKey)).map(({ sub, locs }) => {
      const n = locs.length;
      const body = sub.complex && !bare(sub.text) ? `${complexMultiplier(n)}(${sub.text})` : `${multiplier(n)}${sub.text}`;
      return `${locs.sort(compareLocant).join(',')}-${body}`;
    });
    return `${words.join(' ')} ${acid}`;
  }

  /**
   * Nitrate and nitrite esters where nothing more senior is present, named on the alcohol:
   * methyl nitrate, isopentyl nitrite, propane-1,2,3-triyl trinitrate, (...)furan-3-yl nitrate.
   */
  nitrateEster(): string | null {
    const mol = this.mol;
    if (this.principal && !['ketone', 'alcohol', 'thiol', 'amine', 'aldehyde', 'nitrile'].includes(this.principal)) return null;
    const found: { o: AtomId; c: AtomId; n: AtomId; kind: 'nitrate' | 'nitrite' }[] = [];
    for (const n of mol.atoms()) {
      if (n.element !== 'N' || this.an.ringAtoms.has(n.id)) continue;
      const nb = mol.neighbours(n.id);
      const bridge = nb.filter((o) => el(mol, o) === 'O' && mol.neighbours(o).length === 2 && mol.bondBetween(n.id, o)!.order === 1);
      const ends = nb.filter((o) => el(mol, o) === 'O' && mol.neighbours(o).length === 1);
      if (bridge.length !== 1) continue;
      const c = mol.neighbours(bridge[0]!).find((x) => x !== n.id)!;
      if (el(mol, c) !== 'C' || isAcylCarbon(mol, c)) continue;
      const nitro = ends.length === 2 && ((n.charge === 1 && ends.some((o) => mol.atom(o).charge === -1)) || (n.charge === 0 && ends.every((o) => mol.bondBetween(n.id, o)!.order === 2)));
      const nitroso = ends.length === 1 && n.charge === 0 && mol.bondBetween(n.id, ends[0]!)!.order === 2 && nb.length === 2;
      if (nitro) found.push({ o: bridge[0]!, c, n: n.id, kind: 'nitrate' });
      else if (nitroso) found.push({ o: bridge[0]!, c, n: n.id, kind: 'nitrite' });
    }
    if (!found.length || new Set(found.map((f) => f.kind)).size !== 1) return null;
    const word = found[0]!.kind;
    if (found.length === 1) {
      const r = this.substituent(found[0]!.c, found[0]!.o);
      return `${r.text} ${word}`;
    }
    const dropped = new Set(found.flatMap((f) => [f.o, f.n, ...mol.neighbours(f.n)]));
    const rest = [...mol.atoms()].map((a) => a.id).filter((x) => !dropped.has(x));
    const core = this.coreDiyl(rest, found.map((f) => f.c));
    return core ? `${core} ${multiplier(found.length)}${word}` : null;
  }

  /**
   * Several esters of one acid on one alcohol, named on the alcohol: propane-1,2,3-triyl trioctanoate,
   * (...)-octahydro-2H-indeno[5,6-b]furan-5,7-diyl diacetate. Null where the acids differ or the
   * alcohol parts are not one piece.
   */
  polyolEster(): string | null {
    const mol = this.mol;
    const esters = this.principalGroups.filter((g) => g.kind === 'ester');
    if (esters.length < 2 || esters.length !== this.principalGroups.length) return null;
    // Each acid part: the acyl carbon with whatever is on it but the ester oxygen.
    const acidOf = (g: Group) => {
      const o = g.consumed[1]!, seen = new Set<AtomId>([g.anchor]), stack = [g.anchor];
      while (stack.length) { const x = stack.pop()!; for (const y of mol.neighbours(x)) if (y !== o && !seen.has(y)) { seen.add(y); stack.push(y); } }
      return seen;
    };
    const acids = esters.map(acidOf);
    const all = new Set(acids.flatMap((a) => [...a]));
    if (acids.reduce((n, a) => n + a.size, 0) !== all.size) return null;
    const rest = [...mol.atoms()].map((a) => a.id).filter((x) => !all.has(x) && !esters.some((g) => g.consumed[1] === x));
    // The acids must be the same: name one as an acyl group and compare.
    const acyl = esters.map((g) => { try { return this.substituent(g.anchor, g.consumed[1]!).text; } catch { return null; } });
    if (acyl.some((a) => a === null || a !== acyl[0])) return null;
    const ends = esters.map((g) => g.esterCarbon!);
    if (!ends.every((e) => rest.includes(e))) return null;
    // The alcohol part in one piece.
    const restSet = new Set(rest), seen = new Set<AtomId>([rest[0]!]), stack = [rest[0]!];
    while (stack.length) { const x = stack.pop()!; for (const y of mol.neighbours(x)) if (restSet.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); } }
    if (seen.size !== rest.length) return null;
    const core = this.coreDiyl(rest, ends);
    if (!core) return null;
    const acid = esterWord(acyl[0]!);
    if (!acid) return null;
    return `${core} ${multiplier(esters.length)}${acid}`;
  }

  // -------------------------------------------------------- substituents

  substituent(a: AtomId, from: AtomId): SubName { return this.remembered(`${a}<${from}`, () => chemistStyle(this.computeSubstituent(a, from))); }

  /**
   * Each group is named once, whether it has a name or not: every candidate parent asks for the
   * same groups again, and without this a long polyene or polyprenyl chain takes exponential time.
   */
  remembered(key: string, compute: () => SubName): SubName {
    const hit = this.subCache.get(key);
    if (hit instanceof OutOfScope) throw hit;
    if (hit) return hit;
    try {
      const r = compute();
      this.subCache.set(key, r);
      return r;
    } catch (e) {
      if (e instanceof OutOfScope) this.subCache.set(key, e);
      throw e;
    }
  }

  computeSubstituent(a: AtomId, from: AtomId): SubName {
    const mol = this.mol;
    const e = el(mol, a);
    const others = mol.neighbours(a).filter((n) => n !== from);
    const simple = (text: string): SubName => ({ text, complex: false, sortKey: text });
    // A group on a double or triple bond is an ylidene or ylidyne, never "-yl": that would lose the bond.
    const link = mol.bondBetween(a, from);
    if (link && (link.order === 2 || link.order === 3)) throw new OutOfScope('substituent on a multiple bond');
    if (this.an.ringAtoms.has(a)) return this.ringSubstituent(a, from);
    if (HALO[e]) {
      const isotope = mol.atom(a).isotope;
      return isotope === null ? simple(HALO[e]!) : { text: `${HALO[e]!}-${isotope}${e}`, complex: true, sortKey: HALO[e]! };
    }
    if (e === 'O') {
      if (others.length === 0) return simple(mol.atom(a).charge === -1 ? 'oxido' : 'hydroxy');
      const r = others[0]!;
      if (isAcylCarbon(mol, r)) {
        const acyl = this.substituent(r, a);
        if (/^2-.+acetyl$/.test(acyl.text) && balanced(acyl.text.slice(0, -6))) { const t = `${acyl.text.slice(0, -6)}acetoxy`; return { text: t, complex: true, sortKey: sortKeyOf(t) }; }
        return acyl.text === 'acetyl' ? simple('acetoxy') : { text: `${acyl.complex ? `(${acyl.text})` : acyl.text}oxy`, complex: true, sortKey: `${acyl.sortKey}oxy` };
      }
      if (others.length === 1 && el(mol, r) === 'C' && mol.neighbours(r).length === 2 && mol.incidentBonds(r).some((b) => mol.bond(b).order === 3)) return simple('cyanato');
      return alkoxy(this.substituent(r, a));
    }
    if (e === 'Si' || e === 'Sn') {
      // Trialkylsilyl / trialkylstannyl, e.g. tert-butyldimethylsilyl, tributylstannyl.
      if (!others.every((n) => el(mol, n) === 'C' && mol.bondBetween(a, n)!.order === 1)) throw new OutOfScope(`${e} substituent`);
      const word = e === 'Si' ? 'silyl' : 'stannyl';
      const inner = others.length ? this.groupedSubs(others, a) : '';
      const text = `${inner}${word}`;
      return { text, complex: true, sortKey: sortKeyOf(text) };
    }
    if (e === 'P') {
      // (RO)2P(=O)- phosphoryl, (RO)2P(=S)- phosphorothioyl, R2P- phosphanyl.
      const dbl = others.filter((n) => mol.bondBetween(a, n)!.order === 2);
      if (dbl.length > 1 || dbl.some((n) => !['O', 'S'].includes(el(mol, n)) || mol.neighbours(n).length !== 1)) throw new OutOfScope('phosphorus substituent');
      const rest = others.filter((n) => !dbl.includes(n));
      const hP = this.an.h.get(a) ?? 0;
      // P(III) with three bonds or hydrogens (phosphanyl), or P(V) with one =O or =S and three
      // more: anything else (a five-bond P with no double bond, a charged P) is declined.
      const lambda5 = !dbl.length && !hP && rest.length === 4;
      if (mol.atom(a).charge !== 0 || (!lambda5 && 1 + rest.length + hP + 2 * dbl.length !== (dbl.length ? 5 : 3)) || rest.some((n) => mol.bondBetween(a, n)!.order !== 1)) throw new OutOfScope('phosphorus substituent');
      // An oxido on P(III) is read as =O.
      if (!dbl.length && !lambda5 && rest.some((n) => mol.atom(n).charge !== 0)) throw new OutOfScope('phosphorus substituent');
      const parts = rest.map((n) => this.substituent(n, a));
      // P(V) with hydrogen: hydroxy(oxo)-λ5-phosphanyl, the H-phosphinic acid; "hydroxyphosphoryl" would be P(=O)(OH)=.
      if (dbl.length && hP) parts.push({ text: el(mol, dbl[0]!) === 'S' ? 'thioxo' : 'oxo', complex: false, sortKey: el(mol, dbl[0]!) === 'S' ? 'thioxo' : 'oxo' });
      const counts = new Map<string, { s: SubName; n: number }>();
      for (const p2 of parts) { const c2 = counts.get(p2.text); if (c2) c2.n++; else counts.set(p2.text, { s: p2, n: 1 }); }
      // Every prefix after the first in brackets: hydroxy(methoxy)phosphorothioyl.
      const inner = [...counts.values()].sort((x, y) => x.s.sortKey.localeCompare(y.s.sortKey))
        .map(({ s: s2, n }, i) => (s2.complex || (i > 0 && n === 1) ? `${complexMultiplier(n)}(${s2.text})` : `${multiplier(n)}${s2.text}`)).join('');
      const word = lambda5 ? '-λ5-phosphanyl' : !dbl.length ? 'phosphanyl' : hP ? '-λ5-phosphanyl' : el(mol, dbl[0]!) === 'S' ? 'phosphorothioyl' : 'phosphoryl';
      const plain = `${inner}${word}`;
      const rs = this.rs.get(a);
      if (rs) this.cited.add(a);
      return { text: rs ? `(${rs})-${plain}` : plain, complex: true, sortKey: sortKeyOf(plain) };
    }
    if (e === 'S') {
      const oxo = others.filter((n) => el(mol, n) === 'O' && mol.bondBetween(a, n)!.order === 2).length;
      const rest = others.filter((n) => !(el(mol, n) === 'O' && mol.bondBetween(a, n)!.order === 2));
      if (rest.length === 0 && oxo === 0) return simple(mol.atom(a).charge === -1 ? 'sulfanidyl' : 'mercapto');
      if (oxo === 2 && rest.length === 1 && el(mol, rest[0]!) === 'O' && mol.atom(rest[0]!).charge === -1) return simple('sulfonato');
      if (oxo === 2 && rest.length === 1 && el(mol, rest[0]!) === 'O' && mol.neighbours(rest[0]!).length === 1 && this.an.h.get(rest[0]!) === 1) return simple('sulfo');
      if (oxo === 2 && rest.length === 1 && el(mol, rest[0]!) === 'N' && mol.neighbours(rest[0]!).length === 1 && mol.atom(rest[0]!).charge === 0) return simple('sulfamoyl');
      // Sulfinic acid and sulfinate as prefixes; "oxidosulfinyl" would read as a sulfonyl.
      if (oxo === 1 && rest.length === 1 && el(mol, rest[0]!) === 'O' && mol.neighbours(rest[0]!).length === 1) {
        if (mol.atom(rest[0]!).charge === -1) return simple('sulfinato');
        if (mol.atom(rest[0]!).charge === 0 && this.an.h.get(rest[0]!) === 1) return simple('sulfino');
      }
      if (mol.atom(a).charge !== 0 || this.an.h.get(a)) throw new OutOfScope('sulfur substituent');
      // Oxido on a sulfur reads as =O.
      if (rest.length === 1 && el(mol, rest[0]!) === 'O' && mol.atom(rest[0]!).charge !== 0) throw new OutOfScope('sulfur substituent');
      if (rest.length === 1 && !oxo && el(mol, rest[0]!) === 'C' && mol.neighbours(rest[0]!).length === 2 && mol.incidentBonds(rest[0]!).some((b) => mol.bond(b).order === 3)) return simple('thiocyanato');
      // -S-S-R: methyldisulfaneyl.
      const s2 = rest.length === 1 && !oxo ? rest[0]! : undefined;
      if (s2 !== undefined && el(mol, s2) === 'S' && mol.atom(s2).charge === 0 && mol.neighbours(s2).length === 2 && mol.incidentBonds(s2).every((b) => mol.bond(b).order === 1)) {
        const far = mol.neighbours(s2).find((x) => x !== a)!;
        if (el(mol, far) === 'C') {
          const R = this.substituent(far, s2);
          const text = `${wrapInner(R)}disulfaneyl`;
          return { text, complex: true, sortKey: sortKeyOf(text) };
        }
      }
      if (rest.length === 1) {
        const R = this.substituent(rest[0]!, a);
        const tail = oxo === 2 ? 'sulfonyl' : oxo === 1 ? 'sulfinyl' : 'thio';
        const inner = wrapInner(R);
        // A sulfinyl sulfur is a stereocentre: ((S)-phenylsulfinyl).
        const rs = this.rs.get(a);
        if (rs) this.cited.add(a);
        return { text: `${rs ? `(${rs})-` : ''}${inner}${tail}`, complex: true, sortKey: `${R.sortKey}${tail}` };
      }
      throw new OutOfScope('sulfur substituent');
    }
    if (e === 'N') {
      const oxy = others.filter((n) => el(mol, n) === 'O');
      // Nitro is exactly N(=O)=O or N+(=O)O-; N(OH)2 is dihydroxyamino, and N+(=O)OH is declined below.
      if (oxy.length === 2 && others.length === 2 && oxy.every((o) => mol.neighbours(o).length === 1)) {
        const q = mol.atom(a).charge, ords = oxy.map((o) => mol.bondBetween(a, o)!.order).sort(), qs = oxy.map((o) => mol.atom(o).charge).sort();
        if (q === 0 && ords.join() === '2,2' && qs.join() === '0,0') return simple('nitro');
        if (q === 1 && ords.join() === '1,2' && oxy.some((o) => mol.bondBetween(a, o)!.order === 1 && mol.atom(o).charge === -1) && oxy.some((o) => mol.bondBetween(a, o)!.order === 2 && mol.atom(o).charge === 0)) return simple('nitro');
        if (q === 0 && ords.join() === '1,1' && oxy.every((o) => mol.atom(o).charge === 0 && this.an.h.get(o) === 1)) return { text: 'dihydroxyamino', complex: true, sortKey: 'dihydroxyamino' };
        throw new OutOfScope('nitrogen substituent');
      }
      if (mol.atom(a).charge === 1 && others.length === 1 && mol.bondBetween(a, others[0]!)!.order === 3 && el(mol, others[0]!) === 'C' && mol.atom(others[0]!).charge === -1) return simple('isocyano');
      if (mol.atom(a).charge === 1) {
        // -N+H=C<: (propan-2-ylidene)azaniumyl.
        const d2 = others.find((n) => mol.bondBetween(a, n)!.order === 2);
        if (d2 !== undefined && el(mol, d2) === 'C' && others.length === 1) {
          const Y = this.ylidene(d2, a);
          return { text: `${Y.complex ? `(${Y.text})` : Y.text}azaniumyl`, complex: true, sortKey: `${Y.sortKey}azaniumyl` };
        }
        // Open-chain ammonium as a prefix: trimethylazaniumyl, azaniumyl.
        if (!mol.incidentBonds(a).every((b) => mol.bond(b).order === 1)) throw new OutOfScope('nitrogen substituent');
        const inner = others.length ? this.groupedSubs(others, a) : '';
        return { text: `${inner}azaniumyl`, complex: true, sortKey: sortKeyOf(`${inner}azaniumyl`) };
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
      // -NH-NH2 hydrazineyl; other N, O and S neighbours are named as prefixes on amino:
      // (phenylamino)amino, hydroxyamino, (methylsulfonyl)amino.
      if (others.length === 1 && el(mol, others[0]!) === 'N' && mol.neighbours(others[0]!).length === 1 && mol.atom(others[0]!).charge === 0) return simple('hydrazineyl');
      // -NH-NR2: 2,2-dimethylhydrazineyl, 2-phenylhydrazineyl.
      const o0 = others[0]!;
      const far = others.length === 1 && el(mol, o0) === 'N' && mol.atom(o0).charge === 0 && !this.an.ringAtoms.has(o0) && mol.incidentBonds(o0).every((b) => mol.bond(b).order === 1)
        ? mol.neighbours(o0).filter((x) => x !== a) : [];
      if (far.length && far.every((x) => el(mol, x) === 'C' && !isAcylCarbon(mol, x))) {
        const subs = countSubs(far.map((x) => this.substituent(x, o0)).sort((x, y) => x.sortKey.localeCompare(y.sortKey)));
        const text = subs.map((x) => `${Array(x.n).fill('2').join(',')}-${x.n > 1 ? (x.complex ? complexMultiplier(x.n) : multiplier(x.n)) : ''}${x.complex ? `(${x.text})` : x.text}`).join('-') + 'hydrazineyl';
        return { text, complex: true, sortKey: sortKeyOf(text) };
      }
      // -NH-N=CR2: 2-(3-methylbenzylidene)hydrazineyl.
      const hz = others.length === 1 && el(mol, o0) === 'N' && mol.atom(o0).charge === 0 && !this.an.ringAtoms.has(o0) && mol.neighbours(o0).length === 2
        ? mol.neighbours(o0).find((x) => x !== a && el(mol, x) === 'C' && mol.bondBetween(o0, x)!.order === 2) : undefined;
      if (hz !== undefined) {
        const Y = this.ylidene(hz, o0);
        const text = `2-${Y.complex ? `(${Y.text})` : Y.text}hydrazineyl`;
        return { text, complex: true, sortKey: sortKeyOf(text) };
      }
      const acyl = others.find((n) => isAcylCarbon(mol, n));
      if (acyl !== undefined && others.length === 1) {
        const A = this.substituent(acyl, a);
        if (A.text === 'acetyl') return simple('acetamido');
        if (A.text === 'benzoyl') return simple('benzamido');
        const am = amido(A.text);
        if (am) return { text: am, complex: true, sortKey: sortKeyOf(am) };
        return { text: `${A.complex ? `(${A.text})` : A.text}amino`, complex: true, sortKey: `${A.sortKey}amino` };
      }
      if (others.length === 0) return simple('amino');
      const subs = others.map((n) => this.substituent(n, a)).sort((x, y) => x.sortKey.localeCompare(y.sortKey));
      if (subs.length === 2 && subs[0]!.text === subs[1]!.text) {
        const s = subs[0]!;
        return { text: `di${s.complex ? `(${s.text})` : s.text}amino`, complex: true, sortKey: `di${s.sortKey}amino` };
      }
      const inner = subs.map((s, i) => (i < subs.length - 1 || s.complex) ? (s.complex || subs.length > 1 && i > 0 ? `(${s.text})` : s.text) : s.text).join('');
      const s0 = subs[0]!;
      const wrap0 = subs.length === 1 ? wrapInner(s0) : s0.complex ? `(${s0.text})` : s0.text;
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
    // A thioacyl group on a chain: propanethioyl.
    const dS = bonds.find((x) => x.o === 2 && el(mol, x.n) === 'S' && mol.neighbours(x.n).length === 1);
    if (dS && !dO && bonds.length === 2 && bonds.some((x) => x !== dS && x.o === 1 && el(mol, x.n) === 'C' && !this.an.ringAtoms.has(x.n))) {
      const chain = this.alkyl(a, from, 'oyl');
      // The chain names the =S on its first carbon as 1-thioxo; the ending says it instead.
      const bare = chain.text.replace(/-1-thioxo(?=[a-z])/, '').replace(/(^|\)-)1-thioxo(?=[a-z])/, '$1');
      if (/anoyl$/.test(bare) && !/thioxo/.test(bare)) { const text = bare.replace(/oyl$/, 'ethioyl'); return { text, complex: chain.complex, sortKey: sortKeyOf(text) }; }
    }
    if (dO) {
      const rest = bonds.filter((x) => x !== dO);
      if (rest.length === 0) return simple('formyl');
      const r = rest[0]!;
      const re = el(mol, r.n);
      if (re === 'O') {
        const beyond = mol.neighbours(r.n).filter((n) => n !== a);
        // CO2- as a prefix keeps its charge: 3-carboxylato-3-hydroxypentanedioate.
        if (beyond.length === 0) return simple(mol.atom(r.n).charge === -1 ? 'carboxylato' : 'carboxy');
        const R = this.substituent(beyond[0]!, r.n);
        const ro = alkoxy(R).text;
        // A substituted alkoxy is bracketed before carbonyl: (2-hydroxyethoxy)carbonyl.
        const alk = R.text === 'benzyl' ? '(benzyloxy)' : ALKOXY[R.text] || /(yl|\))oxy$/.test(ro) ? ro : `(${ro})`;
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
        return { text, complex: true, sortKey: sortKeyOf(text) };
      }
      if (re === 'N') {
        const nsubs = mol.neighbours(r.n).filter((n) => n !== a);
        if (mol.atom(r.n).charge !== 0) throw new OutOfScope('charged carbamoyl nitrogen');
        if (nsubs.length === 0) return simple('carbamoyl');
        // What is on the nitrogen, double-bonded as an ylidene: ((diaminomethylidene)carbamoyl), (dimethylcarbamoyl).
        const S = nsubs.map((n) => (mol.bondBetween(r.n, n)!.order === 2 ? this.ylidene(n, r.n) : this.substituent(n, r.n)));
        const text = `${citeRun(countSubs(S))}carbamoyl`;
        return { text, complex: true, sortKey: sortKeyOf(text) };
      }
      if (re === 'S' && rest.length === 1 && r.o === 1 && mol.neighbours(r.n).length === 2 && !this.an.ringAtoms.has(r.n)) {
        // C(=O)S-R hanging off something: ((methylthio)carbonyl).
        const R = this.substituent(r.n, a);
        return { text: `(${R.text})carbonyl`, complex: true, sortKey: `${R.sortKey}carbonyl` };
      }
      if (HALO[re]) return { text: `${HALO[re]!.replace('o', 'o')}carbonyl`.replace(/^(\w+)o(carbonyl)$/, '$1ocarbonyl'), complex: true, sortKey: 'carbonyl' };
      if (re === 'C') {
        // Acyl: acetyl, benzoyl, or alkanoyl numbered from the carbonyl carbon.
        if (this.an.ringAtoms.has(r.n)) {
          const R = this.ringSubstituent(r.n, a);
          if (R.text === 'phenyl') return simple('benzoyl');
          const c = ringCarbonyl(R.text);
          if (c) return { text: c, complex: true, sortKey: sortKeyOf(c) };
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
    // On one carbon there is nowhere else to be: (bromomethyl), (trifluoromethyl), not (1-bromomethyl).
    const pre = this.prefixString(prefixes, numbering, n === 1);

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
      if (n === 4 && fv === 2 && locs === '2') return { text: 'tert-pentyl', complex: true, sortKey: 'pentyl' };
      if (n === 3 && fv === 1 && locs === '2') return { text: 'isobutyl', complex: false, sortKey: 'isobutyl' };
      if (n === 4 && fv === 1 && locs === '3') return { text: 'isopentyl', complex: false, sortKey: 'isopentyl' };
      if (n === 3 && fv === 1 && locs === '2,2') return { text: 'neopentyl', complex: false, sortKey: 'neopentyl' };
    }
    if (ending === 'yl' && sat && n === 1 && prefixes.length === 1 && prefixes[0]!.text === 'phenyl') return { text: 'benzyl', complex: false, sortKey: 'benzyl' };
    if (ending === 'ylidene' && n === 1 && prefixes.length === 1 && prefixes[0]!.text === 'phenyl') {
      // Its double bond's E or Z is cited with it: ((E)-benzylidene)amino.
      const ez = this.stereoPrefix(path, numbering, from);
      return { text: ez ? `${ez}-benzylidene` : 'benzylidene', complex: !!ez, sortKey: 'benzylidene' };
    }

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
    // A substituent that has substituents goes in brackets: (bromomethyl)benzene.
    const complex = prefixes.length > 0 || /[0-9]/.test(text) || text.includes('(');
    return { text, complex, sortKey: sortKeyOf(plain) };
  }

  ringSubstituent(a: AtomId, from: AtomId, ylidene = false): SubName {
    const system = this.ringByAtom.get(a)!;
    if (system.includes(from)) throw new OutOfScope('ring entered from inside itself');
    const r = recognizeRing(this.an, system);
    if (!r) throw new OutOfScope('ring substituent without a supported name');
    const mol = this.mol;
    if (!ylidene) { const asm = this.assemblySubstituent(a, from, { kind: 'ring', atoms: system, numberings: r.numberings, ring: r.info }); if (asm) return asm; }
    const inS = new Set(system);
    // A triple bond in the ring would be written as one more "ene" below.
    if ([...mol.bonds()].some((b) => b.order === 3 && inS.has(b.begin) && inS.has(b.end))) throw new OutOfScope('ring substituent with a triple bond');
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
    // On a ring that is a substituent, its oxides are prefixes: 1,1-dioxidothiomorpholin-4-yl.
    for (const x of system) for (let i = this.oxides.get(x) ?? 0; i > 0; i--) pre.push({ text: 'oxido', complex: false, sortKey: 'oxido', at: x });
    const unsat: [AtomId, AtomId][] = [];
    if (r.info.kind !== 'template' && r.info.kind !== 'spiro') for (const b of mol.bonds()) if (inS.has(b.begin) && inS.has(b.end) && b.order === 2) unsat.push([b.begin, b.end]);
    const ringP: Parent = { kind: 'ring', atoms: system, numberings: r.numberings, ring: r.info };
    for (const numbering of r.numberings) {
      const heteros = r.info.kind === 'vonbaeyer' || r.info.kind === 'cyclo' ? system.filter((x) => el(mol, x) !== 'C') : [];
      const key: (number | number[])[] = [
        // A von Baeyer or replacement name numbers its heteroatoms first: 2-oxa-6-azaspiro[3.3]heptan-6-yl.
        heteros.map((x) => locVal(numbering.get(x)!)).sort((x, y) => x - y),
        [...heteros].sort((x, y) => 'OSN'.indexOf(el(mol, x)) - 'OSN'.indexOf(el(mol, y))).map((x) => locVal(numbering.get(x)!)),
        // Indicated hydrogen at the point of attachment where there is any: 9H-purin-9-yl.
        (el(mol, a) === 'N' || ylidene) && (hydroOf.get(numbering)?.ih ?? []).length && !(hydroOf.get(numbering)?.ih ?? []).includes(a) ? 1 : 0,
        (hydroOf.get(numbering)?.ih ?? []).map((x) => locVal(numbering.get(x)!)).sort((x, y) => x - y),
        locVal(numbering.get(a)!),
        (hydroOf.get(numbering)?.hydro ?? []).map((x) => locVal(numbering.get(x)!)).sort((x, y) => x - y),
        unsat.map((u) => this.bondLocant(ringP, numbering, u)).sort((x, y) => x - y),
        pre.map((x) => locVal(numbering.get(x.at as AtomId)!)).sort((x, y) => x - y),
        alphaLocs(pre, numbering),
      ];
      if (!best || cmpKey(key, best.key) < 0) best = { numbering, key, pre };
    }
    const numbering = best!.numbering;
    let preText = this.prefixString(pre, numbering, false);
    if (pre.length >= 2 && new Set(pre.map((x) => x.text)).size === 1 && /^(fluoro|chloro|bromo|iodo)$/.test(pre[0]!.text)
      && system.every((x) => mol.implicitHydrogens(x) === 0 && el(mol, x) === 'C')) preText = `per${pre[0]!.text}`;
    const fv = numbering.get(a)!;
    // Cationic ring nitrogens: piperidin-1-ium-4-yl.
    const iumLocs = system.filter((x) => isRingCation(mol, x)).map((x) => numbering.get(x)!).sort(compareLocant);
    const ideLocs = system.filter((x) => isRingAnion(mol, x)).map((x) => numbering.get(x)!).sort(compareLocant);
    const ium = (iumLocs.length ? `-${iumLocs.join(',')}-${multiplier(iumLocs.length)}ium` : '')
      + (ideLocs.length ? `-${ideLocs.join(',')}-${multiplier(ideLocs.length)}ide` : '');
    let core: string;
    if (r.info.kind === 'spiro') {
      core = `${spiroText(numbering).replace(/e\]$/, ']')}${ium}-${fv}-yl${ylidene ? 'idene' : ''}`;
    } else if (r.info.kind === 'template') {
      const t = r.info.template!;
      const h = hydroOf.get(numbering);
      // A ring atom double-bonded outwards needs a saturated position: 2,3-dihydro-...-2-ylidene.
      if (ylidene && !h && t.aromatic) throw new OutOfScope('ring ylidene substituent');
      if (h?.saturated && t.saturated) core = `${t.saturated.replace(/e$/, '')}${ium}-${fv}-yl`;
      else if (h && (el(mol, a) === 'N' || ylidene) && h.hydro.includes(a) && !h.ih.includes(a) && !ium) {
        // Joined through a ring nitrogen that would be a hydro position: its hydrogen is added
        // hydrogen, with the lowest one beside it: 3,4-dihydroquinolin-1(2H)-yl, 2-oxopyrimidin-1(2H)-yl.
        const byLoc = (x: AtomId, y: AtomId) => compareLocant(numbering.get(x)!, numbering.get(y)!);
        const partner = h.hydro.filter((x) => x !== a && mol.bondBetween(a, x)).sort(byLoc)[0] ?? h.hydro.filter((x) => x !== a).sort(byLoc)[0]!;
        const rest: Hydro = { ...h, hydro: h.hydro.filter((x) => x !== a && x !== partner) };
        core = `${withHydro((bridgeOf.get(numbering) ?? '') + t.yl, rest, numbering)}-${fv}(${numbering.get(partner)}H)-yl`;
      } else if (h) core = `${withHydro((bridgeOf.get(numbering) ?? '') + t.yl, h, numbering)}${ium}-${fv}-yl`;
      else if (t.name === 'benzene') core = 'phenyl';
      else if ((t.name === 'morpholine' || t.name === 'thiomorpholine') && fv === '4' && !ium) core = `${t.name.replace(/e$/, '')}o`;
      else core = `${t.indicatedH ? `${t.indicatedH}H-` : ''}${t.yl}${ium}-${fv}-yl`;
      if (ylidene) core += 'idene';
    } else if (r.info.kind === 'vonbaeyer') {
      const hetero = heteroPrefix(this.mol, system, numbering);
      const base2 = `${hetero}${r.info.bracket}${alkaneStem(r.info.size)}`;
      core = unsat.length
        ? `${base2}${multiplier(unsat.length) ? 'a' : ''}-${unsat.map((u) => this.bondLocantText(ringP, numbering, u)).sort(compareLocant).join(',')}-${multiplier(unsat.length)}en${ium}-${fv}-yl`
        : `${base2}an${ium}-${fv}-yl`;
      if (ylidene) core += 'idene';
    } else {
      const hetero = heteroPrefix(this.mol, system, numbering, true);
      const stem = `${hetero}cyclo${alkaneStem(r.info.size)}`;
      if (!unsat.length) core = hetero ? `${stem}an${ium}-${fv}-yl` : `${stem}yl`;
      else {
        const locs = unsat.map((u) => this.bondLocant(ringP, numbering, u)).sort((x, y) => x - y).join(',');
        const m = multiplier(unsat.length);
        core = `${stem}${m ? 'a' : ''}-${locs}-${m}en-${fv}-yl`;
      }
      if (ylidene) core += 'idene';
    }
    const plain = preText + (preText && /^[0-9[]/.test(core) ? '-' : '') + core;
    const stereo = this.stereoPrefix(system, numbering, from);
    const text = stereo ? `${stereo}-${plain}` : plain;
    const complex = /[0-9]/.test(text) || text.includes('(') || /^per/.test(preText);
    // Nothing on the ring: two of them are di(1H-imidazol-1-yl), not bis.
    return { text, complex, sortKey: sortKeyOf(plain), ...(complex && !pre.length && !stereo ? { di: true } : {}) };
  }
}
