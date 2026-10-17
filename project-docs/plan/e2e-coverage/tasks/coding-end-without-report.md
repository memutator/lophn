# coding-end-without-report

coding session의 터미널 process가 완료 보고 없이 끝나면(shell 역할이 `coding_agent_terminals/exited`로 알린다) token이 회수되고, 맡긴 call이 `failed`로 닫히며, 맡긴 App Engineer가 reaction 입력을 정확히 한 번 받는다. claim이 없었던 session(`endSession`이 같은 tx에서 닫는 길)과 claim이 있던 session(`CodingSessionEndedUnreported` event → Reactor가 닫는 길) 둘이 서로 다른 길이라 행을 둘로 둔다. `tests/e2e/coding_test.ts`에 행 둘을 더한다.

- 단위: coding-end-without-report (wave 3)
- 선행: coding-report-needs-release. 같은 `tests/e2e/coding_test.ts`를 순서대로 고친다.
- 소유(이 task만 고친다):
  - `tests/e2e/coding_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/tickets/coding/`
  - `packages/core/apps/tickets/session-end.ts`
  - `packages/core/router/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 9절 `coding-end-without-report`; `candidates-invariants.md` 후보 28; `candidates-product.md` 후보 `coding-token-lifecycle`의 "보고 없는 끝"
  - architecture: `project-docs/architecture/coding-agent.md`("session의 끝은 터미널 process의 exit으로만 안다", "끝나는 길마다 call은 한 번만 닫힌다"와 끝나는 길 표), `project-docs/architecture/agent-call.md`("같은 사실을 두 길로 알리지 않는다"), `project-docs/products/AGENT-ROLE.md` T20·E4
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `router`, `events`, `external-coding-agent`
  - 코드: `packages/protocol/coding-agent/terminal-requests.ts`(`codingTerminalExited`: shell 역할이 부르는 route. `session`, `exit_code`, `reason`), `packages/core/apps/tickets/coding/{terminal,sessions,close-call,relay}.ts`(`endSession`: claim이 없으면 `closeCall`을 그 tx에서 호출, 있으면 `TicketSessionEnd.settle`이 `CodingSessionEndedUnreported`를 내고 Reactor의 `coding.close_call.CodingSessionEndedUnreported`가 닫는다), `packages/core/apps/tickets/session-end.ts`, `packages/protocol/lophn-agent/{calls,received-messages}.ts`(`callRead`, `receivedMessageList`: reaction 입력은 `from.kind === "program"`이고 refs에 ticket과 session이 있다)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/gateway/`(`exitTerminal`), `tests/support/coding/{cli,hand-off}.ts`(`codingCli`, `handOff`), `tests/support/fake-server/mod.ts`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `coding-token-scope`가 만든 `coding_test.ts`의 `Ctx`·`ROWS`와 `Started`(`session`, `ticket`, `call`, `cli`), `exitTerminal(core, session, reason?)`(`gateway-client`), `callRead`·`receivedMessageList`(`packages/protocol/lophn-agent/mod.ts`), `ticketShow`
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `coding-report-needs-release`가 merge됐다. `ROWS`에 행 둘을 더한다.
2. 행 둘. 앱은 행마다 새로 만든다(`ctx.app("end-unclaimed")`, `ctx.app("end-claimed")`). 끝내기 전에 fake에 text 하나를 건다: reaction 입력이 App Engineer의 둘째 turn(`turn` 1)을 열고 그 turn이 model을 부른다. 둘째 turn이 끝나면 reaction이 정확히 들어온 것이다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `unclaimed-end` | `ctx.handOff(app)` → `fake.script([text])` → `exitTerminal(core, session)` → `waitTurnEnd(core, app.ae, 1)` → `exitTerminal`을 한 번 더 → 읽기 | 맡기기 셋(helper) + ① text | ledger: `callRead {call}`가 `failed`이고 `fail_reason`이 `receiver_ended`다 / inbox: `receivedMessageList {session: app.ae}`에서 `from.kind === "program"`인 입력이 정확히 하나이고 refs에 이 ticket이 있다(두 번째 `exited`가 알림을 또 만들지 않았고, Router의 실패 알림과 Reactor의 알림이 겹치지 않았다) / ticket: `ticketShow`가 `open`이고 claim이 null이다 | 후보 `coding-end-without-report`(candidates-docs 9절이 적은 220행), T20, E4. claim이 없으면 `endSession`이 `closeCall`을 같은 tx에서 부른다 |
| `claimed-end` | `ctx.handOff(app)` → `cli.run("ticket show", {ticket})` → `cli.run("ticket claim", {ticket, base_revision})` → `fake.script([text])` → `exitTerminal` → `waitTurnEnd(core, app.ae, 1)` → 읽기 | 맡기기 셋(helper) + ① text | ledger: `callRead`가 `failed`, `receiver_ended`다 / inbox: `from.kind === "program"` 입력이 정확히 하나이고 refs에 ticket과 이 coding session이 있다 / ticket: `ticketShow`가 `open`이고 claim이 null이다(반납된 claim. 다시 맡길 수 있다) | 같은 근거. claim이 있으면 `settle`이 `CodingSessionEndedUnreported`를 내고 Reactor가 닫는다. 이 길은 비동기라 reaction turn이 끝난 것(`waitTurnEnd`)이 닫힘의 신호다 |

   `exitTerminal`이 `exited` route를 부르고, 응답은 writer의 command가 commit된 뒤에 온다. `unclaimed-end`의 call 닫힘과 reaction 입력은 그 tx 안이라 응답 시점에 이미 있다. `claimed-end`는 Reactor가 나중에 처리하므로 `waitTurnEnd(…, 1)`로 기다린다(sleep이 아니라 turn 상태를 읽는 poll이다).
3. 두 번째 `exitTerminal`(`unclaimed-end`)은 "같은 끝을 shell이 두 번 알려도 한 번만 알린다"를 본다. `endSession`이 이미 끝난 session이면 아무것도 하지 않는다고 읽었다. 어긋나면 제품 bug다.
4. 어긋나면 제품 bug다. 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-tickets`·`router`(끝나는 길마다 call은 한 번만 닫히고 맡긴 App Engineer는 같은 사실을 한 번만 받는다), `external-coding-agent`(session의 끝은 터미널 process의 exit으로만 안다).
- 현실적 회귀: 보고 없이 끝난 session의 call이 `accepted`로 영영 남아 ticket이 잠기는 것, 같은 끝을 App Engineer가 두 번 받아 두 번 반응하는 것(Router와 Reactor가 모두 알리는 경우), claim이 반납되지 않아 같은 ticket을 다시 맡길 수 없는 것.
- 왜 지금 test가 못 잡나: `apps/tickets/coding/coding_test.ts`·`tickets_test.ts`는 event와 command를 직접 부르고, shell 역할의 `exited`부터 Reactor, Router, App Engineer의 새 turn까지 process를 건너는 흐름은 지금 E2E에 없다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/coding_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/coding_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "보고 없이 끝난 coding session의 call은 failed로 닫히고 맡긴 App Engineer는 한 번만 알림을 받는다"

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
