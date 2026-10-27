import '@hexsketch/web/style.css';
import './embed.css';
import { App } from '@modelcontextprotocol/ext-apps';
import { aiSummary, objectPoints, parsePattern, structureLink, substructureMatches, writeCdxml, HEXSKETCH_URL, type DocObject, type DrawingStyle, type Molecule, type ObjectGroup } from '@hexsketch/core';
import { placeLabels, readStructure } from '@hexsketch/agent';
import { nameMolecule } from '@hexsketch/naming';
import { mountApp, type AppApi } from '@hexsketch/web';

/**
 * HexSketch inside a chat (MCP Apps): one editor the chemist and the AI both
 * work in, while the conversation goes on (best full screen, where the chat
 * stays beside it).
 *
 * - The open_sketcher tool's `structure`, if any, opens in the editor.
 * - The chemist's edits reach the AI twice over: as model context (so the next
 *   question is about what is drawn now) and through sketch_sync (so the AI
 *   can call read_sketcher). "Send to chat" also posts the drawing.
 * - What the AI shows with show_in_sketcher (a new structure, highlights,
 *   labels on atoms, a note) is fetched with sketch_updates and appears here,
 *   in the drawing and in the Notes panel.
 */

/** As the server sends it (packages/hexsketch/src/mcp.ts). */
interface SketchUpdate {
  version: number;
  structure?: string;
  highlights?: { smiles: string; color: string; name: string }[];
  labels?: { at: string; text: string; color?: string; occurrence?: number }[];
  note?: string;
  step?: { index: number; count: number };
}

const app = new App({ name: 'HexSketch', version: '0.1.8' }, { availableDisplayModes: ['inline', 'fullscreen'] });

const expand = { label: 'Full screen', run: () => toggleFullscreen() };
const send = { label: 'Send to chat', run: (ui: AppApi) => sendToChat(ui) };
const open = { label: 'Open in HexSketch', run: (ui: AppApi) => openInBrowser(ui) };

/** A failure while starting shows in the frame, so it reads as an error rather than an empty box. */
function showError(err: unknown) {
  const box = document.createElement('pre');
  box.className = 'start-error';
  box.textContent = `HexSketch could not start here:\n${(err as Error)?.stack ?? String(err)}`;
  document.body.prepend(box);
}
window.addEventListener('error', (e) => showError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

let ui: AppApi;
try {
  // Two A4 pages side by side: room for a reaction scheme on one line, as a chat's full-screen frame is wide.
  ui = mountApp({ zoom: 1.25, actions: [expand, send, open], page: { paper: 'A4', orientation: 'portrait', across: 2, down: 1 } });
} catch (err) {
  showError(err);
  throw err;
}
const expandButton = document.querySelector<HTMLButtonElement>('.host-action');
expandButton?.classList.add('primary');

/** Whether the AI can reach this editor, in the top bar: so a broken link shows, with its reason. */
const linkState = Object.assign(document.createElement('span'), { className: 'link-state', textContent: 'Connecting…' });
document.querySelector('.topbar .spacer')?.after(linkState);
function setLink(state: 'live' | 'off' | 'wait', text: string, detail = '') {
  linkState.dataset.state = state;
  linkState.textContent = text;
  linkState.title = detail || text;
}

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

function addNote(text: string | undefined, highlights: SketchUpdate['highlights']): HTMLLIElement {
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
function mark(highlights: SketchUpdate['highlights'], labels: SketchUpdate['labels']) {
  const doc = ui.editor.doc;
  const marks = (highlights ?? []).map((h) => {
    let pattern;
    try { pattern = parsePattern(h.smiles); } catch { return null; }
    return { color: h.color, places: substructureMatches(pattern, doc.mol) };
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

async function openStructure(input: string, step?: SketchUpdate['step']): Promise<boolean> {
  try {
    const s = await readStructure(input);
    const first = s.mol.atoms().next().value as { x: number; y: number } | undefined;
    const was = first ? { x: first.x, y: first.y } : null;
    if (step && step.index > 0 && stepShift) {
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

async function apply(u: SketchUpdate) {
  // The notes panel opens first, so a new structure is centred in the room it leaves.
  const card = u.note || u.highlights?.length ? addNote(u.note, u.highlights) : null;
  if (u.structure) await openStructure(u.structure, u.step);
  if (u.highlights || u.labels) mark(u.highlights, u.labels);
  keepFrame(card);
  if (u.step) ui.flash(`Step ${u.step.index + 1} of ${u.step.count}: Back and Next are in Notes`);
  else ui.flash(u.structure ? 'The AI changed the drawing (Undo brings yours back)' : 'The AI pointed something out (see Notes)');
}

// ------------------------------------------------------------ the chat link

/** The drawing as text for the AI, or null when nothing is drawn. */
async function describe(): Promise<string | null> {
  const doc = ui.editor.doc;
  if (!doc.mol.atomCount) return null;
  const link = await structureLink(doc.mol, doc.style, doc.objects, doc.groups, HEXSKETCH_URL);
  return aiSummary(doc.mol, { nameOf: (m) => nameMolecule(m).name, link });
}

async function sendToChat(u: AppApi) {
  const text = await describe();
  if (!text) { u.flash('Draw a structure first'); return; }
  const r = await app.sendMessage({ role: 'user', content: [{ type: 'text', text }] });
  u.flash(r.isError ? 'The chat did not accept the drawing; copy it with Edit › Copy for AI instead' : 'Sent to the chat');
}

async function openInBrowser(u: AppApi) {
  const doc = u.editor.doc;
  if (!doc.mol.atomCount && !doc.objects.length) { await app.openLink({ url: HEXSKETCH_URL }); return; }
  const r = await app.openLink({ url: await structureLink(doc.mol, doc.style, doc.objects, doc.groups, HEXSKETCH_URL) });
  if (r.isError) u.flash('The chat did not open the link; use Edit › Copy Link');
}

function setFullscreen(on: boolean) {
  document.body.classList.toggle('fullscreen', on);
  if (expandButton) expandButton.textContent = on ? 'Exit full screen' : 'Full screen';
}

async function toggleFullscreen() {
  const modes = app.getHostContext()?.availableDisplayModes ?? [];
  if (!modes.includes('fullscreen')) { ui.flash('This chat does not offer full screen; Open in HexSketch gives the full editor'); return; }
  const r = await app.requestDisplayMode({ mode: document.body.classList.contains('fullscreen') ? 'inline' : 'fullscreen' });
  setFullscreen(r.mode === 'fullscreen');
}

/**
 * The editor asks for full screen the first time it opens: inline it is a
 * short panel in a narrow column, which is no way to draw, least of all on a
 * phone. The chat decides — it may refuse, or not offer full screen at all —
 * and the Full screen button goes on toggling it either way.
 */
let askedFullscreen = false;
async function openFullscreen() {
  if (askedFullscreen) return;
  askedFullscreen = true;
  const ctx = app.getHostContext();
  if (!ctx?.availableDisplayModes?.includes('fullscreen') || ctx.displayMode === 'fullscreen') return;
  const r = await app.requestDisplayMode({ mode: 'fullscreen' }).catch(() => null);
  if (r) setFullscreen(r.mode === 'fullscreen');
}

/**
 * How tall the panel is inline: the frame the chat says it has room for,
 * rather than a guessed 560px that overflows a phone and wastes a desktop.
 */
function fitFrame(ctx = app.getHostContext()) {
  const box = ctx?.containerDimensions as { height?: number; maxHeight?: number } | undefined;
  const h = box?.height ?? box?.maxHeight;
  document.body.style.setProperty('--embed-h', h ? `${Math.round(Math.max(320, Math.min(900, h)))}px` : '560px');
}

app.onhostcontextchanged = (ctx) => {
  if (ctx.displayMode) setFullscreen(ctx.displayMode === 'fullscreen');
  if (ctx.containerDimensions) fitFrame(ctx);
};

// ----------------------------------------------------------- the open sketch

let sketchId = '';
let opened = false;
let since = 0;

/** The editor's first content: the tool's input, or its result where a chat sends only that. */
async function start(input: string) {
  if (opened) return;
  opened = true;
  void openFullscreen();
  if (input) await openStructure(input);
  ui.flash(input ? 'Edit the structure, then Send to chat or ask in the chat' : 'Draw your structure, then Send to chat or ask in the chat');
}
app.ontoolinput = ({ arguments: args }) => start(typeof args?.structure === 'string' ? args.structure.trim() : '');
app.ontoolresult = (result) => {
  const sc = result.structuredContent as { structure?: unknown; sketch?: unknown } | undefined;
  void start(typeof sc?.structure === 'string' ? sc.structure.trim() : '');
  if (typeof sc?.sketch === 'string' && !sketchId) { sketchId = sc.sketch; startUpdates(); void shareWithModel(); }
  else if (!sketchId) setLink('off', 'Not linked to the AI', 'The chat gave the editor no sketch id (open_sketcher\'s structuredContent did not arrive).');
};

/**
 * How often the editor asks for what the AI showed: often right after
 * anything changed, less often as the drawing sits unchanged (every request
 * costs the hosted server something), and not at all once it has been out of
 * sight for a while. A visible editor never stops, so what the AI shows
 * still arrives, at worst a minute later. Using the editor, or looking at it
 * again, brings it straight back to the quick pace.
 */
const POLL = { active: 2000, quiet: 5000, idle: 30000, asleep: 60000, hidden: 30000 };
const QUIET_AFTER = 2 * 60e3, IDLE_AFTER = 15 * 60e3, ASLEEP_AFTER = 30 * 60e3, HIDDEN_STOP_AFTER = 10 * 60e3;
let lastActivity = Date.now();
let hiddenSince = document.hidden ? Date.now() : 0;
let pollTimer = 0, pollDue = 0, paused = false, polling = false;
let pollNow: () => void = () => {};

function schedulePoll(ms: number) {
  clearTimeout(pollTimer);
  pollDue = Date.now() + ms;
  pollTimer = window.setTimeout(() => pollNow(), ms);
}

/** The next poll's delay, or null to pause until the editor is seen again. */
function pollDelay(): number | null {
  const now = Date.now();
  if (document.hidden) return now - hiddenSince > HIDDEN_STOP_AFTER ? null : POLL.hidden;
  const idle = now - lastActivity;
  return idle > ASLEEP_AFTER ? POLL.asleep : idle > IDLE_AFTER ? POLL.idle : idle > QUIET_AFTER ? POLL.quiet : POLL.active;
}

/** Someone used the editor (or the AI changed it): check again soon. */
function activity() {
  lastActivity = Date.now();
  if (!polling) return;
  if (paused) { paused = false; setLink('wait', 'Reconnecting…'); schedulePoll(0); }
  else if (pollDue - Date.now() > POLL.active) schedulePoll(POLL.active);
}
for (const type of ['pointerdown', 'keydown', 'wheel']) document.addEventListener(type, activity, { passive: true });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenSince = Date.now();
  else { hiddenSince = 0; activity(); }
});

/** Fetch what the AI asked to show, while this is the open editor. */
function startUpdates() {
  if (!app.getHostCapabilities()?.serverTools) {
    setLink('off', 'Not linked to the AI', 'This chat does not let the editor reach HexSketch (no serverTools capability), so the AI cannot show things here. Your drawing still reaches the AI.');
    return;
  }
  let failures = 0;
  polling = true;
  pollNow = async () => {
    try {
      const r = await app.callServerTool({ name: 'sketch_updates', arguments: { sketch: sketchId, since } });
      if (r.isError) throw new Error((r.content?.[0] as { text?: string } | undefined)?.text ?? 'the chat returned an error');
      const sc = r.structuredContent as { live?: boolean; updates?: SketchUpdate[] } | undefined;
      if (!sc) throw new Error('the chat returned no structuredContent from sketch_updates');
      failures = 0;
      if (sc.live === false) {
        polling = false;
        setLink('off', 'Not linked: HexSketch has lost this editor', 'HexSketch no longer knows this editor (it was opened more than a day ago, or by another computer). Ask the AI to open the sketcher again.');
        return;
      }
      setLink('live', 'Linked to the AI', 'What the AI shows with show_in_sketcher appears here.');
      // Steps sent together open at the first, for the user to step through.
      let first: { frame: number; count: number } | null = null;
      for (const u of sc.updates ?? []) {
        since = Math.max(since, u.version);
        await apply(u);
        if (u.step?.index === 0) first = { frame: at, count: u.step.count };
        lastActivity = Date.now();
      }
      if (first) { goTo(first.frame); ui.flash(`Step 1 of ${first.count}: Next is in Notes`); }
    } catch (err) {
      failures += 1;
      const why = (err as Error)?.message ?? String(err);
      if (failures >= 2) setLink('off', `Not linked: ${why.slice(0, 60)}`, `The editor could not fetch the AI's updates: ${why}`);
    }
    if (failures) { schedulePoll(Math.min(30000, 2000 * 2 ** failures)); return; }
    const next = pollDelay();
    if (next === null) {
      paused = true;
      setLink('wait', 'Paused while out of sight', 'The editor stopped checking for the AI\'s changes while it was out of sight. It reconnects as soon as it is on screen again.');
      return;
    }
    schedulePoll(next);
  };
  pollNow();
}

/**
 * What the chat tells the AI on every turn while the editor is open: that it
 * is open and is where to work (models drift back to images and long chat
 * answers otherwise), and what is drawn now.
 */
async function shareWithModel() {
  const text = await describe();
  const how = `The HexSketch editor is open in this chat${sketchId ? ` (sketch "${sketchId}")` : ''}, and the user is working in it. Work in it too: show every structure you discuss with show_in_sketcher, highlight the parts you mean, pin short labels to atoms (a pKa, a reactive site, a configuration) and sum them up in its note in a few short bullets by colour (the note is a small summary beside the drawing, not your answer, and on a phone it takes room the drawing needs); draw reactions with its reaction input (an arrow, reagents above it, solvent and conditions below); keep your chat reply short and point to the editor. Do not show structures as images, pictures from the web or text drawings unless the user asks for one. Call read_sketcher when the user refers to their drawing.`;
  await app.updateModelContext({ content: [{ type: 'text', text: text ? `${how}\n\nThe user's drawing, as it is now:\n\n${text}` : `${how}\n\nThe canvas is empty.` }] }).catch(() => {});
}

// Keep the AI's view of the drawing current, once editing pauses.
let timer = 0;
ui.editor.onChange(() => {
  activity();
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    await shareWithModel();
    if (sketchId && app.getHostCapabilities()?.serverTools) {
      const doc = ui.editor.doc;
      const cdxml = doc.mol.atomCount || doc.objects.length ? writeCdxml(doc.mol, doc.style, doc.objects, { groups: doc.groups }) : '';
      app.callServerTool({ name: 'sketch_sync', arguments: { sketch: sketchId, cdxml } }).catch(() => {});
    }
  }, 800);
});

app.connect().then(() => {
  app.setupSizeChangedNotifications();
  setFullscreen(app.getHostContext()?.displayMode === 'fullscreen');
  fitFrame();
}).catch((err) => {
  // Opened outside a chat (a preview, a test): the editor still works.
  console.warn('HexSketch: no MCP Apps host', err);
  setLink('off', 'Not in a chat', String(err));
});
