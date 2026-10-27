import { DurableObject } from 'cloudflare:workers';
import type { Sketch as SketchData, SketchStore, SketchUpdate } from '../../../packages/hexsketch/src/sketch-store.ts';

/**
 * Open editors for the hosted server. Every request may reach a new Worker
 * instance, so nothing lives in the Worker itself: each editor is a Sketch
 * (a Durable Object holding its drawing and the AI's updates), and each MCP
 * session a Conversation (which editor it opened last). The model's calls
 * and the editor's may arrive through different sessions; both name the
 * sketch, so they meet in the same Sketch. Both delete themselves a day
 * after they were last used.
 */

const DAY = 24 * 3600e3;
/** The longest an editor's poll waits for an update. */
const MAX_WAIT = 20_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export class Sketch extends DurableObject {
  /** When the editor last asked for updates: kept in memory only, since an editor on screen asks every few seconds. */
  #seenAt = 0;
  /** Editors waiting for the next update (a long poll), woken by addUpdate. */
  #waiting = new Set<() => void>();

  async create(id: string, drawing: string): Promise<void> {
    await this.ctx.storage.put({ id, drawing, count: 0 });
    await this.ctx.storage.setAlarm(Date.now() + DAY);
  }

  async read(): Promise<SketchData | null> {
    const got = await this.ctx.storage.get<unknown>(['id', 'drawing']);
    const id = got.get('id') as string | undefined;
    if (!id) return null;
    const updates = [...(await this.ctx.storage.list<SketchUpdate>({ prefix: 'u:' })).values()];
    return { id, drawing: (got.get('drawing') as string | undefined) ?? '', updates };
  }

  async addUpdate(update: Omit<SketchUpdate, 'version'>): Promise<SketchUpdate | null> {
    const count = await this.ctx.storage.get<number>('count');
    if (count === undefined) return null;
    const u = { version: count + 1, ...update };
    // One key per update (zero-padded, so they list in order): a value may hold at most 2 MB.
    await this.ctx.storage.put<unknown>({ count: u.version, [`u:${String(u.version).padStart(6, '0')}`]: u, ...(update.structure ? { drawing: update.structure } : {}) });
    await this.ctx.storage.setAlarm(Date.now() + DAY);
    for (const wake of [...this.#waiting]) wake();
    return u;
  }

  async setDrawing(drawing: string): Promise<void> {
    if ((await this.ctx.storage.get<string>('id')) === undefined) return;
    await this.ctx.storage.put('drawing', drawing);
    await this.ctx.storage.setAlarm(Date.now() + DAY);
  }

  /**
   * An editor polling: one call per poll (each call to a Durable Object is
   * billed), only the updates it hasn't had. With nothing new, it waits up
   * to `waitMs` for the next update, so what the AI shows arrives at once.
   */
  async poll(since: number, waitMs = 0): Promise<{ live: boolean; updates: SketchUpdate[] }> {
    const count = await this.ctx.storage.get<number>('count');
    if (count === undefined) return { live: false, updates: [] };
    this.#seenAt = Date.now();
    if (count <= since && waitMs > 0) {
      await new Promise<void>((resolve) => {
        const wake = () => { clearTimeout(timer); this.#waiting.delete(wake); resolve(); };
        const timer = setTimeout(wake, Math.min(waitMs, MAX_WAIT));
        this.#waiting.add(wake);
      });
      this.#seenAt = Date.now();
    }
    const start = `u:${String(Math.max(0, Math.floor(since)) + 1).padStart(6, '0')}`;
    return { live: true, updates: [...(await this.ctx.storage.list<SketchUpdate>({ prefix: 'u:', start })).values()] };
  }

  async seen(): Promise<void> { this.#seenAt = Date.now(); }
  async seenAt(): Promise<number> { return this.#seenAt; }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}

export class Conversation extends DurableObject {
  async setLatest(id: string): Promise<void> {
    await this.ctx.storage.put('latest', id);
    await this.ctx.storage.setAlarm(Date.now() + DAY);
  }
  async latest(): Promise<string | null> { return (await this.ctx.storage.get<string>('latest')) ?? null; }
  async alarm(): Promise<void> { await this.ctx.storage.deleteAll(); }
}

/** A Durable Object namespace, as far as this Worker uses it. */
interface Namespace<T> { idFromName(name: string): unknown; get(id: unknown): T }
export interface SketchEnv {
  SKETCHES: Namespace<Pick<Sketch, 'create' | 'read' | 'addUpdate' | 'setDrawing' | 'poll' | 'seen' | 'seenAt'>>;
  CONVERSATIONS: Namespace<Pick<Conversation, 'setLatest' | 'latest'>>;
}

/** The SketchStore for one request: sketches shared by all, "latest" and "live" for this conversation only (none without one). */
export function hostedSketchStore(env: SketchEnv, conversation: string | null): SketchStore {
  const sketch = (id: string) => {
    // Only our ids name Durable Objects.
    if (!UUID.test(id)) throw new Error('That HexSketch editor is no longer open: call open_sketcher.');
    return env.SKETCHES.get(env.SKETCHES.idFromName(id));
  };
  const convo = conversation ? env.CONVERSATIONS.get(env.CONVERSATIONS.idFromName(conversation)) : null;
  const latest = async () => (convo ? convo.latest() : null);
  return {
    async create(drawing) {
      const id = crypto.randomUUID();
      await sketch(id).create(id, drawing);
      await convo?.setLatest(id);
      return { id, drawing, updates: [] };
    },
    async get(id) { return UUID.test(id) ? sketch(id).read() : null; },
    latest,
    async addUpdate(id, update) {
      const u = await sketch(id).addUpdate(update);
      if (!u) throw new Error('That HexSketch editor is no longer open: call open_sketcher.');
      return u;
    },
    async setDrawing(id, drawing) { await sketch(id).setDrawing(drawing); },
    async seen(id) { await sketch(id).seen(); },
    async poll(id, since, waitMs) { return UUID.test(id) ? sketch(id).poll(since, waitMs) : { live: false, updates: [] }; },
    async live(withinMs) {
      const id = await latest();
      if (!id) return null;
      return Date.now() - (await sketch(id).seenAt()) <= withinMs ? id : null;
    },
  };
}
