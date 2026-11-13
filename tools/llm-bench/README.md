# LLM benchmark

Does HexSketch make a model's chemistry more reliable? Each question is a
drawing a chemist would make. It is put to a model twice -- through OpenRouter,
for any model, or inside Claude Code, for Claude's own:

| Condition | How the question reaches the model | How it answers |
|---|---|---|
| Without HexSketch (`smiles`) | The chemist's question, the structures as SMILES, and the reagents and conditions written out. No tools. | In text |
| With HexSketch (`hexsketch`) | As on hexsketch.com: the question in the chat beside the editor, which holds the drawing. HexSketch's own system prompt, all its tools, and the drawing as HexSketch describes it. | In the chat, and by drawing in the editor (`show_in_sketcher`) |
| Claude Code, typed (`cc-plain`) | In Claude Code with nothing attached: the same words as `smiles`. | In text |
| Claude Code, drawn (`cc-drawn`) | In Claude Code with HexSketch's connector and nothing else: the chemist's words and a link to their drawing, which the model reads through HexSketch. | In text, drawing with `render_structure` |

Through OpenRouter, the tools run here exactly as the website runs them,
against a stand-in editor; in Claude Code, HexSketch's connector runs from
this checkout. Either way the benchmark measures HexSketch as it is.

## What is measured

The paper is 100 marks over seven types of question (`questions/`); `--set hard`
is 29 harder questions: ten reactions from a chemist's own ChemDraw drawings,
taken from published total and process syntheses, with the products they drew
as the answers; six more ending at a drug whose structure PubChem confirms; and
the rest on less common chemistry. `--set all` is the two together, 55
questions and 214 marks. Each run
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

The paper is written in [paper.ts](paper.ts), one spec per question, and
drawn from there; a question may also be drawn by hand in HexSketch. See
[questions/README.md](questions/README.md). Then:

```sh
npm run llm-bench:author   # draw the paper from paper.ts
npm run llm-bench:prep
```

checks them and writes `questions.jsonl`, and `questions/questions.html` to
proofread them.

## What the runs have settled

- **One repeat cannot tell a ten-mark difference from noise.** The same
  condition, settings and model scored 95 / 100 and 80 / 100 in two runs an
  hour apart: a question answered twice before spent its whole budget and
  answered nothing. Any claim about a score needs the default three repeats
  and the range the report prints. Token, time and orientation figures are
  means over every question and move far less.
- **At equal settings HexSketch does not change the score. It changes
  everything about how the score is reached.** Three repeats of the drug-scale
  paper on the free model, 78 answers a condition: 88.7 / 100 (86–90) with
  HexSketch against 90.3 (86–94) without. The ranges overlap, so there is no
  score difference to report, in either direction. What does separate, as means
  over every answer: 9.0k output tokens a question against 15.6k, 75 s against
  135 s, no answer cut off against four, every structure valid against 95%,
  98% of names matching their structure against 90%, and 84% of structures
  drawn the same way round as the question against 40%. A chemist gets the same
  marks in half the time and half the tokens, and gets drawings they can read.
  (An earlier single run read 95 against 91, and was quoted here as a win. One
  repeat cannot measure that, as the bullet above says: three can, and it is a
  tie.)
- **Difficulty comes from the size of the molecule, not the cleverness of the
  question.** Sixteen questions on migration selectivity, kinetic enolates and
  the rest scored 56 / 63 on a free model, and every mark dropped was a token
  cut-off. What models come apart on is carrying twenty-five heavy atoms
  through a transformation.
- **HexSketch trades thinking for drawing.** Over three repeats it wins and
  loses the same questions every time, and that is the trade. It rescues the
  bookkeeping: a drug-scale coupling the model never once finished inside
  32000 tokens it answered right all three times with HexSketch, in 18k. It
  cuts a trap short: asked which two buyable materials make a biaryl amide it
  drew the amide disconnection three times out of three and lost the marks,
  because the benzoic acid it asks you to buy has no supplier, where without
  HexSketch it reasoned its way to the Suzuki coupling twice. Same with the
  diazoketone trap: drawn after 5.7k tokens and committed to the methyl ester,
  against 26k of thinking and the right answer. The questions it loses are the
  ones whose answer looks right on the page and fails on a fact the drawing
  does not hold. **That is a product gap, not just a benchmark result:**
  HexSketch can tell the model a structure is valid, named and balanced, but
  not that nobody sells it. The vendor check this benchmark already uses
  (route.ts, 30 suppliers) would answer exactly the question the model got
  wrong.
- **It is the description that saves the tokens, not the instructions.** Four
  conditions on one model, holding one thing still at a time: the question as
  a SMILES costs 19257 output tokens a question and 214 s, with nine answers
  cut off; the same question with the drawing described instead -- same plain
  system prompt, no tools, only the structure given as a name, a formula and
  a scheme rather than a SMILES to parse -- costs 7141 tokens and 57 s, with
  nothing cut off. That one change is 86% of the whole saving. HexSketch's
  own instructions, added on top, cost 1549 tokens rather than saving any,
  and the tools then save 3516 more. So a model is faster here because of
  what it is told about the drawing, not because of how it is told to behave.
  (The instructions are measured unfairly: that condition hands the model
  instructions that tell it to draw with tools it has not been given, which
  is also why its structures are the worst of the four. Read 1549 as the most
  the instructions could be costing, not as a measurement.) None of this
  touches the score: all four conditions landed inside each other's ranges.
- **In Claude Code, a question drawn in HexSketch is a question HexSketch is
  used for.** Haiku 5.5 inside Claude Code, nothing loaded but HexSketch's
  connector, three repeats of the whole paper. Asked in text with the
  connector attached, half its answers (49%) never call HexSketch and 39%
  draw their answer. Asked the way a chemist using HexSketch asks -- their
  words and a link to what they drew -- every answer calls it, and 77% draw
  their answer. The marks: 158.0 (156-159) with no tools, 160.3 (160-161)
  with the connector, 164.7 (159-169) with the question drawn, retrosynthesis
  going to 20 / 20. Suggestive rather than settled. The drawn question costs
  six times as much and takes twice as long: the model reads the drawing,
  draws its answer, and 8% of its calls fail, most of them render_structure
  given a malformed mechanism, which it then corrects.
- **"Draw before you think" was tried and rejected.** An extra prompt line
  telling the model to draw as soon as it could write a structure moved the
  score by a noise-sized amount and dropped structures drawn the same way
  round from 94% to 35%.

## Running it

Once: OPSIN (needs Java), to read the names models give.

```sh
sh tools/opsin/fetch.sh
```

### In Claude Code, with Claude's models

Claude's own models run inside Claude Code itself, on the subscription Claude
Code is signed in with: no OpenRouter, no key. Each question runs in its own
`claude -p` with every built-in tool, skill, setting, CLAUDE.md and MCP server
taken away, and HexSketch's connector -- run from this checkout, so a change
to HexSketch is in the next run with nothing deployed -- as the only thing
attached. Claude Code reports what it loaded before it starts; a run that
loaded anything more, or whose HexSketch call was refused, is failed rather
than measured.

```sh
npm run llm-bench -- --model claude-haiku-5-5 --set all
```

A model id without a slash runs in Claude Code and compares, by default:

| Condition | The question | HexSketch |
|---|---|---|
| `cc-plain` | typed: the words, with the structures as SMILES and the reagents written out | none |
| `cc-drawn` | drawn: the words, and a link to the drawing in HexSketch, as a chemist hands it over | the connector, which the model needs to read the drawing |
| `cc-hexsketch` | typed, exactly as `cc-plain` | the connector, unasked for -- what attaching it alone changes |

`--effort` is passed to Claude Code. The cost a report gives is Claude Code's
own count; on a subscription it is usage against the plan's limits, not a bill.
Claude Code does not report thinking apart from output, so a report's thinking
figure reads 0 there: the thinking is in the output count.

### Through OpenRouter, with any model

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
| `--model` | required | OpenRouter model id, or a Claude Code one (`claude-haiku-5-5`) |
| `--provider` | any | Pin one provider, with no fallbacks |
| `--conditions` | `smiles,hexsketch`, or `cc-plain,cc-drawn` in Claude Code | Any of `smiles`, `hexsketch`, `cc-plain`, `cc-hexsketch`, `cc-drawn` |
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
