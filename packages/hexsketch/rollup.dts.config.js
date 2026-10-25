import { dts } from 'rollup-plugin-dts';

// Type declarations for the published entry points, with HexSketch's own
// packages folded in (they are not published separately).
export default ['index', 'png'].map((name) => ({
  input: `src/${name}.ts`,
  output: { file: `dist/${name}.d.ts`, format: 'es' },
  plugins: [dts({ respectExternal: true, compilerOptions: { allowImportingTsExtensions: true } })],
  external: [/^node:/, '@resvg/resvg-wasm'],
}));
