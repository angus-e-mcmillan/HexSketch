import { DEFAULT_PAGE, normalizePage, PAPERS, pageSize, type PageSettings, type PaperName } from '@hexsketch/core';

/**
 * File > Document Settings: the page (A4, US Letter or a slide; portrait or
 * landscape; one or more pages across and down) plus how the page is shown
 * (rulers, grid, units) and analysis decimals. The page belongs to the
 * document (saved in CDXML); the rest are this browser's preferences, and the
 * last page chosen becomes the default for new documents.
 */
export interface ViewPrefs {
  page: PageSettings;
  units: 'cm' | 'in';
  rulers: boolean;
  grid: boolean;
  /** Grid spacing in `units`. */
  gridSpacing: number;
  decimals: number;
}

const KEY = 'hexsketch.prefs';
export const DEFAULT_PREFS: ViewPrefs = { page: DEFAULT_PAGE, units: 'cm', rulers: true, grid: false, gridSpacing: 0.5, decimals: 4 };

export function loadPrefs(): ViewPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem('drawchem.prefs') ?? 'null') as Partial<ViewPrefs> | null;
    if (!raw) return { ...DEFAULT_PREFS };
    return {
      page: normalizePage(raw.page),
      units: raw.units === 'in' ? 'in' : 'cm',
      rulers: raw.rulers ?? DEFAULT_PREFS.rulers,
      grid: raw.grid ?? DEFAULT_PREFS.grid,
      gridSpacing: Number(raw.gridSpacing) > 0 ? Number(raw.gridSpacing) : DEFAULT_PREFS.gridSpacing,
      decimals: Number.isInteger(raw.decimals) ? Math.min(6, Math.max(0, raw.decimals!)) : DEFAULT_PREFS.decimals,
    };
  } catch { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(p: ViewPrefs): void {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* private window: keep for this session only */ }
}

/** Points per unit. */
export const PT_PER = { cm: 72 / 2.54, in: 72 } as const;

/** The Document Settings dialog. Resolves with the new settings, or null on Cancel. */
export function documentSettingsDialog(current: { page: PageSettings; prefs: ViewPrefs }): Promise<{ page: PageSettings; prefs: ViewPrefs } | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'doc-settings';
    let page = { ...current.page };
    const prefs = { ...current.prefs };
    const paperOptions = (Object.keys(PAPERS) as PaperName[]).map((k) => `<option value="${k}">${PAPERS[k].label}</option>`).join('');
    dlg.innerHTML = `
      <form method="dialog">
        <h2>Document Settings</h2>
        <div class="ds-body">
          <div class="ds-fields">
            <fieldset>
              <legend>Page</legend>
              <label class="ds-row"><span>Size</span><select name="paper">${paperOptions}</select></label>
              <div class="ds-row"><span>Orientation</span>
                <div class="segmented" role="radiogroup">
                  <button type="button" data-o="portrait" role="radio" title="Portrait"><svg viewBox="0 0 16 16" width="14" height="14"><rect x="4" y="1.5" width="8" height="13" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>Portrait</button>
                  <button type="button" data-o="landscape" role="radio" title="Landscape"><svg viewBox="0 0 16 16" width="14" height="14"><rect x="1.5" y="4" width="13" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>Landscape</button>
                </div>
              </div>
              <div class="ds-row"><span>Pages</span>
                <span class="ds-pages"><input name="across" type="number" min="1" max="20" step="1" aria-label="Pages across"> across × <input name="down" type="number" min="1" max="20" step="1" aria-label="Pages down"> down</span>
              </div>
            </fieldset>
            <fieldset>
              <legend>View</legend>
              <label class="ds-check"><input name="rulers" type="checkbox"> Show rulers</label>
              <div class="ds-row ds-grid"><label class="ds-check"><input name="grid" type="checkbox"> Show grid every</label>
                <input name="gridSpacing" type="number" min="0.05" step="0.05" aria-label="Grid spacing">
                <select name="units" aria-label="Units"><option value="cm">cm</option><option value="in">in</option></select>
              </div>
            </fieldset>
            <fieldset>
              <legend>Analysis</legend>
              <label class="ds-row"><span>Decimals</span><input name="decimals" type="number" min="0" max="6" step="1"></label>
            </fieldset>
          </div>
          <div class="ds-preview" aria-hidden="true"></div>
        </div>
        <div class="ds-buttons"><button value="cancel" type="button" class="ds-cancel">Cancel</button><button value="ok" class="ds-ok">OK</button></div>
      </form>`;
    const f = dlg.querySelector('form')!;
    const field = <T extends HTMLInputElement | HTMLSelectElement>(n: string) => f.elements.namedItem(n) as T;
    field<HTMLSelectElement>('paper').value = page.paper;
    field<HTMLInputElement>('across').value = String(page.across);
    field<HTMLInputElement>('down').value = String(page.down);
    field<HTMLInputElement>('rulers').checked = prefs.rulers;
    field<HTMLInputElement>('grid').checked = prefs.grid;
    field<HTMLInputElement>('gridSpacing').value = String(prefs.gridSpacing);
    field<HTMLSelectElement>('units').value = prefs.units;
    field<HTMLInputElement>('decimals').value = String(prefs.decimals);

    const preview = dlg.querySelector<HTMLElement>('.ds-preview')!;
    const sync = () => {
      page = normalizePage({ ...page, paper: field<HTMLSelectElement>('paper').value as PaperName, across: Number(field<HTMLInputElement>('across').value), down: Number(field<HTMLInputElement>('down').value) });
      for (const b of Array.from(dlg.querySelectorAll<HTMLButtonElement>('[data-o]'))) b.setAttribute('aria-checked', String(b.dataset.o === page.orientation));
      // A small picture of the pages, to scale.
      const s = pageSize(page), W = s.w * page.across, H = s.h * page.down, k = Math.min(150 / W, 150 / H);
      let rects = '';
      for (let i = 0; i < page.across; i++) for (let j = 0; j < page.down; j++) rects += `<rect x="${i * s.w * k + 0.5}" y="${j * s.h * k + 0.5}" width="${s.w * k - 1}" height="${s.h * k - 1}"/>`;
      const w = W * k, h = H * k, cm = (v: number) => (v / PT_PER.cm).toFixed(1);
      preview.innerHTML = `<svg width="${w + 2}" height="${h + 2}" viewBox="-0.5 -0.5 ${w + 2} ${h + 2}">${rects}</svg><div>${PAPERS[page.paper].label}, ${page.orientation}<br>${cm(s.w)} × ${cm(s.h)} cm per page</div>`;
    };
    for (const b of Array.from(dlg.querySelectorAll<HTMLButtonElement>('[data-o]'))) b.addEventListener('click', () => { page.orientation = b.dataset.o as PageSettings['orientation']; sync(); });
    f.addEventListener('input', sync);
    field<HTMLSelectElement>('paper').addEventListener('change', () => {
      // Slides are landscape; paper starts portrait.
      page.orientation = field<HTMLSelectElement>('paper').value.startsWith('Slide') ? 'landscape' : 'portrait';
      sync();
    });
    field<HTMLSelectElement>('units').addEventListener('change', () => {
      // Keep the grid sensible when switching units.
      field<HTMLInputElement>('gridSpacing').value = field<HTMLSelectElement>('units').value === 'in' ? '0.25' : '0.5';
    });
    sync();

    const done = (ok: boolean) => {
      dlg.close();
      dlg.remove();
      if (!ok) { resolve(null); return; }
      sync();
      resolve({
        page,
        prefs: {
          page,
          units: field<HTMLSelectElement>('units').value === 'in' ? 'in' : 'cm',
          rulers: field<HTMLInputElement>('rulers').checked,
          grid: field<HTMLInputElement>('grid').checked,
          gridSpacing: Math.max(0.05, Number(field<HTMLInputElement>('gridSpacing').value) || DEFAULT_PREFS.gridSpacing),
          decimals: Math.min(6, Math.max(0, Math.round(Number(field<HTMLInputElement>('decimals').value)))),
        },
      });
    };
    f.addEventListener('submit', (e) => { e.preventDefault(); done(true); });
    dlg.querySelector('.ds-cancel')!.addEventListener('click', () => done(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg);
    dlg.showModal();
    field<HTMLSelectElement>('paper').focus();
  });
}

/**
 * Rulers along the top and left of the canvas, in cm or inches from the
 * page's top-left corner, with a mark following the pointer (as ChemDraw's
 * View > Show Rulers).
 */
export function drawRuler(canvas: HTMLCanvasElement, axis: 'x' | 'y', o: { origin: number; zoom: number; units: 'cm' | 'in'; pointer: number | null }): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
  // Never allocate more than a sane bitmap, whatever the layout says.
  if (!cssW || !cssH || cssW * dpr > 16384 || cssH * dpr > 16384) return;
  if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
  }
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);
  const css = getComputedStyle(canvas);
  ctx.fillStyle = css.getPropertyValue('--ruler-bg').trim() || '#f4f4f4';
  ctx.fillRect(0, 0, cssW, cssH);
  const ink = css.getPropertyValue('--ruler-ink').trim() || '#777';
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.lineWidth = 1;
  ctx.font = '9px -apple-system, BlinkMacSystemFont, Helvetica, Arial, sans-serif';
  const len = axis === 'x' ? cssW : cssH, depth = axis === 'x' ? cssH : cssW;
  const unitPx = PT_PER[o.units] * o.zoom;
  // Minor ticks: mm (or 1/8 in); thinned out when they would crowd.
  const sub = o.units === 'cm' ? [10, 5, 2, 1] : [8, 4, 2, 1];
  const minor = sub.find((n) => unitPx / n >= 5) ?? 1;
  const labelEvery = [1, 2, 5, 10, 20, 50].find((n) => unitPx * n >= 34) ?? 50;
  const first = Math.floor(-o.origin / unitPx * minor) - 1, last = Math.ceil((len - o.origin) / unitPx * minor) + 1;
  ctx.beginPath();
  for (let i = first; i <= last; i++) {
    const pos = Math.round(o.origin + (i / minor) * unitPx) + 0.5;
    const whole = i % minor === 0, half = !whole && (2 * i) % minor === 0;
    const t = whole ? depth * 0.55 : half ? depth * 0.35 : depth * 0.2;
    if (axis === 'x') { ctx.moveTo(pos, depth); ctx.lineTo(pos, depth - t); } else { ctx.moveTo(depth, pos); ctx.lineTo(depth - t, pos); }
    if (whole && (i / minor) % labelEvery === 0) {
      const v = String(i / minor);
      if (axis === 'x') ctx.fillText(v, pos + 2, 9);
      else { ctx.save(); ctx.translate(9, pos + 2); ctx.rotate(-Math.PI / 2); ctx.textAlign = 'right'; ctx.fillText(v, 0, 0); ctx.restore(); }
    }
  }
  ctx.stroke();
  ctx.beginPath();
  if (axis === 'x') { ctx.moveTo(0, depth - 0.5); ctx.lineTo(cssW, depth - 0.5); } else { ctx.moveTo(depth - 0.5, 0); ctx.lineTo(depth - 0.5, cssH); }
  ctx.stroke();
  if (o.pointer !== null) {
    ctx.strokeStyle = css.getPropertyValue('--accent').trim() || '#2f6fde';
    ctx.beginPath();
    const p = Math.round(o.pointer) + 0.5;
    if (axis === 'x') { ctx.moveTo(p, 0); ctx.lineTo(p, depth); } else { ctx.moveTo(0, p); ctx.lineTo(depth, p); }
    ctx.stroke();
  }
}
