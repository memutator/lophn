# shell-workspace

project 창과 앱 공간의 나머지 화면을 새 계약과 문구로 옮긴다: PM·AE session을 열던 곳은 그 place의 lophn이나 고른 agent의 session을 열고, run 목록·앱 상세·annotation·artifact 탭의 role 말을 지운다. 앱 화면 annotation은 고른 agent를 `agent` 칸에 싣는다.

- 단위: shell (wave 3)
- 선행: shell-events. renderer session store의 새 꼴을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/workspace/{workspace.tsx,workspace.module.css,core-source.ts}`
  - `packages/shell/renderer/workspace/agent`
  - `packages/shell/renderer/workspace/reactions`
  - `packages/shell/renderer/workspace/sidebar/run-list.tsx`
  - `packages/shell/renderer/app-frame/{app-runs.ts,app-space.tsx,toast-handler.ts}`
  - `packages/shell/renderer/app-frame/app-detail`
  - `packages/shell/renderer/app-frame/annotate`
  - `packages/shell/renderer/artifact/artifact-tab.tsx`
  - `packages/shell/ipc/annotation.ts`
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `tools/wireframes/pages/screens/app-space`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/shell/main/app-frame/annotate.ts`
  - `tools/wireframes/mock/app-space/data.ts`
  - `packages/shell/renderer/workspace/sidebar/panel-sessions.ts`
  - `packages/shell/renderer/workspace/source.ts`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "주소와 넘기기"(앱 화면 annotation은 앱 title bar agent select가 고른 agent의 그 앱 place session으로 간다. domain 일을 받는 쪽은 주인 그릇 place의 lophn session이다), "화면"(project 창 sidebar와 앱 agent select는 모든 agent를 보이고 고르면 그 place의 session을 연다), "뼈대 검토"(project 파일 annotation은 그 project place의 lophn session이 받는다. wave 3 화면 task는 wording catalog에 key를 더하기만 한다)
  - 계약 brief의 "내놓는 것": `project-docs/plan/remove-role/tasks/contract-session.md`(annotation 보내기의 `agent`), `contract-agent.md`, `runs-core.md`(run 기록의 `target`), `router-core.md`(annotation 배달), `shell-events.md`, `wireframe-sidebar.md`(앱 공간 agent select와 gallery), `wireframe-agents.md`(wording key)
  - architecture: `project-docs/architecture/annotation.md`(신원은 shell main이 정한다, 받는 session은 사람이 보고 있는 대화다), `project-docs/architecture/run.md`의 "화면"(run이 연 session은 그 run 아래로 묶는다), `project-docs/architecture/activation.md`의 "실패와 복구"(실패를 알리려고 program이 agent를 부르지 않는다), `project-docs/architecture/workspace-layout.md`(agent 탭은 한 곳에만 있다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `core-api`. `project-docs/module-catalog.yaml`의 `packages/shell/renderer`, `packages/shell/ipc`, `packages/shell/main`(모두 boundary `shell`), `tools`(boundary 없음)
  - 계약 코드: `packages/protocol/lophn-agent/places.ts`(`AgentId`, `LOPHN_AGENT_ID`, `Place`), `packages/protocol/lophn-agent/agent-values.ts`(`LOPHN_AGENT_NAME`), `packages/protocol/lophn-agent/agent-definitions.ts`(`agentRead`), `packages/protocol/lophn-agent/agent-sessions.ts`(`placeSessionRead`), `packages/protocol/apps/annotation.ts`(`annotationSendInputSchema.agent`), `packages/protocol/runs/runs.ts`(run 기록 `target`)
  - 선행이 바꾼 것: `packages/shell/renderer/desktop/connection/events/sessions-store.ts`의 `SessionEntry`(`agent: AgentId | null`, `place`)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 화면(gallery는 renderer component를 그대로 그린다. 앱 공간 agent select와 그 gallery는 wave 2 `wireframe-sidebar`가 고쳤다):

    | gallery page id | gallery file | 그리는 renderer | 가짜 data → 실제 source |
    |---|---|---|---|
    | `app-space`, `new-app-space`, `new-app-agent-pane`, `new-app-runs`, `new-app-runs-empty`, `new-app-version-failed`, `new-app-activity`, `new-app-annotate`, `new-app-annotate-list` | `tools/wireframes/pages/screens/app-space.tsx`(목록과 설명), `app-space/pages.tsx`, `app-space/space.tsx` | `app-frame/app-space.tsx`(`AppSpace`), `app-runs.ts`, `annotate/annotation-panel.tsx`, `app-detail/` | `tools/wireframes/mock/app-space/data.ts`(`fixedRuns`), `app-frame/app-detail/testdata/fake-source.ts`, `app-frame/testdata/fake-annotate.ts`, `desktop/dev-mock/agent.ts` → `workspace/core-source.ts`의 `runs`, `app-frame/app-detail/core-source.ts`, shell main을 거친 core `annotations/send` |
    | project 창 sidebar Background(`tools/wireframes/pages/screens/project-window.tsx`, `wireframe-sidebar` 것) | 소유 밖 | `workspace/workspace.tsx`, `workspace/sidebar/run-list.tsx` | `workspace/fake-source.ts` → `workspace/core-source.ts`의 `runs` |
    | `artifact-annotate`(`tools/wireframes/pages/screens/artifact.tsx`) | 소유 밖 | `artifact/artifact-tab.tsx` | – |
  - wording key 영역: `packages/design/wording/catalog/app-space.ts`(`app-space.*`, `app-detail.*`), `packages/design/wording/catalog/artifact.ts`(`artifact.*`). 이 task는 이 두 file에 key를 더하기만 한다.
- 계약:
  - 쓰는 것: `contract-session`의 `placeSessionOpen`·`placeSessionList`, annotation 보내기의 `agent`. `contract-agent`의 `agentRead`. `runs-core`의 run 기록 꼴. `shell-events`의 session store 꼴. `wireframe-agents`가 더한 wording key(catalog는 고치지 않는다).
  - 내놓는 것: 이 화면들은 옛 session·정의 route 상수와 role 값을 쓰지 않는다.

## 할 일

1. 먼저 지금 꼴을 본다. wave 2 `wireframe-sidebar`는 `app-frame/app-space.tsx`, `workspace/reactions/project-manager.ts`, gallery `app-space` page를 고쳤고, 선행 `shell-events`는 `workspace/sidebar/run-list.tsx`와 `workspace/reactions/project-manager.ts`를 session 정보 type에 맞춰 최소로 고쳤다. 그 꼴을 이어 쓰고, 아래 "남지 않음" grep을 먼저 돌려 남은 곳을 찾는다. 이미 새 꼴인 곳은 그대로 둔다.
2. run 기록 꼴(`workspace/sidebar/run-list.tsx`). 근거: `runs-core`의 기록 `target` = `{ agent: AgentAtPlace } | { app, tool }`.
   - `RunRecordView.target`을 `{ agent: { agent: AgentId; place: Place | null } } | { app; tool }`로 바꾸고 `CallAgent` import를 지운다. 주석("`SessionEntry.agent`와 같은 `CallAgent`")을 고친다.
   - 이 type으로 깨지는 남의 file은 넘길 줄로 그 줄만 맞춘다: `tools/wireframes/mock/app-space/data.ts`의 `fixedRuns`(target을 `{ agent: { agent: <id>, place: { kind: "app", id: app } } }`로, lophn run은 다른 place로), `workspace/sidebar/panel-sessions.ts`의 run 줄 풀이. 이 wave에 그 file을 가진 task가 없다.
3. project 창(`workspace/workspace.tsx`, `workspace/reactions`, `workspace/agent`). 근거: README "화면"(고르면 그 place의 session을 연다), "session의 정체는 (agent id, place)다".
   - sidebar session 제목 읽기(`agentViewSource({ assignment: row.assignment, place: … })`, 지금 251~262줄): 모든 줄을 `{ kind: "project", id: projectId }`로 읽는다. `row.role === "lophn"`이면 `global`이던 갈래를 지운다.
   - Background run 읽기(지금 283~306줄): `source.runs({ place: { project: projectId } })` 하나만 읽는다. `source.runs({ agent: { role: "lophn" } })`와 두 결과를 합치는 줄을 지운다(정한 것 2).
   - `openRole(role)`(지금 743줄)을 lophn을 여는 함수로 바꾼다. 줄은 `row.assignment === LOPHN_AGENT_ID`로 찾고 `agentByRole`을 쓰지 않는다. 부르는 곳은 activity bar의 `onRail`(`action === "agent"`)이다.
   - `reactions/project-manager.ts`를 `reactions/project-lophn.ts`로, `openProjectManager`를 `openProjectLophn`으로 이름을 바꾼다. 하는 일은 이 project place의 lophn session을 여는 것이다. 열린 session은 session store에서 `agent === LOPHN_AGENT_ID`, `place`가 이 project, `ended === null`인 것 가운데 마지막이고 없으면 새 session 탭이다. `workspace.tsx`의 import를 고친다.
   - `Workspace`의 `projectManager` prop(지금 180~181줄, 시작 route 806~826줄): `desktop/main.tsx`가 아직 `projectManager={…}`를 넘기면 prop 이름은 두고 주석과 하는 일(`openProjectLophn`)만 고친다. 넘기지 않으면(`shell-desktop`이 먼저 합쳐졌으면) prop과 `started.current.pm`을 지운다(정한 것 1).
   - `workspace/agent/agent-tab.tsx`: factory 호출 꼴은 그대로 두고 주석("Operator는 `agt_…`이고, 나머지는 place가 정체성이다", "lophn은 자리가 없어 null")을 고친다.
   - `workspace/core-source.ts`: `runs(filter)`는 filter를 그대로 넘긴다. 이 task 뒤로 `agent` 거르기를 쓰는 곳이 없다. 바꿀 것이 없으면 그대로 둔다.
   - `workspace.tsx`와 `reactions/toast-handler.ts` 주석의 role 이름을 고친다.
4. 앱 공간(`app-frame/app-space.tsx`, `app-frame/app-runs.ts`, `app-frame/toast-handler.ts`). 근거: README "화면", contract-session의 annotation `agent`.
   - `latestSession(assignment)`: session store에서 `agent === assignment`, `place`가 `{ kind: "app", id: app }`, `ended === null`인 것 가운데 마지막이다. `keyOf`, `.role`, `coding_agent` 비교를 지운다.
   - `openSession(target, forApp)`: target이 null이면 지금처럼 `forApp`이 이 앱일 때만 pane을 lophn의 이 앱 session(`latestSession(LOPHN_AGENT_ID)`)으로 연다. target이 있으면 그 session의 `place`가 이 앱이고 agent가 `useAppAgents`의 줄(`app-space.tsx`의 지역 변수 `agentList.agents`)에 있을 때만 pane에 연다.
   - `appEngineer` prop(지금 84~85줄, 186~193줄): 이름은 두고(`desktop/main.tsx`가 넘긴다, 정한 것 1) true면 pane을 `{ mode: "agent", assignment: LOPHN_AGENT_ID, session: null }`로 연다. 방금 만든 앱은 그 앱 place의 lophn 새 session으로 시작한다(roadmap "새 앱은 home의 lophn이 등록하고 그 앱 place의 lophn session에 맡긴다").
   - `app-runs.ts`: agent run은 `record.target.agent.place`가 이 앱이고 그 agent가 `agents`(`useAppAgents`의 줄)에 있을 때만 줄로 둔다. 이름과 profile은 그 줄에서 온다. `agent.role` 거르기(`!== "lophn"`, `=== "operator"`, `=== "app_engineer"`)를 지우고, session 제목은 lophn을 포함한 모든 줄을 `{ kind: "app", id: app }`로 읽는다. 머리 주석을 고친다.
   - `toast-handler.ts`: 주석의 "App Engineer 새 대화"를 "lophn의 이 앱 session"으로 고친다.
5. 앱 화면 annotation. 근거: README "앱 화면 annotation은 앱 title bar agent select가 고른 agent의, 그 앱 place session으로 간다", contract-session "annotation".
   - `packages/shell/ipc/annotation.ts`: `annotateSendRequestSchema`에 `agent`를 optional로 더한다. main tsc는 protocol을 보지 않으므로 `AgentId` 모양을 옮겨 쓴다(`z.union([z.literal("lophn"), z.string().regex(/^agt_[0-7][0-9a-hjkmnp-tv-z]{25}$/)])`). `session`의 주석("그 앱 App Engineer의 session")을 고친다.
   - 넘길 줄 `packages/shell/main/app-frame/annotate.ts`: core `annotations/send` 본문에 target이 app일 때만 `agent: request.agent`를 싣는다(artifact·file target은 이 칸을 받지 않는다). 이 wave에 이 file을 가진 task가 없다. 이 줄만 고치고 보고의 "넘길 줄"에 적는다.
   - `annotate/use-annotate.ts`: `send(session)`을 `send({ session, agent? })`로 바꾸고 `api.send({ view_session, session, agent })`로 보낸다. 주석을 고친다.
   - `app-space.tsx`의 `sendAnnotations`: pane이 agent를 보이면(`pane?.mode === "agent"`) 그 `pane.assignment`와 `pane.session`, 아니면 `LOPHN_AGENT_ID`와 null이다(정한 것 3). 보내기 단추·안내·보낸 toast는 그 agent의 이름(`useAppAgents` 줄의 `name`)을 넣은 key로 쓴다.
   - `annotate/annotation-panel.tsx`: `sendLabel`·`note`의 App Engineer 기본값을 지우고 필수 prop으로 둔다(부르는 곳은 `app-space.tsx`와 `artifact/artifact-tab.tsx` 둘이다). 보관 오류 글(`app-space.error.annotations-archived`)은 role 이름 없는 key로 바꾼다.
6. artifact 탭(`artifact/artifact-tab.tsx`). 근거: README "뼈대 검토"(project 파일 annotation은 그 project place의 lophn session), "domain 일을 받는 쪽"(주인 없는 artifact는 주인 그릇 place의 lophn session).
   - `projectManagerSession()` prop은 이름을 두고(`workspace/kinds/artifact.tsx`가 넘긴다, 정한 것 1) 주석을 "pane에 열린 이 project place의 lophn session"으로 고친다. 그 값을 만드는 `workspace/use-tab-host-slices.ts`(`openedProjectManagerSession`)가 이 뜻으로 고르는지 본다. 아니면 보고의 "알려진 미완 동작"에 적는다(이 wave에 그 file을 가진 task가 없다).
   - 안내 글 `artifact.text.annotations-note`("…or to the Project Manager…")를 role 이름 없는 key로 바꾼다(lophn에게 간다는 뜻).
7. 앱 상세(`app-frame/app-detail`). 근거: README "화면"의 role label을 지운다.
   - `source.ts`: `AgentRole` type을 지운다. `Caller`의 agent 갈래는 `{ kind: "agent"; agent: AgentId; name: string | null; session; title; turn; toolCall }`이다.
   - `core-source.ts`의 `lookups`: session 읽기는 `placeSessionRead`의 resource·method로 부르고 output의 `session.agent`(`AgentId`)를 쓴다. agent 이름은 `agentRead`(input `{ agent }`)의 `effective` 이름을 agent id마다 한 번 읽어 기억한다(지금 `apps/get`·`sessions/read`를 id마다 한 번 기억하는 것과 같은 모양). lophn은 읽지 않고 `LOPHN_AGENT_NAME`이다. route를 글(`"sessions", "read"`)로 쓰지 않고 protocol 상수의 `resource`·`method`를 쓴다. `callerOf`의 `role: session?.role ?? "operator"`를 지운다.
   - `model.ts`: `ROLE_TEXT`를 지우고 `callerText`의 agent 갈래는 `caller.name`, 없으면 이름 모르는 agent를 말하는 key다.
   - `versions/versions-tab.tsx`: 실패 안내 `app-detail.note.failed-called`·`failed-unchanged`("App Engineer was called…")를 role 이름 없는 key로 바꾼다. 뜻은 release를 올린 agent가 결과를 받았다는 것이다(`activation.md`: `release.activate`가 실패 기록을 돌려주고 program이 agent를 부르지 않는다).
   - `testdata/fake-source.ts`의 `ANALYST`: `role: "operator"`를 `agent`(`agt_` id)와 `name`으로 바꾼다.
8. wording. 근거: README "뼈대 검토"의 wording catalog 줄, `wording` skill.
   - 먼저 `wireframe-agents`가 더한 key를 찾는다: `grep -n "annotation\|caller\|failed" packages/design/wording/catalog/app-space.ts packages/design/wording/catalog/artifact.ts`.
   - 없으면 그 두 file에 key를 더한다. 바꿀 글: `app-space.button.send-annotations`("Send to App Engineer" → `{agent}`), `app-space.text.annotations-note`, `app-space.error.annotations-archived`, `app-space.title.annotations-sent`(`{agent}`를 더한다), `app-detail.label.role-*`(이름 모르는 agent 하나), `app-detail.note.failed-called`, `app-detail.note.failed-unchanged`, `artifact.text.annotations-note`. 있는 key의 값을 고치거나 key를 지우지 않는다(옛 key는 wave 4 `cleanup-shell`이 지운다). key 이름에 role 낱말(`role-`, `project-manager`, `app-engineer`, `operator`)을 넣지 않는다.
   - key를 더했으면 `npm run wording`과 `node tools/check-wording.ts`를 돌린다.
9. gallery. wireframe 코드를 다시 그리지 않는다. page는 renderer component를 그대로 그리고, 이 task는 설명 글과 고정 data만 고친다.
   - `tools/wireframes/pages/screens/app-space.tsx`: 설명에 남은 "App Engineer", "Operator"(`app-space`의 펼친 select, `new-app-runs`, `new-app-version-failed`, `new-app-annotate-list` 등)를 lophn이나 고른 agent로 고친다. `wireframe-sidebar`가 이미 고친 설명은 그대로 둔다.
   - `app-space/pages.tsx`, `app-space/space.tsx`: `pane.agent`의 "App Engineer"와 `AGENT_KEY`가 남았으면 select에 있는 agent(lophn이나 사람이 만든 agent)의 `data-agent` 값으로 바꾼다.
   - 기능이 없어진 page(앞 wave가 지운 coding 터미널 요청 page 등)는 설명의 role 이름만 고친다. page를 빼야 하면 이 area file의 `pages`에서 빼고 보고에 적는다.

## 정한 것

planner가 문서에 답이 없어 정했다.

1. **다른 task가 넘겨 주는 prop 이름은 이 wave에 바꾸지 않는다.** `Workspace.projectManager`와 `AppSpace.appEngineer`는 `desktop/main.tsx`(`shell-desktop`)가, `ArtifactTab.projectManagerSession`은 `workspace/kinds/artifact.tsx`(소유 없음)가 넘긴다. `shell-desktop`과 같은 wave이고 선행이 없어, 한쪽만 이름을 바꾸면 다른 쪽 branch의 type check가 깨진다. 하는 일과 주석만 고치고 이름은 wave 4 `cleanup-shell`이 바꾼다. 다만 `projectManager`는 죽은 값이라(아무도 `true`로 정하지 않는다) `main.tsx`가 더 넘기지 않으면 지운다.
2. **project 창 Background는 `place: { project }` 한 번만 읽는다.** session이 place를 갖게 되어 이 project의 lophn run도 `place`로 걸린다. home(place 없음)의 lophn run은 런처 lophn 패널의 것이다. `run.md` "화면"의 두 번 읽기는 lead가 문서에서 고친다.
3. **annotation을 받는 agent는 pane이 보이는 agent다.** pane이 agent를 보이지 않으면(닫힘, Background, Manage) lophn이고 session은 null이다(contract-session "없으면 lophn"). 사람이 고른 agent와 보내기 단추 글이 늘 같아야 사람이 받는 쪽을 안다.
4. **앱 상세의 부른 쪽은 agent 이름만 보인다.** role label(`app-detail.label.role-*`)을 이름으로 바꾸고, 이름을 못 읽으면 이름 모르는 agent를 말하는 글 하나다. 기록 줄은 많아도 부른 agent는 몇 안 되어 agent id마다 한 번 읽으면 된다.

## 끝남

- `npm run check`가 통과한다.
- `node packages/shell/renderer/build.ts`로 renderer bundle이 선다(`check:full`은 이것을 보지 않는다).
- `npm run wireframes`가 되고, gallery의 `app-space`, `new-app-agent-pane`, `new-app-runs`, `new-app-runs-empty`, `new-app-version-failed`, `new-app-activity`, `new-app-annotate`, `new-app-annotate-list`, `artifact-annotate`가 renderer의 `AppSpace`(`artifact-annotate`는 `ArtifactTab`)로 그려진다. annotation 보내기 단추와 Background 줄에 role 이름이 없다.
- 위험 test: 없음. 화면, 문구, 가짜 data와 IPC 칸 하나만 바꾼다. annotation 신원과 renderer 요청 경계는 지금 `packages/shell/main/app-frame/annotate_test.ts`가 보고 이 task는 그 판정을 바꾸지 않는다(`write-test`). 그 test는 통과만 한다.
- 남지 않음: 아래가 모두 0줄이다. 이 화면들은 core를 resource·method 글로도 부른다(`workspace/core-source.ts`의 `"runs"`, `app-detail/core-source.ts`, shell main의 `"annotations", "send"`). 그래서 칸 이름도 글로 본다.

  ```sh
  P="packages/shell/renderer/workspace/workspace.tsx packages/shell/renderer/workspace/core-source.ts packages/shell/renderer/workspace/agent packages/shell/renderer/workspace/reactions packages/shell/renderer/workspace/sidebar/run-list.tsx packages/shell/renderer/app-frame/app-runs.ts packages/shell/renderer/app-frame/app-space.tsx packages/shell/renderer/app-frame/toast-handler.ts packages/shell/renderer/app-frame/app-detail packages/shell/renderer/app-frame/annotate packages/shell/renderer/artifact/artifact-tab.tsx packages/shell/ipc/annotation.ts tools/wireframes/pages/screens/app-space.tsx tools/wireframes/pages/screens/app-space"
  # role 이름
  grep -rnE "project_manager|app_engineer|coding_agent|\"operator\"|Project Manager|App Engineer|Operator" $P
  # 옛 type·route 상수·role로 찾던 함수
  grep -rnE "\b(AgentRef|CallAgent|NamedAgent|AgentRole|ROLE_TEXT|keyOf|refOf|agentByRole|openRole|openProjectManager|agentDefinitionRead|agentDefinitionList|agentSessionRead|agentSessionList|openAgentSession)\b" $P
  # role 칸(글로 부르는 route의 input·output 포함). 고른 요소의 접근성 role(`ipc/annotation.ts`의 `role: elementText`)은 다른 뜻이라 뺀다
  grep -rnE "\.role([^-a-zA-Z]|$)|\brole\??:|agent: \{ role" $P | grep -v "role: elementText"
  # 글로 부르는 옛 resource
  grep -rnE "\"(agent-definitions|operators|builtin-agents)\"" $P
  # 이름에 role이 든 wording key
  grep -rnoE "\"[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]*(project-manager|app-engineer|operator|role-)[a-z0-9-]*\"" $P
  # 값에 role 이름이 든 wording key
  grep -rhoE '"[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+"' $P | tr -d '"' | sort -u | node --input-type=module -e 'import { en } from "./packages/design/wording/en.ts"; let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { for (const k of s.split("\n").filter(Boolean)) { const v = en[k] ?? ""; if (/Project Manager|App Engineer|Operator/.test(v)) console.log(k, "=", v); } });'
  ```

  camelCase 이름은 정한 것 1의 prop 이름(`appEngineer`, `projectManagerSession`, 남았다면 `projectManager`)과 남의 file에서 import한 이름만 남는다: `grep -rnE "projectManager|appEngineer|ProjectManager|AppEngineer" $P`.

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
