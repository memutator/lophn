# ds-tool-rename

`domain-tools`가 넘긴 `app_api` 이름 계열을 `tool`로 바꾸고, agent tool 이름 접두를 `app__<app id>__<tool>`에서 domain 이름 기반으로 바꾼다. 앱의 tool은 이미 MCP tool 모양 선언(`blueprint.tools[]`)인데 안쪽 이름이 `app_api`로 남아 있다. 동작은 바꾸지 않고 이름과 agent tool 이름 꼴만 바꾼다. 마지막에 `context_binding`(쓰는 곳 없는 칸)을 지운다.

- 단위: tool (wave 4)
- 선행: ds-project-registry
- 소유(이 task만 고친다):
  - `packages/protocol/approvals`
  - `packages/protocol/apps`
  - `packages/protocol/lophn-agent/scope.ts`
  - `packages/protocol/lophn-agent/tool-calls.ts`
  - `packages/protocol/lophn-agent/tool-catalog.ts`
  - `packages/protocol/lophn-agent/tool-values.ts`
  - `packages/protocol/coding-agent/cli-commands.ts`
  - `packages/sdk`
  - `packages/coding-agent/guides`
  - `packages/core/approvals`
  - `packages/core/apps/agent-tools`
  - `packages/core/apps/blueprint`
  - `packages/core/apps/calls`
  - `packages/core/apps/control.ts`
  - `packages/core/apps/invocations`
  - `packages/core/apps/mcp`
  - `packages/core/apps/packages`
  - `packages/core/apps/permissions`
  - `packages/core/apps/ports.ts`
  - `packages/core/apps/preview`
  - `packages/core/apps/register.ts`
  - `packages/core/apps/releases`
  - `packages/core/apps/routes.ts`
  - `packages/core/apps/runtime`
  - `packages/core/problems/tests`
  - `packages/core/agent-roles/credentials.ts`
  - `packages/core/agent-roles/tool-lists.ts`
  - `packages/core/agent-roles/tool-lists_test.ts`
  - `packages/core/agent-roles/roles`
  - `packages/core/lophn-agent/run-loop`
  - `packages/core/lophn-agent/session/caller-directory.ts`
  - `packages/core/lophn-agent/tool-judgment`
  - `packages/core/lophn-agent/tools`
  - `packages/core/main/agent-runtime/product-driver.ts`
  - `packages/core/main/app-supervisor`
  - `packages/core/main/daemon/wiring/apps.ts`
  - `packages/core/main/daemon/wiring/context.ts`
  - `packages/shell/main/app-frame`
  - `packages/shell/main/desktop/wiring/app-calls.ts`
  - `packages/shell/main/desktop/wiring/app-views.ts`
  - `packages/shell/preload/app-api.ts`
  - `packages/shell/preload/app.ts`
  - `packages/shell/renderer/app-frame/app-detail`
  - `packages/shell/renderer/app-frame/app-views.tsx`
  - `packages/shell/renderer/apps`
  - `packages/shell/renderer/workspace/agents/core-grants.ts`
  - `packages/shell/renderer/workspace/agents/source.ts`
  - `packages/shell/renderer/workspace/agents/editor`
  - `packages/shell/renderer/desktop/connection`
  - `tools/check-deps.ts`
  - `tools/deps-blueprint.ts`
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `tools/wireframes/pages/screens/questions.tsx`
  - `tools/wireframes/pages/screens/waiting`
  - `tests/e2e`
  - `tests/eval/checks`
  - `tests/eval/registry`
  - `tests/eval/scenarios`
  - `tests/eval/versions`
  - `tests/eval/human`
  - `tests/eval/criteria`
  - `tests/eval/types.ts`
  - `tests/support/app`
  - `deno.lock`
  - `project-docs/module-catalog.yaml`
  - `project-docs/architecture`
- 읽을 것:
  - 계획: `project-docs/plan/domain-split/README.md`("정한 것"의 "넘겨받은 이름 정리")
  - architecture: `project-docs/architecture/app-call.md`(호출 길, Gate, invocation), `project-docs/architecture/agent-definition.md`(agent grant), `layers.md`
  - 코드(이름이 걸린 곳): `packages/protocol/approvals/{intent,grants,requests}.ts`, `packages/protocol/apps/{blueprint/*,calls/*,runtime,broker,channel-values,registry,releases,permissions}.ts`, `packages/protocol/lophn-agent/{scope,tool-calls,tool-catalog,tool-values}.ts`, `packages/core/lophn-agent/tools/{app-tools,app-toolkit,app-public}.ts`와 `tools/app-api/`, `packages/core/apps/**`, `packages/sdk/cap-app-api/`, `packages/shell/preload/app-api.ts`
  - 도구: `tools/move-files.ts`(폴더·file 이동)
- 계약:
  - 쓰는 것: 없음(이름 바꾸기).
  - 내놓는 것: 아래 표의 새 이름. 계획 안에서 이 이름을 읽는 다른 task는 없다(이 wave에서 겹치는 소유가 없다).

## 이름 표

| 옛 | 새 |
|---|---|
| approval intent kind·target kind `"app_api"` (`packages/protocol/approvals/intent.ts`), `appApiIntent`, `AppApiTarget` | `"tool"`, `toolIntent`, `AppToolTarget`. target 칸 `api` → `tool` |
| grant 칸: `{kind:"app.call", app, app_apis}`, agent grant entry `apis: [{api, setting}]`, `added_app_apis`, `AddedAppApi` | `tools`, `tools: [{tool, setting}]`, `added_tools`, `AddedTool` |
| attestation·desired·probe·launch 계획의 `app_api: string[]`, `declarations.app_api`, `app_connections[].app_api`, `AppApiUseDeclaration` (`packages/sdk/blueprint`, `packages/protocol/apps/blueprint/uses.ts`) | `tools`, `declarations.tools`, `app_connections[].tools`, `AppToolUseDeclaration` |
| process-wire·broker·capability host의 `api` 칸(`packages/protocol/apps/calls/{process-wire,broker}.ts`, `handler.api`, `source.api`, `command`로 쓰던 key) | `tool` |
| `appApiKeySchema`(`packages/protocol/apps/channel-values.ts`), `appApiKey`(`runtime/entrypoint/wire-check.ts`) | `toolKeySchema`, `toolKey` (`toolNameSchema`는 그대로 둔다. 둘은 다른 검사다) |
| 읽기 route `app.app_api` / `app.app_api_index` (`appAppApi`, `appAppApiIndex`, `AppApiIndexEntry`, `reads.appApi`, `reads.appApiIndex`; resource `apps` method `app_api`, `app_api_index`) | `app.blueprint` / `app.tool_index` (`appBlueprint`, `appToolIndex`, `AppToolIndexEntry`; method `blueprint`, `tool_index`). 정한 것: 앞의 것은 앱 하나의 blueprint 읽기(tools, screens, declarations, evidence)라 `tool`이라 부르지 않는다 |
| session `tool_calls.app_api`(`packages/protocol/lophn-agent/tool-calls.ts`, `tool-values.ts`의 `appApiFields`, `appApiBindingSchema`) | `tool_calls.app_tool`, `appToolBindingSchema`. `context_binding` 칸은 지운다(값이 늘 null이다) |
| SDK package `@lophn/cap-app-api`, `packages/sdk/cap-app-api/`, symbol `lophn.cap-app-api`, `APP_API_PORT`, `AppApiPort`, `AppApiCaller`, `lophn.app-api-rejection`, `APP_API_REJECTION` | `@lophn/cap-tool`, `packages/sdk/cap-tool/`, `lophn.cap-tool`, `TOOL_PORT`, `ToolPort`, `ToolCaller`, `lophn.tool-rejection`, `TOOL_REJECTION` |
| file·폴더: `packages/protocol/apps/blueprint/app-api.ts`, `packages/core/apps/runtime/entrypoint/app-api-port.ts`, `packages/core/lophn-agent/tools/app-api/`(`name.ts`, `input.ts`), `packages/shell/preload/app-api.ts`(내용은 app view의 `lophnApp.callTool` bridge), 앱 template `src/app-api.ts.tmpl` | `blueprint/tools.ts`, `entrypoint/tool-port.ts`, `tools/app-tool/`, `preload/app-bridge.ts`, `src/tools.ts.tmpl` |
| `appApi*` 이름(`AppApiCallPath`, `AppApiLookup`, `appApiLookupOf`, `AppApiView`, `AppApiSource`, `buildAppApiTools`, `appApiToolName`, `APP_API_TOOL_PREFIX`) | `AppToolCallPath`, `AppToolLookup`, `appToolLookupOf`, `AppToolView`, `AppToolSource`, `buildAppTools`, `appToolName`, `APP_TOOL_PREFIX` |
| agent tool 이름 `app__<app id>__<tool>` | `<domain 이름>__<tool 이름>` |
| 문장·주석·wording 속 "app-api", "app_api", "app API" | "tool" |

## agent tool 이름 꼴(정한 것)

- 꼴: `<domain 이름>__<tool 이름>`. domain 이름은 slug(`[a-z0-9-]`)라 `_`가 없고 `__`로 tool 이름과 갈린다. tool 이름은 `[A-Za-z0-9_.-]{1,64}`다(`toolNameSchema`).
- 규칙(`appToolName`): wire 문자(`[A-Za-z0-9_-]`) 밖의 글자는 `_`로 바꾸고, 바꿨거나 64자를 넘으면 앞부분을 자르고 전체 이름의 hash 앞 8자를 붙인다. 지금 `appApiToolName`과 같은 규칙이고 접두만 다르다. 이름을 parse하지 않는다. 이름 → (앱, tool)은 정의 목록이 안다.
- domain 이름은 `app.tool_index`의 항목이 싣는다(`AppToolIndexEntry.domain`, 이름 문자열). apps는 domains를 import하지 못하므로 apps 쪽 port(`blueprint/`에 정의)를 `main/daemon/wiring/apps.ts`가 `domainInfoOf`(`packages/core/domains/registry/reads.ts`, `lophn-agent-registration.ts`가 쓰는 것과 같은 함수)로 구현해 꽂는다.
- 근거: README "agent tool 접두는 `app__<app>__<tool>`에서 `<domain 이름>__<tool>` 꼴로 바꾼다"와 MCP 이름 규칙(1..64자 `[A-Za-z0-9_.-]`, `toolNameSchema`). 한 domain에 앱이 하나라 domain 이름 + tool 이름이면 이 agent가 보는 이름 안에서 유일하다. 같은 이름이 둘이면 지금처럼 앞의 것만 정의가 된다(`buildAppTools`의 `names` 검사).

## 할 일

1. **기준선.** `grep -rnE "app_api|appApi|app-api|app_apis|AppApi|APP_API|context_binding|app__" packages tools tests --include=*.ts --include=*.tsx --include=*.md --include=*.tmpl --include=*.json | grep -v tests/eval/runs | wc -l`로 센다. 임시 file은 `.dev-data/ds-tool-rename/`에 둔다.
2. **이동.** `tools/move-files.ts`로 위 표의 file·폴더를 옮긴다(`--dry-run` 보고서를 먼저 읽는다). SDK 폴더를 옮기면 `deno.lock`의 workspace 항목, `packages/core/apps/packages/vendor.ts`의 사본 file 목록("app-api.ts" 줄), 앱 template(`packages/core/apps/packages/template/app/` 아래 `blueprint.ts.tmpl`, `deno.json.tmpl`, `src/…`, `tests/…`의 import와 `AGENTS.md.tmpl`), 설치된 SDK 이름을 쓰는 곳을 같이 고친다.
3. **치환.** 단어 경계 script로 표의 이름을 바꾼다(`app_api` → `tools`/`tool`은 칸에 따라 다르므로 표대로 칸 단위로 한다). 문자열 literal(`"app_api"`, route 이름 `"app.app_api"`, SQL column `app_api`)은 type check가 못 본다. 바꾼 뒤 grep으로 남은 것을 읽는다. 표에 route 이름을 바꾸면 method를 문자열로도 grep한다(`"app_api"`, `app_api_index`: 화면이 resource·method 문자열로 부른다 — `packages/shell/renderer/app-frame/app-detail/core-source.ts`, `packages/shell/main/app-frame/blueprint-source.ts`, `packages/shell/renderer/apps/core-source.ts`).
4. **agent tool 이름.** `appToolName(domain, tool)`을 위 규칙으로 쓰고 `buildAppTools`가 `AppToolView.domain`을 넘긴다. `lophn-agent/tool-judgment/tool-gate.ts`, `run-loop/{untrusted,runtime-access,prepare}.ts`, `session/caller-directory.ts`가 `app__` 접두로 tool을 알아보던 곳을 `APP_TOOL_PREFIX` 대신 정의 목록으로 알아보게 맞춘다(접두로 parse하지 않는다). `core/apps/mcp/serve.ts`(coding agent MCP)의 tool 이름 꼴은 앱 tool 이름 그대로이므로 바뀐 점이 없는지 확인한다.
5. **문서 속 이름.** `packages/sdk/cap-tool/guide.md`, `packages/sdk/blueprint/guide.md`, `packages/coding-agent/guides/skills/lophn-build-app/SKILL.md`, `packages/core/agent-roles/roles/*`의 prompt·guide에서 "app-api"를 "tool"로 고친다. `project-docs/architecture/*.md`와 `project-docs/module-catalog.yaml`은 backtick path가 옮긴 file을 가리킬 때만 path 문자열을 고친다(문장은 lead 몫).
6. **eval 쪽.** `tests/eval/registry/tool/app.app_api.json`, `registry/template/app.json` 등 이름이 route·template 목록과 대조되는 file은 새 이름으로 옮긴다. eval material의 앱 source(`tests/eval/materials/**/source/**.tmpl`)와 `tests/eval/runs/`는 건드리지 않는다(다시 만든다). `tests/e2e`와 `tests/support`는 type을 막는 곳만 고친다. 돌리지 않는다.
7. **test.** `packages/core/lophn-agent/tools/app-api/name_test.ts`(→ `tools/app-tool/name_test.ts`)를 새 꼴로 옮긴다: 새 꼴 이름, 64자 넘는 이름의 hash, 같은 입력 같은 이름, 문자 치환 시 hash가 붙는 규칙을 그대로 본다. 그 밖에 새 test는 만들지 않는다(이름 바꾸기). 이름만 바뀐 위험 test(Gate가 앱 호출에 걸리는 것, `app-grants_test`, `calls_test`)는 그대로 통과해야 한다.
8. **확인.** `deno task check:full` → `project-docs/plan/tools/lead/boot.sh` → `deno run -A packages/shell/renderer/build.ts` → `deno task wireframes`.

## 끝남

- `deno task check:full`이 통과하고 `boot.sh`가 `boot N exit 0`을 찍는다.
- 위험 test: "agent tool 이름은 같은 입력에 같은 이름이고 wire 문자만 쓰며 64자를 넘지 않는다" (`packages/core/lophn-agent/tools/app-tool/name_test.ts`).
- 남지 않음(0줄. `tests/eval/runs`, `tests/eval/materials`, `project-docs`의 roadmap·plan은 뺀다):
  - `grep -rnE "app_api|appApi|app-api|app_apis|AppApi|APP_API" packages tools tests`
  - `grep -rn "context_binding" packages tools tests`
  - `grep -rn 'app__' packages tools tests --include=*.ts --include=*.tsx --include=*.md`
  - `find packages -iname '*app-api*' -not -path '*/node_modules/*'`

## 보고

- 바꾼 file(폴더 단위), 옮긴 file 표
- 통과한 check
- 등록할 것: `deno.lock`, `packages/protocol/**/mod.ts` 줄이 바뀌었으면 목록
- 안 쓰게 된 export
- 정한 것: route 새 이름(`app.blueprint`, `app.tool_index`), `tool_calls.app_tool`, 표에 없던 이름을 바꾼 곳
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 있으면 적는다
- **무겁게 짠 것**: domain 이름을 `app.tool_index`로 나르는 port가 무거우면 적는다(`무엇 / 왜 / 줄인다면 / 어디`). 없으면 "없음"
- **알려진 미완 동작**: eval material의 앱 source는 옛 SDK 이름이라 eval run은 이 계획 뒤에 자료를 새로 만들 때까지 돌지 않는다. 그 밖에 안 되는 동작.
