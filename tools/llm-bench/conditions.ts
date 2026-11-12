/**
 * How a question is put to a model, with HexSketch and without, in two places.
 *
 * Through OpenRouter, for any model:
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
 *
 * Inside Claude Code, for Claude's own models on the subscription Claude Code
 * runs on: cc-plain, cc-hexsketch and cc-drawn, described at CLAUDE_CODE below.
 * The comparison that matters there is cc-plain against cc-drawn: the question
 * typed, and the question drawn in HexSketch the way a chemist hands it over.
 */
import { analyze, compare, convert, drawingSummary, link, name, readStructure, validate } from '../../packages/agent/src/index.ts';
import { findStructure, pageTools, prepare, prepareSteps, safetyOf, textOf, PAGE_INSTRUCTIONS, SHOWN_NEXT, type FunctionTool, type Show } from '../../packages/hexsketch/src/toolkit.ts';
import { ANSWER_FORMAT, type Question } from './questions.ts';

export type Condition = 'smiles' | 'hexsketch' | 'cc-plain' | 'cc-hexsketch' | 'cc-drawn';
/** The two conditions an OpenRouter run compares: the question typed, and the question drawn on hexsketch.com. */
export const CONDITIONS: Condition[] = ['smiles', 'hexsketch'];
export const ALL_CONDITIONS: Condition[] = ['smiles', 'hexsketch', 'cc-plain', 'cc-hexsketch', 'cc-drawn'];
/**
 * The Claude Code conditions: the model runs inside Claude Code itself
 * (claude -p), on the subscription Claude Code runs on rather than through
 * OpenRouter, with every built-in tool, skill, setting and MCP server taken
 * away. Both get the same words -- the question as a chemist types it, with
 * the SMILES and the reagents -- so the only difference between them is
 * whether HexSketch's connector is attached.
 *
 *   cc-plain       Claude Code with no tools at all.
 *   cc-hexsketch   Claude Code with HexSketch's connector and nothing else,
 *                  run from this checkout, so a change to HexSketch is in the
 *                  next run without deploying anything.
 *   cc-drawn       The same connector, with the question as a chemist using
 *                  HexSketch hands it over: what they type, and a link to what
 *                  they drew. The model has to read the drawing through
 *                  HexSketch to see it at all. Against cc-plain it measures
 *                  HexSketch as a chemist uses it; against cc-hexsketch, what
 *                  drawing the question rather than typing it changes.
 */
export const CLAUDE_CODE: Condition[] = ['cc-plain', 'cc-hexsketch', 'cc-drawn'];
/** The two conditions a Claude Code run compares unless told otherwise: the question typed, and drawn. */
export const CLAUDE_CODE_PAIR: Condition[] = ['cc-plain', 'cc-drawn'];

/** What each condition is called in a report, so four columns can be told apart. */
export const CONDITION_NAME: Record<Condition, string> = {
  smiles: 'Without HexSketch',
  hexsketch: 'With HexSketch',
  'cc-plain': 'Claude Code, no tools',
  'cc-hexsketch': 'Claude Code with HexSketch',
  'cc-drawn': 'Claude Code with HexSketch, question drawn',
};

/** The system prompt without HexSketch: neutral, so only HexSketch's own instructions differ. */
const PLAIN_SYSTEM = 'You are an expert chemist helping a colleague. Answer their question about the structures they give you.';

export interface Opening { system: string; user: string; tools: FunctionTool[] }

/** What the model is given first, in each condition. */
export async function opening(q: Question, c: Condition): Promise<Opening> {
  const end = ANSWER_FORMAT[q.key.kind];
  // As a chemist using HexSketch from Claude Code asks: their words, and a link to what they drew.
  if (c === 'cc-drawn' && q.drawing) return { system: PLAIN_SYSTEM, user: `${q.ask}\n\nMy drawing in HexSketch: ${await link(q.drawing, { format: 'cdxml' })}\n\n${end}`, tools: [] };
  if (c === 'smiles' || c === 'cc-plain' || c === 'cc-hexsketch' || c === 'cc-drawn') {
    const parts = [q.ask];
    if (q.given.length) parts.push(q.given.length === 1 && !q.scheme.length ? `SMILES: ${q.given[0]}` : q.given.map((s, i) => `Structure ${i + 1}: ${s}`).join('\n'));
    if (q.scheme.length) parts.push(q.scheme.join('\n'));
    parts.push(end);
    return { system: PLAIN_SYSTEM, user: parts.join('\n\n'), tools: [] };
  }
  const shown = q.drawing ? await describe(q.drawing) : null;
  return {
    system: PAGE_INSTRUCTIONS,
    // As the website sends it: the message, then what the editor shows (when anything is drawn).
    user: `${q.ask}\n\n${end}${shown ? `\n\nWhat the editor shows now:\n${shown}` : ''}`,
    tools: pageTools(),
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
