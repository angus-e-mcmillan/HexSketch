/**
 * Pages to read by eye: the questions as they will be asked (prep.ts), and a
 * run's answers beside their drawings (run.ts). Drawn by HexSketch.
 */
import { writeFileSync } from 'node:fs';
import { link, render } from '../../packages/agent/src/index.ts';
import { CONDITION_NAME, opening, type Condition } from './conditions.ts';
import type { Key, Question } from './questions.ts';
import type { RunRecord } from './run.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

async function svg(input: string | null | undefined, empty = 'nothing to draw'): Promise<string> {
  if (!input) return `<p class="none">${esc(empty)}</p>`;
  try { return String((await render(input, { padding: 10, abbreviate: true })).data); } catch (e) { return `<p class="none">${esc((e as Error).message)}</p>`; }
}

/** The drawing as a link that opens it in HexSketch, to check it by hand (on a phone, one tap). */
async function openIn(input: string | null | undefined): Promise<string> {
  if (!input) return '';
  try { return `<p class="open"><a href="${esc(await link(input, { format: 'cdxml' }))}">Open in HexSketch</a></p>`; } catch { return ''; }
}

/** The key as SMILES to draw (one structure, a set, the stages as a reaction, or the structure whose atoms are asked about); null for a number or a word. */
export const keySmiles = (k: Key): string | null =>
  k.kind === 'structure' || k.kind === 'atoms' || k.kind === 'ranking' ? k.smiles : k.kind === 'structures' ? k.smiles.join('.') : k.kind === 'sequence' ? k.stages.map((s) => s.join('.')).join('>>') : null;

/** A written answer as the examiner wrote it. */
export const keyText = (k: Key): string =>
  k.kind === 'number' ? `${k.value} ± ${k.tolerance}` : k.kind === 'term' ? k.accept.join(' / ') : keySmiles(k) ?? '';

const keyCell = async (k: Key) => {
  const s = keySmiles(k);
  if (!s) return `<p class="written">${esc(keyText(k))}</p>`;
  const marked = k.kind === 'atoms' ? '<p>The atom marked :1 in this SMILES:</p>' : k.kind === 'ranking' ? '<p>The atoms in order, marked :1, :2, … in this SMILES:</p>' : '';
  return `<div class="d">${await svg(s)}</div>${marked ? `${marked}<p><code>${esc(s)}</code></p>` : ''}`;
};

const STYLE = `<style>
body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:1180px;margin:24px auto;padding:0 20px;color:#18212b;background:#fff}
h1 small,h2 small{font-weight:normal;color:#5b6875;font-size:.75em;margin-left:.5em}
.q{border:1px solid #d9dfe5;border-radius:8px;padding:16px 20px;margin:18px 0}
.d{background:#fff;border:1px solid #e6eaee;padding:8px;overflow:auto;min-height:60px}.d svg{max-width:100%;height:auto}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}@media(max-width:820px){.cols{grid-template-columns:1fr}}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f7;padding:10px;border-radius:6px;font-size:.82em;max-height:420px;overflow:auto}
h3{margin:0 0 6px;font-size:.8em;text-transform:uppercase;letter-spacing:.05em;color:#5b6875}
.open{margin:8px 0 0}.open a{font-size:.85em;color:#1f4e79}
.none{color:#8a96a3;font-style:italic}.written{font-size:1.3em;font-weight:600;margin:8px 0}.warn{color:#b3261e}
.m{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.m span{font-size:.75em;border-radius:4px;padding:1px 7px;background:#eef1f4}
.m .y{background:#e4f1e6;color:#2f6b3a}.m .n{background:#fbeceb;color:#b3261e}
.a{border-top:1px solid #eef1f4;padding-top:10px;margin-top:10px}
details summary{cursor:pointer;color:#1f4e79;font-size:.85em}
</style>`;

/** questions/questions.html: each question's drawing, what each condition sends, and the key. */
export async function writeQuestionsPage(file: URL, questions: Question[], warnings: Map<string, string[]>): Promise<void> {
  const parts: string[] = [];
  for (const q of questions) {
    const [plain, hex] = await Promise.all([opening(q, 'smiles'), opening(q, 'hexsketch')]);
    const w = warnings.get(q.id) ?? [];
    parts.push(`<section class="q" id="${esc(q.id)}"><h2>${esc(q.id)} <small>${q.type} · ${q.marks} marks${q.hazard ? ` · hazard: ${esc(q.hazard.join(', '))}` : ''}</small></h2>
${w.length ? `<ul class="warn">${w.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
<div class="cols"><div><h3>In the editor</h3><div class="d">${await svg(q.drawing, 'nothing drawn')}</div>${await openIn(q.drawing)}</div>
<div><h3>Answer (${q.key.kind})</h3>${await keyCell(q.key)}${'also' in q.key && q.key.also?.length ? `<p>Also accepted: ${q.key.also.length}</p>` : ''}</div></div>
<div class="cols"><div><h3>Without HexSketch, the model receives</h3><pre>${esc(plain.user)}</pre></div>
<div><h3>With HexSketch, the model receives</h3><pre>${esc(hex.user)}</pre></div></div></section>`);
  }
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>Benchmark questions</title>${STYLE}<h1>Benchmark questions <small>${questions.length}</small></h1>${parts.join('\n')}`);
}

/** out/<run>/report.html: every answer, measured, beside the question and the key. */
export async function writeReport(file: URL, run: string, questions: Question[], records: RunRecord[], conditions: Condition[]): Promise<void> {
  const mark = (label: string, v: boolean | null | undefined) => (v === null || v === undefined ? '' : `<span class="${v ? 'y' : 'n'}">${label} ${v ? '✓' : '✗'}</span>`);
  const parts: string[] = [];
  for (const q of questions) {
    const cols: string[] = [];
    for (const c of conditions) {
      const rs = records.filter((r) => r.id === q.id && r.condition === c).sort((a, b) => a.repeat - b.repeat);
      const answers: string[] = [];
      for (const r of rs) {
        const picture = c === 'hexsketch' && r.drawn ? await svg(r.drawn) : keySmiles(q.key) !== null ? await svg(r.answer?.replace(/\s*>>\s*/g, '>>'), 'no answer') : `<p class="written">${esc(r.answer ?? 'no answer')}</p>`;
        answers.push(`<div class="a"><b>Repeat ${r.repeat}</b>${c === 'hexsketch' ? ` <small>(${r.drawn ? 'the editor at the end' : 'the answer; nothing drawn'})</small>` : ''}
<div class="m"><span class="${r.marks ? 'y' : 'n'}">${r.marks ?? 0} / ${q.marks} marks</span>${r.refused ? `<span class="n" title="${esc(r.refusal ?? '')}">refused</span>` : ''}${r.cutOff ? '<span class="n" title="Stopped at the output-token limit before answering">cut off</span>' : ''}${mark('correct', r.correct)}${r.stereo ? '<span class="n">stereo wrong</span>' : ''}${mark('valid', r.valid)}${mark('name', r.consistent)}${mark('kept', r.preserved)}${mark('hazard', r.flagged)}${mark('orientation', r.oriented)}${r.route ? `<span class="${r.route.valid ? 'y' : 'n'}" title="${esc(r.route.why ?? '')}">route ${r.route.valid ? 'valid' : `invalid: ${esc(r.route.why ?? '')}`}</span>${r.route.buyable === null ? '<span title="PubChem could not be reached; the mark is given">on sale: not checked</span>' : mark(r.route.buyable === false ? `on sale (fewest: ${r.route.notSold.map((x) => r.route!.vendors[x] ?? 0).join(', ')} vendors)` : 'on sale (30+ vendors each)', r.route.buyable)}${mark('known reactions', r.route.forward)}${mark('accepted disconnection', r.route.accepted)}${r.route.pending ? '<span class="n">for the chemist to grade</span>' : r.route.approved !== null ? mark('chemist', r.route.approved) : ''}<span>${esc(r.route.steps.map((st) => st.reaction ?? 'unknown').join(' → '))}</span>` : ''}<span>${r.tools.length} tool calls</span><span>${r.tokens.completion} tokens out (${r.tokens.reasoning} thinking)</span><span>$${r.cost.toFixed(3)}</span><span>${(r.ms / 1000).toFixed(0)} s</span></div>
<div class="d">${picture}</div>
<p><code>${esc(r.answer ?? '(no ANSWER line)')}</code>${r.name ? `<br>${esc(r.name)}` : ''}</p>
<details><summary>The reply</summary><pre>${esc(r.text)}</pre></details></div>`);
      }
      cols.push(`<div><h3>${CONDITION_NAME[c]}</h3>${answers.join('') || '<p class="none">no runs</p>'}</div>`);
    }
    parts.push(`<section class="q"><h2>${esc(q.id)} <small>${q.type} · ${q.marks} marks</small></h2><p>${esc(q.ask)}</p>
<div class="cols"><div><h3>Question</h3><div class="d">${await svg(q.drawing, 'nothing drawn')}</div></div><div><h3>Answer</h3>${await keyCell(q.key)}</div></div>
<div class="cols">${cols.join('')}</div></section>`);
  }
  writeFileSync(file, `<!doctype html><meta charset="utf-8"><title>${esc(run)}</title>${STYLE}<h1>${esc(run)}</h1>${parts.join('\n')}`);
}
