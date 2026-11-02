import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { alignByMaps, analyze, hazards, hazardLine, HAZARD_DISCLAIMER, arrangeForArrows, convert, describeImbalance, detectFormat, disconnectionMarks, electronArrows, highlightPlaces, imbalance, labelPlaces, orientLike, readStructure, scheme, schemeBalance, validate, type ElectronArrow, type Highlight, type Scheme, type Structure } from '@hexsketch/agent';
import { parsePattern, smilesAtomMaps, type Molecule } from '@hexsketch/core';
import type { SketchUpdate } from './sketch-store.ts';

/**
 * What HexSketch's AI tools are, apart from how they are reached: the
 * instructions and tool inputs the model sees, and the work behind showing
 * something in the editor (show_in_sketcher, open_sketcher's marks, steps).
 * The MCP server (mcp.ts) wires these to MCP; a page with a chat beside the
 * editor can use the same, so the two never drift apart. No MCP here.
 */

/** Highlight colours for show_in_sketcher, in order, named so the model can refer to them. */
export const HIGHLIGHTS = [
  { name: 'yellow', color: '#ffe066', text: '#8a6d00' }, { name: 'blue', color: '#8fd3ff', text: '#1b6aa5' },
  { name: 'orange', color: '#ffb07a', text: '#b4531a' }, { name: 'green', color: '#a6e3a1', text: '#2f7a34' },
  { name: 'purple', color: '#d4b0ff', text: '#6b46b5' },
] as const;
export const COLOUR_NAMES = HIGHLIGHTS.map((h) => h.name) as [string, ...string[]];
/** At most this many labels on a drawing, so it stays readable. */
export const MAX_LABELS = 8;
/**
 * How wide a reaction scheme may run before it wraps onto another row: two
 * A4 pages side by side less their margins, the in-chat editor's sheet.
 */
export const SCHEME_WIDTH = 2 * (595.28 - 72);
/** At most this many steps in one show_in_sketcher call. */
export const MAX_STEPS = 10;

/** What HexSketch draws for any chat, editor or not. */
export const CHEMISTRY = [
  '- Protecting groups are drawn abbreviated, as chemists write them (Boc, Fmoc, Cbz, Alloc, Troc, TBS, TIPS, TES, TBDPS, TMS, Trt, Pbf, PMB, Bn and tBu on O, MOM, THP): write them in full in the SMILES, and names, formulas and checks still see every atom. A highlight or label can\'t point inside an abbreviation; atoms with map numbers are never abbreviated.',
  '- Peptides are drawn as chemists draw them, from the SMILES alone: N-terminus on the left, the backbone a flat zigzag, the side chains on wedges showing their configuration. Write their stereocentres in the SMILES.',
  '- Draw every reaction as a scheme, with the reaction input: starting materials, then an arrow, then products, never just side by side. Always write the reagents and catalysts above the arrow and the solvent, temperature, time (and yield, if known) below it, as a chemist would; one arrow per step for a sequence.',
  '- Draw a retrosynthesis or a synthesis as one scheme on one page, in one call, not as steps, so the chemist sees the whole route at once: a reaction from the target with retrosynthetic arrows back to the starting materials, the disconnections marked on the target (disconnect, by atom-map numbers given only in the target, the first stage), and the forward route with its reagents and conditions in then, below it. HexSketch checks that atoms balance, not whether a route works or its materials can be bought: say so when it matters.',
];

/** Bullets every kind of chat is told. */
const STRUCTURES = '- Give structures as SMILES, molfile or CDXML text, or a HexSketch link. Not names: HexSketch does not turn names into structures.';
const MECHANISM = '- Draw a mechanism one step per show_in_sketcher call, with curly arrows: the species as SMILES with atom-map numbers on the atoms the arrows touch ("[OH-:1].[CH3:2][Br:3]"), and arrows from a lone pair ([1]) or a bond ([2, 3]) to an atom ([3]) or to a bond, existing or being made ([1, 2]). Show intermediates with their charges, name the step in a short note, and keep the same map numbers from step to step.';
const ORIENTATION = '- Give related structures as SMILES and HexSketch draws them the same way round: in a scheme, each structure keeps the orientation of the first related one before it (the same compound is drawn identically), and a structure you show in the editor keeps the orientation of the drawing it replaces. Keep a compound in the same place in the scheme from one call to the next, so the chemist can follow it.';

export const INSTRUCTIONS = [
  'HexSketch draws, names and checks chemical structures.',
  '',
  STRUCTURES,
  '- Check every SMILES you write against the name and formula HexSketch returns for it: open_sketcher, show_in_sketcher and render_structure return them with any problems found, so draw first rather than calling validate_structure first. Use validate_structure for a SMILES you only give in text.',
  '- Open the editor first. As soon as the conversation turns to a structure — drawing, showing, explaining, comparing or changing one — call open_sketcher before any other HexSketch tool, with the structure if you have one and empty if the user is about to draw, and in the same call the highlights, labels, note, arrows or steps you would show next. Do it on the first such message, not after answering in text once: the editor is the point of HexSketch, and it opens full screen beside the conversation. Only a request for a file or a bare number (a mass, a name, a formula) is answered without it.',
  '- To show a structure where the editor cannot be opened, call render_structure. Every result includes a link that opens the structure in HexSketch, where the user can edit it by drawing: always give the user that link.',
  '- Once the editor is open, it is where you and the user look at structures, for the rest of the conversation. Call read_sketcher to see what they have drawn. Show every structure you discuss with show_in_sketcher: highlight the parts you mean (each highlight one atom, one functional group or one monomer such as an amino acid, at one place), pin short labels to the atoms they concern (a pKa, a reactive site, a configuration), and sum them up in its note in a few short bullets by colour — the drawing carries the detail, the note is a small summary beside it, and your answer stays in the chat. Do not instead show structures as images (render_structure), pictures from the web, links or text drawings, and do not open another editor; only render or search when the user asks for an image or a file. Keep the chat reply short and point to the editor ("the yellow ester").',
  ...CHEMISTRY,
  MECHANISM,
  ORIENTATION,
  '- Text that starts "Structure from HexSketch", or a hexsketch.com link, is a structure the user drew: read the SMILES from it, or pass the link to these tools. While the editor is open, the user\'s current drawing is also given to you in the same form.`;',
].join('\n');

/**
 * For chats that cannot show the editor (Codex and Claude Code in a terminal,
 * other agents): pictures and links, and files where the server can write
 * them.
 */
export const textInstructions = (saves: boolean) => [
  'HexSketch draws, names and checks chemical structures.',
  '',
  STRUCTURES,
  '- Show every structure and reaction you discuss with render_structure: it returns the picture with its name, formula and any problems found (check them against what you meant, so draw first rather than calling validate_structure first), and a link that opens it in HexSketch at hexsketch.com, in the browser, where the user can edit it by drawing. Always give the user the link. Where you can show a web page beside the chat (a preview pane or a browser tool), open the link there as well, so the editor is open with the drawing as you talk. Use validate_structure for a SMILES you only give in text.',
  ...(saves ? ['- To save a drawing, give render_structure save_to, a path whose extension sets the format: .png or .svg for a picture, .pdf for a document, .cdxml for ChemDraw, .mol for other chemistry software.'] : []),
  ...CHEMISTRY,
  '- Draw a mechanism one render_structure call per step, with curly arrows: the species as SMILES with atom-map numbers on the atoms the arrows touch ("[OH-:1].[CH3:2][Br:3]"), and arrows from a lone pair ([1]) or a bond ([2, 3]) to an atom ([3]) or to a bond, existing or being made ([1, 2]). Show intermediates with their charges, name the step in a short note, and keep the same map numbers from step to step.',
  '- Give related structures as SMILES and HexSketch draws them the same way round: in a scheme, each structure keeps the orientation of the first related one before it, so the same compound is drawn identically.',
  '- Text that starts "Structure from HexSketch" (from Edit › Copy for AI in HexSketch), or a hexsketch.com link, is a structure the user drew: read the SMILES from it, or pass the link to these tools.',
].join('\n');

/** render_structure's description, for a chat with the editor and for one without (see docs/connector.md, "Which chats get the editor"). */
export function renderDescriptions(o: { rasterize: boolean; saves: boolean }): { forEditor: string; forText: string } {
  const saves = o.saves ? ' With save_to, also writes the file (format from the extension: .png .svg .pdf .cdxml .mol).' : '';
  const image = o.rasterize ? ' (PNG by default)' : ' (SVG)';
  /**
   * Where the editor shows, as it was before text-only chats: a fuller
   * description here made models draw a picture before opening the editor,
   * and Claude's desktop app then never showed the editor.
   */
  const renderForEditor = `Draw a chemical structure, or a reaction scheme (reaction), as a publication-quality image${image}, with its name, SMILES and a link that opens it in HexSketch for editing. Show the user the image and the link.${saves} In a chat that shows the HexSketch editor, use open_sketcher and show_in_sketcher instead, unless the user asks for an image or a file.`;
  // Where it doesn't, it is the drawing tool, so it carries the essentials: some agents never show a server's instructions to the model.
  const renderForText = `Draw a chemical structure, or a reaction scheme (reaction), as a publication-quality image${image}, with its name, SMILES, formula and a link that opens it in HexSketch at hexsketch.com, where the user can edit it by drawing. Give structures as SMILES, not names. Check the name and formula returned against what you meant, and always give the user the link; where you can show a web page beside the chat (a preview pane, a browser tool), open the link there too. Draw every reaction as a scheme: reagents above the arrow, solvent, temperature, time and yield below; a whole synthesis or retrosynthesis as one scheme (then).${saves}`;
  return { forEditor: renderForEditor, forText: renderForText };
}

/**
 * Input schemas are made fresh for each use: a schema object used twice in
 * one tool is published as a $ref to the first, which some clients (Claude's
 * directory among them) can't read.
 */
export const structure = () => z.string().min(1).max(1_000_000).describe('The structure: SMILES (e.g. "CC(=O)Oc1ccccc1C(=O)O"), molfile or CDXML text, or a HexSketch link (https://hexsketch.com/#smiles=... or #cdxml=...). Not a name.');
const sequence = () => ({
  stages: z.array(z.string().min(1)).min(2).max(8).describe('SMILES of each stage, left to right: starting materials, any intermediates, products. Join the structures of one stage with "." and they are drawn with "+" between them, e.g. ["CC(=O)O.OCC", "CC(=O)OCC.O"].'),
  arrows: z.array(z.object({
    reagents: z.string().max(200).optional().describe('Written above the arrow: reagents and catalysts, e.g. "MeOH, H2SO4 (cat.)" or "1. LDA  2. MeI". Digits in formulas are subscripted.'),
    conditions: z.string().max(200).optional().describe('Written below the arrow: solvent, temperature, time and yield, e.g. "THF, −78 °C to rt, 2 h" (a second line after \\n, e.g. "85%").'),
    type: z.enum(['forward', 'equilibrium', 'retrosynthetic']).optional().describe('forward (default), equilibrium or retrosynthetic.'),
  })).optional().describe('One per step, between consecutive stages (one fewer than the stages).'),
});
export const reaction = () => z.object({
  ...sequence(),
  // Without descriptions of their own (those above say it): Codex drops every description from a tool over 5,000 bytes.
  then: z.array(z.object({
    stages: z.array(z.string().min(1)).min(2).max(8),
    arrows: z.array(z.object({ reagents: z.string().max(200).optional(), conditions: z.string().max(200).optional(), type: z.enum(['forward', 'equilibrium', 'retrosynthetic']).optional() })).optional(),
  })).max(3).optional().describe('More schemes, given as stages and arrows like this one, drawn below it in the same drawing, each starting on a new row: for a retrosynthesis, the forward route (with its reagents and conditions) below the retrosynthetic analysis, so the whole route is on one page.'),
}).describe('A reaction scheme instead of a single structure: starting materials, an arrow with the reagents above it and the solvent and conditions below, and the products. Use it for every reaction or synthetic step.');

const atomRef = () => z.array(z.number().int().min(0)).min(1).max(2);
export const arrows = () => z.array(z.object({
  from: atomRef().describe('Where the electrons come from, by atom-map number: [3] a lone pair on atom 3, [2, 3] the bond between atoms 2 and 3.'),
  to: atomRef().describe('Where they go: [2] onto atom 2, [1, 2] into the bond 1–2, existing or being made (a nucleophile attacking: from [1] to [1, 2]).'),
  electrons: z.union([z.literal(1), z.literal(2)]).optional().describe('2 (default): an electron pair, full arrowhead. 1: one electron, a fishhook (radical steps).'),
  colour: z.enum(COLOUR_NAMES).optional().describe('Arrow colour, as a highlight colour name; default black.'),
})).max(12).describe('Curly (electron-pushing) arrows for a mechanism step, drawn on the structure or reaction given in the same call. Give it as SMILES with atom-map numbers on the atoms the arrows touch, e.g. "[OH-:1].[CH3:2][Br:3]" with arrows [{from:[1],to:[1,2]},{from:[2,3],to:[3]}]. A mapped atom written as just its element ([C:1]) keeps its usual hydrogens; separate species are drawn close together, the attacking one beside the atom it attacks. HexSketch places each arrow clear of the drawing.');

export const disconnect = () => z.array(z.array(z.number().int().min(0)).length(2)).max(6).describe('Retrosynthesis: bonds of the target to mark as disconnections, by their atoms\' map numbers in the SMILES. [[1, 2]] draws a wavy line across the bond 1–2. With a reaction, the marks go on its first stage, the target: give the map numbers there only.');

export const style = z.enum(['hexsketch', 'acs']).optional().describe('Drawing style: hexsketch (default) or acs (ACS 1996 journal style).');

/** A tool's structure or reaction scheme (exactly one), ready for the agent functions, with any curly arrows drawn on it. */
export async function given(structureText: string | undefined, reactionScheme: Scheme | undefined, opts: { style?: 'hexsketch' | 'acs'; like?: Molecule; arrows?: ElectronArrow[]; disconnect?: number[][]; abbreviate?: boolean } = {}): Promise<string | Structure> {
  if (structureText && reactionScheme) throw new Error('Give a structure or a reaction, not both');
  const { arrows: curly, disconnect: cuts, ...read } = opts;
  const reading = { ...(read.style ? { style: read.style } : {}), ...(read.abbreviate ? { abbreviate: true } : {}) };
  if (cuts?.length && !structureText && !reactionScheme) throw new Error('Disconnections are marked on the structure given in the same call: give the target as SMILES with atom-map numbers, e.g. "c1ccccc1[C:1](=O)[NH:2]C"');
  if (curly?.length && !structureText && !reactionScheme) throw new Error('Arrows are drawn on the structure or reaction given in the same call: give it as SMILES with atom-map numbers, e.g. "[OH-:1].[CH3:2][Br:3]"');
  let s: string | Structure;
  let placed = false;
  if (reactionScheme) s = await scheme(reactionScheme, { ...read, maxWidth: SCHEME_WIDTH });
  // A SMILES replacing a drawing is turned to match it (laid-out files keep their own coordinates).
  else if (structureText && read.like?.atomCount && detectFormat(structureText) === 'smiles') {
    s = await readStructure(structureText, reading);
    // A mechanism step keeps its atoms where the step before had them (by map number); otherwise it is turned to match.
    placed = alignByMaps(s.mol, read.like, s.style.bondLength);
    if (!placed) orientLike(s, read.like);
  } else if (!structureText) throw new Error('Give a structure (SMILES, molfile, CDXML or a HexSketch link) or a reaction');
  else s = structureText;
  if (!curly?.length && !cuts?.length) return s;
  if (typeof s === 'string') s = await readStructure(s, reading);
  if (curly?.length) {
    // A scheme keeps its stages where they are; one structure's separate species come together.
    if (!reactionScheme && !placed) arrangeForArrows(s.mol, curly, s.style.bondLength);
    s.objects.push(...electronArrows(s.mol, s.objects, s.style, curly));
  }
  if (cuts?.length) s.objects.push(...disconnectionMarks(s.mol, s.style, cuts));
  return s;
}

/**
 * A label fragment that starts at a mapped atom ("[C:1](=O)N") means that
 * atom: which of the fragment's places it is, counted as the editor counts
 * them (left to right), so the label lands there and not on a look-alike.
 */
export function mappedOccurrence(mol: Molecule, at: string): number | undefined {
  let pattern: Molecule;
  try { pattern = parsePattern(at); } catch { return undefined; }
  const first = pattern.atoms().next().value;
  const n = first ? [...smilesAtomMaps(pattern)].find(([, id]) => id === first.id)?.[0] : undefined;
  const target = n === undefined ? undefined : smilesAtomMaps(mol).get(n);
  if (target === undefined) return undefined;
  const i = labelPlaces(mol, at).findIndex((p) => p.id === target);
  return i >= 0 ? i + 1 : undefined;
}

/** Which of a fragment's places (from 1, left to right) it fits best, as an unnamed highlight is marked; undefined when it has no place. */
export function bestPlace(mol: Molecule, at: string): number | undefined {
  let found: ReturnType<typeof highlightPlaces>;
  try { found = highlightPlaces(mol, at); } catch { return undefined; }
  return found.length ? found.reduce((b, p, k) => (p.misfit < found[b]!.misfit ? k : b), 0) + 1 : undefined;
}

/** For a tool result: where a scheme's atoms don't balance, and what that may mean. */
export async function balanceOf(r: Scheme | undefined): Promise<Record<string, unknown>> {
  if (!r) return {};
  const b = await schemeBalance(r).catch(() => []);
  return b.length ? { balance: b, balance_note: 'Atoms that do not balance across an arrow: fine when they come from a reagent written above it or leave as an unshown byproduct; otherwise add the missing byproduct (H2O, HCl...) or correct the product.' } : {};
}

/**
 * For a tool result: what could make the drawing dangerous to make or handle
 * (its structures, and reagents written above its arrows), for the model to
 * pass on to the user.
 */
export async function safetyOf(drawing: string | Structure | undefined): Promise<Record<string, unknown>> {
  if (!drawing) return {};
  const found = await hazards(drawing).catch(() => []);
  return found.length ? { hazards: found.map(hazardLine), hazard_note: `Flag dangers and warnings to the user in a few words; notes only if they matter. ${HAZARD_DISCLAIMER}` } : {};
}

/** The arrows as the agent takes them, with colour names turned into colours. */
export const curlyArrows = (list: { from: number[]; to: number[]; electrons?: 1 | 2; colour?: string }[] | undefined): ElectronArrow[] | undefined =>
  list?.map(({ colour, ...a }) => {
    const c = colour ? HIGHLIGHTS.find((h) => h.name === colour.toLowerCase()) : undefined;
    return { ...a, ...(c ? { color: c.text } : {}) };
  });

export const checkOf = async (drawing: string | Structure): Promise<Record<string, unknown>> => {
  const [about, v] = await Promise.all([analyze(drawing), validate(drawing)]);
  const issues = v.issues.filter((x) => x.severity !== 'note').map((x) => x.message);
  return {
    name: about.name, formula: about.formula,
    ...(about.structures.length ? { structures: about.structures.map((x) => ({ name: x.name, formula: x.formula })) } : {}),
    ...(issues.length ? { issues } : {}),
  };
};

/** One step's fields: what show_in_sketcher shows, and each of its steps. */
export const showFields = () => ({
    structure: structure().optional().describe('A new structure to draw in place of the current one (the user can undo it). To show several side by side (both enantiomers, compounds you compare), join their SMILES with "." in one structure; for a reaction, use reaction instead, so it gets an arrow, reagents and conditions. Leave out to work on what is drawn.'),
    reaction: reaction().optional(),
    arrows: arrows().optional(),
    disconnect: disconnect().optional(),
    highlight: z.array(z.union([
      z.string().min(1),
      z.object({
        smiles: z.string().min(1).describe('The SMILES fragment.'),
        occurrence: z.number().int().min(1).max(20).optional().describe('Which place, when the fragment is found more than once: counted left to right by its first atom (default: where the fragment fits best).'),
        every: z.boolean().optional().describe('Mark every place the fragment is found (rarely: one highlight is one thing).'),
      }),
    ])).max(HIGHLIGHTS.length).optional().describe('Up to five things to highlight, each one atom, one functional group or one monomer (an amino acid residue, a nucleotide, a sugar), coloured yellow, blue, orange, green, purple in order. Each is a SMILES fragment of just that group, e.g. "C(=O)O" or "c1ccccc1", marked at one place: where the fragment fits best (fewest groups attached that it does not have), or the one whose first atom has an atom-map number ("[C:3](=O)O"), or give {smiles, occurrence} for another. To show two of a kind, give two highlights.'),
    labels: z.array(z.object({
      at: z.string().min(1).describe('SMILES fragment whose first atom the label points at, e.g. "OC(=O)" for an acid\'s OH. The same fragment as a highlight gives the label that highlight\'s colour.'),
      text: z.string().min(1).max(40).describe('A few words or a value, e.g. "pKa ≈ 4.4", "Michael acceptor", "(S)", "H-bond donor". Not a sentence.'),
      colour: z.enum(COLOUR_NAMES).optional().describe('Text colour, as a highlight colour name; default that of the highlight with the same fragment, else grey.'),
      occurrence: z.number().int().min(1).max(20).optional().describe('Which place, when the fragment is found more than once: counted left to right (default: where the fragment fits best, as for a highlight).'),
    })).max(MAX_LABELS).optional().describe(`Up to ${MAX_LABELS} short labels pinned beside atoms: values and properties at the atom they belong to (pKa, a reactive site, a configuration), so the drawing carries the detail and the note stays short.`),
    note: z.string().max(800).optional().describe('A summary for the editor\'s notes panel, small and organised: up to five "- " bullets of a few words each, each starting with the **colour** it explains (e.g. "- **Yellow**: carboxylic acid, pKa ≈ 4.4"), or two short sentences. Point to the drawing rather than repeat its labels; no preamble, no restating the question, no chemistry lesson: the explanation goes in the chat reply.'),
});
export type Show = { structure?: string; reaction?: Scheme; arrows?: Parameters<typeof curlyArrows>[0]; disconnect?: number[][]; highlight?: (string | Highlight)[]; labels?: { at: string; text: string; colour?: string; occurrence?: number }[]; note?: string };

/** Check one step and build the editor's update for it, drawn the same way round as `before`. */
export const prepare = async (a: Show, before: Molecule | undefined, current: string): Promise<{ update: Omit<SketchUpdate, 'version'>; report: Record<string, unknown>; mol: Molecule | null }> => {
  if (a.arrows?.length && !a.reaction && !a.structure) throw new Error('Arrows are drawn on the structure or reaction given in the same call: give the structure again as SMILES with atom-map numbers on the atoms the arrows touch, e.g. "[OH-:1].[CH3:2][Br:3]"');
  // A scheme reaches the editor as CDXML, arrows and text included, the same way round as what it replaces.
  if (a.disconnect?.length && !a.reaction && !a.structure) throw new Error('Disconnections are marked on the structure given in the same call: give the target again as SMILES with atom-map numbers, e.g. "c1ccccc1[C:1](=O)[NH:2]C"');
  const g = a.reaction || a.structure ? await given(a.structure, a.reaction, { abbreviate: true, ...(before ? { like: before } : {}), ...(a.arrows ? { arrows: curlyArrows(a.arrows)! } : {}), ...(a.disconnect ? { disconnect: a.disconnect } : {}) }) : undefined;
  const s = g === undefined ? undefined : typeof g === 'string' ? g : await convert(g, 'cdxml');
  if (!s && !a.highlight?.length && !a.labels?.length && !a.note) throw new Error('Give a structure, a reaction, a highlight, labels or a note to show.');
  const drawing = s ?? current;
  const mol: Molecule | null = drawing ? (await readStructure(drawing, { abbreviate: true })).mol : null;
  // The structure as drawn, with its atom-map numbers, for the next step to follow.
  const drawn = g && typeof g !== 'string' ? g.mol : mol;
  const highlights = (a.highlight ?? []).map((h, i) => {
    const { smiles: frag, occurrence: n, every } = typeof h === 'string' ? { smiles: h } as Highlight : h;
    let found: ReturnType<typeof highlightPlaces>;
    try { found = mol ? highlightPlaces(mol, frag) : []; } catch (err) { throw new Error(`Highlight "${frag}" is not a SMILES fragment: ${(err as Error).message}`); }
    const occurrence = every ? undefined : n ?? (drawn ? mappedOccurrence(drawn, frag) : undefined);
    // Without a place named, the editor marks the one the fragment fits best: say which, so a wrong pick can be corrected.
    const best = mol ? bestPlace(mol, frag) ?? 1 : 1;
    const marked = every ? 'every place' : found.length ? `place ${occurrence ?? best} of ${found.length}${occurrence ? '' : found.length > 1 ? ' (the best fit; give occurrence, counted left to right, for another)' : ''}` : 'none';
    return { smiles: frag, ...(occurrence ? { occurrence } : {}), ...(every ? { every } : {}), ...HIGHLIGHTS[i]!, places: found.length, marked };
  });
  const pinned = (a.labels ?? []).map((l) => {
    const places = mol ? labelPlaces(mol, l.at).length : 0;
    const colour = l.colour ? HIGHLIGHTS.find((h) => h.name === l.colour) : highlights.find((h) => h.smiles === l.at);
    // Where it is not named, a label goes where its fragment fits best, as a highlight does (and so beside the highlight with the same fragment).
    const occurrence = l.occurrence ?? (drawn ? mappedOccurrence(drawn, l.at) : undefined) ?? (mol && places > 1 ? bestPlace(mol, l.at) : undefined);
    return { at: l.at, text: l.text, ...(colour ? { color: colour.text } : {}), ...(occurrence ? { occurrence } : {}), places };
  });
  const missed = [...highlights.filter((h) => h.places < (h.occurrence ?? 1)).map((h) => h.smiles), ...pinned.filter((l) => l.places < (l.occurrence ?? 1)).map((l) => l.at)];
  return {
    mol: s ? drawn : before ?? null,
    update: {
      ...(s ? { structure: s } : {}),
      ...(a.highlight ? { highlights: highlights.map(({ smiles, occurrence, every, color, name: n }) => ({ smiles, ...(occurrence ? { occurrence } : {}), ...(every ? { every } : {}), color, name: n })) } : {}),
      ...(a.labels ? { labels: pinned.map(({ places: _, ...l }) => l) } : {}),
      ...(a.note ? { note: a.note } : {}),
    },
    report: {
      // What was drawn, to check against what was meant (in place of a separate validate_structure call).
      ...(s ? { drawn: await checkOf(s) } : {}),
      ...(await balanceOf(a.reaction)),
      ...(await safetyOf(s)),
      highlights: highlights.map((h) => ({ smiles: h.smiles, colour: h.name, places: h.places, marked: h.marked })),
      ...(pinned.length ? { labels: pinned.map((l) => ({ at: l.at, text: l.text, places: l.places })) } : {}),
      ...(missed.length ? { warning: `Not found in the drawing: ${missed.join(', ')}. Check the fragment against read_sketcher's SMILES.` } : {}),
    },
  };
};


/**
 * A sequence of steps (a mechanism), each checked and made into the
 * editor's update, opening at the first: the updates to show, in order,
 * and what to tell the model. Any mistake throws before any is shown.
 */
export const prepareSteps = async (steps: Show[], before: Molecule | undefined, current: string): Promise<{ updates: Omit<SketchUpdate, 'version'>[]; report: Record<string, unknown> }> => {
  // Every step is checked before any is shown, so a mistake in step 3 leaves the editor as it was.
  const prepared: Awaited<ReturnType<typeof prepare>>[] = [];
  let like = before;
  for (const [i, step] of steps.entries()) {
    let p;
    try { p = await prepare(step, like, current); } catch (err) { throw new Error(`Step ${i + 1}: ${(err as Error).message}`); }
    prepared.push(p);
    if (p.update.structure) { current = p.update.structure; like = p.mol ?? like; }
  }
  const updates = prepared.map((p, i) => ({ ...p.update, step: { index: i, count: prepared.length } }));
  // In a mechanism every species is drawn, so each step should have the atoms and charge of the one before.
  const unbalanced: string[] = [];
  for (let i = 1; i < steps.length; i++) {
    const a0 = prepared[i - 1]!, a1 = prepared[i]!;
    if (!steps[i - 1]!.structure || !steps[i]!.structure || !a0.mol || !a1.mol) continue;
    const x = imbalance(a0.mol, a1.mol);
    if (x) unbalanced.push(`Step ${i} → ${i + 1}: ${describeImbalance(x)}`);
  }
  const report = {
    steps: prepared.map((p, i) => ({ step: i + 1, ...p.report })),
    ...(unbalanced.length ? { balance: unbalanced, balance_note: 'In a mechanism each step should have the same atoms and total charge as the one before. Unless a species joins or leaves on purpose (a proton from the solvent, say), check the step and show it again.' } : {}),
    next: `The user sees step 1 of ${prepared.length} in the editor and steps through with Back and Next. In the chat, say in a line or two what happens overall and point them to the steps; don't narrate each one.`,
  };
  return { updates, report };
};
export const stepsField = z.array(z.object(showFields())).min(2).max(MAX_STEPS).optional().describe(`Instead of the fields above, a sequence of up to ${MAX_STEPS} steps the user steps through with Back and Next, starting at the first: a mechanism (each step its species with atom-map numbers, its curly arrows and a one-line note naming it, keeping the same map numbers throughout) or a before-and-after. Not for a synthesis or retrosynthesis: draw it as one reaction (with then), so all of it is on the page at once. Each step is drawn the same way round as the one before.`);

/** What the tools do, as the model reads it: the same wherever HexSketch is reached. */
export const DESCRIPTIONS = {
  name_structure: 'The IUPAC name of a structure, generated offline. Returns name null with a reason when the structure is outside what HexSketch names.',
  analyze_structure: 'Name, SMILES (with stereochemistry), molecular formula, exact (monoisotopic) mass, molecular weight, elemental analysis and isotope pattern (m/z). Mixtures and salts are also given per structure.',
  validate_structure: 'Check a structure, typically a SMILES you wrote, before presenting it: catches unreadable SMILES, names given instead of SMILES, aromatic rings that cannot be kekulized, atoms over or under their valence, unusual charges and radicals. Returns ok, issues (error, warning or note), and the name and formula to compare with what you meant. Never fails on bad input; it reports it.',
  convert_structure: 'Convert a structure to SMILES (with stereochemistry), a molfile (V2000), CDXML (ChemDraw) or a HexSketch link.',
  compare_structures: 'Are two structures the same compound, and the same stereoisomer? The inputs may be in different formats (a SMILES against a drawing, for instance).',
  read_sketcher: 'What the user has drawn in the open HexSketch editor: name, SMILES (with stereochemistry), formula, masses and a link. Call it whenever the user refers to their drawing ("this", "what I drew", "my structure").',
  show_in_sketcher: `Show something in the HexSketch editor that is already open (after open_sketcher), instead of describing it in the chat or showing an image: replace the structure, highlight parts of it, pin short labels to atoms, and sum it up in a note beside it. Use it every time you explain or change a structure while the editor is open, one call per point: highlight and label the groups you are describing (an acid's pKa, a Michael acceptor, a stereocentre's configuration, the most lipophilic part), draw a reaction the user asks about (reaction: starting materials, arrow with reagents above and solvent and conditions below, products), a mechanism with curly arrows (structure as SMILES with atom-map numbers, plus arrows), or a retrosynthetic disconnection (disconnect). For a mechanism, give steps instead: the user steps through them with Back and Next. Draw a synthesis or retrosynthesis as one reaction instead (then adds the forward route below the analysis), so the whole route is on one page. Highlights are SMILES fragments matched in the drawing, e.g. "C(=O)O" for a carboxyl group or "c1ccccc1" for a benzene ring: hydrogens are not compared, bond orders are except inside aromatic rings, and uppercase atoms only match non-aromatic ones (so an aryl ester is "C(=O)Oc", not "C(=O)OC"); up to ${HIGHLIGHTS.length}, coloured ${HIGHLIGHTS.map((h) => h.name).join(', ')} in order, so you can refer to them by colour. Each highlight is one thing — one atom, one functional group or one monomer (an amino acid residue) — marked at one place: where the fragment fits best, or the one you pick with occurrence or an atom-map number; give the group itself, not its surroundings, and two highlights for two of a kind. Labels are small text beside one atom, clear of the drawing, in the colour of the highlight with the same fragment (or the colour you give): the label points at the first atom of its fragment, so start the fragment there ("OC(=O)" labels an acid's OH, "O=C" a carbonyl oxygen, "C(C)C(=O)O" the carbon next to the acid). Each call replaces your earlier highlights (if it gives highlight) and labels (if it gives labels); the user can undo anything you change.`,
} as const;

/** What show_in_sketcher tells the model once the editor shows its update. */
export const SHOWN_NEXT = 'The user sees this in the editor now. Keep the note a short, organised summary; put the explanation in a short chat reply that points at the drawing by colour. For the next point, call show_in_sketcher again.';

// ------------------------------------------------- a chat beside the editor

/**
 * For a chat on the same page as the editor (hexsketch.com): the editor is
 * always open, so there is nothing to open, nothing to render as a picture,
 * and the user's drawing is the one the model works on.
 */
export const PAGE_INSTRUCTIONS = [
  'HexSketch draws, names and checks chemical structures. You are chatting with a chemist on hexsketch.com, beside the HexSketch editor: the drawing they see is the one you work on.',
  '',
  '- Give structures to the tools as SMILES, molfile or CDXML text, or a HexSketch link. For a named compound (a drug, a development code such as AZD7594, a natural product, a CAS number), call find_structure, which looks it up in PubChem, rather than writing its SMILES from memory; then draw what it returns. Write SMILES yourself for intermediates, reagents and proposals PubChem would not know.',
  '- Show every structure and reaction you discuss in the editor with show_in_sketcher, never as text drawings or SMILES alone. Draw straight away: show_in_sketcher checks the structure and returns its name and formula, so do not call validate_structure, name_structure or analyze_structure before it; check what it returns against what you meant, and show it again if it is wrong. Each tool call is a round trip the user waits for: when you need several tools, call them together in one turn.',
  '- Highlight the parts you mean (each highlight one atom, one functional group or one monomer such as an amino acid, at one place), pin short labels to the atoms they concern (a pKa, a reactive site, a configuration), and sum them up in its note in a few short bullets by colour. The drawing carries the detail; keep the chat reply short and point to it ("the yellow ester").',
  '- When the user says "this", "my structure" or "what I drew", call read_sketcher first: they may have changed the drawing. Each message also says what the editor shows, when it has changed.',
  ...CHEMISTRY,
  '- When a result lists hazards (energetic groups, highly toxic or pyrophoric compounds, hazardous reagents or combinations), flag each danger or warning to the user in a few words, e.g. "Note: methyl azide is likely explosive." Mention notes only when they matter. They are screening rules: do not lecture, and do not refuse ordinary chemistry because of them.',
  MECHANISM,
  ORIENTATION,
].join('\n');

/** A tool as an OpenAI-style function: what OpenRouter and most model APIs take. */
export interface FunctionTool { name: string; description: string; parameters: Record<string, unknown> }

/** JSON Schema of a tool's inputs, made exactly as the MCP server makes it (so every front end offers the same tool). */
export const toJsonSchema = (shape: z.ZodRawShape): Record<string, unknown> => {
  const { $schema: _, ...schema } = zodToJsonSchema(z.object(shape), { strictUnions: true, pipeStrategy: 'input' }) as Record<string, unknown>;
  return schema;
};

/** A compound found by name in PubChem. */
export interface FoundStructure { query: string; name: string; smiles: string; formula: string; iupac?: string; pubchem: string }

/**
 * Look a compound up by name, code or CAS number in PubChem (the US National
 * Library of Medicine's open chemistry database), which answers browsers and
 * servers alike. Throws, with words for the model, when it isn't there.
 */
export async function findStructure(query: string, fetchImpl: typeof fetch = fetch): Promise<FoundStructure> {
  const q = query.trim();
  if (!q) throw new Error('Give a name to look up');
  const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(q)}/property/IsomericSMILES,MolecularFormula,IUPACName,Title/JSON`;
  const r = await fetchImpl(url);
  if (r.status === 404) throw new Error(`PubChem has no compound called "${q}". Try another name, a code or the CAS number, or write the SMILES if you are sure of it.`);
  if (!r.ok) throw new Error(`PubChem did not answer (${r.status}): try again in a moment`);
  const body = await r.json() as { PropertyTable?: { Properties?: { CID: number; SMILES?: string; IsomericSMILES?: string; MolecularFormula?: string; IUPACName?: string; Title?: string }[] } };
  // PubChem now answers IsomericSMILES as "SMILES"; older answers used the name asked for.
  const p = body.PropertyTable?.Properties?.[0];
  const smiles = p?.SMILES ?? p?.IsomericSMILES;
  if (!p || !smiles) throw new Error(`PubChem has no structure for "${q}"`);
  return { query: q, name: p.Title ?? q, smiles, formula: p.MolecularFormula ?? '', ...(p.IUPACName ? { iupac: p.IUPACName } : {}), pubchem: `https://pubchem.ncbi.nlm.nih.gov/compound/${p.CID}` };
}

/** Tools only a chat beside the editor has (the MCP server reaches no other site). */
export const PAGE_ONLY_TOOLS = ['find_structure'];

/** The tools a chat beside the editor offers: the MCP server's, less those for opening the editor or rendering pictures, and a PubChem lookup. */
export function pageTools(): FunctionTool[] {
  const show = DESCRIPTIONS.show_in_sketcher.replace('that is already open (after open_sketcher)', 'beside the chat');
  return [
    { name: 'show_in_sketcher', description: show, parameters: toJsonSchema({ ...showFields(), steps: stepsField }) },
    { name: 'read_sketcher', description: DESCRIPTIONS.read_sketcher, parameters: toJsonSchema({}) },
    {
      name: 'find_structure',
      description: 'Look a compound up by name in PubChem: a drug or trade name, a development code (AZD7594, LY3214996), a natural product, a common name, or a CAS number. Returns its SMILES (with stereochemistry), formula, IUPAC name and PubChem page. Use it for any named compound instead of writing its SMILES from memory, then draw the SMILES with show_in_sketcher and check the formula HexSketch gives matches. Not for new or proposed structures, which PubChem does not have.',
      parameters: toJsonSchema({ name: z.string().min(1).max(200).describe('The name, code or CAS number, e.g. "AZD7594", "atorvastatin", "50-78-2".') }),
    },
    { name: 'name_structure', description: DESCRIPTIONS.name_structure, parameters: toJsonSchema({ structure: structure() }) },
    { name: 'analyze_structure', description: DESCRIPTIONS.analyze_structure, parameters: toJsonSchema({ structure: structure() }) },
    { name: 'validate_structure', description: DESCRIPTIONS.validate_structure, parameters: toJsonSchema({ structure: structure() }) },
    { name: 'compare_structures', description: DESCRIPTIONS.compare_structures, parameters: toJsonSchema({ a: structure(), b: structure() }) },
    { name: 'convert_structure', description: DESCRIPTIONS.convert_structure, parameters: toJsonSchema({ structure: structure(), to: z.enum(['smiles', 'mol', 'cdxml', 'link']).describe('Target format.') }) },
  ];
}
