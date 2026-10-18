/**
 * Arrows, arcs, drawing elements and colours: geometry, handles and CDXML
 * round trips, checked against ChemDraw's own sample files where possible.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  arcParams, arcPoint, arcThrough, makeArcArrow, makeArrow, makeShape, parseSmiles, readCdxml, readCdxmlObjects, writeCdxml,
  DEFAULT_STYLE, type Arrow,
} from '@hexsketch/core';
import { depict, toSvg } from '@hexsketch/render';
import { dragHandle, Editor, objectFromDrag } from '../src/index.ts';

const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;
const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

test('AngularSize sign matches ChemDraw: the mTor sample arc reads back to its own head', () => {
  // From ChemDraw's "mTor Signalling" sample: an arc of -53.3 degrees.
  const xml = '<CDXML><page><arrow id="1" LineType="Dashed" ArrowheadHead="Full" ArrowheadType="Solid" HeadSize="1000" ArrowheadCenterSize="875" ArrowheadWidth="250" AngularSize="-53.3" Head3D="185.62 270.76 0" Tail3D="113.60 303.80 0" Center3D="182.52 359.03 0" MajorAxisEnd3D="270.85 359.03 0" MinorAxisEnd3D="182.52 447.35 0"/></page></CDXML>';
  const [a] = readCdxmlObjects(xml) as Arrow[];
  assert.ok(a!.arc && a!.line === 'dashed');
  const { t1 } = arcParams(a!);
  const h = arcPoint(a!.arc!, t1);
  assert.ok(near(h.x, 185.62, 0.3) && near(h.y, 270.76, 0.3), `head from tail + sweep: (${h.x.toFixed(2)}, ${h.y.toFixed(2)})`);
});

test('arcThrough: a positive sweep runs anticlockwise on screen and passes through both ends', () => {
  const g = arcThrough({ x: 0, y: 0 }, { x: 100, y: 0 }, 90);
  const r = Math.hypot(g.center.x, g.center.y);
  assert.ok(near(Math.hypot(100 - g.center.x, g.center.y), r));
  // Anticlockwise from left to right on screen bows downward (y > 0).
  assert.ok(g.center.y < 0, 'centre above the chord, so the arc dips below it');
  const a = makeArcArrow({ x: 0, y: 0 }, { x: 100, y: 0 }, 90);
  const { t0, t1 } = arcParams(a);
  const mid = arcPoint(a.arc!, (t0 + t1) / 2);
  assert.ok(mid.y > 0, `arc midpoint below the chord, got ${mid.y.toFixed(2)}`);
});

test('dragging an arc arrow tip slides it round the same circle (catalytic cycles)', () => {
  const ed = new Editor();
  ed.setTool({ kind: 'arrow', arrow: 'reaction', arc: 270 });
  ed.pointerDown({ x: 100, y: 100 }); ed.pointerMove({ x: 130, y: 100 }); ed.pointerMove({ x: 160, y: 100 }); ed.pointerUp({ x: 160, y: 100 });
  const a = ed.doc.objects[0] as Arrow;
  assert.ok(a.arc && a.arc.angle === 270);
  const c = { ...a.arc.center }, r = Math.hypot(a.tail.x - c.x, a.tail.y - c.y);
  const orig = clone(a);
  // Drag the head a quarter turn further round (and a little off the circle).
  const tHead = Math.atan2(a.head.y - c.y, a.head.x - c.x);
  for (const step of [10, 30, 60, 89]) {
    const ang = tHead + (step * Math.PI) / 180 * (a.arc.angle > 0 ? -1 : 1);
    dragHandle(a, orig, 'head', { x: c.x + 1.2 * r * Math.cos(ang), y: c.y + 1.2 * r * Math.sin(ang) }, { fixedAngles: true });
  }
  assert.ok(near(a.arc!.center.x, c.x) && near(a.arc!.center.y, c.y), 'centre unchanged');
  assert.ok(near(Math.hypot(a.head.x - c.x, a.head.y - c.y), r), 'head still on the circle');
  assert.ok(near(Math.hypot(a.tail.x - orig.tail.x, a.tail.y - orig.tail.y), 0), 'tail unchanged');
  assert.equal(a.arc!.angle, 359, 'sweep grew by the drag (clamped below a full turn)');
  // And back down: shorten to 200 degrees.
  const ang200 = Math.atan2(orig.tail.y - c.y, orig.tail.x - c.x) - (200 * Math.PI) / 180;
  dragHandle(a, orig, 'head', { x: c.x + r * Math.cos(ang200), y: c.y + r * Math.sin(ang200) }, { fixedAngles: true });
  for (let k = 0; k < 3; k++) dragHandle(a, orig, 'head', { x: c.x + r * Math.cos(ang200), y: c.y + r * Math.sin(ang200) }, { fixedAngles: true });
  assert.ok(Math.abs(Math.abs(a.arc!.angle) - 200) <= 1, `shortened to 200, got ${a.arc!.angle}`);
});

test('dragging the middle of a straight arrow bends it into an arc through that point; back to the line straightens it', () => {
  const a = makeArrow({ x: 0, y: 0 }, { x: 100, y: 0 });
  const orig = clone(a);
  dragHandle(a, orig, 'mid', { x: 50, y: -30 }, { fixedAngles: true });
  assert.ok(a.arc);
  const r = Math.hypot(a.arc!.center.x, a.arc!.center.y);
  assert.ok(near(Math.hypot(50 - a.arc!.center.x, -30 - a.arc!.center.y), r, 0.01), 'passes through the dragged point');
  assert.ok(near(a.head.x, 100, 0.2) && near(a.head.y, 0, 0.2), 'ends fixed');
  dragHandle(a, orig, 'mid', { x: 50, y: 0.5 }, { fixedAngles: true });
  assert.equal(a.arc, null);
});

test('arrows, arcs, shapes and colours survive a CDXML round trip', () => {
  const objs = [
    Object.assign(makeArcArrow({ x: 10, y: 10 }, { x: 60, y: 10 }, -300), { color: '#7e2b0e' }),
    Object.assign(makeArrow({ x: 0, y: 50 }, { x: 80, y: 50 }, 'retro')),
    Object.assign(makeArrow({ x: 0, y: 70 }, { x: 80, y: 70 }, 'nogo'), { line: 'bold' as const }),
    makeShape('circle', [{ x: 200, y: 200 }, { x: 230, y: 200 }, { x: 200, y: 230 }], { fill: 'shaded', color: '#11102a' }),
    makeShape('roundRect', [{ x: 300, y: 200 }, { x: 340, y: 200 }, { x: 300, y: 220 }], { line: 'dashed', shadow: true }),
    makeShape('line', [{ x: 0, y: 300 }, { x: 50, y: 320 }], { line: 'wavy' }),
  ];
  const mol = parseSmiles('c1ccccc1O');
  let i = 0;
  for (const a of mol.atoms()) { a.x = 100 + 20 * Math.cos(i); a.y = 100 + 20 * Math.sin(i); i++; }
  const ring = [...mol.atoms()].filter((a) => a.element === 'C').map((a) => a.id);
  mol.ringFills.push({ atoms: ring, color: '#ff8121' });
  const o = [...mol.atoms()].find((a) => a.element === 'O')!;
  o.color = '#ff0000'; o.highlight = '#00ffff';
  const bond = [...mol.bonds()][0]!;
  bond.color = '#0000ff'; bond.highlight = '#ffff00';
  const xml = writeCdxml(mol, DEFAULT_STYLE, objs);
  const back = readCdxmlObjects(xml);
  const arc = back[0] as Arrow;
  assert.equal(arc.arc?.angle, -300);
  assert.equal(arc.color, '#7e2b0e');
  assert.ok((back[1] as Arrow).headStyle === 'hollow' && (back[1] as Arrow).shaftSpacing === 600, 'retrosynthetic');
  assert.ok((back[2] as Arrow).nogo === 'cross' && (back[2] as Arrow).line === 'bold');
  const [circle, rect, line] = back.slice(3);
  assert.ok(circle?.kind === 'shape' && circle.shape === 'circle' && circle.fill === 'shaded' && circle.color === '#11102a');
  assert.ok(rect?.kind === 'shape' && rect.shape === 'roundRect' && rect.line === 'dashed' && rect.shadow && near(rect.points[1]!.x, 340));
  assert.ok(line?.kind === 'shape' && line.shape === 'line' && line.line === 'wavy');
  const m2 = readCdxml(xml);
  const o2 = [...m2.atoms()].find((a) => a.element === 'O')!;
  assert.equal(o2.color, '#ff0000');
  assert.equal(o2.highlight, '#00ffff');
  assert.ok([...m2.bonds()].some((b) => b.color === '#0000ff' && b.highlight === '#ffff00'));
  assert.equal(m2.ringFills.length, 1);
  assert.equal(m2.ringFills[0]!.color, '#ff8121');
  // The colour table keeps the document palette so ChemDraw's Colors menu matches.
  assert.ok(xml.includes('<color r="0.0667" g="0.0627" b="0.1647"/>'));
});

test('colour commands: selection gets colour, highlight and ring fill; breaking the ring drops the fill', () => {
  const ed = new Editor();
  ed.setTool({ kind: 'ring', size: 6, aromatic: true });
  ed.pointerDown({ x: 200, y: 200 }); ed.pointerUp({ x: 200, y: 200 });
  ed.selectAll();
  assert.ok(ed.applyColor('#ff0000'));
  assert.ok([...ed.doc.mol.bonds()].every((b) => b.color === '#ff0000'));
  assert.ok(ed.applyHighlight('#00ff00'));
  assert.ok(ed.applyRingFill('#ff8121'));
  assert.equal(ed.doc.mol.ringFills.length, 1);
  const svg = ed.render().svg;
  assert.ok(svg.includes('fill="#ff8121"'), 'ring fill painted');
  assert.ok(svg.includes('stroke="#00ff00"') && svg.includes('stroke-linecap="round"'), 'highlight band painted');
  assert.ok(svg.indexOf('#ff8121') < svg.indexOf('fill="#ff0000"'), 'backgrounds come before the structure');
  ed.doc.edit((mol) => mol.removeBond([...mol.bonds()][0]!.id));
  assert.equal(ed.doc.mol.ringFills.length, 0, 'ring broken: fill removed (ChemDraw help)');
  ed.doc.undo();
  assert.equal(ed.doc.mol.ringFills.length, 1, 'undo restores it');
});

test('drawing elements: circle from the centre, rectangle corner to corner, and they render', () => {
  const c = objectFromDrag({ kind: 'shape', shape: 'circle' }, 100, 100, 130, 140, 18.43);
  assert.ok(c.kind === 'shape' && near(Math.hypot(c.points[1]!.x - 100, c.points[1]!.y - 100), 50));
  const r = objectFromDrag({ kind: 'shape', shape: 'rect', fill: 'filled' }, 10, 10, 50, 30, 18.43);
  assert.ok(r.kind === 'shape' && near(r.points[0]!.x, 30) && near(r.points[0]!.y, 20) && near(r.points[1]!.x, 50));
  const svg = toSvg(depict(parseSmiles('C'), DEFAULT_STYLE, [c, r]));
  assert.ok(svg.includes('<path'));
});
