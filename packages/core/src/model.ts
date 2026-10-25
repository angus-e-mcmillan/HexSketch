import { elementBySymbol, type ElementData } from './elements.ts';

export type AtomId = number;
export type BondId = number;

/** How a bond is drawn. Mirrors the CDXML Bond_Display enumeration. */
export type BondDisplay =
  | 'plain'
  | 'wedgeBegin'      // solid wedge, narrow at begin atom
  | 'wedgeEnd'        // solid wedge, narrow at end atom
  | 'hashBegin'       // hashed wedge, narrow at begin atom
  | 'hashEnd'
  | 'wavy'            // undefined stereochemistry
  | 'bold'            // uniform bold, no stereochemistry implied
  | 'hash'            // uniform hash
  | 'dashed'
  | 'either';         // crossed double bond: E/Z unspecified

export type BondOrder = 1 | 2 | 3 | 4 | 1.5;

/**
 * Which side of a double bond the second line sits on. 'auto' lets the
 * renderer choose (ring interior, else the more substituted side), which is
 * what ChemDraw does until the user overrides it.
 */
export type DoubleBondPosition = 'auto' | 'center' | 'left' | 'right';

export interface Atom {
  readonly id: AtomId;
  element: string;
  /** Page coordinates in points (1/72 inch), y increasing downward as in CDXML. */
  x: number;
  y: number;
  charge: number;
  /** Mass number for a labelled isotope; null means natural abundance. */
  isotope: number | null;
  /** Unpaired electrons: 0 none, 1 doublet/radical, 2 triplet. */
  radical: number;
  /**
   * Explicit hydrogen count. null means "derive from valence", which is what
   * a freshly drawn atom does. Set to a number when a file or the user pins it.
   */
  explicitHydrogens: number | null;
  /** Free-text label when the atom is a superatom such as "Ph" or "OTf". */
  label: string | null;
  /** Stereocentre parity as read from a file; recomputed from geometry when drawing. */
  stereoParity: 'R' | 'S' | 'unspecified' | null;
  /**
   * Tetrahedral configuration, in SMILES terms: looking from `order[0]`
   * toward this atom, `order[1..3]` run anticlockwise when `anticlockwise`
   * is true (SMILES @). -1 stands for an implicit hydrogen. Filled from SMILES
   * or from wedge geometry; null when unspecified.
   */
  chirality: { order: AtomId[]; anticlockwise: boolean } | null;
  /** Colour of the atom label (Colors menu), '#rrggbb'; null draws in the foreground colour. */
  color?: string | null;
  /** Highlight Colors: a coloured band or label background behind the atom. */
  highlight?: string | null;
}

export interface Bond {
  readonly id: BondId;
  begin: AtomId;
  end: AtomId;
  order: BondOrder;
  display: BondDisplay;
  doubleBondPosition: DoubleBondPosition;
  /** Double-bond configuration: are substituents ref[0] (on begin) and ref[1] (on end) cis? */
  ez: { ref: [AtomId, AtomId]; cis: boolean } | null;
  /** Colour of the bond lines, '#rrggbb'; null draws in the foreground colour. */
  color?: string | null;
  /** Highlight Colors: a coloured band behind the bond. */
  highlight?: string | null;
}

/** Ring Fill Colors: a ring's interior painted behind its bonds; dropped when the ring is broken. */
export interface RingFill { atoms: AtomId[]; color: string }

export interface AtomInit extends Partial<Omit<Atom, 'id'>> {
  element: string;
  x: number;
  y: number;
}

export interface BondInit extends Partial<Omit<Bond, 'id' | 'begin' | 'end'>> {
  begin: AtomId;
  end: AtomId;
}

/**
 * A connection table with 2D coordinates.
 *
 * Atoms and bonds are held in insertion order and addressed by stable ids, so
 * deleting an atom never renumbers the others. Adjacency is maintained
 * incrementally because the editor queries it on every pointer move.
 */
export class Molecule {
  #atoms = new Map<AtomId, Atom>();
  #bonds = new Map<BondId, Bond>();
  #adjacency = new Map<AtomId, Set<BondId>>();
  #nextAtomId: AtomId = 1;
  #nextBondId: BondId = 1;
  /** Filled rings, by their atoms in ring order. */
  ringFills: RingFill[] = [];

  get atomCount(): number { return this.#atoms.size; }
  get bondCount(): number { return this.#bonds.size; }

  atoms(): IterableIterator<Atom> { return this.#atoms.values(); }
  bonds(): IterableIterator<Bond> { return this.#bonds.values(); }

  atom(id: AtomId): Atom {
    const a = this.#atoms.get(id);
    if (!a) throw new Error(`no atom ${id}`);
    return a;
  }

  bond(id: BondId): Bond {
    const b = this.#bonds.get(id);
    if (!b) throw new Error(`no bond ${id}`);
    return b;
  }

  hasAtom(id: AtomId): boolean { return this.#atoms.has(id); }
  hasBond(id: BondId): boolean { return this.#bonds.has(id); }

  addAtom(init: AtomInit): Atom {
    const atom: Atom = {
      id: this.#nextAtomId++,
      element: init.element,
      x: init.x,
      y: init.y,
      charge: init.charge ?? 0,
      isotope: init.isotope ?? null,
      radical: init.radical ?? 0,
      explicitHydrogens: init.explicitHydrogens ?? null,
      label: init.label ?? null,
      stereoParity: init.stereoParity ?? null,
      chirality: init.chirality ?? null,
      color: init.color ?? null,
      highlight: init.highlight ?? null,
    };
    this.#atoms.set(atom.id, atom);
    this.#adjacency.set(atom.id, new Set());
    return atom;
  }

  addBond(init: BondInit): Bond {
    if (!this.#atoms.has(init.begin)) throw new Error(`no atom ${init.begin}`);
    if (!this.#atoms.has(init.end)) throw new Error(`no atom ${init.end}`);
    if (init.begin === init.end) throw new Error('bond to self');
    const existing = this.bondBetween(init.begin, init.end);
    if (existing) throw new Error(`atoms ${init.begin}-${init.end} already bonded`);

    const bond: Bond = {
      id: this.#nextBondId++,
      begin: init.begin,
      end: init.end,
      order: init.order ?? 1,
      display: init.display ?? 'plain',
      doubleBondPosition: init.doubleBondPosition ?? 'auto',
      ez: init.ez ?? null,
      color: init.color ?? null,
      highlight: init.highlight ?? null,
    };
    this.#bonds.set(bond.id, bond);
    this.#adjacency.get(bond.begin)!.add(bond.id);
    this.#adjacency.get(bond.end)!.add(bond.id);
    return bond;
  }

  removeAtom(id: AtomId): void {
    const incident = this.#adjacency.get(id);
    if (!incident) return;
    for (const bondId of [...incident]) this.removeBond(bondId);
    this.#adjacency.delete(id);
    this.#atoms.delete(id);
  }

  removeBond(id: BondId): void {
    const bond = this.#bonds.get(id);
    if (!bond) return;
    // "If in any case the ring is broken, the color will be removed" (ChemDraw help).
    this.ringFills = this.ringFills.filter((f) => !f.atoms.some((a, i) => {
      const b = f.atoms[(i + 1) % f.atoms.length]!;
      return (a === bond.begin && b === bond.end) || (a === bond.end && b === bond.begin);
    }));
    this.#adjacency.get(bond.begin)?.delete(id);
    this.#adjacency.get(bond.end)?.delete(id);
    this.#bonds.delete(id);
  }

  /** Bond ids touching an atom. */
  incidentBonds(id: AtomId): readonly BondId[] {
    return [...(this.#adjacency.get(id) ?? [])];
  }

  /** Atom ids one bond away. */
  neighbours(id: AtomId): readonly AtomId[] {
    const out: AtomId[] = [];
    for (const bondId of this.#adjacency.get(id) ?? []) {
      const b = this.#bonds.get(bondId)!;
      out.push(b.begin === id ? b.end : b.begin);
    }
    return out;
  }

  bondBetween(a: AtomId, b: AtomId): Bond | undefined {
    for (const bondId of this.#adjacency.get(a) ?? []) {
      const bond = this.#bonds.get(bondId)!;
      if (bond.begin === b || bond.end === b) return bond;
    }
    return undefined;
  }

  otherAtom(bond: Bond, from: AtomId): AtomId {
    return bond.begin === from ? bond.end : bond.begin;
  }

  /** Sum of bond orders at an atom, counting aromatic bonds as 1.5 then rounding up. */
  bondOrderSum(id: AtomId): number {
    let sum = 0;
    for (const bondId of this.#adjacency.get(id) ?? []) {
      sum += this.#bonds.get(bondId)!.order;
    }
    // An aromatic carbon reads 1.5+1.5+1 = 4; ceil keeps Kekule and aromatic
    // forms agreeing on implicit hydrogen count.
    return Number.isInteger(sum) ? sum : Math.ceil(sum);
  }

  /**
   * Hydrogens drawn implicitly at an atom.
   *
   * Follows the usual organic-editor rule: pick the smallest standard valence
   * that covers the bonds already present, adjust for charge, and subtract.
   * Carbocations lose a hydrogen, carbanions keep theirs, and anything with an
   * explicit count set bypasses the model entirely.
   */
  implicitHydrogens(id: AtomId): number {
    const atom = this.atom(id);
    if (atom.explicitHydrogens !== null) return atom.explicitHydrogens;
    if (atom.label !== null) return 0; // superatoms carry their own formula

    const el = elementBySymbol(atom.element);
    if (!el || el.valences.length === 0) return 0;

    const used = this.bondOrderSum(id) + atom.radical;
    const target = pickValence(el, atom.charge, used);
    return Math.max(0, target - used);
  }

  /**
   * Bonds, radical electrons and pinned hydrogens beyond the most the element
   * allows at its charge: 1 for a five-bond carbon. 0 when within valence, and
   * for superatoms and elements without valence data.
   */
  excessValence(id: AtomId): number {
    const atom = this.atom(id);
    if (atom.label !== null) return 0;
    const el = elementBySymbol(atom.element);
    if (!el || el.valences.length === 0) return 0;
    const used = this.bondOrderSum(id) + atom.radical + (atom.explicitHydrogens ?? 0);
    return Math.max(0, used - pickValence(el, atom.charge, used));
  }

  /**
   * For an atom with its hydrogen count pinned (a bracket atom in SMILES, a
   * file's H count), how many bonds or hydrogens short of the element's
   * valence it is: 1 for [CH2] in C[CH2]. 0 for atoms whose hydrogens follow
   * from valence, radicals counted as filling it.
   */
  missingValence(id: AtomId): number {
    const atom = this.atom(id);
    if (atom.label !== null || atom.explicitHydrogens === null) return 0;
    const el = elementBySymbol(atom.element);
    if (!el || el.valences.length === 0) return 0;
    const used = this.bondOrderSum(id) + atom.radical + atom.explicitHydrogens;
    return Math.max(0, pickValence(el, atom.charge, used) - used);
  }

  /** Connected components, as arrays of atom ids. */
  fragments(): AtomId[][] {
    const seen = new Set<AtomId>();
    const out: AtomId[][] = [];
    for (const atom of this.#atoms.values()) {
      if (seen.has(atom.id)) continue;
      const component: AtomId[] = [];
      const stack = [atom.id];
      seen.add(atom.id);
      while (stack.length) {
        const current = stack.pop()!;
        component.push(current);
        for (const n of this.neighbours(current)) {
          if (!seen.has(n)) { seen.add(n); stack.push(n); }
        }
      }
      out.push(component);
    }
    return out;
  }

  clone(): Molecule {
    const copy = new Molecule();
    const idMap = new Map<AtomId, AtomId>();
    // Ids are kept, so selections and objects that name atoms (linked captions) survive undo.
    for (const a of this.#atoms.values()) {
      copy.#nextAtomId = a.id;
      idMap.set(a.id, copy.addAtom({ ...a, chirality: null }).id);
    }
    copy.#nextAtomId = this.#nextAtomId;
    const remap = (id: AtomId) => (id === -1 ? -1 : idMap.get(id) ?? -1);
    for (const a of this.#atoms.values()) {
      if (a.chirality) copy.atom(idMap.get(a.id)!).chirality = { order: a.chirality.order.map(remap), anticlockwise: a.chirality.anticlockwise };
    }
    for (const b of this.#bonds.values()) {
      copy.#nextBondId = b.id;
      copy.addBond({
        ...b, begin: idMap.get(b.begin)!, end: idMap.get(b.end)!,
        ez: b.ez ? { ref: [remap(b.ez.ref[0]), remap(b.ez.ref[1])], cis: b.ez.cis } : null,
      });
    }
    copy.#nextBondId = this.#nextBondId;
    copy.ringFills = this.ringFills.map((f) => ({ atoms: f.atoms.map(remap), color: f.color }));
    return copy;
  }
}

/**
 * Choose the standard valence an atom is aiming for.
 *
 * Picks the smallest standard valence that still covers the bonds present, so
 * that sulfur reads as divalent in a thioether but hexavalent in a sulfone.
 */
function pickValence(el: ElementData, charge: number, used: number): number {
  const shift = chargeShift(el, charge);
  let best = -1;
  for (const v of el.valences) {
    const target = v + shift;
    if (target >= used) return target;
    best = target;
  }
  return best < 0 ? 0 : best;
}

/** Main-group column, 13 through 17. Anything else returns null. */
function mainGroup(symbol: string): number | null {
  if (['B', 'Al', 'Ga', 'In', 'Tl'].includes(symbol)) return 13;
  if (['C', 'Si', 'Ge', 'Sn', 'Pb'].includes(symbol)) return 14;
  if (['N', 'P', 'As', 'Sb', 'Bi'].includes(symbol)) return 15;
  if (['O', 'S', 'Se', 'Te', 'Po'].includes(symbol)) return 16;
  if (['F', 'Cl', 'Br', 'I', 'At'].includes(symbol)) return 17;
  return null;
}

/**
 * How charge changes the number of bonding slots.
 *
 * Groups 15-17 have a lone pair to donate, so a cation gains a slot and an
 * anion loses one: NH4+ takes four bonds, NH2- takes two. Group 13 is electron
 * deficient and behaves oppositely, giving BH4- its four bonds. Group 14 sits
 * at the crossover and loses a slot either way, which is why both CH3+ and
 * CH3- carry three hydrogens.
 */
function chargeShift(el: ElementData, charge: number): number {
  if (charge === 0) return 0;
  switch (mainGroup(el.symbol)) {
    case 15:
    case 16:
    case 17:
      return charge;
    case 13:
      return -charge;
    case 14:
      return -Math.abs(charge);
    default:
      // Metals and transition elements: treat charge as consuming valence,
      // which keeps Na+ and Ca2+ from sprouting hydrogens.
      return -Math.abs(charge);
  }
}
