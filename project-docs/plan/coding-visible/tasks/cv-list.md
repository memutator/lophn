# cv-list

App Engineer의 `session.list`가 열린 coding session을 싣게 한다. 지금은 `withCodingSessions`가 `find`에만 coding session을 더해 `listOpen`에 없고, App Engineer가 도는 coding agent의 id를 아는 길이 coding agent가 보낸 call의 봉투뿐이다. 근거는 `project-docs/issues/coding-agent.md`의 "App Engineer의 `session.list`는 열린 coding session을 보여 주지 않는다". 고르는 규칙(grant가 deny인 상대와 자기 자신을 뺀다)은 그대로 두고, `queued_coding`도 그대로 둔다. App Engineer 지침에 한 줄을 더해 봉투 밖에서도 이 길을 쓰게 한다.

- 단위: cv-list (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/main/daemon/wiring/router-registration.ts`
  - `packages/core/router/reads.ts`
  - `packages/core/agent-roles/roles/app-engineer/prompt.md`
  - `project-docs/architecture/agent-call.md`
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`(34행 목록의 상태, 56행 coding agent 맡기기, 65행 주소는 session ID), `coding-agent.md`(읽기만. 이 task는 고치지 않는다)
  - 코드: `packages/core/router/ports.ts`(`SessionDirectory.listOpen`, `TargetSession`), `packages/core/lophn-agent/places/directory.ts`(`listOpen`이 lophn session만 낸다), `packages/core/apps/tickets/coding/store.ts`(`liveSessions`, `loadSession`, `stateOf`), `packages/protocol/coding-agent/harness-adapter.ts`(`HARNESS_ADAPTERS[id].label`), `packages/core/lophn-agent/tools/call/sessions.ts`(`listSendable`)
- 계약:
  - 쓰는 것: `callSendable`(`packages/protocol/lophn-agent/calls.ts`)의 출력은 이미 `role: "coding_agent"`와 `state: "waiting"`을 허락한다(`SENDABLE_SESSION_STATES`). protocol은 바꾸지 않는다. `RouterEnvironment.describe`(`packages/core/router/environment.ts`)의 반환 모양 `{ place, state }`도 그대로다.
  - 내놓는 것: `session.list`의 `sessions`에 끝나지 않은 coding session이 `role: "coding_agent"`, `place: {kind:"app", id}`, `state: stateOf(row)`로 든다. 다른 task가 기대는 것은 없다.

## 할 일

1. `router-registration.ts` `withCodingSessions`에 `listOpen()`을 더한다. `directory.listOpen()` 뒤에 `liveSessions(sql)`의 각 행을 잇는다. 항목은 `{ session: row.session as Id<"ses">, transport: "harness", agent: { role: "coding_agent", app: row.app as Id<"app"> }, accepting: true, name }`이다. `liveSessions`가 ended 아닌 것만 주므로 `accepting`은 `true`다. 이유: 목록과 `find`가 같은 `transport:"harness"` 대상을 말해야 목록에서 고른 id가 `to:{session}`으로 그대로 닿는다.
2. `name`은 `HARNESS_ADAPTERS[row.harness].label`(`"Claude Code"`, `"Codex"` 등, `harness-adapter.ts`)이다. 이유: `name`은 필수 칸(`z.string()`)이다. lophn 쪽은 App Engineer가 앱 이름, Operator가 자기 이름을 내지만 coding session에는 이름이 따로 없다. 앱은 `place` 칸이 이미 말하므로 구별에 남는 것은 어느 harness냐다. 앱 하나에 끝나지 않은 session은 하나뿐이라(`activeOf`) 겹치지 않는다.
3. 같은 함수의 `sql` 인자를 `Pick<Sql, "get">`에서 `Pick<Sql, "get" | "all">`로 넓힌다(`liveSessions`가 `all`을 쓴다). 호출하는 곳은 `environment.deps`의 `view.sql` 하나이고 `SqlView.sql`(`router/store.ts`)이 이미 `get`·`all`을 가진다. `store.ts`의 `loadSession`은 이 file이 이미 import한 lophn `loadSession`과 이름이 겹치므로 `loadSession as loadCodingSession`으로 import한다.
4. 같은 file의 `environment.describe`가 coding session을 안다. 먼저 `loadCodingSession(view.sql, target.session)`을 보고, 있으면 `{ place: { kind: "app", id: row.app }, state: stateOf(row) }`를 돌려준다. 없으면 지금 코드(lophn `loadSession`, `turns`)로 간다. 이유: 지금 describe는 lophn `sessions`와 `turns`만 읽어 coding session은 place가 null, state가 idle로 나온다. `waiting`은 coding session만 낸다. lophn session은 reader가 허락 기다림을 못 봐서 지금처럼 구별하지 않는다.
5. `packages/core/router/reads.ts`의 `STATES`에 `"waiting"`을 더하고, 위 주석("허락 기다림(waiting)은 reader가 못 봐서 구별하지 않는다")을 "waiting은 coding session만 낸다. lophn session은 reader가 못 봐서 구별하지 않는다"로 고친다. 이유: `STATES.find(...) ?? "unknown"`이 waiting을 unknown으로 떨어뜨린다. `sendableRead`의 나머지(자기 제외, `!accepting`, `gate.visible`)는 고치지 않는다.
6. 새 test는 만들지 않는다. 이유: `visible`은 `gate()`의 verdict가 deny가 아니면 참이고, `agent_call`은 대상 agent를 `canonicalize`로만 맞춰 role을 가르지 않는다. grant 줄이 `excluded`면 deny, 줄이 없으면 run인 것은 `packages/core/approvals/gate/gate_test.ts`가 이미 본다. `sendableRead`의 거르기도 고치지 않는다. `router_test.ts`의 `listOpen: () => []`는 대역이라 그대로 둔다.
7. `app-engineer/prompt.md`의 "The coding agent's message arrives as …" 항목(ch-reply가 쓴 것) 바로 뒤에 한 줄을 더한다. 도는 coding agent는 `session.list`에도 `role: "coding_agent"`로 보이고, 봉투가 없을 때(새 session, 사람이 "그 coding agent에게 전해"라고 할 때)는 그 id로 `call`을 `to:{session}`, `reply:"conversation"`으로 보낸다. 목록에 없으면 도는 session이 없는 것이니 새 ticket 맡기기(`to:{role:"coding_agent", place}`)로 간다. 영어로, 앞 항목과 같은 말투로 쓴다. 이유: 줄이 없으면 App Engineer가 봉투 밖에서 이 길을 쓸 근거가 없다.
8. 문서(`agent-call.md`, 코드와 맞춘다):
   - 34행: "목록의 상태는 running, waiting, idle, unknown이다. waiting은 coding session만 낸다(대기 권한 요청, `stateOf`). lophn session은 reader가 허락 기다림을 못 봐서 running으로 보인다. 구별이 필요해지면 turn 행에 적는 쪽을 본다"로 고친다.
   - 56행 근처: 열린 coding session은 이 목록에 `role: "coding_agent"`로 실려 `to:{session}`으로 바로 보낼 수 있고, `queued_coding`은 아직 session이 없는 줄에 선 맡기기라는 것을 한 줄 더한다.

## 확인한 것(brief를 쓸 때 코드로 확인)

- `gate.visible`은 App Engineer가 보낸 쪽이고 coding agent가 받는 쪽일 때 통과한다. `callGate.verdict`가 보낸 agent의 grant를 읽고 `agent_call` 대상으로 `gate()`를 부르며, grant 줄이 없는 상대의 기본은 허락이다(`packages/core/approvals/gate/gate.ts`, AGENT-ROLE T4). `visible`은 deny가 아니면 true다.
- `callGate`가 보낸 쪽을 찾는 `directory.find`(`environment.deps`의 `senderAgent`, 감싸지 않은 쪽)는 lophn session만 찾는다. 이 task에는 영향이 없다. `sendableRead`의 보낸 쪽은 `actors: ["agent"]`, 곧 lophn agent session이고, coding agent는 `from.kind === "coding_agent"`로 다니며 Router `authorize`가 `from.kind !== "agent"`면 Gate를 건너뛴다. 그래서 감싼 `find`로 바꾸지 않는다.
- 다른 앱의 App Engineer도 grant가 deny가 아니면 이 앱의 coding session을 본다. "고르는 규칙은 지금 그대로"(계획 README)이므로 앱으로 좁히지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(grant 경계는 `gate_test.ts`가 본다. 위 6번).
- lead에게(eval 갱신): `tests/eval/versions/files.ts` `classifyPath`로 `router-registration.ts`·`reads.ts`는 `core`(RUNTIME 접두사 밖의 `packages/core/`), `app-engineer/prompt.md`는 `instruction`(INSTRUCTION이 RUNTIME보다 먼저다)을 올린다. `call.ts`는 안 건드려 `tool`은 그대로, `runtime`·`assembly`도 그대로다. 이 task는 `tests/eval`을 건드리지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음
- 정한 것: 문서에 답이 없어 worker가 정한 것(prompt 문구)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없음. (`coding-agent.md`에 목록 이야기를 더할 일이 생기면 고치지 말고 문구를 여기 적어 lead에게 넘긴다. 그 file은 cv-start가 소유한다.)
