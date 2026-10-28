# shell-desktop

desktop 창의 나머지 화면을 새 계약과 문구로 옮긴다: 새 앱을 만든 뒤 앱 공간이 그 앱 place의 lophn session으로 열리고, Settings › Jobs의 만든 쪽 줄과 Workflows의 참가자 줄이 role 대신 agent 이름과 place를 보인다.

- 단위: shell (wave 3)
- 선행: shell-events, shell-workspace. renderer session store의 새 꼴을 쓴다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/{main.tsx,router.ts}`
  - `packages/shell/renderer/desktop/launcher`
  - `packages/shell/renderer/desktop/settings/jobs`
  - `packages/shell/renderer/workflow`
  - `packages/shell/renderer/icons/workspace.ts`
  - `tools/wireframes/pages/screens/{launcher,workflow}.tsx`
  - `tools/wireframes/pages/screens/launcher`
  - `tools/wireframes/pages/screens/workflow`
  - `tools/wireframes/pages/kit/overlay/page.tsx`
- 추가 소유(뼈대 검토, planner): 살 단계가 "소유 줄 밖"으로 적은 file을 소유로 옮긴다. 그 step의 "넘길 줄"/"lead가 소유에 더한다" 표시는 이제 이 task의 일이다.
  - `packages/shell/renderer/workspace/{source,fake-source}.ts`
  - `tools/wireframes/pages/screens/project-window.tsx`
  - `packages/shell/renderer/workspace/sidebar/workflow-panel.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/remove-role/README.md`의 "agent와 정의"(등록할 때 agent를 만들지 않는다), "주소와 넘기기"(workflow 참가자는 `{agent, place?}`, `human`, `harness`. job을 만든 쪽은 (agent, place)), "화면"(role label을 지운다), "뼈대 검토"(wave 3 화면 task는 wording catalog에 key를 더하기만 한다). roadmap `project-docs/products/roadmap/remove-role.md`의 "정한 것 (사람)"(새 앱은 home의 lophn이 등록하고 그 앱 place의 lophn session에 맡긴다)
  - 계약 brief의 "내놓는 것": `project-docs/plan/remove-role/tasks/jobs-core.md`(job 기록의 `creator: AgentAtPlace`, 저장 action `agent_run` = `{ agent: AgentId, agent_place }`), `workflows-core.md`(참가자 꼴), `contract-agent.md`(`agentList`), `contract-session.md`, `shell-events.md`, `wireframe-agents.md`(wording key)
  - architecture: `project-docs/architecture/job.md`의 "화면"(Settings › Scheduled jobs, project 창 job panel의 "걸린 job"), `project-docs/architecture/workflow.md`의 "화면"(step 담당 글, 사람 차례), `project-docs/architecture/place-session.md`(session의 agent와 place는 바뀌지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `core-api`. `project-docs/module-catalog.yaml`의 `packages/shell/renderer`(boundary `shell`), `tools`(boundary 없음)
  - 계약 코드: `packages/protocol/lophn-agent/places.ts`(`AgentId`, `LOPHN_AGENT_ID`, `Place`), `packages/protocol/lophn-agent/agent-values.ts`(`LOPHN_AGENT_NAME`), `packages/protocol/lophn-agent/agent-definitions.ts`(`agentList`: `agents/list`, output `{ agents: AgentRow[] }`), `packages/protocol/jobs/{values,jobs}.ts`, `packages/protocol/workflows/values.ts`(참가자)
  - 선행이 바꾼 것: `packages/shell/renderer/desktop/connection/events/sessions-store.ts`의 `SessionEntry`(`agent: AgentId | null`, `place`)
  - skill: `.claude/skills/ui-design/SKILL.md`, `.claude/skills/wording/SKILL.md`, `.claude/skills/write-test/SKILL.md`
  - 화면(gallery는 renderer component를 그대로 그린다. 따로 그리지 않는다):

    | gallery page id | gallery file | 그리는 renderer | 가짜 data → 실제 source |
    |---|---|---|---|
    | `launcher-lophn`, `new-launcher-new-app`, `new-launcher-projects`, `new-launcher-empty` | `tools/wireframes/pages/screens/launcher.tsx`(목록과 설명), `launcher/launcher-pages.tsx` | `desktop/launcher/launcher.tsx`, `create-app-dialog.tsx`, `lophn-panel/lophn-panel.tsx` | `desktop/dev-mock/agent.ts`(`mockAgentTabSource`), `apps/testdata/` → `apps/core-source.ts`의 `create`(그대로) |
    | `settings-jobs-list`, `settings-jobs-history`, `settings-jobs-edit`, `settings-jobs-delete` | `tools/wireframes/pages/screens/settings.tsx`·`settings-pages.tsx`·`settings-frame.tsx`(소유 밖, 고치지 않아도 그려진다) | `desktop/settings/jobs/{jobs-panel,job-line,edit-dialog}.tsx` | `desktop/settings/jobs/testdata/fake-source.ts`(`JOBS`, `NAMES`) → `desktop/settings/jobs/core-source.ts`(`jobList`, `agentList`) |
    | project 창 Scheduled jobs panel(`tools/wireframes/pages/screens/project-window.tsx`, 소유 밖) | 소유 밖 | `workspace/sidebar/job-panel.tsx`(소유 밖)가 부르는 `jobsOfProject` | `project-window.tsx`의 `JOBS` |
    | `workflow-tab-running`, `workflow-tab-human-turn`, `workflow-tab-not-handed`, `workflow-tab-ended` 등 `workflow` 영역 | `tools/wireframes/pages/screens/workflow.tsx`, `workflow/pages.tsx` | `workflow/instance-view.tsx`, `workflow/model.ts` | `workspace/fake-source.ts`의 `PARTICIPANTS` → `workspace/core-source.ts`의 `workflow_instances` 읽기(그대로 넘긴다) |
    | kit overlay(Dialog·Toast 견본) | `tools/wireframes/pages/kit/overlay/page.tsx` | `@lophn/ui/overlay` | 같은 file의 견본 글 |
  - wording key 영역: `packages/design/wording/catalog/workspace.ts`(`launcher.*`), `packages/design/wording/catalog/workspace-settings.ts`(`jobs.*`), `packages/design/wording/catalog/workflow.ts`(`workflow.*`). 이 task는 이 세 file에 key를 더하기만 한다.
- 계약:
  - 쓰는 것: `jobs-core`의 job 기록 꼴, `workflows-core`의 참가자 꼴. `contract-session`의 `placeSessionOpen`. `shell-events`의 session store 꼴. `wireframe-agents`가 더한 wording key(catalog는 고치지 않는다).
  - 내놓는 것: 이 화면들은 role 값과 role label key를 쓰지 않는다.

## 할 일

1. 먼저 지금 꼴을 본다. wave 2 `jobs-core`는 `desktop/settings/jobs`를 job 기록 꼴에 맞춰, `workflows-core`는 `workflow/instance-view.tsx`를 workflow type에 맞춰 최소로 고쳤다. 그 꼴을 이어 쓰고, 아래 "남지 않음" grep을 먼저 돌려 남은 곳을 찾는다. 이미 새 꼴인 곳은 그대로 둔다.
2. 새 앱 흐름(`desktop/router.ts`, `desktop/main.tsx`, `desktop/launcher`). 근거: roadmap "정한 것 (사람)"의 새 앱 줄, README "등록할 때 agent를 만들지 않는다".
   - `router.ts`: `Route.appEngineer`를 `newSession?: true`로 바꾸고 주석을 "app 공간에서 그 앱 place의 lophn을 새 session으로 열어 시작한다"로 고친다. `openNewApp`은 `{ space: "app", app, newSession: true }`다.
   - `router.ts`: `Route.projectManager`를 지우고 `openProject`의 `Pick<Route, "session" | "projectManager" | "open">`에서 뺀다. 아무도 `true`로 정하지 않는 죽은 값이다.
   - `main.tsx`: `<Workspace projectManager={route.projectManager}>`를 지운다. `<AppSpace appEngineer={route.appEngineer}>`는 `appEngineer={route.newSession}`이다. `AppSpace`의 prop 이름은 `shell-workspace` 소유라 이 wave에 그대로다(정한 것 5). `settingsSpace`의 주석("Project Manager")을 고친다.
   - `launcher/create-app-dialog.tsx`: 주석("그 앱의 App Engineer와 이어서 시작한다")을 그 앱 place의 lophn 새 session으로 고친다. 안내 `launcher.dialog.new-app-note`와 도움말 `launcher.field.app-purpose-help`("Its App Engineer …")를 role 이름 없는 key로 바꾼다(8).
   - `launcher/launcher.tsx`: `onNewApp`의 주석을 고친다. `openLophn`이 고르는 session은 `item.ended === null && item.agent === LOPHN_AGENT_ID && item.place === null`의 마지막이다(home의 lophn).
   - 확인만 한다: 런처 lophn 패널에서 lophn이 앱을 등록하고 `call`로 그 앱 place의 lophn에게 맡기면, call 블록의 [Open conversation]이 `runToastAction`을 거쳐 `main.tsx`의 `openSession`에 오고, session store의 `place`(app)로 그 앱 공간을 연다. 고칠 것이 없으면 그대로 둔다.
3. session 열기(`desktop/main.tsx`의 `openSession`). 근거: README "화면"(고르면 그 place의 session을 연다), `place-session.md`.
   - place가 project면 그 project 창, app이면 그 앱 공간, null(home)이거나 모르는 session이면 `openLauncher(session)`이다. "지금 project 창이면 거기서 연다" 갈래를 지운다(정한 것 2).
4. Settings › Scheduled jobs(`desktop/settings/jobs`). 근거: README "job을 만든 쪽은 (agent, place)다", `jobs-core`의 기록 꼴, `job.md` "화면".
   - `source.ts`: `AgentRefView`를 지운다. `JobView.creator`는 `{ agent: AgentId; place: PlaceView | null }`, `JobActionView`의 `agent_run`은 `{ kind: "agent_run"; agent: AgentId; agent_place: PlaceView | null; prompt }`다. `JobNames.operators`(Operator id → 이름)를 `agents`(agent id → 이름, lophn 포함)로 바꾼다.
   - `core-source.ts`: `agentDefinitionList`(`agent-definitions/list`) → `agentList`(`agents/list`). output `{ agents }`의 줄마다 `agent → name`으로 `JobNames.agents`를 채운다. role로 거르던 `row.agent.role === "operator"` 갈래를 지운다.
   - `model.ts`: `agentName(agent: AgentRefView)`를 `agentName(agent: AgentId, names: JobNames)`로 바꾼다. `names.agents`에 없으면 lophn은 `LOPHN_AGENT_NAME`, 나머지는 이름 모르는 agent를 말하는 key다. `creatorText`는 place가 project면 `jobs.label.created-by-place`(project 제목), app이면 같은 key(앱 이름), null이면 `jobs.label.created-by`다. `actionText`의 agent_run은 `agentName(action.agent, names)`다.
   - `model.ts`의 `jobsOfProject`: "그 project의 PM이 만든 것"을 "그 project place의 agent가 만든 것"(`creator.place?.kind === "project" && creator.place.id === project`)으로 바꾼다. 나머지 두 조건(그 project의 agent를 부름, 그 project의 workflow를 시작함)은 그대로다. 주석을 고친다.
   - `edit-dialog.tsx`: `jobs.note.edit-readonly`의 `agent`는 `agentName(job.creator.agent, names)`다. `names`는 `jobs-panel.tsx`가 넘긴다.
   - `testdata/fake-source.ts`: `JOBS`의 `creator`와 `agent_run.agent`를 새 꼴로 바꾼다(lophn @ home, lophn @ project, 사람이 만든 agent @ app 등 지금 장면 수를 그대로). `NAMES.operators`는 `NAMES.agents`다.
   - 넘길 줄: `tools/wireframes/pages/screens/project-window.tsx`의 `JOBS`(`creator: { role: … }`)가 이 type으로 깨지면 그 칸만 새 꼴로 맞춘다. 이 wave에 이 file을 가진 task가 없다.
5. Workflows 참가자(`workflow/model.ts`, `workflow/instance-view.tsx`). 근거: README "workflow 참가자는 `{agent, place?}`, `human`(`with`), `harness`다", `workflows-core`의 참가자 꼴(place가 없으면 instance의 project).
   - `model.ts`: `ROLE_KEY`와 `roleKey`를 지우고 `participantText(participant)`를 둔다. `{ agent, place? }`는 agent 이름이고, place가 있으면 그 이름과 place 값(`place.project` 또는 `place.app`)을 잇는 key다. `{ kind: "human" }`은 사람, `{ kind: "harness" }`는 coding agent를 말하는 key다. `jobWho`가 쓰는 key도 role 낱말 없는 key로 바꾼다.
   - `instance-view.tsx`: `participantName`은 `participantText`를 쓴다. `whoOf`의 `workflow.label.role-*` 사용을 새 key로 바꾼다. 주석 "사람 step은 \"You, with Project Manager\"다"를 고친다.
   - 넘길 줄: 참가자의 화면 type은 `packages/shell/renderer/workspace/source.ts`의 `WorkflowInstanceView.participants`(`{ role, name? }`)이고, 가짜 값은 `packages/shell/renderer/workspace/fake-source.ts`의 `PARTICIPANTS`다. 둘 다 이 wave에 가진 task가 없다. 앞 wave가 새 꼴로 바꾸지 않았으면 그 type 한 칸과 `PARTICIPANTS` 값만 새 꼴로 맞춘다(참가자 key 이름 `pm`·`operator`와 step의 `by`는 그대로 두고 값만 `{ agent: "lophn" }`, `{ agent: "Eval analyst" }`, `{ kind: "human" }`으로). 보고의 "넘길 줄"에 적는다.
6. 남은 글.
   - `icons/workspace.ts`: 주석 "Operator editor의 [Delete Operator]"를 "agent editor의 [Delete]"로 고친다.
   - `tools/wireframes/pages/kit/overlay/page.tsx`: 견본 글 "Operator run", "1 Operator repeats a check here", "See Operators"를 role 이름 없이 바꾼다(예: "Agent run").
   - `tools/wireframes/pages/screens/launcher.tsx`: `new-launcher-new-app` 설명("App Engineer의 새 session")을 "그 앱 place의 lophn 새 session"으로 고친다.
7. gallery. wireframe 코드를 다시 그리지 않는다. 위 표의 page는 renderer component를 그대로 그리고, 이 task는 설명 글과 고정 data만 고친다. `workflow/pages.tsx`와 `launcher/launcher-pages.tsx`는 바뀐 type으로 깨지는 곳만 맞춘다.
8. wording. 근거: README "뼈대 검토"의 wording catalog 줄, `wording` skill.
   - 먼저 `wireframe-agents`가 더한 key를 찾는다: `grep -n "new-app\|purpose\|agent\|created" packages/design/wording/catalog/workspace.ts packages/design/wording/catalog/workspace-settings.ts`, `grep -n "participant\|label\.by\|human\|harness" packages/design/wording/catalog/workflow.ts`.
   - 없으면 그 세 file에 key를 더한다. 바꿀 글: `launcher.dialog.new-app-note`, `launcher.field.app-purpose-help`, `jobs.label.agent-*`(이름 모르는 agent 하나만, 예 "an agent"), `workflow.label.role-*` 전부(사람 "You", harness "Coding agent", lophn, program, job 둘, 모르는 agent)와 agent · place를 잇는 key 하나. 있는 key의 값을 고치거나 key를 지우지 않는다(옛 key는 wave 4 `cleanup-shell`이 지운다). key 이름에 role 낱말(`role-`, `project-manager`, `app-engineer`, `operator`)을 넣지 않는다.
   - key를 더했으면 `npm run wording`과 `node tools/check-wording.ts`를 돌린다.

## 정한 것

planner가 문서에 답이 없어 정했다.

1. **Apps의 [New app] dialog는 남긴다.** 사람이 `apps/create`로 직접 등록하고, 만들면 앱 공간이 그 앱 place의 lophn 새 session으로 열린다. home의 lophn이 등록하는 길(런처 lophn 패널의 `/new-app`)은 core 지침과 skill(wave 2 `place-prompts`)이 맡고, 화면은 call 블록의 [Open conversation]이 앱 공간을 여는 지금 길을 그대로 쓴다. README와 roadmap은 dialog를 지우라고 하지 않았고, 뼈대가 "새 앱을 만든 뒤 앱 공간이 그 앱 place의 lophn session으로 열린다"를 이 task의 일로 정했다.
2. **home session은 늘 런처 lophn 패널에서 연다.** project 창은 그 project place의 session만 보인다(README "화면"). home session을 project 창의 Agent 탭에 열면 탭의 place(project)와 session의 place(home)가 어긋난다.
3. **런처 lophn 패널은 lophn에 묶여 있다.** lophn 아닌 agent의 home session(place 없는 `call`, job, CLI run이 연다)을 열면 패널이 그 session을 lophn 얼굴로 보인다. README에 그 session을 볼 화면이 없어 고치지 않는다. 보고의 "알려진 미완 동작"에 적는다.
4. **job과 workflow의 agent 이름은 화면이 붙인다.** job은 `agents/list`를 `job.list`와 같이 한 번 읽어 id → 이름 표로 붙인다(지금 Operator 이름 표와 같은 길). workflow 참가자는 `workflow.yaml`에 쓴 agent 이름을 그대로 보이고, place는 적힌 것만 보인다(없으면 instance의 project라 따로 적지 않는다).
5. **`AppSpace.appEngineer`와 `Workspace.projectManager`의 prop 이름은 이 wave에 바꾸지 않는다.** 그 두 component는 `shell-workspace` 소유이고 같은 wave에 선행이 없다. 이 task는 자기 file의 `Route` 칸 이름만 바꾸고(`newSession`), 죽은 `projectManager`는 넘기지 않는다. prop 이름은 wave 4 `cleanup-shell`이 바꾼다.

## 끝남

- `npm run check`가 통과한다.
- `node packages/shell/renderer/build.ts`로 renderer bundle이 선다(`check:full`은 이것을 보지 않는다).
- `npm run wireframes`가 되고, gallery의 `launcher-lophn`, `new-launcher-new-app`, `settings-jobs-list`, `settings-jobs-history`, `settings-jobs-edit`, `workflow-tab-running`, `workflow-tab-human-turn`, `workflow-tab-not-handed`와 kit overlay page가 renderer component(`Launcher`, `CreateAppDialog`, `JobsPanel`, `InstanceView`)로 그려진다. job의 만든 쪽 줄은 agent 이름과 place 이름, workflow step 담당은 agent 이름(이나 "You")을 보인다.
- 위험 test: 없음. 화면, 문구, 가짜 data만 바꾼다(`write-test`). job을 다루는 범위(같은 agent·같은 place)는 core `jobs-core`가 지키고 화면의 `jobsOfProject`는 보이는 줄을 고를 뿐이다.
- 남지 않음: 아래가 모두 0줄이다. Settings › Jobs는 core를 route 상수의 resource·method로 부른다. 옛 resource 글이 남지 않았는지도 본다.

  ```sh
  P="packages/shell/renderer/desktop/main.tsx packages/shell/renderer/desktop/router.ts packages/shell/renderer/desktop/launcher packages/shell/renderer/desktop/settings/jobs packages/shell/renderer/workflow packages/shell/renderer/icons/workspace.ts tools/wireframes/pages/screens/launcher.tsx tools/wireframes/pages/screens/workflow.tsx tools/wireframes/pages/screens/launcher tools/wireframes/pages/screens/workflow tools/wireframes/pages/kit/overlay/page.tsx"
  # role 이름
  grep -rnE "project_manager|app_engineer|\"operator\"|Project Manager|App Engineer|Operator" $P
  # 옛 type·route 상수·role로 찾던 이름
  grep -rnE "\b(AgentRef|AgentRefView|CallAgent|NamedAgent|agentDefinitionList|agentDefinitionRead|ROLE_KEY|roleKey|projectManager)\b" $P
  # role 칸
  grep -rnE "\.role([^-a-zA-Z]|$)|\brole\??:|agent: \{ role" $P
  # 글로 부르는 옛 resource
  grep -rnE "\"(agent-definitions|operators|builtin-agents)\"" $P
  # 이름에 role이 든 wording key
  grep -rnoE "\"[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]*(project-manager|app-engineer|operator|role-)[a-z0-9-]*\"|jobs\.label\.agent-lophn" $P
  # 값에 role 이름이 든 wording key
  grep -rhoE '"[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+"' $P | tr -d '"' | sort -u | node --input-type=module -e 'import { en } from "./packages/design/wording/en.ts"; let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { for (const k of s.split("\n").filter(Boolean)) { const v = en[k] ?? ""; if (/Project Manager|App Engineer|Operator/.test(v)) console.log(k, "=", v); } });'
  ```

  `appEngineer`는 `main.tsx`가 `AppSpace`에 넘기는 한 줄만 남는다(정한 것 5): `grep -rnE "appEngineer|AppEngineer|ProjectManager" $P`.

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
