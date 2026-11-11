/**
 * Reads one question from a HexSketch drawing (File › Save as CDXML). The
 * convention, in full in questions/README.md:
 *
 *   - Above a caption that says "Answer": the question as the chemist would
 *     put it. Structures, arrows with reagents above and conditions below,
 *     "?" for what is asked: this is what is in the editor. A caption that
 *     starts "Q:" is what the chemist types in the chat; "[4]" at its end
 *     is what a right answer earns.
 *   - Below "Answer": the answer. One structure; several (any order); or
 *     structures with arrows between them (a sequence, in order). For a
 *     question about atoms ("which nitrogen is the most basic?"), the
 *     structure again with the atom highlighted, or with 1, 2, 3 written
 *     beside atoms for a ranking. Or, with nothing drawn, the answer written
 *     after "Answer:": a number ("8.1 ± 1") or a word ("sp2", alternatives
 *     joined by " / ").
 *   - Below "Also accept": another answer that is right too.
 *   - A caption "Hazard: HCN, hydrogen cyanide, cyanide" anywhere: the reply
 *     should warn of it, and any of these words counts.
 */
import { readCdxmlDocument, readCdxmlStyle, writeCdxml, writeSmiles, type Arrow, type Caption, type DocObject, type DrawingStyle, type Molecule } from '../../packages/core/src/index.ts';
import { TYPES, type Key, type Question, type QuestionType } from './questions.ts';

type Pt = { x: number; y: number };
interface Box { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number }
interface Fragment { ids: number[]; mol: Molecule; smiles: string; box: Box }

const ANSWER = /^answers?\b\s*:?/i;
const ALSO = /^also\s+accept(?:ed)?\b\s*:?/i;
const ASK = /^q(?:uestion)?\s*:\s*/i;
const HAZARD = /^hazards?\s*:\s*/i;
const isSchemeArrow = (o: DocObject): o is Arrow => o.kind === 'arrow' && !o.curve && !o.arc;
const isRetro = (a: Arrow) => a.headStyle === 'hollow' && a.shaftSpacing > 0;
const isEquilibrium = (a: Arrow) => a.shaftSpacing > 0 && a.headStyle !== 'hollow' && a.tailEnd !== 'none';
const mid = (a: Arrow): Pt => ({ x: (a.tail.x + a.head.x) / 2, y: (a.tail.y + a.head.y) / 2 });

export interface ReadQuestion { question: Question; warnings: string[] }

export function readQuestionDrawing(xml: string, id: string): ReadQuestion {
  const warnings: string[] = [];
  const type = TYPES.find((t) => id.toLowerCase().startsWith(t));
  if (!type) throw new Error(`the file name must start with the question type: ${TYPES.join(', ')} (e.g. reaction-1.cdxml)`);
  const doc = readCdxmlDocument(xml);
  const style = readCdxmlStyle(xml);
  const L = style.bondLength;
  const captions = doc.objects.filter((o): o is Caption => o.kind === 'text' && !!o.text.trim());
  const arrows = doc.objects.filter(isSchemeArrow);
  const fragments = splitFragments(doc.mol);

  const answer = captions.filter((c) => ANSWER.test(c.text.trim())).sort((a, b) => a.y - b.y)[0];
  if (!answer) throw new Error('no caption says "Answer": write one, and draw the answer below it');
  const alsos = captions.filter((c) => ALSO.test(c.text.trim()) && c.y > answer.y).sort((a, b) => a.y - b.y);
  const cuts = [answer.y, ...alsos.map((c) => c.y), Infinity];
  const regionOf = (y: number) => { let r = 0; while (y >= cuts[r]!) r++; return r; }; // 0 question, 1 answer, 2+ also accept
  for (const f of fragments) if (regionOf(f.box.y0 + L * 0.2) !== regionOf(f.box.y1 - L * 0.2)) warnings.push(`a structure (${f.smiles}) lies across the "Answer" or "Also accept" line: move it clearly above or below`);

  const special = (c: Caption) => ANSWER.test(c.text.trim()) || ALSO.test(c.text.trim()) || HAZARD.test(c.text.trim());
  const hazardCaption = captions.find((c) => HAZARD.test(c.text.trim()));
  const hazard = hazardCaption ? hazardCaption.text.trim().replace(HAZARD, '').split(/[,;\n]/).map((w) => w.trim()).filter(Boolean) : undefined;
  if (type === 'hazard' && !hazard?.length) throw new Error('a hazard question needs a caption "Hazard: " with the words that count as a warning');

  // -------------------------------------------------------------- question
  const qFragments = readingOrder(fragments.filter((f) => regionOf(f.box.cy) === 0).map((f) => ({ box: f.box, f }))).map((x) => x.f);
  const qArrows = arrows.filter((a) => regionOf(mid(a).y) === 0);
  const qCaptions = captions.filter((c) => regionOf(c.y) === 0 && !special(c));
  const askCaption = qCaptions.find((c) => ASK.test(c.text.trim()));
  if (!askCaption) throw new Error('no caption starting "Q:" with what the chemist asks');
  const asked = askCaption.text.trim().replace(ASK, '').trim();
  // Marks at the end of the question, "[4]" or "[4 marks]": part of the paper, not of what the chemist types.
  const marked = /\s*\[\s*(\d+(?:\.\d+)?)\s*(?:marks?)?\s*\]\s*$/i.exec(asked);
  const ask = marked ? asked.slice(0, marked.index).trim() : asked;
  const marks = marked ? Number(marked[1]) : 1;
  if (!marked) warnings.push('no marks: end the question with them, e.g. "[4]"; counted as 1');
  const { lines: scheme } = describeScheme(qArrows, qFragments, qCaptions.filter((c) => c !== askCaption), L, style);
  const given = qFragments.map((f) => f.smiles);

  // The editor's content: everything above "Answer" except the chat question (and the hazard tag).
  const keepAtoms = new Set(qFragments.flatMap((f) => f.ids));
  const shown = doc.mol.clone();
  for (const a of doc.mol.atoms()) if (!keepAtoms.has(a.id)) shown.removeAtom(a.id);
  const shownObjects = doc.objects.filter((o) => o !== askCaption && !(o.kind === 'text' && special(o)) && regionOf(o.kind === 'arrow' ? mid(o).y : o.kind === 'text' ? o.y : o.points[0]!.y) === 0);
  const drawing = shown.atomCount || shownObjects.length ? writeCdxml(shown, style, shownObjects) : '';

  // ---------------------------------------------------------------- answer
  const atomMarks = { mol: doc.mol, captions: captions.filter((c) => !special(c)), L, style };
  let key = readKey(1, fragments, arrows, regionOf, warnings, atomMarks) ?? readWrittenKey(answer.text.trim().replace(ANSWER, '').trim());
  if (!key) throw new Error('nothing drawn below "Answer", and nothing written after "Answer:"');
  for (let r = 2; r < cuts.length; r++) {
    const alt = readKey(r, fragments, arrows, regionOf, warnings, atomMarks);
    if (!alt) continue;
    if (alt.kind !== key.kind) { warnings.push(`"Also accept" ${r - 1} is a ${alt.kind}, the answer a ${key.kind}: ignored`); continue; }
    if (key.kind === 'structure' && alt.kind === 'structure') (key.also ??= []).push(alt.smiles);
    else if (key.kind === 'structures' && alt.kind === 'structures') (key.also ??= []).push(alt.smiles);
    else if (key.kind === 'sequence' && alt.kind === 'sequence') (key.also ??= []).push(alt.stages);
  }
  // A route question: what is drawn under "Answer" (and each "Also accept") is a last step the chemist accepts, its building blocks.
  if (type === 'route') {
    const sets = key.kind === 'structure' ? [[key.smiles], ...(key.also ?? []).map((s) => [s])] : key.kind === 'structures' ? [key.smiles, ...(key.also ?? [])] : null;
    if (!sets) throw new Error('a route question\'s answer is the building blocks of an accepted last step: draw them, without arrows, under "Answer" (others under "Also accept")');
    if (given.length !== 1) throw new Error('a route question shows one target');
    const steps = /(?:at most|in|within|no more than)\s+(\d+)\s+steps?/i.exec(ask);
    if (!steps) warnings.push('the question does not say how many steps ("in at most 3 steps"): 4 allowed');
    key = { kind: 'route', target: given[0]!, accepted: sets, maxSteps: steps ? Number(steps[1]) : 4 };
  }
  if (type === 'mechanism' && key.kind !== 'sequence') warnings.push('a mechanism answer is usually a sequence: draw its structures with arrows between them');

  return {
    question: { id, type: type as QuestionType, ask, marks, drawing, given, scheme, key, ...(hazard ? { hazard } : {}) },
    warnings,
  };
}

/** The answer written after "Answer:": a number (with "± tolerance"), or else a word or phrase (alternatives joined by " / " or " or "). */
function readWrittenKey(text: string): Key | null {
  if (!text) return null;
  const num = /^(-?\d+(?:\.\d+)?)\s*(?:(?:±|\+\/-|\+-)\s*(\d+(?:\.\d+)?))?$/.exec(text);
  if (num) {
    const decimals = (num[1]!.split('.')[1] ?? '').length;
    return { kind: 'number', value: Number(num[1]), tolerance: num[2] ? Number(num[2]) : 0.5 * 10 ** -decimals };
  }
  return { kind: 'term', accept: text.split(/\s*(?:\/|\bor\b)\s*/).map((x) => x.trim()).filter(Boolean) };
}

/** A structure's SMILES with atom-map numbers on the given atoms ([NH:1]), as atoms are pointed at in text. */
function withMaps(f: Fragment, maps: { atom: number; map: number }[]): string {
  // Mark each atom with an isotope no element has, write the SMILES, then turn the marks into map numbers.
  const m = f.mol.clone();
  for (const { atom, map } of maps) m.atom(atom).isotope = 900 + map;
  return writeSmiles(m).replace(/\[9(\d\d)([^\]]*)\]/g, (_, n: string, rest: string) => `[${rest}:${Number(n)}]`);
}

interface Marks { mol: Molecule; captions: Caption[]; L: number; style: DrawingStyle }

/**
 * The answer drawn in region `r`: one structure, a set, or stages along
 * arrows; or one structure with atoms highlighted (the atoms asked for), or
 * with 1, 2, 3 beside atoms (a ranking).
 */
function readKey(r: number, fragments: Fragment[], arrows: Arrow[], regionOf: (y: number) => number, warnings: string[], marks: Marks): Key | null {
  const frags = fragments.filter((f) => regionOf(f.box.cy) === r);
  const arrs = arrows.filter((a) => regionOf(mid(a).y) === r);
  if (!frags.length) return null;
  if (frags.length === 1 && !arrs.length) {
    const f = frags[0]!;
    // Numbers beside atoms: each marks the nearest atom of the structure.
    const ranked: { atom: number; map: number }[] = [];
    for (const c of marks.captions) {
      if (regionOf(c.y) !== r || !/^\d{1,2}$/.test(c.text.trim())) continue;
      const b = captionBox(c, marks.style);
      let best: { atom: number; d: number } | null = null;
      for (const id of f.ids) { const a = marks.mol.atom(id), d = Math.hypot(a.x - b.cx, a.y - b.cy); if (d < marks.L * 1.3 && (!best || d < best.d)) best = { atom: id, d }; }
      if (best) ranked.push({ atom: best.atom, map: Number(c.text.trim()) });
    }
    if (ranked.length) {
      const nums = ranked.map((x) => x.map).sort((a, b) => a - b);
      if (nums.some((n, i) => n !== i + 1)) throw new Error(`the numbers beside atoms in the answer must run 1, 2, 3… (found ${nums.join(', ')})`);
      return { kind: 'ranking', smiles: withMaps(f, ranked) };
    }
    const lit = f.ids.filter((id) => marks.mol.atom(id).highlight);
    if (lit.length) return { kind: 'atoms', smiles: withMaps(f, lit.map((atom, i) => ({ atom, map: i + 1 }))) };
  }
  if (!arrs.length) return frags.length === 1 ? { kind: 'structure', smiles: frags[0]!.smiles } : { kind: 'structures', smiles: readingOrder(frags.map((f) => ({ box: f.box, f }))).map((x) => x.f.smiles) };
  const items = readingOrder([...frags.map((f) => ({ box: f.box, f, a: null as Arrow | null })), ...arrs.map((a) => ({ box: arrowBox(a), f: null as Fragment | null, a }))]);
  const stages: string[][] = [[]];
  for (const it of items) { if (it.a) { if (stages.at(-1)!.length) stages.push([]); } else stages.at(-1)!.push(it.f!.smiles); }
  const filled = stages.filter((s) => s.length);
  if (filled.length < 2) { warnings.push('arrows in the answer, but no structures on both sides of them: read as a set'); return { kind: 'structures', smiles: frags.map((f) => f.smiles) }; }
  return { kind: 'sequence', stages: filled };
}

/** The arrows of the question as a chemist would type them. */
function describeScheme(arrows: Arrow[], given: Fragment[], captions: Caption[], L: number, style: DrawingStyle): { lines: string[] } {
  const lines: string[] = [];
  const nameOf = (f: Fragment) => `Structure ${given.indexOf(f) + 1}`;
  for (const a of [...arrows].sort((p, q) => mid(p).y - mid(q).y || mid(p).x - mid(q).x)) {
    const x0 = Math.min(a.tail.x, a.head.x) - L * 0.5, x1 = Math.max(a.tail.x, a.head.x) + L * 0.5, y = mid(a).y;
    const near = captions.filter((c) => { const b = captionBox(c, style); return b.cx >= x0 && b.cx <= x1 && Math.abs(b.cy - y) < L * 1.6 && !/^\?+$/.test(c.text.trim()); })
      .sort((p, q) => p.y - q.y);
    const above = near.filter((c) => captionBox(c, style).cy < y).map((c) => c.text.trim().replace(/\n/g, ', '));
    const below = near.filter((c) => captionBox(c, style).cy >= y).map((c) => c.text.trim().replace(/\n/g, ', '));
    const side = (end: Pt) => {
      const fs = fragmentsAt(given, a, end, L);
      if (fs.length) return fs.map(nameOf).join(' + ');
      return captions.some((c) => /^\?+$/.test(c.text.trim()) && Math.hypot(c.x - end.x, c.y - end.y) < L * 3) ? '?' : '?';
    };
    const arrow = isRetro(a) ? '⇒' : isEquilibrium(a) ? '⇌' : '→';
    const notes = [above.length ? `above the arrow: ${above.join('; ')}` : '', below.length ? `below it: ${below.join('; ')}` : ''].filter(Boolean).join('; ');
    lines.push(`${side(a.tail)} ${arrow} ${side(a.head)}${notes ? `  (${notes})` : ''}`);
  }
  return { lines };
}

/** The structures at one end of an arrow: the nearest, and those beside it on the same side ("A + B →"). */
function fragmentsAt(given: Fragment[], a: Arrow, end: Pt, L: number): Fragment[] {
  const other = end === a.tail ? a.head : a.tail;
  const dir = Math.sign(end.x - other.x) || 1;
  let nearest: Fragment | null = null, d = L * 4;
  for (const f of given) {
    const dist = Math.hypot(Math.max(f.box.x0 - end.x, 0, end.x - f.box.x1), Math.max(f.box.y0 - end.y, 0, end.y - f.box.y1));
    if (dist < d) { d = dist; nearest = f; }
  }
  if (!nearest) return [];
  const n = nearest;
  return given.filter((f) => f === n || ((f.box.cx - end.x) * dir > 0 && f.box.y0 < n.box.y1 && f.box.y1 > n.box.y0 && Math.abs(f.box.cx - n.box.cx) < L * 10))
    .sort((p, q) => p.box.cx - q.box.cx);
}

function splitFragments(mol: Molecule): Fragment[] {
  return mol.fragments().map((ids) => {
    const keep = new Set(ids);
    const part = mol.clone();
    for (const a of mol.atoms()) if (!keep.has(a.id)) part.removeAtom(a.id);
    const xs = ids.map((i) => mol.atom(i).x), ys = ids.map((i) => mol.atom(i).y);
    return { ids, mol: part, smiles: writeSmiles(part), box: box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)) };
  });
}

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });

function captionBox(c: Caption, style: DrawingStyle): Box {
  const size = c.runs?.[0]?.size ?? style.captionSize ?? 10;
  const lines = c.text.split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.55, h = lines.length * size * 1.2;
  const x0 = c.align === 'center' ? c.x - w / 2 : c.align === 'right' ? c.x - w : c.x;
  return box(x0, c.y - size, x0 + w, c.y - size + h);
}

const arrowBox = (a: Arrow): Box => box(Math.min(a.tail.x, a.head.x), Math.min(a.tail.y, a.head.y), Math.max(a.tail.x, a.head.x), Math.max(a.tail.y, a.head.y));

/** Reading order: rows of things that overlap vertically, top to bottom; left to right within a row. */
function readingOrder<T extends { box: Box }>(items: T[]): T[] {
  const rows: T[][] = [];
  for (const it of [...items].sort((a, b) => a.box.y0 - b.box.y0)) {
    const row = rows.find((r) => r.some((o) => (it.box.cy > o.box.y0 && it.box.cy < o.box.y1) || (o.box.cy > it.box.y0 && o.box.cy < it.box.y1)));
    if (row) row.push(it); else rows.push([it]);
  }
  rows.sort((a, b) => Math.min(...a.map((o) => o.box.cy)) - Math.min(...b.map((o) => o.box.cy)));
  return rows.flatMap((r) => r.sort((a, b) => a.box.cx - b.box.cx));
}
