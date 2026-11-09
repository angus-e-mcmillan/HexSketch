/**
 * The exam's questions: questions.jsonl, built by prep.ts from the drawings
 * in exam/ (one HexSketch drawing per question, see exam/README.md).
 */
import { existsSync, readFileSync } from 'node:fs';

export interface Question {
  /** The drawing's file name without .cdxml. */
  id: string;
  /** Section of the exam blueprint (exam/blueprint.json); 0 when the question gives none. */
  section: number;
  /** As written on the paper, e.g. "3.2". */
  number: string;
  marks: number;
  /** The question as the examiner wrote it. */
  text: string;
  /** SMILES of the structures drawn in the question, in reading order. */
  given: string[];
  /** Everything the model receives: the text, the structures as SMILES and any scheme. */
  prompt: string;
  answer: Answer;
}

export type Answer =
  /** One structure: full marks for the same compound (the same stereoisomer when `stereo`), half for the right connectivity with the wrong stereochemistry. */
  | { kind: 'structure'; smiles: string; stereo: boolean; also?: string[] }
  /** A name for the structure: parsed by OPSIN, then marked as a structure. `avoid`: a trivial name that earns nothing. */
  | { kind: 'name'; smiles: string; stereo: boolean; avoid?: string; also?: string[] }
  /** A molecular formula, element by element. */
  | { kind: 'formula'; formula: string }
  /** A number within a tolerance (an exact mass, a molecular weight). */
  | { kind: 'number'; value: number; tolerance: number; what: string }
  /** Several structures in any order (starting materials, products): a share of the marks per structure, less a share per extra one. */
  | { kind: 'structures'; smiles: string[]; stereo: boolean; also?: string[][] }
  /** Structures in order (a mechanism's intermediates, a route), each stage one or more structures: a share of the marks per stage given in order. */
  | { kind: 'sequence'; stages: string[][]; stereo: boolean; also?: string[][][] }
  /** Letters, e.g. "A,C": a share of the marks per right letter, less a share per wrong one. */
  | { kind: 'choice'; letters: string }
  /** A written answer the examiner marks against the scheme. */
  | { kind: 'marked'; scheme: string };

/** What the model is asked to end its answer with. */
export const ANSWER_FORMAT: Record<Answer['kind'], string> = {
  structure: 'the SMILES',
  name: 'the name',
  formula: 'the molecular formula (e.g. C9H8O4)',
  number: 'the number alone',
  structures: 'the SMILES of each structure, joined by "."',
  sequence: 'the SMILES of each structure in order, joined by " >> " (structures of one step joined by ".")',
  choice: 'the letter of your choice (for "all that apply", every letter, e.g. A,C)',
  marked: 'your full answer (it may run over several lines)',
};

export const QUESTIONS_FILE = new URL('questions.jsonl', import.meta.url);

export function loadQuestions(): Question[] {
  if (!existsSync(QUESTIONS_FILE)) return [];
  const text = readFileSync(QUESTIONS_FILE, 'utf8').trim();
  return text ? text.split('\n').map((l) => JSON.parse(l) as Question) : [];
}

export interface Blueprint { total: number; sections: { section: number; title: string; marks: number; tests: string; hexsketch: string }[] }

export function loadBlueprint(): Blueprint {
  return JSON.parse(readFileSync(new URL('exam/blueprint.json', import.meta.url), 'utf8')) as Blueprint;
}

/** How many of each, by key. */
export function countBy<T>(xs: readonly T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}
