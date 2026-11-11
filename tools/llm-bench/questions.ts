/**
 * The benchmark's questions: questions.jsonl, built by prep.ts from the
 * HexSketch drawings in questions/ (one drawing per question; the convention
 * is in questions/README.md).
 */
import { existsSync, readFileSync } from 'node:fs';

/** The kind of task, from the drawing's file name (reaction-1.cdxml): results are reported per type. */
export const TYPES = ['reaction', 'multistep', 'mechanism', 'retrosynthesis', 'route', 'structure', 'analysis', 'hazard'] as const;
export type QuestionType = (typeof TYPES)[number];

export interface Question {
  /** The drawing's file name without .cdxml. */
  id: string;
  type: QuestionType;
  /** What the chemist types in the chat. */
  ask: string;
  /** What a right answer earns ("[4]" at the end of the Q: caption). */
  marks: number;
  /** What the chemist drew (CDXML): structures, arrows, reagents and "?". Empty when nothing is drawn. */
  drawing: string;
  /** SMILES of the structures drawn, in reading order. */
  given: string[];
  /** The drawn scheme as a chemist would type it: "Structure 1 + Structure 2 → ?  (above the arrow: …; below: …)". */
  scheme: string[];
  key: Key;
  /** Words any of which, in the model's reply, counts as flagging the hazard (hazard questions only). */
  hazard?: string[];
}

export type Key =
  /** One structure (the product, the structure asked for). */
  | { kind: 'structure'; smiles: string; also?: string[] }
  /** Several structures in any order (all the products, the starting materials). */
  | { kind: 'structures'; smiles: string[]; also?: string[][] }
  /** Structures in order, each stage one or more structures (a mechanism's intermediates, a route). */
  | { kind: 'sequence'; stages: string[][]; also?: string[][][] }
  /** Atoms of the structure (the most basic nitrogen, the stereocentres): its SMILES with them marked :1, :2… The answer must mark exactly these, numbered in any order. */
  | { kind: 'atoms'; smiles: string }
  /** Atoms in order (most nucleophilic first): its SMILES with them marked :1, :2, :3. */
  | { kind: 'ranking'; smiles: string }
  /** A number (a pKa, an angle), right within the tolerance. */
  | { kind: 'number'; value: number; tolerance: number }
  /** A word or short phrase ("sp2"): any of these, ignoring case, spaces and superscripts. */
  | { kind: 'term'; accept: string[] }
  /** A synthesis the model plans itself, in at most maxSteps steps (route.ts marks it): accepted holds the last-step disconnections the chemist accepts, each a set of building blocks. */
  | { kind: 'route'; target: string; accepted: string[][]; maxSteps: number };

/** How the model is asked to end its reply, in both conditions alike. */
export const ANSWER_FORMAT: Record<Key['kind'], string> = {
  structure: 'End your reply with two lines: "ANSWER: " followed by the SMILES of the answer, then "NAME: " followed by its IUPAC name.',
  structures: 'End your reply with one line: "ANSWER: " followed by the SMILES of each structure, joined by ".".',
  sequence: 'End your reply with one line: "ANSWER: " followed by the SMILES of each structure in order, joined by " >> " (structures of the same step joined by ".").',
  atoms: 'End your reply with one line: "ANSWER: " followed by the SMILES of the structure with the atom you mean marked by the atom-map number 1, e.g. CC[NH:1]CC (for more than one atom, number them 1, 2, 3 and so on, in any order).',
  ranking: 'End your reply with one line: "ANSWER: " followed by the SMILES of the structure with the atoms marked in the order asked by atom-map numbers 1, 2, 3 and so on, e.g. [NH2:2]CC[NH:1]C.',
  number: 'End your reply with one line: "ANSWER: " followed by the number alone.',
  term: 'End your reply with one line: "ANSWER: " followed by the answer alone, in a word or a short phrase.',
  route: 'End your reply with one line per step, in order from the starting materials: "STEP: " followed by the reaction SMILES (reactants joined by ".", then ">>", then the product), a space, and the reagents and conditions in words. For example: STEP: OC(=O)c1ccccc1.NCC>>O=C(NCC)c1ccccc1 HATU, DIPEA, DMF',
};

/** Answers that are structures (the others are about the structures in the question). */
export const isStructureKey = (k: Key): k is Extract<Key, { kind: 'structure' | 'structures' | 'sequence' }> => k.kind === 'structure' || k.kind === 'structures' || k.kind === 'sequence';

export const QUESTIONS_FILE = new URL('questions.jsonl', import.meta.url);

/** The questions of a set: the paper (questions/, questions.jsonl), or another set (questions/<set>/, questions-<set>.jsonl), such as candidates being tried out. */
export const questionsFile = (set?: string): URL => (set ? new URL(`questions-${set}.jsonl`, import.meta.url) : QUESTIONS_FILE);
export const questionsDir = (set?: string): URL => new URL(set ? `questions/${set}/` : 'questions/', import.meta.url);

export function loadQuestions(set?: string): Question[] {
  const file = questionsFile(set);
  if (!existsSync(file)) return [];
  const text = readFileSync(file, 'utf8').trim();
  return text ? text.split('\n').map((l) => JSON.parse(l) as Question) : [];
}

/** How many of each, by key (Object.groupBy, which this project's TypeScript target lacks). */
export function countBy<T>(xs: readonly T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return out;
}
