/**
 * Grading: the model's final answer against the key. Structures are compared
 * by HexSketch (the same code the tools use, but run here on the answer
 * alone, never shown to the model); names are parsed by OPSIN, an
 * independent name parser, so a name HexSketch's own namer would write is not
 * favoured.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { compare, parseFormula } from './hexsketch.ts';
import type { Question } from './questions.ts';

const OPSIN = new URL('../opsin/opsin.jar', import.meta.url).pathname;

/** SMILES for each name (null where OPSIN cannot read it), in one Java run. */
export function opsin(names: readonly string[]): (string | null)[] {
  if (!names.length) return [];
  if (!existsSync(OPSIN)) throw new Error('OPSIN is missing: run sh tools/opsin/fetch.sh (needs Java to run)');
  const input = names.map((n) => n.replace(/\s*\n\s*/g, ' ').trim() || '?').join('\n') + '\n';
  const out = execFileSync('java', ['-jar', OPSIN, '-osmi'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  const lines = out.split('\n');
  // One line out per name in; a name OPSIN cannot read gives a blank line or a message with spaces in it.
  return names.map((_, i) => { const l = (lines[i] ?? '').trim(); return l && !/\s/.test(l) ? l : null; });
}

/** The answer the model gave: the last "ANSWER:" line, without backticks or a full stop. */
export function finalAnswer(text: string): string | null {
  const found = [...text.matchAll(/^\s*\**ANSWER\**\s*:\s*(.+?)\s*$/gim)].at(-1)?.[1];
  if (!found) return null;
  // A full stop, backticks and bold around it, in any order ("`CCO`." or "**CCO**").
  let a = found.trim(), was = '';
  while (a !== was) { was = a; a = a.replace(/\.$/, '').replace(/^[`*]+|[`*]+$/g, '').trim(); }
  return a || null;
}

export type Verdict = 'correct' | 'wrong' | 'stereo' | 'unreadable' | 'no-answer';

/**
 * Grade one answer. 'stereo': the right compound, the wrong (or missing)
 * stereochemistry where it was asked for. 'unreadable': not a SMILES (or a
 * name OPSIN can parse) at all. `named` is OPSIN's SMILES for a name answer.
 */
export async function grade(q: Question, answer: string | null, named?: string | null): Promise<Verdict> {
  if (!answer) return 'no-answer';
  const a = q.answer;
  if (a.kind === 'formula') return sameFormula(answer, a.formula) ? 'correct' : 'wrong';
  if (a.kind === 'name' && a.avoid && answer.toLowerCase().includes(a.avoid.toLowerCase())) return 'wrong';
  const smiles = a.kind === 'name' ? named : answer;
  if (!smiles) return 'unreadable';
  let verdict: Verdict = 'wrong';
  for (const key of [a.smiles, ...(a.also ?? [])]) {
    let c;
    try { c = await compare(smiles, key); } catch { if (key === a.smiles) return 'unreadable'; continue; }
    if (c.same || (!a.stereo && c.sameConnectivity)) return 'correct';
    if (c.sameConnectivity) verdict = 'stereo';
  }
  return verdict;
}

/** Formulas equal element by element, whatever their order (C9H8O4, H8C9O4) or subscript characters. */
export function sameFormula(given: string, key: string): boolean {
  const plain = (f: string) => f.replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080)).replace(/\s+/g, '');
  try {
    const a = parseFormula(plain(given)), b = parseFormula(plain(key));
    return a.size === b.size && [...a].every(([el, n]) => b.get(el) === n);
  } catch { return false; }
}
