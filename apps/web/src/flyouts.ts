/**
 * Flyout palettes (Arrows, Drawing Elements) and the Colors menus, laid out
 * like ChemDraw's. Icons are drawn by HexSketch's own renderer from the very
 * object each tool makes, so what the button shows is what you get.
 */
import { arcThrough, DEFAULT_STYLE, makeArrow, makeCurlyArrow, makeShape, Molecule, type DocObject, type DrawingStyle } from '@hexsketch/core';
import { depict, toSvg } from '@hexsketch/render';
import type { ArrowTool, ShapeTool, Tool } from '@hexsketch/editor';

export interface FlyoutEntry { title: string; tool: Tool; icon: string }

const ICON_STYLE: DrawingStyle = { ...DEFAULT_STYLE, lineWidth: 1.1, boldWidth: 2.4, bondLength: 14 };

/** A 24x24 icon of an object, in currentColor. */
function iconOf(o: DocObject): string {
  const dep = depict(new Molecule(), ICON_STYLE, [o]);
  return toSvg(dep, { padding: 1.5, color: 'currentColor' })
    .replace(/width="[^"]*pt" height="[^"]*pt"/, 'width="24" height="24" preserveAspectRatio="xMidYMid meet"');
}

const straight = (kind: ArrowTool['arrow']) => makeArrow({ x: 2, y: 12 }, { x: 24, y: 12 }, kind);
/** An arc of the given sweep, symmetric about the top of a circle. */
function arcIcon(angle: number, heads: ArrowTool['heads'] = {}, dashed = false) {
  const r = 9, a0 = (90 - angle / 2) * Math.PI / 180, a1 = (90 + angle / 2) * Math.PI / 180;
  const tail = { x: 12 + r * Math.cos(a0), y: 12 - r * Math.sin(a0) }, head = { x: 12 + r * Math.cos(a1), y: 12 - r * Math.sin(a1) };
  const o = makeArrow(tail, head, 'reaction');
  o.headEnd = heads.head ?? 'full'; o.tailEnd = heads.tail ?? 'none';
  o.arc = arcThrough(tail, head, angle);
  if (dashed) o.line = 'dashed';
  return o;
}

export function arrowFlyout(): FlyoutEntry[] {
  const S = (title: string, arrow: ArrowTool['arrow']): FlyoutEntry => ({ title, tool: { kind: 'arrow', arrow }, icon: iconOf(straight(arrow)) });
  const A = (title: string, angle: number, heads: ArrowTool['heads'] = {}): FlyoutEntry => ({
    title, tool: { kind: 'arrow', arrow: 'reaction', arc: angle, heads }, icon: iconOf(arcIcon(angle, heads)),
  });
  return [
    S('Reaction Arrow (e)', 'reaction'), S('Half Arrow', 'halfLeft'), S('Resonance Arrow', 'resonance'), S('Equilibrium Arrow', 'equilibrium'),
    S('Retrosynthetic Arrow', 'retro'), S('Dashed Arrow', 'dashed'), S('Bold Arrow', 'bold'), S('Hollow Head', 'hollowHead'),
    S('Angled Head', 'angledHead'), S('No-Go Arrow (Cross)', 'nogo'), S('No-Go Arrow (Hash)', 'nogoHash'), S('Dipole Arrow', 'dipole'),
    A('Arc Arrow 90° anticlockwise', 90), A('Arc Arrow 120° anticlockwise', 120), A('Arc Arrow 180° anticlockwise', 180), A('Arc Arrow 270° anticlockwise', 270),
    A('Arc Arrow 90° clockwise', -90), A('Arc Arrow 120° clockwise', -120), A('Arc Arrow 180° clockwise', -180), A('Arc Arrow 270° clockwise', -270),
    A('Half-Head Arc 180°', 180, { head: 'halfLeft' }), A('Double-Headed Arc 180°', 180, { head: 'full', tail: 'full' }),
    A('Catalytic Cycle Arc 300°', 300), A('Catalytic Cycle Arc 300° clockwise', -300),
    { title: 'Electron Pushing (curly arrow; drag between atoms and bonds)', tool: { kind: 'arrow', arrow: 'electron', curly: true }, icon: iconOf(makeCurlyArrow({ x: 3, y: 17 }, { x: 21, y: 15 }, 'electron', 0.6)) },
    { title: 'Radical Pushing (fishhook)', tool: { kind: 'arrow', arrow: 'radical', curly: true }, icon: iconOf(makeCurlyArrow({ x: 3, y: 17 }, { x: 21, y: 15 }, 'radical', 0.6)) },
  ];
}

export function shapeFlyout(): FlyoutEntry[] {
  const out: FlyoutEntry[] = [];
  const c = { x: 12, y: 12 };
  const variants: [string, Partial<ShapeTool>][] = [['', {}], [' Dashed', { line: 'dashed' }], [' Shaded', { fill: 'shaded' }], [' Filled', { fill: 'filled' }], [' Shadowed', { shadow: true }]];
  for (const [name, shape, pts] of [
    ['Circle', 'circle', [c, { x: 21, y: 12 }, { x: 12, y: 21 }]],
    ['Oval', 'oval', [c, { x: 22, y: 12 }, { x: 12, y: 18 }]],
    ['Rounded Rectangle', 'roundRect', [c, { x: 21, y: 12 }, { x: 12, y: 18 }]],
    ['Rectangle', 'rect', [c, { x: 21, y: 12 }, { x: 12, y: 18 }]],
  ] as const) {
    for (const [v, opts] of variants) {
      const tool: ShapeTool = { kind: 'shape', shape, ...opts };
      out.push({ title: name + v, tool, icon: iconOf(makeShape(shape, [...pts], opts)) });
    }
  }
  const line = (title: string, opts: Partial<ShapeTool>) => {
    out.push({ title, tool: { kind: 'shape', shape: 'line', ...opts }, icon: iconOf(makeShape('line', [{ x: 3, y: 20 }, { x: 21, y: 4 }], opts)) });
  };
  line('Line', {}); line('Dashed Line', { line: 'dashed' }); line('Wavy Line', { line: 'wavy' }); line('Bold Line', { line: 'bold' });
  for (const angle of [270, 180, 120, 90]) {
    out.push({ title: `Arc ${angle}°`, tool: { kind: 'arrow', arrow: 'plainLine', arc: angle, heads: { head: 'none' } }, icon: iconOf(arcIcon(angle, { head: 'none' })) });
  }
  return out;
}

/*
 * Highlight and ring-fill palettes. ChemDraw's are fully saturated; HexSketch
 * defaults to soft pastels that read like a translucent marker over white.
 * They are stored opaque because CDXML colour tables carry no alpha, so the
 * look survives a round trip through ChemDraw and Office unchanged.
 * Custom... still offers any colour.
 */
/** Highlight colours for a document without a palette of its own (the Highlight menu offers the document palette). */
export const HIGHLIGHT_COLORS = [
  '#c9f2c2', '#bfeef3', '#fff4a8', '#ffdcb5', '#ffc6bf', '#e4f3b0', '#cfe6ff', '#f2e8b8', '#d9defe', '#ead6ff',
  '#cdeecd', '#cff6e8', '#ffe7cc', '#ffd6ef', '#e6e6e6', '#ffe6a1', '#f3cdd0', '#ffd0bd', '#e9e0c9', '#fbeee8',
];
export const RING_FILL_COLORS = [
  '#ffd9d4', '#ffeabf', '#fff6c2', '#dcf5ce', '#cdf1e8', '#d3e9ff', '#ddd8ff', '#f3d6ff', '#ffd6e8', '#ececec',
  '#f6c2b5', '#ffd79c', '#eaf29c', '#b4e4bb', '#a9e2d6', '#b3d4f6', '#c3bcf2', '#e4bcf2', '#f6bdd3', '#d2d2d2',
];

/** Show a popover under `anchor`; closes on outside click or Escape. Returns the panel. */
export function popover(anchor: HTMLElement, build: (panel: HTMLElement, close: () => void) => void, side: 'below' | 'right' = 'below'): HTMLElement {
  document.querySelectorAll('.popover').forEach((p) => p.remove());
  const panel = document.createElement('div');
  panel.className = 'popover';
  const r = anchor.getBoundingClientRect();
  panel.style.left = `${side === 'right' ? r.right + 4 : r.left}px`;
  panel.style.top = `${side === 'right' ? r.top : r.bottom + 4}px`;
  const close = () => { panel.remove(); document.removeEventListener('mousedown', outside, true); document.removeEventListener('keydown', esc, true); };
  const outside = (e: MouseEvent) => { if (!panel.contains(e.target as Node) && e.target !== anchor) close(); };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  build(panel, close);
  document.body.append(panel);
  // Keep it on screen.
  const pr = panel.getBoundingClientRect();
  if (pr.right > innerWidth - 4) panel.style.left = `${Math.max(4, innerWidth - pr.width - 4)}px`;
  if (pr.bottom > innerHeight - 4) panel.style.top = `${Math.max(4, innerHeight - pr.height - 4)}px`;
  setTimeout(() => { document.addEventListener('mousedown', outside, true); document.addEventListener('keydown', esc, true); });
  return panel;
}

/** A grid of colour swatches with optional Custom… and Remove rows. */
export function swatchGrid(panel: HTMLElement, title: string, colors: readonly string[], pick: (c: string | null) => void, opts: { custom?: boolean; remove?: string; cols?: number } = {}) {
  const h = document.createElement('div');
  h.className = 'popover-title';
  h.textContent = title;
  panel.append(h);
  const grid = document.createElement('div');
  grid.className = 'swatches';
  grid.style.gridTemplateColumns = `repeat(${opts.cols ?? 5}, 22px)`;
  for (const c of colors) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.title = c;
    b.addEventListener('click', () => pick(c));
    grid.append(b);
  }
  panel.append(grid);
  if (opts.custom) {
    const row = document.createElement('label');
    row.className = 'popover-row';
    row.innerHTML = '<span>Custom…</span>';
    const input = Object.assign(document.createElement('input'), { type: 'color', value: '#ff4040' });
    input.addEventListener('change', () => pick(input.value));
    row.append(input);
    panel.append(row);
  }
  if (opts.remove) {
    const b = document.createElement('button');
    b.className = 'popover-row';
    b.textContent = opts.remove;
    b.addEventListener('click', () => pick(null));
    panel.append(b);
  }
}
