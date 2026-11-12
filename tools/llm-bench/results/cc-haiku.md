# cc-haiku

claude-haiku-5-5 (served as claude-haiku-5-5, via Claude Code), effort medium, 3 repeats of 45 questions worth 174 marks. Total cost $0.38.

| | Claude Code, no tools | Claude Code with HexSketch |
|---|---|---|
| **Score** | **158.0 / 174 (156–159)** | **166.0 / 174 (159–170)** |
| reaction | 80.0 / 80 | 78.7 / 80 |
| multistep | 18.3 / 20 | 20.0 / 20 |
| mechanism | 5.0 / 10 | 8.3 / 10 |
| retrosynthesis | 13.3 / 20 | 16.7 / 20 |
| structure | 14.0 / 14 | 14.0 / 14 |
| analysis | 14.0 / 15 | 15.0 / 15 |
| hazard | 13.3 / 15 | 13.3 / 15 |
| Correct | 93% (135) | 96% (135) |
| Right compound, wrong stereochemistry | 0% (135) | 0% (135) |
| Valid structures | 98% (135) | 99% (135) |
| Name matches structure | 87% (90) | 83% (90) |
| Unchanged part kept | 99% (93) | 99% (93) |
| Hazard flagged | 100% (12) | 92% (12) |
| Drawn the same way round | 44% (91) | 49% (91) |
| Refused | 0 | 0 |
| Cut off at the token limit, no answer | 0 | 0 |
| cost / question | $0.001 | $0.002 |
| input tokens / question (from cache) | 3819 (2794) | 20093 (16902) |
| output tokens / question (thinking) | 1530 (0) | 1952 (0) |
| median time | 9 s | 12 s |
| tool calls / question | 0.0 | 1.3 |

Score: marks for answers that are right, averaged over the repeats (range in brackets). Each measure is the share of the answers it applies to (how many in brackets).

## Each question

| Question | Marks | Claude Code, no tools: right · tokens out · $ · s | Claude Code with HexSketch: right · tokens out · $ · s |
|---|---|---|---|
| reaction-1 | 4 | 3/3 · 3581 · 0.002 · 19 | 3/3 · 5032 · 0.004 · 26 |
| reaction-2 | 4 | 3/3 · 1067 · 0.001 · 8 | 3/3 · 1714 · 0.002 · 12 |
| reaction-3 | 4 | 3/3 · 620 · 0.001 · 6 | 3/3 · 1169 · 0.001 · 9 |
| reaction-4 | 4 | 3/3 · 2498 · 0.001 · 15 | 3/3 · 3681 · 0.003 · 22 |
| reaction-5 | 4 | 3/3 · 1247 · 0.001 · 9 | 2/3 · 1779 · 0.002 · 14 |
| reaction-6 | 4 | 3/3 · 418 · 0.000 · 5 | 3/3 · 530 · 0.001 · 6 |
| reaction-7 | 4 | 3/3 · 1840 · 0.001 · 12 | 3/3 · 1593 · 0.001 · 11 |
| reaction-h1 | 4 | 3/3 · 2141 · 0.001 · 14 | 3/3 · 2279 · 0.002 · 16 |
| reaction-h2 | 4 | 3/3 · 536 · 0.001 · 5 | 3/3 · 789 · 0.001 · 7 |
| reaction-h3 | 4 | 3/3 · 1437 · 0.001 · 11 | 3/3 · 2050 · 0.002 · 14 |
| reaction-h4 | 4 | 3/3 · 559 · 0.000 · 5 | 3/3 · 1123 · 0.001 · 9 |
| reaction-h5 | 4 | 3/3 · 982 · 0.001 · 7 | 3/3 · 1022 · 0.001 · 8 |
| reaction-h6 | 4 | 3/3 · 982 · 0.001 · 8 | 3/3 · 1201 · 0.001 · 9 |
| reaction-h7 | 4 | 3/3 · 930 · 0.001 · 7 | 3/3 · 1392 · 0.002 · 11 |
| reaction-h8 | 4 | 3/3 · 1659 · 0.001 · 11 | 3/3 · 1988 · 0.002 · 14 |
| reaction-h9 | 4 | 3/3 · 1646 · 0.001 · 12 | 3/3 · 1977 · 0.002 · 14 |
| reaction-h10 | 4 | 3/3 · 2040 · 0.001 · 13 | 3/3 · 2114 · 0.002 · 13 |
| reaction-h11 | 4 | 3/3 · 1171 · 0.001 · 10 | 3/3 · 1253 · 0.001 · 11 |
| reaction-h12 | 4 | 3/3 · 2097 · 0.001 · 13 | 3/3 · 2407 · 0.002 · 15 |
| reaction-h13 | 4 | 3/3 · 2273 · 0.001 · 13 | 3/3 · 2361 · 0.002 · 14 |
| multistep-1 | 5 | 2/3 · 1403 · 0.001 · 9 | 3/3 · 2426 · 0.002 · 15 |
| multistep-2 | 5 | 3/3 · 2038 · 0.001 · 13 | 3/3 · 3490 · 0.003 · 19 |
| multistep-3 | 5 | 3/3 · 1191 · 0.001 · 9 | 3/3 · 1310 · 0.001 · 9 |
| multistep-h1 | 5 | 3/3 · 2188 · 0.001 · 13 | 3/3 · 2250 · 0.002 · 14 |
| mechanism-1 | 5 | 3/3 · 2677 · 0.002 · 14 | 3/3 · 2840 · 0.002 · 16 |
| mechanism-2 | 5 | 0/3 · 2386 · 0.001 · 13 | 2/3 · 3068 · 0.002 · 18 |
| retrosynthesis-1 | 5 | 2/3 · 1348 · 0.001 · 9 | 2/3 · 2361 · 0.002 · 14 |
| retrosynthesis-2 | 5 | 0/3 · 1656 · 0.001 · 10 | 2/3 · 1858 · 0.001 · 12 |
| retrosynthesis-3 | 5 | 3/3 · 1113 · 0.001 · 7 | 3/3 · 1173 · 0.001 · 9 |
| retrosynthesis-h1 | 5 | 3/3 · 1244 · 0.001 · 8 | 3/3 · 1401 · 0.001 · 10 |
| structure-1 | 2 | 3/3 · 2115 · 0.001 · 13 | 3/3 · 3262 · 0.003 · 20 |
| structure-2 | 2 | 3/3 · 963 · 0.001 · 7 | 3/3 · 1385 · 0.002 · 12 |
| structure-3 | 2 | 3/3 · 1440 · 0.001 · 10 | 3/3 · 2136 · 0.002 · 16 |
| structure-4 | 2 | 3/3 · 3585 · 0.002 · 22 | 3/3 · 4292 · 0.003 · 30 |
| structure-5 | 2 | 3/3 · 667 · 0.001 · 6 | 3/3 · 1408 · 0.002 · 12 |
| structure-h1 | 2 | 3/3 · 835 · 0.001 · 7 | 3/3 · 948 · 0.001 · 9 |
| structure-h2 | 2 | 3/3 · 3155 · 0.002 · 18 | 3/3 · 3592 · 0.003 · 22 |
| analysis-1 | 3 | 2/3 · 950 · 0.001 · 7 | 3/3 · 1189 · 0.001 · 9 |
| analysis-2 | 3 | 3/3 · 971 · 0.001 · 7 | 3/3 · 1001 · 0.001 · 8 |
| analysis-3 | 3 | 3/3 · 517 · 0.000 · 6 | 3/3 · 535 · 0.001 · 6 |
| analysis-4 | 3 | 3/3 · 1517 · 0.001 · 10 | 3/3 · 1794 · 0.002 · 12 |
| analysis-h1 | 3 | 3/3 · 745 · 0.001 · 7 | 3/3 · 958 · 0.001 · 8 |
| hazard-1 | 5 | 3/3 · 931 · 0.001 · 8 | 3/3 · 1604 · 0.002 · 12 |
| hazard-2 | 5 | 3/3 · 2133 · 0.001 · 14 | 2/3 · 2683 · 0.002 · 17 |
| hazard-h1 | 5 | 2/3 · 1350 · 0.001 · 10 | 3/3 · 1429 · 0.002 · 12 |
