/**
 * Checks a running HexSketch connector end to end, as Claude uses it: the
 * model's calls and the editor's through two separate sessions.
 *
 *   node --experimental-strip-types apps/mcp-worker/test/smoke.ts [url]
 *
 * The url defaults to the local dev server (npm run dev:mcp); after a deploy,
 * pass https://mcp.hexsketch.com/mcp. Exits 1 on the first failure.
 */
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8787/mcp');
const connect = async (name: string) => {
  const client = new Client({ name, version: '1' });
  const transport = new StreamableHTTPClientTransport(url);
  await client.connect(transport);
  return { client, session: transport.sessionId, call: async (tool: string, args: Record<string, unknown>) => (await client.callTool({ name: tool, arguments: args })) as CallToolResult };
};
const text = (r: CallToolResult, i = 0) => (r.content[i] as { text: string }).text;
const step = async (what: string, fn: () => Promise<void>) => {
  const t = Date.now();
  try { await fn(); console.log(`ok   ${what} (${Date.now() - t} ms)`); } catch (err) { console.log(`FAIL ${what}\n     ${(err as Error).message}`); process.exit(1); }
};

const model = await connect('smoke-model');
const editor = await connect('smoke-editor');
let sketch = '';

await step('initialize gives each connection its own session', async () => {
  assert.ok(model.session && editor.session && model.session !== editor.session);
  assert.equal(model.client.getServerVersion()?.name, 'hexsketch');
});
await step('the tools and the editor are listed', async () => {
  const names = (await model.client.listTools()).tools.map((t) => t.name);
  for (const n of ['render_structure', 'analyze_structure', 'open_sketcher', 'read_sketcher', 'show_in_sketcher']) assert.ok(names.includes(n), n);
  const html = await model.client.readResource({ uri: 'ui://hexsketch/sketcher.html' });
  assert.ok(((html.contents[0] as { text?: string }).text ?? '').length > 100_000);
});
await step('analyze names aspirin', async () => {
  assert.equal(JSON.parse(text(await model.call('analyze_structure', { structure: 'CC(=O)Oc1ccccc1C(=O)O' }))).name, '2-acetoxybenzoic acid');
});
await step('render_structure draws a PNG', async () => {
  const r = await model.call('render_structure', { structure: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O' });
  const img = r.content.find((c) => c.type === 'image') as { data: string } | undefined;
  assert.ok(img && Buffer.from(img.data, 'base64').subarray(1, 4).toString() === 'PNG');
});
await step('open_sketcher opens an editor', async () => {
  const r = await model.call('open_sketcher', { structure: 'CC(C)Cc1ccc(cc1)C(C)C(=O)O' });
  sketch = (r.structuredContent as { sketch: string }).sketch;
  assert.match(sketch, /^[0-9a-f-]{36}$/);
});
await step('a reaction shown by the model reaches the editor, through another session', async () => {
  await model.call('show_in_sketcher', { reaction: { stages: ['CC(C)Cc1ccc(cc1)C(C)C(=O)O', 'CC(C)Cc1ccc(cc1)C(C)C(=O)OC'], arrows: [{ reagents: 'MeOH, H2SO4 (cat.)', conditions: 'reflux' }] }, note: 'Esterification' });
  const got = (await editor.call('sketch_updates', { sketch, since: 0 })).structuredContent as { live: boolean; updates: { note?: string; structure?: string }[] };
  assert.equal(got.live, true);
  assert.equal(got.updates[0]?.note, 'Esterification');
  assert.match(got.updates[0]?.structure ?? '', /<arrow/);
  const again = (await editor.call('sketch_updates', { sketch, since: 1 })).structuredContent as { live: boolean; updates: unknown[] };
  assert.deepEqual(again, { live: true, updates: [] }); // only what it hasn't had
});
await step('while the editor polls, results point the model to it', async () => {
  const r = await model.call('analyze_structure', { structure: 'CCO' });
  assert.ok(r.content.some((c) => c.type === 'text' && /HexSketch editor is open/.test(c.text)));
});
await step('the user\'s drawing, reported by the editor, is what read_sketcher sees', async () => {
  const { convert } = await import('@hexsketch/agent');
  await editor.call('sketch_sync', { sketch, cdxml: await convert('c1ccccc1O', 'cdxml') });
  assert.equal(JSON.parse(text(await model.call('read_sketcher', {}))).name, 'phenol');
});
await step('another conversation does not see this editor', async () => {
  const other = await connect('smoke-other');
  assert.equal((await other.call('read_sketcher', {})).isError, true);
  assert.equal(JSON.parse(text(await other.call('read_sketcher', { sketch }))).name, 'phenol');
});
console.log('All good.');
