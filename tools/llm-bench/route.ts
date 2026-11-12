/**
 * Marking an open synthesis question (type "route"): the model proposes its
 * own route, one "STEP: reactants>>product reagents" line per step, and there
 * are many right answers. Five parts, each a fifth of the marks:
 *
 *   1  valid: every SMILES reads, the last product is the target, each
 *      step's reactants are starting materials or earlier products, no atom
 *      from nowhere, at most the steps asked for (if not, the route earns 0)
 *   1  buyable: every starting material is sold (PubChem's vendor list)
 *   1  each step is a known reaction (route_check.py's templates)
 *   2  the last step is one of the disconnections the chemist accepts (drawn
 *      in the question's answer), or the chemist approves the route
 *
 * A valid route that is not an accepted one and not yet graded is pending:
 * it is listed for the chemist (grades.json), who approves or rejects it.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { compare, imbalance, readStructure } from '../../packages/agent/src/index.ts';
import { parseFormula } from '../../packages/core/src/index.ts';
import type { Question } from './questions.ts';

export interface RouteStep { reactants: string[]; product: string; reagents: string }

export interface RouteMarks {
  /** Names the route for grades.json: the question and its steps. */
  id: string;
  steps: (RouteStep & { reaction: string | null })[];
  valid: boolean;
  /** Why it is not valid, in a few words. */
  why: string | null;
  startingMaterials: string[];
  /** How many chemical vendors PubChem lists for each starting material; -1 where it could not be asked. */
  vendors: Record<string, number>;
  /** Every starting material has at least VENDORS_NEEDED vendors; null when PubChem could not be asked. */
  buyable: boolean | null;
  /** Starting materials too few vendors list, worst first. */
  notSold: string[];
  forward: boolean;
  accepted: boolean;
  /** The step that made one of the couplings the chemist accepts, from 1; 0 when none did. */
  acceptedStep: number;
  /** The chemist's verdict, from grades.json; null when not graded. */
  approved: boolean | null;
  /** Valid, not an accepted disconnection, and not graded yet. */
  pending: boolean;
  /** The share of the marks earned, 0 to 1. */
  score: number;
}

/** The "STEP:" lines of a reply: reaction SMILES, then the reagents in words. */
export function parseRoute(text: string): RouteStep[] {
  const steps: RouteStep[] = [];
  for (const m of text.matchAll(/^\s*\**\s*STEP\s*\d*\s*\**\s*:\s*\**\s*(.+?)\s*$/gim)) {
    const line = m[1]!.replace(/`/g, '').trim();
    const [rxn, ...rest] = line.split(/\s+/);
    const parts = rxn!.split('>');
    if (parts.length < 2) continue;
    // reactants>>product, or reactants>agents>product.
    const reactants = parts[0]!.split('.').filter(Boolean), product = parts.at(-1)!.replace(/\.$/, '');
    const agents = parts.length === 3 ? parts[1]!.split('.').filter(Boolean).join(', ') : '';
    steps.push({ reactants, product, reagents: [agents, rest.join(' ')].filter(Boolean).join(', ') });
  }
  return steps;
}

// ------------------------------------------------------------ the catalogue

const CACHE = new URL('results/vendors.json', import.meta.url);
let catalogue: Record<string, number> | null = null;

/**
 * How many vendors to believe a compound can really be bought. Many suppliers
 * list compounds they have never made, so one listing means nothing: a
 * chemist checking in SciFinder treats about thirty suppliers as a decent
 * chance of getting it. SciFinder is the authority; this is only a screen.
 */
export const VENDORS_NEEDED = 30;

/** At most this many heavy atoms makes a compound a commodity, bought without a thought (hydrazine, methylamine, HCl). */
const COMMODITY_ATOMS = 4;

/** How many chemical vendors PubChem lists for a compound; null when PubChem cannot be asked. Cached in results/vendors.json. */
export async function vendorCount(smiles: string): Promise<number | null> {
  catalogue ??= existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) as Record<string, number> : {};
  if (smiles in catalogue) return catalogue[smiles]!;
  const get = async (url: string, body?: string): Promise<Response | null> => {
    for (let a = 0; a < 4; a++) {
      try {
        const r = await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body } : {});
        if (r.status === 503 || r.status === 429) { await new Promise((res) => setTimeout(res, 1500 * (a + 1))); continue; }
        return r;
      } catch { await new Promise((res) => setTimeout(res, 1500 * (a + 1))); }
    }
    return null;
  };
  const ids = await get('https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/cids/TXT', `smiles=${encodeURIComponent(smiles)}`);
  if (!ids) return null;
  const cid = Number((await ids.text()).trim().split('\n')[0]);
  let n = 0;
  if (cid > 0) {
    // The sources of this compound by category: the vendors are the ones that sell it, not the databases that list it.
    const v = await get(`https://pubchem.ncbi.nlm.nih.gov/rest/pug_view/categories/compound/${cid}/JSON`);
    if (!v) return null;
    if (v.ok) {
      const body = JSON.parse(await v.text()) as { SourceCategories?: { Categories?: { Category?: string; Sources?: { SourceName?: string }[] }[] } };
      const vendors = body.SourceCategories?.Categories?.find((c) => c.Category === 'Chemical Vendors')?.Sources ?? [];
      n = new Set(vendors.map((x) => x.SourceName).filter(Boolean)).size;
    }
  }
  catalogue[smiles] = n;
  writeFileSync(CACHE, JSON.stringify(catalogue, null, 1) + '\n');
  return n;
}

// --------------------------------------------------------------- the grades

const GRADES = new URL('results/grades.json', import.meta.url);
export interface Grades { routes: Record<string, { viable: boolean; note?: string }>; drawings?: Record<string, unknown> }
export const loadGrades = (): Grades => (existsSync(GRADES) ? JSON.parse(readFileSync(GRADES, 'utf8')) as Grades : { routes: {} });

// ------------------------------------------------------------------ marking

const same = async (a: string, b: string) => { try { return (await compare(a, b)).same; } catch { return false; } };
const sameConstitution = async (a: string, b: string) => { try { return (await compare(a, b)).sameConnectivity; } catch { return false; } };

export async function markRoute(q: Question, final: string, grades: Grades = loadGrades(), vendorsOf: (smiles: string) => Promise<number | null> = vendorCount): Promise<RouteMarks> {
  if (q.key.kind !== 'route') throw new Error(`${q.id} is not a route question`);
  const key = q.key;
  const steps = parseRoute(final);
  const id = createHash('sha256').update(`${q.id}\n${steps.map((s) => `${s.reactants.join('.')}>>${s.product}`).join('\n')}`).digest('hex').slice(0, 16);
  const marks: RouteMarks = { id, steps: steps.map((s) => ({ ...s, reaction: null })), valid: false, why: null, startingMaterials: [], vendors: {}, buyable: null, notSold: [], forward: false, accepted: false, acceptedStep: 0, approved: null, pending: false, score: 0 };
  const fail = (why: string) => { marks.why = why; return marks; };
  if (!steps.length) return fail('no STEP lines');
  if (steps.length > key.maxSteps) return fail(`${steps.length} steps, more than ${key.maxSteps}`);

  // Every SMILES reads, and no step makes atoms from nowhere.
  for (const [i, s] of steps.entries()) {
    try {
      const before = (await readStructure(s.reactants.join('.'), { format: 'smiles' })).mol;
      const after = (await readStructure(s.product, { format: 'smiles' })).mol;
      const x = imbalance(before, after);
      // Reagents written in words (Boc2O, MsCl) may bring atoms; with none, they come from nowhere.
      const added = x ? [...parseFormula(x.gained || 'H').keys()].filter((el) => el !== 'H') : [];
      if (added.length && !s.reagents.trim()) return fail(`step ${i + 1} makes ${added.join(', ')} from nowhere`);
    } catch (e) { return fail(`step ${i + 1}: ${(e as Error).message}`); }
  }
  if (!(await same(steps.at(-1)!.product.split('.').sort((a, b) => b.length - a.length)[0]!, key.target))) {
    return fail((await sameConstitution(steps.at(-1)!.product, key.target)) ? 'ends at the target with the wrong stereochemistry' : 'does not end at the target');
  }
  // Starting materials: reactants no earlier step makes.
  const made: string[] = [];
  for (const s of steps) {
    for (const r of s.reactants) {
      let earlier = false;
      for (const p of made) if (await same(r, p)) { earlier = true; break; }
      if (!earlier && !marks.startingMaterials.includes(r)) marks.startingMaterials.push(r);
    }
    made.push(...s.product.split('.'));
  }
  marks.valid = true;

  // Really on sale? Enough vendors list it that a chemist would expect to get it. Commodity
  // chemicals (hydrazine, methylamine, HCl) are not worth asking about: nobody wonders where to buy them.
  const commodity = async (smiles: string) => { try { return (await readStructure(smiles, { format: 'smiles' })).mol.atomCount <= COMMODITY_ATOMS; } catch { return false; } };
  const counts = await Promise.all(marks.startingMaterials.map(async (s) => ((await commodity(s)) ? Infinity : vendorsOf(s))));
  marks.startingMaterials.forEach((s, i) => { marks.vendors[s] = Number.isFinite(counts[i]) ? counts[i]! : counts[i] === null ? -1 : VENDORS_NEEDED; });
  marks.notSold = marks.startingMaterials.filter((_, i) => (counts[i] ?? 0) < VENDORS_NEEDED)
    .sort((a, b) => (marks.vendors[a] ?? 0) - (marks.vendors[b] ?? 0));
  marks.buyable = counts.some((x) => x === null) ? null : !marks.notSold.length;

  // Each step a known reaction.
  try {
    const out = execFileSync('python3', ['-I', new URL('route_check.py', import.meta.url).pathname], { input: JSON.stringify({ steps }), encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    const checked = (JSON.parse(out) as { steps: { reaction: string | null }[] }).steps;
    checked.forEach((c, i) => { marks.steps[i]!.reaction = c.reaction; });
    marks.forward = checked.every((c) => c.reaction);
  } catch (e) {
    // A check that cannot run is the machine's fault, not the route's: say so, rather than quietly
    // taking a fifth of the marks from every route marked on a machine without RDKit.
    const said = `${(e as { stderr?: string }).stderr ?? ''} ${(e as Error).message}`;
    if (/No module named .?rdkit|ENOENT/.test(said)) throw new Error('Marking a route needs Python 3 with RDKit, for the check that each step is a known reaction: pip install rdkit');
    marks.forward = false;
  }

  // One of the couplings the chemist accepts, at any step: a published route often ends in a
  // deprotection, so where the key bond is made matters, not whether it is made last.
  for (const [n, step] of steps.entries()) {
    for (const set of key.accepted) {
      if (set.length !== step.reactants.length) continue;
      const used = new Set<number>();
      let all = true;
      for (const want of set) {
        let hit = -1;
        for (const [i, r] of step.reactants.entries()) if (!used.has(i) && (await sameConstitution(r, want))) { hit = i; break; }
        if (hit < 0) { all = false; break; }
        used.add(hit);
      }
      if (all) { marks.accepted = true; marks.acceptedStep = n + 1; break; }
    }
    if (marks.accepted) break;
  }
  marks.approved = grades.routes[id]?.viable ?? null;
  marks.pending = !marks.accepted && marks.approved === null;
  // Only a compound known to be hard to buy costs the mark: when PubChem cannot be reached the
  // check says nothing, and a route must not score lower for a network that was down.
  marks.score = (1 + (marks.buyable === false ? 0 : 1) + (marks.forward ? 1 : 0) + (marks.accepted || marks.approved ? 2 : 0)) / 5;
  return marks;
}
