/**
 * The paper sat by hand: an answer sheet filled in with the official answers
 * must come back 100 out of 100, or the marking is not measuring the models
 * fairly either. The sheet is built and filled here, so the whole path is
 * exercised: Boc and the other abbreviations a chemist draws, stages along
 * arrows, highlighted atoms, numbers beside atoms, and written answers.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { drawnOut, readStructure } from '../../../packages/agent/src/index.ts';
import { makeArrow, makeCaption, readCdxmlDocument, readCdxmlStyle, smilesAtomMaps, writeCdxml, type Caption, type DocObject } from '../../../packages/core/src/index.ts';
import { loadQuestions } from '../questions.ts';

const here = new URL('..', import.meta.url).pathname;

test('the official answers, drawn on the answer sheet, score full marks', async (t) => {
  const questions = loadQuestions();
  if (!questions.length) return t.skip('the paper is not built here');
  execFileSync('node', ['--experimental-strip-types', '--no-warnings', join(here, 'sheet.ts')], { stdio: 'ignore' });
  const sheetFile = join(here, 'answer-sheet.cdxml');
  assert.ok(existsSync(sheetFile), 'the answer sheet is written');

  const xml = readFileSync(sheetFile, 'utf8');
  const doc = readCdxmlDocument(xml), style = readCdxmlStyle(xml);
  const objects: DocObject[] = [...doc.objects];
  const caps = doc.objects.filter((o): o is Caption => o.kind === 'text');
  for (const q of questions) {
    const head = caps.find((c) => new RegExp(`^\\s*${q.id}\\b`).test(c.text.trim()));
    assert.ok(head, `${q.id} has a heading on the sheet`);
    const y0 = head.y + 110;
    const k = q.key;
    const stages = k.kind === 'structure' ? [[k.smiles]] : k.kind === 'structures' ? [k.smiles] : k.kind === 'sequence' ? k.stages : k.kind === 'atoms' || k.kind === 'ranking' ? [[k.smiles]] : [];
    if (!stages.length) {
      const text = k.kind === 'number' ? `Answer: ${k.value}` : `Answer: ${k.kind === 'term' ? k.accept[0] : ''}`;
      objects.push(makeCaption(60, y0, text, [{ text, script: 'formula' }], 'left'));
      continue;
    }
    let x = 60;
    for (const [si, stage] of stages.entries()) {
      if (si) { objects.push(makeArrow({ x: x + 10, y: y0 }, { x: x + 70, y: y0 })); x += 90; }
      for (const smi of stage) {
        // Drawn as a chemist draws, with the protecting groups abbreviated.
        const s = await readStructure(smi, { format: 'smiles', abbreviate: true });
        const xs = [...s.mol.atoms()].map((a) => a.x), ys = [...s.mol.atoms()].map((a) => a.y);
        const dx = x - Math.min(...xs), dy = y0 - (Math.min(...ys) + Math.max(...ys)) / 2;
        const ids = new Map<number, number>();
        for (const a of s.mol.atoms()) ids.set(a.id, doc.mol.addAtom({ ...a, x: a.x + dx, y: a.y + dy }).id);
        for (const b of s.mol.bonds()) doc.mol.addBond({ ...b, begin: ids.get(b.begin)!, end: ids.get(b.end)! });
        for (const [map, id] of smilesAtomMaps(s.mol)) {
          const at = doc.mol.atom(ids.get(id)!);
          if (k.kind === 'atoms') at.highlight = '#ffe066';
          else {
            const others = [...doc.mol.atoms()].filter((o) => o.id !== at.id);
            const spots = Array.from({ length: 24 }, (_, i) => ({ x: at.x + Math.cos((i / 12) * Math.PI) * 13, y: at.y + Math.sin((i / 12) * Math.PI) * 13 }));
            const room = (p: { x: number; y: number }) => Math.min(...others.map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
            const spot = spots.reduce((best, p) => (room(p) > room(best) ? p : best));
            objects.push(makeCaption(spot.x, spot.y + 4, String(map), [{ text: String(map), script: 'formula' }], 'center'));
          }
        }
        x += Math.max(...xs) - Math.min(...xs) + 60;
      }
    }
    if (q.hazard?.length) { const warn = `Hazard: ${q.hazard[0]}`; objects.push(makeCaption(60, y0 + 70, warn, [{ text: warn, script: 'formula' }], 'left')); }
  }
  const filled = join(tmpdir(), `answers-${process.pid}.cdxml`);
  writeFileSync(filled, writeCdxml(drawnOut(doc.mol, style), style, objects));

  const out = execFileSync('node', ['--experimental-strip-types', '--no-warnings', join(here, 'sat.ts'), '--file', filled, '--who', 'the key', '--run', `sat-check-${process.pid}`], { encoding: 'utf8' });
  const total = questions.reduce((sum, q) => sum + q.marks, 0);
  assert.match(out, new RegExp(`the key: ${total} / ${total}`), out.split('\n').filter((l) => / \d+ \/ \d+ /.test(l) && !/ (\d+) \/ \1$/.test(l.trim())).join('\n'));
});
