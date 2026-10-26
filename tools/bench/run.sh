#!/bin/sh
# Run the naming and drawing benchmark (docs/benchmark.md). Needs Node 22,
# Java (for OPSIN) and RDKit (pip install rdkit). Offline apart from fetching
# OPSIN the first time.
set -e
cd "$(dirname "$0")/../.."
sh tools/opsin/fetch.sh
node --experimental-strip-types --no-warnings tools/bench/hexsketch.ts
python3 tools/bench/score.py
