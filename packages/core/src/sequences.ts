/**
 * Text that reads as a sequence: a peptide in three-letter code
 * ("H-Ala-Gly-OH") or an oligonucleotide ("5'-ACGT-3'", "d(GATC)"). A caption
 * or lone label holding one is chemically meaningful: it has a formula and a
 * mass, and Expand Label draws it out.
 */
import { Molecule } from './model.ts';
import { oligoCounts, oligoMolecule, oligoSmiles, parseOligo } from './nucleotides.ts';
import { parsePeptide, peptideCounts, peptideMolecule, peptideSmiles } from './peptides.ts';

export function isSequence(text: string): boolean { return !!parsePeptide(text) || !!parseOligo(text); }

/** SMILES of the structure a sequence stands for, or null when the text is not one. */
export function sequenceSmiles(text: string): string | null {
  const p = parsePeptide(text);
  if (p) return peptideSmiles(p);
  const o = parseOligo(text);
  return o ? oligoSmiles(o) : null;
}

/** The structure drawn out: a peptide as a backbone zigzag, an oligonucleotide as a strand. */
export function sequenceMolecule(text: string, L = 18.43): Molecule | null {
  const p = parsePeptide(text);
  if (p) return peptideMolecule(p, L);
  const o = parseOligo(text);
  return o ? oligoMolecule(o, L) : null;
}

/** Atom counts (with hydrogens) of a sequence, without building its structure. */
export function sequenceCounts(text: string): Map<string, number> | null {
  const p = parsePeptide(text);
  if (p) return peptideCounts(p);
  const o = parseOligo(text);
  return o ? oligoCounts(o) : null;
}
