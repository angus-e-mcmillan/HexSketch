# @hexsketch/agent

HexSketch for AI agents and scripts. Reads SMILES, molfiles, CDXML, HexSketch
links and picture payloads (format detected), and needs no DOM or network.

```ts
import { analyze, compare, convert, link, name, render, validate } from '@hexsketch/agent';

await validate('CC(=O)Oc1ccccc1C(=O)O');
// { ok: true, issues: [], smiles: 'CC(=O)OC1=CC=CC=C1C(=O)O', name: '2-acetoxybenzoic acid', formula: 'C9H8O4' }

await render('C[C@H](N)C(=O)O', { to: 'svg' });       // also 'pdf', 'cdxml', 'mol', and 'png' with a rasterizer
await name('C[C@H](N)C(=O)O');                       // { name: '(S)-2-aminopropanoic acid' }
await analyze('CC(=O)[O-].[Na+]');                   // formula, exact mass, MW, elemental analysis, isotopes; per structure
await convert(molfileText, 'smiles');                // SMILES with stereochemistry from wedges
await compare('C[C@H](N)C(=O)O', 'N[C@@H](C)C(=O)O'); // { same: true, sameConnectivity: true, ... }
await link('CC#N');                                  // https://hexsketch.com/#smiles=CC%23N
```

`validate` never throws: unreadable input, names or InChI given instead of
SMILES, aromatic rings that can't be kekulized, atoms over or under their
valence, unusual charges and abbreviations it can't draw out come back as
issues (`error`, `warning`, `note`). The other functions throw an `Error`
whose message says what is wrong with the input.

PNG output carries the structure inside the image, so the picture opens for
editing in HexSketch. Rasterizing is left to the caller (`rasterize: (svg,
scale) => pngBytes`), so this package has no dependencies beyond HexSketch's
own.
