/**
 * The final exam's three rules, checked rather than asserted.
 *
 * The set was chosen by hand (see FINAL_IDS in paper.ts), and a hand-chosen set rots: a question
 * edited to fix one thing reintroduces a shared structure, or a redrawn molecule starts clashing
 * again. These are the rules that made the selection, so they are the rules that keep it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { PAPERS, type Spec } from '../paper.ts';
import { parseSmiles, readCdxmlDocument, sameStructure, type Molecule } from '../../../packages/core/src/index.ts';
import { faults } from '../layout.ts';

const FINAL = PAPERS.final!;

/** Every structure a question shows or answers with, map numbers aside. */
function structuresOf(s: Spec): string[] {
  const a = s.answer;
  const ans = 'sequence' in a ? a.sequence : 'structures' in a ? a.structures : 'atoms' in a ? [a.atoms] : 'ranking' in a ? [a.ranking] : [];
  return [...s.shown.stages.filter((t) => t !== '?'), ...ans]
    .flatMap((t) => t.split('.'))
    .map((t) => t.replace(/:\d+\]/g, ']'))
    .filter((t) => t !== '?');
}

test('the final exam holds questions', () => {
  assert.ok(FINAL.length > 60, `${FINAL.length} questions`);
});

test('no structure of six atoms or more appears in two questions', () => {
  const items: { q: string; smiles: string; mol: Molecule }[] = [];
  for (const s of FINAL) {
    for (const x of structuresOf(s)) {
      let m: Molecule;
      try { m = parseSmiles(x); } catch { continue; }
      // Reagents and small fragments are expected to recur; a compound of six atoms is not.
      if (m.atomCount < 6) continue;
      items.push({ q: s.id, smiles: x, mol: m });
    }
  }
  const shared: string[] = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!;
      if (a.q === b.q || a.mol.atomCount !== b.mol.atomCount) continue;
      if (sameStructure(a.mol, b.mol)) shared.push(`${a.q} and ${b.q} share ${a.smiles}`);
    }
  }
  assert.deepEqual(shared, []);
});

test('every drawing in the final exam is laid out without a fault', () => {
  const dir = new URL('../questions/final/', import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith('.cdxml'));
  assert.equal(files.length, FINAL.length, `${files.length} drawings for ${FINAL.length} questions: run llm-bench:author --set final`);
  const bad: string[] = [];
  for (const f of files.sort()) {
    const doc = readCdxmlDocument(readFileSync(new URL(f, dir), 'utf8'));
    // One connected component at a time, so a fault is a fault of a molecule and not of the page.
    const seen = new Set<number>();
    for (const atom of doc.mol.atoms()) {
      if (seen.has(atom.id)) continue;
      const part = new Set([atom.id]);
      for (const stack = [atom.id]; stack.length; ) {
        const id = stack.pop()!;
        for (const n of doc.mol.neighbours(id)) if (!part.has(n)) { part.add(n); stack.push(n); }
      }
      for (const id of part) seen.add(id);
      if (part.size < 3) continue;
      const sub = doc.mol.clone();
      for (const x of [...sub.atoms()]) if (!part.has(x.id)) sub.removeAtom(x.id);
      const fa = faults(sub);
      if (fa.clashes || fa.crossings || fa.labelHits) {
        bad.push(`${f.replace('.cdxml', '')}: ${fa.clashes} clashes, ${fa.crossings} crossings, ${fa.labelHits} labels over bonds`);
      }
    }
  }
  assert.deepEqual(bad, []);
});
