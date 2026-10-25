import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { analyze, compare, convert, link, name, readStructure, render, validate, type Rasterizer, type RenderFormat } from '@hexsketch/agent';
import { parseSmiles, substructureMatches, type Molecule } from '@hexsketch/core';

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
}

/** Where the in-chat editor is served from. */
export const SKETCHER_URI = 'ui://hexsketch/sketcher.html';

/** Highlight colours for show_in_sketcher, in order, named so the model can refer to them. */
export const HIGHLIGHTS = [
  { name: 'yellow', color: '#ffe066' }, { name: 'blue', color: '#8fd3ff' }, { name: 'orange', color: '#ffb07a' },
  { name: 'green', color: '#a6e3a1' }, { name: 'purple', color: '#d4b0ff' },
] as const;

/** What the AI asked the open editor to show; the editor fetches these with sketch_updates. */
export interface SketchUpdate {
  version: number;
  /** Replaces the drawing. */
  structure?: string;
  /** Atoms and bonds to highlight in the drawing (after any new structure), replacing earlier AI highlights. */
  highlights?: { smiles: string; color: string; name: string }[];
  note?: string;
}

const INSTRUCTIONS = `HexSketch draws, names and checks chemical structures.

- Give structures as SMILES, molfile or CDXML text, or a HexSketch link. Not names: HexSketch does not turn names into structures.
- Before presenting a SMILES you wrote, call validate_structure and compare its name and formula with what you meant.
- To show a structure, call render_structure. Every result includes a link that opens the structure in HexSketch, where the user can edit it by drawing: always give the user that link.
- When the user wants to draw, sketch, edit or correct a structure, or a structure is easier to show than to describe, call open_sketcher: it opens HexSketch's editor in the chat (where the chat supports it). It works best full screen, where it stays open beside the conversation.
- While the editor is open, work in it with the user: call read_sketcher to see what they have drawn, and show_in_sketcher to change the structure, highlight parts of it and leave a short note there, rather than opening another editor or only describing it in the chat.
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

export function createServer(opts: ServerOptions): McpServer {
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
  }, (args) => safely(async () => {
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
  }, ({ structure: s }) => safely(async () => text({ ...(await name(s)), link: await link(s) })));

  server.registerTool('analyze_structure', {
    title: 'Analyze a structure',
    description: 'Name, SMILES (with stereochemistry), molecular formula, exact (monoisotopic) mass, molecular weight, elemental analysis and isotope pattern (m/z). Mixtures and salts are also given per structure.',
    inputSchema: { structure },
    annotations: { title: 'Analyze a structure', ...READ_ONLY },
  }, ({ structure: s }) => safely(async () => text({ ...(await analyze(s)), link: await link(s) })));

  server.registerTool('validate_structure', {
    title: 'Check a structure',
    description: 'Check a structure, typically a SMILES you wrote, before presenting it: catches unreadable SMILES, names given instead of SMILES, aromatic rings that cannot be kekulized, atoms over or under their valence, unusual charges and radicals. Returns ok, issues (error, warning or note), and the name and formula to compare with what you meant. Never fails on bad input; it reports it.',
    inputSchema: { structure },
    annotations: { title: 'Check a structure', ...READ_ONLY },
  }, ({ structure: s }) => safely(async () => {
    const v = await validate(s);
    return text(v.smiles !== undefined ? { ...v, link: await link(s) } : v);
  }));

  server.registerTool('convert_structure', {
    title: 'Convert a structure',
    description: 'Convert a structure to SMILES (with stereochemistry), a molfile (V2000), CDXML (ChemDraw) or a HexSketch link.',
    inputSchema: { structure, to: z.enum(['smiles', 'mol', 'cdxml', 'link']).describe('Target format.') },
    annotations: { title: 'Convert a structure', ...READ_ONLY },
  }, ({ structure: s, to }) => safely(async () => ({ content: [{ type: 'text', text: await convert(s, to) }] })));

  server.registerTool('compare_structures', {
    title: 'Compare two structures',
    description: 'Are two structures the same compound, and the same stereoisomer? The inputs may be in different formats (a SMILES against a drawing, for instance).',
    inputSchema: { a: structure, b: structure },
    annotations: { title: 'Compare two structures', ...READ_ONLY },
  }, ({ a, b }) => safely(async () => text(await compare(a, b))));

  server.registerTool('structure_link', {
    title: 'Link to edit in HexSketch',
    description: 'A link that opens the structure in HexSketch (in the browser, nothing to install), where the user can edit it by drawing and copy it back. Give it to the user whenever they may want to change a structure.',
    inputSchema: { structure, style },
    annotations: { title: 'Link to edit in HexSketch', ...READ_ONLY },
  }, ({ structure: s, style: st }) => safely(async () => ({ content: [{ type: 'text', text: await link(s, read(st)) }] })));

  if (opts.sketcherHtml) {
    const html = opts.sketcherHtml;
    // The editor open now: one per connection (a chat), the latest open_sketcher wins.
    let sketch: { id: string; version: number; updates: SketchUpdate[]; drawing: string } | null = null;
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
      sketch = { id: crypto.randomUUID(), version: 0, updates: [], drawing: s ?? '' };
      // The editor reads structuredContent; the text is for the model, and for chats that cannot show the editor.
      const shared = { structure: s ?? '', sketch: sketch.id };
      if (!s || !about) return { content: [{ type: 'text', text: 'Opened the HexSketch editor with an empty canvas. In a chat that cannot show it, the user can draw at https://hexsketch.com and paste what Edit › Copy for AI gives them.' }], structuredContent: shared };
      const url = await link(s);
      return {
        content: [{ type: 'text', text: JSON.stringify({ opened: about.name ?? about.smiles, smiles: about.smiles, link: url, note: 'The editor is open in the chat where it is supported (suggest full screen to keep it beside the conversation); the link opens the same structure on hexsketch.com.' }, null, 2) }],
        structuredContent: { ...shared, name: about.name, smiles: about.smiles, link: url },
      };
    }));

    /** The molecule the editor shows now, as far as the server knows. */
    const current = async (): Promise<Molecule | null> => (sketch?.drawing ? (await readStructure(sketch.drawing)).mol : null);

    server.registerTool('read_sketcher', {
      title: 'Read the HexSketch editor',
      description: 'What the user has drawn in the open HexSketch editor: name, SMILES (with stereochemistry), formula, masses and a link. Call it whenever the user refers to their drawing ("this", "what I drew", "my structure").',
      inputSchema: {},
      annotations: { title: 'Read the HexSketch editor', ...READ_ONLY },
    }, () => safely(async () => {
      if (!sketch) throw new Error('No HexSketch editor is open: call open_sketcher first.');
      if (!sketch.drawing) return text({ empty: true, note: 'The canvas is empty.' });
      return text({ ...(await analyze(sketch.drawing)), link: await link(sketch.drawing) });
    }));

    server.registerTool('show_in_sketcher', {
      title: 'Show in the HexSketch editor',
      description: `Show something in the HexSketch editor that is already open, instead of opening another: replace the structure, highlight parts of it, and leave a short note beside it. Use it to explain while you talk: highlight the group you are describing, show the product of a change, point out a stereocentre. Highlights are SMILES fragments matched in the drawing, e.g. "C(=O)O" for a carboxyl group or "c1ccccc1" for a benzene ring: hydrogens are not compared, bond orders are except inside aromatic rings, and uppercase atoms only match non-aromatic ones (so an aryl ester is "C(=O)Oc", not "C(=O)OC"); up to ${HIGHLIGHTS.length}, coloured ${HIGHLIGHTS.map((h) => h.name).join(', ')} in order, so you can refer to them by colour. Each call replaces your earlier highlights; the user can undo anything you change.`,
      inputSchema: {
        structure: structure.optional().describe('A new structure to draw in place of the current one (the user can undo it). Leave out to work on what is drawn.'),
        highlight: z.array(z.string().min(1)).max(HIGHLIGHTS.length).optional().describe('SMILES fragments to highlight, e.g. ["C(=O)O", "c1ccccc1"].'),
        note: z.string().max(2000).optional().describe('A short explanation shown in the editor\'s notes panel, e.g. "Yellow: the ester you made from the acid."'),
      },
      annotations: { title: 'Show in the HexSketch editor', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, ({ structure: s, highlight, note }) => safely(async () => {
      if (!sketch) throw new Error('No HexSketch editor is open: call open_sketcher first.');
      if (!s && !highlight?.length && !note) throw new Error('Give a structure, a highlight or a note to show.');
      const target = s ? (await readStructure(s)).mol : await current();
      const highlights = (highlight ?? []).map((frag, i) => {
        let pattern: Molecule;
        try { pattern = parseSmiles(frag); } catch (err) { throw new Error(`Highlight "${frag}" is not a SMILES fragment: ${(err as Error).message}`); }
        const places = target ? substructureMatches(pattern, target).length : 0;
        return { smiles: frag, ...HIGHLIGHTS[i]!, places };
      });
      sketch.version += 1;
      sketch.updates = [...sketch.updates, {
        version: sketch.version,
        ...(s ? { structure: s } : {}),
        ...(highlight ? { highlights: highlights.map(({ smiles, color, name: n }) => ({ smiles, color, name: n })) } : {}),
        ...(note ? { note } : {}),
      }].slice(-50);
      if (s) sketch.drawing = s;
      const missed = highlights.filter((h) => h.places === 0).map((h) => h.smiles);
      return text({
        shown: true,
        highlights: highlights.map((h) => ({ smiles: h.smiles, colour: h.name, places: h.places })),
        ...(missed.length ? { warning: `Not found in the drawing: ${missed.join(', ')}. Check the fragment against read_sketcher's SMILES.` } : {}),
      });
    }));

    // For the editor itself (hidden from the model where the chat supports it).
    registerAppTool(server, 'sketch_updates', {
      description: 'Used by the HexSketch editor to fetch what show_in_sketcher asked it to show. Not for the model.',
      inputSchema: { sketch: z.string(), since: z.number().int() },
      annotations: READ_ONLY,
      _meta: appOnly,
    }, ({ sketch: id, since }) => safely(async () => {
      const live = sketch?.id === id;
      const updates = live ? sketch!.updates.filter((u) => u.version > since) : [];
      return { content: [{ type: 'text', text: `${updates.length} updates` }], structuredContent: { live, updates } };
    }));

    registerAppTool(server, 'sketch_sync', {
      description: 'Used by the HexSketch editor to report the user\'s drawing, so read_sketcher can see it. Not for the model.',
      inputSchema: { sketch: z.string(), cdxml: z.string().max(4_000_000) },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
      _meta: appOnly,
    }, ({ sketch: id, cdxml }) => safely(async () => {
      if (sketch?.id === id) sketch.drawing = cdxml;
      return { content: [{ type: 'text', text: 'ok' }] };
    }));
  }

  return server;
}
