# call-gate

agent grant가 "묻기"인 상대를 부르는 `call` tool은 turn 안에서 먼저 사람에게 묻는다. 거절하면 call이 가지 않아 상대 session이 안 열리고, 허락하면 열린다. `tests/e2e/call-gate_test.ts`.

- 단위: call-gate (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/call-gate_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/tools/call/`
  - `packages/core/main/daemon/wiring/router-registration.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-invariants.md` 후보 10(`call-gate`); `candidates-product.md` 후보 `call-gate-ask-reject`
  - architecture: `project-docs/architecture/approval.md`("agent call은 call tool이 turn 안에서 먼저 묻고, Router는 tx 안에서 한 번 더 판정", "agent는 자기 grant를 넓히지 못한다"), `project-docs/architecture/agent-call.md`("Gate는 두 곳이다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `approvals`, `router`, `agent-tools`
  - 코드: `packages/core/lophn-agent/tools/bundles/call.ts`(`call` tool: `gate`가 `agent_call` intent를 만든다), `packages/core/lophn-agent/tools/call/target.ts`(받는 곳 이름 풀기: `place: {project: <name>}`), `packages/core/main/daemon/wiring/router-registration.ts`(`callGate`: 묻는 grant는 `gate_allowed`가 있을 때만 통과, grant 줄이 없으면 거절), `packages/protocol/approvals/grants.ts`(`agentGrantsSet {agent, entries}`, entry `{kind: "agent", agent, setting: "ask"}`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `agentGrantsSet`(`packages/protocol/approvals/mod.ts`), `agentSessionList`·`receivedMessageList`·`toolCallList`(`packages/protocol/lophn-agent/mod.ts`).
  - 내놓는 것: 없음(test file만)

## 할 일

1. 새 file이다. 같은 `Deno.test` 한 개 안에서 core를 한 번 띄우고 행마다 새 session을 연다(행의 준비를 반복하지 않는다). 준비: `connectFakeProvider`, project 폴더 `proj`, `openProject`(PM project가 생긴다), `agentGrantsSet {agent: {role: "lophn"}, entries: [{kind: "agent", agent: {role: "project_manager", project: <id>}, setting: "ask"}]}`(사람 자격). 행마다 `openSession(lophn)`.
2. 행 표.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `reject` | `say` → `waitPermission`(lophn session. choices는 allow·reject) → `decide(reject)` → `waitTurnEnd` | ① tool `call {to: {role: "project_manager", place: {project: <project 이름>}}, reply: "none", body: "hi", refs: []}` ② text | route: `agentSessionList({agent: PM})`에 session이 없다(call로 안 열렸다) / ledger: `toolCallList`의 `call` call이 `success`가 아니다 / fake: journal이 2개이고 둘째 요청에 call id의 `tool_result`가 있다 | 후보 10 행 a. 권한: Gate 두 곳 중 call tool 쪽 |
| `allow` | 위와 같고 `decide(allow)` → PM session이 열린 것을 `agentSessionList`가 낼 때까지 poll → PM의 첫 turn `waitTurnEnd` | ① 같은 call ② text ③ text(PM의 새 turn. 두 text가 같아 순서와 무관하다) | route: `agentSessionList({agent: PM})`에 session이 하나이고 그 session의 `receivedMessageList`에 `call`이 이 call이고 보낸 쪽이 agent다 / ledger: `call` call이 `success` / fake: journal이 3개 | 후보 10 행 b |

3. grant 줄이 없을 때(`not_granted`)와 `never`일 때는 보지 않는다(Gate 판정 table은 `gate_test.ts`가 본다).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `approvals`(agent call은 turn 안에서 사람에게 묻고 거절하면 가지 않는다), `router`(tx 안에서 grant를 한 번 더 판정), `agent-tools`.
- 현실적 회귀: call tool이 Gate를 건너뛰어 사람 허락 없이 다른 agent를 여는 것, 거절했는데 상대 session이 열리는 것, 허락했는데 Router가 "묻는 grant"라고 거절해 call이 가지 못하는 것.
- 왜 지금 test가 못 잡나: `gate_test`는 판정 table만, `router-registration_test`는 `callGate` 함수만 본다. call tool(child) → Gate(core 메모리) → 사람 결정 → Router → 새 session의 왕복은 process를 건너야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/call-gate_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/call-gate_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "묻는 grant의 상대는 사람이 허락해야만 열리고, 거절하면 열리지 않는다"

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
