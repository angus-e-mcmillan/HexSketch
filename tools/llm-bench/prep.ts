/**
 * Builds questions.jsonl, the LLM benchmark's questions, from the naming
 * benchmark's structures (tools/bench/structures.tsv) and a few reactions
 * written by hand. Every name in a question is one HexSketch generated and
 * OPSIN parsed back to the same structure (and stereoisomer), so the answer
 * key is checked twice over. Deterministic: the same files give the same
 * questions. Run once and commit the result; needs Java (for OPSIN).
 *
 *   node --experimental-strip-types tools/llm-bench/prep.ts
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { analyze, compare, name, readStructure } from '../../packages/agent/src/index.ts';
import { opsin } from './grade.ts';
import { countBy, type Question } from './questions.ts';

const here = new URL('.', import.meta.url);
const bench = new URL('../bench/', here);

const failed = new Set(readFileSync(new URL('failures.tsv', bench), 'utf8').split('\n').map((l) => l.split('\t')[1]));
const [, ...rows] = readFileSync(new URL('structures.tsv', bench), 'utf8').trim().split('\n');

interface Candidate { id: string; smiles: string; heavy: number; name: string; stereo: boolean }
const candidates: Candidate[] = [];
for (const row of rows) {
  const [set, id, , smiles] = row.split('\t') as [string, string, string, string];
  // Drug-like molecules (ZINC), not the solvent-sized solubility set.
  if (set === 'solubility' || failed.has(id) || candidates.some((c) => c.id === id)) continue;
  // ZINC's protonation states ([NH2+]=c1...) are not how a chemist would name or draw the compound; nitro groups are fine.
  if (/\+|-\]/.test(smiles.replaceAll('[N+](=O)[O-]', ''))) continue;
  const s = await readStructure(smiles);
  const n = (await name(s)).name;
  if (!n) continue;
  candidates.push({ id, smiles, heavy: [...s.mol.atoms()].filter((a) => a.element !== 'H').length, name: n, stereo: /[@]/.test(smiles) || /[/\\]/.test(smiles) });
}
// A fixed order that has nothing to do with the files' order.
const key = (c: Candidate) => createHash('sha256').update(`hexsketch-llm-bench:${c.id}`).digest('hex');
candidates.sort((a, b) => (key(a) < key(b) ? -1 : 1));

// Keep only names OPSIN reads back to exactly the structure.
const back = opsin(candidates.map((c) => c.name));
const checked: Candidate[] = [];
for (const [i, c] of candidates.entries()) {
  const smi = back[i];
  if (smi && (await compare(smi, c.smiles)).same) checked.push(c);
}

const pick = (n: number, ok: (c: Candidate) => boolean, used: Set<string>) => {
  const out = checked.filter((c) => !used.has(c.id) && ok(c)).slice(0, n);
  for (const c of out) used.add(c.id);
  return out;
};

/** How many of each kind: the pilot's share first, then the rest of the full set. */
const PLAN = { name2smiles: [8, 32], stereo: [6, 24], smiles2name: [6, 24], formula: [4, 16] } as const;
const used = new Set<string>();
const questions: Question[] = [];
const add = (q: Omit<Question, 'pilot'>, pilot: boolean) => questions.push({ ...q, pilot });

for (const [pilotN, restN] of [PLAN.name2smiles]) {
  pick(pilotN + restN, (c) => !c.stereo && c.heavy >= 16 && c.heavy <= 32, used).forEach((c, i) =>
    add({ id: `name2smiles-${c.id}`, category: 'name2smiles', prompt: `Give the SMILES of ${c.name}.`, answer: { kind: 'structure', smiles: c.smiles, stereo: false } }, i < pilotN));
}
for (const [pilotN, restN] of [PLAN.stereo]) {
  pick(pilotN + restN, (c) => c.stereo && /\((?:[0-9,a-z']*[RSEZ])/.test(c.name) && c.heavy >= 10, used).forEach((c, i) =>
    add({ id: `stereo-${c.id}`, category: 'stereo', prompt: `Give the SMILES of ${c.name}, with its stereochemistry.`, answer: { kind: 'structure', smiles: c.smiles, stereo: true } }, i < pilotN));
}
for (const [pilotN, restN] of [PLAN.smiles2name]) {
  pick(pilotN + restN, (c) => c.heavy >= 14 && c.heavy <= 30, used).forEach((c, i) =>
    add({ id: `smiles2name-${c.id}`, category: 'smiles2name', prompt: `Give the IUPAC name of the compound with SMILES ${c.smiles}.`, answer: { kind: 'name', smiles: c.smiles, stereo: c.stereo } }, i < pilotN));
}
for (const [pilotN, restN] of [PLAN.formula]) {
  for (const [i, c] of pick(pilotN + restN, (c) => c.heavy >= 16 && c.heavy <= 32, used).entries()) {
    const formula = (await analyze(c.smiles)).formula;
    add({ id: `formula-${c.id}`, category: 'formula', prompt: `What is the molecular formula of ${c.name}?`, answer: { kind: 'formula', formula } }, i < pilotN);
  }
}

/**
 * Reactions with one textbook product, written for this benchmark. Graded on
 * connectivity (racemic products, and an endo adduct whose relative
 * configuration the question doesn't ask for).
 */
const REACTIONS: [string, string, string, boolean][] = [
  ['grignard', 'Benzaldehyde is treated with methylmagnesium bromide in diethyl ether, then with aqueous NH4Cl. What is the product?', 'CC(O)c1ccccc1', true],
  ['diels-alder', 'Cyclopentadiene reacts with maleic anhydride. What is the product?', 'O=C1OC(=O)C2C3C=CC(C3)C12', true],
  ['fischer', 'Benzoic acid is heated in methanol with a little sulfuric acid. What is the product?', 'COC(=O)c1ccccc1', true],
  ['friedel-crafts', 'Anisole is treated with acetyl chloride and AlCl3. What is the major product?', 'COc1ccc(C(C)=O)cc1', true],
  ['ozonolysis', '1-Methylcyclohexene is treated with ozone at −78 °C, then with dimethyl sulfide. What is the product?', 'CC(=O)CCCCC=O', true],
  ['boc', 'Glycine methyl ester is treated with di-tert-butyl dicarbonate and triethylamine. What is the product?', 'COC(=O)CNC(=O)OC(C)(C)C', true],
  ['wittig', 'Benzaldehyde reacts with methylenetriphenylphosphorane (Ph3P=CH2). What is the organic product other than triphenylphosphine oxide?', 'C=Cc1ccccc1', false],
  ['hydroboration', '1-Methylcyclohexene is treated with BH3·THF, then with H2O2 and NaOH. What is the product?', 'CC1CCCCC1O', false],
  ['reduction', 'Methyl 4-nitrobenzoate is hydrogenated over Pd/C in ethanol. What is the product?', 'COC(=O)c1ccc(N)cc1', false],
  ['saponification', 'Ethyl acetate is heated with aqueous NaOH, then acidified with HCl. What are the organic products? Give both, joined with "."', 'CC(=O)O.CCO', false],
  ['aldol', 'Acetone and benzaldehyde (1 : 1) are stirred with aqueous NaOH until the dehydrated aldol product forms. What is the product?', 'CC(=O)C=Cc1ccccc1', false],
  ['amide', 'Benzoyl chloride is added to benzylamine with triethylamine in dichloromethane. What is the product?', 'O=C(NCc1ccccc1)c1ccccc1', false],
];
for (const [id, prompt, smiles, pilot] of REACTIONS) add({ id: `reaction-${id}`, category: 'reaction', prompt, answer: { kind: 'structure', smiles, stereo: false } }, pilot);

// Every answer must read.
for (const q of questions) if (q.answer.kind !== 'formula') await readStructure(q.answer.smiles);

writeFileSync(new URL('questions.jsonl', here), questions.map((q) => JSON.stringify(q)).join('\n') + '\n');
const count = (pilot: boolean) => Object.entries(countBy(questions.filter((q) => !pilot || q.pilot), (q) => q.category)).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`pilot: ${count(true)}\nall: ${count(false)}`);
