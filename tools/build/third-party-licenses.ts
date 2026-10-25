import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { OutputBundle } from 'rollup';

/**
 * The licence of every npm package bundled into a build, as their licences
 * require the notices to travel with the code. HexSketch's own packages are
 * not under node_modules once resolved, so they are not listed.
 */
export function thirdPartyLicenses(bundle: OutputBundle): string {
  const dirs = new Set<string>();
  for (const out of Object.values(bundle)) {
    if (out.type !== 'chunk') continue;
    for (const id of Object.keys(out.modules)) {
      // CommonJS wrappers are virtual modules: "\0" in front, "?commonjs-..." after.
      const m = /^(.*[\\/]node_modules[\\/](?:@[^\\/]+[\\/])?[^\\/]+)[\\/]/.exec(id.replace(/^\0/, '').replace(/\?.*$/, ''));
      if (m) dirs.add(m[1]!);
    }
  }
  const sections = [...dirs].map((dir) => {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { name: string; version: string; license?: string };
    const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
    if (!file) throw new Error(`No licence file in bundled package ${pkg.name}`);
    return `${pkg.name} ${pkg.version} (${pkg.license ?? 'see below'})\n\n${readFileSync(join(dir, file), 'utf8').trim()}`;
  }).sort();
  return `Third-party code bundled into this build\n\n${sections.join(`\n\n${'-'.repeat(72)}\n\n`)}\n`;
}
