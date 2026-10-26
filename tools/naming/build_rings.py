"""Generate packages/naming/src/rings.ts: ring parents with their IUPAC numbering.

Each parent name is parsed by OPSIN, which reports every ring atom's locant,
so the numbering is OPSIN's (FR-5 fusion numbering included) rather than
written by hand. The namer uses these parents for any saturation state, with
hydro prefixes and indicated hydrogen.

Two sources: NAMED, written below in order of preference; and two-ring fusion
names built from components (pyrazolo[1,5-a]pyrimidine), for which the
preferred name of each ring system is chosen by the base-component and
lowest-descriptor rules. Run from the repo root (needs Java and RDKit):

    python3 tools/naming/build_rings.py
"""
import itertools
import re
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

from rdkit import Chem, RDLogger

RDLogger.DisableLog('rdApp.*')
ROOT = Path(__file__).resolve().parents[2]
OPSIN = ROOT / 'tools' / 'opsin' / 'opsin.jar'
OUT = ROOT / 'packages' / 'naming' / 'src' / 'rings.ts'

# Parents by name, preferred first. Names are as ChemDraw and chemists write
# them where IUPAC allows a choice; indicated hydrogen is left off (the namer
# adds it for each structure).
NAMED = """
pyridine pyrimidine pyrazine pyridazine 1,2,3-triazine 1,2,4-triazine 1,3,5-triazine 1,2,4,5-tetrazine
furan thiophene pyrrole imidazole pyrazole oxazole isoxazole thiazole isothiazole
1,2,3-triazole 1,2,4-triazole tetrazole 1,2,3-oxadiazole 1,2,4-oxadiazole 1,2,5-oxadiazole 1,3,4-oxadiazole
1,2,3-thiadiazole 1,2,4-thiadiazole 1,2,5-thiadiazole 1,3,4-thiadiazole 1,2,3,4-thiatriazole 1,2,3,4-oxatriazole
1,3-dioxole 1,2-dioxole 1,3-oxathiole 1,3-dithiole 1,2-dithiole 1,2-oxathiole
pyran thiopyran 1,4-dioxine 1,3-dioxine 1,4-oxathiine 1,4-dithiine 1,3-oxazine 1,4-oxazine 1,2-oxazine 1,3-thiazine 1,4-thiazine 1,2-thiazine
1,3,5-oxadiazine 1,3,4-oxadiazine 1,3,4-thiadiazine 1,3,5-thiadiazine 1,2,4-oxadiazine 1,2,4-thiadiazine 1,2,3-oxathiazine 1,4,2-dioxazine 1,3,5-dioxazine 1,3,5-dithiazine 1,2,4,5-tetrazine
azepine 1,2-diazepine 1,3-diazepine 1,4-diazepine oxepine thiepine 1,4-oxazepine 1,3-oxazepine 1,4-thiazepine 1,3-thiazepine 1,2,4-triazepine 1,3,5-triazepine
azocine 1,5-diazocine oxocine azonine azete 1,2-diazete oxete thiete azirine oxirene diazirine
naphthalene azulene indene anthracene phenanthrene fluorene pyrene acenaphthylene biphenylene phenalene chrysene tetracene triphenylene
cyclopenta[a]phenanthrene benzo[a]anthracene benzo[c]phenanthrene fluoranthene pentalene heptalene as-indacene s-indacene
indole isoindole indolizine indazole benzimidazole benzoxazole benzothiazole 1,2-benzoxazole 2,1-benzoxazole 1,2-benzothiazole 2,1-benzothiazole
benzofuran isobenzofuran benzo[b]thiophene benzo[c]thiophene benzotriazole 2,1,3-benzoxadiazole 2,1,3-benzothiadiazole 1,2,3-benzothiadiazole 1,2,3-benzotriazine 1,2,4-benzotriazine
quinoline isoquinoline quinolizine quinazoline quinoxaline cinnoline phthalazine
1,5-naphthyridine 1,6-naphthyridine 1,7-naphthyridine 1,8-naphthyridine 2,6-naphthyridine 2,7-naphthyridine
pteridine purine chromene isochromene thiochromene isothiochromene xanthene thioxanthene acridine phenazine phenothiazine phenoxazine phenoxathiine phenanthridine phenanthroline
1,10-phenanthroline 4,7-phenanthroline 1,7-phenanthroline perimidine carbazole beta-carboline dibenzofuran dibenzothiophene dibenzo[b,e][1,4]dioxine thianthrene
benzo[d][1,3]dioxole 1,4-benzodioxine 1,3-benzodioxine 1,3-benzodioxole 1,4-benzoxazine 3,1-benzoxazine 2,1-benzoxazine 1,3-benzoxazine 1,4-benzothiazine 1,3-benzothiazine 1,2-benzothiazine 3,1-benzothiazine
1-benzazepine 2-benzazepine 3-benzazepine 1,4-benzodiazepine 1,5-benzodiazepine 2,3-benzodiazepine 1,3-benzodiazepine 1,5-benzoxazepine 1,4-benzoxazepine 1,5-benzothiazepine 1,4-benzothiazepine 4,1-benzoxazepine 3,1-benzoxazepine
1-benzoxepine 3-benzoxepine 1-benzothiepine dibenzo[b,f]azepine dibenzo[b,e]azepine dibenzo[b,f]oxepine dibenzo[b,e]oxepine dibenzo[b,f][1,4]oxazepine dibenzo[b,e][1,4]diazepine dibenzo[b,f][1,4]thiazepine dibenzo[a,d]cycloheptene
benzo[b][1,4]dioxepine benzo[b][1,4]oxazepine benzo[f][1,4]oxazepine benzo[e][1,4]diazepine benzo[b][1,4]diazepine benzo[cd]indole benzo[de]isoquinoline benzo[g]quinoline benzo[h]quinoline benzo[f]quinoline benzo[g]indole benzo[e]indole benzo[f]indole benzo[g]chromene benzo[h]chromene benzo[f]chromene
naphtho[2,1-b]furan naphtho[1,2-b]furan naphtho[2,3-b]furan naphtho[2,1-b]thiophene naphtho[1,2-d]thiazole naphtho[2,1-d]thiazole naphtho[1,2-d]oxazole naphtho[1,2-d]imidazole naphtho[2,3-d]imidazole
cyclopenta[b]pyridine cyclopenta[c]pyridine cyclopenta[d]pyrimidine cyclopenta[b]thiophene cyclopenta[c]thiophene cyclopenta[b]furan cyclopenta[b]pyrrole cyclopenta[c]pyrrole cyclopenta[c]pyrazole cyclopenta[d]thiazole cyclopenta[d]imidazole cyclopenta[b]indole cyclopenta[b]quinoline cyclopenta[b]pyran cyclopenta[c]pyran cyclopenta[c]chromene
cyclohepta[b]pyridine cyclohepta[b]thiophene cyclohepta[d]pyrimidine cyclohepta[b]indole cyclohepta[b]furan cyclohepta[c]pyrazole cyclohepta[d]thiazole cyclohepta[b]pyrrole cyclohepta[c]pyridine cycloocta[b]pyridine cycloocta[b]thiophene cycloocta[d]pyrimidine
thieno[2,3-d]pyrimidine thieno[3,2-d]pyrimidine thieno[3,4-d]pyrimidine thieno[2,3-b]pyridine thieno[3,2-b]pyridine thieno[2,3-c]pyridine thieno[3,2-c]pyridine thieno[3,4-b]pyridine thieno[2,3-b]thiophene thieno[3,2-b]thiophene thieno[2,3-b]pyrazine thieno[2,3-d]pyridazine thieno[3,2-b]pyrrole thieno[2,3-b]pyrrole thieno[2,3-d]thiazole thieno[3,2-d]thiazole
[1]benzothieno[2,3-d]pyrimidine [1]benzothieno[3,2-d]pyrimidine [1]benzothieno[2,3-b]pyridine [1]benzothieno[3,2-b]pyridine [1]benzothieno[2,3-c]pyridine [1]benzofuro[3,2-d]pyrimidine [1]benzofuro[2,3-d]pyrimidine [1]benzofuro[3,2-b]pyridine
pyrido[2,3-d]pyrimidine pyrido[3,2-d]pyrimidine pyrido[3,4-d]pyrimidine pyrido[4,3-d]pyrimidine pyrido[1,2-a]pyrimidine pyrido[2,3-b]pyrazine pyrido[3,4-b]pyrazine pyrido[1,2-a]pyrazine pyrido[2,3-d]pyridazine pyrido[3,4-d]pyridazine pyrido[1,2-a]benzimidazole pyrido[1,2-a]indole pyrido[3,4-b]indole pyrido[4,3-b]indole pyrido[2,3-b]indole pyrido[3,2-b]indole pyrido[1,2-b]indazole pyrido[2,1-b]quinazoline pyrido[1,2-a]pyrimidine
pyrimido[4,5-d]pyrimidine pyrimido[5,4-d]pyrimidine pyrimido[1,2-a]benzimidazole pyrimido[2,1-b]quinazoline pyrimido[4,5-b]quinoline pyrimido[5,4-b]indole pyrimido[1,6-a]benzimidazole pyrimido[2,1-b][1,3]thiazine pyrimido[2,1-a]isoquinoline
pyrazino[2,3-b]pyrazine pyrazino[1,2-a]indole pyrazino[1,2-a]pyrazine pyrazino[2,1-b]quinazoline pyrazino[2,3-b]quinoxaline pyrazino[1,2-a]benzimidazole
pyrrolo[2,3-b]pyridine pyrrolo[3,2-b]pyridine pyrrolo[2,3-c]pyridine pyrrolo[3,2-c]pyridine pyrrolo[3,4-b]pyridine pyrrolo[3,4-c]pyridine pyrrolo[1,2-a]pyrazine pyrrolo[1,2-a]pyrimidine pyrrolo[1,2-c]pyrimidine pyrrolo[2,3-d]pyrimidine pyrrolo[3,2-d]pyrimidine pyrrolo[3,4-d]pyrimidine pyrrolo[1,2-b]pyridazine pyrrolo[2,1-b]thiazole pyrrolo[2,1-c][1,4]oxazine pyrrolo[2,1-c][1,4]benzodiazepine pyrrolo[1,2-a]indole pyrrolo[3,4-b]indole pyrrolo[2,3-b]indole pyrrolo[3,2-b]indole pyrrolo[1,2-a]quinoxaline pyrrolo[1,2-a]quinoline pyrrolo[3,4-c]pyrrole pyrrolo[3,2-b]pyrrole pyrrolo[1,2-a]imidazole pyrrolo[1,2-c]imidazole pyrrolo[2,1-a]isoquinoline pyrrolo[1,2-a]azepine pyrrolo[2,3-b]pyrazine pyrrolo[1,2-a][1,4]diazepine pyrrolo[3,4-c]pyrazole pyrrolo[3,4-c]quinoline
pyrazolo[1,5-a]pyrimidine pyrazolo[3,4-d]pyrimidine pyrazolo[4,3-d]pyrimidine pyrazolo[1,5-c]pyrimidine pyrazolo[3,4-b]pyridine pyrazolo[4,3-b]pyridine pyrazolo[3,4-c]pyridine pyrazolo[4,3-c]pyridine pyrazolo[1,5-a]pyridine pyrazolo[1,5-a]pyrazine pyrazolo[1,5-b]pyridazine pyrazolo[3,4-b]pyrazine pyrazolo[5,1-b]thiazole pyrazolo[5,1-c][1,2,4]triazine pyrazolo[3,4-d]pyridazine pyrazolo[1,2-a]pyrazole pyrazolo[1,5-a][1,3,5]triazine pyrazolo[3,4-b]quinoline pyrazolo[1,5-a]quinazoline pyrazolo[5,1-b]quinazoline pyrazolo[3,4-c]pyrazole pyrazolo[1,5-d][1,2,4]triazine pyrazolo[4,3-c]quinoline pyrazolo[3,4-d][1,3]thiazole pyrazolo[1,5-a][1,4]diazepine pyrazolo[4,3-e][1,2,4]triazolo[1,5-c]pyrimidine
imidazo[1,2-a]pyridine imidazo[1,5-a]pyridine imidazo[4,5-b]pyridine imidazo[4,5-c]pyridine imidazo[1,2-a]pyrimidine imidazo[1,2-c]pyrimidine imidazo[1,5-a]pyrimidine imidazo[1,2-a]pyrazine imidazo[1,5-a]pyrazine imidazo[1,2-b]pyridazine imidazo[2,1-b]thiazole imidazo[2,1-b][1,3]thiazole imidazo[2,1-b][1,3,4]thiadiazole imidazo[2,1-b]oxazole imidazo[4,5-d]pyridazine imidazo[1,2-a]benzimidazole imidazo[2,1-b]benzothiazole imidazo[1,2-a]quinoline imidazo[1,2-a]quinoxaline imidazo[4,5-f]quinoline imidazo[1,5-a]quinoxaline imidazo[2,1-a]isoquinoline imidazo[1,2-d][1,2,4]triazine imidazo[5,1-f][1,2,4]triazine imidazo[4,5-d]imidazole imidazo[1,2-a][1,3,5]triazine imidazo[4,5-e]benzofuran imidazo[1,2-c]quinazoline imidazo[4,5-b]pyrazine imidazo[1,5-a]imidazole imidazo[1,2-b]pyrazole imidazo[2,1-b][1,3]thiazine imidazo[4,5-g]quinazoline imidazo[2,1-f]purine imidazo[1,2-a]azepine imidazo[2,1-b]quinazoline
[1,2,4]triazolo[1,5-a]pyrimidine [1,2,4]triazolo[4,3-a]pyrimidine [1,2,4]triazolo[1,5-c]pyrimidine [1,2,4]triazolo[4,3-c]pyrimidine [1,2,4]triazolo[4,3-a]pyridine [1,2,4]triazolo[1,5-a]pyridine [1,2,4]triazolo[4,3-a]pyrazine [1,2,4]triazolo[1,5-a]pyrazine [1,2,4]triazolo[4,3-b]pyridazine [1,2,4]triazolo[1,5-b]pyridazine [1,2,4]triazolo[3,4-b][1,3,4]thiadiazole [1,2,4]triazolo[3,4-b][1,3,4]thiadiazine [1,2,4]triazolo[5,1-b][1,3,4]thiadiazole [1,2,4]triazolo[3,4-b]benzothiazole [1,2,4]triazolo[4,3-a]quinoxaline [1,2,4]triazolo[1,5-a]quinazoline [1,2,4]triazolo[4,3-a]quinazoline [1,2,4]triazolo[1,5-c]quinazoline [1,2,4]triazolo[4,3-c]quinazoline [1,2,4]triazolo[3,4-a]phthalazine [1,2,4]triazolo[4,3-a]quinoline [1,2,4]triazolo[5,1-b]thiazole [1,2,4]triazolo[3,4-b]thiazole [1,2,4]triazolo[3,2-b]thiazole [1,2,4]triazolo[1,5-a][1,3,5]triazine [1,2,4]triazolo[4,3-b][1,2,4]triazine [1,2,4]triazolo[4,3-a]benzimidazole [1,2,4]triazolo[1,5-a]benzimidazole [1,2,4]triazolo[3,4-f][1,2,4]triazine [1,2,4]triazolo[4,3-d][1,4]benzodiazepine [1,2,4]triazolo[4,3-a][1,4]benzodiazepine [1,2,4]triazolo[1,5-d][1,2,4]triazine [1,2,4]triazolo[5,1-c][1,2,4]triazine [1,2,4]triazolo[3,4-b][1,3]benzothiazole [1,2,4]triazolo[4,3-a]azepine [1,2,4]triazolo[1,5-a]azepine
[1,2,3]triazolo[4,5-d]pyrimidine [1,2,3]triazolo[1,5-a]pyridine [1,2,3]triazolo[4,5-b]pyridine [1,2,3]triazolo[1,5-a]pyrimidine [1,2,3]triazolo[1,5-a]quinazoline [1,2,3]triazolo[4,5-c]pyridine [1,2,3]triazolo[1,5-a]pyrazine
tetrazolo[1,5-a]pyridine tetrazolo[1,5-a]pyrimidine tetrazolo[1,5-b]pyridazine tetrazolo[1,5-a]quinoline tetrazolo[1,5-a]quinoxaline tetrazolo[1,5-c]quinazoline tetrazolo[5,1-b]benzothiazole
[1,3]thiazolo[3,2-a]pyrimidine [1,3]thiazolo[4,5-d]pyrimidine [1,3]thiazolo[5,4-d]pyrimidine [1,3]thiazolo[4,5-b]pyridine [1,3]thiazolo[5,4-b]pyridine [1,3]thiazolo[4,5-c]pyridine [1,3]thiazolo[5,4-c]pyridine [1,3]thiazolo[3,2-a]pyridine [1,3]thiazolo[3,2-b][1,2,4]triazole [1,3]thiazolo[2,3-c][1,2,4]triazole [1,3]thiazolo[3,2-a]benzimidazole [1,3]thiazolo[2,3-b]quinazoline [1,3]thiazolo[4,5-d]thiazole [1,3]thiazolo[5,4-d][1,3]thiazole [1,3]thiazolo[3,2-b][1,2,4]triazine [1,3]thiazolo[3,4-a]benzimidazole [1,3]thiazolo[4,5-b]quinoxaline [1,3]thiazolo[3,2-a][1,3,5]triazine [1,3]thiazolo[2,3-b][1,3]thiazine [1,3]thiazolo[3,2-c]pyrimidine [1,3]thiazolo[4,5-c]quinoline [1,3]thiazolo[3,2-a]azepine [1,3]thiazolo[5,4-f]quinazoline
[1,3]oxazolo[4,5-b]pyridine [1,3]oxazolo[5,4-b]pyridine [1,3]oxazolo[4,5-c]pyridine [1,3]oxazolo[5,4-d]pyrimidine [1,3]oxazolo[4,5-d]pyrimidine [1,3]oxazolo[3,2-a]pyridine [1,3]oxazolo[3,2-a]pyrimidine [1,3]oxazolo[4,5-c]quinoline [1,2]oxazolo[5,4-b]pyridine [1,2]oxazolo[4,5-b]pyridine [1,2]oxazolo[4,5-c]pyridine [1,2]oxazolo[5,4-d]pyrimidine [1,2]oxazolo[4,5-d]pyridazine [1,2]oxazolo[4,5-d]pyrimidine [1,2]oxazolo[3,4-d]pyridazine [1,2]oxazolo[2,3-a]pyridine [1,2]thiazolo[5,4-b]pyridine [1,2]thiazolo[4,5-d]pyrimidine [1,2]thiazolo[4,5-b]pyridine [1,2]thiazolo[5,4-d]pyrimidine
furo[2,3-b]pyridine furo[3,2-b]pyridine furo[2,3-c]pyridine furo[3,2-c]pyridine furo[3,4-b]pyridine furo[3,4-c]pyridine furo[2,3-d]pyrimidine furo[3,2-d]pyrimidine furo[3,4-d]pyrimidine furo[2,3-b]quinoline furo[3,2-c]chromene furo[3,2-g]chromene furo[2,3-b]pyrazine furo[3,4-c]furan furo[3,2-b]furan furo[2,3-b]furan furo[3,2-b]pyrrole furo[3,4-c]pyrrole furo[3,4-b]pyrazine furo[2,3-c]pyrazole furo[3,4-c]pyrazole furo[3,4-b]indole furo[3,4-c]quinoline furo[3,2-c]pyran furo[3,4-b]pyran furo[3,4-c]pyridazine
[1,3]dioxolo[4,5-g]quinoline [1,3]dioxolo[4,5-g]chromene [1,3]dioxolo[4,5-b]pyridine [1,3]dioxolo[4,5-c]pyridine [1,3]dioxolo[4,5-g]isoquinoline [1,3]dioxolo[4,5-g]quinazoline [1,3]dioxolo[4,5-f]indole [1,3]dioxolo[4,5-f][1,3]benzodioxole [1,4]dioxino[2,3-b]pyridine [1,4]dioxino[2,3-g]quinoline [1,4]dioxino[2,3-f]quinazoline [1,4]dioxino[2,3-c]pyrrole [1,4]dioxino[2,3-b]pyrazine
[1,3,4]thiadiazolo[3,2-a]pyrimidine [1,3,4]thiadiazolo[2,3-b]quinazoline [1,3,4]thiadiazolo[3,2-b][1,2,4]triazine [1,2,4]oxadiazolo[4,3-a]pyridine [1,2,5]oxadiazolo[3,4-b]pyrazine [1,2,5]oxadiazolo[3,4-b]pyridine [1,2,5]thiadiazolo[3,4-b]pyridine [1,2,5]thiadiazolo[3,4-b]pyrazine [1,3,4]oxadiazolo[3,2-a]pyridine
oxazolo[4,5-b]pyridine oxazolo[5,4-b]pyridine thiazolo[3,2-a]pyrimidine thiazolo[4,5-d]pyrimidine thiazolo[5,4-b]pyridine thiazolo[4,5-b]pyridine
pyrano[2,3-c]pyrazole pyrano[3,2-c]chromene pyrano[2,3-d]pyrimidine pyrano[3,2-b]pyridine pyrano[4,3-c]pyrazole pyrano[2,3-b]pyridine pyrano[3,4-c]pyridine pyrano[4,3-b]pyridine pyrano[3,2-c]pyridine pyrano[2,3-b]quinoline pyrano[3,2-c]quinoline pyrano[3,4-b]indole pyrano[4,3-b]indole pyrano[2,3-c]pyridine pyrano[3,4-b]pyrrole pyrano[3,2-b]pyrrole pyrano[4,3-c]pyridine pyrano[3,4-d]imidazole pyrano[4,3-d]pyrimidine pyrano[4,3-d]thiazole pyrano[3,2-g]chromene pyrano[3,4-c]pyrrole pyrano[2,3-c]pyrrole pyrano[4,3-b]pyran pyrano[3,2-b]pyran
thiopyrano[2,3-b]pyridine thiopyrano[4,3-d]pyrimidine thiopyrano[4,3-c]pyrazole thiopyrano[3,4-b]indole thiopyrano[3,2-c]pyrazole thiopyrano[4,3-b]pyridine thiopyrano[2,3-d]thiazole thiopyrano[2,3-d]pyrimidine thiopyrano[4,3-b]indole
azepino[4,5-b]indole azepino[3,4-b]indole azepino[1,2-a]benzimidazole azeto[1,2-a]benzimidazole
oxazino[2,3-a]isoquinoline [1,3]oxazino[3,2-a]benzimidazole [1,4]oxazino[4,3-a]benzimidazole [1,4]oxazino[3,4-c][1,4]benzoxazine pyrido[2,1-c][1,4]oxazine pyrazino[2,1-c][1,4]oxazine pyrido[1,2-c]pyrimidine
[1,2,4]triazino[5,6-b]indole [1,2,4]triazino[4,3-a]benzimidazole [1,2,4]triazino[2,3-a]benzimidazole [1,3,5]triazino[1,2-a]benzimidazole [1,2,4]triazolo[3,4-b][1,3,4]thiadiazepine
isoindolo[1,2-b]quinazoline isoindolo[2,1-a]quinazoline indolo[2,3-b]quinoxaline indolo[2,1-b]quinazoline indolo[1,2-c]quinazoline indolo[3,2-b]quinoline indolo[2,3-a]carbazole indolo[3,2-c]quinoline indeno[1,2-b]pyridine indeno[1,2-c]pyrazole indeno[2,1-b]pyridine indeno[1,2-d]pyrimidine indeno[1,2-d]thiazole indeno[1,2-b]quinoxaline indeno[1,2-b]indole indeno[1,2-b]pyrazine indeno[1,2-c]pyridine indeno[1,2-b]quinoline indeno[2,1-c]pyridine
chromeno[2,3-b]pyridine chromeno[4,3-b]pyridine chromeno[3,4-c]pyridine chromeno[4,3-c]pyrazole chromeno[3,4-d]thiazole chromeno[2,3-d]pyrimidine chromeno[4,3-d]pyrimidine chromeno[3,4-b]pyridine chromeno[4,3-b]quinoline chromeno[2,3-c]pyrrole chromeno[3,4-c]pyrrole chromeno[4,3-c]pyridine chromeno[4,3-d]thiazole chromeno[3,4-d]imidazole
quino[2,3-b]quinoxaline thiazolo[3,2-a]benzimidazole benzimidazo[1,2-a]quinoline benzimidazo[2,1-b]quinazoline benzimidazo[1,2-c]quinazoline benzimidazo[2,1-b][1,3]thiazole benzimidazo[1,2-a]pyrimidine benzofuro[3,2-c]pyridine benzofuro[2,3-b]pyridine benzothieno[3,2-b]indole benzothiazolo[2,3-b]quinazoline benzothiazolo[3,2-a]pyrimidine benzoxazolo[3,2-a]pyridine
thiazino[3,2-a]benzimidazole [1,3]thiazino[3,2-a]benzimidazole [1,3]thiazino[2,3-b]quinazoline [1,4]thiazino[3,4-c][1,4]oxazine
quinolino[2,3-b]quinoline naphtho[2,3-d]oxazole naphtho[1,8-bc]pyran naphtho[2,3-b]thiophene naphtho[1,2-b]pyran naphtho[2,1-b]pyran naphtho[2,3-c]furan naphtho[1,2-e][1,3]oxazine naphtho[2,1-e][1,3]oxazine
benzo[a]pyrene benzo[e]pyrene perylene dibenzo[a,h]anthracene dibenzo[a,j]anthracene dibenzo[a,c]anthracene benzo[b]fluoranthene benzo[k]fluoranthene benzo[j]fluoranthene benzo[ghi]perylene indeno[1,2,3-cd]pyrene coronene picene pentacene pentaphene
benzo[a]fluorene benzo[b]fluorene benzo[c]fluorene cyclopenta[cd]pyrene acephenanthrylene aceanthrylene benzo[c]chrysene benzo[g]chrysene dibenzo[a,l]pyrene dibenzo[a,e]pyrene dibenzo[a,i]pyrene dibenzo[a,h]pyrene naphtho[1,2-b]fluoranthene
benzo[a]acridine benzo[c]acridine dibenzo[a,h]acridine dibenzo[a,j]acridine dibenzo[c,g]carbazole benzo[a]carbazole benzo[b]carbazole benzo[c]carbazole benzo[a]phenazine dibenzo[a,c]phenazine indeno[1,2,1-jk]fluorene
benzo[c]cinnoline benzo[f]quinoxaline benzo[g]quinoxaline benzo[h]isoquinoline benzo[f]isoquinoline benzo[c]phenanthridine benzo[b]naphtho[2,1-d]thiophene benzo[b]naphtho[2,3-d]furan benzo[b]naphtho[1,2-d]furan
dibenzo[b,d]pyran dibenzo[c,h]chromene benzo[c]chromene 6H-benzo[c]chromene indeno[1,2-b]furan indeno[2,1-b]indole cyclopenta[def]phenanthrene cyclopenta[def]chrysene
spiro[4.5]decane
""".split()
NAMED = [n for n in NAMED if not n.startswith('spiro')]

# Two-ring fusion names from components, to catch systems NAMED misses.
ATTACHED = {  # prefix form: monocycle name, ring size
    'pyrido': ('pyridine', 6), 'pyrimido': ('pyrimidine', 6), 'pyrazino': ('pyrazine', 6), 'pyridazino': ('pyridazine', 6),
    'thieno': ('thiophene', 5), 'furo': ('furan', 5), 'pyrrolo': ('pyrrole', 5), 'imidazo': ('imidazole', 5), 'pyrazolo': ('pyrazole', 5),
    '[1,3]thiazolo': ('thiazole', 5), '[1,3]oxazolo': ('oxazole', 5), '[1,2]oxazolo': ('isoxazole', 5), '[1,2]thiazolo': ('isothiazole', 5),
    '[1,2,4]triazolo': ('1,2,4-triazole', 5), '[1,2,3]triazolo': ('1,2,3-triazole', 5), 'tetrazolo': ('tetrazole', 5),
    '[1,3,4]thiadiazolo': ('1,3,4-thiadiazole', 5), '[1,3,4]oxadiazolo': ('1,3,4-oxadiazole', 5), '[1,2,4]oxadiazolo': ('1,2,4-oxadiazole', 5),
    '[1,2,4]triazino': ('1,2,4-triazine', 6), '[1,3,5]triazino': ('1,3,5-triazine', 6), 'pyrano': ('pyran', 6), 'thiopyrano': ('thiopyran', 6),
    '[1,4]oxazino': ('1,4-oxazine', 6), '[1,3]oxazino': ('1,3-oxazine', 6), '[1,4]thiazino': ('1,4-thiazine', 6), '[1,3]thiazino': ('1,3-thiazine', 6),
    'azepino': ('azepine', 7), '[1,4]diazepino': ('1,4-diazepine', 7), '[1,3]dioxolo': ('1,3-dioxole', 5), '[1,4]dioxino': ('1,4-dioxine', 6),
}
BASES = ['pyridine', 'pyrimidine', 'pyrazine', 'pyridazine', '[1,2,4]triazine', '[1,3,5]triazine', 'thiophene', 'furan', 'pyrrole', 'imidazole',
         'pyrazole', '[1,3]thiazole', '[1,3]oxazole', '[1,2]oxazole', '[1,2]thiazole', '[1,3,4]thiadiazole', '[1,2,4]triazole', '[1,2,3]triazole',
         '[1,3,4]oxadiazole', '[1,2,4]thiadiazole', 'azepine', '[1,4]diazepine', '[1,3]diazepine', '[1,4]oxazine', '[1,3]oxazine', '[1,4]thiazine',
         '[1,3]thiazine', 'pyran', 'thiopyran', '[1,4]oxazepine', '[1,4]thiazepine', '[1,3,4]thiadiazine', 'tetrazole', '[1,2,4]triazepine']
BASE_SIZE = {b: 7 if 'epine' in b else 5 if b.endswith(('ole', 'thiophene', 'furan', 'pyrrole')) else 6 for b in BASES}


def composition(name: str) -> tuple[int, int, int, int]:
    """(N, O, S, ring size) of a monocyclic component."""
    clean = re.sub(r'^\[[\d,]+\]', '', name)
    mono = {'pyridine': (1, 0, 0), 'pyrimidine': (2, 0, 0), 'pyrazine': (2, 0, 0), 'pyridazine': (2, 0, 0), 'triazine': (3, 0, 0),
            'thiophene': (0, 0, 1), 'furan': (0, 1, 0), 'pyrrole': (1, 0, 0), 'imidazole': (2, 0, 0), 'pyrazole': (2, 0, 0),
            'thiazole': (1, 0, 1), 'oxazole': (1, 1, 0), 'isoxazole': (1, 1, 0), 'isothiazole': (1, 0, 1), 'thiadiazole': (2, 0, 1),
            'oxadiazole': (2, 1, 0), 'triazole': (3, 0, 0), 'tetrazole': (4, 0, 0), 'azepine': (1, 0, 0), 'diazepine': (2, 0, 0),
            'oxazine': (1, 1, 0), 'thiazine': (1, 0, 1), 'pyran': (0, 1, 0), 'thiopyran': (0, 0, 1), 'oxazepine': (1, 1, 0),
            'thiazepine': (1, 0, 1), 'thiadiazine': (2, 0, 1), 'triazepine': (3, 0, 0), 'dioxole': (0, 2, 0), 'dioxine': (0, 2, 0)}
    word = re.sub(r'^[\d,-]+', '', clean)
    n, o, s_ = mono[word]
    size = 7 if 'epine' in word else 5 if word.endswith(('ole', 'thiophene', 'furan')) else 6
    return n, o, s_, size


def seniority(c: tuple[int, int, int, int]) -> tuple:
    """Base-component seniority (FR-3.1), larger is more senior."""
    n, o, s_, size = c
    return (n > 0, o > 0 if not n else 0, size, n + o + s_, (n > 0) + (o > 0) + (s_ > 0), o, s_, n)


def opsin_cml(names: list[str]) -> dict[str, ET.Element]:
    """OPSIN's CML for each name it can parse, keyed by the name (failures are left out)."""
    out = subprocess.run(['java', '-jar', str(OPSIN), '-ocml'], input='\n'.join(names) + '\n',
                         capture_output=True, text=True, check=True).stdout
    ns = {'c': 'http://www.xml-cml.org/schema'}
    docs = {}
    for d in re.findall(r'<cml.*?</cml>', out, flags=re.S):
        for mol in ET.fromstring(d).findall('c:molecule', ns):
            nm = mol.find('c:name', ns)
            if nm is not None and nm.text:
                docs[nm.text] = mol
    return docs


def parse_one(cml) -> dict | None:
    """Ring atoms in locant order with their ring bonds, or None if not one ring system."""
    ns = {'c': 'http://www.xml-cml.org/schema'}
    mol = cml
    if mol is None or mol.find('c:atomArray', ns) is None or mol.find('c:bondArray', ns) is None:
        return None
    atoms = {}
    for a in mol.find('c:atomArray', ns):
        if a.get('elementType') == 'H':
            continue
        locs = [l.get('value') for l in a.findall('c:label', ns) if l.get('dictRef') == 'cmlDict:locant']
        num = [l for l in locs if re.fullmatch(r"\d+[a-z]?", l)]
        atoms[a.get('id')] = (a.get('elementType'), num[0] if num else None)
    bonds = []
    for b in mol.find('c:bondArray', ns):
        x, y = b.get('atomRefs2').split()
        if x in atoms and y in atoms:
            bonds.append((x, y))
    if any(loc is None for _, loc in atoms.values()):
        return None
    rd = Chem.RWMol()
    idx = {}
    for aid, (e, _) in atoms.items():
        idx[aid] = rd.AddAtom(Chem.Atom(e))
    for x, y in bonds:
        rd.AddBond(idx[x], idx[y], Chem.BondType.SINGLE)
    m = rd.GetMol()
    m.UpdatePropertyCache(strict=False)
    Chem.FastFindRings(m)
    ri = m.GetRingInfo()
    if any(ri.NumAtomRings(i) == 0 for i in range(m.GetNumAtoms())) or len(Chem.GetMolFrags(m)) != 1:
        return None
    order = sorted(atoms, key=lambda a: locant_key(atoms[a][1]))
    pos = {a: i for i, a in enumerate(order)}
    return {
        'elements': [atoms[a][0] for a in order],
        'locants': [atoms[a][1] for a in order],
        'bonds': sorted(tuple(sorted((pos[x], pos[y]))) for x, y in bonds),
        'key': Chem.MolToSmiles(m),
    }


def locant_key(l: str):
    m = re.fullmatch(r'(\d+)([a-z]?)', l)
    return (int(m.group(1)), m.group(2))


def stem(name: str) -> str:
    return name[:-1] if name.endswith('e') else name


def fusion_names() -> list[tuple[str, tuple]]:
    """Two-ring fusion names, each with a preference key (lower is better)."""
    out = []
    letters = 'abcdefg'
    for pre, (mono, size) in ATTACHED.items():
        pairs = [(i, i % size + 1) for i in range(1, size + 1)]
        for base in BASES:
            bsize = BASE_SIZE[base]
            if seniority(composition(base)) < seniority(composition(mono)):
                continue  # the base component must be the senior one
            for (p, q) in pairs:
                for x, y in ((p, q), (q, p)):
                    for li in range(bsize):
                        out.append((f'{pre}[{x},{y}-{letters[li]}]{base}', (li, min(x, y), x > y)))
    return out


def main():
    named = [(n, (i,)) for i, n in enumerate(NAMED)]
    print(f'{len(named)} named, generating fusion names', file=sys.stderr)
    fused = fusion_names()
    print(f'{len(fused)} fusion names to try', file=sys.stderr)
    seen: dict[str, dict] = {}
    for batch, preferred in ((named, True), (fused, False)):
        names = [n for n, _ in batch]
        docs: dict[str, ET.Element] = {}
        for i in range(0, len(names), 2000):
            docs.update(opsin_cml(names[i:i + 2000]))
        cands = []
        for n, rank in batch:
            d = docs.get(n)
            if d is None:
                continue
            r = parse_one(d)
            if r is None:
                continue
            r['name'] = n
            cands.append((rank, r))
        cands.sort(key=lambda c: c[0])
        for _, r in cands:
            if r['key'] not in seen:
                seen[r['key']] = r
    rows = list(seen.values())
    print(f'{len(rows)} distinct ring systems', file=sys.stderr)
    lines = [
        '// Generated by tools/naming/build_rings.py from OPSIN: do not edit by hand.',
        '// Ring parents with their IUPAC locants, atoms in locant order, ring bonds as index pairs.',
        "import type { RingTemplate } from './templates.ts';",
        '',
        'type Row = [name: string, elements: string, locants: string, bonds: string];',
        'const ROWS: Row[] = [',
    ]
    for r in rows:
        bonds = ' '.join(f'{a}-{b}' for a, b in r['bonds'])
        lines.append(f"  [{r['name']!r}, {' '.join(r['elements'])!r}, {' '.join(r['locants'])!r}, {bonds!r}],")
    lines += [
        '];',
        '',
        '/** Mancude parents for hydro-prefix naming, in order of preference. */',
        'export const RING_PARENTS: RingTemplate[] = ROWS.map(([name, elements, locants, bonds]) => ({',
        "  name, yl: name.replace(/e$/, ''), smiles: '', aromatic: true, mancude: true,",
        "  skeleton: { elements: elements.split(' '), bonds: bonds.split(' ').map((b) => b.split('-').map(Number) as [number, number]) },",
        "  locants: locants.split(' '),",
        '}));',
        '',
    ]
    OUT.write_text('\n'.join(lines), encoding='utf-8')
    print(f'wrote {OUT}', file=sys.stderr)


if __name__ == '__main__':
    main()
