/**
 * Local OPSIN bridge (Node only). Parses IUPAC names back to SMILES with the
 * OPSIN jar under tools/opsin, entirely offline. Used to verify every name
 * the namer produces: a name is only trusted if it parses back to the same
 * structure.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const OPSIN_JAR = fileURLToPath(new URL('../../../tools/opsin/opsin.jar', import.meta.url));

export function opsinAvailable(): boolean {
  if (!existsSync(OPSIN_JAR)) return false;
  try { execFileSync('java', ['-version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

/** Parse names to SMILES; unparsable names give null. One JVM for the whole batch. */
export function opsinToSmiles(names: string[]): (string | null)[] {
  if (!names.length) return [];
  const out = execFileSync('java', ['-jar', OPSIN_JAR, '-osmi'], {
    input: names.join('\n') + '\n',
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'ignore'],
    maxBuffer: 64 * 1024 * 1024,
  });
  const lines = out.split('\n');
  // OPSIN prints a prompt line first when reading stdin interactively; drop non-result lines.
  const results = lines.filter((l) => !l.startsWith('Run the jar'));
  return names.map((_, i) => {
    const s = (results[i] ?? '').trim();
    return s ? s : null;
  });
}
