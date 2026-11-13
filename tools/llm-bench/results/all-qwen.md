# all-qwen

qwen/qwen3.7-flash (served as qwen/qwen3.7-flash, via Alibaba), effort medium, 3 repeats of 45 questions worth 174 marks. Total cost $0.47. 1 runs failed (not measured): run again with --run all-qwen.

| | Without HexSketch | With HexSketch |
|---|---|---|
| **Score** | **69.7 / 174 (65–76)** | **65.3 / 174 (52–73)** |
| reaction | 32.0 / 80 | 28.0 / 80 |
| multistep | 8.3 / 20 | 8.3 / 20 |
| mechanism | 1.7 / 10 | 1.7 / 10 |
| retrosynthesis | 5.0 / 20 | 0.0 / 20 |
| structure | 6.0 / 14 | 10.7 / 14 |
| analysis | 10.0 / 15 | 10.0 / 15 |
| hazard | 6.7 / 15 | 6.7 / 15 |
| Correct | 41% (135) | 43% (134) |
| Right compound, wrong stereochemistry | 1% (135) | 1% (134) |
| Valid structures | 69% (135) | 93% (134) |
| Name matches structure | 37% (90) | 73% (89) |
| Unchanged part kept | 89% (70) | 80% (92) |
| Hazard flagged | 83% (12) | 100% (12) |
| Drawn the same way round | 45% (65) | 83% (82) |
| Refused | 0 | 0 |
| Cut off at the token limit, no answer | 30 | 0 |
| cost / question | $0.002 | $0.001 |
| input tokens / question (from cache) | 144 (0) | 30697 (23316) |
| output tokens / question (thinking) | 18027 (17654) | 5885 (5270) |
| median time | 181 s | 62 s |
| tool calls / question | 0.0 | 2.0 |

Score: marks for answers that are right, averaged over the repeats (range in brackets). Each measure is the share of the answers it applies to (how many in brackets).

## Each question

| Question | Marks | Without HexSketch: right · tokens out · $ · s | With HexSketch: right · tokens out · $ · s |
|---|---|---|---|
| reaction-1 | 4 | 0/3 · 9946 · 0.001 · 104 | 0/3 · 6052 · 0.001 · 72 |
| reaction-2 | 4 | 0/3 · 10189 · 0.001 · 106 | 1/3 · 5390 · 0.001 · 63 |
| reaction-3 | 4 | 0/3 (2 cut off) · 23264 · 0.003 · 222 | 2/3 · 3744 · 0.001 · 45 |
| reaction-4 | 4 | 0/3 (2 cut off) · 30819 · 0.004 · 311 | 1/3 · 4763 · 0.001 · 57 |
| reaction-5 | 4 | 3/3 · 13814 · 0.002 · 182 | 2/3 · 5386 · 0.001 · 71 |
| reaction-6 | 4 | 3/3 · 6856 · 0.001 · 77 | 2/3 · 4696 · 0.001 · 57 |
| reaction-7 | 4 | 3/3 · 22783 · 0.003 · 219 | 1/3 · 10252 · 0.002 · 118 |
| reaction-h1 | 4 | 1/3 · 18249 · 0.002 · 187 | 0/3 · 5141 · 0.001 · 59 |
| reaction-h2 | 4 | 3/3 · 9112 · 0.001 · 99 | 3/3 · 3140 · 0.001 · 40 |
| reaction-h3 | 4 | 0/3 (1 cut off) · 18074 · 0.002 · 195 | 0/3 · 6123 · 0.001 · 143 |
| reaction-h4 | 4 | 2/3 · 16732 · 0.002 · 184 | 0/3 · 3159 · 0.001 · 43 |
| reaction-h5 | 4 | 3/3 · 12541 · 0.002 · 133 | 3/3 · 2806 · 0.001 · 35 |
| reaction-h6 | 4 | 1/3 · 22881 · 0.003 · 243 | 1/3 · 4324 · 0.001 · 55 |
| reaction-h7 | 4 | 1/3 (1 cut off) · 25884 · 0.003 · 258 | 1/3 · 9916 · 0.002 · 142 |
| reaction-h8 | 4 | 0/3 (2 cut off) · 30870 · 0.004 · 319 | 0/3 · 6547 · 0.001 · 82 |
| reaction-h9 | 4 | 1/3 · 18703 · 0.002 · 195 | 2/3 · 6164 · 0.001 · 84 |
| reaction-h10 | 4 | 0/3 (1 cut off) · 23173 · 0.003 · 237 | 0/3 · 7404 · 0.001 · 102 |
| reaction-h11 | 4 | 0/3 (2 cut off) · 28656 · 0.004 · 287 | 1/3 · 5350 · 0.001 · 70 |
| reaction-h12 | 4 | 2/3 (1 cut off) · 17534 · 0.002 · 185 | 1/2 · 9478 · 0.002 · 104 |
| reaction-h13 | 4 | 1/3 (2 cut off) · 30840 · 0.004 · 315 | 0/3 · 6536 · 0.001 · 82 |
| multistep-1 | 5 | 2/3 (1 cut off) · 25610 · 0.003 · 259 | 2/3 · 11666 · 0.002 · 120 |
| multistep-2 | 5 | 3/3 · 20965 · 0.003 · 213 | 2/3 · 6912 · 0.001 · 72 |
| multistep-3 | 5 | 0/3 (1 cut off) · 15494 · 0.002 · 152 | 0/3 · 5731 · 0.001 · 63 |
| multistep-h1 | 5 | 0/3 (2 cut off) · 28600 · 0.004 · 281 | 1/3 · 5761 · 0.001 · 86 |
| mechanism-1 | 5 | 0/3 · 8847 · 0.001 · 96 | 1/3 · 10833 · 0.002 · 126 |
| mechanism-2 | 5 | 1/3 (1 cut off) · 23637 · 0.003 · 240 | 0/3 · 10764 · 0.002 · 127 |
| retrosynthesis-1 | 5 | 1/3 (1 cut off) · 22594 · 0.003 · 304 | 0/3 · 5455 · 0.001 · 65 |
| retrosynthesis-2 | 5 | 0/3 (2 cut off) · 22956 · 0.003 · 229 | 0/3 · 5581 · 0.001 · 73 |
| retrosynthesis-3 | 5 | 0/3 (1 cut off) · 14910 · 0.002 · 155 | 0/3 · 14914 · 0.004 · 220 |
| retrosynthesis-h1 | 5 | 2/3 · 23045 · 0.003 · 245 | 0/3 · 6366 · 0.001 · 77 |
| structure-1 | 2 | 2/3 (1 cut off) · 27969 · 0.004 · 286 | 3/3 · 3019 · 0.001 · 32 |
| structure-2 | 2 | 1/3 · 19435 · 0.003 · 185 | 3/3 · 9179 · 0.002 · 104 |
| structure-3 | 2 | 2/3 · 11098 · 0.001 · 123 | 1/3 · 3954 · 0.001 · 46 |
| structure-4 | 2 | 0/3 (3 cut off) · 32000 · 0.004 · 329 | 3/3 · 6329 · 0.001 · 86 |
| structure-5 | 2 | 3/3 · 4712 · 0.001 · 47 | 3/3 · 2667 · 0.001 · 33 |
| structure-h1 | 2 | 0/3 (1 cut off) · 19948 · 0.003 · 216 | 0/3 · 5314 · 0.001 · 69 |
| structure-h2 | 2 | 1/3 (2 cut off) · 30981 · 0.004 · 310 | 3/3 · 1020 · 0.000 · 13 |
| analysis-1 | 3 | 2/3 · 15541 · 0.002 · 166 | 2/3 · 3849 · 0.001 · 50 |
| analysis-2 | 3 | 0/3 · 11920 · 0.002 · 126 | 1/3 · 4104 · 0.001 · 52 |
| analysis-3 | 3 | 3/3 · 3571 · 0.000 · 42 | 3/3 · 2992 · 0.001 · 34 |
| analysis-4 | 3 | 2/3 · 9339 · 0.001 · 94 | 1/3 · 5183 · 0.001 · 63 |
| analysis-h1 | 3 | 3/3 · 12849 · 0.002 · 137 | 3/3 · 4626 · 0.001 · 53 |
| hazard-1 | 5 | 1/3 · 3840 · 0.001 · 45 | 1/3 · 3653 · 0.001 · 50 |
| hazard-2 | 5 | 0/3 · 6169 · 0.001 · 71 | 0/3 · 4995 · 0.001 · 68 |
| hazard-h1 | 5 | 3/3 · 4247 · 0.001 · 48 | 3/3 · 4790 · 0.001 · 71 |
