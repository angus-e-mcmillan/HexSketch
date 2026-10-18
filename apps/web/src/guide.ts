/**
 * The getting-started guide: a few short pages, shown once the first time
 * HexSketch opens and afterwards from File > Getting Started Guide. Copy and
 * paste with Word, PowerPoint, Google Docs and Slides gets its own page,
 * marked as the thing to know.
 */
const SEEN_KEY = 'hexsketch.guideSeen';

const key = (k: string) => `<kbd>${k}</kbd>`;
/** A shortcut both ways: Mac first, then Windows (⌘C / Ctrl+C). */
const both = (k: string) => `${key(`⌘${k}`)} / ${key(`Ctrl+${k}`)}`;

/** The round trip, drawn: HexSketch on the left, the document on the right, a copy/paste arrow each way. */
const ROUND_TRIP_ART = `
<svg class="guide-art" viewBox="0 0 360 120" role="img" aria-label="Copy in HexSketch and paste in your document; copy the picture there and paste it back">
  <defs><marker id="gArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>
  <rect x="6" y="16" width="120" height="88" rx="10" class="ga-box"/>
  <text x="66" y="36" class="ga-title">HexSketch</text>
  <g class="ga-mol" transform="translate(66 70)"><path d="M0,-20 L17.3,-10 L17.3,10 L0,20 L-17.3,10 L-17.3,-10 Z"/><path d="M-12.5,-6.5 L-12.5,6.5 M12.5,-6.5 L0,-14 M12.5,6.5 L0,14"/></g>
  <rect x="234" y="16" width="120" height="88" rx="10" class="ga-box"/>
  <text x="294" y="36" class="ga-title">Word · Slides</text>
  <rect x="254" y="48" width="80" height="44" rx="4" class="ga-pic"/>
  <g class="ga-mol" transform="translate(294 70) scale(0.8)"><path d="M0,-20 L17.3,-10 L17.3,10 L0,20 L-17.3,10 L-17.3,-10 Z"/><path d="M-12.5,-6.5 L-12.5,6.5 M12.5,-6.5 L0,-14 M12.5,6.5 L0,14"/></g>
  <path d="M136,48 C170,36 196,36 226,48" class="ga-arrow" marker-end="url(#gArrow)"/>
  <text x="180" y="30" class="ga-key">copy → paste</text>
  <path d="M226,78 C196,90 170,90 136,78" class="ga-arrow" marker-end="url(#gArrow)"/>
  <text x="180" y="108" class="ga-key">copy → paste</text>
</svg>`;

/** Three fused hexagons, drawn as if sketched. */
const WELCOME_ART = `
<svg class="guide-art guide-hero" viewBox="0 0 200 92" aria-hidden="true">
  <g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M40,26 L60,14.5 L80,26 L80,49 L60,60.5 L40,49 Z"/>
    <path d="M80,26 L100,14.5 L120,26 L120,49 L100,60.5 L80,49"/>
    <path d="M120,26 L140,14.5 L160,26 L160,49 L140,60.5 L120,49"/>
    <path d="M46,30 L46,45 M74,30 L60,22 M74,45 L60,53" stroke-width="1.6" opacity="0.6"/>
  </g>
  <path d="M152,70 L178,44 L184,50 L158,76 L150,78 Z" fill="#ffd27a" stroke="#1d1d1f" stroke-width="1.4" stroke-linejoin="round"/>
  <path d="M150,78 L152,70 L158,76 Z" fill="#1d1d1f"/>
</svg>`;

const PAGES: { title: string; badge?: string; html: string }[] = [
  {
    title: 'Welcome to HexSketch',
    html: `${WELCOME_ART}<p>Draw chemical structures the way you would in ChemDraw: the same tools, the same clicks and the same keyboard shortcuts.</p>
      <p>Everything runs in your browser. Your drawings stay on your computer.</p>
      <p class="guide-muted">This guide takes a minute. Reopen it any time from <b>File › Getting Started Guide</b>.</p>`,
  },
  {
    title: 'Copy and paste into Word, PowerPoint and Google',
    badge: 'Most important',
    html: `${ROUND_TRIP_ART}
      <ol>
        <li><b>Into your document:</b> select the structure, press ${both('C')}, then ${both('V')} in Word, PowerPoint, Google Docs or Slides.</li>
        <li><b>Back to edit it:</b> click the picture in your document, ${both('C')}, then ${both('V')} in HexSketch. It comes back as an editable structure.</li>
        <li><b>Done editing:</b> copy again and paste it back into your document.</li>
      </ol>
      <p class="guide-tip"><b>Tip:</b> if a picture from Word pastes back as a plain image, triple-click beside it in Word so its whole line is selected, then copy and paste again.</p>`,
  },
  {
    title: 'Drawing',
    html: `<ul>
        <li><b>Click</b> to draw a bond. Click an atom to grow a chain; drag to choose the direction.</li>
        <li>Pick <b>rings</b>, arrows, text and shapes from the toolbar on the left.</li>
        <li><b>Hover over an atom and type</b> a letter to label it (${key('o')} O, ${key('n')} N, ${key('b')} Br, ${key('m')} Me…), or a number to sprout bonds and rings from it, as in ChemDraw.</li>
        <li>Double-click an atom to type any label, such as CO<sub>2</sub>Me or OTBS.</li>
        <li>${both('Z')} undoes, ${both('A')} selects everything, and ${key('⌥ Option')} / ${key('Alt')}-drag copies a selection.</li>
      </ul>`,
  },
  {
    title: 'Right-click for everything',
    html: `<p>Select a structure and <b>right-click</b> it:</p>
      <ul>
        <li><b>Analysis</b> writes the name, formula and molecular weight under the structure, and keeps them up to date as you edit.</li>
        <li><b>Export</b> saves just the selection as PNG, SVG, PDF, CDXML (opens in ChemDraw) or MOL.</li>
        <li>Expand labels, clean up, colour, highlight, group, align and flip.</li>
      </ul>`,
  },
  {
    title: 'Make it yours',
    html: `<ul>
        <li><b>File › Drawing Settings</b>: bond length, line widths, fonts and styles such as ACS Document 1996. Save your own style for new documents.</li>
        <li><b>File › Document Settings</b>: page size (A4, Letter or a slide), orientation, rulers and grid.</li>
        <li><b>File › Send Feedback</b>: tell us what to fix or add next. We read every message.</li>
      </ul>`,
  },
];

export function guideSeen(): boolean {
  try { return localStorage.getItem(SEEN_KEY) === '1'; } catch { return true; }
}

/** Open the guide; resolves when it is closed. Closing it, however, marks it as seen. */
export function openGuide(start = 0): Promise<void> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'guide';
    dlg.setAttribute('aria-label', 'Getting started with HexSketch');
    let page = Math.max(0, Math.min(PAGES.length - 1, start));
    const show = () => {
      const p = PAGES[page]!;
      dlg.innerHTML = `
        <button type="button" class="guide-close" aria-label="Close">×</button>
        <div class="guide-body">
          ${p.badge ? `<span class="guide-badge">${p.badge}</span>` : ''}
          <h2>${p.title}</h2>
          ${p.html}
        </div>
        <div class="guide-foot">
          <div class="guide-dots">${PAGES.map((_, i) => `<button type="button" data-page="${i}" aria-label="Page ${i + 1}" class="${i === page ? 'on' : ''}"></button>`).join('')}</div>
          <div class="guide-nav">
            ${page > 0 ? '<button type="button" class="guide-back">Back</button>' : '<button type="button" class="guide-skip">Skip</button>'}
            <button type="button" class="guide-next">${page < PAGES.length - 1 ? 'Next' : 'Start drawing'}</button>
          </div>
        </div>`;
      dlg.querySelector('.guide-close')!.addEventListener('click', done);
      dlg.querySelector('.guide-skip')?.addEventListener('click', done);
      dlg.querySelector('.guide-back')?.addEventListener('click', () => { page--; show(); });
      dlg.querySelector('.guide-next')!.addEventListener('click', () => { if (page < PAGES.length - 1) { page++; show(); } else done(); });
      for (const d of Array.from(dlg.querySelectorAll<HTMLButtonElement>('[data-page]'))) d.addEventListener('click', () => { page = Number(d.dataset.page); show(); });
      dlg.querySelector<HTMLButtonElement>('.guide-next')!.focus();
    };
    function done() {
      try { localStorage.setItem(SEEN_KEY, '1'); } catch { /* private window: it may show again next time */ }
      dlg.close();
      dlg.remove();
      resolve();
    }
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(); });
    dlg.addEventListener('keydown', (e) => {
      e.stopPropagation(); // keys here are not drawing hotkeys
      if (e.key === 'ArrowRight' && page < PAGES.length - 1) { page++; show(); }
      if (e.key === 'ArrowLeft' && page > 0) { page--; show(); }
    });
    document.body.append(dlg);
    show();
    dlg.showModal();
  });
}
