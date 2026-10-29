/**
 * Writes an HTML page comparing peptide drawings: the Expand Label layout, the
 * same structure from SMILES through layout2D (paste), and each after Clean Up.
 * Usage: node --experimental-strip-types tools/peptide-gallery.ts out.html
 */
import { writeFileSync } from 'node:fs';
import { cleanUpStructure, DEFAULT_STYLE, layout2D, parsePeptide, parseSmiles, peptideMolecule, peptideSmiles, type Molecule } from '../packages/core/src/index.ts';
import { depict, toSvg } from '../packages/render/src/index.ts';

const SEQS = [
  'H-Ala-Gly-Phe-OH',
  'Boc-Lys(Z)-Pro-D-Ala-Ser(tBu)-Phe-Leu-OMe',
  'H-Cys-Tyr-Ile-Gln-Asn-Cys-Pro-Leu-Gly-NH2',
  'Fmoc-Cys(Trt)-Arg(Pbf)-His(Trt)-OH',
  'H-Tyr-Gly-Gly-Phe-Met-Arg-Arg-Val-Arg-Pro-Lys-Leu-Lys-Trp-Asp-OH',
];
const L = DEFAULT_STYLE.bondLength;
const svg = (m: Molecule) => toSvg(depict(m, DEFAULT_STYLE), { padding: 6, background: '#fff' });
const rows: string[] = [];
for (const s of SEQS) {
  const expanded = peptideMolecule(parsePeptide(s)!, L);
  const pasted = parseSmiles(peptideSmiles(parsePeptide(s)!)); layout2D(pasted, L);
  const ce = expanded.clone(); cleanUpStructure(ce, L);
  const cp = pasted.clone(); cleanUpStructure(cp, L);
  rows.push(`<h3>${s}</h3><div class=r><figure>${svg(expanded)}<figcaption>Expand Label</figcaption></figure><figure>${svg(ce)}<figcaption>Expand Label, then Clean Up</figcaption></figure></div>`
    + `<div class=r><figure>${svg(pasted)}<figcaption>Pasted SMILES</figcaption></figure><figure>${svg(cp)}<figcaption>Pasted, then Clean Up</figcaption></figure></div>`);
}
writeFileSync(process.argv[2] ?? 'peptides.html', `<!doctype html><meta charset=utf-8><style>body{font:13px system-ui;margin:16px}.r{display:flex;gap:16px;flex-wrap:wrap}figure{margin:0}svg{max-width:100%;height:auto}</style>${rows.join('')}`);
