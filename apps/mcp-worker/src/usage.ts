/**
 * What the Cloudflare account has used on a day, priced: for the daily
 * spending cap (budget.ts) and `npm run usage`. The price is an
 * overestimate: what that use would cost if the plan included nothing.
 * Storage is left out; this app stores little.
 */

/** Workers Paid prices in USD, October 2026. */
const PRICE = { request: 0.30e-6, cpuMs: 0.02e-6, objectRequest: 0.15e-6, gbSecond: 12.5e-6 };
/** Durable Object duration is billed at 128 MB per object. */
const OBJECT_GB = 0.125;

export interface Usage { requests: number; cpuMs: number; objectRequests: number; gbSeconds: number; usd: number }

/** The account's use so far on `date` (YYYY-MM-DD, UTC), from the GraphQL Analytics API. */
export async function usageOn(token: string, account: string, date: string): Promise<Usage> {
  const filter = `{ date_geq: "${date}", date_leq: "${date}" }`;
  const query = `{ viewer { accounts(filter: { accountTag: ${JSON.stringify(account)} }) {
    workers: workersInvocationsAdaptive(limit: 100, filter: ${filter}) { sum { requests cpuTimeUs } }
    objects: durableObjectsInvocationsAdaptiveGroups(limit: 100, filter: ${filter}) { sum { requests } }
    periodic: durableObjectsPeriodicGroups(limit: 100, filter: ${filter}) { sum { activeTime } }
  } } }`;
  const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  type Rows = { sum: Record<string, number | null> }[];
  const json = (await res.json().catch(() => null)) as { data?: { viewer?: { accounts?: Record<string, Rows>[] } }; errors?: { message: string }[] } | null;
  if (!res.ok || json?.errors?.length) throw new Error(`analytics: ${json?.errors?.map((e) => e.message).join('; ') || res.status}`);
  const got = json?.data?.viewer?.accounts?.[0];
  if (!got) throw new Error('analytics: no such account, or the token lacks Account Analytics: Read');
  const sum = (rows: Rows | undefined, key: string) => (rows ?? []).reduce((n, r) => n + (r.sum[key] ?? 0), 0);
  const requests = sum(got.workers, 'requests');
  const cpuMs = sum(got.workers, 'cpuTimeUs') / 1000;
  const objectRequests = sum(got.objects, 'requests');
  const gbSeconds = sum(got.periodic, 'activeTime') / 1e6 * OBJECT_GB;
  const usd = requests * PRICE.request + cpuMs * PRICE.cpuMs + objectRequests * PRICE.objectRequest + gbSeconds * PRICE.gbSecond;
  return { requests, cpuMs, objectRequests, gbSeconds, usd };
}
