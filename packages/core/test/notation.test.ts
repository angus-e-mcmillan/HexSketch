/** Formulas typed as text are set in Formula style; other words with digits are left alone. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { autoFormula, isFormulaWord, splitSymbols } from '../src/index.ts';

test('formulas are recognised', () => {
  for (const w of ['NaN3', 'CH2Cl2', 'Et3N', 'O2', 'Cl2', 'NH4+', 'Na+', 'Ca2+', 'Pd(PPh3)4', 'Pd2(dba)3', 'K2CO3', 'Cs2CO3', 'B2pin2',
    'CuSO4·5H2O', 'iPr2NEt', 'H2SO4', 'n-Bu4NF', 'LiAlH4', 'NaBH4', 'H2O2', 'Ti(OiPr)4']) assert.ok(isFormulaWord(w), w);
});

test('words that only look like formulas are not', () => {
  for (const w of ['SN2', 'SN1', 'SNAr', 'E1cb', 'E2', 'C3', 'N1', '92%', '12', '2h', 'Step1', 'THF', 'MeOH', 'B3LYP', 'rt']) assert.ok(!isFormulaWord(w), w);
});

test('autoFormula marks formula words only, and skips the word being typed', () => {
  assert.deepEqual(autoFormula([{ text: 'NaN3, DMF, 80 °C' }]), [{ text: 'NaN3', script: 'formula' }, { text: ', DMF, 80 °C' }]);
  assert.deepEqual(autoFormula([{ text: 'SN2 at C3' }]), [{ text: 'SN2 at C3' }]);
  // The caret at the end of "NaN3": left alone until the word is finished.
  assert.deepEqual(autoFormula([{ text: 'NaN3' }], [4, 4]), [{ text: 'NaN3' }]);
  // Styled runs keep their style.
  assert.deepEqual(autoFormula([{ text: 'NaN3', bold: true }]), [{ text: 'NaN3', bold: true, script: 'formula' }]);
  assert.deepEqual(autoFormula([{ text: 'NaN3', script: 'sup' }]), [{ text: 'NaN3', script: 'sup' }]);
});

test('letters split into symbols and abbreviations', () => {
  assert.deepEqual(splitSymbols('NHBoc').pieces, ['N', 'H', 'Boc']);
  assert.deepEqual(splitSymbols('COOH').pieces, ['C', 'O', 'O', 'H']);
  assert.deepEqual(splitSymbols('OSEM').pieces, ['O', 'SEM']);
  assert.equal(splitSymbols('Xyz').known, false);
});
