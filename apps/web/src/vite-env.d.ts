/** What Vite puts on import.meta.env (replaced with literals at build time). */
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}

/** The release and commit the editor was built from (vite.config.ts); not defined outside a Vite build. */
declare const __HEXSKETCH_VERSION__: string | undefined;
