# shell-events

session event와 snapshot의 agent를 `AgentId`로 제자리에서 바꾼다: `SessionStarted`와 session snapshot을 내는 core 쪽, 받는 renderer의 session·대기 store와 대기 카드, shell main 알림. renderer의 session 정보 type이 바뀌어 깨지는 곳을 최소로 맞춘다. 이 뒤로 wave 3의 다른 shell task가 새 type 위에서 일한다.

- 단위: shell (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/events/{agent,snapshot}.ts`
  - `packages/core/lophn-agent/places/lifecycle.ts`
  - `packages/core/main/daemon/wiring/session-snapshots.ts`
  - `packages/shell/renderer/desktop/connection`
  - `packages/shell/main/desktop/wiring/notice.ts`
  - `packages/shell/main/notice`
  - `tools/wireframes/pages/screens/waiting`
  - `packages/shell/renderer/conversation/{agent-tab-core-source-env,agent-tab-core-source-sessions,agent-tab-data,agent-tab-fake-source,agent-tab-source}.ts` (넘길 줄: session 정보 type)
  - `packages/shell/renderer/conversation/agent-view.tsx`, `packages/shell/renderer/conversation/header/{agent-header,session-popover}.tsx` (넘길 줄)
  - `packages/shell/renderer/workspace/{source.ts,sidebar/panel-sessions.ts,sidebar/run-list.tsx,reactions/project-manager.ts,agents/agent-key.ts}` (넘길 줄)
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/shell/renderer/desktop/launcher/launcher.tsx`
  - `packages/shell/renderer/app-frame/app-space.tsx`
  - `tools/wireframes/pages/screens/app-space/space.tsx`
- 읽을 것:
  - 제품 결정: `project-docs/plan/remove-role/README.md`
    - "session과 place 종류": session의 정체는 (agent id, place)이고 열 때 정해 바꾸지 않는다.
    - "뼈대 검토": event·snapshot 꼴은 `contract-session`이 모양만 적고 실제 변경은 이 task가 제자리에서 한다. `coding_agent` actor 종류는 wave 4 `cleanup-protocol`이 지운다.
    - "화면"의 "문구": role label은 지운다.
  - 계약 모양:
    - `project-docs/plan/remove-role/tasks/contract-session.md`의 "제자리에서 바꿀 꼴의 목표"의 event·snapshot 줄과 할 일 1의 `placeSessionRead`(`sessions/read`, output `{ session: PlaceSession }`, `title` 칸)
    - `project-docs/plan/remove-role/tasks/contract-agent.md`의 할 일 2(`agentIdSchema`, `LOPHN_AGENT_ID`. `AgentId`는 `string`으로 infer된다)와 5(`agentRead`: input `{ agent, place? }`, output `effective`의 `name`·`profile`은 `{ value, source }`)
  - 앞 task가 남긴 것:
    - `project-docs/plan/remove-role/tasks/sessions-core.md` "내놓는 것": `SessionStarted`와 snapshot을 옛 꼴(`{ role: "lophn" }`, `{ role: "operator", agent }`)로 바꿔 낸다. 이 task가 그 줄을 지운다.
    - `project-docs/plan/remove-role/tasks/wireframe-sidebar.md` 할 일 2: `panel-sessions.ts`의 `sessionAgentKey(entry)`가 store의 `agent`를 읽는 한 곳이다. 이 task는 그 함수만 고친다.
    - `project-docs/plan/remove-role/tasks/wireframe-agents.md` 할 일 10: `waiting.label.agent-unnamed`("Agent")를 더했다. 이 task는 catalog를 고치지 않는다.
    - `project-docs/plan/remove-role/tasks/jobs-core.md`: 멈춘 job의 `creator`는 `AgentAtPlace`이고, 저장 action `agent_run`은 `{ agent: AgentId, agent_place, … }`다. 대기 목록이 넘길 줄로 맞춰 두었다.
  - architecture:
    - `project-docs/architecture/event.md` "흐름"과 "지키는 것"(화면은 조건을 걸고 ready 뒤 snapshot을 읽는다. session snapshot이 싣는 것). 이 문서의 snapshot 줄("coding session은 harness도 싣는다")은 lead가 합칠 때 고친다.
    - `project-docs/architecture/place-session.md` "지키는 것"의 첫 줄
    - `project-docs/architecture/agent-definition.md` "Profile"(main 알림에서 올린 이미지 주소를 풀 수 없으면 이름 첫 글자)
  - skill: `.claude/skills/write-test/SKILL.md`, `.claude/skills/ui-design/SKILL.md`(대기 목록 gallery), `.claude/skills/wording/SKILL.md`(key를 쓰기만 한다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `event-stream`, `events`, `agent-sessions`, `core-api`, `shell`. `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/lophn-agent`, `packages/core/main`, `packages/shell/renderer`, `packages/shell/main`, `tools`
  - 본보기(화면)와 renderer 짝:

    | gallery file | 그리는 renderer | page id |
    |---|---|---|
    | `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`(page 목록은 소유 밖 `questions.tsx`) | `desktop/connection/waiting/{waiting-layer,waiting-panel}.tsx`, `cards/*` | `new-waiting-list`, `new-waiting-permission`, `new-waiting-activation`, `new-waiting-finished`, `new-waiting-settled`, `waiting-job-hold-list`, `waiting-job-hold-kinds`, `new-waiting-toasts` |

    가짜 data를 대신하는 것: core 쪽은 `SessionStarted` event와 `snapshots/list` read다. gallery는 `desktop/connection/waiting/fake-source.ts`와 `events/fake-source.ts`다.
  - 코드(지금 모양):
    - `packages/protocol/events/agent.ts`의 `sessionStarted`(`agent: callAgentOutputSchema`, `external_session`)와 머리 주석의 coding agent 줄. `snapshot.ts`의 `sessionSnapshotSchema`(`agent: callAgentOutputSchema`, `harness`, `harnessIdSchema` import)
    - `packages/core/lophn-agent/places/lifecycle.ts`의 `startSession`이 내는 `SessionStarted`. `packages/core/main/daemon/wiring/session-snapshots.ts`의 `snapshotsOf`(`agent: agentRefOf(row)`, `as SessionSnapshot`)
    - `desktop/connection/events/sessions-store.ts`(`SessionEntry.agent: CallAgent | null`, `base`의 `coding_agent` 견줌), `events/waiting-store.ts`(`Common.agent`, `sessions` 표, `jobHold`의 `placeOfAgentRef`), `events/waiting-store_test.ts`(fixture `agent: { role: "lophn" }`)
    - `desktop/connection/waiting/model.ts`(`AGENT_LABELS`, `agentLabel`, `requesterOf`, `metaOf`, `jobActionText`), `waiting/cards/head.tsx`(`FACES`, `faceOf`), `waiting/fake-source.ts`(role 꼴 fixture)
    - `packages/shell/main/desktop/wiring/notice.ts`의 `who()`(`agentDefinitionRead`, `agentSessionRead`, `AGENT_LABELS`, `coding_agent` 건너뛰기)
    - `packages/shell/renderer/conversation/agent-tab-data.ts:614`(`roleOf`가 store의 `agent?.role`을 읽는다)
    - `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`의 `sessionAgentKey`
- 계약:
  - 쓰는 것: `contract-session`이 적은 event·snapshot 목표 꼴. `contract-agent`의 `AgentId`, `agentRead`. `contract-session`의 `placeSessionRead`.
  - 내놓는 것:
    - `SessionStarted.payload` = `{ agent: AgentId, place, revived }`, session snapshot의 `agent: AgentId`(`external_session`·`harness` 없음). core는 옛 꼴로 바꿔 내던 줄이 없다.
    - renderer session store의 한 줄은 `{ agent: AgentId, place }`를 싣는다(`CallAgent` 없음). wave 3의 `shell-conversation`, `shell-workspace`, `shell-desktop`은 이 꼴을 쓴다.
    - shell main 알림은 agent 이름·얼굴을 `agentRead`의 `effective`로, session 이름을 `placeSessionRead`로 읽는다.

## 할 일

wave 2가 모두 합쳐진 뒤라 registry에는 새 route(`agents/*`, `PLACE_SESSION_ROUTES`)가 들어 있다. coding session 층은 wave 1(`coding-core`, `coding-shell`)이 지웠다. 그래도 coding 갈래(`coding_agent`, `harness`, `coding_start`)가 소유 file에 남아 있으면 같이 지운다.

1. **protocol**(`packages/protocol/events/agent.ts`, `snapshot.ts`). 근거: contract-session "제자리에서 바꿀 꼴의 목표".
   - `sessionStarted`: `z.strictObject({ agent: agentIdSchema, place: placeOutputSchema.nullable(), revived: z.boolean() })`. `external_session`을 지운다.
   - `sessionSnapshotSchema`: `agent: agentIdSchema`. `harness` 칸과 `harnessIdSchema` import를 지운다. 쓰지 않게 된 `callAgentOutputSchema` import를 지운다.
   - 바꾼 칸에 붙은 주석("누구의 session인지(coding agent인지)", "coding session만 싣는다", 머리의 "coding agent는 SessionStarted, …를 낸다")을 고친다. `SENDABLE_SESSION_STATES`(`unknown` 포함)는 `calls.ts`라 그대로 둔다.
2. **core가 내는 곳**(`lifecycle.ts`, `session-snapshots.ts`). 근거: 계약 "core는 옛 꼴로 바꿔 내던 줄이 없다".
   - `startSession`의 `SessionStarted.payload`는 `{ agent: <session 줄의 agent id>, place: placeOf(row), revived: false }`다. `sessions-core`가 남긴 옛 꼴 바꾸기를 지운다.
   - `snapshotsOf`는 `agent: <session 줄의 agent id>`를 싣는다. `as SessionSnapshot`을 `satisfies SessionSnapshot`으로 바꿀 수 있으면 바꾼다. coding session 갈래가 남아 있으면 지운다.
   - 옛 꼴 바꾸는 함수(`agentRefOf` 등, `session/model.ts`는 소유 밖)를 더 쓰는 곳이 없게 되면 보고의 "안 쓰게 된 export"에 적는다.
3. **renderer session store**(`desktop/connection/events/sessions-store.ts`). 근거: 계약 "renderer session store의 한 줄은 `{ agent: AgentId, place }`".
   - `SessionEntry.agent`와 `Record_.agent`는 `AgentId | null`이다. null은 `SessionStarted`·snapshot 전에 turn event로 생긴 줄이다(지금과 같다). `CallAgent` import를 지운다.
   - `SessionStarted`를 받을 때 `base`는 `"idle"`이다(`coding_agent` 견줌을 지운다).
4. **대기 store**(`events/waiting-store.ts`, `events/waiting-store_test.ts`).
   - `Common.agent`는 `AgentId | null`, `sessions` 표는 `{ agent: AgentId; place: Place | null }`이다.
   - 멈춘 job 줄(`jobHold`): `agent: hold.job.creator.agent`, `place: hold.job.creator.place`. `placeOfAgentRef` import와 `jobs-core`가 넣은 옛 꼴 바꾸기를 지운다.
   - coding 대기(`coding_start`, `waitStart`, snapshot의 `agent.role !== "coding_agent"`)가 남아 있으면 지운다.
   - `waiting-store_test.ts`의 fixture `agent: { role: "lophn" }`를 `agent: "lophn"`으로 고친다. 판정은 그대로다.
5. **대기 카드**(`waiting/model.ts`, `waiting/cards/head.tsx`, 그 밖 `waiting/*`). 근거: README "role label은 지운다".
   - `agentLabel(agent: AgentId): string`: lophn이면 `t("waiting.label.agent-lophn")`, 아니면 `t("waiting.label.agent-unnamed")`다(정한 것). `AGENT_LABELS`를 지운다. `requesterOf`·`metaOf`는 이 함수를 그대로 쓴다.
   - `jobActionText`의 `agent_run`: 저장 action의 `agent`(`AgentId`)로 `agentLabel`을 부른다.
   - `head.tsx`: 얼굴은 둘이다. lophn이거나 agent가 null이면(activation 카드 포함) lophn 얼굴(`square`·`coral`), 그 밖은 기본 agent 얼굴(`arch`·`sage`, `wireframe-agents`의 기본 profile과 같다)이다. `FACES`의 role 칸과 `CallAgent` import를 지운다.
   - `decide.ts`, `finished.ts`, `settled.ts`, `waiting-panel.tsx`, `cards/*`에 `CallAgent`나 `.role`을 읽는 곳이 남았으면 같은 규칙으로 고친다.
6. **fake와 gallery**(`waiting/fake-source.ts`, `events/fake-source.ts`, `tools/wireframes/pages/screens/waiting/waiting-pages.tsx`).
   - `agent: { role: "operator", agent: id("agt", 1) }` → `agent: id("agt", 1)`, `agent: { role: "lophn" }` → `agent: "lophn"`. coding fixture(`role: "coding_agent"`)는 지운다.
   - 멈춘 job fixture의 `creator`와 `agent_run`은 `jobs-core`가 정한 꼴이다. Project Manager·App Engineer이던 값은 그 project·앱 place의 lophn(`{ agent: "lophn", place: { kind: "project", id: PROJECT } }` 꼴)으로 둔다.
   - `SessionStarted` fixture의 `external_session`을 지운다.
   - `waiting-pages.tsx`는 fixture를 import만 한다. 글에 role 이름이 있으면 고친다.
7. **shell main 알림**(`packages/shell/main/desktop/wiring/notice.ts`, `packages/shell/main/notice`). 근거: 계약 "shell main 알림은 … `agentRead`의 `effective`로, session 이름을 `placeSessionRead`로 읽는다".
   - `who(session)`: snapshot의 `agent`(`AgentId`)로 `read("read", agentRead, { agent })`와 `read("read", placeSessionRead, { session })`을 한꺼번에 부른다.
   - 이름은 `effective.name.value`, 읽지 못하면 lophn이면 `word("waiting.label.agent-lophn")`, 아니면 `word("waiting.label.agent-unnamed")`다. 얼굴은 지금처럼 `effective.profile.value`가 character면 그것, 아니면 이름 첫 글자다. session 이름은 `session.title`이다.
   - `agentDefinitionRead`·`agentSessionRead` import, `AGENT_LABELS`, `coding_agent` 건너뛰기를 지운다.
   - `packages/shell/main/notice/rule.ts`·`excerpt.ts`·`rule_test.ts`에 role이나 옛 꼴이 있으면 고친다. 판정은 바꾸지 않는다.
8. **넘길 줄**(소유의 넘길 줄 file만, type check가 깨지는 곳을 최소로 맞춘다).
   - `workspace/sidebar/panel-sessions.ts`의 `sessionAgentKey(entry)`: `entry.agent`를 그대로 돌려준다(`AgentId | null`). 이 file에서 store 줄을 role로 읽던 곳이 남았으면 이 함수로 바꾼다. run 기록(`RunRecordView.target.agent`)을 잇는 함수는 run 꼴이라 그대로 둔다.
   - `conversation/agent-tab-data.ts:614`의 `roleOf`: store의 `agent`가 null이면 null, lophn이면 `"lophn"`, 아니면 `"operator"`다. `AgentRole` 값으로 맞추기만 한다(sender chip의 role을 지우는 것은 `shell-conversation`이다).
   - 그 밖의 넘길 줄 file(`agent-tab-core-source-*`, `agent-tab-fake-source.ts`, `agent-tab-source.ts`, `agent-view.tsx`, `header/*`, `workspace/source.ts`, `sidebar/run-list.tsx`, `reactions/project-manager.ts`, `agents/agent-key.ts`)은 type check가 깨질 때만 고친다. `RunRecordView`와 `RunFilter`는 바꾸지 않는다(run 꼴은 `shell-workspace`가 옮긴다).
9. **소유 밖에서 깨지는 곳**. 지금 코드로 보면 store와 snapshot의 `agent` 꼴이 바뀌어 소유 밖 두 곳이 type check에서 깨진다.
   - `packages/shell/renderer/desktop/launcher/launcher.tsx:110`: `item.agent?.role === "lophn"`(home의 lophn session을 찾는다). 고치면 `item.agent === LOPHN_AGENT_ID && item.place === null`이다.
   - `tools/wireframes/pages/screens/app-space/space.tsx:136-150`의 `RUN_SNAPSHOTS`: `agent: run.target.agent`(run 기록의 `CallAgent`)로 `SessionSnapshot`을 만든다. 고치면 run 기록의 agent를 id 글로 바꾼 값(`lophn` → `"lophn"`, operator → 그 id)이다.
   - 이 brief의 소유 줄에 이 두 file이 넘길 줄로 있으면 위처럼 고친다. 없으면 1~8을 끝낸 뒤 commit하지 말고 멈춰 보고한다. 보고의 "넘길 줄"에 이 두 줄과 고칠 모양을 적는다(이 두 줄이 type check를 깨서 `check:full`이 통과하지 않는다).
   - `app-frame/app-space.tsx`가 store의 `agent`를 role로 읽어 깨지면(`wireframe-sidebar`가 `sessionAgentKey`로 옮기지 않은 줄), 같은 방법으로 멈춰 보고한다.
10. 지우거나 바꾼 이름(`external_session`, `harness`, `callAgentOutputSchema`, `AGENT_LABELS`, `agentDefinitionRead`, `agentSessionRead`, `placeOfAgentRef`)과 칸 이름(`.agent.role`, `agent?.role`, `role:`)을 소유 file과 넘길 줄 file에서 `grep -rn`해 주석과 글에 남은 것을 고친다.

## 정한 것

- 대기 카드는 agent 이름을 읽지 않는다. lophn이면 "lophn", 아니면 "Agent"(`waiting.label.agent-unnamed`)다. 얼굴도 둘이다. 이유: 지금도 카드는 이름 대신 role 이름을 보였고 정의를 읽지 않는다. 이름을 보이려면 대기 층에 agent 읽기 통로가 새로 든다(AGENTS.md "속도"). 알림(main)은 지금처럼 정의를 읽어 이름을 보인다.
- `SessionEntry.agent`는 `AgentId | null`로 둔다. 이유: `SessionStarted`나 snapshot보다 turn event가 먼저 오면 agent를 모르는 줄이 생긴다(지금과 같다).
- run 기록 꼴(`RunRecordView`)과 `RunFilter`는 이 task가 바꾸지 않는다. 이유: session 정보가 아니라 run 꼴이고, 쓰는 `app-frame/app-runs.ts`·`workspace.tsx`가 `shell-workspace` 소유다.
- 위험 test를 더하지 않는다. 이유: event·화면 꼴 바꾸기다(`write-test` "쓰지 않는 test"). 있는 `waiting-store_test.ts`("다시 붙으면 snapshot이 대기 목록을 맞추고 사라진 요청은 남지 않는다")와 `notice/rule_test.ts`가 다시 붙기와 알림 판정을 그대로 본다.

## 끝남

- `npm run check`가 통과한다. 작업 중에는 `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test packages/shell/renderer/desktop/connection/events/waiting-store_test.ts packages/shell/main/notice/rule_test.ts`만 돌린다.
- core를 고쳤으므로 `project-docs/plan/tools/lead/boot.sh`가 `boot N exit 0`을 두 번 찍는다.
- `node packages/shell/renderer/build.ts`로 renderer bundle이 선다.
- `npm run wireframes`가 되고 `new-waiting-list`, `new-waiting-permission`, `new-waiting-finished`, `waiting-job-hold-kinds`가 그려진다. 요청한 쪽이 "lophn" 또는 "Agent"이고 role 이름이 없다.
- 위험 test: 없음. 위 두 test file이 통과한다.
- 남지 않음:
  - `grep -n "external_session\|callAgentOutputSchema\|harnessIdSchema\|harness:" packages/protocol/events/agent.ts packages/protocol/events/snapshot.ts`가 0줄이다.
  - `grep -rn "CallAgent\|AgentRef\|placeOfAgentRef\|coding_agent\|agentDefinitionRead\|agentSessionRead\|agent-project-manager\|agent-app-engineer\|agent-operator" packages/shell/renderer/desktop/connection packages/shell/main/desktop/wiring/notice.ts packages/shell/main/notice tools/wireframes/pages/screens/waiting`가 0줄이다.
  - `grep -rn "agent?\.role\|agent\.role\|role: \"" packages/shell/renderer/desktop/connection packages/shell/main/desktop/wiring/notice.ts`가 0줄이다.
  - `grep -n "agentRefOf\|external_session\|coding_agent" packages/core/lophn-agent/places/lifecycle.ts packages/core/main/daemon/wiring/session-snapshots.ts`가 0줄이다.

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
