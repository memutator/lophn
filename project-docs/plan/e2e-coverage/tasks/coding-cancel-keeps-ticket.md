# coding-cancel-keeps-ticket

사람이 맡긴 call을 cancel하면 coding session이 멈추고(shell에 `stop` 터미널 요청이 가고) token이 회수되며, claim이 풀려 ticket은 열려 있다. ticket 취소와는 다르다: call cancel은 "이 맡기기를 멈춘다"이고 ticket은 다시 맡길 수 있다. `tests/e2e/coding_test.ts`에 행 하나를 더한다.

- 단위: coding-cancel-keeps-ticket (wave 3)
- 선행: coding-one-per-app. 같은 `tests/e2e/coding_test.ts`를 순서대로 고친다.
- 소유(이 task만 고친다):
  - `tests/e2e/coding_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/apps/tickets/coding/transport.ts`
  - `packages/core/apps/tickets/coding/sessions.ts`
  - `packages/core/router/router.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 9절 `coding-cancel-keeps-ticket`
  - architecture: `project-docs/architecture/coding-agent.md`("call cancel은 session을 멈추고 token을 회수하되 ticket은 열어 둔다. 다시 맡길 수 있다. ticket 취소는 별개이고 ticket을 닫는다"와 끝나는 길 표의 `call cancel` 줄)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-tickets`, `router`, `external-coding-agent`
  - 코드: `packages/core/router/router.ts`(`cancel`: 사람은 모든 call을 취소한다. call을 `cancelled`로 옮기고 `transport.cancel`), `packages/core/apps/tickets/coding/transport.ts`(`stop`: `revokeToken` + `stop` 터미널 요청. 이 길은 claim을 풀지 않는다), `packages/core/apps/tickets/coding/{sessions,close-call}.ts`(shell이 process 끝을 알리면 `endSession`이 claim을 반납하고, 이미 `cancelled`인 call은 `closeCall`이 닫지도 알리지도 않는다), `packages/protocol/coding-agent/terminal-requests.ts`(`stop` 요청은 `kind: "stop"`, `request`, `session`), `packages/protocol/lophn-agent/calls.ts`(`callCancel`: 사람 자격, `callRead`)
  - main의 `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`, `until`), `tests/support/gateway/`(`exitTerminal`, `Gateway.next`), `tests/support/coding/{cli,hand-off}.ts`(`codingCli`, `handOff`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `coding-token-scope`가 만든 `coding_test.ts`의 `Ctx`·`ROWS`와 `Started`(`session`, `call`, `ticket`, `cli`), `callCancel`(user, `{call}`)·`callRead`·`ticketShow`, `exitTerminal(core, session, "killed")`
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `coding-one-per-app`이 merge됐다. `ROWS`에 행 하나를 더한다.
2. 행 하나. 앱은 새로 만든다. 맡긴 call을 사람이 cancel하면 Router가 보낸 쪽(App Engineer)에게 알림을 만들지 않는다고 읽었다(`cancel`은 상태를 옮기고 transport를 부를 뿐이다). 그러므로 fake 대답이 더 들지 않는다. 어긋나 App Engineer의 turn이 하나 더 열리면 제품이 닫지 않아야 할 call을 알린 것이다. 보고에 적는다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `cancel-claimed` | `ctx.handOff(app)` → `cli.run("ticket show", {ticket})` → `cli.run("ticket claim", {ticket, base_revision})` → `core.call(callCancel, {call})`(사람) → `app.gateway.next("coding_terminal", (frame) => frame.request.kind === "stop" && frame.request.session === 세션)` → `exitTerminal(core, 세션, "killed")` → 읽기 | 맡기기 셋(helper) | gateway: cancel 뒤 그 session의 `stop` 터미널 요청이 온다 / CLI: `stop` 요청이 오기를 기다리기 전에, cancel 응답 직후 같은 token의 `ticket show`가 `value.error.code === "unauthorized"`다(회수가 cancel과 같은 commit이다) / ledger: shell이 process 끝(`killed`)을 알린 뒤 `ticketShow`가 `open`이고 claim이 null이며 `callRead`는 `cancelled`다(`failed`가 아니다) | 후보 `coding-cancel-keeps-ticket`(candidates-docs 9절이 적은 221행). 끝나는 길 표: call cancel은 "session 멈춤, claim 풀림, ticket 열린 채, call cancelled" |

   cancel 응답 직후 token이 회수돼 있다는 것은 `revokeToken`이 commit 뒤 `relay.apply`에서 동기로 불린다고 읽은 것이다(`storage/ledger/after-commit.ts`의 `withAfterCommit`이 command 응답 전에 `apply`를 부른다). Router의 `calls/cancel` command가 그 writer를 지나는지는 코드로 확인한다. 아니라면 `until`(신호는 호출이 `unauthorized`가 되는 것, 제한 시간 있음)로 바꾸고 보고에 적는다.
3. shell 역할이 `stop` 요청에 `exitTerminal(..., "killed")`로 답하는 것이 실제 shell main이 하는 일이다(PTY를 죽이고 process 끝을 core에 알린다). claim이 풀리는 것은 이 끝을 알린 뒤다(`stop` 요청은 claim을 건드리지 않는다. `endSession`의 `settle`이 반납한다). 이미 `cancelled`인 call을 Reactor의 `CodingSessionEndedUnreported`가 다시 닫지 않는 것은 `closeCall`의 `state !== "accepted"` 검사다. 단정하지 않는다(없는 것을 보려면 기다려야 한다).
4. 어긋나면 제품 bug다. 추가 소유 안에서만 고치고 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `app-tickets`·`router`(call cancel은 session을 멈추고 token을 회수하되 ticket은 열어 둔다), `external-coding-agent`(멈춤은 shell main에 터미널 요청으로 간다).
- 현실적 회귀: call cancel이 ticket까지 닫아 사람이 다시 맡길 수 없게 되는 것, cancel 뒤에도 token이 살아 있어 멈추는 중인 터미널이 core를 계속 쓰는 것, 멈춘 session의 claim이 풀리지 않아 ticket이 `claimed`로 잠기는 것(1시간 뒤에야 만료).
- 왜 지금 test가 못 잡나: `apps/tickets/coding/coding_test.ts`와 `router_test.ts`는 transport와 Router를 따로 본다. cancel → `stop` frame → shell 역할의 끝 알림 → claim 반납까지 이어지는 길은 process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/coding_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/coding_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "맡긴 call을 cancel하면 coding session이 멈추고 token이 회수되며 ticket은 다시 맡길 수 있게 열려 있다"

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
