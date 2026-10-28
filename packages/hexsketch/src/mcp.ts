import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { alignByMaps, analyze, arrangeForArrows, compare, convert, describeImbalance, detectFormat, disconnectionMarks, electronArrows, imbalance, labelPlaces, link, name, orientLike, readStructure, render, scheme, schemeBalance, validate, type ElectronArrow, type Rasterizer, type RenderFormat, type Scheme, type Structure } from '@hexsketch/agent';
import { parsePattern, smilesAtomMaps, substructureMatches, type Molecule } from '@hexsketch/core';
import { memorySketchStore, type Sketch, type SketchStore, type SketchUpdate } from './sketch-store.ts';

export type { SketchUpdate } from './sketch-store.ts';

/**
 * HexSketch as an MCP server: the agent toolkit as tools an AI assistant can
 * call. Transport-agnostic, so the same server runs over stdio (the
 * `hexsketch mcp` command, the Claude Desktop extension) and, later, HTTP.
 */

export interface ServerOptions {
  version: string;
  /** Turns SVG into PNG; without it, render_structure offers SVG only. */
  rasterize?: Rasterizer;
  /** Writes a rendered file where the assistant asks (local servers only). Returns the absolute path. */
  saveFile?: (path: string, data: string | Uint8Array, overwrite: boolean) => Promise<string>;
  /** The in-chat editor (MCP Apps), as one HTML file; without it there is no open_sketcher tool. */
  sketcherHtml?: () => Promise<string>;
  /**
   * Where open editors are kept. The model's and the editor's calls may come
   * through different connections or processes, which must share it (the CLI
   * uses a folder); defaults to this server's memory.
   */
  sketches?: SketchStore;
  /**
   * The store's latest sketch is this conversation's own (a hosted server
   * keeps one per conversation), so an editor it reports as on screen is
   * this model's even when this server did not open it (a hosted server may
   * be a new instance for every request).
   */
  sketchesPerConversation?: boolean;
  /** The largest drawing (CDXML) an editor may report, in characters. */
  maxDrawing?: number;
}

/** Where the in-chat editor is served from. */
export const SKETCHER_URI = 'ui://hexsketch/sketcher.html';

/** Highlight colours for show_in_sketcher, in order, named so the model can refer to them. */
export const HIGHLIGHTS = [
  { name: 'yellow', color: '#ffe066', text: '#8a6d00' }, { name: 'blue', color: '#8fd3ff', text: '#1b6aa5' },
  { name: 'orange', color: '#ffb07a', text: '#b4531a' }, { name: 'green', color: '#a6e3a1', text: '#2f7a34' },
  { name: 'purple', color: '#d4b0ff', text: '#6b46b5' },
] as const;
const COLOUR_NAMES = HIGHLIGHTS.map((h) => h.name) as [string, ...string[]];
/** At most this many labels on a drawing, so it stays readable. */
const MAX_LABELS = 8;
/**
 * How wide a reaction scheme may run before it wraps onto another row: two
 * A4 pages side by side less their margins, the in-chat editor's sheet.
 */
const SCHEME_WIDTH = 2 * (595.28 - 72);
/** The longest the editor's poll for updates waits for one (well inside any chat's limit on a call). */
const MAX_WAIT = 20_000;
/** At most this many steps in one show_in_sketcher call. */
const MAX_STEPS = 10;

const INSTRUCTIONS = `HexSketch draws, names and checks chemical structures.

- Give structures as SMILES, molfile or CDXML text, or a HexSketch link. Not names: HexSketch does not turn names into structures.
- Check every SMILES you write against the name and formula HexSketch returns for it: open_sketcher, show_in_sketcher and render_structure return them with any problems found, so draw first rather than calling validate_structure first. Use validate_structure for a SMILES you only give in text.
- Open the editor first. As soon as the conversation turns to a structure — drawing, showing, explaining, comparing or changing one — call open_sketcher before any other HexSketch tool, with the structure if you have one and empty if the user is about to draw, and in the same call the highlights, labels, note, arrows or steps you would show next. Do it on the first such message, not after answering in text once: the editor is the point of HexSketch, and it opens full screen beside the conversation. Only a request for a file or a bare number (a mass, a name, a formula) is answered without it.
- To show a structure where the editor cannot be opened, call render_structure. Every result includes a link that opens the structure in HexSketch, where the user can edit it by drawing: always give the user that link.
- Once the editor is open, it is where you and the user look at structures, for the rest of the conversation. Call read_sketcher to see what they have drawn. Show every structure you discuss with show_in_sketcher: highlight the parts you mean, pin short labels to the atoms they concern (a pKa, a reactive site, a configuration), and sum them up in its note in a few short bullets by colour — the drawing carries the detail, the note is a small summary beside it, and your answer stays in the chat. Do not instead show structures as images (render_structure), pictures from the web, links or text drawings, and do not open another editor; only render or search when the user asks for an image or a file. Keep the chat reply short and point to the editor ("the yellow ester").
- Draw every reaction as a scheme, with the reaction input (render_structure, open_sketcher, show_in_sketcher): starting materials, then an arrow, then products, never just side by side. Always write the reagents and catalysts above the arrow and the solvent, temperature, time (and yield, if known) below it, as a chemist would; one arrow per step for a sequence.
- Draw a mechanism one step per show_in_sketcher call, with curly arrows: the species as SMILES with atom-map numbers on the atoms the arrows touch ("[OH-:1].[CH3:2][Br:3]"), and arrows from a lone pair ([1]) or a bond ([2, 3]) to an atom ([3]) or to a bond, existing or being made ([1, 2]). Show intermediates with their charges, name the step in a short note, and keep the same map numbers from step to step.
- For a retrosynthesis, mark the disconnections on the target (disconnect, by atom-map numbers), show the precursors as a reaction with a retrosynthetic arrow, then the forward route with its reagents and conditions; steps lets the chemist walk through it. HexSketch checks that atoms balance, not whether a route works or its materials can be bought: say so when it matters.
- Give related structures as SMILES and HexSketch draws them the same way round: in a scheme, each structure keeps the orientation of the first related one before it (the same compound is drawn identically), and a structure you show in the editor keeps the orientation of the drawing it replaces. Keep a compound in the same place in the scheme from one call to the next, so the chemist can follow it.
- Text that starts "Structure from HexSketch", or a hexsketch.com link, is a structure the user drew: read the SMILES from it, or pass the link to these tools. While the editor is open, the user's current drawing is also given to you in the same form.`;

/**
 * Input schemas are made fresh for each use: a schema object used twice in
 * one tool is published as a $ref to the first, which some clients (Claude's
 * directory among them) can't read.
 */
const structure = () => z.string().min(1).max(1_000_000).describe('The structure: SMILES (e.g. "CC(=O)Oc1ccccc1C(=O)O"), molfile or CDXML text, or a HexSketch link (https://hexsketch.com/#smiles=... or #cdxml=...). Not a name.');
const reaction = () => z.object({
  stages: z.array(z.string().min(1)).min(2).max(8).describe('SMILES of each stage, left to right: starting materials, any intermediates, products. Join the structures of one stage with "." and they are drawn with "+" between them, e.g. ["CC(=O)O.OCC", "CC(=O)OCC.O"].'),
  arrows: z.array(z.object({
    reagents: z.string().max(200).optional().describe('Written above the arrow: reagents and catalysts, e.g. "MeOH, H2SO4 (cat.)" or "1. LDA  2. MeI". Digits in formulas are subscripted.'),
    conditions: z.string().max(200).optional().describe('Written below the arrow: solvent, temperature, time and yield, e.g. "THF, −78 °C to rt, 2 h" (a second line after \\n, e.g. "85%").'),
    type: z.enum(['forward', 'equilibrium', 'retrosynthetic']).optional().describe('forward (default), equilibrium or retrosynthetic.'),
  })).optional().describe('One per step, between consecutive stages (one fewer than the stages).'),
}).describe('A reaction scheme instead of a single structure: starting materials, an arrow with the reagents above it and the solvent and conditions below, and the products. Use it for every reaction or synthetic step.');

const atomRef = () => z.array(z.number().int().min(0)).min(1).max(2);
const arrows = () => z.array(z.object({
  from: atomRef().describe('Where the electrons come from, by atom-map number: [3] a lone pair on atom 3, [2, 3] the bond between atoms 2 and 3.'),
  to: atomRef().describe('Where they go: [2] onto atom 2, [1, 2] into the bond 1–2, existing or being made (a nucleophile attacking: from [1] to [1, 2]).'),
  electrons: z.union([z.literal(1), z.literal(2)]).optional().describe('2 (default): an electron pair, full arrowhead. 1: one electron, a fishhook (radical steps).'),
  colour: z.enum(COLOUR_NAMES).optional().describe('Arrow colour, as a highlight colour name; default black.'),
})).max(12).describe('Curly (electron-pushing) arrows for a mechanism step, drawn on the structure or reaction given in the same call. Give it as SMILES with atom-map numbers on the atoms the arrows touch, e.g. "[OH-:1].[CH3:2][Br:3]" with arrows [{from:[1],to:[1,2]},{from:[2,3],to:[3]}]. A mapped atom written as just its element ([C:1]) keeps its usual hydrogens; separate species are drawn close together, the attacking one beside the atom it attacks. HexSketch places each arrow clear of the drawing.');

const disconnect = () => z.array(z.array(z.number().int().min(0)).length(2)).max(6).describe('Retrosynthesis: bonds of the target to mark as disconnections, by their atoms\' map numbers in the SMILES. [[1, 2]] draws a wavy line across the bond 1–2. Follow it with the synthons or reagents as a reaction with a retrosynthetic arrow.');

const style = z.enum(['hexsketch', 'acs']).optional().describe('Drawing style: hexsketch (default) or acs (ACS 1996 journal style).');
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const text = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failure = (err: unknown): CallToolResult => ({ isError: true, content: [{ type: 'text', text: (err as Error).message }] });
/** Run a tool body, turning a bad structure into a tool error the assistant can read and fix. */
const safely = (fn: () => Promise<CallToolResult>) => fn().catch(failure);

/** A tool's structure or reaction scheme (exactly one), ready for the agent functions, with any curly arrows drawn on it. */
async function given(structureText: string | undefined, reactionScheme: Scheme | undefined, opts: { style?: 'hexsketch' | 'acs'; like?: Molecule; arrows?: ElectronArrow[]; disconnect?: number[][] } = {}): Promise<string | Structure> {
  if (structureText && reactionScheme) throw new Error('Give a structure or a reaction, not both');
  const { arrows: curly, disconnect: cuts, ...read } = opts;
  if (cuts?.length && !structureText && !reactionScheme) throw new Error('Disconnections are marked on the structure given in the same call: give the target as SMILES with atom-map numbers, e.g. "c1ccccc1[C:1](=O)[NH:2]C"');
  if (curly?.length && !structureText && !reactionScheme) throw new Error('Arrows are drawn on the structure or reaction given in the same call: give it as SMILES with atom-map numbers, e.g. "[OH-:1].[CH3:2][Br:3]"');
  let s: string | Structure;
  let placed = false;
  if (reactionScheme) s = await scheme(reactionScheme, { ...read, maxWidth: SCHEME_WIDTH });
  // A SMILES replacing a drawing is turned to match it (laid-out files keep their own coordinates).
  else if (structureText && read.like?.atomCount && detectFormat(structureText) === 'smiles') {
    s = await readStructure(structureText, read.style ? { style: read.style } : {});
    // A mechanism step keeps its atoms where the step before had them (by map number); otherwise it is turned to match.
    placed = alignByMaps(s.mol, read.like, s.style.bondLength);
    if (!placed) orientLike(s, read.like);
  } else if (!structureText) throw new Error('Give a structure (SMILES, molfile, CDXML or a HexSketch link) or a reaction');
  else s = structureText;
  if (!curly?.length && !cuts?.length) return s;
  if (typeof s === 'string') s = await readStructure(s, read.style ? { style: read.style } : {});
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
function mappedOccurrence(mol: Molecule, at: string): number | undefined {
  let pattern: Molecule;
  try { pattern = parsePattern(at); } catch { return undefined; }
  const first = pattern.atoms().next().value;
  const n = first ? [...smilesAtomMaps(pattern)].find(([, id]) => id === first.id)?.[0] : undefined;
  const target = n === undefined ? undefined : smilesAtomMaps(mol).get(n);
  if (target === undefined) return undefined;
  const i = labelPlaces(mol, at).findIndex((p) => p.id === target);
  return i >= 0 ? i + 1 : undefined;
}

/** For a tool result: where a scheme's atoms don't balance, and what that may mean. */
async function balanceOf(r: Scheme | undefined): Promise<Record<string, unknown>> {
  if (!r) return {};
  const b = await schemeBalance(r).catch(() => []);
  return b.length ? { balance: b, balance_note: 'Atoms that do not balance across an arrow: fine when they come from a reagent written above it or leave as an unshown byproduct; otherwise add the missing byproduct (H2O, HCl...) or correct the product.' } : {};
}

/** The arrows as the agent takes them, with colour names turned into colours. */
const curlyArrows = (list: { from: number[]; to: number[]; electrons?: 1 | 2; colour?: string }[] | undefined): ElectronArrow[] | undefined =>
  list?.map(({ colour, ...a }) => {
    const c = colour ? HIGHLIGHTS.find((h) => h.name === colour.toLowerCase()) : undefined;
    return { ...a, ...(c ? { color: c.text } : {}) };
  });

const toBase64 = (bytes: Uint8Array) => {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** How recently an editor must have asked for updates to count as on screen (it asks every 1.5 s, or 6 s when hidden). */
const ON_SCREEN_MS = 20_000;

export function createServer(opts: ServerOptions): McpServer {
  const sketches = opts.sketcherHtml ? (opts.sketches ?? memorySketchStore()) : null;
  /** The sketches this server's open_sketcher opened: an editor on screen from another chat (or app) is not this model's. */
  const opened = new Set<string>();
  /**
   * While an editor is on screen, every tool result says to work in it: models
   * drift back to images and long chat answers otherwise.
   */
  const inEditor = async (r: CallToolResult): Promise<CallToolResult> => {
    const id = !r.isError && sketches ? await sketches.live(ON_SCREEN_MS) : null;
    if (!id || (!opts.sketchesPerConversation && !opened.has(id))) return r;
    return { ...r, content: [...r.content, { type: 'text', text: `The HexSketch editor is open in this chat (sketch "${id}"): show this there with show_in_sketcher (a structure, highlights, short labels on atoms and a note of a few bullets summing them up) rather than as an image, a picture from the web or a text drawing, and keep your chat reply short.` }] };
  };
  /** A model tool's body: a bad structure becomes a tool error the assistant can read and fix; results point to an open editor. */
  const tool = (fn: () => Promise<CallToolResult>) => safely(fn).then(inEditor);
  const server = new McpServer({ name: 'hexsketch', title: 'HexSketch', version: opts.version, websiteUrl: 'https://hexsketch.com' }, { instructions: INSTRUCTIONS });
  const read = (s?: 'hexsketch' | 'acs') => (s ? { style: s } : {});
  const formats: RenderFormat[] = opts.rasterize ? ['png', 'svg', 'pdf', 'cdxml', 'mol'] : ['svg', 'pdf', 'cdxml', 'mol'];

  server.registerTool('render_structure', {
    title: 'Draw a structure',
    description: `Draw a chemical structure, or a reaction scheme (reaction), as a publication-quality image${opts.rasterize ? ' (PNG by default)' : ' (SVG)'}, with its name, SMILES and a link that opens it in HexSketch for editing. Show the user the image and the link.${opts.saveFile ? ' With save_to, also writes the file (format from the extension: .png .svg .pdf .cdxml .mol).' : ''}`,
    inputSchema: {
      structure: structure().optional(),
      reaction: reaction().optional(),
      arrows: arrows().optional(),
      disconnect: disconnect().optional(),
      format: z.enum(formats as [RenderFormat, ...RenderFormat[]]).optional().describe(`Output format; default ${formats[0]}. PDF needs save_to.`),
      style,
      ...(opts.saveFile ? {
        save_to: z.string().optional().describe('File to write, e.g. /Users/me/aspirin.png. Its extension sets the format.'),
        overwrite: z.boolean().optional().describe('Replace save_to if it exists (default false).'),
      } : {}),
    },
    annotations: { title: 'Draw a structure', readOnlyHint: !opts.saveFile, destructiveHint: false, openWorldHint: false },
  }, (args) => tool(async () => {
    const a = args as { structure?: string; reaction?: Scheme; arrows?: Parameters<typeof curlyArrows>[0]; disconnect?: number[][]; format?: RenderFormat; style?: 'hexsketch' | 'acs'; save_to?: string; overwrite?: boolean };
    const fromPath = a.save_to ? (/\.([a-z]+)$/i.exec(a.save_to)?.[1]?.toLowerCase() as RenderFormat | undefined) : undefined;
    if (a.save_to && (!fromPath || !formats.includes(fromPath))) throw new Error(`save_to needs one of these extensions: ${formats.map((f) => `.${f}`).join(' ')}`);
    const to = fromPath ?? a.format ?? formats[0]!;
    if (to === 'pdf' && !a.save_to) throw new Error('PDF is a file: give save_to, e.g. /path/to/structure.pdf');
    const input = await given(a.structure, a.reaction, { ...read(a.style), arrows: curlyArrows(a.arrows), ...(a.disconnect ? { disconnect: a.disconnect } : {}) });
    const r = await render(input, { ...read(a.style), to, ...(opts.rasterize ? { rasterize: opts.rasterize } : {}) });
    const about = await analyze(input, read(a.style));
    const saved = a.save_to && opts.saveFile ? await opts.saveFile(a.save_to, r.data, a.overwrite ?? false) : undefined;
    const issues = (await validate(input, read(a.style))).issues.filter((x) => x.severity !== 'note').map((x) => x.message);
    const info = { name: about.name, smiles: about.smiles, formula: about.formula, ...(issues.length ? { issues } : {}), link: await link(input, read(a.style)), ...(saved ? { saved } : {}), ...(await balanceOf(a.reaction)) };
    const content: CallToolResult['content'] = [];
    if (to === 'png') content.push({ type: 'image', data: toBase64(r.data as Uint8Array), mimeType: 'image/png' });
    else if (typeof r.data === 'string' && !saved) content.push({ type: 'text', text: r.data });
    content.push({ type: 'text', text: JSON.stringify(info, null, 2) });
    return { content };
  }));

  server.registerTool('name_structure', {
    title: 'Name a structure',
    description: 'The IUPAC name of a structure, generated offline. Returns name null with a reason when the structure is outside what HexSketch names.',
    inputSchema: { structure: structure() },
    annotations: { title: 'Name a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => text({ ...(await name(s)), link: await link(s) })));

  server.registerTool('analyze_structure', {
    title: 'Analyze a structure',
    description: 'Name, SMILES (with stereochemistry), molecular formula, exact (monoisotopic) mass, molecular weight, elemental analysis and isotope pattern (m/z). Mixtures and salts are also given per structure.',
    inputSchema: { structure: structure() },
    annotations: { title: 'Analyze a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => text({ ...(await analyze(s)), link: await link(s) })));

  server.registerTool('validate_structure', {
    title: 'Check a structure',
    description: 'Check a structure, typically a SMILES you wrote, before presenting it: catches unreadable SMILES, names given instead of SMILES, aromatic rings that cannot be kekulized, atoms over or under their valence, unusual charges and radicals. Returns ok, issues (error, warning or note), and the name and formula to compare with what you meant. Never fails on bad input; it reports it.',
    inputSchema: { structure: structure() },
    annotations: { title: 'Check a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => {
    const v = await validate(s);
    return text(v.smiles !== undefined ? { ...v, link: await link(s) } : v);
  }));

  server.registerTool('convert_structure', {
    title: 'Convert a structure',
    description: 'Convert a structure to SMILES (with stereochemistry), a molfile (V2000), CDXML (ChemDraw) or a HexSketch link.',
    inputSchema: { structure: structure(), to: z.enum(['smiles', 'mol', 'cdxml', 'link']).describe('Target format.') },
    annotations: { title: 'Convert a structure', ...READ_ONLY },
  }, ({ structure: s, to }) => tool(async () => ({ content: [{ type: 'text', text: await convert(s, to) }] })));

  server.registerTool('compare_structures', {
    title: 'Compare two structures',
    description: 'Are two structures the same compound, and the same stereoisomer? The inputs may be in different formats (a SMILES against a drawing, for instance).',
    inputSchema: { a: structure(), b: structure() },
    annotations: { title: 'Compare two structures', ...READ_ONLY },
  }, ({ a, b }) => tool(async () => text(await compare(a, b))));

  server.registerTool('structure_link', {
    title: 'Link to edit in HexSketch',
    description: 'A link that opens the structure in HexSketch (in the browser, nothing to install), where the user can edit it by drawing and copy it back. Give it to the user whenever they may want to change a structure.',
    inputSchema: { structure: structure(), style },
    annotations: { title: 'Link to edit in HexSketch', ...READ_ONLY },
  }, ({ structure: s, style: st }) => tool(async () => ({ content: [{ type: 'text', text: await link(s, read(st)) }] })));

  if (opts.sketcherHtml) {
    const html = opts.sketcherHtml;
    const store = sketches!;
    /** When this process last told the store an editor was on screen, so a polling editor doesn't write every time. */
    const lastSeen = new Map<string, number>();
    const sketchId = z.string().optional().describe('The sketch id open_sketcher returned; leave out for the editor opened last.');
    /** The sketch a model call means: the one named, else the one opened last. */
    const target = async (id?: string): Promise<Sketch> => {
      const s = await store.get(id ?? (await store.latest()) ?? '');
      if (!s) throw new Error(id ? 'That HexSketch editor is no longer open: call open_sketcher.' : 'No HexSketch editor is open: call open_sketcher first.');
      return s;
    };
    /** What the editor is sent to draw: the structure as given, or as CDXML when laid out here (a scheme, or turned to match `like`). */
    const toDraw = async (t?: string, r?: Scheme, like?: Molecule, curly?: ElectronArrow[], cuts?: number[][]): Promise<string> => {
      const g = await given(t, r, { ...(like ? { like } : {}), ...(curly ? { arrows: curly } : {}), ...(cuts ? { disconnect: cuts } : {}) });
      return typeof g === 'string' ? g : convert(g, 'cdxml');
    };
    const appOnly = { ui: { resourceUri: SKETCHER_URI, visibility: ['app'] as ('app' | 'model')[] } };

    registerAppResource(server, 'HexSketch editor', SKETCHER_URI, {
      description: 'The HexSketch structure editor, for drawing and editing structures in the chat.',
      _meta: { ui: { prefersBorder: true } },
    }, async () => ({
      contents: [{ uri: SKETCHER_URI, mimeType: RESOURCE_MIME_TYPE, text: await html(), _meta: { ui: { prefersBorder: true, permissions: { clipboardWrite: {} } } } }],
    }));

    /** What the model checks a structure it wrote against: its name and formula, and anything that looks wrong. */
    const checkOf = async (drawing: string | Structure): Promise<Record<string, unknown>> => {
      const [about, v] = await Promise.all([analyze(drawing), validate(drawing)]);
      const issues = v.issues.filter((x) => x.severity !== 'note').map((x) => x.message);
      return {
        name: about.name, formula: about.formula,
        ...(about.structures.length ? { structures: about.structures.map((x) => ({ name: x.name, formula: x.formula })) } : {}),
        ...(issues.length ? { issues } : {}),
      };
    };

    /** One step's fields: what show_in_sketcher shows, and each of its steps. */
    const showFields = () => ({
        structure: structure().optional().describe('A new structure to draw in place of the current one (the user can undo it). To show several side by side (both enantiomers, compounds you compare), join their SMILES with "." in one structure; for a reaction, use reaction instead, so it gets an arrow, reagents and conditions. Leave out to work on what is drawn.'),
        reaction: reaction().optional(),
        arrows: arrows().optional(),
        disconnect: disconnect().optional(),
        highlight: z.array(z.string().min(1)).max(HIGHLIGHTS.length).optional().describe('SMILES fragments to highlight, e.g. ["C(=O)O", "c1ccccc1"].'),
        labels: z.array(z.object({
          at: z.string().min(1).describe('SMILES fragment whose first atom the label points at, e.g. "OC(=O)" for an acid\'s OH. The same fragment as a highlight gives the label that highlight\'s colour.'),
          text: z.string().min(1).max(40).describe('A few words or a value, e.g. "pKa ≈ 4.4", "Michael acceptor", "(S)", "H-bond donor". Not a sentence.'),
          colour: z.enum(COLOUR_NAMES).optional().describe('Text colour, as a highlight colour name; default that of the highlight with the same fragment, else grey.'),
          occurrence: z.number().int().min(1).max(20).optional().describe('Which place, when the fragment is found more than once: counted left to right (default 1).'),
        })).max(MAX_LABELS).optional().describe(`Up to ${MAX_LABELS} short labels pinned beside atoms: values and properties at the atom they belong to (pKa, a reactive site, a configuration), so the drawing carries the detail and the note stays short.`),
        note: z.string().max(800).optional().describe('A summary for the editor\'s notes panel, small and organised: up to five "- " bullets of a few words each, each starting with the **colour** it explains (e.g. "- **Yellow**: carboxylic acid, pKa ≈ 4.4"), or two short sentences. Point to the drawing rather than repeat its labels; no preamble, no restating the question, no chemistry lesson: the explanation goes in the chat reply.'),
    });
    type Show = { structure?: string; reaction?: Scheme; arrows?: Parameters<typeof curlyArrows>[0]; disconnect?: number[][]; highlight?: string[]; labels?: { at: string; text: string; colour?: string; occurrence?: number }[]; note?: string };

    /** Check one step and build the editor's update for it, drawn the same way round as `before`. */
    const prepare = async (a: Show, before: Molecule | undefined, current: string): Promise<{ update: Omit<SketchUpdate, 'version'>; report: Record<string, unknown>; mol: Molecule | null }> => {
      if (a.arrows?.length && !a.reaction && !a.structure) throw new Error('Arrows are drawn on the structure or reaction given in the same call: give the structure again as SMILES with atom-map numbers on the atoms the arrows touch, e.g. "[OH-:1].[CH3:2][Br:3]"');
      // A scheme reaches the editor as CDXML, arrows and text included, the same way round as what it replaces.
      if (a.disconnect?.length && !a.reaction && !a.structure) throw new Error('Disconnections are marked on the structure given in the same call: give the target again as SMILES with atom-map numbers, e.g. "c1ccccc1[C:1](=O)[NH:2]C"');
      const g = a.reaction || a.structure ? await given(a.structure, a.reaction, { ...(before ? { like: before } : {}), ...(a.arrows ? { arrows: curlyArrows(a.arrows)! } : {}), ...(a.disconnect ? { disconnect: a.disconnect } : {}) }) : undefined;
      const s = g === undefined ? undefined : typeof g === 'string' ? g : await convert(g, 'cdxml');
      if (!s && !a.highlight?.length && !a.labels?.length && !a.note) throw new Error('Give a structure, a reaction, a highlight, labels or a note to show.');
      const drawing = s ?? current;
      const mol: Molecule | null = drawing ? (await readStructure(drawing)).mol : null;
      const highlights = (a.highlight ?? []).map((frag, i) => {
        let pattern: Molecule;
        try { pattern = parsePattern(frag); } catch (err) { throw new Error(`Highlight "${frag}" is not a SMILES fragment: ${(err as Error).message}`); }
        const places = mol ? substructureMatches(pattern, mol).length : 0;
        return { smiles: frag, ...HIGHLIGHTS[i]!, places };
      });
      // The structure as drawn, with its atom-map numbers, for the next step to follow.
      const drawn = g && typeof g !== 'string' ? g.mol : mol;
      const pinned = (a.labels ?? []).map((l) => {
        const places = mol ? labelPlaces(mol, l.at).length : 0;
        const colour = l.colour ? HIGHLIGHTS.find((h) => h.name === l.colour) : highlights.find((h) => h.smiles === l.at);
        const occurrence = l.occurrence ?? (drawn ? mappedOccurrence(drawn, l.at) : undefined);
        return { at: l.at, text: l.text, ...(colour ? { color: colour.text } : {}), ...(occurrence ? { occurrence } : {}), places };
      });
      const missed = [...highlights.filter((h) => h.places === 0).map((h) => h.smiles), ...pinned.filter((l) => l.places < (l.occurrence ?? 1)).map((l) => l.at)];
      return {
        mol: s ? drawn : before ?? null,
        update: {
          ...(s ? { structure: s } : {}),
          ...(a.highlight ? { highlights: highlights.map(({ smiles, color, name: n }) => ({ smiles, color, name: n })) } : {}),
          ...(a.labels ? { labels: pinned.map(({ places: _, ...l }) => l) } : {}),
          ...(a.note ? { note: a.note } : {}),
        },
        report: {
          // What was drawn, to check against what was meant (in place of a separate validate_structure call).
          ...(s ? { drawn: await checkOf(s) } : {}),
          ...(await balanceOf(a.reaction)),
          highlights: highlights.map((h) => ({ smiles: h.smiles, colour: h.name, places: h.places })),
          ...(pinned.length ? { labels: pinned.map((l) => ({ at: l.at, text: l.text, places: l.places })) } : {}),
          ...(missed.length ? { warning: `Not found in the drawing: ${missed.join(', ')}. Check the fragment against read_sketcher's SMILES.` } : {}),
        },
      };
    };


    /** Show a sequence of steps, all checked before any is shown, opening at the first; returns what to tell the model. */
    const showSteps = async (id: string, steps: Show[], before: Molecule | undefined, current: string): Promise<Record<string, unknown>> => {
      // Every step is checked before any is shown, so a mistake in step 3 leaves the editor as it was.
      const prepared: Awaited<ReturnType<typeof prepare>>[] = [];
      let like = before;
      for (const [i, step] of steps.entries()) {
        let p;
        try { p = await prepare(step, like, current); } catch (err) { throw new Error(`Step ${i + 1}: ${(err as Error).message}`); }
        prepared.push(p);
        if (p.update.structure) { current = p.update.structure; like = p.mol ?? like; }
      }
      for (const [i, p] of prepared.entries()) await store.addUpdate(id, { ...p.update, step: { index: i, count: prepared.length } });
      // In a mechanism every species is drawn, so each step should have the atoms and charge of the one before.
      const unbalanced: string[] = [];
      for (let i = 1; i < steps.length; i++) {
        const a0 = prepared[i - 1]!, a1 = prepared[i]!;
        if (!steps[i - 1]!.structure || !steps[i]!.structure || !a0.mol || !a1.mol) continue;
        const x = imbalance(a0.mol, a1.mol);
        if (x) unbalanced.push(`Step ${i} → ${i + 1}: ${describeImbalance(x)}`);
      }
      return {
        steps: prepared.map((p, i) => ({ step: i + 1, ...p.report })),
        ...(unbalanced.length ? { balance: unbalanced, balance_note: 'In a mechanism each step should have the same atoms and total charge as the one before. Unless a species joins or leaves on purpose (a proton from the solvent, say), check the step and show it again.' } : {}),
        next: `The user sees step 1 of ${prepared.length} in the editor and steps through with Back and Next. In the chat, say in a line or two what happens overall and point them to the steps; don't narrate each one.`,
      };
    };
    const stepsField = z.array(z.object(showFields())).min(2).max(MAX_STEPS).optional().describe(`Instead of the fields above, a sequence of up to ${MAX_STEPS} steps the user steps through with Back and Next, starting at the first: a mechanism (each step its species with atom-map numbers, its curly arrows and a one-line note naming it, keeping the same map numbers throughout), a synthesis, or a before-and-after. Each step is drawn the same way round as the one before.`);

    registerAppTool(server, 'open_sketcher', {
      title: 'Open the HexSketch editor',
      description: 'Open HexSketch\'s drawing editor in the chat, so the user can draw a structure by hand or edit one you give. This is the first tool to call whenever the conversation involves a structure — drawing, sketching, showing, explaining, comparing, correcting one — before render_structure or structure_link, and on the first such message rather than after an answer in text. It opens full screen, beside the conversation. Give, in this same call, what you would show next (highlight, labels, note, arrows, disconnect, or steps), so the user sees your answer as the editor opens rather than after another round. Then keep working in that editor: read_sketcher shows what the user drew, and show_in_sketcher changes, highlights and annotates it. The result gives the name and formula of what was drawn, with any problems found: check them against what you meant. The user\'s drawing also comes back as a message starting "Structure from HexSketch" when they press Send to chat. In chats that cannot show the editor, give the user the link in the result instead.',
      inputSchema: {
        ...showFields(),
        structure: structure().optional().describe('A structure to start from (SMILES, molfile, CDXML or a HexSketch link); leave out for an empty canvas.'),
        steps: stepsField,
      },
      annotations: { title: 'Open the HexSketch editor', ...READ_ONLY },
      _meta: { ui: { resourceUri: SKETCHER_URI } },
    }, (args) => safely(async () => {
      const { steps, ...one } = args as Show & { steps?: Show[] };
      if (steps && Object.values(one).some((v) => v !== undefined)) throw new Error('Give steps, or the fields of one step, not both');
      const { structure: text0, reaction: r, arrows: curly, disconnect: cuts, ...marks } = one;
      const s = r || text0 ? await toDraw(text0, r, undefined, curlyArrows(curly), cuts) : undefined;
      // Highlights, labels and a note on what opens: checked before the editor is opened, as show_in_sketcher checks them.
      const shown = !steps && (marks.highlight?.length || marks.labels?.length || marks.note) ? await prepare(marks, undefined, s ?? '') : null;
      const sketch = await store.create(s ?? '');
      opened.add(sketch.id);
      if (shown) await store.addUpdate(sketch.id, shown.update);
      const sequence = steps ? await showSteps(sketch.id, steps, undefined, '') : null;
      // Models see the text or the structuredContent depending on the chat, so both say how to carry on.
      const next = `The HexSketch editor is now open in the chat and stays open; the user and you work in it together for the rest of this conversation. Whenever you discuss, explain, compare or change this structure, show it in the editor: call show_in_sketcher (with sketch "${sketch.id}") with highlight (SMILES fragments, coloured yellow, blue, orange... in order), labels (a few words or a value beside an atom: "pKa ≈ 4.4", "Michael acceptor") and a short note, or with a new structure. Draw reactions with reaction (an arrow between starting materials and products, reagents above it, solvent and conditions below), never as structures side by side. Keep the note to a few short bullets naming the highlights by colour, and the chat reply short, pointing at the drawing by colour. Call read_sketcher (with the same sketch) whenever the user refers to their drawing, since they may have edited it. While it is open, do not show structures as images, pictures from the web or text drawings, and do not open another editor. Suggest Full screen to keep the editor beside the chat.`;
      const shared = { structure: s ?? '', sketch: sketch.id, next };
      if (sequence) return { content: [{ type: 'text', text: JSON.stringify({ opened: `${steps!.length} steps`, ...sequence, next: `${sequence.next} ${next}` }, null, 2) }], structuredContent: shared };
      if (!s) return { content: [{ type: 'text', text: JSON.stringify({ opened: 'an empty canvas', next, fallback: 'In a chat that cannot show the editor, the user can draw at https://hexsketch.com and paste what Edit › Copy for AI gives them.' }, null, 2) }], structuredContent: shared };
      const [check, url] = await Promise.all([checkOf(s), link(s)]);
      const info = { opened: (check.name as string | null) ?? 'the structure', drawn: check, link: url, ...(shown ? shown.report : {}), ...(await balanceOf(r)) };
      return {
        content: [{ type: 'text', text: JSON.stringify({ ...info, next, fallback: 'If the chat cannot show the editor, the link opens the same structure on hexsketch.com.' }, null, 2) }],
        structuredContent: { ...shared, ...info },
      };
    }));

    server.registerTool('read_sketcher', {
      title: 'Read the HexSketch editor',
      description: 'What the user has drawn in the open HexSketch editor: name, SMILES (with stereochemistry), formula, masses and a link. Call it whenever the user refers to their drawing ("this", "what I drew", "my structure").',
      inputSchema: { sketch: sketchId },
      annotations: { title: 'Read the HexSketch editor', ...READ_ONLY },
    }, ({ sketch: id }) => safely(async () => {
      const sketch = await target(id);
      if (!sketch.drawing) return text({ sketch: sketch.id, empty: true, note: 'The canvas is empty.' });
      return text({ sketch: sketch.id, ...(await analyze(sketch.drawing)), link: await link(sketch.drawing), next: 'Show what you say about this drawing in the editor with show_in_sketcher (highlight the parts you mean, explain in the note).' });
    }));

    server.registerTool('show_in_sketcher', {
      title: 'Show in the HexSketch editor',
      description: `Show something in the HexSketch editor that is already open (after open_sketcher), instead of describing it in the chat or showing an image: replace the structure, highlight parts of it, pin short labels to atoms, and sum it up in a note beside it. Use it every time you explain or change a structure while the editor is open, one call per point: highlight and label the groups you are describing (an acid's pKa, a Michael acceptor, a stereocentre's configuration, the most lipophilic part), draw a reaction the user asks about (reaction: starting materials, arrow with reagents above and solvent and conditions below, products), a mechanism with curly arrows (structure as SMILES with atom-map numbers, plus arrows), or a retrosynthetic disconnection (disconnect). For a mechanism, a retrosynthesis or any sequence, give steps instead: the user steps through them with Back and Next. Highlights are SMILES fragments matched in the drawing, e.g. "C(=O)O" for a carboxyl group or "c1ccccc1" for a benzene ring: hydrogens are not compared, bond orders are except inside aromatic rings, and uppercase atoms only match non-aromatic ones (so an aryl ester is "C(=O)Oc", not "C(=O)OC"); up to ${HIGHLIGHTS.length}, coloured ${HIGHLIGHTS.map((h) => h.name).join(', ')} in order, so you can refer to them by colour. Labels are small text beside one atom, clear of the drawing, in the colour of the highlight with the same fragment (or the colour you give): the label points at the first atom of its fragment, so start the fragment there ("OC(=O)" labels an acid's OH, "O=C" a carbonyl oxygen, "C(C)C(=O)O" the carbon next to the acid). Each call replaces your earlier highlights (if it gives highlight) and labels (if it gives labels); the user can undo anything you change.`,
      inputSchema: {
        sketch: sketchId,
        ...showFields(),
        steps: stepsField,
      },
      annotations: { title: 'Show in the HexSketch editor', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, (args) => safely(async () => {
      const { sketch: id, steps, ...one } = args as Show & { sketch?: string; steps?: Show[] };
      const sketch = await target(id);
      const before = sketch.drawing ? await readStructure(sketch.drawing).then((x) => x.mol, () => undefined) : undefined;
      if (steps) {
        if (Object.values(one).some((v) => v !== undefined)) throw new Error('Give steps, or the fields of one step, not both');
        return text({ shown: true, sketch: sketch.id, ...(await showSteps(sketch.id, steps, before, sketch.drawing)) });
      }
      const { update, report } = await prepare(one, before, sketch.drawing);
      await store.addUpdate(sketch.id, update);
      return text({ shown: true, sketch: sketch.id, ...report, next: 'The user sees this in the editor now. Keep the note a short, organised summary; put the explanation in a short chat reply that points at the drawing by colour. For the next point, call show_in_sketcher again.' });
    }));

    // For the editor itself (hidden from the model where the chat supports it).
    registerAppTool(server, 'sketch_updates', {
      description: 'Used by the HexSketch editor to fetch what show_in_sketcher asked it to show. Not for the model.',
      inputSchema: { sketch: z.string(), since: z.number().int(), wait: z.number().int().min(0).max(MAX_WAIT).optional() },
      annotations: { title: 'Fetch editor updates', ...READ_ONLY },
      _meta: appOnly,
    }, ({ sketch: id, since, wait }) => safely(async () => {
      // With wait, a poll that finds nothing holds on until the next update (or the wait is up): what the AI shows arrives at once.
      // `waits` tells the editor this server does, so it can poll again straight away.
      const waitMs = Math.min(wait ?? 0, MAX_WAIT);
      if (store.poll) {
        // A plain object: one returned by a Durable Object call carries extra (symbol) keys.
        const { live, updates } = await store.poll(id, since, waitMs);
        return { content: [{ type: 'text', text: `${updates.length} updates` }], structuredContent: { live, updates: [...updates], waits: true } };
      }
      const until = Date.now() + waitMs;
      for (;;) {
        const sketch = await store.get(id);
        if (sketch && Date.now() - (lastSeen.get(id) ?? 0) > 5000) { lastSeen.set(id, Date.now()); await store.seen(id); }
        const updates = sketch ? sketch.updates.filter((u) => u.version > since) : [];
        if (!sketch || updates.length || Date.now() >= until) return { content: [{ type: 'text', text: `${updates.length} updates` }], structuredContent: { live: !!sketch, updates, waits: true } };
        await new Promise((r) => setTimeout(r, 250));
      }
    }));

    registerAppTool(server, 'sketch_sync', {
      description: 'Used by the HexSketch editor to report the user\'s drawing, so read_sketcher can see it. Not for the model.',
      inputSchema: { sketch: z.string(), cdxml: z.string().max(opts.maxDrawing ?? 4_000_000) },
      annotations: { title: 'Report the drawing', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: appOnly,
    }, ({ sketch: id, cdxml }) => safely(async () => {
      await store.setDrawing(id, cdxml);
      return { content: [{ type: 'text', text: 'ok' }] };
    }));
  }

  return server;
}
