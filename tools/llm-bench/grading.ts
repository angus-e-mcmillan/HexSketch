/**
 * The chemist's grading page (a claude.ai artifact): what the marking
 * cannot settle by itself.
 *
 *   npm run llm-bench:grading -- push --runs RUN,RUN [--set NAME]
 *     writes grading/items/*.json: every route waiting for a verdict
 *     (route.ts), and the drawing pairs from results/ab-<run>.json
 *     (layout.ts). Claude writes them to the page's "items" collection.
 *   npm run llm-bench:grading -- pull DIR
 *     reads the page's "grades" collection, saved as JSON files in DIR,
 *     into results/grades.json, which the marking reads: run the
 *     benchmark again with --run to re-mark.
 *
 * Item ids keep only the characters the page's database allows.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { render, scheme } from '../../packages/agent/src/index.ts';
import { loadQuestions } from './questions.ts';
import { loadGrades, type RouteMarks } from './route.ts';

const here = new URL('.', import.meta.url);
const docId = (id: string) => id.replace(/[^A-Za-z0-9_\-.~:@+]/g, '_').slice(0, 200);
const svg = async (input: Parameters<typeof render>[0]) => { try { return (await render(input, { to: 'svg' })).data as string; } catch { return null; } };

const [command, ...rest] = process.argv.slice(2);
if (command === 'push') {
  const { values: opt } = parseArgs({ args: rest, options: { runs: { type: 'string' }, set: { type: 'string' } } });
  if (!opt.runs) throw new Error('Give --runs RUN,RUN');
  const qs = new Map(loadQuestions(opt.set).map((q) => [q.id, q]));
  const out = new URL('grading/items/', here);
  mkdirSync(out, { recursive: true });
  let routes = 0, pairs = 0;
  for (const run of opt.runs.split(',')) {
    // Routes waiting for the chemist.
    const file = new URL(`out/${run}/records.jsonl`, here);
    if (existsSync(file)) {
      // One card per distinct route: the same route from two answers is one judgement (grades go by route id).
      const seen = new Set<string>();
      for (const line of readFileSync(file, 'utf8').trim().split('\n')) {
        const r = JSON.parse(line) as { key: string; id: string; route?: RouteMarks };
        if (!r.route?.pending || seen.has(r.route.id)) continue;
        seen.add(r.route.id);
        const q = qs.get(r.id);
        const steps = [];
        for (const s of r.route.steps) {
          let picture: string | null = null;
          try { picture = await svg(await scheme({ stages: [s.reactants.join('.'), s.product], arrows: [{ reagents: s.reagents }] }, { abbreviate: true })); } catch { picture = null; }
          steps.push({ reaction: s.reaction, smiles: `${s.reactants.join('.')}>>${s.product}`, reagents: s.reagents, svg: picture });
        }
        const item = {
          kind: 'route', id: `${run}/${r.key}`, routeId: r.route.id, order: routes, title: q ? `${q.id}: a route to judge` : r.id,
          question: q?.ask ?? '', target: q?.given[0] ? await svg(q.given[0]) : null, steps,
          checks: { valid: r.route.valid, why: r.route.why, buyable: r.route.buyable, notSold: r.route.notSold.map((x) => `${x} (${r.route!.vendors[x] ?? 0} vendors)`), vendors: r.route.vendors, forward: r.route.forward, accepted: r.route.accepted },
        };
        writeFileSync(new URL(`${docId(item.id)}.json`, out), JSON.stringify(item));
        routes++;
      }
    }
    // Drawing pairs, blind: which is HexSketch stays in results/ab-<run>.json.
    const ab = new URL(`results/ab-${run}.json`, here);
    if (existsSync(ab)) {
      for (const p of JSON.parse(readFileSync(ab, 'utf8')) as { id: string; question: string; context: string | null; a: string; b: string; i: number }[]) {
        const item = { kind: 'ab', id: p.id, order: p.i, title: `Answer drawing ${p.i + 1}`, question: p.question, context: p.context, a: p.a, b: p.b };
        writeFileSync(new URL(`${docId(item.id)}.json`, out), JSON.stringify(item));
        pairs++;
      }
    }
  }
  console.log(`${routes} routes and ${pairs} drawing pairs in ${out.pathname}`);
} else if (command === 'pull') {
  const dir = rest[0];
  if (!dir || !existsSync(dir)) throw new Error('Give the directory the page\'s grades were saved to');
  const grades = loadGrades();
  grades.drawings ??= {};
  // Which side was HexSketch, for every pair in any run.
  const sides = new Map<string, string>();
  for (const f of readdirSync(new URL('results/', here)).filter((x) => /^ab-.*\.json$/.test(x))) {
    for (const p of JSON.parse(readFileSync(new URL(`results/${f}`, here), 'utf8')) as { id: string; hexsketch: string }[]) sides.set(p.id, p.hexsketch);
  }
  const items = new Map<string, { kind: string; routeId?: string; id: string }>();
  const itemDir = new URL('grading/items/', here);
  if (existsSync(itemDir)) for (const f of readdirSync(itemDir)) { const it = JSON.parse(readFileSync(new URL(f, itemDir), 'utf8')); items.set(docId(it.id), it); }
  let n = 0;
  const files = readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith('.json'));
  for (const f of files) {
    const raw = JSON.parse(readFileSync(join(dir, f), 'utf8')) as Record<string, unknown>;
    const g = (raw.data ?? raw) as { kind?: string; itemId?: string; verdict?: string; note?: string };
    const item = g.itemId ? items.get(docId(g.itemId)) : undefined;
    if (!g.verdict || !item) continue;
    if (item.kind === 'route' && item.routeId) grades.routes[item.routeId] = { viable: g.verdict === 'viable', ...(g.note ? { note: g.note } : {}) };
    if (item.kind === 'ab') {
      const side = sides.get(item.id);
      const pick = g.verdict === 'same' ? 'same' : side ? (g.verdict === side ? 'hexsketch' : 'other') : null;
      if (pick) grades.drawings[item.id] = { pick, ...(g.note ? { note: g.note } : {}) };
    }
    n++;
  }
  writeFileSync(new URL('results/grades.json', here), JSON.stringify(grades, null, 1) + '\n');
  const picks = Object.values(grades.drawings as Record<string, { pick: string }>);
  const won = picks.filter((p) => p.pick === 'hexsketch').length, lost = picks.filter((p) => p.pick === 'other').length;
  console.log(`${n} grades read. Routes judged: ${Object.keys(grades.routes).length}. Drawings: HexSketch preferred ${won}, the other ${lost}, no difference ${picks.length - won - lost}.`);
} else {
  console.log('npm run llm-bench:grading -- push --runs RUN,RUN [--set NAME] | pull DIR');
}
