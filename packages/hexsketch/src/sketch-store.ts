/**
 * The open editors ("sketches") the AI and the editors share. The model's
 * tool calls and the editor's may reach HexSketch through different
 * connections, even different processes (Claude Desktop does this), so the
 * state lives in a store rather than in one server's memory.
 */

/** What the AI asked an open editor to show; the editor fetches these with sketch_updates. */
export interface SketchUpdate {
  version: number;
  /** Replaces the drawing. */
  structure?: string;
  /** Atoms and bonds to highlight in the drawing (after any new structure), replacing earlier AI highlights. */
  highlights?: { smiles: string; color: string; name: string }[];
  note?: string;
}

export interface Sketch {
  id: string;
  /** The AI's updates, oldest first; an update's version is its position, from 1. */
  updates: SketchUpdate[];
  /** The drawing as the server last heard it: the opened structure, the AI's latest, or the user's (CDXML). */
  drawing: string;
}

export interface SketchStore {
  /** Open a new sketch, which becomes the latest. */
  create(drawing: string): Promise<Sketch>;
  get(id: string): Promise<Sketch | null>;
  /** The sketch opened last, if any. */
  latest(): Promise<string | null>;
  /** Record an update (its version is assigned here) and, with a structure, the new drawing. */
  addUpdate(id: string, update: Omit<SketchUpdate, 'version'>): Promise<SketchUpdate>;
  setDrawing(id: string, drawing: string): Promise<void>;
  /** The editor showing this sketch is on screen now (it asks for updates every few seconds). */
  seen(id: string): Promise<void>;
  /** The latest sketch, if its editor was on screen within the last `withinMs`. */
  live(withinMs: number): Promise<string | null>;
}

/** A store in this process's memory: for tests, and servers that are one process with one connection. */
export function memorySketchStore(): SketchStore {
  const sketches = new Map<string, Sketch>();
  const seenAt = new Map<string, number>();
  let last: string | null = null;
  return {
    async create(drawing) {
      const s = { id: crypto.randomUUID(), updates: [], drawing };
      sketches.set(s.id, s);
      last = s.id;
      return structuredClone(s);
    },
    async get(id) { const s = sketches.get(id); return s ? structuredClone(s) : null; },
    async latest() { return last; },
    async addUpdate(id, update) {
      const s = sketches.get(id);
      if (!s) throw new Error('That HexSketch editor is no longer open: call open_sketcher.');
      const u = { version: s.updates.length + 1, ...update };
      s.updates.push(u);
      if (update.structure) s.drawing = update.structure;
      return u;
    },
    async setDrawing(id, drawing) { const s = sketches.get(id); if (s) s.drawing = drawing; },
    async seen(id) { if (sketches.has(id)) seenAt.set(id, Date.now()); },
    async live(withinMs) { return last && Date.now() - (seenAt.get(last) ?? 0) <= withinMs ? last : null; },
  };
}
