# hexsketch

Chemical structures for AI agents, scripts and the command line, from the
makers of the [HexSketch](https://hexsketch.com) structure editor. Render, name,
analyse, convert and check SMILES, molfiles and CDXML, with no network access
and no native dependencies.

Every drawing it makes can be opened and edited in HexSketch: PNGs carry the
structure inside them, and `link` gives a URL that opens the structure ready
to edit.

## Command line

```sh
npx hexsketch analyze "CC(=O)Oc1ccccc1C(=O)O"
# Name: 2-acetoxybenzoic acid
# SMILES: CC(=O)OC1=CC=CC=C1C(=O)O
# Formula: C9H8O4
# Exact mass: 180.0423
# Molecular weight: 180.16
# ...

npx hexsketch render "N[C@@H](Cc1ccccc1)C(=O)O" -o phenylalanine.png   # .svg .png .pdf .cdxml .mol
npx hexsketch name phenylalanine.png                                    # L-phenylalanine
npx hexsketch validate "C(C)(C)(C)(C)C"                                 # exit 1: five-bond carbon
npx hexsketch compare "C[C@H](N)C(=O)O" "N[C@@H](C)C(=O)O"              # same stereoisomer: exit 0
npx hexsketch convert structure.mol --to smiles                         # SMILES with stereochemistry
npx hexsketch link "CC#N"                                               # https://hexsketch.com/#smiles=CC%23N
```

A structure is SMILES, a file (molfile, CDXML, or a PNG exported from
HexSketch), a HexSketch link, or `-` for standard input. `--json` gives
machine-readable output for every command. Exit codes: 0 done; 1 `validate`
found errors or `compare` found a difference; 2 bad usage or unreadable input.

## Library

```js
import { analyze, compare, convert, link, name, render, validate } from 'hexsketch';
import { rasterize } from 'hexsketch/png'; // Node only, for PNG

const check = await validate('CC(=O)Oc1ccccc1C(=O)O');
// { ok: true, issues: [], smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', name: '2-acetoxybenzoic acid', formula: 'C9H8O4' }

const { data: svg } = await render('C[C@H](N)C(=O)O');               // SVG text
const { data: png } = await render('C[C@H](N)C(=O)O', { to: 'png', rasterize });
```

The main module is platform-neutral: it runs in Node 20+, Workers and
browsers, including straight from a CDN:

```html
<script type="module">
  import { render } from 'https://cdn.jsdelivr.net/npm/hexsketch@0.1.0/dist/index.js';
  document.body.innerHTML = (await render('c1ccccc1O')).data;
</script>
```

`validate` never throws. It reports unreadable input, names or InChI given
instead of SMILES, aromatic rings that can't be kekulized, atoms over or
under their valence, unusual charges and abbreviations it can't draw out.
Every other function throws an `Error` whose message says what is wrong.

## Licence

Business Source License 1.1 (`LICENSE`): free to use, including at work and
through AI assistants; distributing or hosting HexSketch as part of a product
or service for others needs a commercial licence. Each version becomes
Apache-2.0 four years after release. The link and picture-payload format
([spec](https://github.com/angus-e-mcmillan/HexSketch/blob/main/docs/link-format.md))
is MIT (`LICENSE-MIT`).

PNG text uses Liberation Sans (SIL Open Font License 1.1, see `fonts/LICENSE`),
which shares Helvetica's and Arial's metrics. PNG rendering uses
[resvg](https://github.com/linebender/resvg) (MPL-2.0).
