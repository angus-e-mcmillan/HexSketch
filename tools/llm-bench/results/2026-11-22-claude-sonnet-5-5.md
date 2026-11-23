# 2026-11-22-claude-sonnet-5-5

claude-sonnet-5-5 (served as claude-sonnet-5-5, via Claude Code), effort medium, 1 repeat of 39 questions worth 170 marks. Total cost $3.23.

| | Claude Code, no tools | Claude Code with HexSketch, question drawn |
|---|---|---|
| **Score** | **150.0 / 170** | **142.5 / 170** |
| multistep | 34.0 / 39 | 29.0 / 39 |
| mechanism | 25.0 / 30 | 25.0 / 30 |
| retrosynthesis | 20.0 / 25 | 20.0 / 25 |
| route | 10.0 / 15 | 7.5 / 15 |
| structure | 12.0 / 12 | 12.0 / 12 |
| analysis | 14.0 / 14 | 14.0 / 14 |
| hazard | 35.0 / 35 | 35.0 / 35 |
| Correct | 87% (39) | 85% (39) |
| Right compound, wrong stereochemistry | 3% (39) | 3% (39) |
| Valid structures | 100% (37) | 95% (37) |
| Name matches structure | 42% (12) | 75% (12) |
| Unchanged part kept | 96% (24) | 96% (24) |
| Hazard flagged | 100% (7) | 100% (7) |
| Drawn the same way round | 45% (22) | 62% (21) |
| Refused | 0 | 0 |
| Cut off at the token limit, no answer | 0 | 0 |
| cost / question | $0.018 | $0.065 |
| input tokens / question (from cache) | 3102 (1540) | 29262 (20205) |
| output tokens / question (thinking) | 1149 (0) | 2674 (0) |
| median time | 11 s | 28 s |
| tool calls / question | 0.0 | 1.3 |

Score: marks for answers that are right, averaged over the repeats. Each measure is the share of the answers it applies to (how many in brackets).

## Each question

| Question | Marks | Claude Code, no tools: right · tokens out · $ · s | Claude Code with HexSketch, question drawn: right · tokens out · $ · s |
|---|---|---|---|
| multistep-d1 | 5 | 0/1 · 1280 · 0.019 · 13 | 0/1 · 2815 · 0.065 · 34 |
| multistep-d2 | 5 | 1/1 · 2083 · 0.027 · 18 | 1/1 · 3650 · 0.075 · 38 |
| multistep-d3 | 5 | 1/1 · 1169 · 0.018 · 11 | 1/1 · 2940 · 0.066 · 29 |
| multistep-d4 | 4 | 1/1 · 667 · 0.013 · 7 | 1/1 · 2264 · 0.056 · 25 |
| multistep-d5 | 5 | 1/1 · 774 · 0.014 · 8 | 1/1 · 2434 · 0.058 · 28 |
| multistep-d6 | 5 | 1/1 · 1593 · 0.023 · 18 | 0/1 · 5026 · 0.091 · 45 |
| multistep-d7 | 5 | 1/1 · 651 · 0.013 · 9 | 1/1 · 2441 · 0.059 · 26 |
| multistep-d8 | 5 | 1/1 · 1005 · 0.016 · 11 | 1/1 · 2620 · 0.060 · 28 |
| mechanism-d1 | 5 | 1/1 · 1331 · 0.020 · 13 | 1/1 · 2497 · 0.057 · 28 |
| mechanism-d2 | 5 | 1/1 · 1387 · 0.020 · 13 | 1/1 · 3203 · 0.066 · 32 |
| mechanism-d3 | 5 | 1/1 · 2198 · 0.028 · 20 | 1/1 · 3212 · 0.064 · 30 |
| mechanism-d4 | 5 | 1/1 · 1009 · 0.016 · 10 | 1/1 · 2556 · 0.059 · 27 |
| mechanism-d5 | 5 | 0/1 · 1187 · 0.018 · 13 | 0/1 · 5629 · 0.134 · 52 |
| mechanism-d6 | 5 | 1/1 · 1081 · 0.017 · 11 | 1/1 · 3003 · 0.064 · 33 |
| retrosynthesis-d1 | 5 | 1/1 · 894 · 0.015 · 9 | 1/1 · 2279 · 0.055 · 28 |
| retrosynthesis-d2 | 5 | 1/1 · 1315 · 0.019 · 12 | 1/1 · 2534 · 0.062 · 27 |
| retrosynthesis-d3 | 5 | 1/1 · 523 · 0.015 · 7 | 1/1 · 2090 · 0.056 · 26 |
| retrosynthesis-d4 | 5 | 0/1 · 704 · 0.013 · 9 | 0/1 · 2160 · 0.083 · 24 |
| retrosynthesis-d5 | 5 | 1/1 · 1152 · 0.018 · 11 | 1/1 · 2756 · 0.091 · 31 |
| route-d1 | 5 | 1/1 · 1620 · 0.023 · 13 | 1/1 · 3114 · 0.063 · 31 |
| route-d2 | 5 | 0/1 · 1716 · 0.024 · 14 | 0/1 · 724 · 0.031 · 11 |
| route-d3 | 5 | 0/1 · 882 · 0.015 · 10 | 0/1 · 2183 · 0.052 · 24 |
| structure-d1 | 3 | 1/1 · 1670 · 0.023 · 15 | 1/1 · 1885 · 0.059 · 22 |
| structure-d2 | 2 | 1/1 · 724 · 0.013 · 9 | 1/1 · 3639 · 0.085 · 41 |
| structure-d3 | 3 | 1/1 · 653 · 0.013 · 7 | 1/1 · 2213 · 0.066 · 24 |
| structure-d4 | 2 | 1/1 · 534 · 0.012 · 7 | 1/1 · 1983 · 0.082 · 25 |
| structure-d5 | 2 | 1/1 · 466 · 0.011 · 7 | 1/1 · 3953 · 0.090 · 51 |
| analysis-d1 | 3 | 1/1 · 935 · 0.016 · 9 | 1/1 · 2234 · 0.055 · 26 |
| analysis-d2 | 3 | 1/1 · 339 · 0.010 · 6 | 1/1 · 1788 · 0.050 · 20 |
| analysis-d3 | 3 | 1/1 · 628 · 0.013 · 8 | 1/1 · 1809 · 0.049 · 20 |
| analysis-d4 | 3 | 1/1 · 912 · 0.015 · 10 | 1/1 · 2096 · 0.056 · 23 |
| analysis-d5 | 2 | 1/1 · 362 · 0.010 · 7 | 1/1 · 1680 · 0.048 · 19 |
| hazard-d1 | 5 | 1/1 · 1687 · 0.023 · 18 | 1/1 · 2788 · 0.064 · 31 |
| hazard-d2 | 5 | 1/1 · 1400 · 0.020 · 14 | 1/1 · 2514 · 0.058 · 25 |
| hazard-d3 | 5 | 1/1 · 1509 · 0.021 · 15 | 1/1 · 2626 · 0.060 · 28 |
| hazard-d4 | 5 | 1/1 · 1885 · 0.025 · 19 | 1/1 · 2871 · 0.063 · 32 |
| hazard-d5 | 5 | 1/1 · 1835 · 0.025 · 18 | 1/1 · 2749 · 0.058 · 30 |
| hazard-d6 | 5 | 1/1 · 1776 · 0.024 · 18 | 1/1 · 2839 · 0.063 · 32 |
| hazard-d7 | 5 | 1/1 · 1282 · 0.019 · 14 | 1/1 · 2473 · 0.061 · 31 |
