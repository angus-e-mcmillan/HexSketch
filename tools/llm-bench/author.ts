/**
 * Draws the paper: one CDXML question per spec in paper.ts, written into
 * questions/ exactly as HexSketch would save it (File › Save as CDXML), so a
 * question can be changed in one line of chemistry rather than redrawn, and
 * the whole paper can be rebuilt when the layout engine improves.
 *
 *   npm run llm-bench:author [-- --only reaction-1,hazard-2] [--set NAME]
 *
 * Every file is read back with the same reader prep.ts uses and checked
 * against the spec it came from: what the chemist asks, the marks, and the
 * answer, structure by structure. A question that does not read back as
 * meant is reported and not written.
 *
 * The layout is the one questions/README.md describes: the question at the
 * top as a chemist would have it in the editor, then "Q: … [4]", then
 * "Answer" and the answer, then any "Also accept", then any "Hazard:".
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { readStructure, scheme, type SchemeArrow, type Structure } from '../../packages/agent/src/index.ts';
import { depict } from '../../packages/render/src/index.ts';
import { cloneObjects, DEFAULT_STYLE, makeCaption, Molecule, objectPoints, smilesAtomMaps, writeCdxml, writeSmiles, type AtomId, type DocObject } from '../../packages/core/src/index.ts';
import { readQuestionDrawing } from './drawing.ts';
import { PAPER, type Answer, type Spec } from './paper.ts';
import { questionsDir } from './questions.ts';

const style = { ...DEFAULT_STYLE };
const L = style.bondLength;
/** A pastel marker, as the editor's Highlight Colors offer. */
const HIGHLIGHT = '#fff4a8';
/** Stands in for the answer in the question: drawn, then replaced by "?". */
const UNKNOWN = '[Xe]';

// Drawn out, not abbreviated: the reader takes each structure's SMILES from the drawing as it stands.
const read = (smiles: string) => readStructure(smiles);
const bounds = (s: Pick<Structure, 'mol' | 'objects'>) => depict(s.mol, style, s.objects).bounds;

/** One block of drawing: its structures and objects, with the top left at (0, 0). */
interface Block { mol: Molecule; objects: DocObject[]; width: number; height: number }

function blockOf(s: Pick<Structure, 'mol' | 'objects'>): Block {
  const b = bounds(s);
  const dx = -b.x0, dy = -b.y0;
  const mol = s.mol.clone();
  for (const a of mol.atoms()) { a.x += dx; a.y += dy; }
  const objects = cloneObjects(s.objects);
  for (const o of objects) for (const q of objectPoints(o)) { q.x += dx; q.y += dy; }
  return { mol, objects, width: b.x1 - b.x0, height: b.y1 - b.y0 };
}

/** Structures side by side, as a set of building blocks is drawn. */
async function row(smiles: string[]): Promise<Block> {
  const pieces = await Promise.all(smiles.map(read));
  const mol = new Molecule();
  const objects: DocObject[] = [];
  let x = 0, height = 0;
  for (const p of pieces) {
    const b = blockOf(p);
    const ids = new Map<AtomId, AtomId>();
    for (const a of b.mol.atoms()) ids.set(a.id, mol.addAtom({ ...a, x: a.x + x }).id);
    for (const bd of b.mol.bonds()) mol.addBond({ ...bd, begin: ids.get(bd.begin)!, end: ids.get(bd.end)! });
    for (const o of b.objects) { for (const q of objectPoints(o)) q.x += x; objects.push(o); }
    x += b.width + 1.8 * L;
    height = Math.max(height, b.height);
  }
  return { ...blockOf({ mol, objects }), width: Math.max(0, x - 1.8 * L), height };
}

/** The stages of a scheme with arrows between them; "?" is drawn as a question mark. */
async function stages(list: string[], arrows: SchemeArrow[] | undefined, like?: Molecule): Promise<Block> {
  if (list.length === 1) return row(list[0]!.split('.'));
  const s = await scheme({ stages: list.map((x) => (x === '?' ? UNKNOWN : x)), arrows }, { ...(like ? { like } : {}) });
  const blank = [...s.mol.atoms()].filter((a) => a.element === 'Xe');
  if (blank.length) {
    const x = blank.reduce((t, a) => t + a.x, 0) / blank.length, y = blank.reduce((t, a) => t + a.y, 0) / blank.length;
    for (const a of blank) s.mol.removeAtom(a.id);
    s.objects.push(makeCaption(x, y + style.captionSize * 0.4, '?', [{ text: '?', size: style.captionSize * 1.6 }], 'center'));
  }
  return blockOf(s);
}

/** The answer as drawn: structures side by side, stages along arrows, highlighted atoms, or numbers beside atoms. */
async function answerBlock(a: Answer): Promise<Block | null> {
  if ('written' in a) return null;
  if ('sequence' in a) return stages(a.sequence, a.sequence.slice(1).map(() => ({})));
  if ('structures' in a) return row(a.structures);
  const marked = 'atoms' in a ? a.atoms : a.ranking;
  const s = await readStructure(marked);
  const maps = [...smilesAtomMaps(s.mol)];
  if (!maps.length) throw new Error(`${'atoms' in a ? 'atoms' : 'ranking'}: mark the atoms with map numbers, e.g. [NH:1]`);
  if ('atoms' in a) {
    for (const [, id] of maps) s.mol.atom(id).highlight = HIGHLIGHT;
    return blockOf(s);
  }
  // A number beside each atom, set away from the structure's middle so it reads as that atom's.
  const b = blockOf(s);
  const ids = new Map([...s.mol.atoms()].map((a2, i) => [a2.id, [...b.mol.atoms()][i]!.id]));
  const cx = [...b.mol.atoms()].reduce((t, a2) => t + a2.x, 0) / b.mol.atomCount;
  const cy = [...b.mol.atoms()].reduce((t, a2) => t + a2.y, 0) / b.mol.atomCount;
  for (const [n, id] of maps) {
    const at = b.mol.atom(ids.get(id)!);
    const away = Math.hypot(at.x - cx, at.y - cy) || 1;
    const ux = (at.x - cx) / away, uy = (at.y - cy) / away;
    b.objects.push(makeCaption(at.x + ux * 0.62 * L, at.y + uy * 0.62 * L + style.captionSize * 0.4, String(n), undefined, 'center'));
  }
  return blockOf(b);
}

/** The page: blocks and captions down the page, the question first. */
class Page {
  mol = new Molecule();
  objects: DocObject[] = [];
  y = 0;
  block(b: Block): void {
    const ids = new Map<AtomId, AtomId>();
    for (const a of b.mol.atoms()) ids.set(a.id, this.mol.addAtom({ ...a, y: a.y + this.y }).id);
    for (const bd of b.mol.bonds()) this.mol.addBond({ ...bd, begin: ids.get(bd.begin)!, end: ids.get(bd.end)! });
    for (const o of b.objects) { for (const q of objectPoints(o)) q.y += this.y; this.objects.push(o); }
    this.y += b.height + 1.2 * L;
  }
  caption(text: string): void {
    this.y += style.captionSize;
    this.objects.push(makeCaption(0, this.y, text));
    this.y += style.captionSize * 0.9;
  }
}

// ------------------------------------------------------------------ the spec

/** The structures of an answer, in the order the reader will find them. */
const answerSmiles = async (a: Answer): Promise<string[]> => {
  if ('written' in a) return [];
  const list = 'sequence' in a ? a.sequence : 'structures' in a ? a.structures : ['atoms' in a ? a.atoms : a.ranking];
  return Promise.all(list.flatMap((x) => x.split('.')).map(async (x) => writeSmiles((await readStructure(x.replace(/:\d+\]/g, ']'), { format: 'smiles' })).mol)));
};

async function draw(spec: Spec): Promise<string> {
  const page = new Page();
  const q = await stages(spec.shown.stages, spec.shown.arrows);
  page.block(q);
  page.caption(`Q: ${spec.ask} [${spec.marks}]`);
  const answer = await answerBlock(spec.answer);
  page.caption('written' in spec.answer ? `Answer: ${spec.answer.written}` : 'Answer');
  if (answer) page.block(answer);
  for (const also of spec.also ?? []) {
    const b = await answerBlock(also);
    page.caption('written' in also ? `Also accept: ${also.written}` : 'Also accept');
    if (b) page.block(b);
  }
  if (spec.hazard?.length) page.caption(`Hazard: ${spec.hazard.join(', ')}`);
  return writeCdxml(page.mol, style, page.objects);
}

/** What the reader makes of the drawing, against what the spec meant. */
async function check(spec: Spec, xml: string): Promise<string[]> {
  const bad: string[] = [];
  const { question, warnings } = readQuestionDrawing(xml, spec.id);
  for (const w of warnings) bad.push(`warning: ${w}`);
  if (question.ask !== spec.ask) bad.push(`asks "${question.ask}", not "${spec.ask}"`);
  if (question.marks !== spec.marks) bad.push(`${question.marks} marks, not ${spec.marks}`);
  const shown = spec.shown.stages.filter((s) => s !== '?').flatMap((s) => s.split('.'));
  const wanted = await Promise.all(shown.map(async (s) => writeSmiles((await read(s)).mol)));
  const got = await Promise.all(question.given.map(async (s) => writeSmiles((await readStructure(s)).mol)));
  for (const s of wanted) { const i = got.indexOf(s); if (i < 0) bad.push(`the question does not show ${s}`); else got.splice(i, 1); }
  for (const s of got) bad.push(`the question shows ${s}, which the spec does not`);
  const want = await answerSmiles(spec.answer);
  const key = question.key;
  const have = key.kind === 'structure' ? [key.smiles] : key.kind === 'structures' ? key.smiles
    : key.kind === 'sequence' ? key.stages.flat() : key.kind === 'atoms' || key.kind === 'ranking' ? [key.smiles.replace(/:\d+\]/g, ']')] : [];
  const plain = await Promise.all(have.map(async (s) => writeSmiles((await readStructure(s)).mol)));
  if (want.length && (plain.length !== want.length || want.some((s, i) => s !== plain[i]))) {
    bad.push(`the answer reads as ${plain.join(' , ')}, not ${want.join(' , ')}`);
  }
  if ('written' in spec.answer && key.kind !== 'number' && key.kind !== 'term') bad.push(`"${spec.answer.written}" read as a ${key.kind}`);
  if ('atoms' in spec.answer && key.kind !== 'atoms') bad.push(`the highlighted atoms read as a ${key.kind}`);
  if ('ranking' in spec.answer && key.kind !== 'ranking') bad.push(`the numbered atoms read as a ${key.kind}`);
  const marks = (s: string) => [...s.matchAll(/:(\d+)\]/g)].map((m) => Number(m[1])).sort((a, b) => a - b).join(',');
  if (('atoms' in spec.answer || 'ranking' in spec.answer) && (key.kind === 'atoms' || key.kind === 'ranking')) {
    const meant = 'atoms' in spec.answer ? spec.answer.atoms : spec.answer.ranking;
    // Which atoms, by where the maps sit in the canonical SMILES the reader writes.
    const mine = await readStructure(meant), theirs = await readStructure(key.smiles);
    const canon = (m: Awaited<ReturnType<typeof readStructure>>) => {
      const mol = m.mol.clone();
      for (const [n, id] of smilesAtomMaps(m.mol)) mol.atom(id).isotope = 900 + n;
      return writeSmiles(mol);
    };
    if (canon(mine) !== canon(theirs)) bad.push(`the marked atoms are not the ones meant (${marks(meant)} meant)`);
  }
  if (JSON.stringify(question.hazard ?? null) !== JSON.stringify(spec.hazard ?? null)) bad.push(`the hazard words read as ${JSON.stringify(question.hazard ?? null)}`);
  return bad;
}

// ------------------------------------------------------------------- the run

const { values: opt } = parseArgs({ options: { only: { type: 'string' }, set: { type: 'string' } } });
const dir = questionsDir(opt.set);
mkdirSync(dir, { recursive: true });
const pick = opt.only?.split(',').map((x) => x.trim());
const specs = PAPER.filter((s) => !pick || pick.includes(s.id));
if (!specs.length) throw new Error(pick ? `No question called ${pick.join(', ')}` : 'paper.ts holds no questions');
const seen = new Map<string, string>();
let wrote = 0, failed = 0;
for (const spec of specs) {
  try {
    const xml = await draw(spec);
    const bad = await check(spec, xml);
    if (bad.length) { failed++; console.error(`${spec.id}:\n  ${bad.join('\n  ')}`); continue; }
    writeFileSync(new URL(`${spec.id}.cdxml`, dir), xml);
    wrote++;
    // A molecule two questions share lets one be answered from the other: every question gets its own.
    for (const s of await answerSmiles(spec.answer)) {
      const key = s.replace(/[^A-Za-z0-9@+\-()[\]=#\\/.]/g, '');
      if (key.length > 24 && seen.has(key) && seen.get(key) !== spec.id) console.warn(`${spec.id} reuses a structure from ${seen.get(key)}: ${s}`);
      if (key.length > 24) seen.set(key, spec.id);
    }
  } catch (e) { failed++; console.error(`${spec.id}: ${(e as Error).message}`); }
}
console.log(`${wrote} question${wrote === 1 ? '' : 's'} drawn in ${dir.pathname}${failed ? `, ${failed} not written` : ''}`);
if (failed) process.exit(1);
