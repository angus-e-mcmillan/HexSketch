import { arcPolyline, curvePolyline, makeCaption, makeShape, parsePattern, substructureMappings, type AtomId, type DocObject, type DrawingStyle, type Molecule } from '@hexsketch/core';
import { depict, layoutCaption, textWidth } from '@hexsketch/render';

/**
 * Short notes the AI pins to atoms ("pKa ≈ 4.2" by an acid, "Michael
 * acceptor" by an enone): small coloured text in the free space beside the
 * atom, clear of the bonds, atom labels, other captions and each other, with
 * a faint dashed leader only when it had to go further out.
 */

export interface AtomLabel {
  /** A SMILES fragment matched in the drawing; the label points at its first atom ("OC(=O)" at the OH, "C(=O)O" at the carbonyl carbon). */
  at: string;
  text: string;
  /** Text colour; default dark grey. */
  color?: string;
  /** Which place the fragment is found, counted left to right then top to bottom (1, the default, is the first). */
  occurrence?: number;
}

export interface PlacedLabels {
  /** Captions (and any leaders) to add to the drawing. */
  objects: DocObject[];
  /** For each label, how many places its fragment was found (0: not found, so not drawn). */
  found: number[];
}

type Pt = { x: number; y: number };
interface Box { x0: number; y0: number; x1: number; y1: number }

const GREY = '#4b5563', LEADER = '#a3a3a3';
/** Further out than this (in bond lengths), a label gets a leader. */
const LEADER_AFTER = 1.2;

/** A leader from just off the atom to just short of the text. */
const leaderEnds = (a: Pt, dir: Pt, gap: number, L: number): [Pt, Pt] => [
  { x: a.x + dir.x * L * 0.3, y: a.y + dir.y * L * 0.3 },
  { x: a.x + dir.x * (gap - 0.12) * L, y: a.y + dir.y * (gap - 0.12) * L },
];

/** The drawing's places for each label's fragment, in reading order. */
export function labelPlaces(mol: Molecule, at: string): (Pt & { id: AtomId })[] {
  let pattern: Molecule;
  try { pattern = parsePattern(at); } catch (err) { throw new Error(`Label fragment "${at}" is not a SMILES fragment: ${(err as Error).message}`); }
  const first = pattern.atoms().next().value;
  if (!first) return [];
  return substructureMappings(pattern, mol)
    .map((m) => mol.atom(m.map.get(first.id)!))
    .sort((a, b) => (Math.abs(a.x - b.x) > 1e-6 ? a.x - b.x : a.y - b.y))
    .map((a) => ({ x: a.x, y: a.y, id: a.id }));
}

export function placeLabels(mol: Molecule, objects: readonly DocObject[], style: DrawingStyle, labels: readonly AtomLabel[]): PlacedLabels {
  const L = style.bondLength, size = Math.round(style.captionSize * 0.8 * 2) / 2, pad = L * 0.1;
  // What a label must keep clear of: atoms with their labels, bonds, and the captions, arrows and shapes already there.
  // A segment's third value is the room it needs either side: a highlight band is wider than a bond.
  const boxes: Box[] = [], segments: [Pt, Pt, number][] = [];
  const line = L * 0.08, band = L * 0.3;
  // Atom labels as drawn (hydrogens and charges included); a bare carbon is just its corner.
  const drawn = depict(mol, style).labels;
  for (const a of mol.atoms()) {
    const b = drawn.get(a.id)?.bounds;
    const r = a.highlight ? band : L * 0.1;
    boxes.push(b ? { x0: b.x0 - (a.highlight ? L * 0.1 : 0), y0: b.y0, x1: b.x1 + (a.highlight ? L * 0.1 : 0), y1: b.y1 } : { x0: a.x - r, y0: a.y - r, x1: a.x + r, y1: a.y + r });
  }
  for (const b of mol.bonds()) segments.push([mol.atom(b.begin), mol.atom(b.end), b.highlight ? band : line]);
  for (const o of objects) {
    if (o.kind === 'text') {
      for (const l of layoutCaption(o, style).lines) boxes.push({ x0: l.x0, y0: l.top, x1: l.x1, y1: l.bottom });
    } else if (o.kind === 'arrow') {
      const pts = o.curve?.length ? curvePolyline(o.curve, 12) : o.arc ? arcPolyline(o, 24) : [o.tail, o.head];
      for (let i = 1; i < pts.length; i++) segments.push([pts[i - 1]!, pts[i]!, line]);
    } else {
      const xs = o.points.map((p) => p.x), ys = o.points.map((p) => p.y);
      if (o.shape === 'line') segments.push([o.points[0]!, o.points[1]!, line]);
      else boxes.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
    }
  }
  const clear = (b: Box) => {
    const g = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
    return !boxes.some((o) => o.x0 < g.x1 && o.x1 > g.x0 && o.y0 < g.y1 && o.y1 > g.y0)
      && !segments.some(([p, q, w]) => segmentHitsBox(p, q, { x0: g.x0 - w, y0: g.y0 - w, x1: g.x1 + w, y1: g.y1 + w }));
  };

  const out: DocObject[] = [];
  const found: number[] = [];
  for (const label of labels) {
    const places = labelPlaces(mol, label.at);
    found.push(places.length);
    const anchor = places[Math.min(places.length, Math.max(1, label.occurrence ?? 1)) - 1];
    const text = label.text.replace(/\s+/g, ' ').trim();
    if (!anchor || !text) continue;
    // On one line, or a longer label on two, whichever finds the closer place.
    const layouts = [[text]];
    const cut = text.length > 14 ? splitNearMiddle(text) : null;
    if (cut) layouts.push(cut);
    const open = openSide(mol, anchor.id);
    // Read as the anchor's: no other atom nearer the text (unless a leader shows which atom it is).
    const others = [...mol.atoms()].filter((a) => a.id !== anchor.id);
    const own = (box: Box) => {
      // The eye looks for the atom by the end of the text nearest it, and by the text as a whole (its middle).
      const q = { x: Math.min(Math.max(anchor.x, box.x0), box.x1), y: Math.min(Math.max(anchor.y, box.y0), box.y1) };
      const m = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
      const dq = Math.hypot(q.x - anchor.x, q.y - anchor.y), dm = Math.hypot(m.x - anchor.x, m.y - anchor.y);
      return others.every((a) => Math.hypot(q.x - a.x, q.y - a.y) > dq + L * 0.1 && Math.hypot(m.x - a.x, m.y - a.y) > dm);
    };
    const leaderClear = (from: Pt, to: Pt) => !segments.some(([p, q]) => segmentsCross(from, to, p, q))
      && !boxes.some((b) => segmentHitsBox(from, to, b));
    type Place = { box: Box; gap: number; dir: Pt; score: number; lines: string[] };
    let best: Place | null = null;
    const search = (lines: string[]) => {
      const hw = Math.max(...lines.map((l) => textWidth(l, size, false, style.captionFont))) / 2;
      const hh = (size + (lines.length - 1) * style.captionSize * 1.2) / 2;
      for (const gap of [0.3, 0.5, 0.75, 1.05, 1.4, 1.85, 2.4]) {
        // Nothing further out can beat what was found (a place scores at least its gap).
        if (best && gap >= best.score) return;
        for (let k = 0; k < 24; k++) {
          const t = (k * Math.PI) / 12;
          const dir = { x: Math.cos(t), y: Math.sin(t) };
          // From the atom out along dir to the box's near edge, then to its centre.
          const ext = Math.min(Math.abs(dir.x) > 1e-9 ? hw / Math.abs(dir.x) : Infinity, Math.abs(dir.y) > 1e-9 ? hh / Math.abs(dir.y) : Infinity);
          const cx = anchor.x + dir.x * (gap * L + ext), cy = anchor.y + dir.y * (gap * L + ext);
          const box = { x0: cx - hw, y0: cy - hh, x1: cx + hw, y1: cy + hh };
          // Closeness first; then the open side, a little preference for beside rather than above or below, one line, no leader.
          const leader = gap > LEADER_AFTER;
          const score = gap + 0.45 * (1 - Math.cos(t - open)) + 0.08 * Math.abs(dir.y) + (leader ? 0.5 : 0) + (lines.length - 1) * 0.15;
          if (best && score >= best.score) continue;
          if (!clear(box)) continue;
          if (leader ? !leaderClear(...leaderEnds(anchor, dir, gap, L)) : !own(box)) continue;
          best = { box, gap, dir, score, lines };
        }
      }
    };
    for (const lines of layouts) search(lines);
    const place = best as Place | null;
    if (!place) continue;
    const { box, gap, dir } = place;
    const shown = place.lines.join('\n');
    const caption = makeCaption((box.x0 + box.x1) / 2, box.y0 + size * 0.75, shown, [{ text: shown, size, color: label.color ?? GREY }], 'center');
    caption.color = label.color ?? GREY;
    out.push(caption);
    boxes.push(box);
    if (gap > LEADER_AFTER) {
      const [from, to] = leaderEnds(anchor, dir, gap, L);
      out.push(makeShape('line', [from, to], { line: 'dashed', color: LEADER }));
      segments.push([from, to, line]);
    }
  }
  return { objects: out, found };
}

/**
 * The direction with most room around an atom: the middle of the widest gap
 * between its bonds (out of a ring, along a chain's end), the more level one
 * when gaps tie, since text runs across.
 */
function openSide(mol: Molecule, id: AtomId): number {
  const a = mol.atom(id);
  const angles = mol.neighbours(id).map((n) => Math.atan2(mol.atom(n).y - a.y, mol.atom(n).x - a.x)).sort((p, q) => p - q);
  if (!angles.length) return 0;
  if (angles.length === 1) return angles[0]! + Math.PI;
  let best = 0, bestGap = -1, bestLevel = -1;
  angles.forEach((t, i) => {
    const next = i + 1 < angles.length ? angles[i + 1]! : angles[0]! + 2 * Math.PI;
    const gap = next - t, mid = t + gap / 2, level = Math.abs(Math.cos(mid));
    if (gap > bestGap + 0.05 || (Math.abs(gap - bestGap) <= 0.05 && level > bestLevel)) { best = mid; bestGap = gap; bestLevel = level; }
  });
  return best;
}

/** Distance from a point to a box (0 inside it). */
const toBox = (p: Pt, b: Box) => Math.hypot(Math.max(b.x0 - p.x, 0, p.x - b.x1), Math.max(b.y0 - p.y, 0, p.y - b.y1));

/** A label split in two at the space nearest its middle. */
function splitNearMiddle(text: string): [string, string] | null {
  let at = -1;
  for (let i = 0; i < text.length; i++) if (text[i] === ' ' && (at < 0 || Math.abs(i - text.length / 2) < Math.abs(at - text.length / 2))) at = i;
  return at > 0 ? [text.slice(0, at), text.slice(at + 1)] : null;
}

/** Whether segments ab and cd cross. */
function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const side = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0;
}

/** Whether segment pq crosses or lies in box b (Liang–Barsky clipping). */
function segmentHitsBox(p: Pt, q: Pt, b: Box): boolean {
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [pp, qq] of [[-dx, p.x - b.x0], [dx, b.x1 - p.x], [-dy, p.y - b.y0], [dy, b.y1 - p.y]] as const) {
    if (pp === 0) { if (qq < 0) return false; continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) return false; if (r > t0) t0 = r; } else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

