import {
  altTextFor, computeMass, decodePayload, elementalAnalysis, isotopePattern, layout2D, parseSmiles, pngWithPayload,
  readCdxmlDocument, readCdxmlStyle, readMolfile, readStructureLink, sameStereoisomer, sameStructure, smilesLink,
  structureLink, writeCdxml, writeMolfile, writeSmiles, ACS_1996_STYLE, DEFAULT_STYLE, HEXSKETCH_URL, Molecule,
  PAYLOAD_MARKERS, type DocObject, type DrawingStyle, type ObjectGroup,
} from '@hexsketch/core';
import { depict, toPdf, toSvg } from '@hexsketch/render';
import { Editor, EditorDocument } from '@hexsketch/editor';
import { nameMolecule } from '@hexsketch/naming';

/**
 * HexSketch for AI agents and scripts: read a structure from SMILES, a
 * molfile, CDXML, a HexSketch link or picture payload; render it; name it;
 * analyse it; convert it; check it. No DOM and no network, so it runs in
 * Node, Workers and browsers alike. Every function takes the input as text
 * (or a Structure already read) and works out its format.
 */

export type InputFormat = 'smiles' | 'mol' | 'cdxml' | 'link' | 'payload';
export type StyleName = 'hexsketch' | 'acs';

export interface Structure {
  mol: Molecule;
  objects: DocObject[];
  groups: ObjectGroup[];
  style: DrawingStyle;
  format: InputFormat;
  /** The SMILES as given, for SMILES input. */
  smiles?: string;
}

export interface ReadOptions {
  /** Skip detection. */
  format?: InputFormat;
  /** Drawing style; defaults to the one the input carries (CDXML, links), else HexSketch's. */
  style?: StyleName | DrawingStyle;
}

const STYLES: Record<StyleName, Readonly<DrawingStyle>> = { hexsketch: DEFAULT_STYLE, acs: ACS_1996_STYLE };
const styleOf = (s: StyleName | DrawingStyle | undefined): DrawingStyle | null =>
  s === undefined ? null : typeof s === 'string' ? { ...(STYLES[s] ?? DEFAULT_STYLE) } : s;

/** Which format a piece of text is in. */
export function detectFormat(input: string): InputFormat {
  const t = input.trim();
  if (PAYLOAD_MARKERS.some((m) => t.includes(m))) return 'payload';
  if (/^(https?:\/\/[^#\s]*)?#.*\b(smiles|cdxml)=/i.test(t)) return 'link';
  if (t.startsWith('<')) return 'cdxml';
  if (/\n/.test(t) && /V[23]000|M {2}END/.test(t)) return 'mol';
  return 'smiles';
}

const noCoordinates = (mol: Molecule) => [...mol.atoms()].every((a) => a.x === 0 && a.y === 0);

/** Read a structure. Throws an Error whose message says what is wrong with the input. */
export async function readStructure(input: string | Structure, opts: ReadOptions = {}): Promise<Structure> {
  if (typeof input !== 'string') return input;
  const format = opts.format ?? detectFormat(input);
  const chosen = styleOf(opts.style);
  const style = chosen ?? { ...DEFAULT_STYLE };
  const text = input.trim();
  if (!text) throw new Error('No structure given');
  switch (format) {
    case 'smiles': {
      if (/^InChI=/i.test(text)) throw new Error('InChI is not supported: give SMILES, a molfile or CDXML');
      let mol: Molecule;
      try { mol = parseSmiles(text); } catch (err) {
        const why = (err as Error).message;
        // The mistakes agents make most: a name instead of SMILES, and aromatic rings written wrongly.
        if (/\s/.test(text) || /[ad-kmq-z]/.test(text.replace(/\[[^\]]*\]|Cl|Br/g, ''))) throw new Error(`"${text}" looks like a name, not SMILES: HexSketch reads SMILES, molfiles and CDXML, not names`);
        if (/kekulize/.test(why)) throw new Error(`Not a valid SMILES: ${why}. Check the aromatic rings: pyrrole-type N needs [nH], and a ring written in lowercase must be able to take alternating double bonds`);
        throw new Error(`Not a valid SMILES: ${why}`);
      }
      if (!mol.atomCount) throw new Error('The SMILES has no atoms');
      layout2D(mol, style.bondLength);
      return { mol, objects: [], groups: [], style, format, smiles: text };
    }
    case 'mol': {
      let mol: Molecule;
      // The header is three lines, the first often blank, so trimming would shift it: align on the counts line.
      const lines = input.replace(/\r/g, '').split('\n');
      const counts = lines.findIndex((l) => /V[23]000/.test(l));
      const block = lines.slice(Math.max(0, counts - 3)).join('\n').split('$$$$')[0]!;
      try { mol = readMolfile(block, style.bondLength); } catch (err) { throw new Error(`Not a readable molfile: ${(err as Error).message}`); }
      if (!mol.atomCount) throw new Error('The molfile has no atoms');
      if (noCoordinates(mol)) layout2D(mol, style.bondLength);
      return { mol, objects: [], groups: [], style, format };
    }
    case 'cdxml': {
      let doc;
      try { doc = readCdxmlDocument(text); } catch (err) { throw new Error(`Not readable CDXML: ${(err as Error).message}`); }
      const s = chosen ?? readCdxmlStyle(text);
      if (noCoordinates(doc.mol)) layout2D(doc.mol, s.bondLength);
      return { ...doc, style: s, format };
    }
    case 'payload': {
      const p = await decodePayload(text);
      if (!p) throw new Error('The HexSketch payload is damaged or cut short');
      return { mol: p.mol, objects: p.objects, groups: p.groups, style: chosen ?? p.style, format };
    }
    case 'link': {
      const got = await readStructureLink(text.slice(text.indexOf('#')), style.bondLength);
      if (!got) throw new Error('The link has no structure in it (expected #smiles= or #cdxml=)');
      if (got.kind === 'smiles') return { mol: got.mol, objects: [], groups: [], style, format, smiles: got.smiles };
      return { mol: got.mol, objects: got.objects, groups: got.groups, style: chosen ?? got.style, format };
    }
  }
}

/** The structure with abbreviations (Ph, OMe, Boc...) drawn out, for SMILES, names and comparisons. */
function expanded(s: Structure): Molecule {
  if (![...s.mol.atoms()].some((a) => a.label !== null)) return s.mol;
  const editor = new Editor(new EditorDocument(s.mol.clone(), s.style));
  editor.expandLabels();
  return editor.doc.mol;
}

/** One molecule per connected structure. */
function parts(mol: Molecule): Molecule[] {
  return mol.fragments().map((ids) => {
    if (ids.length === mol.atomCount) return mol;
    const keep = new Set(ids);
    const part = mol.clone();
    for (const a of mol.atoms()) if (!keep.has(a.id)) part.removeAtom(a.id);
    return part;
  });
}

const safeName = (mol: Molecule): { name: string | null; reason?: string } => {
  try { return nameMolecule(mol); } catch (err) { return { name: null, reason: (err as Error).message }; }
};

// -------------------------------------------------------------------- render

export type RenderFormat = 'svg' | 'pdf' | 'png' | 'cdxml' | 'mol';
/** Turns an SVG into PNG bytes, `scale` pixels per point (the CLI supplies one; browsers can use a canvas). */
export type Rasterizer = (svg: string, scale: number) => Uint8Array | Promise<Uint8Array>;

export interface RenderOptions extends ReadOptions {
  to?: RenderFormat;
  /** Margin around the drawing, points. */
  padding?: number;
  /** Background colour; transparent when omitted (PNG defaults to white). */
  background?: string;
  /** Required for PNG. */
  rasterize?: Rasterizer;
  /** PNG pixels per point (default 4). */
  scale?: number;
}

export interface Rendered {
  format: RenderFormat;
  mediaType: string;
  /** Text for svg, cdxml and mol; bytes for pdf and png. */
  data: string | Uint8Array;
  /** Drawing size in points (1/72 inch), margin included; 0 for cdxml and mol. */
  width: number;
  height: number;
}

const MEDIA: Record<RenderFormat, string> = {
  svg: 'image/svg+xml', pdf: 'application/pdf', png: 'image/png', cdxml: 'chemical/x-cdxml', mol: 'chemical/x-mdl-molfile',
};

/**
 * Draw a structure. PNG output carries the structure inside it, so the picture
 * opens for editing in HexSketch (File > Open, or paste).
 */
export async function render(input: string | Structure, opts: RenderOptions = {}): Promise<Rendered> {
  const s = await readStructure(input, opts);
  const to = opts.to ?? 'svg';
  const out = (data: string | Uint8Array, width = 0, height = 0): Rendered => ({ format: to, mediaType: MEDIA[to], data, width, height });
  if (to === 'cdxml') return out(writeCdxml(s.mol, s.style, s.objects, { groups: s.groups }));
  if (to === 'mol') return out(writeMolfile(s.mol, s.style.bondLength, 'HexSketch structure'));
  if (!s.mol.atomCount && !s.objects.length) throw new Error('Nothing to draw');
  const dep = depict(s.mol, s.style, s.objects);
  const padding = opts.padding ?? 6;
  const background = opts.background ?? (to === 'png' ? '#ffffff' : undefined);
  const svg = toSvg(dep, { padding, ...(background ? { background } : {}) });
  const size = /viewBox="[^"]*?([\d.]+) ([\d.]+)"/.exec(svg);
  const width = size ? Number(size[1]) : 0, height = size ? Number(size[2]) : 0;
  if (to === 'svg') return out(svg, width, height);
  if (to === 'pdf') return out(toPdf(dep, { padding }), width, height);
  if (!opts.rasterize) throw new Error('PNG needs a rasterizer (render({ to: "png", rasterize })); SVG and PDF need none');
  const png = await opts.rasterize(svg, opts.scale ?? 4);
  const alt = await altTextFor(s.mol, safeName(expanded(s)).name, s.style, s.objects, s.groups);
  return out(pngWithPayload(png, alt), width, height);
}

// ------------------------------------------------------------ name, analyze

/** The IUPAC name, or null with the reason when the structure is outside what HexSketch names. */
export async function name(input: string | Structure, opts: ReadOptions = {}): Promise<{ name: string | null; reason?: string }> {
  return safeName(expanded(await readStructure(input, opts)));
}

export interface Analysis {
  name: string | null;
  smiles: string;
  formula: string;
  charge: number;
  exactMass: number;
  /** Null when an element has no standard atomic weight. */
  molecularWeight: number | null;
  /** "C, 60.00; H, 4.48; O, 35.52" */
  elementalAnalysis: string;
  /** Isotope peaks of at least 1% of the tallest, tallest first. */
  isotopes: { mz: number; relative: number }[];
}

function analyzeOne(mol: Molecule): Analysis {
  const m = computeMass(mol);
  return {
    name: safeName(mol).name,
    smiles: writeSmiles(mol),
    formula: m.formulaWithCharge,
    charge: m.charge,
    exactMass: m.monoisotopicMass,
    molecularWeight: m.unweighable.length ? null : m.molecularWeight,
    elementalAnalysis: m.unweighable.length ? '' : elementalAnalysis(m),
    isotopes: isotopePattern(m.counts, m.charge),
  };
}

/** Name, SMILES, formula and masses: for the whole drawing, and per structure when there are several. */
export async function analyze(input: string | Structure, opts: ReadOptions = {}): Promise<Analysis & { structures: Analysis[] }> {
  const mol = expanded(await readStructure(input, opts));
  if (!mol.atomCount) throw new Error('No atoms to analyse');
  const each = parts(mol);
  return { ...analyzeOne(mol), structures: each.length > 1 ? each.map(analyzeOne) : [] };
}

// ------------------------------------------------------------- convert, link

export type ConvertFormat = 'smiles' | 'mol' | 'cdxml' | 'link';

/** The structure as SMILES (with stereochemistry), a molfile, CDXML, or a link that opens it in HexSketch. */
export async function convert(input: string | Structure, to: ConvertFormat, opts: ReadOptions & { base?: string } = {}): Promise<string> {
  const s = await readStructure(input, opts);
  switch (to) {
    case 'smiles': return writeSmiles(expanded(s));
    case 'mol': return writeMolfile(s.mol, s.style.bondLength, 'HexSketch structure');
    case 'cdxml': return writeCdxml(s.mol, s.style, s.objects, { groups: s.groups });
    case 'link': return link(s, opts);
  }
}

/**
 * A link that opens the structure in HexSketch, ready to edit. SMILES input
 * gives a short, readable #smiles= link; anything else keeps its drawing.
 */
export async function link(input: string | Structure, opts: ReadOptions & { base?: string } = {}): Promise<string> {
  const s = await readStructure(input, opts);
  const base = opts.base ?? HEXSKETCH_URL;
  if (s.smiles !== undefined && !opts.style) return smilesLink(s.smiles, base);
  return structureLink(s.mol, s.style, s.objects, s.groups, base);
}

// ---------------------------------------------------------- validate, compare

export interface Issue {
  severity: 'error' | 'warning' | 'note';
  message: string;
  /** 1-based atom number in input order, where the issue is at one atom. */
  atom?: number;
}

export interface Validation {
  /** False when the input can't be read or has a chemically impossible atom. */
  ok: boolean;
  issues: Issue[];
  /** Present when the input could be read. */
  smiles?: string;
  name?: string | null;
  formula?: string;
}

/** Elements LLM-written SMILES most often overload: a valence error here is almost always a mistake. */
const STRICT_VALENCE = new Set(['C', 'N', 'O']);

/**
 * Check a structure (typically a SMILES an agent wrote) and say what looks
 * wrong: unreadable input, atoms over their valence, unusual charges,
 * radicals, abbreviations that can't be drawn out. Never throws for bad
 * input; it reports it. Compare `smiles` and `name` with what was meant.
 */
export async function validate(input: string | Structure, opts: ReadOptions = {}): Promise<Validation> {
  let s: Structure;
  try { s = await readStructure(input, opts); } catch (err) { return { ok: false, issues: [{ severity: 'error', message: (err as Error).message }] }; }
  const issues: Issue[] = [];
  const mol = expanded(s);
  const number = new Map([...s.mol.atoms()].map((a, i) => [a.id, i + 1]));
  const where = (id: number) => (number.has(id) ? { atom: number.get(id)! } : {});
  for (const a of mol.atoms()) {
    const tag = `${a.label ?? a.element}${number.has(a.id) ? ` (atom ${number.get(a.id)})` : ''}`;
    const excess = mol.excessValence(a.id);
    if (excess > 0) {
      const used = mol.bondOrderSum(a.id) + a.radical + (a.explicitHydrogens ?? 0);
      issues.push({ severity: STRICT_VALENCE.has(a.element) ? 'error' : 'warning', message: `${tag} has valence ${used}, ${excess} more than ${a.charge ? `a ${a.charge > 0 ? '+' : ''}${a.charge} ` : ''}${a.element} allows`, ...where(a.id) });
    }
    const missing = mol.missingValence(a.id);
    if (missing > 0 && !a.radical) issues.push({ severity: 'warning', message: `${tag} has ${missing} fewer bond${missing > 1 ? 's' : ''} or hydrogen${missing > 1 ? 's' : ''} than ${a.element} needs: a radical, or missing hydrogens?`, ...where(a.id) });
    if (a.label !== null) issues.push({ severity: 'warning', message: `${tag}: "${a.label}" is not an abbreviation HexSketch can draw out, so SMILES and name treat it as a single ${a.element}`, ...where(a.id) });
    if (a.radical) issues.push({ severity: 'note', message: `${tag} is a radical`, ...where(a.id) });
    if (Math.abs(a.charge) >= 2 && STRICT_VALENCE.has(a.element)) issues.push({ severity: 'warning', message: `${tag} has charge ${a.charge > 0 ? '+' : ''}${a.charge}`, ...where(a.id) });
    else if (a.charge !== 0 && a.element === 'C') issues.push({ severity: 'note', message: `${tag} is a ${a.charge > 0 ? 'carbocation' : 'carbanion'}`, ...where(a.id) });
  }
  const pieces = mol.fragments().length;
  if (pieces > 1) issues.push({ severity: 'note', message: `${pieces} separate structures (salt, mixture or reaction)` });
  const named = safeName(mol);
  if (!named.name) issues.push({ severity: 'note', message: `No IUPAC name generated${named.reason ? `: ${named.reason}` : ''}` });
  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    smiles: writeSmiles(mol),
    name: named.name,
    formula: computeMass(mol).formulaWithCharge,
  };
}

export interface Comparison {
  /** Same compound and same stereochemistry. */
  same: boolean;
  /** Same compound when stereochemistry is ignored. */
  sameConnectivity: boolean;
  smiles: [string, string];
}

/** Are two inputs the same compound (and the same stereoisomer)? Formats may differ. */
export async function compare(a: string | Structure, b: string | Structure, opts: ReadOptions = {}): Promise<Comparison> {
  const ma = expanded(await readStructure(a, opts)), mb = expanded(await readStructure(b, opts));
  const sameConnectivity = sameStructure(ma, mb);
  return { same: sameConnectivity && sameStereoisomer(ma, mb), sameConnectivity, smiles: [writeSmiles(ma), writeSmiles(mb)] };
}
