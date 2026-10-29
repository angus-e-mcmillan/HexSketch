/**
 * Peptides written in three-letter code, e.g. "H-Ala-Gly-Phe-OH",
 * "Ac-Lys(Boc)-D-Pro-NH2", "Boc-Ser(tBu)-OMe": parsing, building the full
 * structure (L residues unless marked D-), a ChemDraw-style zigzag layout,
 * names OPSIN can read back, and recognising a drawn structure as a peptide
 * so it keeps its sequence after Expand Label.
 *
 * The residue table is ordinary amino-acid chemistry written for HexSketch;
 * nothing is taken from ChemDraw's nickname or monomer files.
 */
import { assignWedges, layout2D } from './layout.ts';
import { Molecule, type AtomId } from './model.ts';
import { sameStructure, isomorphisms } from './isomorphism.ts';
import { parseSmiles } from './smiles.ts';
import { perceiveStereoFromGeometry, rsLabel } from './stereo.ts';

type Pt = { x: number; y: number };

interface ResidueDef {
  /** Side chain as written inside N[C@@H](...)C(=O) for the L residue; '' for glycine. */
  side?: string;
  /** The same side chain with '*' where a protecting group goes. */
  prot?: string;
  /** A whole residue that does not fit N[C@@H](side)C(=O): SMILES and its backbone atom indices. */
  special?: { smiles: string; main: number[]; d?: string };
  /** Acyl and free names for peptide nomenclature (null: no name). */
  acyl: string | null;
  free: string | null;
  /** Name of the C-terminal amide, when it has a common one. */
  amide?: string;
  achiral?: boolean;
}

/** {a}, {b}, ... are ring-closure placeholders, numbered afresh each time a residue is used. */
export const RESIDUES: Readonly<Record<string, ResidueDef>> = {
  Ala: { side: 'C', acyl: 'alanyl', free: 'alanine', amide: 'alaninamide' },
  Arg: { side: 'CCCNC(=N)N', prot: 'CCCNC(=N)N*', acyl: 'arginyl', free: 'arginine', amide: 'argininamide' },
  Asn: { side: 'CC(=O)N', prot: 'CC(=O)N*', acyl: 'asparaginyl', free: 'asparagine', amide: 'asparaginamide' },
  Asp: { side: 'CC(=O)O', prot: 'CC(=O)O*', acyl: 'α-aspartyl', free: 'aspartic acid' },
  Cys: { side: 'CS', prot: 'CS*', acyl: 'cysteinyl', free: 'cysteine', amide: 'cysteinamide' },
  Gln: { side: 'CCC(=O)N', prot: 'CCC(=O)N*', acyl: 'glutaminyl', free: 'glutamine', amide: 'glutaminamide' },
  Glu: { side: 'CCC(=O)O', prot: 'CCC(=O)O*', acyl: 'α-glutamyl', free: 'glutamic acid' },
  Gly: { side: '', acyl: 'glycyl', free: 'glycine', amide: 'glycinamide', achiral: true },
  His: { side: 'Cc{a}c[nH]cn{a}', prot: 'Cc{a}cn(*)cn{a}', acyl: 'histidyl', free: 'histidine', amide: 'histidinamide' },
  Ile: { side: '[C@@H](C)CC', acyl: 'isoleucyl', free: 'isoleucine', amide: 'isoleucinamide' },
  Leu: { side: 'CC(C)C', acyl: 'leucyl', free: 'leucine', amide: 'leucinamide' },
  Lys: { side: 'CCCCN', prot: 'CCCCN*', acyl: 'lysyl', free: 'lysine', amide: 'lysinamide' },
  Met: { side: 'CCSC', acyl: 'methionyl', free: 'methionine', amide: 'methioninamide' },
  Phe: { side: 'Cc{a}ccccc{a}', acyl: 'phenylalanyl', free: 'phenylalanine', amide: 'phenylalaninamide' },
  Pro: { special: { smiles: 'N{a}CCC[C@H]{a}C(=O)', main: [0, 4, 5], d: 'N{a}CCC[C@@H]{a}C(=O)' }, acyl: 'prolyl', free: 'proline', amide: 'prolinamide' },
  Ser: { side: 'CO', prot: 'CO*', acyl: 'seryl', free: 'serine', amide: 'serinamide' },
  Thr: { side: '[C@@H](C)O', prot: '[C@@H](C)O*', acyl: 'threonyl', free: 'threonine', amide: 'threoninamide' },
  Trp: { side: 'Cc{a}c[nH]c{b}ccccc{a}{b}', prot: 'Cc{a}cn(*)c{b}ccccc{a}{b}', acyl: 'tryptophyl', free: 'tryptophan', amide: 'tryptophanamide' },
  Tyr: { side: 'Cc{a}ccc(O)cc{a}', prot: 'Cc{a}ccc(O*)cc{a}', acyl: 'tyrosyl', free: 'tyrosine', amide: 'tyrosinamide' },
  Val: { side: 'C(C)C', acyl: 'valyl', free: 'valine', amide: 'valinamide' },
  // Common non-proteinogenic residues.
  Orn: { side: 'CCCN', prot: 'CCCN*', acyl: 'ornithyl', free: 'ornithine' },
  Nle: { side: 'CCCC', acyl: 'norleucyl', free: 'norleucine' },
  Nva: { side: 'CCC', acyl: 'norvalyl', free: 'norvaline' },
  Abu: { side: 'CC', acyl: null, free: null },
  Cit: { side: 'CCCNC(N)=O', acyl: 'citrullyl', free: 'citrulline' },
  Dab: { side: 'CCN', prot: 'CCN*', acyl: null, free: null },
  Dap: { side: 'CN', prot: 'CN*', acyl: null, free: null },
  Phg: { side: 'c{a}ccccc{a}', acyl: null, free: null },
  Cha: { side: 'CC{a}CCCCC{a}', acyl: null, free: null },
  Tle: { side: 'C(C)(C)C', acyl: null, free: null },
  Sec: { side: 'C[SeH]', acyl: 'selenocysteinyl', free: 'selenocysteine' },
  Hyp: { special: { smiles: 'N{a}C[C@H](O)C[C@H]{a}C(=O)', main: [0, 5, 6], d: 'N{a}C[C@@H](O)C[C@@H]{a}C(=O)' }, acyl: null, free: null },
  Aib: { special: { smiles: 'NC(C)(C)C(=O)', main: [0, 1, 4] }, acyl: null, free: null, achiral: true },
  Sar: { special: { smiles: 'N(C)CC(=O)', main: [0, 2, 3] }, acyl: 'sarcosyl', free: 'sarcosine', achiral: true },
  bAla: { special: { smiles: 'NCCC(=O)', main: [0, 1, 2, 3] }, acyl: 'β-alanyl', free: 'β-alanine', achiral: true },
  pGlu: { special: { smiles: 'N{a}C(=O)CC[C@H]{a}C(=O)', main: [0, 5, 6], d: 'N{a}C(=O)CC[C@@H]{a}C(=O)' }, acyl: null, free: null },
};

/** Protecting groups on side chains, as the substituent that replaces '*'. Leading O is optional (OtBu = tBu). */
const PROTECTIONS: Readonly<Record<string, string>> = {
  Boc: 'C(=O)OC(C)(C)C', Z: 'C(=O)OCc{p}ccccc{p}', Cbz: 'C(=O)OCc{p}ccccc{p}',
  Fmoc: 'C(=O)OCC{p}c{q}ccccc{q}-c{s}ccccc{p}{s}', Alloc: 'C(=O)OCC=C', Ac: 'C(C)=O', Tfa: 'C(=O)C(F)(F)F',
  Trt: 'C(c{p}ccccc{p})(c{q}ccccc{q})c{s}ccccc{s}', tBu: 'C(C)(C)C', Bn: 'Cc{p}ccccc{p}', Bzl: 'Cc{p}ccccc{p}',
  Me: 'C', Et: 'CC', All: 'CC=C', Acm: 'CNC(C)=O', StBu: 'SC(C)(C)C', TBS: '[Si](C)(C)C(C)(C)C', TBDMS: '[Si](C)(C)C(C)(C)C',
  Pbf: 'S(=O)(=O)c{p}c(C)c(C)c{q}OC(C)(C)Cc{q}c{p}C', Tos: 'S(=O)(=O)c{p}ccc(C)cc{p}', Ts: 'S(=O)(=O)c{p}ccc(C)cc{p}',
  NO2: '[N+](=O)[O-]', Mtt: 'C(c{p}ccccc{p})(c{q}ccccc{q})c{s}ccc(C)cc{s}',
};

interface Terminus { smiles: string; main: number[]; name?: string }
/** N-terminal groups: SMILES whose last atom bonds to the first residue's N. */
const N_TERMINI: Readonly<Record<string, Terminus>> = {
  H: { smiles: '', main: [] },
  Ac: { smiles: 'CC(=O)', main: [0, 1], name: 'N-acetyl-' },
  Boc: { smiles: 'CC(C)(C)OC(=O)', main: [1, 4, 5] },
  Z: { smiles: 'c{a}ccccc{a}COC(=O)', main: [6, 7, 8] },
  Cbz: { smiles: 'c{a}ccccc{a}COC(=O)', main: [6, 7, 8] },
  Fmoc: { smiles: 'C{a}(c{b}ccccc{b}-c{c}ccccc{a}{c})COC(=O)', main: [0, 13, 14, 15] },
  Bz: { smiles: 'c{a}ccccc{a}C(=O)', main: [6] },
  Alloc: { smiles: 'C=CCOC(=O)', main: [0, 1, 2, 3, 4] },
  Tfa: { smiles: 'FC(F)(F)C(=O)', main: [1, 4] },
  For: { smiles: 'C(=O)', main: [0], name: 'N-formyl-' },
  Me: { smiles: 'C', main: [0] },
};
/** C-terminal groups: SMILES bonded to the last carbonyl carbon. */
const C_TERMINI: Readonly<Record<string, Terminus>> = {
  OH: { smiles: 'O', main: [0] },
  NH2: { smiles: 'N', main: [0] },
  NHMe: { smiles: 'NC', main: [0, 1] },
  NHEt: { smiles: 'NCC', main: [0, 1, 2] },
  OMe: { smiles: 'OC', main: [0, 1], name: 'methyl' },
  OEt: { smiles: 'OCC', main: [0, 1, 2], name: 'ethyl' },
  OtBu: { smiles: 'OC(C)(C)C', main: [0, 1] },
  OBn: { smiles: 'OCc{a}ccccc{a}', main: [0, 1] },
  OBzl: { smiles: 'OCc{a}ccccc{a}', main: [0, 1] },
  OAll: { smiles: 'OCC=C', main: [0, 1, 2, 3] },
};

export interface PeptideResidue { code: string; d: boolean; nMe: boolean; protection: string | null; stereoUnknown?: boolean }
export interface Peptide { nTerm: string; residues: PeptideResidue[]; cTerm: string }

/**
 * Parse a peptide written as hyphen-separated three-letter codes. Termini are
 * optional (H- and -OH are assumed); D- marks a D residue, Me an N-methyl
 * residue (MeLeu), and parentheses a side-chain protecting group (Lys(Boc)).
 * Text with no hyphen is not treated as a peptide, so a plain "Ala" label stays a label.
 */
export function parsePeptide(text: string): Peptide | null {
  const t = text.trim().replace(/[–—]/g, '-');
  if (!t.includes('-') || /\s/.test(t)) return null;
  const tokens = t.split('-');
  if (tokens.some((x) => x === '')) return null;
  let nTerm = 'H', cTerm = 'OH';
  if (N_TERMINI[tokens[0]!] && tokens.length > 1) nTerm = tokens.shift()!;
  if (C_TERMINI[tokens[tokens.length - 1]!] && tokens.length > 1) cTerm = tokens.pop()!;
  const residues: PeptideResidue[] = [];
  let d = false;
  for (const tok of tokens) {
    if (tok === 'D' || tok === 'L') { if (d) return null; d = tok === 'D'; continue; }
    const m = /^(N?Me)?([A-Za-z]{3,4})(?:\(([A-Za-z0-9]+)\))?$/.exec(tok);
    if (!m) return null;
    let code = m[2]!;
    let nMe = !!m[1];
    if (!RESIDUES[code] && /^Me[A-Z][a-z]{2}$/.test(m[0]!)) { code = m[0]!.slice(2); nMe = true; }
    const def = RESIDUES[code];
    if (!def) return null;
    let protection = m[3] ?? null;
    if (protection) {
      if (!def.prot) return null;
      const key = PROTECTIONS[protection] ? protection : protection.replace(/^O(?=[A-Z]|tBu)/, '');
      if (!PROTECTIONS[key]) return null;
      protection = key;
    }
    if (nMe && def.special) return null;
    residues.push({ code, d: d && !def.achiral, nMe, protection });
    d = false;
  }
  if (d || !residues.length) return null;
  if (residues.some((r, i) => r.code === 'pGlu' && i > 0)) return null;
  if (residues[0]!.code === 'pGlu' && nTerm !== 'H') return null;
  return { nTerm, residues, cTerm };
}

/** Write a peptide back in three-letter code. */
export function peptideText(p: Peptide): string {
  const res = p.residues.map((r) => `${r.d ? 'D-' : ''}${r.nMe ? 'Me' : ''}${r.code}${r.protection ? `(${r.protection})` : ''}`);
  return [p.residues[0]?.code === 'pGlu' ? null : p.nTerm, ...res, p.cTerm].filter((x) => x !== null).join('-');
}

// ------------------------------------------------------------------ building

/** Count atoms in a SMILES fragment (bracket atoms, two-letter halogens, organic subset). */
function countAtoms(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '[') { i = s.indexOf(']', i); n++; }
    else if ((c === 'C' && s[i + 1] === 'l') || (c === 'B' && s[i + 1] === 'r')) { n++; i++; }
    else if (/[BCNOPSFIbcnops]/.test(c)) n++;
  }
  return n;
}

interface Built { smiles: string; main: number[] }

function buildSmiles(p: Peptide): Built {
  let ring = 10;
  const fresh = (s: string) => {
    const map = new Map<string, string>();
    return s.replace(/\{(\w+)\}/g, (_, k: string) => { if (!map.has(k)) map.set(k, `%${ring++}`); return map.get(k)!; });
  };
  let smiles = '', count = 0;
  const main: number[] = [];
  const put = (frag: string, idx: number[]) => { main.push(...idx.map((i) => i + count)); smiles += frag; count += countAtoms(frag); };
  const nt = N_TERMINI[p.nTerm]!;
  if (p.residues[0]!.code !== 'pGlu') put(fresh(nt.smiles), nt.main);
  for (const r of p.residues) {
    const def = RESIDUES[r.code]!;
    if (def.special) {
      const s = r.d && def.special.d ? def.special.d : def.special.smiles;
      put(fresh(s), def.special.main);
      continue;
    }
    let side = fresh(r.protection ? def.prot!.replace('*', PROTECTIONS[r.protection]!) : def.side!);
    // A D residue is the mirror image: side-chain centres invert too (D-Ile is 2R,3R).
    if (r.d) side = side.replace(/@@?/g, (m) => (m === '@' ? '@@' : '@'));
    const n = r.nMe ? 'N(C)' : 'N';
    const nAtoms = r.nMe ? 2 : 1;
    if (def.achiral && side === '') { put(`${n}CC(=O)`, [0, nAtoms, nAtoms + 1]); continue; }
    const ca = r.d ? '[C@H]' : '[C@@H]';
    const frag = `${n}${ca}(${side})C(=O)`;
    const sideAtoms = countAtoms(side);
    put(frag, [0, nAtoms, nAtoms + 1 + sideAtoms]);
  }
  const ct = C_TERMINI[p.cTerm]!;
  put(fresh(ct.smiles), ct.main);
  return { smiles, main };
}

/** SMILES of a peptide (L residues unless marked D). */
export function peptideSmiles(p: Peptide): string { return buildSmiles(p).smiles; }

/** The full structure of a peptide, laid out as a backbone zigzag with side chains alternating up and down. */
export function peptideMolecule(p: Peptide, L = 18.43): Molecule {
  const { smiles, main } = buildSmiles(p);
  const mol = parseSmiles(smiles);
  const ids = [...mol.atoms()].map((a) => a.id);
  layoutPeptide(mol, main.map((i) => ids[i]!), L);
  return mol;
}

/**
 * Lay a structure out as Expand Label draws its sequence, when it is a peptide
 * (one fragment that recognisePeptide reads): backbone zigzag, side chains on
 * alternate sides, and wedges for the configurations the structure records.
 * Returns false, leaving the structure untouched, when it is not a peptide;
 * callers then fall back to layout2D, which folds long chains onto themselves.
 */
export function layoutAsPeptide(mol: Molecule, L = 18.43): boolean {
  if (mol.atomCount < 7) return false;
  let p: Peptide | null;
  try { p = recognisePeptide(mol); } catch { return false; }
  if (!p) return false;
  const built = peptideMolecule(p, L);
  const map = isomorphisms(built, mol).next().value;
  if (!map) return false;
  const want = new Map<AtomId, { order: AtomId[]; anticlockwise: boolean }>();
  for (const a of mol.atoms()) if (a.chirality) want.set(a.id, { order: [...a.chirality.order], anticlockwise: a.chirality.anticlockwise });
  for (const [from, to] of map) { const a = mol.atom(to), b = built.atom(from); a.x = b.x; a.y = b.y; }
  for (const b of mol.bonds()) if (/^(wedge|hash)(Begin|End)$/.test(b.display)) b.display = 'plain';
  assignWedges(mol, want);
  return true;
}

/**
 * Backbone on a horizontal zigzag (as ChemDraw draws expanded sequences);
 * every other group is laid out on its own and swung onto its anchor's open
 * side. Rings that close back onto the backbone (Pro, Hyp, pGlu) are drawn as
 * regular polygons on the open side.
 */
function layoutPeptide(mol: Molecule, main: AtomId[], L: number) {
  const want = new Map<AtomId, { order: AtomId[]; anticlockwise: boolean }>();
  for (const a of mol.atoms()) if (a.chirality) want.set(a.id, { order: [...a.chirality.order], anticlockwise: a.chirality.anticlockwise });
  const pos = new Map<AtomId, Pt>();
  const onMain = new Set(main);

  // Components of the non-backbone atoms, with the backbone atoms they touch.
  const seen = new Set<AtomId>();
  const comps: { atoms: AtomId[]; anchors: AtomId[] }[] = [];
  for (const a of mol.atoms()) {
    if (onMain.has(a.id) || seen.has(a.id)) continue;
    const atoms: AtomId[] = [], anchors = new Set<AtomId>();
    const stack = [a.id];
    seen.add(a.id);
    while (stack.length) {
      const x = stack.pop()!;
      atoms.push(x);
      for (const n of mol.neighbours(x)) {
        if (onMain.has(n)) anchors.add(n);
        else if (!seen.has(n)) { seen.add(n); stack.push(n); }
      }
    }
    comps.push({ atoms, anchors: [...anchors] });
  }

  // Backbone by turtle: a zigzag of alternating 60-degree turns. A ring bridging
  // N and Ca (Pro, Hyp, pGlu) needs 108 degrees inside it, so the chain bends
  // the same way at both atoms (54 degrees each, the exterior bisectors), as
  // proline does in hand-drawn peptides.
  const DEG = Math.PI / 180;
  const ringSide = new Map<number, number>(); // main index of N -> side of the ring
  for (const c of comps) {
    if (c.anchors.length !== 2) continue;
    const [i, j] = c.anchors.map((x) => main.indexOf(x)).sort((x, y) => x - y) as [number, number];
    if (j === i + 1) ringSide.set(i, 0);
  }
  {
    let h = -30 * DEG, last = -60 * DEG;
    let p: Pt = { x: 0, y: 0 };
    pos.set(main[0]!, p);
    for (let i = 0; i + 1 < main.length; i++) {
      if (i > 0) {
        let turn = -Math.sign(last) * 60 * DEG;
        if (ringSide.has(i)) {
          const side = -Math.sign(turn);
          ringSide.set(i, side);
          turn = -side * 54 * DEG;
        } else if (ringSide.has(i - 1)) {
          turn = -ringSide.get(i - 1)! * 54 * DEG;
        }
        h += turn; last = turn;
      } else if (ringSide.has(0)) {
        ringSide.set(0, -1);
      }
      p = { x: p.x + L * Math.cos(h), y: p.y + L * Math.sin(h) };
      pos.set(main[i + 1]!, p);
    }
  }
  const dx = L * Math.cos(Math.PI / 6), dy = L / 2;
  void dx; void dy;
  const angleTo = (a: Pt, b: Pt) => Math.atan2(b.y - a.y, b.x - a.x);
  const openSide = (id: AtomId) => (main.indexOf(id) % 2 ? -1 : 1); // odd atoms sit high: their groups point up (screen -y)
  /** How far a candidate placement keeps from everything already placed (bigger is better). */
  const clearance = (cand: Map<AtomId, Pt>) => {
    let best = Infinity;
    for (const [id, p] of cand) for (const [jd, q] of pos) {
      if (mol.bondBetween(id, jd)) continue;
      best = Math.min(best, Math.hypot(p.x - q.x, p.y - q.y));
    }
    return best;
  };

  // Directions for groups on each backbone atom: spread through its open angle;
  // a lone group at a chain end carries the zigzag on.
  const dirOf = new Map<(typeof comps)[number], { anchor: AtomId; dir: number }>();
  const byAnchor = new Map<AtomId, typeof comps>();
  for (const c of comps) if (c.anchors.length === 1) { const l = byAnchor.get(c.anchors[0]!) ?? []; l.push(c); byAnchor.set(c.anchors[0]!, l); }
  for (const [anchor, list] of byAnchor) {
    const pa = pos.get(anchor)!;
    const nb = mol.neighbours(anchor).filter((n) => onMain.has(n)).map((n) => angleTo(pa, pos.get(n)!));
    let start = 0, gap = 2 * Math.PI;
    if (nb.length) {
      const s2 = [...nb].sort((x, y) => x - y);
      gap = -1;
      for (let i = 0; i < s2.length; i++) {
        const a2 = s2[i]!, b2 = i + 1 < s2.length ? s2[i + 1]! : s2[0]! + 2 * Math.PI;
        if (b2 - a2 > gap + 1e-9) { gap = b2 - a2; start = a2; }
      }
    }
    const i = main.indexOf(anchor);
    const atEnd = nb.length === 1 && list.length === 1 && (i === 0 || i === main.length - 1);
    // Bigger groups take the middle of the open angle.
    const ordered = [...list].sort((x, y) => x.atoms.length - y.atoms.length);
    const slots = ordered.map((_, j) => start + (gap * (j + 1)) / (list.length + 1));
    const mid = start + gap / 2;
    slots.sort((x, y) => Math.abs(y - mid) - Math.abs(x - mid));
    ordered.forEach((c, j) => {
      let dir = slots[j]!;
      if (atEnd) {
        // Carry the zigzag on: of the two 60-degree continuations, the one further from the chain.
        const nbr = pos.get(main[i === 0 ? 1 : i - 1]!)!, nbr2 = main.length > 2 ? pos.get(main[i === 0 ? 2 : i - 2]!)! : null;
        const back = Math.atan2(nbr.y - pa.y, nbr.x - pa.x);
        const opts = [back + Math.PI + 60 * DEG, back + Math.PI - 60 * DEG];
        const far = (d: number) => (nbr2 ? Math.hypot(pa.x + L * Math.cos(d) - nbr2.x, pa.y + L * Math.sin(d) - nbr2.y) : -d);
        dir = far(opts[0]!) >= far(opts[1]!) ? opts[0]! : opts[1]!;
      }
      dirOf.set(c, { anchor, dir });
    });
  }

  // Place rings through the backbone first, then single atoms (C=O oxygens, methyls), then bigger groups.
  const singles = comps.filter((c) => c.anchors.length === 1 && c.atoms.length === 1);
  const ringComps = comps.filter((c) => c.anchors.length >= 2);
  const groups = comps.filter((c) => c.anchors.length === 1 && c.atoms.length > 1).sort((x, y) => x.atoms.length - y.atoms.length);

  for (const c of ringComps) {
    // A ring through two backbone atoms (Pro, Hyp, pGlu): path inside the component between them.
    const [A, B] = c.anchors as [AtomId, AtomId];
    const inComp = new Set(c.atoms);
    const startNbr = mol.neighbours(A).filter((n) => inComp.has(n));
    const prev = new Map<AtomId, AtomId>();
    const queue = [...startNbr];
    for (const s0 of startNbr) prev.set(s0, -1);
    let end: AtomId | undefined;
    while (queue.length) {
      const x = queue.shift()!;
      if (mol.neighbours(x).includes(B)) { end = x; break; }
      for (const n of mol.neighbours(x)) if (inComp.has(n) && !prev.has(n)) { prev.set(n, x); queue.push(n); }
    }
    if (end === undefined) continue;
    const path: AtomId[] = [];
    for (let x: AtomId = end; x !== -1; x = prev.get(x)!) path.unshift(x);
    const pa = pos.get(A)!, pb = pos.get(B)!;
    const size = path.length + 2, Lr = Math.hypot(pb.x - pa.x, pb.y - pa.y);
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const ux = (pb.x - pa.x) / Lr, uy = (pb.y - pa.y) / Lr;
    const inr = Lr / (2 * Math.tan(Math.PI / size)), R = Lr / (2 * Math.sin(Math.PI / size));
    const step = (2 * Math.PI) / size;
    let bestCand: Map<AtomId, Pt> | null = null, bestScore = -Infinity;
    const iA = main.indexOf(A), iB = main.indexOf(B);
    const known = ringSide.get(Math.min(iA, iB));
    // Normal on the ring's side, seen walking from the lower-index backbone atom.
    const fwd = iA < iB ? 1 : -1;
    const sides = known ? [known] : [1, -1];
    for (const side of sides) {
      const nx = -uy * side * fwd, ny = ux * side * fwd;
      const cx = mx + nx * inr, cy = my + ny * inr;
      const a0 = Math.atan2(pa.y - cy, pa.x - cx), aB = Math.atan2(pb.y - cy, pb.x - cx);
      const dir = Math.abs(Math.atan2(Math.sin(a0 + step - aB), Math.cos(a0 + step - aB))) < 1e-3 ? -1 : 1;
      const cand = new Map<AtomId, Pt>();
      path.forEach((id, k) => cand.set(id, { x: cx + R * Math.cos(a0 + dir * step * (k + 1)), y: cy + R * Math.sin(a0 + dir * step * (k + 1)) }));
      // Ring substituents (C=O of pGlu, OH of Hyp) point away from the ring centre.
      const rest = c.atoms.filter((x) => !cand.has(x));
      for (let guard = 0; rest.some((x) => !cand.has(x)) && guard < 50; guard++) {
        for (const x of rest) {
          if (cand.has(x)) continue;
          const from = mol.neighbours(x).find((n) => cand.has(n));
          if (from === undefined) continue;
          const pf = cand.get(from)!;
          const ang = Math.atan2(pf.y - cy, pf.x - cx);
          cand.set(x, { x: pf.x + L * Math.cos(ang), y: pf.y + L * Math.sin(ang) });
        }
      }
      // Prefer the backbone's open side unless the other side is clearly roomier.
      const score = clearance(cand);
      if (score > bestScore) { bestScore = score; bestCand = cand; }
    }
    for (const [id, p] of bestCand!) pos.set(id, p);
  }

  // Single atoms point straight out, tilting up to 40 degrees if a ring (proline) is in the way.
  for (const c of singles) {
    const { anchor, dir } = dirOf.get(c)!;
    const pa = pos.get(anchor)!;
    let best: Pt | null = null, bestScore = -Infinity;
    for (const off of [0, -20, 20, -40, 40]) {
      const a = dir + (off * Math.PI) / 180;
      const p = { x: pa.x + L * Math.cos(a), y: pa.y + L * Math.sin(a) };
      const score = Math.min(clearance(new Map([[c.atoms[0]!, p]])), 0.9 * L) - Math.abs(off) * 0.002 * L;
      if (score > bestScore) { bestScore = score; best = p; }
    }
    pos.set(c.atoms[0]!, best!);
  }

  for (const c of groups) {
    const { anchor, dir } = dirOf.get(c)!;
    const cands = placeComponent(mol, c.atoms, anchor, pos.get(anchor)!, dir, L);
    let best = cands[0]!, bestScore = -Infinity;
    cands.forEach((cand, k) => {
      // A bond's length of room is enough: then the first bond leaves along `dir`, at the
      // ideal angle Clean Up would restore, unmirrored if possible. Swinging the group's
      // centre onto `dir` (bending its first bond) is for when that is crowded.
      const score = Math.min(clearance(cand), L) - [0, 0.02, 0.15, 0.17][k]! * L;
      if (score > bestScore) { bestScore = score; best = cand; }
    });
    for (const [id, p] of best) pos.set(id, p);
  }
  for (const [id, p] of pos) { mol.atom(id).x = p.x; mol.atom(id).y = p.y; }
  assignWedges(mol, want);
}

/**
 * Lay a group out on its own (with its anchor) and swing it onto the anchor
 * leaving at angle `dir`. Returns candidate placements: first bond along
 * `dir`, its mirror image, and the group's centre along `dir` (and mirrored).
 */
function placeComponent(mol: Molecule, atoms: AtomId[], anchor: AtomId, pa: Pt, dir: number, L: number): Map<AtomId, Pt>[] {
  const sub = new Molecule();
  const toSub = new Map<AtomId, AtomId>();
  for (const id of [anchor, ...atoms]) toSub.set(id, sub.addAtom({ ...mol.atom(id), chirality: null }).id);
  for (const b of mol.bonds()) {
    if (toSub.has(b.begin) && toSub.has(b.end)) sub.addBond({ begin: toSub.get(b.begin)!, end: toSub.get(b.end)!, order: b.order });
  }
  layout2D(sub, L);
  const a = sub.atom(toSub.get(anchor)!);
  let cx = 0, cy = 0;
  for (const id of atoms) { const p = sub.atom(toSub.get(id)!); cx += p.x; cy += p.y; }
  cx /= atoms.length; cy /= atoms.length;
  const roots = atoms.filter((id) => mol.neighbours(id).includes(anchor));
  const r = roots.length === 1 ? sub.atom(toSub.get(roots[0]!)!) : { x: cx, y: cy };
  const out: Map<AtomId, Pt>[] = [];
  for (const target of [r, { x: cx, y: cy }]) {
    for (const mirror of [1, -1]) {
      const rot = dir - Math.atan2(mirror * (target.y - a.y), target.x - a.x);
      const cos = Math.cos(rot), sin = Math.sin(rot);
      const m = new Map<AtomId, Pt>();
      for (const id of atoms) {
        const p = sub.atom(toSub.get(id)!);
        const x = p.x - a.x, y = mirror * (p.y - a.y);
        m.set(id, { x: pa.x + x * cos - y * sin, y: pa.y + x * sin + y * cos });
      }
      out.push(m);
    }
  }
  return out;
}

// -------------------------------------------------------------------- naming

/**
 * A name OPSIN reads back, for unprotected peptides with H/Ac at the N-terminus
 * and OH, NH2 or a simple ester at the C-terminus; null otherwise.
 */
export function peptideName(p: Peptide): string | null {
  if (p.residues.some((r) => r.protection || r.nMe)) return null;
  // OPSIN reads "alanyl" as L-alanyl, so a residue drawn without its configuration
  // has no peptide name that means what was drawn (the systematic name does).
  if (p.residues.some((r) => r.stereoUnknown && !RESIDUES[r.code]!.achiral)) return null;
  const nt = N_TERMINI[p.nTerm]!;
  if (p.nTerm !== 'H' && !nt.name) return null;
  const parts: string[] = [];
  const last = p.residues.length - 1;
  for (let i = 0; i <= last; i++) {
    const r = p.residues[i]!, def = RESIDUES[r.code]!;
    let word: string | null | undefined;
    if (i < last) word = def.acyl;
    else if (p.cTerm === 'OH' || C_TERMINI[p.cTerm]!.name) word = def.free;
    else if (p.cTerm === 'NH2') word = def.amide;
    else return null;
    if (!word) return null;
    const cfg = def.achiral ? '' : r.d ? 'D-' : 'L-';
    parts.push(cfg + word);
  }
  let body = parts[0]!;
  for (let i = 1; i < parts.length; i++) body += (/^[DL]-|^[αβ]-/.test(parts[i]!) ? '-' : '') + parts[i]!;
  const ct = C_TERMINI[p.cTerm]!;
  if (ct.name) {
    // Esters: "methyl L-alanyl-L-phenylalaninate"; acids named "...ic acid" become "...ate".
    const ester = body.replace(/ic acid$/, 'ate').replace(/ine$/, 'inate').replace(/an$/, 'anate');
    if (ester === body) return null;
    body = `${ct.name} ${ester}`;
  }
  return (nt.name ?? '') + body;
}

/** Element counts of a peptide, including hydrogens (no layout needed). */
export function peptideCounts(p: Peptide): Map<string, number> {
  const mol = parseSmiles(buildSmiles(p).smiles);
  const counts = new Map<string, number>();
  const add = (s: string, n: number) => { if (n > 0) counts.set(s, (counts.get(s) ?? 0) + n); };
  for (const a of mol.atoms()) { add(a.element, 1); add('H', mol.implicitHydrogens(a.id)); }
  return counts;
}

// ---------------------------------------------------------------- recognition

/**
 * Recognise a drawn structure (one fragment) as a peptide of the residues
 * above: find the N-Cα-C(=O) repeat, identify each residue, the termini and
 * D/L from the drawn wedges, then confirm by rebuilding the peptide and
 * checking it is the same structure. Returns null if anything does not fit.
 */
export function recognisePeptide(frag: Molecule): Peptide | null {
  const mol = frag;
  const el = (id: AtomId) => mol.atom(id).element;
  if ([...mol.atoms()].some((a) => a.label !== null) || mol.fragments().length !== 1) return null;
  const dblO = (c: AtomId) => mol.incidentBonds(c).map((b) => mol.bond(b)).find((b) => b.order === 2 && el(mol.otherAtom(b, c)) === 'O');
  // Units N - Ca - C(=O) where Ca is sp3 carbon.
  const units: { n: AtomId; ca: AtomId; c: AtomId }[] = [];
  for (const c of mol.atoms()) {
    if (c.element !== 'C' || !dblO(c.id)) continue;
    for (const ca of mol.neighbours(c.id)) {
      if (el(ca) !== 'C' || mol.incidentBonds(ca).some((b) => mol.bond(b).order !== 1)) continue;
      for (const n of mol.neighbours(ca)) {
        if (el(n) === 'N' && n !== c.id && mol.incidentBonds(n).every((b) => mol.bond(b).order === 1)) units.push({ n, ca, c: c.id });
      }
    }
  }
  if (!units.length) return null;
  // Chain units: C(=O) of one bonded to N of the next.
  const nextOf = (u: typeof units[number]) => units.filter((v) => v !== u && mol.bondBetween(u.c, v.n) && v.ca !== u.ca);
  let best: typeof units = [];
  for (const start of units) {
    if (units.some((u) => mol.bondBetween(u.c, start.n))) continue;
    const chain = [start];
    const used = new Set([start.ca]);
    for (;;) {
      const nx = nextOf(chain[chain.length - 1]!).filter((v) => !used.has(v.ca));
      if (nx.length !== 1) break;
      chain.push(nx[0]!); used.add(nx[0]!.ca);
    }
    if (chain.length > best.length) best = chain;
  }
  if (best.length < 1) return null;
  const candidates = guessSequences(mol, best);
  for (const p of candidates) {
    const built = parseSmiles(buildSmiles(p).smiles);
    if (!sameStructure(built, mol)) continue;
    // D/L from the drawing (wedges) or from recorded configurations (SMILES):
    // compare CIP labels at each Ca with the all-L build.
    const drawn = mol.clone();
    if ([...mol.bonds()].some((b) => b.display !== 'plain')) perceiveStereoFromGeometry(drawn);
    const drawnIds = [...mol.atoms()].map((a) => a.id), cloneIds = [...drawn.atoms()].map((a) => a.id);
    const toClone = new Map(drawnIds.map((id, i) => [id, cloneIds[i]!]));
    const builtIds = [...built.atoms()].map((a) => a.id);
    const caBuilt = mainCaIndices(p).map((i) => builtIds[i]!);
    const caSet = new Set(caBuilt.map((id) => builtIds.indexOf(id)));
    // Each atom's residue: the nearest alpha carbon (side-chain stereocentres sit in their own residue).
    const residueOf = new Map<AtomId, number>(caBuilt.map((id, i) => [id, i]));
    for (const queue = [...caBuilt]; queue.length;) {
      const x = queue.shift()!;
      for (const n of built.neighbours(x)) if (!residueOf.has(n)) { residueOf.set(n, residueOf.get(x)!); queue.push(n); }
    }
    const drawnLabel = new Map<AtomId, 'R' | 'S' | null>();
    const got = (id: AtomId) => {
      const c = toClone.get(id)!;
      if (!drawnLabel.has(c)) drawnLabel.set(c, rsLabel(drawn, c));
      return drawnLabel.get(c)!;
    };
    // The symmetries of a peptide (phenyl flips, tBu methyls, Trt rings) never move a
    // stereocentre, so a few mappings settle it; trying them all takes exponentially
    // long on a near miss (allo-Thr among Trt groups froze the page).
    let tries = 0;
    for (const map of isomorphisms(built, mol)) {
      if (++tries > 8) break;
      for (const [i, r] of p.residues.entries()) {
        if (RESIDUES[r.code]!.achiral) continue;
        const want = rsLabel(built, caBuilt[i]!), g = got(map.get(caBuilt[i]!)!);
        r.stereoUnknown = g === null;
        r.d = g !== null && g !== want;
      }
      // Every other stereocentre must be the standard one for that residue (allo-Thr is not Thr);
      // one drawn without a wedge leaves its residue's configuration unknown, as at Ca.
      const final = parseSmiles(buildSmiles(p).smiles);
      const finalIds = [...final.atoms()].map((a) => a.id);
      const ok = builtIds.every((id, k) => {
        if (caSet.has(k)) return true;
        const want = rsLabel(final, finalIds[k]!);
        if (want === null) return true;
        const g = got(map.get(id)!);
        if (g === null) { p.residues[residueOf.get(id)!]!.stereoUnknown = true; return true; }
        return g === want;
      });
      if (ok) return p;
    }
  }
  return null;
}

/** Indices (in build order) of each residue's alpha carbon. */
function mainCaIndices(p: Peptide): number[] {
  const { main } = buildSmiles(p);
  const nt = N_TERMINI[p.nTerm]!;
  let k = p.residues[0]!.code === 'pGlu' ? 0 : nt.main.length;
  const out: number[] = [];
  for (const r of p.residues) {
    const def = RESIDUES[r.code]!;
    const len = def.special ? def.special.main.length : 3;
    out.push(main[k + (def.special ? def.special.main.length - 2 : 1)]!);
    k += len;
  }
  return out;
}

/** Candidate sequences for a backbone: each residue matched by its side chain, termini by what hangs off the ends. */
function guessSequences(mol: Molecule, chain: { n: AtomId; ca: AtomId; c: AtomId }[]): Peptide[] {
  const backbone = new Set(chain.flatMap((u) => [u.n, u.ca, u.c]));
  const residues: PeptideResidue[] = [];
  for (let i = 0; i < chain.length; i++) {
    const u = chain[i]!;
    // Residue fragment: N, Ca, C', its =O and the side chain (anything reachable from Ca off the backbone).
    const keep = new Set([u.n, u.ca, u.c]);
    const o = mol.neighbours(u.c).find((x) => mol.bondBetween(u.c, x)!.order === 2 && mol.atom(x).element === 'O');
    if (o !== undefined) keep.add(o);
    // An N-methyl belongs to its residue (MeLeu, Sar).
    for (const x of mol.neighbours(u.n)) if (!backbone.has(x) && mol.atom(x).element === 'C' && mol.neighbours(x).length === 1) keep.add(x);
    const stack = mol.neighbours(u.ca).filter((x) => !backbone.has(x));
    while (stack.length) {
      const x = stack.pop()!;
      if (keep.has(x)) continue;
      keep.add(x);
      for (const n of mol.neighbours(x)) if (!backbone.has(n) && !keep.has(n)) stack.push(n);
    }
    const sub = subMolecule(mol, keep);
    const hit = matchResidue(sub);
    if (!hit) return [];
    residues.push(hit);
  }
  // Termini: what hangs off the first N (besides Ca and anything in residue 1) and the last C'.
  const firstN = chain[0]!.n, lastC = chain[chain.length - 1]!.c;
  const first = residues[0]!;
  const nCands = first.code === 'pGlu' ? ['H'] : Object.keys(N_TERMINI);
  const out: Peptide[] = [];
  for (const nt of nCands) for (const ct of Object.keys(C_TERMINI)) {
    const p: Peptide = { nTerm: nt, residues: residues.map((r) => ({ ...r })), cTerm: ct };
    if (countAtoms(buildSmiles(p).smiles) === mol.atomCount) out.push(p);
  }
  void firstN; void lastC;
  return out;
}

function subMolecule(mol: Molecule, keep: Set<AtomId>): Molecule {
  const sub = new Molecule();
  const map = new Map<AtomId, AtomId>();
  for (const id of keep) {
    const a = mol.atom(id);
    // Cut bonds become hydrogens, so pin the count the atom had plus what it lost.
    map.set(id, sub.addAtom({ element: a.element, x: a.x, y: a.y, charge: a.charge }).id);
  }
  for (const b of mol.bonds()) if (keep.has(b.begin) && keep.has(b.end)) sub.addBond({ begin: map.get(b.begin)!, end: map.get(b.end)!, order: b.order });
  return sub;
}

/** Residue templates as free fragments N-Ca-C(=O) with cut bonds as hydrogens: "NC(side)C=O". */
let templates: { r: PeptideResidue; mol: Molecule }[] | null = null;
function matchResidue(sub: Molecule): PeptideResidue | null {
  if (!templates) {
    templates = [];
    for (const [code, def] of Object.entries(RESIDUES)) {
      const prots: (string | null)[] = [null, ...(def.prot ? Object.keys(PROTECTIONS) : [])];
      for (const prot of prots) for (const nMe of def.special ? [false] : [false, true]) {
        let smi: string;
        let ring = 10;
        const fresh = (s: string) => { const m = new Map<string, string>(); return s.replace(/\{(\w+)\}/g, (_, k: string) => { if (!m.has(k)) m.set(k, `%${ring++}`); return m.get(k)!; }); };
        if (def.special) smi = fresh(def.special.smiles);
        else {
          const side = prot ? def.prot!.replace('*', PROTECTIONS[prot]!) : def.side!;
          smi = `${nMe ? 'N(C)' : 'N'}C${side ? `(${fresh(side)})` : ''}C(=O)`;
        }
        try { templates.push({ r: { code, d: false, nMe, protection: prot }, mol: parseSmiles(smi) }); } catch { /* skip */ }
      }
    }
  }
  for (const t of templates) if (sameStructure(t.mol, sub)) return { ...t.r };
  return null;
}
