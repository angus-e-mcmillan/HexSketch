/**
 * Settings compared: one dot per setup (a run, and a condition in it), its
 * score against what it took, output tokens and time per question, so the
 * setups that do best for least sit top left. For trying ways to make
 * HexSketch faster and cheaper, on a free model, before paying for a run.
 *
 *   npm run llm-bench:compare -- --runs "RUN[:CONDITION][=LABEL];..." [--title TEXT] [--name FILE]
 *
 * Writes results/<name>.html and results/plots/<name>-tokens.svg and
 * <name>-time.svg. Without a condition, every condition in the run is a dot.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values: opt } = parseArgs({ options: { runs: { type: 'string' }, title: { type: 'string' }, name: { type: 'string', default: 'compare' } } });
if (!opt.runs) throw new Error('Give --runs "run[:condition][=label];..."');
const dir = new URL('results/', import.meta.url);

interface ConditionSummary { score: number; outOf: number; cutOff?: number; refused: number; cost: number; tokens: number; reasoning: number; prompt: number; cachedPrompt?: number; seconds: number; toolCalls: number }
interface Summary { run: string; model: string; settings: { effort: string; maxTokens: number; likeWebsite?: { effort: string; maxTokens: number } | null }; questions: { count: number; marks: number }; conditions: Record<string, ConditionSummary> }

interface Dot { label: string; condition: string; c: ConditionSummary; run: string }
const dots: Dot[] = [];
for (const spec of opt.runs.split(";").map((x) => x.trim()).filter(Boolean)) {
  const [where, label] = spec.split('=') as [string, string | undefined];
  const [run, only] = where.split(':') as [string, string | undefined];
  const s = JSON.parse(readFileSync(new URL(`${run}.json`, dir), 'utf8')) as Summary;
  for (const [condition, c] of Object.entries(s.conditions)) {
    if (only && condition !== only) continue;
    const web = condition === 'hexsketch' && s.settings.likeWebsite;
    const how = web ? `as hexsketch.com, ${web.maxTokens} tokens` : `${s.settings.effort} effort`;
    dots.push({ label: label ?? `${condition === 'hexsketch' ? 'With' : 'Without'} HexSketch, ${how}`, condition, c, run });
  }
}
if (!dots.length) throw new Error('No conditions found in those runs');
const outOf = dots[0]!.c.outOf;

// ----------------------------------------------------------------- drawing

type Role = 'surface' | 'text' | 'text2' | 'muted' | 'grid' | 'axis' | 'without' | 'with';
const LIGHT: Record<Role, string> = { surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', without: '#2a78d6', with: '#eb6834' };
const DARK: Record<Role, string> = { surface: '#1a1a19', text: '#f0efec', text2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', without: '#3987e5', with: '#d95926' };
type Ink = (r: Role) => string;
const cssInk: Ink = (r) => `var(--${r})`, hexInk: Ink = (r) => LIGHT[r];
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
const niceMax = (v: number) => { const p = 10 ** Math.floor(Math.log10(v || 1)); return Math.ceil((v || 1) / p) * p; };
const role = (d: Dot): Role => (d.condition === 'hexsketch' ? 'with' : 'without');

/** Score (up) against a cost (across): a dot per setup, labelled beside it; labels step down where they would collide. */
function scatter(id: string, title: string, xName: string, x: (d: Dot) => number, xFormat: (v: number) => string, ink: Ink): string {
  const W = 720, H = 420, L = 56, R = 210, T = 48, B = 52, pw = W - L - R, ph = H - T - B;
  const xMax = niceMax(Math.max(...dots.map(x)) * 1.05), X = (v: number) => L + (v / xMax) * pw, Y = (v: number) => T + ph - (v / outOf) * ph;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}" font-family="system-ui,-apple-system,'Segoe UI',sans-serif">`);
  out.push(`<rect width="${W}" height="${H}" fill="${ink('surface')}"/>`);
  out.push(`<text x="${L}" y="22" font-size="15" font-weight="600" fill="${ink('text')}">${esc(title)}</text>`);
  out.push(`<text x="${L}" y="38" font-size="12" fill="${ink('text2')}">Up is more marks; left is ${esc(xName === 'Median time per question' ? 'faster' : 'cheaper')}. Top left is best.</text>`);
  for (let i = 0; i <= 5; i++) {
    const v = (outOf * i) / 5, y = Y(v);
    out.push(`<line x1="${L}" x2="${L + pw}" y1="${y}" y2="${y}" stroke="${ink('grid')}"/><text x="${L - 8}" y="${y + 4}" font-size="11" text-anchor="end" fill="${ink('muted')}">${v}</text>`);
    const xv = (xMax * i) / 5;
    out.push(`<text x="${X(xv)}" y="${T + ph + 18}" font-size="11" text-anchor="middle" fill="${ink('muted')}">${xFormat(xv)}</text>`);
  }
  out.push(`<line x1="${L}" x2="${L + pw}" y1="${T + ph}" y2="${T + ph}" stroke="${ink('axis')}"/>`);
  out.push(`<text x="${L + pw / 2}" y="${H - 12}" font-size="12" text-anchor="middle" fill="${ink('text2')}">${esc(xName)}</text>`);
  out.push(`<text transform="translate(16 ${T + ph / 2}) rotate(-90)" font-size="12" text-anchor="middle" fill="${ink('text2')}">Score (of ${outOf})</text>`);
  // Labels to the right of their dot, stepped down by a line where two would overlap.
  const placed: { x0: number; x1: number; y: number }[] = [];
  for (const d of [...dots].sort((a, b) => b.c.score - a.c.score)) {
    const cx = X(x(d)), cy = Y(d.c.score), text = `${d.label} (${d.c.score.toFixed(0)})`, w = text.length * 6.2;
    let ly = cy + 4;
    while (placed.some((p) => Math.abs(p.y - ly) < 13 && cx + 10 < p.x1 && cx + 10 + w > p.x0)) ly += 13;
    placed.push({ x0: cx + 10, x1: cx + 10 + w, y: ly });
    out.push(`<circle cx="${cx}" cy="${cy}" r="6" fill="${ink(role(d))}" stroke="${ink('surface')}" stroke-width="2"><title>${esc(`${d.label}: ${d.c.score} marks, ${xFormat(x(d))}`)}</title></circle>`);
    if (Math.abs(ly - (cy + 4)) > 1) out.push(`<line x1="${cx + 6}" y1="${cy}" x2="${cx + 10}" y2="${ly - 4}" stroke="${ink('muted')}"/>`);
    out.push(`<text x="${cx + 12}" y="${ly}" font-size="11" fill="${ink('text')}">${esc(text)}</text>`);
  }
  // Legend: which colour is which, on the subtitle's line after its text.
  const lx = L + 330;
  out.push(`<circle cx="${lx}" cy="34" r="5" fill="${ink('without')}"/><text x="${lx + 9}" y="38" font-size="11" fill="${ink('text2')}">Without HexSketch</text>`);
  out.push(`<circle cx="${lx + 125}" cy="34" r="5" fill="${ink('with')}"/><text x="${lx + 134}" y="38" font-size="11" fill="${ink('text2')}">With HexSketch</text>`);
  out.push('</svg>');
  return out.join('');
}

const k = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : String(Math.round(v)));
const charts = [
  { id: `${opt.name}-tokens`, svg: (ink: Ink) => scatter(`${opt.name}-tokens`, opt.title ?? 'Score against output tokens', 'Output tokens per question (thinking included)', (d) => d.c.tokens, k, ink) },
  { id: `${opt.name}-time`, svg: (ink: Ink) => scatter(`${opt.name}-time`, opt.title ? `${opt.title}: time` : 'Score against time', 'Median time per question', (d) => d.c.seconds, (v) => `${Math.round(v)} s`, ink) },
];
const rows = [...dots].sort((a, b) => b.c.score - a.c.score).map((d) => `<tr><td>${esc(d.label)}</td><td>${d.c.score.toFixed(0)}</td><td>${d.c.cutOff ?? '–'}</td><td>${k(d.c.tokens)}</td><td>${k(d.c.prompt)}${d.c.cachedPrompt ? ` (${k(d.c.cachedPrompt)})` : ''}</td><td>${Math.round(d.c.seconds)} s</td><td>${d.c.toolCalls.toFixed(1)}</td><td>${esc(d.run)}</td></tr>`).join('');

mkdirSync(new URL('plots/', dir), { recursive: true });
for (const c of charts) writeFileSync(new URL(`plots/${c.id}.svg`, dir), c.svg(hexInk));
const vars = (p: Record<Role, string>) => Object.entries(p).map(([a, b]) => `--${a}:${b}`).join(';');
writeFileSync(new URL(`${opt.name}.html`, dir), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HexSketch settings compared</title>
<style>
:root{${vars(LIGHT)};--page:#f9f9f7;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars(DARK)};--page:#0d0d0d;color-scheme:dark}}
:root[data-theme="dark"]{${vars(DARK)};--page:#0d0d0d;color-scheme:dark}
body{margin:0;background:var(--page);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:800px;margin:0 auto;padding:24px 16px}
h1{font-size:20px;margin:0 0 4px}p.sub{color:var(--text2);margin:0 0 20px}
figure{margin:0 0 20px;padding:16px;background:var(--surface);border-radius:8px;border:1px solid var(--grid);overflow-x:auto}
svg{max-width:100%;height:auto;display:block}
table{border-collapse:collapse;font-variant-numeric:tabular-nums;font-size:13px}th,td{padding:4px 10px;border-bottom:1px solid var(--grid);text-align:left}th{color:var(--text2);font-weight:500}
</style>
<main><h1>${esc(opt.title ?? 'Settings compared')}</h1>
<p class="sub">${esc([...new Set(dots.map((d) => d.run))].join(' · '))}. One pass each: a single answer is worth 2 to 5 marks, so small differences are noise.</p>
${charts.map((c) => `<figure>${c.svg(cssInk)}</figure>`).join('\n')}
<figure><table><tr><th>Setup</th><th>Score</th><th>Cut off</th><th>Output tokens</th><th>Input tokens (cached)</th><th>Median time</th><th>Tool calls</th><th>Run</th></tr>${rows}</table></figure>
</main>`);
console.log(`${dots.length} setups: ${new URL(`${opt.name}.html`, dir).pathname}`);
