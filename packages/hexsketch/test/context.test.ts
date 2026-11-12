/** What the model reads of a drawing, and how much the website's tools cost it on every request. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, layout2D, makeArrow, makeCaption, parseSmiles, substructureMappings, writeCdxml, type Molecule } from '@hexsketch/core';
import { drawingSummary, readStructure } from '@hexsketch/agent';
import { balanceOf, pageTools, prepare, textOf } from '../src/toolkit.ts';

test('read_sketcher sees the reagents written on an arrow', async () => {
  const mol = parseSmiles('O=C1CCCCC1'); layout2D(mol, DEFAULT_STYLE.bondLength);
  const xs = [...mol.atoms()].map((a) => a.x);
  const right = Math.max(...xs), y = [...mol.atoms()].reduce((t, a) => t + a.y, 0) / mol.atomCount;
  const cdxml = writeCdxml(mol, DEFAULT_STYLE, [
    makeArrow({ x: right + 20, y }, { x: right + 120, y }),
    makeCaption(right + 70, y - 10, 'NaBH4', undefined, 'center'),
    makeCaption(right + 70, y + 16, 'MeOH, 0 °C', undefined, 'center'),
  ]);
  assert.deepEqual(await textOf(cdxml), { text: ['the structure → nothing  (above the arrow: NaBH4; below it: MeOH, 0 °C)'] });
  assert.deepEqual(await textOf(writeCdxml(mol, DEFAULT_STYLE, [])), {}, 'no arrows or text: nothing added');
});

test('show_in_sketcher describes each field once: steps say "As <field> above", with the same types', () => {
  const show = pageTools().find((t) => t.name === 'show_in_sketcher')!;
  const props = show.parameters.properties as Record<string, { description?: string; items?: { properties: Record<string, Record<string, unknown>> } }>;
  const steps = props.steps!.items!.properties;
  // A step takes every field of the tool but steps and cycle, which are for the whole call.
  assert.deepEqual(Object.keys(steps).sort(), Object.keys(props).filter((k) => k !== 'steps' && k !== 'cycle').sort());
  for (const [k, v] of Object.entries(steps)) {
    assert.equal(v.description, `As ${k} above.`);
    // No description left anywhere inside a step's field.
    const inner = JSON.stringify({ ...v, description: undefined });
    assert.ok(!inner.includes('"description"'), `${k} still repeats a description`);
  }
  // The top-level fields keep theirs.
  assert.ok((props.reaction!.description ?? '').length > 50);
  assert.ok(JSON.stringify(show).length < 13000, `show_in_sketcher is ${JSON.stringify(show).length} characters`);
});

test('a product with a carbon from nowhere is called out on its own, apart from a byproduct left out', async () => {
  // A reductive amination drawn with an extra CH2 in the product, as a model drew it on the benchmark.
  const sm = 'O=C1CCCCC1.NCc1ccccc1';
  const wrong = await balanceOf({ stages: [sm, 'C(NCc1ccccc1)C1CCCCC1'], arrows: [{ reagents: 'NaBH3CN' }] });
  assert.equal((wrong.check_product as string[]).length, 1);
  assert.match((wrong.check_product as string[])[0]!, /^Step 1: the product has C .*product is wrong/);
  // The right product only lacks the water lost: a byproduct, not a mistake.
  const right = await balanceOf({ stages: [sm, 'C1(NCc2ccccc2)CCCCC1'], arrows: [{ reagents: 'NaBH3CN' }] });
  assert.equal(right.check_product, undefined);
  assert.deepEqual(right.balance, [{ step: 1, unbalanced: 'O on the left is not on the right' }]);
});

test('the drawing sent with a message carries the hazards of the reagents written on its arrows', async () => {
  const mol = parseSmiles('OC(=O)Cc1ccccc1'); layout2D(mol, DEFAULT_STYLE.bondLength);
  const right = Math.max(...[...mol.atoms()].map((a) => a.x)), y = [...mol.atoms()].reduce((t, a) => t + a.y, 0) / mol.atomCount;
  const objects = [makeArrow({ x: right + 20, y }, { x: right + 120, y }), makeCaption(right + 70, y - 10, '1. (COCl)2\n2. CH2N2', undefined, 'center')];
  const text = drawingSummary({ mol, objects, style: DEFAULT_STYLE })!;
  assert.match(text, /\nHazards \(screening rules only: check the SDS\):\n- Diazomethane\./);
  assert.ok(!drawingSummary({ mol, objects: [], style: DEFAULT_STYLE })!.includes('Hazards'), 'nothing hazardous, no section');
});

test('a product shown in place of the drawing keeps its starting material\'s way round, Boc drawn out there and abbreviated here (benchmark)', async () => {
  // A Suzuki product (a ring the bromide lacks) replacing the chemist's drawing of the bromide and the boronic acid, turned 90°.
  const before = (await readStructure('CC(C)(C)OC(=O)N1CCC[C@@H](C1)c1ccc(Br)cc1.OB(O)c1ccncc1', { format: 'smiles' })).mol;
  for (const a of before.atoms()) { const { x, y } = a; a.x = -y; a.y = x; }
  const { update } = await prepare({ structure: 'CC(C)(C)OC(=O)N1CCC[C@@H](C1)c1ccc(-c2ccncc2)cc1' }, before, '');
  const shown = (await readStructure(update.structure!)).mol;
  // The bromide's aryl–piperidine bond, there and in the product, by the substructure they share.
  const core = parseSmiles('C1CCNCC1c1ccccc1');
  const bondAngle = (m: Molecule) => {
    const map = substructureMappings(core, m, 1)[0]!.map;
    const p = m.atom(map.get(5)!), q = m.atom(map.get(6)!);
    return (Math.atan2(q.y - p.y, q.x - p.x) * 180) / Math.PI;
  };
  const turn = ((bondAngle(shown) - bondAngle(before) + 540) % 360) - 180;
  assert.ok(Math.abs(turn) < 5, `turned ${turn.toFixed(0)}°`);
});

test('atoms a reagent above the arrow brings are not called out (NaN3, morpholine), those NaBH3CN cannot bring are', async () => {
  const azide = await balanceOf({ stages: ['BrCCCBr', '[N-]=[N+]=NCCCN=[N+]=[N-]'], arrows: [{ reagents: 'NaN3 (2.5 equiv)', conditions: 'DMSO, 60 °C' }] });
  assert.equal(azide.check_product, undefined, 'the azide brings the N');
  const snar = await balanceOf({ stages: ['O=[N+]([O-])c1ccc(F)c(F)c1', 'O=[N+]([O-])c1ccc(N2CCOCC2)c(F)c1'], arrows: [{ reagents: 'morpholine, K2CO3' }] });
  assert.equal(snar.check_product, undefined, 'a named reagent may bring anything');
  const bare = await balanceOf({ stages: ['BrCCCBr', '[N-]=[N+]=NCCCN=[N+]=[N-]'] });
  assert.equal((bare.check_product as string[]).length, 1, 'with nothing above the arrow, the N is from nowhere');
});
