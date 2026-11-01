import './chat.css';
import { aiSummary, structureLink, writeCdxml, HEXSKETCH_URL } from '@hexsketch/core';
import { analyze, compare, convert, drawnOut, link, name, validate } from '@hexsketch/agent';
import { nameMolecule } from '@hexsketch/naming';
import { pageTools, prepare, prepareSteps, HIGHLIGHTS, PAGE_INSTRUCTIONS, SHOWN_NEXT, type Show } from '../../../packages/hexsketch/src/toolkit.ts';
import { createAiLayer, formatted, type AiLayer } from './ai.ts';
import type { AppApi } from './app.ts';
import * as openrouter from './openrouter.ts';

/**
 * Ask AI: a chat beside the editor on hexsketch.com. The model (any on
 * OpenRouter, on the user's own account) works the editor with the same
 * tools, instructions and display as in Claude (packages/hexsketch/src/
 * toolkit.ts, ai.ts); they run here, in the page. Loaded only when the user
 * first opens it.
 */

const MODEL = 'hexsketch.aiModel';
/** Tool rounds per message before the model has to answer. */
const MAX_ROUNDS = 10;

const tools = pageTools();
/** A reply's "**yellow**" in that highlight's colour, as in Notes. */
const COLOURS = new Map<string, string>(HIGHLIGHTS.map((h) => [h.name, h.color]));
/** What each tool is doing, for the line the chat shows while it works. */
const DOING: Record<string, string> = {
  show_in_sketcher: 'Drawing in the editor', read_sketcher: 'Reading your drawing', name_structure: 'Naming',
  analyze_structure: 'Analysing', validate_structure: 'Checking a structure', compare_structures: 'Comparing', convert_structure: 'Converting',
};

let chat: Chat | null = null;

/** Open the chat, or close it if it is open. */
export function toggleChat(ui: AppApi): void {
  chat ??= new Chat(ui);
  chat.toggle();
}

class Chat {
  private readonly el = document.createElement('aside');
  private readonly list: HTMLOListElement;
  private readonly input: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly model: HTMLSelectElement;
  private readonly ai: AiLayer;
  private messages: openrouter.Message[] = [{ role: 'system', content: PAGE_INSTRUCTIONS }];
  /** The drawing as the model last saw it, so a message only carries it when it has changed. */
  private lastSeen: string | null = null;
  private busy: AbortController | null = null;
  /** Takes away the status line of the turn under way. */
  private stopStatus = () => {};
  private readonly ui: AppApi;

  constructor(ui: AppApi) {
    this.ui = ui;
    this.ai = createAiLayer(ui);
    this.el.className = 'chat';
    this.el.setAttribute('aria-label', 'Ask AI');
    this.el.innerHTML = `
      <header><span class="title">Ask AI</span><select class="model" aria-label="Model"></select>
        <button type="button" class="new" title="New chat">New</button><button type="button" class="close" title="Close" aria-label="Close">×</button></header>
      <section class="signin">
        <p><strong>Talk to an AI about your structures.</strong> It sees what you draw, and answers by drawing: highlights, labels, reactions and mechanisms, right here in the editor.</p>
        <p>The chat runs on <a href="https://openrouter.ai" target="_blank" rel="noopener">OpenRouter</a>: one account for Claude, GPT, Gemini and open models. You pay OpenRouter for what you use, usually a few cents a question.</p>
        <button type="button" class="primary signin-button">Sign in with OpenRouter</button>
        <details><summary>Or paste an OpenRouter API key</summary><form class="key"><input type="password" placeholder="sk-or-…" autocomplete="off" aria-label="OpenRouter API key"><button type="submit">Use key</button></form></details>
        <p class="fineprint">Your messages and your drawing go from this browser to OpenRouter and the model you pick, not to HexSketch. The key stays in this browser.</p>
      </section>
      <ol class="messages" aria-live="polite"></ol>
      <form class="compose"><textarea rows="2" placeholder="Ask about your structure, or what to draw…" aria-label="Message"></textarea><button type="submit" class="primary">Send</button></form>
      <p class="fineprint account">Through OpenRouter, on your account · <button type="button" class="signout">Sign out</button></p>`;
    document.querySelector('.workspace')!.append(this.el);
    this.list = this.el.querySelector('.messages')!;
    this.input = this.el.querySelector('textarea')!;
    this.sendButton = this.el.querySelector('.compose button')!;
    this.model = this.el.querySelector('.model')!;

    this.el.querySelector('.close')!.addEventListener('click', () => this.toggle(false));
    this.el.querySelector('.new')!.addEventListener('click', () => this.reset());
    this.el.querySelector('.signin-button')!.addEventListener('click', async () => {
      if (!(await openrouter.signIn())) this.ui.flash('Your browser blocked the sign-in window: allow pop-ups for hexsketch.com, or paste a key');
    });
    this.el.querySelector<HTMLFormElement>('.key')!.addEventListener('submit', (e) => {
      e.preventDefault();
      const field = this.el.querySelector<HTMLInputElement>('.key input')!;
      openrouter.setApiKey(field.value);
      field.value = '';
    });
    this.el.querySelector('.signout')!.addEventListener('click', () => openrouter.setApiKey(null));
    openrouter.onKeyChange(() => this.showSignedIn());
    this.el.querySelector<HTMLFormElement>('.compose')!.addEventListener('submit', (e) => { e.preventDefault(); void this.send(); });
    this.input.addEventListener('keydown', (e) => {
      // Enter sends, Shift+Enter starts a new line; keys typed here are not the editor's shortcuts.
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); void this.send(); }
      e.stopPropagation();
    });
    this.model.addEventListener('change', () => { try { localStorage.setItem(MODEL, this.model.value); } catch { /* not kept */ } });
    void this.loadModels();
    this.showSignedIn();
  }

  toggle(open = !document.body.classList.contains('chat-open')): void {
    document.body.classList.toggle('chat-open', open);
    if (open) (openrouter.apiKey() ? this.input : this.el.querySelector<HTMLElement>('.signin-button')!).focus();
    this.ui.reveal();
  }

  private showSignedIn(): void {
    const signedIn = !!openrouter.apiKey();
    this.el.classList.toggle('signed-in', signedIn);
    if (signedIn && document.body.classList.contains('chat-open')) this.input.focus();
  }

  private async loadModels(): Promise<void> {
    let models: openrouter.Model[];
    try { models = await openrouter.toolModels(); } catch (err) { this.say('error', (err as Error).message); return; }
    const top = openrouter.suggested(models);
    const option = (m: openrouter.Model) => Object.assign(document.createElement('option'), { value: m.id, textContent: m.free ? `${m.name} (free)` : m.name });
    const group = (label: string, list: openrouter.Model[]) => {
      const g = Object.assign(document.createElement('optgroup'), { label });
      g.append(...list.map(option));
      return g;
    };
    this.model.replaceChildren(group('Suggested', top), group('All models that use tools', models));
    let kept: string | null = null;
    try { kept = localStorage.getItem(MODEL); } catch { /* none */ }
    this.model.value = kept && models.some((m) => m.id === kept) ? kept : top[0]?.id ?? models[0]?.id ?? '';
  }

  private reset(): void {
    this.busy?.abort();
    this.messages = [{ role: 'system', content: PAGE_INSTRUCTIONS }];
    this.lastSeen = null;
    this.list.replaceChildren();
    this.input.focus();
  }

  /** A line in the chat: the user's message, the AI's reply, what a tool is doing, or an error. */
  private say(kind: 'user' | 'ai' | 'doing' | 'error' | 'cost', text: string): HTMLLIElement {
    const li = Object.assign(document.createElement('li'), { className: kind });
    if (kind === 'ai') li.append(formatted(text, COLOURS));
    else li.textContent = text;
    this.list.append(li);
    li.scrollIntoView({ block: 'end' });
    return li;
  }

  /** The drawing as text for the model, or null when nothing is drawn (as the in-chat editor tells Claude). */
  private async describe(): Promise<string | null> {
    const doc = this.ui.editor.doc;
    if (!doc.mol.atomCount) return null;
    const url = await structureLink(doc.mol, doc.style, doc.objects, doc.groups, HEXSKETCH_URL);
    return aiSummary(drawnOut(doc.mol, doc.style), { nameOf: (m) => nameMolecule(m).name, link: url });
  }

  /** The drawing as a document (CDXML), as the MCP server keeps it, for show_in_sketcher to work on. */
  private drawing(): string {
    const doc = this.ui.editor.doc;
    return doc.mol.atomCount || doc.objects.length ? writeCdxml(doc.mol, doc.style, doc.objects, { page: doc.page, groups: doc.groups }) : '';
  }

  private async send(): Promise<void> {
    // While it works, the button stops it.
    if (this.busy) { this.busy.abort(); return; }
    const text = this.input.value.trim();
    if (!text) return;
    if (!openrouter.apiKey()) { this.showSignedIn(); return; }
    if (!this.model.value) { this.ui.flash('Pick a model first'); return; }
    this.input.value = '';
    this.say('user', text);
    // The drawing goes along when it has changed since the model last saw it.
    const now = await this.describe();
    const seen = now ?? '';
    const context = seen !== (this.lastSeen ?? '') ? `\n\n${now ? `What the editor shows now:\n${now}` : 'The editor is now empty.'}` : '';
    this.lastSeen = seen;
    this.messages.push({ role: 'user', content: text + context });

    this.busy = new AbortController();
    this.el.classList.add('busy');
    this.sendButton.textContent = 'Stop';
    // One status line at the bottom, with the time so far, so a slow model never looks stuck.
    const status = this.say('doing', 'Thinking…');
    const started = Date.now();
    let doing = 'Thinking';
    const tick = () => { status.textContent = `${doing}… ${Math.round((Date.now() - started) / 1000)} s`; };
    const timer = setInterval(tick, 1000);
    const toBottom = () => { this.list.append(status); status.scrollIntoView({ block: 'end' }); };
    // What the whole answer cost, every round of it, on the user's OpenRouter account.
    let cost = 0;
    this.stopStatus = () => { clearInterval(timer); status.remove(); };
    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        doing = 'Thinking';
        tick();
        // The reply appears as the model writes it, then is set out properly (bold, lists, colours) when it ends.
        const view: { bubble?: HTMLLIElement } = {};
        const reply = await openrouter.complete(this.model.value, this.messages, tools, {
          signal: this.busy.signal,
          onCost: (usd) => { cost += usd; },
          onText: (soFar) => {
            view.bubble ??= Object.assign(document.createElement('li'), { className: 'ai' });
            view.bubble.textContent = soFar;
            this.list.append(view.bubble);
            toBottom();
          },
        });
        this.messages.push(reply);
        const final = reply.content?.trim();
        if (final) {
          view.bubble ??= Object.assign(document.createElement('li'), { className: 'ai' });
          view.bubble.replaceChildren(formatted(final, COLOURS));
          this.list.append(view.bubble);
        } else view.bubble?.remove();
        if (!reply.tool_calls?.length) break;
        for (const call of reply.tool_calls) {
          doing = DOING[call.function.name] ?? call.function.name;
          this.say('doing', `${doing}…`);
          toBottom();
          tick();
          const result = await this.run(call.function.name, call.function.arguments);
          this.messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
        }
        toBottom();
      }
      const took = Math.round((Date.now() - started) / 1000);
      this.say('cost', `${this.model.selectedOptions[0]?.textContent ?? this.model.value} · ${took} s${cost ? ` · $${cost < 0.01 ? cost.toFixed(4) : cost.toFixed(3)}` : ''}`);
      // What the AI drew it knows already: only the user's own changes go with the next message.
      this.lastSeen = (await this.describe()) ?? '';
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        this.say('error', (err as Error).message);
        if (err instanceof openrouter.OpenRouterError && err.signOut) openrouter.setApiKey(null);
      }
    } finally {
      this.stopStatus();
      this.busy = null;
      this.el.classList.remove('busy');
      this.sendButton.textContent = 'Send';
    }
  }

  /** Run one of the model's tool calls here, in the page; a mistake goes back to the model to fix, as an MCP tool error does. */
  private async run(tool: string, json: string): Promise<unknown> {
    let args: Record<string, unknown>;
    try { args = JSON.parse(json || '{}') as Record<string, unknown>; } catch { return { error: 'The arguments were not valid JSON' }; }
    try {
      const s = args.structure as string;
      switch (tool) {
        case 'show_in_sketcher': return await this.show(args as Show & { steps?: Show[] });
        case 'read_sketcher': {
          const now = this.drawing();
          this.lastSeen = (await this.describe()) ?? '';
          return now ? { ...(await analyze(now)), link: await link(now) } : { empty: true, note: 'The canvas is empty.' };
        }
        case 'name_structure': return { ...(await name(s)), link: await link(s) };
        case 'analyze_structure': return { ...(await analyze(s)), link: await link(s) };
        case 'validate_structure': { const v = await validate(s); return v.smiles !== undefined ? { ...v, link: await link(s) } : v; }
        case 'compare_structures': return await compare(args.a as string, args.b as string);
        case 'convert_structure': return { result: await convert(s, args.to as 'smiles' | 'mol' | 'cdxml' | 'link') };
        default: return { error: `There is no tool called ${tool}` };
      }
    } catch (err) {
      return { error: (err as Error).message };
    }
  }

  /** show_in_sketcher, as the MCP server does it, shown straight in this editor. */
  private async show(args: Show & { steps?: Show[] }): Promise<unknown> {
    const { steps, ...one } = args;
    const current = this.drawing();
    const before = this.ui.editor.doc.mol.atomCount ? this.ui.editor.doc.mol.clone() : undefined;
    if (steps) {
      if (Object.values(one).some((v) => v !== undefined)) throw new Error('Give steps, or the fields of one step, not both');
      const { updates, report } = await prepareSteps(steps, before, current);
      // Steps open at the first, for the user to step through.
      let first = -1;
      for (const u of updates) { await this.ai.apply(u); if (u.step?.index === 0) first = this.ai.at; }
      if (first >= 0) this.ai.goTo(first);
      return { shown: true, ...report };
    }
    const { update, report } = await prepare(one, before, current);
    await this.ai.apply(update);
    return { shown: true, ...report, next: SHOWN_NEXT };
  }
}
