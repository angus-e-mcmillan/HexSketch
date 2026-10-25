// SPDX-License-Identifier: MIT
// The HexSketch link and payload format (docs/link-format.md): MIT, see LICENSE-MIT.

import { readCdxmlDocument, readCdxmlStyle } from './cdxml.ts';
import { computeMass } from './formula.ts';
import { layout2D } from './layout.ts';
import type { Molecule } from './model.ts';
import type { DocObject, ObjectGroup } from './objects.ts';
import { readCdxmlPage, type PageSettings } from './page.ts';
import { decodePayload, encodePayload, PAYLOAD_MARKER } from './payload.ts';
import { parseSmiles, writeSmiles } from './smiles.ts';
import { DEFAULT_STYLE, type DrawingStyle } from './style.ts';

/**
 * Links that open a structure in HexSketch, so an AI assistant can hand a
 * chemist something to edit, and a chemist can hand a drawing back. The
 * structure travels in the URL fragment (after #), which browsers never send
 * to the server:
 *
 *   https://hexsketch.com/#smiles=<SMILES, percent-encoded>
 *   https://hexsketch.com/#cdxml=<base64url(deflate-raw(CDXML))>
 *
 * The #cdxml= value is the payload HexSketch puts in alt text, without its
 * marker. It also accepts plain percent-encoded CDXML (starting with "<"),
 * which is easier to write from a script.
 */
export const HEXSKETCH_URL = 'https://hexsketch.com/';

/** A link that opens `smiles` (laid out fresh) in HexSketch. */
export function smilesLink(smiles: string, base = HEXSKETCH_URL): string {
  return `${base}#smiles=${encodeURIComponent(smiles)}`;
}

/** A link that opens this drawing as it is: layout, style, captions and arrows included. */
export async function structureLink(mol: Molecule, style: DrawingStyle = DEFAULT_STYLE, objects: readonly DocObject[] = [], groups: readonly ObjectGroup[] = [], base = HEXSKETCH_URL): Promise<string> {
  const payload = (await encodePayload(mol, style, objects, groups)).slice(PAYLOAD_MARKER.length);
  return `${base}#cdxml=${payload}`;
}

export type LinkedStructure =
  /** From #smiles=: atoms and bonds only, laid out with `bondLength`. */
  | { kind: 'smiles'; mol: Molecule; smiles: string }
  | { kind: 'drawing'; mol: Molecule; objects: DocObject[]; groups: ObjectGroup[]; style: DrawingStyle; page: PageSettings | null };

/** Percent-decoding that gives null instead of throwing on a stray "%". */
function decoded(s: string): string | null {
  try { return decodeURIComponent(s); } catch { return null; }
}

/**
 * The structure a link's fragment (location.hash, with or without "#")
 * points to; null when the fragment names none. Throws, with a message fit to
 * show, when it names one that can't be read.
 */
export async function readStructureLink(hash: string, bondLength = DEFAULT_STYLE.bondLength): Promise<LinkedStructure | null> {
  // Not URLSearchParams: it turns "+" into a space, and SMILES charges are written with "+".
  const params = new Map<string, string>();
  for (const part of hash.replace(/^#/, '').split('&')) {
    const eq = part.indexOf('=');
    if (eq > 0) params.set(part.slice(0, eq).toLowerCase(), part.slice(eq + 1));
  }

  const cdxml = params.get('cdxml');
  if (cdxml !== undefined) {
    const text = decoded(cdxml)?.trim() ?? '';
    if (text.startsWith('<')) {
      let doc;
      try { doc = readCdxmlDocument(text); } catch { throw new Error('The link has CDXML that could not be read'); }
      if (!doc.mol.atomCount && !doc.objects.length) throw new Error('The link has CDXML with no structure in it');
      const style = readCdxmlStyle(text);
      // CDXML from other programs may have no coordinates.
      if ([...doc.mol.atoms()].every((a) => a.x === 0 && a.y === 0)) layout2D(doc.mol, style.bondLength);
      return { kind: 'drawing', ...doc, style, page: readCdxmlPage(text) };
    }
    const p = await decodePayload(PAYLOAD_MARKER + cdxml);
    if (!p) throw new Error('The link is damaged: its drawing could not be read (it may have been cut short)');
    return { kind: 'drawing', mol: p.mol, objects: p.objects, groups: p.groups, style: p.style, page: readCdxmlPage(p.cdxml) };
  }

  const smiles = params.get('smiles');
  if (smiles !== undefined) {
    // Links should percent-encode the SMILES, but people paste them by hand too:
    // "%12" is then a ring closure, not an escape, so fall back to the text as written.
    for (const candidate of new Set([decoded(smiles), smiles])) {
      const s = candidate?.trim();
      if (!s) continue;
      let mol: Molecule;
      try { mol = parseSmiles(s); } catch { continue; }
      if (!mol.atomCount) continue;
      layout2D(mol, bondLength);
      return { kind: 'smiles', mol, smiles: s };
    }
    throw new Error('The link has a SMILES string that could not be read');
  }
  return null;
}

/**
 * Plain text describing a drawing, for pasting into a chat with an AI
 * assistant: per structure its name, SMILES, formula and masses, then a link
 * that opens the drawing again.
 */
export function aiSummary(mol: Molecule, opts: { nameOf?: (m: Molecule) => string | null; link?: string } = {}): string {
  const parts = mol.fragments().map((ids) => {
    if (ids.length === mol.atomCount) return mol;
    const keep = new Set(ids);
    const part = mol.clone();
    for (const a of mol.atoms()) if (!keep.has(a.id)) part.removeAtom(a.id);
    return part;
  });
  const lines = [parts.length > 1 ? `Drawing from HexSketch (${parts.length} structures)` : 'Structure from HexSketch'];
  parts.forEach((part, i) => {
    let name: string | null = null;
    try { name = opts.nameOf?.(part) ?? null; } catch { name = null; }
    const m = computeMass(part);
    if (parts.length > 1) lines.push('', `Structure ${i + 1}`);
    if (name) lines.push(`Name: ${name}`);
    lines.push(`SMILES: ${writeSmiles(part)}`);
    lines.push(`Formula: ${m.formulaWithCharge}`);
    lines.push(`Exact mass: ${m.monoisotopicMass.toFixed(4)}`);
    if (!m.unweighable.length) lines.push(`Molecular weight: ${m.molecularWeight.toFixed(2)}`);
  });
  if (opts.link) lines.push('', `Open and edit in HexSketch: ${opts.link}`);
  return lines.join('\n');
}
