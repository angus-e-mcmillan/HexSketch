import { cloneGroups, groupContents, parentGroup, topGroups, type ObjectGroup, newObjectId, analysisRuns, ANALYSIS_ITEMS, sortAnalysisItems, writeSmiles, type AnalysisItem, captionRuns, cleanUpStructure, cloneObjects, computeMass, setCaptionRuns, type Caption, type TextRun, type TextStyle, elementBySymbol, layout2D, layoutAsPeptide, makeCaption, Molecule, objectPoints, objectPolylines, parsePeptide, parseSmiles, peptideMolecule, peptideSmiles, perceiveRings, type DocObject, perceiveStereoFromGeometry, type AtomId, type BondId, type MassResult, type DrawingStyle } from '@hexsketch/core';
import { captionBounds, depict, toSvg, type Depiction } from '@hexsketch/render';
import { EditorDocument } from './document.ts';
import { hitObject, hitTest, inLasso, inRect, objectsInRect, type Hit } from './hittest.ts';
import { ATOM_HOTKEYS, BOND_HOTKEYS, resolveHotkey, type ToolId } from './hotkeys.ts';
import {
  applyAtomAction, applyBondAction, applyLabel, atomNear, bondFromAtom, bondFromPoint, bondProps, clickBond, erase,
  ringAtPoint, ringOnAtom, ringOnBond, type BondKind,
} from './ops.ts';
import { largestGapBisector, snapAngle } from './placement.ts';
import { dragHandle, handleAt, objectFromDrag, objectHandles, rebowCurve, type ArrowTool, type HandleName, type ShapeTool } from './objecttools.ts';

export type Tool =
  | { kind: 'select'; mode: 'marquee' | 'lasso' }
  | { kind: 'bond'; bond: BondKind }
  | { kind: 'ring'; size: number; aromatic: boolean }
  | { kind: 'chain' }
  | { kind: 'eraser' }
  | { kind: 'text' }
  | ArrowTool
  | ShapeTool;

export interface PointerInfo {
  x: number; y: number; shift?: boolean; alt?: boolean;
  /** Command (Ctrl on Windows): while dragging a selection, locks the move to one axis. */
  meta?: boolean;
  /** Event time in ms; needed for double-clicks. */
  time?: number;
}

/** A piece of drawing on its own: structures, objects and groups (copied, duplicated, placed). */
export interface Drawing { mol: Molecule; objects: DocObject[]; groups: ObjectGroup[] }

/** Two clicks on the same thing within this many ms make a double-click. */
const DOUBLE_CLICK_MS = 400;

type Gesture =
  | { kind: 'idle' }
  | { kind: 'press'; x: number; y: number; hit: Hit }
  | { kind: 'bondDrag'; from: Hit; x0: number; y0: number; x: number; y: number }
  | { kind: 'chainDrag'; from: Hit; x0: number; y0: number; x: number; y: number }
  | { kind: 'createDrag'; x0: number; y0: number; x: number; y: number }
  | { kind: 'handle'; id: number; handle: HandleName; orig: DocObject }
  | { kind: 'move'; x0: number; y0: number; x: number; y: number; copy?: boolean; ghost?: string }
  | { kind: 'marquee'; x0: number; y0: number; x: number; y: number }
  | { kind: 'lasso'; points: { x: number; y: number }[] };

/** Pixels-equivalent distance (in points) before a press becomes a drag. */
const DRAG_THRESHOLD = 3;

/**
 * Framework-free editor. The host feeds pointer and key events in page
 * coordinates (points) and draws whatever render() returns.
 */
export class Editor {
  readonly doc: EditorDocument;
  tool: Tool = { kind: 'bond', bond: 'single' };
  hover: Hit = { kind: 'none' };
  /**
   * ChemDraw's hotspot (measured in ChemDraw 20.1): the atom or bond last
   * hovered, which stays put when the mouse leaves. Keys typed with the mouse
   * off the molecule act on it and move it on (to the new atom after a sprout,
   * to the far bond of a fused ring), so 42n152o types out a dipeptide; keys
   * typed while hovering leave it where it is. Arrow keys step it atom -> bond
   * -> atom. Escape ends it; Enter on a selection starts it; Space selects its
   * molecule.
   */
  hotspot: { kind: 'atom'; id: AtomId } | { kind: 'bond'; id: BondId } | null = null;
  selection = { atoms: new Set<AtomId>(), bonds: new Set<BondId>(), objects: new Set<number>() };
  /** Set when the host should open a label editor on an atom. */
  onEditLabel: ((atom: AtomId) => void) | null = null;
  /** Set when the host should open a text editor on a caption. */
  onEditCaption: ((id: number) => void) | null = null;
  /** Object > Fixed Lengths / Fixed Angles (Cmd+L / Cmd+E in ChemDraw). */
  fixedLengths = true;
  fixedAngles = true;
  #gesture: Gesture = { kind: 'idle' };
  #dep: Depiction | null = null;
  #listeners = new Set<() => void>();

  constructor(doc = new EditorDocument()) {
    this.doc = doc;
    doc.onChange(() => { this.#dep = null; this.#refreshAnalysis(); this.#refreshGroups(); this.#emit(); });
  }

  get L(): number { return this.doc.style.bondLength; }
  get depiction(): Depiction {
    const objs = this.#hideCaption === null ? this.doc.objects : this.doc.objects.filter((o) => o.id !== this.#hideCaption);
    return (this.#dep ??= depict(this.doc.mol, this.doc.style, objs));
  }

  #hideCaption: number | null = null;
  /** A caption being edited in place is left out of the drawing (the editor shows it). */
  get hideCaption(): number | null { return this.#hideCaption; }
  set hideCaption(id: number | null) { this.#hideCaption = id; this.#dep = null; this.#emit(); }
  get mass(): MassResult | null {
    const mol = this.analysisMolecule();
    return mol.atomCount ? computeMass(mol) : null;
  }

  #peptideCache = new Map<string, Molecule | null>();
  /**
   * What the Analysis panel describes: the drawing plus any caption that reads
   * as a peptide ("H-Ala-Gly-OH" typed with the text tool), as ChemDraw
   * interprets chemically meaningful text.
   */
  analysisMolecule(): Molecule {
    const caps = this.doc.objects.filter((o): o is Extract<DocObject, { kind: 'text' }> => o.kind === 'text');
    const peps = caps.map((c) => {
      const key = c.text.trim();
      if (!this.#peptideCache.has(key)) {
        const p = parsePeptide(key);
        this.#peptideCache.set(key, p ? parseSmiles(peptideSmiles(p)) : null);
      }
      return this.#peptideCache.get(key)!;
    }).filter((m): m is Molecule => !!m);
    if (!peps.length) return this.doc.mol;
    const out = this.doc.mol.clone();
    for (const m of peps) {
      const map = new Map<AtomId, AtomId>();
      for (const a of m.atoms()) map.set(a.id, out.addAtom({ ...a, chirality: null }).id);
      for (const a of m.atoms()) if (a.chirality) out.atom(map.get(a.id)!).chirality = { order: a.chirality.order.map((x) => (x === -1 ? -1 : map.get(x)!)), anticlockwise: a.chirality.anticlockwise };
      for (const b of m.bonds()) out.addBond({ ...b, begin: map.get(b.begin)!, end: map.get(b.end)!, ez: null });
    }
    return out;
  }

  /**
   * Structure > Expand Label: peptides written in three-letter code (as a
   * caption or a lone atom label) become their full structure, drawn as a
   * backbone zigzag; abbreviations such as Ph, OMe, CO2Me, Boc or TBS on an
   * atom are drawn out in place. Works on the selection, else the hovered
   * item, else every expandable label. Returns how many were expanded.
   */
  expandLabels(): number {
    const mol = this.doc.mol, L = this.L;
    let caps = [...this.selection.objects], atoms = [...this.selection.atoms];
    if (!caps.length && !atoms.length) {
      if (this.hover.kind === 'object') caps = [this.hover.id];
      else if (this.hover.kind === 'atom') atoms = [this.hover.id];
      else { caps = this.doc.objects.map((o) => o.id); atoms = [...mol.atoms()].filter((a) => a.label !== null).map((a) => a.id); }
    }
    const capJobs = caps.map((id) => this.doc.objects.find((o) => o.id === id))
      .filter((o): o is Extract<DocObject, { kind: 'text' }> => o?.kind === 'text' && !!parsePeptide(o.text.trim()));
    const atomJobs = atoms.filter((id) => mol.hasAtom(id) && mol.atom(id).label !== null && expandable(mol, id));
    if (!capJobs.length && !atomJobs.length) return 0;
    this.doc.edit((m, objs) => {
      for (const c of capJobs) {
        const pep = peptideMolecule(parsePeptide(c.text.trim())!, L);
        // Left edge at the caption, centred on its text.
        const xs = [...pep.atoms()].map((a) => a.x), ys = [...pep.atoms()].map((a) => a.y);
        insertMolecule(m, pep, c.x - Math.min(...xs), c.y - this.doc.style.captionSize * 0.35 - (Math.min(...ys) + Math.max(...ys)) / 2, 2 * L);
        this.#removeObjects(objs, [c.id]);
      }
      for (const id of atomJobs) expandAtomLabel(m, id, L);
    });
    this.clearSelection();
    return capJobs.length + atomJobs.length;
  }

  setTool(tool: Tool) {
    this.tool = tool;
    this.#gesture = { kind: 'idle' };
    this.#stamp = null;
    this.#emit();
  }

  /**
   * File > Drawing Settings: give the document a new style as one undoable
   * step. When the bond length changes, the drawing is scaled about its centre
   * so existing structures match it (`rescale: false` leaves them as drawn).
   */
  setStyle(next: DrawingStyle, opts: { rescale?: boolean } = {}): void {
    const k = next.bondLength / this.doc.style.bondLength;
    this.doc.edit((mol, objects) => {
      this.doc.style = { ...next };
      if (opts.rescale === false || !Number.isFinite(k) || Math.abs(k - 1) < 1e-6) return;
      const pts = [...[...mol.atoms()], ...objects.flatMap((o) => objectPoints(o))];
      if (!pts.length) return;
      const xs = pts.map((q) => q.x), ys = pts.map((q) => q.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      for (const q of pts) { q.x = cx + (q.x - cx) * k; q.y = cy + (q.y - cy) * k; }
    });
  }

  onChange(fn: () => void) { this.#listeners.add(fn); return () => this.#listeners.delete(fn); }
  #emit() { for (const fn of this.#listeners) fn(); }

  // ---------------------------------------------------------------- pointer

  /** Atoms, then bonds, then arrows and captions, as ChemDraw prioritises them. */
  hit(x: number, y: number): Hit {
    const h = hitTest(this.doc.mol, this.depiction, x, y, this.L);
    if (h.kind !== 'none') return h;
    const o = hitObject(this.doc.objects, this.doc.style, x, y);
    return o !== null ? { kind: 'object', id: o } : h;
  }

  pointerDown(p: PointerInfo) {
    // A copy picked up with Option+double-click: this click puts it down
    // (Option+click puts down one and keeps the copy for more).
    if (this.#stamp) {
      const s = this.#stamp;
      this.insertDrawing(s.src, p.x - s.x0, p.y - s.y0);
      if (!p.alt) this.#stamp = null;
      this.#gesture = { kind: 'idle' };
      this.#emit();
      return;
    }
    // Adjustment handles of the hovered or selected arrow / drawing element come first.
    const t0 = this.tool.kind;
    if (t0 === 'select' || t0 === 'arrow' || t0 === 'shape') {
      const grab = this.#handleUnder(p.x, p.y);
      if (grab) {
        const o = this.doc.objects.find((x) => x.id === grab.id)!;
        this.doc.beginLive();
        this.#gesture = { kind: 'handle', id: grab.id, handle: grab.handle, orig: cloneObjects([o])[0]! };
        return;
      }
    }
    const hit = this.hit(p.x, p.y);
    this.#gesture = { kind: 'press', x: p.x, y: p.y, hit };
    if (this.tool.kind === 'select') {
      const onSelected = (hit.kind === 'atom' && this.selection.atoms.has(hit.id)) || (hit.kind === 'bond' && this.selection.bonds.has(hit.id))
        || (hit.kind === 'object' && this.selection.objects.has(hit.id));
      if (hit.kind !== 'none' && !onSelected) this.#selectHit(hit, !!p.shift);
      if (hit.kind === 'none' && !p.shift) this.clearSelection();
    }
  }

  pointerMove(p: PointerInfo) {
    const g = this.#gesture;
    if (this.#stamp) { this.#stamp.x = p.x; this.#stamp.y = p.y; this.#emit(); return; }
    if (g.kind === 'idle') {
      const hit = this.hit(p.x, p.y);
      if (!sameHit(hit, this.hover)) { this.#setHover(hit); this.#emit(); }
      return;
    }
    if (g.kind === 'press') {
      if (Math.hypot(p.x - g.x, p.y - g.y) < DRAG_THRESHOLD) return;
      const t = this.tool;
      if (t.kind === 'bond') this.#gesture = { kind: 'bondDrag', from: g.hit, x0: g.x, y0: g.y, x: p.x, y: p.y };
      else if (t.kind === 'arrow' || t.kind === 'shape') this.#gesture = { kind: 'createDrag', x0: g.x, y0: g.y, x: p.x, y: p.y };
      else if (t.kind === 'chain') this.#gesture = { kind: 'chainDrag', from: g.hit, x0: g.x, y0: g.y, x: p.x, y: p.y };
      else if (t.kind === 'select') {
        this.#gesture = g.hit.kind === 'none'
          ? (t.mode === 'lasso' ? { kind: 'lasso', points: [{ x: g.x, y: g.y }, { x: p.x, y: p.y }] } : { kind: 'marquee', x0: g.x, y0: g.y, x: p.x, y: p.y })
          : { kind: 'move', x0: g.x, y0: g.y, x: p.x, y: p.y, copy: !!p.alt };
      }
      this.#emit();
      return;
    }
    if (g.kind === 'handle') {
      const o = this.doc.objects.find((x) => x.id === g.id);
      if (o) { dragHandle(o, g.orig, g.handle, { x: p.x, y: p.y }, { fixedAngles: this.fixedAngles && !p.alt, oval: !!p.shift }); this.doc.touch(); }
      return;
    }
    if (g.kind === 'move') g.copy = !!p.alt;
    if (g.kind === 'lasso') g.points.push({ x: p.x, y: p.y });
    else if (g.kind === 'move' && (p.meta || p.shift)) {
      // Command (or Shift, as in ChemDraw) keeps the move horizontal or vertical, whichever is larger.
      const dx = p.x - g.x0, dy = p.y - g.y0;
      if (Math.abs(dx) >= Math.abs(dy)) { g.x = p.x; g.y = g.y0; } else { g.x = g.x0; g.y = p.y; }
    } else { g.x = p.x; g.y = p.y; }
    this.hover = this.hit(p.x, p.y);
    this.#emit();
  }

  pointerUp(p: PointerInfo) {
    const g = this.#gesture;
    this.#gesture = { kind: 'idle' };
    if (g.kind === 'press') {
      // Double-clicks need event times (the app passes them; scripted clicks without times stay single).
      const now = p.time ?? -Infinity;
      const last = this.#lastClick;
      const quick = !!last && p.time !== undefined && now - last.t < DOUBLE_CLICK_MS;
      // Option+double-click goes by place, not by what is hit: the first click
      // may have drawn something there (bond tool) that the second one hits.
      const pickUp = quick && !!p.alt && last!.hit.kind !== 'none' && Math.hypot(g.x - last!.x, g.y - last!.y) < DRAG_THRESHOLD;
      const again = quick && sameHit(last!.hit, g.hit) && g.hit.kind !== 'none';
      this.#lastClick = again || pickUp ? null : { t: now, hit: g.hit, x: g.x, y: g.y };
      if (pickUp) this.#pickUpCopy(last!.hit, g.x, g.y, last!.edited);
      else if (again) this.#doubleClick(g.hit, last!.edited);
      else {
        const before = this.doc.canUndo ? this.#undoDepth() : 0;
        this.#click(g.hit, g.x, g.y);
        this.#lastClick!.edited = this.#undoDepth() !== before;
      }
    }
    else if (g.kind === 'bondDrag') this.#commitBondDrag(g);
    else if (g.kind === 'chainDrag') this.#commitChain(g);
    else if (g.kind === 'createDrag') this.#commitObject(g.x0, g.y0, g.x, g.y);
    else if (g.kind === 'handle') this.doc.endLive();
    else if (g.kind === 'move' && p.alt) this.#duplicateSelection(g.x - g.x0, g.y - g.y0);
    else if (g.kind === 'move') this.#commitMove(g.x - g.x0, g.y - g.y0);
    else if (g.kind === 'marquee') this.#setSelection({ ...inRect(this.doc.mol, g.x0, g.y0, g.x, g.y), objects: objectsInRect(this.doc.objects, this.doc.style, g.x0, g.y0, g.x, g.y) }, !!p.shift);
    else if (g.kind === 'lasso') this.#setSelection({ ...inLasso(this.doc.mol, g.points), objects: this.#objectsInLasso(g.points) }, !!p.shift);
    this.#setHover(this.hit(p.x, p.y));
    this.#emit();
  }

  /** Hovering an atom or bond also makes it the hotspot. */
  #setHover(hit: Hit) {
    this.hover = hit;
    if (hit.kind === 'atom' || hit.kind === 'bond') this.hotspot = { kind: hit.kind, id: hit.id };
  }

  #lastClick: { t: number; hit: Hit; x: number; y: number; edited?: boolean } | null = null;
  #undoDepth(): number { return this.doc.undoDepth; }

  /**
   * Double-click, as in ChemDraw: with a selection tool, select the whole
   * structure under the pointer (or edit a caption); with a bond or ring tool
   * on an atom, undo what the first click drew and edit the atom's label.
   */
  #doubleClick(hit: Hit, firstClickEdited?: boolean) {
    const t = this.tool;
    if (t.kind === 'select') {
      if (hit.kind === 'object') {
        if (this.doc.objects.find((o) => o.id === hit.id)?.kind === 'text') this.onEditCaption?.(hit.id);
        return;
      }
      this.selectStructureAt(hit);
      return;
    }
    if ((t.kind === 'bond' || t.kind === 'chain' || t.kind === 'ring') && hit.kind === 'atom') {
      if (firstClickEdited) this.doc.undo();
      if (this.doc.mol.hasAtom(hit.id)) this.onEditLabel?.(hit.id);
    }
  }

  // ------------------------------------------------------- align / distribute

  /**
   * The things Align and Distribute move: each structure touched by the
   * selection (moving whole, but measured by its selected part, as ChemDraw's
   * help says) and each selected arrow, shape or caption.
   */
  #layoutUnits(): { atoms: AtomId[]; objects: number[]; box: { x0: number; y0: number; x1: number; y1: number } }[] {
    const mol = this.doc.mol, dep = this.depiction;
    const sel = new Set(this.selection.atoms);
    for (const b of this.selection.bonds) if (mol.hasBond(b)) { sel.add(mol.bond(b).begin); sel.add(mol.bond(b).end); }
    const units: { atoms: AtomId[]; objects: number[]; box: { x0: number; y0: number; x1: number; y1: number } }[] = [];
    const grow = (box: { x0: number; y0: number; x1: number; y1: number }, x0: number, y0: number, x1 = x0, y1 = y0) => {
      box.x0 = Math.min(box.x0, x0); box.y0 = Math.min(box.y0, y0); box.x1 = Math.max(box.x1, x1); box.y1 = Math.max(box.y1, y1);
    };
    for (const frag of mol.fragments()) {
      const part = frag.filter((a) => sel.has(a));
      if (!part.length) continue;
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      for (const a of part) {
        const at = mol.atom(a), lb = dep.labels.get(a)?.bounds;
        if (lb) grow(box, lb.x0, lb.y0, lb.x1, lb.y1); else grow(box, at.x, at.y);
      }
      units.push({ atoms: frag, objects: [], box });
    }
    for (const id of this.selection.objects) {
      const o = this.doc.objects.find((x) => x.id === id);
      if (!o) continue;
      const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
      if (o.kind === 'text') { const b = captionBounds(o, this.doc.style); grow(box, b.x0, b.y0, b.x1, b.y1); }
      else for (const p of objectPolylines(o).flat()) grow(box, p.x, p.y);
      units.push({ atoms: [], objects: [id], box });
    }
    return units;
  }

  #shiftUnits(moves: { u: { atoms: AtomId[]; objects: number[] }; dx: number; dy: number }[]) {
    const moving = new Set(moves.flatMap((m) => m.u.objects));
    moves = moves.map((m) => ({ ...m, u: { ...m.u, objects: [...m.u.objects, ...this.#followers(new Set(m.u.atoms), new Set(m.u.objects)).filter((id) => !moving.has(id))] } }));
    this.doc.edit((mol, objs) => {
      for (const { u, dx, dy } of moves) {
        if (!dx && !dy) continue;
        for (const a of u.atoms) { const at = mol.atom(a); at.x += dx; at.y += dy; }
        for (const o of objs) if (u.objects.includes(o.id)) for (const p of objectPoints(o)) { p.x += dx; p.y += dy; }
      }
    });
  }

  /**
   * Object > Align: line the selected structures and objects up on their
   * left edges, left/right centres, right edges, top edges, top/bottom centres
   * or bottom edges, taking the highest item on the page as the reference (ChemDraw).
   */
  alignSelection(mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'): boolean {
    const units = this.#layoutUnits();
    if (units.length < 2) return false;
    const ref = units.reduce((a, b) => (b.box.y0 < a.box.y0 ? b : a));
    const key = (b: { x0: number; y0: number; x1: number; y1: number }) =>
      mode === 'left' ? b.x0 : mode === 'right' ? b.x1 : mode === 'hcenter' ? (b.x0 + b.x1) / 2
        : mode === 'top' ? b.y0 : mode === 'bottom' ? b.y1 : (b.y0 + b.y1) / 2;
    const target = key(ref.box);
    const horizontal = mode === 'left' || mode === 'right' || mode === 'hcenter';
    this.#shiftUnits(units.map((u) => ({ u, dx: horizontal ? target - key(u.box) : 0, dy: horizontal ? 0 : target - key(u.box) })));
    return true;
  }

  /**
   * Object > Distribute: equal gaps between three or more items, side by side
   * (horizontally) or one above another (vertically); the outermost two stay put.
   */
  distributeSelection(direction: 'horizontal' | 'vertical'): boolean {
    const units = this.#layoutUnits();
    if (units.length < 3) return false;
    const h = direction === 'horizontal';
    const lo = (u: (typeof units)[number]) => (h ? u.box.x0 : u.box.y0), hi = (u: (typeof units)[number]) => (h ? u.box.x1 : u.box.y1);
    const sorted = [...units].sort((a, b) => lo(a) + hi(a) - (lo(b) + hi(b)));
    const span = hi(sorted[sorted.length - 1]!) - lo(sorted[0]!);
    const sizes = sorted.reduce((s, u) => s + (hi(u) - lo(u)), 0);
    const gap = (span - sizes) / (sorted.length - 1);
    let at = lo(sorted[0]!);
    const moves = sorted.map((u) => {
      const d = at - lo(u);
      at += hi(u) - lo(u) + gap;
      return { u, dx: h ? d : 0, dy: h ? 0 : d };
    });
    this.#shiftUnits(moves);
    return true;
  }

  // ------------------------------------------------------ copy, duplicate, place

  /**
   * The selected part of the drawing (all of it when nothing is selected),
   * with the captions attached to it and whole groups. Ids are kept, so
   * analysis links and groups still match.
   */
  selectedDrawing(): Drawing {
    const sel = this.selection, doc = this.doc;
    if (!sel.atoms.size && !sel.objects.size) return { mol: doc.mol, objects: doc.objects, groups: doc.groups };
    const atoms = new Set(sel.atoms);
    const ids = new Set([...sel.objects, ...this.attachedCaptions(atoms, sel.objects)]);
    const objects = doc.objects.filter((o) => ids.has(o.id));
    const mol = doc.mol.clone();
    for (const a of doc.mol.atoms()) if (!atoms.has(a.id)) mol.removeAtom(a.id);
    const groups = doc.groups.filter((g) => { const c = groupContents(doc.groups, g); return c.atoms.some((a) => atoms.has(a)) || c.objects.some((o) => ids.has(o)); });
    return { mol, objects, groups };
  }

  /**
   * Add a copy of `src`, moved by (dx, dy), as one undoable step. Everything
   * gets fresh ids (the same drawing can go in many times), analysis captions
   * and groups follow, and the copy becomes the selection.
   */
  insertDrawing(src: Drawing, dx: number, dy: number): { atoms: AtomId[]; objects: number[] } {
    const added = { atoms: [] as AtomId[], objects: [] as number[] };
    this.doc.edit((mol, objects) => {
      const idMap = new Map<number, number>();
      for (const a of src.mol.atoms()) idMap.set(a.id, mol.addAtom({ ...a, x: a.x + dx, y: a.y + dy, chirality: null }).id);
      for (const b of src.mol.bonds()) mol.addBond({ ...b, begin: idMap.get(b.begin)!, end: idMap.get(b.end)!, ez: null });
      for (const f of src.mol.ringFills) mol.ringFills.push({ atoms: f.atoms.map((a) => idMap.get(a)!), color: f.color });
      const copies = cloneObjects(src.objects);
      const objMap = new Map(copies.map((o) => [o.id, newObjectId()] as const));
      for (const o of copies) {
        o.id = objMap.get(o.id)!;
        for (const q of objectPoints(o)) { q.x += dx; q.y += dy; }
        if (o.kind === 'text' && o.analysis) {
          o.analysis.basis = o.analysis.basis.map((a) => idMap.get(a)).filter((a): a is number => a !== undefined);
          if (o.analysis.source !== undefined) o.analysis.source = objMap.get(o.analysis.source);
        }
        objects.push(o);
      }
      const groupMap = new Map(src.groups.map((g) => [g.id, newObjectId()] as const));
      for (const g of src.groups) {
        this.doc.groups.push({
          id: groupMap.get(g.id)!,
          atoms: g.atoms.map((a) => idMap.get(a)).filter((a): a is number => a !== undefined),
          objects: g.objects.map((o) => objMap.get(o)).filter((o): o is number => o !== undefined),
          groups: g.groups.map((c) => groupMap.get(c)).filter((c): c is number => c !== undefined),
        });
      }
      added.atoms = [...idMap.values()];
      added.objects = [...objMap.values()];
    });
    this.clearSelection();
    const atoms = new Set(added.atoms);
    for (const a of added.atoms) this.selection.atoms.add(a);
    for (const b of this.doc.mol.bonds()) if (atoms.has(b.begin) && atoms.has(b.end)) this.selection.bonds.add(b.id);
    for (const o of added.objects) this.selection.objects.add(o);
    this.#emit();
    return added;
  }

  /** Option+drag (ChemDraw): a copy of the selection lands where the drag ends; the original stays. */
  #duplicateSelection(dx: number, dy: number) {
    if ((!dx && !dy) || (!this.selection.atoms.size && !this.selection.objects.size)) return;
    this.insertDrawing(this.selectedDrawing(), dx, dy);
  }

  /**
   * Option+double-click: pick up a copy of the structure, group or object
   * under the pointer, without touching the original. The copy follows the
   * pointer; a click puts it down (Option+click puts it down and keeps it for
   * more); Escape drops it.
   */
  #stamp: { src: Drawing; x0: number; y0: number; x: number; y: number; ghost?: string } | null = null;
  get placingCopy(): boolean { return this.#stamp !== null; }
  cancelCopy(): void { if (this.#stamp) { this.#stamp = null; this.#emit(); } }

  #pickUpCopy(hit: Hit, x: number, y: number, firstClickEdited?: boolean) {
    // The first click of the pair may have drawn something (bond and ring tools): take it back.
    if (firstClickEdited) this.doc.undo();
    if (hit.kind === 'atom' || hit.kind === 'bond') {
      if (hit.kind === 'atom' ? !this.doc.mol.hasAtom(hit.id) : !this.doc.mol.hasBond(hit.id)) return;
      this.selectStructureAt(hit);
    } else if (hit.kind === 'object') {
      if (!this.doc.objects.some((o) => o.id === hit.id)) return;
      this.clearSelection();
      this.#selectHit(hit, false);
    } else return;
    this.#stamp = { src: cloneDrawing(this.selectedDrawing()), x0: x, y0: y, x, y };
    this.#emit();
  }

  /** A faint picture of `src` for previews (the SVG's contents, in page coordinates). */
  #ghost(src: Drawing): string {
    const svg = toSvg(depict(src.mol, this.doc.style, src.objects), { padding: 0 });
    return svg.replace(/^[\s\S]*?<svg\b[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  }

  /** Select every atom and bond connected to an atom or bond (one whole molecule). */
  selectStructureAt(hit: Hit) {
    const mol = this.doc.mol;
    const seed = hit.kind === 'atom' ? hit.id : hit.kind === 'bond' && mol.hasBond(hit.id) ? mol.bond(hit.id).begin : null;
    if (seed === null || !mol.hasAtom(seed)) return;
    const frag = mol.fragments().find((f) => f.includes(seed)) ?? [];
    const inFrag = new Set(frag);
    this.clearSelection();
    for (const a of frag) this.selection.atoms.add(a);
    for (const b of mol.bonds()) if (inFrag.has(b.begin)) this.selection.bonds.add(b.id);
    this.#selectGroups();
    this.#emit();
  }

  #click(hit: Hit, x: number, y: number) {
    const t = this.tool, L = this.L, chain = this.doc.style.chainAngle;
    switch (t.kind) {
      case 'bond':
        this.doc.edit((mol) => {
          if (hit.kind === 'atom') bondFromAtom(mol, hit.id, L, t.bond, chain);
          else if (hit.kind === 'bond') clickBond(mol, hit.id, t.bond);
          else bondFromPoint(mol, x, y, L, t.bond);
        });
        return;
      case 'ring':
        this.doc.edit((mol) => {
          if (hit.kind === 'atom') ringOnAtom(mol, hit.id, t.size, t.aromatic, L);
          else if (hit.kind === 'bond') ringOnBond(mol, hit.id, t.size, t.aromatic);
          else ringAtPoint(mol, x, y, t.size, t.aromatic, L);
        });
        return;
      case 'chain':
        this.doc.edit((mol) => {
          if (hit.kind === 'atom') bondFromAtom(mol, hit.id, L, 'single', chain);
          else bondFromPoint(mol, x, y, L, 'single');
        });
        return;
      case 'eraser':
        if (hit.kind === 'atom') this.doc.edit((mol) => erase(mol, [hit.id], []));
        else if (hit.kind === 'bond') this.doc.edit((mol) => erase(mol, [], [hit.id]));
        else if (hit.kind === 'object') this.doc.edit((_, objs) => this.#removeObjects(objs, [hit.id]));
        return;
      case 'text': {
        // On an atom: edit its label. On a caption: edit it. Elsewhere: start a new caption (ChemDraw's text tool).
        if (hit.kind === 'atom') { this.onEditLabel?.(hit.id); return; }
        if (hit.kind === 'object' && this.doc.objects.find((o) => o.id === hit.id)?.kind === 'text') { this.onEditCaption?.(hit.id); return; }
        const cap = makeCaption(x, y + this.doc.style.captionSize * 0.35, '');
        this.doc.objects.push(cap);
        this.onEditCaption?.(cap.id);
        return;
      }
      case 'arrow': case 'shape':
        // A click draws a default-sized object (an arrow pointing right).
        this.#commitObject(x, y, x, y);
        return;
      case 'select':
        return;
    }
  }

  /** End point of a bond being dragged: an atom under the pointer, else fixed length at a 15 degree step. */
  #dragEnd(from: Hit, x0: number, y0: number, x: number, y: number) {
    const mol = this.doc.mol;
    const start = from.kind === 'atom' ? mol.atom(from.id) : { x: x0, y: y0 };
    const target = this.hit(x, y);
    if (target.kind === 'atom' && !(from.kind === 'atom' && target.id === from.id)) {
      const a = mol.atom(target.id);
      return { start, end: { x: a.x, y: a.y }, atom: target.id as AtomId | null };
    }
    const raw = Math.atan2(y - start.y, x - start.x);
    const angle = this.fixedAngles ? snapAngle(raw) : raw;
    const len = this.fixedLengths ? this.L : Math.max(this.L * 0.25, Math.hypot(x - start.x, y - start.y));
    return { start, end: { x: start.x + len * Math.cos(angle), y: start.y + len * Math.sin(angle) }, atom: null };
  }

  #commitBondDrag(g: Extract<Gesture, { kind: 'bondDrag' }>) {
    const t = this.tool;
    if (t.kind !== 'bond') return;
    const { start, end, atom } = this.#dragEnd(g.from, g.x0, g.y0, g.x, g.y);
    this.doc.edit((mol) => {
      const a = g.from.kind === 'atom' ? g.from.id : atomNear(mol, start.x, start.y, this.L * 0.25) ?? mol.addAtom({ element: 'C', x: start.x, y: start.y }).id;
      const b = atom ?? atomNear(mol, end.x, end.y, this.L * 0.25, a) ?? mol.addAtom({ element: 'C', x: end.x, y: end.y }).id;
      const existing = mol.bondBetween(a, b);
      if (existing) clickBond(mol, existing.id, t.bond);
      else mol.addBond({ begin: a, end: b, ...bondProps(t.bond) });
    });
  }

  /** Acyclic chain tool: a zigzag whose length follows the drag, in fixed-angle steps. */
  #commitChain(g: Extract<Gesture, { kind: 'chainDrag' }>) {
    const pts = this.#chainPoints(g);
    if (pts.length < 2) return;
    this.doc.edit((mol) => {
      let prev = g.from.kind === 'atom' ? g.from.id : mol.addAtom({ element: 'C', x: pts[0]!.x, y: pts[0]!.y }).id;
      for (const p of pts.slice(1)) {
        const next = atomNear(mol, p.x, p.y, this.L * 0.25, prev) ?? mol.addAtom({ element: 'C', x: p.x, y: p.y }).id;
        if (!mol.bondBetween(prev, next)) mol.addBond({ begin: prev, end: next });
        prev = next;
      }
    });
  }

  #chainPoints(g: { from: Hit; x0: number; y0: number; x: number; y: number }) {
    const mol = this.doc.mol;
    const s = g.from.kind === 'atom' ? mol.atom(g.from.id) : { x: g.x0, y: g.y0 };
    const dir = snapAngle(Math.atan2(g.y - s.y, g.x - s.x));
    const half = ((180 - this.doc.style.chainAngle) / 2) * (Math.PI / 180);
    const step = this.L * Math.cos(half);
    const n = Math.max(1, Math.round(Math.hypot(g.x - s.x, g.y - s.y) / step));
    const pts = [{ x: s.x, y: s.y }];
    for (let i = 1; i <= n; i++) {
      const a = dir + (i % 2 ? -half : half);
      const p = pts[i - 1]!;
      pts.push({ x: p.x + this.L * Math.cos(a), y: p.y + this.L * Math.sin(a) });
    }
    return pts;
  }

  #commitMove(dx: number, dy: number) {
    if (!dx && !dy) return;
    const atoms = new Set(this.selection.atoms);
    for (const b of this.selection.bonds) { const bd = this.doc.mol.bond(b); atoms.add(bd.begin); atoms.add(bd.end); }
    const objs = new Set([...this.selection.objects, ...this.#followers(atoms, this.selection.objects)]);
    this.doc.edit((mol, objects) => {
      for (const a of atoms) { const at = mol.atom(a); at.x += dx; at.y += dy; }
      for (const o of objects) {
        if (!objs.has(o.id)) continue;
        for (const p of objectPoints(o)) { p.x += dx; p.y += dy; }
      }
    });
  }

  /** Arrow or drawing element from a drag with the current tool. */
  #commitObject(x0: number, y0: number, x: number, y: number) {
    const t = this.tool;
    if (t.kind !== 'arrow' && t.kind !== 'shape') return;
    if (t.kind === 'arrow' && t.curly) {
      // Electron pushing: start at the atom's lone pair or the bond's middle, end at the target.
      const from = this.#pushEnd(x0, y0), to = this.#pushEnd(x, y);
      const o = objectFromDrag(t, from.x, from.y, to.x, to.y, this.L, this.fixedAngles);
      if (o.kind === 'arrow') {
        const L = this.L;
        const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
        const nx = dy / len, ny = -dx / len; // bow side: left of travel
        // Tail: above an atom (its lone pair) or just off a bond on the bowing side.
        if (from.atom) o.tail = { x: from.x + nx * 0.35 * L, y: from.y + ny * 0.35 * L };
        else if (from.bond) o.tail = { x: from.x + nx * 0.2 * L, y: from.y + ny * 0.2 * L };
        // Head: short of a labelled atom, on the same side, so it points at the label rather than into it.
        if (to.labelled) {
          const ux = to.x - o.tail.x, uy = to.y - o.tail.y, ul = Math.hypot(ux, uy) || 1;
          o.head = { x: to.x - (ux / ul) * 0.2 * L + nx * 0.42 * L, y: to.y - (uy / ul) * 0.2 * L + ny * 0.42 * L };
        }
        // Short hops (a pi bond onto its own atom) still get a clear curl: at least half a bond length of bow.
        const chord = Math.hypot(o.head.x - o.tail.x, o.head.y - o.tail.y) || 1;
        rebowCurve(o, Math.max(0.45, (0.5 * L) / chord));
      }
      this.doc.edit((_, objects) => { objects.push(o); });
      return;
    }
    const o = objectFromDrag(t, x0, y0, x, y, this.L, this.fixedAngles);
    this.doc.edit((_, objects) => { objects.push(o); });
  }

  /** Where an electron-pushing arrow attaches near a point: an atom, a bond's midpoint, or the point itself. */
  #pushEnd(x: number, y: number): { x: number; y: number; atom?: boolean; bond?: boolean; labelled?: boolean } {
    const h = hitTest(this.doc.mol, this.depiction, x, y, this.L);
    const mol = this.doc.mol;
    if (h.kind === 'atom') { const a = mol.atom(h.id); return { x: a.x, y: a.y, atom: true, labelled: this.depiction.labels.has(h.id) }; }
    if (h.kind === 'bond') { const b = mol.bond(h.id), p = mol.atom(b.begin), q = mol.atom(b.end); return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, bond: true }; }
    return { x, y };
  }

  /** The handle of an arrow or drawing element under the pointer: hovered or selected objects first. */
  #handleUnder(x: number, y: number): { id: number; handle: HandleName } | null {
    const tol = 3 + this.doc.style.lineWidth;
    const ids = [...(this.hover.kind === 'object' ? [this.hover.id] : []), ...this.selection.objects];
    const order = [...ids.map((id) => this.doc.objects.find((o) => o.id === id)).filter((o): o is DocObject => !!o), ...[...this.doc.objects].reverse()];
    for (const o of order) {
      const h = handleAt(o, { x, y }, tol);
      if (h) return { id: o.id, handle: h };
    }
    return null;
  }

  /** Change one arrow, caption or drawing element as an undoable step (context-menu commands). */
  updateObject(id: number, fn: (o: DocObject) => void) {
    this.doc.edit((_, objs) => { const o = objs.find((x) => x.id === id); if (o) fn(o); });
  }

  // ------------------------------------------------------------------ colour

  /** Atoms, bonds and objects a colour command applies to: the selection. */
  #colorTargets() {
    const atoms = new Set(this.selection.atoms), bonds = new Set(this.selection.bonds);
    // A selected atom pair implies the bond between them (marquee selections include both anyway).
    for (const b of this.doc.mol.bonds()) if (atoms.has(b.begin) && atoms.has(b.end)) bonds.add(b.id);
    return { atoms, bonds, objects: new Set(this.selection.objects) };
  }

  /** Colors menu: colour the selected atoms (labels), bonds and objects; null returns them to the foreground colour. */
  applyColor(color: string | null) {
    const { atoms, bonds, objects } = this.#colorTargets();
    if (!atoms.size && !bonds.size && !objects.size) return false;
    this.doc.edit((mol, objs) => {
      for (const a of atoms) mol.atom(a).color = color;
      for (const b of bonds) mol.bond(b).color = color;
      for (const o of objs) if (objects.has(o.id)) o.color = color;
    });
    return true;
  }

  /** Colors > By Element: label colours from the periodic table (carbon and hydrogen stay foreground). */
  colorByElement() {
    const { atoms } = this.#colorTargets();
    const ids = atoms.size ? atoms : new Set([...this.doc.mol.atoms()].map((a) => a.id));
    this.doc.edit((mol) => {
      for (const id of ids) {
        const a = mol.atom(id);
        a.color = a.label !== null ? null : ELEMENT_COLORS[a.element] ?? null;
      }
    });
  }

  /** Colors > Highlight Colors: a band behind the selected bonds and atoms; null removes it. */
  applyHighlight(color: string | null) {
    const { atoms, bonds } = this.#colorTargets();
    if (!atoms.size && !bonds.size) return false;
    this.doc.edit((mol) => {
      for (const a of atoms) mol.atom(a).highlight = color;
      for (const b of bonds) mol.bond(b).highlight = color;
    });
    return true;
  }

  /** Colors > Ring Fill Colors: fill every ring wholly inside the selection; null removes the fill. */
  applyRingFill(color: string | null) {
    const { atoms } = this.#colorTargets();
    const rings = perceiveRings(this.doc.mol).filter((r) => r.atoms.every((a) => atoms.has(a)));
    if (!rings.length) return false;
    const key = (ids: number[]) => [...ids].sort((x, y) => x - y).join(',');
    this.doc.edit((mol) => {
      const keys = new Set(rings.map((r) => key(r.atoms)));
      mol.ringFills = mol.ringFills.filter((f) => !keys.has(key(f.atoms)));
      if (color) for (const r of rings) mol.ringFills.push({ atoms: [...r.atoms], color });
    });
    return true;
  }

  #removeObjects(objects: import('@hexsketch/core').DocObject[], ids: Iterable<number>) {
    const drop = new Set(ids);
    for (let i = objects.length - 1; i >= 0; i--) if (drop.has(objects[i]!.id)) objects.splice(i, 1);
  }

  #objectsInLasso(poly: { x: number; y: number }[]): Set<number> {
    const inside = (x: number, y: number) => {
      let c = false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const a = poly[i]!, b = poly[j]!;
        if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
      }
      return c;
    };
    const out = new Set<number>();
    for (const o of this.doc.objects) {
      const pts = objectPoints(o);
      if (pts.every((p) => inside(p.x, p.y))) out.add(o.id);
    }
    return out;
  }

  /** Commit caption text; empty text removes the caption. */
  setCaption(id: number, text: string) {
    this.setCaptionRich(id, [{ text }]);
  }

  /** Commit an edited caption: styled runs and alignment. Empty text removes it (with no undo step if it was new). */
  setCaptionRich(id: number, runs: TextRun[], align?: Caption['align']) {
    const current = this.doc.objects.find((o) => o.id === id);
    if (!current || current.kind !== 'text') return;
    const text = runs.map((r) => r.text).join('');
    if (!text.trim()) {
      // A caption that was never filled in leaves no undo step behind.
      this.doc.objects = this.doc.objects.filter((o) => o.id !== id);
      this.#dep = null; this.#emit();
      return;
    }
    const apply = (o: Caption) => { setCaptionRuns(o, runs); if (align) o.align = align; };
    if (current.text === '') {
      // A brand-new caption: take it out before the undo snapshot, then add it
      // back with its text inside the step, so one undo removes it entirely.
      this.doc.objects = this.doc.objects.filter((o) => o.id !== id);
      this.doc.edit((_, objects) => { const c = { ...current }; apply(c); objects.push(c); });
      return;
    }
    this.doc.edit((_, objects) => { const o = objects.find((x) => x.id === id); if (o?.kind === 'text') apply(o); });
  }

  /**
   * Style whole captions (the selected ones, or `ids`): toggles for bold,
   * italic and underline (on if any run lacks it), scripts likewise, and
   * size, colour and alignment set outright.
   */
  styleCaptions(patch: Partial<TextStyle> & { align?: Caption['align'] }, ids?: number[]): boolean {
    const targets = (ids ?? [...this.selection.objects]).map((id) => this.doc.objects.find((o) => o.id === id))
      .filter((o): o is Caption => o?.kind === 'text');
    if (!targets.length) return false;
    this.doc.edit((_, objects) => {
      for (const t of targets) {
        const o = objects.find((x) => x.id === t.id) as Caption | undefined;
        if (!o) continue;
        const { align, ...style } = patch;
        if (align) o.align = align;
        setCaptionRuns(o, restyle(captionRuns(o), style));
      }
    });
    return true;
  }

  // -------------------------------------------------------------- selection

  #selectHit(hit: Hit, add: boolean) {
    if (!add) this.clearSelection();
    if (hit.kind === 'object') this.selection.objects.add(hit.id);
    if (hit.kind === 'atom') this.selection.atoms.add(hit.id);
    if (hit.kind === 'bond') {
      this.selection.bonds.add(hit.id);
      const b = this.doc.mol.bond(hit.id);
      this.selection.atoms.add(b.begin); this.selection.atoms.add(b.end);
    }
    this.#selectGroups();
  }

  #setSelection(s: { atoms: Set<AtomId>; bonds: Set<BondId>; objects: Set<number> }, add: boolean) {
    if (!add) this.clearSelection();
    for (const a of s.atoms) this.selection.atoms.add(a);
    for (const b of s.bonds) this.selection.bonds.add(b);
    for (const o of s.objects) this.selection.objects.add(o);
    this.#selectGroups();
  }

  clearSelection() { this.selection.atoms.clear(); this.selection.bonds.clear(); this.selection.objects.clear(); }

  selectAll() {
    this.clearSelection();
    for (const a of this.doc.mol.atoms()) this.selection.atoms.add(a.id);
    for (const b of this.doc.mol.bonds()) this.selection.bonds.add(b.id);
    for (const o of this.doc.objects) this.selection.objects.add(o.id);
    this.#emit();
  }

  deleteSelection() {
    if (!this.selection.atoms.size && !this.selection.bonds.size && !this.selection.objects.size) return;
    const atoms = [...this.selection.atoms], bonds = [...this.selection.bonds], objs = [...this.selection.objects];
    this.clearSelection();
    this.doc.edit((mol, objects) => { erase(mol, atoms, bonds); this.#removeObjects(objects, objs); });
  }

  // --------------------------------------------------------------- keyboard

  /**
   * A key press, resolved like ChemDraw: against the hovered atom or bond,
   * else as a tool switch. Returns true if the key was consumed.
   */
  key(key: string, mods: { meta?: boolean; ctrl?: boolean; shift?: boolean; alt?: boolean } = {}): boolean {
    const cmd = mods.meta || mods.ctrl;
    // Rotation and nudging (ChemDraw: Option+Up/Down 15 degrees, Option+Left/Right 1 degree).
    if (key.startsWith('Arrow') && !cmd) {
      if (!mods.alt && this.#liveHotspot() !== null && !this.#hasSelection() && !this.selection.bonds.size) { this.#walkHotspot(key); return true; }
      if (mods.alt) {
        const step = key === 'ArrowUp' ? -15 : key === 'ArrowDown' ? 15 : key === 'ArrowLeft' ? -1 : 1;
        this.rotateSelection(step);
      } else {
        const d = mods.shift ? 10 : 1;
        const [dx, dy] = key === 'ArrowUp' ? [0, -d] : key === 'ArrowDown' ? [0, d] : key === 'ArrowLeft' ? [-d, 0] : [d, 0];
        if (!this.#hasSelection()) return false;
        this.#commitMove(dx, dy);
      }
      return true;
    }
    if (cmd) {
      if ((key === 'h' || key === 'H') && mods.shift) { this.rotate180('horizontal'); return true; }
      if ((key === 'v' || key === 'V') && mods.shift) { this.rotate180('vertical'); return true; }
      if (key === 'l' && !mods.shift) { this.fixedLengths = !this.fixedLengths; this.#emit(); return true; }
      if (key === 'e' && !mods.shift) { this.fixedAngles = !this.fixedAngles; this.#emit(); return true; }
      if ((key === 'n' || key === 'N' || key === 'Dead') && mods.alt) { this.nameToCaption(); return true; }
      if (key === 'z' && !mods.shift) { this.doc.undo(); return true; }
      if ((key === 'z' && mods.shift) || key === 'Z' || key === 'y') { this.doc.redo(); return true; }
      if (key === 'a') { this.selectAll(); return true; }
      if ((key === 'k' || key === 'K') && mods.shift) { this.cleanUp(); return true; }
      // Object > Group (Cmd+G) and Ungroup (Shift+Cmd+G), as in ChemDraw.
      if (key === 'g' || key === 'G') { if (mods.shift) this.ungroupSelection(); else this.groupSelection(); return true; }
      return false;
    }
    if (key === 'Delete' || key === 'Backspace') {
      if (this.selection.atoms.size || this.selection.bonds.size || this.selection.objects.size) { this.deleteSelection(); return true; }
      const h = this.hover;
      if (h.kind === 'object') { this.doc.edit((_, objs) => this.#removeObjects(objs, [h.id])); this.hover = { kind: 'none' }; return true; }
      if (h.kind === 'atom') { this.doc.edit((mol) => erase(mol, [h.id], [])); this.hover = { kind: 'none' }; return true; }
      if (h.kind === 'bond') { this.doc.edit((mol) => erase(mol, [], [h.id])); this.hover = { kind: 'none' }; return true; }
      return false;
    }
    if (key === 'Escape' && this.#stamp) { this.#stamp = null; this.#emit(); return true; }
    if (key === 'Escape') { this.clearSelection(); this.hotspot = null; this.#gesture = { kind: 'idle' }; this.#emit(); return true; }

    const hovered = this.hover.kind === 'atom' && this.doc.mol.hasAtom(this.hover.id) ? this.hover
      : this.hover.kind === 'bond' && this.doc.mol.hasBond(this.hover.id) ? this.hover : { kind: 'none' as const };
    const spot = this.#liveHotspot();
    if (hovered.kind === 'none') {
      // Molecule to hotspot (Enter on a selection) and back (Space).
      if (key === 'Enter' && spot === null && this.selection.atoms.size) {
        this.hotspot = { kind: 'atom', id: Math.max(...[...this.selection.atoms].filter((a) => this.doc.mol.hasAtom(a))) };
        this.clearSelection();
        return true;
      }
      if (key === ' ' && spot !== null) {
        const mol = this.doc.mol;
        const seed = spot.kind === 'atom' ? spot.id : mol.bond(spot.id).begin;
        const frag = mol.fragments().find((f) => f.includes(seed)) ?? [];
        this.hotspot = null;
        this.#setSelection({ atoms: new Set(frag), bonds: new Set([...mol.bonds()].filter((b) => frag.includes(b.begin)).map((b) => b.id)), objects: new Set() }, false);
        return true;
      }
    }
    // Off the molecule, keys go to the hotspot and move it on; over it, the hotspot stays.
    const viaSpot = hovered.kind === 'none' && spot !== null
      && (spot.kind === 'atom' ? !!ATOM_HOTKEYS[key] || key === 'Enter' : !!BOND_HOTKEYS[key]);
    const target = viaSpot ? spot! : hovered;
    const r = resolveHotkey(key, target);
    if (!r) return false;
    if (r.target === 'atom' && target.kind === 'atom') {
      const id = target.id;
      if (r.action.kind === 'editLabel') { this.onEditLabel?.(id); return true; }
      const action = r.action;
      let next: AtomId = id;
      this.doc.edit((mol) => { next = applyAtomAction(mol, id, action, this.L, this.doc.style.chainAngle); });
      if (viaSpot) this.hotspot = { kind: 'atom', id: next };
      this.#emit();
      return true;
    }
    if (r.target === 'bond' && target.kind === 'bond') {
      const id = target.id, action = r.action;
      let next: BondId = id;
      this.doc.edit((mol) => { next = applyBondAction(mol, id, action); });
      if (viaSpot) this.hotspot = { kind: 'bond', id: next };
      this.#emit();
      return true;
    }
    if (r.target === 'generic') {
      if (r.action.kind === 'tool') { this.setTool(toolFor(r.action.tool, this.tool)); return true; }
      return false;
    }
    return false;
  }

  #liveHotspot() {
    const h = this.hotspot, mol = this.doc.mol;
    if (h && !(h.kind === 'atom' ? mol.hasAtom(h.id) : mol.hasBond(h.id))) this.hotspot = null;
    return this.hotspot;
  }

  /**
   * Arrow keys step the hotspot from an atom to one of its bonds, or from a
   * bond to one of its ends: whichever lies most nearly in the arrow's
   * direction. It always moves, even when nothing points that way (measured:
   * Down on a methyl climbs back up its bond).
   */
  #walkHotspot(key: string) {
    const mol = this.doc.mol, h = this.hotspot!;
    const want = key === 'ArrowUp' ? -Math.PI / 2 : key === 'ArrowDown' ? Math.PI / 2 : key === 'ArrowLeft' ? Math.PI : 0;
    const off = (from: { x: number; y: number }, to: { x: number; y: number }) => {
      const a = Math.atan2(to.y - from.y, to.x - from.x);
      return Math.abs(Math.atan2(Math.sin(a - want), Math.cos(a - want)));
    };
    if (h.kind === 'atom') {
      const at = mol.atom(h.id);
      let best: BondId | null = null, bestOff = Infinity;
      for (const b of mol.incidentBonds(h.id)) {
        const o = off(at, mol.atom(mol.otherAtom(mol.bond(b), h.id)));
        if (o < bestOff - 1e-6) { bestOff = o; best = b; }
      }
      if (best !== null) this.hotspot = { kind: 'bond', id: best };
    } else {
      const b = mol.bond(h.id), p = mol.atom(b.begin), q = mol.atom(b.end);
      const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
      this.hotspot = { kind: 'atom', id: off(mid, q) < off(mid, p) - 1e-6 ? b.end : b.begin };
    }
    this.#emit();
  }

  /**
   * Structure > Clean Up Structure (Shift+Cmd+K): fix bond lengths, angles and
   * ring shapes of the selected fragments (or everything) while keeping their
   * position, orientation and stereochemistry (see core/cleanup.ts).
   */
  cleanUp() {
    const mol = this.doc.mol;
    if (!mol.atomCount) return;
    const chosen = this.selection.atoms.size ? [...this.selection.atoms] : undefined;
    this.doc.edit((m) => cleanUpStructure(m, this.L, chosen));
  }

  /** Insert a structure (pasted SMILES or file) laid out fresh, beside what is already drawn. */
  insertLaidOut(input: Molecule, at?: { x: number; y: number }) {
    const fresh = input.clone();
    // A peptide is drawn as Expand Label draws it: a backbone zigzag rather than a folded chain.
    if (fresh.fragments().length !== 1 || !layoutAsPeptide(fresh, this.L)) layout2D(fresh, this.L);
    this.doc.edit((m) => {
      const xs = [...fresh.atoms()].map((a) => a.x), ys = [...fresh.atoms()].map((a) => a.y);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      // Centre on the requested point (the middle of the view, as ChemDraw pastes), but keep
      // a long structure on the page: the canvas cannot scroll above or left of it.
      const target = at ?? { x: 300, y: 300 };
      let dx = Math.max(target.x - cx, 2 * this.L - Math.min(...xs));
      const dy = Math.max(target.y - cy, 2 * this.L - Math.min(...ys));
      // Don't land on top of an existing drawing: slide right until clear.
      const width = Math.max(...xs) - Math.min(...xs);
      const clashes = () => [...fresh.atoms()].some((a) => [...m.atoms()].some((b) => Math.hypot(a.x + dx - b.x, a.y + dy - b.y) < this.L));
      for (let i = 0; i < 20 && clashes(); i++) dx += width + 2 * this.L;
      const idMap = new Map<AtomId, AtomId>();
      for (const a of fresh.atoms()) idMap.set(a.id, m.addAtom({ ...a, x: a.x + dx, y: a.y + dy, chirality: null }).id);
      for (const b of fresh.bonds()) m.addBond({ ...b, begin: idMap.get(b.begin)!, end: idMap.get(b.end)!, ez: null });
    });
  }

  #hasSelection() { return this.selection.atoms.size > 0 || this.selection.objects.size > 0; }

  /** Atoms (with bonds' ends) and objects to transform: the selection, or everything. */
  #targets() {
    const sel = this.#hasSelection() || this.selection.bonds.size > 0;
    const atoms = new Set(sel ? this.selection.atoms : [...this.doc.mol.atoms()].map((a) => a.id));
    if (sel) for (const b of this.selection.bonds) { const bd = this.doc.mol.bond(b); atoms.add(bd.begin); atoms.add(bd.end); }
    const objects = new Set(sel ? this.selection.objects : this.doc.objects.map((o) => o.id));
    return { atoms, objects };
  }

  /** Apply a point transform about the targets' centre. */
  #transform(fn: (x: number, y: number, cx: number, cy: number) => [number, number], swapWedges: boolean) {
    const { atoms, objects } = this.#targets();
    const pts: { x: number; y: number }[] = [];
    for (const a of atoms) pts.push(this.doc.mol.atom(a));
    for (const o of this.doc.objects) if (objects.has(o.id)) pts.push(...objectPoints(o));
    if (!pts.length) return;
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const [ox, oy] = fn(cx, cy, cx, cy), [ux, uy] = fn(cx + 1, cy, cx, cy), [vx, vy] = fn(cx, cy + 1, cx, cy);
    const mirrors = (ux - ox) * (vy - oy) - (uy - oy) * (vx - ox) < 0;
    this.doc.edit((mol, objs) => {
      for (const a of atoms) { const at = mol.atom(a); [at.x, at.y] = fn(at.x, at.y, cx, cy); }
      for (const o of objs) {
        if (!objects.has(o.id)) continue;
        for (const p of objectPoints(o)) [p.x, p.y] = fn(p.x, p.y, cx, cy);
        // A mirror image of an arc runs the other way round.
        if (o.kind === 'arrow' && o.arc && mirrors) o.arc.angle = -o.arc.angle;
      }
      if (swapWedges) for (const b of mol.bonds()) {
        if (!atoms.has(b.begin) || !atoms.has(b.end)) continue;
        const swap: Record<string, typeof b.display> = { wedgeBegin: 'hashBegin', hashBegin: 'wedgeBegin', wedgeEnd: 'hashEnd', hashEnd: 'wedgeEnd' };
        if (swap[b.display]) b.display = swap[b.display]!;
      }
    });
  }

  /** Rotate the selection (or everything); positive degrees turn clockwise on screen. */
  rotateSelection(degrees: number) {
    const t = (degrees * Math.PI) / 180, c = Math.cos(t), s = Math.sin(t);
    this.#transform((x, y, cx, cy) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c], false);
  }

  /**
   * Object > Rotate 180 degrees Horizontal / Vertical: a turn in 3D, so the
   * drawing mirrors but wedges become hashes and stereochemistry is kept.
   */
  rotate180(axis: 'horizontal' | 'vertical') {
    this.#transform((x, y, cx, cy) => (axis === 'horizontal' ? [2 * cx - x, y] : [x, 2 * cy - y]), true);
  }

  /** Object > Flip Horizontal / Vertical: a true mirror image (stereochemistry inverts). */
  flip(axis: 'horizontal' | 'vertical') {
    this.#transform((x, y, cx, cy) => (axis === 'horizontal' ? [2 * cx - x, y] : [x, 2 * cy - y]), false);
  }

  /** Name provider, set by the host (keeps the editor free of the naming package). */
  nameOf: ((mol: Molecule) => string | null) | null = null;

  /**
   * Structure > Convert Structure to Name (Option+Cmd+N): the name of each
   * selected (or every) structure, centred underneath it with the rest of its
   * analysis lines.
   */
  nameToCaption(): boolean {
    const t = this.analysisTargets(true);
    return this.#setAnalysis(t, (items) => [...items, 'name']);
  }

  // ---------------------------------------------------------------- analysis

  /** Decimal places for masses in analysis lines (ChemDraw's Analysis window "Decimals"). */
  analysisDecimals = 4;

  /**
   * What the Analysis menu describes: each structure touched by the
   * selection, else the one under the pointer (or, with `all`, every
   * structure), plus selected captions that read as peptides.
   */
  analysisTargets(all = false): { fragments: AtomId[][]; captions: number[] } {
    const mol = this.doc.mol;
    const frags = mol.fragments();
    let seeds = new Set<AtomId>([...this.selection.atoms]);
    for (const b of this.selection.bonds) if (mol.hasBond(b)) seeds.add(mol.bond(b).begin);
    const captions = [...this.selection.objects].filter((id) => this.#peptideCaption(id));
    if (!seeds.size && !captions.length) {
      const h = this.hover;
      if (h.kind === 'atom' && mol.hasAtom(h.id)) seeds.add(h.id);
      else if (h.kind === 'bond' && mol.hasBond(h.id)) seeds.add(mol.bond(h.id).begin);
      else if (h.kind === 'object' && this.#peptideCaption(h.id)) captions.push(h.id);
      else if (all) seeds = new Set(frags.flat());
    }
    return { fragments: frags.filter((f) => f.some((a) => seeds.has(a))), captions };
  }

  /** Analysis items already shown for every target (the menu's check marks). */
  analysisShown(): Set<AnalysisItem> {
    const t = this.analysisTargets();
    const linked = [...t.fragments.map((f) => this.#linkedCaption(f)), ...t.captions.map((id) => this.#linkedCaption(null, id))];
    if (!linked.length || linked.some((c) => !c)) return new Set();
    return new Set(ANALYSIS_ITEMS.map((x) => x.item).filter((i) => linked.every((c) => c!.analysis!.items.includes(i))));
  }

  /**
   * Right-click > Analysis: show or hide one line (or, with 'all', every
   * line) of the targets' analysis caption, as ChemDraw's check-mark menu does.
   * Returns false when there is nothing to analyse.
   */
  toggleAnalysis(item: AnalysisItem | 'all'): boolean {
    const t = this.analysisTargets();
    const shown = this.analysisShown();
    const on = item === 'all' || !shown.has(item);
    return this.#setAnalysis(t, (items) => (item === 'all' ? ANALYSIS_ITEMS.map((x) => x.item) : on ? [...items, item] : items.filter((i) => i !== item)));
  }

  #setAnalysis(t: { fragments: AtomId[][]; captions: number[] }, change: (items: AnalysisItem[]) => AnalysisItem[]): boolean {
    if (!t.fragments.length && !t.captions.length) return false;
    const targets = [...t.fragments.map((f) => ({ frag: f, source: undefined as number | undefined })), ...t.captions.map((id) => ({ frag: null, source: id }))];
    const plans = targets.map(({ frag, source }) => {
      const existing = this.#linkedCaption(frag, source);
      const items = sortAnalysisItems(change(existing?.analysis?.items ?? []));
      return { frag, source, existing, items, at: existing ? null : this.#analysisAnchor(frag, source) };
    });
    this.doc.edit((_, objects) => {
      for (const p of plans) {
        if (p.existing) {
          const c = objects.find((o) => o.id === p.existing!.id);
          if (!c || c.kind !== 'text') continue;
          if (!p.items.length) objects.splice(objects.indexOf(c), 1);
          else c.analysis = { ...c.analysis!, items: p.items };
        } else if (p.items.length) {
          const c = makeCaption(p.at!.x, p.at!.y, '', undefined, 'center');
          c.analysis = { items: p.items, basis: p.frag ? [...p.frag] : [], ...(p.source !== undefined ? { source: p.source } : {}) };
          objects.push(c);
        }
      }
    });
    return true;
  }

  /** The analysis caption already linked to a structure (or to a peptide caption). */
  #linkedCaption(frag: AtomId[] | null, source?: number): Caption | null {
    const inFrag = new Set(frag ?? []);
    for (const o of this.doc.objects) {
      if (o.kind !== 'text' || !o.analysis) continue;
      if (source !== undefined ? o.analysis.source === source : o.analysis.source === undefined && o.analysis.basis.some((a) => inFrag.has(a))) return o;
    }
    return null;
  }

  /** Where a new analysis caption goes: centred under the structure, first baseline 1.5 caption heights below it (ChemDraw). */
  #analysisAnchor(frag: AtomId[] | null, source?: number): { x: number; y: number } {
    const size = this.doc.style.captionSize;
    if (frag) {
      const mol = this.doc.mol, dep = this.depiction;
      let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of frag) {
        const a = mol.atom(id), lb = dep.labels.get(id)?.bounds;
        x0 = Math.min(x0, lb?.x0 ?? a.x); x1 = Math.max(x1, lb?.x1 ?? a.x); y1 = Math.max(y1, lb?.y1 ?? a.y);
      }
      return { x: (x0 + x1) / 2, y: y1 + size * 1.5 };
    }
    const c = this.doc.objects.find((o): o is Caption => o.id === source && o.kind === 'text')!;
    const b = captionBounds(c, this.doc.style);
    return { x: (b.x0 + b.x1) / 2, y: b.y1 + size * 1.25 };
  }

  #peptideCaption(id: number): Molecule | null {
    const c = this.doc.objects.find((o) => o.id === id);
    if (!c || c.kind !== 'text' || c.analysis) return null;
    const key = c.text.trim();
    if (!this.#peptideCache.has(key)) {
      const p = parsePeptide(key);
      this.#peptideCache.set(key, p ? parseSmiles(peptideSmiles(p)) : null);
    }
    return this.#peptideCache.get(key)!;
  }

  /** A structure's atoms as a molecule of their own. */
  #subMolecule(atoms: Iterable<AtomId>): Molecule {
    const mol = this.doc.mol, keep = new Set(atoms), sub = mol.clone();
    for (const a of mol.atoms()) if (!keep.has(a.id)) sub.removeAtom(a.id);
    return sub;
  }

  #analysisCache = new Map<string, TextRun[] | null>();
  /**
   * Keep linked analysis captions true to their structures: a structure that
   * grows or changes gets new lines, one that is deleted takes its caption
   * with it. Runs on every change (undo snapshots already hold the matching text).
   */
  #refreshAnalysis() {
    const objects = this.doc.objects;
    if (!objects.some((o) => o.kind === 'text' && o.analysis)) return;
    const mol = this.doc.mol;
    let frags: AtomId[][] | null = null;
    for (let i = objects.length - 1; i >= 0; i--) {
      const c = objects[i]!;
      if (c.kind !== 'text' || !c.analysis) continue;
      let sub: Molecule | null;
      if (c.analysis.source !== undefined) {
        sub = this.#peptideCaption(c.analysis.source);
      } else {
        frags ??= mol.fragments();
        const alive = new Set(c.analysis.basis.filter((a) => mol.hasAtom(a)));
        const basis = frags.filter((f) => f.some((a) => alive.has(a))).flat();
        if (basis.length !== c.analysis.basis.length || basis.some((a, k) => a !== c.analysis!.basis[k])) c.analysis.basis = basis;
        sub = basis.length ? this.#subMolecule(basis) : null;
      }
      if (!sub) { objects.splice(i, 1); continue; }
      const key = `${writeSmiles(sub)}|${sub.atomCount}|${c.analysis.items.join(',')}|${this.analysisDecimals}`;
      if (!this.#analysisCache.has(key)) {
        const name = c.analysis.items.includes('name') ? this.nameOf?.(sub) ?? null : null;
        this.#analysisCache.set(key, analysisRuns(sub, c.analysis.items, { name, decimals: this.analysisDecimals }));
      }
      const runs = this.#analysisCache.get(key)!;
      if (!runs) { if (!c.text) objects.splice(i, 1); continue; }
      const next = makeCaption(0, 0, '', runs);
      if (next.text !== c.text || JSON.stringify(captionRuns(next)) !== JSON.stringify(captionRuns(c))) setCaptionRuns(c, runs);
      // A long name (a peptide's) centred under its structure can reach past the left edge
      // of the page, where the canvas cannot scroll: keep it on the page.
      const b = captionBounds(c, this.doc.style);
      if (b.x0 < 0) c.x += this.L - b.x0;
    }
  }

  // ------------------------------------------------------------------ groups

  /** The structures (whole fragments) and objects a group holds, inner groups included. */
  #groupMembers(g: ObjectGroup, frags = this.doc.mol.fragments()): { atoms: AtomId[]; objects: number[] } {
    const c = groupContents(this.doc.groups, g);
    const seeds = new Set(c.atoms);
    const live = new Set(this.doc.objects.map((o) => o.id));
    return { atoms: frags.filter((f) => f.some((a) => seeds.has(a))).flat(), objects: c.objects.filter((id) => live.has(id)) };
  }

  /** Outermost groups touched by the selection. */
  #selectedGroups(): ObjectGroup[] {
    const sel = this.selection;
    const frags = this.doc.mol.fragments();
    return topGroups(this.doc.groups).filter((g) => {
      const m = this.#groupMembers(g, frags);
      return m.atoms.some((a) => sel.atoms.has(a)) || m.objects.some((o) => sel.objects.has(o));
    });
  }

  /** Selecting any part of a group selects all of it, inner groups included (ChemDraw). */
  #selectGroups() {
    if (!this.doc.groups.length) return;
    const mol = this.doc.mol;
    for (const g of this.#selectedGroups()) {
      const m = this.#groupMembers(g);
      for (const a of m.atoms) this.selection.atoms.add(a);
      for (const o of m.objects) this.selection.objects.add(o);
    }
    for (const b of mol.bonds()) if (this.selection.atoms.has(b.begin) && this.selection.atoms.has(b.end)) this.selection.bonds.add(b.id);
  }

  /** Whether the selection includes a group (for Ungroup's menu state). */
  get selectionHasGroup(): boolean { return this.#selectedGroups().length > 0; }

  /**
   * Object > Group (Cmd+G): the selected structures (whole), arrows, shapes
   * and captions become one group; groups in the selection go inside it as
   * they are (groups nest). Needs two or more things. Returns false when
   * there is nothing to group.
   */
  groupSelection(): boolean {
    const mol = this.doc.mol, sel = this.selection;
    const inner = this.#selectedGroups();
    const covered = new Set<AtomId>(), coveredObjects = new Set<number>();
    for (const g of inner) { const m = this.#groupMembers(g); m.atoms.forEach((a) => covered.add(a)); m.objects.forEach((o) => coveredObjects.add(o)); }
    const frags = mol.fragments().filter((f) => f.some((a) => sel.atoms.has(a)) && !f.some((a) => covered.has(a)));
    const objects = new Set([...sel.objects].filter((o) => !coveredObjects.has(o)));
    for (const id of this.attachedCaptions(frags.flat(), objects)) if (!coveredObjects.has(id)) objects.add(id);
    if (frags.length + objects.size + inner.length < 2) return false;
    this.doc.edit(() => {
      this.doc.groups.push({ id: newObjectId(), atoms: frags.map((f) => f[0]!), objects: [...objects], groups: inner.map((g) => g.id) });
    });
    this.#selectGroups();
    this.#emit();
    return true;
  }

  /**
   * Object > Ungroup (Shift+Cmd+G): take the outermost groups in the
   * selection apart, one level; groups inside them become groups of their own.
   */
  ungroupSelection(): boolean {
    const gone = new Set(this.#selectedGroups().map((g) => g.id));
    if (!gone.size) return false;
    this.doc.edit(() => { this.doc.groups = this.doc.groups.filter((g) => !gone.has(g.id)); });
    return true;
  }

  /**
   * Keep groups true to the drawing: drop deleted members and missing inner
   * groups; a group left with fewer than two things dissolves, handing what
   * it still holds to the group above it.
   */
  #refreshGroups() {
    if (!this.doc.groups.length) return;
    const frags = this.doc.mol.fragments();
    const live = new Set(this.doc.objects.map((o) => o.id));
    for (const g of this.doc.groups) {
      const had = new Set(g.atoms);
      // One surviving atom per structure directly in this group.
      g.atoms = frags.map((f) => f.find((a) => had.has(a))).filter((a): a is AtomId => a !== undefined);
      g.objects = g.objects.filter((id) => live.has(id));
    }
    for (let changed = true; changed; ) {
      changed = false;
      const ids = new Set(this.doc.groups.map((g) => g.id));
      for (const g of this.doc.groups) g.groups = g.groups.filter((c) => ids.has(c) && c !== g.id);
      const weak = this.doc.groups.find((g) => g.atoms.length + g.objects.length + g.groups.length < 2);
      if (weak) {
        const parent = parentGroup(this.doc.groups, weak);
        if (parent) {
          parent.atoms.push(...weak.atoms);
          parent.objects.push(...weak.objects);
          parent.groups.push(...weak.groups);
        }
        this.doc.groups = this.doc.groups.filter((g) => g !== weak);
        changed = true;
      }
    }
  }

  /** Analysis captions attached to these atoms (they move, copy and export with them). */
  attachedCaptions(atoms: Iterable<AtomId>, objects: ReadonlySet<number> = new Set()): number[] {
    return this.#followers(new Set(atoms), objects);
  }

  /** Select just these objects (arrows, shapes, captions). */
  selectObjects(ids: Iterable<number>) {
    this.clearSelection();
    for (const id of ids) this.selection.objects.add(id);
    this.#emit();
  }

  /** Linked analysis captions that should move with these atoms and objects (and are not moving already). */
  #followers(atoms: Set<AtomId>, objects: ReadonlySet<number>): number[] {
    return this.doc.objects.filter((o) => o.kind === 'text' && o.analysis && !objects.has(o.id)
      && (o.analysis.source !== undefined ? objects.has(o.analysis.source) : o.analysis.basis.length > 0 && o.analysis.basis.every((a) => atoms.has(a)))).map((o) => o.id);
  }

  /** Commit text typed into the label editor. Empty text clears a label back to carbon. */
  setLabel(atom: AtomId, text: string) {
    if (!this.doc.mol.hasAtom(atom)) return;
    this.doc.edit((mol) => {
      const t = text.trim();
      if (!t) { const a = mol.atom(atom); a.element = 'C'; a.label = null; a.isotope = null; return; }
      applyLabel(mol, atom, t);
    });
  }

  /** More bonds than the element's highest normal valence allows (charge-adjusted). */
  overvalent(id: AtomId): boolean {
    const a = this.doc.mol.atom(id);
    if (a.label !== null) return false;
    const el = elementBySymbol(a.element);
    if (!el || !el.valences.length) return false;
    const used = this.doc.mol.bondOrderSum(id) + a.radical + (a.explicitHydrogens ?? 0);
    const max = Math.max(...el.valences) + (['N', 'O', 'S', 'P'].includes(a.element) ? Math.max(0, a.charge) : 0);
    return used > max;
  }

  // ---------------------------------------------------------------- render

  /** SVG for the current state: the structure, then hover, selection and gesture overlays. */
  render(opts: { padding?: number } = {}): { svg: string; depiction: Depiction } {
    const dep = this.depiction;
    const overlays: string[] = [];
    const L = this.L;
    const mol = this.doc.mol;
    const HOVER = '#3b82f6';

    const atomBox = (id: AtomId, color: string, fill: string) => {
      const a = mol.atom(id);
      const lb = dep.labels.get(id)?.bounds;
      const r = L * 0.22;
      const [x0, y0, x1, y1] = lb ? [lb.x0, lb.y0, lb.x1, lb.y1] : [a.x - r, a.y - r, a.x + r, a.y + r];
      overlays.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="${r * 0.4}" fill="${fill}" stroke="${color}" stroke-width="0.6"/>`);
    };
    const bondBand = (id: BondId, color: string) => {
      const b = mol.bond(id), p = mol.atom(b.begin), q = mol.atom(b.end);
      overlays.push(`<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}" stroke="${color}" stroke-opacity="0.35" stroke-width="${L * 0.28}" stroke-linecap="round"/>`);
    };

    // Valence problems get ChemDraw's red box.
    for (const a of mol.atoms()) {
      if (!this.overvalent(a.id)) continue;
      const lb = dep.labels.get(a.id)?.bounds;
      const r = L * 0.25;
      const [x0, y0, x1, y1] = lb ? [lb.x0, lb.y0, lb.x1, lb.y1] : [a.x - r, a.y - r, a.x + r, a.y + r];
      overlays.push(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="none" stroke="#e00" stroke-width="0.8"/>`);
    }
    const objectBox = (id: number, fill: string) => {
      const o = this.doc.objects.find((x) => x.id === id);
      if (!o) return;
      if (o.kind === 'text') {
        const b = captionBounds(o, this.doc.style);
        overlays.push(`<rect x="${b.x0}" y="${b.y0}" width="${b.x1 - b.x0}" height="${b.y1 - b.y0}" fill="${fill}" stroke="${HOVER}" stroke-width="0.6"/>`);
      } else {
        for (const line of objectPolylines(o)) {
          overlays.push(`<polyline points="${line.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${HOVER}" stroke-opacity="0.35" stroke-width="${L * 0.35}" stroke-linecap="round" stroke-linejoin="round"/>`);
        }
      }
    };
    for (const o of this.selection.objects) objectBox(o, 'rgba(59,130,246,0.18)');
    // Adjustment handles (with a selection, arrow or drawing tool), as small open circles.
    const handleTool = this.tool.kind === 'select' || this.tool.kind === 'arrow' || this.tool.kind === 'shape';
    const showHandles = new Set<number>(this.selection.objects);
    if (this.hover.kind === 'object') showHandles.add(this.hover.id);
    if (this.#gesture.kind === 'handle') showHandles.add(this.#gesture.id);
    if (handleTool) for (const id of showHandles) {
      const o = this.doc.objects.find((x) => x.id === id);
      if (o?.kind === 'arrow' && o.curve?.length === 4) {
        // Control-point arms, as in a Bézier pen tool.
        const c = o.curve;
        overlays.push(`<path d="M ${c[0]!.x},${c[0]!.y} L ${c[1]!.x},${c[1]!.y} M ${c[3]!.x},${c[3]!.y} L ${c[2]!.x},${c[2]!.y}" stroke="${HOVER}" stroke-width="0.6" stroke-dasharray="2 1.5" fill="none"/>`);
      }
      if (o) for (const h of objectHandles(o)) {
        const sq = h.name === 'c1' || h.name === 'c2';
        overlays.push(sq ? `<rect class="handle" x="${h.p.x - 2}" y="${h.p.y - 2}" width="4" height="4" fill="#fff" stroke="${HOVER}" stroke-width="0.9"/>`
          : `<circle class="handle" cx="${h.p.x}" cy="${h.p.y}" r="${2.2}" fill="#fff" stroke="${HOVER}" stroke-width="0.9"/>`);
      }
    }
    if (this.hover.kind === 'object') objectBox(this.hover.id, 'rgba(59,130,246,0.10)');
    for (const b of this.selection.bonds) if (mol.hasBond(b)) bondBand(b, HOVER);
    for (const a of this.selection.atoms) if (mol.hasAtom(a)) atomBox(a, HOVER, 'rgba(59,130,246,0.18)');
    if (this.hover.kind === 'atom' && mol.hasAtom(this.hover.id)) atomBox(this.hover.id, HOVER, 'rgba(59,130,246,0.12)');
    if (this.hover.kind === 'bond' && mol.hasBond(this.hover.id)) bondBand(this.hover.id, HOVER);
    const spot = this.#liveHotspot();
    if (spot && !sameHit(spot, this.hover)) {
      // Highlighted like a hover; an atom also gets ChemDraw's green dot, just off it in its most open direction.
      if (spot.kind === 'bond') bondBand(spot.id, HOVER);
      else {
        atomBox(spot.id, HOVER, 'rgba(59,130,246,0.12)');
      }
    }
    if (spot?.kind === 'atom') {
      const a = mol.atom(spot.id);
      const angles = mol.neighbours(spot.id).map((n) => Math.atan2(mol.atom(n).y - a.y, mol.atom(n).x - a.x));
      const dir = angles.length ? largestGapBisector(angles) : -Math.PI / 4;
      overlays.push(`<circle class="hotspot" cx="${a.x + 0.45 * L * Math.cos(dir)}" cy="${a.y + 0.45 * L * Math.sin(dir)}" r="${L * 0.1}" fill="#1fa84a"/>`);
    }

    const g = this.#gesture;
    if (g.kind === 'bondDrag') {
      const { start, end } = this.#dragEnd(g.from, g.x0, g.y0, g.x, g.y);
      overlays.push(`<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${HOVER}" stroke-width="${this.doc.style.lineWidth}"/>`);
    } else if (g.kind === 'createDrag' && (this.tool.kind === 'arrow' || this.tool.kind === 'shape')) {
      const o = objectFromDrag(this.tool, g.x0, g.y0, g.x, g.y, L, this.fixedAngles);
      for (const line of objectPolylines(o)) {
        overlays.push(`<polyline points="${line.map((p) => `${p.x},${p.y}`).join(' ')}" fill="none" stroke="${HOVER}" stroke-width="${this.doc.style.lineWidth}"/>`);
      }
    } else if (g.kind === 'handle') {
      // Arc angle readout while bending or sliding an arc, as ChemDraw shows it.
      const o = this.doc.objects.find((x) => x.id === g.id);
      if (o?.kind === 'arrow' && o.arc) {
        const mid = objectHandles(o).find((h) => h.name === 'mid')!.p;
        overlays.push(`<text x="${mid.x + 6}" y="${mid.y - 6}" font-family="Helvetica, Arial, sans-serif" font-size="9" fill="${HOVER}">${Math.abs(Math.round(o.arc.angle))}°</text>`);
      }
    } else if (g.kind === 'chainDrag') {
      const pts = this.#chainPoints(g).map((p) => `${p.x},${p.y}`).join(' ');
      overlays.push(`<polyline points="${pts}" fill="none" stroke="${HOVER}" stroke-width="${this.doc.style.lineWidth}"/>`);
    } else if (g.kind === 'move' && g.copy) {
      // Option+drag: a faint copy follows the pointer and the original stays put.
      g.ghost ??= this.#ghost(this.selectedDrawing());
      overlays.push(`<g transform="translate(${+(g.x - g.x0).toFixed(2)} ${+(g.y - g.y0).toFixed(2)})" opacity="0.45">${g.ghost}</g>`);
    } else if (g.kind === 'move') {
      overlays.push(`<g transform="translate(${g.x - g.x0} ${g.y - g.y0})" opacity="0.5">${[...this.selection.atoms].filter((a) => mol.hasAtom(a)).map((a) => `<circle cx="${mol.atom(a).x}" cy="${mol.atom(a).y}" r="${L * 0.15}" fill="${HOVER}"/>`).join('')}</g>`);
    } else if (g.kind === 'marquee') {
      overlays.push(`<rect x="${Math.min(g.x0, g.x)}" y="${Math.min(g.y0, g.y)}" width="${Math.abs(g.x - g.x0)}" height="${Math.abs(g.y - g.y0)}" fill="rgba(59,130,246,0.08)" stroke="${HOVER}" stroke-width="0.6" stroke-dasharray="3 2"/>`);
    } else if (g.kind === 'lasso') {
      overlays.push(`<polygon points="${g.points.map((p) => `${p.x},${p.y}`).join(' ')}" fill="rgba(59,130,246,0.08)" stroke="${HOVER}" stroke-width="0.6" stroke-dasharray="3 2"/>`);
    }

    if (this.#stamp) {
      const st = this.#stamp;
      st.ghost ??= this.#ghost(st.src);
      overlays.push(`<g transform="translate(${+(st.x - st.x0).toFixed(2)} ${+(st.y - st.y0).toFixed(2)})" opacity="0.45">${st.ghost}</g>`);
    }
    const svg = toSvg(dep, { padding: opts.padding ?? 4 }).replace('</svg>', `<g class="overlay">${overlays.join('')}</g></svg>`);
    return { svg, depiction: dep };
  }
}

function sameHit(a: Hit, b: Hit): boolean {
  return a.kind === b.kind && (a.kind === 'none' || (a as { id: number }).id === (b as { id: number }).id);
}

function toolFor(id: ToolId, current: Tool): Tool {
  switch (id) {
    case 'benzene': return { kind: 'ring', size: 6, aromatic: true };
    case 'cyclopentadiene': return { kind: 'ring', size: 5, aromatic: true };
    case 'solidBond': return { kind: 'bond', bond: 'single' };
    case 'acyclicChain': return { kind: 'chain' };
    case 'text': return { kind: 'text' };
    case 'marquee': return { kind: 'select', mode: 'marquee' };
    case 'arrow': return { kind: 'arrow', arrow: 'reaction' };
    default: return current; // arrows, brackets, TLC, orbitals: not yet implemented
  }
}

/** Colors > By Element: label colours (Jmol-style, darkened where needed to read on white). */
const ELEMENT_COLORS: Record<string, string> = {
  N: '#3050f8', O: '#ff0d0d', S: '#b8a000', P: '#ff8000', F: '#1fa01f', Cl: '#1fa01f', Br: '#a62929', I: '#940094',
  B: '#e07070', Si: '#a08060', Se: '#c08000', Li: '#cc80ff', Na: '#ab5cf2', K: '#8f40d4', Mg: '#5f9f00', Sn: '#668080',
  Fe: '#e06633', Cu: '#c88033', Zn: '#7d80b0', Pd: '#006985', Pt: '#99a0b0', Ni: '#50d050', Co: '#f090a0', Rh: '#0a7d8c',
  Ru: '#248f8f', Ir: '#175487', Au: '#d0a000', Ag: '#909090', Ti: '#909090', D: '#808080',
};

/**
 * Abbreviations Expand Label draws out, as SMILES whose first atom takes the
 * labelled atom's place. Written for HexSketch from standard chemistry.
 */
const NICKNAMES: Record<string, string> = {
  Me: 'C', Et: 'CC', Pr: 'CCC', nPr: 'CCC', iPr: 'C(C)C', Bu: 'CCCC', nBu: 'CCCC', tBu: 'C(C)(C)C', sBu: 'C(C)CC', iBu: 'CC(C)C',
  Ph: 'c1ccccc1', Bn: 'Cc1ccccc1', Bz: 'C(=O)c1ccccc1', Ac: 'C(C)=O', Cy: 'C1CCCCC1', Vin: 'C=C', All: 'CC=C',
  OH: 'O', SH: 'S', NH2: 'N', NHMe: 'NC', NMe2: 'N(C)C', NHAc: 'NC(C)=O', NHBoc: 'NC(=O)OC(C)(C)C', NHCbz: 'NC(=O)OCc1ccccc1', NHFmoc: 'NC(=O)OCC1c2ccccc2-c2ccccc12',
  OMe: 'OC', OEt: 'OCC', OtBu: 'OC(C)(C)C', OPh: 'Oc1ccccc1', OBn: 'OCc1ccccc1', OAc: 'OC(C)=O', OBz: 'OC(=O)c1ccccc1',
  OTf: 'OS(=O)(=O)C(F)(F)F', OTs: 'OS(=O)(=O)c1ccc(C)cc1', OMs: 'OS(=O)(=O)C', OTBS: 'O[Si](C)(C)C(C)(C)C', OTBDMS: 'O[Si](C)(C)C(C)(C)C',
  OTIPS: 'O[Si](C(C)C)(C(C)C)C(C)C', OTMS: 'O[Si](C)(C)C', OTES: 'O[Si](CC)(CC)CC', OPMB: 'OCc1ccc(OC)cc1', OTHP: 'OC1CCCCO1', OMOM: 'OCOC',
  CO2H: 'C(=O)O', COOH: 'C(=O)O', CO2Me: 'C(=O)OC', CO2Et: 'C(=O)OCC', CO2tBu: 'C(=O)OC(C)(C)C', CO2Bn: 'C(=O)OCc1ccccc1', CHO: 'C=O',
  CONH2: 'C(N)=O', CN: 'C#N', NO2: '[N+](=O)[O-]', N3: 'N=[N+]=[N-]', CF3: 'C(F)(F)F', CCl3: 'C(Cl)(Cl)Cl',
  Tf: 'S(=O)(=O)C(F)(F)F', Ts: 'S(=O)(=O)c1ccc(C)cc1', Ms: 'S(=O)(=O)C', SO2Ph: 'S(=O)(=O)c1ccccc1',
  Boc: 'C(=O)OC(C)(C)C', Cbz: 'C(=O)OCc1ccccc1', Z: 'C(=O)OCc1ccccc1', Fmoc: 'C(=O)OCC1c2ccccc2-c2ccccc12', Alloc: 'C(=O)OCC=C', Troc: 'C(=O)OCC(Cl)(Cl)Cl',
  TMS: '[Si](C)(C)C', TBS: '[Si](C)(C)C(C)(C)C', TBDMS: '[Si](C)(C)C(C)(C)C', TIPS: '[Si](C(C)C)(C(C)C)C(C)C', TES: '[Si](CC)(CC)CC', TBDPS: '[Si](c1ccccc1)(c1ccccc1)C(C)(C)C',
  PMB: 'Cc1ccc(OC)cc1', Trt: 'C(c1ccccc1)(c1ccccc1)c1ccccc1', THP: 'C1CCCCO1', MOM: 'COC',
  Bpin: 'B1OC(C)(C)C(C)(C)O1', MgBr: '[Mg]Br', MgCl: '[Mg]Cl', SnBu3: '[Sn](CCCC)(CCCC)CCCC',
};

/** Can this labelled atom be expanded (a peptide on its own, or a known abbreviation)? */
function expandable(mol: Molecule, id: AtomId): boolean {
  const a = mol.atom(id);
  if (!a.label) return false;
  if (mol.neighbours(id).length === 0 && parsePeptide(a.label)) return true;
  return !!NICKNAMES[a.label] && mol.neighbours(id).length <= 1;
}

/**
 * Copy a molecule into `m`, shifted, but no nearer the top or left edge of the
 * page than `margin` (the canvas cannot scroll there); returns the id map.
 */
function insertMolecule(m: Molecule, src: Molecule, dx: number, dy: number, margin: number): Map<AtomId, AtomId> {
  const atoms = [...src.atoms()];
  dx = Math.max(dx, margin - Math.min(...atoms.map((a) => a.x)));
  dy = Math.max(dy, margin - Math.min(...atoms.map((a) => a.y)));
  const map = new Map<AtomId, AtomId>();
  for (const a of src.atoms()) map.set(a.id, m.addAtom({ ...a, x: a.x + dx, y: a.y + dy, chirality: null }).id);
  for (const b of src.bonds()) m.addBond({ ...b, begin: map.get(b.begin)!, end: map.get(b.end)!, ez: null });
  return map;
}

/** Replace a labelled atom by the structure its label stands for. */
function expandAtomLabel(m: Molecule, id: AtomId, L: number) {
  const a = m.atom(id);
  const nbrs = m.neighbours(id);
  if (nbrs.length === 0 && parsePeptide(a.label!)) {
    const pep = peptideMolecule(parsePeptide(a.label!)!, L);
    const xs = [...pep.atoms()].map((p) => p.x), ys = [...pep.atoms()].map((p) => p.y);
    insertMolecule(m, pep, a.x - (Math.min(...xs) + Math.max(...xs)) / 2, a.y - (Math.min(...ys) + Math.max(...ys)) / 2, 2 * L);
    m.removeAtom(id);
    return;
  }
  const frag = parseSmiles(NICKNAMES[a.label!]!);
  layout2D(frag, L);
  const fAtoms = [...frag.atoms()];
  const head = fAtoms[0]!;
  // Point the group away from the atom it hangs on (or rightwards for a lone label).
  let dir = 0;
  if (nbrs.length === 1) { const n = m.atom(nbrs[0]!); dir = Math.atan2(a.y - n.y, a.x - n.x); }
  const rest = fAtoms.slice(1);
  const cx = rest.length ? rest.reduce((s, p) => s + p.x, 0) / rest.length : head.x + 1;
  const cy = rest.length ? rest.reduce((s, p) => s + p.y, 0) / rest.length : head.y;
  const rot = dir - Math.atan2(cy - head.y, cx - head.x);
  const cos = Math.cos(rot), sin = Math.sin(rot);
  const place = (p: { x: number; y: number }) => ({ x: a.x + (p.x - head.x) * cos - (p.y - head.y) * sin, y: a.y + (p.x - head.x) * sin + (p.y - head.y) * cos });
  // The labelled atom becomes the group's first atom; the rest are added.
  a.element = head.element; a.label = null; a.charge = head.charge; a.explicitHydrogens = head.explicitHydrogens; a.isotope = null;
  const map = new Map<AtomId, AtomId>([[head.id, id]]);
  for (const p of rest) map.set(p.id, m.addAtom({ ...p, ...place(p), chirality: null }).id);
  for (const b of frag.bonds()) m.addBond({ ...b, begin: map.get(b.begin)!, end: map.get(b.end)!, ez: null });
}

/**
 * Apply a style change to runs. Booleans and scripts toggle: if every run
 * already has the value it is removed, otherwise added. Size and colour are set.
 */
export function restyle(runs: TextRun[], patch: Partial<TextStyle>): TextRun[] {
  const out = runs.map((r) => ({ ...r }));
  for (const key of ['bold', 'italic', 'underline'] as const) {
    if (patch[key] === undefined) continue;
    const all = out.every((r) => r[key]);
    for (const r of out) r[key] = all ? undefined : true;
  }
  if (patch.script !== undefined) {
    const all = out.every((r) => r.script === patch.script);
    for (const r of out) r.script = all ? undefined : patch.script;
  }
  if ('size' in patch) for (const r of out) r.size = patch.size;
  if ('color' in patch) for (const r of out) r.color = patch.color ?? undefined;
  if ('font' in patch) for (const r of out) r.font = patch.font || undefined;
  return out;
}

function cloneDrawing(d: Drawing): Drawing {
  return { mol: d.mol.clone(), objects: cloneObjects(d.objects), groups: cloneGroups(d.groups) };
}
