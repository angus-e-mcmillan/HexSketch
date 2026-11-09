/**
 * Marking: the model's final answer against the key, as marks out of the
 * question's. Structures are compared by HexSketch (never shown to the
 * model); names are parsed by OPSIN, an independent name parser, so a name
 * HexSketch's own namer would write is not favoured.
 *
 * Partial credit, the same for every question of a kind:
 *   structure, name   full marks for the same compound (stereoisomer where
 *                     marked); half for the right connectivity with the wrong
 *                     or missing stereochemistry
 *   formula, number   all or nothing
 *   structures (set)  a share per structure in the key, less a share per
 *                     extra structure given (half a share for stereo-only)
 *   sequence          a share per stage of the key given in order
 *   choice            a share per right letter, less a share per wrong one
 *   marked            none until the examiner marks it
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { compare, parseFormula } from './hexsketch.ts';
import type { Answer, Question } from './questions.ts';

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
 * full stop. With `rest`, everything from the last "ANSWER:" to the end (a
 * written answer for the examiner).
 */
export function finalAnswer(text: string, rest = false): string | null {
  if (rest) {
    const at = [...text.matchAll(/^\s*\**ANSWER\**\s*:/gim)].at(-1);
    const a = at ? text.slice(at.index! + at[0].length).trim() : '';
    return a || null;
  }
  const found = [...text.matchAll(/^\s*\**ANSWER\**\s*:\s*(.+?)\s*$/gim)].at(-1)?.[1];
  if (!found) return null;
  let a = found.trim(), was = '';
  while (a !== was) { was = a; a = a.replace(/\.$/, '').replace(/^[`*]+|[`*]+$/g, '').trim(); }
  return a || null;
}

export type Verdict = 'correct' | 'partial' | 'wrong' | 'stereo' | 'unreadable' | 'no-answer' | 'ungraded';
export interface Mark { verdict: Verdict; marks: number }

/** Mark one answer. `named` is OPSIN's SMILES for a name answer. */
export async function grade(q: Question, answer: string | null, named?: string | null): Promise<Mark> {
  const m = q.marks, a = q.answer;
  const none = (verdict: Verdict): Mark => ({ verdict, marks: 0 });
  if (!answer) return none('no-answer');
  switch (a.kind) {
    case 'marked': return none('ungraded');
    case 'formula': return sameFormula(answer, a.formula) ? { verdict: 'correct', marks: m } : none('wrong');
    case 'number': {
      const n = Number(answer.replace(/[^\d.eE+-]/g, ''));
      if (!Number.isFinite(n)) return none('unreadable');
      return Math.abs(n - a.value) <= a.tolerance + 1e-9 ? { verdict: 'correct', marks: m } : none('wrong');
    }
    case 'choice': {
      const given = letters(answer), key = letters(a.letters);
      if (!given.size) return none('unreadable');
      const right = [...given].filter((l) => key.has(l)).length, wrong = given.size - right;
      return share(m, right - wrong, key.size, right === key.size && !wrong);
    }
    case 'name': {
      if (a.avoid && answer.toLowerCase().includes(a.avoid.toLowerCase())) return none('wrong');
      if (!named) return none('unreadable');
      return markStructure(m, named, [a.smiles, ...(a.also ?? [])], a.stereo);
    }
    case 'structure': return markStructure(m, answer, [a.smiles, ...(a.also ?? [])], a.stereo);
    case 'structures': {
      const given = splitStructures(answer, '.');
      if (!given.length) return none('unreadable');
      for (const g of given) if (!(await readable(g))) return none('unreadable');
      let best: Mark = none('wrong');
      for (const key of [a.smiles, ...(a.also ?? [])]) {
        const { matched, stereoOnly } = await matchSet(given, key, a.stereo);
        const extra = given.length - matched - stereoOnly;
        const r = share(m, matched + stereoOnly / 2 - extra, key.length, matched === key.length && !extra);
        if (r.marks > best.marks || (best.verdict === 'wrong' && r.verdict !== 'wrong')) best = r;
      }
      return best;
    }
    case 'sequence': {
      const stages = splitStructures(answer, '>>').map((s) => splitStructures(s, '.'));
      if (!stages.length || stages.some((s) => !s.length)) return none('unreadable');
      for (const g of stages.flat()) if (!(await readable(g))) return none('unreadable');
      let best: Mark = none('wrong');
      for (const key of [a.stages, ...(a.also ?? [])]) {
        // The key's stages in order; stages the key leaves out may come between them.
        let i = 0, hit = 0;
        for (const ks of key) {
          for (; i < stages.length; i++) {
            const { matched, stereoOnly } = await matchSet(stages[i]!, ks, a.stereo);
            if (matched + stereoOnly === ks.length && stages[i]!.length === ks.length) { hit += stereoOnly ? 0.5 : 1; i++; break; }
          }
        }
        const r = share(m, hit, key.length, hit === key.length);
        if (r.marks > best.marks || (best.verdict === 'wrong' && r.verdict !== 'wrong')) best = r;
      }
      return best;
    }
  }
}

/** `got` shares out of `of`, as marks out of `m`, to half a mark; `full` names a complete answer. */
function share(m: number, got: number, of: number, full: boolean): Mark {
  const marks = Math.max(0, Math.round((m * got) / of * 2) / 2);
  return { verdict: full ? 'correct' : marks > 0 ? 'partial' : 'wrong', marks };
}

async function markStructure(m: number, smiles: string, keys: string[], stereo: boolean): Promise<Mark> {
  let best: Mark = { verdict: 'wrong', marks: 0 };
  for (const key of keys) {
    let c;
    try { c = await compare(smiles, key); } catch { return { verdict: 'unreadable', marks: 0 }; }
    if (c.same || (!stereo && c.sameConnectivity)) return { verdict: 'correct', marks: m };
    if (c.sameConnectivity) best = { verdict: 'stereo', marks: Math.round(m) / 2 };
  }
  return best;
}

/** How many of the key's structures the given ones match (each given one at most once). */
async function matchSet(given: string[], key: string[], stereo: boolean): Promise<{ matched: number; stereoOnly: number }> {
  const used = new Set<number>();
  let matched = 0, stereoOnly = 0;
  for (const k of key) {
    let hit = -1, partial = -1;
    for (const [i, g] of given.entries()) {
      if (used.has(i)) continue;
      let c; try { c = await compare(g, k); } catch { continue; }
      if (c.same || (!stereo && c.sameConnectivity)) { hit = i; break; }
      if (c.sameConnectivity && partial < 0) partial = i;
    }
    if (hit >= 0) { used.add(hit); matched++; }
    else if (partial >= 0) { used.add(partial); stereoOnly++; }
  }
  return { matched, stereoOnly };
}

async function readable(smiles: string): Promise<boolean> { try { await compare(smiles, smiles); return true; } catch { return false; } }

/** The letters in an answer ("A, C", "C and A", "AC" all give A and C). */
function letters(s: string): Set<string> {
  const t = s.toUpperCase().replace(/\bAND\b/g, ',').trim();
  const found = /^[A-Z]+$/.test(t) ? t.split('') : (t.match(/\b[A-Z]\b/g) ?? []);
  return new Set(found);
}

/** Split structures written with "." (a set) or ">>" (a sequence); "." inside brackets is kept. */
export function splitStructures(answer: string, by: '.' | '>>'): string[] {
  const parts = by === '>>' ? answer.split(/\s*(?:>>|→|->)\s*/) : answer.split(/\s*[.,;]\s+|\.(?![^[]*\])/);
  return parts.map((s) => s.trim()).filter(Boolean);
}

/** Formulas equal element by element, whatever their order (C9H8O4, H8C9O4) or subscript characters. */
export function sameFormula(given: string, key: string): boolean {
  const plain = (f: string) => f.replace(/[₀-₉]/g, (d) => String(d.charCodeAt(0) - 0x2080)).replace(/\s+/g, '');
  try {
    const a = parseFormula(plain(given)), b = parseFormula(plain(key));
    return a.size === b.size && [...a].every(([el, n]) => b.get(el) === n);
  } catch { return false; }
}

export type { Answer };
