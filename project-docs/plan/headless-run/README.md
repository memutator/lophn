# headless-run: lophn agent와 앱 tool을 화면 없이 부른다

- **목표:** `claude -p`나 `codex exec`처럼 lophn agent를 화면 없이 부르는 run을 만든다. run은 agent 호출 하나 또는 앱 tool 호출 하나이고, 비동기로 쓴다. core의 run 연산과 사람이 쓰는 CLI를 둔다.
- **재료:**
  - roadmap `project-docs/products/roadmap/headless-schedule.md`("모양"의 agent 호출과 run, "무엇을 만드나" 1, "정한 것", "권한")
  - roadmap `approval.md`(unattended mode)
  - architecture: `place-session.md`, `agent-call.md`, `event.md`, `coding-agent.md`(CLI와 연결), `agent-definition.md`, `layers.md`
- **범위 밖:** job과 scheduler(`schedule-job`), workflow(`workflow`), flow, eval과 e2e test(사람).
- **돌리는 방식:** worker(`sonnet-high`). orchestrate skill대로 한다. task id는 `hr-`로 시작한다.
- **시작 조건:** `approval-simplify`가 land했다. run의 turn은 unattended이고, 그 mode를 그 계획이 만든다. 실제로는 `ae-builds`, `reactor-remove`, `agent-definition`이 land하고 e2e와 eval을 되살린 뒤에 연다(사람, 2026-10-21).
- **brief의 기준:** brief는 2026-10-21 main(`e192a9d8c`) 기준으로 썼다. 앞 계획(`problem-remove`, `approval-simplify`)이 land하면 planner가 path와 계약을 다시 맞춘 뒤 연다.

## 정한 것

roadmap `headless-schedule.md`의 "정한 것"을 따른다. 정리하면 이렇다.

- run의 끝은 그 입력이 연 turn의 끝이다. 답은 그 turn의 마지막 답이다.
- 호출마다 새 session이다. 이어 쓰려면 `--session`을 준다.
- 출력 JSON schema를 주면 program이 맞는지 검사하고, 틀리면 `invalid_output`으로 실패한다.
- 자동 재시도는 없다.
- lophn이 꺼져 있으면 CLI는 `unavailable`로 끝난다.
- CLI 자격은 가장 단순한 길로 한다. core가 user token을 data root의 file(0600)에 쓰고 CLI가 읽는다(사람: 같은 OS 사용자의 위험은 신경 쓰지 않는다).

이 계획에서 더 정한 것:

- **run의 turn은 unattended다.** run 입력과 그 turn이 보낸 call 사슬은 묻지 않는다(`approval.md`).
- **CLI는 지금의 `lophn` 명령에 더한다.** coding token이 없으면 user token file을 쓴다. 명령은 `lophn agent run`(`--async`, `--session`, `--schema`, `--input`), `lophn tool call`, `lophn run wait|show|cancel`이다. 결과는 stdout에 내고, `--json`이면 run 전체를 낸다.
- **tool run의 부른 쪽은 사람이다.** user token으로 부르는 앱 tool은 지금 앱 화면에서 사람이 부르는 것과 같은 길이다(Gate를 거치지 않는다).
- **run이 연 session은 열린 채 남는다.** 화면에서는 sidebar에 그대로 두지 않고, 그 session을 연 run 아래에 묶어 보인다. 모양은 `ui-design` skill로 wireframe부터 정한다(roadmap "정할 것" 1).
- **core는 그 입력이 들어간 turn과 `TurnEnded`로 끝을 안다.** eval처럼 "1초 조용하면 끝"으로 짐작하지 않는다.

### 뼈대 검토에서 정한 것 (agent, 2026-10-21)

- **부를 agent는 `--agent`로 고른다. 없으면 lophn이다.**
  - 사람이 치기 쉬운 짧은 꼴을 받는다: `lophn`, `pm:<project>`, `ae:<app>`, `operator:<이름>`, `operator:<project 또는 app>/<이름>`
  - Router의 `NamedAgent` JSON도 받는다. 이름은 지금처럼 정확히 맞아야 풀린다.
- **schema가 있을 때 답 전체를 감싼 code fence 하나는 벗기고 JSON으로 읽는다.** model은 JSON을 fence로 자주 감싼다. 그 밖에는 고치지 않는다.
- **`--schema`는 JSON 글로 받는다.** `--input`은 새 명령에서는 run의 입력이다. `tool call --async`도 받는다(core에서 run은 모두 비동기다).
- **coding session 안에서는 coding token이 먼저다.** 그래서 run route는 `forbidden`이다. App Engineer가 coding agent에게 맡기는 흐름이 막혀 있어 괜찮다.
- **`invalid_output`은 run의 실패 이유다.** 경계의 공통 오류 코드 일곱은 그대로다.
- **tool run을 취소해도 이미 보낸 앱 호출은 멈추지 않는다.** run만 취소됨이 되고, 호출은 저절로 끝난다.
- **화면에서는 run이 연 session만 그 run 아래로 묶는다.**
  - project agent의 session은 project sidebar에서, App Engineer와 앱 place Operator의 session은 그 앱의 agent 목록에서 묶는다.
  - tool run은 session이 없어 run 목록에만 보인다. `--session`으로 이어 쓴 session은 원래 자리에 그대로 둔다.
  - 모양은 wireframe에서 정한다.
- **run 입력은 켤 때 다시 줄 세우지 않는다.** 꺼지기 전에 turn이 가져가지 않은 run 입력이 켤 때 사람 메시지처럼 다시 돌면, 이미 실패로 닫힌 run 뒤에 attended turn이 생긴다.
- **`operator:<x>/<이름>`의 `<x>`는 project로 먼저 풀고, `not_found`면 앱으로 한 번 더 푼다.** 그러려면 `StartRun`은 agent 이름을 다 푼 뒤에 session을 연다. 이름이 안 풀린 채 session부터 열지 않는다.
- **CLI의 결과와 종료 코드**
  - 실패하거나 취소된 run은 `--json`이 없으면 stdout을 비우고 stderr에 한 줄을 쓰며, 4로 끝난다.
  - `--async`, `run show`, `run cancel`은 명령 자체가 되면 0이다.
- **core가 user token file을 쓰지 못하면 시작을 멈춘다.** `writeRunMetadata`와 같다.
- **CLI의 `not_found` 글은 user token일 때 coding token의 글("앱 범위 밖")로 바꾸지 않는다.** `packages/coding-agent/connection/client/core.ts`를 `hr-cli-commands`가 고친다.
- **화면의 모양은 살 단계의 안(project sidebar에 Agents와 Recent 사이의 run 칸, 앱 space에 run 목록)으로 wireframe을 그리고, 사람이 gallery를 보고 정한다.** 그 전에 `hr-screen-data`를 열지 않는다. 화면 낱말은 wording 규칙상 `run`을 쓸 수 없어 "Background"를 안으로 둔다.
- **`ListRuns`는 `agent`와 `place`로 거른다.** run은 만들 때 place를 기록한다: agent run은 그 agent의 place(lophn은 없음), tool run은 그 앱이다. 앱 space는 `place: {app}` 하나로 그 앱의 run을 다 읽는다. 화면은 session event마다 읽고 job이 run을 쌓으므로, 거르기는 core가 한다.
- **Agent 탭의 session 목록(session popover)은 run이 연 session도 그대로 보인다.** 모든 session을 찾는 곳이다.
- **run의 session이 끝나면(archive, 지움) 그 session의 running run은 `turn_interrupted`로 닫는다.** 입력이 줄에 있는 채로 session이 끝나면 turn이 열리지 않아 run이 영영 running으로 남는다.
- **이름이 없는 tool은 `StartRun`에서 막지 않고 run이 `tool_denied`로 실패한다.** tool 선언을 미리 볼 port를 두지 않는 쪽이 단순하다.
- **새 module `packages/core/runs`는 catalog 줄이 먼저 있어야 한다.** lead가 빈 `mod.ts`와 `project-docs/module-catalog.yaml`, `project-docs/boundary-catalog.yaml` 줄을 `hr-contract-runs`보다 먼저 commit한다.

## 사람이 정할 것

- 없음.

## 순서

- wave와 선행은 tasks의 brief가 정한다. 계약(run의 모양, run route, CLI 명령)을 먼저 고정한다.

## lead가 할 일

- merge할 때마다 바뀐 곳의 test를 돌린다. e2e와 eval은 돌리지 않는다(사람).
- land는 `LOPHN_LAND_SKIP_E2E=1 land.sh headless-run`다. 사람이 lead session에 "e2e를 건너뛰고 land해도 된다"고 직접 말해야 한다(orchestrate skill).
- 새 module을 만들면 `project-docs/module-catalog.yaml`과 `project-docs/boundary-catalog.yaml` 줄을 lead가 그 계약 task보다 먼저, 또는 같이 commit한다. 없으면 `check-modules`가 떨어진다.
- `hr-cli-commands`의 worker prompt에 적는다: CLI를 손으로 돌릴 때는 `env -u LOPHN_CODING_TOKEN LOPHN_HOME=<worktree>/.dev-data/hr-cli-commands`로 돌린다. 안 그러면 사람의 `~/.lophn/run/user-token`을 읽어 사람이 쓰는 lophn을 부른다(AGENTS.md "사람에게 묻는 것").
- 다 끝나면 `project-docs/boundary-catalog.yaml`의 `coding-agent-cli-interface`를 고친다. 이제 사람도 그 CLI를 쓴다.
- `RUN_ROUTES`를 `packages/protocol/mod.ts`의 `ALL_ROUTES`에 등록한다. shell의 allowlist가 그 목록을 읽어, 빠지면 화면이 run route를 부르지 못한다.
- 다 끝나면
  - 새 architecture 문서(run)를 쓴다. `place-session.md`(run이 여는 session), `coding-agent.md`(CLI의 사람 자격)를 고친다.
  - roadmap `headless-schedule.md`에서 land된 것을 지운다.
  - changelog 열린 판에 항목을 덧붙이고, 계획 폴더를 지운다.
- 사람에게 묻는 것: push, 실제 model provider 호출(개발은 `deno task dev`의 fake). 그 밖은 planner에게 묻는다.
