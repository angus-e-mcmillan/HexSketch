/**
 * What is measured on each answer, all automatically, the same in both
 * conditions:
 *
 *   correct      the answer is the key (or an answer the examiner also
 *                accepts): the same compound, and the same stereoisomer at
 *                every stereocentre the key defines (a centre the key leaves
 *                undefined may be either way); for questions about the
 *                structures, the same labels, ranking, number (within its
 *                tolerance) or word
 *   stereo       right compound, wrong or missing stereochemistry
 *   valid        every structure in the answer is a readable SMILES with no
 *                atom over its valence
 *   consistent   the name the model gives is the structure it gives (OPSIN,
 *                an independent name parser, reads the name; stereodescriptors
 *                included): one-structure answers only
 *   preserved    what the answer should keep of the structures in the
 *                question (the part they share with the key) is all there
 *   flagged      hazard questions: the reply warns of the hazard
 *   oriented     the answer is drawn the same way round as the structure it
 *                comes from, as the chemist would see it: with HexSketch, as
 *                the model drew it in the editor; without, laid out from its
 *                SMILES, as any drawing program would
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { commonCore, compare, readStructure, validate } from '../../packages/agent/src/index.ts';
import { isomorphisms, layout2D, parseSmiles, sameStereoisomer, smilesAtomMaps, substructureMappings, writeSmiles, DEFAULT_STYLE, type Molecule } from '../../packages/core/src/index.ts';
import { isStructureKey, type Key, type Question } from './questions.ts';

const OPSIN = new URL('../opsin/opsin.jar', import.meta.url).pathname;

/** SMILES for each name (null where OPSIN cannot read it), in one Java run. */
export function opsin(names: readonly string[]): (string | null)[] {
  if (!names.length) return [];
  if (!existsSync(OPSIN)) throw new Error('OPSIN is missing: run sh tools/opsin/fetch.sh (needs Java to run)');
  const input = names.map((n) => n.replace(/\s*\n\s*/g, ' ').trim() || '?').join('\n') + '\n';
  const out = execFileSync('java', ['-jar', OPSIN, '-osmi'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 64 << 20 });
  const lines = out.split('\n');
  return names.map((_, i) => { const l = (lines[i] ?? '').trim(); return l && !/\s/.test(l) ? l : null; });
}

/** The model's final answer: the last "ANSWER:" line and the last "NAME:" line, without backticks or a full stop. */
export function finalAnswer(text: string): { answer: string | null; name: string | null } {
  const last = (label: string) => {
    const found = [...text.matchAll(new RegExp(`^\\s*\\**${label}\\**\\s*:\\s*(.+?)\\s*$`, 'gim'))].at(-1)?.[1];
    if (!found) return null;
    let a = found.trim(), was = '';
    while (a !== was) { was = a; a = a.replace(/\.$/, '').replace(/^[`*]+|[`*]+$/g, '').trim(); }
    return a || null;
  };
  return { answer: last('ANSWER'), name: last('NAME') };
}

/** Split an answer into its structures: stages by ">>", structures of a stage by ".". */
export function splitAnswer(answer: string, kind: Key['kind']): string[][] {
  const stages = kind === 'sequence' ? answer.split(/\s*(?:>>|→|->)\s*/) : [answer];
  return stages.map((s) => (kind === 'structure' ? [s.trim()] : s.split(/\s*[,;]\s+|\.(?![^[]*\])/).map((x) => x.trim()))).map((s) => s.filter(Boolean)).filter((s) => s.length);
}

export interface Measures {
  answered: boolean;
  correct: boolean;
  stereo: boolean;
  /** Null where the answer is not a structure. */
  valid: boolean | null;
  /** Null where it does not apply (several structures, or no structure given). */
  consistent: boolean | null;
  preserved: boolean | null;
  flagged: boolean | null;
  oriented: boolean | null;
}

/**
 * Measure one reply. `text` is everything the model wrote in its replies
 * (for the hazard check), `final` its last reply, `named` OPSIN's SMILES for
 * its NAME, and `drawn` the editor's drawing at the end (with HexSketch).
 */
export async function measure(q: Question, text: string, final: string, named: string | null, drawn: string | null): Promise<Measures & { answer: string | null; name: string | null }> {
  const { answer, name } = finalAnswer(final);
  const flagged = q.hazard ? q.hazard.some((w) => text.toLowerCase().includes(w.toLowerCase())) : null;
  const pointsAtAtoms = q.key.kind === 'atoms' || q.key.kind === 'ranking';
  const none: Measures = { answered: false, correct: false, stereo: false, valid: isStructureKey(q.key) || pointsAtAtoms ? false : null, consistent: q.key.kind === 'structure' ? false : null, preserved: null, flagged, oriented: null };
  if (!answer) return { ...none, answer, name };
  if (q.key.kind === 'atoms' || q.key.kind === 'ranking') {
    let valid = false;
    try { const v = await validate(answer); valid = v.ok && !v.issues.some((i) => i.severity === 'error'); } catch { valid = false; }
    return { ...none, answered: true, valid, correct: valid && markedRight(q.key, answer), answer, name };
  }
  if (!isStructureKey(q.key)) return { ...none, answered: true, correct: writtenRight(q.key, answer), answer, name };
  const stages = splitAnswer(answer, q.key.kind);
  const all = stages.flat();
  const mols: (Molecule | null)[] = all.map((s) => { try { return parseSmiles(s); } catch { return null; } });
  let valid = mols.every((m) => m && m.atomCount);
  if (valid) for (const s of all) { const v = await validate(s); if (!v.ok || v.issues.some((i) => i.severity === 'error')) { valid = false; break; } }

  // Correct, or right but for the stereochemistry.
  let correct = false, stereo = false;
  if (mols.every(Boolean)) {
    const keys = q.key.kind === 'structure' ? [[[q.key.smiles]], ...(q.key.also ?? []).map((s) => [[s]])]
      : q.key.kind === 'structures' ? [[q.key.smiles], ...(q.key.also ?? []).map((s) => [s])]
        : [q.key.stages, ...(q.key.also ?? [])];
    for (const key of keys) {
      const r = q.key.kind === 'sequence' ? await matchSequence(stages, key) : await matchSet(all, key[0]!);
      if (r === 'same') { correct = true; break; }
      if (r === 'stereo') stereo = true;
    }
  }

  // The name against the structure.
  let consistent: boolean | null = null;
  if (q.key.kind === 'structure') {
    consistent = false;
    if (named && mols[0]) { try { consistent = (await compare(named, all[0]!)).same; } catch { consistent = false; } }
  }

  // What should survive from the question into the answer.
  const product = all.at(-1) && mols.at(-1) ? mols.at(-1)! : null;
  let preserved: boolean | null = null;
  const lastKey = q.key.kind === 'structure' ? q.key.smiles : q.key.kind === 'structures' ? null : q.key.stages.at(-1)!.join('.');
  const kept = lastKey ? retainedCore(q.given, lastKey) : null;
  if (kept && product) preserved = all.some((s) => { try { return substructureMappings(kept, parseSmiles(s), 1).length > 0; } catch { return false; } });
  else if (kept) preserved = false;

  // Drawn the same way round as the structure it comes from.
  let oriented: boolean | null = null;
  if (kept && product && q.drawing) oriented = await sameWayRound(q.drawing, drawn, all.at(-1)!);

  return { answered: true, correct, stereo: stereo && !correct, valid, consistent, preserved, flagged, oriented, answer, name };
}

// ------------------------------------------------------------ correctness

/**
 * Atoms pointed at in a SMILES by atom-map numbers, against the key's: the
 * same compound, and under some mapping of one onto the other (so an atom
 * equivalent by symmetry counts) the marked atoms correspond, with the same
 * numbers for a ranking.
 */
export function markedRight(key: Extract<Key, { kind: 'atoms' | 'ranking' }>, answer: string): boolean {
  let k: Molecule, a: Molecule;
  try { k = parseSmiles(key.smiles); a = parseSmiles(answer); } catch { return false; }
  const want = new Map([...smilesAtomMaps(k)].map(([map, id]) => [id, map]));
  const got = new Map([...smilesAtomMaps(a)].map(([map, id]) => [id, map]));
  if (!got.size) return false;
  let n = 0;
  for (const iso of isomorphisms(k, a)) {
    // Every marked atom of the answer is one the key marks, and every one the key marks is marked.
    const marked = [...got.keys()];
    const image = new Map([...want].map(([kid, map]) => [iso.get(kid)!, map]));
    const ok = marked.length === image.size && marked.every((x) => image.has(x) && (key.kind === 'atoms' || image.get(x) === got.get(x)));
    if (ok) return true;
    if (++n >= 2000) break;
  }
  return false;
}

/** An answer about the structures written as a number or a word, against the key. */
export function writtenRight(key: Extract<Key, { kind: 'number' | 'term' }>, answer: string): boolean {
  switch (key.kind) {
    case 'number': {
      const n = Number(/-?\d+(?:\.\d+)?/.exec(answer.replace(/[−–]/g, '-'))?.[0]);
      return Number.isFinite(n) && Math.abs(n - key.value) <= key.tolerance + 1e-9;
    }
    case 'term': {
      const norm = (t: string) => t.toLowerCase().replace(/[²³¹⁰]/g, (c) => ({ '²': '2', '³': '3', '¹': '1', '⁰': '0' })[c]!).replace(/[\s^\-_.'"]/g, '');
      return key.accept.some((a) => norm(a) === norm(answer));
    }
  }
}

type Match = 'same' | 'stereo' | 'different';

/**
 * Is `answer` the key: the same compound, with the key's configuration at
 * every stereocentre and double bond the key defines? Centres the key leaves
 * undefined may be either way, or undefined.
 */
export function sameAsKey(answer: Molecule, key: Molecule): Match {
  let any = false;
  let n = 0;
  for (const map of isomorphisms(key, answer)) {
    any = true;
    const a = answer.clone();
    for (const [k, x] of map) if (!key.atom(k).chirality) a.atom(x).chirality = null;
    for (const kb of key.bonds()) if (!kb.ez) { const xb = a.bondBetween(map.get(kb.begin)!, map.get(kb.end)!); if (xb) xb.ez = null; }
    if (sameStereoisomer(key, a)) return 'same';
    if (++n >= 64) break;
  }
  return any ? 'stereo' : 'different';
}

/** The answer's structures against a set: the same set, each matched once. */
async function matchSet(given: string[], key: string[]): Promise<Match> {
  if (given.length !== key.length) return 'different';
  const used = new Set<number>();
  let stereoOnly = false;
  for (const k of key) {
    const km = parseSmiles(k);
    let hit = -1, partial = -1;
    for (const [i, g] of given.entries()) {
      if (used.has(i)) continue;
      const r = sameAsKey(parseSmiles(g), km);
      if (r === 'same') { hit = i; break; }
      if (r === 'stereo' && partial < 0) partial = i;
    }
    if (hit < 0 && partial < 0) return 'different';
    if (hit < 0) stereoOnly = true;
    used.add(hit >= 0 ? hit : partial);
  }
  return stereoOnly ? 'stereo' : 'same';
}

/** The key's stages in order; stages the key leaves out (a proton transfer) may come between them. */
async function matchSequence(stages: string[][], key: string[][]): Promise<Match> {
  let i = 0, stereoOnly = false;
  for (const ks of key) {
    let found = false;
    for (; i < stages.length; i++) {
      const r = await matchSet(stages[i]!, ks);
      if (r !== 'different') { found = true; if (r === 'stereo') stereoOnly = true; i++; break; }
    }
    if (!found) return 'different';
  }
  return stereoOnly ? 'stereo' : 'same';
}

// ------------------------------------------------------------ preservation

/** The largest part of a structure in the question that the key keeps (at least 6 atoms), as a pattern. */
export function retainedCore(given: string[], key: string): Molecule | null {
  let best: Molecule | null = null;
  let keyMol: Molecule;
  try { keyMol = parseSmiles(key); } catch { return null; }
  for (const g of given) {
    let gm: Molecule;
    try { gm = parseSmiles(g); } catch { continue; }
    const map = commonCore(gm, keyMol)[0];
    if (!map || map.size < 6 || (best && map.size <= best.atomCount)) continue;
    const core = gm.clone();
    for (const a of gm.atoms()) if (!map.has(a.id)) core.removeAtom(a.id);
    best = core;
  }
  return best;
}

// ------------------------------------------------------------- orientation

/**
 * Is the answer drawn the same way round as the question's structure it
 * shares most with? Both are scaled to the same bond length and centred on
 * the atoms they share; the answer counts as the same way round when those
 * atoms lie, on average, within half a bond of where they are in the question.
 * With HexSketch (`drawn` given) the answer's drawing is the editor's; else
 * it is the SMILES laid out afresh.
 */
async function sameWayRound(question: string, drawn: string | null, answer: string): Promise<boolean | null> {
  const q = await readStructure(question);
  let target: Molecule | null = null;
  if (drawn) {
    const d = await readStructure(drawn);
    for (const ids of d.mol.fragments()) {
      const part = sub(d.mol, ids);
      try { if ((await compare(writeSmiles(part), answer)).sameConnectivity) { target = part; break; } } catch { /* not this one */ }
    }
  }
  if (!target) { try { target = parseSmiles(answer); layout2D(target, DEFAULT_STYLE.bondLength); } catch { return null; } }
  let best = Infinity, shared = 0;
  for (const ids of q.mol.fragments()) {
    const ref = sub(q.mol, ids);
    const maps = ref.atomCount <= target.atomCount ? commonCore(ref, target) : commonCore(target, ref).map((m) => new Map([...m].map(([t, r]) => [r, t])));
    if (!maps[0] || maps[0].size < 6 || maps[0].size < shared) continue;
    shared = maps[0].size;
    const lr = bondLength(ref), lt = bondLength(target);
    for (const map of maps) {
      const pairs = [...map].map(([r, t]) => [ref.atom(r), target!.atom(t)] as const);
      const c = (k: 0 | 1) => ({ x: pairs.reduce((s, p) => s + p[k].x, 0) / pairs.length, y: pairs.reduce((s, p) => s + p[k].y, 0) / pairs.length });
      const cr = c(0), ct = c(1);
      const rms = Math.sqrt(pairs.reduce((s, [r, t]) => s + ((r.x - cr.x) / lr - (t.x - ct.x) / lt) ** 2 + ((r.y - cr.y) / lr - (t.y - ct.y) / lt) ** 2, 0) / pairs.length);
      best = Math.min(best, rms);
    }
  }
  return shared ? best < 0.5 : null;
}

function sub(mol: Molecule, ids: readonly number[]): Molecule {
  const keep = new Set(ids);
  const part = mol.clone();
  for (const a of mol.atoms()) if (!keep.has(a.id)) part.removeAtom(a.id);
  return part;
}

function bondLength(m: Molecule): number {
  const ls = [...m.bonds()].map((b) => Math.hypot(m.atom(b.begin).x - m.atom(b.end).x, m.atom(b.begin).y - m.atom(b.end).y)).filter((l) => l > 0);
  return ls.length ? ls.sort((a, b) => a - b)[Math.floor(ls.length / 2)]! : 1;
}
