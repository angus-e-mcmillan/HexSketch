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

The paper is 100 marks over seven types of question (`questions/`). Each run
reports the **score** in each condition (marks for right answers, overall and
per type), and for every answer, automatically:

| Measure | The question it answers |
|---|---|
| Correct | Is it the answer, with the stereochemistry the answer defines? (For analysis questions: the right label, ranking, number or word.) |
| Right compound, wrong stereochemistry | Did it lose or invert a stereocentre? |
| Valid structures | Does every SMILES read, with no atom over its valence? |
| Name matches structure | Is the name the model gives the structure it gives? (OPSIN reads the name) |
| Unchanged part kept | Is everything the reaction should not touch still there (every fluorine, the protecting group)? |
| Hazard flagged | On questions with a hazard: did the reply warn of it, unasked? |
| Drawn the same way round | Is the answer oriented like the chemist's drawing? With HexSketch, as the model drew it; without, laid out from its SMILES as any drawing program would |
| Refused | Did the model decline? By the provider's stop reason (`refusal`, `content_filter`), a request the provider blocked, or a reply with no answer that says it won't |
| Cut off | Did it stop at `--max-tokens`, still thinking, without an answer? Counted wrong, and shown apart from wrong answers |

And what each answer took: input, output and thinking tokens, cost, time and
tool calls, for every question in each condition (the "Each question" table
in the results).

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
| `--like-website` | | The HexSketch condition asks as hexsketch.com does: low effort, at most 4,096 tokens a turn for Claude and 16,384 for other models, thinking not sent back |
| `--max-rounds` | 12 | Tool rounds before the model must answer |
| `--concurrency` | 4 | Questions in flight at once |
| `--run` | date-model | Name of the run; give an old one to carry on where it stopped |
| `--dry-run` | | Show how many requests it would make, then stop |

### Free models

To try the paper out without spending anything, use a free model
(`--list-models free`). Not all of them work. These were tried in November 2026:

| Model | |
|---|---|
| `nvidia/nemotron-3.5-super-vl:free` | Works: uses the tools, about 2 minutes an answer. Run with `--repeats 1 --concurrency 3 --timeout 1200` (an hour for the paper) |
| `nvidia/nemotron-3-ultra-550b-a55b:free` | Works, but up to 16 minutes an answer |
| `baidu/ernie-5.5-flash-preview:free` | Often thinks to the token limit without answering |
| `google/gemma-4-31b-it:free` | Rate-limited by its provider (429) |
| `thinkingmachines/inkling-2-small:free` | Refused: OpenRouter serves it only to agent apps (403) |

One pass of a free model is noisy (a single answer is worth 2 to 5 marks):
use free models to find problems with the questions and with HexSketch, and
paid models with three repeats for the numbers.

## Output

- `results/<run>.md` and `.json`: the score and each measure in each
  condition, refusals, and per question the marks, tokens, cost and time.
  Commit these.
- `results/plots.html` and `results/plots/*.svg`: charts of every run of
  the whole paper (the latest per model), without HexSketch beside with it:
  the score, the score by question type, each measure, and cost, tokens and
  time per question. The SVGs are for slides. Remake them with
  `npm run llm-bench:plot` (`-- --runs a,b` for particular runs).
- `results/<name>.html` and `results/plots/<name>-tokens.svg`, `-time.svg`:
  setups compared, one dot per run and condition, the score against output
  tokens and against time (top left is best). For trying settings on a free
  model: `npm run llm-bench:compare -- --runs "run;run:hexsketch=Label" --name settings`.
- `out/<run>/report.html`: every answer drawn beside the question and the
  answer key, with its measures and the model's reply. Not committed.
- `out/<run>/transcripts/`: every conversation in full.

To test the runner without spending anything, run the stand-in for OpenRouter:

```sh
node --experimental-strip-types tools/llm-bench/test/mock.ts 8788 &
LLM_BENCH_API=http://localhost:8788 OPENROUTER_API_KEY=test npm run llm-bench -- --model mock/model --repeats 1 --run mock
```
