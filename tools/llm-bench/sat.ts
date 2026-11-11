/**
 * The chemist sits the paper: one HexSketch document holding every answer,
 * each under the heading of the question it answers, marked exactly as a
 * model's answers are.
 *
 *   npm run llm-bench:sat -- --file answers.cdxml [--set NAME] [--who "Angus"]
 *
 * Answers are matched by the heading above them, so they may be moved and
 * spaced however suits. What is drawn under a heading is read the same way
 * the answer in a question file is read: one structure, a set of them,
 * stages along arrows, atoms highlighted, 1/2/3 beside atoms, or an
 * "Answer: ..." caption for a number or a word. Any other text under the
 * heading counts as what the chemist said, so a hazard question's warning is
 * found there.
 *
 * Writes results/<run>.json and .md, in the same shape as a model's run, so
 * the paper's ceiling sits beside the models in the figures.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { drawnOut, readStructure } from '../../packages/agent/src/index.ts';
import { readCdxmlDocument, readCdxmlStyle, writeCdxml, type Caption, type DocObject } from '../../packages/core/src/index.ts';
import { captionBox, isSchemeArrow, mid, readKey, readWrittenKey, splitFragments } from './drawing.ts';
import { finalAnswer, measure, opsin } from './measure.ts';
import { countBy, loadQuestions, TYPES, type Key, type Question } from './questions.ts';

const { values: opt } = parseArgs({ options: { file: { type: 'string' }, set: { type: 'string' }, who: { type: 'string', default: 'the chemist' }, run: { type: 'string' } } });
if (!opt.file) throw new Error('Give --file, the answer sheet saved from HexSketch');
const questions = loadQuestions(opt.set);
if (!questions.length) throw new Error('No questions: run npm run llm-bench:prep first');

const xml = readFileSync(opt.file, 'utf8');
const read = readCdxmlDocument(xml);
const style = readCdxmlStyle(xml);
// A chemist draws Boc, Cbz and the rest as abbreviations: drawn out, so the answer is compared atom for atom.
const doc = { ...read, mol: drawnOut(read.mol, style) };
const L = style.bondLength;
const captions = doc.objects.filter((o): o is Caption => o.kind === 'text' && !!o.text.trim());

// The heading of each question, in the order they run down the page.
const heads = questions
  .map((q) => ({ q, caption: captions.find((c) => new RegExp(`^\\s*${q.id}\\b`, 'i').test(c.text.trim())) }))
  .filter((x): x is { q: Question; caption: Caption } => !!x.caption)
  .sort((a, b) => a.caption.y - b.caption.y);
const missing = questions.filter((q) => !heads.some((h) => h.q.id === q.id));
if (!heads.length) throw new Error(`No question headings found. Each answer goes under a caption naming its question, e.g. "${questions[0]!.id}".`);

// Everything between one heading and the next belongs to that question; the answer to the last runs to the foot of the page.
const cuts = heads.map((h) => h.caption.y);
const regionOf = (y: number) => { let r = -1; while (r + 1 < cuts.length && y >= cuts[r + 1]!) r++; return r; };
const fragments = splitFragments(doc.mol);
const arrows = doc.objects.filter(isSchemeArrow);
// The question's own drawing is on the sheet too: only what lies below it is an answer.
const drawnByChemist = new Set(fragments);
for (const { q, caption } of heads) {
  if (!q.drawing) continue;
  const q0 = await readStructure(q.drawing);
  const shown = splitFragments(drawnOut(q0.mol, q0.style)).map((f) => f.smiles);
  const r = regionOf(caption.y + 1);
  const here = fragments.filter((f) => regionOf(f.box.cy) === r).sort((a, b) => a.box.cy - b.box.cy);
  for (const f of here) { const i = shown.indexOf(f.smiles); if (i >= 0) { shown.splice(i, 1); drawnByChemist.delete(f); } }
}

/** The answer line a model would have written, from what the chemist drew. */
function asAnswer(key: Key): string {
  switch (key.kind) {
    case 'structure': return key.smiles;
    case 'structures': return key.smiles.join('.');
    case 'sequence': return key.stages.map((s) => s.join('.')).join(' >> ');
    case 'atoms': case 'ranking': return key.smiles;
    case 'number': return String(key.value);
    case 'term': return key.accept[0] ?? '';
    default: return '';
  }
}

interface Row { id: string; type: string; marks: number; got: number; correct: boolean; note: string }
const rows: Row[] = [];
const records: Record<string, unknown>[] = [];
const warnings: string[] = [];

for (const [i, { q }] of heads.entries()) {
  const mine = fragments.filter((f) => drawnByChemist.has(f) && regionOf(f.box.cy) === i);
  const myArrows = arrows.filter((a) => regionOf(mid(a).y) === i);
  const myCaptions = captions.filter((c) => regionOf(c.y) === i && !new RegExp(`^\\s*${q.id}\\b`, 'i').test(c.text.trim()));
  const written = myCaptions.map((c) => c.text.trim()).join('\n');

  let key: Key | null = null;
  try {
    key = readKey(i, mine, myArrows, (y) => regionOf(y), warnings, { mol: doc.mol, captions: myCaptions, L, style })
      ?? readWrittenKey(written.replace(/^answers?\s*:?\s*/i, ''));
  } catch (e) { warnings.push(`${q.id}: ${(e as Error).message}`); }

  if (!key) { rows.push({ id: q.id, type: q.type, marks: q.marks, got: 0, correct: false, note: 'nothing drawn' }); continue; }
  const answer = asAnswer(key);
  // What the chemist drew, as the editor would hold it, so orientation is measured as it is for a model.
  const ids = new Set(mine.flatMap((f) => f.ids));
  const drawing = doc.mol.clone();
  for (const a of doc.mol.atoms()) if (!ids.has(a.id)) drawing.removeAtom(a.id);
  const drawn = drawing.atomCount ? writeCdxml(drawing, style, [] as DocObject[]) : null;

  const final = `${written}\nANSWER: ${answer}`;
  const named = null;
  const m = await measure(q, `${written}\n${answer}`, final, named, drawn);
  // The chemist writes no IUPAC name, so there is nothing to check a name against.
  const got = m.correct ? q.marks : 0;
  rows.push({ id: q.id, type: q.type, marks: q.marks, got, correct: m.correct, note: m.correct ? '' : `answered ${finalAnswer(final).answer ?? ''}`.slice(0, 80) });
  records.push({ key: `${q.id}.human.1`, id: q.id, type: q.type, condition: 'human', repeat: 1, model: opt.who, ...m, consistent: null, marks: got, drawn, final, text: written, tokens: { prompt: 0, completion: 0, reasoning: 0 }, cost: 0, ms: 0, rounds: 0, tools: [] });
}

// ------------------------------------------------------------------ summary

const total = questions.reduce((t, q) => t + q.marks, 0);
const score = rows.reduce((t, r) => t + r.got, 0);
const typesIn = TYPES.filter((t) => questions.some((q) => q.type === t));
const marksOf = (type?: string) => questions.filter((q) => !type || q.type === type).reduce((t, q) => t + q.marks, 0);
const rate = (pick: (r: Record<string, unknown>) => unknown) => {
  const applies = records.filter((r) => pick(r) !== null && pick(r) !== undefined);
  return { rate: applies.length ? applies.filter((r) => pick(r)).length / applies.length : null, n: applies.length };
};
const run = opt.run ?? `sat-${new Date().toISOString().slice(0, 10)}`;
const here = new URL('.', import.meta.url);
const summary = {
  run, model: opt.who, when: new Date().toISOString(),
  settings: { effort: 'n/a', maxTokens: 0, repeats: 1 },
  questions: { count: questions.length, marks: total, types: countBy(questions, (q) => q.type) },
  conditions: {
    human: {
      score, scoreRange: [score, score], outOf: total,
      byType: Object.fromEntries(typesIn.map((t) => [t, { score: rows.filter((r) => r.type === t).reduce((a, b) => a + b.got, 0), outOf: marksOf(t) }])),
      correct: rate((r) => r.correct), stereo: rate((r) => r.stereo), valid: rate((r) => r.valid), consistent: { rate: null, n: 0 },
      preserved: rate((r) => r.preserved), flagged: rate((r) => r.flagged), oriented: rate((r) => r.oriented),
      refused: 0, cutOff: 0, cost: 0, tokens: 0, reasoning: 0, prompt: 0, cachedPrompt: 0, seconds: 0, toolCalls: 0,
    },
  },
  perQuestion: rows.map((r) => ({ id: r.id, type: r.type, marks: r.marks, human: { right: r.correct ? 1 : 0, of: 1, refused: 0, cutOff: 0, promptTokens: 0, outputTokens: 0, thinkingTokens: 0, cost: 0, seconds: 0, toolCalls: 0 } })),
};
writeFileSync(new URL(`results/${run}.json`, here), JSON.stringify(summary, null, 2) + '\n');
const md = [
  `# ${run}`, '', `${opt.who} sat the paper: ${score} / ${total}.`, '',
  '| Question | Marks | Got | |', '|---|---|---|---|',
  ...rows.map((r) => `| ${r.id} | ${r.marks} | ${r.got} | ${r.correct ? 'right' : r.note} |`),
  '', ...typesIn.map((t) => `- ${t}: ${rows.filter((r) => r.type === t).reduce((a, b) => a + b.got, 0)} / ${marksOf(t)}`),
].join('\n');
writeFileSync(new URL(`results/${run}.md`, here), md + '\n');

for (const w of warnings) console.warn(w);
if (missing.length) console.warn(`No heading found for: ${missing.map((q) => q.id).join(', ')}`);
console.log(`${opt.who}: ${score} / ${total}`);
for (const r of rows) console.log(`  ${r.id.padEnd(18)} ${String(r.got).padStart(2)} / ${r.marks}  ${r.correct ? '' : r.note}`);
console.log(`\nresults/${run}.md`);
