# cc-smoke

claude-haiku-5-5 (served as claude-haiku-5-5, via Claude Code), effort medium, 1 repeat of 3 questions worth 10 marks. Total cost $0.01.

| | Claude Code, no tools | Claude Code with HexSketch |
|---|---|---|
| **Score** | **10.0 / 10** | **10.0 / 10** |
| reaction | 8.0 / 8 | 8.0 / 8 |
| structure | 2.0 / 2 | 2.0 / 2 |
| Correct | 100% (3) | 100% (3) |
| Right compound, wrong stereochemistry | 0% (3) | 0% (3) |
| Valid structures | 100% (3) | 100% (3) |
| Name matches structure | 100% (3) | 100% (3) |
| Unchanged part kept | 100% (2) | 100% (2) |
| Hazard flagged | – | – |
| Drawn the same way round | 100% (2) | 100% (2) |
| Refused | 0 | 0 |
| Cut off at the token limit, no answer | 0 | 0 |
| cost / question | $0.001 | $0.002 |
| input tokens / question (from cache) | 3803 (1794) | 24309 (20655) |
| output tokens / question (thinking) | 1207 (0) | 2057 (0) |
| median time | 7 s | 11 s |
| tool calls / question | 0.0 | 2.3 |

Score: marks for answers that are right, averaged over the repeats. Each measure is the share of the answers it applies to (how many in brackets).

## Each question

| Question | Marks | Claude Code, no tools: right · tokens out · $ · s | Claude Code with HexSketch: right · tokens out · $ · s |
|---|---|---|---|
| reaction-h4 | 4 | 1/1 · 589 · 0.001 · 6 | 1/1 · 1114 · 0.001 · 9 |
| reaction-h7 | 4 | 1/1 · 959 · 0.001 · 7 | 1/1 · 1234 · 0.002 · 11 |
| structure-h2 | 2 | 1/1 · 2074 · 0.002 · 13 | 1/1 · 3823 · 0.003 · 20 |
