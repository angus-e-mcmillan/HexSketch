import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Sketch, SketchStore, SketchUpdate } from './sketch-store.ts';

/**
 * Sketches in a folder, shared by every HexSketch process on this computer:
 * Claude Desktop may start one for the model's tool calls and reach another
 * for the editor's. Each kind of write has its own file, so the processes
 * don't overwrite each other: <id>.updates.json (the AI's), <id>.drawing (the
 * latest drawing), <id>.seen (when its editor was last on screen), and
 * `latest`. Files are replaced whole (write, then rename). Sketches untouched
 * for a day are removed.
 */
export function createSketchStore(dir: string): SketchStore & { dir: string } {
  mkdirSync(dir, { recursive: true });
  const file = (id: string, kind: string) => {
    // Ids come from editors and the model: only ours (UUIDs) name files.
    if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('not a sketch id');
    return join(dir, `${id}.${kind}`);
  };
  const write = (path: string, text: string) => {
    const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}`;
    writeFileSync(tmp, text);
    renameSync(tmp, path);
  };
  const readUpdates = (id: string): SketchUpdate[] => {
    try { return JSON.parse(readFileSync(file(id, 'updates.json'), 'utf8')) as SketchUpdate[]; } catch { return []; }
  };
  const prune = () => {
    const day = Date.now() - 24 * 3600e3;
    for (const f of readdirSync(dir)) {
      try { if (f !== 'latest' && statSync(join(dir, f)).mtimeMs < day) rmSync(join(dir, f)); } catch { /* another process got there first */ }
    }
  };
  const get = async (id: string): Promise<Sketch | null> => {
    let drawing: string;
    try { drawing = readFileSync(file(id, 'drawing'), 'utf8'); } catch { return null; }
    return { id, drawing, updates: readUpdates(id) };
  };
  const latest = async (): Promise<string | null> => {
    try { const id = readFileSync(join(dir, 'latest'), 'utf8').trim(); return existsSync(file(id, 'drawing')) ? id : null; } catch { return null; }
  };
  return {
    dir,
    async create(drawing) {
      prune();
      const id = crypto.randomUUID();
      write(file(id, 'drawing'), drawing);
      write(join(dir, 'latest'), id);
      return { id, drawing, updates: [] };
    },
    get,
    latest,
    async addUpdate(id, update) {
      if (!(await get(id))) throw new Error('That HexSketch editor is no longer open: call open_sketcher.');
      const updates = readUpdates(id);
      const u = { version: updates.length + 1, ...update };
      write(file(id, 'updates.json'), JSON.stringify([...updates, u]));
      if (update.structure) write(file(id, 'drawing'), update.structure);
      return u;
    },
    async setDrawing(id, drawing) {
      if (existsSync(file(id, 'drawing'))) write(file(id, 'drawing'), drawing);
    },
    async seen(id) {
      if (existsSync(file(id, 'drawing'))) write(file(id, 'seen'), String(Date.now()));
    },
    async live(withinMs) {
      const id = await latest();
      if (!id) return null;
      try { return Date.now() - statSync(file(id, 'seen')).mtimeMs <= withinMs ? id : null; } catch { return null; }
    },
  };
}
