# session-archive-calls

허락을 기다리는 turn이 돌고 있고 받은 call이 열려 있는 session을 archive(또는 지움)하면 한 번에 turn은 interrupted로, 대기 request는 cancelled로, 보낸 쪽 call은 `receiver_ended`로 닫히는 것을 `tests/e2e/session_test.ts`에 행 둘로 더한다. agent 둘(보낸 lophn, 받는 Project Manager)이 동시에 model을 부르므로 `reply-fn`의 줄(lane)이 필요하다.

- 단위: session-archive-calls (wave 2)
- 선행: reply-fn, session-scope. `reply-fn`의 줄과 같은 file(`tests/e2e/session_test.ts`)의 순서다.
- 소유(이 task만 고친다):
  - `tests/e2e/session_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/places/lifecycle.ts`
  - `packages/core/lophn-agent/session/commands.ts`
  - `packages/core/approvals/turn-requests.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 6절의 `session-archive-one-tx`
  - architecture: `project-docs/architecture/place-session.md`("archive와 지움은 모든 영향을 한 tx에 묶는다", 흐름 그림), `project-docs/architecture/agent-call.md`("실패는 조용히 버리지 않고 한 번만 알린다", receiver_ended), `project-docs/architecture/approval.md`("turn 안 request는 원래 일이 끝나면 cancelled")
  - `project-docs/products/AGENT-ROLE.md`의 T17(받은 session이 결과 없이 끝나면 보낸 session에 실패가 들어온다), T13은 이 task에 넣지 않는다(아래 "정한 것")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `router`, `approvals`
  - 코드: `packages/core/lophn-agent/places/lifecycle.ts`의 `endSession`(도는 turn interrupted → `failReceivedCalls` → 입력함 비우기 → 발행, 한 tx), `packages/core/router/model.ts`의 `failureInput`·`FAILURE_TEXTS`(보낸 쪽은 `from: {kind: "program"}`인 reply를 받는다), route `ReadCall`(`callRead {call}`: `state`, `fail_reason`), `ReadSession`(`agentSessionRead`), `ArchiveSession`·`DeleteSession`(compare `{state_seq}`), `ListSessions`(`agentSessionList`), `approvalsDecideTurn`, `sessionSnapshotsList`, `turnRead`
  - `reply-fn` brief(`tasks/reply-fn.md`)의 "내놓는 것": `FakeServer.script(steps, lane?: {name, match})`, `JournalEntry.lane`, `probe.ts`의 `toolNames`·`lastUserText`·`idIn`. **support brief의 이름으로 맞춘다.** main에 land된 `tests/support/fake-server/{types,mod,probe}.ts`가 다르면 main을 따른다.
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/e2e/{approval,stop}_test.ts`(본보기. LOPHN.md 쓰기가 PM의 허락을 부른다)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`, `tests/support/fake-server/{mod,types,probe}.ts`(`reply-fn`이 내놓는 줄과 `toolNames`), `archiveSession`·`deleteSession`·`agentSessionList`·`agentSessionRead`·`callRead`·`receivedMessageList`·`turnRead`(`packages/protocol/lophn-agent/mod.ts`), `approvalsDecideTurn`(`packages/protocol/approvals/mod.ts`), `sessionSnapshotsList`(`packages/protocol/events/mod.ts`)
  - 내놓는 것: 없음(test file만)

## 할 일

1. 시작 조건: `tests/e2e/session_test.ts`가 main에 있고(`session-rows`) `reply-fn`의 줄이 land되어 있어야 한다. 아니면 시작하지 말고 보고한다. 있으면 그 file의 core 띄우기·`t.step`을 그대로 쓰고 행만 더한다.
2. 줄을 둘 둔다. 보낸 쪽(lophn)과 받는 쪽(PM)은 같은 시각에 model을 부르므로 요청이 오는 순서가 정해지지 않는다. role마다 다른 tool 이름으로 가른다: lophn 줄은 `toolNames(request)`에 `app_create`가 있을 때, PM 줄은 `context_draft`가 있을 때(`packages/core/agent-roles/tool-lists.ts`로 확인한 role 전용 쓰기 tool). 안 흔들리는 표지를 못 찾으면 `reply-fn` brief의 추천(role 전용 tool 이름)을 따르고 보고에 적는다.
3. 행 표. 준비: `openProject`(PM 생성), `openSession(lophn)`(id `src`). 보낸 쪽의 받는 쪽 이름은 project의 slug(`openProject`가 정한 이름)다. 받는 session 찾기: `src`가 call을 보내면 core가 PM의 새 session을 연다. `human.ts`에는 session 기다리기가 없으므로 `agentSessionList({agent: PM})`을 신호로 읽는 작은 poll(제한 시간 있음, sleep 아님)을 file 안에 한 함수로 쓴다. 같은 poll이 다른 task에도 필요하면 보고의 "넘길 줄"에 적는다.

| 행 | route 순서 | fake 대답(줄별) | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `archive` | `say(src)` → 받는 PM session `dst`를 poll로 찾음 → `waitPermission(dst)` → `agentSessionRead(dst)`(`state_seq`) → `archiveSession` → `waitTurnEnd(src, 1)`(보낸 쪽이 늦은 실패를 새 입력으로 받아 둘째 turn을 연다) | lophn 줄: ① tool `call {to: {role: "project_manager", place: {project: <이름>}}, reply: "result", body: "update LOPHN.md", refs: []}` ② text ③ text(늦은 실패 알림으로 열린 둘째 turn). PM 줄: ① tool `file_write {path: "LOPHN.md", content: "rules"}`(허락 대기) | ledger: `turnRead`로 본 `dst`의 turn이 `finished`·`{kind: "interrupted", reason: "session_ended"}`이고 `agentSessionRead(dst)`의 `lifecycle`이 `archived`다 / route: `callRead`(call id는 `receivedMessageList(dst)`의 `call`)가 `state: "failed"`, `fail_reason: "receiver_ended"`다 / route: 늦은 허락 `core.tryCall(approvalsDecideTurn, {session: dst, request, choice: {kind: "allow"}})`가 `!ok`이고 project 폴더에 `LOPHN.md`가 없다 | 후보 `session-archive-one-tx`, place-session 29·30행, AGENT-ROLE T17. 일부만 적용된 끝(turn은 닫혔는데 call이 accepted로 남음)이 없어야 한다 |
| `delete` | 위와 같고 `archiveSession` 대신 `deleteSession` | 위와 같다 | ledger: `agentSessionRead(dst)`가 `not_found`다 / route: `callRead`가 `state: "failed"`, `fail_reason: "receiver_ended"`다 / route: 늦은 허락이 `!ok`이고 `LOPHN.md`가 없다 | 같은 후보의 지움 쪽. 지움도 같은 tx로 call을 닫는다 |

   - `waitTurnEnd(src, 1)`이 뜻하는 것은 단정이 아니라 "늦은 실패 입력이 도착해 둘째 turn이 돌았다"는 기다림이다. 그 turn이 안 열리면 lophn 줄 ③이 안 쓰여 fake journal이 3개에서 멈추므로 `within`(제한 시간)이 무엇을 기다렸는지 담아 실패한다. `stop_test.ts`의 `within`을 같은 모양으로 쓴다.
   - 행마다 `fake.reset()`으로 줄을 비우고 새 project 폴더·새 session을 쓴다. 두 행의 fake 대답은 줄을 합쳐 각각 4개다.
4. "정한 것": 이 case는 README "정한 것" 11의 상한(대답 3)을 넘는다. 이유는 session 둘이 한 flow에서 각자 turn을 돌려야 call이 열리고 닫히기 때문이다(보낸 lophn 3, 받는 PM 1). 이 이유를 test 머리 주석에 쓴다. **사람이 이 예외를 허락해야 한다**(README 11은 `agent-call`과 앱 activation helper만 예외로 적었다). 허락이 없으면 이 task는 merge하지 않고 `agent-call`의 행으로 옮긴다. T13(보낸 session이 먼저 archive되면 결과는 받은 session에만 남음)은 대답이 5개가 되어 `agent-call`의 몫으로 둔다.
5. `delete` 행이 코드와 맞지 않으면(예: 지움이 도는 turn 때문에 `conflict`를 낸다. `packages/protocol/lophn-agent/sessions.ts`의 `deleteSession` 주석은 "진행 중 run이 있으면 conflict"라 하고 `endSession`은 interrupted로 닫고 진행한다) 제품 쪽 주석이 낡았는지 동작이 틀린지 가려 보고한다. 동작이 문서(place-session.md)와 다르면 제품 bug이다. 같은 불일치를 `stop-rows`의 `end-session-delete`도 본다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-sessions`(archive와 지움은 모든 영향을 한 tx에 묶는다), `router`(받은 call이 session의 끝으로 닫히면 보낸 쪽이 안다), `approvals`(끝난 session의 대기 request는 cancelled).
- 현실적 회귀: archive 때 turn만 닫히고 받은 call이 accepted로 남아 보낸 lophn이 영영 기다리는 것, 대기 request가 남아 늦은 allow가 쓰기를 일으키는 것, 지움은 call을 닫지 않는 것.
- 왜 지금 test가 못 잡나: `lifecycle`의 unit은 한 tx 안의 SQL만 본다. 도는 turn(child process)과 허락 대기(core 메모리)와 보낸 session의 새 입력(Router → 입력함 → 다음 turn)이 같이 맞아야 보인다. process와 session을 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/session_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/session_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "session을 archive하거나 지우면 도는 turn, 대기 허락, 받은 call이 한 번에 닫혀 늦은 허락이 쓰기를 일으키지 못하고 보낸 쪽이 실패를 안다"

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
