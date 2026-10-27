import { elementBySymbol, elementByNumber } from './elements.ts';
import { Molecule, type BondDisplay, type BondOrder, type DoubleBondPosition } from './model.ts';
import { DEFAULT_STYLE, type DrawingStyle } from './style.ts';
import { analysisCode, analysisItemOf, type AnalysisItem } from './analysis.ts';
import { pageCdxmlAttrs, type PageSettings } from './page.ts';
import { captionRuns, newObjectId, setCaptionRuns, type ArcGeometry, type Arrow, type ArrowEnd, type Caption, type DocObject, type ObjectGroup, type Shape, type TextRun } from './objects.ts';

/**
 * CDXML reading and writing, following the published ChemDraw CDXML schema
 * (cdxml.dtd). Coordinates are points with y increasing downward, the same
 * convention the Molecule model uses, so no transform is needed.
 */

const DISPLAY_TO_CDXML: Record<BondDisplay, string | null> = {
  plain: null,
  wedgeBegin: 'WedgeBegin',
  wedgeEnd: 'WedgeEnd',
  hashBegin: 'WedgedHashBegin',
  hashEnd: 'WedgedHashEnd',
  wavy: 'Wavy',
  bold: 'Bold',
  hash: 'Hash',
  dashed: 'Dash',
  either: null,
};

const CDXML_TO_DISPLAY: Record<string, BondDisplay> = Object.fromEntries(
  Object.entries(DISPLAY_TO_CDXML).filter(([, v]) => v !== null).map(([k, v]) => [v, k as BondDisplay]),
);

const POSITION_TO_CDXML: Record<DoubleBondPosition, string | null> = {
  auto: null, center: 'Center', left: 'Left', right: 'Right',
};

/** CDXML font face bits: 1 bold, 2 italic, 32 subscript, 64 superscript; 96 is "formula". */
function labelFace(style: DrawingStyle): number {
  return (style.labelBold ? 1 : 0) | 96;
}

const fmt = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/*
 * Colours: CDXML objects name a colour by index. 0 is black and 1 white;
 * 2 and up are colortable entries, the first two being the background and
 * foreground (CDX spec, ColorTable). An absent color means foreground.
 */
const hex2rgb = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
const rgb2hex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');

class ColorTable {
  readonly entries: string[] = ['#ffffff', '#000000'];
  constructor(palette: readonly string[] = []) { for (const c of palette) this.index(c); }
  index(c: string): number {
    const h = c.toLowerCase();
    let i = this.entries.indexOf(h);
    if (i < 0) { this.entries.push(h); i = this.entries.length - 1; }
    return i + 2;
  }
  xml(): string {
    return `<colortable>${this.entries.map((h) => { const [r, g, b] = hex2rgb(h); return `<color r="${+r!.toFixed(4)}" g="${+g!.toFixed(4)}" b="${+b!.toFixed(4)}"/>`; }).join('')}</colortable>`;
  }
}

/** Colour table of a CDXML document; colorAt(index) gives '#rrggbb', or null for the foreground. */
function readColorTable(xml: string): (i: number | undefined) => string | null {
  const table = [...(/<colortable>([\s\S]*?)<\/colortable>/.exec(xml)?.[1] ?? '').matchAll(/<color\b([^>]*)\/>/g)].map((m) => {
    const v = (n: string) => Number(new RegExp(`\\b${n}="([^"]*)"`).exec(m[1]!)?.[1] ?? 0);
    return rgb2hex(v('r'), v('g'), v('b'));
  });
  return (i) => {
    if (i === undefined || Number.isNaN(i) || i === 3) return null;
    if (i === 0) return '#000000';
    if (i === 1) return '#ffffff';
    return table[i - 2] ?? null;
  };
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

export function writeCdxml(mol: Molecule, style: DrawingStyle = DEFAULT_STYLE, objects: readonly DocObject[] = [], opts: { page?: PageSettings; groups?: readonly ObjectGroup[] } = {}): string {
  let nextId = 1000;
  const nodeIds = new Map<number, number>();
  const fragIds = new Map<number, number>();
  const bondIds = new Map<number, number>();
  const lines: string[] = [];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const a of mol.atoms()) {
    minX = Math.min(minX, a.x); minY = Math.min(minY, a.y);
    maxX = Math.max(maxX, a.x); maxY = Math.max(maxY, a.y);
  }
  if (!Number.isFinite(minX)) minX = minY = maxX = maxY = 0;
  const bbox = `${fmt(minX)} ${fmt(minY)} ${fmt(maxX)} ${fmt(maxY)}`;

  lines.push('<?xml version="1.0" encoding="UTF-8" ?>');
  lines.push('<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >');
  lines.push(
    `<CDXML CreationProgram="HexSketch" BoundingBox="${bbox}"` +
    ` LabelFont="3" LabelSize="${fmt(style.labelSize)}" LabelFace="${labelFace(style)}"` +
    ` CaptionFont="3" CaptionSize="${fmt(style.captionSize)}"` +
    ` HashSpacing="${fmt(style.hashSpacing)}" MarginWidth="${fmt(style.marginWidth)}"` +
    ` LineWidth="${fmt(style.lineWidth)}" BoldWidth="${fmt(style.boldWidth)}"` +
    ` BondLength="${fmt(style.bondLength)}" BondSpacing="${fmt(style.bondSpacing)}"` +
    ` ChainAngle="${fmt(style.chainAngle)}"` +
    ` ShowTerminalCarbonLabels="${style.showTerminalCarbonLabels ? 'yes' : 'no'}"` +
    ` HideImplicitHydrogens="${style.hideImplicitHydrogens ? 'yes' : 'no'}"` +
    ` InterpretChemically="yes" color="0" bgcolor="1">`,
  );
  const colors = new ColorTable(style.palette);
  const colorAttr = (c: string | null | undefined) => (c ? ` color="${colors.index(c)}"` : '');
  const colorTableAt = lines.length;
  lines.push('');
  // Font table: 3 is the label font; caption fonts follow (each run names its own, else the document's).
  const fontIds = new Map<string, number>([[style.labelFont, 3]]);
  const fontId = (name: string) => { if (!fontIds.has(name)) fontIds.set(name, fontIds.size + 3); return fontIds.get(name)!; };
  fontId(style.captionFont);
  for (const o of objects) if (o.kind === 'text') for (const r of captionRuns(o)) if (r.font) fontId(r.font);
  lines.push(`<fonttable>${[...fontIds].map(([name, id]) => `<font id="${id}" charset="iso-8859-1" name="${esc(name)}"/>`).join('')}</fonttable>`);
  lines.push(`<page id="${nextId++}" ${opts.page ? pageCdxmlAttrs(opts.page) : 'BoundingBox="0 0 540 720"'}>`);

  // Where each fragment and object was written, so groups can wrap them afterwards.
  const segments: { atoms?: Set<number>; object?: number; from: number; to: number }[] = [];
  for (const fragment of mol.fragments()) {
    const fragLine = lines.length;
    lines.push('');
    const fragId = nextId++;
    for (const atomId of fragment) {
      const a = mol.atom(atomId);
      const id = nextId++;
      nodeIds.set(atomId, id);
      fragIds.set(atomId, fragId);
      const attrs = [`id="${id}"`, `p="${fmt(a.x)} ${fmt(a.y)}"`];
      if (a.label !== null) {
        attrs.push('NodeType="Nickname"');
      } else if (a.element !== 'C') {
        const el = elementBySymbol(a.element);
        if (el) attrs.push(`Element="${el.z}"`);
      }
      if (a.charge !== 0) attrs.push(`Charge="${a.charge}"`);
      if (a.isotope !== null) attrs.push(`Isotope="${a.isotope}"`);
      if (a.radical) attrs.push(`Radical="${a.radical === 1 ? 'Doublet' : 'Triplet'}"`);
      if (a.explicitHydrogens !== null) attrs.push(`NumHydrogens="${a.explicitHydrogens}"`);
      if (a.color) attrs.push(`color="${colors.index(a.color)}"`);
      // Highlight Colors, as ChemDraw 20.1 writes them (checked against a ChemDraw export).
      if (a.highlight) attrs.push(`highlightColor="${colors.index(a.highlight)}"`);
      if (a.label !== null) {
        lines.push(`<n ${attrs.join(' ')}><t><s font="3" size="${fmt(style.labelSize)}" face="${labelFace(style)}"${colorAttr(a.color)}>${esc(a.label)}</s></t></n>`);
      } else {
        lines.push(`<n ${attrs.join(' ')}/>`);
      }
    }
    for (const b of mol.bonds()) {
      if (!fragment.includes(b.begin)) continue;
      const attrs = [`id="${nextId++}"`, `B="${nodeIds.get(b.begin)}"`, `E="${nodeIds.get(b.end)}"`];
      if (b.order !== 1) attrs.push(`Order="${b.order}"`);
      const display = DISPLAY_TO_CDXML[b.display];
      if (display) attrs.push(`Display="${display}"`);
      const position = POSITION_TO_CDXML[b.doubleBondPosition];
      if (position && b.order === 2) attrs.push(`DoublePosition="${position}"`);
      if (b.color) attrs.push(`color="${colors.index(b.color)}"`);
      if (b.highlight) attrs.push(`highlightColor="${colors.index(b.highlight)}"`);
      bondIds.set(b.id, Number(/id="(\d+)"/.exec(attrs[0]!)![1]));
      lines.push(`<b ${attrs.join(' ')}/>`);
    }
    // Ring Fill Colors: ChemDraw writes a ColoredMolecularArea listing the ring's bonds.
    for (const f of mol.ringFills) {
      if (!f.atoms.every((a) => fragment.includes(a))) continue;
      const ring = f.atoms.map((a, i) => mol.bondBetween(a, f.atoms[(i + 1) % f.atoms.length]!)?.id);
      if (ring.some((x) => x === undefined)) continue;
      lines.push(`<ColoredMolecularArea id="${nextId++}" bgcolor="${colors.index(f.color)}" BasisObjects="${ring.map((x) => bondIds.get(x!)).join(' ')}"/>`);
    }
    lines[fragLine] = `<fragment id="${fragId}">`;
    lines.push('</fragment>');
    segments.push({ atoms: new Set(fragment), from: fragLine, to: lines.length });
  }
  const END: Record<ArrowEnd, string> = { none: 'None', full: 'Full', halfLeft: 'HalfLeft', halfRight: 'HalfRight' };
  const p3 = (p: { x: number; y: number }) => `${fmt(p.x)} ${fmt(p.y)} 0`;
  // Caption ids are fixed first, so an analysis can name the peptide caption it describes.
  const textIds = new Map(objects.filter((o) => o.kind === 'text').map((o) => [o.id, nextId++] as const));
  for (const o of objects) {
    const objLine = lines.length;
    writeObject(o);
    segments.push({ object: o.id, from: objLine, to: lines.length });
  }
  function writeObject(o: DocObject) {
    if (o.kind === 'arrow' && o.curve) {
      // Curly arrows as ChemDraw curves: each node written as in-handle, node, out-handle.
      const c = o.curve;
      const pts: { x: number; y: number }[] = [c[0]!];
      for (let i = 0; i < c.length; i++) pts.push(c[i]!);
      pts.push(c[c.length - 1]!);
      const attrs = [`id="${nextId++}"`];
      if (o.color) attrs.push(`color="${colors.index(o.color)}"`);
      if (o.line !== 'plain') attrs.push(`LineType="${o.line === 'bold' ? 'Bold' : 'Dashed'}"`);
      if (o.headEnd !== 'none') attrs.push(`ArrowheadHead="${END[o.headEnd]}"`);
      if (o.tailEnd !== 'none') attrs.push(`ArrowheadTail="${END[o.tailEnd]}"`);
      attrs.push(`ArrowheadType="${o.headStyle === 'hollow' ? 'Hollow' : o.headStyle === 'angled' ? 'Angled' : 'Solid'}"`,
        `HeadSize="${o.headSize}"`, `ArrowheadCenterSize="${o.centerSize}"`, `ArrowheadWidth="${o.width}"`,
        `CurvePoints="${pts.map((p) => `${fmt(p.x)} ${fmt(p.y)}`).join(' ')}"`);
      lines.push(`<curve ${attrs.join(' ')}/>`);
    } else if (o.kind === 'arrow') {
      const attrs = [`id="${nextId++}"`];
      if (o.color) attrs.push(`color="${colors.index(o.color)}"`);
      if (o.line !== 'plain') attrs.push(`LineType="${o.line === 'bold' ? 'Bold' : 'Dashed'}"`);
      attrs.push('FillType="None"', `ArrowheadHead="${END[o.headEnd]}"`,
        `ArrowheadType="${o.headStyle === 'hollow' ? 'Hollow' : o.headStyle === 'angled' ? 'Angled' : 'Solid'}"`,
        `HeadSize="${o.headSize}"`, `ArrowheadCenterSize="${o.centerSize}"`, `ArrowheadWidth="${o.width}"`);
      if (o.tailEnd !== 'none') attrs.push(`ArrowheadTail="${END[o.tailEnd]}"`);
      if (o.shaftSpacing) attrs.push(`ArrowShaftSpacing="${o.shaftSpacing}"`);
      if (o.nogo !== 'none') attrs.push(`NoGo="${o.nogo === 'cross' ? 'Cross' : 'Hash'}"`);
      if (o.dipole) attrs.push('Dipole="yes"');
      if (o.arc) attrs.push(`AngularSize="${+o.arc.angle.toFixed(1)}"`);
      attrs.push(`Head3D="${p3(o.head)}"`, `Tail3D="${p3(o.tail)}"`);
      if (o.arc) {
        // ChemDraw expects principal axes; an oval made by squashing a circle may hold conjugate ones.
        const ax = principalAxes(o.arc);
        attrs.push(`Center3D="${p3(o.arc.center)}"`, `MajorAxisEnd3D="${p3(ax.majorEnd)}"`, `MinorAxisEnd3D="${p3(ax.minorEnd)}"`);
      }
      lines.push(`<arrow ${attrs.join(' ')}/>`);
    } else if (o.kind === 'shape') {
      lines.push(shapeXml(o, nextId++, colorAttr(o.color)));
    } else {
      // Styled runs as <s> elements; face bits 1 bold, 2 italic, 4 underline, 32 sub, 64 super, 96 formula.
      const runs = captionRuns(o).map((r) => {
        const face = (r.bold ? 1 : 0) | (r.italic ? 2 : 0) | (r.underline ? 4 : 0) | (r.script === 'sub' ? 32 : r.script === 'sup' ? 64 : r.script === 'formula' ? 96 : 0);
        return `<s font="${fontId(r.font ?? style.captionFont)}" size="${fmt(r.size ?? style.captionSize)}" face="${face}"${colorAttr(r.color ?? o.color)}>${esc(r.text).replace(/\n/g, '&#10;')}</s>`;
      }).join('');
      const just = o.align === 'center' ? ' Justification="Center" CaptionJustification="Center"' : o.align === 'right' ? ' Justification="Right" CaptionJustification="Right"' : '';
      const tid = textIds.get(o.id)!;
      lines.push(`<t id="${tid}" p="${fmt(o.x)} ${fmt(o.y)}"${colorAttr(o.color)}${just} LineHeight="auto">${runs}</t>`);
      if (o.analysis) {
        // ChemDraw's linked analysis: the structure's fragment, nodes and bonds (or the peptide caption) as basis.
        const atoms = o.analysis.basis.filter((a) => nodeIds.has(a));
        const inBasis = new Set(atoms);
        const basis = o.analysis.source !== undefined ? [textIds.get(o.analysis.source)].filter((x) => x !== undefined)
          : [...new Set(atoms.map((a) => fragIds.get(a)!)), ...atoms.map((a) => nodeIds.get(a)!),
            ...[...mol.bonds()].filter((b) => inBasis.has(b.begin) && inBasis.has(b.end)).map((b) => bondIds.get(b.id)!)];
        if (basis.length) {
          lines.push(`<chemicalproperty id="${nextId++}" ChemicalPropertyDisplayID="${tid}" ChemicalPropertyIsActive="yes" ChemicalPropertyType="${o.analysis.items.map(analysisCode).join(' ')}" BasisObjects="${basis.join(' ')}"/>`);
        }
      }
    }
  }
  lines[colorTableAt] = colors.xml();
  // Object > Group: ChemDraw wraps grouped fragments and objects in <group>, at the first member's place.
  // Groups nest: each <group> holds its own members and its inner groups.
  if (opts.groups?.length && segments.length) {
    const groups = opts.groups;
    type Seg = (typeof segments)[number];
    const direct = (seg: Seg) => groups.find((g) => (seg.object !== undefined ? g.objects.includes(seg.object) : g.atoms.some((a) => seg.atoms!.has(a))));
    const parentOf = (g: ObjectGroup) => groups.find((x) => x.groups.includes(g.id));
    /** The chain of groups from the outermost down to the one holding `seg`. */
    const path = (seg: Seg) => { const out: ObjectGroup[] = []; for (let g = direct(seg); g && !out.includes(g); g = parentOf(g)) out.unshift(g); return out; };
    const paths = new Map(segments.map((seg) => [seg, path(seg)] as const));
    const head = lines.slice(0, segments[0]!.from), body: string[] = [];
    const done = new Set<ObjectGroup>();
    const emit = (g: ObjectGroup, depth: number) => {
      done.add(g);
      body.push(`<group id="${nextId++}">`);
      for (const seg of segments) {
        const p = paths.get(seg)!;
        if (p[depth] !== g) continue;
        if (p.length === depth + 1) body.push(...lines.slice(seg.from, seg.to));
        else if (!done.has(p[depth + 1]!)) emit(p[depth + 1]!, depth + 1);
      }
      body.push('</group>');
    };
    for (const seg of segments) {
      const p = paths.get(seg)!;
      if (!p.length) body.push(...lines.slice(seg.from, seg.to));
      else if (!done.has(p[0]!)) emit(p[0]!, 0);
    }
    lines.length = 0;
    lines.push(...head, ...body);
  }
  lines.push('</page></CDXML>');
  return lines.join('\n');
}

/** A drawing element as a CDXML <graphic>. */
function shapeXml(o: Shape, id: number, color: string): string {
  const [c, a, b] = o.points as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const p3 = (p: { x: number; y: number }) => `${fmt(p.x)} ${fmt(p.y)} 0`;
  const flags = (base: string[]) => [...base, ...(o.fill === 'shaded' ? ['Shaded'] : o.fill === 'filled' ? ['Filled'] : []),
    ...(o.line === 'dashed' ? ['Dashed'] : o.line === 'bold' ? ['Bold'] : []), ...(o.shadow ? ['Shadow'] : [])].join(' ');
  if (o.shape === 'line') {
    const lt = o.line === 'plain' ? '' : ` LineType="${o.line === 'bold' ? 'Bold' : o.line === 'wavy' ? 'Wavy' : 'Dashed'}"`;
    return `<graphic id="${id}" BoundingBox="${fmt(c.x)} ${fmt(c.y)} ${fmt(a.x)} ${fmt(a.y)}"${color} GraphicType="Line"${lt}/>`;
  }
  if (o.shape === 'circle' || o.shape === 'oval') {
    return `<graphic id="${id}" BoundingBox="${fmt(a.x)} ${fmt(a.y)} ${fmt(c.x)} ${fmt(c.y)}"${color} GraphicType="Oval" OvalType="${flags(o.shape === 'circle' ? ['Circle'] : [])}" Center3D="${p3(c)}" MajorAxisEnd3D="${p3(a)}" MinorAxisEnd3D="${p3(b)}"/>`;
  }
  const corners = rectCorners(o);
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  const round = o.shape === 'roundRect';
  return `<graphic id="${id}" BoundingBox="${fmt(Math.min(...xs))} ${fmt(Math.min(...ys))} ${fmt(Math.max(...xs))} ${fmt(Math.max(...ys))}"${color} GraphicType="Rectangle" RectangleType="${flags(round ? ['RoundEdge'] : []) || 'Plain'}"${round ? ' CornerRadius="600"' : ''} HexSketchAxes="yes" Center3D="${p3(c)}" MajorAxisEnd3D="${p3(a)}" MinorAxisEnd3D="${p3(b)}"/>`;
}

/**
 * Principal axes of the ellipse centre + a cos t + b sin t (a, b conjugate
 * semi-diameters), keeping the direction of travel.
 */
export function principalAxes(g: ArcGeometry): { majorEnd: { x: number; y: number }; minorEnd: { x: number; y: number } } {
  const c = g.center;
  const a = { x: g.majorEnd.x - c.x, y: g.majorEnd.y - c.y }, b = { x: g.minorEnd.x - c.x, y: g.minorEnd.y - c.y };
  const dot = a.x * b.x + a.y * b.y;
  if (Math.abs(dot) < 1e-9 * (1 + a.x * a.x + a.y * a.y)) return { majorEnd: g.majorEnd, minorEnd: g.minorEnd };
  // Parameter where |P'(t)| is extreme: tan 2t = 2 a.b / (|a|^2 - |b|^2).
  const t0 = 0.5 * Math.atan2(2 * dot, (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y));
  const u = { x: a.x * Math.cos(t0) + b.x * Math.sin(t0), y: a.y * Math.cos(t0) + b.y * Math.sin(t0) };
  const v = { x: -a.x * Math.sin(t0) + b.x * Math.cos(t0), y: -a.y * Math.sin(t0) + b.y * Math.cos(t0) };
  return { majorEnd: { x: c.x + u.x, y: c.y + u.y }, minorEnd: { x: c.x + v.x, y: c.y + v.y } };
}

/** Corners of a rectangle stored as centre, major- and minor-axis ends (half-extents). */
export function rectCorners(o: Shape): { x: number; y: number }[] {
  const [c, a, b] = o.points as [{ x: number; y: number }, { x: number; y: number }, { x: number; y: number }];
  const u = { x: a.x - c.x, y: a.y - c.y }, v = { x: b.x - c.x, y: b.y - c.y };
  return [[1, 1], [-1, 1], [-1, -1], [1, -1]].map(([i, j]) => ({ x: c.x + i! * u.x + j! * v.x, y: c.y + i! * u.y + j! * v.y }));
}

/**
 * Arrows, drawing elements and free captions (text not belonging to an atom)
 * in a CDXML document. Given the molecule readCdxml made from the same text,
 * analysis captions (<chemicalproperty>) are linked back to their structure.
 */
export function readCdxmlObjects(xml: string, mol?: Molecule, ids?: Map<string, number>): DocObject[] {
  const out: DocObject[] = [];
  // `ids` collects CDXML element id -> object id, for groups: each loop sets curTag before pushing.
  let curTag = '';
  if (ids) {
    const push = out.push.bind(out);
    out.push = (...items: DocObject[]) => { const id = /\bid="([^"]*)"/.exec(curTag)?.[1]; if (id && items.length) ids.set(id, items[items.length - 1]!.id); return push(...items); };
  }
  // Linked analysis captions: display caption id -> property codes and basis ids.
  const props = new Map<string, { items: AnalysisItem[]; basis: string[] }>();
  for (const m of xml.matchAll(/<chemicalproperty\b([^>]*)\/?>/g)) {
    const a = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(m[1]!)?.[1];
    const display = a('ChemicalPropertyDisplayID');
    if (!display || a('ChemicalPropertyIsActive') === 'no') continue;
    const items = (a('ChemicalPropertyType') ?? '').trim().split(/\s+/).map((c) => analysisItemOf(Number(c))).filter((x): x is AnalysisItem => !!x);
    if (items.length) props.set(display, { items, basis: (a('BasisObjects') ?? '').trim().split(/\s+/) });
  }
  const atomOfNode = new Map<string, number>();
  if (mol && props.size) {
    const atoms = [...mol.atoms()];
    nodeIdOrder(xml).forEach((id, i) => { if (atoms[i]) atomOfNode.set(id, atoms[i]!.id); });
  }
  const captionOfT = new Map<string, Caption>();
  const linkSource: [Caption, string[]][] = [];
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  const pt = (v: string | undefined) => { const [x, y] = (v ?? '0 0').split(/\s+/).map(Number); return { x: x ?? 0, y: y ?? 0 }; };
  const colorAt = readColorTable(xml);
  const colorOf = (tag: string) => { const c = attr(tag, 'color'); return c === undefined ? null : colorAt(Number(c)); };
  const END: Record<string, ArrowEnd> = { None: 'none', Full: 'full', HalfLeft: 'halfLeft', HalfRight: 'halfRight' };
  for (const m of xml.matchAll(/<arrow\b([^>]*)\/?>/g)) {
    const tag = m[1]!;
    curTag = tag;
    const angular = attr(tag, 'AngularSize');
    const arc: ArcGeometry | null = angular !== undefined && attr(tag, 'Center3D') && Math.abs(Number(angular)) > 1e-6
      ? { center: pt(attr(tag, 'Center3D')), majorEnd: pt(attr(tag, 'MajorAxisEnd3D')), minorEnd: pt(attr(tag, 'MinorAxisEnd3D')), angle: Number(angular) }
      : null;
    const lt = attr(tag, 'LineType') ?? '';
    const ht = attr(tag, 'ArrowheadType');
    const nogo = attr(tag, 'NoGo');
    const a: Arrow = {
      kind: 'arrow', id: newObjectId(),
      head: pt(attr(tag, 'Head3D')), tail: pt(attr(tag, 'Tail3D')),
      headEnd: END[attr(tag, 'ArrowheadHead') ?? 'Full'] ?? 'full',
      tailEnd: END[attr(tag, 'ArrowheadTail') ?? 'None'] ?? 'none',
      headSize: Number(attr(tag, 'HeadSize') ?? 1000),
      centerSize: Number(attr(tag, 'ArrowheadCenterSize') ?? 875),
      width: Number(attr(tag, 'ArrowheadWidth') ?? 250),
      shaftSpacing: Number(attr(tag, 'ArrowShaftSpacing') ?? 0),
      arc,
      line: /Bold/.test(lt) ? 'bold' : /Dash/.test(lt) ? 'dashed' : 'plain',
      headStyle: ht === 'Hollow' ? 'hollow' : ht === 'Angled' ? 'angled' : 'solid',
      nogo: nogo === 'Cross' ? 'cross' : nogo === 'Hash' ? 'hash' : 'none',
      dipole: attr(tag, 'Dipole') === 'yes',
      color: colorOf(tag),
    };
    out.push(a);
  }
  // Curly arrows: open curves with an arrowhead (ChemDraw's curve tool / electron pushing).
  for (const m of xml.matchAll(/<curve\b([^>]*)\/?>/g)) {
    const tag = m[1]!;
    curTag = tag;
    const head = attr(tag, 'ArrowheadHead'), tail = attr(tag, 'ArrowheadTail');
    if (attr(tag, 'Closed') === 'yes' || (!head && !tail) || !attr(tag, 'CurvePoints')) continue;
    const nums = attr(tag, 'CurvePoints')!.trim().split(/\s+/).map(Number);
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i]!, y: nums[i + 1]! });
    if (pts.length < 6 || pts.length % 3) continue;
    // Triples (in, node, out) per node -> [node0, out0, in1, node1, out1, in2, node2, ...].
    const curve: { x: number; y: number }[] = [];
    for (let k = 0; k < pts.length / 3; k++) {
      if (k > 0) curve.push(pts[3 * k]!);
      curve.push(pts[3 * k + 1]!);
      if (k < pts.length / 3 - 1) curve.push(pts[3 * k + 2]!);
    }
    const lt = attr(tag, 'LineType') ?? '';
    const ht = attr(tag, 'ArrowheadType');
    out.push({
      kind: 'arrow', id: newObjectId(), tail: { ...curve[0]! }, head: { ...curve[curve.length - 1]! },
      headEnd: END[head ?? 'None'] ?? 'none', tailEnd: END[tail ?? 'None'] ?? 'none',
      headSize: Number(attr(tag, 'HeadSize') ?? 1000), centerSize: Number(attr(tag, 'ArrowheadCenterSize') ?? 875), width: Number(attr(tag, 'ArrowheadWidth') ?? 250),
      shaftSpacing: 0, arc: null, curve,
      line: /Bold/.test(lt) ? 'bold' : /Dash/.test(lt) ? 'dashed' : 'plain',
      headStyle: ht === 'Hollow' ? 'hollow' : ht === 'Angled' ? 'angled' : 'solid', nogo: 'none', dipole: false, color: colorOf(tag),
    });
  }
  // Drawing elements. Graphics superseded by an <arrow> are older copies of it.
  for (const m of xml.matchAll(/<graphic\b([^>]*)\/?>/g)) {
    const tag = m[1]!;
    curTag = tag;
    if (attr(tag, 'SupersededBy')) continue;
    const type = attr(tag, 'GraphicType');
    const box = (attr(tag, 'BoundingBox') ?? '0 0 0 0').split(/\s+/).map(Number) as [number, number, number, number];
    const color = colorOf(tag);
    const flags = (attr(tag, type === 'Oval' ? 'OvalType' : 'RectangleType') ?? '').split(/\s+/);
    const fill: Shape['fill'] = flags.includes('Shaded') ? 'shaded' : flags.includes('Filled') ? 'filled' : 'none';
    const line: Shape['line'] = flags.includes('Dashed') ? 'dashed' : flags.includes('Bold') ? 'bold' : 'plain';
    const shadow = flags.includes('Shadow');
    const axes = () => [pt(attr(tag, 'Center3D')), pt(attr(tag, 'MajorAxisEnd3D')), pt(attr(tag, 'MinorAxisEnd3D'))];
    if (type === 'Oval' && attr(tag, 'Center3D')) {
      out.push({ kind: 'shape', id: newObjectId(), shape: flags.includes('Circle') ? 'circle' : 'oval', points: axes(), fill, line, shadow, color });
    } else if (type === 'Rectangle') {
      const points = (attr(tag, 'HexSketchAxes') ?? attr(tag, 'DrawChemAxes')) === 'yes' ? axes() : (() => {
        const [x0, y0, x1, y1] = box, c = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
        return [c, { x: Math.max(x0, x1), y: c.y }, { x: c.x, y: Math.max(y0, y1) }];
      })();
      out.push({ kind: 'shape', id: newObjectId(), shape: flags.includes('RoundEdge') ? 'roundRect' : 'rect', points, fill, line, shadow, color });
    } else if (type === 'Line') {
      const lt = attr(tag, 'LineType') ?? '';
      out.push({
        kind: 'shape', id: newObjectId(), shape: 'line', points: [{ x: box[0], y: box[1] }, { x: box[2], y: box[3] }],
        fill: 'none', line: /Bold/.test(lt) ? 'bold' : /Wavy/.test(lt) ? 'wavy' : /Dash/.test(lt) ? 'dashed' : 'plain', shadow: false, color,
      });
    }
  }
  // Free captions: <t> elements outside fragments (atom labels live inside <n>).
  const body = xml.replace(/<fragment\b[\s\S]*?<\/fragment>/g, '');
  const unescape = (t: string) => t.replace(/&#10;|&#xA;|&#13;/gi, '\n').replace(/\r\n?/g, '\n').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  // Font names by id; runs in a sans font (Helvetica, Arial: the default look) carry no font of their own.
  const fonts = new Map([...xml.matchAll(/<font\b([^>]*)\/?>/g)].map((f) => [attr(f[1]!, 'id'), attr(f[1]!, 'name')] as const));
  for (const m of body.matchAll(/<t\b([^>]*)>([\s\S]*?)<\/t>/g)) {
    const tTag = m[1]!;
    curTag = tTag;
    const p = pt(attr(tTag, 'p'));
    const runs: TextRun[] = [...m[2]!.matchAll(/<s\b([^>]*)>([^<]*)<\/s>/g)].map((x) => {
      const face = Number(attr(x[1]!, 'face') ?? 0);
      const size = attr(x[1]!, 'size');
      const r: TextRun = { text: unescape(x[2]!) };
      if (face & 1) r.bold = true;
      if (face & 2) r.italic = true;
      if (face & 4) r.underline = true;
      if ((face & 96) === 96) r.script = 'formula'; else if (face & 32) r.script = 'sub'; else if (face & 64) r.script = 'sup';
      if (size !== undefined) r.size = Number(size);
      const font = fonts.get(attr(x[1]!, 'font'));
      if (font && !/^(helvetica|arial)\b/i.test(font)) r.font = font;
      // color="0" (black) is how ChemDraw marks ordinary foreground text.
      const col = colorOf(x[1]!);
      if (col && !(col === '#000000' && attr(x[1]!, 'color') === '0')) r.color = col;
      return r;
    });
    const text = runs.map((r) => r.text).join('');
    if (!text.trim()) continue;
    const just = attr(tTag, 'Justification') ?? attr(tTag, 'CaptionJustification');
    const cap: Caption = { kind: 'text', id: newObjectId(), x: p.x, y: p.y, text, color: colorOf(tTag), align: just === 'Center' ? 'center' : just === 'Right' ? 'right' : 'left' };
    // Runs in the document caption size and colour carry no styling of their own.
    const docSize = Number(/\bCaptionSize="([^"]*)"/.exec(xml)?.[1] ?? NaN);
    setCaptionRuns(cap, runs.map((r) => ({ ...r, ...(r.size === docSize ? { size: undefined } : {}), ...(r.color && r.color === cap.color ? { color: undefined } : {}) })));
    const tid = attr(tTag, 'id');
    if (tid) captionOfT.set(tid, cap);
    const prop = tid ? props.get(tid) : undefined;
    if (prop) {
      const basis = prop.basis.map((b) => atomOfNode.get(b)).filter((x): x is number => x !== undefined);
      if (basis.length) cap.analysis = { items: prop.items, basis };
      else linkSource.push([cap, prop.basis]);
    }
    out.push(cap);
  }
  // An analysis of a caption (a peptide in three-letter code) names that caption.
  for (const [cap, basis] of linkSource) {
    const src = basis.map((b) => captionOfT.get(b)).find((c) => c && c !== cap);
    if (src) cap.analysis = { items: props.get([...captionOfT].find(([, c]) => c === cap)![0])!.items, basis: [], source: src.id };
  }
  return out;
}

/** Atoms in ring order for a set of bonds forming one cycle, or null. */
function ringAtomsFromBonds(mol: Molecule, bonds: number[]): number[] | null {
  if (bonds.length < 3) return null;
  const left = new Set(bonds);
  const first = mol.bond(bonds[0]!);
  const atoms = [first.begin, first.end];
  left.delete(bonds[0]!);
  while (left.size) {
    const tail = atoms[atoms.length - 1]!;
    const next = [...left].find((id) => { const b = mol.bond(id); return b.begin === tail || b.end === tail; });
    if (next === undefined) return null;
    const b = mol.bond(next);
    left.delete(next);
    const other = b.begin === tail ? b.end : b.begin;
    if (other === atoms[0]) break;
    atoms.push(other);
  }
  return left.size === 0 && atoms.length === bonds.length ? atoms : null;
}

/** Style attributes present on a CDXML root element, merged over a base style. */
export function readCdxmlStyle(xml: string, base: DrawingStyle = DEFAULT_STYLE): DrawingStyle {
  const root = /<CDXML\b([^>]*)>/.exec(xml)?.[1] ?? '';
  const num = (name: string) => {
    const m = new RegExp(`\\b${name}="([-0-9.]+)"`).exec(root);
    return m ? Number(m[1]) : undefined;
  };
  const yes = (name: string) => {
    const m = new RegExp(`\\b${name}="(yes|no)"`).exec(root);
    return m ? m[1] === 'yes' : undefined;
  };
  const face = num('LabelFace');
  return {
    ...base,
    bondLength: num('BondLength') ?? base.bondLength,
    lineWidth: num('LineWidth') ?? base.lineWidth,
    boldWidth: num('BoldWidth') ?? base.boldWidth,
    hashSpacing: num('HashSpacing') ?? base.hashSpacing,
    marginWidth: num('MarginWidth') ?? base.marginWidth,
    bondSpacing: num('BondSpacing') ?? base.bondSpacing,
    chainAngle: num('ChainAngle') ?? base.chainAngle,
    labelSize: num('LabelSize') ?? base.labelSize,
    labelBold: face !== undefined ? (face & 1) === 1 : base.labelBold,
    captionSize: num('CaptionSize') ?? base.captionSize,
    showTerminalCarbonLabels: yes('ShowTerminalCarbonLabels') ?? base.showTerminalCarbonLabels,
    hideImplicitHydrogens: yes('HideImplicitHydrogens') ?? base.hideImplicitHydrogens,
    // HexSketch's own switch: a ChemDraw file keeps its bare methyls.
    methylAsMe: /\bCreationProgram="HexSketch"/.test(root) ? base.methylAsMe : false,
  };
}

/**
 * Read every fragment in a CDXML document into one Molecule. Nested
 * fragments inside nickname nodes are collapsed to a labelled atom.
 */
/**
 * The document without fragments nested inside nodes (expanded nicknames), so
 * they do not contribute atoms twice; the outer node keeps its label.
 */
function stripNestedFragments(xml: string): string {
  let body = xml;
  for (let guard = 0; guard < 8; guard++) {
    // Only an opening <n ...> (not a self-closed <n .../>) can hold a nested fragment;
    // matching a self-closed one would swallow the next top-level fragment.
    const next = body.replace(/(<n\b[^>]*[^/]>)((?:(?!<\/n>|<n\b)[\s\S])*?)<fragment\b[\s\S]*?<\/fragment>/g, '$1$2');
    if (next === body) break;
    body = next;
  }
  return body;
}
const NODE_RE = () => /<n\b([^>]*?)(\/>|>([\s\S]*?)<\/n>)/g;

/** CDXML node ids in the order readCdxml adds them as atoms. */
function nodeIdOrder(xml: string): string[] {
  const out: string[] = [];
  const body = stripNestedFragments(xml);
  const re = NODE_RE();
  for (let m; (m = re.exec(body)); ) {
    const id = /\bid="([^"]*)"/.exec(m[1]!)?.[1];
    if (id && /\bp="[^"]*"/.test(m[1]!)) out.push(id);
  }
  return out;
}

export function readCdxml(xml: string): Molecule {
  const mol = new Molecule();
  const idMap = new Map<string, number>();
  const attr = (tag: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1];
  const colorAt = readColorTable(xml);
  const colorOf = (tag: string, name = 'color') => { const c = attr(tag, name); return c === undefined ? null : colorAt(Number(c)); };

  const body = stripNestedFragments(xml);
  const nodeRe = NODE_RE();
  for (let m; (m = nodeRe.exec(body)); ) {
    const tag = m[1]!;
    const inner = m[3] ?? '';
    const id = attr(tag, 'id');
    const p = attr(tag, 'p');
    if (!id || !p) continue;
    const [x, y] = p.split(/\s+/).map(Number) as [number, number];
    const z = Number(attr(tag, 'Element') ?? 6);
    const nodeType = attr(tag, 'NodeType');
    const text = [...inner.matchAll(/<s\b[^>]*>([^<]*)<\/s>/g)].map((s) => s[1]).join('');
    const isNickname = nodeType === 'Nickname' || nodeType === 'Fragment' || nodeType === 'GenericNickname';
    const numH = attr(tag, 'NumHydrogens');
    const atom = mol.addAtom({
      element: elementByNumber(z)?.symbol ?? 'C',
      x, y,
      charge: Number(attr(tag, 'Charge') ?? 0),
      isotope: attr(tag, 'Isotope') ? Number(attr(tag, 'Isotope')) : null,
      label: isNickname && text ? text.replace(/&apos;/g, "'").replace(/&amp;/g, '&') : null,
      explicitHydrogens: numH !== undefined && !isNickname ? Number(numH) : null,
      color: colorOf(tag) ?? colorOf(/<s\b([^>]*)>/.exec(inner)?.[1] ?? ''),
      highlight: colorOf(tag, 'highlightColor') ?? colorOf(tag, 'HexSketchHighlight') ?? colorOf(tag, 'DrawChemHighlight'),
    });
    idMap.set(id, atom.id);
  }

  const bondIdMap = new Map<string, number>();
  const bondRe = /<b\b([^>]*?)\/?>/g;
  for (let m; (m = bondRe.exec(body)); ) {
    const tag = m[1]!;
    const b = idMap.get(attr(tag, 'B') ?? '');
    const e = idMap.get(attr(tag, 'E') ?? '');
    if (b === undefined || e === undefined || b === e || mol.bondBetween(b, e)) continue;
    const orderAttr = attr(tag, 'Order') ?? '1';
    const order = (orderAttr === '1.5' ? 1.5 : Math.min(4, Math.max(1, Number(orderAttr.split(/\s+/)[0]) || 1))) as BondOrder;
    const display = CDXML_TO_DISPLAY[attr(tag, 'Display') ?? ''] ?? 'plain';
    const pos = attr(tag, 'DoublePosition');
    mol.addBond({
      begin: b, end: e, order, display,
      doubleBondPosition: pos === 'Center' ? 'center' : pos === 'Left' ? 'left' : pos === 'Right' ? 'right' : 'auto',
      color: colorOf(tag),
      highlight: colorOf(tag, 'highlightColor') ?? colorOf(tag, 'HexSketchHighlight') ?? colorOf(tag, 'DrawChemHighlight'),
    });
    const bid = attr(tag, 'id');
    if (bid) bondIdMap.set(bid, mol.bondBetween(b, e)!.id);
  }
  // Ring fills: ChemDraw's ColoredMolecularArea (bonds of the ring).
  for (const m of body.matchAll(/<ColoredMolecularArea\b([^>]*)\/?>/g)) {
    const color = colorOf(m[1]!, 'bgcolor');
    const bonds = (attr(m[1]!, 'BasisObjects') ?? '').trim().split(/\s+/).map((x) => bondIdMap.get(x)).filter((x): x is number => x !== undefined);
    const atoms = ringAtomsFromBonds(mol, bonds);
    if (color && atoms) mol.ringFills.push({ atoms, color });
  }
  for (const m of body.matchAll(/<fragment\b([^>]*)>/g)) {
    const spec = (attr(m[1]!, 'HexSketchRingFills') ?? attr(m[1]!, 'DrawChemRingFills'));
    if (!spec) continue;
    for (const part of spec.split(';')) {
      const [ci, ids] = part.split(':');
      const atoms = (ids ?? '').trim().split(/\s+/).map((i) => idMap.get(i));
      const color = colorAt(Number(ci));
      if (color && atoms.length >= 3 && atoms.every((a) => a !== undefined)) mol.ringFills.push({ atoms: atoms as number[], color });
    }
  }
  return mol;
}

/**
 * Object > Group in a CDXML document. Groups nest: each <group> becomes a
 * group of the atoms (by node) and objects (by element id) directly inside
 * it, holding the groups nested within.
 */
export function readCdxmlGroups(xml: string, atomOfNode: ReadonlyMap<string, number>, objectOfId: ReadonlyMap<string, number>): ObjectGroup[] {
  const groups: ObjectGroup[] = [];
  const stack: ObjectGroup[] = [];
  const re = /<(\/?)group\b[^>]*>|<(n|arrow|curve|graphic|t)\b[^>]*?\bid="([^"]*)"/g;
  for (let m; (m = re.exec(xml)); ) {
    if (m[2] === undefined) {
      if (m[1]) { stack.pop(); continue; }
      const g: ObjectGroup = { id: newObjectId(), atoms: [], objects: [], groups: [] };
      stack[stack.length - 1]?.groups.push(g.id);
      groups.push(g);
      stack.push(g);
      continue;
    }
    const g = stack[stack.length - 1];
    if (!g) continue;
    // Each member belongs to the innermost group around it.
    const a = m[2] === 'n' ? atomOfNode.get(m[3]!) : undefined;
    if (a !== undefined) g.atoms.push(a);
    const o = objectOfId.get(m[3]!);
    if (o !== undefined && !g.objects.includes(o)) g.objects.push(o);
  }
  // Drop empty groups (holding only things HexSketch does not keep).
  const empty = new Set(groups.filter((g) => !g.atoms.length && !g.objects.length && !g.groups.length).map((g) => g.id));
  for (const g of groups) g.groups = g.groups.filter((c) => !empty.has(c));
  return groups.filter((g) => !empty.has(g.id));
}

/** A whole CDXML document: structures, objects (with analysis links) and groups. */
export function readCdxmlDocument(xml: string): { mol: Molecule; objects: DocObject[]; groups: ObjectGroup[] } {
  const mol = readCdxml(xml);
  const ids = new Map<string, number>();
  const objects = readCdxmlObjects(xml, mol, ids);
  if (!/<group\b/.test(xml)) return { mol, objects, groups: [] };
  const atoms = [...mol.atoms()];
  const atomOfNode = new Map<string, number>();
  nodeIdOrder(xml).forEach((id, i) => { if (atoms[i]) atomOfNode.set(id, atoms[i]!.id); });
  return { mol, objects, groups: readCdxmlGroups(xml, atomOfNode, ids) };
}
