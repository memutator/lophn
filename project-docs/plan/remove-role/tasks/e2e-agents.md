# e2e-agents

role이 주제인 e2e(`operator_test`, `pm-tools_test`)를 지우고, 주제가 남는 agent·session·call 쪽 e2e와 공용 support를 새 계약으로 옮긴다. 고치는 것은 주소와 session 정체, route 상수뿐이다. 새 e2e는 만들지 않는다(필요하면 lead가 사람에게 묻는다).

- 단위: e2e (wave 3)
- 선행: shell-events. e2e가 session snapshot과 event를 읽는다.
- 소유(이 task만 고친다):
  - `tests/support`
  - `tests/e2e/{operator,pm-tools}_test.ts` (지운다)
  - `tests/e2e/{session,agent-call,registration,annotation,kinds,compact,restart,stop,steer,turn-fate,rewind,approval,prompt-blocked,prompt-notice,boot}_test.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/testing.md`("`tests/support`", "앱 길", "case 고르는 규칙", "돌리는 때"), `project-docs/architecture/place-session.md`, `project-docs/architecture/agent-call.md`, `project-docs/architecture/annotation.md`, `project-docs/architecture/approval.md`("할당"). 이 문서들의 role 말은 lead가 고친다.
  - skill: `.claude/skills/write-test/SKILL.md`(특히 "지우는 test가 지키던 권한 경계 검사까지 같이 없애지 않는다")
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-sessions`, `router`, `agent-tools`, `agent-tool-spi`, `run-loop`, `approvals`, `agents`, `apps`. `project-docs/module-catalog.yaml`의 `tests`
  - 제품 결정: `project-docs/plan/remove-role/README.md`의 "session과 place 종류", "주소와 넘기기", "저장과 test"(role이 주제인 test는 지운다, 주제가 남는 test는 주소만 고친다, 새 e2e는 만들지 않는다), "뼈대 검토"(wave 2와 3은 함께 올린다, annotation 받는 쪽)
  - 계약 모양: `project-docs/plan/remove-role/tasks/contract-agent.md`(`AgentId`, `LOPHN_AGENT_ID`, `agentCreate`, `agentList`, `assignmentGet`, `assignmentSet`), `project-docs/plan/remove-role/tasks/contract-session.md`(`placeSessionOpen`·`placeSessionRead`·`placeSessionList`, `agentCallRead`, `CallAddressInput`, annotation의 `agent` 칸), `project-docs/plan/remove-role/tasks/shell-events.md`(snapshot의 `agent: AgentId`)
  - tool 목록: `packages/core/agent-places/tool-lists.ts`의 `placeToolNames(kind)`(place-tools가 만들었다). fake server 줄(lane)을 가를 place 종류 전용 tool 이름을 여기서 확인한다.
  - 코드: `tests/support/core/human.ts`(`openSession`), `tests/support/app/activate.ts`(`startTestApp`, `TestApp.ae`), `tests/support/fake-server/server_test.ts`, 아래 "할 일"의 e2e file 전부, 지우는 `tests/e2e/pm-tools_test.ts`(옮길 행의 원본)
- 계약:
  - 쓰는 것: `contract-agent`의 `AgentId`, `LOPHN_AGENT_ID`, `agentCreate`, `agentList`, `assignmentSet`. `contract-session`의 `PLACE_SESSION_ROUTES`, `AGENT_CALL_ROUTES`, `CallAddressInput`. `shell-events`의 event·snapshot 꼴.
  - 내놓는 것: `tests/support`의 session 열기·사람 메시지 도우미는 `(AgentId, place)`로 연다. `e2e-apps`가 이것을 쓴다.

## 할 일

role 주제 e2e 둘을 지우고, 나머지는 `{ role: … }` 주소와 옛 route 상수만 새 꼴로 바꾼다. PM·AE가 받던 자리는 그 place의 lophn이나 test가 만든 agent로 옮기고 test가 지키던 경계 검사는 남긴다(README "저장과 test", write-test skill).

공통 바꿈표(모든 file에 쓴다):

| 옛 것 | 새 것 |
|---|---|
| `openSession(core, { role: "lophn" })` | `openPlaceSession(core, LOPHN_AGENT_ID)` (home) |
| `openSession(core, { role: "project_manager", project })` | `openPlaceSession(core, LOPHN_AGENT_ID, { kind: "project", id: project })` |
| `openSession(core, { role: "app_engineer", app })` | `openPlaceSession(core, LOPHN_AGENT_ID, { kind: "app", id: app })` |
| `openSession(core, { role: "operator", agent })` | `openPlaceSession(core, agent, <그 행의 place>)` |
| `agentSessionRead` / `agentSessionList { agent: ref }` | `placeSessionRead` / `placeSessionList { agent, place }` |
| `openAgentSession` | `placeSessionOpen` (`{ id, agent, place }`) |
| `callRead` | `agentCallRead` (`call.to`는 `CallTarget`) |
| `operatorCreate { id, place, definition }` | `agentCreate { id, definition }` (정의에 place가 없다) |
| `agentAssignmentGet`·`agentAssignmentSet { agent: ref }` | `assignmentGet`·`assignmentSet { agent: AgentId }` |
| `agentDefinitionList { place }` | `agentList {}` |
| call `to: { role: "project_manager", place: { project: "x" } }` | `to: { agent: "lophn", place: { project: "x" } }` |
| call `to: { role: "app_engineer", place: { app: "X" } }` | `to: { agent: "lophn", place: { app: "X" } }` |
| fake tool 이름 `operator_create` | `agent_create` |
| 주석·test 이름의 "PM", "Project Manager", "AE", "App Engineer", "Operator" | "project place session", "앱 place session", "lophn", "test가 만든 agent" 가운데 맞는 것 |

- 머리 주석의 boundary ID는 catalog에 지금 있는 ID를 쓴다. `agent-roles`는 그대로 둔다(계획 끝에 lead가 catalog와 같이 고친다).
- 줄(lane)은 place 종류 전용 tool 이름으로 가른다: home은 `app_create`, project는 `workflow_check`, app은 `release_prepare`. 시작 전에 `placeToolNames`로 셋이 서로 겹치지 않는지 확인한다. 한 행에서 같은 place 종류의 session 둘이 같이 model을 부르면 `systemText`(정의 본문)로 가른다.

1. `tests/support/core/human.ts`: `openPlaceSession(core: Core, agent: AgentId, place: Place | null = null): Promise<string>`을 더한다. `core.ids.newId("ses")`로 id를 만들고 `placeSessionOpen { id, agent, place }`를 부른다. 옛 `openSession(core, AgentRef)`는 지우지 않는다. 소유 밖의 `tests/live/chatgpt_test.ts:65`와 `tests/eval/runner/steps.ts:35`가 아직 부른다(병렬 규칙 2). 보고의 "안 쓰게 된 export"에 적는다.
2. `tests/support/app/activate.ts`: `startTestApp`이 여는 session을 `openPlaceSession(core, LOPHN_AGENT_ID, { kind: "app", id: created.id })`로 바꾼다(README 사람 결정 "새 앱은 … 그 앱 place의 lophn session에 맡긴다"). 주석의 "App Engineer"는 "앱 place의 lophn session"으로 바꾼다. 이름 `TestApp.ae`, `aeTurn`, `aeToolResult`, `aeLane`, `AeTurn`, `AeToolResult`와 `appProjectName`·`openAppProject`의 꼴은 바꾸지 않는다(`tests/e2e/app-release_test.ts`(e2e-apps)와 `tests/eval/restore/apps.ts`(eval-scenarios)가 import한다).
3. `tests/support`의 나머지: `fake-server/server_test.ts`의 `operator_create`를 `agent_create`로, 줄 이름 `pm`·`engineer`와 대답 글을 role 없는 이름(`creator`·`ticketer` 같은 것)으로 바꾼다(줄 가르기를 보는 test라 이름은 자료일 뿐이다). `loop/harness.ts`의 `role_prompt`, `wire/binding.ts`의 layer `"role"`이 wave 2(place-scope) 뒤에도 남았으면 `place_kind_prompt`, `"place_kind"`로 고친다.
4. 지운다(subject가 role이다. README "저장과 test"의 예):
   - `tests/e2e/operator_test.ts`. 이 file의 할당 경계 행(removed, no-assignment, assignment-added, domain-narrowed)은 e2e-apps가 `tests/e2e/app-call_test.ts`로 옮긴다. 이 task는 옮기지 않는다. `pm-creates-operator` 행이 보던 "agent를 만드는 tool은 할당·`mcp_servers`·`skip`을 주지 못하고 묻지 않는다"는 5의 옮긴 행이 본다.
   - `tests/e2e/pm-tools_test.ts`. 경계 검사는 5로 옮긴다.
5. `tests/e2e/session_test.ts`:
   - 공통 바꿈표대로 고친다. `newProject`는 `{ project, place }`(project place)를 돌려준다. `LOPHN`은 home이다.
   - test 이름 "session 열기·보관·fork는 role과 place, 이력의 규칙을 지킨다" → "agent와 place". 행 주석 `// role-place-mismatch`는 지운다.
   - `unknown-operator` 행 → `unknown-agent: 없는 agent에는 session을 열 수 없다`. `placeSessionOpen { agent: <새 agt id>, place: null }`이 `not_found`이고 `placeSessionList`가 빈다.
   - `fork-at-point` 행: 사본의 `agent`와 `place`가 원본과 같다(fork는 같은 agent·같은 place, sessions-core 계약).
   - `openCallWaitingPermission`의 받는 쪽은 그 project place의 lophn이다. 줄은 보낸 쪽 home(`app_create`), 받는 쪽 project(`workflow_check`이 있고 `app_create`·`release_prepare`가 없다)로 가른다.
   - pm-tools_test의 flow를 새 행 `project-tools-run`으로 옮긴다(새 project 폴더 `project-tools`, 그 project place의 lophn session). 한 turn에서 `shell_run`(`SHELL`), `skill_read {name: "kinds-yaml"}`, `image_read`, `file_grep`, `web_fetch`(fake의 loopback 주소), `agent_create {name: "helper", body: "Help."}`(place 칸 없음)을 부르고 단정은 그대로 옮긴다: disk의 `made.txt`, ledger에서 다섯은 `success`이고 `web`은 `{kind: "failure", code: "invalid_input"}`, `agentList`에 `helper`, shell tool_result가 30 KiB 이하. operator_test `pm-creates-operator`의 단정 둘을 더한다: `assignmentGet {agent: <helper id>}`가 `entries: []`, `revision: 0`이고, 첫 요청의 `agent_create` `input_schema.properties`에 `mcp_servers`, `skip`, `assign`이나 `grant`가 든 칸이 없다(agents-core가 정한 tool 입력을 먼저 읽는다). turn이 끝나는 것이 "묻지 않는다"의 단정이다.
   - 머리 주석에 옮긴 행의 세 질문을 pm-tools_test·operator_test 것에서 옮겨 한 묶음으로 더한다. boundary는 `agent-tools`·`run-loop`(runtime child에서 tool이 돌고 place 종류의 operation 상한이 그 목록의 tool을 막지 않는다), `agent-tool-spi`(상한은 tool 이름이 아니라 route 이름 기준), `agents`(agent를 만드는 tool은 할당을 주지 못한다). 현실적 회귀는 "tool이 route 상한에 막혀 turn이 실패하는 것(두 번 난 일), 이름이 route와 다른 command tool(`agent.create` → `CreateAgent`)이 막히는 것, web_fetch가 loopback으로 나가는 것, 만드는 tool 입력에 할당·`mcp_servers`·`skip` 칸이 생기는 것"이다.
6. `tests/e2e/agent-call_test.ts`:
   - 줄 상수 `LOPHN`·`PM`·`AE`·`OPERATOR`를 place 종류 셋 `HOME`(`app_create`), `PROJECT`(`workflow_check`, `app_create`·`release_prepare` 없음), `APP`(`release_prepare`)으로 바꾸고 `lane(fake, "pm")` 같은 이름을 맞춘다. 머리 주석의 줄 설명도 고친다.
   - `pm`/`toPm`은 `{ agent: "lophn", place: { kind: "project", id: project } }`(session 목록용)과 `{ agent: "lophn", place: { project: "proj" } }`(call `to`)이다. `sessionIds`·`opened`는 `(agent: AgentId, place: Place | null)`을 받아 `placeSessionList`를 부른다.
   - `call-not-found`의 `to`는 `{ agent: "lophn", place: { project: "no-such-project" } }`다.
   - `call-closed-session`의 hint 단정 `"call its role and place"`는 router-core가 바꾼 글로 맞춘다(`packages/core/router`에서 closed hint 글을 찾아 그 핵심 구절만 단정한다).
   - `operator-to-app-ae` 행 → `agent-to-app: test가 만든 agent가 앱 이름으로 앱 place의 lophn을 부르면 같은 왕복이 돈다`. 보내는 쪽은 `agentCreate`로 만든 `reviewer`의 그 project place session(줄 `PROJECT`), 받는 쪽은 `{ agent: "lophn", place: { app: "Ledger App" } }`(줄 `APP`)다. 단정은 지금 셋 그대로다.
7. `tests/e2e/registration_test.ts`:
   - `project-creates-pm` 행과 `definitionsAt`·`assertNoSecondBuiltIn`을 지운다. 주제가 role이다(README "등록할 때 agent를 만들지 않는다"). lophn 예약 이름은 agents-core의 unit이 본다.
   - `lophn-registers-then-calls`: `call`의 `to`는 `{ agent: "lophn", place: { app: "Todo List" } }`, 받는 session은 `placeSessionList { agent: "lophn", place: { kind: "app", id } }`로 찾는다. 단정은 그대로다.
   - test 이름 → "E2E lophn이 앱을 등록하고 그 앱 place의 lophn session에 맡긴다". 머리 주석의 contract는 `agent-tools`(lophn이 `app.create`와 `call`을 쓴다), `router`(이름으로 앱 place의 lophn session을 새로 연다)로 줄인다.
8. `tests/e2e/annotation_test.ts`(README "앱 화면 annotation은 앱 title bar agent select가 고른 agent의, 그 앱 place session으로 간다", contract-session: `agent`가 없으면 lophn):
   - `new-session`: `placeSessionRead`의 `session.agent`가 `"lophn"`, `session.place`가 `{ kind: "app", id: a }`다. 보내기 입력에 `agent`를 넣지 않는다.
   - `open-session`·`other-app`: 그 앱 place의 lophn session을 연다. `archived-app`: `placeSessionList { agent: "lophn", place: { kind: "app", id: c }, archived: "include" }`가 빈다.
   - test 이름과 주석의 "그 앱 project의 Project Manager" → "그 앱 place의 session". `element: { role: "button" }`은 ARIA role이라 그대로다.
9. `tests/e2e/kinds_test.ts`: "session은 열리지 않는다" 단정을 `placeSessionList { agent: "lophn", place: { kind: "project", id: project } }`가 빈다로 바꾼다.
10. 주소만 고치는 나머지(공통 바꿈표만): `tests/e2e/{compact,restart,stop,steer,turn-fate,rewind,approval,prompt-blocked,prompt-notice,boot}_test.ts`. PM session은 그 project place의 lophn session이다. test 이름과 주석의 PM 말을 바꾼다. 지키던 단정은 하나도 빼지 않는다.

## 정한 것

- 새 helper 이름은 `openPlaceSession`이고 옛 `openSession`은 남긴다. 이유: 옛 helper를 제자리에서 바꾸면 소유 밖의 `tests/live/chatgpt_test.ts`와 선행이 없는 eval-scenarios의 `tests/eval/runner/steps.ts`가 type check에서 깨진다. 이름은 route `placeSessionOpen`, type `PlaceSession`과 맞춘다. 옛 것은 `AgentRef`를 지우는 wave 4(`cleanup-protocol`, `tests` 소유)가 같이 지운다.
- pm-tools_test의 flow와 operator_test `pm-creates-operator`의 단정을 `session_test.ts`의 한 행으로 옮긴다. 이유: README가 두 file을 지우라고 했지만 그 안의 "place 종류의 operation 상한이 그 목록의 tool을 막지 않는다"는 두 번 고친 bug이고 "agent를 만드는 tool은 할당을 주지 못한다"는 권한 경계다(write-test). 새 flow가 아니라 core 하나를 같이 쓰는 행이라 e2e 시간도 준다.
- 받는 자리는 test가 따로 정의를 만들 필요가 없으면 그 place의 lophn이다. 이유: README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session"이고, lophn은 늘 있어 준비가 가장 가볍다. 다른 agent가 있어야 뜻이 있는 자리(`agent-to-app`의 보내는 쪽)만 `agentCreate`로 만든다.
- `ae*` helper 이름은 바꾸지 않는다. 이유: `tests/e2e/app-release_test.ts`(e2e-apps 소유, 선행이 이 task)가 import한다. 바꾸면 그 file이 깨진다.

## 끝남

- `npm run check`가 통과한다(`tests/e2e`는 type check에 들고, `tests/support`의 `*_test.ts`는 돈다).
- 고친 e2e가 돈다. 앱 길 dependency를 한 번 받고(`npm run e2e:deps`), 고친 file과 `activate.ts`를 쓰는 `app-release_test.ts`(고치지 않고 돌리기만)를 돌린다:
  `ELECTRON_RUN_AS_NODE=1 node_modules/electron/dist/electron --test --test-concurrency=1 tests/e2e/{session,agent-call,registration,annotation,kinds,compact,restart,stop,steer,turn-fate,rewind,approval,prompt-blocked,prompt-notice,boot,app-release}_test.ts`
  (`npm run e2e`의 길과 같다. 전체 `npm run e2e`는 e2e-apps가 끝낸 뒤 돌리고 `land.sh`가 다시 돈다.) 떨어지면 단정을 풀거나 기다림을 넣어 맞추지 않는다. core 쪽 bug로 보이면 고치지 말고 "알려진 미완 동작"에 재현 명령과 함께 적는다.
- 위험 test: 새로 쓰지 않는다. 옮긴 `session_test.ts`의 `project-tools-run` 행 "project place의 tool이 runtime child에서 돌고 web_fetch는 loopback으로 나가지 못하며 agent를 만드는 tool은 할당을 주지 않는다"가 통과한다.
- 남지 않음(아래 `<files>`는 `tests/support tests/e2e/{session,agent-call,registration,annotation,kinds,compact,restart,stop,steer,turn-fate,rewind,approval,prompt-blocked,prompt-notice,boot}_test.ts`):
  - `ls tests/e2e/operator_test.ts tests/e2e/pm-tools_test.ts`가 둘 다 없다고 한다.
  - `grep -rn 'project_manager\|app_engineer\|Project Manager\|App Engineer\|Operator\|operator\|role: "lophn"\|agentSessionRead\|agentSessionList\|agentAssignment\|agentDefinitionList\|\bcallRead\b' <files>`가 0줄이다.
  - `grep -rnw 'PM\|AE' <files>`가 0줄이다.
  - `grep -rn 'openAgentSession\|AgentRef\|openSession(' <files>`는 `tests/support/core/human.ts`의 옛 `openSession` 함수와 그 import 줄만 낸다.

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
