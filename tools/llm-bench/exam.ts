/**
 * Reads one exam question from a HexSketch drawing (a CDXML file saved with
 * File › Save as CDXML). The convention, in full in exam/README.md:
 *
 *   - Above a caption that says "Answer": the question. Its text in captions
 *     ("3.2 Give the major product. [4]": section 3, question 2, 4 marks),
 *     the structures it shows, and any scheme (arrows, with reagents written
 *     above them and "?" for what is asked).
 *   - Below "Answer": the model answer. Structures drawn there are the key;
 *     arrows between them make it a sequence. "Answer: name", "Answer:
 *     formula", "Answer: exact mass" and "Answer: molecular weight" ask for
 *     that of the structure drawn below; "Answer: A, C" letters; "Answer:
 *     C9H8O4" or "Answer: 180.0423" a literal; "Answer: marked" a written
 *     answer the examiner marks against the text below.
 *   - Below a caption "Also accept": another answer that earns the marks.
 *
 * Regions are split by height on the page, so the examiner lays the question
 * out as on an exam paper: question at the top, answer underneath.
 */
import { computeMass, readCdxmlDocument, readCdxmlStyle, writeSmiles, type Arrow, type Caption, type DocObject, type DrawingStyle, type Molecule } from '../../packages/core/src/index.ts';
import type { Structure } from '../../packages/agent/src/index.ts';
import type { Answer, Question } from './questions.ts';

type Pt = { x: number; y: number };
interface Box { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number }

/** One connected structure in the drawing. */
interface Fragment { mol: Molecule; smiles: string; box: Box }

export interface ExamDrawing {
  question: Question;
  /** The whole drawing, for the preview. */
  drawing: Structure;
  warnings: string[];
}

const ANSWER = /^(?:model\s+)?answers?\b|^key\b|^mark(?:ing)?\s+scheme\b/i;
const ALSO = /^also\s+accept(?:ed|able)?\b|^or\b|^alternative(?:ly)?\b/i;
const isAnswer = (c: Caption) => ANSWER.test(c.text.trim());
const isAlso = (c: Caption) => ALSO.test(c.text.trim());
/** A straight reaction-type arrow (not a curly electron arrow, not an arc). */
const isSchemeArrow = (o: DocObject): o is Arrow => o.kind === 'arrow' && !o.curve && !o.arc;
const isRetro = (a: Arrow) => a.headStyle === 'hollow' && a.shaftSpacing > 0;
const isEquilibrium = (a: Arrow) => a.shaftSpacing > 0 && a.headStyle !== 'hollow' && a.tailEnd !== 'none';
const mid = (a: Arrow): Pt => ({ x: (a.tail.x + a.head.x) / 2, y: (a.tail.y + a.head.y) / 2 });
const hasStereo = (smiles: string) => /[@/\\]/.test(smiles);

export function parseExamDrawing(xml: string, id: string): ExamDrawing {
  const warnings: string[] = [];
  const doc = readCdxmlDocument(xml);
  const style = readCdxmlStyle(xml);
  const L = style.bondLength;
  const captions = doc.objects.filter((o): o is Caption => o.kind === 'text' && !!o.text.trim());
  const arrows = doc.objects.filter(isSchemeArrow);
  const fragments = splitFragments(doc.mol);

  // The markers that split the page: "Answer" first, then any "Also accept", in order down the page.
  const answers = captions.filter(isAnswer).sort((a, b) => a.y - b.y);
  if (!answers.length) throw new Error('no caption says "Answer": write one, and draw the model answer below it');
  if (answers.length > 1) warnings.push('more than one caption says "Answer"; the first (highest) one splits the page');
  const answer = answers[0]!;
  const alsos = captions.filter((c) => isAlso(c) && c.y > answer.y).sort((a, b) => a.y - b.y);
  const cuts = [answer.y, ...alsos.map((c) => c.y), Infinity];
  const regionOf = (y: number) => { let r = 0; while (y >= cuts[r]!) r++; return r; }; // 0 question, 1 key, 2+ alternatives

  for (const f of fragments) {
    const top = regionOf(f.box.y0 + L * 0.2), bottom = regionOf(f.box.y1 - L * 0.2);
    if (top !== bottom) warnings.push(`a structure (${f.smiles}) lies across the "${top === 0 ? 'Answer' : 'Also accept'}" line: move it clearly above or below`);
  }
  const inRegion = <T>(xs: T[], at: (x: T) => number, r: number) => xs.filter((x) => regionOf(at(x)) === r);
  const plainCaptions = captions.filter((c) => !isAnswer(c) && !isAlso(c));

  // ---------------------------------------------------------------- question
  const qFragments = inRegion(fragments, (f) => f.box.cy, 0);
  const qArrows = inRegion(arrows, (a) => mid(a).y, 0);
  const qCaptions = inRegion(plainCaptions, (c) => c.y, 0);
  for (const o of doc.objects) if (o.kind === 'arrow' && (o.curve || o.arc) && regionOf(o.tail.y) === 0) { warnings.push('a curly arrow in the question is not passed to the model (only its text and structures are)'); break; }
  const given = readingOrder(qFragments.map((f) => ({ box: f.box, f }))).map((x) => x.f);
  const { schemeLines, used } = describeScheme(qArrows, given, qCaptions, L);
  const textCaptions = readingOrder(qCaptions.filter((c) => !used.has(c)).map((c) => ({ box: captionBox(c, style), c }))).map((x) => x.c);
  const text = textCaptions.map((c) => c.text.trim()).join('\n').trim();
  if (!text) throw new Error('no question text above "Answer"');

  const numbered = /^\s*(?:q(?:uestion)?\s*)?(\d+)\s*[.)]\s*(\d+)\b/i.exec(text) ?? /^\s*(?:q(?:uestion)?\s*)?(\d+)\s*[.)]\s/i.exec(text);
  let section = 0, number = id;
  if (numbered) { section = Number(numbered[1]); number = numbered[2] !== undefined ? `${numbered[1]}.${numbered[2]}` : numbered[1]!; }
  else {
    const fromFile = /^(\d+)[-._](\d+)/.exec(id);
    if (fromFile) { section = Number(fromFile[1]); number = `${fromFile[1]}.${fromFile[2]}`; }
    else warnings.push('no section number: start the question "3.2 …" (section 3, question 2) or name the file 3-2.cdxml');
  }
  const marksMatch = /\[\s*(\d+(?:\.\d+)?)\s*(?:marks?|pts?|points?)?\s*\]/i.exec(text);
  const marks = marksMatch ? Number(marksMatch[1]) : 1;
  if (!marksMatch) warnings.push('no marks given (write "[3]" at the end of the question); counted as 1 mark');

  const promptParts = [text];
  if (given.length) promptParts.push(['Structures in the question, as SMILES (from HexSketch):', ...given.map((f, i) => `Structure ${i + 1}: ${f.smiles}`)].join('\n'));
  if (schemeLines.length) promptParts.push(['Scheme:', ...schemeLines].join('\n'));
  const prompt = promptParts.join('\n\n');

  // --------------------------------------------------------------------- key
  const rest = answer.text.trim().replace(ANSWER, '').replace(/^\s*[:.\-–—]\s*/, '').trim();
  const key = readKey(rest, 1, { fragments, arrows, captions: plainCaptions, inRegion, L, warnings, style });
  const alternatives: Answer[] = [];
  for (const [i, c] of alsos.entries()) {
    const alsoRest = c.text.trim().replace(ALSO, '').replace(/^\s*[:.\-–—]\s*/, '').trim();
    try {
      const alt = readKey(alsoRest || rest, i + 2, { fragments, arrows, captions: plainCaptions, inRegion, L, warnings, style });
      if (alt.kind !== key.kind) warnings.push(`the "Also accept" answer ${i + 1} is ${alt.kind}, the Answer is ${key.kind}: it is ignored`);
      else alternatives.push(alt);
    } catch (e) { if (!/nothing drawn/.test((e as Error).message)) warnings.push(`"Also accept" ${i + 1}: ${(e as Error).message}`); }
  }
  if (alternatives.length) {
    if (key.kind === 'structure' || key.kind === 'name') key.also = alternatives.map((a) => (a as { smiles: string }).smiles);
    else if (key.kind === 'structures') key.also = alternatives.map((a) => (a as { smiles: string[] }).smiles);
    else if (key.kind === 'sequence') key.also = alternatives.map((a) => (a as { stages: string[][] }).stages);
    else warnings.push(`"Also accept" has no effect on a ${key.kind} answer`);
  }

  const drawing: Structure = { mol: doc.mol, objects: doc.objects, groups: doc.groups, style, format: 'cdxml' };
  return { question: { id, section, number, marks, text, given: given.map((f) => f.smiles), prompt, answer: key }, drawing, warnings };
}

// ----------------------------------------------------------------- the key

interface KeyContext {
  fragments: Fragment[]; arrows: Arrow[]; captions: Caption[];
  inRegion: <T>(xs: T[], at: (x: T) => number, r: number) => T[];
  L: number; warnings: string[]; style: DrawingStyle;
}

const FORMULA = /^(?:[A-Z][a-z]?\d*)+$/;
const NUMBER = /^(-?\d+(?:\.\d+)?)(?:\s*(?:±|\+\/-|\+-)\s*(\d+(?:\.\d+)?))?$/;
const LETTERS = /^[A-Z](?:\s*(?:,|&|and|\/|\s)\s*[A-Z])*$/;

/** The answer in region `r` (1 the key, 2+ an alternative), read as `rest` (the words after "Answer") says. */
function readKey(rest: string, r: number, ctx: KeyContext): Answer {
  const frags = readingOrder(ctx.inRegion(ctx.fragments, (f) => f.box.cy, r).map((f) => ({ box: f.box, f }))).map((x) => x.f);
  const arrows = ctx.inRegion(ctx.arrows, (a) => mid(a).y, r);
  const caps = readingOrder(ctx.inRegion(ctx.captions, (c) => c.y, r).map((c) => ({ box: captionBox(c, ctx.style), c }))).map((x) => x.c.text.trim());
  const lower = rest.toLowerCase();
  const ignoreStereo = /ignore\s+stereo|no\s+stereo|stereo\s+not\s+marked/.test(lower);
  const stereoOf = (smiles: string[]) => !ignoreStereo && smiles.some(hasStereo);
  const one = (what: string): Fragment => {
    if (frags.length !== 1) throw new Error(`"Answer: ${rest}" needs exactly one structure drawn below it (${frags.length ? `${frags.length} found` : 'nothing drawn'}), its ${what}`);
    return frags[0]!;
  };

  if (/^(?:iupac\s+)?name\b/.test(lower)) {
    const f = one('name');
    const avoid = /\bnot\s+(?:the\s+)?(?:trivial\s+name\s+)?["“]?([a-z][\w\s'(),-]*?)["”]?$/.exec(lower)?.[1]?.trim();
    return { kind: 'name', smiles: f.smiles, stereo: stereoOf([f.smiles]), ...(avoid ? { avoid } : {}) };
  }
  if (/^(?:molecular\s+)?formula$/.test(lower)) return { kind: 'formula', formula: computeMass(one('formula').mol).formulaWithCharge };
  if (/^(?:molecular\s+)?formula\s*[:=]?\s*/.test(lower)) {
    const literal = rest.replace(/^(?:molecular\s+)?formula\s*[:=]?\s*/i, '').trim();
    if (!FORMULA.test(literal)) throw new Error(`"${literal}" does not read as a formula (write it like C9H8O4)`);
    return { kind: 'formula', formula: literal };
  }
  if (/^(?:exact|monoisotopic|accurate)\s+mass\b/.test(lower)) {
    const tol = Number(/±\s*(\d+(?:\.\d+)?)/.exec(rest)?.[1] ?? 0.001);
    return { kind: 'number', value: Number(computeMass(one('exact mass').mol).monoisotopicMass.toFixed(4)), tolerance: tol, what: 'exact mass' };
  }
  if (/^(?:molecular\s+weight|mw|molar\s+mass|molecular\s+mass|mol\.?\s*wt\.?)\b/.test(lower)) {
    const tol = Number(/±\s*(\d+(?:\.\d+)?)/.exec(rest)?.[1] ?? 0.01);
    return { kind: 'number', value: Number(computeMass(one('molecular weight').mol).molecularWeight.toFixed(2)), tolerance: tol, what: 'molecular weight' };
  }
  if (/^(?:marked|written|examiner|essay|free\s+text)\b/.test(lower)) {
    const scheme = [rest.replace(/^(?:marked|written|examiner|essay|free\s+text)\b\s*[:.\-–—]?\s*/i, ''), ...caps].filter(Boolean).join('\n');
    if (frags.length) ctx.warnings.push('structures below "Answer: marked" are shown to the examiner only; the model\'s answer is marked by hand');
    return { kind: 'marked', scheme: scheme || '(no marking scheme written)' };
  }
  if (!frags.length) {
    // Nothing drawn: the answer is in the words themselves.
    const literal = rest || caps.join(' ');
    const num = NUMBER.exec(literal);
    if (num) {
      const decimals = (num[1]!.split('.')[1] ?? '').length;
      return { kind: 'number', value: Number(num[1]), tolerance: num[2] ? Number(num[2]) : 0.5 * 10 ** -decimals, what: 'value' };
    }
    if (LETTERS.test(literal) && (/[,&\/]|\band\b|\s/.test(literal) || literal.length === 1)) return { kind: 'choice', letters: literal.toUpperCase().replace(/\s*(?:,|&|and|\/|\s)\s*/g, ',').replace(/,+/g, ',') };
    if (FORMULA.test(literal) && /\d|[A-Z][a-z]?[A-Z]/.test(literal)) return { kind: 'formula', formula: literal };
    throw new Error(`nothing drawn below "Answer${rest ? `: ${rest}` : ''}", and its words are not a formula, a number or letters`);
  }
  if (rest && !ignoreStereo) ctx.warnings.push(`"Answer: ${rest}" is not a kind of answer this reader knows; the structures drawn below it are the key`);

  // Structures: one, a set, or stages along arrows.
  if (frags.length === 1 && !arrows.length) return { kind: 'structure', smiles: frags[0]!.smiles, stereo: stereoOf([frags[0]!.smiles]) };
  if (!arrows.length) return { kind: 'structures', smiles: frags.map((f) => f.smiles), stereo: stereoOf(frags.map((f) => f.smiles)) };
  // Walk the key in reading order; each arrow starts a new stage.
  const items = readingOrder([
    ...frags.map((f) => ({ box: f.box, f, a: null as Arrow | null })),
    ...arrows.map((a) => ({ box: arrowBox(a), f: null as Fragment | null, a })),
  ]);
  const stages: string[][] = [[]];
  for (const it of items) {
    if (it.a) { if (stages.at(-1)!.length) stages.push([]); }
    else stages.at(-1)!.push(it.f!.smiles);
  }
  const filled = stages.filter((s) => s.length);
  if (filled.length < 2) ctx.warnings.push('arrows in the answer, but the structures are not on both sides of them: marked as a set');
  if (filled.length < 2) return { kind: 'structures', smiles: frags.map((f) => f.smiles), stereo: stereoOf(frags.map((f) => f.smiles)) };
  return { kind: 'sequence', stages: filled, stereo: stereoOf(frags.map((f) => f.smiles)) };
}

// --------------------------------------------------------------- the scheme

/** The arrows of the question as text: "Structure 1 → ?  (above the arrow: NaBH4; below: MeOH, 0 °C)". */
function describeScheme(arrows: Arrow[], given: Fragment[], captions: Caption[], L: number): { schemeLines: string[]; used: Set<Caption> } {
  const used = new Set<Caption>();
  const lines: string[] = [];
  const nameOf = (f: Fragment | null) => (f ? `Structure ${given.indexOf(f) + 1}` : '?');
  for (const a of arrows.sort((p, q) => mid(p).y - mid(q).y || mid(p).x - mid(q).x)) {
    const x0 = Math.min(a.tail.x, a.head.x) - L * 0.5, x1 = Math.max(a.tail.x, a.head.x) + L * 0.5, y = mid(a).y;
    const near = captions.filter((c) => { const b = captionBox(c, { captionSize: 10 } as DrawingStyle); return b.cx >= x0 && b.cx <= x1 && Math.abs(b.cy - y) < L * 1.6; });
    const above = near.filter((c) => c.y < y).map((c) => c.text.trim()), below = near.filter((c) => c.y >= y).map((c) => c.text.trim());
    for (const c of near) used.add(c);
    // "?" captions stand for what is asked; any other caption at an arrow's end is a label for that end.
    const endCaption = (p: Pt) => captions.find((c) => !near.includes(c) && /^\?+$/.test(c.text.trim()) && Math.hypot(c.x - p.x, c.y - p.y) < L * 2.5);
    const tailF = nearestFragment(given, a.tail, L * 2.5), headF = nearestFragment(given, a.head, L * 2.5);
    const headQ = headF ? null : endCaption(a.head), tailQ = tailF ? null : endCaption(a.tail);
    if (headQ) used.add(headQ);
    if (tailQ) used.add(tailQ);
    const arrow = isRetro(a) ? '⇒' : isEquilibrium(a) ? '⇌' : '→';
    const side = (fs: Fragment[], p: Pt) => { const all = fragmentsOnSide(given, a, p, L); return all.length ? all.map(nameOf).join(' + ') : nameOf(fs[0] ?? null); };
    const notes = [above.length ? `above the arrow: ${above.join('; ')}` : '', below.length ? `below: ${below.join('; ')}` : ''].filter(Boolean).join('; ');
    lines.push(`${side(tailF ? [tailF] : [], a.tail)} ${arrow} ${side(headF ? [headF] : [], a.head)}${notes ? `  (${notes})` : ''}`);
  }
  return { schemeLines: lines, used };
}

/** Structures grouped at one end of an arrow ("A + B →"): those whose boxes are on that side and overlap it vertically. */
function fragmentsOnSide(given: Fragment[], a: Arrow, end: Pt, L: number): Fragment[] {
  const other = end === a.tail ? a.head : a.tail;
  const dir = Math.sign(end.x - other.x) || 1;
  const nearest = nearestFragment(given, end, L * 2.5);
  if (!nearest) return [];
  return given.filter((f) => f === nearest || ((f.box.cx - end.x) * dir > 0 && f.box.y0 < nearest.box.y1 && f.box.y1 > nearest.box.y0 && Math.abs(f.box.cx - nearest.box.cx) < L * 8));
}

function nearestFragment(fs: Fragment[], p: Pt, within: number): Fragment | null {
  let best: Fragment | null = null, d = within;
  for (const f of fs) {
    const dx = Math.max(f.box.x0 - p.x, 0, p.x - f.box.x1), dy = Math.max(f.box.y0 - p.y, 0, p.y - f.box.y1);
    const dist = Math.hypot(dx, dy);
    if (dist < d) { d = dist; best = f; }
  }
  return best;
}

// ---------------------------------------------------------------- geometry

function splitFragments(mol: Molecule): Fragment[] {
  return mol.fragments().map((ids) => {
    const keep = new Set(ids);
    const part = mol.clone();
    for (const a of mol.atoms()) if (!keep.has(a.id)) part.removeAtom(a.id);
    const xs = ids.map((id) => mol.atom(id).x), ys = ids.map((id) => mol.atom(id).y);
    return { mol: part, smiles: writeSmiles(part), box: box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)) };
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
  const sorted = [...items].sort((a, b) => a.box.y0 - b.box.y0);
  const rows: T[][] = [];
  for (const it of sorted) {
    const row = rows.find((r) => r.some((o) => it.box.cy > o.box.y0 && it.box.cy < o.box.y1) || r.some((o) => o.box.cy > it.box.y0 && o.box.cy < it.box.y1));
    if (row) row.push(it); else rows.push([it]);
  }
  rows.sort((a, b) => Math.min(...a.map((o) => o.box.cy)) - Math.min(...b.map((o) => o.box.cy)));
  return rows.flatMap((r) => r.sort((a, b) => a.box.cx - b.box.cx));
}
