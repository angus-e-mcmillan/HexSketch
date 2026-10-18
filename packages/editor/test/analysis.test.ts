/**
 * Right-click > Analysis: name, formula and masses written under the
 * structure in one linked caption (measured in ChemDraw 20.1, fixture
 * chemdraw-analysis.cdxml), and File > Document Settings page layout.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  documentSize, isotopePattern, layout2D, parseSmiles, readCdxml, readCdxmlObjects, readCdxmlPage,
  writeCdxml, DEFAULT_STYLE, elementCounts, type Caption,
} from '@hexsketch/core';
import { Editor } from '../src/index.ts';

const FIX = new URL('../../../tools/visual/fixtures/', import.meta.url);

function aspirin() {
  const ed = new Editor();
  const m = parseSmiles('CC(=O)Oc1ccccc1C(=O)O');
  layout2D(m, ed.L);
  for (const a of m.atoms()) { a.x += 200; a.y += 200; }
  ed.doc.replace(m);
  ed.nameOf = () => '2-acetoxybenzoic acid';
  return ed;
}
const captions = (ed: Editor) => ed.doc.objects.filter((o): o is Caption => o.kind === 'text');
const selectAll = (ed: Editor) => { for (const a of ed.doc.mol.atoms()) ed.selection.atoms.add(a.id); };

test('ChemDraw: one centred caption, lines in fixed order whatever order they were added', () => {
  const ed = aspirin();
  selectAll(ed);
  ed.toggleAnalysis('formula');
  ed.toggleAnalysis('mw');
  ed.toggleAnalysis('name');
  const caps = captions(ed);
  assert.equal(caps.length, 1);
  assert.equal(caps[0]!.text, '2-acetoxybenzoic acid\nChemical Formula: C9H8O4\nMolecular Weight: 180.1590');
  assert.equal(caps[0]!.align, 'center');
  // Formula digits are subscripts (ChemDraw writes face 96/32 runs).
  assert.ok(caps[0]!.runs!.some((r) => r.script === 'formula' && r.text === 'C9H8O4'));
  // Centred under the structure, first baseline 1.5 caption sizes below it.
  const xs = [...ed.doc.mol.atoms()].map((a) => a.x);
  assert.ok(Math.abs(caps[0]!.x - (Math.min(...xs) + Math.max(...xs)) / 2) < 8);
  assert.deepEqual([...ed.analysisShown()].sort(), ['formula', 'mw', 'name']);
  // The same menu item again takes its line away.
  ed.toggleAnalysis('mw');
  assert.equal(captions(ed)[0]!.text, '2-acetoxybenzoic acid\nChemical Formula: C9H8O4');
});

test('ChemDraw: every analysis line matches ChemDraw 20.1 for aspirin', () => {
  const ed = aspirin();
  selectAll(ed);
  ed.toggleAnalysis('all');
  const cd = readCdxmlObjects(readFileSync(new URL('chemdraw-analysis.cdxml', FIX), 'utf8')).find((o): o is Caption => o.kind === 'text')!;
  assert.equal(captions(ed)[0]!.text, cd.text);
});

test('isotope pattern keeps fine structure, tallest first, at least 1%', () => {
  const peaks = isotopePattern(elementCounts(parseSmiles('CC(=O)Oc1ccccc1C(=O)O')));
  assert.deepEqual(peaks.map((p) => `${p.mz.toFixed(4)} (${p.relative.toFixed(1)}%)`), ['180.0423 (100.0%)', '181.0456 (9.7%)']);
  const br = isotopePattern(elementCounts(parseSmiles('Brc1ccccc1')));
  assert.equal(br.length >= 2, true);
  assert.ok(Math.abs(br[1]!.relative - 97.3) < 0.5); // 81Br
});

test('the analysis follows its structure: edits, moves, deletion and undo', () => {
  const ed = aspirin();
  selectAll(ed);
  ed.toggleAnalysis('formula');
  const cap = () => captions(ed)[0];
  // Grow the structure: the formula follows.
  const o = [...ed.doc.mol.atoms()].find((a) => a.element === 'O' && ed.doc.mol.neighbours(a.id).length === 1 && ed.doc.mol.bondOrderSum(a.id) === 1)!;
  ed.doc.edit((mol) => { const c = mol.addAtom({ element: 'C', x: o.x + 20, y: o.y }); mol.addBond({ begin: o.id, end: c.id, order: 1 }); });
  assert.equal(cap()!.text, 'Chemical Formula: C10H10O4');
  // Moving the structure moves its caption.
  const x0 = cap()!.x;
  ed.tool = { kind: 'select', mode: 'marquee' };
  ed.selection.objects.clear();
  selectAll(ed);
  ed.key('ArrowRight', {});
  assert.ok(cap()!.x > x0);
  // Deleting the structure takes the caption; undo brings both back.
  ed.doc.edit((mol) => { for (const a of [...mol.atoms()]) mol.removeAtom(a.id); });
  assert.equal(captions(ed).length, 0);
  ed.doc.undo();
  assert.equal(cap()!.text, 'Chemical Formula: C10H10O4');
});

test('a peptide caption gets its own analysis', () => {
  const ed = new Editor();
  ed.nameOf = () => null;
  ed.doc.edit((_, objects) => { objects.push({ kind: 'text', id: 77, x: 100, y: 100, text: 'H-Ala-Gly-OH', color: null }); });
  ed.selection.objects.add(77);
  ed.toggleAnalysis('formula');
  ed.toggleAnalysis('mw');
  const a = captions(ed).find((c) => c.analysis);
  assert.equal(a?.text, 'Chemical Formula: C5H10N2O3\nMolecular Weight: 146.1460');
});

test('CDXML: analysis captions round-trip and read from ChemDraw', () => {
  const ed = aspirin();
  selectAll(ed);
  ed.toggleAnalysis('formula');
  ed.toggleAnalysis('name');
  const xml = writeCdxml(ed.doc.mol, DEFAULT_STYLE, ed.doc.objects);
  assert.match(xml, /<chemicalproperty [^>]*ChemicalPropertyType="1 2"/);
  const mol = readCdxml(xml);
  const back = readCdxmlObjects(xml, mol).find((o): o is Caption => o.kind === 'text')!;
  assert.deepEqual(back.analysis?.items, ['name', 'formula']);
  assert.equal(back.analysis?.basis.length, 13);

  const cdText = readFileSync(new URL('chemdraw-analysis.cdxml', FIX), 'utf8');
  const cdMol = readCdxml(cdText);
  const cd = readCdxmlObjects(cdText, cdMol).find((o): o is Caption => o.kind === 'text')!;
  assert.deepEqual(cd.analysis?.items, ['name', 'formula', 'exactMass', 'mw', 'mz', 'elemental']);
  assert.equal(cd.analysis?.basis.length, cdMol.atomCount);
});

test('Document Settings: ChemDraw page counts and paper, A4 and slides', () => {
  // A ChemDraw document of US Letter pages less half-inch margins, 2 x 2 pages.
  const cd = readCdxmlPage(readFileSync(new URL('chemdraw-analysis.cdxml', FIX), 'utf8'));
  assert.deepEqual(cd, { paper: 'Letter', orientation: 'portrait', across: 2, down: 2 });
  const page = { paper: 'Slide16x9', orientation: 'landscape', across: 3, down: 1 } as const;
  assert.deepEqual(documentSize(page), { w: 2880, h: 540 });
  const xml = writeCdxml(parseSmiles('C'), DEFAULT_STYLE, [], { page });
  assert.deepEqual(readCdxmlPage(xml), page);
  assert.deepEqual(readCdxmlPage(writeCdxml(parseSmiles('C'), DEFAULT_STYLE, [], { page: { paper: 'A4', orientation: 'landscape', across: 1, down: 2 } })),
    { paper: 'A4', orientation: 'landscape', across: 1, down: 2 });
});
