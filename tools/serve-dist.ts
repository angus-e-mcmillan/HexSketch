/**
 * Serve a static build as a host would, applying its _headers file (Cloudflare
 * Pages / Netlify syntax), to try the hosted version locally.
 * Usage: node --experimental-strip-types tools/serve-dist.ts [dir] [port]
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const dir = process.argv[2] ?? 'apps/web/dist';
const port = Number(process.argv[3] ?? 5180);
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.txt': 'text/plain' };

/** _headers rules: a path pattern line followed by indented "Name: value" lines. */
const rules: { pattern: RegExp; headers: [string, string][] }[] = [];
const file = join(dir, '_headers');
if (existsSync(file)) {
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) rules.push({ pattern: new RegExp(`^${line.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`), headers: [] });
    else { const i = line.indexOf(':'); rules[rules.length - 1]?.headers.push([line.slice(0, i).trim(), line.slice(i + 1).trim()]); }
  }
}

createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x').pathname;
  let path = normalize(join(dir, url));
  if (!path.startsWith(normalize(dir))) { res.writeHead(403).end(); return; }
  if (!existsSync(path) || statSync(path).isDirectory()) path = join(dir, 'index.html');
  for (const r of rules) if (r.pattern.test(url)) for (const [k, v] of r.headers) res.setHeader(k, v);
  res.setHeader('Content-Type', TYPES[extname(path)] ?? 'application/octet-stream');
  res.end(readFileSync(path));
}).listen(port, () => console.log(`Serving ${dir} at http://localhost:${port}/`));
