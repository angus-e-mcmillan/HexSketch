import { perceiveRings, type AtomId, type Molecule } from '@hexsketch/core';

/** Characteristic groups in decreasing seniority (IUPAC 2013, P-41). */
export const SENIORITY = ['carboxylate', 'sulfonate', 'olate', 'thiolate', 'ide', 'ium', 'iminium', 'aminium', 'diazonium', 'acid', 'peracid', 'sulfonic', 'ester', 'sulfonateEster', 'acylHalide', 'sulfonylHalide', 'amide', 'sulfonamide', 'urea', 'nitrile', 'aldehyde', 'ketone', 'alcohol', 'thiol', 'amine'] as const;
export type GroupKind = (typeof SENIORITY)[number];

export interface Group {
  kind: GroupKind;
  /** Skeletal atom that takes the suffix locant: the group's own carbon for acids, esters,
   *  amides, nitriles, acyl halides and aldehydes; the C=O carbon for ketones; the carbon
   *  bearing OH, SH or N for alcohols, thiols and amines. */
  anchor: AtomId;
  /** True when the anchor is the group's own carbon (it may end a chain, or hang off a ring). */
  ownCarbon: boolean;
  /** Heteroatoms that belong to the group and must not be named again as prefixes. */
  consumed: AtomId[];
  /** Ester alkoxy carbon, amide/amine N substituent carbons. */
  esterCarbon?: AtomId;
  nitrogen?: AtomId;
  halogen?: string;
  /** C=S in place of C=O (a thiourea or thioamide), or S in place of the ester O (a thioate). */
  thio?: boolean;
  /** A sulfinic acid or what is made from it: S(=O) rather than S(=O)2. */
  sulfin?: boolean;
  /** An amidine (C(=NH)N) or a hydrazide (C(=O)NHNH2) rather than an amide. */
  imid?: boolean;
  hydrazide?: boolean;
}

export interface Analysis {
  mol: Molecule;
  h: Map<AtomId, number>;
  ringAtoms: Set<AtomId>;
  ringBonds: Set<number>;
  /** Connected ring systems (fused rings share bonds). */
  ringSystems: AtomId[][];
  groups: Group[];
}

export function analyze(mol: Molecule): Analysis {
  const h = new Map<AtomId, number>();
  for (const a of mol.atoms()) h.set(a.id, mol.implicitHydrogens(a.id));

  const rings = perceiveRings(mol);
  const ringAtoms = new Set<AtomId>();
  const ringBonds = new Set<number>();
  for (const r of rings) { r.atoms.forEach((a) => ringAtoms.add(a)); r.bonds.forEach((b) => ringBonds.add(b)); }

  // Ring systems: components of the graph made of ring bonds only.
  const ringSystems: AtomId[][] = [];
  const seen = new Set<AtomId>();
  for (const start of ringAtoms) {
    if (seen.has(start)) continue;
    const comp: AtomId[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const b of mol.incidentBonds(x)) {
        if (!ringBonds.has(b)) continue;
        const y = mol.otherAtom(mol.bond(b), x);
        if (!seen.has(y)) { seen.add(y); stack.push(y); }
      }
    }
    ringSystems.push(comp);
  }

  // Thiones only where no ketone is present: a ketone takes the suffix, a C=S is then thioxo.
  let groups = findGroups(mol, h, ringAtoms);
  if (groups.some((g) => g.kind === 'ketone' && !g.thio)) groups = groups.filter((g) => !(g.kind === 'ketone' && g.thio));
  return { mol, h, ringAtoms, ringBonds, ringSystems, groups };
}

const el = (mol: Molecule, id: AtomId) => mol.atom(id).element;

function findGroups(mol: Molecule, h: Map<AtomId, number>, ringAtoms: Set<AtomId>): Group[] {
  const groups: Group[] = [];
  const claimed = new Set<AtomId>();

  for (const c of mol.atoms()) {
    if (c.element !== 'C' || c.label !== null) continue;
    const nbrs = mol.incidentBonds(c.id).map((b) => ({ atom: mol.otherAtom(mol.bond(b), c.id), order: mol.bond(b).order }));
    const dblO = nbrs.find((n) => n.order === 2 && el(mol, n.atom) === 'O' && mol.neighbours(n.atom).length === 1);
    const tripN = nbrs.find((n) => n.order === 3 && el(mol, n.atom) === 'N' && mol.neighbours(n.atom).length === 1);
    const carbons = nbrs.filter((n) => el(mol, n.atom) === 'C');
    const singles = nbrs.filter((n) => n.order === 1 && el(mol, n.atom) !== 'C');

    // Amidines: C(=NH) with an open-chain amino nitrogen beside it and carbon (or nothing) on the other side.
    const dblNH = nbrs.find((n) => n.order === 2 && el(mol, n.atom) === 'N' && mol.neighbours(n.atom).length === 1 && !ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0);
    if (dblNH && !ringAtoms.has(c.id) && carbons.length <= 1) {
      const nAm = singles.filter((n) => el(mol, n.atom) === 'N' && !ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0
        && mol.incidentBonds(n.atom).every((b) => mol.bond(b).order === 1) && mol.neighbours(n.atom).every((m) => m === c.id || el(mol, m) === 'C'));
      if (nAm.length === 1 && singles.length === 1) {
        groups.push({ kind: 'amide', anchor: c.id, ownCarbon: true, consumed: [dblNH.atom, nAm[0]!.atom], nitrogen: nAm[0]!.atom, imid: true });
        claimed.add(dblNH.atom); claimed.add(nAm[0]!.atom);
        continue;
      }
    }
    // Thioureas and thioamides: C(=S) between two open-chain nitrogens, or on one with carbon beside it.
    const dblS = nbrs.find((n) => n.order === 2 && el(mol, n.atom) === 'S' && mol.neighbours(n.atom).length === 1 && mol.atom(n.atom).charge === 0);
    if (dblS && !ringAtoms.has(c.id)) {
      const ns = singles.filter((n) => el(mol, n.atom) === 'N' && !ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0
        && mol.incidentBonds(n.atom).every((b) => mol.bond(b).order === 1) && mol.neighbours(n.atom).every((m) => m === c.id || el(mol, m) === 'C'));
      if (ns.length === 2 && singles.length === 2 && carbons.length === 0) {
        groups.push({ kind: 'urea', anchor: c.id, ownCarbon: true, consumed: [dblS.atom, ns[0]!.atom, ns[1]!.atom], thio: true });
        claimed.add(dblS.atom); claimed.add(ns[0]!.atom); claimed.add(ns[1]!.atom);
        continue;
      }
      if (ns.length === 1 && singles.length === 1 && carbons.length <= 1) {
        groups.push({ kind: 'amide', anchor: c.id, ownCarbon: true, consumed: [dblS.atom, ns[0]!.atom], nitrogen: ns[0]!.atom, thio: true });
        claimed.add(dblS.atom); claimed.add(ns[0]!.atom);
        continue;
      }
    }
    // O-C#N and S-C#N are cyanates, named as prefixes (cyanatomethane).
    if (tripN && singles.some((n) => el(mol, n.atom) === 'O' || el(mol, n.atom) === 'S')) continue;
    if (tripN && !ringAtoms.has(c.id)) {
      groups.push({ kind: 'nitrile', anchor: c.id, ownCarbon: true, consumed: [tripN.atom] });
      claimed.add(tripN.atom);
      continue;
    }
    if (dblO && !ringAtoms.has(c.id)) {
      const oh = singles.find((n) => el(mol, n.atom) === 'O' && mol.neighbours(n.atom).length === 1 && h.get(n.atom) === 1);
      const oMinus = singles.find((n) => el(mol, n.atom) === 'O' && mol.neighbours(n.atom).length === 1 && mol.atom(n.atom).charge === -1);
      if (oMinus && carbons.length + singles.length <= 2) {
        groups.push({ kind: 'carboxylate', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, oMinus.atom] });
        claimed.add(dblO.atom); claimed.add(oMinus.atom);
        continue;
      }
      // Peroxy acid C(=O)OOH: benzenecarboperoxoic acid.
      const oo = singles.find((n) => el(mol, n.atom) === 'O' && mol.neighbours(n.atom).length === 2 && mol.neighbours(n.atom).some((m) => m !== c.id && el(mol, m) === 'O' && mol.neighbours(m).length === 1 && h.get(m) === 1));
      if (oo && carbons.length + singles.length <= 2) {
        const end = mol.neighbours(oo.atom).find((m) => m !== c.id)!;
        groups.push({ kind: 'peracid', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, oo.atom, end] });
        claimed.add(dblO.atom); claimed.add(oo.atom); claimed.add(end);
        continue;
      }
      const or = singles.find((n) => el(mol, n.atom) === 'O' && mol.neighbours(n.atom).length === 2 && !ringAtoms.has(n.atom));
      const x = singles.find((n) => ['F', 'Cl', 'Br', 'I'].includes(el(mol, n.atom)));
      // The nitrogen of an amide carries carbon, or an oxygen (N-hydroxy, a Weinreb amide's N-methoxy).
      // (or a sulfonyl: an N-sulfonyl amide is named as the amide, N-((4-aminophenyl)sulfonyl)acetamide).
      const sulfonyl = (m: AtomId) => el(mol, m) === 'S' && mol.neighbours(m).filter((o) => el(mol, o) === 'O' && mol.bondBetween(m, o)!.order === 2).length === 2;
      const nAmide = singles.find((n) => el(mol, n.atom) === 'N' && !ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0
        && mol.neighbours(n.atom).every((m) => m === c.id || el(mol, m) === 'C' || sulfonyl(m) || (el(mol, m) === 'O' && !ringAtoms.has(m) && mol.atom(m).charge === 0)) && mol.incidentBonds(n.atom).every((b) => mol.bond(b).order === 1));
      const others = carbons.length + singles.length;
      // Urea: C(=O) between two open-chain nitrogens, named as the parent "urea".
      const ureaN = singles.filter((n) => el(mol, n.atom) === 'N' && !ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0
        && mol.incidentBonds(n.atom).every((b) => mol.bond(b).order === 1));
      // One open-chain N and one ring N: a carboxamide on the ring nitrogen (2-oxoimidazolidine-1-carboxamide).
      const ringNs = singles.filter((n) => el(mol, n.atom) === 'N' && ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0);
      if (ureaN.length === 1 && ringNs.length === 1 && others === 2 && mol.neighbours(ureaN[0]!.atom).every((m) => m === c.id || el(mol, m) === 'C')) {
        groups.push({ kind: 'amide', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, ureaN[0]!.atom], nitrogen: ureaN[0]!.atom });
        claimed.add(dblO.atom); claimed.add(ureaN[0]!.atom);
        continue;
      }
      if (ureaN.length === 2 && others === 2) {
        groups.push({ kind: 'urea', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, ureaN[0]!.atom, ureaN[1]!.atom] });
        claimed.add(dblO.atom); claimed.add(ureaN[0]!.atom); claimed.add(ureaN[1]!.atom);
        continue;
      }
      if (oh && others <= 2) { groups.push({ kind: 'acid', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, oh.atom] }); claimed.add(dblO.atom); claimed.add(oh.atom); continue; }
      // An S-ester: C(=O)-S-R, an ...thioate.
      const sr = singles.find((n) => el(mol, n.atom) === 'S' && mol.neighbours(n.atom).length === 2 && !ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0);
      if (sr && !or && others <= 2 && singles.length === 1) {
        const esterCarbon = mol.neighbours(sr.atom).find((m) => m !== c.id)!;
        if (el(mol, esterCarbon) === 'C' && !isAcylCarbon(mol, esterCarbon) && !mol.incidentBonds(esterCarbon).some((b) => mol.bond(b).order === 2 && el(mol, mol.otherAtom(mol.bond(b), esterCarbon)) === 'S')) {
          groups.push({ kind: 'ester', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, sr.atom], esterCarbon, thio: true });
          claimed.add(dblO.atom); claimed.add(sr.atom);
          continue;
        }
      }
      // A hydrazide: C(=O)-NH-NH2.
      const nHyd = singles.find((n) => el(mol, n.atom) === 'N' && !ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0 && mol.incidentBonds(n.atom).every((b) => mol.bond(b).order === 1)
        && mol.neighbours(n.atom).length === 2 && mol.neighbours(n.atom).some((m) => m !== c.id && el(mol, m) === 'N' && mol.neighbours(m).length === 1 && mol.atom(m).charge === 0 && !ringAtoms.has(m)));
      if (nHyd && singles.length === 1 && others <= 2) {
        const n2 = mol.neighbours(nHyd.atom).find((m) => m !== c.id)!;
        groups.push({ kind: 'amide', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, nHyd.atom, n2], nitrogen: nHyd.atom, hydrazide: true });
        claimed.add(dblO.atom); claimed.add(nHyd.atom); claimed.add(n2);
        continue;
      }
      if (or && others <= 2) {
        const esterCarbon = mol.neighbours(or.atom).find((m) => m !== c.id)!;
        if ((el(mol, esterCarbon) === 'C' && !isAcylCarbon(mol, esterCarbon)) || el(mol, esterCarbon) === 'Si') {
          groups.push({ kind: 'ester', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, or.atom], esterCarbon });
          claimed.add(dblO.atom); claimed.add(or.atom);
          continue;
        }
      }
      if (x && others <= 2) { groups.push({ kind: 'acylHalide', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, x.atom], halogen: el(mol, x.atom) }); claimed.add(dblO.atom); claimed.add(x.atom); continue; }
      if (nAmide && others <= 2 && singles.length === 1) { groups.push({ kind: 'amide', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, nAmide.atom], nitrogen: nAmide.atom }); claimed.add(dblO.atom); claimed.add(nAmide.atom); continue; }
      if (singles.length === 0 && carbons.length <= 1 && (h.get(c.id) ?? 0) >= 1) {
        groups.push({ kind: 'aldehyde', anchor: c.id, ownCarbon: true, consumed: [dblO.atom] });
        claimed.add(dblO.atom);
        continue;
      }
    }
    // A ring C=S beside ring heteroatoms, named as a thione: imidazolidine-2-thione.
    const ringS = nbrs.find((n) => n.order === 2 && el(mol, n.atom) === 'S' && mol.neighbours(n.atom).length === 1 && mol.atom(n.atom).charge === 0);
    if (ringS && !dblO && ringAtoms.has(c.id) && singles.length >= 1 && singles.every((n) => ringAtoms.has(n.atom) && ['N', 'O', 'S'].includes(el(mol, n.atom)))
        && carbons.length + singles.length === 2) {
      groups.push({ kind: 'ketone', anchor: c.id, ownCarbon: false, consumed: [ringS.atom], thio: true });
      claimed.add(ringS.atom);
      continue;
    }
    if (dblO && ringAtoms.has(c.id) && singles.every((n) => ringAtoms.has(n.atom) && ['N', 'O', 'S'].includes(el(mol, n.atom)))
        && carbons.length + singles.length === 2) {
      groups.push({ kind: 'ketone', anchor: c.id, ownCarbon: false, consumed: [dblO.atom] });
      claimed.add(dblO.atom);
      continue;
    }
    // A ketene's C=O: ethenone, 2,2-diphenylethen-1-one.
    if (dblO && !ringAtoms.has(c.id) && singles.length === 0 && carbons.length === 1 && carbons[0]!.order === 2) {
      groups.push({ kind: 'ketone', anchor: c.id, ownCarbon: false, consumed: [dblO.atom] });
      claimed.add(dblO.atom);
      continue;
    }
    if (dblO && singles.length === 0 && carbons.length === 2) {
      groups.push({ kind: 'ketone', anchor: c.id, ownCarbon: false, consumed: [dblO.atom] });
      claimed.add(dblO.atom);
      continue;
    }
    // An open-chain C=O on a ring nitrogen with nothing but carbon or ring nitrogens beside it is named as a
    // ketone: 1-(piperidin-1-yl)prop-2-en-1-one, di(1H-imidazol-1-yl)methanone.
    if (dblO && !ringAtoms.has(c.id) && singles.length >= 1 && carbons.length + singles.length === 2
        && singles.every((n) => el(mol, n.atom) === 'N' && ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0)) {
      groups.push({ kind: 'ketone', anchor: c.id, ownCarbon: false, consumed: [dblO.atom] });
      claimed.add(dblO.atom);
    }
  }

  // Sulfonic acids and what is made from them, on a carbon: R-SO2-OH, -O-, -OR, -X, -NR2.
  for (const sAtom of mol.atoms()) {
    if (sAtom.element !== 'S' || sAtom.charge !== 0 || ringAtoms.has(sAtom.id) || mol.neighbours(sAtom.id).length !== 4) continue;
    const nb = mol.incidentBonds(sAtom.id).map((b) => ({ atom: mol.otherAtom(mol.bond(b), sAtom.id), order: mol.bond(b).order }));
    const oxo = nb.filter((n) => n.order === 2 && el(mol, n.atom) === 'O' && mol.neighbours(n.atom).length === 1);
    const carbon = nb.filter((n) => n.order === 1 && el(mol, n.atom) === 'C');
    const rest = nb.filter((n) => n.order === 1 && el(mol, n.atom) !== 'C');
    if (oxo.length !== 2 || carbon.length !== 1 || rest.length !== 1) continue;
    const x = rest[0]!.atom, xe = el(mol, x), xn = mol.neighbours(x);
    const base = { anchor: carbon[0]!.atom, ownCarbon: false, consumed: [sAtom.id, x, oxo[0]!.atom, oxo[1]!.atom] };
    let made: Group | null = null;
    if (xe === 'O' && xn.length === 1 && mol.atom(x).charge === -1) made = { kind: 'sulfonate', ...base };
    else if (xe === 'O' && xn.length === 1 && h.get(x) === 1) made = { kind: 'sulfonic', ...base };
    else if (xe === 'O' && xn.length === 2 && !ringAtoms.has(x)) {
      const r = xn.find((m) => m !== sAtom.id)!;
      if ((el(mol, r) === 'C' && !isAcylCarbon(mol, r)) || el(mol, r) === 'Si') made = { kind: 'sulfonateEster', ...base, esterCarbon: r };
    } else if (['F', 'Cl', 'Br', 'I'].includes(xe)) made = { kind: 'sulfonylHalide', ...base, halogen: xe };
    else if (xe === 'N' && xn.length === 2 && mol.atom(x).charge === 0 && xn.some((m) => m !== sAtom.id && el(mol, m) === 'N' && mol.atom(m).charge === 1)) {
      // A sulfonyl azide: -N=N+=N-.
      const n2 = xn.find((m) => m !== sAtom.id)!, n3 = mol.neighbours(n2).find((m) => m !== x);
      if (n3 !== undefined && el(mol, n3) === 'N' && mol.atom(n3).charge === -1 && mol.neighbours(n3).length === 1) {
        made = { kind: 'sulfonylHalide', ...base, consumed: [...base.consumed, n2, n3], halogen: 'N3' };
      }
    }
    else if (xe === 'N' && !groups.some((g) => g.kind === 'amide' && g.nitrogen === x) && !ringAtoms.has(x) && mol.atom(x).charge === 0 && mol.incidentBonds(x).every((b) => mol.bond(b).order === 1)
      && xn.every((m) => m === sAtom.id || el(mol, m) === 'C')) made = { kind: 'sulfonamide', ...base, nitrogen: x };
    if (!made) continue;
    groups.push(made);
    for (const a of made.consumed) claimed.add(a);
  }

  // Sulfinic acids and what is made from them: R-S(=O)-OH, -NR2, -OR (a sulfur stereocentre often).
  for (const sAtom of mol.atoms()) {
    if (sAtom.element !== 'S' || sAtom.charge !== 0 || ringAtoms.has(sAtom.id) || claimed.has(sAtom.id) || mol.neighbours(sAtom.id).length !== 3) continue;
    const nb = mol.incidentBonds(sAtom.id).map((b) => ({ atom: mol.otherAtom(mol.bond(b), sAtom.id), order: mol.bond(b).order }));
    const oxo = nb.filter((n) => n.order === 2 && el(mol, n.atom) === 'O' && mol.neighbours(n.atom).length === 1);
    const carbon = nb.filter((n) => n.order === 1 && el(mol, n.atom) === 'C');
    const rest = nb.filter((n) => n.order === 1 && el(mol, n.atom) !== 'C');
    if (oxo.length !== 1 || carbon.length !== 1 || rest.length !== 1) continue;
    const x = rest[0]!.atom, xe = el(mol, x), xn = mol.neighbours(x);
    const base = { anchor: carbon[0]!.atom, ownCarbon: false, consumed: [sAtom.id, x, oxo[0]!.atom], sulfin: true };
    let made: Group | null = null;
    if (xe === 'O' && xn.length === 1 && h.get(x) === 1) made = { kind: 'sulfonic', ...base };
    else if (xe === 'N' && !ringAtoms.has(x) && mol.atom(x).charge === 0 && mol.incidentBonds(x).every((b) => mol.bond(b).order === 1)
      && xn.every((m) => m === sAtom.id || el(mol, m) === 'C')) made = { kind: 'sulfonamide', ...base, nitrogen: x };
    if (!made) continue;
    groups.push(made);
    for (const a of made.consumed) claimed.add(a);
  }

  // Groups on a carbon: OH, SH, NH2/NHR/NR2.
  for (const x of mol.atoms()) {
    if (claimed.has(x.id)) continue;
    // Ions: alkoxide/phenoxide O-, and ammonium N+ with only carbon or hydrogen neighbours.
    if (x.charge === -1 && x.element === 'O' && mol.neighbours(x.id).length === 1 && el(mol, mol.neighbours(x.id)[0]!) === 'C'
        && !isAcylCarbon(mol, mol.neighbours(x.id)[0]!)) {
      groups.push({ kind: 'olate', anchor: mol.neighbours(x.id)[0]!, ownCarbon: false, consumed: [x.id] });
      continue;
    }
    if (x.charge === 1 && x.element === 'N' && mol.neighbours(x.id).length >= 1 && mol.neighbours(x.id).every((n) => el(mol, n) === 'C')
        && mol.incidentBonds(x.id).every((b) => mol.bond(b).order === 1) && !ringAtoms.has(x.id)) {
      groups.push({ kind: 'aminium', anchor: mol.neighbours(x.id)[0]!, ownCarbon: false, consumed: [x.id], nitrogen: x.id });
      continue;
    }
    // Thiolate S- on carbon: benzenethiolate.
    if (x.charge === -1 && x.element === 'S' && mol.neighbours(x.id).length === 1 && el(mol, mol.neighbours(x.id)[0]!) === 'C'
        && !isAcylCarbon(mol, mol.neighbours(x.id)[0]!)) {
      groups.push({ kind: 'thiolate', anchor: mol.neighbours(x.id)[0]!, ownCarbon: false, consumed: [x.id] });
      continue;
    }
    // Anionic ring nitrogen: 1H-tetrazol-1-ide.
    if (x.charge === -1 && x.element === 'N' && ringAtoms.has(x.id) && isRingAnion(mol, x.id)) {
      groups.push({ kind: 'ide', anchor: x.id, ownCarbon: false, consumed: [] });
      continue;
    }
    // Diazonium on a carbon: benzenediazonium.
    if (x.charge === 1 && x.element === 'N' && mol.neighbours(x.id).length === 2) {
      const nn = mol.neighbours(x.id).find((n) => el(mol, n) === 'N' && mol.bondBetween(x.id, n)!.order === 3 && mol.neighbours(n).length === 1 && mol.atom(n).charge === 0);
      const c = mol.neighbours(x.id).find((n) => el(mol, n) === 'C' && mol.bondBetween(x.id, n)!.order === 1);
      if (nn !== undefined && c !== undefined) { groups.push({ kind: 'diazonium', anchor: c, ownCarbon: false, consumed: [x.id, nn] }); claimed.add(nn); continue; }
    }
    // Iminium C=N+: propan-2-iminium, N-methylpyrrolidin-2-iminium.
    if (x.charge === 1 && x.element === 'N' && !ringAtoms.has(x.id) && isIminium(mol, x.id)) {
      const c = mol.neighbours(x.id).find((n) => mol.bondBetween(x.id, n)!.order === 2)!;
      groups.push({ kind: 'iminium', anchor: c, ownCarbon: false, consumed: [x.id], nitrogen: x.id });
      continue;
    }
    // Cationic ring nitrogen (piperidin-1-ium, pyridin-1-ium): named on its ring.
    if (x.charge === 1 && ringAtoms.has(x.id) && isRingCation(mol, x.id)) {
      groups.push({ kind: 'ium', anchor: x.id, ownCarbon: false, consumed: [] });
      continue;
    }
    if (x.charge !== 0) continue;
    const carbonNbrs = mol.neighbours(x.id).filter((n) => el(mol, n) === 'C');
    const allBondsSingle = mol.incidentBonds(x.id).every((b) => mol.bond(b).order === 1);
    if (!allBondsSingle || ringAtoms.has(x.id)) continue;
    if (x.element === 'O' && mol.neighbours(x.id).length === 1 && h.get(x.id) === 1 && carbonNbrs.length === 1) {
      groups.push({ kind: 'alcohol', anchor: carbonNbrs[0]!, ownCarbon: false, consumed: [x.id] });
    } else if (x.element === 'S' && mol.neighbours(x.id).length === 1 && h.get(x.id) === 1 && carbonNbrs.length === 1) {
      groups.push({ kind: 'thiol', anchor: carbonNbrs[0]!, ownCarbon: false, consumed: [x.id] });
    } else if (x.element === 'N' && carbonNbrs.length === mol.neighbours(x.id).length && carbonNbrs.length >= 1
      && carbonNbrs.every((c) => !isAcylCarbon(mol, c))) {
      // One group per nitrogen; the anchor is chosen later among its carbons.
      groups.push({ kind: 'amine', anchor: carbonNbrs[0]!, ownCarbon: false, consumed: [x.id], nitrogen: x.id });
    }
  }
  return groups;
}

/** A ring N+ named with -ium: bonded to ring atoms, carbon, hydrogen or an oxido O-, and not nitro. */
export function isRingCation(mol: Molecule, n: AtomId): boolean {
  const a = mol.atom(n);
  // Pyrylium-type O+ and S+: two ring bonds, one of them double.
  if ((a.element === 'O' || a.element === 'S') && a.charge === 1) {
    return mol.neighbours(n).length === 2 && mol.incidentBonds(n).some((b) => mol.bond(b).order === 2);
  }
  if (a.element !== 'N' || a.charge !== 1) return false;
  return mol.neighbours(n).every((m) => el(mol, m) === 'C' || el(mol, m) === 'N' || (el(mol, m) === 'O' && mol.atom(m).charge === -1 && mol.neighbours(m).length === 1))
    && mol.neighbours(n).filter((m) => el(mol, m) === 'O').length <= 1;
}

/** A ring N- with only ring neighbours (the conjugate base of an NH). */
export function isRingAnion(mol: Molecule, n: AtomId): boolean {
  const a = mol.atom(n);
  return a.element === 'N' && a.charge === -1 && mol.neighbours(n).length === 2 && mol.incidentBonds(n).every((b) => mol.bond(b).order === 1);
}

/** An open-chain C=N+ with only carbon or hydrogen otherwise on the nitrogen. */
export function isIminium(mol: Molecule, n: AtomId): boolean {
  const a = mol.atom(n);
  if (a.element !== 'N' || a.charge !== 1) return false;
  const dbl = mol.incidentBonds(n).filter((b) => mol.bond(b).order === 2);
  if (dbl.length !== 1 || mol.incidentBonds(n).some((b) => mol.bond(b).order > 2)) return false;
  const c = mol.otherAtom(mol.bond(dbl[0]!), n);
  return el(mol, c) === 'C' && mol.neighbours(n).every((m) => el(mol, m) === 'C');
}

/** Carbon double-bonded to O or N (acyl/imidoyl), which disqualifies ester alkyls and amines. */
export function isAcylCarbon(mol: Molecule, c: AtomId): boolean {
  if (el(mol, c) !== 'C') return false;
  return mol.incidentBonds(c).some((b) => {
    const bd = mol.bond(b);
    const o = mol.otherAtom(bd, c);
    return bd.order === 2 && (el(mol, o) === 'O' || el(mol, o) === 'S');
  });
}
