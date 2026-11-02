import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSmiles } from '../src/smiles.ts';
import { hazardsOf, reagentHazards, screenHazards, type HazardLevel } from '../src/hazards.ts';

/** The worst level found and the titles, for a SMILES. */
const check = (smiles: string) => {
  const found = hazardsOf(parseSmiles(smiles));
  return { worst: found[0]?.level as HazardLevel | undefined, titles: found.map((h) => h.title), found };
};

test('azides are judged by (C + O)/N and the rule of six', () => {
  const methyl = check('CN=[N+]=[N-]');
  assert.equal(methyl.worst, 'danger');
  assert.equal(methyl.found[0]!.detail, '(C + O)/N 0.33, 1 C per group, oxygen balance −98%.');
  assert.equal(check('[N-]=[N+]=NCc1ccccc1').worst, 'warning'); // benzyl azide: 2.33
  assert.equal(check('CCCCCCCCCN=[N+]=[N-]').worst, 'warning'); // nonyl azide passes the rules, but an azide is never just a note
  assert.equal(check('N=[N+]=[N-]').worst, 'danger'); // hydrazoic acid
});

test('nitro compounds: oxygen balance and the rule of six', () => {
  assert.equal(check('Cc1c(cc(cc1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]').worst, 'danger'); // TNT
  assert.equal(check('C[N+](=O)[O-]').worst, 'danger'); // nitromethane
  assert.equal(check('O=[N+]([O-])c1ccccc1').worst, 'note'); // nitrobenzene: OB −162%
  assert.equal(check('O=N(=O)c1ccccc1').worst, 'note'); // written with pentavalent nitrogen
  assert.equal(check('NNc1ccc(cc1[N+](=O)[O-])[N+](=O)[O-]').worst, 'danger'); // 2,4-DNPH, shipped wet
  assert.match(check('C(C(CO[N+](=O)[O-])O[N+](=O)[O-])O[N+](=O)[O-]').titles[0]!, /Likely explosive: nitrate/); // nitroglycerin
});

test('peroxides, diazo compounds and salts', () => {
  assert.equal(check('OO').worst, 'danger'); // hydrogen peroxide
  assert.equal(check('O=C(OOC(=O)c1ccccc1)c1ccccc1').worst, 'warning'); // benzoyl peroxide
  assert.equal(check('CCOC(=O)C=[N+]=[N-]').worst, 'warning'); // ethyl diazoacetate
  assert.deepEqual(check('C=[N+]=[N-]').titles, ['Likely explosive: diazo group', 'Highly toxic: diazomethane']);
  assert.match(check('[Pb+2].[N-]=[N+]=[N-].[N-]=[N+]=[N-]').titles[0]!, /Primary explosive: heavy-metal azide/);
  assert.deepEqual(check('[Na+].[N-]=[N+]=[N-]').titles, ['Toxic: azide salt']); // toxic, not itself explosive
  assert.deepEqual(check('[K+].[O-][N+](=O)[O-]').titles, ['Strong oxidiser: nitrate']);
  assert.equal(check('[NH4+].[O-][N+](=O)[O-]').worst, 'danger'); // ammonium nitrate
});

test('toxic and reactive compounds', () => {
  assert.deepEqual(check('O=C(Cl)Cl').titles, ['Highly toxic: phosgene']);
  assert.deepEqual(check('[Na+].[C-]#N').titles, ['Highly toxic: cyanide']);
  assert.deepEqual(check('CN(C)N=O').titles, ['Toxic: N-nitrosamine']);
  assert.deepEqual(check('CC(C)(C)[Li]').titles, ['Pyrophoric: tert-butyllithium']);
  assert.deepEqual(check('[Na+].[H-]').titles, ['Reactive: sodium hydride']);
  assert.deepEqual(check('c1ccccc1').titles, ['Toxic: benzene']);
  // A nitramine is not also a nitrosamine.
  assert.ok(!check('C1N(CN(CN1[N+](=O)[O-])[N+](=O)[O-])[N+](=O)[O-]').titles.some((t) => t.includes('nitrosamine')));
});

test('ordinary compounds and drugs give no warning', () => {
  for (const smiles of [
    'CC(=O)Oc1ccccc1C(=O)O', // aspirin
    'CC(=O)Nc1ccc(O)cc1', // paracetamol
    'CCCCc1nc(Cl)c(CO)n1Cc1ccc(cc1)-c1ccccc1-c1nn[nH]n1', // losartan: a tetrazole that passes every rule
    'Cc1ccccc1', 'O', 'N', 'NC(N)=O', 'c1ccncc1', '[Na+].OC([O-])=O',
  ]) assert.deepEqual(check(smiles).titles, [], smiles);
});

test('reagents written as text', () => {
  const titles = (text: string) => reagentHazards(text).map((h) => h.title);
  assert.deepEqual(titles('NaHCO3, H2O'), []); // not NaH
  assert.deepEqual(titles('HNO3, H2SO4, 0 °C'), ['Nitration: exothermic']);
  assert.deepEqual(titles('t-BuLi, THF, −78 °C'), ['Pyrophoric reagent']); // not also "BuLi"
  assert.deepEqual(titles('n-BuLi, THF'), ['Organolithium']);
  assert.deepEqual(titles('KCN, DMSO'), ['Cyanide']);
  assert.deepEqual(titles('Pd/C, H2, MeOH'), []);
  assert.deepEqual(titles('TBAF, THF'), []);
});

test('dangerous pairs, each half drawn or written', () => {
  const titles = (smiles: string, text: string) => screenHazards(parseSmiles(smiles), text).map((h) => h.title);
  // NaH with DMF: both written, or NaH drawn and DMF written, or both drawn.
  assert.ok(titles('', 'NaH, DMF, 0 °C').includes('NaH with DMF, DMAc or DMSO'));
  assert.ok(titles('[Na+].[H-]', 'DMSO, rt').includes('NaH with DMF, DMAc or DMSO'));
  assert.ok(titles('[Na+].[H-].CN(C)C=O', '').includes('NaH with DMF, DMAc or DMSO'));
  assert.ok(!titles('', 'NaH, THF').includes('NaH with DMF, DMAc or DMSO'));
  // Azide salts with DCM or chloroform.
  assert.equal(screenHazards(parseSmiles('[Na+].[N-]=[N+]=[N-]'), 'CH2Cl2, rt')[0]!.title, 'Azide salt with DCM or chloroform');
  assert.ok(titles('ClC(Cl)Cl', 'NaN3').includes('Azide salt with DCM or chloroform'));
  assert.ok(titles('', 'NaN3, DCM/H2O, Bu4NBr').includes('Azide salt with DCM or chloroform'));
  // An organic azide in DCM (a click reaction) is not this hazard.
  assert.ok(!titles('[N-]=[N+]=NCc1ccccc1', 'CuI, DCM').includes('Azide salt with DCM or chloroform'));
});

test('routine reagents are notes, not alarms', () => {
  for (const text of ['n-BuLi, THF, −78 °C', 'LiAlH4, THF', 'mCPBA, DCM', 'DEAD, PPh3', 'MeI, K2CO3'])
    assert.ok(reagentHazards(text).every((h) => h.level === 'note'), text);
  assert.equal(check('[Na+].[H-]').worst, 'note');
});

test('process-safety findings from OPRD', () => {
  const titles = (smiles: string, text: string) => screenHazards(parseSmiles(smiles), text).map((h) => h.title);
  // Sulfonyl azides and diazo compounds carry the literature's numbers.
  const tsn3 = check('Cc1ccc(cc1)S(=O)(=O)N=[N+]=[N-]').found[0]!;
  assert.match(tsn3.title, /sulfonyl azide/);
  assert.match(check('CCOC(=O)C(=[N+]=[N-])c1ccccc1').titles[0]!, /diazo group/);
  assert.ok(titles('', 'TsN3, Et3N, MeCN').includes('Sulfonyl azide (diazo transfer)'));
  // Exact compounds.
  assert.ok(check('C[Si](C)(C)C=[N+]=[N-]').titles.includes('Highly toxic: trimethylsilyldiazomethane'));
  assert.deepEqual(check('On1nnc2ccccc21').titles, ['Energetic: HOBt']);
  assert.deepEqual(check('NO').titles, ['Energetic: hydroxylamine']);
  // Pairs, from text or structures.
  assert.ok(titles('', 'HNO3, Ac2O, 0 °C').includes('HNO3 with Ac2O'));
  assert.ok(titles('', 'POCl3, DMF, 80 °C').includes('Vilsmeier reagent (POCl3 with DMF)'));
  assert.ok(titles('', 'SOCl2, DMF (cat.), DCM').includes('SOCl2 or (COCl)2 with DMF'));
  assert.ok(titles('', '(COCl)2, DMSO, then Et3N, −78 °C').includes('Activated DMSO (Swern-type)'));
  // Routine: no flag for Pd/C in methanol or hot DMSO.
  assert.deepEqual(titles('', 'H2, Pd/C, MeOH'), []);
  assert.deepEqual(titles('', 'K2CO3, DMSO, 120 °C'), []);
});
