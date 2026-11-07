/** The benchmark's questions (questions.jsonl, built by prep.ts). */
import { readFileSync } from 'node:fs';

export type Category = 'name2smiles' | 'stereo' | 'smiles2name' | 'formula' | 'reaction' | 'common2smiles' | 'common2name' | 'smiles2formula' | 'synthesis' | 'spectra' | 'other';

/**
 * standard: questions.jsonl, from the ZINC sets. hard: hard.jsonl, picked by
 * hand to trip models up (hard.ts). exam: exam.jsonl, the Ready questions in
 * the exam bank (bank/, written in the HexSketch Exam Bank page).
 */
export type QuestionSet = 'standard' | 'hard' | 'exam';
export const SETS: QuestionSet[] = ['standard', 'hard', 'exam'];
export const SET_FILE: Record<QuestionSet, string> = { standard: 'questions.jsonl', hard: 'hard.jsonl', exam: 'exam.jsonl' };

export interface Question {
  id: string;
  category: Category;
  prompt: string;
  answer:
    /** A structure, graded by comparing it with this one (or any in `also`): as the same stereoisomer when `stereo`, else by connectivity. */
    | { kind: 'structure'; smiles: string; stereo: boolean; also?: string[] }
    /**
     * A name, graded by parsing it with OPSIN and comparing the structure it
     * names with this one. `avoid`: a trivial name OPSIN would parse too, so
     * an answer containing it is wrong.
     */
    | { kind: 'name'; smiles: string; stereo: boolean; avoid?: string; also?: string[] }
    /** A molecular formula, graded element by element. */
    | { kind: 'formula'; formula: string };
  /** In the small set run first (--pilot). */
  pilot: boolean;
}

/** What the model is asked to end its answer with, per kind of answer. */
export const ANSWER_FORMAT: Record<Question['answer']['kind'], string> = {
  structure: 'the SMILES',
  name: 'the name',
  formula: 'the molecular formula (e.g. C9H8O4)',
};

export function loadQuestions(set: QuestionSet = 'standard'): Question[] {
  const text = readFileSync(new URL(SET_FILE[set], import.meta.url), 'utf8');
  return text.trim().split('\n').map((l) => JSON.parse(l) as Question);
}

/** How many of each, by key (Object.groupBy, which this project's TypeScript target lacks). */
export function countBy<T>(xs: readonly T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}
