"""
Structures as a standard toolkit draws them from SMILES: RDKit's 2D layout,
as a molfile per structure, for comparing with HexSketch's drawings.

Reads JSON on stdin: {"smiles": [...]}; writes {"molfiles": [molfile or null]}.
Run as: python3 -I depict.py < in.json
"""
import json
import sys

from rdkit import Chem, RDLogger
from rdkit.Chem import rdDepictor

RDLogger.DisableLog("rdApp.*")
rdDepictor.SetPreferCoordGen(True)


def depict(smiles):
    m = Chem.MolFromSmiles(smiles)
    if m is None:
        return None
    rdDepictor.Compute2DCoords(m)
    Chem.WedgeMolBonds(m, m.GetConformer())
    return Chem.MolToMolBlock(m)


print(json.dumps({"molfiles": [depict(s) for s in json.load(sys.stdin).get("smiles", [])]}))
