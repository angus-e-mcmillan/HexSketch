/**
 * The two ways a chemist can put a question to a model.
 *
 * smiles     Without HexSketch: the chemist types the question and pastes the
 *            structures as SMILES, with the reagents written out. No tools.
 *            The model answers in text.
 * hexsketch  With HexSketch, as on hexsketch.com: the question is typed in
 *            the chat beside the editor, which holds the chemist's drawing.
 *            The model gets HexSketch's own system prompt, its tools, and the
 *            drawing as HexSketch describes it with each message; it answers
 *            in the chat and draws in the editor with show_in_sketcher. The
 *            tools run here exactly as the website runs them (apps/web/src/chat.ts),
 *            against a stand-in editor that keeps the current drawing.
 */
import { analyze, compare, convert, drawingSummary, link, name, readStructure, validate } from '../../packages/agent/src/index.ts';
import { findStructure, pageTools, prepare, prepareSteps, safetyOf, textOf, PAGE_INSTRUCTIONS, SHOWN_NEXT, type FunctionTool, type Show } from '../../packages/hexsketch/src/toolkit.ts';
import { ANSWER_FORMAT, type Question } from './questions.ts';

export type Condition = 'smiles' | 'hexsketch' | 'smiles-described' | 'hexsketch-no-tools';
/** The two conditions a run compares. */
export const CONDITIONS: Condition[] = ['smiles', 'hexsketch'];
/**
 * Conditions a run may ask for, to take apart why HexSketch halves a model's
 * thinking. Three things differ between the two conditions above at once: what
 * the model is told about the structure (a name and a formula, or a SMILES to
 * parse itself), what its instructions are, and whether it has tools. These two
 * hold one of those still:
 *
 *   smiles-described     What the editor shows, without HexSketch's instructions
 *                        and without tools: the drawing described in the same
 *                        words, under the plain system prompt. Against `smiles`,
 *                        it measures what the description alone is worth.
 *   hexsketch-no-tools   HexSketch's instructions and the same description, but
 *                        no tools to call. Against `hexsketch`, it measures what
 *                        the tools are worth; against `smiles-described`, what
 *                        the instructions are worth.
 */
export const ALL_CONDITIONS: Condition[] = ['smiles', 'hexsketch', 'smiles-described', 'hexsketch-no-tools'];

/** What each condition is called in a report, so four columns can be told apart. */
export const CONDITION_NAME: Record<Condition, string> = {
  smiles: 'Without HexSketch',
  'smiles-described': 'The drawing described, no tools',
  'hexsketch-no-tools': "HexSketch's instructions, no tools",
  hexsketch: 'With HexSketch',
};

/** The system prompt without HexSketch: neutral, so only HexSketch's own instructions differ. */
const PLAIN_SYSTEM = 'You are an expert chemist helping a colleague. Answer their question about the structures they give you.';

export interface Opening { system: string; user: string; tools: FunctionTool[] }

/** What the model is given first, in each condition. */
export async function opening(q: Question, c: Condition): Promise<Opening> {
  const end = ANSWER_FORMAT[q.key.kind];
  if (c === 'smiles') {
    const parts = [q.ask];
    if (q.given.length) parts.push(q.given.length === 1 && !q.scheme.length ? `SMILES: ${q.given[0]}` : q.given.map((s, i) => `Structure ${i + 1}: ${s}`).join('\n'));
    if (q.scheme.length) parts.push(q.scheme.join('\n'));
    parts.push(end);
    return { system: PLAIN_SYSTEM, user: parts.join('\n\n'), tools: [] };
  }
  const shown = q.drawing ? await describe(q.drawing) : null;
  const withDrawing = `${q.ask}\n\n${end}${shown ? `\n\nWhat the editor shows now:\n${shown}` : ''}`;
  // The drawing described, but nothing else of HexSketch: no instructions, no tools.
  if (c === 'smiles-described') return { system: PLAIN_SYSTEM, user: withDrawing, tools: [] };
  return {
    system: PAGE_INSTRUCTIONS,
    // As the website sends it: the message, then what the editor shows (when anything is drawn).
    user: withDrawing,
    tools: c === 'hexsketch-no-tools' ? [] : pageTools(),
  };
}

/** The drawing as the website describes it to the model with a message (chat.ts describe()). */
async function describe(cdxml: string): Promise<string | null> {
  return drawingSummary(await readStructure(cdxml));
}

/** The stand-in editor: the drawing it holds, as CDXML, which show_in_sketcher replaces. */
export interface Editor { drawing: string }

/** PubChem lookups, once per name per run (PubChem allows a few requests a second). */
const found = new Map<string, Promise<unknown>>();

/** Run one tool call as the website does; a mistake goes back to the model as an error to fix. */
export async function runTool(editor: Editor, tool: string, json: string): Promise<{ result: unknown; error: boolean }> {
  let args: Record<string, unknown>;
  try { args = JSON.parse(json || '{}') as Record<string, unknown>; } catch { return { result: { error: 'The arguments were not valid JSON' }, error: true }; }
  try {
    const s = args.structure as string;
    switch (tool) {
      case 'show_in_sketcher': return { result: await show(editor, args as Show & { steps?: Show[]; cycle?: boolean }), error: false };
      case 'read_sketcher': {
        const now = editor.drawing;
        return { result: now ? { ...(await analyze(now)), ...(await textOf(now)), ...(await safetyOf(now)) } : { empty: true, note: 'The canvas is empty.' }, error: false };
      }
      case 'find_structure': {
        const q = String(args.name ?? '').trim().toLowerCase();
        if (!found.has(q)) found.set(q, findStructure(q).catch((e: Error) => ({ error: e.message })));
        const r = await found.get(q)!;
        return { result: r, error: !!(r as { error?: string }).error };
      }
      case 'name_structure': return { result: { ...(await name(s)), link: await link(s) }, error: false };
      case 'analyze_structure': return { result: { ...(await analyze(s)), link: await link(s) }, error: false };
      case 'validate_structure': { const v = await validate(s); return { result: v.smiles !== undefined ? { ...v, link: await link(s) } : v, error: false }; }
      case 'compare_structures': return { result: await compare(args.a as string, args.b as string), error: false };
      case 'convert_structure': return { result: { result: await convert(s, args.to as 'smiles' | 'mol' | 'cdxml' | 'link') }, error: false };
      default: return { result: { error: `There is no tool called ${tool}` }, error: true };
    }
  } catch (err) {
    return { result: { error: (err as Error).message }, error: true };
  }
}

/** show_in_sketcher, as the website runs it (chat.ts show()), on the stand-in editor. */
async function show(editor: Editor, args: Show & { steps?: Show[]; cycle?: boolean }): Promise<unknown> {
  const { steps, cycle, ...one } = args;
  if (cycle && !steps) throw new Error('cycle draws the steps of a mechanism round a circle: give steps as well');
  const current = editor.drawing;
  const before = current ? (await readStructure(current)).mol : undefined;
  if (steps) {
    if (Object.values(one).some((v) => v !== undefined)) throw new Error('Give steps, or the fields of one step, not both');
    const { updates, report } = await prepareSteps(steps, before?.atomCount ? before : undefined, current, { cycle: !!cycle });
    const last = [...updates].reverse().find((u) => u.structure);
    if (last?.structure) editor.drawing = last.structure;
    return { shown: true, ...report };
  }
  const { update, report } = await prepare(one, before?.atomCount ? before : undefined, current);
  if (update.structure) editor.drawing = update.structure;
  return { shown: true, ...report, next: SHOWN_NEXT };
}
