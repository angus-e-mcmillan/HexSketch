# Benchmark

How well HexSketch names and draws structures it has never seen, measured on
2,282 public structures. Reproduce it with `tools/bench/run.sh`
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
| Small organics (Huuskonen solubility set) | 1282 | 1278 (99.7%) | 1276 (99.8%) | 0 | 0 | 2 | 0 | 4 | 0 |
| Lead-like molecules (ZINC) | 500 | 482 (96.4%) | 479 (99.4%) | 1 | 0 | 1 | 1 | 18 | 0 |
| Fragment-like molecules (ZINC), held out | 500 | 480 (96.0%) | 473 (98.5%) | 0 | 3 | 2 | 2 | 20 | 0 |
| **All** | 2282 | 2240 (98.2%) | 2228 (99.5%) | 1 | 3 | 5 | 3 | 42 | 0 |

Median time to name a structure: 0.8 ms.

Why structures were declined:

- charged species: 21
- ring system without a supported parent name: 18
- ring entered from inside itself: 2
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
| HexSketch | 96.4% | 3.3% | 2.1% | 0.012 |
| RDKit | 98.6% | 1.2% | 1.2% | 0.003 |
| RDKit CoordGen | 99.0% | 0.7% | 0.5% | 0.005 |

HexSketch's drawings with overlaps or crossings are listed in
`tools/bench/layout-failures.tsv`. A side-by-side gallery is at
[hexsketch.com/benchmark](https://hexsketch.com/benchmark).

## The structures

- **Small organics (Huuskonen solubility set):** 1282 small organic molecules from Huuskonen,
  J. Chem. Inf. Comput. Sci. 2000, 40, 773, as distributed with RDKit.
- **Lead-like molecules (ZINC):** 500 lead-like molecules from the ZINC database, as
  distributed with RDKit (`Regress/Data/zinc.leads.500.q.smi`).

Both come from RDKit release `Release_2025_09_1` (`tools/bench/prep.py`).
