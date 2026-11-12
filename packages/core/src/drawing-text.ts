/**
 * The text of a drawing, for an AI to read: each reaction arrow, with the
 * structures at its ends and what is written above and below it ("Structure 1
 * + Structure 2 → ?  (above the arrow: NaBH3CN; below it: CH2Cl2/HFIP)"), and
 * any other text drawn (a question, a label beside an atom). Without it a
 * model sees the structures but not the reagents, so it guesses the reaction.
 *
 * Structures are numbered as aiSummary numbers them: in the order of
 * mol.fragments().
 */
import type { Molecule } from './model.ts';
import type { Arrow, Caption, DocObject } from './objects.ts';

type Pt = { x: number; y: number };
interface Box { x0: number; y0: number; x1: number; y1: number; cx: number; cy: number }

const box = (x0: number, y0: number, x1: number, y1: number): Box => ({ x0, y0, x1, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
const mid = (a: Arrow): Pt => ({ x: (a.tail.x + a.head.x) / 2, y: (a.tail.y + a.head.y) / 2 });
/** Straight arrows of a scheme: not curly (electron-pushing) or arc arrows. */
const isSchemeArrow = (o: DocObject): o is Arrow => o.kind === 'arrow' && !o.curve && !o.arc && o.headEnd !== 'none';
const isRetro = (a: Arrow) => a.headStyle === 'hollow' && a.shaftSpacing > 0;
const isEquilibrium = (a: Arrow) => a.shaftSpacing > 0 && a.headStyle !== 'hollow' && a.tailEnd !== 'none';
/**
 * A caption's lines as one line. Conditions wrap to fit the arrow, so a line
 * break is not always a boundary between reagents: where the line before it
 * already ends in a comma the break adds nothing, and where the next line
 * carries on in lower case ("ammonium" / "carbamate") it is one reagent's name
 * cut in two. Only a break that starts something new becomes a comma, so what
 * a chemist writes above an arrow is what a reader gets back.
 */
const oneLine = (t: string) =>
  t.trim().split(/\s*\n\s*/).filter(Boolean)
    .reduce((a, b) => (a ? `${a}${/[,;:]$/.test(a) || /^[a-z(]/.test(b) ? ' ' : ', '}${b}` : b), '');

/** Where a caption's text sits, roughly: its lines at the caption size, from its first baseline. */
function captionBox(c: Caption, size: number): Box {
  const lines = c.text.split('\n');
  const w = Math.max(...lines.map((l) => l.length)) * size * 0.55, h = lines.length * size * 1.2;
  const x0 = c.align === 'center' ? c.x - w / 2 : c.align === 'right' ? c.x - w : c.x;
  return box(x0, c.y - size, x0 + w, c.y - size + h);
}

/**
 * Lines describing the drawing's arrows and text; empty when it has none.
 * `bondLength` sets how near counts as "at" an arrow's end or "beside" an atom.
 */
export function drawingText(mol: Molecule, objects: readonly DocObject[], bondLength: number, captionSize = 10): string[] {
  const L = bondLength;
  const fragments = mol.fragments().map((ids) => {
    const xs = ids.map((i) => mol.atom(i).x), ys = ids.map((i) => mol.atom(i).y);
    return { ids, box: box(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)) };
  });
  const name = (f: (typeof fragments)[number]) => (fragments.length === 1 ? 'the structure' : `Structure ${fragments.indexOf(f) + 1}`);
  // Captions the editor writes for a structure (its formula or mass, kept up to date) are not the chemist's text.
  const captions = objects.filter((o): o is Caption => o.kind === 'text' && !!o.text.trim() && !o.analysis);
  const used = new Set<Caption>();
  const lines: string[] = [];

  const arrows = objects.filter(isSchemeArrow).sort((p, q) => mid(p).y - mid(q).y || mid(p).x - mid(q).x);
  for (const a of arrows) {
    const x0 = Math.min(a.tail.x, a.head.x) - L * 0.5, x1 = Math.max(a.tail.x, a.head.x) + L * 0.5, y = mid(a).y;
    const near = captions.filter((c) => { const b = captionBox(c, captionSize); return b.cx >= x0 && b.cx <= x1 && Math.abs(b.cy - y) < L * 1.8 && !/^[?+]+$/.test(c.text.trim()); })
      .sort((p, q) => p.y - q.y);
    for (const c of near) used.add(c);
    const above = near.filter((c) => captionBox(c, captionSize).cy < y).map((c) => oneLine(c.text));
    const below = near.filter((c) => captionBox(c, captionSize).cy >= y).map((c) => oneLine(c.text));
    /** The structures at an arrow's end: the nearest within reach, and those beside it on the same side ("A + B →"). */
    const at = (end: Pt) => {
      const other = end === a.tail ? a.head : a.tail;
      const dir = Math.sign(end.x - other.x) || 1;
      let nearest: (typeof fragments)[number] | null = null, d = L * 4;
      for (const f of fragments) {
        const dist = Math.hypot(Math.max(f.box.x0 - end.x, 0, end.x - f.box.x1), Math.max(f.box.y0 - end.y, 0, end.y - f.box.y1));
        if (dist < d) { d = dist; nearest = f; }
      }
      if (!nearest) {
        const q = captions.find((c) => /^\?+$/.test(c.text.trim()) && Math.hypot(captionBox(c, captionSize).cx - end.x, captionBox(c, captionSize).cy - end.y) < L * 3);
        if (q) used.add(q);
        return q ? '?' : 'nothing';
      }
      const n = nearest;
      return fragments.filter((f) => f === n || ((f.box.cx - end.x) * dir > 0 && f.box.y0 < n.box.y1 && f.box.y1 > n.box.y0 && Math.abs(f.box.cx - n.box.cx) < L * 10))
        .sort((p, q) => p.box.cx - q.box.cx).map(name).join(' + ');
    };
    const sign = isRetro(a) ? '⇒' : isEquilibrium(a) ? '⇌' : '→';
    const notes = [above.length ? `above the arrow: ${above.join('; ')}` : '', below.length ? `below it: ${below.join('; ')}` : ''].filter(Boolean).join('; ');
    lines.push(`${at(a.tail)} ${sign} ${at(a.head)}${notes ? `  (${notes})` : ''}`);
  }

  // Any other text: beside an atom (a label), or on its own.
  for (const c of captions) {
    if (used.has(c) || /^[+]+$/.test(c.text.trim())) continue;
    const b = captionBox(c, captionSize);
    let beside: { f: (typeof fragments)[number]; element: string; d: number } | null = null;
    for (const f of fragments) for (const id of f.ids) {
      const atom = mol.atom(id), d = Math.hypot(atom.x - b.cx, atom.y - b.cy);
      if (d < L * 1.3 && (!beside || d < beside.d)) beside = { f, element: atom.label ?? atom.element, d };
    }
    lines.push(beside && c.text.trim().length <= 12
      // "an N", "an F", "a C": element symbols are read as letters.
      ? `"${oneLine(c.text)}" written beside a${/^[AEFHILMNORSX]/.test(beside.element) ? 'n' : ''} ${beside.element} atom of ${name(beside.f)}`
      : `Text: "${oneLine(c.text)}"`);
  }
  return lines;
}
