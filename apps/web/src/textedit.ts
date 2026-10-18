/**
 * Rich caption editing, after ChemDraw's text tool and Text menu: several
 * lines (Return starts a new line), bold, italic, underline, subscript,
 * superscript, Formula style, size, colour and left/centre/right alignment.
 *
 * The editor keeps its own run model: each run is a <span data-style> in a
 * contenteditable box, typing inherits the span it lands in, and every style
 * command works on character offsets in that model, so the browser's own
 * formatting markup never gets involved.
 */
import { captionRuns, formulaPieces, type Caption, type TextRun, type TextStyle } from '@hexsketch/core';
import { restyle, type Editor } from '@hexsketch/editor';
import { CAPTION_FONTS } from '@hexsketch/render';
import { popover, swatchGrid } from './flyouts.ts';

export interface CaptionEditorHost {
  editor: Editor;
  pageEl: HTMLElement;
  wrapEl: HTMLElement;
  zoom: () => number;
  palette: () => readonly string[];
}

const SIZES = [5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 24];
const ZWSP = '​';

export function createCaptionEditor(host: CaptionEditorHost) {
  const { editor, wrapEl } = host;
  const box = document.createElement('div');
  box.className = 'caption-editor';
  box.contentEditable = 'true';
  box.spellcheck = false;
  box.hidden = true;
  wrapEl.append(box);

  const bar = document.createElement('div');
  bar.className = 'text-bar';
  bar.hidden = true;
  document.body.append(bar);

  let editing: number | null = null;
  let align: Caption['align'] = 'left';

  // ------------------------------------------------------------- model <-> DOM

  const docSize = () => editor.doc.style.captionSize;
  const docFont = () => editor.doc.style.captionFont;

  function styleCss(r: TextStyle): string {
    const z = host.zoom();
    const parts = [`font-size:${(r.size ?? docSize()) * z}px`];
    if (r.font) parts.push(`font-family:${cssFont(r.font)}`);
    if (r.bold) parts.push('font-weight:bold');
    if (r.italic) parts.push('font-style:italic');
    if (r.underline) parts.push('text-decoration:underline');
    if (r.color) parts.push(`color:${r.color}`);
    if (r.script === 'sub' || r.script === 'sup') parts.push(`vertical-align:${r.script === 'sub' ? 'sub' : 'super'};font-size:${(r.size ?? docSize()) * z * 0.75}px`);
    return parts.join(';');
  }

  function render(runs: TextRun[]) {
    box.replaceChildren();
    for (const r of runs) {
      const span = document.createElement('span');
      const { text, ...style } = r;
      span.dataset.style = JSON.stringify(style);
      span.setAttribute('style', styleCss(style));
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (i > 0) span.append(document.createElement('br'));
        if (!line) return;
        if (style.script === 'formula') {
          // Show Formula subscripts while editing; they read back as plain text.
          for (const p of formulaPieces(line)) {
            if (p.kind === 'normal') span.append(p.text);
            else { const s = document.createElement('span'); s.className = p.kind === 'sub' ? 'fsub' : 'fsup'; s.textContent = p.text; span.append(s); }
          }
        } else span.append(line);
      });
      box.append(span);
    }
    if (!runs.length) box.append(document.createTextNode(''));
  }

  /** Read the box back into runs (zero-width spaces dropped, <br> as new lines). */
  function read(): TextRun[] {
    const runs: TextRun[] = [];
    const walk = (node: Node, style: TextStyle) => {
      if (node.nodeType === Node.TEXT_NODE) {
        const t = (node.textContent ?? '').replaceAll(ZWSP, '');
        if (t) runs.push({ text: t, ...style });
        return;
      }
      if (!(node instanceof HTMLElement)) return;
      if (node.tagName === 'BR') { runs.push({ text: '\n', ...style }); return; }
      let st = style;
      if (node.dataset.style) st = JSON.parse(node.dataset.style) as TextStyle;
      // Browsers wrap new lines in <div>; treat each as a line.
      if ((node.tagName === 'DIV' || node.tagName === 'P') && node !== box && runs.length && !runs[runs.length - 1]!.text.endsWith('\n')) runs.push({ text: '\n', ...st });
      for (const c of Array.from(node.childNodes)) walk(c, st);
    };
    walk(box, {});
    // A trailing <br> the browser keeps for the caret is not a line.
    while (runs.length && runs[runs.length - 1]!.text === '\n') runs.pop();
    // Merge neighbours with the same style (Formula pieces come back as separate text nodes).
    const merged: TextRun[] = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      const { text: _a, ...sa } = last ?? { text: '' };
      const { text: _b, ...sb } = r;
      void _a; void _b;
      const key = (x: TextStyle) => [!!x.bold, !!x.italic, !!x.underline, x.script ?? '', x.size ?? '', x.color ?? '', x.font ?? ''].join('|');
      if (last && key(sa) === key(sb)) last.text += r.text;
      else merged.push({ ...r });
    }
    return merged;
  }

  /** Caret / selection as character offsets in the run model. */
  function selectionOffsets(): [number, number] | null {
    const sel = getSelection();
    if (!sel || !sel.rangeCount || !box.contains(sel.anchorNode)) return null;
    const offsetOf = (node: Node, off: number) => {
      let n = 0, found = -1;
      const walk = (x: Node): boolean => {
        if (x === node && x.nodeType !== Node.TEXT_NODE) {
          // Offset counts child nodes.
          for (let i = 0; i < off && i < x.childNodes.length; i++) n += lengthOf(x.childNodes[i]!);
          found = n; return true;
        }
        if (x.nodeType === Node.TEXT_NODE) {
          const t = x.textContent ?? '';
          if (x === node) { found = n + t.slice(0, off).replaceAll(ZWSP, '').length; return true; }
          n += t.replaceAll(ZWSP, '').length;
          return false;
        }
        if (x instanceof HTMLElement && x.tagName === 'BR') { n += 1; return false; }
        for (const c of Array.from(x.childNodes)) if (walk(c)) return true;
        return false;
      };
      walk(box);
      return found < 0 ? n : found;
    };
    const a = offsetOf(sel.anchorNode!, sel.anchorOffset), b = offsetOf(sel.focusNode!, sel.focusOffset);
    return [Math.min(a, b), Math.max(a, b)];
  }
  const lengthOf = (x: Node): number => (x.nodeType === Node.TEXT_NODE ? (x.textContent ?? '').replaceAll(ZWSP, '').length
    : x instanceof HTMLElement && x.tagName === 'BR' ? 1 : Array.from(x.childNodes).reduce((s, c) => s + lengthOf(c), 0));

  /** Put the caret / selection back at character offsets. */
  function setSelection(start: number, end: number) {
    const find = (target: number): [Node, number] => {
      let n = 0;
      let result: [Node, number] | null = null;
      const walk = (x: Node): boolean => {
        if (x.nodeType === Node.TEXT_NODE) {
          const len = (x.textContent ?? '').length;
          if (target <= n + len) { result = [x, target - n]; return true; }
          n += len; return false;
        }
        if (x instanceof HTMLElement && x.tagName === 'BR') {
          if (target === n) { result = [x.parentNode!, Array.from(x.parentNode!.childNodes).indexOf(x)]; return true; }
          n += 1; return false;
        }
        for (const c of Array.from(x.childNodes)) if (walk(c)) return true;
        return false;
      };
      walk(box);
      return result ?? [box, box.childNodes.length];
    };
    const [sn, so] = find(start), [en, eo] = find(end);
    const range = document.createRange();
    range.setStart(sn, so); range.setEnd(en, eo);
    const sel = getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  }

  /** Split runs so that [start, end) is made of whole runs; returns the new list and the index range. */
  function split(runs: TextRun[], start: number, end: number): { runs: TextRun[]; from: number; to: number } {
    const out: TextRun[] = [];
    let pos = 0, from = -1, to = -1;
    for (const r of runs) {
      const len = r.text.length, a = pos, b = pos + len;
      const cuts = [a, Math.min(Math.max(start, a), b), Math.min(Math.max(end, a), b), b];
      for (let k = 0; k < 3; k++) {
        const t = r.text.slice(cuts[k]! - a, cuts[k + 1]! - a);
        if (!t) continue;
        if (k === 1 && from < 0) from = out.length;
        out.push({ ...r, text: t });
        if (k === 1) to = out.length;
      }
      pos = b;
    }
    return { runs: out, from: from < 0 ? out.length : from, to: to < 0 ? out.length : to };
  }

  // ------------------------------------------------------------------ commands

  /** Apply a style to the selected characters, or (caret only) to what is typed next. */
  function applyStyle(patch: Partial<TextStyle>) {
    if (editing === null) {
      if (!editor.styleCaptions(patch)) return;
      return;
    }
    const runs = read();
    const off = selectionOffsets() ?? [0, runs.reduce((s, r) => s + r.text.length, 0)];
    const [start, end] = off;
    if (start === end) {
      // Pending style: an empty styled span at the caret, held open by a zero-width space.
      const { runs: parts, from } = split(runs, start, end);
      const before = parts[from - 1] ?? parts[from] ?? { text: '' };
      const { text: _t, ...base } = before;
      void _t;
      const styled = restyle([{ text: ZWSP, ...base }], patch)[0]!;
      parts.splice(from, 0, styled);
      render(parts);
      // Place the caret just after the zero-width space.
      const span = box.children[from] as HTMLElement | undefined;
      if (span?.firstChild) { const r = document.createRange(); r.setStart(span.firstChild, 1); r.collapse(true); const sel = getSelection()!; sel.removeAllRanges(); sel.addRange(r); }
      box.focus();
      return;
    }
    const { runs: parts, from, to } = split(runs, start, end);
    const changed = restyle(parts.slice(from, to), patch);
    parts.splice(from, to - from, ...changed);
    render(parts);
    setSelection(start, end);
    box.focus();
    syncBar();
  }

  function setAlign(a: Caption['align']) {
    if (editing === null) { editor.styleCaptions({ align: a }); return; }
    align = a;
    place();
    syncBar();
    box.focus();
  }

  // ------------------------------------------------------------- open / close

  function place() {
    const c = editor.doc.objects.find((o) => o.id === editing);
    if (!c || c.kind !== 'text') return;
    const z = host.zoom();
    const r = host.pageEl.getBoundingClientRect(), w = wrapEl.getBoundingClientRect();
    const x = r.left - w.left + wrapEl.scrollLeft + c.x * z;
    const y = r.top - w.top + wrapEl.scrollTop + (c.y - docSize() * 0.95) * z;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.textAlign = align ?? 'left';
    box.style.transform = align === 'center' ? 'translateX(-50%)' : align === 'right' ? 'translateX(-100%)' : '';
    box.style.fontSize = `${docSize() * z}px`;
    box.style.lineHeight = '1.2';
    const br = box.getBoundingClientRect();
    placeBar(br.left, br.top, br.bottom);
  }

  /** The toolbar sits just above the text, or below it when that would cover the menu bar. */
  function placeBar(left: number, top: number, bottom: number) {
    const minTop = (document.querySelector('.topbar')?.getBoundingClientRect().bottom ?? 0) + 6;
    const h = bar.offsetHeight || 32;
    bar.style.left = `${Math.max(4, Math.min(left, innerWidth - (bar.offsetWidth || 420) - 4))}px`;
    bar.style.top = `${top - h - 8 >= minTop ? top - h - 8 : bottom + 8}px`;
  }

  function open(id: number) {
    const c = editor.doc.objects.find((o) => o.id === id);
    if (!c || c.kind !== 'text') return;
    editing = id;
    align = c.align ?? 'left';
    render(c.text ? captionRuns(c).map((r) => ({ ...r, color: r.color ?? c.color ?? undefined })) : []);
    box.hidden = false;
    box.style.fontFamily = cssFont(docFont());
    editor.hideCaption = id;
    place();
    bar.hidden = false;
    syncBar();
    box.focus();
    // Caret at the end.
    const range = document.createRange();
    range.selectNodeContents(box);
    range.collapse(false);
    const sel = getSelection()!;
    sel.removeAllRanges(); sel.addRange(range);
  }

  function commit() {
    if (editing === null) return;
    const id = editing;
    editing = null;
    const runs = read();
    box.hidden = true;
    editor.hideCaption = null;
    editor.setCaptionRich(id, runs, align);
    syncBar();
    wrapEl.focus();
  }

  box.addEventListener('keydown', (e) => {
    // Every key typed here belongs to the text: none may reach the drawing's
    // hotkeys (Return there would start editing a nearby atom label).
    e.stopPropagation();
    const cmd = e.metaKey || e.ctrlKey;
    if (e.key === 'Enter' && !cmd) {
      // Return starts a new line, as in ChemDraw.
      e.preventDefault();
      document.execCommand('insertLineBreak');
      return;
    }
    if ((e.key === 'Enter' && cmd) || e.key === 'Escape') { e.preventDefault(); commit(); return; }
    if (cmd && !e.shiftKey && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      applyStyle({ [{ b: 'bold', i: 'italic', u: 'underline' }[e.key.toLowerCase() as 'b']]: true });
      return;
    }
    if (cmd && e.shiftKey && ['l', 'c', 'r'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      setAlign(({ l: 'left', c: 'center', r: 'right' } as const)[e.key.toLowerCase() as 'l']);
    }
  });
  // Paste as plain text so foreign formatting never enters the run model.
  box.addEventListener('paste', (e) => {
    e.preventDefault();
    e.stopPropagation();
    document.execCommand('insertText', false, e.clipboardData?.getData('text/plain') ?? '');
  });
  box.addEventListener('input', () => place());
  document.addEventListener('mousedown', (e) => {
    if (editing === null) return;
    const t = e.target as Node;
    if (box.contains(t) || bar.contains(t) || (t instanceof Element && t.closest('.popover'))) return;
    commit();
  }, true);
  document.addEventListener('selectionchange', () => { if (editing !== null) syncBar(); });

  // -------------------------------------------------------------------- toolbar

  const button = (label: string, title: string, onClick: () => void, cls = '') => {
    const b = document.createElement('button');
    b.type = 'button';
    // One inline span, so a label like X<sub>2</sub> stays on one line inside the button's grid.
    b.innerHTML = `<span class="lbl">${label}</span>`;
    b.title = title;
    b.className = cls;
    b.addEventListener('mousedown', (e) => e.preventDefault()); // keep the text selection
    b.addEventListener('click', onClick);
    bar.append(b);
    return b;
  };
  // Font: the document's caption font, or one of the fonts every computer has (measured exactly for layout).
  const fontSel = document.createElement('select');
  fontSel.title = 'Font';
  fontSel.className = 'font';
  for (const f of CAPTION_FONTS) {
    const o = new Option(f, f);
    o.style.fontFamily = cssFont(f);
    fontSel.append(o);
  }
  fontSel.addEventListener('change', () => applyStyle({ font: fontSel.value === docFont() ? undefined : fontSel.value }));
  bar.append(fontSel);
  const size = document.createElement('select');
  size.title = 'Size';
  for (const n of SIZES) size.append(new Option(`${n}`, `${n}`));
  size.append(new Option('Other…', 'other'));
  size.addEventListener('change', () => {
    let v = size.value === 'other' ? Number(prompt('Font size (pt)', `${docSize()}`)) : Number(size.value);
    if (!v || v < 2 || v > 200) { syncBar(); return; }
    v = Math.round(v * 10) / 10;
    applyStyle({ size: v === docSize() ? undefined : v });
  });
  bar.append(size);
  const bB = button('<b>B</b>', 'Bold (⌘B)', () => applyStyle({ bold: true }));
  const bI = button('<i>I</i>', 'Italic (⌘I)', () => applyStyle({ italic: true }));
  const bU = button('<u>U</u>', 'Underline (⌘U)', () => applyStyle({ underline: true }));
  const bSub = button('X<sub>2</sub>', 'Subscript', () => applyStyle({ script: 'sub' }));
  const bSup = button('X<sup>2</sup>', 'Superscript', () => applyStyle({ script: 'sup' }));
  const bF = button('CH<sub>2</sub>', 'Formula: subscripts digits, raises charges (CH2Cl2, NH4+)', () => applyStyle({ script: 'formula' }));
  bar.append(Object.assign(document.createElement('span'), { className: 'sep' }));
  const aL = button(alignIcon('left'), 'Flush Left (⇧⌘L)', () => setAlign('left'));
  const aC = button(alignIcon('center'), 'Centered (⇧⌘C)', () => setAlign('center'));
  const aR = button(alignIcon('right'), 'Flush Right (⇧⌘R)', () => setAlign('right'));
  bar.append(Object.assign(document.createElement('span'), { className: 'sep' }));
  const colorBtn = button('<span class="swatch-dot"></span>', 'Text colour', () => {
    popover(colorBtn, (panel, close) => {
      swatchGrid(panel, 'Text colour', ['#000000', ...host.palette()], (c) => { applyStyle({ color: c === '#000000' ? null : c }); close(); }, { custom: true, cols: 7 });
    });
  });

  /** Reflect the style at the caret (or of the selected captions) in the toolbar. */
  function syncBar() {
    let runs: TextRun[] = [];
    let a: Caption['align'] = align;
    if (editing !== null) {
      const all = read();
      const off = selectionOffsets();
      if (off) {
        const [s0, e0] = off[0] === off[1] ? [Math.max(0, off[0] - 1), off[0]] : off;
        const { runs: parts, from, to } = split(all, s0, e0);
        runs = parts.slice(from, to);
      }
      if (!runs.length) runs = all;
    } else {
      const caps = [...editor.selection.objects].map((id) => editor.doc.objects.find((o) => o.id === id)).filter((o): o is Caption => o?.kind === 'text');
      bar.hidden = !caps.length || editor.tool.kind !== 'select';
      if (bar.hidden) return;
      runs = caps.flatMap((c) => captionRuns(c));
      a = caps[0]!.align ?? 'left';
      const b = host.pageEl.getBoundingClientRect(), z = host.zoom();
      const c0 = caps[0]!;
      placeBar(b.left + c0.x * z, b.top + (c0.y - docSize() * 1.1) * z, b.top + (c0.y + docSize() * 0.4) * z);
    }
    const every = (f: (r: TextRun) => boolean) => runs.length > 0 && runs.every(f);
    bB.classList.toggle('on', every((r) => !!r.bold));
    bI.classList.toggle('on', every((r) => !!r.italic));
    bU.classList.toggle('on', every((r) => !!r.underline));
    bSub.classList.toggle('on', every((r) => r.script === 'sub'));
    bSup.classList.toggle('on', every((r) => r.script === 'sup'));
    bF.classList.toggle('on', every((r) => r.script === 'formula'));
    for (const [btn, v] of [[aL, 'left'], [aC, 'center'], [aR, 'right']] as const) btn.classList.toggle('on', a === v);
    const sz = runs[0]?.size ?? docSize();
    size.value = SIZES.includes(sz) ? `${sz}` : 'other';
    const fonts = new Set(runs.length ? runs.map((r) => r.font ?? docFont()) : [docFont()]);
    fontSel.value = fonts.size === 1 ? [...fonts][0]! : '';
    if (fonts.size === 1 && !CAPTION_FONTS.includes([...fonts][0] as typeof CAPTION_FONTS[number])) fontSel.value = 'Helvetica';
    (colorBtn.firstElementChild as HTMLElement).style.background = runs[0]?.color ?? '#000';
  }

  return {
    open, commit,
    isOpen: () => editing !== null,
    /** Show the toolbar for captions selected with a selection tool. */
    refresh: () => { if (editing === null) syncBar(); else place(); },
  };
}

function alignIcon(a: 'left' | 'center' | 'right'): string {
  const rows = [[2, 14], [2, 10], [2, 14], [2, 8]];
  const lines = rows.map(([x, w], i) => {
    const x0 = a === 'left' ? x! : a === 'center' ? 9 - w! / 2 : 16 - w!;
    return `<line x1="${x0}" y1="${3 + i * 3.5}" x2="${x0 + w!}" y2="${3 + i * 3.5}"/>`;
  }).join('');
  return `<svg viewBox="0 0 18 16" width="16" height="14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">${lines}</svg>`;
}

/** CSS font stack for a caption font, falling back within its family. */
function cssFont(font: string): string {
  if (/times/i.test(font)) return `"${font}", "Times New Roman", Times, serif`;
  if (/courier/i.test(font)) return `"${font}", "Courier New", Courier, monospace`;
  return `"${font}", Helvetica, Arial, sans-serif`;
}
