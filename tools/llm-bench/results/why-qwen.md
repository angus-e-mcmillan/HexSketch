# why-qwen

qwen/qwen3.7-flash (served as qwen/qwen3.7-flash, via Alibaba), effort medium, 2 repeats of 16 questions worth 62 marks. Total cost $0.18.

| | Without HexSketch | The drawing described, no tools | HexSketch's instructions, no tools | With HexSketch |
|---|---|---|---|---|
| **Score** | **20.0 / 62 (19–21)** | **22.5 / 62 (19–26)** | **19.0 / 62 (14–24)** | **22.0 / 62 (19–25)** |
| reaction | 6.0 / 20 | 4.0 / 20 | 4.0 / 20 | 6.0 / 20 |
| multistep | 2.5 / 10 | 5.0 / 10 | 5.0 / 10 | 2.5 / 10 |
| mechanism | 0.0 / 5 | 0.0 / 5 | 0.0 / 5 | 0.0 / 5 |
| retrosynthesis | 0.0 / 10 | 2.5 / 10 | 0.0 / 10 | 0.0 / 10 |
| structure | 3.0 / 6 | 5.0 / 6 | 3.0 / 6 | 5.0 / 6 |
| analysis | 6.0 / 6 | 6.0 / 6 | 4.5 / 6 | 6.0 / 6 |
| hazard | 2.5 / 5 | 0.0 / 5 | 2.5 / 5 | 2.5 / 5 |
| Correct | 38% (32) | 44% (32) | 34% (32) | 44% (32) |
| Right compound, wrong stereochemistry | 0% (32) | 3% (32) | 0% (32) | 3% (32) |
| Valid structures | 66% (32) | 81% (32) | 50% (32) | 88% (32) |
| Name matches structure | 22% (18) | 50% (18) | 33% (18) | 56% (18) |
| Unchanged part kept | 92% (12) | 70% (20) | 77% (13) | 75% (20) |
| Hazard flagged | 100% (2) | 100% (2) | 100% (2) | 100% (2) |
| Drawn the same way round | 55% (11) | 63% (16) | 50% (10) | 74% (19) |
| Refused | 0 | 0 | 0 | 0 |
| Cut off at the token limit, no answer | 9 | 0 | 0 | 0 |
| cost / question | $0.003 | $0.001 | $0.001 | $0.001 |
| input tokens / question (from cache) | 146 (0) | 247 (0) | 1295 (124) | 31047 (21204) |
| output tokens / question (thinking) | 19257 (18909) | 7141 (6814) | 8690 (8415) | 5174 (4497) |
| median time | 214 s | 57 s | 74 s | 53 s |
| tool calls / question | 0.0 | 0.0 | 0.0 | 1.9 |

Score: marks for answers that are right, averaged over the repeats (range in brackets). Each measure is the share of the answers it applies to (how many in brackets).

## Each question

| Question | Marks | Without HexSketch: right · tokens out · $ · s | The drawing described, no tools: right · tokens out · $ · s | HexSketch's instructions, no tools: right · tokens out · $ · s | With HexSketch: right · tokens out · $ · s |
|---|---|---|---|---|---|
| reaction-1 | 4 | 0/2 (2 cut off) · 32000 · 0.004 · 298 | 0/2 · 7551 · 0.001 · 75 | 0/2 · 5623 · 0.001 · 62 | 0/2 · 7037 · 0.001 · 82 |
| reaction-4 | 4 | 1/2 (1 cut off) · 26491 · 0.003 · 255 | 0/2 · 14261 · 0.002 · 138 | 2/2 · 6801 · 0.001 · 79 | 1/2 · 5421 · 0.001 · 62 |
| reaction-6 | 4 | 2/2 · 4556 · 0.001 · 49 | 2/2 · 7489 · 0.001 · 77 | 0/2 · 4094 · 0.001 · 50 | 2/2 · 3731 · 0.001 · 41 |
| reaction-h3 | 4 | 0/2 · 30336 · 0.004 · 302 | 0/2 · 6250 · 0.001 · 68 | 0/2 · 23876 · 0.003 · 250 | 0/2 · 7408 · 0.002 · 85 |
| reaction-h7 | 4 | 0/2 (1 cut off) · 26421 · 0.003 · 255 | 0/2 · 6258 · 0.001 · 63 | 0/2 · 19750 · 0.003 · 199 | 0/2 · 5478 · 0.001 · 59 |
| multistep-1 | 5 | 1/2 · 26298 · 0.003 · 255 | 1/2 · 5921 · 0.001 · 63 | 2/2 · 18546 · 0.002 · 175 | 1/2 · 6577 · 0.001 · 68 |
| multistep-3 | 5 | 0/2 (1 cut off) · 19787 · 0.003 · 191 | 1/2 · 14752 · 0.002 · 138 | 0/2 · 8370 · 0.001 · 87 | 0/2 · 5035 · 0.001 · 51 |
| mechanism-1 | 5 | 0/2 (1 cut off) · 20641 · 0.003 · 208 | 0/2 · 4960 · 0.001 · 51 | 0/2 · 6747 · 0.001 · 79 | 0/2 · 13103 · 0.003 · 136 |
| retrosynthesis-1 | 5 | 0/2 · 25846 · 0.003 · 248 | 1/2 · 17938 · 0.002 · 190 | 0/2 · 6295 · 0.001 · 66 | 0/2 · 6160 · 0.001 · 71 |
| retrosynthesis-3 | 5 | 0/2 · 5883 · 0.001 · 59 | 0/2 · 7226 · 0.001 · 76 | 0/2 · 4305 · 0.001 · 46 | 0/2 · 4661 · 0.001 · 49 |
| structure-1 | 2 | 2/2 · 6134 · 0.001 · 63 | 2/2 · 2445 · 0.000 · 23 | 1/2 · 4877 · 0.001 · 49 | 2/2 · 1059 · 0.000 · 15 |
| structure-4 | 2 | 1/2 (1 cut off) · 19078 · 0.002 · 189 | 1/2 · 4390 · 0.001 · 44 | 0/2 · 8474 · 0.001 · 89 | 1/2 · 3765 · 0.001 · 39 |
| structure-h2 | 2 | 0/2 (2 cut off) · 32000 · 0.004 · 301 | 2/2 · 2551 · 0.000 · 26 | 2/2 · 2899 · 0.000 · 31 | 2/2 · 743 · 0.000 · 9 |
| analysis-1 | 3 | 2/2 · 19263 · 0.003 · 201 | 2/2 · 4694 · 0.001 · 50 | 1/2 · 4868 · 0.001 · 58 | 2/2 · 3807 · 0.001 · 44 |
| analysis-4 | 3 | 2/2 · 6233 · 0.001 · 61 | 2/2 · 4021 · 0.001 · 39 | 2/2 · 5826 · 0.001 · 62 | 2/2 · 5699 · 0.001 · 63 |
| hazard-1 | 5 | 1/2 · 7152 · 0.001 · 81 | 0/2 · 3545 · 0.000 · 42 | 1/2 · 7691 · 0.001 · 90 | 1/2 · 3110 · 0.001 · 36 |
