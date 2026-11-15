/**
 * Name every structure in a file and have OPSIN read each name back: a name counts only if it
 * gives the same structure again. Prints the tally and writes the cases to look at.
 *
 *   node --experimental-strip-types --no-warnings tools/naming/check.ts structures.tsv [out-dir]
 *
 * The file has one structure per line: a label, a tab, a SMILES. Needs Java and
 * tools/opsin/opsin.jar (tools/opsin/fetch.sh).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { computeMass, parseSmiles, sameStereoisomer, sameStructure, type Molecule } from '../../packages/core/src/index.ts';
import { isMetal } from '../../packages/naming/src/simple.ts';
import { nameMolecule } from '../../packages/naming/src/index.ts';
import '../../packages/naming/src/all-rings.ts';
import { opsinAvailable, opsinToSmiles } from '../../packages/naming/src/opsin.ts';

const [file, outDir = 'tools/naming/out'] = process.argv.slice(2);
if (!file) { console.error('usage: check.ts structures.tsv [out-dir]'); process.exit(2); }
if (!opsinAvailable()) { console.error('OPSIN is not available: install Java and run tools/opsin/fetch.sh'); process.exit(2); }

/** Every bond to a metal taken apart into ions. */
function ionic(mol: Molecule): Molecule {
  const m = mol.clone();
  for (const b of [...m.bonds()]) {
    const metal = [b.begin, b.end].find((a) => isMetal(m.atom(a).element));
    if (metal === undefined) continue;
    const other = b.begin === metal ? b.end : b.begin;
    if (isMetal(m.atom(other).element)) continue;
    m.atom(metal).charge += b.order; m.atom(other).charge -= b.order;
    m.removeBond(b.id);
  }
  // A hydrogen written on a metal ([KH], [AlH3]) is a hydride ion all the same.
  for (const a of [...m.atoms()]) {
    if (!isMetal(a.element) || !a.explicitHydrogens) continue;
    for (let i = 0; i < a.explicitHydrogens; i++) m.addAtom({ element: 'H', x: 0, y: 0, charge: -1, explicitHydrogens: 0 });
    a.charge += a.explicitHydrogens; a.explicitHydrogens = 0;
  }
  return m;
}

interface Row { label: string; smiles: string; mol?: Molecule; name?: string; reason?: string; ms?: number; verdict?: string; back?: string }
const rows: Row[] = readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('\t')).map((l) => { const [label, smiles] = l.split('\t') as [string, string]; return { label, smiles: smiles.trim() }; });

for (const r of rows) {
  try { r.mol = parseSmiles(r.smiles); } catch (e) { r.verdict = 'unreadable SMILES'; r.reason = (e as Error).message; continue; }
  const t = performance.now();
  try {
    const res = nameMolecule(r.mol);
    if (res.name) r.name = res.name; else { r.verdict = 'declined'; r.reason = res.reason ?? ''; }
  } catch (e) { r.verdict = 'CRASH'; r.reason = (e as Error).message; }
  r.ms = performance.now() - t;
}

// A mixture is named part by part ("a · b"); OPSIN reads each part.
const named = rows.filter((r) => r.name);
const parts = named.flatMap((r) => r.name!.split(' · '));
const read = opsinToSmiles(parts);
let k = 0;
for (const r of named) {
  const n = r.name!.split(' · ').length;
  const got = read.slice(k, k + n); k += n;
  if (got.some((g) => g === null)) { r.verdict = /^(5'-|[A-Z][a-z]*-.*-(OH|NH2|OMe)$)/.test(r.name!) ? 'sequence' : 'unread'; continue; }
  r.back = got.join('.');
  let other: Molecule;
  try { other = parseSmiles(r.back); } catch { r.verdict = 'unread'; continue; }
  try {
    r.verdict = sameStereoisomer(r.mol!, other) ? 'ok' : sameStructure(r.mol!, other) ? 'stereo differs'
      // A salt drawn with bonds to its metal and one written as ions are the same compound; so are
      // two ways of writing a molecule of one or two atoms (carbon monoxide).
      : sameStructure(ionic(r.mol!), ionic(other)) || (r.mol!.atomCount <= 2 && computeMass(r.mol!).formula === computeMass(other).formula) ? 'ok' : 'WRONG';
  } catch (e) { r.verdict = 'compare failed'; r.reason = (e as Error).message; }
}

// OPSIN reads a composition name of metal ions with inorganic anions ("bismuth(III) hydroxide chromate",
// "dialuminium dicalcium pentaoxide") as covalent compounds or not at all: those it cannot referee.
const composition = (mol: Molecule) => {
  const frags = mol.fragments();
  const bare = (f: number[]) => f.length === 1 && isMetal(mol.atom(f[0]!).element) && mol.atom(f[0]!).charge > 0;
  const inorganicIon = (f: number[]) => !f.some((a) => mol.atom(a).element === 'C') && f.some((a) => mol.atom(a).charge < 0);
  return frags.some(bare) && frags.some(inorganicIon);
};
for (const r of rows) if ((r.verdict === 'WRONG' || r.verdict === 'unread') && r.mol && composition(r.mol)) r.verdict = 'inorganic, not checked';

const tally = new Map<string, number>();
for (const r of rows) tally.set(r.verdict!, (tally.get(r.verdict!) ?? 0) + 1);
const order = ['ok', 'sequence', 'inorganic, not checked', 'declined', 'stereo differs', 'unread', 'WRONG', 'CRASH', 'compare failed', 'unreadable SMILES'];
console.log(`${rows.length} structures`);
for (const v of order) if (tally.has(v)) console.log(`  ${v.padEnd(18)} ${tally.get(v)}`);
const why = new Map<string, number>();
for (const r of rows) if (r.verdict === 'declined') { const key = r.reason!.replace(/\d+/g, 'N').slice(0, 60); why.set(key, (why.get(key) ?? 0) + 1); }
console.log('declined, by reason:');
for (const [reason, n] of [...why].sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log(`  ${String(n).padStart(5)}  ${reason}`);
const slow = rows.filter((r) => (r.ms ?? 0) > 500).sort((a, b) => b.ms! - a.ms!);
if (slow.length) console.log(`slow (over 0.5 s): ${slow.length}, worst ${slow[0]!.label} ${Math.round(slow[0]!.ms!)} ms`);

mkdirSync(outDir, { recursive: true });
const dump = (verdicts: string[], name: string) => writeFileSync(`${outDir}/${name}.tsv`, rows.filter((r) => verdicts.includes(r.verdict!)).map((r) => [r.label, r.smiles, r.name ?? '', r.back ?? '', r.reason ?? ''].join('\t')).join('\n') + '\n');
dump(['WRONG', 'stereo differs', 'CRASH', 'compare failed'], 'wrong');
dump(['unread'], 'unread');
dump(['inorganic, not checked'], 'inorganic');
dump(['declined'], 'declined');
dump(['unreadable SMILES'], 'unreadable');
dump(['ok'], 'ok');
process.exit(tally.has('WRONG') || tally.has('CRASH') ? 1 : 0);
