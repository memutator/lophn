# role-layer-tools

새 core module `packages/core/agent-roles`(role 층)를 만들고, role이 보는 tool을 정하는 것을 모두 거기로 모은다: role별 tool 목록(`tool-catalog.ts`에서), role 규칙이 든 tool 넷(guide·settings, instructions, operator, context·glossary), role별 credential 상한, 앱 등록 때 built-in agent 정의를 만드는 `agents/ensure.ts`·`agents/app-engineer.ts`. harness는 role 층을 import하지 않으므로 harness가 쓰던 role 목록은 인자로 받게 바꾼다.

- 단위: role-layer (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/lophn-agent/{tool-catalog.ts,tool-catalog_test.ts}`
  - `packages/core/agent-roles/`
  - `packages/core/lophn-agent/tools/bundles/{guide,instructions,operator,context}.ts`
  - `packages/core/lophn-agent/tools/context/`
  - `packages/core/lophn-agent/tools/domain/{operator-place.ts,operator-place_test.ts}`
  - `packages/core/lophn-agent/agents/{ensure.ts,app-engineer.ts,layers.ts,resolve.ts,resolve_test.ts,mod.ts}`
  - `packages/core/lophn-agent/session/compactor.ts`
  - `packages/core/lophn-agent/run-loop/{prepare.ts,runtime-access.ts,runtime.ts,agent-credentials.ts,mod.ts}`
  - `packages/core/main/agent-tools_test.ts`
  - `packages/core/main/agent-runtime/{main.ts,product-driver.ts}`
  - `packages/core/main/daemon/wiring/{lophn-agent.ts,lophn-agent-registration.ts,lophn-agent-runtime.ts}`
- 읽을 것:
  - architecture: `project-docs/architecture/layers.md`("harness와 lophn domain"), `project-docs/architecture/agent-definition.md`("role의 tool 목록은 코드가 고정하고…", "Operator 정의를 만들고 고치는 tool은 grant를 주지 못한다")
  - roadmap: `project-docs/products/roadmap/harness-domain-split.md`("role이 어떤 tool을 보는지 정하는 곳", "harness 안에 있는 domain 지식", "단계" 3번)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `agent-roles`, `agent-tools`, `project-docs/module-catalog.yaml`
- 계약:
  - 쓰는 것: `harness-spi-*`가 낸 `tools/spi.ts`, `defineTool`, `selectTools`, `agentTools()`(`main/agent-tools.ts`), `roleOperations`의 base 부분. lead가 이 task 전에 module-catalog·boundary-catalog·`tools/check-deps.ts`에 `agent-roles`를 등록해 둔다(없으면 check가 새 폴더에서 실패한다). `agent-roles`는 `lophn-agent`(harness)와 protocol, base를 import할 수 있고 domain(`apps`·`problems`·`projects`)은 import하지 않는다.
  - 내놓는 것 (`packages/core/agent-roles/`):
    - `tool-lists.ts`: `TOOL_ORDER`, `builtinToolNames(role): readonly string[]`(옛 `tool-catalog.ts`의 role 목록 그대로).
    - `tools/mod.ts`: `ROLE_AGENT_TOOLS: readonly ToolDefinition[]`(guide.read, settings.get, instructions.read, operator.create·update, context.list·get·search·violations·test·draft·submit, glossary.set = 13개).
    - `credentials.ts`: `roleOperations(role, tools)`(harness의 base 상한 + role 몫), `agentConditions(...)`(App Engineer의 `app` 조건).
    - `agents/ensure.ts`, `agents/app-engineer.ts`: 옛 `lophn-agent/agents/`의 `ensureLophn`·`ensureProjectManager`·`ensureAppEngineer`·`withAppEngineer`.
    - harness가 받는 인자: `PreparerDeps.roleTools(role): readonly string[]`, `resolveAgent`·`resolveTurnAgent` 입력의 `tools: readonly string[]`, `createAgentCredentialLink`의 `operationsFor`·`conditionsFor`, `agentRuntimePolicies(routes, agentOperations)`(이 인자는 모든 role의 상한 합집합).
    - `protocol/lophn-agent/tool-catalog.ts`에는 `toWireToolName`, 이름 규칙 상수만 남는다.

## 정한 것: role 층의 module 경로와 boundary 이름

- 경로 `packages/core/agent-roles`, boundary ID `agent-roles`. 근거: (1) boundary-catalog에 이미 `agent-roles`("role마다의 prompt, tool 범위, 명령")가 있다. 그 정의가 이 층의 내용과 맞다. 지금은 `lophn-agent`의 자식인데 최상위 module로 올리면 된다. (2) 로드맵의 가칭 `agents`는 이미 있는 boundary `agents`("place에 놓인 agent와 그 설정")와 겹친다. (3) `lophn-agent` 안의 하위 폴더로 두면 `tools/check-deps.ts`가 harness와 role 층을 path로밖에 못 가른다(README 정한 것 2).
- 소유가 아니라 lead가 한다: boundary-catalog(`agent-roles`를 `lophn-agent`의 자식에서 최상위로, `agent-tool-spi`의 `provided_by`에 더하기), module-catalog 줄, `tools/check-deps.ts`의 층 목록(여기서는 `agent-roles`를 바닥으로 세지 않기만 한다. 규칙 전체는 `layer-checks`).

## 정한 것: context tool이 projects가 아니라 role 층으로 간다

README의 `domain-tools-projects`(context·outline)는 열지 않는다. 코드를 보니 (1) `outline` tool은 이미 없다. (2) context tool은 role 규칙 그 자체다: `tools/context/visible.ts`의 `contextVisible`이 role마다 보이는 context를 가르고(`lophn`은 전부, `project_manager`는 자기 project, `app_engineer`는 자기 앱의 project, `operator`는 붙은 것), `bundles/context.ts`의 `visibleRows`가 role로 project 목록을 만든다. (3) `run-loop/place-data.ts`의 `readContext`와 `prompt-assembly`의 `renderContextText`를 부른다. 둘 다 harness 안쪽이라 `projects`의 tool file이 import하면 "protocol과 harness의 tool type만 import" 규칙을 어긴다. 그래서 context·glossary tool은 operator·guide·instructions와 같이 role 층의 tool이다. `agent-tool-spi`의 `provided_by`는 `apps`, `problems`, `agent-roles` 셋이다(`projects`는 빠진다).

## 할 일

근거: README `role-layer` 단위, roadmap "단계" 3번, 위 "정한 것".

1. snapshot을 뜬다(이전 task의 `.tmp-probe/dump.ts`와 같은 script. 끝에 같은 결과여야 한다). 끝낼 때 script를 지운다.
2. `tools/move-files.ts`로 옮긴다.
   - `lophn-agent/tools/bundles/{guide,instructions,operator,context}.ts` → `agent-roles/tools/`
   - `lophn-agent/tools/context/` 전체(`draft.ts`, `search.ts`, `visible.ts`, `visible_test.ts`) → `agent-roles/tools/context/`
   - `lophn-agent/tools/domain/operator-place.ts`와 `_test.ts` → `agent-roles/tools/`
   - `lophn-agent/agents/ensure.ts`, `agents/app-engineer.ts` → `agent-roles/agents/`
   - `agent-roles/tools/mod.ts`를 만들어 네 목록을 `ROLE_AGENT_TOOLS`로 모은다. 옮긴 file은 harness를 `lophn-agent/tools/spi.ts`와 필요한 harness 안쪽 file(`run-loop/place-data.ts`, `prompt-assembly/`, `tool-judgment/intents.ts`, `instructions/read.ts`, `roles/guides.ts`)에서 import한다. role 층이 harness를 import하는 것은 규칙대로다. 이 안쪽 file들은 뒤 task(`role-layer-prompts`, `role-layer-place`)가 role 층으로 옮긴다.
3. `main/agent-tools.ts`가 옛 네 bundle을 import하던 줄을 `ROLE_AGENT_TOOLS` import 한 줄로 바꾼다(소유 밖이지만 이 줄만 고친다. `domain-tools-apps`도 같은 file의 다른 줄을 고친다. lead가 rebase에서 합친다).
4. `protocol/lophn-agent/tool-catalog.ts`의 role 목록(`COMMON_TOOLS`, `WORK_TOOLS`, `READ_TOOLS`, `LOPHN_ONLY_READ_TOOLS`, `ROLE_WRITE_TOOLS`)과 `TOOL_ORDER`, `builtinToolNames`를 `agent-roles/tool-lists.ts`로 옮긴다. `tool-catalog_test.ts`의 wire 이름·충돌 검사는 `agent-roles/tool-lists_test.ts`로 옮긴다. 쓰는 곳을 고친다: `main/agent-tools.ts`(`TOOL_ORDER`), `main/agent-tools_test.ts`, `agents/resolve_test.ts`.
5. harness가 role 목록을 인자로 받게 한다. `grep -rn "builtinToolNames" packages --include=*.ts`로 모든 쓰는 곳을 센다.
   - `agents/resolve.ts`: `tools: [...builtinToolNames(role)]`를 입력의 `tools`로. `agents/layers.ts`(`resolveTurnAgent`), `session/compactor.ts`, `run-loop/prepare.ts`가 그 값을 넘긴다. `run-loop/prepare.ts`의 `PreparerDeps`에 `roleTools(role)`을 더하고 `selectTools(deps.roleTools(role), …)`를 쓴다. `main/agent-runtime/product-driver.ts`가 `builtinToolNames`를 꽂는다. `session/compactor.ts`의 deps도 같은 방식이다.
   - `agents/resolve_test.ts`가 `tools`를 넘기도록 고친다.
6. credential의 role 몫을 옮긴다. `run-loop/runtime-access.ts`에 harness 몫만 남긴다(`RUNTIME_MACHINE_ROUTES`, `RUNTIME_MACHINE_OPERATIONS`, `EXTERNAL_TOOL_OPERATIONS`, `HUMAN_WAIT_ROUTES`, tool들의 `runOperations`). role 몫(`PLACE_READS`, `REWIND_WRITE_TOOLS`와 rewind route 더하기, `app_engineer`의 `annotationsGet`, `ROLES`로 role 검사)을 `agent-roles/credentials.ts`의 `roleOperations(role, tools)`로 옮긴다. `run-loop/agent-credentials.ts`의 `agentConditions`(App Engineer의 `app` 조건)는 `agent-roles/credentials.ts`로 옮기고 `createAgentCredentialLink`는 `operationsFor`(이미 있다)와 `conditionsFor`를 인자로 받는다. `run-loop/runtime.ts`의 `agentRuntimePolicies(routes, agentOperations)`는 role 합집합을 인자로 받고, 그 안에서 `createAgentCredentialLink`를 만드는 `startAgentRuntimeChild`는 `operationsFor`, `conditionsFor` 옵션을 받아 넘긴다. 조립(`main/agent-runtime/main.ts`, `main/daemon/wiring/lophn-agent-runtime.ts`)이 `roleOperations`와 합집합(`ROLES.flatMap`)을 만들어 넘긴다. 이 task의 credential 값은 `harness-spi-registry` 뒤 값과 같아야 한다(role별 operation 목록을 먼저 찍어 대조).
7. `main/daemon/wiring/lophn-agent.ts`, `lophn-agent-registration.ts`의 `agents/ensure.ts`·`agents/app-engineer.ts` import를 새 경로로(`move-files.ts`가 고친다). `agents/mod.ts`의 `ensure*` 재내보내기를 지운다.
8. `main/agent-tools_test.ts`가 새 위치의 `builtinToolNames`를 쓰도록 고친다.
9. (lead가 더함) `packages/core/agent-roles/.gitkeep`을 지운다. lead가 catalog check(`check-modules`는 catalog의 path가 있어야 통과한다)를 위해 둔 빈 file이다. module-catalog·boundary-catalog·`tools/check-deps.ts`의 `agent-roles` 등록은 lead가 이미 했다(`agent-roles`는 `lophn-agent`를 import할 수 있고, `lophn-agent`·바닥은 `agent-roles`를, `agent-roles`와 domain은 서로를 import하지 못한다).

## 끝남

- `deno task check`가 통과한다.
- 동작 비교: 1번의 snapshot 전후가 같다(role별 tool 이름, 순서, 설명, 입력 schema, Gate 유무). `main/agent-tools_test.ts`(role 목록↔정의 일치, `CreateTicket` operation)와 `agents/resolve_test.ts`가 통과한다. role별 `roleOperations` 값이 전후로 같다.
- 위험 test: 없음 (옮기기와 인자로 바꾸기뿐이다. 위 두 test가 지킨다)
- 남지 않음:
  - `grep -rn "builtinToolNames\|TOOL_ORDER" packages --include=*.ts`에서 `packages/protocol`, `packages/core/lophn-agent` 줄이 0이다.
  - `grep -rn "agent-roles" packages/core/lophn-agent --include=*.ts`가 0줄이다(harness가 role 층을 import하지 않는다).
  - `ls packages/core/lophn-agent/tools/bundles/`에 `guide.ts instructions.ts operator.ts context.ts`가 없다. `packages/core/lophn-agent/tools/context/`가 없다.
  - `grep -rn "app_engineer\|annotationsGet\|PLACE_READS" packages/core/lophn-agent/run-loop/runtime-access.ts packages/core/lophn-agent/run-loop/agent-credentials.ts`가 0줄이다.

## 지켜야 할 것(계획 README)

- 동작을 바꾸지 않는다. agent가 보는 tool 목록과 입력이 role마다 나누기 전과 같아야 한다(`tools/registry_test.ts`가 role별 목록을 본다).
- tool 정의 file은 agent runtime child에서 실린다. domain의 store나 DB 코드를 import하지 않는다(`layers.md` "실행 때 import가 뜻하는 것").
- import를 지우려고 다른 module의 표를 SQL로 직접 읽지 않는다. 못 끊으면 `tools/check-deps.ts` 예외로 드러낸다.
- protocol을 바꾸면 쓰는 쪽을 같은 변경에서 고친다. `v2`나 옛 이름 읽기를 두지 않는다.
- 옮기기는 `tools/move-files.ts`로 하고 import를 기계적으로 고친다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: module-catalog, boundary-catalog(`agent-roles` 최상위, `agent-tool-spi`의 provided_by), `main/agent-tools.ts`의 import 줄(이 task가 고친 것)
- 안 쓰게 된 export: 없음
- 정한 것: 위 두 가지 말고 worker가 정한 것
- 넘길 줄: `main/agent-tools.ts` import 줄. 못 푼 role 이름 문자열 위치(file:line)
- 계약 바꾸기 요청: 없음이 기본
- **무겁게 짠 것**: 없음이 기본. 있으면 `무엇 / 왜 / 줄인다면 / 어디`
- **알려진 미완 동작**: `agents/names.ts`·`agents/builtin.ts`(`BUILTIN_NAMES`, `DEFAULT_PROFILES`)는 `resolve.ts`·`inspect.ts`가 직접 읽는 role 표라 이 task에서 옮기지 않았다고 적는다
