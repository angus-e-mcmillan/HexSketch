import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { payloadFromPng } from '@hexsketch/core';
import { main } from '../src/cli.ts';

const ASPIRIN = 'CC(=O)Oc1ccccc1C(=O)O';
const dir = mkdtempSync(join(tmpdir(), 'hexsketch-cli-'));

async function run(...argv: string[]): Promise<{ code: number; out: string }> {
  let out = '';
  const code = await main(argv, (s) => { out += s; });
  return { code, out };
}

test('analyze prints name, SMILES, formula and masses; --json for machines', async () => {
  const text = await run('analyze', ASPIRIN);
  assert.equal(text.code, 0);
  assert.match(text.out, /^Name: 2-acetoxybenzoic acid\nSMILES: \S+\nFormula: C9H8O4\nExact mass: 180\.0423\nMolecular weight: 180\.16\n/);
  const json = JSON.parse((await run('analyze', ASPIRIN, '--json')).out);
  assert.equal(json.formula, 'C9H8O4');
  assert.equal(json.name, '2-acetoxybenzoic acid');
});

test('render writes SVG to standard output, files by extension', async () => {
  const svg = await run('render', ASPIRIN);
  assert.equal(svg.code, 0);
  assert.match(svg.out, /^<svg[\s\S]*<\/svg>\n$/);
  const pdf = join(dir, 'a.pdf');
  assert.equal((await run('render', ASPIRIN, '-o', pdf)).code, 0);
  assert.equal(readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
  assert.equal((await run('render', ASPIRIN, '--format', 'pdf')).code, 2); // binary needs -o
  assert.equal((await run('render', ASPIRIN, '-o', join(dir, 'a.gif'))).code, 2);
});

test('PNG comes out drawn and editable, and reads back in', async () => {
  const png = join(dir, 'phe.png');
  const r = await run('render', 'N[C@@H](Cc1ccccc1)C(=O)O', '-o', png, '--json');
  assert.equal(r.code, 0);
  assert.equal(JSON.parse(r.out).mediaType, 'image/png');
  const bytes = readFileSync(png);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  assert.ok(bytes.length > 5000, `${bytes.length} bytes: drawn, not blank`);
  assert.match(payloadFromPng(new Uint8Array(bytes)) ?? '', /HexSketch:1:/);
  assert.equal((await run('name', png)).out, 'L-phenylalanine\n');
  const plain = join(dir, 'plain.png');
  writeFileSync(plain, bytes.subarray(0, 33)); // a PNG header with no structure
  assert.equal((await run('name', plain)).code, 2);
});

test('validate and compare report through the exit code', async () => {
  const bad = await run('validate', 'C(C)(C)(C)(C)C');
  assert.equal(bad.code, 1);
  assert.match(bad.out, /^Problems found\nerror: C \(atom 1\) has valence 5/);
  assert.equal((await run('validate', ASPIRIN)).code, 0);
  assert.equal(JSON.parse((await run('validate', 'aspirin', '--json')).out).ok, false);
  assert.equal((await run('compare', 'C[C@H](N)C(=O)O', 'N[C@@H](C)C(=O)O')).code, 0);
  const enantiomers = await run('compare', 'C[C@H](N)C(=O)O', 'C[C@@H](N)C(=O)O');
  assert.equal(enantiomers.code, 1);
  assert.match(enantiomers.out, /^Same compound, different stereochemistry/);
});

test('convert, link and name', async () => {
  assert.equal((await run('convert', 'C[C@H](N)C(=O)O', '--to', 'smiles')).out, 'C[C@H](N)C(=O)O\n');
  assert.match((await run('convert', ASPIRIN, '--to', 'mol')).out, /V2000/);
  assert.equal((await run('link', 'CC#N')).out, 'https://hexsketch.com/#smiles=CC%23N\n');
  assert.equal((await run('link', 'CCO', '--base', 'http://localhost:5174/')).out, 'http://localhost:5174/#smiles=CCO\n');
  assert.equal((await run('name', 'C[C@H](N)C(=O)O')).out, '(S)-2-aminopropanoic acid\n');
  const molfile = join(dir, 'a.mol');
  writeFileSync(molfile, (await run('convert', ASPIRIN, '--to', 'mol')).out);
  assert.equal((await run('name', molfile)).out, '2-acetoxybenzoic acid\n');
});

test('usage errors exit 2', async () => {
  assert.equal((await run()).code, 2);
  assert.equal((await run('frobnicate', 'CCO')).code, 2);
  assert.equal((await run('name')).code, 2);
  assert.equal((await run('convert', 'CCO')).code, 2);
  assert.equal((await run('render', 'CCO', '--style', 'nature')).code, 2);
  assert.equal(JSON.parse((await run('name', 'C1CC', '--json')).out).error.includes('unclosed ring'), true);
  assert.equal((await run('--version')).out, '0.1.0\n');
  assert.match((await run('--help')).out, /^hexsketch 0\.1\.0/);
});

test('runs as a command, reading standard input', () => {
  const cli = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
  const out = execFileSync(process.execPath, ['--experimental-strip-types', '--no-warnings', cli, 'name', '-'], { input: 'c1ccccc1O\n', encoding: 'utf8' });
  assert.equal(out, 'phenol\n');
});
