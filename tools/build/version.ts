/**
 * The version shown in the editor's bottom right corner (issue #47), so a
 * tester can tell which build they have: the release, then the commit it was
 * built from, marked "dirty" when built with uncommitted changes.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

export function buildVersion(): string {
  const { version } = JSON.parse(readFileSync(new URL('../../packages/hexsketch/package.json', import.meta.url), 'utf8')) as { version: string };
  try {
    const git = (args: string) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return `v${version} (${git('rev-parse --short HEAD')}${git('status --porcelain') ? ', dirty' : ''})`;
  } catch {
    return `v${version}`;
  }
}
