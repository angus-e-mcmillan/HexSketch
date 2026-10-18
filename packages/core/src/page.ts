/**
 * Document layout (File > Document Settings > Layout in ChemDraw): the paper
 * or slide the drawing is laid out on, its orientation, and how many pages
 * across and down the document spans. Sizes are in points.
 */
export type PaperName = 'A4' | 'Letter' | 'Slide16x9' | 'Slide4x3';

export interface PageSettings {
  paper: PaperName;
  orientation: 'portrait' | 'landscape';
  /** Pages across (columns) and down (rows), 1 or more. */
  across: number;
  down: number;
}

export const PAPERS: Record<PaperName, { label: string; w: number; h: number; margin: number }> = {
  A4: { label: 'A4', w: 595.28, h: 841.89, margin: 36 },
  Letter: { label: 'US Letter', w: 612, h: 792, margin: 36 },
  // Slides are laid out landscape; PowerPoint's widescreen and standard sizes.
  Slide16x9: { label: 'Slide 16:9', w: 540, h: 960, margin: 0 },
  Slide4x3: { label: 'Slide 4:3', w: 540, h: 720, margin: 0 },
};

export const DEFAULT_PAGE: PageSettings = { paper: 'A4', orientation: 'portrait', across: 1, down: 1 };

/** One page's width and height, oriented. */
export function pageSize(p: PageSettings): { w: number; h: number } {
  const { w, h } = PAPERS[p.paper];
  const [short, long] = w < h ? [w, h] : [h, w];
  return p.orientation === 'portrait' ? { w: short, h: long } : { w: long, h: short };
}

/** The whole document: pages across by pages down. */
export function documentSize(p: PageSettings): { w: number; h: number } {
  const s = pageSize(p);
  return { w: s.w * p.across, h: s.h * p.down };
}

/** A sane copy (whole page counts from 1 to 20). */
export function normalizePage(p: Partial<PageSettings> | null | undefined): PageSettings {
  const clamp = (n: unknown) => Math.min(20, Math.max(1, Math.round(Number(n) || 1)));
  return {
    paper: p?.paper && p.paper in PAPERS ? p.paper : DEFAULT_PAGE.paper,
    orientation: p?.orientation === 'landscape' ? 'landscape' : 'portrait',
    across: clamp(p?.across ?? 1),
    down: clamp(p?.down ?? 1),
  };
}

/**
 * The CDXML <page> attributes ChemDraw writes: the printable area of all pages
 * (paper less its margins) as BoundingBox, and the page counts. HexSketchPaper
 * keeps the exact choice for HexSketch.
 */
export function pageCdxmlAttrs(p: PageSettings): string {
  const s = pageSize(p), m = PAPERS[p.paper].margin;
  const w = (s.w - 2 * m) * p.across, h = (s.h - 2 * m) * p.down;
  return `BoundingBox="0 0 ${+w.toFixed(2)} ${+h.toFixed(2)}" WidthPages="${p.across}" HeightPages="${p.down}" HexSketchPaper="${p.paper} ${p.orientation}"`;
}

/** Page settings from a CDXML document, or null when it says nothing usable. */
export function readCdxmlPage(xml: string): PageSettings | null {
  const tag = /<page\b([^>]*)>/.exec(xml)?.[1];
  if (!tag) return null;
  const attr = (n: string) => new RegExp(`\\b${n}="([^"]*)"`).exec(tag)?.[1];
  const across = Number(attr('WidthPages') ?? 1) || 1, down = Number(attr('HeightPages') ?? 1) || 1;
  const own = (attr('HexSketchPaper') ?? attr('DrawChemPaper'))?.split(' ');
  if (own && own[0]! in PAPERS) return normalizePage({ paper: own[0] as PaperName, orientation: own[1] === 'landscape' ? 'landscape' : 'portrait', across, down });
  const bb = attr('BoundingBox')?.trim().split(/\s+/).map(Number);
  if (!bb || bb.length < 4 || bb.some((v) => !Number.isFinite(v))) return null;
  // ChemDraw's box is the printable area; match it to the nearest paper with its margins.
  const w = (bb[2]! - bb[0]!) / across, h = (bb[3]! - bb[1]!) / down;
  let best: PageSettings | null = null, bestErr = Infinity;
  for (const paper of Object.keys(PAPERS) as PaperName[]) {
    for (const orientation of ['portrait', 'landscape'] as const) {
      const cand = { paper, orientation, across, down };
      const s = pageSize(cand), m = PAPERS[paper].margin;
      const err = Math.abs(s.w - 2 * m - w) + Math.abs(s.h - 2 * m - h);
      if (err < bestErr) { bestErr = err; best = cand; }
    }
  }
  return best && bestErr < 60 ? normalizePage(best) : normalizePage({ paper: 'Letter', orientation: w > h ? 'landscape' : 'portrait', across, down });
}
