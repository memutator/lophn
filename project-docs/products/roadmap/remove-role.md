# role 없애기: agent는 전역, place는 session에

상태: 로드맵. 2026-10-28 사람이 방향을 내고 planner가 정리했다. 계획 `remove-role`로 연다(`project-docs/plan/remove-role/README.md`, agent가 정한 것은 그 README에 있다).
배경 문서: `project-docs/products/AGENT-ROLE.md`, `project-docs/architecture/agent-definition.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/domain.md`, `project-docs/architecture/agent-call.md`, `project-docs/architecture/workflow.md`, `project-docs/architecture/job.md`, `project-docs/architecture/coding-agent.md`, `project-docs/architecture/terminal-agent.md`.

## 왜

- Project Manager, App Engineer, Operator는 소프트웨어 공학의 말이다. `PRODUCT.md`는 그런 것을 사람에게서 감추려 한다. 사람은 지금 보는 창에서 agent와 말하면 된다.
- role 사이 넘기기가 비싸다. Operator가 앱 버그를 만나면 App Engineer에게, kind를 바꾸려면 Project Manager에게 call한다(`AGENT-ROLE.md` O4~O6). 맥락이 끊기고 turn이 는다. role이 없으면 버그를 찾은 agent가 고친다.
- agent 사이의 차이는 이미 다른 것이 만든다. credential 조건은 role이 아니라 place 종류에서 나온다(`packages/core/agent-roles/credentials.ts`의 `agentConditions`). 범위는 정의의 `domains`와 할당이 좁힌다.
- agent를 place에 묶은 것은 role(PM은 project에, AE는 앱에)의 흔적이다. place가 하는 일(file 범위, 받는 domain, credential 조건, prompt 고정, 화면과 주소)은 모두 "session이 어디서 일하나"의 일이다. `sessions` 표는 이미 place를 role과 따로 든다(`place_kind`, `place_id`). Claude Code, Codex, OpenCode도 agent 설정은 전역이고 작업 폴더는 session마다다.

## 지금 코드 (HEAD 706993098)

### role

- 값은 `"lophn"`, `"project_manager"`, `"app_engineer"`, `"operator"`다(`packages/protocol/lophn-agent/places.ts:5-12`의 `ROLES`). `Role`은 49 files, role로 갈리는 union `AgentRef`(`places.ts:39`)는 57 files가 쓴다. 주소에만 쓰는 `"coding_agent"`가 `protocol/lophn-agent/calls.ts:45-60`에 있고 Router가 늘 거절한다.
- role 이름이 나오는 file(test 뺌): protocol 8, core 25, shell 38(+ design wording 12), coding-agent 1, sdk 1, tools 7, tests 12. `*_test.ts` 230개 가운데 56개(core 28, shell 1, e2e 24, eval 3).
- harness(`packages/core/lophn-agent`)는 role을 모르고 `AgentRoleTable`(`core/lophn-agent/agents/role-table.ts:12`)로 받는다. role의 차이는 `packages/core/agent-roles`(52 files, 2772줄)가 준다(`ROLE_TABLE`, `core/agent-roles/agents/role-table.ts:27`).

### role이 정하는 것

- **tool 목록**(`core/agent-roles/tool-lists.ts`의 `builtinToolNames`): lophn 42, PM 43, App Engineer 53, Operator 35. 넷 모두 공통 19와 읽기 13을 받는다.
  - lophn만: `instructions.read`, `app.create`. lophn·AE: `app.tools`, `app.status`, `app.logs`, `app.invocations`. lophn·PM·AE: job 넷.
  - PM만: `workflow.check`. PM·AE: `operator.create`, `operator.update`, `domain.create`. PM·AE·Operator: `file.write`, `file.edit`, `shell.run`.
  - AE만: `app.link_source`, `package.publish`, `release.prepare`, `release.activate`, `preview.start`·`call`·`stop`.
  - 목록 밖 role 검사: preview 호출(`core/apps/calls/caller.ts:106`), `operatorPlaceAllowed`(`core/agent-roles/tools/operator-place.ts`), job을 만드는 role(`core/jobs/commands.ts:122,140`의 `CREATOR_ROLES`), `call` tool 설명의 role 이름(`core/lophn-agent/tools/bundles/call.ts:36-38`).
- **지침**: `core/agent-roles/roles/{lophn,project-manager,app-engineer,operator}/prompt.md`(60, 54, 98, 35줄). 모든 role에 같은 `PRODUCT_INSTRUCTIONS`의 세 줄이 PM, AE, `operator.create`를 말한다.
- **내장 skill**(`protocol/lophn-agent/skill-settings.ts:24-85`의 `roles`, 거르는 곳 `core/lophn-agent/extensions/skills.ts:182`의 `builtinForRole`): `guide-*` 여덟과 `new-app`·`repair-app`은 lophn, `guide-domains`는 lophn·PM·AE, `guide-artifact`는 PM·AE·Operator, `guide-workflows`·`check-kinds`는 PM, `design-app`은 AE, `kinds-yaml`은 PM·AE.
- **credential**: 상한(`credentials.ts:56`의 `roleOperations`)은 role 목록 route의 합이다. 조건(`:98`의 `agentConditions`)은 이미 place 종류에서 나온다(app place면 `conditions.app`, project place면 `conditions.project`, lophn은 없음).
- **file 범위**(`core/agent-roles/place/place-folders.ts:26-64`의 `placeScope`): lophn은 활성 project 폴더를 읽기만. PM은 project 폴더, 그릇의 domain 폴더 전부, `workflows/`. AE는 앱 source와 그 앱의 domain 폴더. Operator는 그릇 폴더(앱 source는 읽기만)와 고른 domain의 `artifacts/`.
- **정의 자리**(`core/agent-roles/agents/role-table.ts:21-55`): lophn `<data>/agents/lophn.md`, PM `<data>/projects/<prj>/agents/project-manager.md`, AE `<data>/apps/<app>/agents/app-engineer.md`, Operator `<place data>/agents/<agt id>.md`. built-in 정의 칸은 model, skills, mcp_off, 본문이고, Operator는 name, profile, domains, mcp_servers, skip을 더 갖는다(`protocol/lophn-agent/operators.ts:32,51-61`). route는 `CreateOperator`, `ChangeOperator`, `DeleteOperator`, `ChangeBuiltinAgent`(`protocol/lophn-agent/agent-definitions.ts`).
- **자동 생성**: lophn은 첫 기동(`core/main/daemon/wiring/lophn-agent.ts:43-47`). PM은 project 등록 tx 안(`projectManagerProvisioningPort`, `core/projects/registry/commands.ts:142`). AE는 `app.create` commit 뒤(`withAppEngineer`, `lophn-agent.ts:62-75`, 실패는 버린다).
- **session**: `sessions.role`과 `operator` 열, role과 `place_kind`를 잇는 CHECK, index `sessions_agent(role, place_kind, place_id, operator, lifecycle)`(`core/lophn-agent/session/model.ts:46-80`). lophn session은 place가 null이다. 여는 검사는 `core/lophn-agent/places/lifecycle.ts:44-60`과 `rolePlaceFits`.
- **주소**: call의 `to`는 `{session}` 또는 `{role, place?, name?}`(`calls.ts:51-80`)이고, `core/agent-roles/place/session-directory.ts`의 `resolveNamed`가 푼다. 저장은 `agent_calls."to"` JSON.
- **annotation**: 앱 annotation은 그 앱의 AE에게, 주인 없는 artifact annotation은 domain 주인 그릇의 PM이나 AE에게 간다(`core/main/daemon/wiring/router.ts:203-250`).
- **workflow**: 참가자는 `{role, place?, name?}`이고 role에 `human`, `harness`가 있다(`protocol/workflows/values.ts:3-12,45-54`, `packages/sdk/flow/wire.ts:11-16`이 손으로 옮긴 사본). 푸는 곳은 `core/workflows/plan.ts:25-45`. `workflows/` 폴더는 PM만 쓴다. flow의 앱 tool 호출은 PM의 할당으로 돈다(`core/main/flow-host/host.ts:177-182`가 `{role: "project_manager"}`를 박는다).
- **job**: `jobs.creator_role`·`creator_id`(`core/jobs/schema.ts:19-33`), 대상은 `NamedAgent`(`protocol/jobs/values.ts:59`), `runs.agent_key`는 `<role>:<id>`(`core/runs/store.ts:11-19`).
- **화면**: sidebar(`shell/renderer/workspace/sidebar/sidebar-agent.ts`의 `SidebarAgentRole`, AE는 없다), 앱 title bar agent select(`app-frame/agent-select.tsx`), Agents 탭(`workspace/agents/`, `ROLE_LABEL`). wording key 22개가 role 이름을 key에 갖고, catalog 42줄이 글에 갖는다.
- **CLI**: `lophn run`의 `pm:`, `ae:`, `operator:`(`packages/coding-agent/cli/commands/run.ts:30-62`).
- **eval**: scenario 폴더가 role 이름이다(`tests/eval/scenarios/{app-engineer,lophn,operator,project-manager}`, scenario 11, registry instruction 4).
- **죽은 코드**: `protocol/lophn-agent/scope.ts`의 `agentRoleSchema` 말고는 쓰는 곳이 없다(`traces.ts:102,141,181`만 쓴다).

### coding agent 연결 장치

- coding session 층(`core/apps/coding/` 23 files, `protocol/coding-agent/` 19 files, 표 `coding_sessions`·`coding_lines`·`coding_inputs`, CLI의 message·앱 읽기·preview, coding MCP endpoint)은 여는 길이 없다. `CodingTransport.start`(`core/apps/coding/transport.ts:40`)를 부르는 곳이 없고, Router(`router.ts:116,126,147`), job(`jobs-registration.ts:32`), run(`runs/service.ts:169`)이 `coding_agent`를 거절한다.
- AE에 묶인 곳은 `core/apps/coding/message.ts:35`(CLI `message send`가 AE로)와 `close-call.ts:47`(session 끝 알림이 AE로)이다.
- 터미널 agent 층(hook, 감지, 설치, 탭 icon·점·알림, `architecture/terminal-agent.md`)은 사람이 연 터미널이 쓴다. 남긴다(사람, 2026-10-26).

## 무엇을 만드나

1. **agent는 lophn과 사람이 만든 agent뿐이다.** 정의는 전역에 있고 꼴이 하나다. lophn은 지울 수 없고 이름과 profile이 고정된 내장 정의다. Operator는 agent로 이름을 바꾼다.
2. **place는 session이 갖는다.** session을 열 때 place를 정한다: 없음(home), project, app. 창에서 열면 그 창의 place다. session의 agent와 place는 열 때 정해지고 바뀌지 않는다.
3. **차이는 session의 place 종류가 만든다.** tool 목록, 지침, 내장 skill, credential 상한, file 범위가 place 종류 셋으로 갈린다. 같은 place 종류의 session은 agent가 누구든 같은 tool과 범위를 받는다. 좁히는 것은 정의의 `domains`, `skills`, 할당이다.
4. **받는 domain은 session의 place와 정의의 `domains`로 정한다.** `domains`가 비면 place 그릇의 active domain 전부, 있으면 그 가운데 place 그릇의 domain과 겹치는 것만 받는다(0개일 수 있다). home은 0개다. domain 자체(그릇 하나에 속함, 공개 tool, 사용 관계, lophn 지도)는 그대로다.
5. **주소는 agent 이름과 place다.** call, workflow 참가자, job 대상, CLI `run`이 같은 꼴이다.
6. **coding session 층을 지운다.** 터미널 agent 층은 남긴다.

## 정한 것 (사람, 2026-10-28)

- role을 없앤다. lophn과 agent만 남기고 Operator를 agent로 부른다.
- agent는 place에 놓이지 않는다. session이 place를 갖는다.
- agent 정의에 권한 칸을 두지 않는다. 차이는 session의 place 종류와 정의의 domains, skills, 할당이 만든다.
- 등록할 때 agent를 만들지 않는다. 새 앱은 home의 lophn이 등록하고 그 앱 place의 lophn session에 맡긴다.
- coding agent 연결 장치의 coding session 층을 지운다.

## 끝남 기준

- role 이름(`project_manager`, `app_engineer`, role 값 `"operator"`, `Project Manager`, `App Engineer`, `Operator`)이 `packages`, `tools`, `tests`에 남지 않는다(eval의 지난 기록 `tests/eval/runs/`, scorecard, experiment 보고는 뺀다). `role` 낱말은 model 메시지의 role 같은 다른 뜻으로만 남는다.
- home의 lophn에게 새 앱을 청하면, 앱을 등록하고 그 앱 place의 lophn session이 짓고 release한다.
- 사람이 만든 agent를 project 창에서 열면 kind, `DOMAIN.md`, workflow를 쓴다. 앱 창에서 열면 그 앱을 고치고 release한다.
- `npm run check`가 통과한다.

## 하지 않는 것

- **agent 정의의 권한 칸**(짓기 가능, domain 고치기 가능). role이 칸 이름만 바꿔 돌아온다.
- **터미널 agent 층 지우기.** 사람이 연 터미널의 탭 icon, 점, 알림이 쓴다.
- **eval 돌리기.** scenario는 다시 쓰지만 실제 model 호출은 사람이 정한다.
- **옛 이름 읽기와 migration.** 개발 data는 지우고 새로 만든다(AGENTS.md "호환성").
