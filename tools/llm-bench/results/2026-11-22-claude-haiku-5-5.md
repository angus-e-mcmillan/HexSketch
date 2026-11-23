# 2026-11-22-claude-haiku-5-5

claude-haiku-5-5 (served as claude-haiku-5-5, via Claude Code), effort medium, 1 repeat of 39 questions worth 170 marks. Total cost $0.37.

| | Claude Code, no tools | Claude Code with HexSketch, question drawn |
|---|---|---|
| **Score** | **137.5 / 170** | **128.0 / 170** |
| multistep | 29.0 / 39 | 29.0 / 39 |
| mechanism | 15.0 / 30 | 15.0 / 30 |
| retrosynthesis | 25.0 / 25 | 25.0 / 25 |
| route | 12.5 / 15 | 10.0 / 15 |
| structure | 12.0 / 12 | 12.0 / 12 |
| analysis | 14.0 / 14 | 12.0 / 14 |
| hazard | 30.0 / 35 | 25.0 / 35 |
| Correct | 82% (39) | 74% (39) |
| Right compound, wrong stereochemistry | 0% (39) | 3% (39) |
| Valid structures | 100% (37) | 95% (37) |
| Name matches structure | 58% (12) | 92% (12) |
| Unchanged part kept | 96% (24) | 96% (23) |
| Hazard flagged | 100% (7) | 86% (7) |
| Drawn the same way round | 52% (23) | 58% (19) |
| Refused | 0 | 0 |
| Cut off at the token limit, no answer | 0 | 0 |
| cost / question | $0.002 | $0.007 |
| input tokens / question (from cache) | 3926 (2322) | 61538 (45948) |
| output tokens / question (thinking) | 3331 (0) | 7570 (0) |
| median time | 18 s | 33 s |
| tool calls / question | 0.0 | 3.1 |

Score: marks for answers that are right, averaged over the repeats. Each measure is the share of the answers it applies to (how many in brackets).

## Each question

| Question | Marks | Claude Code, no tools: right · tokens out · $ · s | Claude Code with HexSketch, question drawn: right · tokens out · $ · s |
|---|---|---|---|
| multistep-d1 | 5 | 0/1 · 2474 · 0.002 · 14 | 0/1 · 6384 · 0.007 · 33 |
| multistep-d2 | 5 | 1/1 · 4943 · 0.003 · 25 | 0/1 · 8132 · 0.007 · 40 |
| multistep-d3 | 5 | 1/1 · 3929 · 0.002 · 20 | 1/1 · 6642 · 0.008 · 36 |
| multistep-d4 | 4 | 1/1 · 1437 · 0.001 · 9 | 1/1 · 8614 · 0.010 · 39 |
| multistep-d5 | 5 | 1/1 · 2183 · 0.001 · 13 | 1/1 · 7749 · 0.007 · 38 |
| multistep-d6 | 5 | 1/1 · 5150 · 0.003 · 26 | 1/1 · 9073 · 0.008 · 45 |
| multistep-d7 | 5 | 1/1 · 1567 · 0.001 · 11 | 1/1 · 6582 · 0.006 · 39 |
| multistep-d8 | 5 | 0/1 · 3770 · 0.002 · 19 | 1/1 · 9133 · 0.008 · 50 |
| mechanism-d1 | 5 | 0/1 · 2081 · 0.001 · 13 | 0/1 · 4357 · 0.004 · 22 |
| mechanism-d2 | 5 | 0/1 · 2734 · 0.002 · 16 | 0/1 · 29974 · 0.024 · 143 |
| mechanism-d3 | 5 | 1/1 · 6526 · 0.004 · 31 | 1/1 · 13513 · 0.011 · 64 |
| mechanism-d4 | 5 | 1/1 · 2948 · 0.002 · 17 | 1/1 · 15612 · 0.015 · 76 |
| mechanism-d5 | 5 | 0/1 · 6964 · 0.004 · 35 | 0/1 · 24462 · 0.022 · 106 |
| mechanism-d6 | 5 | 1/1 · 4567 · 0.003 · 24 | 1/1 · 15887 · 0.013 · 69 |
| retrosynthesis-d1 | 5 | 1/1 · 2176 · 0.001 · 15 | 1/1 · 4102 · 0.005 · 26 |
| retrosynthesis-d2 | 5 | 1/1 · 3116 · 0.002 · 15 | 1/1 · 5812 · 0.006 · 29 |
| retrosynthesis-d3 | 5 | 1/1 · 1436 · 0.001 · 10 | 1/1 · 3133 · 0.005 · 20 |
| retrosynthesis-d4 | 5 | 1/1 · 2598 · 0.002 · 15 | 1/1 · 5797 · 0.005 · 27 |
| retrosynthesis-d5 | 5 | 1/1 · 3087 · 0.002 · 16 | 1/1 · 8051 · 0.008 · 42 |
| route-d1 | 5 | 1/1 · 7336 · 0.004 · 34 | 1/1 · 12477 · 0.011 · 60 |
| route-d2 | 5 | 1/1 · 5531 · 0.003 · 27 | 0/1 · 11253 · 0.010 · 60 |
| route-d3 | 5 | 0/1 · 2527 · 0.002 · 22 | 0/1 · 7996 · 0.007 · 43 |
| structure-d1 | 3 | 1/1 · 3473 · 0.002 · 19 | 1/1 · 2232 · 0.003 · 18 |
| structure-d2 | 2 | 1/1 · 3690 · 0.002 · 18 | 1/1 · 2979 · 0.004 · 21 |
| structure-d3 | 3 | 1/1 · 8525 · 0.005 · 40 | 1/1 · 3101 · 0.004 · 23 |
| structure-d4 | 2 | 1/1 · 2029 · 0.001 · 13 | 1/1 · 2967 · 0.004 · 23 |
| structure-d5 | 2 | 1/1 · 1269 · 0.001 · 9 | 1/1 · 2195 · 0.003 · 17 |
| analysis-d1 | 3 | 1/1 · 3588 · 0.002 · 18 | 1/1 · 3254 · 0.004 · 19 |
| analysis-d2 | 3 | 1/1 · 1292 · 0.001 · 9 | 1/1 · 3309 · 0.004 · 24 |
| analysis-d3 | 3 | 1/1 · 1559 · 0.001 · 10 | 1/1 · 5584 · 0.005 · 24 |
| analysis-d4 | 3 | 1/1 · 900 · 0.001 · 6 | 1/1 · 2567 · 0.003 · 19 |
| analysis-d5 | 2 | 1/1 · 555 · 0.001 · 6 | 0/1 · 2640 · 0.003 · 19 |
| hazard-d1 | 5 | 1/1 · 2864 · 0.002 · 16 | 1/1 · 6829 · 0.007 · 40 |
| hazard-d2 | 5 | 1/1 · 3372 · 0.002 · 18 | 1/1 · 3812 · 0.005 · 23 |
| hazard-d3 | 5 | 1/1 · 5105 · 0.003 · 27 | 1/1 · 4227 · 0.005 · 26 |
| hazard-d4 | 5 | 1/1 · 2862 · 0.002 · 18 | 0/1 · 9323 · 0.009 · 40 |
| hazard-d5 | 5 | 0/1 · 2863 · 0.002 · 20 | 0/1 · 4389 · 0.005 · 27 |
| hazard-d6 | 5 | 1/1 · 4108 · 0.002 · 23 | 1/1 · 4752 · 0.006 · 30 |
| hazard-d7 | 5 | 1/1 · 2772 · 0.002 · 18 | 1/1 · 6324 · 0.007 · 38 |
