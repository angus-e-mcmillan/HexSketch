import { DurableObject } from 'cloudflare:workers';
import { usageOn } from './usage.ts';

/**
 * The daily spending cap. Cloudflare has no hard spending limit, only
 * alerts, so this Worker keeps its own: every 10 minutes (the cron in
 * wrangler.jsonc) it asks Cloudflare's analytics what the account has used
 * today (UTC) and prices it. At DAILY_CAP_USD or more, the Budget records
 * today as paused: tool calls then get a message saying so instead of
 * reaching a Durable Object (where most of the cost is), until 00:00 UTC.
 *
 * Needs two secrets (wrangler secret put …): USAGE_API_TOKEN, a token with
 * Account Analytics: Read, and ACCOUNT_ID. Without them nothing is paused.
 */

export const today = (now = new Date()) => now.toISOString().slice(0, 10);

/** What a tool call gets while paused: for the model to pass on to the user. */
export function pausedText(now = new Date()): string {
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  const hours = Math.max(1, Math.ceil((midnight - now.getTime()) / 3600e3));
  return `HexSketch's hosted server has reached its daily usage limit, so it is paused until 00:00 UTC (in about ${hours} h). `
    + 'HexSketch is free, and the limit keeps its running costs in check. Tell the user, and that meanwhile they can '
    + 'draw at https://hexsketch.com, or install HexSketch in Claude Desktop, where it runs on their computer with no limit: '
    + 'https://github.com/angus-e-mcmillan/HexSketch/releases/latest/download/hexsketch.mcpb';
}

/** The one place that knows whether today is paused. */
export class Budget extends DurableObject {
  async pausedOn(): Promise<string | null> { return (await this.ctx.storage.get<string>('pausedOn')) ?? null; }
  async setPausedOn(date: string | null): Promise<void> { await this.ctx.storage.put('pausedOn', date); }
}

interface Namespace<T> { idFromName(name: string): unknown; get(id: unknown): T }
export interface BudgetEnv {
  BUDGET: Namespace<Pick<Budget, 'pausedOn' | 'setPausedOn'>>;
  DAILY_CAP_USD?: string;
  USAGE_API_TOKEN?: string;
  ACCOUNT_ID?: string;
}
const budget = (env: BudgetEnv) => env.BUDGET.get(env.BUDGET.idFromName('budget'));

// Each Worker instance asks the Budget at most once a minute, so checking costs next to nothing.
let cached = { at: 0, pausedOn: null as string | null };
export async function isPaused(env: BudgetEnv): Promise<boolean> {
  if (Date.now() - cached.at > 60e3) cached = { at: Date.now(), pausedOn: await budget(env).pausedOn() };
  return cached.pausedOn === today();
}

/** The cron: pause today if its use has reached the cap, or lift the pause if the cap was raised. */
export async function checkBudget(env: BudgetEnv): Promise<void> {
  if (!env.USAGE_API_TOKEN || !env.ACCOUNT_ID) { console.warn('Spending cap is off: set the USAGE_API_TOKEN and ACCOUNT_ID secrets'); return; }
  const cap = Number(env.DAILY_CAP_USD ?? 5);
  const date = today();
  const usage = await usageOn(env.USAGE_API_TOKEN, env.ACCOUNT_ID, date);
  const pause = usage.usd >= cap;
  await budget(env).setPausedOn(pause ? date : null);
  console.log(`Usage ${date}: $${usage.usd.toFixed(2)} of a $${cap} cap${pause ? ', paused' : ''}`, usage);
}
