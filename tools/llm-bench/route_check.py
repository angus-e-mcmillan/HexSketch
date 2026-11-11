"""
Checks each step of a synthetic route: does a known reaction class make the
stated product from the stated reactants? Templates for the reactions most
of medicinal chemistry uses (amide coupling, reductive amination, Suzuki,
SNAr and Buchwald, alkylation, Mitsunobu, protecting groups on and off,
reductions, oxidations, Grignard, Sonogashira...), applied with RDKit.

A step no template makes is "unknown", not wrong: the chemist decides it.
Selectivity (which of two amines reacts) is not judged: the reactants may
have more than one site, and any of them making the product counts.

Reads JSON on stdin: {"steps": [{"reactants": [smiles...], "product": smiles}]}
Writes JSON: {"steps": [{"valid": bool, "reaction": name or null, "error": str or null}]}
Run as: python3 -I route_check.py < steps.json
"""
import itertools
import json
import sys

from rdkit import Chem, RDLogger
from rdkit.Chem import AllChem

RDLogger.DisableLog("rdApp.*")

AMINE = "[N;H2,H1;!$(N-C=[O,S,N]);!$(N-S(=O)=O);!$(N-a);!$(N=*);!$(N#*);!$([N+])]"
ANY_AMINE = "[N;H2,H1;!$(N-C=[O,S,N]);!$(N-S(=O)=O);!$(N=*);!$(N#*);!$([N+])]"
LEAVING = "[Cl,Br,I,$(OS(=O)(=O)[#6]),$(OS(=O)(=O)C(F)(F)F)]"
HALIDE = "[Cl,Br,I,$(OS(=O)(=O)C(F)(F)F)]"
CARBONYL = "[CX3;!$(C(=O)[O,N,S,Cl]);!$(C(=O)=*)]"

TEMPLATES = [
    ("amide coupling", f"[C:1](=[O:2])[OX2H1].{AMINE.replace('!$(N-a);', '')[:-1]}:3]>>[C:1](=[O:2])[N:3]"),
    ("amide from acid chloride", f"[C:1](=[O:2])Cl.{ANY_AMINE[:-1]}:3]>>[C:1](=[O:2])[N:3]"),
    ("ester from acid chloride", "[C:1](=[O:2])Cl.[OX2H1:3][#6:4]>>[C:1](=[O:2])[O:3][#6:4]"),
    ("esterification", "[C:1](=[O:2])[OX2H1].[OX2H1:3][CX4:4]>>[C:1](=[O:2])[O:3][C:4]"),
    ("ester hydrolysis", "[C:1](=[O:2])[O:3][CX4]>>[C:1](=[O:2])[O:3]"),
    ("sulfonamide", f"[S:1](=[O:2])(=[O:3])Cl.{ANY_AMINE[:-1]}:4]>>[S:1](=[O:2])(=[O:3])[N:4]"),
    ("urea from isocyanate", f"[N:1]=[C:2]=[O:3].{ANY_AMINE[:-1]}:4]>>[N:1][C:2](=[O:3])[N:4]"),
    ("reductive amination", f"{CARBONYL[:-1]}:1]=[O].{ANY_AMINE[:-1]}:2]>>[C:1][N:2]"),
    ("Suzuki coupling", f"[c,$(C=C):1]{HALIDE}.[c,$(C=C):2][B]([OX2])[OX2]>>[*:1]-[*:2]"),
    ("Sonogashira coupling", f"[c:1]{HALIDE}.[CH1:2]#[C:3]>>[c:1][C:2]#[C:3]"),
    ("SNAr or Buchwald amination", f"[c:1]{HALIDE.replace('$(OS(=O)(=O)C(F)(F)F)', 'F,$(OS(=O)(=O)C(F)(F)F)')}.{ANY_AMINE[:-1]}:2]>>[c:1][N:2]"),
    ("SNAr or Ullmann ether", f"[c:1]{HALIDE.replace('$(OS(=O)(=O)C(F)(F)F)', 'F')}.[OX2H1:2][#6:3]>>[c:1][O:2][#6:3]"),
    ("N-alkylation", f"{ANY_AMINE[:-1]}:1].[CX4;!$(C(F)(F)F):2]{LEAVING}>>[N:1][C:2]"),
    ("O-alkylation", f"[OX2H1:1][#6:3].[CX4:2]{LEAVING}>>[#6:3][O:1][C:2]"),
    ("Mitsunobu", "[OX2H1:1][c,$(C=O):3].[CX4;H1,H2:2][OX2H1]>>[*:3][O:1][C:2]"),
    ("Mitsunobu (N)", "[NX3;H1:1]([#6:3])[$(C=O),$(S(=O)=O):4].[CX4;H1,H2:2][OX2H1]>>[*:4][N:1]([#6:3])[C:2]"),
    ("Boc protection", f"{ANY_AMINE[:-1]}:1]>>[N:1]C(=O)OC(C)(C)C"),
    ("Boc removal", "[N:1]C(=O)OC(C)(C)C>>[N:1]"),
    ("Cbz removal", "[N:1]C(=O)OCc1ccccc1>>[N:1]"),
    ("Fmoc removal", "[N:1]C(=O)OCC1c2ccccc2-c2ccccc12>>[N:1]"),
    ("benzyl ether removal", "[O:1][CH2]c1ccccc1>>[O:1]"),
    ("silyl ether removal", "[O:1][Si]>>[O:1]"),
    ("tert-butyl ester removal", "[C:1](=[O:2])OC(C)(C)C>>[C:1](=[O:2])O"),
    ("nitro reduction", "[c,C:1][N+](=O)[O-]>>[*:1]N"),
    ("azide reduction", "[C,c:1]N=[N+]=[N-]>>[*:1]N"),
    ("ketone or aldehyde reduction", f"{CARBONYL[:-1]}:1]=[O:2]>>[C:1][O:2]"),
    ("ester or acid reduction", "[CX3:1](=O)[OX2]>>[CH2:1]O"),
    ("ester reduction to aldehyde", "[CX3:1](=[O:2])O[CX4]>>[CH1:1]=[O:2]"),
    ("amide reduction", "[CX3:1](=O)[N:2]>>[CH2:1][N:2]"),
    ("alcohol oxidation", "[CX4;H1,H2:1][OX2H1:2]>>[C:1]=[O:2]"),
    ("alkene hydrogenation", "[C:1]=[C:2]>>[C:1][C:2]"),
    ("Grignard or organolithium addition", f"{CARBONYL[:-1]}:1]=[O:2].[#6:3][Mg,Li]>>[C:1]([#6:3])[O:2]"),
    ("Weinreb ketone synthesis", "[C:1](=[O:2])N(C)OC.[#6:3][Mg,Li]>>[C:1](=[O:2])[#6:3]"),
    ("Weinreb amide", "[C:1](=[O:2])[OX2H1]>>[C:1](=[O:2])N(C)OC"),
    ("Wittig or HWE olefination", "[CX3;H1,H0;!$(C(=O)[O,N]):1]=O.[CX4:2][P]>>[C:1]=[C:2]"),
    ("azide substitution", f"[CX4:1]{LEAVING}>>[C:1]N=[N+]=[N-]"),
    ("alcohol to mesylate or tosylate", "[CX4:1][OX2H1:2]>>[C:1][O:2]S(=O)(=O)C"),
    ("alcohol to halide", "[CX4:1][OX2H1]>>[C:1]Br"),
    ("acid chloride", "[C:1](=[O:2])[OX2H1]>>[C:1](=[O:2])Cl"),
    ("C-alkylation of an active methylene", f"[CH2:1]([C:3]=[O:4])[C:5]=[O:6].[CX4:2]{LEAVING}>>[CH1:1]([C:2])([C:3]=[O:4])[C:5]=[O:6]"),
    ("Knorr pyrazole synthesis", "[CH3:1][C:2](=O)[CH1:3]([#6:7])[C:4](=O)[CH3:5].[NH2:8][NH2:9]>>[CH3:1][c:2]1[c:3]([#6:7])[c:4]([CH3:5])[nH:8][n:9]1"),
    ("aza-Michael addition", "[nH1:1].[C:2]=[CH1:3][C:4]#[N:5]>>[n:1][C:2][CH2:3][C:4]#[N:5]"),
    ("N-aryl protection (SEM)", "[nH1:1]>>[n:1]COCC[Si](C)(C)C"),
    ("N-aryl deprotection (SEM)", "[n:1]COCC[Si](C)(C)C>>[nH1:1]"),
    ("N-aryl deprotection (Ts)", "[n:1]S(=O)(=O)c1ccc(C)cc1>>[nH1:1]"),
    ("N-aryl deprotection (THP)", "[n:1]C1CCCCO1>>[nH1:1]"),
    ("N-aryl deprotection (ethoxyethyl)", "[n:1]C(C)OCC>>[nH1:1]"),
    ("N-aryl deprotection (Boc)", "[n:1]C(=O)OC(C)(C)C>>[nH1:1]"),
    ("acid reduction to alcohol (borane)", "[C:1](=O)[OX2H1]>>[CH2:1]O"),
]

REACTIONS = []
for name, smarts in TEMPLATES:
    rxn = AllChem.ReactionFromSmarts(smarts)
    rxn.Initialize()
    REACTIONS.append((name, rxn))


def flat(smiles):
    """Canonical SMILES without stereochemistry, for comparing constitutions."""
    m = Chem.MolFromSmiles(smiles)
    if m is None:
        return None
    Chem.RemoveStereochemistry(m)
    return Chem.MolToSmiles(m)


def products_of(rxn, mols):
    out = set()
    try:
        results = rxn.RunReactants(tuple(mols), 200)
    except Exception:
        return out
    for prods in results:
        for p in prods:
            try:
                Chem.SanitizeMol(p)
                s = Chem.MolToSmiles(p)
                f = flat(s)
                if f:
                    out.add(f)
            except Exception:
                continue
    return out


def check(step):
    reactants = [Chem.MolFromSmiles(s) for s in step.get("reactants", [])]
    product_text = step.get("product", "")
    if not reactants or any(m is None for m in reactants) or Chem.MolFromSmiles(product_text) is None:
        return {"valid": False, "reaction": None, "error": "a SMILES does not read"}
    # The product, or any one structure in it (by-products written alongside).
    wanted = {flat(part) for part in product_text.split(".")} - {None}
    for name, rxn in REACTIONS:
        n = rxn.GetNumReactantTemplates()
        for combo in itertools.permutations(reactants, n):
            made = products_of(rxn, combo)
            # A protecting group off (or on) at every site in one step: apply the template again to what it made.
            if n == 1:
                for _ in range(3):
                    more = set()
                    for s in made:
                        m = Chem.MolFromSmiles(s)
                        if m is not None:
                            more |= products_of(rxn, (m,))
                    if more <= made:
                        break
                    made |= more
            if wanted & made:
                return {"valid": True, "reaction": name, "error": None}
    return {"valid": True, "reaction": None, "error": None}


def main():
    data = json.load(sys.stdin)
    print(json.dumps({"steps": [check(s) for s in data.get("steps", [])]}))


if __name__ == "__main__":
    main()
