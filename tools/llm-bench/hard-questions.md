# HexSketch LLM benchmark: hard set (65 questions)

Each prompt is sent as written, followed by: `End with "ANSWER: " and <the SMILES | the name | the molecular formula (e.g. C9H8O4)>.` ★ = in the 33-question pilot.


## name2smiles

| # | | Question | Answer key | Graded as |
|---|---|---|---|---|
| 1 | ★ | Give the SMILES of 1,3,3-trimethylbicyclo[2.2.1]heptan-2-one. | `CC12CCC(C2)C(C)(C)C1=O` | connectivity |
| 2 | ★ | Give the SMILES of 1H,3H-benzo[de]isochromene-1,3-dione. | `O=C1OC(=O)c2cccc3cccc1c23` | connectivity |
| 3 | ★ | Give the SMILES of 4-chlorothieno[3,2-c]pyridine. | `Clc1nccc2sccc12` | connectivity |
| 4 |  | Give the SMILES of tricyclo[3.3.1.1^{3,7}]decan-1-amine. | `NC12CC3CC(CC(C3)C1)C2` | connectivity |
| 5 | ★ | Give the SMILES of 2,5,8,11-tetraoxadodecane. | `COCCOCCOCCOC` | connectivity |
| 6 |  | Give the SMILES of 6-methoxy-2H-1,4-benzoxazin-3(4H)-one. | `COc1ccc2OCC(=O)Nc2c1` | connectivity |
| 7 | ★ | Give the SMILES of 3-bromoimidazo[1,2-a]pyridine-6-carbonitrile. | `N#Cc1ccc2ncc(Br)n2c1` | connectivity |
| 8 |  | Give the SMILES of (1R,3S)-3-aminocyclopentane-1-carboxylic acid, with its stereochemistry. | `N[C@@H]1C[C@@H](CC1)C(=O)O` | stereoisomer |
| 9 | ★ | Give the SMILES of (2E,4Z,6E)-octa-2,4,6-trienal, with its stereochemistry. | `O=C/C=C/C=C\C=C\C` | stereoisomer |
| 10 |  | Give the SMILES of 2-azaspiro[3.3]heptane-6-carboxylic acid. | `OC(=O)C1CC2(C1)CNC2` | connectivity |
| 11 |  | Give the SMILES of 4H-quinolizin-4-one. | `O=c1cccc2ccccn12` | connectivity |
| 12 |  | Give the SMILES of 1-azabicyclo[2.2.2]octan-3-one. | `O=C1CN2CCC1CC2` | connectivity |

## smiles2name

| # | | Question | Answer key | Graded as |
|---|---|---|---|---|
| 13 | ★ | Give the IUPAC name of the compound with SMILES NC(=O)N1c2ccccc2C=Cc2ccccc21. | `NC(=O)N1c2ccccc2C=Cc2ccccc21` | name via OPSIN, connectivity |
| 14 | ★ | Give the IUPAC name of the compound with SMILES Brc1cnc2[nH]ccc2c1. | `Brc1cnc2[nH]ccc2c1` | name via OPSIN, connectivity |
| 15 |  | Give the IUPAC name of the compound with SMILES O=C1CCC2(CC1)OCCO2. | `O=C1CCC2(CC1)OCCO2` | name via OPSIN, connectivity |
| 16 | ★ | Give the IUPAC name of the compound with SMILES C[C@@]12CC[C@@H](C1(C)C)CC2=O, with its stereodescriptors. | `C[C@@]12CC[C@@H](C1(C)C)CC2=O` | name via OPSIN, stereoisomer |
| 17 | ★ | Give the IUPAC name of the compound with SMILES C/C=C/C=C\C(=O)O, with its stereodescriptors. | `C/C=C/C=C\C(=O)O` | name via OPSIN, stereoisomer |
| 18 |  | Give the IUPAC name of the compound with SMILES Nc1ccnc2ccnn12. | `Nc1ccnc2ccnn12` | name via OPSIN, connectivity |
| 19 |  | Give the IUPAC name of the compound with SMILES O[C@H]1CN2CCC1CC2, with its stereodescriptors. | `O[C@H]1CN2CCC1CC2` | name via OPSIN, stereoisomer |
| 20 |  | Give the IUPAC name of the compound with SMILES OC(=O)CC(=O)CC#N. | `OC(=O)CC(=O)CC#N` | name via OPSIN, connectivity |
| 21 | ★ | Give the IUPAC name of the compound with SMILES c1ccc2c(c1)[nH]c1cnccc12. | `c1ccc2c(c1)[nH]c1cnccc12` | name via OPSIN, connectivity |

## common2smiles

| # | | Question | Answer key | Graded as |
|---|---|---|---|---|
| 22 | ★ | Give the SMILES of strychnine, with every stereocentre. | `C1CN2CC3=CCO[C@H]4CC(=O)N5[C@H]6[C@H]4[C@H]3C[C@H]2[C@@]61C7=CC=CC=C75` | stereoisomer |
| 23 | ★ | Give the SMILES of morphine, with every stereocentre. | `CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O` | stereoisomer |
| 24 |  | Give the SMILES of quinine, with every stereocentre. | `COC1=CC2=C(C=CN=C2C=C1)[C@H]([C@@H]3C[C@@H]4CCN3C[C@@H]4C=C)O` | stereoisomer |
| 25 | ★ | Give the SMILES of cocaine, with every stereocentre. | `CN1[C@H]2CC[C@@H]1[C@H]([C@H](C2)OC(=O)C3=CC=CC=C3)C(=O)OC` | stereoisomer |
| 26 |  | Give the SMILES of artemisinin, with every stereocentre. | `C[C@@H]1CC[C@H]2[C@H](C(=O)O[C@H]3[C@@]24[C@H]1CC[C@](O3)(OO4)C)C` | stereoisomer |
| 27 | ★ | Give the SMILES of paclitaxel, with every stereocentre. | `CC1=C2[C@H](C(=O)[C@@]3([C@H](C[C@@H]4[C@]([C@H]3[C@@H]([C@@](C2(C)C)(C[C@@H]1OC(=O)[C@@H]([C@H](C5=CC=CC=C5)NC(=O)C6=CC=CC=C6)O)O)OC(=O)C7=CC=CC=C7)(CO4)OC(=O)C)O)C)OC(=O)C` | stereoisomer |
| 28 |  | Give the SMILES of oseltamivir, with every stereocentre. | `CCC(CC)O[C@@H]1C=C(C[C@@H]([C@H]1NC(=O)C)N)C(=O)OCC` | stereoisomer |
| 29 |  | Give the SMILES of atorvastatin, with every stereocentre. | `CC(C)C1=C(C(=C(N1CC[C@H](C[C@H](CC(=O)O)O)O)C2=CC=C(C=C2)F)C3=CC=CC=C3)C(=O)NC4=CC=CC=C4` | stereoisomer |
| 30 | ★ | Give the SMILES of sucrose, with every stereocentre. | `C([C@@H]1[C@H]([C@@H]([C@H]([C@H](O1)O[C@]2([C@H]([C@@H]([C@H](O2)CO)O)O)CO)O)O)O)O` | stereoisomer |
| 31 |  | Give the SMILES of dexamethasone, with every stereocentre. | `C[C@@H]1C[C@H]2[C@@H]3CCC4=CC(=O)C=C[C@@]4([C@]3([C@H](C[C@@]2([C@]1(C(=O)CO)O)C)O)F)C` | stereoisomer |
| 32 | ★ | Give the SMILES of ezetimibe, with every stereocentre. | `C1=CC(=CC=C1[C@@H]2[C@H](C(=O)N2C3=CC=C(C=C3)F)CC[C@@H](C4=CC=C(C=C4)F)O)O` | stereoisomer |
| 33 |  | Give the SMILES of erythromycin A, with every stereocentre. | `CC[C@@H]1[C@@]([C@@H]([C@H](C(=O)[C@@H](C[C@@]([C@@H]([C@H]([C@@H]([C@H](C(=O)O1)C)O[C@H]2C[C@@]([C@H]([C@@H](O2)C)O)(C)OC)C)O[C@H]3[C@@H]([C@H](C[C@H](O3)C)N(C)C)O)(C)O)C)C)O)(C)O` | stereoisomer |

## common2name

| # | | Question | Answer key | Graded as |
|---|---|---|---|---|
| 34 | ★ | Give the systematic IUPAC name of L-cysteine, with its R/S stereodescriptors (not a trivial name). | `C([C@@H](C(=O)O)N)S` | name via OPSIN, stereoisomer; "cysteine" not allowed |
| 35 | ★ | Give the systematic IUPAC name of L-threonine, with its R/S stereodescriptors (not a trivial name). | `C[C@H]([C@@H](C(=O)O)N)O` | name via OPSIN, stereoisomer; "threonine" not allowed |
| 36 |  | Give the systematic IUPAC name of L-isoleucine, with its R/S stereodescriptors (not a trivial name). | `CC[C@H](C)[C@@H](C(=O)O)N` | name via OPSIN, stereoisomer; "isoleucine" not allowed |
| 37 | ★ | Give the systematic IUPAC name of (−)-menthol, with its R/S stereodescriptors (not a trivial name). | `C[C@@H]1CC[C@H]([C@@H](C1)O)C(C)C` | name via OPSIN, stereoisomer; "menthol" not allowed |
| 38 |  | Give the systematic IUPAC name of (−)-ephedrine, with its R/S stereodescriptors (not a trivial name). | `C[C@@H]([C@@H](C1=CC=CC=C1)O)NC` | name via OPSIN, stereoisomer; "ephedrine" not allowed |
| 39 |  | Give the systematic IUPAC name of captopril, with its R/S stereodescriptors (not a trivial name). | `C[C@H](CS)C(=O)N1CCC[C@H]1C(=O)O` | name via OPSIN, stereoisomer; "captopril" not allowed |

## formula

| # | | Question | Answer key | Graded as |
|---|---|---|---|---|
| 40 | ★ | What is the molecular formula of vancomycin? | C66H75Cl2N9O24 | formula |
| 41 | ★ | What is the molecular formula of cyclosporin A? | C62H111N11O12 | formula |
| 42 |  | What is the molecular formula of sirolimus (rapamycin)? | C51H79NO13 | formula |
| 43 | ★ | What is the molecular formula of cyanocobalamin (vitamin B12)? | C63H88CoN14O14P | formula |
| 44 |  | What is the molecular formula of chlorophyll a? | C55H72MgN4O5 | formula |
| 45 | ★ | What is the molecular formula of amphotericin B? | C47H73NO17 | formula |
| 46 |  | What is the molecular formula of tacrolimus? | C44H69NO12 | formula |
| 47 |  | What is the molecular formula of bryostatin 1? | C47H68O17 | formula |

## smiles2formula

| # | | Question | Answer key | Graded as |
|---|---|---|---|---|
| 48 | ★ | What is the molecular formula of the compound with SMILES CC(C)C1=NC(=CS1)CN(C)C(=O)N[C@@H](C(C)C)C(=O)N[C@@H](CC2=CC=CC=C2)C[C@@H]([C@H](CC3=CC=CC=C3)NC(=O)OCC4=CN=CS4)O? | C37H48N6O5S2 | formula |
| 49 | ★ | What is the molecular formula of the compound with SMILES CC1(CCC(=C(C1)C2=CC=C(C=C2)Cl)CN3CCN(CC3)C4=CC(=C(C=C4)C(=O)NS(=O)(=O)C5=CC(=C(C=C5)NCC6CCOCC6)[N+](=O)[O-])OC7=CN=C8C(=C7)C=CN8)C? | C45H50ClN7O7S | formula |
| 50 |  | What is the molecular formula of the compound with SMILES CCC(CC)COC(=O)[C@H](C)N[P@](=O)(OC[C@@H]1[C@H]([C@H]([C@](O1)(C#N)C2=CC=C3N2N=CN=C3N)O)O)OC4=CC=CC=C4? | C27H35N6O8P | formula |
| 51 | ★ | What is the molecular formula of the compound with SMILES C[C@@H]1[C@H]([C@H](C[C@@H](O1)O[C@@H]2[C@H](O[C@H](C[C@@H]2O)O[C@@H]3[C@H](O[C@H](C[C@@H]3O)O[C@H]4CC[C@]5([C@@H](C4)CC[C@@H]6[C@@H]5C[C@H]([C@]7([C@@]6(CC[C@@H]7C8=CC(=O)OC8)O)C)O)C)C)C)O)O? | C41H64O14 | formula |
| 52 |  | What is the molecular formula of the compound with SMILES CC(C)(C)NC(=O)[C@@H]1C[C@@H]2CCCC[C@@H]2CN1C[C@H]([C@H](CC3=CC=CC=C3)NC(=O)[C@H](CC(=O)N)NC(=O)C4=NC5=CC=CC=C5C=C4)O? | C38H50N6O5 | formula |
| 53 |  | What is the molecular formula of the compound with SMILES CS(=O)(=O)CCNCC1=CC=C(O1)C2=CC3=C(C=C2)N=CN=C3NC4=CC(=C(C=C4)OCC5=CC(=CC=C5)F)Cl? | C29H26ClFN4O4S | formula |

## reaction

| # | | Question | Answer key | Graded as |
|---|---|---|---|---|
| 54 | ★ | (R)-2-Bromobutane is heated with sodium azide in DMF. What is the product, with its stereochemistry? | `CC[C@H](C)N=[N+]=[N-]` | stereoisomer |
| 55 | ★ | The alcohol C[C@@H](O)CC is treated with 4-nitrobenzoic acid, triphenylphosphine and DIAD in THF. What is the ester formed, with its stereochemistry? | `CC[C@H](C)OC(=O)c1ccc([N+](=O)[O-])cc1` | stereoisomer |
| 56 | ★ | (E)-But-2-ene is treated with bromine in dichloromethane. What is the product, with its stereochemistry? | `C[C@@H](Br)[C@H](C)Br` | stereoisomer |
| 57 |  | (Z)-But-2-ene is treated with a catalytic amount of OsO4 and N-methylmorpholine N-oxide in aqueous acetone. What is the product, with its stereochemistry? | `C[C@@H](O)[C@H](C)O` | stereoisomer |
| 58 | ★ | 2-Methylcyclohexan-1-one is treated with mCPBA in dichloromethane. What is the major product? | `CC1CCCCC(=O)O1` | connectivity |
| 59 | ★ | 2-Bromo-2-methylbutane is heated with potassium tert-butoxide in tert-butanol. What is the major alkene? | `C=C(C)CC` | connectivity |
| 60 |  | 2-Chlorocyclohexan-1-one is treated with sodium methoxide in methanol. What is the product? | `COC(=O)C1CCCC1` | connectivity |
| 61 |  | Anisole is treated with sodium in liquid ammonia with ethanol. What is the product? | `COC1=CCC=CC1` | connectivity |
| 62 |  | CC1C(=O)CCCC1=O is treated with but-3-en-2-one and a base, and the Michael adduct is then heated with acid. What is the product? | `CC12CCC(=O)C=C1CCCC2=O` | connectivity |
| 63 | ★ | Allyl phenyl ether is heated to 200 °C. What is the product? | `C=CCc1ccccc1O` | connectivity |
| 64 |  | 2,3-Dimethylbutane-2,3-diol is heated with sulfuric acid. What is the product? | `CC(=O)C(C)(C)C` | connectivity |
| 65 |  | Isoprene (2-methylbuta-1,3-diene) and methyl acrylate are heated together. What is the major Diels–Alder adduct? | `COC(=O)C1CCC(C)=CC1` | connectivity |
