import '@hexsketch/web/style.css';
import './embed.css';
import { App } from '@modelcontextprotocol/ext-apps';
import { aiSummary, structureLink, writeCdxml, HEXSKETCH_URL } from '@hexsketch/core';
import { drawnOut } from '@hexsketch/agent';
import { addRingParents, nameMolecule } from '@hexsketch/naming';
import { mountApp, type AppApi } from '@hexsketch/web';
import { createAiLayer, type AiUpdate } from '@hexsketch/web/ai';

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
interface SketchUpdate extends AiUpdate { version: number }

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
/** The Notes panel, highlights, labels and steps of what the AI shows (shared with any page that puts an AI beside the editor). */
const ai = createAiLayer(ui);
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

// ------------------------------------------------------------ the chat link

/** The drawing as text for the AI, or null when nothing is drawn. */
async function describe(): Promise<string | null> {
  const doc = ui.editor.doc;
  if (!doc.mol.atomCount) return null;
  const link = await structureLink(doc.mol, doc.style, doc.objects, doc.groups, HEXSKETCH_URL);
  // Abbreviations (Boc, OTBS...) drawn out, so the AI gets the full SMILES and formula.
  return aiSummary(drawnOut(doc.mol, doc.style), { nameOf: (m) => nameMolecule(m).name, link });
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

/** Keep clear of what the chat's own controls cover, where it says (a phone's message box, a notch). */
function keepClear(ctx = app.getHostContext()) {
  const inset = ctx?.safeAreaInsets;
  if (!inset) return;
  for (const side of ['top', 'right', 'bottom', 'left'] as const) document.body.style.setProperty(`--safe-${side}`, `${Math.max(0, inset[side] ?? 0)}px`);
}

app.onhostcontextchanged = (ctx) => {
  if (ctx.displayMode) setFullscreen(ctx.displayMode === 'fullscreen');
  if (ctx.containerDimensions) fitFrame(ctx);
  if (ctx.safeAreaInsets) keepClear(ctx);
};

// ----------------------------------------------------------- the open sketch

let sketchId = '';
let opened = false;
let since = 0;

/**
 * The ring parents, which the page carries as gzipped JSON
 * (src/rings-later.ts): added once the first drawing is up, after which
 * names and what the AI is told about the drawing are brought up to date.
 */
async function loadRingParents() {
  const el = document.getElementById('ring-parents');
  if (!el) return;
  el.remove();
  try {
    const bytes = Uint8Array.from(atob(el.textContent ?? ''), (c) => c.charCodeAt(0));
    const json = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
    addRingParents(JSON.parse(json) as Parameters<typeof addRingParents>[0]);
  } catch (err) {
    console.warn('HexSketch: ring parents not loaded', err);
    return;
  }
  ui.editor.doc.touch();
  void shareWithModel();
}

/** The editor's first content: the tool's input, or its result where a chat sends only that. */
async function start(input: string) {
  if (opened) return;
  opened = true;
  void openFullscreen();
  if (input) await ai.openStructure(input);
  // Once the drawing has been painted (two frames on), so it never waits for them.
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => void loadRingParents(), 50)));
  ui.flash(input ? 'Edit the structure, then Send to chat or ask in the chat' : 'Draw your structure, then Send to chat or ask in the chat');
}
// The structure as given opens at once, unless the server draws more onto it (a scheme, arrows, steps): then its result does.
app.ontoolinput = ({ arguments: args }) => {
  if (args && ['reaction', 'arrows', 'disconnect', 'steps'].some((k) => args[k] !== undefined)) return;
  void start(typeof args?.structure === 'string' ? args.structure.trim() : '');
};
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
/**
 * While the editor is on screen and in use, each poll waits on the server
 * (up to this long) for the next update, which then arrives at once, and the
 * next poll follows straight away. A server or chat that can't hold a call
 * open falls back to the paced polls above.
 */
const LONG_WAIT = 15000;
let longPoll = true;
let inFlight = false;
const QUIET_AFTER = 2 * 60e3, IDLE_AFTER = 15 * 60e3, ASLEEP_AFTER = 30 * 60e3, HIDDEN_STOP_AFTER = 10 * 60e3;
/** While the hosted server is paused by its daily spending cap: check back this often, whatever the user does. */
const PAUSED_RETRY = 10 * 60e3;
let capped = false;
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
  if (!polling || capped) return;
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
    if (inFlight) return;
    inFlight = true;
    clearTimeout(pollTimer);
    const wait = longPoll && !document.hidden && Date.now() - lastActivity <= ASLEEP_AFTER ? LONG_WAIT : 0;
    let waited = false;
    try {
      let r;
      try { r = await app.callServerTool({ name: 'sketch_updates', arguments: { sketch: sketchId, since, ...(wait ? { wait } : {}) } }); } finally { inFlight = false; }
      const why = (r.structuredContent as { paused?: string } | undefined)?.paused;
      if (why) {
        if (!capped) ui.flash('HexSketch is paused: its daily usage limit was reached');
        capped = true;
        failures = 0;
        setLink('off', 'Paused: daily usage limit reached', why);
        schedulePoll(PAUSED_RETRY);
        return;
      }
      capped = false;
      if (r.isError) throw new Error((r.content?.[0] as { text?: string } | undefined)?.text ?? 'the chat returned an error');
      const sc = r.structuredContent as { live?: boolean; updates?: SketchUpdate[]; waits?: boolean } | undefined;
      if (!sc) throw new Error('the chat returned no structuredContent from sketch_updates');
      failures = 0;
      // An older server answers at once: back to paced polls.
      if (wait && !sc.waits) longPoll = false;
      waited = !!(wait && sc.waits);
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
        await ai.apply(u);
        if (u.step?.index === 0) first = { frame: ai.at, count: u.step.count };
        lastActivity = Date.now();
      }
      if (first) { ai.goTo(first.frame); ui.flash(`Step 1 of ${first.count}: Next is in Notes`); }
    } catch (err) {
      // A chat that won't hold the call open: paced polls from now on.
      if (wait) longPoll = false;
      failures += 1;
      const why = (err as Error)?.message ?? String(err);
      if (failures >= 2) setLink('off', `Not linked: ${why.slice(0, 60)}`, `The editor could not fetch the AI's updates: ${why}`);
    }
    if (failures) { schedulePoll(Math.min(30000, 2000 * 2 ** failures)); return; }
    const next = waited && !document.hidden ? 0 : pollDelay();
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
      const sent = Date.now();
      app.callServerTool({ name: 'sketch_sync', arguments: { sketch: sketchId, cdxml } }).then(() => {
        // A chat that runs the editor's calls one at a time holds this behind the waiting poll: stop waiting, so edits reach the AI promptly.
        if (inFlight && longPoll && Date.now() - sent > 4000) longPoll = false;
      }, () => {});
    }
  }, 800);
});

app.connect().then(() => {
  app.setupSizeChangedNotifications();
  setFullscreen(app.getHostContext()?.displayMode === 'fullscreen');
  fitFrame();
  keepClear();
}).catch((err) => {
  // Opened outside a chat (a preview, a test): the editor still works.
  console.warn('HexSketch: no MCP Apps host', err);
  setLink('off', 'Not in a chat', String(err));
});
