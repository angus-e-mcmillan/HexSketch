/**
 * The benchmark: each question put to a model without HexSketch (SMILES in
 * text, no tools) and with it (as on hexsketch.com: HexSketch's prompt, its
 * tools and the chemist's drawing), through OpenRouter. Every answer is
 * measured (measure.ts); results/ gets the summary (committed), out/ every
 * transcript and a page to read the answers beside their drawings.
 *
 *   npm run llm-bench -- --model anthropic/claude-opus-5 --provider anthropic
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CONDITIONS, opening, runTool, type Condition } from './conditions.ts';
import { measure, opsin, finalAnswer, refusalOf, REFUSAL_ERROR, type Measures } from './measure.ts';
import { countBy, loadQuestions, QUESTIONS_FILE, TYPES, type Question } from './questions.ts';
import { writeReport } from './report.ts';

const here = new URL('.', import.meta.url);
/** OpenRouter's API (LLM_BENCH_API points it elsewhere, for the runner's own test). */
const API = process.env.LLM_BENCH_API ?? 'https://openrouter.ai/api/v1';

const { values: opt } = parseArgs({
  options: {
    model: { type: 'string' },
    provider: { type: 'string' },
    conditions: { type: 'string', default: CONDITIONS.join(',') },
    repeats: { type: 'string', default: '3' },
    types: { type: 'string' },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'max-tokens': { type: 'string', default: '32000' },
    effort: { type: 'string', default: 'medium' },
    'max-rounds': { type: 'string', default: '12' },
    timeout: { type: 'string', default: '600' },
    run: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'list-models': { type: 'string' },
  },
});

function apiKey(): string {
  if (process.env.OPENROUTER_API_KEY) return process.env.OPENROUTER_API_KEY.trim();
  const file = new URL('.env', here);
  const line = existsSync(file) ? readFileSync(file, 'utf8').split('\n').find((l) => l.startsWith('OPENROUTER_API_KEY=')) : undefined;
  if (line) return line.slice('OPENROUTER_API_KEY='.length).trim().replace(/^["']|["']$/g, '');
  throw new Error('No OpenRouter key: put OPENROUTER_API_KEY=... in tools/llm-bench/.env (git ignores it)');
}

// -------------------------------------------------------------- list models

if (opt['list-models'] !== undefined) {
  const r = await fetch(`${API}/models`);
  const { data } = await r.json() as { data: { id: string; name: string; context_length: number; pricing: { prompt: string; completion: string } }[] };
  const q = opt['list-models'].toLowerCase();
  for (const m of data.filter((m) => `${m.id} ${m.name}`.toLowerCase().includes(q))) {
    const per = (p: string) => `$${(Number(p) * 1e6).toFixed(2)}`;
    console.log(`${m.id.padEnd(48)} ${per(m.pricing.prompt)} in / ${per(m.pricing.completion)} out per 1M tokens, ${m.context_length} context`);
  }
  process.exit(0);
}

// --------------------------------------------------------------------- plan

if (!opt.model) throw new Error('Give --model, an OpenRouter model id (find one with --list-models opus)');
const model = opt.model;
const conditions = opt.conditions!.split(',').map((c) => c.trim()) as Condition[];
for (const c of conditions) if (!CONDITIONS.includes(c)) throw new Error(`Unknown condition ${c}: use ${CONDITIONS.join(', ')}`);
const repeats = Number(opt.repeats), maxTokens = Number(opt['max-tokens']), maxRounds = Number(opt['max-rounds']);
const only = opt.only ? new Set(opt.only.split(',')) : null;
const types = opt.types ? new Set(opt.types.split(',')) : null;
const questions = loadQuestions().filter((q) => (!only || only.has(q.id)) && (!types || types.has(q.type)));
if (!questions.length) throw new Error(loadQuestions().length ? 'No questions match' : 'No questions yet: draw them in HexSketch into tools/llm-bench/questions/ and run npm run llm-bench:prep');
const setHash = createHash('sha256').update(readFileSync(QUESTIONS_FILE)).digest('hex').slice(0, 12);

interface Job { key: string; q: Question; condition: Condition; repeat: number }
const jobs: Job[] = questions.flatMap((q) => conditions.flatMap((condition) => Array.from({ length: repeats }, (_, r) => ({ key: `${q.id}.${condition}.${r + 1}`, q, condition, repeat: r + 1 }))));
// Mixed order, the same every time: no condition gets all the quiet hours.
const order = (k: string) => createHash('sha256').update(k).digest('hex');
jobs.sort((a, b) => (order(a.key) < order(b.key) ? -1 : 1));

const slug = model.replace(/[^a-z0-9.]+/gi, '-').replace(/^-|-$/g, '');
const runName = opt.run ?? `${new Date().toISOString().slice(0, 10)}-${slug}`;
const outDir = new URL(`out/${runName}/`, here);
console.log(`${runName}: ${questions.length} questions × ${conditions.join('/')} × ${repeats} = ${jobs.length} runs of ${model}${opt.provider ? ` on ${opt.provider}` : ''}`);
if (opt['dry-run']) process.exit(0);
const key = apiKey();
mkdirSync(new URL('transcripts/', outDir), { recursive: true });

// ------------------------------------------------------------------ one run

interface Message { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_details?: unknown }
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface Usage { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number }; cost?: number }
interface Reply { model?: string; provider?: string; choices?: { message: Message; finish_reason?: string; native_finish_reason?: string }[]; usage?: Usage; error?: { message: string; code?: number } }

export interface RunRecord extends Partial<Measures> {
  key: string; id: string; type: string; condition: Condition; repeat: number;
  model: string; providers: string[];
  /** The model's last reply, and everything it wrote in its replies. */
  final: string; text: string;
  /** With HexSketch: the editor's drawing at the end (CDXML). */
  drawn: string | null;
  answer?: string | null; name?: string | null; named?: string | null;
  /** The model declined to answer (see refusal()), and why it was counted as one. */
  refused?: boolean; refusal?: string | null;
  /** Marks earned: the question's marks when correct, else 0. */
  marks?: number;
  rounds: number; tools: { name: string; error: boolean }[]; finish: string | null;
  /** cached: input tokens read from the provider's prompt cache (charged at a fraction). */
  tokens: { prompt: number; completion: number; reasoning: number; cached?: number }; cost: number; ms: number; error?: string;
}

/**
 * Claude's prompt cache marked as hexsketch.com marks it (apps/web/src/openrouter.ts):
 * the instructions and tools, and the conversation up to the latest message,
 * are kept for the next request. Other providers cache on their own. Without
 * it the benchmark would charge every round of tool calls in full, which no
 * chat does.
 */
function cached(model: string, messages: Message[]): unknown[] {
  if (!model.startsWith('anthropic/')) return messages;
  const lastUser = messages.map((m) => m.role).lastIndexOf('user');
  return messages.map((m, i) => (m.role === 'system' || i === lastUser) && typeof m.content === 'string'
    ? { ...m, content: [{ type: 'text', text: m.content, cache_control: { type: 'ephemeral' } }] }
    : m);
}

async function ask(body: object, deadline: number): Promise<Reply> {
  for (let attempt = 0; ; attempt++) {
    const left = deadline - Date.now();
    if (left <= 0) throw new Error('timed out');
    const r = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'HexSketch LLM benchmark' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(left),
    });
    const text = await r.text();
    let reply: Reply;
    try { reply = JSON.parse(text) as Reply; } catch { reply = { error: { message: text.slice(0, 300), code: r.status } }; }
    // Rate limits and provider hiccups are retried; anything else is the run's answer.
    if ((r.status === 429 || r.status >= 500 || reply.error?.code === 429) && attempt < 5) { await new Promise((res) => setTimeout(res, 2000 * 2 ** attempt)); continue; }
    if (!r.ok || reply.error) throw new Error(`OpenRouter ${r.status}: ${reply.error?.message ?? text.slice(0, 300)}`);
    return reply;
  }
}

async function runOne(job: Job): Promise<RunRecord> {
  const { q, condition } = job;
  const start = await opening(q, condition);
  const editor = { drawing: q.drawing };
  const messages: Message[] = [{ role: 'system', content: start.system }, { role: 'user', content: start.user }];
  const rec: RunRecord = {
    key: job.key, id: q.id, type: q.type, condition, repeat: job.repeat, model, providers: [], final: '', text: '', drawn: null,
    rounds: 0, tools: [], finish: null, tokens: { prompt: 0, completion: 0, reasoning: 0 }, cost: 0, ms: 0,
  };
  const t0 = Date.now(), deadline = t0 + Number(opt.timeout) * 1000;
  try {
    for (;;) {
      // Out of rounds: one last turn without tools, so the model has to answer.
      const toolsNow = start.tools.length && rec.rounds < maxRounds;
      const reply = await ask({
        model, messages: cached(model, messages), max_tokens: maxTokens,
        // --effort none for a model without a thinking mode: require_parameters would otherwise rule out every provider.
        ...(opt.effort === 'none' ? {} : { reasoning: { effort: opt.effort } }),
        ...(start.tools.length ? { tools: start.tools.map((t) => ({ type: 'function', function: t })), tool_choice: toolsNow ? 'auto' : 'none' } : {}),
        provider: { ...(opt.provider ? { order: [opt.provider], allow_fallbacks: false } : {}), require_parameters: true },
        usage: { include: true },
      }, deadline);
      rec.rounds++;
      if (reply.model) rec.model = reply.model;
      if (reply.provider && !rec.providers.includes(reply.provider)) rec.providers.push(reply.provider);
      const u = reply.usage ?? {};
      rec.tokens.prompt += u.prompt_tokens ?? 0; rec.tokens.completion += u.completion_tokens ?? 0;
      rec.tokens.reasoning += u.completion_tokens_details?.reasoning_tokens ?? 0; rec.cost += u.cost ?? 0;
      rec.tokens.cached = (rec.tokens.cached ?? 0) + (u.prompt_tokens_details?.cached_tokens ?? 0);
      const choice = reply.choices?.[0];
      if (!choice) throw new Error('OpenRouter gave no answer');
      // The provider's own reason where it gives one ("refusal"), else OpenRouter's ("content_filter").
      rec.finish = choice.native_finish_reason ?? choice.finish_reason ?? null;
      const m = choice.message;
      if (m.content) rec.text += `${m.content}\n`;
      // The thinking goes back with the turn (reasoning_details), as Claude's API needs for tool use.
      messages.push({ role: 'assistant', content: m.content ?? '', ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}), ...(m.reasoning_details ? { reasoning_details: m.reasoning_details } : {}) });
      if (!m.tool_calls?.length) { rec.final = m.content ?? ''; break; }
      for (const call of m.tool_calls) {
        const out = await runTool(editor, call.function.name, call.function.arguments);
        rec.tools.push({ name: call.function.name, error: out.error });
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(out.result) });
      }
    }
  } catch (err) {
    const message = (err as Error).message;
    // A provider that blocks the request for its content has answered: it refused. Anything else is a failed run, tried again next time.
    if (REFUSAL_ERROR.test(message)) { rec.refused = true; rec.refusal = `the provider declined: ${message.slice(0, 200)}`; }
    else rec.error = message;
  }
  if (condition === 'hexsketch' && editor.drawing !== q.drawing) rec.drawn = editor.drawing;
  rec.ms = Date.now() - t0;
  writeFileSync(new URL(`transcripts/${job.key}.json`, outDir), JSON.stringify({ record: rec, messages }, null, 2));
  return rec;
}

// ---------------------------------------------------------------- run them

const done = new Map<string, RunRecord>();
const recordsFile = new URL('records.jsonl', outDir);
// A run stopped part-way carries on where it left off (--run <name>); failed runs are tried again.
// Only answers to this run's questions, conditions and repeats count.
const wanted = new Set(jobs.map((j) => j.key));
if (existsSync(recordsFile)) for (const l of readFileSync(recordsFile, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l) as RunRecord; if (!r.error && wanted.has(r.key)) done.set(r.key, r); }
const todo = jobs.filter((j) => !done.has(j.key));
if (done.size) console.log(`${done.size} already done, ${todo.length} to go`);
let next = 0, finished = 0, spent = [...done.values()].reduce((s, r) => s + r.cost, 0);
const records: RunRecord[] = [...done.values()];
writeFileSync(recordsFile, records.length ? records.map((r) => JSON.stringify(r)).join('\n') + '\n' : '');
await Promise.all(Array.from({ length: Math.max(1, Number(opt.concurrency)) }, async () => {
  while (next < todo.length) {
    const job = todo[next++]!;
    const r = await runOne(job);
    records.push(r);
    writeFileSync(recordsFile, JSON.stringify(r) + '\n', { flag: 'a' });
    finished++; spent += r.cost;
    console.log(`${String(finished).padStart(4)}/${todo.length}  ${job.key.padEnd(40)} ${r.error ? `ERROR ${r.error.slice(0, 80)}` : `${r.tools.length} tool calls, ${(r.ms / 1000).toFixed(0)} s`}  ($${spent.toFixed(2)} so far)`);
  }
}));

// ------------------------------------------------------------------ measure

const byId = new Map(questions.map((q) => [q.id, q]));
const ok = records.filter((r) => !r.error && byId.has(r.id));
const names = ok.map((r) => finalAnswer(r.final).name);
const parsed = opsin(names.filter((n): n is string => !!n));
let k = 0;
for (const [i, r] of ok.entries()) r.named = names[i] ? parsed[k++] ?? null : null;
for (const r of ok) {
  Object.assign(r, await measure(byId.get(r.id)!, r.text, r.final, r.named ?? null, r.drawn));
  r.refusal = r.refusal ?? refusalOf(r.text, r.answer ?? null, r.finish);
  r.refused = !!r.refusal;
  r.marks = r.correct ? byId.get(r.id)!.marks : 0;
}
writeFileSync(recordsFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

// ------------------------------------------------------------------ summary

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const MEASURES = ['correct', 'stereo', 'valid', 'consistent', 'preserved', 'flagged', 'oriented'] as const;
/** Each measure as the share of the answers it applies to, with how many that is. */
const rates = (rs: RunRecord[]) => Object.fromEntries(MEASURES.map((m) => {
  const applies = rs.filter((r) => r[m] !== null && r[m] !== undefined);
  return [m, { rate: applies.length ? applies.filter((r) => r[m]).length / applies.length : null, n: applies.length }];
})) as Record<(typeof MEASURES)[number], { rate: number | null; n: number }>;
/** Marks out of the paper's total, per repeat (each repeat a full pass through the questions). */
const scores = (rs: RunRecord[]) => Array.from({ length: repeats }, (_, i) => rs.filter((r) => r.repeat === i + 1)).filter((x) => x.length).map((x) => x.reduce((t, r) => t + (r.marks ?? 0), 0));
const typesIn = TYPES.filter((t) => questions.some((q) => q.type === t));
const totalMarks = questions.reduce((t, q) => t + q.marks, 0);
const marksOf = (type?: string) => questions.filter((q) => !type || q.type === type).reduce((t, q) => t + q.marks, 0);
const summary = {
  run: runName, date: new Date().toISOString(), model, served: [...new Set(ok.map((r) => r.model))], providers: [...new Set(ok.flatMap((r) => r.providers))],
  settings: { provider: opt.provider ?? null, effort: opt.effort, maxTokens, maxRounds, repeats, timeoutSeconds: Number(opt.timeout), temperature: 'default' },
  questions: { hash: setHash, count: questions.length, marks: totalMarks, types: countBy(questions, (q) => q.type) },
  commit: (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return null; } })(),
  failedRuns: records.length - records.filter((r) => !r.error).length,
  totalCost: records.reduce((s, r) => s + r.cost, 0),
  conditions: Object.fromEntries(conditions.map((c) => {
    const rs = ok.filter((r) => r.condition === c);
    const sc = scores(rs);
    return [c, {
      score: mean(sc), scoreRange: sc.length ? [Math.min(...sc), Math.max(...sc)] : [0, 0], outOf: totalMarks,
      byType: Object.fromEntries(typesIn.map((t) => [t, { score: mean(scores(rs.filter((r) => r.type === t))), outOf: marksOf(t) }])),
      ...rates(rs),
      refused: rs.filter((r) => r.refused).length,
      cost: mean(rs.map((r) => r.cost)), tokens: mean(rs.map((r) => r.tokens.completion)), reasoning: mean(rs.map((r) => r.tokens.reasoning)),
      prompt: mean(rs.map((r) => r.tokens.prompt)), cachedPrompt: mean(rs.map((r) => r.tokens.cached ?? 0)), seconds: median(rs.map((r) => r.ms / 1000)), toolCalls: mean(rs.map((r) => r.tools.length)),
    }];
  })),
  /** Per question and condition: answers right, refusals, and what an answer took (means over the repeats). */
  perQuestion: questions.map((q) => ({
    id: q.id, type: q.type, marks: q.marks,
    ...Object.fromEntries(conditions.map((c) => {
      const rs = ok.filter((r) => r.id === q.id && r.condition === c);
      return [c, {
        right: rs.filter((r) => r.correct).length, of: rs.length, refused: rs.filter((r) => r.refused).length,
        promptTokens: mean(rs.map((r) => r.tokens.prompt)), outputTokens: mean(rs.map((r) => r.tokens.completion)), thinkingTokens: mean(rs.map((r) => r.tokens.reasoning)),
        cost: mean(rs.map((r) => r.cost)), seconds: mean(rs.map((r) => r.ms / 1000)), toolCalls: mean(rs.map((r) => r.tools.length)),
      }];
    })),
  })),
};
mkdirSync(new URL('results/', here), { recursive: true });
writeFileSync(new URL(`results/${runName}.json`, here), JSON.stringify(summary, null, 2) + '\n');

const pct = (x: { rate: number | null; n: number }) => (x.rate === null ? '–' : `${(100 * x.rate).toFixed(0)}% (${x.n})`);
const LABEL: Record<(typeof MEASURES)[number], string> = {
  correct: 'Correct', stereo: 'Right compound, wrong stereochemistry', valid: 'Valid structures', consistent: 'Name matches structure',
  preserved: 'Unchanged part kept', flagged: 'Hazard flagged', oriented: 'Drawn the same way round',
};
const cs = summary.conditions;
const head = (c: Condition) => (c === 'smiles' ? 'Without HexSketch' : 'With HexSketch');
const score = (x: { score: number; outOf: number }, range?: number[]) => `${x.score.toFixed(1)} / ${x.outOf}${range && repeats > 1 ? ` (${range[0]}–${range[1]})` : ''}`;
const lines = [
  `# ${runName}`, '',
  `${model} (served as ${summary.served.join(', ') || '?'}, via ${summary.providers.join(', ') || '?'}), effort ${opt.effort}, ${repeats} repeat${repeats === 1 ? '' : 's'} of ${questions.length} questions worth ${totalMarks} marks. Total cost $${summary.totalCost.toFixed(2)}.${summary.failedRuns ? ` ${summary.failedRuns} runs failed (not measured): run again with --run ${runName}.` : ''}`, '',
  `| | ${conditions.map(head).join(' | ')} |`, `|---|${conditions.map(() => '---').join('|')}|`,
  `| **Score** | ${conditions.map((c) => `**${score(cs[c]!, cs[c]!.scoreRange)}**`).join(' | ')} |`,
  ...typesIn.map((t) => `| ${t} | ${conditions.map((c) => score(cs[c]!.byType[t]!)).join(' | ')} |`),
  ...MEASURES.map((m) => `| ${LABEL[m]} | ${conditions.map((c) => pct(cs[c]![m])).join(' | ')} |`),
  `| Refused | ${conditions.map((c) => cs[c]!.refused).join(' | ')} |`,
  `| cost / question | ${conditions.map((c) => `$${cs[c]!.cost.toFixed(3)}`).join(' | ')} |`,
  `| input tokens / question (from cache) | ${conditions.map((c) => `${cs[c]!.prompt.toFixed(0)} (${cs[c]!.cachedPrompt.toFixed(0)})`).join(' | ')} |`,
  `| output tokens / question (thinking) | ${conditions.map((c) => `${cs[c]!.tokens.toFixed(0)} (${cs[c]!.reasoning.toFixed(0)})`).join(' | ')} |`,
  `| median time | ${conditions.map((c) => `${cs[c]!.seconds.toFixed(0)} s`).join(' | ')} |`,
  `| tool calls / question | ${conditions.map((c) => cs[c]!.toolCalls.toFixed(1)).join(' | ')} |`,
  '', `Score: marks for answers that are right, averaged over the repeats${repeats > 1 ? ' (range in brackets)' : ''}. Each measure is the share of the answers it applies to (how many in brackets).`,
  '', '## Each question', '',
  `| Question | Marks | ${conditions.map((c) => `${head(c)}: right · tokens out · $ · s`).join(' | ')} |`, `|---|---|${conditions.map(() => '---').join('|')}|`,
  ...summary.perQuestion.map((p) => `| ${p.id} | ${p.marks} | ${conditions.map((c) => {
    const x = (p as unknown as Record<string, { right: number; of: number; refused: number; outputTokens: number; cost: number; seconds: number }>)[c]!;
    return `${x.right}/${x.of}${x.refused ? ` (${x.refused} refused)` : ''} · ${x.outputTokens.toFixed(0)} · ${x.cost.toFixed(3)} · ${x.seconds.toFixed(0)}`;
  }).join(' | ')} |`),
];
writeFileSync(new URL(`results/${runName}.md`, here), lines.join('\n') + '\n');
await writeReport(new URL('report.html', outDir), runName, questions, ok, conditions);
console.log('\n' + lines.join('\n'));
console.log(`\nEvery answer beside its drawing: ${new URL('report.html', outDir).pathname}`);
