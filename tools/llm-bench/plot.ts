/**
 * Plots the benchmark's results: every full run in results/ (one model each),
 * without HexSketch beside with it. Writes results/plots.html (every chart,
 * light and dark, with a table under each) and results/plots/*.svg (each
 * chart on its own, light, for slides).
 *
 *   npm run llm-bench:plot                     every run of the whole paper
 *   npm run llm-bench:plot -- --runs a,b       these runs (names in results/)
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { TYPES } from './questions.ts';

const { values: opt } = parseArgs({ options: { runs: { type: 'string' } } });
const dir = new URL('results/', import.meta.url);

interface Rate { rate: number | null; n: number }
interface ConditionSummary {
  score: number; outOf: number; byType: Record<string, { score: number; outOf: number }>;
  correct: Rate; valid: Rate; consistent: Rate; preserved: Rate; flagged: Rate; oriented: Rate;
  refused: number; cost: number; tokens: number; reasoning: number; prompt: number; seconds: number; toolCalls: number;
}
interface Summary { run: string; model: string; settings: { repeats: number }; questions: { count: number; marks: number }; conditions: Record<string, ConditionSummary> }

// ------------------------------------------------------------------- runs

const all = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as Summary)
  // Runs from before the paper had marks have no score.
  .filter((s) => s.conditions?.smiles?.score !== undefined && s.conditions?.hexsketch?.score !== undefined);
const wanted = opt.runs ? new Set(opt.runs.split(',')) : null;
// Without --runs: runs of the whole paper only (not a smoke test of a few questions), the latest per model.
const runs = (wanted ? all.filter((s) => wanted.has(s.run)) : all.filter((s) => s.questions.count >= 20))
  .sort((a, b) => a.run.localeCompare(b.run))
  .filter((s, i, xs) => wanted || !xs.slice(i + 1).some((t) => t.model === s.model));
if (!runs.length) throw new Error(wanted ? `No results named ${opt.runs}` : 'No run of the whole paper in results/ yet');

/** A short name for a model: "anthropic/claude-opus-5" → "Claude Opus 5", ":free" kept as "(free)". */
const modelName = (id: string) => {
  const [, name = id] = id.split('/');
  const free = name.endsWith(':free');
  return name.replace(/:free$/, '').split('-').map((w) => (/^\d/.test(w) ? w : w[0]!.toUpperCase() + w.slice(1))).join(' ') + (free ? ' (free)' : '');
};

// --------------------------------------------------------------- the chart

/** Colours by role: CSS variables in the page (so they follow light and dark), hex in the SVG files. */
type Ink = (role: Role) => string;
type Role = 'surface' | 'text' | 'text2' | 'muted' | 'grid' | 'axis' | 'without' | 'with';
const LIGHT: Record<Role, string> = { surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', muted: '#898781', grid: '#e1e0d9', axis: '#c3c2b7', without: '#2a78d6', with: '#eb6834' };
const DARK: Record<Role, string> = { surface: '#1a1a19', text: '#f0efec', text2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', axis: '#383835', without: '#3987e5', with: '#d95926' };
const cssInk: Ink = (r) => `var(--${r})`;
const hexInk: Ink = (r) => LIGHT[r];

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const SERIES = [{ key: 'smiles', name: 'Without HexSketch', role: 'without' as Role }, { key: 'hexsketch', name: 'With HexSketch', role: 'with' as Role }];

interface Bars {
  id: string; title: string; subtitle: string;
  /** One row per category, a bar per series; null where there is nothing to show. */
  rows: { label: string; values: (number | null)[]; notes?: string[] }[];
  max: number; ticks: number[]; format: (v: number) => string;
  /** The axis's tick labels, one style along the axis; the value format when not given. */
  tickFormat?: (v: number) => string;
}

/** Horizontal grouped bars: a row per category, without and with HexSketch side by side, value at each tip. */
function barsSvg(b: Bars, ink: Ink): string {
  const W = 760, labelW = 210, padR = 64, top = 64, rowH = 44, barH = 14, gap = 2;
  const plotW = W - labelW - padR, H = top + b.rows.length * rowH + 34;
  const x = (v: number) => labelW + (Math.min(v, b.max) / b.max) * plotW;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${b.id}-t ${b.id}-d" font-family="system-ui, -apple-system, 'Segoe UI', sans-serif">`);
  out.push(`<title id="${b.id}-t">${esc(b.title)}</title><desc id="${b.id}-d">${esc(b.subtitle)}</desc>`);
  out.push(`<rect width="${W}" height="${H}" fill="${ink('surface')}"/>`);
  out.push(`<text x="0" y="20" font-size="15" font-weight="600" fill="${ink('text')}">${esc(b.title)}</text>`);
  out.push(`<text x="0" y="39" font-size="12" fill="${ink('text2')}">${esc(b.subtitle)}</text>`);
  // Legend: a swatch beside each series name.
  let lx = labelW;
  for (const s of SERIES) {
    out.push(`<rect x="${lx}" y="48" width="10" height="10" rx="2" fill="${ink(s.role)}"/><text x="${lx + 15}" y="57" font-size="11.5" fill="${ink('text2')}">${s.name}</text>`);
    lx += 15 + s.name.length * 6.6 + 18;
  }
  // Gridlines and ticks: hairline, recessive.
  for (const t of b.ticks) {
    out.push(`<line x1="${x(t)}" y1="${top}" x2="${x(t)}" y2="${H - 30}" stroke="${t === 0 ? ink('axis') : ink('grid')}" stroke-width="1"/>`);
    out.push(`<text x="${x(t)}" y="${H - 14}" font-size="11" text-anchor="middle" fill="${ink('muted')}" style="font-variant-numeric: tabular-nums">${(b.tickFormat ?? b.format)(t)}</text>`);
  }
  b.rows.forEach((row, i) => {
    const y0 = top + i * rowH + (rowH - 2 * barH - gap) / 2;
    out.push(`<text x="${labelW - 12}" y="${y0 + barH + 5}" font-size="12.5" text-anchor="end" fill="${ink('text')}">${esc(row.label)}</text>`);
    SERIES.forEach((s, k) => {
      const v = row.values[k];
      const y = y0 + k * (barH + gap);
      const tip = `${row.label}, ${s.name}: ${v === null || v === undefined ? 'not measured' : b.format(v)}${row.notes?.[k] ? ` (${row.notes[k]})` : ''}`;
      if (v === null || v === undefined) {
        out.push(`<text x="${labelW + 4}" y="${y + barH - 3}" font-size="11" fill="${ink('muted')}"><title>${esc(tip)}</title>not measured</text>`);
        return;
      }
      const w = Math.max(0, x(v) - labelW), r = Math.min(4, w / 2, barH / 2);
      // Square at the baseline, rounded data-end.
      out.push(`<g><title>${esc(tip)}</title>${w > 0 ? `<path d="M${labelW},${y} h${w - r} a${r},${r} 0 0 1 ${r},${r} v${barH - 2 * r} a${r},${r} 0 0 1 -${r},${r} h-${w - r} z" fill="${ink(s.role)}"/>` : ''}<rect x="${labelW}" y="${y - 1}" width="${plotW + padR}" height="${barH + 2}" fill="transparent"/></g>`);
      out.push(`<text x="${x(v) + 6}" y="${y + barH - 3}" font-size="11.5" fill="${ink('text2')}" style="font-variant-numeric: tabular-nums">${esc(b.format(v))}</text>`);
    });
  });
  out.push('</svg>');
  return out.join('');
}

/** The same numbers as a table, for reading exactly and for screen readers. */
function table(b: Bars): string {
  return `<details><summary>Table</summary><table><thead><tr><th></th>${SERIES.map((s) => `<th>${s.name}</th>`).join('')}</tr></thead><tbody>${b.rows.map((r) => `<tr><th>${esc(r.label)}</th>${r.values.map((v, k) => `<td>${v === null || v === undefined ? '–' : esc(b.format(v))}${r.notes?.[k] ? ` <small>${esc(r.notes[k]!)}</small>` : ''}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
}

// -------------------------------------------------------------- the charts

const niceMax = (v: number) => { const p = 10 ** Math.floor(Math.log10(v || 1)); return Math.ceil((v || 1) / p) * p; };
const ticksTo = (max: number, n = 5) => Array.from({ length: n + 1 }, (_, i) => (max * i) / n);
const pct = (v: number) => `${Math.round(v)}%`;
const both = (f: (c: ConditionSummary) => number | null) => (s: Summary) => SERIES.map((x) => f(s.conditions[x.key]!));
const repeatsNote = (s: Summary) => (s.settings.repeats > 1 ? `, mean of ${s.settings.repeats} repeats` : '');

const charts: Bars[] = [];
charts.push({
  id: 'score', title: 'Score on the paper', subtitle: `Marks out of ${runs[0]!.questions.marks}, each model without and with HexSketch`,
  rows: runs.map((s) => ({ label: modelName(s.model), values: both((c) => c.score)(s), notes: SERIES.map((x) => `${s.conditions[x.key]!.refused} refused${repeatsNote(s)}`) })),
  max: runs[0]!.questions.marks, ticks: ticksTo(runs[0]!.questions.marks), format: (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1)),
});
for (const s of runs) {
  const types = TYPES.filter((t) => s.conditions.smiles!.byType[t]);
  charts.push({
    id: `types-${s.run}`, title: `Score by question type: ${modelName(s.model)}`, subtitle: 'Share of the marks for each type of question (its marks in brackets)',
    rows: types.map((t) => ({ label: `${t} (${s.conditions.smiles!.byType[t]!.outOf})`, values: both((c) => (100 * c.byType[t]!.score) / c.byType[t]!.outOf)(s) })),
    max: 100, ticks: ticksTo(100), format: pct,
  });
  const MEASURES: [keyof ConditionSummary, string][] = [['correct', 'Correct'], ['valid', 'Valid structures'], ['consistent', 'Name matches structure'], ['preserved', 'Unchanged part kept'], ['flagged', 'Hazard flagged'], ['oriented', 'Same way round as drawn']];
  charts.push({
    id: `measures-${s.run}`, title: `Measures: ${modelName(s.model)}`, subtitle: 'Share of the answers each applies to (how many in the table)',
    rows: MEASURES.map(([k, label]) => ({
      label, values: both((c) => { const r = c[k] as Rate; return r.rate === null ? null : 100 * r.rate; })(s),
      notes: SERIES.map((x) => `of ${(s.conditions[x.key]![k] as Rate).n}`),
    })),
    max: 100, ticks: ticksTo(100), format: pct,
  });
}
const per = (id: string, title: string, subtitle: string, f: (c: ConditionSummary) => number, format: (v: number) => string, tickFormat?: (max: number) => (v: number) => string) => {
  const max = niceMax(Math.max(...runs.flatMap((s) => SERIES.map((x) => f(s.conditions[x.key]!)))));
  charts.push({ id, title, subtitle, rows: runs.map((s) => ({ label: modelName(s.model), values: both(f)(s) })), max, ticks: ticksTo(max), format, ...(tickFormat ? { tickFormat: tickFormat(max) } : {}) });
};
// Free models cost nothing: their bars are empty and their values read $0.000.
per('cost', 'Cost per question', 'Mean US dollars per answer, from OpenRouter', (c) => c.cost, (v) => `$${v < 0.1 ? v.toFixed(3) : v.toFixed(2)}`,
  (max) => (v) => `$${v.toFixed(max >= 1 ? 1 : max >= 0.1 ? 2 : 3)}`);
per('input', 'Input tokens per question', 'Mean tokens sent to the model per answer, over all its turns', (c) => c.prompt, (v) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K` : v.toFixed(0)));
per('output', 'Output tokens per question', 'Mean tokens written per answer, thinking included', (c) => c.tokens, (v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}K` : v.toFixed(0)));
per('time', 'Time per question', 'Median seconds per answer', (c) => c.seconds, (v) => `${v.toFixed(0)} s`);

// ------------------------------------------------------------------ write

mkdirSync(new URL('plots/', dir), { recursive: true });
for (const b of charts) writeFileSync(new URL(`plots/${b.id}.svg`, dir), barsSvg(b, hexInk));
const vars = (p: Record<Role, string>) => Object.entries(p).map(([k, v]) => `--${k}:${v}`).join(';');
const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HexSketch benchmark results</title>
<style>
:root{${vars(LIGHT)};--page:#f9f9f7;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars(DARK)};--page:#0d0d0d;color-scheme:dark}}
:root[data-theme="dark"]{${vars(DARK)};--page:#0d0d0d;color-scheme:dark}
body{margin:0;background:var(--page);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:800px;margin:0 auto;padding:24px max(16px,env(safe-area-inset-left,0px))}
h1{font-size:20px;margin:0 0 4px}p.sub{color:var(--text2);margin:0 0 20px}
figure{margin:0 0 20px;padding:16px;background:var(--surface);border-radius:8px;border:1px solid var(--grid);overflow-x:auto}
svg{max-width:100%;height:auto;display:block}
details{margin-top:8px;color:var(--text2)}summary{cursor:pointer}
table{border-collapse:collapse;margin-top:6px;font-variant-numeric:tabular-nums}th,td{padding:3px 10px;border-bottom:1px solid var(--grid);text-align:left}
</style>
<main><h1>HexSketch benchmark</h1>
<p class="sub">${runs.map((s) => `${esc(modelName(s.model))}: ${esc(s.run)}, ${s.settings.repeats} repeat${s.settings.repeats === 1 ? '' : 's'} of ${s.questions.count} questions`).join(' · ')}. Each chart is also in results/plots/ as an SVG.</p>
${charts.map((b) => `<figure id="${b.id}">${barsSvg(b, cssInk)}${table(b)}</figure>`).join('\n')}
</main>`;
writeFileSync(new URL('plots.html', dir), html);
console.log(`${charts.length} charts for ${runs.length} run${runs.length === 1 ? '' : 's'} (${runs.map((s) => s.run).join(', ')}): ${new URL('plots.html', dir).pathname}`);
