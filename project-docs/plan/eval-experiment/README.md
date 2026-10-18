# eval-experiment: harness 고침을 검증하는 experiment

- 목표: harness를 고친 것을 experiment 단위로 검증한다.
  - 더하는 것: experiment spec, 바뀐 component를 본 run만 고르기, trial 정책, 병렬 실행과 예산, gate(check → 바뀐 곳 e2e → dry run), 다른 checkout에서 core 띄우기, 판정 규칙, 시나리오 고유 단어 경고, assembly의 prefix 재기, 되풀이 진단 judge, 채점과 사람 역할을 eval을 돌리는 agent로 옮기기, runner와 experimenter가 일하는 법.
- 재료:
  - `project-docs/products/roadmap/eval.md`의 "experiment", "trial 수", "특정 시나리오에 맞추지 않기", "scorecard", "역할과 흐름", "병렬과 의존", "공통 수치"의 assembly 단락.
  - 계획 `eval-base`의 README와 `tasks/*.md`(계약, runner, registry, scorecard), 계획 `eval-coding`의 README(coding agent trial).
  - `project-docs/module-catalog.yaml`(gate가 e2e를 고르는 근거), `project-docs/architecture/testing.md`.
- 범위 밖: 새 시나리오.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `ex-`로 시작한다.
- 순서: spec(wave 1) → 고르기, trial 정책, 판정, variant, gate, 병렬, 경고, assembly, 되풀이, agent 채점, agent 사람 역할(wave 2) → 입구(wave 3) → skill(wave 4) → 문서(lead).
- 시작 조건: 계획 `eval-coding`이 main에 land한 뒤(사람: 순서는 base → coding → experiment). 그 전에는 brief만 있다. land하면 planner가 brief를 실제 코드와 대조해 맞춘 뒤 lead를 띄운다.

## 정한 것

- **experiment 기록**: `tests/eval/experiments/<id>/`에 둔다. spec(`spec.json`), program이 낸 판정(`result.json`), experimenter의 해석(`report.md`)이다. commit한다(agent).
- **spec의 칸**(사람: 채택 규칙, agent: 꼴):
  - 가설과 출발점 run
  - 바꾸는 것(component X@a → X@b)
  - target(시나리오나 check id)
  - 미리 써 둔 같은 규칙의 case
  - 판정 규칙, trial 정책, 예산
  - guard는 쓰지 않는다. run 기록으로 program이 고른다.
- **판정은 program이 계산한다**(사람):
  - 채택하려면 target과 미리 써 둔 case가 모두 통과하고, guard가 기준보다 나빠지지 않아야 한다.
  - experimenter는 해석만 한다. 판정을 뒤집으려면 이유를 적고 사람이 정한다.
- **기준 구성은 main checkout에서 잰 버전이다**: 채택은 고친 것을 main에 넣는 것이다. 따로 기준 file을 두지 않는다(agent).
  - 이유: git이 이미 그 일을 한다.
- **trial 정책**(사람: 늘 3번씩 돌리지 않는다, agent: 규칙):
  - 기본은 1번이다.
  - guard가 기준과 다른 verdict를 내면 그 case만 3번까지 늘린다.
  - target이 통과하면 3번까지 늘려 확인한다.
  - 같은 버전에서 trial끼리 결과가 갈린 적이 있는 시나리오는 처음부터 3번 돈다.
- **variant**: `--checkout <path>`로 core를 다른 checkout(worktree)에서 띄운다. grader는 지금 checkout에서 쓴다(agent, roadmap).
- **병렬과 예산**(사람: 넉넉하게):
  - trial마다 root와 port가 따로라 동시에 돈다. 동시 수는 판단 case 4개, coding agent trial 2개다.
  - experiment 하나에 예산 하나(기본 $100)다. 넘으면 새 trial을 띄우지 않는다.
- **gate**: 다음 순서로 돈다(agent).
  1. `deno task check`
  2. 바뀐 component의 module(`module-catalog.yaml`)에 걸린 e2e만
  3. 고른 시나리오의 dry run(fake provider로 되살리기와 fixture 확인)
- **시나리오 고유 단어 경고**: 바꾼 글의 더해진 줄에 시나리오의 앱 이름, project 이름, 사람 말에서 따온 구절이 들어가면 runner가 경고한다(agent).
- **assembly의 prefix 재기**(agent, roadmap "공통 수치"):
  - run 전체 기록의 model 답을 fake provider로 되돌려 주며 새 checkout으로 다시 조립한다.
  - layer별 prefix hash가 앞 call과 같은 비율을 낸다.
  - 진짜 cache hit은 그 뒤 작은 진짜 run으로 본다.
- **채점과 사람 역할은 eval을 돌리는 agent가 맡는다**(사람). 지금은 runner가 `.env`의 key로 Haiku를 따로 부른다(`tests/eval/judge/run.ts`, `tests/eval/human/answer.ts`). 그 길을 지우고 아래로 바꾼다. 옛 길은 남기지 않는다(AGENTS.md "호환성"). `.env`의 key는 core의 role agent만 쓴다.
  - **채점**: program은 trial 뒤에 judge item(criterion@n, verdict enum, 쪼인 입력)을 "채점 대기"로 file에 둔다. 돌리는 agent가 item마다 **새 subagent**를 띄워 그 item과 채점 안내 글(`tests/eval/judge/prompt.md`)만 보고 채점하게 한 뒤, `deno task eval:judge <run>`으로 verdict와 인용을 적는다(사람). program은 enum 밖의 답과 입력에 없는 인용을 지금처럼 걸러 낸다. 채점이 다 들어오기 전의 judge check는 scorecard에서 "채점 대기"로 따로 보인다(agent).
  - **judge 버전**: `judge@n`은 채점 안내 글(prompt)의 버전이다. 채점한 model은 item마다 기록한다. 다른 model이 채점한 run은 grader가 달라 따로 보인다(agent).
  - **사람 역할**: App Engineer가 물으면 runner가 질문을 찍고 "답 대기"로 file에 둔다. 돌리는 agent가 질문마다 새 subagent를 띄워 질문, 시나리오의 요구 카드, 그 trial에서 앞서 한 답만 보고 답하게 한 뒤, `deno task eval:answer`로 넣는다. 이것이 제품의 `askAnswer` route를 부른다. 허락은 지금처럼 program 규칙이다(사람).
  - 잃는 것: program만으로는 run이 끝나지 않는다. 채점이 대기로 남고, 질문은 agent가 답할 때까지 기다린다.
- **되풀이 judge**(`repeat-kind@1`): check가 아니라 진단 판단이다(agent).
  - trial에 같은 tool을 같은 인자로 3번 이상 부른 곳이 있으면, 다른 judge item처럼 "채점 대기"로 두고 돌리는 agent가 채점해 보고서에 넣는다.
  - 통과에 들지 않는다.
- **runner와 experimenter는 개발 쪽 agent다**(사람):
  - runner는 eval을 돌리는 agent session이다. 지금은 lead(Opus)이고, 뒤에는 더 싼 session에 맡긴다. eval CLI를 돌리고 진행을 보고, 질문에 답하고 채점하고, 보고서를 쓴다.
  - experimenter는 `claude-opus-5-5`다. 해석, 원인 가르기, 다음 spec 초안을 맡는다.
  - 일하는 법은 skill 둘로 둔다(agent).
- **상한은 program이 지킨다**(agent).

## 사람이 정할 것

- 없음.

## lead가 할 일

- merge 때마다 등록 file을 고친다:
  - `deno.json`의 `eval:experiment`, `eval:gate` task
  - `fmt.exclude`에 `tests/eval/experiments/`의 JSON
  - skill을 `project-docs/context-component-registry.yaml`에 올린다
- 끝나면:
  - `project-docs/architecture/eval.md`에 experiment를 더한다.
  - `project-docs/products/change-log/`의 열린 판에 덧붙인다.
  - roadmap "단계"에서 이 계획 몫을 지운다.
  - 첫 experiment 하나를 손으로 돌려 본다. 예: lophn instruction 한 줄 고침. 그 기록을 commit한다.

## task

| id | wave | 선행 | 소유 | 하는 일 |
|---|---|---|---|---|
| `ex-spec` | 1 | 없음 | `tests/eval/experiment/spec/**`, `tests/eval/types.ts`(`TrialResult.components`) | spec 꼴, 읽기, 검사, 기록 file(`spec.json`, `result.json`, `report.md`)의 꼴 |
| `ex-select` | 2 | ex-spec | `tests/eval/experiment/select/**` | run 기록의 본 component로 다시 돌릴 run 고르기(target, guard, 그대로 씀), 기준 run 다시 쓰기 |
| `ex-trials` | 2 | ex-spec | `tests/eval/experiment/trials/**` | trial 정책과 흔들리는 시나리오 찾기 |
| `ex-verdict` | 2 | ex-spec | `tests/eval/experiment/verdict/**` | 판정 규칙 계산과 채택·기각 결과 |
| `ex-variant` | 2 | 없음 | `tests/eval/experiment/variant/**`, `tests/support/core/{mod,process}.ts`(core를 띄울 checkout), `tests/eval/versions/**`(variant의 글, 필요할 때만) | 다른 checkout에서 core 띄우기 |
| `ex-gate` | 2 | ex-spec | `tests/eval/experiment/gate/**` | gate 세 단계 |
| `ex-parallel` | 2 | 없음 | `tests/eval/experiment/parallel/**` | 동시 수와 같이 쓰는 예산이 있는 trial pool |
| `ex-overfit` | 2 | ex-spec | `tests/eval/experiment/overfit/**` | 시나리오 고유 단어 경고 |
| `ex-assembly` | 2 | ex-spec | `tests/eval/experiment/assembly/**` | 녹화한 model 답으로 다시 조립해 prefix 유지 재기 |
| `ex-repeat` | 2 | ex-spec, ex-judge-agent | `tests/eval/experiment/repeat/**`, `tests/eval/criteria/repeat-kind.json`, `tests/eval/criteria/mod.ts`(필요할 때만) | 되풀이 진단 judge. 채점 대기 item으로 두고 돌리는 agent가 채점한다 |
| `ex-judge-agent` | 2 | ex-spec | `tests/eval/judge/**`, `tests/eval/scorecard/**`(채점 대기 보이기), `tests/eval/runner/trial.ts`(judge 덩어리만) | judge를 key 호출에서 agent 채점으로: 채점 대기 item file, `deno task eval:judge`(enum과 인용 확인 후 기록), 채점한 model 기록, `judge/run.ts`의 fetch 지우기 |
| `ex-human-agent` | 2 | ex-spec, ex-judge-agent | `tests/eval/human/**`, `tests/eval/runner/trial.ts`(사람 역할 덩어리만) | 사람 역할을 key 호출에서 agent 답으로: 답 대기 질문 file, `deno task eval:answer`(답 file을 쓰고 trial을 쥔 runner가 다음 tick에 `askAnswer`를 부른다), `human/answer.ts`의 fetch 지우기 |
| `ex-cli` | 3 | ex-select, ex-trials, ex-verdict, ex-variant, ex-gate, ex-parallel, ex-overfit, ex-assembly, ex-repeat, ex-judge-agent, ex-human-agent | `tests/eval/run.ts`, `tests/eval/runner/**`, `tests/eval/experiment/mod.ts`, `tests/eval/types.ts`(쓰지 않게 된 `cost_usd` 칸 지우기), `tests/eval/scorecard/**`(그 칸의 합 지우기) | `deno task eval:experiment <id>`와 `eval:gate`. 위 조각을 runner에 잇는다 |
| `ex-skills` | 4 | ex-cli | `.claude/skills/eval-run/**`, `.claude/skills/eval-experiment/**` | runner(Haiku)와 experimenter(Opus)가 일하는 법 |
