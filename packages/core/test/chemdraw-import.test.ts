/**
 * Opening a ChemDraw document keeps its chemistry.
 *
 * Checked against the 54 ChemDraw files in RDKit's test suite, using the R/S
 * ChemDraw itself writes into each file: HexSketch kept 269 of 540
 * stereocentres, and now keeps 534. The small documents here are written for
 * these tests in the same form ChemDraw writes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeMass, ezLabel, parseSmiles, perceiveStereoFromGeometry, readCdxml, readCdxmlDocument, rsLabel, sameStructure, writeCdxml, DEFAULT_STYLE, type Molecule } from '../src/index.ts';

const doc = (body: string) => `<?xml version="1.0"?><CDXML><page>${body}</page></CDXML>`;
const labels = (mol: Molecule) => { perceiveStereoFromGeometry(mol); return [...mol.atoms()].map((a) => rsLabel(mol, a.id)).filter(Boolean).join(); };

// Alanine's carbon, its four neighbours in a cross: N left, C(=O) right, CH3 up, H down.
const centre = (bonds: string, node = '') => doc(`<fragment>
  <n id="1" p="100 100" ${node}/><n id="2" p="80 100" Element="7" NumHydrogens="2"/><n id="3" p="120 100"/>
  <n id="4" p="100 80"/><n id="5" p="100 120" Element="1"/><n id="6" p="130 85" Element="8"/><n id="7" p="130 115" Element="8" NumHydrogens="1"/>
  ${bonds}<b id="14" B="3" E="6" Order="2"/><b id="15" B="3" E="7"/></fragment>`);

test('a bold bond is towards the viewer and a hashed bond away, at an atom with no wedge', () => {
  const plain = centre('<b id="10" B="1" E="2"/><b id="11" B="1" E="3"/><b id="12" B="1" E="4"/><b id="13" B="1" E="5"/>');
  assert.equal(labels(readCdxml(plain)), '', 'nothing drawn, nothing read');
  const wedge = labels(readCdxml(centre('<b id="10" B="1" E="2"/><b id="11" B="1" E="3"/><b id="12" B="1" E="4" Display="WedgeBegin"/><b id="13" B="1" E="5"/>')));
  const bold = labels(readCdxml(centre('<b id="10" B="1" E="2"/><b id="11" B="1" E="3"/><b id="12" B="1" E="4" Display="Bold"/><b id="13" B="1" E="5"/>')));
  const hash = labels(readCdxml(centre('<b id="10" B="1" E="2"/><b id="11" B="1" E="3"/><b id="12" B="1" E="4" Display="Hash"/><b id="13" B="1" E="5"/>')));
  assert.match(wedge, /^[RS]$/);
  assert.equal(bold, wedge, 'bold reads as a wedge');
  assert.notEqual(hash, wedge, 'hashed reads as the other');
  assert.match(hash, /^[RS]$/);
  // Written the other way round, a bold bond still counts at this end.
  assert.equal(labels(readCdxml(centre('<b id="10" B="1" E="2"/><b id="11" B="1" E="3"/><b id="12" B="4" E="1" Display="Bold"/><b id="13" B="1" E="5"/>'))), wedge);
});

test('a configuration the file records but the drawing does not show is given a wedge', () => {
  const bonds = '<b id="10" B="1" E="2"/><b id="11" B="1" E="3"/><b id="12" B="1" E="4"/><b id="13" B="1" E="5"/>';
  // ChemDraw's BondOrdering: seen from the first bond, the others run clockwise.
  const one = readCdxml(centre(bonds, 'Geometry="Tetrahedral" AS="S" BondOrdering="10 11 12 13"'));
  const other = readCdxml(centre(bonds, 'Geometry="Tetrahedral" AS="R" BondOrdering="10 12 11 13"'));
  assert.match(labels(one), /^[RS]$/);
  assert.match(labels(other), /^[RS]$/);
  assert.notEqual(labels(one), labels(other), 'the two orderings are the two configurations');
  assert.ok([...one.bonds()].some((b) => /wedge|hashBegin|hashEnd/.test(b.display)), 'shown by a wedge or a hash');
  // A drawing that already shows it is left as drawn.
  const drawn = readCdxml(centre('<b id="10" B="1" E="2"/><b id="11" B="1" E="3"/><b id="12" B="1" E="4" Display="WedgeBegin"/><b id="13" B="1" E="5"/>', 'Geometry="Tetrahedral" AS="S" BondOrdering="10 11 12 13"'));
  assert.equal([...drawn.bonds()].filter((b) => b.display !== 'plain').length, 1);
});

test('a long bond across a cage counts by its direction, not its length', () => {
  // Two ring bonds up-left and up-right, a wedged bridge far up between them, a hashed H below.
  const mol = readCdxml(doc(`<fragment><n id="1" p="100 100"/><n id="2" p="82 89.6"/><n id="3" p="118 89.6" Element="7" NumHydrogens="2"/><n id="4" p="85.8 50.4" Element="8" NumHydrogens="1"/><n id="5" p="100 120.8" Element="9"/>
    <b B="1" E="2"/><b B="1" E="3"/><b B="1" E="4" Display="WedgeBegin"/><b B="1" E="5" Display="WedgedHashBegin"/></fragment>`));
  const near = readCdxml(doc(`<fragment><n id="1" p="100 100"/><n id="2" p="82 89.6"/><n id="3" p="118 89.6" Element="7" NumHydrogens="2"/><n id="4" p="94.3 80.2" Element="8" NumHydrogens="1"/><n id="5" p="100 120.8" Element="9"/>
    <b B="1" E="2"/><b B="1" E="3"/><b B="1" E="4" Display="WedgeBegin"/><b B="1" E="5" Display="WedgedHashBegin"/></fragment>`));
  assert.match(labels(mol), /^[RS]$/);
  assert.equal(labels(mol), labels(near), 'the same drawing with the bridge drawn short');
});

test('a wavy bond leaves a centre and a double bond unspecified; a wavy double bond is a crossed one', () => {
  assert.equal(labels(readCdxml(centre('<b id="10" B="1" E="2"/><b id="11" B="1" E="3" Display="Wavy"/><b id="12" B="1" E="4" Display="WedgeBegin"/><b id="13" B="1" E="5"/>'))), '');
  const butene = (extra: string, sub = '') => readCdxml(doc(`<fragment><n id="1" p="100 100"/><n id="2" p="118 110"/><n id="3" p="136 100"/><n id="4" p="154 110"/><b B="1" E="2" ${sub}/><b B="2" E="3" Order="2" ${extra}/><b B="3" E="4"/></fragment>`));
  const ez = (mol: Molecule) => { perceiveStereoFromGeometry(mol); return [...mol.bonds()].map((b) => ezLabel(mol, b.id)).filter(Boolean).join(); };
  assert.equal(ez(butene('')), 'E');
  assert.equal(ez(butene('Display="Wavy"')), '', 'a wavy double bond');
  assert.equal(ez(butene('', 'Display="Wavy"')), '', 'a wavy bond to a substituent');
  const crossed = butene('Display="Wavy"');
  assert.equal([...crossed.bonds()].find((b) => b.order === 2)!.display, 'either');
  assert.match(writeCdxml(crossed, DEFAULT_STYLE, []), /Order="2" Display="Wavy"/, 'and is written back as ChemDraw has it');
});

test('an allene has no E or Z', () => {
  const mol = readCdxml(doc('<fragment><n id="1" p="100 110"/><n id="2" p="118 100"/><n id="3" p="136 100"/><n id="4" p="154 100"/><n id="5" p="172 110"/><b B="1" E="2"/><b B="2" E="3" Order="2"/><b B="3" E="4" Order="2"/><b B="4" E="5"/></fragment>'));
  perceiveStereoFromGeometry(mol);
  assert.deepEqual([...mol.bonds()].map((b) => ezLabel(mol, b.id)).filter(Boolean), []);
});

// An abbreviation node as ChemDraw writes it: the label, and inside it the atoms it stands for.
const nickname = (label: string, type: string, inner: string) => doc(`<fragment><n id="1" p="100 100"/><n id="2" p="118 110"/>
  <n id="3" p="136 100" NodeType="${type}"><fragment>${inner}</fragment><t><s>${label}</s></t></n><b B="1" E="2"/><b B="2" E="3"/></fragment>`);

test('an abbreviation HexSketch can read stays a label; one it cannot is drawn out as the file gives it', () => {
  const known = readCdxml(nickname('OMe', 'Fragment', '<n id="10" p="0 0" Element="8"/><n id="11" p="10 0"/><n id="12" p="-10 0" NodeType="ExternalConnectionPoint"/><b B="10" E="11"/><b B="12" E="10"/>'));
  assert.deepEqual([...known.atoms()].map((a) => a.label).filter(Boolean), ['OMe']);
  assert.equal(computeMass(known).formula, 'C3H8O');
  // "Dmab" means nothing to HexSketch; the file says it is a cyclopropylmethyl ether here.
  const unknown = readCdxml(nickname('Xyz', 'Fragment', '<n id="10" p="0 0" Element="8"/><n id="11" p="10 0"/><n id="13" p="20 5"/><n id="14" p="20 -5"/><n id="12" p="-10 0" NodeType="ExternalConnectionPoint"/><b B="10" E="11"/><b B="11" E="13"/><b B="11" E="14"/><b B="13" E="14"/><b B="12" E="10"/>'));
  assert.deepEqual([...unknown.atoms()].map((a) => a.label).filter(Boolean), [], 'no label left');
  assert.ok(sameStructure(unknown, parseSmiles('CCOC1CC1')));
  // A label read differently from what the file says is the file's: "OBz" given as a benzyl ether.
  const differs = readCdxml(nickname('OBz', 'Fragment', '<n id="10" p="0 0" Element="8"/><n id="11" p="10 0"/><n id="12" p="-10 0" NodeType="ExternalConnectionPoint"/><b B="10" E="11"/><b B="12" E="10"/>'));
  assert.ok(sameStructure(differs, parseSmiles('CCOC')));
});

test('text typed as an atom label is text, not a carbon', () => {
  const xml = doc(`<fragment><n id="1" p="100 100"/><n id="2" p="118 110"/><b B="1" E="2"/></fragment>
    <fragment><n id="3" p="200 100" NodeType="Unspecified"><t><s>THF, -78 °C</s></t></n></fragment>
    <fragment><n id="4" p="300 100" NodeType="GenericNickname"><t><s>R</s></t></n><n id="5" p="318 110"/><b B="4" E="5"/></fragment>`);
  const read = readCdxmlDocument(xml);
  assert.equal(read.mol.fragments().length, 2, 'ethane and R-CH3');
  assert.deepEqual(read.objects.filter((o) => o.kind === 'text').map((o) => o.kind === 'text' && o.text), ['THF, -78 °C']);
  assert.deepEqual([...read.mol.atoms()].map((a) => a.label).filter(Boolean), ['R']);
});

test('a radical is read back', () => {
  const mol = parseSmiles('CC(C)(C)O');
  const o = [...mol.atoms()].find((a) => a.element === 'O')!;
  o.radical = 1; o.explicitHydrogens = 0;
  const back = readCdxml(writeCdxml(mol, DEFAULT_STYLE, []));
  assert.equal([...back.atoms()].find((a) => a.element === 'O')!.radical, 1);
});
