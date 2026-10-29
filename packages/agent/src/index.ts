import {
  altTextFor, assignWedges, layoutPeptides, recognisePeptide, computeMass, decodePayload, elementalAnalysis, isotopePattern, layout2D, makeArrow, makeCaption, parseSmiles, pngWithPayload,
  readCdxmlDocument, readCdxmlStyle, readMolfile, readStructureLink, sameStereoisomer, sameStructure, smilesLink,
  structureLink, substructureMappings, writeCdxml, writeMolfile, writeSmiles, type AtomId, ACS_1996_STYLE, DEFAULT_STYLE, HEXSKETCH_URL, Molecule,
  PAYLOAD_MARKERS, type DocObject, type DrawingStyle, type ObjectGroup,
} from '@hexsketch/core';
import { depict, toPdf, toSvg } from '@hexsketch/render';
import { Editor, EditorDocument } from '@hexsketch/editor';
import { nameMolecule } from '@hexsketch/naming';
import '@hexsketch/naming/rings';

import { abbreviateGroups } from './abbreviate.ts';
export { abbreviateGroups, PROTECTING_GROUPS } from './abbreviate.ts';
export { highlighted, highlightPlaces, labelPlaces, placeLabels, type AtomLabel, type Highlight, type PlacedLabels } from './labels.ts';
export { alignByMaps, arrangeForArrows, electronArrows, type ElectronArrow } from './arrows.ts';
export { describeImbalance, disconnectionMarks, imbalance, type Imbalance } from './retro.ts';
import { describeImbalance, imbalance } from './retro.ts';

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
  /** Draw a SMILES's protecting groups as their abbreviations (Boc, Fmoc, TBS...), as a chemist would: for drawings, not for files. */
  abbreviate?: boolean;
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
      layoutPeptides(mol, style.bondLength);
      if (opts.abbreviate) abbreviateGroups(mol);
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

// --------------------------------------------------------------- orientation

/** The atoms `ids` of `mol` as a molecule of their own (ids kept). */
function subMolecule(mol: Molecule, ids: readonly AtomId[]): Molecule {
  const keep = new Set(ids);
  const part = mol.clone();
  for (const a of mol.atoms()) if (!keep.has(a.id)) part.removeAtom(a.id);
  return part;
}

/**
 * Atom mappings a → b of the largest part of `a` found in `b`, trimming `a`
 * a chain end at a time until it fits; none under 4 atoms in common.
 */
function commonCore(a: Molecule, b: Molecule): Map<AtomId, AtomId>[] {
  if (a.atomCount > 80 || b.atomCount > 80) return [];
  let pattern = a;
  while (pattern.atomCount >= 4) {
    const maps = substructureMappings(pattern, b, 24, true);
    if (maps.length) return maps.map((m) => m.map);
    const leaves = [...pattern.atoms()].filter((x) => pattern.neighbours(x.id).length <= 1).map((x) => x.id);
    if (!leaves.length) return [];
    const without = (id: AtomId) => { const t = pattern.clone(); t.removeAtom(id); return t; };
    // The chain end whose loss makes it fit, else the first.
    pattern = leaves.map(without).find((t) => substructureMappings(t, b, 1).length) ?? without(leaves[0]!);
  }
  return [];
}

type Pt2 = { x: number; y: number };
const WEDGE_FLIP: Record<string, string> = { wedgeBegin: 'hashBegin', hashBegin: 'wedgeBegin', wedgeEnd: 'hashEnd', hashEnd: 'wedgeEnd' };

/**
 * Turn, and flip if that fits better, the structure `ids` of `mol` so that
 * the atoms paired with `ref` lie as they do there. Flipping swaps wedges and
 * hashes, so the stereochemistry stays the same.
 */
function alignOnto(mol: Molecule, ids: readonly AtomId[], ref: Molecule, maps: Map<AtomId, AtomId>[], refSize: number): void {
  if (maps[0] && maps[0].size === ids.length && ids.length === refSize) { copyDrawing(mol, ids, ref, maps[0]); return; }
  let best: { err: number; flip: boolean; cos: number; sin: number; c: Pt2 } | null = null;
  for (const map of maps) {
    const pairs = [...map].map(([m, r]) => [mol.atom(m), ref.atom(r)] as const);
    const n = pairs.length;
    const c = { x: pairs.reduce((t, [p]) => t + p.x, 0) / n, y: pairs.reduce((t, [p]) => t + p.y, 0) / n };
    const d = { x: pairs.reduce((t, [, q]) => t + q.x, 0) / n, y: pairs.reduce((t, [, q]) => t + q.y, 0) / n };
    for (const flip of [false, true]) {
      // Best rotation of the centred points (2D Procrustes), after an optional mirror in y.
      let sxx = 0, sxy = 0;
      for (const [p, q] of pairs) {
        const px = p.x - c.x, py = (flip ? -1 : 1) * (p.y - c.y), qx = q.x - d.x, qy = q.y - d.y;
        sxx += px * qx + py * qy; sxy += px * qy - py * qx;
      }
      const th = Math.atan2(sxy, sxx), cos = Math.cos(th), sin = Math.sin(th);
      let err = 0;
      for (const [p, q] of pairs) {
        const px = p.x - c.x, py = (flip ? -1 : 1) * (p.y - c.y);
        err += (px * cos - py * sin - (q.x - d.x)) ** 2 + (px * sin + py * cos - (q.y - d.y)) ** 2;
      }
      // Ties go to the unflipped drawing.
      if (!best || err < best.err - 1e-6) best = { err, flip, cos, sin, c };
    }
  }
  if (!best) return;
  const { flip, cos, sin, c } = best;
  const keep = new Set(ids);
  for (const id of ids) {
    const a = mol.atom(id);
    const px = a.x - c.x, py = (flip ? -1 : 1) * (a.y - c.y);
    a.x = c.x + px * cos - py * sin;
    a.y = c.y + px * sin + py * cos;
  }
  if (flip) for (const b of mol.bonds()) if (keep.has(b.begin) && WEDGE_FLIP[b.display]) b.display = WEDGE_FLIP[b.display] as typeof b.display;
}

/**
 * The same compound drawn again: take the reference's drawing atom for atom,
 * then wedges for this structure's own stereocentres (it may be another
 * stereoisomer).
 */
function copyDrawing(mol: Molecule, ids: readonly AtomId[], ref: Molecule, map: Map<AtomId, AtomId>): void {
  const keep = new Set(ids);
  for (const id of ids) { const r = ref.atom(map.get(id)!); const a = mol.atom(id); a.x = r.x; a.y = r.y; }
  for (const b of mol.bonds()) if (keep.has(b.begin) && WEDGE_FLIP[b.display]) b.display = 'plain';
  assignWedges(mol, new Map([...mol.atoms()].filter((a) => a.chirality).map((a) => [a.id, { ...a.chirality! }])));
}

const isPeptide = (mol: Molecule) => { try { return mol.atomCount >= 7 && recognisePeptide(mol) !== null; } catch { return false; } };

/**
 * Draw related structures the same way round: each structure in `targets`
 * (in order) is turned to match the structure among `refs`, and the targets
 * before it, with which it has the most in common (at least 4 atoms), so a
 * product keeps its starting material's orientation.
 */
function orientLikeOthers(mol: Molecule, targets: readonly AtomId[][], refs: { mol: Molecule; ids: readonly AtomId[] }[] = []): void {
  const known = [...refs];
  for (const ids of targets) {
    const mine = subMolecule(mol, ids);
    // A peptide keeps its own way round: N-terminus on the left.
    if (isPeptide(mine)) { known.push({ mol, ids }); continue; }
    let best: { ref: Molecule; maps: Map<AtomId, AtomId>[]; size: number; refSize: number } | null = null;
    for (const r of known) {
      const theirs = r.mol.atomCount === r.ids.length ? r.mol : subMolecule(r.mol, r.ids);
      // The smaller one is the pattern; pairs always run from this structure to the reference.
      const maps = mine.atomCount <= theirs.atomCount
        ? commonCore(mine, theirs)
        : commonCore(theirs, mine).map((m) => new Map([...m].map(([t, x]) => [x, t])));
      const size = maps[0]?.size ?? 0;
      if (size && (!best || size > best.size)) best = { ref: theirs, maps, size, refSize: theirs.atomCount };
    }
    if (best) alignOnto(mol, ids, best.ref, best.maps, best.refSize);
    known.push({ mol, ids });
  }
}

/**
 * Turn a structure laid out from SMILES so that what it shares with
 * `reference` (the drawing it replaces, say) lies the same way round.
 */
export function orientLike(s: Structure, reference: Molecule): void {
  if (!reference.atomCount || !s.mol.atomCount) return;
  orientLikeOthers(s.mol, s.mol.fragments(), reference.fragments().map((ids) => ({ mol: reference, ids })));
}

// ----------------------------------------------------------- reaction schemes

/** One arrow of a scheme: what is written above and below it, as chemists do. */
export interface SchemeArrow {
  /** Above the arrow: reagents and catalysts, e.g. "MeOH, H2SO4 (cat.)". Digits after symbols are subscripted. */
  reagents?: string;
  /** Below the arrow: solvent, temperature, time, yield, e.g. "reflux, 4 h\n92%". Lines split at \n. */
  conditions?: string;
  type?: 'forward' | 'equilibrium' | 'retrosynthetic';
}

export interface Scheme {
  /** SMILES of each stage, left to right: starting materials, intermediates, products. "A.B" in one stage is drawn A + B. */
  stages: string[];
  /** The arrows between consecutive stages (one fewer than the stages); missing ones are plain arrows. */
  arrows?: SchemeArrow[];
  /** More schemes in the same drawing, each from a new row below (a retrosynthesis's forward route, below its analysis). */
  then?: Scheme[];
}

/** A scheme and those it is followed by, in order. */
const sequences = (s: Scheme): Scheme[] => [s, ...(s.then ?? []).flatMap(sequences)];

/**
 * A reaction scheme as one drawing: the stages left to right, "+" between the
 * structures of a stage, and an arrow between stages with the reagents above
 * it and the conditions below, long enough for its text. Rows wrap at
 * `maxWidth` points (default 520, about the width of a page); each scheme in
 * `then` starts a row of its own below.
 */
export async function scheme(input: Scheme, opts: ReadOptions & { like?: Molecule; maxWidth?: number } = {}): Promise<Structure> {
  const all = sequences(input);
  // The stages of every scheme in one list; `into[i]` is the arrow into stage i, null where a scheme starts.
  const stages: string[] = [];
  const into: (SchemeArrow | null)[] = [];
  for (const [k, seq] of all.entries()) {
    const where = all.length > 1 ? `Scheme ${k + 1}: ` : '';
    if (seq.stages.length < 2) throw new Error(`${where}A scheme needs at least two stages (starting material and product)`);
    const arrows = seq.arrows ?? [];
    if (arrows.length > seq.stages.length - 1) throw new Error(`${where}${arrows.length} arrows for ${seq.stages.length} stages: give one fewer arrow than stages`);
    seq.stages.forEach((t, i) => { stages.push(t.trim()); into.push(i ? arrows[i - 1] ?? {} : null); });
  }
  // Each stage on its own first, so a mistake is reported against the stage it is in.
  const counts: number[] = [];
  for (const [i, t] of stages.entries()) {
    if (detectFormat(t) !== 'smiles') throw new Error(`Stage ${i + 1}: give each stage as SMILES`);
    try { counts.push((await readStructure(t, { ...opts, format: 'smiles' })).mol.fragments().length); } catch (err) { throw new Error(`Stage ${i + 1}: ${(err as Error).message}`); }
  }
  const s = await readStructure(stages.join('.'), { ...(opts.style ? { style: opts.style } : {}), ...(opts.abbreviate ? { abbreviate: true } : {}), format: 'smiles' });
  const { mol, style } = s;
  const L = style.bondLength, size = style.captionSize, line = size * 1.25;
  const fragments = mol.fragments();
  // Each structure the same way round as the first related one before it (or in `like`, the drawing it replaces).
  const like = opts.like?.atomCount ? opts.like.fragments().map((ids) => ({ mol: opts.like!, ids })) : [];
  orientLikeOthers(mol, fragments, like);
  const objects: DocObject[] = [];
  const lines = (t?: string) => (t?.trim() ? t.trim().split('\n') : []);
  const lineWidth = (l: string) => l.length * size * 0.55;
  const textWidth = (t?: string) => Math.max(0, ...lines(t).map(lineWidth));
  // Arrows of a usual length: text that would stretch one past MAX_ARROW wraps onto more lines instead.
  const MIN_ARROW = 2.5 * L, MAX_ARROW = 6 * L, roomFor = MAX_ARROW - 1.2 * L;
  const wrap = (t?: string) => lines(t).flatMap((l) => {
    if (lineWidth(l) <= roomFor) return [l];
    // At commas first ("THF, −78 °C, 2 h"), then at spaces outside brackets ("(3 equiv)" stays whole); a word longer than the room keeps its own line.
    const out: string[] = [];
    for (const piece of l.split(/(?<=[,;])\s+/).flatMap((p) => (lineWidth(p) <= roomFor ? [p] : p.split(/\s+(?![^()]*\))/)))) {
      const joined = out.length ? `${out.at(-1)} ${piece}` : piece;
      if (out.length && lineWidth(joined) <= roomFor) out[out.length - 1] = joined; else out.push(piece);
    }
    return out;
  }).join('\n');
  const caption = (x: number, y: number, text: string) => { objects.push(makeCaption(x, y, text, [{ text, script: 'formula' }], 'center')); };

  // Each stage on its own, from x = 0 and centred on y = 0: its structures with "+" between them.
  const blocks: { atoms: ReturnType<Molecule['atom']>[]; plus: number[]; w: number; h: number }[] = [];
  let f = 0;
  for (const n of counts) {
    const block = { atoms: [] as ReturnType<Molecule['atom']>[], plus: [] as number[], w: 0, h: 0 };
    let x = 0;
    for (let k = 0; k < n; k++, f++) {
      if (k > 0) { block.plus.push(x + L * 0.9); x += L * 1.8; }
      const atoms = fragments[f]!.map((id) => mol.atom(id));
      const xs = atoms.map((a) => a.x), ys = atoms.map((a) => a.y);
      // Room for atom labels at the edges.
      const pad = L * 0.5, x0 = Math.min(...xs) - pad, x1 = Math.max(...xs) + pad;
      const dx = x - x0, dy = -(Math.min(...ys) + Math.max(...ys)) / 2;
      for (const a of atoms) { a.x += dx; a.y += dy; }
      block.atoms.push(...atoms);
      block.h = Math.max(block.h, Math.max(...ys) - Math.min(...ys) + 2 * pad);
      x += x1 - x0;
    }
    block.w = x;
    blocks.push(block);
  }
  const steps = into.map((a) => {
    if (!a) return null;
    a = { ...a, reagents: wrap(a.reagents), conditions: wrap(a.conditions) };
    const len = Math.max(MIN_ARROW, textWidth(a.reagents) + 1.2 * L, textWidth(a.conditions) + 1.2 * L);
    return { a, len, w: len + L * 1.2, above: lines(a.reagents).length * line + size * 0.7, below: lines(a.conditions).length * line + size * 0.5 };
  });

  // Rows no wider than maxWidth: a row that breaks starts with the arrow into its first stage; each scheme starts a row.
  const maxWidth = opts.maxWidth ?? 520;
  const rows: number[][] = [];
  let width = 0;
  for (let i = 0; i < blocks.length; i++) {
    const need = (steps[i]?.w ?? 0) + blocks[i]!.w;
    if (!steps[i] || (width + need > maxWidth && width > 0)) { rows.push([]); width = 0; }
    rows.at(-1)!.push(i);
    width += need;
  }
  let y = 0;
  for (const [r, row] of rows.entries()) {
    const up = Math.max(...row.map((i) => Math.max(blocks[i]!.h / 2, steps[i]?.above ?? 0)));
    const down = Math.max(...row.map((i) => Math.max(blocks[i]!.h / 2, steps[i]?.below ?? 0)));
    // A new scheme stands a little further off than a row that wraps.
    if (r > 0) y += up + (steps[row[0]!] ? 0 : L);
    let x = 0;
    for (const i of row) {
      if (steps[i]) {
        const { a, len } = steps[i]!;
        const tail = { x: x + L * 0.6, y }, head = { x: x + L * 0.6 + len, y };
        const arrow = makeArrow(tail, head, a.type === 'equilibrium' ? 'equilibrium' : a.type === 'retrosynthetic' ? 'retro' : 'reaction');
        objects.push(arrow);
        // The text is centred on the shaft, not on shaft and head: a little to the left of the arrow's middle.
        const tip = (end: string) => (end === 'none' ? 0 : (arrow.headSize / 100) * style.lineWidth);
        const mid = (tail.x + head.x - tip(arrow.headEnd) + tip(arrow.tailEnd)) / 2;
        const above = a.reagents?.trim(), below = a.conditions?.trim();
        if (above) caption(mid, y - size * 0.7 - (lines(above).length - 1) * line, above);
        if (below) caption(mid, y + size * 1.5, below);
        x = head.x + L * 0.6;
      }
      const b = blocks[i]!;
      for (const atom of b.atoms) { atom.x += x; atom.y += y; }
      for (const px of b.plus) caption(x + px, y + size * 0.35, '+');
      x += b.w;
    }
    y += down + 2 * L;
  }
  return { mol, objects, groups: [], style, format: 'smiles' };
}

/**
 * Atoms that do not balance across each forward arrow of a scheme: a
 * byproduct not drawn, or atoms from a reagent written above the arrow
 * (which is fine). Retrosynthetic arrows are skipped: they never balance.
 */
export async function schemeBalance(input: Scheme): Promise<{ scheme?: number; step: number; unbalanced: string }[]> {
  const all = sequences(input);
  const out: { scheme?: number; step: number; unbalanced: string }[] = [];
  for (const [k, seq] of all.entries()) {
    const stages = await Promise.all(seq.stages.map((t) => readStructure(t.trim(), { format: 'smiles' })));
    for (let i = 1; i < stages.length; i++) {
      if (seq.arrows?.[i - 1]?.type === 'retrosynthetic') continue;
      const x = imbalance(expanded(stages[i - 1]!), expanded(stages[i]!));
      if (x) out.push({ ...(all.length > 1 ? { scheme: k + 1 } : {}), step: i, unbalanced: describeImbalance(x) });
    }
  }
  return out;
}

/** The structure with abbreviations (Ph, OMe, Boc...) drawn out, for SMILES, names and comparisons. */
const expanded = (s: Structure): Molecule => drawnOut(s.mol, s.style);

/** A drawing with its abbreviations (Ph, OMe, Boc...) drawn out; the drawing itself if it has none. */
export function drawnOut(mol: Molecule, style: DrawingStyle = DEFAULT_STYLE): Molecule {
  if (![...mol.atoms()].some((a) => a.label !== null)) return mol;
  const editor = new Editor(new EditorDocument(mol.clone(), style));
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

/**
 * The name, never throwing. A structure read from SMILES is named by the
 * SMILES's own stereochemistry; one that was drawn, by what the drawing shows
 * (so a double bond the SMILES left open is not given an E/Z from its layout).
 */
const safeName = (mol: Molecule, drawn = true): { name: string | null; reason?: string } => {
  try { return nameMolecule(mol, { geometry: drawn }); } catch (err) { return { name: null, reason: (err as Error).message }; }
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
  const alt = await altTextFor(s.mol, safeName(expanded(s), s.smiles === undefined).name, s.style, s.objects, s.groups);
  return out(pngWithPayload(png, alt), width, height);
}

// ------------------------------------------------------------ name, analyze

/** The IUPAC name, or null with the reason when the structure is outside what HexSketch names. */
export async function name(input: string | Structure, opts: ReadOptions = {}): Promise<{ name: string | null; reason?: string }> {
  const s = await readStructure(input, opts);
  return safeName(expanded(s), s.smiles === undefined);
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

function analyzeOne(mol: Molecule, drawn = true): Analysis {
  const m = computeMass(mol);
  return {
    name: safeName(mol, drawn).name,
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
  const s = await readStructure(input, opts);
  const mol = expanded(s);
  if (!mol.atomCount) throw new Error('No atoms to analyse');
  const each = parts(mol), drawn = s.smiles === undefined;
  return { ...analyzeOne(mol, drawn), structures: each.length > 1 ? each.map((m) => analyzeOne(m, drawn)) : [] };
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
  const named = safeName(mol, s.smiles === undefined);
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
