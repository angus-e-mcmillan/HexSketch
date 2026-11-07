# LLM benchmark

How much better does a model answer chemistry questions with HexSketch's
tools than without them? Each question is asked through OpenRouter with and
without the tools, and the answers are marked automatically (or by the
examiner, for written answers).

| Condition | The model has |
|---|---|
| `blind` | No tools |
| `readback` | `validate_structure` only |
| `full` | Every checking tool the connector has (`validate`, `name`, `analyze`, `compare`, `convert`) |

The tool descriptions and schemas are the connector's own (from
`packages/hexsketch/src/toolkit.ts`), run in-process.

## Writing questions

Questions are written in the HexSketch Exam Bank page
(https://claude.ai/artifact/GACFCceuef8rxnNUTuVQgu; its code is
`bank/index.html`). Each question has a category of your choosing, the prompt
(shown exactly as the model receives it), an answer key, other answers that
also earn the mark, whether stereochemistry is marked, and an examiner's note
that is never sent to the model. HexSketch draws, names and checks every
structure in a key as it is typed, and shows its hazard warnings. Only
questions marked **Ready** are used.

| The model answers with | Key | Right when |
|---|---|---|
| A structure (SMILES) | the structure | the same compound, or stereoisomer if stereochemistry is marked |
| A name | the compound to be named | OPSIN parses the name to it; a trivial name can be ruled out |
| A molecular formula | the formula | element by element |
| A set of structures (`A.B`) | one SMILES per line | exactly that set, in any order |
| Structures in order (`A >> B`) | one SMILES per line | those structures in that order; extra steps between them are allowed |
| Letters | e.g. `A,C` | exactly those letters |
| A written answer | the marking scheme | marked by the examiner |

Written answers are kept in full and left out of the accuracy until they are
marked.

## From the bank to a run

Claude exports the bank into `bank/questions/` (one JSON file per question,
committed), then:

```sh
node --experimental-strip-types tools/llm-bench/prep-bank.ts
```

checks every key and writes `questions.jsonl` from the Ready questions.

Grading names needs OPSIN (and Java), once:

```sh
sh tools/opsin/fetch.sh
```

Put your OpenRouter key in `tools/llm-bench/.env` (git ignores it; never paste
it anywhere else):

```
OPENROUTER_API_KEY=sk-or-...
```

Then run the pilot questions, or all of them with `--all`:

```sh
npm run llm-bench -- --list-models opus
npm run llm-bench -- --model MODEL_ID --provider anthropic --conditions blind,full --repeats 1
```

| Option | Default | |
|---|---|---|
| `--model` | required | OpenRouter model id |
| `--provider` | any | Pin one provider, with no fallbacks |
| `--conditions` | `blind,full` | Any of `blind`, `readback`, `full` |
| `--repeats` | 3 | Passes through the questions; the report shows their range |
| `--all` | off | Every Ready question, not only those marked for the pilot |
| `--only` | | Comma-separated question ids |
| `--effort` | `medium` | `reasoning.effort`; `none` for a model without thinking |
| `--max-tokens` | 32000 | The same for every model |
| `--max-rounds` | 10 | Tool rounds before the model must answer |
| `--concurrency` | 4 | Questions in flight at once |
| `--run` | date-model | Name of the run; give an old one to carry on where it stopped |
| `--dry-run` | | Show how many requests it would make, then stop |

## Output

- `results/<run>.md` and `.json`: accuracy per condition and category, cost,
  tokens, time, tool calls, the model and provider that answered, and the
  commit and question-set hash.
- `out/<run>/`: every transcript and graded answer (not committed).

To test the runner without spending anything, run the stand-in for OpenRouter:

```sh
node --experimental-strip-types tools/llm-bench/test/mock.ts 8788 &
LLM_BENCH_API=http://localhost:8788 OPENROUTER_API_KEY=test npm run llm-bench -- --model mock/model --repeats 1 --run mock
```

The page loads HexSketch from `bank/hexsketch.js`, built with
`npm run llm-bench:bank`.
