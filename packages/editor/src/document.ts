import { cloneGroups, cloneObjects, type ObjectGroup, DEFAULT_PAGE, DEFAULT_STYLE, Molecule, type DocObject, type DrawingStyle, type PageSettings } from '@hexsketch/core';

/**
 * The editable document: one connection table (all fragments) plus style,
 * with snapshot undo. Snapshots are cheap at drawing sizes and make every
 * command trivially reversible, including multi-step ones like ring fusion.
 */
interface Snapshot { mol: Molecule; objects: DocObject[]; groups: ObjectGroup[]; style: DrawingStyle }

export class EditorDocument {
  mol: Molecule;
  /** Arrows, drawing elements and captions. */
  objects: DocObject[] = [];
  /** Object > Group: sets of structures and objects that select and move together. */
  groups: ObjectGroup[] = [];
  style: DrawingStyle;
  /** File > Document Settings: paper, orientation and pages across and down. */
  page: PageSettings = { ...DEFAULT_PAGE };
  #undo: Snapshot[] = [];
  #redo: Snapshot[] = [];
  #listeners = new Set<() => void>();

  constructor(mol = new Molecule(), style: DrawingStyle = DEFAULT_STYLE) {
    this.mol = mol;
    this.style = style;
  }

  /** Run a mutation as one undoable step. Returns whatever the mutation returns. */
  edit<T>(fn: (mol: Molecule, objects: DocObject[]) => T): T {
    const before = this.#snap();
    const result = fn(this.mol, this.objects);
    this.#undo.push(before);
    this.#edits++;
    if (this.#undo.length > 500) this.#undo.shift();
    this.#redo = [];
    this.#emit();
    return result;
  }

  /**
   * Live edits while dragging a handle: beginLive() snapshots, changes are
   * shown with touch(), and endLive() records the whole drag as one undo step.
   */
  #live: Snapshot | null = null;
  beginLive(): void { this.#live = this.#snap(); }
  touch(): void { this.#emit(); }
  endLive(): void {
    if (!this.#live) return;
    this.#undo.push(this.#live);
    this.#live = null;
    this.#redo = [];
    this.#emit();
  }

  get canUndo(): boolean { return this.#undo.length > 0; }
  /** Number of undoable steps (changes whenever an edit is recorded). */
  get undoDepth(): number { return this.#undo.length + this.#edits; }
  #edits = 0;
  get canRedo(): boolean { return this.#redo.length > 0; }

  // Styles are never changed in place (a new object each time), so the reference is enough.
  #snap(): Snapshot { return { mol: this.mol.clone(), objects: cloneObjects(this.objects), groups: cloneGroups(this.groups), style: this.style }; }
  #restore(s: Snapshot) { this.mol = s.mol; this.objects = s.objects; this.groups = s.groups; this.style = s.style; }

  undo(): void {
    const prev = this.#undo.pop();
    if (!prev) return;
    this.#redo.push(this.#snap());
    this.#restore(prev);
    this.#emit();
  }

  redo(): void {
    const next = this.#redo.pop();
    if (!next) return;
    this.#undo.push(this.#snap());
    this.#restore(next);
    this.#emit();
  }

  /** Replace the whole drawing (open file, edit from a document) as one undoable step. */
  replace(mol: Molecule, objects: DocObject[] = [], groups: ObjectGroup[] = [], style?: DrawingStyle): void {
    this.#undo.push(this.#snap());
    this.#redo = [];
    if (style) this.style = style;
    this.mol = mol;
    this.objects = objects;
    this.groups = groups;
    this.#emit();
  }

  onChange(fn: () => void): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  #emit() { for (const fn of this.#listeners) fn(); }
}
