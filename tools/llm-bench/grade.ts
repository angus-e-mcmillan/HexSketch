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

/**
 * The answer the model gave: the last "ANSWER:" line, without backticks or a
 * full stop. With `rest`, everything from the last "ANSWER:" to the end (an
 * open answer to be marked by the examiner).
 */
export function finalAnswer(text: string, rest = false): string | null {
  if (rest) {
    const at = [...text.matchAll(/^\s*\**ANSWER\**\s*:/gim)].at(-1);
    const a = at ? text.slice(at.index! + at[0].length).trim() : '';
    return a || null;
  }
  const found = [...text.matchAll(/^\s*\**ANSWER\**\s*:\s*(.+?)\s*$/gim)].at(-1)?.[1];
  if (!found) return null;
  // A full stop, backticks and bold around it, in any order ("`CCO`." or "**CCO**").
  let a = found.trim(), was = '';
  while (a !== was) { was = a; a = a.replace(/\.$/, '').replace(/^[`*]+|[`*]+$/g, '').trim(); }
  return a || null;
}

export type Verdict = 'correct' | 'wrong' | 'stereo' | 'unreadable' | 'no-answer' | 'ungraded';

/**
 * Grade one answer. 'stereo': the right compound, the wrong (or missing)
 * stereochemistry where it was asked for. 'unreadable': not a SMILES (or a
 * name OPSIN can parse) at all. `named` is OPSIN's SMILES for a name answer.
 */
export async function grade(q: Question, answer: string | null, named?: string | null): Promise<Verdict> {
  if (!answer) return 'no-answer';
  const a = q.answer;
  if (a.kind === 'formula') return sameFormula(answer, a.formula) ? 'correct' : 'wrong';
  if (a.kind === 'marked') return 'ungraded';
  if (a.kind === 'choice') return sameLetters(answer, a.letters) === null ? 'unreadable' : sameLetters(answer, a.letters) ? 'correct' : 'wrong';
  if (a.kind === 'structures' || a.kind === 'sequence') return gradeMany(a, answer);
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

/** Whether the letters given are exactly the key's ("A, C", "C and A" and "AC" all read as A and C); null when no letters. */
export function sameLetters(given: string, key: string): boolean | null {
  const letters = (s: string) => new Set((s.toUpperCase().replace(/\bAND\b/g, ',').match(/\b[A-Z]\b|^[A-Z]+$/g) ?? []).join('').split(''));
  const g = letters(given.trim()), k = letters(key);
  if (!g.size) return null;
  return g.size === k.size && [...g].every((x) => k.has(x));
}

/** Split a list of structures written with "." (a set) or ">>" (a sequence). */
export function splitStructures(answer: string, kind: 'structures' | 'sequence'): string[] {
  const parts = kind === 'sequence' ? answer.split(/\s*(?:>>|→|->)\s*/) : answer.split(/\s*[.,;]\s+|\.(?![^\[]*\])/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

type Many = Extract<Question['answer'], { kind: 'structures' | 'sequence' }>;
async function gradeMany(a: Many, answer: string): Promise<Verdict> {
  const given = splitStructures(answer, a.kind);
  if (!given.length) return 'unreadable';
  // How each given structure matches each key structure: 2 the same, 1 the same but for stereo, 0 different.
  const match = async (x: string, y: string) => { try { const c = await compare(x, y); return c.same ? 2 : c.sameConnectivity ? 1 : 0; } catch { return -1; } };
  const cache = new Map<string, number>();
  const m = async (x: string, y: string) => { const k = `${x}\u0000${y}`; if (!cache.has(k)) cache.set(k, await match(x, y)); return cache.get(k)!; };
  for (const g of given) if ((await m(g, g)) < 0) return 'unreadable';
  let best: Verdict = 'wrong';
  for (const key of [a.smiles, ...(a.also ?? [])]) {
    let ok = true, stereoOnly = false;
    if (a.kind === 'structures') {
      // The same set: each key structure matched by a different given one, and nothing left over.
      if (given.length !== key.length) continue;
      const used = new Set<number>();
      for (const k of key) {
        let hit = -1;
        for (const [i, g] of given.entries()) { if (used.has(i)) continue; const s = await m(g, k); if (s === 2 || (s === 1 && !a.stereo)) { hit = i; break; } if (s === 1 && hit < 0) { hit = i; stereoOnly = true; } }
        if (hit < 0) { ok = false; break; }
        used.add(hit);
      }
    } else {
      // The key's structures in order, others allowed between them.
      let i = 0;
      for (const k of key) {
        let found = false;
        for (; i < given.length; i++) { const s = await m(given[i]!, k); if (s === 2 || (s === 1 && !a.stereo)) { found = true; i++; break; } if (s === 1) { found = true; stereoOnly = true; i++; break; } }
        if (!found) { ok = false; break; }
      }
    }
    if (ok && !stereoOnly) return 'correct';
    if (ok) best = 'stereo';
  }
  return best;
}

/** Formulas equal element by element, whatever their order (C9H8O4, H8C9O4) or subscript characters. */
export function sameFormula(given: string, key: string): boolean {
  const plain = (f: string) => f.replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080)).replace(/\s+/g, '');
  try {
    const a = parseFormula(plain(given)), b = parseFormula(plain(key));
    return a.size === b.size && [...a].every(([el, n]) => b.get(el) === n);
  } catch { return false; }
}
