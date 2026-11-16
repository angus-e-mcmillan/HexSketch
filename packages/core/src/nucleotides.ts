/**
 * Oligonucleotides written as a sequence, e.g. "5'-ACGT-3'", "d(GATC)",
 * "r(ACGU)" or "5'-mA*mC*dG*dT-3'": parsing, building the full structure
 * (β-D-ribofuranose or 2'-deoxyribofuranose, 3'→5' phosphate diesters), a
 * strand layout as textbooks draw it (5' end at the top, sugars one under
 * the other, bases to the right), and recognising a drawn structure as an
 * oligonucleotide so it keeps that layout.
 *
 * Notation, as on a synthesis order: uppercase A C G T U are the bases; a
 * lowercase letter before a base is its sugar (d 2'-deoxy, r ribo, m 2'-O-methyl,
 * f 2'-fluoro); "*" after a base makes the link to the next a phosphorothioate;
 * "p" at either end is a terminal phosphate. Plain letters are DNA, or RNA when
 * the sequence has U and no T. The text must carry its ends (5'-…-3') or be
 * wrapped as d(…) or r(…), so ordinary words are never read as sequences. The
 * classic d(pApTpG) and an all-lowercase sequence are read too.
 */
import { assignWedges, layout2D } from './layout.ts';
import { Molecule, type AtomId } from './model.ts';
import { isomorphisms } from './isomorphism.ts';
import { perceiveRings } from './rings.ts';
import { parseSmiles } from './smiles.ts';

type Base = 'A' | 'C' | 'G' | 'T' | 'U';
type Sugar = 'd' | 'r' | 'm' | 'f';
export interface Nucleotide { base: Base; sugar: Sugar; /** The link to the next unit is a phosphorothioate. */ thio: boolean }
export interface Oligo { units: Nucleotide[]; p5: boolean; p3: boolean }

/** Bases from the glycosidic N: SMILES (rings 2 and 3; the sugar is ring 1), atom count, and the atom drawn on the ring-oxygen side (C8 or C6, as in the anti conformation). */
const BASES: Record<Base, { smiles: string; atoms: number; upper: number; formula: string }> = {
  A: { smiles: 'N2C=NC3=C2N=CN=C3N', atoms: 10, upper: 1, formula: 'C5N5' },
  G: { smiles: 'N2C=NC3=C2N=C(N)NC3=O', atoms: 11, upper: 1, formula: 'C5N5O1' },
  C: { smiles: 'N2C=CC(N)=NC2=O', atoms: 8, upper: 1, formula: 'C4N3O1' },
  T: { smiles: 'N2C=C(C)C(=O)NC2=O', atoms: 9, upper: 1, formula: 'C5N2O2' },
  U: { smiles: 'N2C=CC(=O)NC2=O', atoms: 8, upper: 1, formula: 'C4N2O2' },
};
/** C2' and what it carries. */
const SUGARS: Record<Sugar, { smiles: string; atoms: number }> = {
  d: { smiles: 'C', atoms: 1 },
  r: { smiles: '[C@H](O)', atoms: 2 },
  m: { smiles: '[C@H](OC)', atoms: 3 },
  f: { smiles: '[C@H](F)', atoms: 2 },
};
const MAX_UNITS = 100;
/** Direction of the C1'-N bond: turned up from straight out of the ring, so a purine lies flat and clears the unit above. */
const GLYCOSIDIC = -48;

export function parseOligo(text: string): Oligo | null {
  let t = text.trim().replace(/[′’‘`´]/g, "'").replace(/[–—]/g, '-').replace(/\s+/g, '');
  const five = /^5'-?/.exec(t), three = /-?3'$/.exec(t);
  if (!!five !== !!three) return null;
  if (five) t = t.slice(five[0].length, t.length - three![0].length);
  let p5 = false, p3 = false;
  // A terminal phosphate may stand outside the wrapper or inside it: pd(AT), d(pApT).
  const ends = () => {
    if (/^p-?(?=[drmf]?[ACGTU]|[dr]\()/.test(t)) { p5 = true; t = t.replace(/^p-?/, ''); }
    if (/[ACGTU)*]-?p$/.test(t)) { p3 = true; t = t.replace(/-?p$/, ''); }
  };
  ends();
  let wrapper: Sugar | null = null;
  const w = /^([dr])\((.*)\)$/.exec(t);
  if (w) { wrapper = w[1] as Sugar; t = w[2]!; ends(); }
  if (!five && !w) return null;
  // All lowercase is the same sequence, as it is often typed.
  if (/^[acgtu*-]+$/.test(t)) t = t.toUpperCase();
  const units: Nucleotide[] = [];
  // A "p" between two bases is the phosphate that is there anyway: d(ApTpG).
  const re = /([drmf])?([ACGTU])(\*)?(?:p(?=[drmf]?[ACGTU]))?-?/y;
  let explicit = false;
  const sugars: (Sugar | null)[] = [];
  while (re.lastIndex < t.length) {
    const m = re.exec(t);
    if (!m) return null;
    if (m[1]) explicit = true;
    sugars.push((m[1] as Sugar | undefined) ?? null);
    units.push({ base: m[2] as Base, sugar: 'd', thio: !!m[3] });
  }
  if (!units.length || units.length > MAX_UNITS) return null;
  if (units[units.length - 1]!.thio && !p3) return null;
  const rna = !explicit && units.some((u) => u.base === 'U') && !units.some((u) => u.base === 'T');
  const fallback: Sugar = wrapper ?? (rna ? 'r' : 'd');
  units.forEach((u, i) => { u.sugar = sugars[i] ?? fallback; });
  return { units, p5, p3 };
}

/** Write an oligonucleotide back as a sequence. */
export function oligoText(o: Oligo): string {
  const same = o.units.every((u) => u.sugar === o.units[0]!.sugar) ? o.units[0]!.sugar : null;
  const wrap = same === 'd' || same === 'r';
  const body = o.units.map((u) => `${wrap ? '' : u.sugar}${u.base}${u.thio ? '*' : ''}`).join('');
  return `5'-${o.p5 ? 'p' : ''}${wrap ? `${same}(${body})` : body}${o.p3 ? 'p' : ''}-3'`;
}

interface UnitAtoms { o5: number; c5: number; c4: number; o4: number; c1: number; base: number; c2: number; x2: number | null; me: number | null; c3: number; o3: number; p: number | null }
interface Built { smiles: string; units: UnitAtoms[]; p5: number | null }

function buildSmiles(o: Oligo): Built {
  let smiles = '', count = 0;
  const units: UnitAtoms[] = [];
  let p5: number | null = null;
  if (o.p5) { smiles += 'OP(=O)(O)'; p5 = 1; count = 4; }
  o.units.forEach((u, i) => {
    const b = BASES[u.base], s = SUGARS[u.sugar];
    const at = count;
    const c2 = at + 5 + b.atoms;
    const c3 = c2 + s.atoms;
    const last = i === o.units.length - 1;
    const linked = !last || o.p3;
    smiles += `OC[C@H]1O[C@@H](${b.smiles})${s.smiles}[C@@H]1O`;
    count = c3 + 2;
    units.push({ o5: at, c5: at + 1, c4: at + 2, o4: at + 3, c1: at + 4, base: at + 5, c2, x2: s.atoms > 1 ? c2 + 1 : null, me: s.atoms > 2 ? c2 + 2 : null, c3, o3: c3 + 1, p: linked ? count : null });
    if (linked) { smiles += u.thio ? 'P(=O)(S)' : 'P(=O)(O)'; count += 3; }
    if (last && o.p3) smiles += 'O';
  });
  return { smiles, units, p5 };
}

/** SMILES of an oligonucleotide, as the free acid. */
export function oligoSmiles(o: Oligo): string { return buildSmiles(o).smiles; }

/** Element counts of an oligonucleotide, including hydrogens (no layout needed). */
export function oligoCounts(o: Oligo): Map<string, number> {
  const mol = parseSmiles(buildSmiles(o).smiles);
  const counts = new Map<string, number>();
  const add = (s: string, n: number) => { if (n > 0) counts.set(s, (counts.get(s) ?? 0) + n); };
  for (const a of mol.atoms()) { add(a.element, 1); add('H', mol.implicitHydrogens(a.id)); }
  return counts;
}

/** The full structure, laid out as a strand: 5' end at the top, bases to the right. */
export function oligoMolecule(o: Oligo, L = 18.43): Molecule { return builtOligo(o, L).mol; }

const baseShapes = new Map<Base, { x: number; y: number }[]>();
/** A base's own drawing, bond length 1, with its attachment carbon first. */
function baseShape(base: Base): { x: number; y: number }[] {
  if (!baseShapes.has(base)) {
    const m = parseSmiles(`C${BASES[base].smiles}`);
    layout2D(m, 1);
    baseShapes.set(base, [...m.atoms()].map((a) => ({ x: a.x, y: a.y })));
  }
  return baseShapes.get(base)!;
}

function builtOligo(o: Oligo, L: number): { mol: Molecule; sugar: Set<AtomId> } {
  const built = buildSmiles(o);
  const mol = parseSmiles(built.smiles);
  const ids = [...mol.atoms()].map((a) => a.id);
  const want = new Map<AtomId, { order: AtomId[]; anticlockwise: boolean }>();
  for (const a of mol.atoms()) if (a.chirality) want.set(a.id, { order: [...a.chirality.order], anticlockwise: a.chirality.anticlockwise });
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const step = (p: { x: number; y: number }, deg: number, len = L) => ({ x: p.x + len * Math.cos(rad(deg)), y: p.y + len * Math.sin(rad(deg)) });
  const put = (i: number, p: { x: number; y: number }) => { const a = mol.atom(ids[i]!); a.x = p.x; a.y = p.y; };
  const r = L / (2 * Math.sin(rad(36)));
  const sugar = new Set<AtomId>();
  // The sugar is a regular pentagon, ring oxygen at the top and C1' on the right; every
  // substituent points straight out, and the chain runs O3'-P-O5' down to the next sugar.
  let c4 = { x: 0, y: 0 };
  built.units.forEach((u, i) => {
    const centre = step(c4, 18, r);
    const o4 = step(centre, -90, r), c1 = step(centre, -18, r), c2 = step(centre, 54, r), c3 = step(centre, 126, r);
    const c5 = step(c4, 198), o5 = step(c5, 258), o3 = step(c3, 126);
    put(u.c4, c4); put(u.o4, o4); put(u.c1, c1); put(u.c2, c2); put(u.c3, c3); put(u.c5, c5); put(u.o5, o5); put(u.o3, o3);
    for (const k of [u.c4, u.o4, u.c1, u.c2, u.c3]) sugar.add(ids[k]!);
    if (u.x2 !== null) { const x = step(c2, 54); put(u.x2, x); if (u.me !== null) put(u.me, step(x, 114)); }
    if (i === 0 && built.p5 !== null) {
      const p = step(o5, 198);
      put(built.p5, p); put(built.p5 - 1, step(p, 198)); put(built.p5 + 1, step(p, 288)); put(built.p5 + 2, step(p, 108));
    }
    // The base: its own drawing turned onto the C1'-N bond, C6 (purine C8) on the ring-oxygen side, the rest pointing away.
    const def = BASES[o.units[i]!.base], shape = baseShape(o.units[i]!.base);
    const n = step(c1, GLYCOSIDIC);
    const ax = shape[1]!.x - shape[0]!.x, ay = shape[1]!.y - shape[0]!.y;
    const turn = rad(GLYCOSIDIC) - Math.atan2(ay, ax);
    const ref = shape[def.upper + 1]!;
    const mirror = ax * (ref.y - shape[1]!.y) - ay * (ref.x - shape[1]!.x) > 0;
    for (let k = 0; k < def.atoms; k++) {
      let dx = shape[k + 1]!.x - shape[1]!.x, dy = shape[k + 1]!.y - shape[1]!.y;
      if (mirror) { // reflect across the attachment bond
        const len2 = ax * ax + ay * ay, dot = (dx * ax + dy * ay) / len2;
        dx = 2 * dot * ax - dx; dy = 2 * dot * ay - dy;
      }
      put(u.base + k, { x: n.x + L * (dx * Math.cos(turn) - dy * Math.sin(turn)), y: n.y + L * (dx * Math.sin(turn) + dy * Math.cos(turn)) });
    }
    if (u.p !== null) {
      const p = step(o3, 66);
      put(u.p, p); put(u.p + 1, step(p, 326)); put(u.p + 2, step(p, 46));
      const next = step(p, 126);
      if (i === built.units.length - 1) put(u.p + 3, next);
      else c4 = step(step(next, 78), 18);
    }
  });
  for (const b of mol.bonds()) if (/^(wedge|hash)(Begin|End)$/.test(b.display)) b.display = 'plain';
  assignWedges(mol, want, new Set(ids.filter((id) => !sugar.has(id))));
  return { mol, sugar };
}

/**
 * Recognise a structure (one fragment) as an oligonucleotide: find each
 * furanose with its base, read the sugar and the links between them, then
 * confirm by rebuilding the strand and checking it is the same structure.
 * Returns null if anything does not fit. Configuration is not examined:
 * `oligoStereoMatches` does that.
 */
export function recogniseOligo(mol: Molecule): Oligo | null {
  if (mol.atomCount < 16 || mol.fragments().length !== 1 || [...mol.atoms()].some((a) => a.label !== null)) return null;
  const el = (id: AtomId) => mol.atom(id).element;
  const found: { o5: AtomId; o3: AtomId; unit: Nucleotide }[] = [];
  for (const ring of perceiveRings(mol)) {
    if (ring.atoms.length !== 5) continue;
    const os = ring.atoms.filter((a) => el(a) === 'O');
    if (os.length !== 1 || ring.atoms.filter((a) => el(a) === 'C').length !== 4) continue;
    const inRing = new Set(ring.atoms);
    const out = (a: AtomId) => mol.neighbours(a).filter((x) => !inRing.has(x));
    const ringNb = (a: AtomId, not: AtomId) => mol.neighbours(a).find((x) => inRing.has(x) && x !== not);
    const beside = mol.neighbours(os[0]!);
    const c1 = beside.find((c) => out(c).length === 1 && el(out(c)[0]!) === 'N');
    const c4 = beside.find((c) => c !== c1);
    if (c1 === undefined || c4 === undefined) continue;
    const c2 = ringNb(c1, os[0]!), c3 = ringNb(c4, os[0]!);
    if (c2 === undefined || c3 === undefined) continue;
    const c5 = out(c4), o3 = out(c3), x2 = out(c2);
    if (c5.length !== 1 || el(c5[0]!) !== 'C' || o3.length !== 1 || el(o3[0]!) !== 'O' || x2.length > 1) continue;
    const o5 = mol.neighbours(c5[0]!).filter((x) => x !== c4);
    if (o5.length !== 1 || el(o5[0]!) !== 'O') continue;
    let sugar: Sugar = 'd';
    if (x2.length) {
      const beyond = mol.neighbours(x2[0]!).filter((x) => x !== c2);
      if (el(x2[0]!) === 'F' && !beyond.length) sugar = 'f';
      else if (el(x2[0]!) === 'O' && !beyond.length) sugar = 'r';
      else if (el(x2[0]!) === 'O' && beyond.length === 1 && el(beyond[0]!) === 'C' && mol.neighbours(beyond[0]!).length === 1) sugar = 'm';
      else continue;
    }
    // The base: everything beyond the glycosidic N.
    const seen = new Set<AtomId>([c1]);
    const stack = [out(c1)[0]!];
    const tally: Record<string, number> = {};
    while (stack.length) {
      const a = stack.pop()!;
      if (seen.has(a)) continue;
      seen.add(a);
      if (seen.size > 13) break;
      tally[el(a)] = (tally[el(a)] ?? 0) + 1;
      stack.push(...mol.neighbours(a));
    }
    const formula = ['C', 'N', 'O'].filter((e) => tally[e]).map((e) => `${e}${tally[e]}`).join('');
    const base = (Object.keys(BASES) as Base[]).find((b) => BASES[b].formula === formula && seen.size === BASES[b].atoms + 1);
    if (!base) continue;
    found.push({ o5: o5[0]!, o3: o3[0]!, unit: { base, sugar, thio: false } });
  }
  if (!found.length || found.length > MAX_UNITS) return null;
  // Follow O3'-P-O5' from the unit nothing leads to.
  const phosphorus = (o: AtomId) => mol.neighbours(o).find((x) => el(x) === 'P');
  const next = new Map<number, number>();
  let p3 = false;
  found.forEach((u, i) => {
    const p = phosphorus(u.o3);
    if (p === undefined) return;
    u.unit.thio = mol.neighbours(p).some((x) => el(x) === 'S');
    const j = found.findIndex((v) => v !== u && mol.bondBetween(p, v.o5));
    if (j >= 0) next.set(i, j); else p3 = true;
  });
  const starts = found.map((_, i) => i).filter((i) => ![...next.values()].includes(i));
  if (starts.length !== 1) return null;
  const order: number[] = [];
  for (let i: number | undefined = starts[0]; i !== undefined && !order.includes(i); i = next.get(i)) order.push(i);
  if (order.length !== found.length) return null;
  const oligo: Oligo = { units: order.map((i) => found[i]!.unit), p5: phosphorus(found[order[0]!]!.o5) !== undefined, p3 };
  const built = parseSmiles(oligoSmiles(oligo));
  if (built.atomCount !== mol.atomCount || !isomorphisms(built, mol).next().value) return null;
  return oligo;
}

/**
 * Lay a structure out as a strand when it is an oligonucleotide of two units
 * or more, keeping the configurations it records. Returns false, leaving the
 * structure untouched, when it is not one.
 */
export function layoutAsOligo(mol: Molecule, L = 18.43): boolean {
  let o: Oligo | null;
  try { o = recogniseOligo(mol); } catch { return false; }
  if (!o || o.units.length < 2) return false;
  const { mol: built, sugar } = builtOligo(o, L);
  const map = isomorphisms(built, mol).next().value;
  if (!map) return false;
  const want = new Map<AtomId, { order: AtomId[]; anticlockwise: boolean }>();
  for (const a of mol.atoms()) if (a.chirality) want.set(a.id, { order: [...a.chirality.order], anticlockwise: a.chirality.anticlockwise });
  for (const [from, to] of map) { const a = mol.atom(to), b = built.atom(from); a.x = b.x; a.y = b.y; }
  for (const b of mol.bonds()) if (/^(wedge|hash)(Begin|End)$/.test(b.display)) b.display = 'plain';
  const ring = new Set([...sugar].map((id) => map.get(id)!));
  assignWedges(mol, want, new Set([...mol.atoms()].map((a) => a.id).filter((id) => !ring.has(id))));
  return true;
}
