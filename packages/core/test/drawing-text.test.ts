/** The text of a drawing for an AI: arrows with their reagents, labels and other text. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aiSummary, DEFAULT_STYLE, drawingText, layout2D, makeArrow, makeCaption, makeCurlyArrow, Molecule, parseSmiles, type DocObject } from '../src/index.ts';

const L = DEFAULT_STYLE.bondLength;

/** Structures laid out and centred at the given points, as one drawing. */
function drawing(parts: [smiles: string, x: number, y: number][]): Molecule {
  const all = new Molecule();
  for (const [smiles, x, y] of parts) {
    const m = parseSmiles(smiles); layout2D(m, L);
    const xs = [...m.atoms()].map((a) => a.x), ys = [...m.atoms()].map((a) => a.y);
    const dx = x - (Math.min(...xs) + Math.max(...xs)) / 2, dy = y - (Math.min(...ys) + Math.max(...ys)) / 2;
    const ids = new Map<number, number>();
    for (const a of m.atoms()) ids.set(a.id, all.addAtom({ ...a, x: a.x + dx, y: a.y + dy, chirality: null }).id);
    for (const b of m.bonds()) all.addBond({ ...b, begin: ids.get(b.begin)!, end: ids.get(b.end)!, ez: null });
  }
  return all;
}

test('a reaction arrow: the structures at its ends and the reagents above and conditions below it', () => {
  const mol = drawing([['O=C1CCCCC1', 100, 100], ['NCc1ccccc1', 220, 100]]);
  const objects: DocObject[] = [
    makeArrow({ x: 290, y: 100 }, { x: 390, y: 100 }),
    makeCaption(340, 90, 'NaBH3CN', undefined, 'center'),
    makeCaption(340, 116, 'CH2Cl2/HFIP (4:1)', undefined, 'center'),
    makeCaption(415, 104, '?', undefined, 'center'),
  ];
  assert.deepEqual(drawingText(mol, objects, L), ['Structure 1 + Structure 2 → ?  (above the arrow: NaBH3CN; below it: CH2Cl2/HFIP (4:1))']);
});

test('reagents over several lines, a retrosynthetic arrow, a product drawn at the head', () => {
  const mol = drawing([['CC(=O)Nc1ccccc1', 100, 100], ['Nc1ccccc1', 300, 100]]);
  const retro = makeArrow({ x: 170, y: 100 }, { x: 250, y: 100 }, 'retro');
  assert.deepEqual(drawingText(mol, [retro], L), ['Structure 1 ⇒ Structure 2']);
  const forward = [makeArrow({ x: 170, y: 100 }, { x: 250, y: 100 }), makeCaption(210, 70, '1. NaOH, H2O\n2. HCl', undefined, 'center')];
  assert.deepEqual(drawingText(mol, forward, L), ['Structure 1 → Structure 2  (above the arrow: 1. NaOH, H2O; 2. HCl)']);
});

test('other text: a label beside an atom, and text on its own; curly arrows are left out', () => {
  const mol = drawing([['CCN(C)C', 100, 100]]);
  const n = [...mol.atoms()].find((a) => a.element === 'N')!;
  // In clear space beside the nitrogen, as a chemist puts a label: the spot furthest from the other atoms.
  const others = [...mol.atoms()].filter((a) => a !== n);
  const spots = Array.from({ length: 24 }, (_, k) => ({ x: n.x + Math.cos((k / 12) * Math.PI) * L * 0.75, y: n.y + Math.sin((k / 12) * Math.PI) * L * 0.75 }));
  const room = (p: { x: number; y: number }) => Math.min(...others.map((o) => Math.hypot(o.x - p.x, o.y - p.y)));
  const spot = spots.reduce((b, p) => (room(p) > room(b) ? p : b));
  const objects: DocObject[] = [makeCaption(spot.x, spot.y + 4, 'a', undefined, 'center'), makeCaption(20, 200, 'Which nitrogen is the most basic?')];
  assert.deepEqual(drawingText(mol, objects, L), ['"a" written beside an N atom of the structure', 'Text: "Which nitrogen is the most basic?"']);
  const curly = makeCurlyArrow({ x: 90, y: 90 }, { x: 110, y: 90 });
  assert.deepEqual(drawingText(mol, [curly], L), []);
});

test('the summary for an AI carries the arrows and text, after the structures', () => {
  const mol = drawing([['O=C1CCCCC1', 100, 100]]);
  const objects: DocObject[] = [makeArrow({ x: 170, y: 100 }, { x: 250, y: 100 }), makeCaption(210, 90, 'NaBH4', undefined, 'center')];
  const text = aiSummary(mol, { objects });
  assert.match(text, /SMILES: O=C1CCCCC1[\s\S]*Arrows and text in the drawing:\n- the structure → nothing {2}\(above the arrow: NaBH4\)/);
  assert.ok(!aiSummary(mol).includes('Arrows and text'), 'without the objects, the summary is as before');
});

test('conditions that wrap to fit the arrow read back as the chemist wrote them', () => {
  const mol = drawing([['CS(=O)c1ccccc1', 100, 100]]);
  const arrow = makeArrow({ x: 170, y: 100 }, { x: 250, y: 100 });
  // As the scheme layout wraps a long line: a reagent's name is cut in two, and
  // one line already ends at a comma.
  const wrapped = makeCaption(210, 72, 'ammonium\ncarbamate,\nPhI(OAc)2, MeOH,\nrt', undefined, 'center');
  assert.deepEqual(drawingText(mol, [arrow, wrapped], L),
    ['the structure → nothing  (above the arrow: ammonium carbamate, PhI(OAc)2, MeOH, rt)']);
  // A step of a sequence starts something new even though "ii." is lower case.
  const steps = makeCaption(210, 72, 'i. DPPA, Et3N,\ntoluene, 90 °C\nii. t-BuOH,\nreflux', undefined, 'center');
  assert.deepEqual(drawingText(mol, [arrow, steps], L),
    ['the structure → nothing  (above the arrow: i. DPPA, Et3N, toluene, 90 °C; ii. t-BuOH, reflux)']);
  // A reagent ending a line, then a solvent in lower case, as a chemist writes them in ChemDraw.
  const solvent = makeCaption(210, 72, 'DIAD, PPh3\ntoluene, 0 °C', undefined, 'center');
  assert.deepEqual(drawingText(mol, [arrow, solvent], L),
    ['the structure → nothing  (above the arrow: DIAD, PPh3, toluene, 0 °C)']);
  // A break that starts something new is still a boundary between reagents.
  const items = makeCaption(210, 86, 'NaBH4\nMeOH', undefined, 'center');
  assert.deepEqual(drawingText(mol, [arrow, items], L),
    ['the structure → nothing  (above the arrow: NaBH4, MeOH)']);
});

test('a structure drawn over an arrow belongs to it, and is never taken for the product', () => {
  // As chemists draw it in ChemDraw: the second reactant over the arrow, right by its head, and
  // the product further on. Read by nearness alone, the reactant over the head became the product.
  const mol = drawing([['O=Cc1ccccc1', 100, 100], ['NCc1ccccc1', 235, 55], ['c1ccc(cc1)CNCc1ccccc1', 360, 100]]);
  const arrow = makeArrow({ x: 170, y: 100 }, { x: 270, y: 100 });
  const reagents = makeCaption(220, 125, 'NaBH(OAc)3', undefined, 'center');
  assert.deepEqual(drawingText(mol, [arrow, reagents], L),
    ['Structure 1 → Structure 3  (above the arrow: Structure 2; below it: NaBH(OAc)3)']);
});
