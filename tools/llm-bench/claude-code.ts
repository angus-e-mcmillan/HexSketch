/**
 * Running a question inside Claude Code itself (claude -p), for the cc-plain and
 * cc-hexsketch conditions: on the subscription Claude Code runs on, not
 * through OpenRouter.
 *
 * Everything Claude Code would bring with it is taken away, so that what a
 * run measures is the model and, in cc-hexsketch, HexSketch's connector and
 * nothing else:
 *
 *   --tools ""                  no built-in tools: no shell, no files, no web
 *   --strict-mcp-config         no MCP server but the one named here (none, in cc-plain)
 *   --disable-slash-commands    no skills and no commands
 *   --setting-sources ""        no user, project or local settings, so no plugins of the user's
 *   an empty directory          no CLAUDE.md or AGENTS.md to read
 *
 * Claude Code says what it loaded before it starts, and a run checks that
 * against what it asked for: anything more than HexSketch's own tools and the
 * run is failed rather than measured, so a result can never quietly include
 * help the condition did not allow. Its own system prompt stays, as it does
 * for anyone using HexSketch from Claude Code.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** HexSketch's connector, run from this checkout: a change to it is in the next run, with nothing deployed. */
const REPO = new URL('../../', import.meta.url).pathname;
const HEXSKETCH = { mcpServers: { hexsketch: { type: 'stdio', command: 'node', args: ['--experimental-strip-types', '--no-warnings', join(REPO, 'packages/hexsketch/src/cli.ts'), 'mcp'], cwd: REPO } } };
const NOTHING = { mcpServers: {} };

export interface ClaudeCodeRun {
  final: string; text: string; model: string;
  rounds: number; tools: { name: string; error: boolean }[]; finish: string | null;
  tokens: { prompt: number; completion: number; reasoning: number; cached: number };
  cost: number;
  /** What Claude Code said it loaded, kept with the record as the proof of isolation. */
  loaded: { tools: string[]; mcp: string[]; skills: number };
}

export async function runClaudeCode(prompt: string, opts: { model: string; withHexsketch: boolean; effort: string; timeoutMs: number }): Promise<ClaudeCodeRun> {
  const dir = mkdtempSync(join(tmpdir(), 'llm-bench-cc-'));
  const config = join(dir, '..', `${dir.split('/').pop()}.mcp.json`);
  writeFileSync(config, JSON.stringify(opts.withHexsketch ? HEXSKETCH : NOTHING));
  const args = [
    '-p', prompt, '--model', opts.model,
    '--tools', '', '--strict-mcp-config', '--mcp-config', config,
    '--disable-slash-commands', '--setting-sources', '',
    '--output-format', 'stream-json', '--verbose',
    ...(opts.effort && opts.effort !== 'none' ? ['--effort', opts.effort] : []),
  ];
  const run: ClaudeCodeRun = {
    final: '', text: '', model: opts.model, rounds: 0, tools: [], finish: null,
    tokens: { prompt: 0, completion: 0, reasoning: 0, cached: 0 }, cost: 0, loaded: { tools: [], mcp: [], skills: 0 },
  };
  const byId = new Map<string, number>();
  let failure: string | null = null;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('claude', args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error(`Claude Code took longer than ${opts.timeoutMs / 1000} s`)); }, opts.timeoutMs);
      let buffer = '', stderr = '';
      child.stderr.on('data', (d) => { stderr += d; });
      child.stdout.on('data', (d) => {
        buffer += d;
        let nl: number;
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl); buffer = buffer.slice(nl + 1);
          if (!line.trim()) continue;
          let e: Record<string, any>;
          try { e = JSON.parse(line); } catch { continue; }
          if (e.type === 'system' && e.subtype === 'init') {
            run.loaded = { tools: e.tools ?? [], mcp: (e.mcp_servers ?? []).map((s: { name: string }) => s.name), skills: (e.skills ?? []).length };
            const allowed = (t: string) => opts.withHexsketch && t.startsWith('mcp__hexsketch__');
            const extra = run.loaded.tools.filter((t) => !allowed(t));
            const servers = run.loaded.mcp.filter((s) => !(opts.withHexsketch && s === 'hexsketch'));
            if (extra.length || servers.length || run.loaded.skills) {
              failure = `Claude Code loaded more than the condition allows: ${[...extra, ...servers.map((s) => `server ${s}`), ...(run.loaded.skills ? [`${run.loaded.skills} skills`] : [])].join(', ')}`;
              child.kill('SIGTERM');
            }
            if (opts.withHexsketch && !run.loaded.mcp.includes('hexsketch')) { failure = 'HexSketch\'s connector did not start'; child.kill('SIGTERM'); }
            if (e.model) run.model = e.model;
          } else if (e.type === 'assistant') {
            run.rounds++;
            for (const block of e.message?.content ?? []) {
              if (block.type === 'text' && block.text) run.text += `${block.text}\n`;
              if (block.type === 'tool_use') { byId.set(block.id, run.tools.length); run.tools.push({ name: String(block.name).replace(/^mcp__hexsketch__/, ''), error: false }); }
            }
          } else if (e.type === 'user') {
            for (const block of e.message?.content ?? []) if (block.type === 'tool_result' && block.is_error && byId.has(block.tool_use_id)) run.tools[byId.get(block.tool_use_id)!]!.error = true;
          } else if (e.type === 'result') {
            run.final = e.result ?? '';
            run.finish = e.stop_reason ?? e.subtype ?? null;
            run.cost = e.total_cost_usd ?? 0;
            const u = e.usage ?? {};
            run.tokens.cached = u.cache_read_input_tokens ?? 0;
            run.tokens.prompt = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + run.tokens.cached;
            run.tokens.completion = u.output_tokens ?? 0;
            if (e.is_error && !failure) failure = `Claude Code ended in error: ${String(e.result ?? e.subtype).slice(0, 200)}`;
          }
        }
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (failure) reject(new Error(failure));
        else if (code !== 0 && !run.final) reject(new Error(`Claude Code exited ${code}: ${stderr.trim().slice(-200)}`));
        else resolve();
      });
      child.on('error', (err) => { clearTimeout(timer); reject(err); });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(config, { force: true });
  }
  // The answer is the last thing it wrote; the final result carries it, and the text keeps every reply.
  if (!run.final) run.final = run.text.trim().split('\n').slice(-6).join('\n');
  return run;
}
