import { layout2D, paletteId, parseSmiles, sameStyle, PALETTES, STYLE_PRESETS, type DrawingStyle } from '@hexsketch/core';
import { CAPTION_FONTS, depict, toSvg } from '@hexsketch/render';
import { PT_PER } from './docsettings.ts';

/**
 * File > Drawing Settings: bond length, line widths, spacing, label and
 * caption fonts, and the colour palette, as in ChemDraw's Drawing settings.
 * Built-in styles (HexSketch, ACS Document 1996) and the user's own saved
 * styles can be picked from a list; one style can be the default for new
 * documents. Saved styles live in this browser (localStorage).
 */
export interface StyleLibrary {
  saved: { name: string; style: DrawingStyle }[];
  /** Style for new documents, or null for the HexSketch style. */
  defaultStyle: DrawingStyle | null;
}

const KEY = 'hexsketch.styles';

export function loadStyleLibrary(): StyleLibrary {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<StyleLibrary> | null;
    const ok = (s: unknown): s is DrawingStyle => !!s && typeof s === 'object' && Number((s as DrawingStyle).bondLength) > 0;
    return {
      saved: Array.isArray(raw?.saved) ? raw.saved.filter((e) => e && typeof e.name === 'string' && ok(e.style)) : [],
      defaultStyle: ok(raw?.defaultStyle) ? raw.defaultStyle : null,
    };
  } catch { return { saved: [], defaultStyle: null }; }
}

export function saveStyleLibrary(lib: StyleLibrary): void {
  try { localStorage.setItem(KEY, JSON.stringify(lib)); } catch { /* private window: keep for this session only */ }
}

/** A drawing that shows off the settings: ring, double bonds, a wedge and labels. */
const SAMPLE = 'O=C(O)[C@@H](N)Cc1ccccc1';
const FONTS = ['Helvetica', 'Arial'];

type LengthField = 'bondLength' | 'lineWidth' | 'boldWidth' | 'hashSpacing' | 'marginWidth';
const LENGTHS: [LengthField, string][] = [
  ['bondLength', 'Fixed length'], ['lineWidth', 'Line width'], ['boldWidth', 'Bold width'],
  ['hashSpacing', 'Hash spacing'], ['marginWidth', 'Margin width'],
];

export interface DrawingSettingsResult { style: DrawingStyle; rescale: boolean; makeDefault: boolean }

/** The Drawing Settings dialog. Resolves with the chosen style, or null on Cancel. */
export function drawingSettingsDialog(current: { style: DrawingStyle; units: 'cm' | 'in'; library: StyleLibrary }): Promise<DrawingSettingsResult | null> {
  return new Promise((resolve) => {
    const lib = current.library;
    const unit = current.units, per = PT_PER[unit], places = unit === 'cm' ? 3 : 4;
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    const dlg = document.createElement('dialog');
    dlg.className = 'doc-settings draw-settings';
    const lengthRows = LENGTHS.map(([k, label]) => `<label class="ds-row"><span>${label}</span><input name="${k}" type="number" min="0.001" step="${unit === 'cm' ? 0.001 : 0.0005}"> ${unit}</label>`).join('');
    const fontOptions = FONTS.map((f) => `<option>${f}</option>`).join('');
    const captionFontOptions = CAPTION_FONTS.map((f) => `<option>${f}</option>`).join('');
    dlg.innerHTML = `
      <form method="dialog">
        <h2>Drawing Settings</h2>
        <div class="ds-row ds-style"><span>Style</span><select name="preset"></select>
          <button type="button" class="ds-small ds-save">Save As…</button><button type="button" class="ds-small ds-delete">Delete</button></div>
        <div class="ds-body">
          <div class="ds-fields">
            <fieldset>
              <legend>Bonds</legend>
              ${lengthRows}
              <label class="ds-row"><span>Bond spacing</span><input name="bondSpacing" type="number" min="1" max="100" step="1"> % of length</label>
              <label class="ds-row"><span>Chain angle</span><input name="chainAngle" type="number" min="60" max="180" step="1"> °</label>
            </fieldset>
            <fieldset>
              <legend>Atom labels</legend>
              <div class="ds-row"><span>Font</span><select name="labelFont">${fontOptions}</select><input name="labelSize" type="number" min="4" max="48" step="0.5" aria-label="Label size"> pt
                <label class="ds-check ds-inline"><input name="labelBold" type="checkbox"> Bold</label></div>
              <label class="ds-check"><input name="showTerminalCarbonLabels" type="checkbox"> Show terminal carbon labels (CH<sub>3</sub>)</label>
            </fieldset>
            <fieldset>
              <legend>Captions</legend>
              <div class="ds-row"><span>Font</span><select name="captionFont">${captionFontOptions}</select><input name="captionSize" type="number" min="4" max="48" step="0.5" aria-label="Caption size"> pt</div>
            </fieldset>
          </div>
          <div class="ds-side">
            <div class="ds-sample" aria-hidden="true"></div>
            <fieldset>
              <legend>Colours</legend>
              <div class="ds-row"><span>Palette</span><select name="palette"></select></div>
              <div class="ds-swatches" aria-hidden="true"></div>
            </fieldset>
            <fieldset>
              <legend>Apply</legend>
              <label class="ds-check"><input name="rescale" type="checkbox" checked> Scale existing structures to the new bond length</label>
              <label class="ds-check"><input name="makeDefault" type="checkbox"> Use these settings for new documents</label>
            </fieldset>
          </div>
        </div>
        <div class="ds-buttons"><button value="cancel" type="button" class="ds-cancel">Cancel</button><button value="ok" class="ds-ok">OK</button></div>
      </form>`;
    const f = dlg.querySelector('form')!;
    const field = <T extends HTMLInputElement | HTMLSelectElement>(n: string) => f.elements.namedItem(n) as T;
    const input = (n: string) => field<HTMLInputElement>(n);
    const presetSel = field<HTMLSelectElement>('preset');
    const paletteSel = field<HTMLSelectElement>('palette');
    // A palette read from a file stays available as "From this document".
    const filePalette = paletteId(current.style) === null && current.style.palette?.length ? current.style.palette : null;

    let style: DrawingStyle = { ...current.style };

    const fillPalettes = () => {
      paletteSel.innerHTML = PALETTES.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')
        + (filePalette ? '<option value="file">From this document</option>' : '');
    };
    /** Style list: built-ins, then saved styles, then "Custom" when the fields match none. */
    const fillPresets = () => {
      const saved = lib.saved.map((e, i) => `<option value="saved:${i}">${esc(e.name)}</option>`).join('');
      presetSel.innerHTML = STYLE_PRESETS.map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('')
        + (saved ? `<optgroup label="Saved">${saved}</optgroup>` : '')
        + '<option value="custom">Custom</option>';
    };
    const styleOf = (v: string): DrawingStyle | null => {
      if (v.startsWith('saved:')) return lib.saved[Number(v.slice(6))]?.style ?? null;
      return STYLE_PRESETS.find((p) => p.id === v)?.style ?? null;
    };
    const matchPreset = () => {
      const saved = lib.saved.findIndex((e) => sameStyle(e.style, style));
      const built = STYLE_PRESETS.find((p) => sameStyle(p.style, style));
      presetSel.value = built ? built.id : saved >= 0 ? `saved:${saved}` : 'custom';
      dlg.querySelector<HTMLButtonElement>('.ds-delete')!.disabled = !presetSel.value.startsWith('saved:');
    };

    const toFields = () => {
      for (const [k] of LENGTHS) input(k).value = String(+(style[k] / per).toFixed(places));
      input('bondSpacing').value = String(style.bondSpacing);
      input('chainAngle').value = String(style.chainAngle);
      field<HTMLSelectElement>('labelFont').value = FONTS.includes(style.labelFont) ? style.labelFont : 'Helvetica';
      input('labelSize').value = String(style.labelSize);
      input('labelBold').checked = style.labelBold;
      input('showTerminalCarbonLabels').checked = style.showTerminalCarbonLabels;
      field<HTMLSelectElement>('captionFont').value = (CAPTION_FONTS as readonly string[]).includes(style.captionFont) ? style.captionFont : 'Helvetica';
      input('captionSize').value = String(style.captionSize);
      paletteSel.value = paletteId(style) ?? (filePalette ? 'file' : 'hexsketch');
    };
    const num = (n: string, fallback: number, min = 0.001) => { const v = Number(input(n).value); return Number.isFinite(v) && v >= min ? v : fallback; };
    const fromFields = () => {
      const next: DrawingStyle = { ...style };
      for (const [k] of LENGTHS) {
        // A box left as shown keeps the exact value (cm to 3 places would turn ACS's 0.6 pt into 0.595).
        const v = num(k, style[k] / per);
        if (v !== +(style[k] / per).toFixed(places)) next[k] = v * per;
      }
      next.bondSpacing = num('bondSpacing', style.bondSpacing, 1);
      next.chainAngle = num('chainAngle', style.chainAngle, 60);
      next.labelFont = field<HTMLSelectElement>('labelFont').value;
      next.labelSize = num('labelSize', style.labelSize, 4);
      next.labelBold = input('labelBold').checked;
      next.showTerminalCarbonLabels = input('showTerminalCarbonLabels').checked;
      next.captionFont = field<HTMLSelectElement>('captionFont').value;
      next.captionSize = num('captionSize', style.captionSize, 4);
      const pv = paletteSel.value;
      next.palette = pv === 'file' && filePalette ? filePalette : PALETTES.find((p) => p.id === pv)?.colors ?? next.palette;
      style = next;
    };

    const sample = parseSmiles(SAMPLE);
    const swatches = dlg.querySelector<HTMLElement>('.ds-swatches')!;
    const preview = dlg.querySelector<HTMLElement>('.ds-sample')!;
    const showPreview = () => {
      // Laid out at this style's bond length and drawn at a fixed scale, so length changes show.
      const mol = sample.clone();
      layout2D(mol, style.bondLength);
      const svg = toSvg(depict(mol, style), { padding: 6, background: '#fff' });
      const m = /width="([\d.]+)pt" height="([\d.]+)pt"/.exec(svg);
      const k = 1.4;
      preview.innerHTML = m ? svg.replace(/width="[\d.]+pt" height="[\d.]+pt"/, `width="${(+m[1]! * k).toFixed(1)}" height="${(+m[2]! * k).toFixed(1)}"`) : svg;
      swatches.innerHTML = ['#000000', ...(style.palette ?? [])].map((c) => `<i style="background:${c}"></i>`).join('');
    };

    fillPalettes();
    fillPresets();
    toFields();
    matchPreset();
    showPreview();

    presetSel.addEventListener('change', () => {
      const s = styleOf(presetSel.value);
      if (s) {
        // A style without its own colours keeps the current palette.
        style = { ...style, ...s, palette: s.palette ?? style.palette };
        toFields();
      }
      matchPreset();
      showPreview();
    });
    f.addEventListener('input', (e) => {
      if (e.target === presetSel) return;
      fromFields();
      matchPreset();
      showPreview();
    });
    dlg.querySelector('.ds-save')!.addEventListener('click', () => {
      fromFields();
      const name = prompt('Save these settings as a style named:', '')?.trim();
      if (!name) return;
      const at = lib.saved.findIndex((e) => e.name === name);
      if (at >= 0) lib.saved[at] = { name, style: { ...style } }; else lib.saved.push({ name, style: { ...style } });
      saveStyleLibrary(lib);
      fillPresets();
      matchPreset();
    });
    dlg.querySelector('.ds-delete')!.addEventListener('click', () => {
      const v = presetSel.value;
      if (!v.startsWith('saved:')) return;
      lib.saved.splice(Number(v.slice(6)), 1);
      saveStyleLibrary(lib);
      fillPresets();
      matchPreset();
    });

    const done = (ok: boolean) => {
      dlg.close();
      dlg.remove();
      if (!ok) { resolve(null); return; }
      fromFields();
      resolve({ style, rescale: input('rescale').checked, makeDefault: input('makeDefault').checked });
    };
    f.addEventListener('submit', (e) => { e.preventDefault(); done(true); });
    dlg.querySelector('.ds-cancel')!.addEventListener('click', () => done(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    document.body.append(dlg);
    dlg.showModal();
    presetSel.focus();
  });
}
