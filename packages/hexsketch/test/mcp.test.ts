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
