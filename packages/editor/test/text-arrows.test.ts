/**
 * Rich captions (formula style, scripts, styles, lines, alignment) and curly /
 * oval arrows, checked against ChemDraw 20.1 exports of the same features.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  arcParams, arcPoint, captionRuns, cloneObjects, formulaPieces, makeArcArrow, makeCaption, makeCurlyArrow, Molecule,
  readCdxmlObjects, writeCdxml, DEFAULT_STYLE, type Arrow, type Caption,
} from '@hexsketch/core';
import { depict, layoutCaption, toSvg } from '@hexsketch/render';
import { dragHandle, Editor, restyle } from '../src/index.ts';

const FIX = new URL('../../../tools/visual/fixtures/', import.meta.url);
const show = (t: string) => formulaPieces(t).map((p) => (p.kind === 'normal' ? p.text : p.kind === 'sub' ? `_${p.text}` : `^${p.text}`)).join('');

test('Formula style: digits after elements are subscripts, charges are raised, coefficients stay', () => {
  assert.equal(show('CH2Cl2'), 'CH_2Cl_2');
  assert.equal(show('Ca(OH)2'), 'Ca(OH)_2');
  assert.equal(show('NH4+'), 'NH_4^+');
  assert.equal(show('SO42−'), 'SO_4^2−');
  assert.equal(show('Ca2+'), 'Ca^2+');
  assert.equal(show('CuSO4·5H2O'), 'CuSO_4·5H_2O');
  assert.equal(show('Et3N, 0 °C'), 'Et_3N, 0 °C');
});

test('captions written in ChemDraw read back with their styles, lines and alignment', () => {
  const objs = readCdxmlObjects(readFileSync(new URL('chemdraw-text.cdxml', FIX), 'utf8')).filter((o): o is Caption => o.kind === 'text');
  const by = (t: string) => objs.find((o) => o.text.startsWith(t))!;
  assert.deepEqual(captionRuns(by('CH2Cl2')), [{ text: 'CH2Cl2', script: 'formula' }]);
  const two = by('rt');
  assert.equal(two.text, 'rt, 2 h\nthen H2O');
  assert.equal(two.align, 'center');
  assert.deepEqual(captionRuns(two).map((r) => [r.bold, r.size]), [[true, 14]]);
  const pd = by('Pd');
  assert.equal(pd.color, '#7e2b0e');
  assert.equal(captionRuns(pd)[0]!.italic, true);
  // ChemDraw puts a centred caption's anchor at its centre: so does the layout.
  const lay = layoutCaption(two, DEFAULT_STYLE);
  const mid = (Math.min(...lay.lines.map((l) => l.x0)) + Math.max(...lay.lines.map((l) => l.x1))) / 2;
  assert.ok(Math.abs(mid - two.x) < 1.5, `centre ${mid.toFixed(2)} vs anchor ${two.x}`);
});

test('styled captions survive a CDXML round trip and render each run', () => {
  const c = makeCaption(50, 50, '', [
    { text: 'Pd(PPh3)4', script: 'formula', bold: true, size: 13, color: '#7e2b0e' },
    { text: ' (5 mol%)\n' }, { text: 'then ', italic: true }, { text: 'x' }, { text: '2', script: 'sup' }, { text: 'under', underline: true },
  ], 'right');
  const back = readCdxmlObjects(writeCdxml(new Molecule(), DEFAULT_STYLE, [c]))[0] as Caption;
  assert.equal(back.align, 'right');
  assert.deepEqual(captionRuns(back), captionRuns(c));
  const svg = toSvg(depict(new Molecule(), DEFAULT_STYLE, [c]));
  assert.ok(svg.includes('font-weight="bold"') && svg.includes('font-style="italic"'));
  assert.ok(svg.includes('>3</text>') && svg.includes('font-size="9.75"'), 'formula subscript at 0.75 size');
  assert.ok(/<line[^>]*stroke-width/.test(svg), 'underline drawn');
});

test('restyle toggles on and off, and sets size and colour', () => {
  const runs = [{ text: 'ab', bold: true }, { text: 'cd' }];
  assert.deepEqual(restyle(runs, { bold: true }).map((r) => !!r.bold), [true, true], 'mixed -> all bold');
  assert.deepEqual(restyle(restyle(runs, { bold: true }), { bold: true }).map((r) => !!r.bold), [false, false], 'all -> none');
  assert.deepEqual(restyle(runs, { size: 14, color: '#ff0000' }).map((r) => [r.size, r.color]), [[14, '#ff0000'], [14, '#ff0000']]);
  const ed = new Editor();
  const cap = makeCaption(10, 10, 'CH2Cl2');
  ed.doc.objects.push(cap);
  ed.selection.objects.add(cap.id);
  assert.ok(ed.styleCaptions({ script: 'formula', align: 'center' }));
  const c2 = ed.doc.objects[0] as Caption;
  assert.equal(c2.align, 'center');
  assert.equal(captionRuns(c2)[0]!.script, 'formula');
});

test('ChemDraw electron-pushing arrows read as arc arrows with the slim head', () => {
  const a = readCdxmlObjects(readFileSync(new URL('chemdraw-electron-push.cdxml', FIX), 'utf8')).find((o): o is Arrow => o.kind === 'arrow')!;
  assert.ok(a.arc && Math.abs(a.arc.angle + 84.6) < 0.01);
  assert.deepEqual([a.headSize, a.centerSize, a.width], [400, 400, 200]);
});

test('curly arrows: control points reshape them, ends stay put, and they round-trip as ChemDraw curves', () => {
  const a = makeCurlyArrow({ x: 0, y: 0 }, { x: 60, y: 0 });
  const orig = cloneObjects([a])[0] as Arrow;
  dragHandle(a, orig, 'c2', { x: 50, y: 40 }, { fixedAngles: true });
  assert.deepEqual(a.curve![2], { x: 50, y: 40 });
  assert.deepEqual([a.tail, a.head], [{ x: 0, y: 0 }, { x: 60, y: 0 }]);
  // Middle handle: the curve's midpoint follows the pointer.
  const o2 = cloneObjects([a])[0] as Arrow;
  dragHandle(a, o2, 'mid', { x: 30, y: -40 }, { fixedAngles: true });
  const c = a.curve!;
  const mid = { x: (c[0]!.x + 3 * c[1]!.x + 3 * c[2]!.x + c[3]!.x) / 8, y: (c[0]!.y + 3 * c[1]!.y + 3 * c[2]!.y + c[3]!.y) / 8 };
  assert.ok(Math.abs(mid.x - 30) < 1e-6 && Math.abs(mid.y + 40) < 1e-6);
  // Round trip through CDXML <curve>.
  const xml = writeCdxml(new Molecule(), DEFAULT_STYLE, [a]);
  assert.ok(xml.includes('<curve '));
  const back = readCdxmlObjects(xml)[0] as Arrow;
  assert.equal(back.curve!.length, 4);
  back.curve!.forEach((p, i) => assert.ok(Math.hypot(p.x - c[i]!.x, p.y - c[i]!.y) < 0.01));
  // ChemDraw's own multi-node curve arrows (sample "Solid-phase Peptide Synthesis") read too.
  const cd = readCdxmlObjects('<CDXML><page><curve id="392" LineType="Dashed" CurveType="10" ArrowheadHead="Full" ArrowheadType="Solid" CurvePoints="497.25 213 552.75 147 608.25 81 668.25 174 755.25 169.5 788.25 166.5 787.88 145.88 814.88 178.13 822.82 187.61 828 186.38 846 194.63 858.57 200.39"/></page></CDXML>')[0] as Arrow;
  assert.equal(cd.curve!.length, 10, 'four nodes, three cubic segments');
  assert.deepEqual(cd.tail, { x: 552.75, y: 147 });
  assert.deepEqual(cd.head, { x: 846, y: 194.63 });
  assert.equal(cd.line, 'dashed');
});

test('Shift-dragging an arc’s middle makes it an oval through the same ends, saved with principal axes', () => {
  const a = makeArcArrow({ x: 0, y: 0 }, { x: 80, y: 0 }, 200);
  const orig = cloneObjects([a])[0] as Arrow;
  const { t0, t1 } = arcParams(orig);
  const m0 = arcPoint(orig.arc!, (t0 + t1) / 2);
  dragHandle(a, orig, 'mid', { x: m0.x, y: m0.y * 1.6 }, { fixedAngles: true, oval: true });
  const g = a.arc!;
  const r1 = Math.hypot(g.majorEnd.x - g.center.x, g.majorEnd.y - g.center.y), r2 = Math.hypot(g.minorEnd.x - g.center.x, g.minorEnd.y - g.center.y);
  assert.ok(Math.abs(r1 - r2) > 5, 'no longer a circle');
  const p = arcParams(a);
  const tail = arcPoint(g, p.t0), head = arcPoint(g, p.t1);
  assert.ok(Math.hypot(tail.x, tail.y) < 0.01 && Math.hypot(head.x - 80, head.y) < 0.01, 'ends fixed');
  const back = readCdxmlObjects(writeCdxml(new Molecule(), DEFAULT_STYLE, [a]))[0] as Arrow;
  const bg = back.arc!;
  const ua = { x: bg.majorEnd.x - bg.center.x, y: bg.majorEnd.y - bg.center.y }, ub = { x: bg.minorEnd.x - bg.center.x, y: bg.minorEnd.y - bg.center.y };
  assert.ok(Math.abs(ua.x * ub.x + ua.y * ub.y) < 0.05 * Math.hypot(ua.x, ua.y) * Math.hypot(ub.x, ub.y), 'axes perpendicular in the file');
  const bp = arcParams(back);
  assert.ok(Math.hypot(arcPoint(bg, bp.t1).x - 80, arcPoint(bg, bp.t1).y) < 0.05, 'head still lands on the same point after reading back');
});

test('the electron pushing tool snaps to atoms and bonds and always curls', () => {
  const ed = new Editor();
  ed.pointerDown({ x: 100, y: 100 }); ed.pointerUp({ x: 100, y: 100 });
  const [a, b] = [...ed.doc.mol.atoms()];
  ed.setTool({ kind: 'arrow', arrow: 'electron', curly: true });
  ed.pointerDown(a!); ed.pointerMove({ x: a!.x + 30, y: a!.y }); ed.pointerMove({ x: b!.x + 40, y: b!.y }); ed.pointerUp({ x: b!.x + 40, y: b!.y });
  const arrow = ed.doc.objects.find((o): o is Arrow => o.kind === 'arrow')!;
  assert.ok(arrow.curve && arrow.curve.length === 4);
  assert.ok(Math.hypot(arrow.tail.x - a!.x, arrow.tail.y - a!.y) < 0.5 * ed.L, 'starts at the atom (its lone pair)');
  assert.deepEqual([arrow.headSize, arrow.centerSize, arrow.width], [400, 400, 200], 'ChemDraw’s electron-pushing head');
});

test('alt text never contains "www", "http" or "cid" (Word empties alt text that does) and still decodes', async () => {
  const { breakLinkLikeRuns, decodePayload, encodePayload, parseSmiles, layout2D, sameStructure } = await import('@hexsketch/core');
  for (const raw of ['abcwwwdefHTTPxwWwW', 'wwwwwwhttphttpHtTp', 'xCIDcidacid', 'plain']) {
    const out = breakLinkLikeRuns(raw);
    assert.ok(!/www|http|cid/i.test(out), out);
    assert.equal(out.replace(/~/g, ''), raw);
  }
  assert.equal(breakLinkLikeRuns('plain'), 'plain', 'nothing added when not needed');
  // Many random structures: no forbidden run survives, and every payload decodes.
  const { altTextFor } = await import('@hexsketch/core');
  const alt = await altTextFor(parseSmiles('CC(=O)Oc1ccccc1C(=O)O'), '2-acetoxybenzoic acid');
  assert.ok(!/www|http|cid/i.test(alt), 'name and payload both safe');
  assert.equal(alt.split('\n')[0]!.replace(/\u2060/g, ''), '2-acetoxybenzoic acid', 'the name reads the same (an invisible word joiner breaks "cid")');
  for (const smi of ['c1ccccc1Cl.CC', 'CC(=O)Nc1ccc(O)cc1', 'OC(=O)c1ccccc1O', 'CN1CCOCC1', 'CCCCCCCCCCCCCCCCO']) {
    const m = parseSmiles(smi); layout2D(m, 18.43);
    const p = await encodePayload(m);
    assert.ok(!/www|http|cid/i.test(p), smi);
    const back = await decodePayload(p);
    assert.ok(back && sameStructure(back.mol, m), smi);
  }
});
