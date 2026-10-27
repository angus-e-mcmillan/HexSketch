import { altTextFor, decodePayload, payloadFromPng, pngWithPayload, documentSize, layout2D, objectPoints, parsePeptide, readMolfile, writeMolfile, writeSmiles, readCdxmlDocument, readCdxmlPage, readCdxmlStyle, writeCdxml, aiSummary, readStructureLink, structureLink, ANALYSIS_ITEMS, DEFAULT_STYLE, Molecule, paletteId, PALETTES, type DocObject, type DrawingStyle } from '@hexsketch/core';
import { depict, toPdf, toSvg } from '@hexsketch/render';
import { Editor, EditorDocument, type Tool } from '@hexsketch/editor';
import { nameMolecule } from '@hexsketch/naming';
import { ICONS } from './icons.ts';
import { createCaptionEditor } from './textedit.ts';
import { arrowFlyout, HIGHLIGHT_COLORS, popover, RING_FILL_COLORS, shapeFlyout, swatchGrid, type FlyoutEntry } from './flyouts.ts';
import { clipboardContent, copyStructure, smilesFromClipboard, structureFromClipboard, structureFromImages, structureImage, svgToPng, EXPORT_MAX_PIXELS } from './clipboard.ts';
import { menuBar, openMenu, type MenuItem } from './menus.ts';
import { recallCopy, rememberCopy } from './recent.ts';
import { documentSettingsDialog, drawRuler, loadPrefs, PT_PER, savePrefs } from './docsettings.ts';
import { drawingSettingsDialog, loadStyleLibrary, saveStyleLibrary } from './drawsettings.ts';
import { guideSeen, openGuide } from './guide.ts';
import { openFeedback } from './feedback.ts';

/** Small icons for the Arrange menu: boxes lined up against a guide. */
const box = (x: number, y: number, w: number, h: number) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="0.8"/>`;
const ico = (body: string, guide: string) => `<svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3">${body}<path d="${guide}" stroke-dasharray="1.5 1.3" stroke-width="1.1"/></svg>`;
const ALIGN_ICONS = {
  left: ico(box(3, 3, 9, 4) + box(3, 10, 13, 4), 'M2 1v16'),
  hcenter: ico(box(4.5, 3, 9, 4) + box(2.5, 10, 13, 4), 'M9 1v16'),
  right: ico(box(6, 3, 9, 4) + box(2, 10, 13, 4), 'M16 1v16'),
  top: ico(box(3, 3, 4, 9) + box(10, 3, 4, 13), 'M1 2h16'),
  vcenter: ico(box(3, 4.5, 4, 9) + box(10, 2.5, 4, 13), 'M1 9h16'),
  bottom: ico(box(3, 6, 4, 9) + box(10, 2, 4, 13), 'M1 16h16'),
  dh: ico(box(1.5, 5, 3, 8) + box(7.5, 5, 3, 8) + box(13.5, 5, 3, 8), ''),
  dv: ico(box(5, 1.5, 8, 3) + box(5, 7.5, 8, 3) + box(5, 13.5, 8, 3), ''),
};

export interface AppAction { label: string; run: (api: AppApi) => void | Promise<void> }
export interface AppOptions {
  actions?: AppAction[];
  zoom?: number;
  /** Show the getting-started guide the first time HexSketch opens in this browser (the standalone app). */
  firstRunGuide?: boolean;
  /** Open the structure in the page address (hexsketch.com/#smiles=… or #cdxml=…), on load and when it changes (the standalone app). */
  openLinks?: boolean;
  /** File menu items for the HexSketch for AI page and the GitHub repo, each opened in a new tab (the standalone app). */
  aboutLinks?: boolean;
}
export interface AppApi {
  editor: Editor;
  flash: (msg: string) => void;
  /**
   * Replace the drawing. `centre` moves it (atoms, arrows and captions) to the
   * middle of the sheet as far as it is in view, and zooms out if it doesn't fit.
   */
  load: (mol: Molecule, style?: DrawingStyle, objects?: DocObject[], opts?: { centre?: boolean }) => void;
  image: () => ReturnType<typeof structureImage>;
}

/**
 * Mount the HexSketch editor into a page that provides the standard skeleton
 * (#menu, #palette, #canvasWrap, #page, #drawing, #status, #zoom,
 * #labelEditor, #fileInput). Used by the standalone app, the Office task pane
 * and the Google Workspace sidebar.
 */
export function mountApp(opts: AppOptions = {}): AppApi {
  let prefs = loadPrefs();
  const styles = loadStyleLibrary();
  /** The style new documents start with: the user's default, else HexSketch's. */
  const newDocStyle = (): DrawingStyle => ({ ...(styles.defaultStyle ?? DEFAULT_STYLE) });
  const editor = new Editor(new EditorDocument(new Molecule(), newDocStyle()));
  // The app opens with the lasso, as ChemDraw does: a click selects, and
  // nothing is drawn until a bond, ring or other drawing tool is picked. On a
  // touch screen this is also what leaves a finger free to scroll the sheet.
  editor.setTool({ kind: 'select', mode: 'lasso' });
  editor.doc.page = { ...prefs.page };
  editor.analysisDecimals = prefs.decimals;
  editor.nameOf = (m) => { try { return nameMolecule(m).name; } catch { return null; } };
  // Ring parents for naming (fused and hydro ring systems): a separate chunk, loaded once the editor is up.
  setTimeout(() => { void import('@hexsketch/naming/rings'); }, 0);
  let zoom = opts.zoom ?? 1.5;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const pageEl = $('page');
  const drawingEl = $('drawing');
  const wrapEl = $('canvasWrap');
  const labelEditor = $<HTMLInputElement>('labelEditor');

  // ------------------------------------------------------------------ palette

  interface PaletteEntry { id: string; icon: string; title: string; tool: Tool }
  interface FlyoutButton { id: string; title: string; entries: FlyoutEntry[]; current: FlyoutEntry }
  const ARROWS = arrowFlyout(), SHAPES = shapeFlyout();
  const FLYOUTS: FlyoutButton[] = [
    { id: 'arrows', title: 'Arrows', entries: ARROWS, current: ARROWS[0]! },
    { id: 'shapes', title: 'Drawing Elements', entries: SHAPES, current: SHAPES[0]! },
  ];
  const PALETTE: (PaletteEntry | FlyoutButton | 'gap')[] = [
    { id: 'marquee', icon: 'marquee', title: 'Marquee (Space)', tool: { kind: 'select', mode: 'marquee' } },
    { id: 'lasso', icon: 'lasso', title: 'Lasso', tool: { kind: 'select', mode: 'lasso' } },
    'gap',
    { id: 'single', icon: 'single', title: 'Solid Bond (x)', tool: { kind: 'bond', bond: 'single' } },
    { id: 'chain', icon: 'chain', title: 'Acyclic Chain (Shift+x)', tool: { kind: 'chain' } },
    { id: 'double', icon: 'double', title: 'Double Bond', tool: { kind: 'bond', bond: 'double' } },
    { id: 'triple', icon: 'triple', title: 'Triple Bond', tool: { kind: 'bond', bond: 'triple' } },
    { id: 'wedge', icon: 'wedge', title: 'Wedged Bond', tool: { kind: 'bond', bond: 'wedge' } },
    { id: 'hash', icon: 'hash', title: 'Hashed Wedged Bond', tool: { kind: 'bond', bond: 'hash' } },
    { id: 'bold', icon: 'bold', title: 'Bold Bond', tool: { kind: 'bond', bond: 'bold' } },
    { id: 'wavy', icon: 'wavy', title: 'Wavy Bond', tool: { kind: 'bond', bond: 'wavy' } },
    { id: 'dashed', icon: 'dashed', title: 'Dashed Bond', tool: { kind: 'bond', bond: 'dashed' } },
    { id: 'eraser', icon: 'eraser', title: 'Eraser', tool: { kind: 'eraser' } },
    { id: 'text', icon: 'text', title: 'Text (t)', tool: { kind: 'text' } },
    FLYOUTS[0]!, FLYOUTS[1]!,
    'gap',
    { id: 'benzene', icon: 'benzene', title: 'Benzene (j)', tool: { kind: 'ring', size: 6, aromatic: true } },
    { id: 'cp', icon: 'cp', title: 'Cyclopentadiene (Shift+j)', tool: { kind: 'ring', size: 5, aromatic: true } },
    { id: 'ring3', icon: 'ring3', title: 'Cyclopropane', tool: { kind: 'ring', size: 3, aromatic: false } },
    { id: 'ring4', icon: 'ring4', title: 'Cyclobutane', tool: { kind: 'ring', size: 4, aromatic: false } },
    { id: 'ring5', icon: 'ring5', title: 'Cyclopentane', tool: { kind: 'ring', size: 5, aromatic: false } },
    { id: 'ring6', icon: 'ring6', title: 'Cyclohexane', tool: { kind: 'ring', size: 6, aromatic: false } },
    { id: 'ring7', icon: 'ring7', title: 'Cycloheptane', tool: { kind: 'ring', size: 7, aromatic: false } },
    { id: 'ring8', icon: 'ring8', title: 'Cyclooctane', tool: { kind: 'ring', size: 8, aromatic: false } },
  ];

  const palette = $('palette');
  for (const entry of PALETTE) {
    if (entry === 'gap') { palette.insertAdjacentHTML('beforeend', '<div class="group-gap"></div>'); continue; }
    if ('entries' in entry) {
      // Flyout: the button shows the last tool picked; clicking it opens the whole palette.
      const fly = entry;
      const b = document.createElement('button');
      b.className = 'tool flyout';
      b.dataset.tool = fly.id;
      const show = () => { b.innerHTML = fly.current.icon; b.title = `${fly.title}: ${fly.current.title}`; b.setAttribute('aria-label', b.title); };
      show();
      b.addEventListener('click', () => {
        popover(b, (panel, close) => {
          const h = document.createElement('div');
          h.className = 'popover-title';
          h.textContent = fly.title;
          const grid = document.createElement('div');
          grid.className = 'flyout-grid';
          for (const item of fly.entries) {
            const t = document.createElement('button');
            t.className = 'tool';
            t.title = item.title;
            t.setAttribute('aria-label', item.title);
            t.innerHTML = item.icon;
            t.addEventListener('click', () => { fly.current = item; show(); editor.setTool(item.tool); close(); wrapEl.focus(); });
            grid.append(t);
          }
          panel.append(h, grid);
        }, 'right');
      });
      palette.append(b);
      continue;
    }
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = entry.id;
    b.title = entry.title;
    b.setAttribute('aria-label', entry.title);
    b.innerHTML = ICONS[entry.icon]!;
    b.addEventListener('click', () => { editor.setTool(entry.tool); wrapEl.focus(); });
    palette.append(b);
  }

  function syncPalette() {
    const t = JSON.stringify(editor.tool);
    for (const entry of PALETTE) {
      if (entry === 'gap') continue;
      const pressed = 'entries' in entry ? entry.entries.some((x) => JSON.stringify(x.tool) === t) : JSON.stringify(entry.tool) === t;
      palette.querySelector(`[data-tool="${entry.id}"]`)?.setAttribute('aria-pressed', String(pressed));
    }
    pageEl.classList.toggle('select', editor.tool.kind === 'select');
  }

  // -------------------------------------------------------------------- menus

  const needSelection = () => flash('Select atoms, bonds or objects first');
  const hasDrawing = () => editor.doc.mol.atomCount > 0 || editor.doc.objects.length > 0;
  const hasSelection = () => editor.selection.atoms.size > 0 || editor.selection.objects.size > 0;

  const colorPanel = (panel: HTMLElement, close: () => void) => {
    swatchGrid(panel, 'Color', ['#000000', ...(editor.doc.style.palette ?? [])], (c) => {
      if (!editor.applyColor(c === '#000000' ? null : c)) needSelection();
      close();
    }, { custom: true, remove: 'Foreground', cols: 7 });
  };
  const highlightPanel = (panel: HTMLElement, close: () => void) => {
    // The document palette (HexSketch's colours unless changed), plus Custom… for anything else.
    const colors = editor.doc.style.palette?.length ? editor.doc.style.palette : HIGHLIGHT_COLORS;
    swatchGrid(panel, 'Highlight Colors', colors, (c) => { if (!editor.applyHighlight(c)) needSelection(); close(); }, { custom: true, remove: 'Remove', cols: 5 });
  };
  const ringFillPanel = (panel: HTMLElement, close: () => void) => {
    swatchGrid(panel, 'Ring Fill Colors', RING_FILL_COLORS, (c) => { if (!editor.applyRingFill(c)) flash('Select a whole ring first'); close(); }, { custom: true, remove: 'Remove', cols: 4 });
  };

  /** Object > Align and Distribute, as in ChemDraw. */
  const need2 = 'Select two or more structures or objects to align';
  const need3 = 'Select three or more structures or objects to distribute';
  const alignItems = (): MenuItem[] => ([
    ['Left Edges', ALIGN_ICONS.left, 'left'], ['L/R Centers', ALIGN_ICONS.hcenter, 'hcenter'], ['Right Edges', ALIGN_ICONS.right, 'right'],
    ['Top Edges', ALIGN_ICONS.top, 'top'], ['T/B Centers', ALIGN_ICONS.vcenter, 'vcenter'], ['Bottom Edges', ALIGN_ICONS.bottom, 'bottom'],
  ] as const).map(([label, icon, mode]) => ({ label, icon, run: () => { if (!editor.alignSelection(mode)) flash(need2); } }));
  const distributeItems = (): MenuItem[] => [
    { label: 'Horizontally', icon: ALIGN_ICONS.dh, run: () => { if (!editor.distributeSelection('horizontal')) flash(need3); } },
    { label: 'Vertically', icon: ALIGN_ICONS.dv, run: () => { if (!editor.distributeSelection('vertical')) flash(need3); } },
  ];

  /** Object > Group / Ungroup, as in ChemDraw. */
  const groupItems = (): MenuItem[] => [
    { label: 'Group', shortcut: '⌘G', run: () => { if (!editor.groupSelection()) flash('Select two or more structures or objects to group'); }, enabled: hasSelection() },
    { label: 'Ungroup', shortcut: '⇧⌘G', run: () => { editor.ungroupSelection(); }, enabled: editor.selectionHasGroup },
  ];

  /** Right-click > Analysis: lines written under the structure, ticked when shown. */
  const analysisItems = (): MenuItem[] => {
    const shown = editor.analysisShown();
    const toggle = (item: Parameters<Editor['toggleAnalysis']>[0]) => () => {
      if (!editor.toggleAnalysis(item)) flash('Select a structure (or a peptide such as H-Ala-Gly-OH) first');
    };
    return [
      ...ANALYSIS_ITEMS.map((x) => ({ label: x.label, checked: shown.has(x.item), run: toggle(x.item) })),
      'sep',
      { label: 'All', run: toggle('all') },
    ];
  };

  const exportItems = (): MenuItem[] => {
    const what = hasSelection() ? 'selection' : 'drawing';
    return [
      { heading: `Export ${what}` },
      { label: 'PNG Image', run: () => exportAs('png') },
      { label: 'SVG Vector', run: () => exportAs('svg') },
      { label: 'PDF', run: () => exportAs('pdf') },
      'sep',
      { label: 'CDXML (ChemDraw)', run: () => exportAs('cdxml') },
      { label: 'MOL File', run: () => exportAs('mol'), enabled: copySource().mol.atomCount > 0 },
    ];
  };

  const copyAsItems = (): MenuItem[] => [
    { label: 'CDXML Text', shortcut: '⌘D', run: () => copyAsText('cdxml') },
    { label: 'SMILES', shortcut: '⌥⌘C', run: () => copyAsText('smiles') },
    { label: 'MOL Text', shortcut: '⌥⇧⌘O', run: () => copyAsText('mol') },
  ];

  const viewToggles = (): MenuItem[] => [
    { label: 'Show Rulers', checked: prefs.rulers, run: () => { prefs = { ...prefs, rulers: !prefs.rulers }; savePrefs(prefs); render(); } },
    { label: 'Show Grid', checked: prefs.grid, run: () => { prefs = { ...prefs, grid: !prefs.grid }; savePrefs(prefs); render(); } },
  ];

  menuBar($('menu'), [
    { title: 'File', items: () => [
      { label: 'New', run: () => { editor.doc.page = { ...prefs.page }; editor.doc.replace(new Molecule(), [], [], newDocStyle()); setZoom(zoom); } },
      { label: 'Open…', shortcut: '⌘O', run: () => $<HTMLInputElement>('fileInput').click() },
      'sep',
      { label: 'Save as CDXML', shortcut: '⌘S', run: saveCdxml },
      { label: 'Save as MOL', run: () => download('structure.mol', writeMolfile(editor.doc.mol, editor.doc.style.bondLength, 'HexSketch structure'), 'chemical/x-mdl-molfile'), enabled: editor.doc.mol.atomCount > 0 },
      { label: 'Export', submenu: exportItems, enabled: hasDrawing() },
      'sep',
      { label: 'Document Settings…', run: openDocumentSettings },
      { label: 'Drawing Settings…', run: openDrawingSettings },
      'sep',
      { label: 'Getting Started Guide', run: () => { void openGuide().then(() => wrapEl.focus()); } },
      { label: 'Send Feedback…', run: () => { void openFeedback().then(() => wrapEl.focus()); } },
      ...(opts.aboutLinks ? ['sep' as const,
        { label: 'Use with Claude…', run: () => { window.open('/ai', '_blank', 'noopener'); } },
        { label: 'Star on GitHub', run: () => { window.open('https://github.com/angus-e-mcmillan/HexSketch', '_blank', 'noopener'); } },
      ] : []),
    ] },
    { title: 'Edit', items: () => [
      { label: 'Undo', shortcut: '⌘Z', run: () => editor.doc.undo(), enabled: editor.doc.canUndo },
      { label: 'Redo', shortcut: '⇧⌘Z', run: () => editor.doc.redo(), enabled: editor.doc.canRedo },
      'sep',
      { label: 'Copy As', submenu: copyAsItems, enabled: hasDrawing() },
      { label: 'Copy for AI', run: copyForAI, enabled: editor.doc.mol.atomCount > 0 },
      { label: 'Copy Link', run: copyLink, enabled: hasDrawing() },
      { label: 'Select All', shortcut: '⌘A', run: () => editor.selectAll() },
      { label: 'Delete', shortcut: '⌫', run: () => editor.key('Delete', {}), enabled: hasSelection() },
    ] },
    { title: 'View', items: () => [
      ...viewToggles(),
      'sep',
      { label: 'Zoom In', shortcut: '⌘+', run: () => setZoom(zoom * 1.25) },
      { label: 'Zoom Out', shortcut: '⌘−', run: () => setZoom(zoom / 1.25) },
      { label: 'Actual Size', run: () => setZoom(1) },
      { label: 'Fit to Window', shortcut: '⌘/', run: fitToWindow, enabled: hasDrawing() },
    ] },
    { title: 'Object', items: () => [
      ...groupItems(),
      'sep',
      { label: 'Align', submenu: alignItems },
      { label: 'Distribute', submenu: distributeItems },
      'sep',
      { label: 'Flip Horizontal', shortcut: '⇧⌘H', run: () => editor.rotate180('horizontal'), enabled: hasSelection() },
      { label: 'Flip Vertical', shortcut: '⇧⌘V', run: () => editor.rotate180('vertical'), enabled: hasSelection() },
    ] },
    { title: 'Structure', items: () => [
      { label: 'Clean Up Structure', shortcut: '⇧⌘K', run: () => editor.cleanUp(), enabled: editor.doc.mol.atomCount > 0 },
      { label: 'Expand Label', run: expandLabel },
      'sep',
      { label: 'Analysis', submenu: analysisItems },
      { label: 'Convert Structure to Name', shortcut: '⌥⌘N', run: convertToName, enabled: editor.doc.mol.atomCount > 0 },
    ] },
    { title: 'Colors', items: () => [
      { label: 'Color', panel: colorPanel },
      { label: 'Highlight Colors', panel: highlightPanel },
      { label: 'Ring Fill Colors', panel: ringFillPanel },
      'sep',
      { label: 'Color by Element', run: () => editor.colorByElement() },
      'sep',
      { label: 'Palette', submenu: paletteItems },
    ] },
  ]);

  function expandLabel() {
    if (!editor.expandLabels()) flash('Nothing to expand: select a peptide (H-Ala-Gly-OH) or an abbreviated label (Ph, OMe, Boc…)');
  }

  function convertToName() {
    if (!editor.nameToCaption()) flash('Draw a structure first');
  }

  function saveCdxml() {
    download('structure.cdxml', writeCdxml(editor.doc.mol, editor.doc.style, editor.doc.objects, { page: editor.doc.page, groups: editor.doc.groups }), 'chemical/x-cdxml');
  }

  function copyAsText(kind: 'cdxml' | 'smiles' | 'mol') {
    const src = copySource();
    const text = kind === 'cdxml' ? writeCdxml(src.mol, editor.doc.style, src.objects, { groups: src.groups }) : kind === 'smiles' ? writeSmiles(src.mol) : writeMolfile(src.mol, editor.doc.style.bondLength);
    navigator.clipboard.writeText(text).then(() => flash(`Copied as ${kind === 'cdxml' ? 'CDXML' : kind === 'smiles' ? 'SMILES' : 'MOL text'}`))
      .catch(() => flash('Copy failed: the browser blocked clipboard access'));
  }

  /**
   * Copy text that takes a moment to make (a link compresses the drawing). The
   * ClipboardItem goes in at once with a promise for the text, as Safari
   * requires; browsers without ClipboardItem get the text when it is ready.
   */
  function copyWhenReady(text: Promise<string>, done: string) {
    const write = typeof ClipboardItem === 'undefined'
      ? text.then((t) => navigator.clipboard.writeText(t))
      : navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((t) => new Blob([t], { type: 'text/plain' })) })]);
    write.then(() => flash(done)).catch(() => flash('Copy failed: the browser blocked clipboard access'));
  }

  /** Links open in this same app: hexsketch.com, or the dev server. */
  const linkBase = () => `${location.origin}${location.pathname}`;

  /** Edit > Copy Link: a link that opens the selection (or the whole drawing) in HexSketch. */
  function copyLink() {
    const src = copySource();
    if (!src.mol.atomCount && !src.objects.length) { flash('Draw a structure first'); return; }
    copyWhenReady(structureLink(src.mol, editor.doc.style, src.objects, src.groups, linkBase()), 'Copied a link that opens this drawing in HexSketch');
  }

  /** Edit > Copy for AI: name, SMILES, formula and masses as text, with a link back to the drawing. */
  function copyForAI() {
    const src = copySource();
    if (!src.mol.atomCount) { flash('Draw a structure first'); return; }
    const text = structureLink(src.mol, editor.doc.style, src.objects, src.groups, linkBase())
      .then((link) => aiSummary(src.mol, { nameOf: (m) => nameMolecule(m).name, link }));
    copyWhenReady(text, 'Copied for AI: paste it into your chat with Claude, ChatGPT or another assistant');
  }

  /** Open the structure a link carries (#smiles=… or #cdxml=…, see core/link.ts) as one undoable step. */
  async function openFromLink() {
    let got;
    try { got = await readStructureLink(location.hash, editor.doc.style.bondLength); }
    catch (err) { flash((err as Error).message); return; }
    if (!got) return;
    const replacing = hasDrawing();
    // Once edited, the drawing no longer matches the address, so drop it there (Copy Link makes a fresh one).
    history.replaceState(null, '', location.pathname + location.search);
    if (got.kind === 'drawing') {
      if (got.page) editor.doc.page = got.page;
      editor.doc.replace(got.mol, got.objects, got.groups, got.style);
    } else {
      placeOnPage(got.mol, []);
      editor.doc.replace(got.mol);
      revealDrawing();
    }
    flash(replacing ? 'Opened the structure from the link (Undo brings back the drawing it replaced)' : 'Opened the structure from the link');
  }

  /** The part of the sheet in view, in page points; the whole sheet when hardly any of it shows. */
  function visibleSheet() {
    const doc = documentSize(editor.doc.page);
    const w = wrapEl.getBoundingClientRect();
    const a = toPage({ clientX: w.left, clientY: w.top }), b = toPage({ clientX: w.right, clientY: w.bottom });
    const r = { x0: Math.max(0, a.x), y0: Math.max(0, a.y), x1: Math.min(doc.w, b.x), y1: Math.min(doc.h, b.y) };
    return r.x1 - r.x0 < 4 * editor.L || r.y1 - r.y0 < 4 * editor.L ? { x0: 0, y0: 0, x1: doc.w, y1: doc.h } : r;
  }

  /**
   * Move a drawing (atoms, arrows, captions) to the middle of the sheet as far
   * as it is in view: a wide window shows more desk than sheet, so the middle
   * of the window can be off the sheet. Wedges keep the stereo, so recorded
   * chirality is dropped.
   */
  function placeOnPage(mol: Molecule, objects: readonly DocObject[]) {
    const pts = [...mol.atoms(), ...objects.flatMap(objectPoints)];
    if (!pts.length) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const v = visibleSheet(), doc = documentSize(editor.doc.page);
    // The middle of what shows, but never so near an edge that part of the drawing falls off the sheet.
    const centre = (lo: number, hi: number, half: number, size: number) =>
      2 * (half + editor.L) > size ? size / 2 : Math.min(size - half - editor.L, Math.max(half + editor.L, (lo + hi) / 2));
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const dx = centre(v.x0, v.x1, (x1 - x0) / 2, doc.w) - (x0 + x1) / 2;
    const dy = centre(v.y0, v.y1, (y1 - y0) / 2, doc.h) - (y0 + y1) / 2;
    for (const a of mol.atoms()) { a.x += dx; a.y += dy; a.chirality = null; }
    for (const o of objects) for (const q of objectPoints(o)) { q.x += dx; q.y += dy; }
  }

  /** Zoom out (never in) until the whole drawing is in view, and scroll it to the middle. */
  function revealDrawing() {
    const b = editor.depiction.bounds;
    if (!Number.isFinite(b.x0)) return;
    const pad = 40, w = wrapEl.clientWidth - 2 * pad, h = viewHeight() - 2 * pad;
    const fit = Math.min(w / Math.max(1, b.x1 - b.x0), h / Math.max(1, b.y1 - b.y0));
    if (fit < zoom) setZoom(fit);
    centreOn(b);
  }

  /** Export the selection (or the whole drawing) as an image or a file. */
  async function exportAs(kind: 'png' | 'svg' | 'pdf' | 'cdxml' | 'mol') {
    const src = copySource();
    if (!src.mol.atomCount && !src.objects.length) { flash('Nothing to export'); return; }
    const dep = depict(src.mol, editor.doc.style, src.objects);
    const base = hasSelection() ? 'selection' : 'drawing';
    if (kind === 'svg') download(`${base}.svg`, toSvg(dep, { padding: 6 }), 'image/svg+xml');
    else if (kind === 'png') {
      // The structure rides inside the PNG, so File > Open (or a paste) can edit it again.
      const png = new Uint8Array(await (await svgToPng(toSvg(dep, { padding: 6, background: '#fff' }), 5, EXPORT_MAX_PIXELS)).blob.arrayBuffer());
      let name: string | null = null;
      try { name = nameMolecule(src.mol).name; } catch { name = null; }
      const alt = await altTextFor(src.mol, name, editor.doc.style, src.objects, src.groups);
      downloadBlob(`${base}.png`, new Blob([pngWithPayload(png, alt) as BlobPart], { type: 'image/png' }));
    }
    else if (kind === 'pdf') downloadBlob(`${base}.pdf`, new Blob([toPdf(dep, { padding: 6 }) as BlobPart], { type: 'application/pdf' }));
    else if (kind === 'cdxml') download(`${base}.cdxml`, writeCdxml(src.mol, editor.doc.style, src.objects, { groups: src.groups }), 'chemical/x-cdxml');
    else download(`${base}.mol`, writeMolfile(src.mol, editor.doc.style.bondLength, 'HexSketch structure'), 'chemical/x-mdl-molfile');
  }

  /** Colors > Palette: the colour table the Color menu offers (colours already used stay as they are). */
  function paletteItems(): MenuItem[] {
    const current = paletteId(editor.doc.style);
    return PALETTES.map((p) => ({ label: p.label, checked: current === p.id, run: () => editor.setStyle({ ...editor.doc.style, palette: p.colors }, { rescale: false }) }));
  }

  async function openDrawingSettings() {
    const r = await drawingSettingsDialog({ style: editor.doc.style, units: prefs.units, library: styles });
    if (r) {
      editor.setStyle(r.style, { rescale: r.rescale });
      if (r.makeDefault) { styles.defaultStyle = { ...r.style }; saveStyleLibrary(styles); }
      flash(r.makeDefault ? 'Drawing settings applied, and saved for new documents' : 'Drawing settings applied');
    }
    wrapEl.focus();
  }

  async function openDocumentSettings() {
    const r = await documentSettingsDialog({ page: editor.doc.page, prefs });
    if (r) {
      editor.doc.page = r.page;
      prefs = r.prefs;
      savePrefs(prefs);
      if (editor.analysisDecimals !== prefs.decimals) {
        editor.analysisDecimals = prefs.decimals;
        editor.doc.touch();
      }
      setZoom(zoom);
    }
    wrapEl.focus();
  }

  function download(name: string, text: string, type: string) {
    downloadBlob(name, new Blob([text], { type }));
  }

  function downloadBlob(name: string, blob: Blob) {
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: name });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $<HTMLInputElement>('fileInput').addEventListener('change', async (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (/\.png$/i.test(file.name) || file.type === 'image/png') {
      // A PNG exported or copied from HexSketch carries its structure.
      const text = payloadFromPng(new Uint8Array(await file.arrayBuffer()));
      const p = text ? await decodePayload(text) : null;
      if (p) editor.doc.replace(p.mol, p.objects, p.groups, p.style);
      else flash(`${file.name} has no HexSketch structure in it`);
      (e.target as HTMLInputElement).value = '';
      return;
    }
    const text = await file.text();
    if (/\.(mol|sdf)$/i.test(file.name) || /V2000/.test(text.split('\n')[3] ?? '')) {
      // First record of an SD file, or a molfile.
      try { editor.doc.replace(readMolfile(text.split('$$$$')[0]!, editor.doc.style.bondLength)); }
      catch (err) { flash(`Could not open ${file.name}: ${(err as Error).message}`); }
      (e.target as HTMLInputElement).value = '';
      return;
    }
    const style = readCdxmlStyle(text, editor.doc.style);
    editor.doc.page = readCdxmlPage(text) ?? editor.doc.page;
    const opened = readCdxmlDocument(text);
    // Files without coordinates (from other programs) get laid out.
    if ([...opened.mol.atoms()].every((a) => a.x === 0 && a.y === 0)) layout2D(opened.mol, style.bondLength);
    editor.doc.replace(opened.mol, opened.objects, opened.groups, style);
    (e.target as HTMLInputElement).value = '';
  });

  // ----------------------------------------------------------------- viewport

  // Rulers sit along the top and left of the canvas; the grid and page breaks lie on the page under the drawing.
  const area = document.createElement('div');
  area.className = 'canvas-area';
  wrapEl.replaceWith(area);
  // Each canvas sits absolutely inside its grid cell, so its pixel size can never feed back into the layout
  // (in Safari it did: a Retina-sized canvas widened its track, the next draw doubled it again, and the page froze).
  area.innerHTML = '<div class="ruler-corner"></div><div class="ruler ruler-x" aria-hidden="true"><canvas></canvas></div><div class="ruler ruler-y" aria-hidden="true"><canvas></canvas></div>';
  area.append(wrapEl);
  const rulerX = area.querySelector<HTMLCanvasElement>('.ruler-x canvas')!, rulerY = area.querySelector<HTMLCanvasElement>('.ruler-y canvas')!;
  const gridEl = Object.assign(document.createElement('div'), { className: 'page-grid' });
  const breaksEl = Object.assign(document.createElement('div'), { className: 'page-breaks' });
  pageEl.prepend(gridEl, breaksEl);
  let pointer: { x: number; y: number } | null = null;

  /** Redraw the rulers once per frame at most. */
  let rulerFrame = 0;
  function drawRulers() {
    area.classList.toggle('no-rulers', !prefs.rulers);
    if (!prefs.rulers || rulerFrame) return;
    rulerFrame = requestAnimationFrame(() => { rulerFrame = 0; paintRulers(); });
  }
  function paintRulers() {
    const p = pageEl.getBoundingClientRect(), rx = rulerX.getBoundingClientRect(), ry = rulerY.getBoundingClientRect();
    drawRuler(rulerX, 'x', { origin: p.left - rx.left, zoom, units: prefs.units, pointer: pointer ? pointer.x - rx.left : null });
    drawRuler(rulerY, 'y', { origin: p.top - ry.top, zoom, units: prefs.units, pointer: pointer ? pointer.y - ry.top : null });
  }
  wrapEl.addEventListener('scroll', drawRulers, { passive: true });
  window.addEventListener('resize', drawRulers);
  wrapEl.addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; drawRulers(); });
  wrapEl.addEventListener('pointerleave', () => { pointer = null; drawRulers(); });

  /** Page size, grid and page breaks for the current settings and zoom. */
  function layoutPage() {
    const doc = documentSize(editor.doc.page);
    pageEl.style.width = `${doc.w * zoom}px`;
    pageEl.style.height = `${doc.h * zoom}px`;
    gridEl.hidden = !prefs.grid;
    if (prefs.grid) {
      const step = prefs.gridSpacing * PT_PER[prefs.units] * zoom;
      gridEl.style.backgroundSize = `${step}px ${step}px`;
    }
    const { across, down } = editor.doc.page;
    const pw = (doc.w / across) * zoom, ph = (doc.h / down) * zoom;
    breaksEl.innerHTML = [
      ...Array.from({ length: across - 1 }, (_, i) => `<div class="break-v" style="left:${(i + 1) * pw}px"></div>`),
      ...Array.from({ length: down - 1 }, (_, i) => `<div class="break-h" style="top:${(i + 1) * ph}px"></div>`),
    ].join('');
  }

  function setZoom(z: number) {
    zoom = Math.min(8, Math.max(0.25, z));
    $('zoom').textContent = `${Math.round(zoom * 100)}%`;
    render();
  }

  function onPhone() { return window.matchMedia('(max-width: 520px)').matches; }
  /**
   * The height the drawing is fitted into and centred on. On a phone that is
   * not the whole canvas: in a chat the message box sits over the bottom of
   * the frame and grows as the user types, so the lower band is left empty
   * and the structure stays in sight.
   */
  function viewHeight() { return wrapEl.clientHeight * (onPhone() ? 0.74 : 1); }

  /** Put the middle of `b` in the middle of what can be seen. */
  function centreOn(b: { x0: number; y0: number; x1: number; y1: number }) {
    wrapEl.scrollLeft = (b.x0 + b.x1) / 2 * zoom + pageEl.offsetLeft - wrapEl.clientWidth / 2;
    wrapEl.scrollTop = (b.y0 + b.y1) / 2 * zoom + pageEl.offsetTop - viewHeight() / 2;
  }

  /** Cmd+/: zoom so the whole drawing fills the window. */
  function fitToWindow() {
    const b = editor.depiction.bounds;
    if (!Number.isFinite(b.x0) || b.x1 - b.x0 < 1) return;
    const w = wrapEl.clientWidth - 80, h = viewHeight() - 80;
    setZoom(Math.min(w / (b.x1 - b.x0), h / (b.y1 - b.y0)));
    centreOn(b);
  }

  /** Middle of the visible canvas, in page points (above the chat box on a phone). */
  function viewCentre() {
    const w = wrapEl.getBoundingClientRect();
    return toPage({ clientX: w.left + w.width / 2, clientY: w.top + viewHeight() / 2 });
  }

  /** Client coordinates to page points. */
  function toPage(e: { clientX: number; clientY: number }) {
    const r = pageEl.getBoundingClientRect();
    return { x: (e.clientX - r.left) / zoom, y: (e.clientY - r.top) / zoom };
  }

  // ------------------------------------------------------------------ drawing

  function render() {
    layoutPage();
    const doc = documentSize(editor.doc.page);
    const { svg, depiction } = editor.render({ padding: 0 });
    const b = depiction.bounds;
    // Position the SVG so its viewBox maps 1 pt to `zoom` px at the right page offset.
    const pad = 40;
    const x0 = Math.min(b.x0, 0) - pad, y0 = Math.min(b.y0, 0) - pad;
    const x1 = Math.max(b.x1, doc.w) + pad, y1 = Math.max(b.y1, doc.h) + pad;
    drawingEl.innerHTML = svg.replace(/width="[^"]*" height="[^"]*" viewBox="[^"]*"/,
      `width="${(x1 - x0) * zoom}" height="${(y1 - y0) * zoom}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}" style="left:${x0 * zoom}px;top:${y0 * zoom}px"`);
    syncPalette();
    renderStatus();
    drawRulers();
  }

  function renderStatus() {
    const t = editor.tool;
    const name = t.kind === 'bond' ? `${t.bond} bond` : t.kind === 'ring' ? `${t.size}-ring${t.aromatic ? ' (aromatic)' : ''}`
      : t.kind === 'arrow' ? (t.arc !== undefined ? `${Math.abs(t.arc)}° arc ${t.arc >= 0 ? '(anticlockwise)' : '(clockwise)'}` : `${t.arrow} arrow`)
      : t.kind === 'shape' ? `${t.shape}` : t.kind;
    const h = editor.hover;
    const over = h.kind === 'atom' ? ' · over atom: letters set labels, digits sprout, +/− charge'
      : h.kind === 'bond' ? ' · over bond: 1/2/3 order, l/c/r position, w/h/b/y style, digits fuse rings' : '';
    if (editor.placingCopy) { if (!flashTimer) $('status').textContent = 'Placing a copy: click to put it down, Option+click to put down several, Esc to stop'; return; }
    if (!flashTimer) $('status').textContent = `Tool: ${name}${over}`;
  }

  editor.onChange(render);

  // ------------------------------------------------------------------- events

  /**
   * A finger with a selection tool scrolls the sheet, as it does everywhere
   * else on a phone, and a tap still selects what it lands on; with a bond,
   * ring or other drawing tool a finger draws. So scrolling never leaves a
   * stray bond behind, and the lasso the app opens with keeps the sheet free
   * to move. A mouse is unaffected: it scrolls with the wheel.
   */
  let pan: { id: number; x: number; y: number; left: number; top: number; page: { x: number; y: number }; moved: boolean } | null = null;
  const fingerScrolls = (e: PointerEvent) => e.pointerType === 'touch' && editor.tool.kind === 'select';

  /**
   * Two fingers pinch to zoom, about the point between them, with any tool:
   * the second finger cancels what the first had begun (a scroll, a bond),
   * and nothing is drawn until every finger has lifted.
   */
  const fingers = new Map<number, { clientX: number; clientY: number }>();
  let pinch: { dist: number; zoom: number; at: { x: number; y: number } } | null = null;
  let pinched = false;
  const spread = () => {
    const [a, b] = [...fingers.values()] as [{ clientX: number; clientY: number }, { clientX: number; clientY: number }];
    return { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, mid: { clientX: (a.clientX + b.clientX) / 2, clientY: (a.clientY + b.clientY) / 2 } };
  };
  /** Keep track of fingers; true while a pinch owns the gesture, so nothing else sees it. */
  function pinchEvent(e: PointerEvent): boolean {
    if (e.pointerType !== 'touch') return false;
    if (e.type === 'pointerdown') fingers.set(e.pointerId, e);
    else if (e.type === 'pointermove' && fingers.has(e.pointerId)) fingers.set(e.pointerId, e);
    else if (e.type === 'pointerup' || e.type === 'pointercancel') fingers.delete(e.pointerId);
    if (e.type === 'pointerdown' && fingers.size === 2) {
      pan = null;
      editor.cancelGesture();
      const { dist, mid } = spread();
      pinch = { dist, zoom, at: toPage(mid) };
      pinched = true;
      return true;
    }
    if (pinch && fingers.size >= 2 && e.type === 'pointermove') {
      const { dist, mid } = spread();
      setZoom(pinch.zoom * (dist / pinch.dist));
      // The point that was between the fingers stays between them.
      const r = pageEl.getBoundingClientRect();
      wrapEl.scrollLeft += r.left + pinch.at.x * zoom - mid.clientX;
      wrapEl.scrollTop += r.top + pinch.at.y * zoom - mid.clientY;
      return true;
    }
    if (fingers.size < 2) pinch = null;
    if (pinched) {
      if (!fingers.size) pinched = false;
      return true;
    }
    return false;
  }

  wrapEl.addEventListener('pointerdown', (e) => {
    if (pinchEvent(e)) return;
    if (e.button !== 0 || e.target === labelEditor) return;
    commitLabel();
    commitCaption();
    wrapEl.focus();
    if (fingerScrolls(e)) {
      pan = { id: e.pointerId, x: e.clientX, y: e.clientY, left: wrapEl.scrollLeft, top: wrapEl.scrollTop, page: toPage(e), moved: false };
      return;
    }
    wrapEl.setPointerCapture(e.pointerId);
    editor.pointerDown({ ...toPage(e), shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, time: e.timeStamp, touch: e.pointerType === 'touch' });
  });
  // Right-click: what you can do with the thing under the pointer, or with the selection.
  wrapEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    commitLabel();
    commitCaption();
    const p = toPage(e);
    const hit = editor.hit(p.x, p.y);
    const sel = editor.selection;
    // Right-clicking outside the selection selects what was clicked (a whole structure for an atom or bond).
    if ((hit.kind === 'atom' && !sel.atoms.has(hit.id)) || (hit.kind === 'bond' && !sel.bonds.has(hit.id))) editor.selectStructureAt(hit);
    else if (hit.kind === 'object' && !sel.objects.has(hit.id)) editor.selectObjects([hit.id]);
    openMenu(contextItems(hit.kind === 'object' ? hit.id : null), { x: e.clientX, y: e.clientY });
  });

  function contextItems(objectId: number | null): MenuItem[] {
    const sel = editor.selection;
    if (!hasSelection()) {
      return [
        { label: 'Select All', shortcut: '⌘A', run: () => editor.selectAll(), enabled: hasDrawing() },
        { label: 'Export Drawing', submenu: exportItems, enabled: hasDrawing() },
        'sep',
        ...viewToggles(),
        'sep',
        { label: 'Document Settings…', run: openDocumentSettings },
        { label: 'Drawing Settings…', run: openDrawingSettings },
      ];
    }
    const items: MenuItem[] = [];
    const o = objectId !== null && sel.objects.size === 1 && !sel.atoms.size ? editor.doc.objects.find((x) => x.id === objectId) : undefined;
    if (o && o.kind !== 'text') items.push(...objectItems(o), 'sep');
    if (o && o.kind === 'text') items.push({ label: 'Edit Text', run: () => editor.onEditCaption?.(o.id) }, 'sep');
    const structures = sel.atoms.size > 0;
    const peptide = [...sel.objects].some((id) => { const c = editor.doc.objects.find((x) => x.id === id); return c?.kind === 'text' && !c.analysis && !!parsePeptide(c.text.trim()); });
    items.push(
      { label: 'Copy', shortcut: '⌘C', run: () => { const src = copySource(); copyStructure(src.mol, editor.doc.style, src.objects, src.groups).then((c) => { void rememberCopy(c.png, c.alt); flash('Copied: paste into Word, PowerPoint or Google Docs; copy it back to edit'); }).catch(() => flash('Copy failed: the browser blocked clipboard access')); } },
      { label: 'Copy As', submenu: copyAsItems },
      'sep',
    );
    if (structures || peptide) {
      items.push(
        { label: 'Analysis', submenu: analysisItems },
        { label: 'Expand Label', run: expandLabel },
      );
      if (structures) items.push({ label: 'Clean Up Structure', shortcut: '⇧⌘K', run: () => editor.cleanUp() });
      items.push('sep');
    }
    items.push({ label: 'Color', panel: colorPanel });
    if (structures) items.push({ label: 'Highlight', panel: highlightPanel }, { label: 'Ring Fill', panel: ringFillPanel });
    items.push('sep');
    items.push(...groupItems());
    if (structures || sel.objects.size > 1) {
      items.push({ label: 'Align', submenu: alignItems }, { label: 'Distribute', submenu: distributeItems });
      if (structures) items.push({ label: 'Flip Horizontal', shortcut: '⇧⌘H', run: () => editor.rotate180('horizontal') }, { label: 'Flip Vertical', shortcut: '⇧⌘V', run: () => editor.rotate180('vertical') });
      items.push('sep');
    }
    items.push({ label: 'Export', submenu: exportItems }, 'sep', { label: 'Delete', shortcut: '⌫', run: () => editor.key('Delete', {}) });
    return items;
  }

  /** ChemDraw's context menu for an arrow or drawing element. */
  function objectItems(o: DocObject): MenuItem[] {
    const set = (fn: (x: DocObject) => void) => () => editor.updateObject(o.id, fn);
    const items: MenuItem[] = [];
    if (o.kind === 'arrow') {
      for (const [label, v] of [['Plain', 'plain'], ['Dashed', 'dashed'], ['Bold', 'bold']] as const) items.push({ label, checked: o.line === v, run: set((x) => { if (x.kind === 'arrow') x.line = v; }) });
      items.push('sep',
        { label: 'Full Arrow at Start', checked: o.tailEnd === 'full', run: set((x) => { if (x.kind === 'arrow') x.tailEnd = x.tailEnd === 'full' ? 'none' : 'full'; }) },
        { label: 'Full Arrow at End', checked: o.headEnd === 'full', run: set((x) => { if (x.kind === 'arrow') x.headEnd = x.headEnd === 'full' ? 'none' : 'full'; }) },
        { label: 'Half Arrow at End Left', checked: o.headEnd === 'halfLeft', run: set((x) => { if (x.kind === 'arrow') x.headEnd = x.headEnd === 'halfLeft' ? 'none' : 'halfLeft'; }) },
        { label: 'Half Arrow at End Right', checked: o.headEnd === 'halfRight', run: set((x) => { if (x.kind === 'arrow') x.headEnd = x.headEnd === 'halfRight' ? 'none' : 'halfRight'; }) },
        'sep');
      for (const [label, v] of [['Solid Arrowhead', 'solid'], ['Hollow Arrowhead', 'hollow'], ['Angled Arrowhead', 'angled']] as const) items.push({ label, checked: o.headStyle === v, run: set((x) => { if (x.kind === 'arrow') x.headStyle = v; }) });
      items.push('sep',
        { label: 'No-Go (Cross)', checked: o.nogo === 'cross', run: set((x) => { if (x.kind === 'arrow') x.nogo = x.nogo === 'cross' ? 'none' : 'cross'; }) },
        { label: 'No-Go (Hash)', checked: o.nogo === 'hash', run: set((x) => { if (x.kind === 'arrow') x.nogo = x.nogo === 'hash' ? 'none' : 'hash'; }) },
        { label: 'Dipole', checked: o.dipole, run: set((x) => { if (x.kind === 'arrow') x.dipole = !x.dipole; }) });
      if (o.arc || o.curve) items.push('sep', { label: 'Straighten', run: set((x) => { if (x.kind === 'arrow') { x.arc = null; x.curve = null; } }) });
    } else if (o.kind === 'shape') {
      if (o.shape !== 'line') {
        for (const [label, v] of [['No Fill', 'none'], ['Filled', 'filled'], ['Shaded', 'shaded']] as const) items.push({ label, checked: o.fill === v, run: set((x) => { if (x.kind === 'shape') x.fill = v; }) });
        items.push({ label: 'Shadowed', checked: o.shadow, run: set((x) => { if (x.kind === 'shape') x.shadow = !x.shadow; }) }, 'sep');
      }
      for (const [label, v] of [['Plain', 'plain'], ['Dashed', 'dashed'], ['Bold', 'bold']] as const) items.push({ label, checked: o.line === v, run: set((x) => { if (x.kind === 'shape') x.line = v; }) });
    }
    return items;
  }
  /** How far a finger may travel and still count as a tap rather than a scroll. */
  const TAP_SLOP = 8;
  wrapEl.addEventListener('pointermove', (e) => {
    if (pinchEvent(e)) return;
    if (pan) {
      if (e.pointerId !== pan.id) return;
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.moved && Math.hypot(dx, dy) < TAP_SLOP) return;
      pan.moved = true;
      wrapEl.scrollLeft = pan.left - dx;
      wrapEl.scrollTop = pan.top - dy;
      return;
    }
    editor.pointerMove({ ...toPage(e), shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, time: e.timeStamp, touch: e.pointerType === 'touch' });
  });
  wrapEl.addEventListener('pointerup', (e) => {
    if (pinchEvent(e)) return;
    if (pan) {
      if (e.pointerId !== pan.id) return;
      const { page, moved } = pan;
      pan = null;
      // A tap, not a scroll: select what is under the finger (or clear the selection).
      if (!moved) {
        editor.pointerDown({ ...page, time: e.timeStamp, touch: true });
        editor.pointerUp({ ...page, time: e.timeStamp, touch: true });
      }
      return;
    }
    if (e.button !== 0) return;
    editor.pointerUp({ ...toPage(e), shift: e.shiftKey, alt: e.altKey, meta: e.metaKey || e.ctrlKey, time: e.timeStamp, touch: e.pointerType === 'touch' });
  });
  // The browser took the gesture over (a scroll or a page zoom): draw nothing.
  wrapEl.addEventListener('pointercancel', (e) => {
    if (pinchEvent(e)) return;
    if (pan?.id === e.pointerId) { pan = null; return; }
    editor.cancelGesture();
  });
  wrapEl.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    setZoom(zoom * (e.deltaY < 0 ? 1.1 : 1 / 1.1));
  }, { passive: false });

  /**
   * What to copy or export: the selection if there is one, else everything.
   * A structure brings its analysis caption along.
   */
  /** What Copy and Export take: the selection (with its captions and groups), or the whole drawing. */
  function copySource() { return editor.selectedDrawing(); }

  // The clipboard picture is prepared ahead of time, so Copy can write it at once:
  // Safari only allows clipboard writes made immediately in response to the key press.
  const copyFingerprint = () => `${editor.doc.undoDepth}|${[...editor.selection.atoms].join(',')}|${[...editor.selection.objects].join(',')}|${editor.doc.mol.atomCount}|${editor.doc.objects.length}`;
  // It is redone only once editing pauses, and never two at a time (overlapping
  // renders of a large drawing exhausted Safari's memory and froze the page).
  let prepared: { key: string; html: string; plain: string; png: Blob; alt: string } | null = null;
  let preparing = false;
  let prepTimer = 0;
  function prepareCopy() {
    if (prepared?.key === copyFingerprint()) return;
    clearTimeout(prepTimer);
    prepTimer = window.setTimeout(runPrepare, 400);
  }
  async function runPrepare() {
    if (preparing) { prepareCopy(); return; }
    const key = copyFingerprint();
    if (prepared?.key === key) return;
    if (!editor.doc.mol.atomCount && !editor.doc.objects.length) { prepared = null; return; }
    preparing = true;
    try {
      const src = copySource();
      const c = await clipboardContent(src.mol, editor.doc.style, src.objects, src.groups);
      if (copyFingerprint() === key) prepared = { key, html: c.html, plain: c.plain, png: c.png, alt: c.alt };
    } catch (err) { console.error(err); }
    preparing = false;
    if (prepared?.key !== copyFingerprint()) prepareCopy();
  }
  editor.onChange(prepareCopy);

  document.addEventListener('copy', (e) => {
    if (e.target === labelEditor || captionEditor.isOpen() || (!editor.doc.mol.atomCount && !editor.doc.objects.length)) return;
    e.preventDefault();
    const ok = () => flash('Copied: paste into Word, PowerPoint or Google Docs; copy it back to edit');
    if (prepared?.key === copyFingerprint() && e.clipboardData) {
      // Synchronous: a PNG in HTML whose alt text carries the structure, which Word keeps.
      e.clipboardData.setData('text/html', prepared.html);
      e.clipboardData.setData('text/plain', prepared.plain);
      void rememberCopy(prepared.png, prepared.alt);
      ok();
      return;
    }
    // Just edited: write when ready (the browser holds the clipboard open for the promises).
    const src = copySource();
    copyStructure(src.mol, editor.doc.style, src.objects, src.groups).then((c) => { void rememberCopy(c.png, c.alt); ok(); })
      .catch((err) => { console.error(err); flash('Copy failed: the browser blocked clipboard access; try again'); });
  });

  document.addEventListener('paste', async (e) => {
    if (e.target === labelEditor || !e.clipboardData) return;
    if (captionEditor.isOpen()) return;
    e.preventDefault();
    // Read everything now: the clipboard is only readable during the event, before any await.
    const html = e.clipboardData.getData('text/html'), plain = e.clipboardData.getData('text/plain');
    const types = [...e.clipboardData.types];
    const files = Array.from(e.clipboardData.files);
    const snapshot = { getData: (t: string) => (t === 'text/html' ? html : t === 'text/plain' ? plain : '') };
    let found = await structureFromClipboard(snapshot);
    // The structure stored inside the picture itself (Word's HTML keeps the original PNG).
    if (!found) found = await structureFromImages(html, files);
    // Safari adds HTML of its own to image pastes, so look at the image whatever else came with it.
    const image = files.find((f) => f.type.startsWith('image/'));
    const loneOfficePicture = !!image || (!html && types.some((t) => t === 'Files' || t.startsWith('image/')));
    // A lone picture copied in Word keeps its alt text in Office's private clipboard format,
    // which browsers can't read: recognise it as a picture this browser copied out earlier.
    if (!found && image) {
      const text = await recallCopy(image);
      const p = text ? await decodePayload(text) : null;
      if (p) found = p;
    }
    if (!found) {
      if (/V2000/.test(plain)) {
        try { editor.insertLaidOut(readMolfile(plain, editor.doc.style.bondLength), viewCentre()); flash('Pasted MOL text as a structure'); return; } catch { /* fall through */ }
      }
      const smi = smilesFromClipboard(snapshot);
      if (smi) { editor.insertLaidOut(smi, viewCentre()); flash('Pasted SMILES as a structure'); return; }
      flash(loneOfficePicture
        ? 'This picture was not copied from HexSketch in this browser. In Word, triple-click beside the picture to select its line, copy, and paste here again'
        : 'Nothing editable on the clipboard: paste a HexSketch picture, CDXML, MOL or SMILES');
      return;
    }
    // Drop the pasted drawing next to whatever is already there.
    const existing = [...editor.doc.mol.atoms()];
    const xs = [...found.mol.atoms()].map((a) => a.x).concat(found.objects.flatMap((o) => objectPoints(o).map((p) => p.x)));
    const dx = existing.length && xs.length ? Math.max(...existing.map((a) => a.x)) + 40 - Math.min(...xs) : 0;
    editor.insertDrawing(found, dx, 0);
    flash('Pasted an editable structure');
  });

  let flashTimer = 0;
  function flash(msg: string) {
    const el = $('status');
    el.textContent = msg;
    clearTimeout(flashTimer);
    flashTimer = window.setTimeout(() => { flashTimer = 0; renderStatus(); }, 3500);
  }

  window.addEventListener('keydown', (e) => {
    // Typing in a caption, a label or any dialog is not a drawing hotkey.
    if (e.target === labelEditor || captionEditor.isOpen() || (e.target instanceof Element && e.target.closest('dialog'))) return;
    const cmd = e.metaKey || e.ctrlKey;
    // ChemDraw: Shift+Cmd+> magnify, Shift+Cmd+< reduce, Cmd+/ fit to window.
    if (cmd && (e.key === '=' || e.key === '+' || e.key === '>' || (e.shiftKey && e.key === '.'))) { e.preventDefault(); setZoom(zoom * 1.25); return; }
    if (cmd && (e.key === '-' || e.key === '<' || (e.shiftKey && e.key === ','))) { e.preventDefault(); setZoom(zoom / 1.25); return; }
    if (cmd && e.key === '/') { e.preventDefault(); fitToWindow(); return; }
    // Cmd+D copy as CDXML, Option+Cmd+C copy as SMILES (ChemDraw's shortcuts).
    if (cmd && e.key === 'd' && !e.shiftKey) {
      e.preventDefault();
      const src = copySource();
      navigator.clipboard.writeText(writeCdxml(src.mol, editor.doc.style, src.objects, { groups: src.groups })).then(() => flash('Copied as CDXML'));
      return;
    }
    if (cmd && e.altKey && (e.code === 'KeyC')) {
      e.preventDefault();
      navigator.clipboard.writeText(writeSmiles(copySource().mol)).then(() => flash('Copied as SMILES'));
      return;
    }
    if (cmd && e.altKey && e.code === 'KeyN') { e.preventDefault(); convertToName(); return; }
    // Option+Shift+Cmd+O: copy as MOL text (ChemDraw).
    if (cmd && e.altKey && e.shiftKey && e.code === 'KeyO') {
      e.preventDefault();
      navigator.clipboard.writeText(writeMolfile(copySource().mol, editor.doc.style.bondLength)).then(() => flash('Copied as MOL text'));
      return;
    }
    if (cmd && (e.code === 'KeyL' || e.code === 'KeyE') && !e.shiftKey && !e.altKey) {
      e.preventDefault();
      editor.key(e.code === 'KeyL' ? 'l' : 'e', { meta: true });
      flash(`Fixed lengths ${editor.fixedLengths ? 'on' : 'off'}, fixed angles ${editor.fixedAngles ? 'on' : 'off'}`);
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); saveCdxml(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key === 'o') { e.preventDefault(); $<HTMLInputElement>('fileInput').click(); return; }
    if (editor.key(e.key, { meta: e.metaKey, ctrl: e.ctrlKey, shift: e.shiftKey, alt: e.altKey })) e.preventDefault();
  });

  // ---------------------------------------------------------- label editing

  let editingAtom: number | null = null;
  editor.onEditLabel = (atom) => {
    const a = editor.doc.mol.atom(atom);
    editingAtom = atom;
    const r = pageEl.getBoundingClientRect(), w = wrapEl.getBoundingClientRect();
    labelEditor.style.left = `${r.left - w.left + wrapEl.scrollLeft + a.x * zoom - 10}px`;
    labelEditor.style.top = `${r.top - w.top + wrapEl.scrollTop + a.y * zoom - 11}px`;
    labelEditor.value = a.label ?? (a.element === 'C' ? '' : a.element);
    labelEditor.hidden = false;
    labelEditor.focus();
    labelEditor.select();
  };

  function commitLabel() {
    if (editingAtom === null) return;
    const atom = editingAtom;
    editingAtom = null;
    labelEditor.hidden = true;
    editor.setLabel(atom, labelEditor.value);
    wrapEl.focus();
  }
  // Captions: the rich text editor (several lines, styles, alignment).
  const captionEditor = createCaptionEditor({
    editor, pageEl, wrapEl, zoom: () => zoom,
    palette: () => editor.doc.style.palette ?? [],
  });
  editor.onEditCaption = (id) => captionEditor.open(id);
  function commitCaption() { captionEditor.commit(); }
  editor.onChange(() => captionEditor.refresh());

  const commitEditor = () => { commitLabel(); commitCaption(); };
  labelEditor.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commitEditor(); }
    if (e.key === 'Escape') { editingAtom = null; labelEditor.hidden = true; wrapEl.focus(); }
  });
  labelEditor.addEventListener('blur', () => commitEditor());

  // Host-specific actions (Insert into Word, Edit selected...).
  for (const action of opts.actions ?? []) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.className = 'host-action';
    b.addEventListener('click', async () => {
      try { await action.run(api); } catch (err) { console.error(err); flash(`${action.label} failed: ${(err as Error).message}`); }
      wrapEl.focus();
    });
    $('menu').append(b);
  }

  const api: AppApi = {
    editor,
    flash,
    /** Replace the drawing (when editing an existing structure from a document). */
    load(mol: Molecule, style?: DrawingStyle, objects: DocObject[] = [], opts: { centre?: boolean } = {}) {
      if (opts.centre) placeOnPage(mol, objects);
      editor.doc.replace(mol, objects, [], style);
      if (opts.centre) revealDrawing();
    },
    image: () => structureImage(editor.doc.mol, editor.doc.style, editor.doc.objects),
  };

  setZoom(zoom);
  wrapEl.focus();
  if (opts.openLinks) {
    void openFromLink();
    window.addEventListener('hashchange', () => void openFromLink());
  }
  if (opts.firstRunGuide && !guideSeen()) void openGuide().then(() => wrapEl.focus());
  return api;

}
