/**
 * How well drawn the answers are. Not part of the score: a panel of its own,
 * and the pairs for the chemist's blind comparison (grading page).
 *
 *   npm run llm-bench:layout -- --run RUN [--set NAME] [--chemdraw DIR]
 *
 * Every right answer HexSketch drew is measured against the conventions a
 * chemist draws by (ChemDraw's defaults): bonds all one length, angles at
 * 120 degrees, nothing clashing, crossing or sitting on a label.
 *
 * The comparison a chemist would make is with ChemDraw, so the only
 * comparator here is ChemDraw itself: paste the answers listed in
 * chemdraw/wanted.txt into ChemDraw, Clean Up Structure, save each as CDXML
 * into a folder, and pass it as --chemdraw. Both drawings are then shown
 * through HexSketch's renderer, so the style never says which is which.
 * Nothing stands in for ChemDraw when it is not given: the panel then
 * measures HexSketch's drawings alone and no pairs are written.
 *
 * Writes results/layout-<run>.html, results/plots/layout-<run>.svg, and,
 * with --chemdraw, results/ab-<run>.json (the pairs, in random order, each
 * recording which side was HexSketch).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { compare, drawnOut, readStructure, render } from '../../packages/agent/src/index.ts';
import { writeMolfile, writeSmiles, type Molecule } from '../../packages/core/src/index.ts';
import { finalAnswer } from './measure.ts';
import { loadQuestions } from './questions.ts';

// -------------------------------------------------------------- measuring

/** What is wrong with a structure's layout, in units that do not depend on its size. */
export interface Faults {
  atoms: number;
  /** Spread of bond lengths: standard deviation over the mean (0 for all alike). */
  bondSpread: number;
  /** Mean departure (degrees) of the angles between neighbouring bonds at an atom from the ideal (120° for two or three, 180° where linear, 90° for four). */
  angleDev: number;
  /** Atoms not bonded to each other, nor to a common neighbour, closer than 0.4 bond lengths. */
  clashes: number;
  /** Bonds that cross. */
  crossings: number;
  /** Bonds that run through another atom's label (N, O, Cl, Boc...). */
  labelHits: number;
}

const dist = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(p.x - q.x, p.y - q.y);
function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
function cross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }): boolean {
  const o = (p: typeof a, q: typeof a, r: typeof a) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function faults(mol: Molecule): Faults {
  const bonds = [...mol.bonds()], atoms = [...mol.atoms()];
  const lengths = bonds.map((b) => dist(mol.atom(b.begin), mol.atom(b.end)));
  const mean = lengths.reduce((t, x) => t + x, 0) / (lengths.length || 1);
  const sd = Math.sqrt(lengths.reduce((t, x) => t + (x - mean) ** 2, 0) / (lengths.length || 1));
  const L = mean || 1;
  // Angles: the gaps between neighbouring bonds around each atom with 2 to 4 of them.
  let dev = 0, n = 0;
  for (const a of atoms) {
    const nb = mol.neighbours(a.id);
    if (nb.length < 2 || nb.length > 4) continue;
    const angles = nb.map((x) => Math.atan2(mol.atom(x).y - a.y, mol.atom(x).x - a.x)).sort((p, q) => p - q);
    const gaps = angles.map((t, i) => ((i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI) - t) * 180 / Math.PI);
    // Linear: an alkyne or nitrile carbon, or the middle of cumulated double bonds (an azide's N+, an allene).
    const orders = mol.incidentBonds(a.id).map((b) => mol.bond(b).order);
    const linear = nb.length === 2 && (orders.includes(3) || orders.every((o) => o === 2));
    if (nb.length === 2) { dev += Math.abs(Math.min(...gaps) - (linear ? 180 : 120)); n++; continue; }
    const ideal = 360 / nb.length;
    for (const g of gaps) { dev += Math.abs(g - ideal); n++; }
  }
  // Clashes: atoms more than two bonds apart, drawn on top of each other.
  const near = (p: number, q: number) => mol.bondBetween(p, q) || mol.neighbours(p).some((x) => mol.bondBetween(x, q));
  let clashes = 0;
  for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
    if (!near(atoms[i]!.id, atoms[j]!.id) && dist(atoms[i]!, atoms[j]!) < 0.4 * L) clashes++;
  }
  let crossings = 0;
  for (let i = 0; i < bonds.length; i++) for (let j = i + 1; j < bonds.length; j++) {
    const p = bonds[i]!, q = bonds[j]!;
    if (p.begin === q.begin || p.begin === q.end || p.end === q.begin || p.end === q.end) continue;
    if (cross(mol.atom(p.begin), mol.atom(p.end), mol.atom(q.begin), mol.atom(q.end))) crossings++;
  }
  // Labels: an atom that shows its symbol (not carbon) with a bond not its own passing within 0.3 bond lengths.
  let labelHits = 0;
  for (const a of atoms) {
    if ((a.label === null || a.label === undefined) && a.element === 'C') continue;
    for (const b of bonds) if (b.begin !== a.id && b.end !== a.id && segDist(a, mol.atom(b.begin), mol.atom(b.end)) < 0.3 * L) labelHits++;
  }
  return { atoms: atoms.length, bondSpread: sd / L, angleDev: n ? dev / n : 0, clashes, crossings, labelHits };
}

// ------------------------------------------------------------------- script

if (import.meta.url === `file://${process.argv[1]}`) {
  const { values: opt } = parseArgs({ options: { run: { type: 'string' }, set: { type: 'string' }, chemdraw: { type: 'string' } } });
  if (!opt.run) throw new Error('Give --run RUN');
  const here = new URL('.', import.meta.url);
  const qs = new Map(loadQuestions(opt.set).map((q) => [q.id, q]));
  const recs = readFileSync(new URL(`out/${opt.run}/records.jsonl`, here), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { key: string; id: string; condition: string; correct?: boolean; drawn: string | null; final: string });
  // Each right answer drawn with HexSketch: the structure in its drawing that is the answer.
  const items: { key: string; id: string; smiles: string; hex: Molecule }[] = [];
  for (const r of recs) {
    if (r.condition !== 'hexsketch' || !r.correct || !r.drawn || !qs.has(r.id)) continue;
    const q = qs.get(r.id)!;
    if (q.key.kind !== 'structure') continue;
    const answer = finalAnswer(r.final).answer;
    if (!answer) continue;
    const d = await readStructure(r.drawn);
    for (const ids of d.mol.fragments()) {
      const part = d.mol.clone();
      for (const a of d.mol.atoms()) if (!ids.includes(a.id)) part.removeAtom(a.id);
      try { if ((await compare(writeSmiles(drawnOut(part, d.style)), answer)).same) { items.push({ key: r.key, id: r.id, smiles: answer, hex: part }); break; } } catch { /* not this one */ }
    }
  }
  if (!items.length) throw new Error('No right answers drawn with HexSketch in that run');

  // The same answers from ChemDraw, when the chemist has exported them: matched by structure, not by file name.
  const drawn = new Map<string, Molecule>();
  if (opt.chemdraw) {
    for (const f of readdirSync(opt.chemdraw).filter((x) => x.toLowerCase().endsWith('.cdxml'))) {
      let s;
      try { s = await readStructure(readFileSync(join(opt.chemdraw, f), 'utf8')); } catch { console.warn(`${f}: not a readable CDXML`); continue; }
      for (const ids of s.mol.fragments()) {
        const part = s.mol.clone();
        for (const a of s.mol.atoms()) if (!ids.includes(a.id)) part.removeAtom(a.id);
        const hit = [];
        for (const x of items) { try { if ((await compare(writeSmiles(drawnOut(part, s.style)), x.smiles)).same) hit.push(x); } catch { /* not this one */ } }
        for (const x of hit) if (!drawn.has(x.key)) drawn.set(x.key, part);
      }
    }
    const missing = items.filter((x) => !drawn.has(x.key)).length;
    if (missing) console.warn(`${missing} of ${items.length} answers have no ChemDraw drawing yet`);
  }
  // What to paste into ChemDraw to compare the rest.
  const wanted = items.filter((x) => !drawn.has(x.key));
  if (wanted.length) {
    mkdirSync(new URL('chemdraw/', here), { recursive: true });
    writeFileSync(new URL('chemdraw/wanted.txt', here), `${wanted.map((x) => `${x.key}\t${x.smiles}`).join('\n')}\n`);
  }

  const hexF = items.map((x) => faults(x.hex));
  const pairKeys = items.filter((x) => drawn.has(x.key));
  const cdF = pairKeys.map((x) => faults(drawn.get(x.key)!));

  // ------------------------------------------------------------- the panel
  const meanOf = (fs: Faults[], k: keyof Faults) => fs.reduce((t, f) => t + f[k], 0) / (fs.length || 1);
  const anyFault = (f: Faults) => f.clashes + f.crossings + f.labelHits > 0;
  const metrics: { k: keyof Faults | 'any'; label: string; fmt: (v: number) => string; value: (fs: Faults[]) => number }[] = [
    { k: 'any', label: 'Drawings with a clash, crossing or label hit', fmt: (v) => `${Math.round(v)}%`, value: (fs) => (100 * fs.filter(anyFault).length) / (fs.length || 1) },
    { k: 'angleDev', label: 'Angle off ideal, mean (°)', fmt: (v) => v.toFixed(1), value: (fs) => meanOf(fs, 'angleDev') },
    { k: 'bondSpread', label: 'Bond length spread (%)', fmt: (v) => v.toFixed(1), value: (fs) => 100 * meanOf(fs, 'bondSpread') },
    { k: 'labelHits', label: 'Bonds through a label, per drawing', fmt: (v) => v.toFixed(2), value: (fs) => meanOf(fs, 'labelHits') },
    { k: 'clashes', label: 'Atom clashes, per drawing', fmt: (v) => v.toFixed(2), value: (fs) => meanOf(fs, 'clashes') },
    { k: 'crossings', label: 'Bond crossings, per drawing', fmt: (v) => v.toFixed(2), value: (fs) => meanOf(fs, 'crossings') },
  ];
  type Role = 'surface' | 'text' | 'text2' | 'muted' | 'grid' | 'cd' | 'hex';
  const LIGHT: Record<Role, string> = { surface: '#fcfcfb', text: '#0b0b0b', text2: '#52514e', muted: '#898781', grid: '#e1e0d9', cd: '#2a78d6', hex: '#eb6834' };
  const DARK: Record<Role, string> = { surface: '#1a1a19', text: '#f0efec', text2: '#c3c2b7', muted: '#898781', grid: '#2c2c2a', cd: '#3987e5', hex: '#d95926' };
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
  const svg = (ink: (r: Role) => string) => {
    const W = 720, rowH = cdF.length ? 46 : 30, top = 64, left = 290, pw = W - left - 70;
    const H = top + metrics.length * rowH + 16;
    const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="system-ui,-apple-system,'Segoe UI',sans-serif" role="img" aria-label="Layout faults">`, `<rect width="${W}" height="${H}" fill="${ink('surface')}"/>`];
    o.push(`<text x="16" y="24" font-size="15" font-weight="600" fill="${ink('text')}">How well the answers are drawn (lower is better)</text>`);
    o.push(`<text x="16" y="42" font-size="12" fill="${ink('text2')}">${items.length} right answers as HexSketch drew them${cdF.length ? `, and ${cdF.length} of them drawn in ChemDraw` : ', against the conventions a chemist draws by'}.</text>`);
    if (cdF.length) o.push(`<circle cx="${W - 250}" cy="38" r="5" fill="${ink('hex')}"/><text x="${W - 241}" y="42" font-size="11" fill="${ink('text2')}">HexSketch</text><circle cx="${W - 150}" cy="38" r="5" fill="${ink('cd')}"/><text x="${W - 141}" y="42" font-size="11" fill="${ink('text2')}">ChemDraw</text>`);
    metrics.forEach((m, i) => {
      const y = top + i * rowH, h = m.value(hexF), c = cdF.length ? m.value(cdF) : null;
      const max = Math.max(h, c ?? 0) || 1;
      o.push(`<text x="${left - 10}" y="${y + 18}" font-size="12" text-anchor="end" fill="${ink('text')}">${esc(m.label)}</text>`);
      const bars: [Role, number][] = c === null ? [['hex', h]] : [['hex', h], ['cd', c]];
      bars.forEach(([role, v], k) => {
        const w = Math.max(2, (pw * v) / max), by = y + 4 + k * 17;
        o.push(`<rect x="${left}" y="${by}" width="${w}" height="14" rx="3" fill="${ink(role)}"/><text x="${left + w + 6}" y="${by + 11}" font-size="11" fill="${ink('text')}">${m.fmt(v)}</text>`);
      });
    });
    o.push('</svg>');
    return o.join('');
  };
  const vars = (p: Record<Role, string>) => Object.entries(p).map(([a, b]) => `--${a}:${b}`).join(';');
  mkdirSync(new URL('results/plots/', here), { recursive: true });
  writeFileSync(new URL(`results/plots/layout-${opt.run}.svg`, here), svg((r) => LIGHT[r]));
  writeFileSync(new URL(`results/layout-${opt.run}.html`, here), `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Layout of the answers</title>
<style>:root{${vars(LIGHT)};--page:#f9f9f7;color-scheme:light}@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${vars(DARK)};--page:#0d0d0d;color-scheme:dark}}:root[data-theme="dark"]{${vars(DARK)};--page:#0d0d0d;color-scheme:dark}
body{margin:0;background:var(--page);color:var(--text);font:14px/1.5 system-ui,sans-serif}main{max-width:800px;margin:0 auto;padding:24px 16px}figure{margin:0;padding:16px;background:var(--surface);border-radius:8px;border:1px solid var(--grid);overflow-x:auto}svg{max-width:100%;height:auto;display:block}</style>
<main><figure>${svg((r) => `var(--${r})`)}</figure></main>`);

  // ------------------------------------------------- pairs for the blind A/B
  const pictures = async (m: Molecule) => (await render(writeMolfile(m), { to: 'svg' })).data as string;
  const pairs = [];
  for (const [i, x] of pairKeys.entries()) {
    const hexFirst = Math.random() < 0.5;
    const [a, b] = hexFirst ? [x.hex, drawn.get(x.key)!] : [drawn.get(x.key)!, x.hex];
    const q = qs.get(x.id)!;
    pairs.push({ id: `${opt.run}/${x.key}`, question: q.ask, context: q.drawing ? (await render(q.drawing, { to: 'svg' })).data : null, a: await pictures(a), b: await pictures(b), hexsketch: hexFirst ? 'a' : 'b', i });
  }
  if (pairs.length) writeFileSync(new URL(`results/ab-${opt.run}.json`, here), JSON.stringify(pairs));
  console.log(`${items.length} drawings: results/layout-${opt.run}.html`);
  for (const m of metrics) console.log(`  ${m.label}: HexSketch ${m.fmt(m.value(hexF))}${cdF.length ? `, ChemDraw ${m.fmt(m.value(cdF))}` : ''}`);
  if (pairs.length) console.log(`${pairs.length} pairs in results/ab-${opt.run}.json`);
  if (wanted.length) console.log(`To compare with ChemDraw: paste the ${wanted.length} answers in chemdraw/wanted.txt into ChemDraw, Clean Up Structure, save each as CDXML, and run again with --chemdraw DIR`);
}
