import '@hexsketch/web/style.css';
import './embed.css';
import { App } from '@modelcontextprotocol/ext-apps';
import { aiSummary, structureLink, HEXSKETCH_URL } from '@hexsketch/core';
import { readStructure } from '@hexsketch/agent';
import { nameMolecule } from '@hexsketch/naming';
import { mountApp, type AppApi } from '@hexsketch/web';

/**
 * HexSketch inside a chat (MCP Apps): the editor in the conversation, so the
 * chemist can draw or correct a structure and hand it to the AI.
 *
 * - The open_sketcher tool's `structure` argument, if any, opens in the editor.
 * - Every edit quietly updates the AI's context with the drawing (name,
 *   SMILES, formula, masses, link), so a question typed next is about what is
 *   drawn now.
 * - "Send to chat" posts the drawing as a message, which the AI answers.
 */

const app = new App({ name: 'HexSketch', version: '0.1.0' });

const send = { label: 'Send to chat', run: (ui: AppApi) => sendToChat(ui) };
const open = { label: 'Open in HexSketch', run: (ui: AppApi) => openInBrowser(ui) };
const expand = { label: 'Full screen', run: (ui: AppApi) => toggleFullscreen(ui) };
/** A failure while starting shows in the frame, so it reads as an error rather than an empty box. */
function showError(err: unknown) {
  const box = document.createElement('pre');
  box.style.cssText = 'margin:12px;padding:12px;border:1px solid #d33;border-radius:6px;background:#fff5f5;color:#900;font:12px/1.4 ui-monospace,monospace;white-space:pre-wrap';
  box.textContent = `HexSketch could not start here:\n${(err as Error)?.stack ?? String(err)}`;
  document.body.prepend(box);
}
window.addEventListener('error', (e) => showError(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

let ui: AppApi;
try {
  ui = mountApp({ zoom: 1.25, actions: [send, open, expand] });
  document.querySelector('.host-action')?.classList.add('primary');
} catch (err) {
  showError(err);
  throw err;
}

/** The drawing as text for the AI, or null when nothing is drawn. */
async function describe(): Promise<string | null> {
  const mol = ui.editor.doc.mol;
  if (!mol.atomCount) return null;
  const doc = ui.editor.doc;
  const link = await structureLink(mol, doc.style, doc.objects, doc.groups, HEXSKETCH_URL);
  return aiSummary(mol, { nameOf: (m) => nameMolecule(m).name, link });
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

async function toggleFullscreen(u: AppApi) {
  const modes = app.getHostContext()?.availableDisplayModes ?? [];
  if (!modes.includes('fullscreen')) { u.flash('This chat does not offer full screen; Open in HexSketch gives the full editor'); return; }
  const now = app.getHostContext()?.displayMode === 'fullscreen' ? 'inline' : 'fullscreen';
  const r = await app.requestDisplayMode({ mode: now });
  document.body.classList.toggle('fullscreen', r.mode === 'fullscreen');
}

// What the AI asked to open: from the tool's input, or from its result where a chat sends only that.
let opened = false;
async function openStructure(input: string) {
  if (opened) return;
  opened = true;
  if (!input) { ui.flash('Draw your structure, then Send to chat'); return; }
  try {
    const s = await readStructure(input);
    // SMILES and molfiles are laid out around the origin; drawings keep their place on the page.
    ui.load(s.mol, s.style, s.objects, { centre: s.format === 'smiles' || s.format === 'mol' || (s.format === 'link' && s.smiles !== undefined) });
    ui.flash('Edit the structure, then Send to chat');
  } catch (err) {
    ui.flash(`Could not open the structure: ${(err as Error).message}`);
  }
}
app.ontoolinput = ({ arguments: args }) => openStructure(typeof args?.structure === 'string' ? args.structure.trim() : '');
app.ontoolresult = (result) => {
  const s = (result.structuredContent as { structure?: unknown } | undefined)?.structure;
  void openStructure(typeof s === 'string' ? s.trim() : '');
};
app.onhostcontextchanged = (ctx) => {
  if (ctx.displayMode) document.body.classList.toggle('fullscreen', ctx.displayMode === 'fullscreen');
};

// Keep the AI's view of the drawing current, once editing pauses.
let timer = 0;
ui.editor.onChange(() => {
  clearTimeout(timer);
  timer = window.setTimeout(async () => {
    const text = await describe();
    if (text) app.updateModelContext({ content: [{ type: 'text', text: `The user's drawing in HexSketch, as it is now:\n\n${text}` }] }).catch(() => {});
  }, 800);
});

app.connect().then(() => app.setupSizeChangedNotifications()).catch((err) => {
  // Opened outside a chat (a preview, a test): the editor still works.
  console.warn('HexSketch: no MCP Apps host', err);
});
