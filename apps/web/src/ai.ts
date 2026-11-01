import './ai.css';
import { documentSize, objectPoints, type DocObject, type DrawingStyle, type Molecule, type ObjectGroup } from '@hexsketch/core';
import { highlighted, placeLabels, readStructure } from '@hexsketch/agent';
import type { AppApi } from './app.ts';

/**
 * What an AI shows in the editor: a new structure, highlights, labels on
 * atoms and a note, one step of a sequence. The MCP server makes these
 * (show_in_sketcher, packages/hexsketch/src/toolkit.ts); the in-chat editor
 * (apps/mcp-app) and any page with an AI beside the editor apply them here.
 */
export interface AiUpdate {
  structure?: string;
  highlights?: { smiles: string; occurrence?: number; every?: boolean; color: string; name: string }[];
  labels?: { at: string; text: string; color?: string; occurrence?: number }[];
  note?: string;
  step?: { index: number; count: number };
}

export interface AiLayer {
  /** Show an update: its note in the Notes panel, then the structure, highlights and labels in the drawing. */
  apply(u: AiUpdate): Promise<void>;
  /** Open a structure (SMILES, molfile, CDXML, link) in the middle of the sheet; false, with a message, if it can't be read. */
  openStructure(input: string, step?: AiUpdate['step']): Promise<boolean>;
  /** Which of the updates shown so far is on screen (Back and Next move it). */
  readonly at: number;
  /** Show update i again (one Undo step). */
  goTo(i: number): void;
}

/**
 * The AI's side of an editor: a Notes panel beside the drawing, highlights
 * and labels it can take back, and Back and Next through what it showed.
 */
export function createAiLayer(ui: AppApi): AiLayer {
  // ------------------------------------------------------------------ notes

  /**
   * The notes panel: what the AI explained, in order, with its highlight
   * colours, and Back and Next through what it showed (a mechanism's steps).
   */
  const notes = document.createElement('aside');
  notes.className = 'notes';
  notes.innerHTML = '<header><span>Notes</span><button type="button" class="close" title="Hide notes" aria-label="Hide notes">×</button></header>'
    + '<nav class="steps" hidden><button type="button" class="back" aria-label="Back">‹ Back</button><span class="where"></span><button type="button" class="next" aria-label="Next">Next ›</button></nav>'
    + '<ol></ol><p class="notes-empty">What the AI points out appears here.</p>';
  document.querySelector('.workspace')!.append(notes);
  const list = notes.querySelector('ol')!;
  const showNotes = (on: boolean) => document.body.classList.toggle('notes-open', on);
  notes.querySelector('.close')!.addEventListener('click', () => showNotes(false));

  function addNote(text: string | undefined, highlights: AiUpdate['highlights']): HTMLLIElement {
    const li = document.createElement('li');
    const colours = new Map((highlights ?? []).map((h) => [h.name, h.color]));
    // A colour the note does not name gets a swatch of its own, so every highlight is accounted for.
    const named = new Set([...(text ?? '').toLowerCase().matchAll(/\*\*([a-z]+)/g)].map((m) => m[1]!));
    const unnamed = (highlights ?? []).filter((h) => !named.has(h.name));
    if (unnamed.length) {
      const key = Object.assign(document.createElement('div'), { className: 'note-key' });
      for (const h of unnamed) {
        const chip = Object.assign(document.createElement('span'), { className: 'chip', textContent: h.name, title: h.smiles });
        chip.style.background = h.color;
        key.append(chip);
      }
      li.append(key);
    }
    if (text) li.append(formatted(text, colours));
    list.append(li);
    notes.classList.add('has-notes');
    showNotes(true);
    return li;
  }

  /**
   * A note's text, with the little Markdown models write (**bold**, *italic*,
   * `code`, "- " lists) shown as such, and a bold highlight colour ("**Yellow**")
   * shown in that colour, as the key to the drawing.
   */
  function formatted(text: string, colours: Map<string, string>): HTMLElement {
    const box = document.createElement('div');
    box.className = 'note-text';
    let ul: HTMLUListElement | null = null;
    for (const line of text.split('\n')) {
      const item = /^\s*[-*•]\s+(.*)$/.exec(line);
      if (item) { ul ??= box.appendChild(document.createElement('ul')); ul.append(inline(document.createElement('li'), item[1]!, colours)); continue; }
      ul = null;
      if (line.trim()) box.append(inline(document.createElement('p'), line, colours));
    }
    return box;
  }
  function inline<T extends HTMLElement>(el: T, text: string, colours: Map<string, string>): T {
    // Text nodes only, so nothing the AI writes runs as HTML.
    for (const part of text.split(/(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`)/)) {
      if (!part) continue;
      const tag = part.startsWith('**') ? 'strong' : part.startsWith('*') ? 'em' : part.startsWith('`') ? 'code' : null;
      const strip = tag === 'strong' ? 2 : tag ? 1 : 0;
      const piece = tag ? Object.assign(document.createElement(tag), { textContent: part.slice(strip, -strip) }) : part;
      const colour = tag === 'strong' ? colours.get(part.slice(2, -2).trim().toLowerCase()) : undefined;
      if (colour && typeof piece !== 'string') { piece.className = 'swatch'; piece.style.background = colour; }
      el.append(piece);
    }
    return el;
  }

  // ------------------------------------------------- AI highlights and labels

  /** What the AI last highlighted, with what each atom and bond had before, so the next call can put it back. */
  let aiMarks: { atoms: Map<number, string | null>; bonds: Map<number, string | null> } = { atoms: new Map(), bonds: new Map() };
  /** The captions (and leaders) of the AI's labels, which its next labels replace. */
  let aiLabels = new Set<number>();

  /** The AI's highlights and labels, in one edit (one Undo takes them away). */
  function mark(highlights: AiUpdate['highlights'], labels: AiUpdate['labels']) {
    const doc = ui.editor.doc;
    // Each highlight marks one place (the server says which), or every place if it asks.
    const marks = (highlights ?? []).map((h) => {
      try { return { color: h.color, places: highlighted(doc.mol, h) }; } catch { return null; }
    });
    doc.edit((m, objects) => {
      if (highlights) {
        for (const [id, was] of aiMarks.atoms) if (m.hasAtom(id)) m.atom(id).highlight = was;
        for (const [id, was] of aiMarks.bonds) if (m.hasBond(id)) m.bond(id).highlight = was;
        aiMarks = { atoms: new Map(), bonds: new Map() };
        for (const mk of marks) {
          if (!mk) continue;
          for (const place of mk.places) {
            for (const id of place.atoms) { if (!aiMarks.atoms.has(id)) aiMarks.atoms.set(id, m.atom(id).highlight ?? null); m.atom(id).highlight = mk.color; }
            for (const id of place.bonds) { if (!aiMarks.bonds.has(id)) aiMarks.bonds.set(id, m.bond(id).highlight ?? null); m.bond(id).highlight = mk.color; }
          }
        }
      }
      if (labels) {
        for (let i = objects.length - 1; i >= 0; i--) if (aiLabels.has(objects[i]!.id)) objects.splice(i, 1);
        let placed: DocObject[] = [];
        try { placed = placeLabels(m, objects, doc.style, labels).objects; } catch { /* a fragment that does not parse: no labels */ }
        objects.push(...placed);
        aiLabels = new Set(placed.map((o) => o.id));
      }
    });
  }

  // ------------------------------------------------------------------ steps

  /** What the editor showed after each of the AI's updates, to step back and forth through. */
  interface Frame {
    mol: Molecule; objects: DocObject[]; groups: ObjectGroup[]; style: DrawingStyle;
    marks: typeof aiMarks; labels: Set<number>; card: HTMLLIElement | null;
  }
  const frames: Frame[] = [];
  let at = -1;
  const stepsBar = notes.querySelector<HTMLElement>('.steps')!;
  const copyMarks = (m: typeof aiMarks) => ({ atoms: new Map(m.atoms), bonds: new Map(m.bonds) });
  // Item by item: a drawing read from CDXML may carry helpers on its arrays, which can't be cloned.
  const copyAll = <T,>(xs: readonly T[]): T[] => xs.map((x) => structuredClone(x));

  function keepFrame(card: HTMLLIElement | null) {
    const d = ui.editor.doc;
    const i = frames.push({
      mol: d.mol.clone(), objects: copyAll(d.objects), groups: copyAll(d.groups), style: { ...d.style },
      marks: copyMarks(aiMarks), labels: new Set(aiLabels), card,
    }) - 1;
    card?.addEventListener('click', () => goTo(i));
    at = i;
    showStep();
  }

  /** Show frame i (one Undo step, so the user's own edits come back with Undo). */
  function goTo(i: number) {
    const f = frames[i];
    if (!f || i === at) return;
    ui.editor.doc.replace(f.mol.clone(), copyAll(f.objects), copyAll(f.groups), { ...f.style });
    aiMarks = copyMarks(f.marks);
    aiLabels = new Set(f.labels);
    at = i;
    showStep();
    ui.reveal();
  }

  function showStep() {
    stepsBar.hidden = frames.length < 2;
    stepsBar.querySelector('.where')!.textContent = `${at + 1} of ${frames.length}`;
    stepsBar.querySelector<HTMLButtonElement>('.back')!.disabled = at <= 0;
    stepsBar.querySelector<HTMLButtonElement>('.next')!.disabled = at >= frames.length - 1;
    frames.forEach((f, i) => f.card?.classList.toggle('current', i === at));
    frames[at]?.card?.scrollIntoView({ block: 'nearest' });
  }
  stepsBar.querySelector('.back')!.addEventListener('click', () => goTo(at - 1));
  stepsBar.querySelector('.next')!.addEventListener('click', () => goTo(at + 1));

  /** How far the first of a sequence of steps was moved onto the sheet: the later steps move as far, so their atoms stay put. */
  let stepShift: { x: number; y: number } | null = null;

  /** Whether a drawing moved by `d` lies on the sheet, clear of its edges: a later step drawn bigger than the first may not. */
  function fitsSheet(mol: Molecule, objects: readonly DocObject[], d: { x: number; y: number }): boolean {
    const { w, h } = documentSize(ui.editor.doc.page), m = ui.editor.L;
    return [...mol.atoms(), ...objects.flatMap(objectPoints)].every((p) => p.x + d.x > m && p.x + d.x < w - m && p.y + d.y > m && p.y + d.y < h - m);
  }

  async function openStructure(input: string, step?: AiUpdate['step']): Promise<boolean> {
    try {
      // Protecting groups as chemists draw them: Boc, Fmoc, TBS...
      const s = await readStructure(input, { abbreviate: true });
      const first = s.mol.atoms().next().value as { x: number; y: number } | undefined;
      const was = first ? { x: first.x, y: first.y } : null;
      if (step && step.index > 0 && stepShift && fitsSheet(s.mol, s.objects, stepShift)) {
        for (const a of s.mol.atoms()) { a.x += stepShift.x; a.y += stepShift.y; }
        for (const o of s.objects) for (const q of objectPoints(o)) { q.x += stepShift.x; q.y += stepShift.y; }
        ui.load(s.mol, s.style, s.objects);
      } else {
        // Whatever its source (a SMILES laid out around the origin, a drawing from elsewhere), it goes in the middle of the sheet.
        ui.load(s.mol, s.style, s.objects, { centre: true });
        stepShift = first && was ? { x: first.x - was.x, y: first.y - was.y } : null;
      }
      aiMarks = { atoms: new Map(), bonds: new Map() };
      aiLabels = new Set();
      return true;
    } catch (err) {
      ui.flash(`Could not open the structure: ${(err as Error).message}`);
      return false;
    }
  }

  async function apply(u: AiUpdate) {
    // The notes panel opens first, so a new structure is centred in the room it leaves.
    const card = u.note || u.highlights?.length ? addNote(u.note, u.highlights) : null;
    if (u.structure) await openStructure(u.structure, u.step);
    if (u.highlights || u.labels) mark(u.highlights, u.labels);
    keepFrame(card);
    // The notes panel may have opened over what the structure was fitted to: bring all of it back into view.
    ui.reveal();
    if (u.step) ui.flash(`Step ${u.step.index + 1} of ${u.step.count}: Back and Next are in Notes`);
    else ui.flash(u.structure ? 'The AI changed the drawing (Undo brings yours back)' : 'The AI pointed something out (see Notes)');
  }

  return { apply, openStructure, goTo, get at() { return at; } };
}
