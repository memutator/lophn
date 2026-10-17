# agent-call

agent 사이 call을 `tests/e2e/agent-call_test.ts`로 본다: A가 B를 부르고 B의 답이 A의 새 입력으로 돌아온다, B가 답 없이 끝나면(session archive) A가 실패를 한 번 받는다, core가 재시작하면 안 가져간 call이 `lophn_restarted`로 닫히고 A가 알림을 받는다. 거기에 이름을 못 푸는 call, 닫힌 session으로의 call, 답 없는 call, 보낸 쪽 cancel 뒤의 늦은 reply, 보낸 session archive 뒤의 reply, 같은 tool call의 중복, 입력함 순서를 행으로 더한다.

- 단위: agent-call (wave 3)
- 선행: reply-fn, call-gate, restart-rows. 줄(lane)과 함수 대답을 쓰고, 같은 Router를 고칠 수 있어 순서를 묶는다.
- 소유(이 task만 고친다):
  - `tests/e2e/agent-call_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/router/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 5절 일곱 행; `candidates-invariants.md` 후보 17(`restart-lost-call`), 18(`call-receiver-ended`), 19(`agent-call-roundtrip`); `candidates-product.md` 후보 `call-result-roundtrip`, `call-restart-lophn-restarted`
  - architecture: `project-docs/architecture/agent-call.md`(call 왕복, "조용히 사라지는 call 없음", "같은 실패를 tool 결과와 입력 둘로 받으면 agent가 두 번 반응"), `project-docs/architecture/place-session.md`(끝나는 session이 받은 call은 `receiver_ended`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `agent-sessions`, `run-loop`, `agent-tools`
  - 코드: `packages/core/router/{router,commands,store}.ts`(`failLostOnStart`, `reply`, 닫기), `packages/core/lophn-agent/tools/bundles/call.ts`(`call`·`reply` tool 입력: `reply {call, body, refs}`), `packages/protocol/lophn-agent/calls.ts`(`callRead`, `CALL_FAIL_REASONS`: `receiver_ended`, `lophn_restarted`), `project-docs/issues/archived/agent-call.md`(전례)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `reply-fn`이 더하는 줄(`script(steps, lane)`)과 `probe.ts`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`)의 줄(lane)·함수 대답·`probe.ts`(`toolNames`로 줄을 가르고 `idIn`으로 `cal_` id를 뽑는다), `agentGrantsSet`, `callRead`·`agentSessionList`·`receivedMessageList`·`archiveSession`.
  - 내놓는 것: 없음(test file만)

## 할 일

1. 새 file이다. 같은 `Deno.test` 한 개 안에서 core를 한 번 띄우고 행마다 새 session을 연다(행의 준비를 반복하지 않는다). 준비: `connectFakeProvider`, project 폴더 `proj`, `openProject`, `agentGrantsSet {agent: {role: "lophn"}, entries: [{kind: "agent", agent: {role: "project_manager", project: <id>}, setting: "never"}]}`(`never` = 묻지 않고 허용). A = lophn session, B = PM session. 줄: lophn은 `toolNames`에 `app_create`가 있는 요청, PM은 `context_draft`가 있는 요청(`script(steps, lane)`).
2. **fake 대답 3개 상한의 예외다**(README "정한 것" 11): session 둘이 각자 turn을 돌아야 하는 flow라 한 case가 4~5개다. test 머리 주석에 이유를 적는다. 단계와 단정 상한은 그대로 지킨다.
3. 행 표. 모두 같은 core를 쓰고 행마다 새 A/B session을 연다.

| 행 | route 순서 | fake 대답(줄별) | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `roundtrip` | `say`(A, 표지 `LOPHN-ONLY-MARK` 포함) → B의 첫 turn과 A의 둘째 turn이 끝날 때까지 `waitTurnEnd(B)`, `waitTurnEnd(A, 1)` → `callRead` | lophn: ① tool `call {to: {role: "project_manager", place: {project: <이름>}}, reply: "result", body: "ping", refs: []}` ② text ③ text(B의 답이 입력이 된 새 turn) / PM: ① 함수: 요청의 마지막 user 글에서 `idIn(..., "cal")`로 call id를 뽑아 tool `reply {call, body: "pong", refs: []}` ② text | ledger: `callRead`가 `done`이고 `agentSessionList({agent: PM})`에 session이 하나 / fake: lophn의 3번째 요청에 `pong`이 있고 PM의 첫 요청에 `ping`이 있으며 `LOPHN-ONLY-MARK`는 없다(원문 대화가 아니라 body와 refs만 간다) / ledger: A의 첫 turn이 B를 기다리지 않고 `completed`로 끝났다(`turnsOf(A)`의 첫 turn이 B의 답보다 먼저 finished) | 후보 19. 핵심 흐름, `agent-call.md` |
| `receiver-ended` | `say`(A) → `waitTurnEnd(B)` → `archiveSession(B)` → `waitTurnEnd(A, 1)` → `callRead` | lophn: ① 같은 call ② text ③ text(실패 알림 turn) / PM: ① text(reply 없이 끝) | ledger: `callRead`가 `failed`·`receiver_ended` / ledger: A의 `receivedMessageList`에 그 알림 입력이 정확히 하나(tool 결과와 입력 둘로 받지 않았다) / fake: lophn 줄의 요청이 정확히 3개 | 후보 18. 같은 실패를 두 번 받으면 agent가 두 번 반응한다 |
| `restart-lost` | `say`(B) → `waitPermission(B)` → `say`(A) → `waitTurnEnd(A, 0)` → `core.kill()` → `bootCore` → `settle` → `waitTurnEnd(A, 1)` → `callRead` | PM: ① tool `file_write LOPHN.md`(Gate로 B를 바쁘게 한다. 답이 안 온다) / lophn: ① tool `call {to: {session: <B id>}, reply: "result", body: "ping", refs: []}` ② text ③ text(재시작 뒤 알림 turn) | ledger: `callRead`가 `failed`·`lophn_restarted`이고 B의 첫 turn이 `interrupted`·`restarted` / ledger: A의 `receivedMessageList`에 알림 입력이 정확히 하나 / fake: journal이 4개(B 1 + A 3) | 후보 17. 조용히 사라지는 call이 없다 |

   `candidates-docs.md` 5절에서 더한 행(agent-call.md 줄 번호는 그 file 기준). 같은 core, 같은 grant, 행마다 새 A/B session. 대답 수는 줄별로 센 합이고 위 2번의 예외 안이다:

| 행 | route 순서 | fake 대답(줄별) | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `call-not-found` | `say`(A) → `waitTurnEnd(A)` | lophn: ① tool `call {to: {role: "project_manager", place: {project: "no-such-project"}}, reply: "none", body: "hi", refs: []}` ② text | fake: 둘째 요청의 call tool_result가 `failed`와 `not_found`를 담는다(구조만) / route: `agentSessionList({agent: PM})`의 session 수가 앞과 같다 / ledger: 이름을 못 푼 call은 받는 곳을 적을 수 없어 행이 없다(`router.ts` 주석). `callRead`로 찾으면 `not_found`다 | `call-not-found`(agent-call.md 231·232행, T9) |
| `call-closed-session` | `openSession(PM)`(B) → `archiveSession(B)` → `say`(A) → `waitTurnEnd(A)` | lophn: ① tool `call {to: {session: <B id>}, reply: "none", body: "hi", refs: []}` ② text | fake: call tool_result가 `failed`·`closed`이고 hint("call its role and place")를 담는다 / route: 열린 PM session이 새로 생기지 않았다(`agentSessionList({agent: PM, archived: "exclude"})`가 비었다) / ledger: B가 받은 message가 없다 | `call-closed-session`(229행, T7). 닫힌 session은 다시 열지 않는다 |
| `call-none-no-reply` | `say`(A) → `waitTurnEnd(B)`와 `waitTurnEnd(A)` | lophn: ① tool `call {..., reply: "none"}` ② text / PM: ① text | route: PM session이 하나 열렸고 그 `receivedMessageList`에 이 call의 message가 있다 / ledger: A의 `receivedMessageList`에 사람 message 하나뿐이고(답 입력이 안 온다) A의 turn이 하나다 / fake: lophn 줄의 요청이 정확히 2개 | `call-none-no-reply`(R2). 답 없는 call은 보낸 쪽을 다시 깨우지 않는다 |
| `operator-to-ae` | 준비 더하기: `apps/create`로 앱 하나(App Engineer 정의가 생긴다), `operators/create`로 project에 Operator 하나, `agentGrantsSet {agent: Operator, entries: [{kind: "agent", agent: {role: "app_engineer", app: <id>}, setting: "never"}]}` → `openSession(Operator)`(O) → `say`(O) → `waitTurnEnd(AE)` → `waitTurnEnd(O, 1)` → `callRead` | Operator: ① tool `call {to: {role: "app_engineer", place: {app: <이름>}}, reply: "result", body: "need fix", refs: []}` ② text ③ text / AE: ① 함수: 마지막 user 글의 call id로 `reply {call, body: "fixed", refs: []}` ② text | ledger: `callRead`가 `done` / fake: Operator 줄의 3번째 요청에 `fixed`가 있다 / route: `agentSessionList({agent: AE})`에 session이 하나 | AGENT-ROLE O5. planner 검토로 `operator-calls-app-engineer` task를 지우고 이 행으로 접었다(왕복 장치는 `roundtrip` 행이 이미 본다. 이 행은 Operator가 보내는 쪽인 것만 다르다) |
| `call-cancel-late-reply` | `say`(B) → `waitPermission(B)` → `say`(A) → A의 첫 turn 끝 → `say`(A, "cancel it") → A의 둘째 turn 끝 → `decide(B, allow)` → `waitTurnEnd(B)` → `callRead` | PM: ① tool `file_write LOPHN.md`(B를 Gate에 세운다) ② 함수: 앞 요청에서 `idIn(..., "cal")`로 call id를 뽑아 `reply {call, body: "late", refs: []}` ③ text / lophn: ① tool `call {to: {session: <B id>}, reply: "result", ...}` ② text ③ 함수: 앞 tool_result의 call id로 `cancel {call, reason: "no longer needed"}` ④ text | ledger: `callRead`가 `cancelled`이다 / fake: PM 줄에서 reply 뒤 요청의 tool_result가 `closed: true`이다(뒤늦은 reply는 닫힌 call로 돌아간다) / ledger: A의 `receivedMessageList`에 reply 입력이 없다 | `call-cancel-late-reply`(251행, T18) |
| `call-sender-archived` | 위 행의 앞부분과 같고 A를 `cancel` 대신 `archiveSession(A)`한 뒤 `decide(B, allow)` | PM 줄은 위와 같다 / lophn: ① 같은 call(reply "result") ② text | ledger: reply 본문이 B의 session에만 남고 `callRead` 상태는 문서 T13이 정한 값이다(읽고 정한다) / route: archive된 A에 새 turn이 안 열렸다 / fake: PM 줄의 reply tool_result가 오류가 아니다 | `call-sender-archived`(T13). 보낸 session이 닫혀도 reply는 받은 session에서 끝난다 |
| `call-dedup` | `say`(A) → `waitTurnEnd(A)` | lophn: ① **같은 tool call id `dup1`을 가진 `call` tool_use 둘**(같은 reply에 같은 id를 두 번 넣어 읽기 tool retry를 흉내 낸다) ② text | route: PM session이 정확히 하나다 / ledger: `receivedMessageList(B)`에 이 call의 message가 하나뿐이다 / fake: lophn 둘째 요청의 tool_result 둘이 같은 call id를 가리킨다 | `call-dedup`(244·245행, T15). 이 흉내가 안 먹으면(중복 tool call id를 core가 앞단에서 거절한다) 이 행은 접고 `router_test.ts`가 dedup을 지킨다고 보고한다 |
| `inbox-order` | `say`(B) → `waitPermission(B)` → `say`(A)(A가 B에게 call을 넣는다) → A의 turn 끝 → `say`(B, "human") → `decide(B, allow)` → `waitTurnEnd(B, 2)` | PM: ① tool `file_write LOPHN.md`(Gate) ② text ③ text ④ text / lophn: ① tool `call {to: {session: <B id>}, reply: "none", ...}` ② text | ledger: B의 둘째 turn(index 1)의 입력 message가 사람 message이고 셋째 turn(index 2)의 입력이 call의 message다(call이 먼저 도착했어도 사람 message가 먼저 turn이 된다) / fake: PM 줄의 3번째 요청 본문에 "human" 글이 있고 4번째에 call 본문이 있다 / route: B의 turn이 셋이고 모두 `completed`다 | `inbox-order`(250행) |

   `call-dedup`, `call-sender-archived`, `inbox-order`는 문서의 정확한 상태 이름을 읽어야 단정이 정해진다. 읽고도 정할 수 없으면 그 행의 단정을 "사람에게 물을 것"에 올리고 나머지를 진행한다.
4. 각 행의 `waitTurnEnd`는 session별 index이고 서로 기다린다. 어느 행이든 줄에 안 맞는 요청이 오면(400 차이 오류) test가 설명 있는 실패를 낸다.
5. 단정이 어긋나면 제품 bug다(Router 안). 고친 행은 "고치기 전 코드에서 실패"를 보고에 적는다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `router`(call 왕복, 실패는 한 번만 보낸 쪽에 돌아간다, 재시작에 사라지지 않는다), `agent-sessions`(받는 session의 끝이 call을 닫는다), `agent-tools`(`call`·`reply`).
- 현실적 회귀: reply가 보낸 session의 새 입력이 되지 못하는 것, 받은 session이 archive됐는데 call이 `accepted`로 영영 남는 것, 같은 실패가 tool 결과와 입력 둘로 가서 agent가 두 번 반응하는 것(전례: `archived/agent-call.md`), 재시작에 입력함의 call이 말없이 사라지는 것.
- 왜 지금 test가 못 잡나: `router_test`는 Router와 가짜 저장소만 본다. 두 session의 model turn이 서로 얽히는 왕복과 재시작 복구는 process를 건너야 하고, 지금 fake는 queue 하나라 session 둘이 동시에 부르면 순서가 갈렸다(`reply-fn`의 줄이 푼다).

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/agent-call_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/agent-call_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "agent 사이 call은 답이 돌아오고, 끝나거나 재시작해도 보낸 쪽이 실패를 한 번 받으며 조용히 사라지지 않는다"

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
