import { elementBySymbol } from './elements.ts';
import { Molecule, type AtomId, type BondDisplay, type BondOrder } from './model.ts';
import { kekulize } from './kekulize.ts';
import { perceiveStereoFromGeometry } from './stereo.ts';
import { assignWedges } from './layout.ts';
import { withLabelsDrawnOut } from './abbreviations.ts';

/**
 * MDL molfile reading (V2000 and V3000) and writing (V2000). Molfiles use
 * angstroms with y up; we scale so the average bond comes out at the
 * drawing's bond length and flip y, and do the reverse when writing (1.5 A
 * per bond, the usual choice).
 */

const ANGSTROM_BOND = 1.5;
const pad = (v: string | number, n: number) => String(v).padStart(n);

/** Symbols a molfile uses for "some atom or group", kept as labels. */
const GENERIC_SYMBOL = /^(R#?|R\d+|A|Q|X|L|LP|\*|M|AH|QH|XH|MH)$/;

/**
 * The structure as a molfile can say it: abbreviations drawn out as atoms, and
 * every stereocentre shown by a wedge (a molfile has no bold or plain hashed
 * bond, which in a perspective drawing carry the configuration).
 */
function forMolfile(input: Molecule, bondLength: number): Molecule {
  const mol = withLabelsDrawnOut(input, bondLength).clone();
  const perspective = [...mol.bonds()].some((b) => b.display === 'bold' || b.display === 'hash');
  if (perspective) {
    perceiveStereoFromGeometry(mol);
    const narrowAt = (id: AtomId) => mol.incidentBonds(id).some((i) => { const b = mol.bond(i); return ((b.display === 'wedgeBegin' || b.display === 'hashBegin') && b.begin === id) || ((b.display === 'wedgeEnd' || b.display === 'hashEnd') && b.end === id); });
    const want = new Map([...mol.atoms()].filter((a) => a.chirality && !narrowAt(a.id)).map((a) => [a.id, { ...a.chirality! }]));
    for (const b of mol.bonds()) if (b.display === 'bold' || b.display === 'hash') b.display = 'plain';
    if (want.size) assignWedges(mol, want, new Set(), { plainOnly: true });
  }
  return mol;
}

export function writeMolfile(input: Molecule, bondLength = 18.43, title = ''): string {
  const mol = forMolfile(input, bondLength);
  const atoms = [...mol.atoms()];
  const index = new Map<AtomId, number>(atoms.map((a, i) => [a.id, i + 1]));
  const k = ANGSTROM_BOND / bondLength;
  const cx = atoms.reduce((s, a) => s + a.x, 0) / Math.max(1, atoms.length);
  const cy = atoms.reduce((s, a) => s + a.y, 0) / Math.max(1, atoms.length);
  const lines = [title.slice(0, 80), '  HexSktch          2D', ''];
  const bonds = [...mol.bonds()];
  if (atoms.length > 999 || bonds.length > 999) throw new Error('too large for a V2000 molfile (999 atoms)');
  lines.push(`${pad(atoms.length, 3)}${pad(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`);
  const CHG: Record<number, number> = { 3: 1, 2: 2, 1: 3, [-1]: 5, [-2]: 6, [-3]: 7 };
  const aliases: [number, string][] = [];
  for (const a of atoms) {
    const x = ((a.x - cx) * k).toFixed(4), y = (-(a.y - cy) * k).toFixed(4);
    // A label that could not be drawn out: a generic atom, with the text as its alias.
    let sym = a.element;
    if (a.label !== null) { sym = /^R\d*$/.test(a.label) ? 'R' : /^(X|A|Q|M|L)$/.test(a.label) ? a.label : '*'; if (sym !== a.label) aliases.push([index.get(a.id)!, a.label]); }
    const chg = CHG[a.charge] ?? 0;
    // The valence field says exactly how many hydrogens an atom has, where that is not the usual
    // count for its bonds ([CH2] with two bonds, a bare metal): bonds plus hydrogens, 15 for none.
    let valence = 0;
    if (a.label === null && a.explicitHydrogens !== null) {
      const free = mol.atom(a.id);
      const pinned = free.explicitHydrogens;
      free.explicitHydrogens = null;
      const usual = mol.implicitHydrogens(a.id);
      free.explicitHydrogens = pinned;
      if (usual !== pinned) { const v = mol.bondOrderSum(a.id) + pinned!; valence = v === 0 ? 15 : Math.min(14, v); }
    }
    // V2000 atom line: x y z (10.4 each), symbol (3, left), mass difference (2), charge (3), stereo, H count, stereo care, valence, then zeros.
    lines.push(`${pad(x, 10)}${pad(y, 10)}${pad('0.0000', 10)} ${sym.padEnd(3)} 0${pad(chg, 3)}  0  0  0${pad(valence, 3)}  0  0  0  0  0  0`);
  }
  const STEREO: Partial<Record<BondDisplay, number>> = { wedgeBegin: 1, hashBegin: 6, wavy: 4 };
  for (const b of bonds) {
    let [i, j] = [index.get(b.begin)!, index.get(b.end)!];
    let display = b.display;
    // Molfile stereo flags point from the first atom: flip the bond for the "End" variants.
    if (display === 'wedgeEnd') { [i, j] = [j, i]; display = 'wedgeBegin'; }
    if (display === 'hashEnd') { [i, j] = [j, i]; display = 'hashBegin'; }
    const order = b.order === 1.5 ? 4 : b.order === 4 ? 1 : b.order;
    // A double bond drawn crossed (or wavy): 3, "either cis or trans".
    const stereo = b.order === 2 ? (display === 'either' || display === 'wavy' ? 3 : 0) : b.order === 1 ? STEREO[display] ?? 0 : 0;
    lines.push(`${pad(i, 3)}${pad(j, 3)}${pad(order, 3)}${pad(stereo, 3)}`);
  }
  for (const [i, text] of aliases) lines.push(`A  ${pad(i, 3)}`, text);
  // Property lines hold at most eight entries each.
  const property = (code: string, list: [number, number][]) => {
    for (let s = 0; s < list.length; s += 8) {
      const chunk = list.slice(s, s + 8);
      lines.push(`M  ${code}${pad(chunk.length, 3)}${chunk.map(([i, v]) => `${pad(i, 4)}${pad(v, 4)}`).join('')}`);
    }
  };
  property('CHG', atoms.filter((a) => a.charge !== 0).map((a) => [index.get(a.id)!, a.charge]));
  // Radicals: 2 a doublet, 3 a triplet.
  property('RAD', atoms.filter((a) => a.radical).map((a) => [index.get(a.id)!, a.radical === 1 ? 2 : 3]));
  property('ISO', atoms.filter((a) => a.isotope !== null).map((a) => [index.get(a.id)!, a.isotope!]));
  lines.push('M  END');
  return lines.join('\n') + '\n';
}

interface RawAtom { x: number; y: number; symbol: string; charge: number; isotope: number | null; radical: number; valence: number; alias?: string }
interface RawBond { a: number; b: number; type: number; stereo: number }

export function readMolfile(text: string, bondLength = 18.43): Molecule {
  const lines = text.replace(/\r/g, '').split('\n');
  const counts = lines[3] ?? '';
  const raw = /V3000/.test(counts) || lines.some((l) => l.startsWith('M  V30 BEGIN CTAB')) ? readV3000(lines) : readV2000(lines, counts);
  const mol = new Molecule();
  const ids: AtomId[] = [];
  for (const a of raw.atoms) {
    let sym = a.symbol, isotope = a.isotope, label: string | null = a.alias ?? null;
    if (sym === 'D' || sym === 'T') { isotope = sym === 'D' ? 2 : 3; sym = 'H'; }
    if (label === null && (GENERIC_SYMBOL.test(sym) || !elementBySymbol(sym))) label = sym === 'R#' || sym === '*' ? 'R' : sym;
    ids.push(mol.addAtom({ element: label === null ? sym : 'C', label, x: 0, y: 0, charge: a.charge, isotope, radical: a.radical === 2 ? 1 : a.radical ? 2 : 0 }).id);
  }
  // Bond stereo: 1 a wedge, 6 a hashed wedge, 4 wavy, each from the first atom; on a double bond 3 is "either".
  for (const r of raw.bonds) {
    const a = ids[r.a - 1], b = ids[r.b - 1];
    if (a === undefined || b === undefined || a === b || mol.bondBetween(a, b)) continue;
    const order = (r.type === 4 ? 1.5 : r.type >= 1 && r.type <= 3 ? r.type : 1) as BondOrder;
    const display: BondDisplay = order === 1 ? (r.stereo === 1 ? 'wedgeBegin' : r.stereo === 6 ? 'hashBegin' : r.stereo === 4 ? 'wavy' : 'plain') : order === 2 && r.stereo === 3 ? 'either' : 'plain';
    mol.addBond({ begin: a, end: b, order, display });
  }
  // Scale to the drawing's bond length, y down.
  const bonds = [...mol.bonds()];
  const at = new Map(ids.map((id, i) => [id, raw.atoms[i]!]));
  const avg = bonds.length
    ? bonds.reduce((s, b) => { const p = at.get(b.begin)!, q = at.get(b.end)!; return s + Math.hypot(p.x - q.x, p.y - q.y); }, 0) / bonds.length
    : ANGSTROM_BOND;
  const k = avg > 1e-6 ? bondLength / avg : bondLength / ANGSTROM_BOND;
  ids.forEach((id, i) => { const a = mol.atom(id); a.x = raw.atoms[i]!.x * k; a.y = -raw.atoms[i]!.y * k; });
  // Aromatic bonds (type 4) become alternating double bonds, as a chemist draws them.
  kekulize(mol);
  // A valence given for an atom fixes its hydrogens: valence less its bonds (15 means none).
  ids.forEach((id, i) => {
    const v = raw.atoms[i]!.valence;
    if (!v || mol.atom(id).label !== null) return;
    const h = Math.max(0, (v === 15 ? 0 : v) - mol.bondOrderSum(id));
    if (mol.implicitHydrogens(id) !== h) mol.atom(id).explicitHydrogens = h;
  });
  return mol;
}

function readV2000(lines: string[], counts: string): { atoms: RawAtom[]; bonds: RawBond[] } {
  if (!/V2000/.test(counts) && counts.trim().length < 6) throw new Error('not a molfile');
  const nAtoms = Number(counts.slice(0, 3)), nBonds = Number(counts.slice(3, 6));
  if (!Number.isInteger(nAtoms) || !Number.isInteger(nBonds) || nAtoms < 0 || nBonds < 0) throw new Error('not a molfile');
  const atoms: RawAtom[] = [], bonds: RawBond[] = [];
  const CHARGE: Record<number, number> = { 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 };
  for (let i = 0; i < nAtoms; i++) {
    const l = lines[4 + i] ?? '';
    const code = Number(l.slice(36, 39)) || 0;
    // Charge code 4 is a doublet radical, in files older than the M  RAD line.
    atoms.push({ x: Number(l.slice(0, 10)) || 0, y: Number(l.slice(10, 20)) || 0, symbol: l.slice(31, 34).trim() || 'C', charge: CHARGE[code] ?? 0, isotope: null, radical: code === 4 ? 2 : 0, valence: Number(l.slice(48, 51)) || 0 });
  }
  for (let i = 0; i < nBonds; i++) {
    const l = lines[4 + nAtoms + i] ?? '';
    bonds.push({ a: Number(l.slice(0, 3)), b: Number(l.slice(3, 6)), type: Number(l.slice(6, 9)) || 1, stereo: Number(l.slice(9, 12)) || 0 });
  }
  // Properties block: charges, radicals and isotopes replace the atom-line values; an alias is an atom's label.
  let cleared = false;
  for (let i = 4 + nAtoms + nBonds; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith('M  END')) break;
    const alias = /^A {2}\s*(\d+)/.exec(l);
    if (alias) { const a = atoms[Number(alias[1]) - 1]; const t = (lines[++i] ?? '').trim(); if (a && t) a.alias = t; continue; }
    const m = /^M {2}(CHG|RAD|ISO)\s*(\d+)(.*)$/.exec(l);
    if (!m) continue;
    // A CHG or RAD line means the atom-line charges no longer count (they are all restated here).
    if (m[1] !== 'ISO' && !cleared) { cleared = true; for (const a of atoms) { a.charge = 0; a.radical = 0; } }
    const nums = m[3]!.trim().split(/\s+/).map(Number);
    for (let j = 0; j + 1 < nums.length; j += 2) {
      const atom = atoms[nums[j]! - 1];
      if (!atom) continue;
      if (m[1] === 'CHG') atom.charge = nums[j + 1]!;
      else if (m[1] === 'RAD') atom.radical = nums[j + 1]!;
      else atom.isotope = nums[j + 1]!;
    }
  }
  return { atoms, bonds };
}

/** V3000: "M  V30" lines in blocks, values as KEY=value after the fixed fields; a trailing "-" continues a line. */
function readV3000(lines: string[]): { atoms: RawAtom[]; bonds: RawBond[] } {
  const body: string[] = [];
  let carry = '';
  for (const l of lines) {
    if (!l.startsWith('M  V30 ')) continue;
    const part = l.slice(7);
    if (part.endsWith('-')) { carry += part.slice(0, -1); continue; }
    body.push(carry + part);
    carry = '';
  }
  const atoms: RawAtom[] = [], bonds: RawBond[] = [];
  const number = new Map<string, number>();
  let block = '';
  const keys = (fields: string[]) => Object.fromEntries(fields.filter((f) => f.includes('=')).map((f) => { const k = f.indexOf('='); return [f.slice(0, k).toUpperCase(), f.slice(k + 1)]; }));
  for (const l of body) {
    const t = l.trim();
    const begin = /^BEGIN (\w+)/.exec(t), end = /^END (\w+)/.exec(t);
    if (begin) { block = begin[1]!; continue; }
    if (end) { block = ''; if (end[1] === 'CTAB') break; continue; }
    const f = t.split(/\s+/);
    if (block === 'ATOM' && f.length >= 5) {
      const k = keys(f.slice(6));
      number.set(f[0]!, atoms.length + 1);
      const cfg = Number(k.RAD ?? 0);
      atoms.push({ x: Number(f[2]) || 0, y: Number(f[3]) || 0, symbol: f[1]!.replace(/^"|"$/g, '') || 'C', charge: Number(k.CHG ?? 0) || 0, isotope: k.MASS ? Math.round(Number(k.MASS)) : null, radical: cfg, valence: k.VAL === '-1' ? 15 : Number(k.VAL ?? 0) || 0 });
    } else if (block === 'BOND' && f.length >= 4) {
      const k = keys(f.slice(4));
      // CFG: 1 up, 2 either, 3 down, as V2000's 1, 4 (3 on a double bond) and 6.
      const cfg = Number(k.CFG ?? 0), type = Number(f[1]) || 1;
      bonds.push({ a: number.get(f[2]!) ?? 0, b: number.get(f[3]!) ?? 0, type, stereo: cfg === 1 ? 1 : cfg === 3 ? 6 : cfg === 2 ? (type === 2 ? 3 : 4) : 0 });
    }
  }
  if (!atoms.length && !body.length) throw new Error('not a molfile');
  return { atoms, bonds };
}
