/**
 * Advance widths and vertical metrics for label fonts, in 1/1000 em.
 *
 * Values are from the Adobe Core 14 AFM files (Helvetica, Times, Courier),
 * which Adobe distributes freely. Arial, Times New Roman and Courier New were
 * designed metric-compatible with them, so the same tables serve those.
 */
export interface FontMetrics {
  widths: Record<string, number>;
  capHeight: number;
  xHeight: number;
  ascender: number;
  descender: number;
  defaultWidth: number;
}

const COMMON = { '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, '(': 333, ')': 333, '+': 584, '-': 333, ' ': 278, '•': 350, '*': 389, ',': 278, '.': 278, '/': 278, '\\': 278, '<': 584, '=': 584, '>': 584, '~': 584, '`': 333, '%': 889, '−': 584, '·': 278, '°': 400, '–': 556, '—': 1000 };

const HELVETICA: FontMetrics = {
  widths: {
    ...COMMON,
    '!': 278, '"': 355, '&': 667, "'": 191, ':': 278, ';': 278, '?': 556, '@': 1015, '[': 278, ']': 278, '^': 469, '{': 334, '|': 260, '}': 334, '#': 556, '$': 556, '_': 556,
    A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
    N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
    n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
  },
  capHeight: 718, xHeight: 523, ascender: 718, descender: -207, defaultWidth: 556,
};

const HELVETICA_BOLD: FontMetrics = {
  widths: {
    ...COMMON,
    '!': 333, '"': 474, '&': 722, "'": 238, ':': 333, ';': 333, '?': 611, '@': 975, '[': 333, ']': 333, '^': 584, '{': 389, '|': 280, '}': 389, '#': 556, '$': 556, '_': 556,
    A: 722, B: 722, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 556, K: 722, L: 611, M: 833,
    N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
    a: 556, b: 611, c: 556, d: 611, e: 556, f: 333, g: 611, h: 611, i: 278, j: 278, k: 556, l: 278, m: 889,
    n: 611, o: 611, p: 611, q: 611, r: 389, s: 556, t: 333, u: 611, v: 556, w: 778, x: 556, y: 556, z: 500,
  },
  capHeight: 718, xHeight: 532, ascender: 718, descender: -207, defaultWidth: 611,
};


/** Times-Roman and Times-Bold (Adobe Core 14 AFM), for captions in Times or Times New Roman (metric-compatible). */
const TIMES: FontMetrics = {
  widths: {
    " ": 250, "!": 333, "\"": 408, "#": 500, "$": 500, "%": 833, "&": 778, "'": 333, "(": 333, ")": 333, "*": 500, "+": 564, ",": 250, "-": 333,
    ".": 250, "/": 278, "0": 500, "1": 500, "2": 500, "3": 500, "4": 500, "5": 500, "6": 500, "7": 500, "8": 500, "9": 500, ":": 278, ";": 278,
    "<": 564, "=": 564, ">": 564, "?": 444, "@": 921, "A": 722, "B": 667, "C": 667, "D": 722, "E": 611, "F": 556, "G": 722, "H": 722, "I": 333,
    "J": 389, "K": 722, "L": 611, "M": 889, "N": 722, "O": 722, "P": 556, "Q": 722, "R": 667, "S": 556, "T": 611, "U": 722, "V": 722, "W": 944,
    "X": 722, "Y": 722, "Z": 611, "[": 333, "\\": 278, "]": 333, "^": 469, "_": 500, "`": 333, "a": 444, "b": 500, "c": 444, "d": 500, "e": 444,
    "f": 333, "g": 500, "h": 500, "i": 278, "j": 278, "k": 500, "l": 278, "m": 778, "n": 500, "o": 500, "p": 500, "q": 500, "r": 333, "s": 389,
    "t": 278, "u": 500, "v": 500, "w": 722, "x": 500, "y": 500, "z": 444, "{": 480, "|": 200, "}": 480, "~": 541,
  },
  capHeight: 662, xHeight: 450, ascender: 683, descender: -217, defaultWidth: 500,
};

const TIMES_BOLD: FontMetrics = {
  widths: {
    " ": 250, "!": 333, "\"": 555, "#": 500, "$": 500, "%": 1000, "&": 833, "'": 333, "(": 333, ")": 333, "*": 500, "+": 570, ",": 250, "-": 333,
    ".": 250, "/": 278, "0": 500, "1": 500, "2": 500, "3": 500, "4": 500, "5": 500, "6": 500, "7": 500, "8": 500, "9": 500, ":": 333, ";": 333,
    "<": 570, "=": 570, ">": 570, "?": 500, "@": 930, "A": 722, "B": 667, "C": 722, "D": 722, "E": 667, "F": 611, "G": 778, "H": 778, "I": 389,
    "J": 500, "K": 778, "L": 667, "M": 944, "N": 722, "O": 778, "P": 611, "Q": 778, "R": 722, "S": 556, "T": 667, "U": 722, "V": 722, "W": 1000,
    "X": 722, "Y": 722, "Z": 667, "[": 333, "\\": 278, "]": 333, "^": 581, "_": 500, "`": 333, "a": 500, "b": 556, "c": 444, "d": 556, "e": 444,
    "f": 333, "g": 500, "h": 556, "i": 278, "j": 333, "k": 556, "l": 278, "m": 833, "n": 556, "o": 500, "p": 556, "q": 556, "r": 444, "s": 389,
    "t": 333, "u": 556, "v": 500, "w": 722, "x": 500, "y": 500, "z": 444, "{": 394, "|": 220, "}": 394, "~": 520,
  },
  capHeight: 676, xHeight: 461, ascender: 676, descender: -205, defaultWidth: 500,
};

/** Courier and Courier New: every character 600/1000 em. */
const COURIER: FontMetrics = { widths: {}, capHeight: 562, xHeight: 426, ascender: 629, descender: -157, defaultWidth: 600 };
const COURIER_BOLD: FontMetrics = { ...COURIER, capHeight: 562, xHeight: 439 };

/** Caption fonts offered in the text bar; any other name is measured as Helvetica. */
export const CAPTION_FONTS = ['Helvetica', 'Arial', 'Times New Roman', 'Courier New'] as const;

export type FontFamily = 'helvetica' | 'times' | 'courier';
/** The metric family of a font name (Arial measures as Helvetica, Times New Roman as Times). */
export function fontFamily(name?: string | null): FontFamily {
  if (name && /times|georgia|serif$/i.test(name) && !/sans/i.test(name)) return 'times';
  if (name && /courier|mono/i.test(name)) return 'courier';
  return 'helvetica';
}

export function fontMetrics(bold: boolean, font?: string | null): FontMetrics {
  const fam = fontFamily(font);
  if (fam === 'times') return bold ? TIMES_BOLD : TIMES;
  if (fam === 'courier') return bold ? COURIER_BOLD : COURIER;
  return bold ? HELVETICA_BOLD : HELVETICA;
}

export function textWidth(text: string, size: number, bold: boolean, font?: string | null): number {
  const m = fontMetrics(bold, font);
  let w = 0;
  for (const ch of text) w += m.widths[ch] ?? m.defaultWidth;
  return (w * size) / 1000;
}

/**
 * Ink bounding boxes (AFM "B" values, 1/1000 em) for round capitals. ChemDraw
 * clips bonds to the glyph outline rather than its advance box, which matters
 * for O and C where a diagonal bond would otherwise stop visibly short. The
 * bold bottom overshoot is -28 rather than the AFM's -19: that is where
 * ChemDraw's clip of a vertical bond into O lands.
 */
const ROUND_INK: Record<'regular' | 'bold', Record<string, [number, number, number, number]>> = {
  regular: { O: [39, -19, 739, 737], C: [44, -19, 681, 737], G: [48, -19, 704, 737], Q: [39, -56, 739, 737] },
  bold: { O: [44, -28, 734, 737], C: [44, -28, 684, 737], G: [44, -28, 713, 737], Q: [44, -52, 748, 737] },
};

export function roundInk(ch: string, bold: boolean): [number, number, number, number] | undefined {
  return ROUND_INK[bold ? 'bold' : 'regular'][ch];
}
