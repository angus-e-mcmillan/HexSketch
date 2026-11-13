/**
 * The answer sheet: every question of the paper in one HexSketch document,
 * each under a caption naming it, with room below to draw the answer.
 *
 *   npm run llm-bench:sheet [-- --set NAME]
 *
 * The chemist opens answer-sheet.cdxml in HexSketch, draws each
 * answer in the space under its heading, and saves. Answers are matched to
 * questions by the heading above them, not by where they sit, so there is no
 * need to keep to the spacing. `npm run llm-bench:sat` then marks it.
 */
import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { readStructure } from '../../packages/agent/src/index.ts';
import { makeCaption, writeCdxml, type DocObject, type Molecule } from '../../packages/core/src/index.ts';
import { loadQuestions } from './questions.ts';

const { values: opt } = parseArgs({ options: { set: { type: 'string' } } });
const questions = loadQuestions(opt.set);
if (!questions.length) throw new Error('No questions: run npm run llm-bench:prep first');

/** Room to draw in, under each question: more for an answer with several structures. */
const ROOM: Record<string, number> = { reaction: 150, multistep: 220, mechanism: 260, retrosynthesis: 180, route: 260, structure: 150, analysis: 150, hazard: 170 };

const { style } = await readStructure(questions.find((q) => q.drawing)?.drawing ?? 'C', {});
const sheet = (await readStructure('C', { format: 'smiles' })).mol;
for (const a of [...sheet.atoms()]) sheet.removeAtom(a.id);
const objects: DocObject[] = [];
let y = 40;

for (const q of questions) {
  const head = `${q.id}  —  ${q.ask}  [${q.marks}]`;
  objects.push(makeCaption(40, y, head, [{ text: head, script: 'formula' }], 'left'));
  y += style.captionSize * 2;
  if (q.drawing) {
    // The question as the chemist drew it, moved down the page under its heading.
    const d = await readStructure(q.drawing);
    const ys = [...d.mol.atoms()].map((a) => a.y), xs = [...d.mol.atoms()].map((a) => a.x);
    const top = Math.min(...ys, ...d.objects.flatMap((o) => (o.kind === 'text' ? [o.y] : o.kind === 'arrow' ? [o.tail.y, o.head.y] : o.points.map((p) => p.y))));
    const dx = 40 - Math.min(...xs, Infinity), dy = y - top;
    const ids = new Map<number, number>();
    for (const a of d.mol.atoms()) ids.set(a.id, sheet.addAtom({ ...a, x: a.x + (Number.isFinite(dx) ? dx : 0), y: a.y + dy }).id);
    for (const b of d.mol.bonds()) sheet.addBond({ ...b, begin: ids.get(b.begin)!, end: ids.get(b.end)! });
    for (const o of d.objects) {
      const moved = structuredClone(o) as DocObject;
      if (moved.kind === 'text') { moved.x += Number.isFinite(dx) ? dx : 0; moved.y += dy; }
      else if (moved.kind === 'arrow') { for (const p of [moved.tail, moved.head]) { p.x += Number.isFinite(dx) ? dx : 0; p.y += dy; } }
      else for (const p of moved.points) { p.x += Number.isFinite(dx) ? dx : 0; p.y += dy; }
      objects.push(moved);
    }
    const bottom = Math.max(...[...d.mol.atoms()].map((a) => a.y + dy), y);
    y = bottom;
  }
  y += ROOM[q.type] ?? 160;
}

const file = new URL(opt.set ? `answer-sheet-${opt.set}.cdxml` : 'answer-sheet.cdxml', import.meta.url);
writeFileSync(file, writeCdxml(sheet, style, objects));
console.log(`${questions.length} questions, ${questions.reduce((t, q) => t + q.marks, 0)} marks: ${file.pathname}`);
console.log('Open it in HexSketch, draw each answer under its heading, save it, then: npm run llm-bench:sat -- --file <the saved file>');
