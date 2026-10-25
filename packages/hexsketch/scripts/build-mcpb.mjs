// Builds the Claude Desktop extension, release/hexsketch.mcpb: the built package
// (dist, fonts, package.json) plus resvg, laid out as npm would install it, so
// the server finds its fonts and version the same way. Run after `npm run build`.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const pkgDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(pkgDir, '..', '..');
const out = join(pkgDir, 'mcpb-build');
const pkg = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(pkgDir, 'dist'), join(out, 'dist'), { recursive: true, filter: (f) => !f.endsWith('.d.ts') });
cpSync(join(pkgDir, 'fonts'), join(out, 'fonts'), { recursive: true });
for (const f of ['LICENSE', 'LICENSE-MIT']) cpSync(join(root, f), join(out, f));
writeFileSync(join(out, 'package.json'), `${JSON.stringify({ name: pkg.name, version: pkg.version, type: 'module', license: pkg.license }, null, 2)}\n`);

const resvg = dirname(createRequire(join(pkgDir, 'package.json')).resolve('@resvg/resvg-wasm/index_bg.wasm'));
cpSync(resvg, join(out, 'node_modules', '@resvg', 'resvg-wasm'), { recursive: true });

const manifest = JSON.parse(readFileSync(join(pkgDir, 'mcpb', 'manifest.json'), 'utf8'));
manifest.version = pkg.version;
writeFileSync(join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// The icon: hexsketch.com's favicon at 512 px, drawn with the package's own rasterizer.
const { rasterize } = await import(join(out, 'dist', 'png.js'));
const svg = readFileSync(join(root, 'apps', 'web', 'public', 'favicon.svg'), 'utf8');
writeFileSync(join(out, 'icon.png'), await rasterize(svg, 16));

const mcpb = join(root, 'node_modules', '.bin', 'mcpb');
execFileSync(mcpb, ['validate', join(out, 'manifest.json')], { stdio: 'inherit' });
mkdirSync(join(pkgDir, 'release'), { recursive: true });
execFileSync(mcpb, ['pack', out, join(pkgDir, 'release', 'hexsketch.mcpb')], { stdio: 'inherit' });
