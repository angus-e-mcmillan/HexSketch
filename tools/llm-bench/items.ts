/**
 * Item analysis: which question each setup got right, as a grid (a row per
 * question, a column per setup), with the share of setups right at the end of
 * each row. A question every setup gets right cannot tell models apart, nor
 * show what HexSketch adds; one none gets right may have a wrong key.
 *
 *   npm run llm-bench:items -- --runs "RUN[:CONDITION][=LABEL];..." [--set NAME] [--name FILE] [--title TEXT]
 *
 * Reads out/<run>/records.jsonl (marked runs); writes results/<name>.html and
 * results/plots/<name>.svg. With repeats, a cell is the share of repeats right.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadQuestions } from './questions.ts';

const { values: opt } = parseArgs({ options: { runs: { type: 'string' }, set: { type: 'string' }, name: { type: 'string', default: 'items' }, title: { type: 'string' } } });
if (!opt.runs) throw new Error('Give --runs "run[:condition][=label];..."');
const here = new URL('.', import.meta.url);
const questions = loadQuestions(opt.set);

interface Rec { id: string; condition: string; correct?: boolean; cutOff?: boolean; finish?: string | null; error?: string }
interface Column { label: string; cells: Map<string, { right: number; cut: number; of: number }> }
const columns: Column[] = [];
for (const spec of opt.runs.split(';').map((x) => x.trim()).filter(Boolean)) {
  const [where, label] = spec.split('=') as [string, string | undefined];
  const [run, only] = where.split(':') as [string, string | undefined];
  const file = new URL(`out/${run}/records.jsonl`, here);
  if (!existsSync(file)) throw new Error(`No records for ${run}`);
  const recs = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as Rec).filter((r) => !r.error);
  for (const condition of [...new Set(recs.map((r) => r.condition))]) {
    if (only && condition !== only) continue;
    const cells = new Map<string, { right: number; cut: number; of: number }>();
    for (const r of recs.filter((x) => x.condition === condition)) {
      const c = cells.get(r.id) ?? { right: 0, cut: 0, of: 0 };
      c.of++; if (r.correct) c.right++; else if (r.cutOff || /length/i.test(r.finish ?? '')) c.cut++;
      cells.set(r.id, c);
    }
    columns.push({ label: label ?? `${run} ${condition === 'hexsketch' ? 'with' : 'without'}`, cells });
  }
}

type Role = 'surface' | 'text' | 'text2' | 'muted' | 'grid' | 'right' | 'wrong' | 'cut' | 'none';
// Right a blue step, wrong a pale neutral, cut off hatched: identity never by colour alone (each cell also says 1, 0 or cut).
const LIGHT: Record<Role, string> = { surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', muted: '#898781', grid: '#e1e0d9', right: '#2a78d6', wrong: '#ecebe6', cut: '#c3c2b7', none: '#fcfcfb' };
const DARK: Record<Role, string> = { surface: '#1a1a19', text: '#f0efec', text2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', right: '#3987e5', wrong: '#2c2c2a', cut: '#52514e', none: '#1a1a19' };
type Ink = (r: Role) => string;
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);

function grid(ink: Ink): string {
  const cw = 64, rh = 22, left = 150, right = 70;
  // Room above the grid for the slanted column labels.
  const top = 64 + Math.max(...columns.map((c) => c.label.length)) * 6.4 * Math.sin(35 * Math.PI / 180);
  const W = Math.max(740, left + columns.length * cw + right), H = top + questions.length * rh + 24;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(opt.title ?? 'Which question each setup got right')}" font-family="system-ui,-apple-system,'Segoe UI',sans-serif">`];
  out.push(`<rect width="${W}" height="${H}" fill="${ink('surface')}"/>`);
  out.push(`<defs><pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="${ink('wrong')}"/><line x1="0" y1="0" x2="0" y2="6" stroke="${ink('cut')}" stroke-width="3"/></pattern></defs>`);
  out.push(`<text x="16" y="24" font-size="15" font-weight="600" fill="${ink('text')}">${esc(opt.title ?? 'Which question each setup got right')}</text>`);
  out.push(`<text x="16" y="42" font-size="12" fill="${ink('text2')}">Blue: right · grey: wrong · hatched: cut off before answering. Right of each row: the share of setups right.</text>`);
  columns.forEach((c, j) => out.push(`<text transform="translate(${left + j * cw + cw / 2} ${top - 8}) rotate(-35)" font-size="11" fill="${ink('text2')}">${esc(c.label)}</text>`));
  questions.forEach((q, i) => {
    const y = top + i * rh;
    out.push(`<text x="${left - 8}" y="${y + rh / 2 + 4}" font-size="11" text-anchor="end" fill="${ink('text')}">${esc(q.id)} (${q.marks})</text>`);
    let right = 0, of = 0;
    columns.forEach((c, j) => {
      const cell = c.cells.get(q.id), x = left + j * cw;
      if (!cell) { out.push(`<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${rh - 2}" fill="${ink('none')}" stroke="${ink('grid')}"/>`); return; }
      right += cell.right / cell.of; of++;
      const share = cell.right / cell.of;
      const fill = share > 0 ? ink('right') : cell.cut ? 'url(#hatch)' : ink('wrong');
      out.push(`<rect x="${x + 1}" y="${y + 1}" width="${cw - 2}" height="${rh - 2}" rx="2" fill="${fill}" fill-opacity="${share > 0 ? 0.35 + 0.65 * share : 1}"><title>${esc(`${q.id}, ${c.label}: ${cell.right} of ${cell.of} right${cell.cut ? `, ${cell.cut} cut off` : ''}`)}</title></rect>`);
      const text = cell.of > 1 ? `${cell.right}/${cell.of}` : share ? '1' : cell.cut ? 'cut' : '0';
      out.push(`<text x="${x + cw / 2}" y="${y + rh / 2 + 4}" font-size="10" text-anchor="middle" fill="${share >= 0.5 ? '#ffffff' : ink('text2')}">${text}</text>`);
    });
    const p = of ? right / of : 0;
    out.push(`<text x="${left + columns.length * cw + 10}" y="${y + rh / 2 + 4}" font-size="11" fill="${p === 1 || !of ? ink('muted') : ink('text')}" font-weight="${p > 0 && p < 1 ? 600 : 400}">${of ? `${Math.round(100 * p)}%` : '–'}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}

const vars = (p: Record<Role, string>) => Object.entries(p).map(([a, b]) => `--${a}:${b}`).join(';');
mkdirSync(new URL('results/plots/', here), { recursive: true });
writeFileSync(new URL(`results/plots/${opt.name}.svg`, here), grid((r) => LIGHT[r]));
writeFileSync(new URL(`results/${opt.name}.html`, here), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Question analysis</title>
<style>
:root{${vars(LIGHT)};--page:#f9f9f7;color-scheme:light}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars(DARK)};--page:#0d0d0d;color-scheme:dark}}
:root[data-theme="dark"]{${vars(DARK)};--page:#0d0d0d;color-scheme:dark}
body{margin:0;background:var(--page);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:900px;margin:0 auto;padding:24px 16px}
figure{margin:0;padding:16px;background:var(--surface);border-radius:8px;border:1px solid var(--grid);overflow-x:auto}
svg{height:auto;display:block}
</style>
<main><figure>${grid((r) => `var(--${r})`)}</figure></main>`);
console.log(`${questions.length} questions × ${columns.length} setups: ${new URL(`results/${opt.name}.html`, here).pathname}`);
