/**
 * HexSketch as the model meets it in the benchmark: the connector's own tool
 * descriptions and input schemas (from packages/hexsketch/src/toolkit.ts, so
 * they never drift from what Claude and Codex see), run here in-process
 * rather than over MCP. Results are the connector's, less the hexsketch.com
 * link, which a benchmark has no use for and which costs tokens.
 */
import { analyze, compare, convert, name, validate } from '../../packages/agent/src/index.ts';
import { parseFormula } from '../../packages/core/src/index.ts';
import { DESCRIPTIONS, structure, toJsonSchema, type FunctionTool } from '../../packages/hexsketch/src/toolkit.ts';
import { z } from 'zod';

export { compare, parseFormula };

/**
 * blind: no tools. readback: only validate_structure, which reads back the
 * name and formula of a SMILES the model wrote. full: every checking tool the
 * connector has in a chat without the editor (render_structure aside: it
 * returns a picture, which this benchmark does not show).
 */
export type Condition = 'blind' | 'readback' | 'full';
export const CONDITIONS: Condition[] = ['blind', 'readback', 'full'];

const TOOLS: Record<string, { def: FunctionTool; run: (a: Record<string, string>) => Promise<unknown> }> = {
  validate_structure: {
    def: { name: 'validate_structure', description: DESCRIPTIONS.validate_structure, parameters: toJsonSchema({ structure: structure() }) },
    run: (a) => validate(a.structure!),
  },
  name_structure: {
    def: { name: 'name_structure', description: DESCRIPTIONS.name_structure, parameters: toJsonSchema({ structure: structure() }) },
    run: (a) => name(a.structure!),
  },
  analyze_structure: {
    def: { name: 'analyze_structure', description: DESCRIPTIONS.analyze_structure, parameters: toJsonSchema({ structure: structure() }) },
    run: (a) => analyze(a.structure!),
  },
  compare_structures: {
    def: { name: 'compare_structures', description: DESCRIPTIONS.compare_structures, parameters: toJsonSchema({ a: structure(), b: structure() }) },
    run: (a) => compare(a.a!, a.b!),
  },
  convert_structure: {
    def: { name: 'convert_structure', description: DESCRIPTIONS.convert_structure, parameters: toJsonSchema({ structure: structure(), to: z.enum(['smiles', 'mol', 'cdxml']).describe('Target format.') }) },
    run: (a) => convert(a.structure!, a.to as 'smiles'),
  },
};

const IN: Record<Condition, string[]> = {
  blind: [],
  readback: ['validate_structure'],
  full: ['validate_structure', 'name_structure', 'analyze_structure', 'compare_structures', 'convert_structure'],
};

export const toolsFor = (c: Condition): FunctionTool[] => IN[c].map((n) => TOOLS[n]!.def);

/** Run a tool as the connector would: a bad input comes back as an error the model can read, not a crash. */
export async function runTool(c: Condition, toolName: string, argsJson: string): Promise<{ text: string; error: boolean }> {
  if (!IN[c].includes(toolName)) return { text: `No tool called ${toolName}`, error: true };
  let args: Record<string, string>;
  try { args = JSON.parse(argsJson || '{}'); } catch { return { text: 'The arguments are not valid JSON', error: true }; }
  try { return { text: JSON.stringify(await TOOLS[toolName]!.run(args), null, 2), error: false }; }
  catch (err) { return { text: (err as Error).message, error: true }; }
}

/** What the model is told, in every condition alike, then what HexSketch adds where it has tools. */
export function systemPrompt(c: Condition): string {
  const base = 'You are answering a chemistry question. Work it out, then end your reply with one line of the form "ANSWER: <answer>" and nothing else on that line.';
  if (c === 'blind') return base;
  return [
    base,
    '',
    'You have HexSketch\'s tools, which read structures and name and check them.',
    '- Give structures to the tools as SMILES. HexSketch does not turn names into structures.',
    '- Check every SMILES you write against the name and formula HexSketch returns for it, and correct it if they do not match what you meant.',
  ].join('\n');
}
