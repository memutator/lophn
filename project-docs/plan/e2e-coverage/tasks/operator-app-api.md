# operator-app-api

사람이 project에 Operator를 만들고 앱을 할당하면 Operator의 model 요청에 그 앱의 app-api가 tool로 보이고, 부르면 core를 지나 앱 process가 실행하고 invocation이 남는다. 사람이 뺀 app-api는 요청에 없고, "물음"으로 둔 app-api는 사람의 결정 전에 실행되지 않는다. `tests/e2e/operator_test.ts`를 만들고 첫 행 넷을 둔다.

- 단위: operator (wave 3)
- 선행: test-app, reply-fn. 앱을 activate하는 helper와 함수 대답·줄을 쓴다(`test-app`이 `reply-fn`을 이미 선행으로 가지지만 이 file도 직접 쓴다).
- 소유(이 task만 고친다):
  - `tests/e2e/operator_test.ts`
- 추가 소유(제품 bug를 찾아 고칠 때만. 이 path가 아닌 곳을 고쳐야 하면 먼저 보고한다):
  - `packages/core/lophn-agent/tools/app-api/`
  - `packages/core/lophn-agent/tools/app-tools.ts`
  - `packages/core/lophn-agent/tools/app-toolkit.ts`
  - `packages/core/lophn-agent/run-loop/prepare.ts`
- 읽을 것:
  - `project-docs/plan/e2e-coverage/README.md` 전체(특히 "정한 것" 3·9~11, 지켜야 할 것), `project-docs/plan/e2e-coverage/research/candidates-docs.md` §1(Operator와 agent grant), `project-docs/architecture/testing.md`(case 고르는 규칙 9개)
  - 이 계획의 `tasks/test-app.md`("내놓는 것": `activateTestApp`, `TestApp`), `tasks/reply-fn.md`(함수 대답, 줄, `probe.ts`), `tasks/app-call.md`(같은 template 앱, `agentGrantsSet {kind: "app", app, apis: []}` 꼴, `appInvocations` 단정)
  - `project-docs/products/AGENT-ROLE.md`의 O1, H3(앱은 앱 단위로 할당하고 app-api마다 빼거나 묻는지를 바꾼다)
  - architecture: `project-docs/architecture/app-call.md`("agent에게는 app-api가 tool로 보인다", "Gate의 사람 대기는 write 줄에 서기 전에 끝낸다", "Gate 등에 막힌 호출(denied)은 남긴다"), `project-docs/architecture/agent-definition.md`("tool 목록은 session을 시작할 때 고정한다"), `project-docs/architecture/approval.md`(agent grant는 사람이 정한다, 기본 묻기는 효과에서 나온다: write는 묻지 않음)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-tools`, `approvals`, `app-runtime`, `agents`, `run-loop`
  - 코드: `packages/protocol/approvals/grants.ts`(`agentGrantsSet`: 입력 `{agent, entries}`. 앱 entry는 `{kind: "app", app, apis: [{api, setting: "excluded" | "never" | "ask"}]}`이고 `apis`에는 사람이 바꾼 것만 든다), `packages/protocol/lophn-agent/agent-definitions.ts`(`operatorCreate`: 입력 `{id: agt id, place: {kind: "project" | "app", id}, definition}`, actors user·agent), `packages/protocol/lophn-agent/operators.ts`(`operatorDefinitionSchema`: `name`과 `body`가 핵심이고 grant는 정의에 없다), `packages/protocol/lophn-agent/places.ts`(`agentRefSchema`: Operator는 `{role: "operator", agent: <agt id>}`), `packages/core/lophn-agent/tools/app-tools.ts`(`buildAppApiTools`: 앱 ∩ 선언 ∩ grant), `tools/app-api/missing.ts`(`grantAllows`, `appApiMissingReason`), `tools/app-api/name.ts`(tool 이름 `app__<app id>__<api>`), `tools/wire.ts`(`MISSING_TOOL_MESSAGES`), `run-loop/prepare.ts`(session의 첫 turn이 tool 목록을 고정한다: `fixedBySession`), `packages/protocol/apps/calls/invocation.ts`(`appInvocations`: `app`, `session`, `effect`, `status`로 거른다. 성공한 read는 남지 않는다), `packages/protocol/lophn-agent/tool-calls.ts`(`toolCallList`: `outcome.kind`)
  - main의 `tests/e2e/approval_test.ts`(`waitPermission`→`decide`→`waitTurnEnd`→`toolCallList` 흐름과 머리 주석 꼴), `tests/e2e/file-write_test.ts`
  - `.claude/skills/write-test/SKILL.md`, AGENTS.md "속도"
- 계약:
  - 쓰는 것: `tests/support/core/{mod,process,human,try-boot}.ts`(`createRun`, `bootCore(run, {settings, env})`, `Core.call/tryCall/kill/stop/ids`, `connectFakeProvider`, `openProject`, `openSession`, `say`, `turnsOf`, `waitTurnEnd`, `waitPermission`, `decide`, `settle`, `until`), `tests/support/fake-server/mod.ts`(`startFakeServer`, `FakeServer.script(steps, lane?)`, `reset`, `journal`, 함수 대답, `JournalEntry.lane`)와 `probe.ts`(`toolNames`, `lastToolResult`, `lastUserText`, `idIn`), `tests/support/app/`(`test-app`이 내놓는 `activateTestApp`, `TestApp`), `bootCore(run, { env: await appCoreEnv() })`(`coding-role`의 `tests/support/coding/deps.ts`), `operatorCreate`, `agentGrantsSet`, `appCallApi`·`appInvocations`·`appRuntime`(`packages/protocol/apps/mod.ts`), `toolCallList`. **support brief의 이름으로 맞춘다**: support 이름은 이 계획의 `reply-fn`, `test-app`, `coding-role` brief에서 옮긴 것이다. 만들어진 뒤 달라졌으면 main의 `tests/support/`가 맞다.
  - 내놓는 것: `tests/e2e/operator_test.ts`와 그 안의 준비(아래). 뒤 task(`operator-grants`, `operator-project-write`)가 같은 file의 table에 행만 더한다. 새 support helper는 없다.

## 이 file의 준비(이 task가 만들고, 뒤 task는 다시 쓰지 않고 행만 더한다)

`Deno.test` 하나, core 하나, 앱 하나, project 하나. 행마다 새 Operator와 새 session을 쓴다.

1. `createRun` → `startFakeServer` → `bootCore(run, { env: await appCoreEnv() })` → `connectFakeProvider`.
2. project 폴더 `<run.work>/proj`를 만들고(`approval_test.ts`처럼) `openProject`. 앱을 activate하기 전에 연다. project 폴더나 앱 source를 더하면 agent runtime child가 다시 뜨고 그 사이 시작한 turn이 끊긴다(`settle`).
3. `activateTestApp(core, fake, { name, slug })` → `TestApp`. template 앱의 app-api는 `list_items`(read, 입력 없음)와 `add_item`(write, 입력 `{title}`)이다(`packages/core/apps/packages/template/app/blueprint.ts.tmpl`). activation helper가 건 줄과 대답은 끝났다. `fake.reset()`으로 줄과 journal을 비운 뒤 행을 시작한다. activation helper의 fake 대답은 README "정한 것" 11의 예외이고 행의 대답에 세지 않는다.
4. file 안에 helper 하나만 둔다(support에 두지 않는다. 행의 준비를 한 곳에 모으는 것이다).
   ```ts
   // 행 하나의 준비. 단계 한 개로 센다.
   operatorWith(core, { project, name, entries? }): Promise<{ agent: string; session: string }>
   // operatorCreate {id: core.ids.newId("agt"), place: {kind: "project", id: project}, definition: {name, body: ""}}
   // → entries가 있으면 agentGrantsSet {agent: {role: "operator", agent}, entries}
   // → openSession(core, {role: "operator", agent})
   ```
   `definition`에 `profile`이 필요한지는 `operatorCreate`를 한 번 불러 본다(`checkOperator`가 `invalid_input`의 details로 알려 준다).
5. app tool의 wire 이름은 `app__<app id>__<api>`다. 이름이 64자(`TOOL_NAME_MAX`)를 넘거나 wire 문자 밖이면 hash가 붙는다. 이 앱 id로는 넘지 않는지 한 번 확인한다. 요청에서 tool을 고를 때는 `toolNames(request)`에서 `__add_item`·`__list_items`로 끝나는 이름을 쓴다.
6. 시간: 이 file은 앱 activation이 가장 오래 든다(`app-release_test`와 같은 몫). 한 번 도는 시간을 보고에 적는다(README "정한 것" 3의 5분 예산).

## 할 일

1. 위 준비로 `tests/e2e/operator_test.ts`를 만든다. 머리 주석에 세 질문을 한 줄씩 남긴다(아래). 뒤 task가 자기 행의 질문을 더한다.
2. 행 넷. 행 안에서 앱에 쓰는 title은 행마다 다른 글(`op-first`, `op-excluded`, `op-held`, `op-user`, `op-allowed`)이라 앞 행이 남긴 row가 단정을 흐리지 않는다.

| 행 | route 순서 | fake 대답 | 단정(서로 다른 곳) | 근거 |
|---|---|---|---|---|
| `app-api` | `operatorWith`(entries `[{kind: "app", app, apis: []}]`) → `say` → `waitTurnEnd` → `appInvocations({app, session})` → `appCallApi`(user) `list_items` | ① 함수: 요청의 `toolNames`에서 `__add_item`으로 끝나는 tool을 골라 `<그 이름> {title: "op-first"}` ② text | fake: 첫 요청 `tools[]`의 앱 tool이 정확히 `__list_items`와 `__add_item` 둘이다(앱 ∩ 선언 ∩ grant) / ledger: `appInvocations({app, session})`에 write 하나, caller가 agent(이 session)이고 `succeeded`이며 changeset이 붙어 있다 / app state: `list_items` 결과에 `op-first`가 있다 | O1. 후보 `operator-app-api` |
| `excluded` | `operatorWith`(entries `[{kind: "app", app, apis: [{api: "add_item", setting: "excluded"}]}]`) → `say` → `waitTurnEnd` → `appInvocations({app, session})` + `toolCallList({session})` → `appCallApi`(user) `list_items` | ① tool `app__<app id>__add_item {title: "op-excluded"}`(요청에 없는 이름을 model이 그래도 부른다. 이름은 test가 `app__${app}__add_item`으로 만든다) ② text | fake: 첫 요청 `tools[]`에 `__list_items`는 있고 `__add_item`은 없다(사람이 뺀 app-api는 요청에 아예 없다) / ledger: `appInvocations({app, session})`가 비어 있고(호출이 core에 닿지 않았다) `toolCallList`의 그 call이 성공이 아니다. 둘째 요청의 tool_result는 `unknown_tool`로 실패한다 / app state: `list_items`에 `op-excluded`가 없다 | H3. 후보 문서는 "not_found로 막힌다"고 썼으나 코드는 tool 단계의 `unknown_tool`이다(아래 "정한 것") |
| `ask-reject` | `operatorWith`(entries `[{kind: "app", app, apis: [{api: "add_item", setting: "ask"}]}]`) → `say` → `waitPermission` → `decide`(reject) → `waitTurnEnd` → `appInvocations({app, session})` + `appCallApi`(user) `list_items` | ① 함수: `__add_item` tool `{title: "op-held"}` ② text | ledger: 이 session의 invocation 하나가 `denied`이고 changeset이 없다(Gate가 막은 호출도 기록에 남는다) / app state: `list_items`에 `op-held`가 없다 / fake: 둘째 요청의 tool_result가 앱의 응답(새 row)이 아니다(거절이 agent에게 간다) | H3. write의 기본은 "묻지 않음"이라 `ask`는 사람이 고른 것이다 |
| `ask-allow` | `operatorWith`(위와 같은 entries) → `say` → `waitPermission` → `appCallApi`(user) `add_item {title: "op-user"}` → `decide`(allow) → `waitTurnEnd` | ① 함수: `__add_item` tool `{title: "op-allowed"}` ② text | app state: 허락 대기 중에 사람 화면의 write(`op-user`)가 막히지 않고 돌아왔고, 끝난 뒤 `list_items`에 `op-user`와 `op-allowed`가 모두 있다 / ledger: agent의 write가 `succeeded`이고 changeset이 붙어 있으며 caller가 이 session이다 / fake: 둘째 요청의 tool_result에 앱의 응답(새 row)이 있다 | app-call "Gate의 사람 대기는 write 줄에 서기 전에 끝낸다". 사람이 답하는 동안 앱의 write를 막지 않는다 |

3. 행마다 fake 대답 2개, 단정 3개, 단계 6 이하다(`operatorWith`와 `waitPermission` 한 번씩이 한 단계). 읽기(`appInvocations`, `toolCallList`, `list_items`)는 단정의 재료다.
4. 어긋난 단정이 제품 bug로 보이면 test를 맞추지 않는다. 고치기 전 코드에서 그 행이 실패하는 것을 먼저 확인하고(출력 한 줄을 보고에 적는다) 추가 소유 안에서만 고친다. `packages/core/approvals/`나 `packages/core/apps/calls/`처럼 다른 task가 소유한 곳이 원인이면 고치지 말고 보고한다. 크거나 제품 동작을 새로 정해야 하면 고치지 말고 "사람에게 물을 것"으로 보고한다(README "정한 것" 8).
5. 정한 것(문서에 답이 없어 이 brief가 정한 것):
   - `excluded` 행의 단정은 코드가 하는 일(`unknown_tool`)에 맞춘다. 사람이 뺀 app-api가 처음부터 요청에 없으면 model이 불러도 "그런 tool 없음"이다. session 도중 grant에서 빠진 경우(`removed_from_grant`)는 이 task의 행이 아니다.
   - `ask-*` 행은 `waitPermission`이 돌려준 request가 이 session의 허락 request인지 본다. tool_result의 글은 단정하지 않고 앱의 응답이 있는지 없는지만 본다.

## 세 질문(test 머리 주석에 한 줄씩 남긴다)

- contract: boundary ID `agent-tools`·`app-runtime`(앱 ∩ release 선언 ∩ agent grant만 tool이 되고 호출은 core를 지나 기록된다), `approvals`(사람이 뺀 것은 요청에 없고 묻기로 한 것은 결정 전에 실행되지 않는다).
- 현실적 회귀: grant를 풀 때 `excluded`가 무시되어 뺀 app-api가 요청에 남는 것, 할당하지 않은 앱이나 선언에 없는 app-api가 tool이 되는 것, "물음"인데 허락 전에 write가 실행되는 것, 사람이 답하는 동안 앱의 write 줄이 막히는 것.
- 왜 지금 test가 못 잡나: `app-tools`와 `missing`의 unit은 grant와 선언의 조합 함수만 본다. 사람의 `agent_grants/set`이 저장되고, agent runtime child가 읽고, model 요청에 실리고, 호출이 core를 지나 앱 process에서 실행되는 왕복은 process를 건너야 한다.

## 지켜야 할 것(계획 공통, README 그대로)

- `testing` README의 "지켜야 할 것"을 그대로 따른다: `~/.lophn`·OS keychain·사람의 전역 harness 설정을 건드리지 않음, 진짜 model provider를 부르지 않음, 전역 mutable 상태·고정 port·고정 path 없음, sanitizer를 끄지 않음, sleep으로 기다리지 않음, support에는 띄우기와 연결만, case 하나는 단계 6·fake 대답 3·단정 3 이하(README "정한 것" 11의 예외만), 화면 문구는 단정하지 않음, protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고침, 다른 module의 표를 SQL로 직접 읽지 않음.
- 제품에 test 전용 flag나 지름길을 넣지 않는다. 앱은 제품의 길(`apps/create` → `apps/connect_source` → App Engineer의 ticket → coding agent의 claim·release prepare → `ticket.verify` → activation)로만 띄운다. data root에 release를 직접 깔지 않는다.
- coding token은 Gateway `coding_terminal` frame으로만 받는다. test가 token을 만들거나 core 안에서 꺼내지 않는다.
- 행을 더하는 task는 그 file의 준비(core 띄우기, fake 연결)를 다시 쓰지 않고 table에 행만 더한다.

## 끝남

- `deno task check`가 통과한다.
- `tests/e2e/operator_test.ts`을 10번 연속 통과한다(`for i in $(seq 10); do deno test --allow-all --no-check tests/e2e/operator_test.ts || break; done`). 끝난 뒤 `pgrep -af 'core/main/daemon/main.ts'`가 0줄이고 `.dev-data/e2e/` 아래 run 폴더가 남지 않는다.
- `unshare -rn sh -c 'ip link set lo up && deno test --allow-all --no-check tests/e2e/operator_test.ts'`가 통과한다(README "정한 것" 10. 이 환경에서 안 되면 이유를 보고에 적는다).
- 위험 test: "Operator에 할당한 app-api만 tool이 되고, 사람이 뺀 것은 요청에 없으며, 묻기로 한 write는 사람의 결정 전에 실행되지 않는다"

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

