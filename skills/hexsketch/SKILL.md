---
name: hexsketch
description: Draw, show and discuss chemical structures and reactions with a chemist in the HexSketch editor. Use whenever a conversation involves a molecule, a reaction, a mechanism, a synthesis or a SMILES, and the HexSketch tools (open_sketcher, show_in_sketcher, render_structure...) are connected.
---

# Working with chemists in HexSketch

Chemists think in sketches. Show structures in the HexSketch editor rather
than describing them, and keep the chat for the short answer.

## The editor first

1. As soon as the conversation turns to a structure, call `open_sketcher`:
   with the structure if you have one, empty if the chemist is about to draw.
   Do it on the first such message, and give the highlights, labels, note,
   arrows or steps in the same call: one round, not two.
2. When the chemist says "this", "my structure" or "what I drew", call
   `read_sketcher` first: they may have edited the drawing.
3. Make each point with `show_in_sketcher`: a new structure or scheme,
   highlights (SMILES fragments, coloured yellow, blue, orange... in order),
   labels pinned to atoms (a few words or a value: "pKa ≈ 4.4", "Michael
   acceptor") and a note of a few short bullets by colour. Then refer to the
   drawing by colour in the chat: "the yellow ester".
   For a mechanism, one call per step with curly `arrows`: give the species
   as SMILES with atom-map numbers (`[OH-:1].[CH3:2][Br:3]`) and arrows from
   a lone pair (`[1]`) or bond (`[2, 3]`) to an atom or a bond being made
   (`[1, 2]`). Send a whole mechanism at once as `steps`: the chemist steps
   through it with Back and Next.
   For a retrosynthesis, mark bonds with `disconnect` (`[[1, 2]]`), then
   show the precursors behind a retrosynthetic arrow and the forward route.
4. While the editor is open, don't show structures as images, web pictures,
   ASCII drawings or extra editors. Use `render_structure` only when the
   chemist asks for an image or a file.

Where the editor can't be shown, use `render_structure` and always give the
HexSketch link from the result, so the chemist can edit the structure by
drawing.

## Get the structure right

- HexSketch reads SMILES, molfiles, CDXML and HexSketch links, not names.
  Write the SMILES yourself.
- Check every SMILES you write against the name and formula HexSketch
  returns with it (`open_sketcher`, `show_in_sketcher` and `render_structure`
  all return them, with any problems found). Fix and show it again if they
  are not what you meant. `validate_structure` is for a SMILES you only give
  in text.
- Write stereochemistry explicitly (`[C@@H]`, `/` and `\`) whenever the
  compound has it, and confirm it with the (R)/(S) or (E)/(Z) in the name.
- Use `compare_structures` to tell whether two structures are the same
  compound or the same stereoisomer, rather than comparing SMILES by eye.

## Reactions are schemes

- Draw every reaction with the `reaction` input: `stages` from starting
  materials to products (structures of one stage joined with "."), and one
  arrow per step.
- On each arrow write what a chemist would: reagents and catalysts above
  (`"Pd(PPh3)4, K2CO3"`), solvent, temperature, time and yield below
  (`"dioxane/H2O, 90 °C, 12 h"`, then `"\n85%"` if known).
- Use `type: "retrosynthetic"` for disconnections and `"equilibrium"` for
  reversible steps.
- HexSketch draws related compounds the same way round. Keep each compound in
  the same place from one call to the next so the chemist can follow it.

## Text from HexSketch

A message that starts "Structure from HexSketch", or a hexsketch.com link, is
a structure the chemist drew. Read the SMILES from it, or pass the link to the
tools as the structure.
