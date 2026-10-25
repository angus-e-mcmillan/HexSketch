import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createServer } from '../../../packages/hexsketch/src/mcp.ts';
import pkg from '../../../packages/hexsketch/package.json';
import sketcherHtml from '../../mcp-app/dist/index.html';
import { rasterize } from './png.ts';
import { hostedSketchStore, type SketchEnv } from './sketches.ts';

export { Conversation, Sketch } from './sketches.ts';

/**
 * HexSketch as a remote MCP server, for Claude's connectors: POST /mcp,
 * streamable HTTP, answered as plain JSON. Each request gets a new server
 * (stateless); open editors live in Durable Objects (sketches.ts). The
 * session id handed out at initialize names the conversation, so "the
 * editor opened last" means this conversation's. No accounts, nothing kept
 * beyond open editors (deleted a day after last use), and no logging of
 * what is drawn.
 */

interface RateLimit { limit(o: { key: string }): Promise<{ success: boolean }> }
interface Env extends SketchEnv { LIMIT?: RateLimit; NEW_LIMIT?: RateLimit }

const MAX_BODY = 2_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};
const plain = (text: string, status = 200, headers: Record<string, string> = {}) =>
  new Response(text, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...CORS, ...headers } });
const rpcError = (status: number, message: string) =>
  Response.json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }, { status, headers: CORS });

const ABOUT = `HexSketch MCP server (${pkg.version})

Draw, name and check chemical structures in Claude, with the HexSketch
editor inside the chat. To add it: Claude > Settings > Connectors > Add
custom connector, with this address:

  https://mcp.hexsketch.com/mcp

More: https://hexsketch.com · Privacy: https://hexsketch.com/privacy
`;

async function mcp(req: Request, env: Env): Promise<Response> {
  if (Number(req.headers.get('Content-Length') ?? 0) > MAX_BODY) return rpcError(413, 'Request too large');
  const body = await req.text();
  if (body.length > MAX_BODY) return rpcError(413, 'Request too large');
  let message: unknown;
  try { message = JSON.parse(body); } catch { return rpcError(400, 'Parse error: the body is not JSON'); }
  const messages = Array.isArray(message) ? message : [message];
  const initializing = messages.some((m) => (m as { method?: unknown } | null)?.method === 'initialize');
  // The conversation: a new one at initialize, then whatever the client sends back.
  const given = req.headers.get('Mcp-Session-Id');
  const conversation = initializing ? crypto.randomUUID() : given && UUID.test(given) ? given : null;
  // New conversations per address (Claude's traffic arrives from a few shared addresses, so this is generous);
  // then requests per conversation, or per address for clients that keep no session.
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (initializing && env.NEW_LIMIT && !(await env.NEW_LIMIT.limit({ key: ip })).success) return rpcError(429, 'Too many new connections: try again in a minute');
  if (env.LIMIT && !(await env.LIMIT.limit({ key: conversation ?? `no-session:${ip}` })).success) return rpcError(429, 'Too many requests: try again in a minute');

  const server = createServer({
    version: pkg.version,
    rasterize,
    sketcherHtml: async () => sketcherHtml,
    sketches: hostedSketchStore(env, conversation),
    sketchesPerConversation: !!conversation,
    maxDrawing: 1_000_000,
  });
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  const res = await transport.handleRequest(new Request(req.url, { method: 'POST', headers: req.headers, body }), { parsedBody: message });
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  if (conversation) headers.set('Mcp-Session-Id', conversation);
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (pathname === '/' || pathname === '/mcp' && req.method === 'GET' && !req.headers.get('Accept')?.includes('text/event-stream')) return plain(ABOUT);
    if (pathname !== '/mcp') return plain('Not found\n', 404);
    if (req.method === 'POST') return mcp(req, env);
    // No server-sent stream (every answer is plain JSON), and sessions need no closing.
    if (req.method === 'DELETE') return new Response(null, { status: 204, headers: CORS });
    return plain('Method not allowed\n', 405, { Allow: 'POST, DELETE, OPTIONS' });
  },
};
