/**
 * The HexSketch half of the benchmark: names, 2D layouts (as molfiles) and
 * drawings (SVG) for every structure in structures.tsv, written to
 * tools/bench/out. Run through tools/bench/run.sh.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { convert, name, readStructure, render } from '../../packages/agent/src/index.ts';

const here = new URL('.', import.meta.url);
const out = new URL('out/', here);
for (const dir of ['mol', 'svg']) mkdirSync(new URL(dir, out), { recursive: true });

const [, ...lines] = readFileSync(new URL('structures.tsv', here), 'utf8').trim().split('\n');
const rows = ['n\tname\treason\tms'];
for (const [i, line] of lines.entries()) {
  const smiles = line.split('\t')[3]!;
  const n = i + 1;
  try {
    const s = await readStructure(smiles);
    const t0 = performance.now();
    const r = await name(s);
    const ms = performance.now() - t0;
    rows.push([n, r.name ?? '', (r.reason ?? '').replace(/\s+/g, ' '), ms.toFixed(1)].join('\t'));
    writeFileSync(new URL(`mol/${n}.mol`, out), await convert(s, 'mol'));
    writeFileSync(new URL(`svg/${n}.svg`, out), (await render(s, { to: 'svg' })).data as string);
  } catch (err) {
    rows.push([n, '', `error: ${(err as Error).message}`.replace(/\s+/g, ' '), ''].join('\t'));
  }
  if (n % 200 === 0) console.error(`${n} / ${lines.length}`);
}
writeFileSync(new URL('hexsketch.tsv', out), rows.join('\n') + '\n');
