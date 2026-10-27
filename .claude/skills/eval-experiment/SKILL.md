---
name: eval-experiment
description: lophn eval experiment의 판정 결과를 해석하고, 떨어진 run을 읽어 원인을 가르고, 의심스러운 judge 판단을 짚고, 다음 spec 초안을 쓸 때 쓴다. experimenter(`claude-opus-5-5`)가 읽을 때. 돌리는 일은 eval-run skill(runner)의 몫이다.
---

# experiment 해석 (experimenter)

experimenter는 program이 낸 판정을 **해석**한다. 판정을 뒤집지 않고, harness를 고치지 않고, eval을 돌리지 않는다. 쓰는 file은 `tests/eval/experiments/<id>/report.md`(와 다음 spec 초안)뿐이다. `run.md`는 runner의 것이라 읽기만 한다. 이유: 사실(runner)과 해석(experimenter)을 한 file에 섞으면 서로 덮어쓴다.

## 읽는 순서

싼 것부터 읽는다. 읽는 만큼 돈이 든다.

1. `spec.json`: `hypothesis`, `change`(바꾼 것), `target`, `cases`(미리 써 둔 같은 규칙), `trials`, `budget_usd`
2. `result.json`: `decision`, `reasons`, `scenarios[]`(`role`, `baseline`, `variant`, `status`, `weaker`, `note`), `mixed`, `changed`, `keep`, `excluded`, `stopped_by_budget`. 칸의 뜻은 `tests/eval/experiment/spec/types.ts`의 주석을 읽는다. 이 skill에 복사하지 않는다(복사본이 낡는다).
3. `run.md`: runner가 적은 사실(gate, 비용, 멈춤, 채점 model)
4. 떨어졌거나 이상한 시나리오의 run 요약 `tests/eval/runs/<run>.json`: check verdict, judge item, 수치. run id는 `result.json`의 `baseline_runs`, `variant_runs`
5. 필요한 trial만 전체 기록: `.dev-data/eval/<run>/trial-<n>.json`(`{ trial, judge, source }`), `trial-<n>.core.log`(core log), `trial-<n>.repeat.json`(되풀이 진단). 크다. 어느 trial을 왜 여는지 정하고 연다.

run 둘을 견줄 때는 `npm run eval:scorecard -- diff <idA> <idB>`가 있다.

## 해석할 것

- `decision`이 `adopt`, `reject`, `inconclusive` 가운데 무엇이고 왜인가(`reasons`). `inconclusive`면 채점 대기, 예산 중단(`stopped_by_budget`), 정책이 더 돌리라는 것(`remaining`) 중 무엇인가.
- target이 나아진 것이 우연이 아닌가. trial 수가 3번까지 늘었나(`variant.trials`).
- guard가 `weaker`(통과율은 낮아졌지만 worse는 아님)인가.
- `mixed`면 `changed`의 다른 component도 같이 바뀐 것이라 섞인 결과로만 읽는다. `excluded`가 있으면 어느 시나리오가 기준에서 빠졌나.
- 미리 쓴 case가 target과 같은 규칙을 정말 시험하나.
- 경고(`overfit`)가 걸린 줄이 일반 규칙인가 시나리오 맞춤인가. `repeats`(같은 호출 되풀이)와 `assembly`(prefix 유지율)는 판정에 들지 않는 진단이다. 있으면 읽는다.

## 원인 가르기

떨어진 trial마다 하나로 정하고 근거를 file과 id로 댄다. 못 정하면 "모름"이라 쓰고 무엇을 더 보면 가려지는지 적는다.

- **model 탓**: 지침을 읽고도 다른 선택을 했고, 같은 버전에서 trial끼리 갈린다. tool 호출은 정상으로 받아들여졌다.
- **제품 탓**: tool이 거절(`invalid_input` 등)하거나 Gate가 막거나 안내 글이 틀렸다. 같은 요청이면 어느 model이라도 막힌다. `configuration_unavailable`이나 `settle`의 timeout처럼 program이 찍은 사실이 이유다.
- **judge 탓**(grader 포함): judge verdict가 program이 확인한 사실과 어긋나거나, 인용이 입력과 맞지 않거나, check가 right fixture에서도 통과하지 않을 모양이다.

## 의심스러운 judge 판단

`report.md`에 따로 적는다. 대상: program 사실과 어긋난 verdict, `cannot_tell`이 몰린 criterion, `quote_found: false`나 `state: "error"`인 item, 같은 입력에서 trial끼리 verdict가 갈린 것. 항목마다 run id, trial, check id, `criterion@n`, verdict, 인용, 왜 의심스러운지를 쓴다. 사람이 같은 입력으로 다시 볼 수 있어야 한다. judge를 직접 다시 부르지 않는다. 이유: 의심은 사람이 따로 검증하기로 했다(채점은 Haiku가 한다).

## 하지 않는 것

- **판정을 뒤집지 않는다.** 판정은 program이 계산한다. 이의가 있으면 `report.md`의 "판정 이의"에 무엇이 어떤 근거로 틀렸는지 쓰고 사람이 정하게 한다. `result.json`을 고치지 않고, 규칙(`default@1`)을 결과에 맞춰 바꾸자고 하지 않는다. 이유: 규칙은 돌리기 전에 정한 것이다.
- **harness를 직접 고치지 않는다.** 다음 고칠 것은 제안으로 쓴다(어느 component, 어느 줄, 왜). 흐름은 experimenter, planner와 사람, 고침 순서다.
- **eval을 돌리지 않는다.** `npm run eval`, `npm run eval:experiment`는 진짜 provider를 불러 돈이 든다. 더 돌려야 하면 `report.md`에 "무엇을 왜 더 돌려야 하나"를 쓴다.
- 새 시나리오를 만들지 않는다(이 계획 밖이다). 필요하면 "이런 case가 필요하다"고 제안으로 쓴다.

## 다음 spec 초안

`tests/eval/experiments/<다음 id>/spec.json`을 `parseSpec`이 받아들이는 꼴로 쓴다(기존 spec.json과 `tests/eval/experiment/spec/parse.ts`를 본보기로). component 참조는 글이다(`instruction:lophn@3`). 초안이라고 `report.md`에 쓴다. 확정과 commit은 planner와 사람이 한다. 이유: runner는 commit되지 않은 spec이나, spec commit 위에 쌓이지 않은 variant를 거절한다.

- 고치기 전에 같은 규칙을 시험하는 **다른 요청의 case**를 `cases`에 먼저 쓴다. 고친 줄에 맞춰 case를 쓰지 않는다. 이유: 시나리오 하나에 맞춘 고침을 걸러 내려는 것이다.
- 판정 규칙과 예산, trial 정책은 돌리기 전에 적는다. 방금 본 결과를 보고 규칙을 고르지 않는다.

## report.md

`tests/eval/experiments/<id>/report.md`. 쓰는 곳은 여기 하나다. 절 이름과 순서를 지킨다.

- `## 판정`: program 결과 한 줄을 인용(`[verdict]` 줄이나 `reasons` 첫 줄)
- `## 해석`: 위 "해석할 것"에 대한 답. 추정은 여기에만 쓴다
- `## 떨어진 것과 원인`: 표. 열은 시나리오 또는 check, run과 trial, 원인(model/제품/judge/모름), 근거. **근거 칸은 file과 id로 댄 사실만** 쓴다. 이유: 사람이 판정과 judge를 의심할 때 근거를 따라갈 수 있어야 한다.
- `## 의심스러운 judge 판단`: 없으면 "없음"
- `## 경고와 진단`: 시나리오 고유 단어, 되풀이 `repeat-kind`, assembly prefix 재기. `result.json`에 있는 것만. 없으면 "없음"
- `## 다음`: 고칠 것 제안, 더 돌릴 것, 다음 spec 초안 경로
- `## 판정 이의`: 없으면 "없음"

## 이 skill이 기대는 것

- 명령: `npm run eval:scorecard -- diff` (`tests/eval/scorecard/main.ts`)
- 기록: `tests/eval/experiments/<id>/{spec,result}.json`, `run.md`(runner), `report.md`(이 skill), `tests/eval/runs/<run>.json`, `.dev-data/eval/<run>/trial-<n>.{json,core.log,repeat.json}`
- 칸 이름: `tests/eval/experiment/spec/types.ts`의 `ExperimentSpec`, `ExperimentResult`, `tests/eval/types.ts`의 `JudgeItem`
- 규칙과 역할: 판정 `default@1`(`tests/eval/experiment/verdict/`), runner와 experimenter 구분(`eval-run` skill)
