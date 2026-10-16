# places-sessions-session

session을 agent(role과 place)에 놓고 수명을 새 모양으로 짠다. assignment를 지우고 role과 place로 가리킨다. session 상태는 열림과 archive이고 지움은 record를 지운다. archive나 지움의 영향 묶음, fork, session snapshot, Router가 쓰는 `SessionDirectory` 구현을 만든다.

- 단위: places-sessions (wave 3)
- 선행: 없음. 계약 고정 뒤 열린다. router와 동시에 돌 수 있다(`core/router/ports.ts`의 `SessionDirectory`를 구현만 한다).
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/{commands,model,fork,guards,reads,history,session-model,summary-read,mod}.ts`
  - `packages/core/lophn-agent/assignments/` (지우기)
  - `packages/core/lophn-agent/places/` (새로. 소유 바꾸기: places-sessions)
- 읽을 것:
  - spec: S8 2·3·5·6장(place, session 수명, 영향, fork, session 허락) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/place-session.md`
  - spec: S3 4·5장(닫힘의 뜻, 열린 call) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-call.md`
  - spec: S1 4·6장(session snapshot, `SessionStarted`·`SessionEnded`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - inventory: `I1.8#3`, `I1.8#4`, `I1.8#5`, `I2.8#3`, `I2.8#4`, `I2.8#7`, `I3.1#4`, `I3.8#5`, `I3.8#6`, `I3.8#7`
  - 요구: req-0043·0045(role은 열 때 정해지고 바뀌지 않는다, archive·지움), req-1522(보관한 place의 session은 새 입력을 받지 않는다) — `/home/pyosechang/projects/lophn/project-docs/requirements/core-lophn-agent.yaml`
  - 결정: `../README.md` 3장 #1·#4, #18·23·57
  - 지금 코드: `session/{commands,model,fork,reads,guards}.ts`, `assignments/*.ts`
- 계약:
  - 쓰는 것: `protocol/lophn-agent/{places,agent-sessions}.ts`(`AgentRef`, `Place`, `rolePlaceFits`, `agentSessionSchema`, `openAgentSession`, `agentSessionRead`, `agentSessionList`), `core/lophn-agent/ports.ts`(`ProjectDirectory`, `AppDirectory`, `SessionEndEffects`), `core/router/ports.ts`(`SessionDirectory`, `TargetSession`), `protocol/events`(`SessionStarted`·`SessionEnded` 등 agent event와 session snapshot. contract-events 것), run-loop의 `interruptRunningTurns`·`inbox.clear`(router task가 내놓는다. 같은 module 안이라 `run-loop/mod.ts`로 import한다)
  - 내놓는 것: `places/mod.ts`의 `createSessionDirectory(deps)`(`SessionDirectory` 구현), `createSessionSnapshots(...)`, session의 새 표와 command. wiring이 Router에 끼운다.

## 모양

### 표 (`session/model.ts`, 개발 data는 지우고 새로 만든다)

- `sessions`: `assignment` 열을 없애고 agent 참조로 바꾼다 — `role`(`lophn|project_manager|app_engineer|operator`), `project`·`app`(place, 없으면 null), `operator`(`agt` ID, role이 operator일 때만). `work_place_kind`·`work_place_id`는 `place_kind`·`place_id`(null 가능, lophn은 place 없음)로 바꾼다. `archived`·`state`·`closed_reason`·`closed_at` 대신 `lifecycle`(`open|archived`) 하나. `role`과 place의 짝은 `rolePlaceFits`와 같은 표를 CHECK로도 둔다(`I3.8#5`). schema step id는 `lophn-agent.sessions.tables`. `assignments` 표 참조(`references assignments`)는 지운다.
- `messages`: 이 task가 표를 정한다. router-run-loop-input이 그 표에 쓴다. 봉투 칸을 더한다(`I3.3#12`의 session 기록 쪽): `from_kind`(`human|program|agent|coding_agent`), `from_ref`(program이면 근거 event seq, agent·coding_agent면 보낸 session, human이면 null), `call`(cal, null 가능), `reply_to`(cal, null 가능), `refs`(JSON), `delivery`(`next_turn|steer`, 사람 메시지만). 옛 `actor`·`mode`·`run`은 `from_kind`·`delivery`·`turn`으로 바꾼다. 이 열 이름을 router-run-loop-input과 같게 쓴다.
- `MessageRow`, `SessionRow`, `loadMessage`, `hasUnappliedSteering` 같은 row type과 읽기 조회도 새 열을 따른다. 이름은 `session/mod.ts`로 다른 단위가 import하므로 옛 이름은 남기고 새 이름을 더한다(`AgentSessionRow`).

### 수명 (`session/commands.ts`)

- `open`(`openAgentSession`): `rolePlaceFits`가 false이면 거절(`I3.8#5`). 같은 표를 정의를 만들 때(agent-definition)도 쓴다. place(project 또는 앱)가 없거나 보관됐으면 `conflict`이다. `ProjectDirectory`·`AppDirectory`로 확인한다. `SessionStarted`를 Bus에 낸다. 옛 `assignment_revision`·`assignment_state` 비교는 없다.
- `archive`(`I2.8#3`): `lifecycle`을 `archived`로 바꾸고 한 tx 안에서 영향을 묶는다(`I3.8#6`): 도는 turn은 interrupted(`session_ended`)로 닫고(`interruptRunningTurns`), 받은 열린 call은 failed(`receiver_ended`)로(`SessionEndEffects.failReceivedCalls`), 대기 권한 요청과 질문은 cancelled로(`cancelPendingRequests`), "이 session 동안" 허락은 지운다(`forgetSessionGrants`), 입력함을 비운다(`inbox.clear`). 보낸 call의 답은 받은 session에만 남는다(아무것도 하지 않는다). archive한 session은 새 입력을 받지 않는다(`I3.8#7`): `places/model.ts`에 `acceptsInput(row, placeArchived)`를 내놓는다. `lifecycle === "open"`이고 place가 보관되지 않았을 때만 true이다. Router의 `TargetSession.accepting`이 이것이다. `session/message-commands.ts`의 거절은 router-run-loop-input이 이 함수를 부른다.
- `delete`(`I2.8#4`): `archive`와 같은 영향을 묶은 뒤 session과 그 기록(messages, tool call, model call)을 지운다. 옛 "돌거나 기다리는 run이 있으면 conflict" 거절은 없다. 도는 turn은 interrupted로 닫고 진행한다(S8 3장). `deleteSessionRecords` 의존은 유지한다.
- 지운다: `unarchive`와 `toggleArchived`의 풀기 방향, `SessionUnarchived` event(`I1.8#3`. 되살리기는 나중이다), `close` command, `sessionClosed`, `sessions.state`의 `closed`, `sessions_closed_terminal` trigger, 읽기의 closed 분기(`I1.8#4`).
- `rename`, `change model`은 모양이 그대로이다. 비교 기준만 새 열에 맞춘다.
- ledger에 쓰던 `Session*` event emit은 걷어낸다(S1 12장). 대신 `SessionStarted`·`SessionEnded`를 Bus에 낸다. 이 task가 session 쪽이다.

### fork (`session/fork.ts`, `I2.8#7`)

- 같은 role과 place(Operator면 같은 `operator`)의 새 session을 연다. 이력(확정 메시지)만 복사한다. 허락, 대기 요청과 질문, 열린 call(보낸 것과 받은 것), rewind 기록은 가져오지 않는다. 지금 코드가 숨긴 구간을 빼고 메시지만 복사하는 것이 이미 맞다. `loadAssignmentRef`를 role·place 읽기로 바꾼다. 복사한 메시지의 봉투 칸은 그대로 둔다.

### 접근 판정 (`session/guards.ts`, `session/reads.ts`)

- `visibleAssignment`를 `visibleSessions`로 바꾼다: user·machine은 모두, agent는 자기 session만(session ID로 판정. actor는 `agent:ses_…`), 그 밖은 없는 session과 같은 답. 목록 읽기(`agentSessionList`)는 `agent: AgentRef`와 `archived` 거름으로 찾는다.

### `assignments/` → `places/` (`I1.8#5`)

- `assignments/`의 표(`assignments`), 상태 machine(`createBuiltinAssignment`·`pause`·`resume`·`withdraw`), 기동 때 lophn·Context Engineer 준비(`bootstrap.ts`), AppCreated·보관 event를 읽는 반응 루프(`reaction.ts`, `reactions.ts`, cursor `lophn-agent-assignments`), `assignmentList`·`assignmentRead` 전부를 지운다. 쓰는 곳 가운데 소유 밖(`core/main/daemon/platform-register.ts`의 `ASSIGNMENT_REACTIONS_CONTEXT`, `register.ts`, `agents/`, `tools/`)은 고치지 않고 보고의 "남은 import"에 적는다.
- 반응이 하던 일은 다음이 대신한다. 앱을 보관하면 그 place의 session은 열린 채 남고 입력만 거절한다(`acceptsInput`가 `AppDirectory.app(...).archived`를 본다). Project Manager와 App Engineer는 project·앱 등록 때 agent-definition이 만든다. lophn은 한 개이다.
- `places/directory.ts` `createSessionDirectory(deps)`: `core/router/ports.ts`의 `SessionDirectory`를 구현한다. `find(session)`은 `TargetSession`(`transport: "lophn"`, `accepting: acceptsInput`)을 돌려준다. `resolveAgent(agent)`는 `ProjectDirectory`·`AppDirectory`·Operator 정의로 agent가 있는지 본다(없으면 `not_found`). `openOf(agent)`는 그 agent의 열린 session 가운데 가장 최근 것이다. `open(tx, agent, opener)`는 새 session을 연다. 보관한 place에는 `conflict`로 거절한다. `listOpen()`은 열린 session의 ID, role, place, 이름, 상태를 준다. coding agent 대상(`role: "coding_agent"`)은 이 구현이 다루지 않는다(coding-agent task의 transport가 한다).
- lophn 한 개 보장과 Project Manager·App Engineer 생성은 agent-definition 몫이다.

### session snapshot (`I3.1#4`)

- 지금 상태(running, waiting, idle, unknown)와 대기 중인 권한 요청·질문을 돌려주는 read. core가 agent event에서 계산한다. `createSessionSnapshots(bus, approvals)`가 Bus의 `TurnStarted`·`TurnEnded`·`PermissionRequested`·`PermissionResolved`·`QuestionAsked`·`QuestionResolved`·`SessionStarted`·`SessionEnded`를 듣고 session별 상태를 메모리에 둔다. 대기 목록은 approvals가 가진 session 안 request를 port로 읽는다. coding agent는 harness가 알려 준 것만 바꾸고 없으면 `unknown`이다. coding agent 상태를 지금 shell main 메모리(`ObservationStore`)가 가진 것은 coding-agent task가 core로 옮긴다.
- read route의 정의는 contract-events(Gateway 구독 frame의 snapshot)에 있다. 정의가 없으면 만들지 말고 "계약 바꾸기 요청"에 적는다.

## 할 일

1. `session/model.ts`의 표를 새 열로 바꾼다. `schema step`을 하나로 정리한다.
2. `session/commands.ts`: `open`, `archive`, `delete`를 위 모양대로 짠다. `unarchive`, `close`를 지운다.
3. `session/fork.ts`, `guards.ts`, `reads.ts`, `history.ts`, `session-model.ts`, `summary-read.ts`에서 `assignment`·`work_place`·`closed`를 role·place·lifecycle로 바꾼다.
4. `assignments/`를 지우고 `places/`(`mod.ts`, `model.ts`, `directory.ts`, `snapshots.ts`)를 짓는다.
5. `session/mod.ts`의 export를 새 이름으로 정리한다(옛 이름은 다른 단위가 쓰므로 `AgentSessionRow`처럼 새 이름을 더하고 옛 이름은 남긴다).
6. test: `places/places_test.ts` 한 파일. 가벼운 준비(저장소만, 또는 순수 함수와 port 대역)로 표를 돈다.
   - "archive한 session은 입력을 받지 않고 보관한 place의 session도 받지 않는다(`acceptsInput`)"
   - "fork는 이력만 복사하고 허락, 대기 요청, 열린 call, rewind 기록은 가져오지 않는다"
   - "role과 place가 맞지 않는 session은 열리지 않는다(`lophn`에 place, `project_manager`에 앱 등)"
7. (lead가 맞추며 더함) session snapshot 읽기는 contract-events의 `protocol/events/snapshot.ts`(`sessionSnapshotsList`)다. 계약 바꾸기 요청을 내지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "보관한 place나 archive한 session은 새 입력을 받지 않는다", "fork는 이력만 복사한다", "role과 place가 맞지 않는 session은 열리지 않는다"
- 남지 않음: `grep -rn "assignment\|work_place\|closed_reason\|unarchive" packages/core/lophn-agent/session packages/core/lophn-agent/places`가 `session/rewind/`와 `session/{message-commands,request,compact,compactor,session-title,message-body,body-read,answer-links}.ts`(다른 task의 file)를 빼고 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: core 조립 목록의 `createAssignmentCommands`·`assignmentSchemaSteps`·`createAssignmentReads` 줄을 뺀다, `places/`의 `createSessionDirectory`와 `createSessionSnapshots`를 `wiring`에 올린다, `protocol/lophn-agent/registry.ts`의 `ASSIGNMENT_ROUTES`·옛 `SESSION_COMMANDS`를 `AGENT_SESSION_ROUTES`로 바꾼다
- 안 쓰게 된 export: `protocol/lophn-agent/{assignments,assignment-values}.ts` 전체, `sessionRecordSchema`·`closeSession`·`unarchiveSession`(`sessions.ts`), `SessionClosed`·`SessionUnarchived`, `core/lophn-agent/assignments`의 모든 export
- 정한 것: `sessions`의 agent 참조 열, `messages`의 봉투 열 이름, `acceptsInput`을 둔 위치, 보관한 place로 열기를 `conflict`로 거절하는 것
- 계약 바꾸기 요청(wave 3): session snapshot read, `SessionEndEffects`에 모자란 것
