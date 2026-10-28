# shell-conversation

대화(Agent 탭)를 새 계약으로 옮긴다: session 열기·읽기·목록은 `placeSession*`, agent 이름·얼굴·model은 `agentRead`, 할당은 `assignmentGet`, call 읽기는 `agentCallRead`. 보낸 이 chip과 권한 보기에서 role label을 지우고 agent 이름만 보인다.

- 단위: shell (wave 3)
- 선행: shell-events. renderer session store의 새 꼴을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/conversation`
  - `tools/wireframes/pages/screens/{agent,agent-pages,conversation}.tsx`
  - `tools/wireframes/pages/screens/agent-tab`
  - `tools/wireframes/pages/screens/artifact/chat-link.tsx`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/shell/renderer/desktop/dev-mock/agent.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "session과 place 종류"(session의 정체는 (agent id, place)), "주소와 넘기기"(call의 `to`는 `{session}`이나 `{agent, place?}`), "화면"(role label을 지운다. "Operator"는 "Agent"다), "뼈대 검토"(새 값의 type은 `AgentId`. wave 3 화면 task는 wording catalog에 key를 더하기만 한다)
  - 계약 brief의 "내놓는 것": `project-docs/plan/remove-role/tasks/contract-agent.md`, `contract-session.md`, `shell-events.md`, `wireframe-agents.md`(wording key)
  - architecture: `project-docs/architecture/agent-chat.md`(Agent 탭, 앱 공간 agent 칸, 런처 lophn 칸이 같은 `AgentView`를 쓴다), `project-docs/architecture/place-session.md`(session의 agent와 place는 열 때 정하고 바뀌지 않는다), `project-docs/architecture/agent-call.md`(call 하나의 모양과 받는 곳)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `core-api`, `event-stream`. `project-docs/module-catalog.yaml`의 `packages/shell/renderer`(boundary `shell`), `tools`(boundary 없음)
  - 계약 코드(wave 1·2가 더했다): `packages/protocol/lophn-agent/places.ts`(`AgentId`, `LOPHN_AGENT_ID`, `Place`), `packages/protocol/lophn-agent/agent-values.ts`(`LOPHN_AGENT_NAME`), `packages/protocol/lophn-agent/agent-definitions.ts`(`agentRead`), `packages/protocol/lophn-agent/agent-sessions.ts`(`PlaceSession`, `placeSessionOpen`, `placeSessionRead`, `placeSessionList`), `packages/protocol/lophn-agent/calls.ts`(`agentCallRead`, `CallAddressInput`, `callCancel`), `packages/protocol/approvals/assignment.ts`(`assignmentGet`)
  - 선행이 바꾼 것: `packages/shell/renderer/desktop/connection/events/sessions-store.ts`의 `SessionEntry`(`agent: AgentId | null`, `place`)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 화면(gallery는 renderer component를 그대로 그린다. 따로 그리지 않는다):

    | gallery page id | gallery file | 그리는 renderer | 가짜 data → 실제 source |
    |---|---|---|---|
    | `new-agent-conversation`, `new-agent-sender-chips`, `new-agent-call-open`, `new-agent-call-replies`, `new-agent-permissions`, `new-agent-commands`, `new-agent-model-picker` 등 `agent` 영역 | `tools/wireframes/pages/screens/agent.tsx`(목록과 설명), `agent-pages.tsx`, `agent-tab/scenes.tsx`, `conversation.tsx` | `conversation/agent-view.tsx`(`AgentView`), `thread/sender-chip.tsx`, `permissions-view/permissions-view.tsx`, `composer/agent-composer.tsx` | `conversation/agent-tab-fake-source.ts`, `agent-tab-fake-commands.ts`, `tools/wireframes/mock/agents-data.ts`(wave 2 `wireframe-agents` 것, 고치지 않는다) → `conversation/agent-tab-core-source*.ts`가 부르는 core route |
    | `artifact-chat-link` | `tools/wireframes/pages/screens/artifact/chat-link.tsx` | `conversation/message-list/agent-turn.tsx`, `message-list/message-body.tsx` | 같은 file의 `AGENT` |
  - wording key 영역: `packages/design/wording/catalog/conversation.ts`(`conversation.*`). 이 task는 이 file에 key를 더하기만 한다.
- 계약:
  - 쓰는 것: `contract-session`의 `PLACE_SESSION_ROUTES`, `AGENT_CALL_ROUTES`. `contract-agent`의 `agentRead`, `assignmentGet`. `shell-events`의 session store 꼴. `wireframe-agents`가 더한 wording key(catalog는 고치지 않는다).
  - 내놓는 것: 대화 화면은 옛 session·정의·할당·call route 상수를 import하지 않는다.

## 할 일

1. 먼저 지금 꼴을 본다. 선행 `shell-events`는 이 폴더의 몇 file(`agent-tab-core-source-{env,sessions}.ts`, `agent-tab-data.ts`, `agent-tab-fake-source.ts`, `agent-tab-source.ts`, `agent-view.tsx`, `header/{agent-header,session-popover}.tsx`)을 session 정보 type에 맞춰 최소로 고쳤다. 그 꼴을 이어 쓰고, 아래 "남지 않음" grep을 먼저 돌려 남은 곳을 찾는다. 이미 새 꼴인 곳은 그대로 둔다.
2. env(`agent-tab-core-source-env.ts`). 근거: README "session의 정체는 (agent id, place)다", `contract-session`의 `placeSessionOpen` input `{ id, agent, place }`.
   - `AgentTarget`(factory 인자)의 꼴은 그대로 둔다(아래 정한 것 1).
   - `Env.agent`를 `AgentRef`에서 `AgentId`(`target.assignment`)로 바꾸고 `Env.place: Place | null`을 더한다. `target.place.kind`가 `global`이면 null, `project`·`app`이면 `{ kind, id }`다.
   - `agentRefOf`와 `AgentRef` import를 지운다. 주석의 "Operator", "Project Manager", "App Engineer"를 고친다.
3. session route(`agent-tab-core-source-sessions.ts`, `agent-tab-core-source-commands.ts`, `agent-tab-core-source-model.ts`). 근거: `contract-session`의 `PLACE_SESSION_ROUTES`.
   - `openAgentSession` → `placeSessionOpen`, input `{ id, agent: env.agent, place: env.place }`.
   - `agentSessionRead` → `placeSessionRead`. `AgentSession` type → `PlaceSession`.
   - `agentSessionList` → `placeSessionList`, input `{ agent: env.agent, place: env.place, archived: "include" }`. `agent-tab-core-source-commands.ts`의 `registryOf`도 `{ agent: env.agent, place: env.place }`로 읽는다.
4. 얼굴·model·권한. 근거: `contract-agent`의 `agentRead`(input의 `place`는 model 층과 받는 domain을 셀 자리, 없으면 home)와 `assignmentGet`.
   - `readFace`: `agentDefinitionRead` → `agentRead`. input은 `{ agent: env.agent }`에 `env.place`가 있으면 `place`를 더한다. 이름과 profile은 output의 `effective`에서 읽는다(꼴은 `agent-definitions.ts`의 `agentRead` output 그대로). 자리 이름은 정의가 아니라 `env.place`로 `placeNameOf`가 읽는다(정의에는 place가 없다).
   - `agent-tab-core-source-model.ts`의 `defaultFor`: `agentDefinitionRead` → `agentRead`(같은 input). `AgentValueLayer`는 `agentRead` output의 model 층 type을 쓴다.
   - `readApps`: `agentAssignmentGet` → `assignmentGet`, input `{ agent: env.agent }`, output `{ assignment: { agent, entries }, revision }`.
5. agent 이름. 근거: README "화면"의 role label을 지운다.
   - `agent-tab-core-source-sessions.ts`의 `roleLabel`과 그 안의 `waiting.label.agent-*` 사용을 지운다. 대신 `agentNameOf(env, agent: AgentId): Promise<string | null>`를 둔다. `LOPHN_AGENT_ID`면 읽지 않고 `LOPHN_AGENT_NAME`이다(lophn의 이름은 바뀌지 않는다, README "lophn은 고정 id를 가진 내장 정의다"). 나머지는 `agentRead`의 `effective` 이름을 agent id마다 한 번 읽어 기억한다.
   - `agent-tab-core-source-thread.ts`: `roleOf`와 `ThreadMemo.roles`를 session의 agent(`PlaceSession.agent`)를 기억하는 `agentOf`로 바꾼다. `senderOf`의 agent 갈래는 `{ kind: "agent", agent, name }`이고 name은 `agentNameOf`다. `withName`도 `agentNameOf`를 쓴다.
   - `agent-tab-core-source-calls.ts`: `callRead` → `agentCallRead`. 읽는 칸(`state`, `fail_reason`, `receiver_session`)이 `AgentCallRow`에 그대로 있는지 type으로 확인한다. `toLabel`은 `call` tool 입력의 `to`(`CallAddressInput`)로 쓴다. `session`이 있으면 그 session의 agent 이름 · session 제목, 없으면 `agent` · (`place.project` 또는 `place.app`)이다. `to.role`과 `to.name`은 읽지 않는다. 주석 예시 "Operator · Eval analyst"를 고친다.
   - `agent-tab-core-source-rewind.ts`의 `callerName`: agent caller는 그 session의 agent 이름이다(`roleLabel` 대신).
6. 화면 값(`agent-tab-source.ts`, `agent-tab-data.ts`, `agent-view-model.ts`).
   - `AgentRole`과 `Role` import를 지운다.
   - `AgentFace.role` → `agent: AgentId`. `AgentFace.place` → `{ kind: "project" | "app"; name } | null`이고 home은 null이다.
   - `Sender`의 agent 갈래 → `{ kind: "agent"; agent: AgentId | null; name: string | null }`.
   - `agent-tab-data.ts`의 `FoldContext.roleOf` → `agentOf(session): AgentId | null`(session store `SessionEntry.agent`). event를 접어 만든 sender는 agent가 lophn이면 name이 `LOPHN_AGENT_NAME`, 아니면 null이다.
   - `newSessionKey`: role 대신 agent id를 쓰고 place가 null이면 `home`이다.
   - `AgentTabSourceFactory`의 주석만 고친다(`assignment`는 `AgentId`, `global`은 home).
7. 부품.
   - `thread/sender-chip.tsx`: `ROLE_LABEL`을 지운다. `senderLabel`의 agent 갈래는 `name`이고, 없으면 `t("conversation.label.sender-agent-other")`다. `conversation.label.sender-agent-named`(`{role} · {name}`)는 쓰지 않는다.
   - `composer/agent-composer.tsx`: `place` prop을 nullable로 하고 null이면 자리 칸(`data-composer-scope` 안 `styles.place` span)을 그리지 않는다. `agent-view.tsx`는 `agent.place`를 그대로 넘긴다.
   - `permissions-view/permissions-view.tsx`: `conversation.notice.permissions-mcp`("…or on this Operator.")를 role 이름 없는 key로 바꾼다(9).
   - `model-picker/{types.ts,model-picker.tsx}` 주석의 "Operator"를 "agent"로 고친다.
8. 가짜 data.
   - `agent-tab-fake-source.ts`: `LOPHN` 얼굴은 `agent: LOPHN_AGENT_ID`, `APP_ENGINEER` 얼굴은 앱 place에 있는 사람이 만든 agent(이름 예: "Eval analyst", `agt_` id, place `{ kind: "app", name: "Eval board" }`)로 바꾸고 상수 이름에서 role 낱말을 뺀다. call 블록의 `to`("Operator · Eval analyst", "Operator · Experiment planner", "Project Manager · phroner")는 agent 이름(과 자리 이름)으로, sender(`{ kind: "agent", role, name }`)는 `{ kind: "agent", agent, name }`으로, 끝난 call 글("The session of Operator · Experiment planner ended…")도 role 이름 없이 바꾼다.
   - `agent-tab-fake-commands.ts`: `new-app`·`repair-app`의 설명은 core 내장 skill의 지금 설명(`packages/core/agent-places/skills/{new-app,repair-app}/SKILL.md` frontmatter의 `description`, wave 2 `place-prompts`가 고쳤다)을 옮긴다.
9. wording. 근거: README "뼈대 검토"의 wording catalog 줄, `wording` skill.
   - 먼저 `wireframe-agents`가 더한 key를 찾는다: `grep -n "sender\|permissions" packages/design/wording/catalog/conversation.ts`. sender와 MCP 권한 안내에 맞는 key가 있으면 쓴다.
   - 없으면 `packages/design/wording/catalog/conversation.ts`에 key를 더한다(예: MCP 안내 "…in the project, or on this agent."). 있는 key의 값을 고치거나 key를 지우지 않는다. 안 쓰게 된 옛 key(`conversation.label.sender-role-*`, `sender-agent-named`, `conversation.notice.permissions-mcp`)는 wave 4 `cleanup-shell`이 지운다.
   - key를 더했으면 `npm run wording`과 `node tools/check-wording.ts`를 돌린다.
10. gallery. wireframe 코드를 다시 그리지 않는다. page는 renderer component를 그대로 import해 그리고, 이 task는 설명 글과 고정 data만 고친다.
    - `tools/wireframes/pages/screens/agent.tsx`: `new-agent-permissions` 설명의 "이 Operator"를 "이 agent"로, 다른 설명에 남은 role 이름을 고친다.
    - `tools/wireframes/pages/screens/artifact/chat-link.tsx`: `AGENT`의 이름 "Operator"를 사람이 만든 agent 이름(예: "Eval analyst", profile 첫 글자)으로 바꾼다.
    - `agent-pages.tsx`, `agent-tab/scenes.tsx`, `conversation.tsx`는 `tools/wireframes/mock/agents-data.ts`를 그대로 쓴다. 바뀐 `AgentFace`·`Sender` type으로 깨지는 곳만 이 file들에서 맞춘다.
11. 넘길 줄. `packages/shell/renderer/desktop/dev-mock/agent.ts`의 `mockAgentTabSource`가 `AgentFace`(`role`, `place`)를 만든다. gallery의 launcher·app-space page와 `npm run dev:mock`이 쓰고, 이 wave에 이 file을 가진 task가 없다. 바뀐 `AgentFace` 꼴(`agent`, nullable `place`)에 맞추는 줄만 고치고 보고의 "넘길 줄"에 적는다. `agent`는 factory 인자의 `assignment`, `place`는 factory 인자의 place(`global`이면 null)에서 만든다. 가짜라 자리 이름은 고정 글이어도 된다.

## 정한 것

planner가 문서에 답이 없어 정했다.

1. **factory 인자 꼴은 그대로 둔다.** `AgentTabSourceFactory`의 `{ assignment, place: { kind: "global" | "project" | "app", id } }`를 부르는 곳은 `workspace/agent/agent-tab.tsx`·`app-frame/app-runs.ts`·`app-frame/app-space.tsx`(`shell-workspace`), `desktop/launcher/lophn-panel/lophn-panel.tsx`(`shell-desktop`), `app-frame/side-panel.tsx`와 `desktop/dev-mock/agent.ts`(소유 없음)다. `shell-workspace`, `shell-desktop`과 같은 wave이고 선행이 없어 꼴을 바꾸면 서로 type check가 깨진다. 안에서 `assignment`는 `AgentId`, `global`은 home(null)으로 읽는다. 이름 정리(`assignment` → `agent`)는 wave 4 `cleanup-shell`에 넘긴다.
2. **얼굴의 자리는 이 source의 place다.** 정의가 전역이 되어 정의에는 place가 없다(README "agent와 정의"). 그래서 lophn도 project 창에서는 그 project 이름이 보인다. home은 자리 칸을 그리지 않는다. 지금 lophn은 빈 이름의 folder 칸을 그린다.
3. **보낸 이 chip은 이름만 보인다.** lophn은 읽지 않고 `LOPHN_AGENT_NAME`, 다른 agent는 thread를 읽을 때 agent id마다 한 번 `agentRead`로 읽는다. event로 접은 줄은 다음 thread 읽기(turn 끝) 전까지 "Another agent"일 수 있다. event마다 읽으면 core reader의 동시 읽기 상한(`agent-tab-core-source-env.ts`의 `MAX_IN_FLIGHT`)을 쉽게 넘는다.
4. **call 블록의 받는 곳 이름은 `call` tool 입력의 이름 그대로다.** agent가 쓴 이름과 자리 이름이 사람이 읽을 글이다. 이름을 id로 다시 풀면 읽기가 둘 는다.

## 끝남

- `npm run check`가 통과한다.
- `node packages/shell/renderer/build.ts`로 renderer bundle이 선다(`check:full`은 이것을 보지 않는다).
- `npm run wireframes`가 되고, gallery의 `new-agent-conversation`, `new-agent-sender-chips`, `new-agent-call-open`, `new-agent-call-replies`, `new-agent-permissions`, `new-agent-commands`, `new-agent-model-picker`, `artifact-chat-link`가 renderer의 `AgentView`(chat-link는 `AgentTurn`·`MessageBody`)로 그려진다. sender chip, call 블록, 권한 보기에 role 이름이 없다.
- 위험 test: 없음. 화면, 문구, 가짜 data만 바꾸고 사용자 데이터나 권한 경계를 건드리지 않는다(`write-test`). 있는 `delivery-state_test.ts`, `live-text_test.ts`는 통과만 한다.
- 남지 않음: 아래가 모두 0줄이다. 이 화면은 route를 상수(`env.read(route, …)`)로만 부른다. resource 글로 부르는 곳이 생기지 않았는지도 본다.

  ```sh
  P="packages/shell/renderer/conversation tools/wireframes/pages/screens/agent.tsx tools/wireframes/pages/screens/agent-pages.tsx tools/wireframes/pages/screens/conversation.tsx tools/wireframes/pages/screens/agent-tab tools/wireframes/pages/screens/artifact/chat-link.tsx"
  # role 이름
  grep -rnE "project_manager|app_engineer|\"operator\"|Project Manager|App Engineer|Operator" $P
  # 옛 type·route 상수·role 이름 함수
  grep -rnE "\b(AgentRef|CallAgent|NamedAgent|AgentRole|Role|AgentSession|agentSessionList|agentSessionRead|openAgentSession|agentDefinitionRead|agentDefinitionList|agentAssignmentGet|callRead|roleLabel|ROLE_LABEL|roleOf|agentRefOf)\b" $P
  # role 칸
  grep -rnE "\.role([^-a-zA-Z]|$)|\brole\??:" $P
  # 글로 부르는 옛 resource
  grep -rnE "\"(agent-definitions|operators|builtin-agents)\"" $P
  # 이름에 role이 든 wording key
  grep -rnoE "\"[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]*(project-manager|app-engineer|operator|role-)[a-z0-9-]*\"|waiting\.label\.agent-" $P
  # 값에 role 이름이 든 wording key
  grep -rhoE '"[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+"' $P | tr -d '"' | sort -u | node --input-type=module -e 'import { en } from "./packages/design/wording/en.ts"; let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { for (const k of s.split("\n").filter(Boolean)) { const v = en[k] ?? ""; if (/Project Manager|App Engineer|Operator/.test(v)) console.log(k, "=", v); } });'
  ```

  `ReceivedMessage.from.kind`의 `coding_agent` 갈래는 남는다(actor 종류는 wave 4 `cleanup-protocol`이 지운다).

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
