/**
 * The LLM benchmark: how well a model answers chemistry questions with and
 * without HexSketch's tools. Asks each question through OpenRouter in each
 * condition (blind, readback, full), runs the tools the model calls here,
 * grades the final answers, and writes a summary to results/ (committed) and
 * every transcript to out/ (not committed). See README.md.
 *
 *   npm run llm-bench -- --model anthropic/claude-opus-5 --conditions blind,full
 */
import { createHash } from 'node:crypto';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { finalAnswer, grade, opsin, type Verdict } from './grade.ts';
import { CONDITIONS, runTool, systemPrompt, toolsFor, type Condition } from './hexsketch.ts';
import { ANSWER_FORMAT, countBy, loadQuestions, type Question } from './questions.ts';

const here = new URL('.', import.meta.url);
/** OpenRouter's API (LLM_BENCH_API points it elsewhere, for the runner's own test). */
const API = process.env.LLM_BENCH_API ?? 'https://openrouter.ai/api/v1';

const { values: opt } = parseArgs({
  options: {
    model: { type: 'string' },
    provider: { type: 'string' },
    conditions: { type: 'string', default: 'blind,full' },
    repeats: { type: 'string', default: '3' },
    all: { type: 'boolean', default: false },
    only: { type: 'string' },
    concurrency: { type: 'string', default: '4' },
    'max-tokens': { type: 'string', default: '32000' },
    effort: { type: 'string', default: 'medium' },
    'max-rounds': { type: 'string', default: '10' },
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
const questions = loadQuestions().filter((q) => (only ? only.has(q.id) : opt.all || q.pilot));
if (!questions.length) throw new Error('No questions match');
const setHash = createHash('sha256').update(readFileSync(new URL('questions.jsonl', here))).digest('hex').slice(0, 12);

interface Job { key: string; q: Question; condition: Condition; repeat: number }
const jobs: Job[] = questions.flatMap((q) => conditions.flatMap((condition) => Array.from({ length: repeats }, (_, r) => ({ key: `${q.id}.${condition}.${r + 1}`, q, condition, repeat: r + 1 }))));
// Mixed order, the same every time: no condition gets all the quiet hours.
const order = (k: string) => createHash('sha256').update(k).digest('hex');
jobs.sort((a, b) => (order(a.key) < order(b.key) ? -1 : 1));

const slug = model.replace(/[^a-z0-9.]+/gi, '-').replace(/^-|-$/g, '');
const runName = opt.run ?? `${new Date().toISOString().slice(0, 10)}-${slug}${opt.all ? '' : '-pilot'}`;
const outDir = new URL(`out/${runName}/`, here);
console.log(`${runName}: ${questions.length} questions × ${conditions.join('/')} × ${repeats} = ${jobs.length} runs of ${model}${opt.provider ? ` on ${opt.provider}` : ''}`);
if (opt['dry-run']) process.exit(0);
const key = apiKey();
mkdirSync(new URL('transcripts/', outDir), { recursive: true });

// ------------------------------------------------------------------ one run

interface Message { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string; reasoning_details?: unknown }
interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
interface Usage { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; cost?: number }
interface Reply { model?: string; provider?: string; choices?: { message: Message & { reasoning?: string }; finish_reason?: string }[]; usage?: Usage; error?: { message: string; code?: number } }

export interface RunRecord {
  key: string; id: string; category: string; condition: Condition; repeat: number;
  model: string; providers: string[]; answer: string | null; verdict?: Verdict; named?: string | null;
  rounds: number; tools: { name: string; error: boolean }[]; finish: string | null;
  tokens: { prompt: number; completion: number; reasoning: number }; cost: number; ms: number; error?: string;
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
  const tools = toolsFor(condition);
  const messages: Message[] = [
    { role: 'system', content: systemPrompt(condition) },
    { role: 'user', content: `${q.prompt}\n\nEnd with "ANSWER: " and ${ANSWER_FORMAT[q.answer.kind]}.` },
  ];
  const rec: RunRecord = {
    key: job.key, id: q.id, category: q.category, condition, repeat: job.repeat, model, providers: [], answer: null,
    rounds: 0, tools: [], finish: null, tokens: { prompt: 0, completion: 0, reasoning: 0 }, cost: 0, ms: 0,
  };
  const t0 = Date.now(), deadline = t0 + Number(opt.timeout) * 1000;
  try {
    for (;;) {
      // Out of rounds: one last turn without tools, so the model has to answer.
      const toolsNow = tools.length && rec.rounds < maxRounds;
      const reply = await ask({
        model, messages, max_tokens: maxTokens,
        // --effort none for a model without a thinking mode: require_parameters would otherwise rule out every provider.
        ...(opt.effort === 'none' ? {} : { reasoning: { effort: opt.effort } }),
        ...(tools.length ? { tools: tools.map((t) => ({ type: 'function', function: t })), tool_choice: toolsNow ? 'auto' : 'none' } : {}),
        provider: { ...(opt.provider ? { order: [opt.provider], allow_fallbacks: false } : {}), require_parameters: true },
        usage: { include: true },
      }, deadline);
      rec.rounds++;
      if (reply.model) rec.model = reply.model;
      if (reply.provider && !rec.providers.includes(reply.provider)) rec.providers.push(reply.provider);
      const u = reply.usage ?? {};
      rec.tokens.prompt += u.prompt_tokens ?? 0; rec.tokens.completion += u.completion_tokens ?? 0;
      rec.tokens.reasoning += u.completion_tokens_details?.reasoning_tokens ?? 0; rec.cost += u.cost ?? 0;
      const choice = reply.choices?.[0];
      if (!choice) throw new Error('OpenRouter gave no answer');
      rec.finish = choice.finish_reason ?? null;
      const m = choice.message;
      // The thinking goes back with the turn (reasoning_details), as Claude's API needs for tool use.
      messages.push({ role: 'assistant', content: m.content ?? '', ...(m.tool_calls?.length ? { tool_calls: m.tool_calls } : {}), ...(m.reasoning_details ? { reasoning_details: m.reasoning_details } : {}) });
      if (!m.tool_calls?.length) { rec.answer = finalAnswer(m.content ?? ''); break; }
      for (const call of m.tool_calls) {
        const out = await runTool(condition, call.function.name, call.function.arguments);
        rec.tools.push({ name: call.function.name, error: out.error });
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.text });
      }
    }
  } catch (err) { rec.error = (err as Error).message; }
  rec.ms = Date.now() - t0;
  writeFileSync(new URL(`transcripts/${job.key}.json`, outDir), JSON.stringify({ record: rec, messages }, null, 2));
  return rec;
}

// ---------------------------------------------------------------- run them

const done = new Map<string, RunRecord>();
const recordsFile = new URL('records.jsonl', outDir);
// A run stopped part-way carries on where it left off (--run <name>); failed runs are tried again.
if (existsSync(recordsFile)) for (const l of readFileSync(recordsFile, 'utf8').split('\n').filter(Boolean)) { const r = JSON.parse(l) as RunRecord; if (!r.error) done.set(r.key, r); }
const todo = jobs.filter((j) => !done.has(j.key));
if (done.size) console.log(`${done.size} already done, ${todo.length} to go`);
let next = 0, finished = 0, spent = [...done.values()].reduce((s, r) => s + r.cost, 0);
const records: RunRecord[] = [...done.values()];
const kept = [...done.values()].map((r) => JSON.stringify(r));
writeFileSync(recordsFile, kept.length ? kept.join('\n') + '\n' : '');
await Promise.all(Array.from({ length: Math.max(1, Number(opt.concurrency)) }, async () => {
  while (next < todo.length) {
    const job = todo[next++]!;
    const r = await runOne(job);
    records.push(r);
    writeFileSync(recordsFile, JSON.stringify(r) + '\n', { flag: 'a' });
    finished++; spent += r.cost;
    console.log(`${String(finished).padStart(4)}/${todo.length}  ${job.key.padEnd(44)} ${r.error ? `ERROR ${r.error.slice(0, 80)}` : `${r.answer ? 'answered' : 'no answer'}, ${r.tools.length} tool calls, ${(r.ms / 1000).toFixed(0)} s`}  ($${spent.toFixed(2)} so far)`);
  }
}));

// -------------------------------------------------------------------- grade

const byId = new Map(questions.map((q) => [q.id, q]));
const named = records.filter((r) => r.answer && byId.get(r.id)?.answer.kind === 'name');
const parsed = opsin(named.map((r) => r.answer!));
named.forEach((r, i) => { r.named = parsed[i]; });
for (const r of records) if (!r.error) r.verdict = await grade(byId.get(r.id)!, r.answer, r.named);
writeFileSync(recordsFile, records.map((r) => JSON.stringify(r)).join('\n') + '\n');

// ------------------------------------------------------------------ summary

const ok = records.filter((r) => !r.error);
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? (s[Math.floor((s.length - 1) / 2)]! + s[Math.ceil((s.length - 1) / 2)]!) / 2 : 0; };
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
/** Accuracy, and its range over the repeats (each repeat a full pass through the questions). */
const score = (rs: RunRecord[]) => {
  const per = Array.from({ length: repeats }, (_, i) => rs.filter((r) => r.repeat === i + 1)).filter((x) => x.length);
  const acc = (x: RunRecord[]) => x.filter((r) => r.verdict === 'correct').length / x.length;
  return {
    n: rs.length, accuracy: rs.length ? acc(rs) : 0,
    range: per.length ? [Math.min(...per.map(acc)), Math.max(...per.map(acc))] : [0, 0],
    verdicts: countBy(rs, (r) => r.verdict ?? 'ungraded'),
    cost: mean(rs.map((r) => r.cost)), tokens: mean(rs.map((r) => r.tokens.completion)), reasoning: mean(rs.map((r) => r.tokens.reasoning)),
    seconds: median(rs.map((r) => r.ms / 1000)), toolCalls: mean(rs.map((r) => r.tools.length)),
  };
};
const categories = [...new Set(questions.map((q) => q.category))];
const summary = {
  run: runName, date: new Date().toISOString(), model, served: [...new Set(ok.map((r) => r.model))], providers: [...new Set(ok.flatMap((r) => r.providers))],
  settings: { provider: opt.provider ?? null, effort: opt.effort, maxTokens, maxRounds, repeats, timeoutSeconds: Number(opt.timeout), temperature: 'default' },
  questions: { set: setHash, count: questions.length, pilot: !opt.all && !only },
  commit: (() => { try { return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim(); } catch { return null; } })(),
  failedRuns: records.length - ok.length,
  totalCost: records.reduce((s, r) => s + r.cost, 0),
  conditions: Object.fromEntries(conditions.map((c) => [c, {
    all: score(ok.filter((r) => r.condition === c)),
    byCategory: Object.fromEntries(categories.map((k) => [k, score(ok.filter((r) => r.condition === c && r.category === k))])),
  }])),
};
mkdirSync(new URL('results/', here), { recursive: true });
writeFileSync(new URL(`results/${runName}.json`, here), JSON.stringify(summary, null, 2) + '\n');

const pct = (x: number) => `${(100 * x).toFixed(0)}%`;
const lines = [
  `# ${runName}`, '',
  `${model} (served as ${summary.served.join(', ') || '?'}, via ${summary.providers.join(', ') || '?'}), effort ${opt.effort}, ${repeats} repeats, ${questions.length} questions. Total cost $${summary.totalCost.toFixed(2)}.${summary.failedRuns ? ` ${summary.failedRuns} runs failed (not scored): run again with --run ${runName}.` : ''}`, '',
  `| | ${conditions.join(' | ')} |`, `|---|${conditions.map(() => '---').join('|')}|`,
  ...['all', ...categories].map((k) => `| ${k} | ${conditions.map((c) => { const s = k === 'all' ? summary.conditions[c]!.all : summary.conditions[c]!.byCategory[k]!; return `${pct(s.accuracy)} (${pct(s.range[0]!)}–${pct(s.range[1]!)})`; }).join(' | ')} |`),
  `| cost / question | ${conditions.map((c) => `$${summary.conditions[c]!.all.cost.toFixed(3)}`).join(' | ')} |`,
  `| output tokens (thinking) | ${conditions.map((c) => `${summary.conditions[c]!.all.tokens.toFixed(0)} (${summary.conditions[c]!.all.reasoning.toFixed(0)})`).join(' | ')} |`,
  `| median time | ${conditions.map((c) => `${summary.conditions[c]!.all.seconds.toFixed(0)} s`).join(' | ')} |`,
  `| tool calls / question | ${conditions.map((c) => summary.conditions[c]!.all.toolCalls.toFixed(1)).join(' | ')} |`,
  '', 'Accuracy, with its range over the repeats in brackets.',
];
writeFileSync(new URL(`results/${runName}.md`, here), lines.join('\n') + '\n');
console.log('\n' + lines.join('\n'));
