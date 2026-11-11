/** What the model reads of a drawing, and how much the website's tools cost it on every request. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_STYLE, layout2D, makeArrow, makeCaption, parseSmiles, writeCdxml } from '@hexsketch/core';
import { balanceOf, pageTools, textOf } from '../src/toolkit.ts';

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
