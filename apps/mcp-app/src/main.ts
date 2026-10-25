import '@hexsketch/web/style.css';
import './embed.css';
import { App } from '@modelcontextprotocol/ext-apps';
import { aiSummary, parseSmiles, structureLink, substructureMatches, writeCdxml, HEXSKETCH_URL } from '@hexsketch/core';
import { readStructure } from '@hexsketch/agent';
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
 * - What the AI shows with show_in_sketcher (a new structure, highlights, a
 *   note) is fetched with sketch_updates and appears here, in the drawing and
 *   in the Notes panel.
 */

/** As the server sends it (packages/hexsketch/src/mcp.ts). */
interface SketchUpdate { version: number; structure?: string; highlights?: { smiles: string; color: string; name: string }[]; note?: string }

const app = new App({ name: 'HexSketch', version: '0.1.4' }, { availableDisplayModes: ['inline', 'fullscreen'] });

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
  ui = mountApp({ zoom: 1.25, actions: [expand, send, open] });
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

/** The notes panel: what the AI explained, newest first, with its highlight colours. */
const notes = document.createElement('aside');
notes.className = 'notes';
notes.innerHTML = '<header><span>Notes</span><button type="button" title="Hide notes" aria-label="Hide notes">×</button></header><ol></ol><p class="notes-empty">What the AI points out appears here.</p>';
document.querySelector('.workspace')!.append(notes);
const list = notes.querySelector('ol')!;
const showNotes = (on: boolean) => document.body.classList.toggle('notes-open', on);
notes.querySelector('button')!.addEventListener('click', () => showNotes(false));

function addNote(text: string | undefined, highlights: SketchUpdate['highlights']) {
  const li = document.createElement('li');
  for (const h of highlights ?? []) {
    const chip = Object.assign(document.createElement('span'), { className: 'chip', textContent: h.smiles, title: `${h.name}: ${h.smiles}` });
    chip.style.background = h.color;
    li.append(chip);
  }
  if (text) li.append(Object.assign(document.createElement('p'), { textContent: text }));
  list.prepend(li);
  notes.classList.add('has-notes');
  showNotes(true);
}

// ----------------------------------------------------------- AI highlights

/** What the AI last highlighted, with what each atom and bond had before, so the next call can put it back. */
let aiMarks: { atoms: Map<number, string | null>; bonds: Map<number, string | null> } = { atoms: new Map(), bonds: new Map() };

function highlight(highlights: NonNullable<SketchUpdate['highlights']>) {
  const mol = ui.editor.doc.mol;
  const marks = highlights.map((h) => {
    let pattern;
    try { pattern = parseSmiles(h.smiles); } catch { return null; }
    return { color: h.color, places: substructureMatches(pattern, mol) };
  });
  const previous = aiMarks;
  aiMarks = { atoms: new Map(), bonds: new Map() };
  ui.editor.doc.edit((m) => {
    for (const [id, was] of previous.atoms) if (m.hasAtom(id)) m.atom(id).highlight = was;
    for (const [id, was] of previous.bonds) if (m.hasBond(id)) m.bond(id).highlight = was;
    for (const mark of marks) {
      if (!mark) continue;
      for (const place of mark.places) {
        for (const id of place.atoms) { if (!aiMarks.atoms.has(id)) aiMarks.atoms.set(id, m.atom(id).highlight ?? null); m.atom(id).highlight = mark.color; }
        for (const id of place.bonds) { if (!aiMarks.bonds.has(id)) aiMarks.bonds.set(id, m.bond(id).highlight ?? null); m.bond(id).highlight = mark.color; }
      }
    }
  });
}

async function openStructure(input: string): Promise<boolean> {
  try {
    const s = await readStructure(input);
    // SMILES and molfiles are laid out around the origin; drawings keep their place on the page.
    ui.load(s.mol, s.style, s.objects, { centre: s.format === 'smiles' || s.format === 'mol' || (s.format === 'link' && s.smiles !== undefined) });
    aiMarks = { atoms: new Map(), bonds: new Map() };
    return true;
  } catch (err) {
    ui.flash(`Could not open the structure: ${(err as Error).message}`);
    return false;
  }
}

async function apply(u: SketchUpdate) {
  if (u.structure) await openStructure(u.structure);
  if (u.highlights) highlight(u.highlights);
  if (u.note || u.highlights?.length) addNote(u.note, u.highlights);
  ui.flash(u.structure ? 'The AI changed the drawing (Undo brings yours back)' : 'The AI pointed something out (see Notes)');
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
app.onhostcontextchanged = (ctx) => { if (ctx.displayMode) setFullscreen(ctx.displayMode === 'fullscreen'); };

// ----------------------------------------------------------- the open sketch

let sketchId = '';
let opened = false;
let since = 0;

/** The editor's first content: the tool's input, or its result where a chat sends only that. */
async function start(input: string) {
  if (opened) return;
  opened = true;
  if (input) await openStructure(input);
  ui.flash(input ? 'Edit the structure, then Send to chat or ask in the chat' : 'Draw your structure, then Send to chat or ask in the chat');
}
app.ontoolinput = ({ arguments: args }) => start(typeof args?.structure === 'string' ? args.structure.trim() : '');
app.ontoolresult = (result) => {
  const sc = result.structuredContent as { structure?: unknown; sketch?: unknown } | undefined;
  void start(typeof sc?.structure === 'string' ? sc.structure.trim() : '');
  if (typeof sc?.sketch === 'string' && !sketchId) { sketchId = sc.sketch; startUpdates(); }
  else if (!sketchId) setLink('off', 'Not linked to the AI', 'The chat gave the editor no sketch id (open_sketcher\'s structuredContent did not arrive).');
};

/** Fetch what the AI asked to show, every couple of seconds while this is the open editor. */
function startUpdates() {
  if (!app.getHostCapabilities()?.serverTools) {
    setLink('off', 'Not linked to the AI', 'This chat does not let the editor reach HexSketch (no serverTools capability), so the AI cannot show things here. Your drawing still reaches the AI.');
    return;
  }
  let failures = 0;
  const poll = async () => {
    try {
      const r = await app.callServerTool({ name: 'sketch_updates', arguments: { sketch: sketchId, since } });
      if (r.isError) throw new Error((r.content?.[0] as { text?: string } | undefined)?.text ?? 'the chat returned an error');
      const sc = r.structuredContent as { live?: boolean; updates?: SketchUpdate[] } | undefined;
      if (!sc) throw new Error('the chat returned no structuredContent from sketch_updates');
      failures = 0;
      if (sc.live === false) {
        setLink('off', 'Not linked: HexSketch has lost this editor', 'HexSketch no longer knows this editor (it was opened more than a day ago, or by another computer). Ask the AI to open the sketcher again.');
        return;
      }
      setLink('live', 'Linked to the AI', 'What the AI shows with show_in_sketcher appears here.');
      for (const u of sc.updates ?? []) { since = Math.max(since, u.version); await apply(u); }
    } catch (err) {
      failures += 1;
      const why = (err as Error)?.message ?? String(err);
      if (failures >= 2) setLink('off', `Not linked: ${why.slice(0, 60)}`, `The editor could not fetch the AI's updates: ${why}`);
    }
    // Slow down after errors, and while the editor is out of sight.
    window.setTimeout(poll, failures ? Math.min(30000, 2000 * 2 ** failures) : document.hidden ? 6000 : 1500);
  };
  void poll();
}

// Keep the AI's view of the drawing current, once editing pauses.
let timer = 0;
ui.editor.onChange(() => {
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const text = await describe();
    if (text) app.updateModelContext({ content: [{ type: 'text', text: `The user's drawing in HexSketch, as it is now:\n\n${text}` }] }).catch(() => {});
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
}).catch((err) => {
  // Opened outside a chat (a preview, a test): the editor still works.
  console.warn('HexSketch: no MCP Apps host', err);
  setLink('off', 'Not in a chat', String(err));
});
