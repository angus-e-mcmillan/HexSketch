// What wrangler's module rules (wrangler.jsonc) make of these imports.
declare module '*.wasm' { const module: WebAssembly.Module; export default module; }
declare module '*.ttf' { const data: ArrayBuffer; export default data; }
declare module '*.html' { const text: string; export default text; }

// The parts of the Workers runtime this Worker uses.
declare module 'cloudflare:workers' {
  export interface DurableObjectStorage {
    get<T>(key: string): Promise<T | undefined>;
    get<T>(keys: string[]): Promise<Map<string, T>>;
    put<T>(key: string, value: T): Promise<void>;
    put<T>(entries: Record<string, T>): Promise<void>;
    list<T>(options: { prefix: string; start?: string }): Promise<Map<string, T>>;
    deleteAll(): Promise<void>;
    setAlarm(when: number): Promise<void>;
  }
  export interface DurableObjectState { storage: DurableObjectStorage }
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }
}
