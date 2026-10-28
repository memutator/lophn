# router-core

call의 받는 곳을 `{ session }`·`{ agent, place? }`(+ `fallback`)로 바꾸고 Router가 새 꼴(`agentCall*`)로 이름을 풀고 `agent_calls`에 저장하게 한다. `call` tool 설명의 role 이름을 지운다. annotation의 받는 쪽을 바꾼다: 앱 화면은 고른 agent의 그 앱 place session, 주인 없는 artifact는 주인 그릇 place의 lophn session.

- 단위: router (wave 2)
- 선행: sessions-core. session을 (agent id, place)로 찾는다.
- 소유(이 task만 고친다):
  - `packages/core/router`
  - `packages/core/agent-places/place/session-directory.ts` (이름 풀기)
  - `packages/core/lophn-agent/places/{directory,ports,unwired}.ts`
  - `packages/core/lophn-agent/session/message-commands.ts`
  - `packages/core/lophn-agent/ports.ts`
  - `packages/core/lophn-agent/tools/bundles/call.ts`
  - `packages/core/lophn-agent/tools/call`
  - `packages/core/main/daemon/wiring/{router,router-registration}.ts`
  - `packages/core/apps/annotations`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/core/workflows/commands_test.ts`
  - `packages/core/lophn-agent/places/places_test.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "정한 것" › "주소와 넘기기"(call의 `to`, domain 일을 받는 쪽, 앱 화면 annotation), "저장과 test"(schema `agent_calls."to"`, 위험 test 셋), "뼈대 검토"(계약은 일부만 옛 꼴 옆에, annotation 받는 쪽, `coding_agent`·`cac`는 wave 4가 지운다, wave 2와 3을 함께 올린다)
  - roadmap: `project-docs/products/roadmap/remove-role.md`의 "지금 코드" › "role이 정하는 것"의 주소·annotation 줄
  - 계약 brief: `project-docs/plan/remove-role/tasks/contract-session.md`(call·annotation 꼴), `tasks/contract-agent.md`(`AgentId`, `AgentAtPlace`, `AgentAddress`, `placeNameSchema`, `LOPHN_AGENT_ID`, `LOPHN_AGENT_NAME`), `tasks/sessions-core.md`(`sessions` 표의 새 열, 여는 검사, 옛 `AgentRef`로 넘기는 줄)
  - architecture: `project-docs/architecture/agent-call.md`("지키는 것": 받는 곳은 정확히 맞아야 풀리고 아니면 `not_found`, 실패는 한 번만 알린다, `agent_calls` 행은 agent가 보낸 call에만 있고 이름을 못 푼 call은 행이 없다, dedup), `annotation.md`("지키는 것": 받는 session은 사람이 보는 대화, artifact annotation은 마지막으로 쓴 session, `annotations.get`의 범위), `place-session.md`("지키는 것": 보관한 place의 session은 새 입력을 받지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `router`, `apps`, `core-api`, `agent-tool-spi`. `project-docs/module-catalog.yaml`의 `packages/core/router`(feature module을 import하지 않고 port만 안다), `packages/core/apps`, `packages/core/lophn-agent`
  - test 규칙: `.claude/skills/write-test/SKILL.md`
  - 계약 code(wave 1이 더했다):
    - `packages/protocol/lophn-agent/calls.ts`: `callAddressInputSchema`·`CallAddressInput`, `callTargetSchema`·`CallTarget`, `agentCallRowSchema`·`AgentCallRow`, `agentCallSend`, `agentCallSendable`, `agentCallRead`, `AGENT_CALL_ROUTES`. 옛 `CallToInput`, `NamedAgent`, `CallAgent`, `CallTo`, `AgentCallRecord`, `callSend`, `callSendable`, `callRead`, `CALL_ROUTES`는 옆에 남아 있다
    - `packages/protocol/lophn-agent/places.ts`: `AgentId`, `LOPHN_AGENT_ID`, `AgentAtPlace`, `AgentAddress`, `Place`
    - `packages/protocol/lophn-agent/agent-values.ts`: `LOPHN_AGENT_NAME`, `agentNameKey`
    - `packages/protocol/apps/annotation.ts`: `annotationSendInputSchema`의 `agent`
  - 고칠 code:
    - Router: `packages/core/router/model.ts`(`RouteInput`, `addressingOf`, `FAILURE_TEXTS`), `router.ts`(`resolve` 105줄, `notCoding` 82줄, `open`, `newRecord`, `deliveryFailed`, `route`), `ports.ts`(`TargetSession`, `SessionDirectory`, `CallStore`), `commands.ts`(`sendCallCommand`), `reads.ts`(`readCallRead`, `sendableRead`, `placeOf`), `store.ts`(`recordOf`), `schema.ts`, `environment.ts`(`RouterDescribe`), `router_test.ts`
    - 이름 풀기: `packages/core/agent-places/place/session-directory.ts`(`createPlaceRoleRules`), `packages/core/lophn-agent/places/ports.ts`(`PlaceRoleRules`), `places/directory.ts`(`createSessionDirectory`, `targetOf`), `places/unwired.ts`
    - 사람 메시지 입구: `packages/core/lophn-agent/session/message-commands.ts`(`MessageRouter` 44줄, `sendWith`의 route 281줄)
    - call tool: `packages/core/lophn-agent/tools/bundles/call.ts`(`CALL_TOOLS`), `tools/call/routing.ts`(`routerOverCore`), `tools/call/sessions.ts`(`listSendable`), `packages/core/lophn-agent/ports.ts`(`CallRouting`)
    - 배선: `packages/core/main/daemon/wiring/router.ts`(`createCallBodyPreparer`, annotation `delivery`: `agentOfApp`, `agentOfOwner`, `refKey`, `checkOpenSession`, `sendHuman`, `deliverTo`), `router-registration.ts`(`environment`)
    - annotation: `packages/core/apps/annotations/{ports,send,reads,blobs}.ts`, `annotations_test.ts`
  - 부르는 곳(이 task 소유가 아니다. 읽기만 한다): `packages/core/lophn-agent/session/rewind/artifact-writer.ts`(`lastArtifactWriter`), `packages/core/workflows/commands.ts`(`handOff`가 옛 `CallToInput`과 `options: null`을 싣는다), `packages/core/main/daemon/wiring/{runs,jobs-registration}.ts`(`createSessionDirectory(...).resolveAgent`), `packages/core/lophn-agent/run-loop/work.ts`(`createLophnInputTransport`), `packages/core/lophn-agent/places/places_test.ts`, `packages/core/workflows/commands_test.ts`(둘 다 `SessionDirectory`를 직접 쓴다)
- 계약:
  - 쓰는 것: `contract-session`의 `AGENT_CALL_ROUTES`(`agentCallSend`, `agentCallSendable`, `agentCallRead`), `CallAddressInput`, `CallTarget`, `AgentCallEnvelope`, `AgentCallRow`, annotation 보내기의 `agent`. `contract-agent`의 `AgentAddress`, `AgentAtPlace`.
  - 내놓는 것:
    - 표 `agent_calls."to"`는 `CallTarget` JSON이다. schema step을 고치고 개발 data는 지운다. 주소용 `coding_agent`는 새 꼴에 없다.
    - session 찾기 port: `resolveAddress(address: AgentAddress): Result<AgentAtPlace>`. agent 이름은 전역에 하나이고 place가 없으면 home이다. 옛 `resolveNamed`는 `runs-core`·`jobs-core`가 옮길 때까지 옆에 두고 wave 4 `cleanup-core`가 지운다.
    - Router 입력의 `to`는 `CallAddressInput`이다. workflow handoff가 넣는 옛 `CallToInput`은 `workflows-core`가 옮길 때까지 같이 받는다.
    - 등록할 것(lead): registry에서 `CALL_ROUTES`를 `AGENT_CALL_ROUTES`로 바꾼다.

## 할 일

wave 1 `coding-core`가 Router의 coding transport와 coding 맡기기 줄을 지웠고, `sessions-core`가 `sessions` 표를 `agent` 열로 바꿨다. 아래에서 "남아 있으면 지운다"고 한 것은 그 두 task가 이미 지웠으면 건너뛴다.

1. Router 입력과 주소 풀기(README "call의 `to`는 `{session}`이나 `{agent, place?}`(+ `fallback`)다", `agent-call.md` 받는 곳 풀기).
   - `router/model.ts`의 `RouteInput`:
     - `to: CallAddressInput | CallToInput`. 옛 `CallToInput`은 workflow handoff(`packages/core/workflows/commands.ts`의 `handOff`)만 넣는다. `workflows-core`가 그 갈래를 지운다. 이미 풀린 `CallTo`(`kind` 칸이 있는 꼴)를 받던 갈래는 지운다. 넣던 쪽(coding의 `message.ts`, `close-call.ts`)은 wave 1이 지웠다.
     - `options`는 `options?: null`로 두고 읽지 않는다. `workflows/commands.ts`가 아직 `options: null`을 싣는다. `workflows-core`가 칸째 지운다.
   - `addressingOf`는 넷으로 가른다: `{ session }`(open_session), `AgentAddress`(`agent` 칸이 있다. new_session), `AgentAddress & { session, fallback: "new" }`(open_session_or_new), 옛 `NamedAgent`(`role` 칸이 있다). 옛 꼴은 같은 파일에 새로 둔 순수 함수 `export function addressOfNamed(named: NamedAgent): Result<AgentAddress>`로 옮겨 새 꼴과 같은 길을 탄다. 옮김은 이렇다(아래 "정한 것"):
     - `lophn` → `{ agent: "lophn", place? }`(place는 있으면 그대로)
     - `project_manager` → `{ agent: "lophn", place: { project } }`, `app_engineer` → `{ agent: "lophn", place: { app } }`(그 place의 lophn). place가 없거나 종류가 틀리면 `invalid_input`(지금 `resolveNamed`와 같다)
     - `operator` → `{ agent: name, place? }`(name이 없으면 `invalid_input`)
     - `coding_agent` → `invalid_input` "a coding agent does not take calls"
     - `router/mod.ts`에는 더하지 않는다. `runs-core`가 flow host에서 `packages/core/router/model.ts`를 바로 import해 쓰고 `workflows-core`가 이 함수와 함께 지운다.
   - `router/router.ts`의 `resolve`: 이름 꼴은 `directory.resolveAddress(address)`로 `AgentAtPlace`를 얻어 `CallTarget`(`{ kind: "new_session", agent }` 또는 `{ kind: "open_session_or_new", session, agent }`)을 만든다. `not_found`면 지금처럼 `failed("not_found", null)`(행 없음), 다른 오류는 그대로 올린다. `notCoding`과 `coding_agent` 검사 세 곳(116, 126, 147줄)을 지운다. 새 주소에는 coding agent가 없다.
   - `open(tx, from, agent: AgentAtPlace, to: CallTarget)`. `Resolved`, `newRecord`, `deliveryFailed`, `route`는 `CallTarget`과 `AgentCallRow`를 쓴다. dedup, 배달 실패, 늦은 실패 알림, `reply`, `cancel`, `close`, `failReceivedBy`, `failLostOnStart`, `markConsumed`의 동작은 바꾸지 않는다.
   - `FAILURE_TEXTS.closed`: "The call was not delivered: that session is closed. Call its agent and place to open a new session."
2. Router의 port(README "session의 정체는 (agent id, place)다").
   - `router/ports.ts`:
     - `TargetSession.agent: AgentAtPlace`. `transport` 칸은 `run-loop/work.ts`가 읽으니 둔다.
     - `SessionDirectory`에 `resolveAddress(address: AgentAddress): Result<AgentAtPlace>`를 더한다. `open(tx, agent: AgentAtPlace, opener: CallFrom)`.
     - 옛 `resolveAgent(named)`는 둔다. `wiring/runs.ts`와 `wiring/jobs-registration.ts`가 `runs-core`·`jobs-core`까지 부르고 `cleanup-core`가 지운다. 주석에 그렇게 적는다.
     - `openOf`는 Router가 부르지 않는다(`places_test.ts`만 부른다). 손대지 않고 보고의 "안 쓰게 된 export"에 적는다.
     - `CallStore`는 `AgentCallRow`를 받고 낸다. coding 맡기기용 `CallStore.setReceiver`와 `InputTransport.deliver`의 `options` 인자가 남아 있으면 지운다. `InputTransport.queued`는 두고 부르지 않는다. 구현인 `packages/core/lophn-agent/run-loop/work.ts`(이 task 소유가 아니다)가 그 칸을 object literal로 내서, 지우면 그 file이 깨진다. 보고의 "안 쓰게 된 export"에 적는다.
   - `router/environment.ts`의 `RouterDescribe`는 `{ state: string }`만 돌려준다. place는 `TargetSession.agent.place`가 안다.
3. 이름 풀기(README "agent 이름은 전역에 하나이고 `lophn`은 예약이다", "`agent`는 이름이고, place가 없으면 home이다").
   - `packages/core/lophn-agent/places/ports.ts`의 `PlaceRoleRules`에 `resolveAddress(address: AgentAddress): Result<AgentAtPlace>`를 더하고, `nameOf`는 `AgentId`를 받는다. `resolveNamed`는 위와 같은 까닭으로 둔다.
   - `packages/core/agent-places/place/session-directory.ts`의 `createPlaceRoleRules`에 구현한다.
     - agent: `agentNameKey(address.agent) === agentNameKey(LOPHN_AGENT_NAME)`이면 `LOPHN_AGENT_ID`. 아니면 `PlaceDeps`의 정의 목록(지금 `operators.operators()`. `sessions-core`가 이름이나 꼴을 바꿨으면 그 port를 쓰고 사본을 만들지 않는다)에서 `agentNameKey`가 같은 정의 하나의 id. 없으면 `not_found` "agent not found".
     - place: 없으면 `null`(home). `{ project }`는 `deps.projects.projectByName`, `{ app }`는 `deps.apps.appByName`으로 푼다(둘 다 id와 이름을 받는다). 없으면 `not_found` "project not found" / "app not found". 보관 여부는 여는 검사(`sessions-core`)가 본다.
     - `nameOf(agent)`: `LOPHN_AGENT_ID`면 `"lophn"`, 아니면 그 정의 이름, 없으면 `""`.
   - `places/unwired.ts`의 `roles`에 `resolveAddress: () => err({ code: "not_found", message: "agent not found" })`.
   - `places/directory.ts`:
     - `resolveAddress: deps.roles.resolveAddress`.
     - `targetOf(row)`의 agent는 `{ agent: <sessions-core 뒤 session 행의 agent 칸>, place: placeOf(row) }`.
     - `open(tx, agent, _opener)`는 그 agent와 place로 `startSession`을 부른다(`sessions-core`가 바꾼 입력 꼴). `coding_agent` 거절 갈래가 남아 있으면 지운다.
     - `listOpen`의 `name`은 `deps.roles.nameOf(<행의 agent>)`.
4. route와 read를 새 상수로(contract-session `AGENT_CALL_ROUTES`).
   - `router/commands.ts`: `sendCallCommand: CommandDefinition<typeof agentCallSend>`. `options`를 넘기지 않는다. `callReply`, `callCancel`, `callsRecover`는 그대로다.
   - `router/reads.ts`: `agentCallRead`, `agentCallSendable`. 목록 한 줄은 `{ session: target.session, agent: target.agent.agent, name: target.name, place: target.agent.place, state }`이고 `queued_coding`이 없다. `placeOf(agent: CallAgent)`와 그 주석을 지운다. `STATES`의 주석에서 coding session 말을 지운다.
   - `router/store.ts`: `"to"`를 `callTargetSchema`로 읽고 `AgentCallRow`를 낸다.
   - `router/schema.ts`: SQL은 그대로다(열은 JSON 글이다). 머리 주석의 `"to"`를 "풀린 받는 곳(`CallTarget` JSON)"으로 고친다. 개발 data는 지운다(README "schema", AGENTS.md "호환성").
5. 사람 메시지 입구: `message-commands.ts`의 `MessageRouter.route` 입력은 `to: { session: Id<"ses"> }`이고 `options`가 없다. `sendWith`도 `options`를 싣지 않는다. import에서 `CallTo`, `CallToInput`을 뺀다.
6. `call` tool(README "call의 `to`"; 계획 첫 줄 "`call` tool 설명의 role 이름을 지운다").
   - `packages/core/lophn-agent/ports.ts`의 `CallRouting`: `send`·`sendable`은 `agentCallSend`·`agentCallSendable`의 `Input`·`Output`이다.
   - `tools/call/routing.ts`: `agentCallSend`, `agentCallSendable`을 부른다.
   - `tools/call/sessions.ts`: 결과는 `{ sessions }`뿐이다(`queued_coding`, 그 주석을 뺀다).
   - `tools/bundles/call.ts`:
     - 입력은 `agentCallSend.input.omit({ dedup: true, unattended: true })`(`options`가 없다).
     - `call` 설명: "to: {session} an open session (see session.list), or {agent, place?} a new session of that agent (agent is the agent's name; place is {project: name} or {app: name}; no place means home), or both with fallback: \"new\" to use the open session and open a new one if it is closed. Names must match exactly. reply: none (no answer), result (the receiver answers with reply) or conversation (both sides keep talking with reply). body: what you hand over. refs: links {kind: file|session|annotation, ...}. If it fails, the result says why (not_found, closed). A closed session is not reopened; call its agent and place to open a new one."
     - closed hint: "that session is closed; call its agent and place to open a new session".
     - `session.list` 설명: "List the open sessions you can send a call to (ID, agent, name, place, state)."
7. 배선.
   - `wiring/router-registration.ts`: `environment.describe`는 `{ state }`만 돌려준다(`loadSession`·`placeOf` import가 남지 않으면 뺀다). `withCodingSessions`와 coding import가 남아 있으면 지운다.
   - `wiring/router.ts`의 `createCallBodyPreparer`: `agentCallSend.name`, `callReply.name`(이름 글은 같다).
8. annotation 배달(README "앱 화면 annotation은 앱 title bar agent select가 고른 agent의, 그 앱 place session으로 간다", "domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다", "뼈대 검토" › "annotation 받는 쪽").
   - `apps/annotations/ports.ts`의 `AnnotationDelivery.deliver` 입력에 `agent: AgentId`를 더한다. 세 함수의 주석을 새 받는 쪽으로 고친다: 앱은 "고른 agent의 그 앱 place session", artifact는 "(a) 그 domain의 artifacts 폴더에 마지막으로 쓴 주인 그릇 place의 열린 session, (b) 입력 session(주인 그릇 place의 lophn 열린 session이어야 한다), (c) 주인 그릇 place의 lophn 새 session", file은 "그 project place의 lophn session".
   - `send.ts`: app target이면 `delivery.deliver({ app, agent: input.agent ?? LOPHN_AGENT_ID, session, text, annotations })`. 머리 주석의 받는 쪽도 고친다.
   - `wiring/router.ts`의 `delivery`. 받는 쪽은 모두 `AgentAtPlace`다.
     - `deliver`: 앱이 있는지 지금처럼 보고(`appExists`, 없으면 `not_found`) 받는 쪽은 `{ agent: input.agent, place: { kind: "app", id: input.app } }`.
     - `deliverArtifact`: `ownerOfDomain`(그대로) → 받는 쪽 `{ agent: LOPHN_AGENT_ID, place: { kind: owner.kind, id: owner.id } }`. (a) `lastArtifactWriter`가 찾은 session(주인 그릇 place의 열린 session이면 agent는 누구든 된다)이 있으면 거기, (b) 없으면 입력 session(받는 쪽의 열린 session인지 본다), (c) 그것도 없으면 받는 쪽의 새 session.
     - `deliverFile`: `{ agent: LOPHN_AGENT_ID, place: { kind: "project", id: input.project } }`.
     - `checkOpenSession(session, target)`: `refKey` 대신 읽은 session의 `agent`와 `place`(kind와 id)가 target과 같고 `lifecycle`이 `open`인지 본다. 아니면 `conflict`.
     - `sendHuman`: session이 null이면 `placeSessionOpen`에 `{ id, agent: target.agent, place: target.place }`를 넣어 연다(`sessions-core`가 옮긴 상수를 쓴다).
     - conflict 글: "not an open session of this agent in this app", "not an open session of lophn in the domain's owner", "not an open session of lophn in this project".
     - `agentOfApp`, `agentOfOwner`, `refKey`, `AgentRef` import를 지운다.
     - `lastArtifactWriter`의 `roles` 칸: `packages/core/lophn-agent/session/rewind/artifact-writer.ts`는 이 task 소유가 아니다. `sessions-core`가 `sessions.role`을 지우며 `roles` 칸과 `s.role in (...)` 거르기를 없앴으면 호출에서 `roles`를 뺀다. 아직 있으면 그 file을 고치지 말고 보고의 "계약 바꾸기 요청"에 적는다(`sessions.role`이 없는 표에서 그 SQL은 돌 때 깨진다).
   - `reads.ts`: 동작은 그대로다(범위는 자격 조건 `conditions.app`·`conditions.project`에서 나온다). 23-24줄과 62줄 주석의 role 이름을 "앱 place session", "project place session", "home session(lophn 등)"으로 고친다. `blobs.ts` 2줄 주석도 같다.
9. test(`write-test` skill. 주제가 남는 test는 주소만 고친다).
   - `router_test.ts`: 대역 `SessionDirectory`에 `resolveAddress: () => ok({ agent: "lophn", place: null })`를 더하고, `TargetSession.agent`를 `{ agent: "lophn", place: null }`로, 이름으로 보내는 주소를 `{ agent: "lophn" }`로, `base`에서 `options`를 뺀다. 대역 `transport`·`store`의 지운 칸도 뺀다. 다섯 test의 이름과 판정은 그대로다.
   - `annotations_test.ts`: 대역 delivery의 `deliver`가 `agent`를 받는다. 226줄 test 이름을 place 말로 바꾼다: "annotations.get: project place session은 자기 project의 file과 그 project가 주인인 domain의 artifact만, app place session은 자기 앱 것과 그 앱이 주인인 domain의 artifact만 읽는다". 판정은 그대로다.
   - 소유 밖에서 `SessionDirectory`를 직접 쓰는 test 둘이 있다: `packages/core/lophn-agent/places/places_test.ts`(`directory.open`에 옛 `AgentRef`를 넘긴다)와 `packages/core/workflows/commands_test.ts`(대역 directory에 `resolveAddress`가 없다). type check가 깨지면 그 줄만 넘길 줄로 맞추고(`open`에는 `{ agent, place }`, 대역에는 `resolveAddress: () => ok({ agent: "lophn", place: null })`) 보고의 "넘길 줄"에 적는다. 다른 줄은 고치지 않는다.

## 정한 것

- 옛 `NamedAgent`를 새 주소로 옮길 때 `project_manager`·`app_engineer`는 그 place의 lophn이다. 이유: README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다"와 같은 규칙이고, `runs-core`의 CLI 옮김(`pm:<p>` → lophn @ project)과 같다. 이 옮김은 workflow handoff가 새 꼴로 바뀔 때(`workflows-core`)까지만 있다.
- agent 이름은 `agentNameKey`로 견준다. 이유: 이름이 겹치는지 보는 검사(`packages/core/lophn-agent/agents/validate.ts`)가 같은 key를 써서, 이 key로 찾으면 정의가 하나로 정해진다. id로 부르는 꼴은 받지 않는다(contract-agent: `agent`는 agent 이름).
- artifact annotation의 (a) 마지막으로 쓴 session은 주인 그릇 place의 열린 session이면 agent를 가리지 않는다. (b) 사람이 지정한 session은 주인 그릇 place의 lophn session이어야 한다. 이유: `annotation.md` "artifact annotation은 그 artifact 폴더에 마지막으로 쓴 session이 받는다"는 role을 묻지 않고, README는 받는 쪽을 그 place의 lophn으로 정했다.
- `RouterDescribe`는 상태만 돌려준다. 이유: place가 `TargetSession.agent`에 들어 와 두 곳에서 정할 까닭이 없다(AGENTS.md "속도").
- `SessionDirectory.openOf`는 지우지 않는다. 이유: Router는 부르지 않지만 `sessions-core` 소유의 `places_test.ts`가 부른다. `cleanup-core`가 옛 `CallAgent`와 함께 지운다.

## 끝남

- `npm run check`가 통과한다.
- 바꾼 곳의 test: `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/core/router/router_test.ts packages/core/apps/annotations/annotations_test.ts packages/core/lophn-agent/places/places_test.ts packages/core/workflows/commands_test.ts`
- 위험 test: 없음. README "저장과 test"의 위험 test 셋에 들지 않는다. 지금 `router_test.ts` 다섯(닫힌 session, 늦은 답, 같은 dedup, step의 unattended, attended 사슬)과 `annotations_test.ts`의 `annotations.get` 범위 test(권한 경계)를 새 주소로 고쳐 통과시킨다. 새 test는 쓰지 않는다.
- 남지 않음:
  - `grep -rn "project_manager\|app_engineer\|Project Manager\|App Engineer\|Operator\|coding_agent\|queued_coding\|refKey" packages/core/router packages/core/apps/annotations packages/core/lophn-agent/tools/call packages/core/lophn-agent/tools/bundles/call.ts packages/core/main/daemon/wiring/router.ts packages/core/main/daemon/wiring/router-registration.ts`가 `packages/core/router/model.ts`의 `addressOfNamed` 줄만 낸다.
  - `grep -rn "callSend\b\|callSendable\b\|callRead\b\|AgentCallRecord\|callToSchema\|CallToInput\|CallTo\b" packages/core/router packages/core/lophn-agent/tools packages/core/lophn-agent/ports.ts packages/core/lophn-agent/session/message-commands.ts packages/core/main/daemon/wiring/router.ts packages/core/main/daemon/wiring/router-registration.ts`가 `router/model.ts`의 `RouteInput.to`와 `addressOfNamed`, `router/router.ts`의 옛 꼴 갈래만 낸다.
  - `grep -rn "CallAgent" packages/core/router`가 `ports.ts`의 import와 옛 `resolveAgent`·`openOf` 줄만 낸다.
  - `grep -n "role" packages/core/main/daemon/wiring/router.ts packages/core/apps/annotations/{ports,send,reads,blobs}.ts packages/core/lophn-agent/tools/bundles/call.ts`가 0줄이다(`lastArtifactWriter`의 `roles`가 남았으면 그 한 줄과 보고).
- 이 task 뒤 wave 3까지 안 되는 것(보고의 "알려진 미완 동작"에 옮긴다): place 정보의 부를 수 있는 agent 목록(`packages/core/agent-places/place/place-data.ts`, `place-scope`)이 아직 옛 `callSendable` 꼴을 읽는다. shell의 annotation 보내기는 `agent`를 싣지 않아 앱 화면 annotation이 그 앱 place의 lophn에게 간다(`shell-workspace`). e2e `agent-call_test.ts`·`annotation_test.ts`가 옛 주소를 쓴다(`e2e-agents`).

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
