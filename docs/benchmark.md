# Benchmark

How well HexSketch names and draws structures it has never seen, measured on
1,782 public structures. Reproduce it with `tools/bench/run.sh`
(needs Java and RDKit; see `tools/bench/README.md`).

## Naming

Each structure is named by HexSketch offline. The name is parsed back to a
structure by [OPSIN](https://github.com/dan2097/opsin) 2.9.0, an
independent name-to-structure tool, and the two are compared by standard InChI
(RDKit 2026.09.1). A name counts as correct only if it gives back
exactly the structure, stereochemistry included. "E/Z added" means the name
gives a double bond's geometry that the input SMILES left open (HexSketch names
the drawing, where the bond is drawn one way round). When HexSketch can't name
a structure it says so rather than guess ("declined").

| Set | Structures | Named | Correct (of named) | E/Z added | Wrong stereo | Wrong structure | Name OPSIN can't read | Declined | Error |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Small organics (Huuskonen solubility set) | 1282 | 1074 (83.8%) | 1071 (99.7%) | 0 | 0 | 2 | 1 | 207 | 1 |
| Lead-like molecules (ZINC) | 500 | 192 (38.4%) | 175 (91.1%) | 0 | 5 | 10 | 2 | 304 | 4 |
| **All** | 1782 | 1266 (71.0%) | 1246 (98.4%) | 0 | 5 | 12 | 3 | 511 | 5 |

Median time to name a structure: 0.5 ms.

Why structures were declined:

- ring system without a supported parent name: 383
- charged species: 82
- no parent hydride: 20
- substituent chain: 12
- ring substituent without a supported name: 11
- nitrogen substituent: 2
- esters with different alkyl groups: 1

Every wrong name, unreadable name and error is listed in
`tools/bench/failures.tsv`.

## Drawing

The same structures laid out in 2D by HexSketch and by RDKit (its default
depiction and CoordGen), scored by the same code:

- **Clean:** no atoms drawn on top of each other (closer than 0.4 bond
  lengths) or on a bond they aren't part of (closer than 0.25), and no bonds
  crossing.
- **Bond length spread:** standard deviation of bond lengths over their mean,
  lower is more even.

| Layout | Clean | Atoms overlapping | Crossing bonds | Bond length spread |
|---|---:|---:|---:|---:|
| HexSketch | 96.3% | 3.5% | 2.2% | 0.012 |
| RDKit | 98.5% | 1.4% | 1.3% | 0.003 |
| RDKit CoordGen | 99.0% | 0.9% | 0.4% | 0.006 |

HexSketch's drawings with overlaps or crossings are listed in
`tools/bench/layout-failures.tsv`. A side-by-side gallery is at
[hexsketch.com/benchmark](https://hexsketch.com/benchmark).

## The structures

- **Small organics (Huuskonen solubility set):** 1282 small organic molecules from Huuskonen,
  J. Chem. Inf. Comput. Sci. 2000, 40, 773, as distributed with RDKit.
- **Lead-like molecules (ZINC):** 500 lead-like molecules from the ZINC database, as
  distributed with RDKit (`Regress/Data/zinc.leads.500.q.smi`).

Both come from RDKit release `Release_2025_09_1` (`tools/bench/prep.py`).
