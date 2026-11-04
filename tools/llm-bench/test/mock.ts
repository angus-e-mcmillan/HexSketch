/**
 * A stand-in for OpenRouter, for testing the runner without spending money:
 * the "model" answers every question with the key's own answer, after one
 * validate_structure call when it has tools, and with a wrong structure for
 * one question without tools, so grading is exercised both ways.
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
  const b = JSON.parse(body) as { messages: { role: string; content: string }[]; tools?: unknown[] };
  calls++;
  const user = b.messages.find((m) => m.role === 'user')!.content;
  const q = questions.find((x) => user.startsWith(x.prompt))!;
  const usage = { prompt_tokens: 100, completion_tokens: 50, completion_tokens_details: { reasoning_tokens: 20 }, cost: 0.001 };
  const a = q.answer;
  const truth = a.kind === 'formula' ? a.formula : a.kind === 'name' ? (await name(a.smiles)).name : a.smiles;
  // With tools, check first (one round), then answer.
  if (b.tools?.length && !b.messages.some((m) => m.role === 'tool') && a.kind !== 'formula') {
    return send({ model: 'mock/model-1', provider: 'Mock', usage, choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: '', tool_calls: [{ id: `c${calls}`, type: 'function', function: { name: 'validate_structure', arguments: JSON.stringify({ structure: a.smiles }) } }] } }] });
  }
  const wrong = q.category === 'reaction' && user.includes('Benzaldehyde is treated') && !b.tools;
  send({ model: 'mock/model-1', provider: 'Mock', usage, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: `Working.\n\nANSWER: ${wrong ? 'CCO' : truth}` } }] });
}).listen(port, () => console.log(`mock OpenRouter on ${port}`));
