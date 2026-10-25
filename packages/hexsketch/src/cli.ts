import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { payloadFromPng } from '@hexsketch/core';
import { analyze, compare, convert, link, name, render, validate, type Analysis, type ConvertFormat, type RenderFormat, type StyleName } from '@hexsketch/agent';
import { rasterize } from './png.ts';
import { createServer } from './mcp.ts';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

/**
 * The hexsketch command. Every command takes a structure as SMILES, a file
 * (molfile, CDXML, or a PNG exported from HexSketch), a HexSketch link, or "-"
 * for standard input. --json prints machine-readable output.
 *
 * Exit codes: 0 done; 1 validate found errors, or compare found a difference;
 * 2 bad usage or unreadable input.
 */

// package.json sits one level up from both src/ and dist/.
const VERSION: string = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')).version;

const HELP = `hexsketch ${VERSION}: chemical structures from the command line (https://hexsketch.com)

Usage: hexsketch <command> <structure> [options]

A structure is SMILES ("CC(=O)Oc1ccccc1C(=O)O"), a file (.mol, .cdxml, or a
.png exported from HexSketch), a HexSketch link, or - for standard input.

Commands:
  render <structure> -o <file>   Draw it: .svg, .png, .pdf, .cdxml or .mol (from the extension)
  name <structure>               IUPAC name
  analyze <structure>            Name, SMILES, formula, masses, elemental analysis, m/z
  convert <structure> --to <f>   smiles, mol, cdxml or link
  validate <structure>           Check it (exit 1 on errors): valence, charges, readable at all
  compare <a> <b>                Same compound and stereoisomer? (exit 1 if not)
  link <structure>               A link that opens it in HexSketch, ready to edit
  mcp                            Run as an MCP server on stdio, for Claude, Codex, Cursor and other AI tools

Options:
  -o, --output <file>    Output file for render (text formats print without it)
  --format <f>           Render format when it can't come from -o: svg, png, pdf, cdxml, mol
  --to <f>               Target for convert
  --style <s>            hexsketch (default) or acs
  --scale <n>            PNG pixels per point (default 4)
  --background <color>   Background colour, e.g. "#ffffff"
  --base <url>           Base URL for links (default https://hexsketch.com/)
  --json                 Machine-readable output
  -h, --help             This help
  -v, --version          Version
`;

class UsageError extends Error {}

function readInput(arg: string | undefined): string {
  if (arg === undefined) throw new UsageError('Give a structure: SMILES, a file, a HexSketch link, or - for standard input');
  if (arg === '-') return readFileSync(0, 'utf8');
  // A path that exists is a file; anything else is the structure itself (SMILES can contain / and \).
  if (existsSync(arg) && statSync(arg).isFile()) {
    const bytes = readFileSync(arg);
    if (extname(arg).toLowerCase() === '.png' || bytes.subarray(1, 4).toString() === 'PNG') {
      const text = payloadFromPng(new Uint8Array(bytes));
      if (!text) throw new UsageError(`${arg} has no HexSketch structure in it`);
      return text;
    }
    return bytes.toString('utf8');
  }
  return arg;
}

/** render_structure's save_to, for the local server: never replaces a file unless asked. */
async function saveFile(path: string, data: string | Uint8Array, overwrite: boolean): Promise<string> {
  const abs = resolve(path);
  if (!overwrite && existsSync(abs)) throw new Error(`${abs} already exists: pass overwrite: true to replace it`);
  if (!existsSync(dirname(abs))) throw new Error(`The folder ${dirname(abs)} does not exist`);
  writeFileSync(abs, data);
  return abs;
}

const fmt = (n: number, d: number) => n.toFixed(d);
function analysisText(a: Analysis): string {
  return [
    a.name ? `Name: ${a.name}` : 'Name: (none generated)',
    `SMILES: ${a.smiles}`,
    `Formula: ${a.formula}`,
    `Exact mass: ${fmt(a.exactMass, 4)}`,
    ...(a.molecularWeight !== null ? [`Molecular weight: ${fmt(a.molecularWeight, 2)}`] : []),
    ...(a.elementalAnalysis ? [`Elemental analysis: ${a.elementalAnalysis}`] : []),
    `m/z: ${a.isotopes.slice(0, 4).map((p) => `${fmt(p.mz, 4)} (${fmt(p.relative, 1)}%)`).join(', ')}`,
  ].join('\n');
}

const RENDER_FORMATS = ['svg', 'png', 'pdf', 'cdxml', 'mol'] as const;
const CONVERT_FORMATS = ['smiles', 'mol', 'cdxml', 'link'] as const;

export async function main(argv: string[], out: (s: string) => void = (s) => process.stdout.write(s)): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        output: { type: 'string', short: 'o' }, format: { type: 'string' }, to: { type: 'string' },
        style: { type: 'string' }, scale: { type: 'string' }, background: { type: 'string' }, base: { type: 'string' },
        json: { type: 'boolean' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
      },
    });
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values: o, positionals: [command, ...rest] } = parsed;
  if (o.version) { out(`${VERSION}\n`); return 0; }
  if (o.help || !command) { out(HELP); return command || o.help ? 0 : 2; }
  const json = (x: unknown) => out(`${JSON.stringify(x, null, 2)}\n`);
  const style = o.style as StyleName | undefined;
  if (style && style !== 'hexsketch' && style !== 'acs') { process.stderr.write(`Unknown style "${style}": use hexsketch or acs\n`); return 2; }
  const read = { ...(style ? { style } : {}) };

  try {
    switch (command) {
      case 'render': {
        const ext = o.output ? extname(o.output).slice(1).toLowerCase() : '';
        const to = (o.format ?? (ext || 'svg')) as RenderFormat;
        if (!RENDER_FORMATS.includes(to as never)) throw new UsageError(`Can't render to "${to}": use ${RENDER_FORMATS.join(', ')}`);
        const scale = o.scale === undefined ? undefined : Number(o.scale);
        if (scale !== undefined && !(scale > 0 && scale <= 20)) throw new UsageError('--scale takes a number from 0 to 20');
        const r = await render(readInput(rest[0]), { ...read, to, rasterize, ...(scale ? { scale } : {}), ...(o.background ? { background: o.background } : {}) });
        if (o.output) {
          writeFileSync(o.output, r.data);
          if (o.json) json({ file: o.output, format: r.format, mediaType: r.mediaType, width: r.width, height: r.height });
          else out(`Wrote ${o.output}\n`);
        } else if (typeof r.data === 'string') {
          out(r.data.endsWith('\n') ? r.data : `${r.data}\n`);
        } else {
          throw new UsageError(`${to.toUpperCase()} is binary: write it to a file with -o drawing.${to}`);
        }
        return 0;
      }
      case 'name': {
        const r = await name(readInput(rest[0]), read);
        if (o.json) json(r);
        else out(`${r.name ?? `(no name: ${r.reason ?? 'outside what HexSketch names'})`}\n`);
        return 0;
      }
      case 'analyze': {
        const r = await analyze(readInput(rest[0]), read);
        if (o.json) json(r);
        else out(`${[analysisText(r), ...r.structures.map((s, i) => `\nStructure ${i + 1}\n${analysisText(s)}`)].join('\n')}\n`);
        return 0;
      }
      case 'convert': {
        const to = o.to as ConvertFormat | undefined;
        if (!to || !CONVERT_FORMATS.includes(to)) throw new UsageError(`convert needs --to ${CONVERT_FORMATS.join('|')}`);
        const r = await convert(readInput(rest[0]), to, { ...read, ...(o.base ? { base: o.base } : {}) });
        if (o.json) json({ format: to, data: r });
        else out(r.endsWith('\n') ? r : `${r}\n`);
        return 0;
      }
      case 'validate': {
        const r = await validate(readInput(rest[0]), read);
        if (o.json) json(r);
        else {
          const lines = [r.ok ? 'OK' : 'Problems found'];
          for (const i of r.issues) lines.push(`${i.severity}: ${i.message}`);
          if (r.smiles !== undefined) lines.push(`SMILES: ${r.smiles}`, `Name: ${r.name ?? '(none generated)'}`, `Formula: ${r.formula}`);
          out(`${lines.join('\n')}\n`);
        }
        return r.ok ? 0 : 1;
      }
      case 'compare': {
        if (rest.length < 2) throw new UsageError('compare takes two structures');
        const r = await compare(readInput(rest[0]), readInput(rest[1]), read);
        if (o.json) json(r);
        else out(`${r.same ? 'Same compound and stereoisomer' : r.sameConnectivity ? 'Same compound, different stereochemistry' : 'Different compounds'}\n${r.smiles[0]}\n${r.smiles[1]}\n`);
        return r.same ? 0 : 1;
      }
      case 'mcp': {
        // stdout belongs to the protocol from here on: nothing else may be written to it.
        const server = createServer({ version: VERSION, rasterize, saveFile });
        await server.connect(new StdioServerTransport());
        return 0;
      }
      case 'link': {
        const r = await link(readInput(rest[0]), { ...read, ...(o.base ? { base: o.base } : {}) });
        if (o.json) json({ link: r });
        else out(`${r}\n`);
        return 0;
      }
      default:
        throw new UsageError(`Unknown command "${command}"`);
    }
  } catch (err) {
    const msg = (err as Error).message;
    if (o.json) json({ error: msg });
    else process.stderr.write(`${err instanceof UsageError ? `${msg}\n\nRun hexsketch --help for usage.` : msg}\n`);
    return 2;
  }
}

// Run as a command (not when imported by the tests).
const invoked = process.argv[1] && /(^|[\\/])(cli\.(ts|js)|hexsketch)$/.test(process.argv[1]);
if (invoked) main(process.argv.slice(2)).then((code) => { process.exitCode = code; });
