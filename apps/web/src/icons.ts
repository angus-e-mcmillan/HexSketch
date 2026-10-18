/** Tool icons, drawn for HexSketch (24x24, currentColor). */
const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const ICONS: Record<string, string> = {
  marquee: svg('<rect x="4" y="5" width="16" height="14" stroke-dasharray="2.2 2"/>'),
  lasso: svg('<path d="M12 5c4.5 0 8 2 8 5s-3.5 5-8 5-8-2-8-5 3.5-5 8-5z" stroke-dasharray="2.2 2"/><path d="M8 14.5c-.8 2 .2 4 2 4.5"/>'),
  single: svg('<path d="M5 18L19 6"/>'),
  double: svg('<path d="M4.5 16.5L17.5 5.5M7 19.5l13-11"/>'),
  triple: svg('<path d="M4 15L16 5M6 18L18 8M8 21l12-10"/>'),
  dashed: svg('<path d="M5 18L19 6" stroke-dasharray="2.4 2.2"/>'),
  hash: svg('<path d="M7 17l-1.2-1.4M10 15.2l-2-2.4M13 13.4l-2.8-3.4M16 11.6l-3.6-4.3M19 9.8l-4.4-5.2" stroke-width="1.3"/>'),
  wedge: `<svg viewBox="0 0 24 24"><path d="M5 18L17.2 4.6 20.2 7.6Z" fill="currentColor"/></svg>`,
  bold: svg('<path d="M5 18L19 6" stroke-width="4" stroke-linecap="butt"/>'),
  wavy: svg('<path d="M4 18c1.5-2.8 3.5.2 5-2.2s3.5.2 5-2.2 3.5.2 5-2.2"/>'),
  chain: svg('<path d="M3 15l4.5-6 4.5 6 4.5-6 4.5 6"/>'),
  eraser: svg('<path d="M14.5 4.5l5 5-9 9h-5l-2.5-2.5z"/><path d="M9.5 9.5l5 5"/><path d="M11 20h9"/>'),
  text: `<svg viewBox="0 0 24 24"><text x="12" y="17.5" text-anchor="middle" font-family="Helvetica, Arial" font-weight="700" font-size="15" fill="currentColor">A</text></svg>`,
  ring3: svg('<path d="M12 5l7 12H5z"/>'),
  ring4: svg('<rect x="5.5" y="5.5" width="13" height="13"/>'),
  ring5: svg('<path d="M12 4l7.6 5.5-2.9 8.9H7.3L4.4 9.5z"/>'),
  ring6: svg('<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z"/>'),
  ring7: svg('<path d="M12 3.6l6.6 3.2 1.6 7.1-4.6 5.7H8.4l-4.6-5.7 1.6-7.1z"/>'),
  ring8: svg('<path d="M8.6 3.8h6.8l4.8 4.8v6.8l-4.8 4.8H8.6l-4.8-4.8V8.6z"/>'),
  benzene: svg('<path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z"/><path d="M6.8 8.9v6.2M12 18.2l5.3-3M12 5.8l5.3 3"/>'),
  arrow: `<svg viewBox="0 0 24 24"><path d="M3 12h13" stroke="currentColor" stroke-width="1.6"/><path d="M21 12l-6.5 3.6 1.2-3.6-1.2-3.6z" fill="currentColor"/></svg>`,
  equilibrium: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 10h14.5v-1.4l3.5 1.9H3z"/><path d="M21 14H6.5v1.4L3 13.5h18z"/></svg>`,
  resonance: `<svg viewBox="0 0 24 24"><path d="M7 12h10" stroke="currentColor" stroke-width="1.6"/><path d="M21 12l-5.5 3.2 1-3.2-1-3.2zM3 12l5.5-3.2-1 3.2 1 3.2z" fill="currentColor"/></svg>`,
  cp: svg('<path d="M12 4l7.6 5.5-2.9 8.9H7.3L4.4 9.5z"/><path d="M6.6 10.2l2 6.2M17.4 10.2l-2 6.2"/>'),
};
