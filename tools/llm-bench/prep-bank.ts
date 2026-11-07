/**
 * Builds exam.jsonl (`--set exam`) from the exam bank: the questions written
 * in the HexSketch Exam Bank page, exported by Claude into bank/questions/
 * (one JSON file per question, as the page stores it). Only questions marked
 * Ready are used. Checks every key reads (HexSketch) or parses (formulas).
 *
 *   node --experimental-strip-types tools/llm-bench/prep-bank.ts
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readStructure } from '../../packages/agent/src/index.ts';
import { parseFormula } from './hexsketch.ts';
import { countBy, type Category, type Question } from './questions.ts';

/** One question as the bank page stores it. */
interface BankQuestion {
  id: string; category: Category; kind: 'structure' | 'name' | 'formula'; prompt: string; key: string;
  also?: string[]; stereo?: boolean; avoid?: string; pilot?: boolean; status: 'draft' | 'ready' | 'retired'; note?: string;
}

const dir = new URL('bank/questions/', import.meta.url);
const bank = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(new URL(f, dir), 'utf8')) as BankQuestion);

const problems: string[] = [];
const questions: Question[] = [];
for (const b of bank.filter((b) => b.status === 'ready')) {
  if (!b.prompt?.trim() || !b.key?.trim()) { problems.push(`${b.id}: no question or no key`); continue; }
  let answer: Question['answer'];
  if (b.kind === 'formula') {
    try { parseFormula(b.key); } catch { problems.push(`${b.id}: the key ${b.key} is not a formula`); continue; }
    answer = { kind: 'formula', formula: b.key };
  } else {
    let ok = true;
    for (const s of [b.key, ...(b.also ?? [])]) {
      try { await readStructure(s); } catch (e) { problems.push(`${b.id}: HexSketch can't read ${s} (${(e as Error).message})`); ok = false; }
    }
    if (!ok) continue;
    const also = b.also?.length ? { also: b.also } : {};
    answer = b.kind === 'name'
      ? { kind: 'name', smiles: b.key, stereo: !!b.stereo, ...(b.avoid ? { avoid: b.avoid } : {}), ...also }
      : { kind: 'structure', smiles: b.key, stereo: !!b.stereo, ...also };
  }
  questions.push({ id: b.id, category: b.category, prompt: b.prompt.trim(), answer, pilot: !!b.pilot });
}

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
writeFileSync(new URL('exam.jsonl', import.meta.url), questions.map((q) => JSON.stringify(q)).join('\n') + '\n');
const count = (pilot: boolean) => Object.entries(countBy(questions.filter((q) => !pilot || q.pilot), (q) => q.category)).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`${bank.length} in the bank, ${questions.length} ready.\npilot (${questions.filter((q) => q.pilot).length}): ${count(true)}\nall: ${count(false)}`);
