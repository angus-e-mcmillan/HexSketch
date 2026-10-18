/**
 * Keyboard shortcuts, identical to ChemDraw 20.1.
 *
 * ChemDraw resolves a key against whatever is under the mouse: an atom, a
 * bond, or nothing (a "generic" tool switch). The bindings below reproduce
 * ChemDraw's shipped hotkeys.xml key for key; hotkeys.test.ts checks them
 * against the installed ChemDraw's file when one is present. Keys are
 * case-sensitive, so "o" and "O" differ (O versus OMe).
 */

export type AtomAction =
  | { kind: 'label'; text: string }
  | { kind: 'sprout'; value: number }
  | { kind: 'charge'; delta: 1 | -1 }
  | { kind: 'attachmentPoint' }
  | { kind: 'atomNumber' };

export type BondAction =
  | { kind: 'order'; order: 1 | 2 | 3 }
  | { kind: 'doublePosition'; position: 'left' | 'right' | 'center' }
  | { kind: 'front' }
  | { kind: 'fuseRing'; size: number }
  | { kind: 'display'; display: 'dashed' | 'tautomeric' | 'hash' | 'hashedWedge' | 'doubleBold' | 'bold' | 'wedge' | 'wavy' };

export type ToolId =
  | 'benzene' | 'cyclopentadiene' | 'solidBond' | 'acyclicChain' | 'arrow' | 'chemicalSymbols'
  | 'text' | 'bracket' | 'tlcPlate' | 'orbital' | 'marquee';

export type GenericAction =
  | { kind: 'tool'; tool: ToolId }
  | { kind: 'dialog'; dialog: 'chooseNickname' | 'properties' };

const label = (text: string): AtomAction => ({ kind: 'label', text });
const sprout = (value: number): AtomAction => ({ kind: 'sprout', value });

/** Hovering an atom. */
export const ATOM_HOTKEYS: Readonly<Record<string, AtomAction>> = {
  A: label('Ac'), b: label('Br'), B: label('B'), c: label('C'), C: label('Cl'),
  d: label('D'), e: label('Et'), E: label('CO2Me'), f: label('F'), F: label('CF3'),
  h: label('H'), H: label('Cbz'), i: label('I'), l: label('Cl'), L: label('Li'),
  m: label('Me'), M: label('MgBr'), n: label('N'), w: label('N'), N: label('NO2'),
  o: label('O'), O: label('OMe'), q: label('O'), Q: label('Fmoc'), p: label('P'),
  P: label('Ph'), r: label('R'), s: label('S'), S: label('Si'), x: label('X'),
  y: label('Boc'), Z: label('N3'), '!': label('?'),
  '0': sprout(0), '1': sprout(1), '2': sprout(2), '3': sprout(3), a: sprout(3),
  '4': sprout(4), '5': sprout(5), '6': sprout(6), '7': sprout(7), '8': sprout(8),
  '9': sprout(9), z: sprout(10), v: sprout(11), u: sprout(12), K: sprout(13), k: sprout(14),
  '.': { kind: 'attachmentPoint' },
  "'": { kind: 'atomNumber' },
  '-': { kind: 'charge', delta: -1 },
  '+': { kind: 'charge', delta: 1 },
};

/** Hovering a bond. */
export const BOND_HOTKEYS: Readonly<Record<string, BondAction>> = {
  f: { kind: 'front' },
  l: { kind: 'doublePosition', position: 'left' },
  r: { kind: 'doublePosition', position: 'right' },
  c: { kind: 'doublePosition', position: 'center' },
  '1': { kind: 'order', order: 1 }, '2': { kind: 'order', order: 2 }, '3': { kind: 'order', order: 3 },
  v: { kind: 'fuseRing', size: 3 }, '4': { kind: 'fuseRing', size: 4 }, '5': { kind: 'fuseRing', size: 5 },
  '6': { kind: 'fuseRing', size: 6 }, '7': { kind: 'fuseRing', size: 7 }, '8': { kind: 'fuseRing', size: 8 },
  '9': { kind: 'fuseRing', size: 9 }, '0': { kind: 'fuseRing', size: 10 },
  a: { kind: 'fuseRing', size: 2 }, z: { kind: 'fuseRing', size: 1 },
  d: { kind: 'display', display: 'dashed' }, D: { kind: 'display', display: 'tautomeric' },
  H: { kind: 'display', display: 'hash' }, h: { kind: 'display', display: 'hashedWedge' },
  W: { kind: 'display', display: 'hashedWedge' }, B: { kind: 'display', display: 'doubleBold' },
  b: { kind: 'display', display: 'bold' }, w: { kind: 'display', display: 'wedge' },
  y: { kind: 'display', display: 'wavy' },
};

/** Mouse over empty canvas: tool switching. */
export const GENERIC_HOTKEYS: Readonly<Record<string, GenericAction>> = {
  j: { kind: 'tool', tool: 'benzene' }, J: { kind: 'tool', tool: 'cyclopentadiene' },
  x: { kind: 'tool', tool: 'solidBond' }, X: { kind: 'tool', tool: 'acyclicChain' },
  e: { kind: 'tool', tool: 'arrow' }, E: { kind: 'tool', tool: 'chemicalSymbols' },
  t: { kind: 'tool', tool: 'text' }, T: { kind: 'tool', tool: 'bracket' },
  g: { kind: 'tool', tool: 'tlcPlate' }, G: { kind: 'tool', tool: 'orbital' },
  ' ': { kind: 'tool', tool: 'marquee' },
  '=': { kind: 'dialog', dialog: 'chooseNickname' },
  '/': { kind: 'dialog', dialog: 'properties' }, '?': { kind: 'dialog', dialog: 'properties' },
};

/**
 * What the "magic" sprout values build on an atom, per ChemDraw's help
 * ("Atom Hotkeys") and its Magic Hotkeys Cheat Sheet. The group is built on
 * the hotspot atom itself where it fits (2 on a chain end makes that carbon
 * the C=O of an acetyl; 3 makes it the ipso carbon of a phenyl), else a C-C
 * bond is sprouted first and the group goes on its far end.
 */
export type SproutKind =
  | 'methylCyclic' | 'methylLinear' | 'carbonyl' | 'phenyl' | 'wedge' | 'hashedWedge'
  | 'cyclohexyl' | 'cyclopentyl' | 'methylidene' | 'dimethyl' | 'alkyne'
  | 'cyclopropyl' | 'cyclobutyl' | 'tBu' | 'sulfonyl';

export const SPROUTS: Readonly<Record<number, SproutKind>> = {
  0: 'methylCyclic', 1: 'methylLinear', 2: 'carbonyl', 3: 'phenyl', 4: 'wedge',
  5: 'hashedWedge', 6: 'cyclohexyl', 7: 'cyclopentyl', 8: 'methylidene', 9: 'dimethyl',
  10: 'alkyne', 11: 'cyclopropyl', 12: 'cyclobutyl', 13: 'tBu', 14: 'sulfonyl',
};

/** Keys that work regardless of the hovered object, from ChemDraw's help. */
export const ENTER_ON_ATOM_EDITS_LABEL = true;

export type Hovered = { kind: 'atom' } | { kind: 'bond' } | { kind: 'none' };

export type ResolvedHotkey =
  | { target: 'atom'; action: AtomAction }
  | { target: 'bond'; action: BondAction }
  | { target: 'generic'; action: GenericAction }
  | { target: 'atom'; action: { kind: 'editLabel' } };

/** Resolve a key press the way ChemDraw does: the hovered object decides the table. */
export function resolveHotkey(key: string, hovered: Hovered): ResolvedHotkey | null {
  if (hovered.kind === 'atom') {
    if (key === 'Enter' && ENTER_ON_ATOM_EDITS_LABEL) return { target: 'atom', action: { kind: 'editLabel' } };
    const a = ATOM_HOTKEYS[key];
    return a ? { target: 'atom', action: a } : null;
  }
  if (hovered.kind === 'bond') {
    const b = BOND_HOTKEYS[key];
    return b ? { target: 'bond', action: b } : null;
  }
  const g = GENERIC_HOTKEYS[key];
  return g ? { target: 'generic', action: g } : null;
}
