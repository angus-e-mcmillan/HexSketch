/**
 * Builds questions.jsonl from the exam drawings in exam/ (one HexSketch
 * drawing per question, saved as CDXML), checks every key, compares the marks
 * written with the blueprint, and writes exam/paper.html: the paper as the
 * examiner drew it beside what the model receives and how each answer is
 * marked. Open paper.html to proofread the exam before a run.
 *
 *   npm run llm-bench:prep
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { render } from '../../packages/agent/src/index.ts';
import { parseExamDrawing, type ExamDrawing } from './exam.ts';
import { ANSWER_FORMAT, loadBlueprint, QUESTIONS_FILE, type Answer, type Question } from './questions.ts';

const examDir = new URL('exam/', import.meta.url);
const files = readdirSync(examDir).filter((f) => f.endsWith('.cdxml') && !f.startsWith('template')).sort();
const blueprint = loadBlueprint();

const parsed: ExamDrawing[] = [];
const problems: string[] = [];
for (const f of files) {
  const id = f.replace(/\.cdxml$/, '');
  try { parsed.push(parseExamDrawing(readFileSync(new URL(f, examDir), 'utf8'), id)); }
  catch (e) { problems.push(`${f}: ${(e as Error).message}`); }
}
const byNumber = (a: Question, b: Question) => a.section - b.section || a.number.localeCompare(b.number, undefined, { numeric: true }) || a.id.localeCompare(b.id);
parsed.sort((a, b) => byNumber(a.question, b.question));
const seen = new Map<string, string>();
for (const { question: q } of parsed) {
  if (q.section && seen.has(q.number)) problems.push(`${q.id}: question ${q.number} is also in ${seen.get(q.number)}`);
  seen.set(q.number, q.id);
}

for (const p of parsed) for (const w of p.warnings) console.warn(`${p.question.id}: ${w}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

const questions = parsed.map((p) => p.question);
writeFileSync(QUESTIONS_FILE, questions.map((q) => JSON.stringify(q)).join('\n') + '\n');

// --------------------------------------------------- marks against the plan

const marksIn = (s: number) => questions.filter((q) => q.section === s).reduce((t, q) => t + q.marks, 0);
const total = questions.reduce((t, q) => t + q.marks, 0);
const unplaced = questions.filter((q) => !blueprint.sections.some((s) => s.section === q.section));
console.log(`${questions.length} questions, ${total} marks (blueprint ${blueprint.total}).`);
for (const s of blueprint.sections) {
  const n = questions.filter((q) => q.section === s.section).length;
  const got = marksIn(s.section);
  console.log(`  ${s.section}. ${s.title.padEnd(32)} ${String(got).padStart(3)} / ${String(s.marks).padStart(3)} marks in ${n} question${n === 1 ? '' : 's'}${got === s.marks ? '' : got < s.marks ? `   (${s.marks - got} to write)` : `   (${got - s.marks} over)`}`);
}
if (unplaced.length) console.log(`  not in any section: ${unplaced.map((q) => q.id).join(', ')}`);

// --------------------------------------------------------------- the paper

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const keyText = (a: Answer): string[] => {
  switch (a.kind) {
    case 'structure': return [`One structure${a.stereo ? ', the same stereoisomer' : ''}: ${a.smiles}`, ...(a.also ?? []).map((s) => `Also accepted: ${s}`)];
    case 'name': return [`A name (parsed by OPSIN) for ${a.smiles}${a.stereo ? ', with its stereodescriptors' : ''}${a.avoid ? `; "${a.avoid}" earns nothing` : ''}`, ...(a.also ?? []).map((s) => `Also accepted: a name for ${s}`)];
    case 'formula': return [`The formula ${a.formula}`];
    case 'number': return [`The ${a.what} ${a.value} (± ${a.tolerance})`];
    case 'structures': return [`${a.smiles.length} structures in any order${a.stereo ? ', as stereoisomers' : ''}: ${a.smiles.join('  ·  ')}`, ...(a.also ?? []).map((s) => `Also accepted: ${s.join('  ·  ')}`)];
    case 'sequence': return [`${a.stages.length} stages in order${a.stereo ? ', as stereoisomers' : ''}: ${a.stages.map((s) => s.join(' + ')).join('  →  ')}`, ...(a.also ?? []).map((s) => `Also accepted: ${s.map((x) => x.join(' + ')).join('  →  ')}`)];
    case 'choice': return [`The letters ${a.letters}`];
    case 'marked': return ['Marked by the examiner against:', ...a.scheme.split('\n')];
  }
};
const MARKING: Record<Answer['kind'], string> = {
  structure: 'full marks for the same compound; half for the right connectivity with wrong or missing stereochemistry',
  name: 'as a structure, after OPSIN parses the name',
  formula: 'all or nothing', number: 'all or nothing, within the tolerance',
  structures: 'a share per structure of the key, less a share per extra structure',
  sequence: 'a share per stage of the key given in order (extra steps between them allowed)',
  choice: 'a share per right letter, less a share per wrong one',
  marked: 'by the examiner; counts for nothing until marked',
};

const sections = new Map<number, ExamDrawing[]>();
for (const p of parsed) sections.set(p.question.section, [...(sections.get(p.question.section) ?? []), p]);
const parts: string[] = [];
for (const [sec, items] of [...sections.entries()].sort((a, b) => a[0] - b[0])) {
  const plan = blueprint.sections.find((s) => s.section === sec);
  parts.push(`<h2>Section ${sec}${plan ? `: ${esc(plan.title)}` : ''} <small>${marksIn(sec)}${plan ? ` of ${plan.marks}` : ''} marks</small></h2>`);
  if (plan) parts.push(`<p class="plan">Tests: ${esc(plan.tests)}<br>HexSketch: ${esc(plan.hexsketch)}</p>`);
  for (const p of items) {
    const q = p.question;
    let svg = '';
    try { svg = String((await render(p.drawing, { padding: 12 })).data); } catch (e) { svg = `<p class="warn">Could not draw: ${esc((e as Error).message)}</p>`; }
    parts.push(`<section class="q" id="${esc(q.id)}">
<h3>${esc(q.number)} <small>${q.marks} mark${q.marks === 1 ? '' : 's'} · ${esc(q.id)}.cdxml</small></h3>
<div class="drawing">${svg}</div>
${p.warnings.length ? `<ul class="warn">${p.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
<div class="cols">
<div><h4>The model receives</h4><pre>${esc(q.prompt)}\n\nEnd with "ANSWER: " and ${esc(ANSWER_FORMAT[q.answer.kind])}.</pre></div>
<div><h4>Marked as</h4><p><b>${q.answer.kind}</b>: ${esc(MARKING[q.answer.kind])}</p><pre>${keyText(q.answer).map(esc).join('\n')}</pre></div>
</div>
</section>`);
  }
}
const html = `<!doctype html><meta charset="utf-8"><title>HexSketch LLM benchmark: the exam</title>
<style>
body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:1100px;margin:24px auto;padding:0 20px;color:#1a222b}
h1 small,h2 small,h3 small{font-weight:normal;color:#5b6875;font-size:.8em;margin-left:.5em}
.plan{color:#5b6875;font-size:.9em}
.q{border:1px solid #d9dfe5;border-radius:8px;padding:16px 20px;margin:16px 0}
.drawing{background:#fff;border:1px solid #e6eaee;padding:12px;overflow:auto}.drawing svg{max-width:100%;height:auto}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:12px}@media(max-width:800px){.cols{grid-template-columns:1fr}}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f3f5f7;padding:10px;border-radius:6px;font-size:.85em}
.warn{color:#b3261e}h4{margin:0 0 6px;font-size:.8em;text-transform:uppercase;letter-spacing:.05em;color:#5b6875}
table{border-collapse:collapse}td,th{border-bottom:1px solid #d9dfe5;padding:4px 10px;text-align:left}
</style>
<h1>The exam <small>${questions.length} questions, ${total} of ${blueprint.total} marks</small></h1>
<table><tr><th>Section</th><th>Marks written</th><th>Planned</th></tr>${blueprint.sections.map((s) => `<tr><td>${s.section}. ${esc(s.title)}</td><td>${marksIn(s.section)}</td><td>${s.marks}</td></tr>`).join('')}</table>
${parts.join('\n')}`;
writeFileSync(new URL('paper.html', examDir), html);
console.log(`Wrote questions.jsonl and exam/paper.html.`);
