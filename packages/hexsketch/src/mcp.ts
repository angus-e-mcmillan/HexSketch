import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { analyze, compare, convert, link, name, readStructure, render, validate, type Rasterizer, type RenderFormat } from '@hexsketch/agent';
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
- To show a structure, call render_structure. Every result includes a link that opens the structure in HexSketch, where the user can edit it by drawing: always give the user that link.
- When the user wants to draw, sketch, edit or correct a structure, or a structure is easier to show than to describe, call open_sketcher: it opens HexSketch's editor in the chat (where the chat supports it). It works best full screen, where it stays open beside the conversation.
- Once the editor is open, it is where you and the user look at structures, for the rest of the conversation. Call read_sketcher to see what they have drawn. Show every structure you discuss with show_in_sketcher, and explain it there: highlight the parts you mean and put the explanation in its note. Do not instead show structures as images (render_structure), pictures from the web, links or text drawings, and do not open another editor; only render or search when the user asks for an image or a file. Keep the chat reply short and point to the editor ("the yellow ester").
- Text that starts "Structure from HexSketch", or a hexsketch.com link, is a structure the user drew: read the SMILES from it, or pass the link to these tools. While the editor is open, the user's current drawing is also given to you in the same form.`;

const structure = z.string().min(1).describe('The structure: SMILES (e.g. "CC(=O)Oc1ccccc1C(=O)O"), molfile or CDXML text, or a HexSketch link (https://hexsketch.com/#smiles=... or #cdxml=...). Not a name.');
const style = z.enum(['hexsketch', 'acs']).optional().describe('Drawing style: hexsketch (default) or acs (ACS 1996 journal style).');
const READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;

const text = (value: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });
const failure = (err: unknown): CallToolResult => ({ isError: true, content: [{ type: 'text', text: (err as Error).message }] });
/** Run a tool body, turning a bad structure into a tool error the assistant can read and fix. */
const safely = (fn: () => Promise<CallToolResult>) => fn().catch(failure);

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
    if (!id || !opened.has(id)) return r;
    return { ...r, content: [...r.content, { type: 'text', text: `The HexSketch editor is open in this chat (sketch "${id}"): show this there with show_in_sketcher (a structure, highlights and a note explaining it) rather than as an image, a picture from the web or a text drawing, and keep your chat reply short.` }] };
  };
  /** A model tool's body: a bad structure becomes a tool error the assistant can read and fix; results point to an open editor. */
  const tool = (fn: () => Promise<CallToolResult>) => safely(fn).then(inEditor);
  const server = new McpServer({ name: 'hexsketch', title: 'HexSketch', version: opts.version, websiteUrl: 'https://hexsketch.com' }, { instructions: INSTRUCTIONS });
  const read = (s?: 'hexsketch' | 'acs') => (s ? { style: s } : {});
  const formats: RenderFormat[] = opts.rasterize ? ['png', 'svg', 'pdf', 'cdxml', 'mol'] : ['svg', 'pdf', 'cdxml', 'mol'];

  server.registerTool('render_structure', {
    title: 'Draw a structure',
    description: `Draw a chemical structure as a publication-quality image${opts.rasterize ? ' (PNG by default)' : ' (SVG)'}, with its name, SMILES and a link that opens it in HexSketch for editing. Show the user the image and the link.${opts.saveFile ? ' With save_to, also writes the file (format from the extension: .png .svg .pdf .cdxml .mol).' : ''}`,
    inputSchema: {
      structure,
      format: z.enum(formats as [RenderFormat, ...RenderFormat[]]).optional().describe(`Output format; default ${formats[0]}. PDF needs save_to.`),
      style,
      ...(opts.saveFile ? {
        save_to: z.string().optional().describe('File to write, e.g. /Users/me/aspirin.png. Its extension sets the format.'),
        overwrite: z.boolean().optional().describe('Replace save_to if it exists (default false).'),
      } : {}),
    },
    annotations: { title: 'Draw a structure', readOnlyHint: !opts.saveFile, destructiveHint: false, openWorldHint: false },
  }, (args) => tool(async () => {
    const a = args as { structure: string; format?: RenderFormat; style?: 'hexsketch' | 'acs'; save_to?: string; overwrite?: boolean };
    const fromPath = a.save_to ? (/\.([a-z]+)$/i.exec(a.save_to)?.[1]?.toLowerCase() as RenderFormat | undefined) : undefined;
    if (a.save_to && (!fromPath || !formats.includes(fromPath))) throw new Error(`save_to needs one of these extensions: ${formats.map((f) => `.${f}`).join(' ')}`);
    const to = fromPath ?? a.format ?? formats[0]!;
    if (to === 'pdf' && !a.save_to) throw new Error('PDF is a file: give save_to, e.g. /path/to/structure.pdf');
    const r = await render(a.structure, { ...read(a.style), to, ...(opts.rasterize ? { rasterize: opts.rasterize } : {}) });
    const about = await analyze(a.structure, read(a.style));
    const saved = a.save_to && opts.saveFile ? await opts.saveFile(a.save_to, r.data, a.overwrite ?? false) : undefined;
    const info = { name: about.name, smiles: about.smiles, formula: about.formula, link: await link(a.structure, read(a.style)), ...(saved ? { saved } : {}) };
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
    const appOnly = { ui: { resourceUri: SKETCHER_URI, visibility: ['app'] as ('app' | 'model')[] } };

    registerAppResource(server, 'HexSketch editor', SKETCHER_URI, {
      description: 'The HexSketch structure editor, for drawing and editing structures in the chat.',
      _meta: { ui: { prefersBorder: true } },
    }, async () => ({
      contents: [{ uri: SKETCHER_URI, mimeType: RESOURCE_MIME_TYPE, text: await html(), _meta: { ui: { prefersBorder: true, permissions: { clipboardWrite: {} } } } }],
    }));

    registerAppTool(server, 'open_sketcher', {
      title: 'Open the HexSketch editor',
      description: 'Open HexSketch\'s drawing editor in the chat, so the user can draw a structure by hand or edit one you give. Use it whenever the user asks to draw, sketch, open, edit or correct a structure in HexSketch, or when a structure is easier to draw than describe; prefer it to render_structure and structure_link when the user may want to change the structure. Then keep working in that editor: read_sketcher shows what the user drew, and show_in_sketcher changes, highlights and annotates it. The user\'s drawing also comes back as a message starting "Structure from HexSketch" when they press Send to chat. In chats that cannot show the editor, give the user the link in the result instead.',
      inputSchema: { structure: structure.optional().describe('A structure to start from (SMILES, molfile, CDXML or a HexSketch link); leave out for an empty canvas.') },
      annotations: { title: 'Open the HexSketch editor', ...READ_ONLY },
      _meta: { ui: { resourceUri: SKETCHER_URI } },
    }, ({ structure: s }) => safely(async () => {
      const about = s ? await analyze(s) : null;
      const sketch = await store.create(s ?? '');
      opened.add(sketch.id);
      // Models see the text or the structuredContent depending on the chat, so both say how to carry on.
      const next = `The HexSketch editor is now open in the chat and stays open; the user and you work in it together for the rest of this conversation. Whenever you discuss, explain, compare or change this structure, show it in the editor: call show_in_sketcher (with sketch "${sketch.id}") with highlight (SMILES fragments, coloured yellow, blue, orange... in order) and a short note, or with a new structure. Put your explanation in the note and keep the chat reply short, pointing to the editor. Call read_sketcher (with the same sketch) whenever the user refers to their drawing, since they may have edited it. While it is open, do not show structures as images, pictures from the web or text drawings, and do not open another editor. Suggest Full screen to keep the editor beside the chat.`;
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
      description: `Show something in the HexSketch editor that is already open (after open_sketcher), instead of describing it in the chat or showing an image: replace the structure, highlight parts of it, and explain it in a note beside it. Use it every time you explain or change a structure while the editor is open, one call per point or step: highlight the groups you are describing, draw the product of a change the user asks about, point out a stereocentre. Highlights are SMILES fragments matched in the drawing, e.g. "C(=O)O" for a carboxyl group or "c1ccccc1" for a benzene ring: hydrogens are not compared, bond orders are except inside aromatic rings, and uppercase atoms only match non-aromatic ones (so an aryl ester is "C(=O)Oc", not "C(=O)OC"); up to ${HIGHLIGHTS.length}, coloured ${HIGHLIGHTS.map((h) => h.name).join(', ')} in order, so you can refer to them by colour. Each call replaces your earlier highlights; the user can undo anything you change.`,
      inputSchema: {
        sketch: sketchId,
        structure: structure.optional().describe('A new structure to draw in place of the current one (the user can undo it). To show several side by side (both enantiomers, a reactant and its product, compounds you compare), join their SMILES with "." in one structure. Leave out to work on what is drawn.'),
        highlight: z.array(z.string().min(1)).max(HIGHLIGHTS.length).optional().describe('SMILES fragments to highlight, e.g. ["C(=O)O", "c1ccccc1"].'),
        note: z.string().max(4000).optional().describe('Your explanation, shown in the editor\'s notes panel beside the drawing: a few sentences, referring to the highlights by colour; **bold** and "- " lists are shown as such. E.g. "**Yellow**: the ester you made from the acid."'),
      },
      annotations: { title: 'Show in the HexSketch editor', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, ({ sketch: id, structure: s, highlight, note }) => safely(async () => {
      const sketch = await target(id);
      if (!s && !highlight?.length && !note) throw new Error('Give a structure, a highlight or a note to show.');
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
        next: 'The user sees this in the editor now. Keep the chat reply to a sentence or two that points to it (by colour); the explanation belongs in the note. For the next point or step, call show_in_sketcher again.',
      });
    }));

    // For the editor itself (hidden from the model where the chat supports it).
    registerAppTool(server, 'sketch_updates', {
      description: 'Used by the HexSketch editor to fetch what show_in_sketcher asked it to show. Not for the model.',
      inputSchema: { sketch: z.string(), since: z.number().int() },
      annotations: READ_ONLY,
      _meta: appOnly,
    }, ({ sketch: id, since }) => safely(async () => {
      const sketch = await store.get(id);
      if (sketch && Date.now() - (lastSeen.get(id) ?? 0) > 5000) { lastSeen.set(id, Date.now()); await store.seen(id); }
      const updates = sketch ? sketch.updates.filter((u) => u.version > since) : [];
      return { content: [{ type: 'text', text: `${updates.length} updates` }], structuredContent: { live: !!sketch, updates } };
    }));

    registerAppTool(server, 'sketch_sync', {
      description: 'Used by the HexSketch editor to report the user\'s drawing, so read_sketcher can see it. Not for the model.',
      inputSchema: { sketch: z.string(), cdxml: z.string().max(4_000_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: appOnly,
    }, ({ sketch: id, cdxml }) => safely(async () => {
      await store.setDrawing(id, cdxml);
      return { content: [{ type: 'text', text: 'ok' }] };
    }));
  }

  return server;
}
