/**
 * OpenRouter (openrouter.ai), which hexsketch.com's chat talks to straight
 * from the browser: one account gives the user Claude, GPT, Gemini and open
 * models alike, paid for with their own credit. HexSketch has no server in
 * between, and the key stays in this browser.
 *
 * Signing in is OpenRouter's OAuth PKCE: a popup to openrouter.ai, which
 * comes back to hexsketch.com/?code=…; that page (the popup) swaps the code
 * for a key, keeps it, tells the editor's page and closes. A popup rather
 * than leaving the page, so the drawing is still there afterwards.
 */

const API = 'https://openrouter.ai/api/v1';
const KEY = 'hexsketch.openrouter.key';
const VERIFIER = 'hexsketch.openrouter.verifier';
const CHANNEL = 'hexsketch.openrouter';

const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: for this page only */ } };

export const apiKey = () => get(KEY);
export const setApiKey = (key: string | null) => { set(KEY, key?.trim() || null); new BroadcastChannel(CHANNEL).postMessage('key'); };

/** Called whenever the key changes, in this page or another (the sign-in popup). */
export function onKeyChange(fn: () => void): void {
  new BroadcastChannel(CHANNEL).addEventListener('message', fn);
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/** Open OpenRouter's sign-in in a popup; false if the browser blocked it. */
export async function signIn(): Promise<boolean> {
  // Opened before any await, while the click still counts, or browsers block it.
  const popup = window.open('about:blank', 'openrouter-sign-in', 'popup,width=520,height=720');
  if (!popup) return false;
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  set(VERIFIER, verifier);
  const back = `${location.origin}/`;
  popup.location.href = `https://openrouter.ai/auth?callback_url=${encodeURIComponent(back)}&code_challenge=${challenge}&code_challenge_method=S256`;
  return true;
}

/** Whether this page is OpenRouter coming back from sign-in (hexsketch.com/?code=… with a sign-in under way). */
export const isSignInReturn = () => new URLSearchParams(location.search).has('code') && get(VERIFIER) !== null;

/** On the page OpenRouter came back to: swap the code for a key, keep it and close. */
export async function finishSignIn(): Promise<string> {
  const code = new URLSearchParams(location.search).get('code') ?? '';
  const verifier = get(VERIFIER);
  set(VERIFIER, null);
  history.replaceState(null, '', location.pathname);
  const r = await fetch(`${API}/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
  });
  if (!r.ok) throw new Error(`OpenRouter did not sign you in (${r.status})`);
  const { key } = await r.json() as { key?: string };
  if (!key) throw new Error('OpenRouter sent no key');
  setApiKey(key);
  return key;
}

export interface Model { id: string; name: string; created: number; free: boolean }

/** The models that can use tools, which HexSketch's chat needs (OpenRouter's list is public). */
export async function toolModels(): Promise<Model[]> {
  const r = await fetch(`${API}/models`);
  if (!r.ok) throw new Error(`OpenRouter's model list did not load (${r.status})`);
  const { data } = await r.json() as { data: { id: string; name: string; created?: number; supported_parameters?: string[]; pricing?: { prompt?: string; completion?: string } }[] };
  return data
    .filter((m) => m.supported_parameters?.includes('tools'))
    .map((m) => ({ id: m.id, name: m.name, created: m.created ?? 0, free: Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A few to start from: the newest of each family that does well with HexSketch's tools. */
export function suggested(models: Model[]): Model[] {
  const families = [/^anthropic\/claude-sonnet/, /^anthropic\/claude-opus/, /^openai\/gpt-(?!.*(mini|nano|oss))/, /^google\/gemini-.*pro/, /^qwen\/qwen/, /^deepseek\//, /^openai\/gpt-oss/];
  const out: Model[] = [];
  for (const f of families) {
    const newest = models.filter((m) => f.test(m.id) && !m.free).sort((a, b) => b.created - a.created)[0];
    if (newest && !out.includes(newest)) out.push(newest);
  }
  return out;
}

export interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/** Why a request failed, in words for the user; `signOut` when the key no longer works. */
export class OpenRouterError extends Error {
  readonly signOut: boolean;
  constructor(message: string, signOut = false) { super(message); this.signOut = signOut; }
}

/**
 * What goes to the model, with Claude's prompt cache marked: the tools and
 * instructions (most of every request, the same each time) and the
 * conversation up to the latest message are kept for the next request, so
 * each round of tool calls is quicker and cheaper. Other providers cache on
 * their own; Claude only where asked.
 */
function cached(model: string, messages: Message[]): unknown[] {
  if (!model.startsWith('anthropic/')) return messages;
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  return messages.map((m, i) => (m.role === 'system' || i === lastUser) && typeof m.content === 'string'
    ? { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
    : m);
}

/**
 * The most a turn may write. Claude's thinking budget is a share of it (at
 * low effort about a fifth), so it stays small for Claude: about 1,000 tokens
 * of thinking, the least Claude takes. Other models set their own thinking by
 * the effort, and a thinking model needs room for it and then the answer: at
 * 4,096, a free Nemotron was cut off mid-thought on 21 of 24 benchmark
 * questions.
 */
export const maxTokensFor = (model: string): number => (model.startsWith('anthropic/') ? 4096 : 16384);

/**
 * One turn of the model: its reply, which may ask for tools. Streamed, so
 * `onText` sees the reply as it is written rather than all at once at the end.
 */
export async function complete(
  model: string, messages: Message[], tools: { name: string; description: string; parameters: unknown }[],
  opts: { signal?: AbortSignal; onText?: (soFar: string) => void; onCost?: (usd: number) => void } = {},
): Promise<Extract<Message, { role: 'assistant' }>> {
  const key = apiKey();
  if (!key) throw new OpenRouterError('Sign in to OpenRouter first', true);
  const r = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://hexsketch.com', 'X-Title': 'HexSketch' },
    body: JSON.stringify({
      model, messages: cached(model, messages), tools: tools.map((t) => ({ type: 'function', function: t })), stream: true,
      // Drawing a structure needs little thought: unchecked, Opus thought 6,000 tokens a step, a minute or two and most of the cost.
      reasoning: { effort: 'low' }, max_tokens: maxTokensFor(model),
      // What each turn cost, sent with the last chunk, for the chat to show.
      usage: { include: true },
    }),
  });
  if (!r.ok || !r.body) {
    let why = '';
    try { why = ((await r.json()) as { error?: { message?: string } }).error?.message ?? ''; } catch { /* not JSON */ }
    if (r.status === 401) throw new OpenRouterError('OpenRouter no longer accepts this sign-in: sign in again', true);
    if (r.status === 402) throw new OpenRouterError('Your OpenRouter credit has run out: add some at openrouter.ai/settings/credits');
    if (r.status === 429) throw new OpenRouterError('Too many requests just now: wait a moment and try again');
    throw new OpenRouterError(`OpenRouter: ${why || r.statusText || r.status}`);
  }
  // Server-sent events: "data: {chunk}" lines, ": comment" lines while OpenRouter waits, "data: [DONE]" at the end.
  let text = '', finish = '';
  const calls: ToolCall[] = [];
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    pending += value;
    const lines = pending.split('\n');
    pending = lines.pop()!;
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;
      let chunk: { choices?: { finish_reason?: string | null; delta?: { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] } }[]; error?: { message?: string }; usage?: { cost?: number; prompt_tokens?: number; completion_tokens?: number } };
      try { chunk = JSON.parse(data); } catch { continue; }
      if (chunk.error) throw new OpenRouterError(`OpenRouter: ${chunk.error.message ?? 'the model stopped'}`);
      if (typeof chunk.usage?.cost === 'number') opts.onCost?.(chunk.usage.cost);
      finish = chunk.choices?.[0]?.finish_reason ?? finish;
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.content) { text += delta.content; opts.onText?.(text); }
      // A tool call arrives in pieces: its id and name first, then its arguments a few characters at a time.
      for (const d of delta?.tool_calls ?? []) {
        const call = calls[d.index] ??= { id: '', type: 'function', function: { name: '', arguments: '' } };
        if (d.id) call.id = d.id;
        if (d.function?.name) call.function.name += d.function.name;
        if (d.function?.arguments) call.function.arguments += d.function.arguments;
      }
    }
  }
  const toolCalls = calls.filter(Boolean);
  if (!text && !toolCalls.length && finish === 'length') throw new OpenRouterError('The model thought for as long as it may and wrote no answer: ask again, or choose another model');
  if (!text && !toolCalls.length) throw new OpenRouterError('OpenRouter: the model sent an empty reply');
  return { role: 'assistant', content: text || null, ...(toolCalls.length ? { tool_calls: toolCalls } : {}) };
}
