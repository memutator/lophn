# call-list-without-session: 실행 기록

runner: lead session(claude-opus-5-5). 채점은 item마다 새 subagent `haiku-xhigh`(`claude-haiku-5-5`). 답한 질문은 없다(사람 역할이 든 시나리오가 없다).

## 기준 run

- lead worktree(plan branch = main `243db6864`)에서 `deno run --allow-all --env-file=<main checkout>/.env tests/eval/run.ts --scenario <17개> --budget 3`. 판단 case 17개, trial 1, $0.4956.
- 그보다 앞서 main checkout에서 돌린 17개(합 $0.43)도 commit했다. 그 가운데 Operator 넷(O4, O6, O7, T19-op)은 core@5라 낡았고, 나머지 열셋은 core@6이라 기준에 같이 들었다(`result.json`의 baseline trial이 2인 것).
- 채점: 기준 run의 judge item 17건(두 번에 걸쳐)을 넣었다.

## experiment

명령: `deno run --allow-all --env-file=<main checkout>/.env tests/eval/run.ts experiment call-list-without-session --checkout .claude/worktrees/exp-call-list`(variant commit `bcf8f6848`, spec commit `a0e4152af` 위).

| 시도 | 시각 | 종료 | 결과 |
|---|---|---|---|
| 1 | 13:34–13:40 | 1 | gate `check ok 23s`, `e2e failed 335s`(앱 E2E 11개). variant의 `.dev-data/e2e/deno-dir`이 지금 checkout으로 가는 symlink였고, release 준비의 esbuild가 `child.unref` 오류로 떨어졌다. symlink를 지우고 variant에서 `deno task e2e:deps`를 돌린 뒤 다시 돌렸다(`project-docs/issues/eval.md`) |
| 2 | 13:43–13:55 | 0 | gate `check ok 16s`, `e2e ok 514s`, `dry-run ok 81s`. `[estimate] trials 19..51 (likely 27) $0.89 (budget $5)`. `[verdict] reject` |
| 3 | 채점 뒤 | 1 | `판정이 이미 났다(reject)` |

- `[change] runtime:runtime@2 -> @3  mixed: core:core@6 -> @7`
- `[warn] 내용을 못 봐서 경고를 못 낸다`(runtime은 코드라 registry에 글이 없다)
- 판정이 난 뒤 variant의 채점 대기 13건을 넣었다. `result.json`은 판정 때의 것이라 guard 줄에 "채점 대기"가 그대로 남아 있다.

## 판정

`reject`(`default@1`), `mixed: true`

```
reject: target 1/2 ok, case 0/2 ok, guard 5/13 ok
target A14-other: variant 0/1, baseline 0/2: 통과하지 못했다
case A12: variant 0/1, baseline 0/2: 통과하지 못했다
case C9-other: variant 0/1, baseline 0/2: 통과하지 못했다
섞인 변경이다: core:core@6→core:core@7
```

| 시나리오 | 역할 | 기준 통과/trial | variant 통과/trial | status |
|---|---|---|---|---|
| O4 | target | 0/1 | 3/3 | ok |
| A14-other | target | 0/2 | 0/1 | fail |
| A12 | case | 0/2 | 0/1 | fail |
| C9-other | case | 0/2 | 0/1 | fail |
| A1-ask, C8, L1, L4-app, L5, L8 | guard | 2/2 | 0/0(+1 채점 대기) | incomplete |
| L4-new | guard | 1/2 | 0/0(+3 채점 대기) | incomplete |
| O6 | guard | 0/1 | 0/0(+1 채점 대기) | incomplete |
| L6, T19-lophn | guard | 2/2 | 1/1 | ok |
| O7 | guard | 1/1 | 1/1 | ok |
| L7 | guard | 0/2 | 0/1 | ok |
| T19-op | guard | 0/1 | 0/1 | ok |

판정 뒤 넣은 variant 채점: O4 `relays-request` 3건 `some_missing`, L4-new 3건 중 `all` 2·`some_missing` 1, A1-ask·L1 `asks_gap`, C8·L4-app·L5·L8·O6 `all`.

## 비용

experiment `cost_usd` $0.5228 / `budget_usd` $5, `stopped_by_budget: false`. 기준 run 합 $0.93. 모두 $1.45.

`overfit`, `repeats`, `assembly`는 `result.json`에 없다.
