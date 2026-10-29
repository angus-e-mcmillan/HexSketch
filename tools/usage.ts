/**
 * Print what the Cloudflare account has used today (UTC), priced as the
 * hosted server's daily spending cap prices it (apps/mcp-worker/src/budget.ts).
 * Also checks the token you give the cap. Needs CLOUDFLARE_API_TOKEN (Account
 * Analytics: Read) and CLOUDFLARE_ACCOUNT_ID.
 *
 *   npm run usage               today
 *   npm run usage -- 2026-10-28 another day
 */
import { usageOn } from '../apps/mcp-worker/src/usage.ts';

const { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = process.env;
if (!token || !account) { console.error('Set CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID.'); process.exit(1); }
const date = process.argv[2] ?? new Date().toISOString().slice(0, 10);
const u = await usageOn(token, account, date);
console.log(`${date} (UTC)
  Worker requests          ${u.requests.toLocaleString()}
  Worker CPU               ${Math.round(u.cpuMs).toLocaleString()} ms
  Durable Object requests  ${u.objectRequests.toLocaleString()}
  Durable Object duration  ${Math.round(u.gbSeconds).toLocaleString()} GB-s
  At most                  $${u.usd.toFixed(2)}`);
