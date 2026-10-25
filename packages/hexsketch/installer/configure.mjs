// Adds HexSketch to Claude Desktop's claude_desktop_config.json, keeping
// everything else in it and a backup of the original next to it.
// Usage: node configure.mjs <config file> <node binary> <path to dist/cli.js>
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const [config, node, cli] = process.argv.slice(2);
if (!config || !node || !cli) { console.error('usage: node configure.mjs <config> <node> <cli.js>'); process.exit(2); }

let settings = {};
if (existsSync(config)) {
  const text = readFileSync(config, 'utf8');
  try { settings = text.trim() ? JSON.parse(text) : {}; } catch {
    console.error(`Claude's config file has a mistake in it, so it was left alone:\n  ${config}\nFix or delete that file, then run the installer again.`);
    process.exit(1);
  }
  copyFileSync(config, `${config}.before-hexsketch`);
} else {
  mkdirSync(dirname(config), { recursive: true });
}
settings.mcpServers = { ...(settings.mcpServers ?? {}), hexsketch: { command: node, args: [cli, 'mcp'] } };
writeFileSync(config, `${JSON.stringify(settings, null, 2)}\n`);
console.log(`Added HexSketch to ${config}`);
