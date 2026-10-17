# lophn-agent를 harness와 lophn domain으로 나누기

상태: 로드맵. 아직 계획(`plan/`)으로 열지 않았다. 열 때 이 문서를 계획 README의 재료로 쓴다.
배경 문서: `project-docs/architecture/layers.md`(층과 import 규칙, harness와 domain의 구분), `project-docs/architecture/agent-definition.md`.

## 왜

`packages/core/lophn-agent`(test 빼고 약 43,000줄)에는 성격이 다른 셋이 섞여 있다. 기준은 "lophn이 무엇을 하는 제품인지 알아야 하나"다.

| 성격 | 예 |
|---|---|
| 장치 (harness) | agent loop, tool calling(registry, schema 검사, 결과 전달, Gate 연결), prompt 조립 틀(층, 예산, cache marker), provider·model 호출 |
| 범용 능력 | file, shell, web, call, ask, MCP, skill |
| lophn domain | role(lophn, PM, App Engineer, Operator), role별 tool 목록과 prompt 내용, place 규칙, domain tool(ticket, release, problem, context, app, package, outline, operator, visual, guide, instructions) |

나누면 얻는 것:
- 빨리 변하는 agent 기술(provider, tool calling, caching)과 천천히 변하는 업무 규칙이 갈린다. harness를 갈아엎거나 외부 harness로 바꿔도 domain은 그대로다.
- domain tool 하나를 고칠 때 지금은 4~5곳(아래)을 고친다. 나누면 그 domain 폴더와 protocol 한 곳에서 끝난다.
- agent에게 주는 context가 작아진다. ticket 일은 `apps/tickets`만, loop 일은 업무를 몰라도 된다.
- 같은 domain 기능을 lophn agent(tool)와 coding agent(CLI)에 한 정의로 낼 수 있다.
- harness는 fake provider로, domain tool은 loop 없이 함수로 test한다.
- 층 규칙의 예외 둘(아래)을 다시 볼 자리가 생긴다.

## 지금 모양

### tool 하나가 정의되는 길

- `ToolDefinition`(`lophn-agent/tools/registry.ts`): `name`, `description`, `input`(zod), `effect`(read | write | external), `origin`(builtin | app | external), `handler(input, ctx)`, 선택 `gate(input, ctx)`. 옛 칸 `revision`, `confirm`, `contract`, `reversible`, `idempotent`이 아직 붙어 있다. 모양 자체는 domain을 모른다.
- `defineBuiltin`(`tools/bundles/common.ts`)이 옛 칸을 채우고 `contract = name`으로 두며, 입력 schema를 `TOOL_INPUTS[name]`에서 가져온다. domain과 묶이는 곳은 여기 하나다.
- bundle은 `tools/bundles/` 아래 파일 하나가 `*_TOOLS: ToolDefinition[]`를 내는 것이다. 17개 파일, 53개 tool, 1,509줄.
  - 범용 6개(17 tool, 298줄): file 7, shell 1, web 2, call 4, ask 1, skill 2.
  - domain 11개(36 tool, 1,141줄): ticket 6, problem 3, app 5, package 3, release 2, context 8, outline 3, operator 2, visual 1, guide 2, instructions 1.
- `tools/builtin.ts`의 `builtinTools()`가 17개 배열을 정적으로 import해 이어 붙인다. `listRoleTools(role, model)`이 role로 거르고 이미지 입력이 없는 model이면 `image.read`를 뺀다. `run-loop/prepare.ts`, `run-loop/runtime-access.ts`가 부른다.
- 앱의 app-api tool(`app__<app>__<api>`)은 `tools/app-tools.ts`, `app-toolkit.ts`가 활성 release 선언 ∩ agent grant로 동적으로 만든다. MCP tool은 `extensions/`가 만든다.

### domain tool은 port가 아니라 core route를 부른다

domain tool의 handler는 agent runtime child process에서 돈다. domain module을 in-process port로 부르지 않는다. `ctx.core: CoreCall`(agent credential로 core에 거는 HTTP loopback)에 protocol의 route 객체를 넘겨 부른다. 예: `ticket.create`의 handler는 `commandOf(ctx.core, ticketCreate, input, …)`(`run-loop/core-call.ts`)이고 `ticketCreate`는 `protocol/coding-agent/ticket/routes.ts`에 있다. 구현은 `core/apps/tickets/`의 route handler다.

domain tool 하나(예: App Engineer의 `ticket.foo`)를 더할 때 고치는 곳:
1. `protocol/lophn-agent/tool-catalog.ts`: 이름, `TOOL_INPUTS`, role 목록
2. `protocol/coding-agent/ticket/routes.ts`: route와 schema
3. `core/lophn-agent/tools/bundles/ticket.ts`: tool 정의
4. `core/apps/tickets/{commands,reads,register}.ts`: 구현
5. 필요하면 `core/lophn-agent/roles/app-engineer/prompt.md`, `run-loop/runtime-access.ts`의 `PLACE_READS`

`main/daemon/wiring/*`은 보통 고치지 않는다.

### role이 어떤 tool을 보는지 정하는 곳

`protocol/lophn-agent/tool-catalog.ts` 한 파일이다. `COMMON_TOOLS`(14), `WORK_TOOLS`(3, lophn 빼고), `READ_TOOLS`(20, 모두), `LOPHN_ONLY_READ_TOOLS`, `ROLE_WRITE_TOOLS`(lophn 1, app_engineer 9, project_manager 7, operator 0)를 `builtinToolNames(role)`이 합친다. `TOOL_INPUTS`가 `satisfies Record<BuiltinToolName, …>`라 tool을 더하면 이 중앙 파일을 꼭 고친다. role과 place 종류는 `protocol/lophn-agent/places.ts`(`ROLES`, `ROLE_PLACES`, `rolePlaceFits`)에 있다.

### harness 안에 있는 domain 지식

- `roles/`: `prompts.ts`(`rolePrompt`, `PRODUCT_INSTRUCTIONS`), `guides.ts`(guide 8개), role prompt md 4개(lophn 60, operator 41, app-engineer 70, project-manager 75줄), guide md 335줄.
- `agents/`: `builtin.ts`, `names.ts`, `app-engineer.ts`(앱 등록 때 App Engineer 생성), `resolve.ts`·`validate.ts`의 role 분기.
- `prompt-assembly/place-info.ts`(201줄): `ROLE_LABEL`, `visibleContexts(role, …)`, place 정보 글. `context-text.ts`(176줄): context 글.
- `prompt-assembly/turn-prompt.ts`(조립 틀)가 `roles/prompts.ts`의 `PRODUCT_INSTRUCTIONS`를 import한다. 틀 안의 domain 글이다.
- `commands/role-prompts.ts`: `NEW_APP_PROMPT`, `REPAIR_APP_PROMPT`, `CHECK_CONTRACTS_PROMPT`.
- `tools/domain/operator-place.ts`: Operator의 role→place 규칙.
- `places/`(559줄)는 place 규칙이 아니라 session 수명이지만 project·app 목록과 Operator 정보를 쓴다. `places/environment.ts`의 `installPlaceEnvironment`는 module 전역 mutable 상태다(AGENTS.md "전역 mutable 상태를 두지 않는다"와 어긋남).

### 범용 tool에 새는 domain

- file: `file/scope.ts`의 `resolveInPlace`가 place 폴더로 경로를 가둔다(`PlaceScope`). `file/write.ts`가 `session/rewind/record.ts`의 `recordBeforeWrite`를 부른다. `tools/bundles/file.ts`가 write·edit에 `instructionGate`를 달아 `LOPHN.md` 쓰기를 `settings_edit` intent로 만든다(`tool-judgment/intents.ts`).
- shell: `shell/run.ts`가 `ctx.scope.read[0]`을 cwd로 쓴다.
- web: 결과를 `lophn-untrusted` tag로 감싼다. 그 밖은 범용이다.
- questions(`tools/questions/`, 2,517줄, tools 중 가장 크다): 물음, 선택지 동작, 보호된 설정이 approvals·ledger domain과 얽혀 있다.
- call(`tools/call/`, 147줄): agent 사이 부름이라 Router와 role·place에 기댄다. Gate가 있다.
- MCP·skill(`extensions/`, 약 6,000줄): 범용 MCP·skill 로직과 place store, project 설정, project server가 섞여 있다.
- `ToolContext`(`tools/tool-context.ts`)가 `role`, `place`, `agent`, `scope`, `rewind`, `skills`, `router`를 싣는다. 사실상 SPI 입력인데 lophn 전용이다.
- `tools/runtime-permissions.ts`가 place 폴더, MCP server, socket으로 Deno 권한을 계산한다.

### 층 규칙의 예외와 숨은 의존

`tools/check-deps.ts`가 이름으로 허용하는 예외 둘:
- `projects>apps`(`CORE_DOMAIN_EDGES`): `core/projects/contexts/ledger/deps.ts`가 `apps/releases/store.ts`의 `loadActiveBlueprint`를 import해 app-api effect를 읽는다. writer·reader Worker가 이 파일을 직접 열어 wiring이 값을 넘길 길이 없다.
- `lophn-agent>projects`(`CORE_LAYER_EXCEPTIONS`): `lophn-agent/register.ts`가 `projects/contexts/mod.ts`의 `contextStatusOf`를 import한다. `agentLookups().contextStatus`로 쓰이고 `agents/validate.ts`가 agent의 context 목록을 검사할 때 부른다.

check가 못 보는 숨은 의존이 이미 있다: `lophn-agent/register.ts`의 `agentLookups`(`placeExists`, `places`, `activeContexts`)가 projects, apps, contexts 표를 SQL로 직접 읽는다. `layers.md`가 하지 말라는 꼴이다(`issues/mistakes.md`의 숨은 SQL 의존과 같은 종류).

### coding agent CLI와 겹침

`packages/coding-agent/cli/commands/*`는 6~21줄짜리 얇은 입구이고 이름→route 표는 `protocol/coding-agent/cli-commands.ts`(`CODING_CLI_COMMANDS`)다. 각 명령은 coding token으로 core route를 HTTP로 부른다(`connection/call.ts`의 `callRoute`). lophn tool과 같은 route 객체와 입력 schema를 쓰고 구현은 겹치지 않는다. 겹치는 것은 감싸는 쪽이다.

| CLI 명령 | 같은 route를 쓰는 lophn tool |
|---|---|
| `ticket list` | `ticket.list` |
| `ticket show` | `ticket.get` |
| `problem list` / `show` | `problem.list` / `problem.get` |
| `app show` | `app.get` |
| `app blueprint` | app-api tool, place 정보 |
| `package list` / `show` | `package.list` / `package.get` |

CLI에만 있는 것: `ticket claim/renew/report`, `message send`, `hook`, `app test/preview/status/logs/invocations`, `release prepare`, `problem more/diff`, harness 명령. lophn tool에만 있는 것: `ticket.create/update/verify/cancel`, `release.list/get`, context, outline, operator, visual, guide 전부.

### test

domain tool마다의 test 파일은 없다. domain route test(예: `core/apps/tickets/tickets_test.ts`)는 이미 domain에 있다. 옮겨질 수 있는 것: `tools/domain/operator-place_test.ts`, `tools/context/visible_test.ts`, `tools/app-api/*_test.ts`, `prompt-assembly/place-info_test.ts`, `context-text_test.ts`, `agents/resolve_test.ts`, `agents/commands_test.ts`, `places/places_test.ts`. 남는 것: `tools/registry_test.ts`, `tool-judgment/tool-gate_test.ts`, `file/scope_test.ts`, `shell/env_test.ts`, `web/target_test.ts`.

## 목표 모양

```
 core/main (composition root) ── 조립만
      │
      ▼
 problems ──▶ apps        projects            domain: 자기 agent tool 정의를 낸다 (agent-tool-spi)
      │         │             │
      ▼         ▼             ▼
 lophn role 층: role, place 규칙, role별 tool 목록, prompt·guide 내용, 앱 등록 때 App Engineer 만들기
      │
      ▼
 harness: loop, tool registry·호출·Gate 연결, prompt 조립 틀, provider·model, 범용 tool(file, shell, web, ask, MCP, skill)
      │
      ▼
 바닥: storage, events, server, supervision, ...
```

- harness는 role 이름, place 종류, domain route를 모른다. tool은 등록받은 목록으로만 안다.
- 각 domain module은 자기 agent tool 정의를 낸다. boundary-catalog의 `agent-tool-spi`(defined_by `agent-tools`, provided_by `projects`, `apps`, `problems`, used_by `run-loop`)가 이 계약이다.
- role 층이 "어느 role이 어느 tool을 보나", role prompt, guide, place 규칙을 갖고 harness에 넘긴다.

## 지켜야 할 것

- **tool 정의 파일은 agent runtime child에서 실린다.** Deno는 실행 때 tree shaking을 하지 않으므로(`layers.md` "실행 때 import가 뜻하는 것") domain의 tool 정의 파일이 그 domain의 store나 DB 코드를 import하면 agent runtime에 sqlite까지 딸려 간다. tool 정의 파일은 protocol(route, schema)과 harness SPI type만 import한다. 지금처럼 handler는 `ctx.core`로 route를 부른다.
- **import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.** (worker brief에 이 문장을 그대로 넣는다. `issues/mistakes.md`)
- 층 규칙(`layers.md`): module은 `core/main`을 import하지 않는다. 바닥은 위층을 import하지 않는다. harness는 domain을 import하지 않는다. domain끼리는 problems → apps만.
- protocol을 바꾸면 쓰는 쪽(lophn tool, coding agent CLI, shell)을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 동작은 바꾸지 않는다. agent가 보는 tool 이름, 입력, role별 목록, prompt 글이 나누기 전과 같아야 한다.

## 정할 것

1. **SPI 모양과 자리.** 후보: harness가 `defineTool`과 `ToolDefinition`(옛 칸을 뺀 것)을 내고, domain은 `agentTools(): ToolDefinition[]`를 낸다. 중앙 `TOOL_INPUTS`·`BuiltinToolName` 표를 해체할지, 이름 목록만 protocol에 남길지. `ToolContext`에서 lophn 전용 칸(`role`, `place`, `rewind`, `router`)을 어떻게 뺄지.
2. **role 층을 둘 module.** `lophn-agent` 안의 하위 폴더로 둘지, core 아래 새 module(가칭 `agents`)로 뺄지. 새 module이면 boundary-catalog와 module-catalog, check-deps의 층 순서가 바뀐다.
3. **lophn tool과 coding agent CLI를 한 정의로 낼지.** 둘은 이미 같은 route를 쓴다. tool 정의에서 CLI 명령을 만들면 감싸는 코드가 하나로 준다. 대신 CLI의 출력 꼴과 token 인증이 tool과 다르다.
4. **범용 tool의 자리와 그 안의 domain.** `LOPHN.md` 쓰기 Gate, rewind 기록, place 폴더 가두기를 harness의 hook으로 뺄지(예: write 전 hook, scope 공급자). questions(2,517줄)와 extensions(약 6,000줄)는 이번 범위에 넣을지 뒤로 미룰지.
5. **credential operation 이름.** `defineBuiltin`이 `contract = name`이라 agent credential의 operation 목록에 tool 이름(`ticket.create`)이 들어가는데 route 이름은 다르다(`CreateTicket`). core의 agent credential 검사가 둘을 어떻게 잇는지 아직 확인하지 않았다. SPI를 짜기 전에 확인한다.
6. **층 예외 둘과 `register.ts`의 SQL.** `contextStatusOf`와 `agentLookups`의 SQL은 role 층이 projects·apps에서 받을 port로 바꿀 수 있는지. `projects>apps`는 Worker가 직접 여는 파일이라 이 분리와 따로 볼지.

## 단계

각 단계는 `deno task check`를 통과하고 동작이 같은 채로 끝난다.

0. **확인.** 정할 것 5(credential operation)를 코드로 확인한다. 범위(정할 것 4)를 정한다.
1. **SPI 도입, 옮기지 않음.** registry가 domain이 넘긴 tool 목록을 받게 바꾼다. `builtin.ts`의 정적 import 17개를 조립(composition root) 쪽으로 옮긴다. 옛 칸을 지운다.
2. **domain tool을 domain으로.** bundle을 domain module 아래로 옮긴다: ticket·app·package·release·visual → `apps`, problem → `problems`, context·outline → `projects`. operator·guide·instructions는 role 층으로. domain마다 한 task.
3. **role 층.** `tool-catalog.ts`의 role별 목록, `places.ts`의 role·place 규칙, `roles/`, `agents/`의 role 분기, `place-info.ts`·`context-text.ts`의 role 규칙, `commands/role-prompts.ts`, `PRODUCT_INSTRUCTIONS`를 role 층으로 모은다. `turn-prompt.ts`는 글을 인자로 받는다.
4. **범용 tool의 domain hook.** `LOPHN.md` Gate, rewind 기록, place 가두기를 harness hook으로 바꾸고 role 층이 채운다.
5. **예외와 숨은 SQL.** `register.ts`의 `contextStatusOf` import와 `agentLookups` SQL을 port로 바꾸고 check-deps 예외를 지운다. 못 끊으면 예외로 남기고 이유를 `layers.md`에 쓴다.
6. **문서.** `layers.md`(그림, 예외, harness와 domain 표), `agent-definition.md`, boundary-catalog(`agent-tool-spi`의 provided_by에 role 층 더하기, 목표 모양 주석 지우기), module-catalog를 고친다. changelog 열린 판에 항목을 덧붙인다.

## 끝남 기준

- harness 폴더의 non-test 파일에서 `protocol/apps`, `protocol/problems`, `protocol/projects`, `protocol/coding-agent` import가 0. role 이름 문자열(`project_manager`, `app_engineer`, `operator`)이 0. check로 만들 수 있으면 `tools/check-deps.ts`에 규칙으로 넣는다.
- `tools/check-deps.ts`의 `CORE_LAYER_EXCEPTIONS`가 비거나, 남은 것마다 `layers.md`에 이유가 있다.
- `lophn-agent/register.ts`(또는 그 후계)에 다른 module 표를 읽는 SQL이 0.
- domain tool 하나를 더할 때 고치는 곳이 그 domain 폴더와 protocol의 route 한 곳, role 층의 목록 한 줄.
- agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같다(`tools/registry_test.ts`가 role별 목록을 본다).

## 관련 이슈

- `issues/agent-definition.md`: `wrapUntrusted` 둘, cache marker, SeenBasis diff notice.
- `issues/mistakes.md`: 숨은 SQL 의존.
- `issues/place-session.md`: agent runtime의 Deno 권한에 place 폴더가 없다(place 규칙이 role 층으로 오면 거기서).
- 이미 닫힘(이슈 결정 적용 계획): deferred tool, App Engineer active context 읽기, reaction 문구와 "Its fields are data.", 앱 Operator의 앱 source 읽기.

## 하지 않는 것

- harness를 외부 라이브러리로 바꾸지 않는다. 나누는 것까지만 한다.
- tool 이름, 입력, prompt 글을 고치지 않는다(동작이 같아야 비교할 수 있다). 고칠 것은 나눈 뒤 따로 한다.
- coding agent CLI 정리(정할 것 3)를 고르지 않으면 CLI는 건드리지 않는다.
