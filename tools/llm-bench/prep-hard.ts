/**
 * Builds hard.jsonl from hard.ts, checking every key (see hard.ts for how).
 * Needs Java (for OPSIN). With --pubchem, also re-fetches each trivial-name
 * compound from PubChem by CID and checks the SMILES and formula written here
 * against it (needs pubchem.ncbi.nlm.nih.gov).
 *
 *   node --experimental-strip-types tools/llm-bench/prep-hard.ts [--pubchem]
 */
import { writeFileSync } from 'node:fs';
import { analyze, compare, readStructure } from '../../packages/agent/src/index.ts';
import { opsin, sameFormula } from './grade.ts';
import { COMMON2NAME, COMMON2SMILES, FORMULA, NAME2SMILES, REACTIONS, SMILES2FORMULA, SMILES2NAME } from './hard.ts';
import { countBy, type Question } from './questions.ts';

const problems: string[] = [];
const questions: Question[] = [];
const add = (q: Question) => questions.push(q);
const isStereo = (smiles: string) => /[@/\\]/.test(smiles);

// Every IUPAC name, parsed in one OPSIN run, must give the SMILES written beside it.
const pairs: [where: string, name: string, smiles: string][] = [
  ...NAME2SMILES.map(([id, n, s]) => [`name2smiles ${id}`, n, s] as [string, string, string]),
  ...SMILES2NAME.map(([id, s, n]) => [`smiles2name ${id}`, n, s] as [string, string, string]),
  ...COMMON2NAME.map(([c, , s, , n]) => [`common2name ${c}`, n, s] as [string, string, string]),
  ...REACTIONS.map(([id, , n, s]) => [`reaction ${id}`, n, s] as [string, string, string]),
];
const parsed = opsin(pairs.map(([, n]) => n));
for (const [i, [where, n, s]] of pairs.entries()) {
  const smi = parsed[i];
  if (!smi) { problems.push(`${where}: OPSIN cannot parse "${n}"`); continue; }
  const c = await compare(smi, s);
  if (!c.same) problems.push(`${where}: "${n}" is ${smi} to OPSIN, not ${s}${c.sameConnectivity ? ' (stereo differs)' : ''}`);
}

// HexSketch must read PubChem's SMILES to PubChem's formula (no slip in copying them).
for (const [where, s, f] of [
  ...COMMON2SMILES.map(([n, , s, f]) => [n, s, f]),
  ...COMMON2NAME.map(([n, , s, f]) => [n, s, f]),
  ...SMILES2FORMULA.map(([id, , s, f]) => [id, s, f]),
] as [string, string, string][]) {
  const got = (await analyze(s)).formula;
  if (!sameFormula(got, f)) problems.push(`${where}: HexSketch reads the SMILES as ${got}, PubChem says ${f}`);
}

if (process.argv.includes('--pubchem')) {
  const rows: [string, number, string | null, string][] = [
    ...COMMON2SMILES.map(([n, cid, s, f]) => [n, cid, s, f] as [string, number, string, string]),
    ...COMMON2NAME.map(([n, cid, s, f]) => [n, cid, s, f] as [string, number, string, string]),
    ...SMILES2FORMULA.map(([id, cid, s, f]) => [id, cid, s, f] as [string, number, string, string]),
    ...FORMULA.map(([n, cid, f]) => [n, cid, null, f] as [string, number, null, string]),
  ];
  for (const [where, cid, s, f] of rows) {
    const r = await fetch(`https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/cid/${cid}/property/SMILES,MolecularFormula/JSON`);
    const p = ((await r.json()) as { PropertyTable: { Properties: { SMILES: string; MolecularFormula: string }[] } }).PropertyTable.Properties[0]!;
    if (p.MolecularFormula !== f) problems.push(`${where}: PubChem's formula is now ${p.MolecularFormula}`);
    if (s && !(await compare(s, p.SMILES)).same) problems.push(`${where}: not PubChem's structure (CID ${cid})`);
    await new Promise((ok) => setTimeout(ok, 250)); // PubChem allows 5 requests a second
  }
}

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }

for (const [id, n, s, pilot] of NAME2SMILES) {
  const stereo = isStereo(s);
  add({ id: `hard-name2smiles-${id}`, category: 'name2smiles', prompt: `Give the SMILES of ${n}${stereo ? ', with its stereochemistry' : ''}.`, answer: { kind: 'structure', smiles: s, stereo }, pilot });
}
for (const [id, s, , pilot] of SMILES2NAME) {
  const stereo = isStereo(s);
  add({ id: `hard-smiles2name-${id}`, category: 'smiles2name', prompt: `Give the IUPAC name of the compound with SMILES ${s}${stereo ? ', with its stereodescriptors' : ''}.`, answer: { kind: 'name', smiles: s, stereo }, pilot });
}
for (const [n, , s, , pilot] of COMMON2SMILES) {
  add({ id: `hard-common2smiles-${n.replace(/\W+/g, '-').toLowerCase()}`, category: 'common2smiles', prompt: `Give the SMILES of ${n}, with every stereocentre.`, answer: { kind: 'structure', smiles: s, stereo: true }, pilot });
}
for (const [n, , s, , , avoid, pilot] of COMMON2NAME) {
  add({ id: `hard-common2name-${avoid}`, category: 'common2name', prompt: `Give the systematic IUPAC name of ${n}, with its R/S stereodescriptors (not a trivial name).`, answer: { kind: 'name', smiles: s, stereo: true, avoid }, pilot });
}
for (const [n, , f, pilot] of FORMULA) {
  add({ id: `hard-formula-${n.split(' (')[0]!.replace(/\W+/g, '-').toLowerCase()}`, category: 'formula', prompt: `What is the molecular formula of ${n}?`, answer: { kind: 'formula', formula: f }, pilot });
}
for (const [id, , s, f, pilot] of SMILES2FORMULA) {
  add({ id: `hard-smiles2formula-${id}`, category: 'smiles2formula', prompt: `What is the molecular formula of the compound with SMILES ${s}?`, answer: { kind: 'formula', formula: f }, pilot });
}
for (const [id, prompt, , s, stereo, pilot] of REACTIONS) {
  add({ id: `hard-reaction-${id}`, category: 'reaction', prompt, answer: { kind: 'structure', smiles: s, stereo }, pilot });
}

for (const q of questions) if (q.answer.kind !== 'formula') await readStructure(q.answer.smiles);
writeFileSync(new URL('hard.jsonl', import.meta.url), questions.map((q) => JSON.stringify(q)).join('\n') + '\n');
const count = (pilot: boolean) => Object.entries(countBy(questions.filter((q) => !pilot || q.pilot), (q) => q.category)).map(([k, n]) => `${k} ${n}`).join(', ');
console.log(`pilot (${questions.filter((q) => q.pilot).length}): ${count(true)}\nall (${questions.length}): ${count(false)}`);
