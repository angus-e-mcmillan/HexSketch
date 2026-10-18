import { perceiveRings, type AtomId, type Molecule } from '@hexsketch/core';

/** Characteristic groups in decreasing seniority (IUPAC 2013, P-41). */
export const SENIORITY = ['carboxylate', 'olate', 'aminium', 'acid', 'ester', 'acylHalide', 'amide', 'nitrile', 'aldehyde', 'ketone', 'alcohol', 'thiol', 'amine'] as const;
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

  return { mol, h, ringAtoms, ringBonds, ringSystems, groups: findGroups(mol, h, ringAtoms) };
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
      const or = singles.find((n) => el(mol, n.atom) === 'O' && mol.neighbours(n.atom).length === 2 && !ringAtoms.has(n.atom));
      const x = singles.find((n) => ['F', 'Cl', 'Br', 'I'].includes(el(mol, n.atom)));
      const nAmide = singles.find((n) => el(mol, n.atom) === 'N' && !ringAtoms.has(n.atom) && mol.atom(n.atom).charge === 0
        && mol.neighbours(n.atom).every((m) => m === c.id || el(mol, m) === 'C'));
      const others = carbons.length + singles.length;
      if (oh && others <= 2) { groups.push({ kind: 'acid', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, oh.atom] }); claimed.add(dblO.atom); claimed.add(oh.atom); continue; }
      if (or && others <= 2) {
        const esterCarbon = mol.neighbours(or.atom).find((m) => m !== c.id)!;
        if ((el(mol, esterCarbon) === 'C' && !isAcylCarbon(mol, esterCarbon)) || el(mol, esterCarbon) === 'Si') {
          groups.push({ kind: 'ester', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, or.atom], esterCarbon });
          claimed.add(dblO.atom); claimed.add(or.atom);
          continue;
        }
      }
      if (x && others <= 2) { groups.push({ kind: 'acylHalide', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, x.atom], halogen: el(mol, x.atom) }); claimed.add(dblO.atom); claimed.add(x.atom); continue; }
      if (nAmide && others <= 2) { groups.push({ kind: 'amide', anchor: c.id, ownCarbon: true, consumed: [dblO.atom, nAmide.atom], nitrogen: nAmide.atom }); claimed.add(dblO.atom); claimed.add(nAmide.atom); continue; }
      if (singles.length === 0 && carbons.length <= 1 && (h.get(c.id) ?? 0) >= 1) {
        groups.push({ kind: 'aldehyde', anchor: c.id, ownCarbon: true, consumed: [dblO.atom] });
        claimed.add(dblO.atom);
        continue;
      }
    }
    if (dblO && ringAtoms.has(c.id) && singles.every((n) => ringAtoms.has(n.atom) && (el(mol, n.atom) === 'N' || el(mol, n.atom) === 'O'))
        && carbons.length + singles.length === 2) {
      groups.push({ kind: 'ketone', anchor: c.id, ownCarbon: false, consumed: [dblO.atom] });
      claimed.add(dblO.atom);
      continue;
    }
    if (dblO && singles.length === 0 && carbons.length === 2) {
      groups.push({ kind: 'ketone', anchor: c.id, ownCarbon: false, consumed: [dblO.atom] });
      claimed.add(dblO.atom);
    }
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

/** Carbon double-bonded to O or N (acyl/imidoyl), which disqualifies ester alkyls and amines. */
export function isAcylCarbon(mol: Molecule, c: AtomId): boolean {
  return mol.incidentBonds(c).some((b) => {
    const bd = mol.bond(b);
    const o = mol.otherAtom(bd, c);
    return bd.order === 2 && (el(mol, o) === 'O' || el(mol, o) === 'S');
  });
}
