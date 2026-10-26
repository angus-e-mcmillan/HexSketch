# Benchmark

Measures how well HexSketch names and draws structures it has never seen.
Results: `docs/benchmark.md` and hexsketch.com/benchmark.

```sh
pip install rdkit        # once; Java is also needed, for OPSIN
npm run bench            # or sh tools/bench/run.sh
```

- `structures.tsv`: the structures, built by `prep.py` from public sets in the
  RDKit repository (pinned to one release), and committed so every run uses
  the same ones.
- `hexsketch.ts`: names, 2D layouts and drawings from HexSketch, into `out/`
  (not committed).
- `score.py`: parses each name back with OPSIN and compares by InChI, scores
  HexSketch's layouts and RDKit's with the same code, and writes
  `results.json`, `failures.tsv`, `layout-failures.tsv`, `docs/benchmark.md`
  and `apps/web/public/benchmark.html`.

After a change to naming or layout, run it again and commit the new results
with the change, so the report always matches the code.
