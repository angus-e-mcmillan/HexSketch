/**
 * The hosted HexSketch: static files, plus one endpoint, POST /api/feedback,
 * which stores what people write in File > Send Feedback in Workers KV
 * (namespace "hexsketch-feedback"). Only /api/* reaches this script; every
 * other request is served straight from the static assets.
 *
 * Read the feedback with `npm run feedback`, or in the Cloudflare dashboard
 * under Storage & Databases > KV > hexsketch-feedback.
 */

interface KV { put(key: string, value: string): Promise<void> }
interface RateLimit { limit(o: { key: string }): Promise<{ success: boolean }> }
interface Env {
  ASSETS: { fetch(req: Request): Promise<Response> };
  FEEDBACK: KV;
  FEEDBACK_LIMIT?: RateLimit;
}

const MAX_MESSAGE = 5000;
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

async function feedback(req: Request, env: Env): Promise<Response> {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  // Only the HexSketch page itself may post (browsers always send Origin on a POST).
  const origin = req.headers.get('Origin');
  let sameOrigin = false;
  try { sameOrigin = !!origin && new URL(origin).host === new URL(req.url).host; } catch { /* "null" or malformed */ }
  if (!sameOrigin) return json({ error: 'forbidden' }, 403);
  // A few messages a minute per visitor is plenty; the address is used for this count only, never stored.
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  if (env.FEEDBACK_LIMIT && !(await env.FEEDBACK_LIMIT.limit({ key: ip })).success) return json({ error: 'too many messages, try again in a minute' }, 429);
  const raw = await req.text();
  if (raw.length > 20_000) return json({ error: 'too long' }, 413);
  let body: { message?: unknown; email?: unknown; website?: unknown; context?: unknown };
  try { body = JSON.parse(raw) as typeof body; } catch { return json({ error: 'bad request' }, 400); }
  // "website" is a field people never see: only bots fill it in.
  if (body.website) return json({ ok: true });
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, MAX_MESSAGE) : '';
  if (!message) return json({ error: 'empty message' }, 400);
  const email = typeof body.email === 'string' && /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(body.email.trim()) ? body.email.trim() : null;
  const context = typeof body.context === 'string' ? body.context.slice(0, 500) : null;
  const at = new Date().toISOString();
  await env.FEEDBACK.put(`feedback:${at}:${crypto.randomUUID().slice(0, 8)}`, JSON.stringify({ at, message, email, context }));
  return json({ ok: true });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/api/feedback') return feedback(req, env);
    if (pathname.startsWith('/api/')) return json({ error: 'not found' }, 404);
    return env.ASSETS.fetch(req);
  },
};
