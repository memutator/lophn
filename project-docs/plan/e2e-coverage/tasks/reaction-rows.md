# reaction-rows

program이 App Engineer를 부르는 길(`ProblemOpened` → Reactor → reaction grant → Router)을 `tests/e2e/reaction_test.ts`로 본다: 기본(open)은 session이 열리고, "물음"은 사람이 허락해야 열리며, 물음 뒤에 끔으로 바꾸면 허락해도 안 열리고, 물음 request는 core를 껐다 켜도 남아 허락하면 session이 하나만 열린다. 앱 process 없이 앱을 등록만 하고, 문제는 shell main이 하는 `problems/observe-view-error`를 test가 대신 불러 연다.

- 단위: reaction-rows (wave 2)
- 선행: boot-damaged, gateway-client. `until` export와 `connectGateway`를 쓴다(support brief의 이름으로 맞춘다).
- 소유(이 task만 고친다):
  - `tests/e2e/reaction_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/events/reactor/`
  - `packages/core/approvals/`
  - `packages/core/problems/reporting/`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 4절 `reaction-ask`·`reaction-off`, 8절 `reaction-survives-restart`·`problem-opens-app-engineer`
  - architecture: `project-docs/architecture/event.md`("새 일 event만 reaction grant로 끌 수 있다", "반응은 최소 한 번, 효과는 한 번", "보류 request는 표에 남는다"), `project-docs/architecture/approval.md`(reaction grant는 Settings에서 온다, "applier는 실행 전에 ... 아직 꺼지지 않았는지 다시 본다"), `project-docs/products/AGENT-ROLE.md` §6 E1
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `events`, `router`, `approvals`, `problems`
  - 코드: `packages/core/events/reactor/session-opening.ts`(`handlerFor`: judge → `deny`면 아무것도 안 함, `run`이면 Router로 보냄, `ask`면 보류 request. `applier`: 허락 뒤 event를 ledger에서 다시 읽고 다시 judge한다), `packages/core/approvals/{applier,commands}.ts`(`decide`는 허락을 기록하고 적용은 그 뒤에 따로 돈다. 적용이 끝나면 `ApprovalDecided`가 `applied`와 함께 난다), `packages/core/approvals/grants/{grants,reaction-settings}.ts`, `packages/protocol/approvals/grants.ts`(`REACTION_EVENT_TYPES`, 모드 `off`·`open`·`ask`, 기본 `open`, 설정 key `reactions.problem_opened`), `packages/protocol/config/file.ts`(`settingsUpdate`: user, `{changes: [{key, action: "set", value}]}`), `packages/protocol/approvals/requests.ts`(`approvalsPending`, `approvalsDecide`), `packages/protocol/problems/reports.ts`(`observeViewError`: actors에 user가 있다. `view`는 `{view_session, generation, app, release, mode, bundle_hash}`, `observation`은 `exceptionObservationInputSchema`), `packages/protocol/problems/exception-observation.ts`, `packages/core/problems/reporting/worker/collector.ts`(`observeViewErrorPayload`: view 오류는 stack을 안 모으고, 묶는 key가 `report_id`라 보고마다 새 문제가 열린다), `packages/core/problems/snapshots/work.ts`(`observedErrorGroupKey`), `packages/protocol/problems/problems.ts`(`listProblems`), `packages/protocol/lophn-agent/{agent-sessions,received-messages}.ts`(`agentSessionList {agent: {role: "app_engineer", app}}`, `receivedMessageList {session}`의 `from`·`refs`), `packages/protocol/apps/apps.ts`(`appCreate`: user, `{slug, name, description}`), `packages/protocol/events/gateway.ts`(`ApprovalDecided` domain event frame)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/kill`, `connectFakeProvider`, `settle`, `waitTurnEnd`, `until`), `tests/support/gateway/mod.ts`(`connectGateway(core, {conditions})`, `Gateway.next`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/journal`)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: 위 support. 새 support를 만들지 않는다. 문제를 여는 호출(`reportViewError`)은 이 file 안의 작은 함수다(shell main이 하는 일을 한 번 부르는 것이라 support가 아니다).
  - 내놓는 것: 없음(test file만)

## 층을 정한 이유와 접은 것

core E2E다. 문제 접수는 collector worker child, 사건 기록은 core ledger, 반응은 core의 Reactor와 approvals, 세션 열기는 Router이고 turn은 agent runtime child다. 이 사슬은 process를 건너야 이어진다. grant 판정만의 경우의 수(`judge`)는 `approvals_test`가 본다.

- 문제를 여는 길로 앱 process 대신 `problems/observe-view-error`를 쓴다: user 자격이 허용된 shell main의 route이고, 앱 activation(wave 3)이 없어도 reaction 사슬 전부를 지난다. 앱 process가 던진 오류가 문제가 되는 길은 `reaction-app`이 본다.
- `reaction-survives-restart`(문제가 열린 commit 직후 core를 끈다)는 commit과 Reactor 사이에 끼어들 수 없어 시간 경쟁이고, 그 뜻(cursor 뒤부터 이어 반응, 같은 event에 두 번 반응하지 않음)은 `events/reactor/reactor_test.ts`가 본다. 대신 deterministic한 짝을 행 4로 둔다: 물음 request가 재시작에 남고 허락하면 한 번만 적용된다.
- `reaction-off`의 "event가 열릴 때 끔"은 negative를 기다릴 신호가 없어(Reactor의 진행을 보는 route가 없다) 행으로 못 둔다. 끔이 grant → 설정 key → 판정까지 이어지는 것은 행 3(물음 뒤 끔)이 허락 적용 시점에 본다. 이유를 test 머리 주석에 한 줄 남긴다.
- `gateway-snapshot-then-events`는 `gateway-client`의 `tests/e2e/gateway_test.ts`가 같은 계약을 본다. 여기서 다시 쓰지 않는다.

## 할 일

1. 새 file이다. `Deno.test` 하나, core 하나, 행 넷이 차례로 돈다(행 4가 core를 끈다). 준비: `startFakeServer` → `bootCore` → `connectFakeProvider` → `appCreate`(user, slug는 소문자·`-`) → `settle` → `connectGateway(core, {conditions: [{types: ["ApprovalDecided"]}]})`. 앱에 source 폴더를 연결하지 않는다(그러면 runtime이 다시 뜬다. App Engineer의 폴더 scope가 비어도 reaction turn은 text 대답으로 끝난다. 안 끝나면 보고한다).
2. 파일 안 helper 둘(support에 넣지 않는다).
   - `reportViewError(core, app)`: `observeViewError`를 user 자격으로 한 번 부른다. `view = {view_session: "e2e-view", generation: 0, app, release: null, mode: "live", bundle_hash: "e2e"}`, `observation = {report_id: core.ids.newId("rpt"), observed_at: <지금 ISO>, observation: "render_error", error: {name: "E2eViewError", message: "boom", message_missing_reason: null, stack: null, stack_missing_reason: {reason: "view"}}, error_missing_reason: null, invocation: null}`. 칸의 정확한 모양과 `atSchema` 형식은 위 schema에서 읽는다. 돌아온 뒤 `listProblems {app}`를 `until`로 읽어 새로 생긴 문제의 id를 돌려준다(보고마다 새 문제다). 이 route가 user 자격으로 `forbidden`·`unavailable`이면(코드로는 actors에 user가 있다) 지름길을 만들지 말고 멈춰 보고한다. 이 task는 `reaction-app`(wave 3)으로 합쳐질 수 있다.
   - `reactionSessions(core, app)`: `agentSessionList`로 그 앱의 App Engineer session을 읽고, session마다 `receivedMessageList`의 첫 메시지가 `from.kind === "program"`이면 그 `refs`의 problem id를 모아 `{session, problems}[]`로 돌려준다. 사람이 연 session은 program 메시지가 없어 빠진다.
3. 설정을 바꾸는 helper는 만들지 않고 `core.call(settingsUpdate, {changes: [{key: "reactions.problem_opened", action: "set", value: "ask"}]})`를 그대로 쓴다. 설정이 즉시 판정에 반영되는지(`createGrants.reactionGrant`가 매번 읽는다)를 첫 실행에서 확인한다. 기동 때만 읽으면 행마다 `settings` 옵션과 재시작으로 바꾸는 대신 보고한다.
4. 행 표. 모든 행은 `fake.reset()` 뒤 `fake.script`로 행 앞에서 대답을 새로 건다. 단계를 셀 때 "준비"(설정 바꾸기)와 재시작(kill·boot·settle)은 각각 한 단계로 본다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `open-opens-app-engineer` (기본 모드) | `reportViewError` → `until`(`reactionSessions`에 그 문제의 session이 하나) → `waitTurnEnd` | ① text | ledger: `listProblems`에 그 문제가 `open`이고 `reactionSessions`는 `[{problems: [그 문제]}]` 하나다 / route: 그 session의 첫 메시지 `from`이 program이고 `refs`에 그 문제 id가 있다 / fake: `journal()`이 정확히 1개이고 그 요청의 마지막 user 글에 그 문제 id가 있다(안 실리면 제품 결함 후보로 보고) | AGENT-ROLE E1, event.md. 기본이 "묻지 않고 연다" |
| `ask-needs-allow` | 준비: `settingsUpdate`(ask). `reportViewError` → `until`(`approvalsPending`에 request 하나) → `approvalsDecide {choice: {kind: "allow"}}` → Gateway `next("event", ApprovalDecided)` → `until`(`reactionSessions`에 둘째 session)로 찾아 `waitTurnEnd` | ① text | route: 허락 전 `approvalsPending`이 request 하나이고 `intent`가 reaction이며 그때 `reactionSessions`는 행 1의 것뿐이다(deterministic: pending이 있으면 보내는 길은 안 탔다) / event: `ApprovalDecided`의 `applied.state`가 `applied`다 / ledger: 허락 뒤 새 session이 정확히 하나이고 program 메시지의 `refs`가 이 문제다 | 후보 `reaction-ask`, approval.md "새 일 handler는 approvals를 거친다" |
| `ask-then-off` | 준비: 모드는 ask인 채. `reportViewError` → `until`(`approvalsPending`에 request 하나) → `settingsUpdate`(off) → `approvalsDecide`(allow) → Gateway `next("event", ApprovalDecided)` | 없음 | event: `ApprovalDecided`의 `applied`가 `failed`이고 code가 `forbidden`이다 / ledger: `reactionSessions`가 행 2 뒤와 같다(새 session 없음. 적용이 끝난 신호를 받은 뒤라 negative가 deterministic이다) / fake: `journal()`의 개수가 행 2 뒤와 같다(model 요청이 안 나갔다) | 후보 `reaction-off`, approval.md "applier는 ... 아직 꺼지지 않았는지 다시 본다" |
| `ask-survives-restart` | 준비: `settingsUpdate`(ask. 앞 행이 off로 끝났다). `reportViewError` → `until`(`approvalsPending`에 request 하나, id 기억) → 재시작(`core.kill()` → `bootCore(run)` → `settle`) → `approvalsDecide`(그 id, allow) → `until`(`reactionSessions`에 새 session)로 찾아 `waitTurnEnd` | ① text | route: 재시작 뒤 같은 id로 `approvalsDecide`가 성공한다(request가 표에 남았다) / ledger: 새 session이 정확히 하나이고 program 메시지가 이 문제를 가리킨다 / fake: 이 행에서 온 model 요청이 정확히 1개다 | event.md "꺼졌다 켜지면 ... 보류 request는 표에 남는다", 후보 `reaction-survives-restart`의 deterministic한 짝 |

5. 행 4는 core를 다시 띄우므로 Gateway 연결이 끊긴다. 이 행은 Gateway를 쓰지 않고 `until`로 읽는다. `finally`에서 Gateway를 닫고(`close()`), 새 core를 `kill()`한다. fake server의 `journal`은 `fake.reset()`을 행 앞에서 부르면 행마다 센다.
6. 어긋나면 test를 고치지 말고 제품 bug로 본다. 예: 허락했는데 session이 둘이 열림(적용이 두 번 돔), 끔인데 적용됨, 재시작 뒤 request가 사라짐.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `events`(새 일 event는 Reactor가 reaction grant대로 session을 연다. 끌 수 있고, 물으면 사람이 허락해야 하고, 효과는 한 번이다), `approvals`(보류 request는 재시작에 남고 적용 때 다시 검사한다), `router`(program이 App Engineer session을 연다).
- 현실적 회귀: 허락 없이 "물음"인데 session이 열리는 것, 끈 뒤에도 보류 request가 적용되는 것, 재시작 뒤 request가 사라지거나 두 번 적용되어 session이 둘 열리는 것, 문제가 열렸는데 Reactor가 그 event를 못 받는 것(collector worker → core → Reactor가 끊김).
- 왜 지금 test로 못 잡나: `reactor_test`·`approvals_test`는 handler와 판정을 fake port로 본다. 문제 접수(collector worker child) → ledger → Reactor → Router → agent runtime child의 turn까지 이어지는 길과 `settings.json`의 key 이름이 grant에 닿는지는 process를 건너야 보인다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/reaction_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/reaction_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: "program이 agent를 부르는 길은 grant대로만 열린다: 물으면 사람이 허락해야 열리고, 끈 뒤에는 허락해도 안 열리며, 재시작 뒤에도 한 번만 적용된다"

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
