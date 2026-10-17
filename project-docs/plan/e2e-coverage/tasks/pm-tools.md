# pm-tools

PM turn 하나에서 child 안의 tool들(shell, skill 읽기, 이미지 읽기, grep, `operator.create`, `web_fetch`)이 Deno 권한에 안 걸리고, `operator.create`가 `forbidden` 없이 Gate를 지나며, `web_fetch`는 loopback으로 못 나가는 것을 `tests/e2e/pm-tools_test.ts`로 본다.

- 단위: pm-tools (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/pm-tools_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/tools/runtime-permissions.ts`
  - `packages/core/agent-roles/credentials.ts`
  - `packages/core/lophn-agent/tools/web/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-bugs.md` 후보 `runtime-tool-permissions`, `command-tool-credential`; `candidates-product.md` 후보 `operator-create-gated`
  - architecture: `project-docs/architecture/agent-definition.md`("shell은 환경 변수 허용 목록만", "file tool은 place 폴더 안에 가둔다", agent credential의 operation 상한), `project-docs/architecture/approval.md`(설정 고치기는 Gate)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `run-loop`, `agent-tool-spi`, `approvals`
  - 코드: `packages/core/lophn-agent/tools/runtime-permissions.ts`(child의 Deno flag), `packages/core/lophn-agent/tools/bundles/{shell,skill,file,web}.ts`(tool 이름과 입력), `packages/core/agent-roles/tools/operator.ts`(`operator.create` 입력 = `operatorDefinitionSchema`에서 `mcp_servers`를 뺀 것 + `place` + `name`. Gate = `settings_edit`), `packages/core/lophn-agent/tools/web/target.ts`(local·private 주소 거절), `packages/core/agent-roles/credentials.ts`(role의 operation 상한), `issues/archived/agent-definition.md`의 credential 이름 bug, `issues/archived/place-session.md`의 Deno 권한 bug
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `toolCallList`, `agentDefinitionList`(`packages/protocol/lophn-agent/mod.ts`).
  - 내놓는 것: 없음(test file만)

## 할 일

1. 새 file이다. 같은 `Deno.test` 한 개 안에서 core를 한 번 띄우고 행마다 새 session을 연다(행의 준비를 반복하지 않는다). 준비: `connectFakeProvider`, project 폴더 `proj`(안에 `pic.png` = 1x1 PNG byte, `notes.md` = 글 한 줄), `openProject`, `openSession(PM)`.
2. case 하나(단계 6 이하, 대답 2):

| 항목 | 내용 |
|---|---|
| route 순서 | `say` → (tool들이 차례로 돈다) → `waitPermission`(`operator_create`의 Gate) → `decide(allow)` → `waitTurnEnd` → `toolCallList`·`agentDefinitionList` |
| fake 대답 | ① 한 reply에 tool call 여섯: `shell_run {command: <SHELL>}`, `skill_read {name: "context-init"}`, `image_read {path: "pic.png"}`, `file_grep {pattern: "notes"}`, `web_fetch {url: <fake.url>/probe}`, `operator_create {name: "helper", place: {project: <project 이름>}, body: "Help.", ...정의의 필수 칸}` ② text |
| 단정 1 (disk) | `proj/made.txt`가 `hi\n`이다 |
| 단정 2 (ledger) | `toolCallList`에서 shell·skill·image·grep·`operator_create`가 `success`, `web_fetch`가 failure(code는 `web/target.ts`가 정한 값을 읽어 단정, `NotCapable` 계열 문구가 아니다). `agentDefinitionList({place: {kind: "project", id}})`에 `helper` Operator가 있다 |
| 단정 3 (fake가 받은 요청) | journal의 모든 항목 path가 `/messages`다(`/probe` 요청이 없다 = `web_fetch`가 loopback으로 못 나갔다). 둘째 요청의 `shell_run` tool_result가 30 KiB 이하다(출력 상한이 건 12 KiB씩) |

SHELL = `echo hi > made.txt; seq 1 400000`(출력이 2 MiB가 넘어 12 KiB씩 상한이 걸린다. 표 안에 `|`를 쓰지 않으려고 pipe 없는 명령을 골랐다).
3. `operator_create`의 필수 칸은 schema(`operatorDefinitionSchema`)에서 읽고 가장 작은 값으로 채운다. `operator_create`의 Gate는 이름이 같은 호출이 한 turn에 여럿이면 어떻게 되는지까지 보지 않는다(하나만 낸다).
4. 어떤 tool이 `NotCapable`·`forbidden`으로 깨지면 test를 고치지 말고 제품 bug로 본다. 권한 flag를 손댄 commit이 둘(`59fb5ac20`, `7208838ab`)이고 어느 쪽도 child를 띄워 확인하지 않았다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-tools`·`run-loop`(runtime child의 Deno flag와 tool 목록이 맞아야 tool이 돈다), `agent-tool-spi`(role의 operation 상한이 tool 이름이 아니라 route 이름 기준이다).
- 현실적 회귀: runtime 권한 flag에서 place 폴더·net·run이 빠져 `NotCapable`로 깨지는 것(이미 두 번 난 일), 이름이 route와 다른 command tool(`operator.create` → `CreateOperator`)이 credential 상한에 막혀 `forbidden`이 되는 것("agent의 주요 일이 막힌다"), `web_fetch`의 주소 판정이 풀려 loopback으로 나가는 것.
- 왜 지금 test가 못 잡나: 두 번 모두 child를 실제로 띄워 확인하지 않았다(닫음에 "E2E 몫"이라고 적혔다). `agent-tools_test`는 목록·정의 일치만 보고 harness는 in-process라 권한 문제가 없다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/pm-tools_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/pm-tools_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "PM의 shell·skill·image·grep·operator.create는 runtime 권한에 막히지 않고, web_fetch는 loopback으로 나가지 못한다"

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
