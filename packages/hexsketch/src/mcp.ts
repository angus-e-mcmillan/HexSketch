import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { getUiCapability, registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from '@modelcontextprotocol/ext-apps/server';
import { InitializeRequestSchema, type CallToolResult, type InitializeRequest, type InitializeResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { analyze, compare, convert, link, name, readStructure, render, validate, type ElectronArrow, type Rasterizer, type RenderFormat, type Scheme } from '@hexsketch/agent';
import type { Molecule } from '@hexsketch/core';
import { memorySketchStore, type Sketch, type SketchStore } from './sketch-store.ts';
import { balanceOf, checkOf, curlyArrows, given, prepare, prepareSteps, showFields, stepsField, arrows, disconnect, reaction, structure, style, DESCRIPTIONS, HIGHLIGHTS, INSTRUCTIONS, renderDescriptions, SHOWN_NEXT, textInstructions, type Show } from './toolkit.ts';

export { HIGHLIGHTS };

export type { SketchUpdate } from './sketch-store.ts';

/**
 * HexSketch as an MCP server: the agent toolkit as tools an AI assistant can
 * call. What the tools are (instructions, inputs, the work behind showing
 * something in the editor) lives in toolkit.ts, shared with every other way
 * an AI reaches HexSketch; this file is the MCP wiring. Transport-agnostic,
 * so the same server runs over stdio (the `hexsketch mcp` command, the Claude
 * Desktop extension) and HTTP (the connector at mcp.hexsketch.com).
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
  /**
   * Whether this chat can show the editor. Left out, the server decides when
   * the client connects, from what it says it supports (canShowEditor); a
   * hosted server that makes a new server for every request passes what was
   * decided when the conversation began.
   */
  editor?: boolean;
}

/** The client, as it introduces itself in initialize. */
export interface ClientHello { capabilities?: unknown; clientInfo?: { name?: string } }

/**
 * Before changing this, read docs/connector.md, "Which chats get the
 * editor": chat apps connect several times per chat, not always saying they
 * show MCP Apps, and a wrong answer sticks (change TEXT_ONLY in the worker).
 *
 * Whether a chat can show the in-chat editor: it says it supports MCP Apps,
 * or it is Claude (web, desktop, phone: "Anthropic..."), which shows them; Claude Code in a
 * terminal cannot. Codex and other terminal agents get pictures
 * and links instead.
 */
export function canShowEditor(hello: ClientHello | undefined): boolean {
  if (getUiCapability(hello?.capabilities as Parameters<typeof getUiCapability>[0])) return true;
  // Claude's apps connect under several names ("Anthropic", "Anthropic/ClaudeAI"...), not all of which say so.
  const name = hello?.clientInfo?.name ?? '';
  return /anthropic|claude/i.test(name) && !/claude[-_ ]?code/i.test(name);
}

/** Where the in-chat editor is served from. */
export const SKETCHER_URI = 'ui://hexsketch/sketcher.html';

/** The longest the editor's poll for updates waits for one (well inside any chat's limit on a call). */
const MAX_WAIT = 20_000;
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
    const id = !r.isError && sketches && modelSeesEditor ? await sketches.live(ON_SCREEN_MS) : null;
    if (!id || (!opts.sketchesPerConversation && !opened.has(id))) return r;
    return { ...r, content: [...r.content, { type: 'text', text: `The HexSketch editor is open in this chat (sketch "${id}"): show this there with show_in_sketcher (a structure, highlights, short labels on atoms and a note of a few bullets summing them up) rather than as an image, a picture from the web or a text drawing, and keep your chat reply short.` }] };
  };
  /** A model tool's body: a bad structure becomes a tool error the assistant can read and fix; results point to an open editor. */
  const tool = (fn: () => Promise<CallToolResult>) => safely(fn).then(inEditor);
  const withEditor = !!opts.sketcherHtml && opts.editor !== false;
  const server = new McpServer({ name: 'hexsketch', title: 'HexSketch', version: opts.version, websiteUrl: 'https://hexsketch.com' }, { instructions: withEditor ? INSTRUCTIONS : textInstructions(!!opts.saveFile) });
  /**
   * The tools the model works the editor with, hidden from a chat that can't
   * show it. The editor's page and its own tools stay on every connection: a
   * chat app may load the editor through a connection other than the
   * model's, one that doesn't say it shows MCP Apps (Claude's desktop app does).
   */
  const editorParts: { enabled: boolean }[] = [];
  let modelSeesEditor = withEditor;
  const read = (s?: 'hexsketch' | 'acs') => (s ? { style: s } : {});
  const { forEditor: renderForEditor, forText: renderForText } = renderDescriptions({ rasterize: !!opts.rasterize, saves: !!opts.saveFile });
  const formats: RenderFormat[] = opts.rasterize ? ['png', 'svg', 'pdf', 'cdxml', 'mol'] : ['svg', 'pdf', 'cdxml', 'mol'];

  const renderTool = server.registerTool('render_structure', {
    title: 'Draw a structure',
    description: withEditor ? renderForEditor : renderForText,
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
    // Pictures (and ChemDraw files) show protecting groups abbreviated; a molfile keeps every atom.
    const abbreviate = to !== 'mol';
    const input = await given(a.structure, a.reaction, { ...read(a.style), abbreviate, arrows: curlyArrows(a.arrows), ...(a.disconnect ? { disconnect: a.disconnect } : {}) });
    const r = await render(input, { ...read(a.style), abbreviate, to, ...(opts.rasterize ? { rasterize: opts.rasterize } : {}) });
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
    description: DESCRIPTIONS.name_structure,
    inputSchema: { structure: structure() },
    annotations: { title: 'Name a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => text({ ...(await name(s)), link: await link(s) })));

  server.registerTool('analyze_structure', {
    title: 'Analyze a structure',
    description: DESCRIPTIONS.analyze_structure,
    inputSchema: { structure: structure() },
    annotations: { title: 'Analyze a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => text({ ...(await analyze(s)), link: await link(s) })));

  server.registerTool('validate_structure', {
    title: 'Check a structure',
    description: DESCRIPTIONS.validate_structure,
    inputSchema: { structure: structure() },
    annotations: { title: 'Check a structure', ...READ_ONLY },
  }, ({ structure: s }) => tool(async () => {
    const v = await validate(s);
    return text(v.smiles !== undefined ? { ...v, link: await link(s) } : v);
  }));

  server.registerTool('convert_structure', {
    title: 'Convert a structure',
    description: DESCRIPTIONS.convert_structure,
    inputSchema: { structure: structure(), to: z.enum(['smiles', 'mol', 'cdxml', 'link']).describe('Target format.') },
    annotations: { title: 'Convert a structure', ...READ_ONLY },
  }, ({ structure: s, to }) => tool(async () => ({ content: [{ type: 'text', text: await convert(s, to) }] })));

  server.registerTool('compare_structures', {
    title: 'Compare two structures',
    description: DESCRIPTIONS.compare_structures,
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
      const g = await given(t, r, { abbreviate: true, ...(like ? { like } : {}), ...(curly ? { arrows: curly } : {}), ...(cuts ? { disconnect: cuts } : {}) });
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
    /** Show a sequence of steps (checked first, all of them), opening at the first; returns what to tell the model. */
    const showSteps = async (id: string, steps: Show[], before: Molecule | undefined, current: string): Promise<Record<string, unknown>> => {
      const { updates, report } = await prepareSteps(steps, before, current);
      for (const u of updates) await store.addUpdate(id, u);
      return report;
    };

    editorParts.push(registerAppTool(server, 'open_sketcher', {
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
    })));

    editorParts.push(server.registerTool('read_sketcher', {
      title: 'Read the HexSketch editor',
      description: DESCRIPTIONS.read_sketcher,
      inputSchema: { sketch: sketchId },
      annotations: { title: 'Read the HexSketch editor', ...READ_ONLY },
    }, ({ sketch: id }) => safely(async () => {
      const sketch = await target(id);
      if (!sketch.drawing) return text({ sketch: sketch.id, empty: true, note: 'The canvas is empty.' });
      return text({ sketch: sketch.id, ...(await analyze(sketch.drawing)), link: await link(sketch.drawing), next: 'Show what you say about this drawing in the editor with show_in_sketcher (highlight the parts you mean, explain in the note).' });
    })));

    editorParts.push(server.registerTool('show_in_sketcher', {
      title: 'Show in the HexSketch editor',
      description: DESCRIPTIONS.show_in_sketcher,
      inputSchema: {
        sketch: sketchId,
        ...showFields(),
        steps: stepsField,
      },
      annotations: { title: 'Show in the HexSketch editor', readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    }, (args) => safely(async () => {
      const { sketch: id, steps, ...one } = args as Show & { sketch?: string; steps?: Show[] };
      const sketch = await target(id);
      const before = sketch.drawing ? await readStructure(sketch.drawing, { abbreviate: true }).then((x) => x.mol, () => undefined) : undefined;
      if (steps) {
        if (Object.values(one).some((v) => v !== undefined)) throw new Error('Give steps, or the fields of one step, not both');
        return text({ shown: true, sketch: sketch.id, ...(await showSteps(sketch.id, steps, before, sketch.drawing)) });
      }
      const { update, report } = await prepare(one, before, sketch.drawing);
      await store.addUpdate(sketch.id, update);
      return text({ shown: true, sketch: sketch.id, ...report, next: SHOWN_NEXT });
    })));

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

  // A chat that can't show the editor doesn't list the model's editor tools, and its tool results don't look for one.
  const textOnly = () => {
    modelSeesEditor = false;
    for (const part of editorParts) part.enabled = false;
    renderTool.description = renderForText;
  };
  if (opts.sketcherHtml && opts.editor === false) textOnly();
  else if (opts.sketcherHtml && opts.editor === undefined) {
    // Decided at initialize, before the tools are listed: its result carries the instructions that fit.
    const base = server.server as unknown as { _oninitialize(request: InitializeRequest): Promise<InitializeResult> };
    server.server.setRequestHandler(InitializeRequestSchema, async (request) => {
      const result = await base._oninitialize(request);
      if (canShowEditor(request.params)) return result;
      textOnly();
      return { ...result, instructions: textInstructions(!!opts.saveFile) };
    });
  }
  return server;
}
