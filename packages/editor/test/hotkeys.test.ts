/**
 * Hotkey parity with the installed ChemDraw. Reads ChemDraw's own hotkeys.xml
 * and requires our tables to bind every key to the same command and value.
 * Skips (rather than passes silently) when ChemDraw is not installed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ATOM_HOTKEYS, BOND_HOTKEYS, GENERIC_HOTKEYS } from '../src/hotkeys.ts';

const XML = '/Applications/ChemDraw 20.1.app/Contents/Resources/SpecialPurpose/ChemDraw Items/hotkeys.xml';
const installed = existsSync(XML);

function chemdrawTable(type: string): Map<string, { command: string; value: string }> {
  const s = readFileSync(XML, 'utf8');
  const block = new RegExp(`<Object type="${type}">([\\s\\S]*?)</Object>`).exec(s)![1]!;
  const out = new Map<string, { command: string; value: string }>();
  for (const m of block.matchAll(/<Hotkey\b([^>]*)\/>/g)) {
    const attr = (n: string) => new RegExp(`${n}="([^"]*)"`).exec(m[1]!)?.[1] ?? '';
    const key = attr('key').replace('&apos;', "'");
    out.set(key, { command: attr('command'), value: attr('value') });
  }
  return out;
}

const DISPLAY: Record<string, string> = {
  DASHED: 'dashed', TAUTOMERIC: 'tautomeric', HASHED: 'hash', HASHEDWEDGED: 'hashedWedge',
  DOUBLEBOLD: 'doubleBold', BOLD: 'bold', WEDGED: 'wedge', WAVY: 'wavy',
};
const TOOL: Record<string, string> = {
  BENZENE: 'benzene', CYCLOPENTADIENE: 'cyclopentadiene', SOLIDBOND: 'solidBond', ACYCLICCHAIN: 'acyclicChain',
  ARROW: 'arrow', CHEMICALSYMBOLS: 'chemicalSymbols', TEXT: 'text', BRACKET: 'bracket',
  TLCPLATE: 'tlcPlate', ORBITAL: 'orbital', MARQUEE: 'marquee',
};

test('atom hotkeys match ChemDraw', { skip: !installed && 'ChemDraw not installed' }, () => {
  const cd = chemdrawTable('Atom');
  assert.deepEqual(new Set(Object.keys(ATOM_HOTKEYS)), new Set(cd.keys()));
  for (const [key, { command, value }] of cd) {
    const ours = ATOM_HOTKEYS[key]!;
    if (command === 'LABELTEXT') assert.deepEqual(ours, { kind: 'label', text: value }, key);
    else if (command === 'SPROUT') assert.deepEqual(ours, { kind: 'sprout', value: Number(value) }, key);
    else if (command === 'CHARGE') assert.deepEqual(ours, { kind: 'charge', delta: value === '+' ? 1 : -1 }, key);
    else if (command === 'ATTACHMENTPOINT') assert.equal(ours.kind, 'attachmentPoint', key);
    else if (command === 'ATOMNUMBER') assert.equal(ours.kind, 'atomNumber', key);
    else assert.fail(`unhandled ChemDraw atom command ${command} on "${key}"`);
  }
});

test('bond hotkeys match ChemDraw', { skip: !installed && 'ChemDraw not installed' }, () => {
  const cd = chemdrawTable('Bond');
  assert.deepEqual(new Set(Object.keys(BOND_HOTKEYS)), new Set(cd.keys()));
  for (const [key, { command, value }] of cd) {
    const ours = BOND_HOTKEYS[key]!;
    if (command === 'BONDORDER') assert.deepEqual(ours, { kind: 'order', order: Number(value) }, key);
    else if (command === 'BONDDOUBLEPOSITION') assert.deepEqual(ours, { kind: 'doublePosition', position: value.toLowerCase() }, key);
    else if (command === 'BONDPOSITION') assert.equal(ours.kind, 'front', key);
    else if (command === 'FUSERING') assert.deepEqual(ours, { kind: 'fuseRing', size: Number(value) }, key);
    else if (command === 'BONDDISPLAY') assert.deepEqual(ours, { kind: 'display', display: DISPLAY[value] }, key);
    else assert.fail(`unhandled ChemDraw bond command ${command} on "${key}"`);
  }
});

test('generic (tool) hotkeys match ChemDraw', { skip: !installed && 'ChemDraw not installed' }, () => {
  const cd = chemdrawTable('Generic');
  assert.deepEqual(new Set(Object.keys(GENERIC_HOTKEYS)), new Set(cd.keys()));
  for (const [key, { command, value }] of cd) {
    const ours = GENERIC_HOTKEYS[key]!;
    if (command === 'TOOLMODE') assert.deepEqual(ours, { kind: 'tool', tool: TOOL[value] }, key);
    else if (command === 'DIALOG') assert.equal(ours.kind, 'dialog', key);
    else assert.fail(`unhandled ChemDraw generic command ${command} on "${key}"`);
  }
});
