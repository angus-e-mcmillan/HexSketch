/**
 * Document drawing style, in points (1/72 inch).
 *
 * Field names follow the CDXML document attributes so a style reads and
 * writes straight through to ChemDraw files.
 */
export interface DrawingStyle {
  bondLength: number;
  lineWidth: number;
  boldWidth: number;
  hashSpacing: number;
  /** White margin cleared around atom labels where bonds stop short. */
  marginWidth: number;
  /** Gap between the lines of a double bond, as a percentage of bondLength. */
  bondSpacing: number;
  chainAngle: number;
  labelFont: string;
  labelSize: number;
  labelBold: boolean;
  captionFont: string;
  captionSize: number;
  showTerminalCarbonLabels: boolean;
  hideImplicitHydrogens: boolean;
  /**
   * The document colour table after background and foreground: what
   * ChemDraw's Colors menu lists as "Other # 1..n". '#rrggbb'.
   */
  palette?: readonly string[];
}

/**
 * HexSketch's colour table: a blue-grey, then sage greens, dusty pinks and
 * slate purples, each light to dark. Black is the foreground, so it is not
 * repeated here.
 */
export const HEXSKETCH_PALETTE: readonly string[] = [
  '#e4e9f3',
  '#c8d5cf', '#aabdb5', '#7da192', '#679180', '#4b826c',
  '#ebdde3', '#e2cad3', '#c194a5', '#ad7a8d', '#a6607a',
  '#c9cad7', '#acadbf', '#7e81a4', '#555785',
];

/** The earlier default: muted inks that print well (navy, rust, greys, sand). */
export const MUTED_PALETTE: readonly string[] = [
  '#11102a', '#7e2b0e', '#dddced', '#edeed3', '#393855', '#686783',
  '#a1a0b7', '#dbdaeb', '#86391a', '#ac603c', '#bc815d', '#d7c4a3',
];

export const DEFAULT_PALETTE = HEXSKETCH_PALETTE;

/** Colour tables to choose from (Colors > Palette, Drawing Settings). */
export const PALETTES: readonly { id: string; label: string; colors: readonly string[] }[] = [
  { id: 'hexsketch', label: 'HexSketch', colors: HEXSKETCH_PALETTE },
  { id: 'muted', label: 'Muted inks', colors: MUTED_PALETTE },
];

/** The listed palette a style uses, or null for a custom colour table (from a file). */
export function paletteId(style: DrawingStyle): string | null {
  const key = (c: readonly string[] = []) => c.map((x) => x.toLowerCase()).join(',');
  return PALETTES.find((p) => key(p.colors) === key(style.palette))?.id ?? null;
}

const CM = 72 / 2.54;

/**
 * HexSketch's house style: 0.65 cm bonds, Helvetica Bold 11 labels, given in
 * cm (3 d.p.) and converted to points. Matches ChemDraw documents set up the
 * same way, whose AppleScript properties report twips (1/20 pt): fixed
 * length 369, line 31, bold 48, margin 32. This is the default for every new document.
 */
export const HEXSKETCH_STYLE: Readonly<DrawingStyle> = {
  bondLength: 0.65 * CM,
  lineWidth: 0.054 * CM,
  boldWidth: 0.085 * CM,
  hashSpacing: 0.088 * CM,
  marginWidth: 0.056 * CM,
  bondSpacing: 18,
  chainAngle: 120,
  labelFont: 'Helvetica',
  labelSize: 11,
  labelBold: true,
  captionFont: 'Helvetica',
  captionSize: 10,
  showTerminalCarbonLabels: false,
  hideImplicitHydrogens: false,
  palette: DEFAULT_PALETTE,
};

/** ACS Document 1996 (the values ACS publishes for journal artwork). */
export const ACS_1996_STYLE: Readonly<DrawingStyle> = {
  bondLength: 14.4,
  lineWidth: 0.6,
  boldWidth: 2,
  hashSpacing: 2.5,
  marginWidth: 1.6,
  bondSpacing: 18,
  chainAngle: 120,
  labelFont: 'Arial',
  labelSize: 10,
  labelBold: false,
  captionFont: 'Arial',
  captionSize: 10,
  showTerminalCarbonLabels: false,
  hideImplicitHydrogens: false,
};

export const DEFAULT_STYLE = HEXSKETCH_STYLE;

/** Built-in styles for File > Drawing Settings. */
export const STYLE_PRESETS: readonly { id: string; label: string; style: Readonly<DrawingStyle> }[] = [
  { id: 'hexsketch', label: 'HexSketch', style: HEXSKETCH_STYLE },
  { id: 'acs1996', label: 'ACS Document 1996', style: ACS_1996_STYLE },
];

/** The numbers and switches that make up a style, for comparing two styles (palette aside). */
export const STYLE_FIELDS = [
  'bondLength', 'lineWidth', 'boldWidth', 'hashSpacing', 'marginWidth', 'bondSpacing', 'chainAngle',
  'labelFont', 'labelSize', 'labelBold', 'captionFont', 'captionSize', 'showTerminalCarbonLabels', 'hideImplicitHydrogens',
] as const satisfies readonly (keyof DrawingStyle)[];

export function sameStyle(a: DrawingStyle, b: DrawingStyle): boolean {
  return STYLE_FIELDS.every((k) => (typeof a[k] === 'number' ? Math.abs((a[k] as number) - (b[k] as number)) < 1e-3 : a[k] === b[k]));
}
