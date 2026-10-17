# registration-rows

project를 등록하면 Project Manager 정의가 하나 생기고, 앱을 등록하면 App Engineer 정의가 하나 생기며 사람이 더하거나 지울 수 없다는 것, 그리고 lophn이 `app.create`로 앱을 등록하고 그 App Engineer에게 답 없는 call로 맡기면 그 session이 열리고 맡긴 글이 입력에 있는 것을 새 file `tests/e2e/registration_test.ts`로 본다.

- 단위: registration-rows (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `tests/e2e/registration_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/agent-roles/agents/ensure.ts`
  - `packages/core/main/daemon/wiring/lophn-agent-registration.ts`
  - `packages/core/main/daemon/wiring/lophn-agent.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/research/candidates-docs.md` 10절(`project-creates-pm`, `app-creates-ae`, `lophn-registers-then-calls`)
  - architecture: `project-docs/architecture/place-session.md`("lophn은 전체에 하나, Project Manager는 project마다 하나, App Engineer는 앱마다 하나다. 더하거나 지우지 않는다. 정의는 파일이라 ... 만들기는 멱등이다", "App Engineer는 앱마다 하나, session은 여럿이다"), `project-docs/architecture/agent-call.md`(새 session을 열 때 이름은 정확히 맞아야 풀린다)
  - `project-docs/products/AGENT-ROLE.md`의 P3, P5, L4
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tools`, `app-releases`(앱 registry), `projects`, `router`
  - 코드(route 이름은 확인한 것): `project.create`(`projectApi.register`), `app.create`(`appCreate {slug, name, description}`, actors에 `user`·`agent`), `ListAgentDefinitions`(`agentDefinitionList {place?}`, 행의 `agent`·`kind`: `built_in` | `operator`), `ReadAgentDefinition`(`agentDefinitionRead {agent}`: 파일이 있으면 `hash`가 null이 아니다), `CreateOperator`(`operatorCreate {id, place, definition}`)와 `DeleteOperator`(`operatorDelete`: `agent`가 `agt_` id라 PM·AE를 가리킬 수 없다), `ListSessions`(`agentSessionList`), `ListReceivedMessages`(`receivedMessageList`), `ReadMessageBody`(`messageBody`), tool `app_create`·`call`
  - 코드(만드는 자리): `packages/core/agent-roles/agents/ensure.ts`(`ensureProjectManager`·`ensureAppEngineer`: 빈 파일, 있으면 그대로), `packages/core/agent-roles/agents/role-table.ts`의 `slotOf`(파일 이름 `project-manager.md`, `app-engineer.md`)와 `isReservedName`(built-in 이름은 Operator가 못 쓴다), `packages/core/agent-roles/place/data-folder.ts`의 `placeAgentsFolder`(`<data root>/projects/<prj id>/agents/`, `<data root>/apps/<app id>/agents/`), `packages/core/main/daemon/wiring/lophn-agent.ts`가 끼우는 `withAppEngineer`(정의는 `packages/core/agent-roles/agents/app-engineer.ts`. `app.create` 뒤 AE 정의 만들기), `packages/core/lophn-agent/agents/definition-file.ts`(Operator 정의의 이름이 built-in 이름이면 `reserved_name` issue), `packages/core/apps/agent-tools/app.ts`(tool `app.create`: slug는 이름에서 만든다. `Todo List` → `todo-list`)
  - main의 `tests/support/core/{mod,process,human}.ts`(`createRun`, `bootCore`, `Core.call/tryCall/upload/kill/stop/ids`, `processesOf`, `runtimePids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `stopTurn`, `settle`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script/reset/journal/arrived/aborted`, `Reply`), `tests/e2e/file-write_test.ts`(본보기)
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human}.ts`, `tests/support/fake-server/mod.ts`(위 목록 그대로), `projectApi`(`packages/protocol/projects/mod.ts`), `appCreate`·`appList`(`packages/protocol/apps/mod.ts`), `agentDefinitionList`·`agentDefinitionRead`·`operatorCreate`·`agentSessionList`·`receivedMessageList`·`messageBody`·`toolCallList`(`packages/protocol/lophn-agent/mod.ts`)
  - 내놓는 것: 없음(test file만)
  - `reply-fn`은 필요 없다. lophn이 앱을 부를 때 앱 이름(`place: {app: "Todo List"}`)을 쓰고 id를 쓰지 않으며, 두 tool call을 한 대답에 담으면 순서가 정해져 있다(쓰기와 읽기가 섞이면 `tool-batch.ts`가 요청 순서대로 하나씩 돈다). 이 판단이 틀려 id를 이어 써야 하면 `reply-fn`을 선행으로 더하고 보고한다.

## 할 일

1. 새 file이다. `Deno.test` 하나 안에서 core를 한 번 띄우고(`bootCore`, `connectFakeProvider`) 행마다 새 project 폴더·새 앱을 쓴다(행의 준비를 반복하지 않는다).
2. 등록 행(fake 없음). 행마다 데이터 root는 `run.home`이다. 만든 정의 파일은 `<run.home>/projects/<prj id>/agents/project-manager.md`, `<run.home>/apps/<app id>/agents/app-engineer.md`다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `project-creates-pm` | `openProject`(`projectApi.register`) → `agentDefinitionList({place: {kind: "project", id}})` → `core.tryCall(operatorCreate, {id: core.ids.newId("agt"), place, definition: {name: "Project Manager"}})` → `agentDefinitionList` 한 번 더 | 없음 | disk: 위 파일이 있다 / route: 첫 목록이 PM 하나(`kind: "built_in"`, `agent: {role: "project_manager", project}`)뿐이다 / route: Operator 이름으로 built-in 이름을 만드는 호출이 `invalid_input`이고 목록이 그대로 하나다(사람이 PM을 더할 길이 없다) | AGENT-ROLE P5, place-session 25행. `runtimePids`·`settle`: `openProject`가 이미 기다린다 |
| `app-creates-ae` | `core.call(appCreate, {slug: "ledger-app", name: "Ledger App", description: "Keep a ledger."})` → `agentDefinitionList({place: {kind: "app", id}})` → `core.tryCall(operatorCreate, {..., place, definition: {name: "App Engineer"}})` → `agentDefinitionList` | 없음 | disk: 위 파일이 있다 / route: 목록이 AE 하나(`kind: "built_in"`, `agent: {role: "app_engineer", app}`)뿐이다 / route: 이름 충돌 호출이 `invalid_input`이고 목록이 그대로 하나다 | AGENT-ROLE P3 |

   - `operatorCreate`가 이름 충돌을 `invalid_input`이 아닌 다른 code로 거절하거나 받아 주면(`definition-file.ts`가 `reserved_name`으로 막는다고 코드로 읽었다) 제품 bug 후보다. 받아 주면 사람이 Project Manager 이름을 가진 agent를 더하는 것이므로 보고한다. 거절 모양(code, `details`)은 처음 돌려 확인하고 실제 값을 쓴다. 거절이 아니라 저장된 뒤 `issues`에 `reserved_name`이 나오는 모양이면 이 행은 목록이 둘로 늘지 않는지(PM이 `operator`로 따로 섞이지 않는지)를 본다.
   - 앱 등록은 `appCreate`를 사람 자격(`core.call`)으로 부른다. lophn이 부르는 길은 아래 행이 본다.
3. lophn 행(fake 대답 3).

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `lophn-registers-then-calls` | `openSession(lophn)` → `say` → `waitTurnEnd(lophn)` → `agentSessionList({agent: {role: "app_engineer", app}})`를 session 하나가 보일 때까지 poll(제한 시간 있음) → AE의 `waitTurnEnd` | ① tool 둘 `app_create {name: "Todo List", purpose: "Keep a short list of todos."}`, `call {to: {role: "app_engineer", place: {app: "Todo List"}}, reply: "none", body: "Build the todo list app.", refs: []}` ② text(lophn의 마지막 요청) ③ text(AE의 첫 turn). ②와 ③은 같은 text라 요청이 오는 순서와 무관하다 | ledger: `appList`에 이름 `Todo List`인 앱이 하나이고 lophn turn의 `toolCallList`에서 `app_create`와 `call`이 모두 `success`다 / route: `agentSessionList`의 AE session이 하나이고 그 session의 `receivedMessageList`가 메시지 하나(`from.kind`가 `agent`, `from.session`이 lophn session, `call`이 null이 아님)이며 `messageBody` 글이 `Build the todo list app.`다 / fake: journal이 3개이고 `mismatch`가 모두 null이다 | AGENT-ROLE L4, place-session("lophn이 앱을 등록하고 그 앱의 App Engineer에게 call로 맡긴다") |

   - lophn은 grant 줄이 없어도 AE를 부를 수 있어야 한다(효과 read의 기본은 `never`, `packages/protocol/approvals/grants.ts`의 `DEFAULT_ASK`). 코드로 읽은 값이다. 실제로 `waitPermission`이 뜨거나 call이 `not_allowed`로 닫히면 기본값을 고치지 말고 보고한다(제품 동작을 새로 정하는 일).
   - planner 검토: `lophn-app-create` task는 지우고 이 행으로 접었다(contract 하나에 test 하나). 이 행이 lophn의 `app_create`(앱이 등록되고 App Engineer 정의가 생긴다)와 그 뒤 call로 AE session이 열리는 것을 함께 본다. 앱 등록은 `appList`로 단정한다.
   - `call`이 `not_found`로 닫히면 두 tool이 요청 순서대로 돌지 않는 것(`app_create`가 끝나기 전에 이름을 풀었다)이므로 제품 bug 후보다. 보고한다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-roles`(Project Manager는 project마다, App Engineer는 앱마다 하나이고 사람이 더하거나 지우지 못한다), `agent-tools`(lophn이 `app.create`와 `call`을 쓴다), `router`(이름으로 App Engineer의 새 session을 연다).
- 현실적 회귀: 등록 때 정의 파일이 안 만들어져(project 등록은 같은 tx 안, 앱은 command 뒤 wiring) agent 정의가 비는 것, 사람이 built-in 이름의 Operator를 만들 수 있어 PM이 둘이 되는 것, lophn이 앱을 등록했는데 그 App Engineer를 call로 부르지 못하는 것.
- 왜 지금 test가 못 잡나: `ensure`의 unit은 파일 시스템 fake만 본다. 등록 command(storage tx) → wiring 후속 → 파일 → 정의 목록 route가 이어지는 것, 그리고 agent runtime child의 tool → core `app.create` → Router → 새 session → child의 새 turn은 process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/registration_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/registration_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- 위험 test: 없음(등록 행은 정의가 비는 회귀를, lophn 행은 앱 흐름의 입구를 본다. 데이터 손실 규칙은 아니다)

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(없으면 "없음")
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 찾은 제품 bug: 증상, 재현하는 행, 의심 file. 고쳤으면 "고치기 전 코드에서 그 행이 실패한 것"의 출력 한 줄
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
