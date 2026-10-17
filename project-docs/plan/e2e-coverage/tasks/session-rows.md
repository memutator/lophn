# session-rows

place를 보관해도 session이 끝나지 않고 입력만 막히는 것, fork가 고른 지점까지의 이력만 복사하는 것, session을 열 때 place를 검사하는 것을 새 file `tests/e2e/session_test.ts`의 행으로 본다.

- 단위: session-rows (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/session_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/places/directory.ts`
  - `packages/core/lophn-agent/places/model.ts`
  - `packages/core/lophn-agent/session/message-commands.ts`
  - `packages/core/lophn-agent/session/fork.ts`
  - `packages/core/agent-roles/place/session-directory.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 6절의 `place-archive-holds-input`, `fork-copies-history`, `role-place-mismatch`
  - architecture: `project-docs/architecture/place-session.md`("지키는 것"의 role·place 고정, place 보관, fork), `project-docs/architecture/agent-call.md`("Router는 closed로 본다"), `project-docs/architecture/testing.md`
  - `project-docs/products/AGENT-ROLE.md`의 P1~P5
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `router`, `projects`, `core-api`
  - 코드(route 이름은 확인한 것): `project.archive`·`project.unarchive`(`projectApi.archive/unarchive`, compare `{base_revision}`는 `projectApi.get`·`register`가 주는 `project.revision`), `OpenSession`(`openAgentSession`, `packages/protocol/lophn-agent/agent-sessions.ts`), `SendMessage`(`sendMessage`), `ForkSession`(`forkSession {id, source, through_seq}`)와 `ArchiveSession`(`archiveSession`, compare `{state_seq}`), `ListReceivedMessages`(`receivedMessageList`, 칸 `created_seq`·`turn`·`body`), `Rewind`·`PreviewRewind`(`sessionRewind`, `sessionRewindPreview`, 쓰는 모양은 main의 `tests/e2e/rewind_test.ts`의 `rewindToBefore`), `ListSessions`(`agentSessionList {agent, archived?}`), `ReadSession`(`agentSessionRead`), `SendCall`을 부르는 tool `call`(`packages/core/lophn-agent/tools/bundles/call.ts`)
  - core의 검사 자리: `packages/core/lophn-agent/places/lifecycle.ts`의 `placeOfAgent`·`placeUsable`(열기: 없거나 보관된 place는 `conflict`, 없는 Operator는 `not_found`), `places/directory.ts`의 `placeArchived`(보관된 place의 session은 `accepting: false`), `session/message-commands.ts`의 `sendWith`(`conflict` "this session takes no new input"), `router/router.ts`(`accepting`이 아니면 call은 `closed`), `session/fork.ts`(숨긴 구간은 복사하지 않음, 허락·열린 call은 가져가지 않음)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `tests/e2e/{rewind,stop}_test.ts`(본보기)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`, `tests/support/fake-server/mod.ts`(위 목록 그대로), `projectApi`(`packages/protocol/projects/mod.ts`), `openAgentSession`·`agentSessionRead`·`agentSessionList`·`archiveSession`·`forkSession`·`receivedMessageList`·`sendMessage`·`sessionRewind`·`sessionRewindPreview`·`turnList`·`toolCallList`(`packages/protocol/lophn-agent/mod.ts`)
  - 내놓는 것: 없음(test file만. 뒤 task `session-scope`, `session-archive-calls`가 같은 file에 행을 더한다. file 머리의 helper와 core 띄우기를 그대로 두고 재사용하게 쓴다)

## 할 일

1. 새 file이다. `Deno.test` 하나 안에서 core를 한 번 띄우고(`bootCore`, `connectFakeProvider`) 행마다 새 project 폴더(`run.work/<행 이름>`)와 새 session을 쓴다(행의 준비를 반복하지 않는다). `deno test` 하나가 5분 안에 끝나게 core는 file 전체에서 하나다. 아래 세 표를 한 file에 둔다.
2. place 보관(`place-archive-holds-input`). project를 보관하면 그 PM session은 open인 채 새 입력만 막히고, 꺼내면 이어서 받는다. 근거: place-session.md "place를 보관하면 그 place의 session은 open인 채 남지만 새 입력을 받지 않고, Router에는 closed로 보인다. 다시 꺼내면 이어서 받는다".
   보관과 꺼내기는 agent runtime의 폴더 권한 합을 바꿔 runtime child를 다시 띄운다. 각각 부르기 전에 `runtimePids`로 옛 pid를 모으고 부른 뒤 `settle(core, 옛 pid)`로 기다린다. 보관해도 다시 안 뜨면(코드로 먼저 `packages/core/main/daemon/place-folders-glue.ts`의 `activeProjectFolderPaths`를 읽어 확인한다) `settle`을 인자 없이 쓴다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `person-message` | `openSession(PM)` → `projectApi.archive` + `settle` → `core.tryCall(sendMessage, ...)`(`say`는 던지므로 `tryCall`로 code를 본다) → `projectApi.unarchive` + `settle` → `say` → `waitTurnEnd` | ① text | route: 보관 중 보낸 message가 `conflict`다 / ledger: `receivedMessageList`가 꺼낸 뒤 보낸 message 하나뿐이고(거절된 것은 흔적이 없다) `agentSessionRead`의 `lifecycle`이 `open`이며 turn이 끝났다 / fake: journal이 1개다(보관 중에는 model 요청이 없었다) | 후보 `place-archive-holds-input`, place-session 31행. 보관은 되돌릴 수 있는 일이라 session을 끝내면 안 된다 |
| `agent-call` | 두 session을 먼저 연다: `openSession(PM)`(id `pm`), `openSession(lophn)` → `projectApi.archive` + `settle` → `say(lophn)` → `waitTurnEnd(lophn)` | ① tool `call {to: {session: <pm>}, reply: "none", body: "hi", refs: []}` ② text. 대답을 `script`하기 전에 `pm`을 알 수 있다(`openSession`이 id를 돌려준다) | fake: 둘째 요청의 `call` tool_result에 `closed`가 들어 있다 / ledger: `receivedMessageList(pm)`이 비어 있다 / route: `agentSessionRead(pm).session.lifecycle`이 `open`이다(call이 닫혀도 session은 안 끝났다) | 같은 후보의 call 쪽. Router가 `accepting: false`를 `closed`로 돌려주는 길(`router/router.ts`) |

   - `archive`가 session이 있는 project에서 거절되면 제품 bug 후보다. place-session.md와 다르므로 보고에 적고 고치기 전 코드에서 행이 실패한 출력을 남긴다.
3. fork(`fork-copies-history`). 같은 role·place의 새 session이 고른 지점까지의 확정 message만 가져가고 rewind로 숨긴 구간은 가져가지 않는다. 근거: place-session.md "fork는 이력만 복사한다 ... rewind가 숨긴 구간은 복사하지 않는다". fork의 `through_seq`는 `receivedMessageList`가 주는 그 message의 `created_seq`다. model 대답은 session마다 text 하나씩이라 대화 한 turn이 대답 하나다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `fork-at-point` | `openSession(PM)` → `say` ×3(각각 `waitTurnEnd`로 끝내고 다음을 보낸다) → `receivedMessageList` → `forkSession {through_seq: 둘째 message의 created_seq}` → `receivedMessageList(fork)` | ① text ② text ③ text | route: `forkSession`의 `copied_messages`가 2이고 `forked_from`이 `{session, through_seq}`다 / ledger: fork의 `receivedMessageList`가 원래 첫째·둘째 message의 `body`(hash)와 같고 `turn`이 모두 `null`이며 `turnList(fork)`가 비어 있다 / route: `agentSessionRead(fork)`의 `agent`가 원래와 같고 `lifecycle`이 `open`이다 | 후보 `fork-copies-history`, place-session 34행 |
| `fork-skips-rewound` | `openSession(PM)` → `say`(M1) → `waitTurnEnd` → `say`(M2) → `waitTurnEnd` → `sessionRewindPreview`·`sessionRewind {choice: "messages_only", checkpoint: M2}`(`rewind_test.ts`의 `rewindToBefore` 모양) → `say`(M3) → `waitTurnEnd` → `forkSession {through_seq: M3의 created_seq}` | ① text ② text ③ text | route: `copied_messages`가 2다 / ledger: fork의 message `body`가 [M1, M3]의 것이고 M2의 것이 없다 / route: `turnList(fork)`가 비어 있다 | 같은 후보. 숨긴 구간(M2 이후, rewind 결과 전)은 복사하지 않는다 |

   - M1~M3는 서로 다른 글(예 `one`, `two`, `three`)로 보낸다. `receivedMessageList`의 `body`는 hash이므로 같은 글끼리 hash가 같다는 것으로 견주거나 `messageBody`(`ReadMessageBody`)로 글을 읽는다.
   - 허락(approval)과 열린 call을 가져가지 않는 규칙은 여기서 보지 않는다(fake 대답 3 상한과 approval 행이 따로 있다).
4. role과 place(`role-place-mismatch`). session을 열 때의 검사 한 곳(`startSession`)이 어느 길로 열어도 같다. 근거: place-session.md "role과 place는 session을 열 때 정해지고 바뀌지 않는다. role에 맞지 않는 place, 없거나 보관된 place에는 열지 않는다", "session을 여는 길은 사람, Router, Reactor이고 모두 같은 연산으로 연다".
   **코드로 확인한 한계**: `AgentRef`가 role마다 알맞은 id 종류(PM은 `prj_`, App Engineer는 `app_`, Operator는 `agt_`)만 받는다. 맞지 않는 id 종류는 `createRpcClient`가 요청 보내기 전에 `invalid_input`으로 거르고(`packages/protocol/client/client.ts`), Operator는 어느 place에나 맞는다. 그래서 route로 "App Engineer를 project에" 같은 짝은 core까지 오지 못한다(`rolePlaceFits`는 `places_test.ts`와 protocol의 값 검사가 본다). E2E로 닿는 것은 아래 넷이다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `archived-project` | `projectApi.archive` + `settle` → `core.tryCall(openAgentSession, {agent: PM})` → `projectApi.unarchive` + `settle` → `openSession(PM)` | 없음 | route: 보관 중 열기가 `conflict`다 / ledger: `agentSessionList({agent: PM, archived: "include"})`가 그 전에는 비어 있다 / route: 꺼낸 뒤 같은 project의 PM session은 열린다 | `lifecycle.ts`의 `placeUsable`("the place is archived") |
| `unknown-app` | `core.tryCall(openAgentSession, {agent: {role: "app_engineer", app: core.ids.newId("app")}})` | 없음 | route: `conflict`다 / ledger: `agentSessionList({agent: 그 ref})`가 비어 있다 | `placeUsable`("the place does not exist") |
| `unknown-operator` | `core.tryCall(openAgentSession, {agent: {role: "operator", agent: core.ids.newId("agt")}})` | 없음 | route: `not_found`다 / ledger: `agentSessionList({agent: 그 ref})`가 비어 있다 | `placeOfAgent`("operator not found") |
| `call-wrong-kind` | `openSession(lophn)` → `say` → `waitTurnEnd` → `agentSessionList({agent: PM})` | ① tool `call {to: {role: "app_engineer", place: {project: <project 이름>}}, reply: "none", body: "hi", refs: []}` ② text | fake: 둘째 요청의 `call` tool_result에 `not_found`가 들어 있다 / route: PM의 `agentSessionList`가 비어 있고 새 session이 안 열렸다 / ledger: `toolCallList`의 `call` call은 `success`다(실패는 결과 값이다) | Router의 이름 풀기(`tools/call/target.ts`의 `named`가 project place의 App Engineer를 못 푼다). 사람 길과 같은 검사로 닫히는지 |

   - `call-wrong-kind`에서 `not_found`가 안 나오고 session이 열리면 role·place 검사가 길마다 다른 것이므로 제품 bug다. 보고한다.
5. 한 `Deno.test`가 길어지면 `t.step`으로 행을 나눈다(sanitizer를 끄지 않는다). 행마다 project 폴더 이름을 다르게 한다(`openProject`의 이름이 폴더 이름에서 나온다).

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-sessions`(role·place는 열 때 정해지고 한 곳에서 검사한다, place를 보관해도 session은 안 끝난다, fork는 이력만 복사한다), `router`(보관된 place는 closed로 보인다).
- 현실적 회귀: project 보관이 PM session을 끝내거나 보관 중에도 message가 접수되는 것, 꺼낸 뒤 session이 이어지지 않는 것, fork가 rewind로 숨긴 구간을 되살리는 것이나 허락·열린 call까지 가져가는 것, call 길로 열 때만 place 검사가 빠지는 것.
- 왜 지금 test가 못 잡나: `places_test.ts`와 `session`의 unit은 한 module 안의 SQL만 본다. 보관(projects) → `accepting`(places) → 입력함·Router(router) → 새 입력의 turn이 이어지는 것은 module과 process를 건너야 이어진다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/session_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/session_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "보관한 place의 session은 열린 채 남고 입력만 막히며, 꺼내면 이어서 받는다. fork는 숨긴 구간을 되살리지 않는다"

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
