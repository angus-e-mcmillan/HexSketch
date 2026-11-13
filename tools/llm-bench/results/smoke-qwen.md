# smoke-qwen

qwen/qwen3.7-flash (served as qwen/qwen3.7-flash, via Alibaba), effort medium, 1 repeat of 2 questions worth 6 marks. Total cost $0.01.

| | Without HexSketch | With HexSketch |
|---|---|---|
| **Score** | **0.0 / 6** | **2.0 / 6** |
| reaction | 0.0 / 4 | 0.0 / 4 |
| structure | 0.0 / 2 | 2.0 / 2 |
| Correct | 0% (2) | 50% (2) |
| Right compound, wrong stereochemistry | 50% (2) | 0% (2) |
| Valid structures | 50% (2) | 50% (2) |
| Name matches structure | 0% (2) | 50% (2) |
| Unchanged part kept | 100% (1) | 50% (2) |
| Hazard flagged | – | – |
| Drawn the same way round | 0% (1) | 100% (2) |
| Refused | 0 | 0 |
| Cut off at the token limit, no answer | 1 | 0 |
| cost / question | $0.003 | $0.001 |
| input tokens / question (from cache) | 149 (0) | 16134 (9600) |
| output tokens / question (thinking) | 22015 (21894) | 3471 (3053) |
| median time | 220 s | 42 s |
| tool calls / question | 0.0 | 1.5 |

Score: marks for answers that are right, averaged over the repeats. Each measure is the share of the answers it applies to (how many in brackets).

## Each question

| Question | Marks | Without HexSketch: right · tokens out · $ · s | With HexSketch: right · tokens out · $ · s |
|---|---|---|---|
| reaction-1 | 4 | 0/1 · 12029 · 0.002 · 124 | 0/1 · 4835 · 0.001 · 57 |
| structure-1 | 2 | 0/1 (1 cut off) · 32000 · 0.004 · 317 | 1/1 · 2107 · 0.001 · 26 |
