# cv-start

"Check the terminal"(`coding_start`) 항목이 터미널이 열릴 때 runtime을 받은 창에만 뜨는 bug를 고친다. coding session snapshot이 harness를 싣고, 대기 목록이 snapshot에서 `unknown`이고 SessionStart가 있는 harness의 coding session도 같은 delay로 센다. snapshot에서 첫 신호를 들은 session은 `done`에 넣어, event stream이 다시 붙은 뒤 온 runtime event가 이미 시작한 session에 항목을 다시 띄우지 않게 한다. 근거는 `project-docs/issues/coding-agent.md`의 "첫 신호 대기 항목은 터미널이 열릴 때 runtime을 받은 창에만 뜬다". 화면은 그대로이고(`coding_start`와 `start:<session>` id, 카드, 문구) 표시 조건만 고친다.

- 단위: cv-start (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/events/snapshot.ts`
  - `packages/core/main/daemon/wiring/session-snapshots.ts`
  - `packages/shell/renderer/desktop/connection/events/waiting-store.ts`
  - `packages/shell/renderer/desktop/connection/events/waiting-store_test.ts` (type이 요구할 때만. 지금 호출 모양은 그대로 맞다)
  - `project-docs/architecture/{coding-agent.md,event.md}`
- 읽을 것:
  - architecture: `project-docs/architecture/coding-agent.md`(70행 첫 신호 대기 항목, 83행 "첫 신호 대기는 core가 아니라 shell renderer가 센다"), `event.md`(25행 session snapshot)
  - 코드: `packages/core/apps/tickets/coding/store.ts`(`SessionRow.harness: HarnessId`, `stateOf`), `packages/shell/terminal-host/main.ts`(152행 `product: plan.harness_id`), `packages/shell/ipc/terminal.ts`(`TerminalRuntime.product`), `packages/protocol/coding-agent/hook-signal.ts`(`HOOK_EVENT_TABLE`), `packages/protocol/coding-agent/harness-id.ts`(`harnessIdSchema`)
- 계약:
  - 쓰는 것: `sessionSnapshotsList`(`packages/protocol/events/snapshot.ts`), `readSessionSnapshots`(`events/snapshots.ts`가 output을 `safeParse`한다), `HOOK_EVENT_TABLE`.
  - 내놓는 것: `SessionSnapshot`에 칸 하나, `harness?: HarnessId`. coding session의 snapshot만 싣고 lophn session은 싣지 않는다(계획 README "정한 것"). 다른 task가 기대는 것은 없다.

## 할 일

1. `snapshot.ts` `sessionSnapshotSchema`에 `harness: harnessIdSchema.optional()`을 더한다(`../coding-agent/harness-id.ts`에서 import. `lophn-agent/calls.ts`가 이미 같은 file을 import한다). 위에 주석 한 줄: coding session만 싣는다(첫 신호가 SessionStarted인 harness인지 창이 알아야 해서). 이유: `optional`이면 coding이 아닌 snapshot을 만드는 곳(아래 "고칠 곳 목록")이 하나도 바뀌지 않는다. `nullable`로 하면 fixture 여럿을 고쳐야 하고 얻는 것이 없다.
2. `session-snapshots.ts`: coding 행의 snapshot(`liveSessions`/`loadCodingSession` 루프)에 `harness: row.harness`를 더한다. lophn 행은 건드리지 않는다. 두 `push`는 `as SessionSnapshot`으로 넘기고 있어 칸이 빠져도 type이 못 잡으니 이 줄을 빠뜨리지 않는다.
3. `waiting-store.ts`: `watchStart`의 timer 부분을 session 하나를 받는 함수로 뽑는다(예: `waitStart(session, app, harness)`). 본문은 지금 그대로다: `done.has(session)`이나 `waitingStart.has(session)`이면 돌아가고, `startsWithSessionStart(harness)`가 아니면 돌아가고, 아니면 `STARTING_QUIET_MS` 뒤에 `put({ id: "start:<session>", kind: "coding_start", ... })`을 거는 `waitingStart.set`. `agent`·`place`는 `sessions.get(session)`을 먼저 보고 없으면 `{ role: "coding_agent", app }`, `{ kind: "app", id: app }`다. `watchStart`는 runtime의 `coding.app`과 `runtime.product`로 이 함수를 부른다. `startsWithSessionStart`의 인자 이름은 `product`에서 `harness`로 바꾼다. 이유: runtime의 `product`는 `plan.harness_id`(`terminal-host/main.ts`)라 `HarnessId`와 같은 id 공간이다. 그래서 한 predicate가 두 길을 다 받는다.
4. `replace()`: 지금의 첫 반복(`waitingStart`의 session 중 snapshot이 없거나 `state !== "unknown"`이면 `stopWaitingStart`)은 그대로 둔다. 그 뒤, `starts`를 모으기 전에 `read.snapshots`를 돈다. `agent.role === "coding_agent"`인 snapshot이:
   - `state === "unknown"`이면 `waitStart(snapshot.session, snapshot.agent.app, snapshot.harness)`로 같은 delay를 건다.
   - 아니면 `stopWaitingStart(snapshot.session)`을 부른다(이미 기다리지 않아도 `done`에는 들어간다). 이유: 첫 신호를 들은 session을 `done`에 넣어 두어야 다시 붙은 뒤에 도착하는 runtime event(`watchStart`)가 그 session을 새로 세지 않는다. `stopWaitingStart`가 `done.add`부터 하므로 새 함수는 필요 없다.
   `start:<session>` id는 그대로다. `sessions` map은 `replaceTurnRequests`가 채운다. timer가 터질 때 읽으므로 호출 순서는 상관없다.
5. 주석: `waitingStart`와 `STARTING_QUIET_MS` 위의 글에서 "runtime으로만"이라고 읽히는 곳을 고친다. 몇 개 안 된다.
6. 문서:
   - `coding-agent.md` 70행: 첫 신호 대기를 shell renderer가 센다는 문장에 두 길을 적는다. 터미널을 연 창은 runtime(`TerminalApi.onRuntime`)으로, 뒤에 연 창이나 다시 붙은 창은 snapshot에서 `unknown`이고 SessionStart가 있는 harness인 coding session으로 센다. 어느 길이든 delay와 지우는 조건은 같고, snapshot에서 첫 신호를 들은 session은 다시 세지 않는다.
   - `coding-agent.md` 83행: 근거 문장에 "snapshot이 coding session의 harness를 싣는 이유"(뒤에 연 창은 runtime을 받지 않아서)를 한 줄 더한다.
   - `event.md` 25행: session snapshot이 "coding session은 harness도 싣는다"를 덧붙인다.

## 고칠 곳 목록(SessionSnapshot을 만들고 읽는 모든 곳, 확인함)

`harness`가 `optional`이라 아래는 바꾸지 않는다. 바꿔야 할 것 같으면 고치지 말고 보고에 적는다.
- 만드는 곳: `core/main/daemon/wiring/session-snapshots.ts`(이 task가 고친다), gallery의 `shell/renderer/desktop/connection/waiting/fake-source.ts` `snapshotOf`(coding session도 `state: "waiting"`이라 snapshot 경로로 세지 않는다), `events/fake-source.ts`(snapshot을 호출한 쪽에서 받는다), `waiting-store_test.ts`의 두 fixture(lophn), `tests/eval/human/human_test.ts`의 fixture.
- 읽는 곳: `events/snapshots.ts`(schema로 parse), `sessions-store.ts`, `session-events-store.ts`, `agent-tab-core-source-{sessions,thread}.ts`, `tests/eval/runner/{spend,trial,idle,roots}.ts`, `tests/eval/human/role.ts`, `tests/e2e/*`, `tests/support/core/human.ts`. 모두 새 칸을 읽지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 표시만 바꾸고 사용자 데이터, 권한, 경계를 건드리지 않는다. 새 test는 만들지 않는다. `waiting-store_test.ts`는 `createWaitingStore(client, now, null, timer)` 호출이 이미 맞고 두 fixture가 lophn snapshot이라 고칠 일이 없을 것이다.
- 손으로 보기(lead, 선택): `deno task dev`에서 hook을 부르지 않는 가짜 `claude`로 맡기기를 하고, 5초 뒤 그 탭을 연 창에 항목이 뜨는지, 새 창을 열어도(창을 열고 5초 뒤) 같은 항목이 뜨는지 본다. 첫 신호를 보내면 두 창에서 사라진다.
- lead에게(eval 갱신): `classifyPath`로 `snapshot.ts`·`session-snapshots.ts`는 `core`를 올린다. `waiting-store.ts`와 docs는 `none`이다. `instruction`·`tool`·`runtime`은 그대로다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(함수 이름, 주석)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: snapshot 경로는 창을 연 때부터 5초를 센다. 터미널이 열린 지 오래된 멈춘 session은 창을 열고 5초 뒤에 뜨고, 막 시작한 session은 SessionStarted가 5초 안에 오면 뜨지 않는다(정상). 없으면 "없음".
