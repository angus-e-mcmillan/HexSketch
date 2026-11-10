# LLM benchmark

Does HexSketch make a model's chemistry more reliable? Each question is a
drawing a chemist would make. It is put to a model twice, through OpenRouter:

| Condition | How the question reaches the model | How it answers |
|---|---|---|
| Without HexSketch (`smiles`) | The chemist's question, the structures as SMILES, and the reagents and conditions written out. No tools. | In text |
| With HexSketch (`hexsketch`) | As on hexsketch.com: the question in the chat beside the editor, which holds the drawing. HexSketch's own system prompt, all its tools, and the drawing as HexSketch describes it. | In the chat, and by drawing in the editor (`show_in_sketcher`) |

The tools run here exactly as the website runs them, against a stand-in
editor, so the benchmark measures HexSketch as it is.

## What is measured

Every answer, automatically, in both conditions:

| Measure | The question it answers |
|---|---|
| Correct | Is it the answer, with the stereochemistry the answer defines? (For analysis questions: the right label, ranking, number or word.) |
| Right compound, wrong stereochemistry | Did it lose or invert a stereocentre? |
| Valid structures | Does every SMILES read, with no atom over its valence? |
| Name matches structure | Is the name the model gives the structure it gives? (OPSIN reads the name) |
| Unchanged part kept | Is everything the reaction should not touch still there (every fluorine, the protecting group)? |
| Hazard flagged | On questions with a hazard: did the reply warn of it, unasked? |
| Drawn the same way round | Is the answer oriented like the chemist's drawing? With HexSketch, as the model drew it; without, laid out from its SMILES as any drawing program would |

## Questions

Questions are drawn in HexSketch: see [questions/README.md](questions/README.md).
Then:

```sh
npm run llm-bench:prep
```

checks them and writes `questions.jsonl`, and `questions/questions.html` to
proofread them.

## Running it

Once: OPSIN (needs Java), to read the names models give.

```sh
sh tools/opsin/fetch.sh
```

Put your OpenRouter key in `tools/llm-bench/.env` (git ignores it; never
paste it anywhere else):

```
OPENROUTER_API_KEY=sk-or-...
```

Then:

```sh
npm run llm-bench -- --list-models opus
npm run llm-bench -- --model MODEL_ID --provider anthropic --repeats 1
```

| Option | Default | |
|---|---|---|
| `--model` | required | OpenRouter model id |
| `--provider` | any | Pin one provider, with no fallbacks |
| `--conditions` | `smiles,hexsketch` | Either or both |
| `--repeats` | 3 | Passes through the questions |
| `--types` | all | e.g. `reaction,mechanism` |
| `--only` | | Question ids, e.g. `reaction-1` |
| `--effort` | `medium` | `reasoning.effort`; `none` for a model without thinking |
| `--max-tokens` | 32000 | The same for every model |
| `--max-rounds` | 12 | Tool rounds before the model must answer |
| `--concurrency` | 4 | Questions in flight at once |
| `--run` | date-model | Name of the run; give an old one to carry on where it stopped |
| `--dry-run` | | Show how many requests it would make, then stop |

## Output

- `results/<run>.md` and `.json`: each measure in each condition, correct by
  question type, cost, tokens, time and tool calls. Commit these.
- `out/<run>/report.html`: every answer drawn beside the question and the
  answer key, with its measures and the model's reply. Not committed.
- `out/<run>/transcripts/`: every conversation in full.

To test the runner without spending anything, run the stand-in for OpenRouter:

```sh
node --experimental-strip-types tools/llm-bench/test/mock.ts 8788 &
LLM_BENCH_API=http://localhost:8788 OPENROUTER_API_KEY=test npm run llm-bench -- --model mock/model --repeats 1 --run mock
```
