"""Build tools/bench/structures.tsv from public sets in the RDKit repository.

Run once (python3 tools/bench/prep.py); the TSV is committed so the benchmark
always runs on the same structures. Needs RDKit and network access to GitHub.

- solubility: Huuskonen's aqueous solubility set (J. Chem. Inf. Comput. Sci.
  2000, 40, 773), as shipped in RDKit's Docs/Book/data: 1,282 small organics,
  each with a common or trivial name.
- zinc-leads: 500 lead-like molecules from ZINC, RDKit's Regress/Data.
"""
import csv
import io
import sys
import urllib.request

from rdkit import Chem, RDLogger

RDLogger.DisableLog('rdApp.*')
TAG = 'Release_2025_09_1'
BASE = f'https://raw.githubusercontent.com/rdkit/rdkit/{TAG}/'


def fetch(path: str) -> str:
    with urllib.request.urlopen(BASE + path) as r:
        return r.read().decode('utf-8')


rows = []
for part in ('train', 'test'):
    supplier = Chem.SDMolSupplier()
    supplier.SetData(fetch(f'Docs/Book/data/solubility.{part}.sdf'))
    for i, mol in enumerate(supplier):
        if mol is None:
            continue
        rows.append(('solubility', f'{part}-{i + 1}', mol.GetProp('_Name'), Chem.MolToSmiles(mol)))

for line in fetch('Regress/Data/zinc.leads.500.q.smi').splitlines():
    smiles, zid = line.split('\t')
    mol = Chem.MolFromSmiles(smiles)
    if mol is not None:
        rows.append(('zinc-leads', zid, '', Chem.MolToSmiles(mol)))

out = io.StringIO()
w = csv.writer(out, delimiter='\t', lineterminator='\n')
w.writerow(['set', 'id', 'label', 'smiles'])
w.writerows(rows)
with open('tools/bench/structures.tsv', 'w', encoding='utf-8') as f:
    f.write(out.getvalue())
print(f'{len(rows)} structures from RDKit {TAG}', file=sys.stderr)
