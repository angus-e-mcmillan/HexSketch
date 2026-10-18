/** Caption fonts: chosen per run in the text bar, measured with the right metrics, kept in CDXML, SVG and PDF. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCaption, readCdxmlObjects, setCaptionRuns, writeCdxml, Molecule, DEFAULT_STYLE, type Caption } from '@hexsketch/core';
import { captionBounds, depict, textWidth, toPdf, toSvg } from '@hexsketch/render';
import { restyle } from '../src/index.ts';

function caption(): Caption {
  const c = makeCaption(100, 100, 'Yield 92%');
  setCaptionRuns(c, [{ text: 'Yield ' }, { text: '92%', font: 'Times New Roman', bold: true }]);
  return c;
}

test('Times and Courier are measured with their own metrics', () => {
  assert.ok(textWidth('Yield', 10, false, 'Times New Roman') < textWidth('Yield', 10, false));
  assert.equal(textWidth('iiii', 10, false, 'Courier New'), 24);
  assert.equal(textWidth('Yield', 10, false, 'Arial'), textWidth('Yield', 10, false));
});

test('restyle sets and clears a font', () => {
  const runs = restyle([{ text: 'ab' }], { font: 'Courier New' });
  assert.equal(runs[0]!.font, 'Courier New');
  assert.equal(restyle(runs, { font: undefined })[0]!.font, undefined);
});

test('run fonts survive CDXML and reach SVG and PDF', () => {
  const c = caption();
  const xml = writeCdxml(new Molecule(), DEFAULT_STYLE, [c]);
  assert.match(xml, /<font id="\d+" charset="iso-8859-1" name="Times New Roman"\/>/);
  const back = readCdxmlObjects(xml).find((o): o is Caption => o.kind === 'text')!;
  assert.deepEqual(back.runs?.map((r) => r.font ?? null), [null, 'Times New Roman']);
  const dep = depict(new Molecule(), DEFAULT_STYLE, [c]);
  assert.match(toSvg(dep), /font-family="Times New Roman, Times New Roman, Times, serif"/);
  const pdf = new TextDecoder('latin1').decode(toPdf(dep));
  assert.match(pdf, /\/BaseFont \/Times-Bold/);
  assert.match(pdf, /\/F6 [\d.]+ Tf/, 'the Times run is set in Times-Bold (F6)');
  // The selection box follows the narrower Times glyphs.
  const plain = makeCaption(100, 100, 'Yield 92%');
  assert.ok(captionBounds(c, DEFAULT_STYLE).x1 !== captionBounds(plain, DEFAULT_STYLE).x1);
});
