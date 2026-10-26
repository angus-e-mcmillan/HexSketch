import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { payloadFromPng } from '@hexsketch/core';
import { createServer, SKETCHER_URI, type ServerOptions } from '../src/mcp.ts';
import { rasterize } from '../src/png.ts';

const dir = mkdtempSync(join(tmpdir(), 'hexsketch-mcp-'));

async function connect(opts: Partial<ServerOptions> = {}) {
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer({ version: '0.0.0-test', rasterize, ...opts }).connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as CallToolResult;
  return { client, call };
}
const textOf = (r: CallToolResult, i = 0) => (r.content[i] as { text: string }).text;

test('lists the tools, with instructions for the model', async () => {
  const { client } = await connect();
  const names = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(names, ['analyze_structure', 'compare_structures', 'convert_structure', 'name_structure', 'render_structure', 'structure_link', 'validate_structure']);
  assert.match(client.getInstructions() ?? '', /validate_structure/);
  assert.match(client.getInstructions() ?? '', /always give the user that link/);
  const tools = (await client.listTools()).tools;
  assert.ok(tools.filter((t) => t.name !== 'render_structure').every((t) => t.annotations?.readOnlyHint === true));
});

test('render_structure returns a PNG that stays editable, with name and link', async () => {
  const { call } = await connect();
  const r = await call('render_structure', { structure: 'N[C@@H](Cc1ccccc1)C(=O)O' });
  assert.equal(r.isError, undefined);
  const img = r.content[0] as { type: string; data: string; mimeType: string };
  assert.equal(img.type, 'image');
  assert.equal(img.mimeType, 'image/png');
  assert.match(payloadFromPng(new Uint8Array(Buffer.from(img.data, 'base64'))) ?? '', /HexSketch:1:/);
  const info = JSON.parse(textOf(r, 1));
  assert.equal(info.name, 'L-phenylalanine');
  assert.equal(info.smiles, 'N[C@@H](CC1=CC=CC=C1)C(=O)O');
  assert.match(info.link, /^https:\/\/hexsketch\.com\/#smiles=/);
});

test('render_structure offers SVG only without a rasterizer, and saves only when allowed', async () => {
  const bare = await connect({ rasterize: undefined });
  const svg = await bare.call('render_structure', { structure: 'CCO' });
  assert.match(textOf(svg), /^<svg/);
  const schema = (await bare.client.listTools()).tools.find((t) => t.name === 'render_structure')!.inputSchema as { properties: Record<string, { enum?: string[] }> };
  assert.equal(schema.properties.save_to, undefined);
  assert.ok(!schema.properties.format!.enum!.includes('png'));
  assert.equal((await bare.call('render_structure', { structure: 'CCO', format: 'pdf' })).isError, true);
});

test('save_to writes the file by its extension and never replaces one unasked', async () => {
  const saved: string[] = [];
  const { call } = await connect({
    saveFile: async (path, data, overwrite) => {
      if (existsSync(path) && !overwrite) throw new Error(`${path} already exists`);
      const { writeFileSync } = await import('node:fs');
      writeFileSync(path, data);
      saved.push(path);
      return path;
    },
  });
  const pdf = join(dir, 'aspirin.pdf');
  const r = await call('render_structure', { structure: 'CC(=O)Oc1ccccc1C(=O)O', save_to: pdf });
  assert.equal(JSON.parse(textOf(r)).saved, pdf);
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await call('render_structure', { structure: 'CCO', save_to: pdf })).isError, true);
  assert.equal((await call('render_structure', { structure: 'CCO', save_to: pdf, overwrite: true })).isError, undefined);
  assert.equal((await call('render_structure', { structure: 'CCO', save_to: join(dir, 'x.gif') })).isError, true);
  assert.deepEqual(saved, [pdf, pdf]);
});

test('name, analyze, convert, compare and link', async () => {
  const { call } = await connect();
  assert.equal(JSON.parse(textOf(await call('name_structure', { structure: 'C[C@H](N)C(=O)O' }))).name, '(S)-2-aminopropanoic acid');
  const a = JSON.parse(textOf(await call('analyze_structure', { structure: 'CC(=O)[O-].[Na+]' })));
  assert.equal(a.name, 'sodium acetate');
  assert.equal(a.structures.length, 2);
  assert.match(a.link, /^https:\/\/hexsketch\.com\/#smiles=/);
  assert.match(textOf(await call('convert_structure', { structure: 'CCO', to: 'mol' })), /V2000/);
  assert.equal(JSON.parse(textOf(await call('compare_structures', { a: 'C[C@H](N)C(=O)O', b: 'C[C@@H](N)C(=O)O' }))).same, false);
  assert.equal(textOf(await call('structure_link', { structure: 'CC#N' })), 'https://hexsketch.com/#smiles=CC%23N');
});

test('bad structures come back as tool errors the model can read', async () => {
  const { call } = await connect();
  const named = await call('name_structure', { structure: 'aspirin' });
  assert.equal(named.isError, true);
  assert.match(textOf(named), /looks like a name/);
  const v = JSON.parse(textOf(await call('validate_structure', { structure: 'C(C)(C)(C)(C)C' })));
  assert.equal(v.ok, false);
  assert.match(v.issues[0].message, /valence 5/);
  const unreadable = JSON.parse(textOf(await call('validate_structure', { structure: 'C1CC' })));
  assert.deepEqual([unreadable.ok, unreadable.link], [false, undefined]);
});

test('hexsketch mcp serves over stdio', async () => {
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['--experimental-strip-types', '--no-warnings', cli, 'mcp'] }));
  try {
    assert.equal(client.getServerVersion()?.name, 'hexsketch');
    const r = (await client.callTool({ name: 'name_structure', arguments: { structure: 'c1ccccc1O' } })) as CallToolResult;
    assert.equal(JSON.parse(textOf(r)).name, 'phenol');
  } finally {
    await client.close();
  }
});

test('open_sketcher appears with the editor, linked to its ui:// resource', async () => {
  const { client } = await connect();
  assert.equal((await client.listTools()).tools.some((t) => t.name === 'open_sketcher'), false);

  const html = '<!doctype html><title>editor</title>';
  const app = await connect({ sketcherHtml: async () => html });
  const tool = (await app.client.listTools()).tools.find((t) => t.name === 'open_sketcher')!;
  assert.equal((tool._meta as { ui: { resourceUri: string } }).ui.resourceUri, SKETCHER_URI);
  assert.equal((tool._meta as Record<string, string>)['ui/resourceUri'], SKETCHER_URI);
  const resource = (await app.client.readResource({ uri: SKETCHER_URI })).contents[0] as { mimeType: string; text: string };
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.equal(resource.text, html);
  assert.match(app.client.getInstructions() ?? '', /open_sketcher/);
});

test('open_sketcher answers with the structure and a link, for chats that cannot show the editor', async () => {
  const { call } = await connect({ sketcherHtml: async () => '<!doctype html>' });
  const result = await call('open_sketcher', { structure: 'CC(=O)Nc1ccc(O)cc1' });
  // The editor can also load the structure from the result, for chats that send only that.
  assert.equal((result.structuredContent as { structure: string }).structure, 'CC(=O)Nc1ccc(O)cc1');
  const r = JSON.parse(textOf(result));
  assert.equal(r.opened, 'N-(4-hydroxyphenyl)acetamide');
  assert.match(r.link, /^https:\/\/hexsketch\.com\/#smiles=/);
  assert.match(textOf(await call('open_sketcher', {})), /empty canvas/);
  assert.equal((await call('open_sketcher', { structure: 'aspirin' })).isError, true);
});

test('the built package serves the real editor', { skip: !existsSync(fileURLToPath(new URL('../dist/sketcher.html', import.meta.url))) && 'run npm run build:pkg first' }, () => {
  const html = readFileSync(fileURLToPath(new URL('../dist/sketcher.html', import.meta.url)), 'utf8');
  assert.match(html, /^<!doctype html>/i);
  // Self-contained: chats load nothing from elsewhere.
  assert.doesNotMatch(html, /<script[^>]*\ssrc=|<link[^>]*stylesheet/);
  assert.match(html, /Business Source License 1\.1/);
  assert.match(html, /@modelcontextprotocol\/ext-apps \d/);
});

test('the AI works in the open editor: show, read, and the editor fetches and reports', async () => {
  const { client, call } = await connect({ sketcherHtml: async () => '<!doctype html>' });
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.ok(['read_sketcher', 'show_in_sketcher', 'sketch_updates', 'sketch_sync'].every((n) => names.includes(n)));
  const appOnly = (await client.listTools()).tools.filter((t) => (t._meta as { ui?: { visibility?: string[] } } | undefined)?.ui?.visibility?.join() === 'app').map((t) => t.name).sort();
  assert.deepEqual(appOnly, ['sketch_sync', 'sketch_updates']);

  assert.equal((await call('show_in_sketcher', { note: 'hi' })).isError, true); // nothing open yet
  const opened = await call('open_sketcher', { structure: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O' });
  const id = (opened.structuredContent as { sketch: string }).sketch;
  // Chats pass the model either the text or the structuredContent: both say to keep working in the editor.
  assert.match((opened.structuredContent as { next: string }).next, /show_in_sketcher.*read_sketcher/s);
  assert.match(textOf(opened), /show_in_sketcher/);
  assert.match(id, /^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(textOf(await call('read_sketcher', {}))).name, '2-(4-isobutylphenyl)propanoic acid');

  const shown = JSON.parse(textOf(await call('show_in_sketcher', { highlight: ['C(=O)O', 'CC(C)C', 'N'], note: 'Yellow: the acid.' })));
  assert.deepEqual(shown.highlights.map((h: { colour: string; places: number }) => [h.colour, h.places]), [['yellow', 1], ['blue', 1], ['orange', 0]]);
  assert.match(shown.warning, /Not found in the drawing: N/);

  const fetch = async (since: number) => (await call('sketch_updates', { sketch: id, since })).structuredContent as { live: boolean; updates: { version: number; note?: string; highlights?: { smiles: string; color: string }[] }[] };
  const first = await fetch(0);
  assert.equal(first.live, true);
  assert.equal(first.updates.length, 1);
  assert.equal(first.updates[0]!.note, 'Yellow: the acid.');
  assert.equal(first.updates[0]!.highlights![0]!.color, '#ffe066');
  assert.deepEqual((await fetch(1)).updates, []);

  // Labels take the colour of the highlight with the same fragment, or the one named; a missing fragment is reported.
  const labelled = JSON.parse(textOf(await call('show_in_sketcher', {
    highlight: ['C(=O)O'],
    labels: [{ at: 'C(=O)O', text: 'pKa ≈ 4.4' }, { at: 'CC(C)C', text: 'lipophilic', colour: 'green' }, { at: 'N', text: 'amine' }],
  })));
  assert.deepEqual(labelled.labels.map((l: { places: number }) => l.places), [1, 1, 0]);
  assert.match(labelled.warning, /Not found in the drawing: N/);
  const pinned = (await fetch(1)).updates[0] as { labels?: { at: string; color?: string }[] };
  assert.deepEqual(pinned.labels!.map((l) => [l.at, l.color]), [['C(=O)O', '#8a6d00'], ['CC(C)C', '#2f7a34'], ['N', undefined]]);

  // The user's drawing, reported by the editor, is what read_sketcher sees.
  const { convert } = await import('@hexsketch/agent');
  await call('sketch_sync', { sketch: id, cdxml: await convert('CC(C)Cc1ccc(cc1)C(C)C(=O)OC', 'cdxml') });
  assert.equal(JSON.parse(textOf(await call('read_sketcher', {}))).name, 'methyl 2-(4-isobutylphenyl)propanoate');

  // A new structure from the AI replaces the drawing; a newer editor makes this one stale.
  await call('show_in_sketcher', { structure: 'c1ccccc1O' });
  assert.equal((await fetch(2)).updates[0]!.version, 3);
  assert.equal(JSON.parse(textOf(await call('read_sketcher', {}))).name, 'phenol');
  // Another editor: the model's calls without an id now mean it, and the first stays reachable by its id.
  await call('open_sketcher', {});
  assert.equal((await fetch(0)).live, true);
  assert.equal(JSON.parse(textOf(await call('read_sketcher', {}))).empty, true);
  assert.equal(JSON.parse(textOf(await call('read_sketcher', { sketch: id }))).name, 'phenol');
});

test('the AI and the editor may reach HexSketch through different connections', async () => {
  // Claude Desktop can route the editor's calls through another connection (or process) than the model's.
  const { createSketchStore } = await import('../src/sketches.ts');
  const { mkdtempSync } = await import('node:fs');
  const shared = createSketchStore(mkdtempSync(join(tmpdir(), 'hexsketch-sketches-')));
  const html = async () => '<!doctype html>';
  const model = await connect({ sketcherHtml: html, sketches: shared });
  const editor = await connect({ sketcherHtml: html, sketches: createSketchStore(shared.dir) }); // another process, same folder
  const id = ((await model.call('open_sketcher', { structure: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O' })).structuredContent as { sketch: string }).sketch;
  await model.call('show_in_sketcher', { sketch: id, highlight: ['C(=O)O'], note: 'Yellow: the acid.' });
  const got = (await editor.call('sketch_updates', { sketch: id, since: 0 })).structuredContent as { live: boolean; updates: { note?: string }[] };
  assert.equal(got.live, true);
  assert.equal(got.updates[0]?.note, 'Yellow: the acid.');
  // And the editor's report of the drawing reaches the model's read_sketcher.
  const { convert } = await import('@hexsketch/agent');
  await editor.call('sketch_sync', { sketch: id, cdxml: await convert('c1ccccc1O', 'cdxml') });
  assert.equal(JSON.parse(textOf(await model.call('read_sketcher', { sketch: id }))).name, 'phenol');
  // Without an id, the model works on the editor opened last.
  assert.equal(JSON.parse(textOf(await model.call('read_sketcher', {}))).name, 'phenol');
  assert.equal(((await editor.call('sketch_updates', { sketch: 'no-such-sketch', since: 0 })).structuredContent as { live: boolean }).live, false);
});

test('while an editor is on screen, every tool result points the model to it', async () => {
  const { createSketchStore } = await import('../src/sketches.ts');
  const { mkdtempSync } = await import('node:fs');
  const shared = createSketchStore(mkdtempSync(join(tmpdir(), 'hexsketch-sketches-')));
  const html = async () => '<!doctype html>';
  const model = await connect({ sketcherHtml: html, sketches: shared });
  const editor = await connect({ sketcherHtml: html, sketches: createSketchStore(shared.dir) });
  const reminds = (r: CallToolResult) => r.content.some((c) => c.type === 'text' && /HexSketch editor is open in this chat/.test(c.text));
  const id = ((await model.call('open_sketcher', { structure: 'CCO' })).structuredContent as { sketch: string }).sketch;
  assert.equal(reminds(await model.call('analyze_structure', { structure: 'CCO' })), false); // opened, but not (yet) on screen
  await editor.call('sketch_updates', { sketch: id, since: 0 }); // the editor polls: it is on screen
  for (const [name, args] of [['analyze_structure', { structure: 'CCO' }], ['render_structure', { structure: 'CCO' }], ['structure_link', { structure: 'CCO' }]] as const) {
    const r = await model.call(name, args);
    assert.ok(reminds(r), name);
    assert.match(r.content.map((c) => (c.type === 'text' ? c.text : '')).join(' '), new RegExp(id));
  }
  assert.equal(reminds(await model.call('name_structure', { structure: 'C1CC' })), false); // errors stay plain
  assert.match(JSON.parse(textOf(await model.call('show_in_sketcher', { note: 'hi' }))).next, /chat reply/);
  assert.match(JSON.parse(textOf(await model.call('read_sketcher', {}))).next, /show_in_sketcher/);
  // An editor another server opened (another chat or app) is not this model's.
  const other = await connect({ sketcherHtml: html, sketches: createSketchStore(shared.dir) });
  assert.equal(reminds(await other.call('analyze_structure', { structure: 'CCO' })), false);
  // Without an editor, results are as before.
  const plain = await connect();
  assert.equal(reminds(await plain.call('analyze_structure', { structure: 'CCO' })), false);
});

test('reactions are drawn as schemes: arrows with reagents above and conditions below', async () => {
  const { call } = await connect({ sketcherHtml: async () => '<!doctype html>' });
  const reaction = { stages: ['CC(C)Cc1ccc(cc1)C(C)C(=O)O.CO', 'CC(C)Cc1ccc(cc1)C(C)C(=O)OC.O'], arrows: [{ reagents: 'H2SO4 (cat.)', conditions: 'reflux, 4 h' }] };
  const drawn = await call('render_structure', { reaction, format: 'svg' });
  assert.match(textOf(drawn), />SO<\/text>.*>reflux, 4 h</);
  assert.equal((await call('render_structure', { structure: 'CCO', reaction })).isError, true);
  const id = ((await call('open_sketcher', { structure: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O' })).structuredContent as { sketch: string }).sketch;
  await call('show_in_sketcher', { reaction, note: 'Fischer esterification' });
  const { updates } = (await call('sketch_updates', { sketch: id, since: 0 })).structuredContent as { updates: { structure?: string }[] };
  const { readStructure } = await import('@hexsketch/agent');
  const got = await readStructure(updates[0]!.structure!);
  assert.equal(got.objects.filter((o) => o.kind === 'arrow').length, 1);
  assert.deepEqual(got.objects.filter((o) => o.kind === 'text').map((o) => o.text), ['+', 'H2SO4 (cat.)', 'reflux, 4 h', '+']);
  assert.ok(JSON.parse(textOf(await call('read_sketcher', {}))).structures.some((x: { name: string }) => x.name === 'methyl 2-(4-isobutylphenyl)propanoate'));
});
