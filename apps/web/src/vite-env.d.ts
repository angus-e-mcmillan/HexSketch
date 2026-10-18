/** What Vite puts on import.meta.env (replaced with literals at build time). */
interface ImportMeta {
  readonly env: { readonly DEV: boolean };
}
