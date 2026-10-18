import { elementBySymbol } from './elements.ts';
import { Molecule, type AtomId, type BondDisplay, type BondOrder } from './model.ts';

/**
 * MDL molfile V2000 reading and writing. Molfiles use angstroms with y up;
 * we scale so the average bond comes out at the drawing's bond length and
 * flip y, and do the reverse when writing (1.5 A per bond, the usual choice).
 */

const ANGSTROM_BOND = 1.5;

export function writeMolfile(mol: Molecule, bondLength = 18.43, title = ''): string {
  const atoms = [...mol.atoms()];
  const index = new Map<AtomId, number>(atoms.map((a, i) => [a.id, i + 1]));
  const k = ANGSTROM_BOND / bondLength;
  const cx = atoms.reduce((s, a) => s + a.x, 0) / Math.max(1, atoms.length);
  const cy = atoms.reduce((s, a) => s + a.y, 0) / Math.max(1, atoms.length);
  const pad = (v: string | number, n: number) => String(v).padStart(n);
  const lines = [title.slice(0, 80), '  HexSktch          2D', ''];
  const bonds = [...mol.bonds()];
  lines.push(`${pad(atoms.length, 3)}${pad(bonds.length, 3)}  0  0  0  0  0  0  0  0999 V2000`);
  const CHG: Record<number, number> = { 3: 1, 2: 2, 1: 3, [-1]: 5, [-2]: 6, [-3]: 7 };
  for (const a of atoms) {
    const x = ((a.x - cx) * k).toFixed(4), y = (-(a.y - cy) * k).toFixed(4);
    const sym = a.label ?? a.element;
    const chg = CHG[a.charge] ?? 0;
    // V2000 atom line: x y z (10.4 each), symbol (3, left), mass difference (2), charge code (3), then zeros.
    lines.push(`${pad(x, 10)}${pad(y, 10)}${pad('0.0000', 10)} ${(sym.length > 3 ? 'R#' : sym).padEnd(3)} 0${pad(chg, 3)}  0  0  0  0  0  0  0  0  0  0`);
  }
  const STEREO: Partial<Record<BondDisplay, number>> = { wedgeBegin: 1, hashBegin: 6, wavy: 4 };
  for (const b of bonds) {
    let [i, j] = [index.get(b.begin)!, index.get(b.end)!];
    let display = b.display;
    // Molfile stereo flags point from the first atom: flip the bond for the "End" variants.
    if (display === 'wedgeEnd') { [i, j] = [j, i]; display = 'wedgeBegin'; }
    if (display === 'hashEnd') { [i, j] = [j, i]; display = 'hashBegin'; }
    const order = b.order === 1.5 ? 4 : b.order;
    lines.push(`${pad(i, 3)}${pad(j, 3)}${pad(order, 3)}${pad(STEREO[display] ?? 0, 3)}`);
  }
  const charged = atoms.filter((a) => a.charge !== 0);
  for (let s = 0; s < charged.length; s += 8) {
    const chunk = charged.slice(s, s + 8);
    lines.push(`M  CHG${pad(chunk.length, 3)}${chunk.map((a) => `${pad(index.get(a.id)!, 4)}${pad(a.charge, 4)}`).join('')}`);
  }
  const iso = atoms.filter((a) => a.isotope !== null);
  if (iso.length) lines.push(`M  ISO${pad(iso.length, 3)}${iso.map((a) => `${pad(index.get(a.id)!, 4)}${pad(a.isotope!, 4)}`).join('')}`);
  lines.push('M  END');
  return lines.join('\n') + '\n';
}

export function readMolfile(text: string, bondLength = 18.43): Molecule {
  const lines = text.replace(/\r/g, '').split('\n');
  const counts = lines[3] ?? '';
  if (!/V2000/.test(counts) && counts.trim().length < 6) throw new Error('not a V2000 molfile');
  if (/V3000/.test(counts)) throw new Error('V3000 molfiles are not supported yet');
  const nAtoms = Number(counts.slice(0, 3)), nBonds = Number(counts.slice(3, 6));
  const mol = new Molecule();
  const ids: AtomId[] = [];
  const raw: { x: number; y: number }[] = [];
  for (let i = 0; i < nAtoms; i++) {
    const l = lines[4 + i] ?? '';
    const x = Number(l.slice(0, 10)), y = Number(l.slice(10, 20));
    const sym = l.slice(31, 34).trim();
    const chgCode = Number(l.slice(36, 39)) || 0;
    const charge = ({ 1: 3, 2: 2, 3: 1, 5: -1, 6: -2, 7: -3 } as Record<number, number>)[chgCode] ?? 0;
    const isElement = !!elementBySymbol(sym);
    ids.push(mol.addAtom({ element: isElement ? sym : 'C', label: isElement ? null : sym, x: 0, y: 0, charge }).id);
    raw.push({ x, y });
  }
  const STEREO: Record<number, BondDisplay> = { 1: 'wedgeBegin', 6: 'hashBegin', 4: 'wavy' };
  for (let i = 0; i < nBonds; i++) {
    const l = lines[4 + nAtoms + i] ?? '';
    const a = ids[Number(l.slice(0, 3)) - 1], b = ids[Number(l.slice(3, 6)) - 1];
    const t = Number(l.slice(6, 9)), st = Number(l.slice(9, 12)) || 0;
    if (a === undefined || b === undefined || a === b || mol.bondBetween(a, b)) continue;
    mol.addBond({ begin: a, end: b, order: (t === 4 ? 1.5 : Math.min(3, Math.max(1, t))) as BondOrder, display: t === 1 ? STEREO[st] ?? 'plain' : 'plain' });
  }
  // Properties block: charges and isotopes override the atom-line values.
  for (let i = 4 + nAtoms + nBonds; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.startsWith('M  END')) break;
    const m = /^M {2}(CHG|ISO)\s*(\d+)(.*)$/.exec(l);
    if (!m) continue;
    const nums = m[3]!.trim().split(/\s+/).map(Number);
    for (let k = 0; k + 1 < nums.length; k += 2) {
      const atom = ids[nums[k]! - 1];
      if (atom === undefined) continue;
      if (m[1] === 'CHG') mol.atom(atom).charge = nums[k + 1]!;
      else mol.atom(atom).isotope = nums[k + 1]!;
    }
  }
  // Scale to the drawing's bond length, y down.
  const bonds = [...mol.bonds()];
  const avg = bonds.length
    ? bonds.reduce((s, b) => { const p = raw[ids.indexOf(b.begin)]!, q = raw[ids.indexOf(b.end)]!; return s + Math.hypot(p.x - q.x, p.y - q.y); }, 0) / bonds.length
    : ANGSTROM_BOND;
  const k = avg > 1e-6 ? bondLength / avg : bondLength / ANGSTROM_BOND;
  ids.forEach((id, i) => { const a = mol.atom(id); a.x = raw[i]!.x * k; a.y = -raw[i]!.y * k; });
  return mol;
}
