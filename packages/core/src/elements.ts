/**
 * Periodic table data.
 *
 * Standard atomic weights follow IUPAC 2021 (Pure Appl. Chem. 94, 573-600).
 * Where IUPAC publishes an interval (e.g. carbon 12.0096-12.0116) we use the
 * conventional single value, which is what ChemDraw and every other structure
 * editor reports. Monoisotopic masses are the mass of the most abundant
 * stable isotope, used for exact-mass readouts.
 */

export interface ElementData {
  readonly z: number;
  readonly symbol: string;
  readonly name: string;
  /** Standard atomic weight, u. null for elements with no stable isotope. */
  readonly weight: number | null;
  /** Mass of the most abundant (or longest-lived) isotope, u. */
  readonly monoisotopic: number;
  /** Valences the neutral atom will satisfy with implicit hydrogen, in order of preference. */
  readonly valences: readonly number[];
  /** Covalent radius in pm, used for bond-length sanity checks on imported files. */
  readonly covalentRadius: number;
}

// prettier-ignore
const TABLE: readonly (readonly [number, string, string, number | null, number, readonly number[], number])[] = [
  [1,  'H',  'Hydrogen',     1.008,     1.0078250319, [1],        31],
  [2,  'He', 'Helium',       4.002602,  4.0026032497, [0],        28],
  [3,  'Li', 'Lithium',      6.94,      7.0160034366, [1],       128],
  [4,  'Be', 'Beryllium',    9.0121831, 9.0121830700, [2],        96],
  [5,  'B',  'Boron',       10.81,     11.0093053600, [3],        84],
  [6,  'C',  'Carbon',      12.011,    12.0000000000, [4],        76],
  [7,  'N',  'Nitrogen',    14.007,    14.0030740044, [3],        71],
  [8,  'O',  'Oxygen',      15.999,    15.9949146196, [2],        66],
  [9,  'F',  'Fluorine',    18.998403163, 18.9984031627, [1],     57],
  [10, 'Ne', 'Neon',        20.1797,   19.9924401762, [0],        58],
  [11, 'Na', 'Sodium',      22.98976928, 22.9897692820, [1],     166],
  [12, 'Mg', 'Magnesium',   24.305,    23.9850417000, [2],       141],
  [13, 'Al', 'Aluminium',   26.9815384, 26.9815385300, [3],      121],
  [14, 'Si', 'Silicon',     28.085,    27.9769265347, [4],       111],
  [15, 'P',  'Phosphorus',  30.973761998, 30.9737619984, [3, 5], 107],
  [16, 'S',  'Sulfur',      32.06,     31.9720711744, [2, 4, 6], 105],
  [17, 'Cl', 'Chlorine',    35.45,     34.9688527000, [1],       102],
  [18, 'Ar', 'Argon',       39.95,     39.9623831237, [0],       106],
  [19, 'K',  'Potassium',   39.0983,   38.9637064864, [1],       203],
  [20, 'Ca', 'Calcium',     40.078,    39.9625909800, [2],       176],
  [21, 'Sc', 'Scandium',    44.955907, 44.9559080000, [3],       170],
  [22, 'Ti', 'Titanium',    47.867,    47.9479410000, [4],       160],
  [23, 'V',  'Vanadium',    50.9415,   50.9439570000, [5],       153],
  [24, 'Cr', 'Chromium',    51.9961,   51.9405060000, [3, 6],    139],
  [25, 'Mn', 'Manganese',   54.938043, 54.9380439000, [2, 4, 7], 139],
  [26, 'Fe', 'Iron',        55.845,    55.9349363000, [2, 3],    132],
  [27, 'Co', 'Cobalt',      58.933194, 58.9331943000, [2, 3],    126],
  [28, 'Ni', 'Nickel',      58.6934,   57.9353424000, [2],       124],
  [29, 'Cu', 'Copper',      63.546,    62.9295977000, [1, 2],    132],
  [30, 'Zn', 'Zinc',        65.38,     63.9291420000, [2],       122],
  [31, 'Ga', 'Gallium',     69.723,    68.9255735000, [3],       122],
  [32, 'Ge', 'Germanium',   72.630,    73.9211777600, [4],       120],
  [33, 'As', 'Arsenic',     74.921595, 74.9215945000, [3, 5],    119],
  [34, 'Se', 'Selenium',    78.971,    79.9165218000, [2, 4, 6], 120],
  [35, 'Br', 'Bromine',     79.904,    78.9183376000, [1],       120],
  [36, 'Kr', 'Krypton',     83.798,    83.9114977282, [0],       116],
  [37, 'Rb', 'Rubidium',    85.4678,   84.9117897380, [1],       220],
  [38, 'Sr', 'Strontium',   87.62,     87.9056125000, [2],       195],
  [39, 'Y',  'Yttrium',     88.905838, 88.9058403000, [3],       190],
  [40, 'Zr', 'Zirconium',   91.224,    89.9046977000, [4],       175],
  [41, 'Nb', 'Niobium',     92.90637,  92.9063730000, [5],       164],
  [42, 'Mo', 'Molybdenum',  95.95,     97.9540482000, [6],       154],
  [43, 'Tc', 'Technetium',  null,      97.9072124000, [7],       147],
  [44, 'Ru', 'Ruthenium',  101.07,    101.9043441000, [3, 4],    146],
  [45, 'Rh', 'Rhodium',    102.90549, 102.9054980000, [3],       142],
  [46, 'Pd', 'Palladium',  106.42,    105.9034804000, [2, 4],    139],
  [47, 'Ag', 'Silver',     107.8682,  106.9050916000, [1],       145],
  [48, 'Cd', 'Cadmium',    112.414,   113.9033651000, [2],       144],
  [49, 'In', 'Indium',     114.818,   114.9038787800, [3],       142],
  [50, 'Sn', 'Tin',        118.710,   119.9022016000, [2, 4],    139],
  [51, 'Sb', 'Antimony',   121.760,   120.9038120000, [3, 5],    139],
  [52, 'Te', 'Tellurium',  127.60,    129.9062227480, [2, 4, 6], 138],
  [53, 'I',  'Iodine',     126.90447, 126.9044719000, [1],       139],
  [54, 'Xe', 'Xenon',      131.293,   131.9041550856, [0],       140],
  [55, 'Cs', 'Caesium',    132.90545196, 132.9054519610, [1],    244],
  [56, 'Ba', 'Barium',     137.327,   137.9052470000, [2],       215],
  [57, 'La', 'Lanthanum',  138.90547, 138.9063563000, [3],       207],
  [58, 'Ce', 'Cerium',     140.116,   139.9054431000, [3, 4],    204],
  [59, 'Pr', 'Praseodymium', 140.90766, 140.9076576000, [3],     203],
  [60, 'Nd', 'Neodymium',  144.242,   141.9077290000, [3],       201],
  [61, 'Pm', 'Promethium', null,      144.9127559000, [3],       199],
  [62, 'Sm', 'Samarium',   150.36,    151.9197397000, [2, 3],    198],
  [63, 'Eu', 'Europium',   151.964,   152.9212380000, [2, 3],    198],
  [64, 'Gd', 'Gadolinium', 157.25,    157.9241123000, [3],       196],
  [65, 'Tb', 'Terbium',    158.925354, 158.9253547000, [3],      194],
  [66, 'Dy', 'Dysprosium', 162.500,   163.9291819000, [3],       192],
  [67, 'Ho', 'Holmium',    164.930329, 164.9303288000, [3],      192],
  [68, 'Er', 'Erbium',     167.259,   165.9302995000, [3],       189],
  [69, 'Tm', 'Thulium',    168.934219, 168.9342179000, [3],      190],
  [70, 'Yb', 'Ytterbium',  173.045,   173.9388664000, [2, 3],    187],
  [71, 'Lu', 'Lutetium',   174.9668,  174.9407752000, [3],       187],
  [72, 'Hf', 'Hafnium',    178.486,   179.9465570000, [4],       175],
  [73, 'Ta', 'Tantalum',   180.94788, 180.9479958000, [5],       170],
  [74, 'W',  'Tungsten',   183.84,    183.9509309000, [6],       162],
  [75, 'Re', 'Rhenium',    186.207,   186.9557501000, [7],       151],
  [76, 'Os', 'Osmium',     190.23,    191.9614770000, [4],       144],
  [77, 'Ir', 'Iridium',    192.217,   192.9629216000, [3, 4],    141],
  [78, 'Pt', 'Platinum',   195.084,   194.9647917000, [2, 4],    136],
  [79, 'Au', 'Gold',       196.966570, 196.9665688000, [1, 3],   136],
  [80, 'Hg', 'Mercury',    200.592,   201.9706434000, [1, 2],    132],
  [81, 'Tl', 'Thallium',   204.38,    204.9744278000, [1, 3],    145],
  [82, 'Pb', 'Lead',       207.2,     207.9766525000, [2, 4],    146],
  [83, 'Bi', 'Bismuth',    208.98040, 208.9803991000, [3, 5],    148],
  [84, 'Po', 'Polonium',   null,      208.9824308000, [2, 4],    140],
  [85, 'At', 'Astatine',   null,      209.9871479000, [1],       150],
  [86, 'Rn', 'Radon',      null,      222.0175782000, [0],       150],
  [87, 'Fr', 'Francium',   null,      223.0197360000, [1],       260],
  [88, 'Ra', 'Radium',     null,      226.0254103000, [2],       221],
  [89, 'Ac', 'Actinium',   null,      227.0277523000, [3],       215],
  [90, 'Th', 'Thorium',    232.0377,  232.0380558000, [4],       206],
  [91, 'Pa', 'Protactinium', 231.03588, 231.0358842000, [5],     200],
  [92, 'U',  'Uranium',    238.02891, 238.0507884000, [6],       196],
];

export const ELEMENTS: readonly ElementData[] = TABLE.map(
  ([z, symbol, name, weight, monoisotopic, valences, covalentRadius]) => ({
    z, symbol, name, weight, monoisotopic, valences, covalentRadius,
  }),
);

const BY_SYMBOL = new Map<string, ElementData>(ELEMENTS.map((e) => [e.symbol, e]));
const BY_Z = new Map<number, ElementData>(ELEMENTS.map((e) => [e.z, e]));

export function elementBySymbol(symbol: string): ElementData | undefined {
  return BY_SYMBOL.get(symbol);
}

export function elementByNumber(z: number): ElementData | undefined {
  return BY_Z.get(z);
}

export function isElementSymbol(symbol: string): boolean {
  return BY_SYMBOL.has(symbol);
}

/**
 * Hill-notation comparator.
 *
 * With carbon present the order is C, then H, then the rest alphabetically.
 * With no carbon in the formula every symbol is ordered alphabetically,
 * hydrogen included, which is why borohydride is written BH4 and not H4B.
 */
export function hillOrder(hasCarbon: boolean): (a: string, b: string) => number {
  return (a, b) => {
    if (a === b) return 0;
    if (hasCarbon) {
      if (a === 'C') return -1;
      if (b === 'C') return 1;
      if (a === 'H') return -1;
      if (b === 'H') return 1;
    }
    return a < b ? -1 : 1;
  };
}
