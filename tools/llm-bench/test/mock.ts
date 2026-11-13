/**
 * A stand-in for OpenRouter, for testing the runner without spending money.
 * The "model" gives the key's own answer, with HexSketch's name for it. With
 * HexSketch's tools it first reads the drawing and draws its answer in the
 * editor as a reaction from the drawn structures; without them, it answers
 * the first question with an extra stereocentre inverted where it can, so the
 * measures are exercised both ways.
 *
 *   node --experimental-strip-types tools/llm-bench/test/mock.ts 8788
 */
import { createServer } from 'node:http';
import { name } from '../../../packages/agent/src/index.ts';
import { loadQuestions } from '../questions.ts';

const questions = loadQuestions();
const port = Number(process.argv[2] ?? 8788);
let calls = 0;

createServer(async (req, res) => {
  let body = '';
  for await (const chunk of req) body += chunk;
  const send = (x: unknown) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(x)); };
  if (req.url?.endsWith('/models')) return send({ data: [{ id: 'mock/model', name: 'Mock', context_length: 1000, pricing: { prompt: '0.000001', completion: '0.000002' } }] });
  const b = JSON.parse(body) as { messages: { role: string; content: string; tool_calls?: { function: { name: string } }[] }[]; tools?: unknown[] };
  calls++;
  const user = b.messages.find((m) => m.role === 'user')!.content;
  const q = questions.find((x) => user.startsWith(x.ask) && x.given.every((s) => user.includes(s))) ?? questions.find((x) => user.startsWith(x.ask))!;
  const usage = { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 }, cost: 0.001 };
  const k = q.key;
  const answer = k.kind === 'structure' ? k.smiles : k.kind === 'structures' ? k.smiles.join('.') : k.kind === 'sequence' ? k.stages.map((s) => s.join('.')).join(' >> ')
    : k.kind === 'atoms' || k.kind === 'ranking' ? k.smiles : k.kind === 'number' ? String(k.value) : k.kind === 'term' ? k.accept[0]! : k.target;
  const toolCall = (n: string, args: object) => send({ model: 'mock/model-1', provider: 'Mock', usage, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: `c${calls}`, type: 'function', function: { name: n, arguments: JSON.stringify(args) } }] } }] });
  const called = b.messages.flatMap((m) => m.tool_calls ?? []).map((t) => t.function.name);
  if (b.tools?.length) {
    // Read the drawing, draw the answer as a reaction from it, then answer.
    if (!called.includes('read_sketcher')) return toolCall('read_sketcher', {});
    if (!called.includes('show_in_sketcher') && k.kind === 'structure') return toolCall('show_in_sketcher', { reaction: { stages: [q.given.join('.'), k.smiles], arrows: [{ reagents: 'reagents' }] } });
  }
  const wrong = !b.tools?.length && q === questions[0];
  const given = wrong ? answer.replace('@@', '§').replace(/@(?!@)/, '@@').replace('§', '@') : answer;
  const nameLine = k.kind === 'structure' ? `\nNAME: ${(await name(given)).name}` : '';
  const warning = b.tools?.length && q.hazard ? `Note: ${q.hazard[0]} hazard.\n` : '';
  send({ model: 'mock/model-1', provider: 'Mock', usage, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `${warning}Working.\n\nANSWER: ${given}${nameLine}` } }] });
}).listen(port, () => console.log(`mock OpenRouter on ${port}`));
