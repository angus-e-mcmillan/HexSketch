/** Nicknames attached from the right read outward, and an abbreviation is never spelt backwards (issue #38). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, Molecule } from '@hexsketch/core';
import { layoutLabel } from '../src/labels.ts';

/** The label text drawn for `label` on an atom whose one bond leaves to the right (so it reads from the right). */
function fromRight(label: string): string {
  const m = new Molecule();
  const a = m.addAtom({ element: 'C', x: 0, y: 0 });
  const b = m.addAtom({ element: 'C', x: 20, y: 0 });
  m.addBond({ begin: a.id, end: b.id, order: 1 });
  m.atom(a.id).label = label;
  return layoutLabel(m, a.id, DEFAULT_STYLE).runs.map((r) => r.text).join('');
}

test('nicknames reverse by symbol and abbreviation, keeping each whole', () => {
  for (const [label, drawn] of [
    ['OSEM', 'SEMO'], ['SEM', 'SEM'], ['OMEM', 'MEMO'], ['OBOM', 'BOMO'], ['NHBoc', 'BocHN'], ['OtBu', 'tBuO'],
    ['CO2Me', 'MeO2C'], ['CO2tBu', 'tBuO2C'], ['OTBS', 'TBSO'], ['OPMB', 'PMBO'], ['NHTs', 'TsHN'], ['COOH', 'HOOC'],
    ['OTf', 'TfO'], ['CF3', 'F3C'],
  ] as const) assert.equal(fromRight(label), drawn, label);
});

test('an abbreviation HexSketch does not know is kept as written', () => {
  assert.equal(fromRight('XYZ'), 'XYZ');
  assert.equal(fromRight('OXYZ'), 'XYZO');
});
