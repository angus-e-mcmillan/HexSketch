import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { analyze, compare, convert, detectFormat, link, name, orientLike, readStructure, render, scheme, validate, type Rasterizer, type RenderFormat, type Scheme, type Structure } from '@hexsketch/agent';
import { parseSmiles, substructureMatches, type Molecule } from '@hexsketch/core';
import { memorySketchStore, type Sketch, type SketchStore } from './sketch-store.ts';

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
  { name: 'yellow', color: '#ffe066' }, { name: 'blue', color: '#8fd3ff' }, { name: 'orange', color: '#ffb07a' },
  { name: 'green', color: '#a6e3a1' }, { name: 'purple', color: '#d4b0ff' },
] as const;

const INSTRUCTIONS = `HexSketch draws, names and checks chemical structures.

- Give structures as SMILES, molfile or CDXML text, or a HexSketch link. Not names: HexSketch does not turn names into structures.
- Before presenting a SMILES you wrote, call validate_structure and compare its name and formula with what you meant.
- Open the editor first. As soon as the conversation turns to a structure — drawing, showing, explaining, comparing or changing one — call open_sketcher before any other HexSketch tool, with the structure if you have one and empty if the user is about to draw. Do it on the first such message, not after answering in text once: the editor is the point of HexSketch, and it opens full screen beside the conversation. Only a request for a file or a bare number (a mass, a name, a formula) is answered without it.
- To show a structure where the editor cannot be opened, call render_structure. Every result includes a link that opens the structure in HexSketch, where the user can edit it by drawing: always give the user that link.
- Once the editor is open, it is where you and the user look at structures, for the rest of the conversation. Call read_sketcher to see what they have drawn. Show every structure you discuss with show_in_sketcher: highlight the parts you mean, and label them in its note with a line or two at most — the note is a caption on the drawing, not your answer, which stays in the chat. Do not instead show structures as images (render_structure), pictures from the web, links or text drawings, and do not open another editor; only render or search when the user asks for an image or a file. Keep the chat reply short and point to the editor ("the yellow ester").
- Draw every reaction as a scheme, with the reaction input (render_structure, open_sketcher, show_in_sketcher): starting materials, then an arrow, then products, never just side by side. Always write the reagents and catalysts above the arrow and the solvent, temperature, time (and yield, if known) below it, as a chemist would; one arrow per step for a sequence.
- Give related structures as SMILES and HexSketch draws them the same way round: in a scheme, each structure keeps the orientation of the first related one before it (the same compound is drawn identically), and a structure you show in the editor keeps the orientation of the drawing it replaces. Keep a compound in the same place in the scheme from one call to the next, so the chemist can follow it.
- Text that starts "Structure from HexSketch", or a hexsketch.com link, is a structure the user drew: read the SMILES from it, or pass the link to these tools. While the editor is open, the user's current drawing is also given to you in the same form.`;

const structure = z.string().min(1).max(1_000_000).describe('The structure: SMILES (e.g. "CC(=O)Oc1ccccc1C(=O)O"), molfile or CDXML text, or a HexSketch link (https://hexsketch.com/#smiles=... or #cdxml=...). Not a name.');
const reaction = z.object({
  stages: z.array(z.string().min(1)).min(2).max(8).describe('SMILES of each stage, left to right: starting materials, any intermediates, products. Join the structures of one stage with "." and they are drawn with "+" between them, e.g. ["CC(=O)O.OCC", "CC(=O)OCC.O"].'),
  arrows: z.array(z.object({
    reagents: z.string().max(200).optional().describe('Written above the arrow: reagents and catalysts, e.g. "MeOH, H2SO4 (cat.)" or "1. LDA  2. MeI". Digits in formulas are subscripted.'),
    conditions: z.string().max(200).optional().describe('Written below the arrow: solvent, temperature, time and yield, e.g. "THF, −78 °C to rt, 2 h" (a second line after \\n, e.g. "85%").'),
    type: z.enum(['forward', 'equilibrium', 'retrosynthetic']).optional().describe('forward (default), equilibrium or retrosynthetic.'),
  })).optional().describe('One per step, between consecutive stages (one fewer than the stages).'),
}).describe('A reaction scheme instead of a single structure: starting materials, an arrow with the reagents above it and the solvent and conditions below, and the products. Use it for every reaction or synthetic step.');

const style = z.enum(['hexsketch', 'acs']).optional().describe('Drawing style: hexsketch (default) or acs (ACS 1996 journal style).');
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const text = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failure = (err: unknown): CallToolResult => ({ isError: true, content: [{ type: 'text', text: (err as Error).message }] });
/** Run a tool body, turning a bad structure into a tool error the assistant can read and fix. */
const safely = (fn: () => Promise<CallToolResult>) => fn().catch(failure);

/** A tool's structure or reaction scheme (exactly one), ready for the agent functions. */
async function given(structureText: string | undefined, reactionScheme: Scheme | undefined, opts: { style?: 'hexsketch' | 'acs'; like?: Molecule } = {}): Promise<string | Structure> {
  if (structureText && reactionScheme) throw new Error('Give a structure or a reaction, not both');
  if (reactionScheme) return scheme(reactionScheme, opts);
  // A SMILES replacing a drawing is turned to match it (laid-out files keep their own coordinates).
  if (structureText && opts.like?.atomCount && detectFormat(structureText) === 'smiles') {
    const s = await readStructure(structureText);
    orientLike(s, opts.like);
    return s;
  }
  if (!structureText) throw new Error('Give a structure (SMILES, molfile, CDXML or a HexSketch link) or a reaction');
  return structureText;
}

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
    return { ...r, content: [...r.content, { type: 'text', text: `The HexSketch editor is open in this chat (sketch "${id}"): show this there with show_in_sketcher (a structure, highlights and a note of a line or two labelling them) rather than as an image, a picture from the web or a text drawing, and keep your chat reply short.` }] };
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
      structure: structure.optional(),
      reaction: reaction.optional(),
      format: z.enum(formats as [RenderFormat, ...RenderFormat[]]).optional().describe(`Output format; default ${formats[0]}. PDF needs save_to.`),
      style,
      ...(opts.saveFile ? {
        save_to: z.string().optional().describe('File to write, e.g. /Users/me/aspirin.png. Its extension sets the format.'),
        overwrite: z.boolean().optional().describe('Replace save_to if it exists (default false).'),
      } : {}),
    },
    annotations: { title: 'Draw a structure', readOnlyHint: !opts.saveFile, destructiveHint: false, openWorldHint: false },
  }, (args) => tool(async () => {
    const a = args as { structure?: string; reaction?: Scheme; format?: RenderFormat; style?: 'hexsketch' | 'acs'; save_to?: string; overwrite?: boolean };
    const fromPath = a.save_to ? (/\.([a-z]+)$/i.exec(a.save_to)?.[1]?.toLowerCase() as RenderFormat | undefined) : undefined;
    if (a.save_to && (!fromPath || !formats.includes(fromPath))) throw new Error(`save_to needs one of these extensions: ${formats.map((f) => `.${f}`).join(' ')}`);
    const to = fromPath ?? a.format ?? formats[0]!;
    if (to === 'pdf' && !a.save_to) throw new Error('PDF is a file: give save_to, e.g. /path/to/structure.pdf');
    const input = await given(a.structure, a.reaction, read(a.style));
    const r = await render(input, { ...read(a.style), to, ...(opts.rasterize ? { rasterize: opts.rasterize } : {}) });
    const about = await analyze(input, read(a.style));
    const saved = a.save_to && opts.saveFile ? await opts.saveFile(a.save_to, r.data, a.overwrite ?? false) : undefined;
    const info = { name: about.name, smiles: about.smiles, formula: about.formula, link: await link(input, read(a.style)), ...(saved ? { saved } : {}) };
    const content: CallToolResult['content'] = [];
    if (to === 'png') content.push({ type: 'image', data: toBase64(r.data as Uint8Array), mimeType: 'image/png' });
    else if (typeof r.data === 'string' && !saved) content.push({ type: 'text', text: r.data });
    content.push({ type: 'text', text: JSON.stringify(info, null, 2) });
    return { content };
  }));

  server.registerTool('name_structure', {
    title: 'Name a structure',
    description: 'The IUPAC name of a structure, generated offline. Returns name null with a reason when the structure is outside what HexSketch names.',
    inputSchema: { structure },
    annotations: { title: 'Name a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => text({ ...(await name(s)), link: await link(s) })));

  server.registerTool('analyze_structure', {
    title: 'Analyze a structure',
    description: 'Name, SMILES (with stereochemistry), molecular formula, exact (monoisotopic) mass, molecular weight, elemental analysis and isotope pattern (m/z). Mixtures and salts are also given per structure.',
    inputSchema: { structure },
    annotations: { title: 'Analyze a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => text({ ...(await analyze(s)), link: await link(s) })));

  server.registerTool('validate_structure', {
    title: 'Check a structure',
    description: 'Check a structure, typically a SMILES you wrote, before presenting it: catches unreadable SMILES, names given instead of SMILES, aromatic rings that cannot be kekulized, atoms over or under their valence, unusual charges and radicals. Returns ok, issues (error, warning or note), and the name and formula to compare with what you meant. Never fails on bad input; it reports it.',
    inputSchema: { structure },
    annotations: { title: 'Check a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => {
    const v = await validate(s);
    return text(v.smiles !== undefined ? { ...v, link: await link(s) } : v);
  }));

  server.registerTool('convert_structure', {
    title: 'Convert a structure',
    description: 'Convert a structure to SMILES (with stereochemistry), a molfile (V2000), CDXML (ChemDraw) or a HexSketch link.',
    inputSchema: { structure, to: z.enum(['smiles', 'mol', 'cdxml', 'link']).describe('Target format.') },
    annotations: { title: 'Convert a structure', ...READ_ONLY },
  }, ({ structure: s, to }) => tool(async () => ({ content: [{ type: 'text', text: await convert(s, to) }] })));

  server.registerTool('compare_structures', {
    title: 'Compare two structures',
    description: 'Are two structures the same compound, and the same stereoisomer? The inputs may be in different formats (a SMILES against a drawing, for instance).',
    inputSchema: { a: structure, b: structure },
    annotations: { title: 'Compare two structures', ...READ_ONLY },
  }, ({ a, b }) => tool(async () => text(await compare(a, b))));

  server.registerTool('structure_link', {
    title: 'Link to edit in HexSketch',
    description: 'A link that opens the structure in HexSketch (in the browser, nothing to install), where the user can edit it by drawing and copy it back. Give it to the user whenever they may want to change a structure.',
    inputSchema: { structure, style },
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
    const toDraw = async (t?: string, r?: Scheme, like?: Molecule): Promise<string> => {
      const g = await given(t, r, like ? { like } : {});
      return typeof g === 'string' ? g : convert(g, 'cdxml');
    };
    const appOnly = { ui: { resourceUri: SKETCHER_URI, visibility: ['app'] as ('app' | 'model')[] } };

    registerAppResource(server, 'HexSketch editor', SKETCHER_URI, {
      description: 'The HexSketch structure editor, for drawing and editing structures in the chat.',
      _meta: { ui: { prefersBorder: true } },
    }, async () => ({
      contents: [{ uri: SKETCHER_URI, mimeType: RESOURCE_MIME_TYPE, text: await html(), _meta: { ui: { prefersBorder: true, permissions: { clipboardWrite: {} } } } }],
    }));

    registerAppTool(server, 'open_sketcher', {
      title: 'Open the HexSketch editor',
      description: 'Open HexSketch\'s drawing editor in the chat, so the user can draw a structure by hand or edit one you give. This is the first tool to call whenever the conversation involves a structure — drawing, sketching, showing, explaining, comparing, correcting one — before render_structure or structure_link, and on the first such message rather than after an answer in text. It opens full screen, beside the conversation. Then keep working in that editor: read_sketcher shows what the user drew, and show_in_sketcher changes, highlights and annotates it. The user\'s drawing also comes back as a message starting "Structure from HexSketch" when they press Send to chat. In chats that cannot show the editor, give the user the link in the result instead.',
      inputSchema: {
        structure: structure.optional().describe('A structure to start from (SMILES, molfile, CDXML or a HexSketch link); leave out for an empty canvas.'),
        reaction: reaction.optional(),
      },
      annotations: { title: 'Open the HexSketch editor', ...READ_ONLY },
      _meta: { ui: { resourceUri: SKETCHER_URI } },
    }, ({ structure: text0, reaction: r }) => safely(async () => {
      const s = r || text0 ? await toDraw(text0, r) : undefined;
      const about = s ? await analyze(s) : null;
      const sketch = await store.create(s ?? '');
      opened.add(sketch.id);
      // Models see the text or the structuredContent depending on the chat, so both say how to carry on.
      const next = `The HexSketch editor is now open in the chat and stays open; the user and you work in it together for the rest of this conversation. Whenever you discuss, explain, compare or change this structure, show it in the editor: call show_in_sketcher (with sketch "${sketch.id}") with highlight (SMILES fragments, coloured yellow, blue, orange... in order) and a short note, or with a new structure. Draw reactions with reaction (an arrow between starting materials and products, reagents above it, solvent and conditions below), never as structures side by side. Keep the note to a caption of a line or two naming the highlights, and the chat reply short, pointing at the drawing by colour. Call read_sketcher (with the same sketch) whenever the user refers to their drawing, since they may have edited it. While it is open, do not show structures as images, pictures from the web or text drawings, and do not open another editor. Suggest Full screen to keep the editor beside the chat.`;
      const shared = { structure: s ?? '', sketch: sketch.id, next };
      if (!s || !about) return { content: [{ type: 'text', text: JSON.stringify({ opened: 'an empty canvas', next, fallback: 'In a chat that cannot show the editor, the user can draw at https://hexsketch.com and paste what Edit › Copy for AI gives them.' }, null, 2) }], structuredContent: shared };
      const url = await link(s);
      const info = { opened: about.name ?? about.smiles, smiles: about.smiles, link: url };
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
      description: `Show something in the HexSketch editor that is already open (after open_sketcher), instead of describing it in the chat or showing an image: replace the structure, highlight parts of it, and explain it in a note beside it. Use it every time you explain or change a structure while the editor is open, one call per point or step: highlight the groups you are describing, draw a reaction the user asks about (reaction: starting materials, arrow with reagents above and solvent and conditions below, products), point out a stereocentre. Keep the note to a caption of a line or two \u2014 the panel is narrow and on a phone it takes room the drawing needs. Highlights are SMILES fragments matched in the drawing, e.g. "C(=O)O" for a carboxyl group or "c1ccccc1" for a benzene ring: hydrogens are not compared, bond orders are except inside aromatic rings, and uppercase atoms only match non-aromatic ones (so an aryl ester is "C(=O)Oc", not "C(=O)OC"); up to ${HIGHLIGHTS.length}, coloured ${HIGHLIGHTS.map((h) => h.name).join(', ')} in order, so you can refer to them by colour. Each call replaces your earlier highlights; the user can undo anything you change.`,
      inputSchema: {
        sketch: sketchId,
        structure: structure.optional().describe('A new structure to draw in place of the current one (the user can undo it). To show several side by side (both enantiomers, compounds you compare), join their SMILES with "." in one structure; for a reaction, use reaction instead, so it gets an arrow, reagents and conditions. Leave out to work on what is drawn.'),
        reaction: reaction.optional(),
        highlight: z.array(z.string().min(1)).max(HIGHLIGHTS.length).optional().describe('SMILES fragments to highlight, e.g. ["C(=O)O", "c1ccccc1"].'),
        note: z.string().max(600).optional().describe('A caption for the drawing, shown in the editor\'s notes panel: at most two short sentences, or three bullets of a few words each, naming the highlights by colour. It is a label, not the answer \u2014 no preamble, no restating the question, no chemistry lesson; anything longer belongs in the chat reply. **bold** and "- " lists are shown as such. E.g. "**Yellow**: the new ester. **Blue**: the acid it came from."'),
      },
      annotations: { title: 'Show in the HexSketch editor', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, ({ sketch: id, structure: text0, reaction: r, highlight, note }) => safely(async () => {
      const sketch = await target(id);
      // A scheme reaches the editor as CDXML, arrows and text included, the same way round as what it replaces.
      const before = sketch.drawing ? await readStructure(sketch.drawing).then((x) => x.mol, () => undefined) : undefined;
      const s = r || text0 ? await toDraw(text0, r, before) : undefined;
      if (!s && !highlight?.length && !note) throw new Error('Give a structure, a reaction, a highlight or a note to show.');
      const drawing = s ?? sketch.drawing;
      const mol: Molecule | null = drawing ? (await readStructure(drawing)).mol : null;
      const highlights = (highlight ?? []).map((frag, i) => {
        let pattern: Molecule;
        try { pattern = parseSmiles(frag); } catch (err) { throw new Error(`Highlight "${frag}" is not a SMILES fragment: ${(err as Error).message}`); }
        const places = mol ? substructureMatches(pattern, mol).length : 0;
        return { smiles: frag, ...HIGHLIGHTS[i]!, places };
      });
      await store.addUpdate(sketch.id, {
        ...(s ? { structure: s } : {}),
        ...(highlight ? { highlights: highlights.map(({ smiles, color, name: n }) => ({ smiles, color, name: n })) } : {}),
        ...(note ? { note } : {}),
      });
      const missed = highlights.filter((h) => h.places === 0).map((h) => h.smiles);
      return text({
        shown: true,
        sketch: sketch.id,
        highlights: highlights.map((h) => ({ smiles: h.smiles, colour: h.name, places: h.places })),
        ...(missed.length ? { warning: `Not found in the drawing: ${missed.join(', ')}. Check the fragment against read_sketcher's SMILES.` } : {}),
        next: 'The user sees this in the editor now. Keep the note a caption of a line or two; put the rest in a short chat reply that points at the drawing by colour. For the next point or step, call show_in_sketcher again.',
      });
    }));

    // For the editor itself (hidden from the model where the chat supports it).
    registerAppTool(server, 'sketch_updates', {
      description: 'Used by the HexSketch editor to fetch what show_in_sketcher asked it to show. Not for the model.',
      inputSchema: { sketch: z.string(), since: z.number().int() },
      annotations: READ_ONLY,
      _meta: appOnly,
    }, ({ sketch: id, since }) => safely(async () => {
      if (store.poll) {
        // A plain object: one returned by a Durable Object call carries extra (symbol) keys.
        const { live, updates } = await store.poll(id, since);
        return { content: [{ type: 'text', text: `${updates.length} updates` }], structuredContent: { live, updates: [...updates] } };
      }
      const sketch = await store.get(id);
      if (sketch && Date.now() - (lastSeen.get(id) ?? 0) > 5000) { lastSeen.set(id, Date.now()); await store.seen(id); }
      const updates = sketch ? sketch.updates.filter((u) => u.version > since) : [];
      return { content: [{ type: 'text', text: `${updates.length} updates` }], structuredContent: { live: !!sketch, updates } };
    }));

    registerAppTool(server, 'sketch_sync', {
      description: 'Used by the HexSketch editor to report the user\'s drawing, so read_sketcher can see it. Not for the model.',
      inputSchema: { sketch: z.string(), cdxml: z.string().max(opts.maxDrawing ?? 4_000_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: appOnly,
    }, ({ sketch: id, cdxml }) => safely(async () => {
      await store.setDrawing(id, cdxml);
      return { content: [{ type: 'text', text: 'ok' }] };
    }));
  }

  return server;
}
