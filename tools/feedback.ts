/**
 * Print feedback sent from File > Send Feedback, newest first. Reads the
 * FEEDBACK KV namespace from apps/web/wrangler.jsonc with wrangler (log in
 * with `npx wrangler login`; set CLOUDFLARE_ACCOUNT_ID if you have several accounts).
 *
 *   npm run feedback            all messages
 *   npm run feedback -- 10      the latest 10
 */
import { execFileSync } from 'node:child_process';

const limit = Number(process.argv[2]) || Infinity;
// Anyone can send feedback: drop control characters (keeping newlines and tabs)
// so a message can't send escape sequences to this terminal.
const clean = (s: string) => s.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
const wrangler = (args: string[]) => execFileSync('npx', ['--yes', 'wrangler@4', ...args, '--binding', 'FEEDBACK', '--config', 'apps/web/wrangler.jsonc', '--remote'], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
});

const keys = (JSON.parse(wrangler(['kv', 'key', 'list', '--prefix', 'feedback:'])) as { name: string }[])
  .map((k) => k.name).sort().reverse().slice(0, limit);
if (!keys.length) console.log('No feedback yet.');
for (const key of keys) {
  const f = JSON.parse(wrangler(['kv', 'key', 'get', key, '--text'])) as { at: string; message: string; email: string | null; context: string | null };
  console.log(`-- ${f.at.replace('T', ' ').slice(0, 16)}${f.email ? `  ${clean(f.email)}` : ''}`);
  console.log(clean(f.message));
  if (f.context) console.log(`   (${clean(f.context)})`);
  console.log('');
}
