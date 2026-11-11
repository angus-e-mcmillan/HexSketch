/**
 * Builds questions.jsonl from the HexSketch drawings in questions/ (one per
 * question, saved with File › Save as CDXML), checks every answer reads, and
 * writes questions/questions.html: each question as drawn, what the model
 * receives with and without HexSketch, and the answer. Open it to proofread
 * the questions before a run.
 *
 *   npm run llm-bench:prep [-- --set NAME]   (NAME: questions/NAME/ to questions-NAME.jsonl)
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { readStructure } from '../../packages/agent/src/index.ts';
import { readQuestionDrawing } from './drawing.ts';
import { countBy, questionsDir, questionsFile, TYPES, type Question } from './questions.ts';
import { keySmiles, writeQuestionsPage } from './report.ts';

const { values: opt } = parseArgs({ options: { set: { type: 'string' } } });
const dir = questionsDir(opt.set);
const files = readdirSync(dir).filter((f) => f.endsWith('.cdxml')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
const questions: Question[] = [];
const warnings = new Map<string, string[]>();
const problems: string[] = [];
for (const f of files) {
  const id = f.replace(/\.cdxml$/, '');
  try {
    const { question, warnings: w } = readQuestionDrawing(readFileSync(new URL(f, dir), 'utf8'), id);
    for (const s of keySmiles(question.key)?.split(/>>|\./) ?? []) await readStructure(s);
    questions.push(question);
    if (w.length) warnings.set(id, w);
  } catch (e) { problems.push(`${f}: ${(e as Error).message}`); }
}
for (const [id, w] of warnings) for (const x of w) console.warn(`${id}: ${x}`);
if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
questions.sort((a, b) => TYPES.indexOf(a.type) - TYPES.indexOf(b.type) || a.id.localeCompare(b.id, undefined, { numeric: true }));
writeFileSync(questionsFile(opt.set), questions.map((q) => JSON.stringify(q)).join('\n') + (questions.length ? '\n' : ''));
await writeQuestionsPage(new URL('questions.html', dir), questions, warnings);
const n = countBy(questions, (q) => q.type);
console.log(`${questions.length} questions: ${TYPES.map((t) => `${t} ${n[t] ?? 0}`).join(', ')}. Proofread them in ${new URL('questions.html', dir).pathname}`);
