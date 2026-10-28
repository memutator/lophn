# sessions-core

session의 정체를 (agent id, place)로 바꾼다: `sessions` 표, 열기·읽기·목록·fork·compact 요청, 여는 검사, 보관·끝의 불변. 새 route 상수(`placeSession*`)로 구현하고 core 안에서 session route를 부르는 조립을 옮긴다. turn 길(run-loop, tool, credential)은 `place-tools`가 옮긴다.

- 단위: sessions (wave 2)
- 선행: agents-core. 여는 검사가 `AgentId`로 정의를 찾는다.
- 소유(이 task만 고친다):
  - `packages/core/lophn-agent/session/{model,commands,reads,fork,guards,caller-directory,history,history_test,compactor}.ts`
  - `packages/core/lophn-agent/session/rewind/{rewind_test,artifact-writer_test}.ts`
  - `packages/core/lophn-agent/places`
  - `packages/core/lophn-agent/message-images.ts`
  - `packages/core/lophn-agent/agents/{layers,caller}.ts` (넘길 줄: session 읽기)
  - `packages/core/lophn-agent/run-loop/runtime-access.ts` (machine route 목록)
  - `packages/core/agent-places/place/session-directory.ts` (여는 규칙)
  - `packages/core/main/daemon/{agent-domains,place-folders-glue,place-folders-glue_test}.ts` (넘길 줄: `sessions` 열 읽기)
  - `packages/core/main/daemon/wiring/{session-snapshots,lophn-agent-registration,lophn-agent-session,router,runs,workflows,jobs,approvals}.ts` (session route를 부르는 곳)
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/core/lophn-agent/instructions/{files,read_test}.ts`
  - `packages/core/lophn-agent/commands/reads.ts`
  - `packages/core/lophn-agent/session/message-commands_test.ts`
  - `packages/core/lophn-agent/session/rewind/artifact-writer.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "session과 place 종류"(session의 정체는 (agent id, place)), "주소와 넘기기"(domain 일을 받는 쪽은 주인 그릇 place의 lophn session), "저장과 test"(schema, 위험 test "session 정체 불변"), "뼈대 검토"(계약은 일부만 옛 꼴 옆에 둔다, `sessions-core`와 `place-tools`는 이어서 합친다).
  - 계약 brief: `project-docs/plan/remove-role/tasks/contract-session.md`(`placeSessionSchema`·`PlaceSession`과 route 넷의 input·output·actors), `tasks/contract-agent.md`(`AgentId`, `LOPHN_AGENT_ID`, `placeKindOf`). 앞 task `tasks/agents-core.md`의 "내놓는 것"과 1·2번(`agentIdOfRef`, `createAgentDirectory`·`AgentDirectory`, `lophn-agent-team.ts`의 `agentDirectory`). 뒤 task `tasks/router-core.md`, `tasks/place-tools.md`, `tasks/place-scope.md`, `tasks/runs-core.md`(이 task가 남긴 옛 꼴 넘김을 그들이 지운다). 앞 task가 실제로 바꾼 것은 plan branch에서 `git log --oneline main..HEAD`와 그 diff로 본다.
  - architecture: `project-docs/architecture/place-session.md` "흐름"과 "지키는 것"(role과 place는 열 때 정해지고 바뀌지 않는다 → agent와 place, 여는 길은 사람과 Router 둘이고 같은 연산, 보관한 place의 session은 열린 채 새 입력만 막힌다, archive·지움은 한 tx, fork는 같은 agent·place에 이력만 복사하고 skip을 가져가지 않는다). `project-docs/architecture/annotation.md` "지키는 것"(artifact annotation은 마지막으로 쓴 session이 받는다).
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `lophn-agent` › `agent-sessions`·`agents`, `router`, `core-api`. `project-docs/module-catalog.yaml`의 `packages/core/lophn-agent`, `packages/core/main`(wiring file끼리 import하지 않는다).
  - 규칙: `tools/check-deps.ts`의 harness-domain(`packages/core/lophn-agent/` 아래 test 아닌 file에 `"project_manager"`·`"app_engineer"`·`"operator"` 글을 쓰지 못한다)과 core 층. `.claude/skills/write-test/SKILL.md`.
  - 코드(고칠 것). `agent-roles`는 wave 1 `agent-places-rename`이 `agent-places`로 옮겼다. 아래는 옮긴 뒤 자리다.
    - 표와 행: `packages/core/lophn-agent/session/model.ts`(`conversationSchemaSteps`의 `create table sessions`·index·trigger, `AgentSessionRow`, `SESSION_COLUMNS`, `sessionRowOf`, `agentRefOf`, `agentClause`, `agentSessionOf`)
    - 여는 검사: `packages/core/lophn-agent/places/lifecycle.ts`(`placeOfAgent`, `startSession`), `places/ports.ts`(`PlaceDeps`, `OperatorDirectory`), `places/unwired.ts`, `places/mod.ts`, `places/directory.ts`(`createSessionDirectory`: `targetOf`, `openOf`, `open`, `listOpen`)
    - route: `session/commands.ts`(`open`), `session/fork.ts`(`createForkCommand`), `session/reads.ts`(`session`, `sessions`, `compactRequests`), `session/guards.ts`
    - session을 읽는 곳: `session/history.ts`(`readSessionConversation`), `session/compactor.ts`(`next`), `message-images.ts`(upload의 session 확인), `session/caller-directory.ts`, `run-loop/runtime-access.ts`(`RUNTIME_MACHINE_ROUTES`)
    - 이름 규칙: `packages/core/agent-places/place/session-directory.ts`(`createPlaceRoleRules`의 `resolveNamed` operator 갈래와 `nameOf`)
    - 조립: `packages/core/main/daemon/wiring/lophn-agent-registration.ts`(`installPlaceEnvironment`), `wiring/router.ts`(`ANNOTATION_DELIVERY_CONTEXT`, `checkOpenSession`, `sendHuman`, `lastArtifactWriter` 호출), `wiring/runs.ts`(`RUNS_CONTEXT`, `agents.agentOf`, `agents.open`), `wiring/workflows.ts`(`WORKFLOWS` 자격, `workflowList`의 session 읽기), `wiring/approvals.ts`(`APPROVALS_CONTEXT`, `sessionOf`), `wiring/session-snapshots.ts`, `packages/core/main/daemon/agent-domains.ts`(`sessionDomains`), `packages/core/main/daemon/place-folders-glue.ts`(`placeFoldersOf`)
    - test: `places/places_test.ts`, `session/history_test.ts`, `session/rewind/{rewind_test,artifact-writer_test}.ts`, `packages/core/main/daemon/place-folders-glue_test.ts`
  - 코드(읽기만): `packages/protocol/lophn-agent/agent-sessions.ts`(새 route와 옛 `openAgentSession`·`agentSessionRead`·`agentSessionList`), `packages/protocol/lophn-agent/sessions.ts`(`sessionCompactRequests`가 `SESSION_COMMANDS` 안에 있다), `packages/protocol/lophn-agent/registry.ts`, `packages/core/lophn-agent/agents/{mod,directory}.ts`(agents-core), `packages/core/lophn-agent/agents/layers.ts`·`run-loop/{prepare,agent-credentials,runtime}.ts`(turn 길. `place-tools`가 옮긴다), `packages/core/main/daemon/wiring/jobs-registration.ts`(`agentRefOf`, `placeDepsOf(...).operators`를 부른다), `packages/core/lophn-agent/session/rewind/artifact-writer.ts`(`lastArtifactWriter`의 `s.role in (...)`), `packages/core/lophn-agent/observability/reads.ts`(contract-agent가 `select id from sessions`로 바꿨다).
- 계약:
  - 쓰는 것: `contract-session`의 `PlaceSession`, `PLACE_SESSION_ROUTES`(`placeSessionOpen`, `placeSessionRead`, `placeSessionList`, `placeSessionCompactRequests`). `contract-agent`의 `AgentId`, `placeKindOf`. `agents-core`의 `AgentId`로 받는 정의 읽기.
  - 내놓는 것:
    - 표 `sessions`: `role`·`operator` 열, role과 `place_kind`를 잇는 CHECK를 지우고 `agent TEXT NOT NULL`(`AgentId`)을 둔다. `place_kind`·`place_id`는 그대로다(null이면 home). index는 `(agent, place_kind, place_id, lifecycle)`. schema step을 고치고 개발 data는 지운다.
    - 여는 검사(사람과 Router가 같은 연산): 정의가 있는 agent이고, place가 null이거나 있고 보관되지 않은 project·app이다. 열린 session의 agent와 place는 바뀌지 않는다. fork는 같은 agent·같은 place다.
    - `SessionStarted`와 session snapshot은 옛 꼴(`{ role: "lophn" }`, `{ role: "operator", agent }`)로 낸다. `shell-events`(wave 3)가 바꾼다.
    - core 안 조립(router, runs, workflows, jobs, approvals 배선)은 새 상수로 session을 열고 읽는다. 그 아래 module이 아직 옛 `AgentRef`를 받으면 lophn → `{ role: "lophn" }`, `agt_…` → `{ role: "operator", agent }`로 넘기고, 그 module task(`router-core`, `runs-core`, `jobs-core`, `workflows-core`, `place-tools`)가 옮길 때 그 줄을 지운다.
    - turn 길은 아직 옛 꼴로 session을 읽어 이 task를 합친 뒤 `place-tools`를 합칠 때까지 turn이 돌지 않는다. lead는 둘을 이어 합친다.
    - 등록할 것(lead): registry에서 `AGENT_SESSION_ROUTES`와 `sessionCompactRequests`를 `PLACE_SESSION_ROUTES`로 바꾼다.

## 할 일

session의 정체는 `{ agent: AgentId, place: Place | null }`이고 place가 null이면 home이다(README "session의 정체는 (agent id, place)다"). 이 task가 끝나도 아직 옛 `AgentRef`를 받는 module이 있다. 그쪽에 넘길 때만 아래 1번의 다리를 쓴다. 다리는 그 module task가 옮길 때 지운다.

**turn 길은 고치지 않는다.** `packages/core/lophn-agent/agents/layers.ts`, `run-loop/{prepare,agent-credentials,runtime}.ts`는 옛 `agentSessionRead`로 session을 읽는 채 둔다(계약 "turn 길은 아직 옛 꼴로 session을 읽어 … turn이 돌지 않는다"). `place-tools`가 옮긴다. `agents/caller.ts`는 `agents-core`가 지웠으면 건너뛴다.

1. **표와 행**(`session/model.ts`). 근거: 계약 "표 `sessions`", README "schema", AGENTS.md "호환성".
   - `create table sessions`: `role`·`operator` 열과 그 CHECK 셋(`role in (...)`, `(role = 'operator') = (operator is not null)`, role과 `place_kind`를 잇는 줄)을 지우고 `id` 다음에 `agent text not null`을 둔다. `project`·`app`·`place_kind`·`place_id`와 그 CHECK는 그대로다.
   - index는 `create index sessions_agent on sessions (agent, place_kind, place_id, lifecycle);`.
   - trigger `sessions_identity_immutable`의 열은 `id, agent, project, app, place_kind, place_id, forked_from_session, forked_from_through_seq, created_seq`다.
   - schema step id는 그대로 두고 SQL을 고친다. migration은 만들지 않는다. 개발 data는 지운다.
   - 머리 주석: "session의 agent와 place와 출처는 바뀌지 않는다". `rolePlaceFits`를 말하는 줄을 지운다.
   - `AgentSessionRow`: `role`·`operator` 대신 `agent: AgentId`. `SESSION_COLUMNS`, `sessionRowOf`를 맞춘다.
   - `agentSessionOf`를 `placeSessionOf(row): PlaceSession`으로 바꾼다. `agentClause(agent: AgentRef)`를 `sessionClause(agent: AgentId, place: Place | null)`로 바꾼다(`agent = ? and place_kind is ? and place_id is ?`).
   - 다리 둘(옛 꼴 넘김. 계약 "lophn → `{ role: "lophn" }`, `agt_…` → `{ role: "operator", agent }`"):
     - `agentRefOfId(id: AgentId): AgentRef`와 `agentRefOf(row) = agentRefOfId(row.agent)`.
     - harness file이라 `"operator"` 글을 쓰지 못한다. 값은 `roleSchema.enum.operator`처럼 protocol 값에서 얻고 주석에 "옛 꼴을 내는 임시 다리다. 쓰는 곳을 옮기는 task(shell-events, router-core, place-tools, jobs-core, place-scope)와 cleanup-core가 지운다"를 적는다("정한 것" 1).
     - 쓰는 곳: `SessionStarted`(2번), session snapshot, Router의 `TargetSession`(5번), apps의 `CallerDirectory`(4번), `wiring/{runs,approvals}.ts`(6번), `agent-domains.ts`, `jobs-registration.ts`(소유 밖, 그대로 맞는다), 8번의 넘길 줄.
2. **여는 검사**(`places/{lifecycle,ports,unwired,mod}.ts`). 근거: 계약 "여는 검사", `place-session.md` "열 때의 검사를 한 곳에 둔다".
   - `ports.ts`의 `PlaceDeps`에 `agents: AgentDirectory`(`agents-core`의 `lophn-agent/agents/mod.ts`)를 더한다. 옛 `operators`는 빈 조회로 남는다(`jobs-registration.ts`가 아직 읽는다. `cleanup-core`가 지운다). 주석을 고친다.
   - `unwired.ts`의 `UNWIRED_PLACE_DEPS`에 `agents: { agent: () => null, agents: () => [] }`.
   - `lifecycle.ts`:
     - `startSession(tx, deps, { id, agent: AgentId, place: Place | null, inherit? })`.
     - `deps.agents.agent(agent)`가 null이면 `not_found` "agent not found". place가 있으면 지금 `placeUsable`(없거나 보관됐으면 `conflict`)을 그대로 쓴다.
     - 새 session의 skip은 그 정의의 `skip`이다(lophn 포함. README "나머지 칸은 다른 agent와 같다").
     - insert는 `agent`, `project`·`app`(place에서), `place_kind`, `place_id`를 쓴다.
     - `SessionStarted` payload는 옛 꼴이다: `{ agent: agentRefOf(row), place, external_session: null, revived: false }`(계약. `shell-events`가 바꾼다).
     - `placeOfAgent`, `rolePlaceFits`, `agentIdentityOf`, `placeOfAgentRef` import를 지운다.
3. **route**(`session/{commands,fork,reads,guards}.ts`). 근거: contract-session의 `PLACE_SESSION_ROUTES`.
   - `commands.ts`의 `open`: route `placeSessionOpen`, input `{ id, agent, place }`. 같은 id가 있으면 agent와 place(`canonicalize`로 견준다)가 같을 때만 지금처럼 앞 결과를 내고, 다르면 `conflict` "session id already used". 열린 session이 아니면 지금처럼 `conflict`. 없으면 `startSession`.
   - `fork.ts`: 새 session은 `{ agent: source.agent, place: placeOf(source) }`로 연다. 정의가 없어졌거나 place가 보관됐으면 열리지 않는다(지금과 같은 길).
   - `reads.ts`:
     - `session` → `placeSessionRead`(`placeSessionOf`).
     - `sessions` → `placeSessionList`. 거르기는 `sessionClause(input.agent, input.place)`이고 나머지(cursor, archived, agent 자격은 자기 session만)는 그대로다.
     - `compactRequests` → `placeSessionCompactRequests`. 한 줄은 `{ session, agent: row.agent, place: placeOf(row), request_seq }`.
   - `guards.ts`: type만 따라간다.
4. **session을 읽는 harness 쪽**(turn 길 밖). 근거: 계약 "core 안 조립은 새 상수로 session을 열고 읽는다".
   - `session/history.ts`의 `readSessionConversation`: `placeSessionRead`로 읽는다(`compaction`만 쓴다). 이 file은 `place-tools` 소유가 아니라 여기서 옮겨야 turn이 다시 돈다.
   - `session/history_test.ts`: 대역 `/sessions/read`의 `agent`를 `"lophn"`으로.
   - `session/compactor.ts`: `next()`의 `sessionCompactRequests`를 `placeSessionCompactRequests`로. `resolveTurnAgent`를 부르는 줄은 turn 길이라 그대로 둔다.
   - `message-images.ts`: upload의 session 확인을 `placeSessionRead`로.
   - `session/caller-directory.ts`: `agent: agentRefOf(row)`가 옛 꼴을 낸다(apps의 `CallerDirectory`가 아직 `AgentRef`다). 고칠 것이 없으면 그대로 두고, `place-tools`가 `AgentId`로 바꾼다.
   - `run-loop/runtime-access.ts`: `RUNTIME_MACHINE_ROUTES`의 `agentSessionRead`를 `placeSessionRead`로, `sessionCompactRequests`를 `placeSessionCompactRequests`로(이름 글이 같아 machine 자격은 그대로다).
5. **Router의 session 목록과 이름 규칙**(`places/directory.ts`, `agent-places/place/session-directory.ts`). `router-core`가 바로 뒤에 새 주소로 다시 쓴다. 여기는 type이 맞고 열기가 새 검사를 타게만 한다.
   - `directory.ts`:
     - `targetOf(row)`의 agent는 `agentRefOf(row)`.
     - `openOf(agent: CallAgent)`와 `open(tx, agent: CallAgent, …)`은 옛 `CallAgent`를 `agentIdOfRef`(agents-core)로 id로, `placeOfAgentRef(agent) ?? null`로 place로 옮긴다. id가 null(PM·AE)이면 `openOf`는 null, `open`은 `not_found` "agent not found". 그 뒤는 `sessionClause`와 새 `startSession`이다.
     - `listOpen`의 name은 `deps.roles.nameOf(agentRefOf(row))`.
   - `session-directory.ts`의 `createPlaceRoleRules(deps: Pick<PlaceDeps, "projects" | "apps" | "agents">)`:
     - `resolveNamed`의 operator 갈래는 `deps.agents.agents()`에서 이름이 같은 agent를 고른다. 정의에 place가 없으므로 주소의 place로 거르지 않는다. 0개면 `not_found`, 둘 이상이면 지금처럼 `invalid_input`.
     - `nameOf`의 operator 갈래는 `deps.agents.agent(ref.agent)?.name ?? ""`. `operators`를 읽지 않는다.
6. **조립**(`main/daemon/wiring/*`, `agent-domains.ts`, `place-folders-glue.ts`). route 상수를 새 것으로 바꾸고, 자격(`AuthenticatedContext.scope.operations`)의 이름도 새 상수의 `.name`으로 바꾼다(글은 같다).
   - `lophn-agent-registration.ts`: `installPlaceEnvironment`의 deps에 `agents: agentDirectory(sql)`(agents-core가 `lophn-agent-team.ts`에서 내놓는다)를 넣고, `createPlaceRoleRules({ projects, apps, agents })`.
   - `session-snapshots.ts`: snapshot의 agent는 `agentRefOf(row)`라 옛 꼴 그대로다(`shell-events`가 바꾼다). 고칠 것이 없으면 그대로 둔다.
   - `router.ts`(annotation 배달은 `router-core`가 고른 agent로 다시 쓴다):
     - `ANNOTATION_DELIVERY_CONTEXT`: `placeSessionOpen.name`, `placeSessionRead.name`.
     - `sendHuman`: 새 session은 `placeSessionOpen`에 `{ id, agent: LOPHN_AGENT_ID, place: placeOfAgentRef(agent) ?? null }`로 연다. 받는 쪽 PM·AE ref는 그 place의 lophn이다(README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다", "뼈대 검토" › "annotation 받는 쪽").
     - `checkOpenSession`: `placeSessionRead`로 읽은 session의 agent가 lophn이고 place가 `placeOfAgentRef(agent)`와 같고 open인지 본다.
     - `lastArtifactWriter` 호출에서 `roles`를 뺀다(8번).
   - `runs.ts`(`runs-core`가 새 주소로 다시 쓴다):
     - `RUNS_CONTEXT`: `placeSessionOpen.name`, `placeSessionRead.name`.
     - `agents.agentOf(session)`: `placeSessionRead`로 읽고 open이 아니면 지금처럼 `conflict`. 돌려주는 agent는 `agentRefOfId(s.agent)`(runs의 port가 아직 `AgentRef`다).
     - `agents.open(agent: AgentRef, session)`: `placeSessionOpen`에 `{ id: session, agent: agentIdOfRef(agent), place: placeOfAgentRef(agent) ?? null }`. id가 null이면 `not_found`.
   - `workflows.ts`: 자격의 `agentSessionRead.name`과 `workflowList`의 읽기를 `placeSessionRead`로(place만 쓴다).
   - `approvals.ts`: `APPROVALS_CONTEXT`의 이름과 `sessionOf`의 읽기를 `placeSessionRead`로. 돌려주는 agent는 `agentRefOfId(session.agent)`(`toolGateHandler`의 꼴이 아직 `AgentRef`다. `place-tools`가 바꾼다). 남은 `coding_agent` 갈래는 새 session에 없으니 지운다.
   - `jobs.ts`, `lophn-agent-session.ts`: session route를 부르지 않으면 고치지 않는다.
   - `agent-domains.ts`: `sessionDomains`의 role은 `agentRefOf(row).role`, domain은 `ports.agentDomains(agentRefOf(row))`. 나머지는 `place-scope`가 다시 쓴다.
   - `place-folders-glue.ts`: `select place_kind, place_id from sessions where id = ?`. `placeScope`가 아직 role을 받으므로 place 종류에서 옛 role을 꾸민다: home → `lophn`, project → `project_manager`, app → `app_engineer`(main file이라 role 이름 글을 쓸 수 있다). 근거: README "file 범위는 place 종류로 정한다"의 출발점(home은 lophn, project는 PM, app은 AE 범위)이고, rewind 쓰기 폴더는 그릇의 domain 폴더 전부다. `place-scope`가 role을 지운다. `ROLES` import를 지운다.
7. **test**(write-test skill. 주제가 남는 test는 꼴만 고친다).
   - `places/places_test.ts`(위험 test). session은 `commandsOf().open.handle(tx, user, { id, agent, place }, {})`로 연다. 대역 `deps`에 `agents`(정의 하나 `agt_…`, skip 기본값을 줄 수 있게)를 더하고 `rolePlaceFits` import를 지운다.
     - 셋째 test를 "열린 session의 agent와 place는 바뀌지 않고, 정의가 없는 agent나 없거나 보관한 place에는 열리지 않는다"로 고친다. 준비를 한 번 하고 표로 본다:
       - 없는 `agt_…`로 열기 → `not_found`. 없는 앱 → `conflict`. 보관한 project → `conflict`. 어느 경우에도 `sessions` 행이 생기지 않는다.
       - lophn @ project, `agt_…` @ app은 열린다.
       - 같은 id로 다른 place나 다른 agent를 열면 `conflict`이고 행은 그대로다.
       - 열린 행에 `update sessions set agent = ?`, `update sessions set place_kind = ?, place_id = ?`는 던진다(trigger).
     - 첫 test(보관)는 앱 place의 `agt_…` session을 위처럼 열고 `directory.find(session).accepting` 판정은 그대로 둔다. `directory.openOf`를 보던 줄은 지운다(Router가 쓰지 않는다. `router-core`가 정리한다).
     - 둘째 test(fork)는 `forkedRow`의 `agent`와 `place_kind`·`place_id`가 원본과 같은지 본다(`operator` 칸 대신).
   - `session/rewind/rewind_test.ts`: 넣는 session 행을 새 열로(`agent`, place).
   - `session/rewind/artifact-writer_test.ts`: `role` 입력과 `PROJECT_ROLES`·`APP_ROLES`를 지운다. session 행은 `agent`와 place로 넣는다. 판정은 "마지막으로 쓴, 그 owner place의 열린 session"이다: 같은 그릇의 다른 agent session이 더 나중에 쓰면 그 session이 받고(지금 Operator 줄), 다른 place의 session·닫힌 session·되돌려진 쓰기는 건너뛴다. test 이름은 그대로다.
   - `place-folders-glue_test.ts`(rewind 쓰기 폴더. `place-scope`가 위험 test로 다시 쓴다): `sessions` 표를 `(id text, agent text, place_kind text, place_id text)`로 만들고 줄을 `('ses_pm', 'lophn', 'project', 'prj_a')`, `('ses_ae', 'agt_…', 'app', 'app_a')`로 넣는다. 결과는 지금과 같다. test 이름의 "PM과 App Engineer"를 "project place와 app place session"으로 바꾼다.
8. **소유 줄에 없는데 이 task의 바꿈으로 깨지는 file**(뼈대 검토 보고 대상). 띄우기 전에 lead가 소유에 넣는다. 넣지 않았으면 고치지 말고 보고의 "계약 바꾸기 요청"에 적는다(이 다섯은 고치지 않으면 type check나 test가 깨진다).
   - `packages/core/lophn-agent/instructions/files.ts`의 `loadInstructionSession`: `found.role`·`found.operator`가 없어진다. `const ref = agentRefOf(found)`로 `{ role: ref.role, operator: "agent" in ref ? ref.agent : null, place: placeOf(found) }`를 만든다(`place-scope`가 `{ agent, place }`로 다시 쓴다).
   - `packages/core/lophn-agent/instructions/read_test.ts`: 넣는 session 행을 새 열로. home은 `'lophn'`과 place null, project A·C와 app session은 `agt_…`(다리로 operator가 되어 자기 project만 읽는다. 지금 PM 줄과 결과가 같다). 표의 결과는 그대로다.
   - `packages/core/lophn-agent/commands/reads.ts`: `role: row.role` → `role: agentRefOf(row).role`.
   - `packages/core/lophn-agent/session/message-commands_test.ts`: 넣는 session 행의 `role`을 `agent`(`'lophn'`)로.
   - `packages/core/lophn-agent/session/rewind/artifact-writer.ts`: `roles` 입력과 `s.role in (...)` 거르기를 지운다. 받는 쪽은 그 owner place의 열린 session이면 agent를 가리지 않는다(`router-core` "정한 것"과 같다). 머리 주석을 고친다.
9. 지우거나 바꾼 이름(`agentClause`, `agentSessionOf`, `placeOfAgent`, `operator` 열, 옛 route 상수)을 `grep -rn`으로 찾아 주석과 오류 글에 남은 것을 고친다. route는 이름 글(`"OpenSession"`, `"ReadSession"`, `"ListSessions"`, `"ListSessionCompactRequests"`)이 같으니 상수 import로 찾는다.
10. 보고의 "등록할 것"에 적는다(계약 "등록할 것(lead)"의 자리): `packages/protocol/lophn-agent/registry.ts`에서 `...AGENT_SESSION_ROUTES`를 `...PLACE_SESSION_ROUTES`로 바꾸고, `SESSION_COMMANDS.filter(...)`가 빼는 목록에 `sessionCompactRequests`를 더한다(`placeSessionCompactRequests`와 resource·method가 같다). core는 handler가 단 route로 등록하므로 이 교체 없이도 worktree의 check와 core 기동이 돈다. 이 file은 고치지 않는다(orchestrate 병렬 규칙 3).

## 정한 것 (brief를 쓴 agent, 2026-10-28)

1. **harness의 옛 꼴 다리는 `session/model.ts`의 `agentRefOfId` 하나이고 operator role 값은 protocol의 `roleSchema.enum.operator`에서 얻는다.** 이유: `SessionStarted`·snapshot·Router·apps가 아직 옛 `AgentRef`를 받아 harness가 그 값을 만들어야 한다(계약). harness-domain 규칙은 role 이름 글을 막아 literal로는 쓸 수 없다. 다리를 한 곳에 두면 지우는 task가 그 import만 따라가면 된다.
2. **옛 `CallAgent`로 열거나 찾는 Router 길(`openOf`, `open`)은 lophn과 `agt_…`를 home으로 옮기고 PM·AE는 없는 agent로 본다.** 이유: 옛 Operator 주소에는 place가 없고 정의에도 place가 없다. `router-core`가 바로 뒤에 `{ agent, place }` 주소로 바꾼다.
3. **annotation 배달의 받는 쪽 PM·AE는 그 place의 lophn session이다.** 이유: README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다", "뼈대 검토"의 "project 파일에 단 annotation은 그 project place의 lophn session이 받는다". 앱 annotation의 고른 agent는 `router-core`가 더한다.
4. **`placeFoldersOf`는 place 종류에서 옛 role을 꾸며 `placeScope`에 넘긴다.** 이유: `placeScope`의 role 칸은 `place-scope`가 지운다. README가 project·app 범위의 출발점을 PM·AE 범위로 정했다.

## 끝남

- `npm run check`가 통과한다.
- 바꾼 곳의 test: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/core/lophn-agent/places/places_test.ts packages/core/lophn-agent/session/history_test.ts packages/core/lophn-agent/session/rewind/rewind_test.ts packages/core/lophn-agent/session/rewind/artifact-writer_test.ts packages/core/main/daemon/place-folders-glue_test.ts packages/core/lophn-agent/instructions/read_test.ts packages/core/lophn-agent/session/message-commands_test.ts`
- 위험 test: "열린 session의 agent와 place는 바뀌지 않고, 정의가 없는 agent나 없거나 보관한 place에는 열리지 않는다"(`places_test.ts`, 위 7번의 표). README "저장과 test"의 위험 test "session 정체 불변"이다. 지금 `places_test.ts`의 "role과 place가 맞지 않는 session은 열리지 않는다"를 옮겨 고친 것이고 새 test file은 없다.
- 남지 않음(모두 0줄):
  - `grep -rnw "agentClause\|agentSessionOf\|agentIdentityOf\|rolePlaceFits\|placeOfAgent\|openAgentSession\|agentSessionRead\|agentSessionList\|sessionCompactRequests" packages/core/lophn-agent/session/{model,commands,reads,fork,guards,caller-directory,history,history_test,compactor}.ts packages/core/lophn-agent/places packages/core/lophn-agent/message-images.ts packages/core/lophn-agent/run-loop/runtime-access.ts packages/core/main/daemon/wiring/{session-snapshots,lophn-agent-registration,lophn-agent-session,router,runs,workflows,jobs,approvals}.ts`
  - `sed -n '/create table sessions/,/create trigger sessions_archived_terminal/p' packages/core/lophn-agent/session/model.ts | grep -cE "role|operator"`가 0이다.
  - `grep -rnE "\bs\.role\b|select role|role, place_kind" packages/core/lophn-agent packages/core/main`
  - `grep -rnw "operators" packages/core/lophn-agent/places/lifecycle.ts packages/core/agent-places/place/session-directory.ts`
- 합친 뒤 plan branch에서 안 되는 것(보고의 "알려진 미완 동작"에 적는다. 뒤 task가 고친다): turn(`place-tools`를 이어서 합칠 때까지. layers·prepare·credential이 옛 session 꼴을 읽는다), 이름으로 부른 agent의 place와 지정한 session으로 보내는 annotation(`router-core`), 이름으로 연 run의 place(`runs-core`), 옛 꼴의 `SessionStarted`·snapshot(`shell-events`), 화면·e2e·eval·CLI의 옛 session route(wave 3).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
