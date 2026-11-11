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
| `--set` | the paper | Another set of questions: `questions/NAME/`, built with `npm run llm-bench:prep -- --set NAME` (candidates being tried out, say) |
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

### Can it be bought?

A route's starting materials are screened against PubChem's chemical-vendor
list, and a compound counts as available only when at least 30 vendors list
it (`VENDORS_NEEDED` in `route.ts`). Many suppliers list compounds they have
never made, so one or two listings mean nothing. This is only a screen:
SciFinder is the authority, and the vendor counts are shown on the grading
page so you can overrule it.

## Sitting the paper yourself

A human score says what the paper's ceiling is, so a model's score means
something. Build the sheet, answer it in HexSketch, and have it marked the
same way a model's answers are:

```sh
npm run llm-bench:sheet
npm run llm-bench:sat -- --file answer-sheet.cdxml --who "Angus"
```

`answer-sheet.cdxml` holds every question under a heading naming it, with
room below to draw. Answers are found by the heading above them, so they can
be moved and spaced however suits. Under a heading, draw what the question
asks for, exactly as a question file's answer is drawn: one structure, a set
of them, stages with arrows between them, the atoms highlighted, 1/2/3
beside atoms, or a caption `Answer: 8.1` for a number or a word. Protecting
groups may be abbreviated as usual. Anything else written under the heading
counts as what you said, so a hazard question's warning belongs there.

It writes `results/<run>.json` and `.md` in the same shape as a model's run,
so the ceiling sits beside the models in the figures.

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
- `results/<name>.html` and `results/plots/<name>.svg` from
  `npm run llm-bench:items -- --runs "run:hexsketch=Label;..."`: which question
  each setup got right, as a grid. A question every setup gets right tells
  nothing apart; one none gets right may have a wrong key.
- `results/layout-<run>.html` from `npm run llm-bench:layout -- --run RUN`:
  how well the right answers are drawn (angles, bond lengths, clashes,
  crossings, bonds through labels). Not scored. The comparison a chemist
  would make is with ChemDraw, so that is the only comparator: the run
  writes `chemdraw/wanted.txt`, you paste those answers into ChemDraw, Clean
  Up Structure, save each as CDXML, and run again with `--chemdraw DIR`.
  Both drawings then go through HexSketch's renderer, so the style never
  says which is which, and the pairs land in `results/ab-<run>.json`.
- The chemist's grading page, a claude.ai artifact: routes the checks could not
  settle, and the blind drawing pairs. `npm run llm-bench:grading -- push
  --runs RUN` writes its items to `grading/items/` (Claude puts them on the
  page); `npm run llm-bench:grading -- pull DIR` turns the grades saved from
  the page into `results/grades.json`, which the marking reads.
- `out/<run>/report.html`: every answer drawn beside the question and the
  answer key, with its measures and the model's reply. Not committed.
- `out/<run>/transcripts/`: every conversation in full.

To test the runner without spending anything, run the stand-in for OpenRouter:

```sh
node --experimental-strip-types tools/llm-bench/test/mock.ts 8788 &
LLM_BENCH_API=http://localhost:8788 OPENROUTER_API_KEY=test npm run llm-bench -- --model mock/model --repeats 1 --run mock
```
