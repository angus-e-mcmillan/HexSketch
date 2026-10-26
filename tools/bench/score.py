"""Score the benchmark: HexSketch names round-tripped through OPSIN, and
HexSketch 2D layouts against RDKit's, on the same structures.

Reads tools/bench/structures.tsv and tools/bench/out (from hexsketch.ts),
writes tools/bench/results.json, tools/bench/failures.tsv and the report
(docs/benchmark.md, apps/web/public/benchmark.html). Run through run.sh.
"""
import csv
import html
import json
import math
import random
import statistics
import subprocess
import sys
from pathlib import Path

import rdkit
from rdkit import Chem, RDLogger
from rdkit.Chem import rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D

RDLogger.DisableLog('rdApp.*')
ROOT = Path(__file__).resolve().parents[2]
BENCH = ROOT / 'tools' / 'bench'
OUT = BENCH / 'out'
OPSIN = ROOT / 'tools' / 'opsin' / 'opsin.jar'

SETS = {
    'solubility': 'Small organics (Huuskonen solubility set)',
    'zinc-leads': 'Lead-like molecules (ZINC)',
}

structures = list(csv.DictReader(open(BENCH / 'structures.tsv', encoding='utf-8'), delimiter='\t'))
hexsketch = {int(r['n']): r for r in csv.DictReader(open(OUT / 'hexsketch.tsv', encoding='utf-8'), delimiter='\t', quoting=csv.QUOTE_NONE)}

# ------------------------------------------------------------------ naming

named = [n for n, r in hexsketch.items() if r['name']]
opsin_out = subprocess.run(
    ['java', '-jar', str(OPSIN), '-osmi'],
    input='\n'.join(hexsketch[n]['name'] for n in named) + '\n',
    capture_output=True, text=True, check=True,
).stdout.split('\n')
back = dict(zip(named, (line.strip() for line in opsin_out)))


def inchi(smiles: str) -> str | None:
    mol = Chem.MolFromSmiles(smiles) if smiles else None
    return Chem.MolToInchi(mol) if mol else None


def skeleton(i: str) -> str:
    """The InChI without its stereo layers: same compound, any stereoisomer."""
    return '/'.join(p for p in i.split('/') if not p.startswith(('b', 't', 'm', 's')))


def naming_outcome(n: int, smiles: str) -> str:
    r = hexsketch[n]
    if not r['name']:
        # A thrown exception (a bug), as opposed to a structure HexSketch knowingly doesn't name.
        return 'error' if r['reason'].startswith('error:') or 'Cannot read properties' in r['reason'] or 'is not a function' in r['reason'] else 'declined'
    if not back.get(n):
        return 'unparsed'
    want, got = inchi(smiles), inchi(back[n])
    if got is None:
        return 'unparsed'
    if want == got:
        return 'correct'
    if skeleton(want) != skeleton(got):
        return 'wrong'
    # Same compound: either the name fixes stereo the input left open (a double
    # bond drawn one way round), or it gives the wrong stereoisomer.
    open_stereo = any(x.specified == Chem.StereoSpecified.Unspecified for x in Chem.FindPotentialStereo(Chem.MolFromSmiles(smiles)))
    return 'stereo-added' if open_stereo else 'stereo'


# ------------------------------------------------------------------ depiction

def heavy_coords(mol):
    conf = mol.GetConformer()
    keep = [a.GetIdx() for a in mol.GetAtoms() if a.GetAtomicNum() != 1]
    pos = {i: (conf.GetAtomPosition(i).x, conf.GetAtomPosition(i).y) for i in keep}
    bonds = [(b.GetBeginAtomIdx(), b.GetEndAtomIdx()) for b in mol.GetBonds()
             if b.GetBeginAtomIdx() in pos and b.GetEndAtomIdx() in pos]
    return pos, bonds


def crosses(p1, p2, p3, p4) -> bool:
    def orient(a, b, c):
        return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    d1, d2 = orient(p3, p4, p1), orient(p3, p4, p2)
    d3, d4 = orient(p1, p2, p3), orient(p1, p2, p4)
    return d1 * d2 < 0 and d3 * d4 < 0


def segment_distance(p, a, b) -> float:
    dx, dy = b[0] - a[0], b[1] - a[1]
    t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / ((dx * dx + dy * dy) or 1.0)))
    return math.dist(p, (a[0] + t * dx, a[1] + t * dy))


def layout_metrics(mol) -> dict:
    """Bond-length spread, atoms drawn on top of each other, and crossing bonds."""
    pos, bonds = heavy_coords(mol)
    if not bonds:
        return {'spread': 0.0, 'clashes': 0, 'crossings': 0}
    lengths = [math.dist(pos[a], pos[b]) for a, b in bonds]
    L = statistics.median(lengths) or 1.0
    spread = statistics.pstdev(lengths) / statistics.mean(lengths)
    bonded = {frozenset(b) for b in bonds}
    ids = list(pos)
    clashes = sum(1 for i, a in enumerate(ids) for b in ids[i + 1:]
                  if frozenset((a, b)) not in bonded and math.dist(pos[a], pos[b]) < 0.4 * L)
    # An atom drawn on a bond it isn't part of (a substituent drawn through a ring).
    clashes += sum(1 for a in ids for b, c in bonds
                   if a not in (b, c) and segment_distance(pos[a], pos[b], pos[c]) < 0.25 * L)
    crossings = sum(1 for i, (a, b) in enumerate(bonds) for c, d in bonds[i + 1:]
                    if len({a, b, c, d}) == 4 and crosses(pos[a], pos[b], pos[c], pos[d]))
    return {'spread': spread, 'clashes': clashes, 'crossings': crossings}


def rdkit_layout(smiles: str, coordgen: bool):
    mol = Chem.MolFromSmiles(smiles)
    rdDepictor.SetPreferCoordGen(coordgen)
    rdDepictor.Compute2DCoords(mol)
    return mol


def hexsketch_layout(n: int):
    path = OUT / 'mol' / f'{n}.mol'
    return Chem.MolFromMolFile(str(path), sanitize=False, removeHs=False) if path.exists() else None


LAYOUTS = {'HexSketch': None, 'RDKit': False, 'RDKit CoordGen': True}

# ------------------------------------------------------------------ run

rows = []
for n, s in enumerate(structures, start=1):
    row = {'n': n, 'set': s['set'], 'id': s['id'], 'label': s['label'], 'smiles': s['smiles'],
           'name': hexsketch[n]['name'], 'reason': hexsketch[n]['reason'], 'ms': hexsketch[n]['ms'],
           'opsin': back.get(n, ''), 'naming': naming_outcome(n, s['smiles']), 'layout': {}}
    for label, coordgen in LAYOUTS.items():
        mol = hexsketch_layout(n) if coordgen is None else rdkit_layout(s['smiles'], coordgen)
        row['layout'][label] = layout_metrics(mol) if mol is not None and mol.GetNumConformers() else None
    rows.append(row)

OUTCOMES = ['correct', 'stereo-added', 'stereo', 'wrong', 'unparsed', 'declined', 'error']


def naming_summary(sub):
    counts = {k: sum(1 for r in sub if r['naming'] == k) for k in OUTCOMES}
    named_n = counts['correct'] + counts['stereo-added'] + counts['stereo'] + counts['wrong'] + counts['unparsed']
    ms = [float(r['ms']) for r in sub if r['ms']]
    return {'total': len(sub), **counts, 'named': named_n,
            'coverage': named_n / len(sub), 'accuracy_of_named': counts['correct'] / named_n if named_n else 0,
            'median_ms': statistics.median(ms) if ms else None}


def layout_summary(sub, label):
    m = [r['layout'][label] for r in sub if r['layout'][label] is not None]
    return {'drawn': len(m),
            'clean': sum(1 for x in m if not x['clashes'] and not x['crossings']) / len(m),
            'with_clash': sum(1 for x in m if x['clashes']) / len(m),
            'with_crossing': sum(1 for x in m if x['crossings']) / len(m),
            'mean_spread': statistics.mean(x['spread'] for x in m)}


summary = {
    'rdkit': rdkit.__version__,
    'opsin': '2.9.0',
    'sets': {k: {'title': t, 'naming': naming_summary([r for r in rows if r['set'] == k]),
                 'layout': {lab: layout_summary([r for r in rows if r['set'] == k], lab) for lab in LAYOUTS}}
             for k, t in SETS.items()},
}
summary['all'] = {'naming': naming_summary(rows), 'layout': {lab: layout_summary(rows, lab) for lab in LAYOUTS}}
(BENCH / 'results.json').write_text(json.dumps(summary, indent=2) + '\n', encoding='utf-8')

with open(BENCH / 'failures.tsv', 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f, delimiter='\t', lineterminator='\n')
    w.writerow(['set', 'id', 'outcome', 'smiles', 'hexsketch_name', 'opsin_smiles_or_reason'])
    for r in rows:
        if r['naming'] in ('stereo-added', 'stereo', 'wrong', 'unparsed', 'error'):
            w.writerow([r['set'], r['id'], r['naming'], r['smiles'], r['name'], r['opsin'] or r['reason']])

with open(BENCH / 'layout-failures.tsv', 'w', encoding='utf-8', newline='') as f:
    w = csv.writer(f, delimiter='\t', lineterminator='\n')
    w.writerow(['set', 'id', 'smiles', 'overlaps', 'crossings'])
    for r in rows:
        m = r['layout']['HexSketch']
        if m is None or m['clashes'] or m['crossings']:
            w.writerow([r['set'], r['id'], r['smiles'], m['clashes'] if m else 'not drawn', m['crossings'] if m else ''])

declined = {}
for r in rows:
    if r['naming'] == 'declined':
        declined[r['reason']] = declined.get(r['reason'], 0) + 1

# ------------------------------------------------------------------ report

pct = lambda x: f'{100 * x:.1f}%'
A = summary['all']


def naming_table_md():
    lines = ['| Set | Structures | Named | Correct (of named) | E/Z added | Wrong stereo | Wrong structure | Name OPSIN can\'t read | Declined | Error |',
             '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|']
    for k, t in SETS.items():
        s = summary['sets'][k]['naming']
        lines.append(f"| {t} | {s['total']} | {s['named']} ({pct(s['coverage'])}) | {s['correct']} ({pct(s['accuracy_of_named'])}) | {s['stereo-added']} | {s['stereo']} | {s['wrong']} | {s['unparsed']} | {s['declined']} | {s['error']} |")
    s = A['naming']
    lines.append(f"| **All** | {s['total']} | {s['named']} ({pct(s['coverage'])}) | {s['correct']} ({pct(s['accuracy_of_named'])}) | {s['stereo-added']} | {s['stereo']} | {s['wrong']} | {s['unparsed']} | {s['declined']} | {s['error']} |")
    return '\n'.join(lines)


def layout_table_md():
    lines = ['| Layout | Clean | Atoms overlapping | Crossing bonds | Bond length spread |', '|---|---:|---:|---:|---:|']
    for lab in LAYOUTS:
        s = A['layout'][lab]
        lines.append(f"| {lab} | {pct(s['clean'])} | {pct(s['with_clash'])} | {pct(s['with_crossing'])} | {s['mean_spread']:.3f} |")
    return '\n'.join(lines)


md = f"""# Benchmark

How well HexSketch names and draws structures it has never seen, measured on
{A['naming']['total']:,} public structures. Reproduce it with `tools/bench/run.sh`
(needs Java and RDKit; see `tools/bench/README.md`).

## Naming

Each structure is named by HexSketch offline. The name is parsed back to a
structure by [OPSIN](https://github.com/dan2097/opsin) {summary['opsin']}, an
independent name-to-structure tool, and the two are compared by standard InChI
(RDKit {summary['rdkit']}). A name counts as correct only if it gives back
exactly the structure, stereochemistry included. "E/Z added" means the name
gives a double bond's geometry that the input SMILES left open (HexSketch names
the drawing, where the bond is drawn one way round). When HexSketch can't name
a structure it says so rather than guess ("declined").

{naming_table_md()}

Median time to name a structure: {A['naming']['median_ms']:.1f} ms.

Why structures were declined:

{chr(10).join(f'- {reason}: {count}' for reason, count in sorted(declined.items(), key=lambda kv: -kv[1]))}

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

{layout_table_md()}

HexSketch's drawings with overlaps or crossings are listed in
`tools/bench/layout-failures.tsv`. A side-by-side gallery is at
[hexsketch.com/benchmark](https://hexsketch.com/benchmark).

## The structures

- **{SETS['solubility']}:** {summary['sets']['solubility']['naming']['total']} small organic molecules from Huuskonen,
  J. Chem. Inf. Comput. Sci. 2000, 40, 773, as distributed with RDKit.
- **{SETS['zinc-leads']}:** {summary['sets']['zinc-leads']['naming']['total']} lead-like molecules from the ZINC database, as
  distributed with RDKit (`Regress/Data/zinc.leads.500.q.smi`).

Both come from RDKit release `Release_2025_09_1` (`tools/bench/prep.py`).
"""
(ROOT / 'docs' / 'benchmark.md').write_text(md, encoding='utf-8')

# The page: the same numbers, plus a gallery of HexSketch and RDKit drawings side by side.


def rdkit_svg(smiles: str) -> str:
    mol = rdkit_layout(smiles, False)
    d = rdMolDraw2D.MolDraw2DSVG(300, 220)
    d.drawOptions().clearBackground = False
    d.DrawMolecule(mol)
    d.FinishDrawing()
    svg = d.GetDrawingText()
    return svg[svg.index('<svg'):]


def hexsketch_svg(n: int) -> str:
    return (OUT / 'svg' / f'{n}.svg').read_text(encoding='utf-8')


rng = random.Random(7)
gallery = rng.sample([r for r in rows if r['set'] == 'zinc-leads' and r['layout']['HexSketch']], 12)


def table_html(md_table: str) -> str:
    lines = [l for l in md_table.splitlines() if not set(l) <= set('|-: ')]
    cells = [[c.strip().replace('**', '') for c in l.strip('|').split('|')] for l in lines]
    head = ''.join(f'<th>{html.escape(c)}</th>' for c in cells[0])
    body = ''.join('<tr>' + ''.join(f'<td>{html.escape(c)}</td>' for c in row) + '</tr>' for row in cells[1:])
    return f'<div class="scroll"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


cards = []
for r in gallery:
    nm = html.escape(r['name'] or '(no name)')
    cards.append(f"""<figure class="pair">
  <div class="pics"><div class="pic"><span>HexSketch</span>{hexsketch_svg(r['n'])}</div><div class="pic"><span>RDKit</span>{rdkit_svg(r['smiles'])}</div></div>
  <figcaption><code>{html.escape(r['smiles'])}</code><br>{nm} <em>({html.escape(r['naming'])})</em></figcaption>
</figure>""")

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HexSketch benchmark</title>
<meta name="description" content="How well HexSketch names and draws {A['naming']['total']:,} public structures, checked with OPSIN and compared with RDKit.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>
  :root {{ color-scheme: light dark; --text: #1d1d1f; --muted: #5f6368; --bg: #ffffff; --line: #e3e3e6; --panel: #f5f5f7; }}
  @media (prefers-color-scheme: dark) {{ :root {{ --text: #ececf0; --muted: #a0a3a8; --bg: #17181a; --line: #34363a; --panel: #222326; }} }}
  body {{ margin: 0; background: var(--bg); color: var(--text); font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }}
  main {{ max-width: 960px; margin: 0 auto; padding: 32px 16px 64px; }}
  h1 {{ font-size: 28px; margin: 0 0 8px; }}
  h2 {{ font-size: 19px; margin: 32px 0 8px; padding-top: 16px; border-top: 1px solid var(--line); }}
  p, li {{ margin: 8px 0; }}
  .muted {{ color: var(--muted); font-size: 14px; }}
  a {{ color: inherit; }}
  code {{ font: 13px ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }}
  .scroll {{ overflow-x: auto; }}
  table {{ border-collapse: collapse; font-size: 14px; min-width: 100%; }}
  th, td {{ padding: 6px 8px; border-bottom: 1px solid var(--line); text-align: right; white-space: nowrap; }}
  th:first-child, td:first-child {{ text-align: left; white-space: normal; }}
  .gallery {{ display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 420px), 1fr)); gap: 16px; }}
  .pair {{ margin: 0; border: 1px solid var(--line); border-radius: 10px; overflow: hidden; }}
  .pics {{ display: grid; grid-template-columns: 1fr 1fr; background: #fff; }}
  .pic {{ position: relative; padding: 18px 6px 6px; display: flex; align-items: center; justify-content: center; min-height: 140px; }}
  .pic + .pic {{ border-left: 1px solid #e3e3e6; }}
  .pic span {{ position: absolute; top: 4px; left: 8px; font-size: 12px; color: #5f6368; }}
  .pic svg {{ width: 100%; height: auto; max-height: 170px; }}
  figcaption {{ padding: 8px 10px; font-size: 13px; color: var(--muted); }}
</style>
</head>
<body>
<main>
<h1>Benchmark</h1>
<p>How well HexSketch names and draws structures it has never seen: {A['naming']['total']:,} public structures,
named offline, every name checked by parsing it back with <a href="https://github.com/dan2097/opsin">OPSIN</a>,
and every drawing scored against RDKit's.</p>
<p class="muted">OPSIN {summary['opsin']} · RDKit {summary['rdkit']} · method and code in
<a href="https://github.com/angus-e-mcmillan/HexSketch/blob/main/docs/benchmark.md">docs/benchmark.md</a></p>

<h2>Naming</h2>
<p>A name counts as correct only if OPSIN turns it back into exactly the structure, stereochemistry included
(compared by standard InChI). When HexSketch can't name a structure, it says so rather than guess.</p>
{table_html(naming_table_md())}
<p class="muted">Median time to name a structure: {A['naming']['median_ms']:.1f} ms.</p>

<h2>Drawing</h2>
<p><strong>Clean</strong> means no atoms drawn on top of each other or on another bond, and no crossing bonds. Lower bond length spread is more even.</p>
{table_html(layout_table_md())}

<h2>Side by side</h2>
<p class="muted">Twelve lead-like molecules picked at random. Each caption gives HexSketch's name and whether OPSIN read it back correctly.</p>
<div class="gallery">
{''.join(cards)}
</div>

<h2>The structures</h2>
<ul>
  <li><strong>{SETS['solubility']}</strong>: Huuskonen, J. Chem. Inf. Comput. Sci. 2000, 40, 773, as distributed with RDKit.</li>
  <li><strong>{SETS['zinc-leads']}</strong>: from the ZINC database, as distributed with RDKit.</li>
</ul>
<p><a href="/">Open HexSketch</a> · <a href="/ai">HexSketch for AI</a></p>
</main>
</body>
</html>
"""
(ROOT / 'apps' / 'web' / 'public' / 'benchmark.html').write_text(page, encoding='utf-8')
print(json.dumps(A, indent=2), file=sys.stderr)
