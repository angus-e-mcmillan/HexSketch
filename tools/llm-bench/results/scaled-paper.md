# scaled-paper

nvidia/nemotron-3.5-super-vl:free (served as nvidia/nemotron-3.5-super-vl:free, via Nvidia), effort medium (with HexSketch: as hexsketch.com, effort low, at most 16384 tokens a turn, thinking not sent back), 1 repeat of 26 questions worth 100 marks. Total cost $0.00.

| | Without HexSketch | With HexSketch |
|---|---|---|
| **Score** | **92.0 / 100** | **77.0 / 100** |
| reaction | 20.0 / 28 | 20.0 / 28 |
| multistep | 15.0 / 15 | 15.0 / 15 |
| mechanism | 10.0 / 10 | 5.0 / 10 |
| retrosynthesis | 15.0 / 15 | 10.0 / 15 |
| structure | 10.0 / 10 | 10.0 / 10 |
| analysis | 12.0 / 12 | 12.0 / 12 |
| hazard | 10.0 / 10 | 5.0 / 10 |
| Correct | 92% (26) | 81% (26) |
| Right compound, wrong stereochemistry | 0% (26) | 0% (26) |
| Valid structures | 92% (26) | 88% (26) |
| Name matches structure | 87% (15) | 87% (15) |
| Unchanged part kept | 100% (15) | 100% (14) |
| Hazard flagged | 100% (2) | 100% (2) |
| Drawn the same way round | 40% (15) | 86% (14) |
| Refused | 0 | 0 |
| Cut off at the token limit, no answer | 2 | 3 |
| cost / question | $0.000 | $0.000 |
| input tokens / question (from cache) | 146 (0) | 14889 (8839) |
| output tokens / question (thinking) | 16153 (16076) | 9227 (8884) |
| median time | 136 s | 61 s |
| tool calls / question | 0.0 | 1.1 |

Score: marks for answers that are right, averaged over the repeats. Each measure is the share of the answers it applies to (how many in brackets).

## Each question

| Question | Marks | Without HexSketch: right · tokens out · $ · s | With HexSketch: right · tokens out · $ · s |
|---|---|---|---|
| reaction-1 | 4 | 0/1 (1 cut off) · 32000 · 0.000 · 270 | 0/1 (1 cut off) · 16384 · 0.000 · 120 |
| reaction-2 | 4 | 1/1 · 15231 · 0.000 · 136 | 1/1 · 11387 · 0.000 · 82 |
| reaction-3 | 4 | 1/1 · 18221 · 0.000 · 172 | 1/1 · 3779 · 0.000 · 29 |
| reaction-4 | 4 | 0/1 (1 cut off) · 32000 · 0.000 · 228 | 0/1 (1 cut off) · 16384 · 0.000 · 120 |
| reaction-5 | 4 | 1/1 · 14811 · 0.000 · 123 | 1/1 · 7203 · 0.000 · 85 |
| reaction-6 | 4 | 1/1 · 10096 · 0.000 · 98 | 1/1 · 2137 · 0.000 · 19 |
| reaction-7 | 4 | 1/1 · 19499 · 0.000 · 185 | 1/1 · 6248 · 0.000 · 72 |
| multistep-1 | 5 | 1/1 · 22690 · 0.000 · 191 | 1/1 · 14479 · 0.000 · 113 |
| multistep-2 | 5 | 1/1 · 30671 · 0.000 · 294 | 1/1 · 10741 · 0.000 · 135 |
| multistep-3 | 5 | 1/1 · 14121 · 0.000 · 137 | 1/1 · 7497 · 0.000 · 54 |
| mechanism-1 | 5 | 1/1 · 9469 · 0.000 · 76 | 1/1 · 26663 · 0.000 · 298 |
| mechanism-2 | 5 | 1/1 · 21610 · 0.000 · 211 | 0/1 (1 cut off) · 16384 · 0.000 · 175 |
| retrosynthesis-1 | 5 | 1/1 · 7168 · 0.000 · 59 | 1/1 · 5290 · 0.000 · 63 |
| retrosynthesis-2 | 5 | 1/1 · 21086 · 0.000 · 212 | 0/1 · 5379 · 0.000 · 58 |
| retrosynthesis-3 | 5 | 1/1 · 24842 · 0.000 · 273 | 1/1 · 2866 · 0.000 · 19 |
| structure-1 | 2 | 1/1 · 29740 · 0.000 · 256 | 1/1 · 5259 · 0.000 · 35 |
| structure-2 | 2 | 1/1 · 12989 · 0.000 · 96 | 1/1 · 5183 · 0.000 · 49 |
| structure-3 | 2 | 1/1 · 7179 · 0.000 · 64 | 1/1 · 6415 · 0.000 · 50 |
| structure-4 | 2 | 1/1 · 18937 · 0.000 · 173 | 1/1 · 26618 · 0.000 · 207 |
| structure-5 | 2 | 1/1 · 5831 · 0.000 · 49 | 1/1 · 2076 · 0.000 · 14 |
| analysis-1 | 3 | 1/1 · 5676 · 0.000 · 49 | 1/1 · 9671 · 0.000 · 107 |
| analysis-2 | 3 | 1/1 · 6952 · 0.000 · 47 | 1/1 · 12730 · 0.000 · 93 |
| analysis-3 | 3 | 1/1 · 6351 · 0.000 · 54 | 1/1 · 6829 · 0.000 · 58 |
| analysis-4 | 3 | 1/1 · 8607 · 0.000 · 81 | 1/1 · 2325 · 0.000 · 16 |
| hazard-1 | 5 | 1/1 · 4557 · 0.000 · 43 | 1/1 · 5313 · 0.000 · 40 |
| hazard-2 | 5 | 1/1 · 19646 · 0.000 · 162 | 0/1 · 4651 · 0.000 · 37 |
