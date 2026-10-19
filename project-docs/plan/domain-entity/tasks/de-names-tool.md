# de-names-tool

앞 계획 `domain-tools`가 넘긴 `app_api` 계열 이름을 모두 tool로 바꾼다(route, 계약 칸, 표 열, SDK package, file 이름, 화면 문구, 주석). 이름 하나가 protocol, core, SDK, shell, test에 걸쳐 있어 한꺼번에 바꿔야 type check가 서므로 codemod task다. 앞의 모든 영역 task가 끝난 뒤(wave 4) 한 번에 돌려 충돌이 없다. 같이 `context_binding`(context 모델의 남은 칸)과 issue skill의 옛 주제 이름을 지운다.

- 단위: names (wave 4)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/`
  - `packages/core/`
  - `packages/sdk/`
  - `packages/coding-agent/`
  - `packages/shell/`
  - `packages/design/wording/`
  - `tools/`
  - `tests/support/`
  - `tests/e2e/`
  - `tests/eval/checks/`
  - `tests/eval/scenarios/`
  - `tests/eval/human/`
  - `tests/eval/types.ts`
  - `.claude/skills/issue/SKILL.md`
  - `deno.json`
  - `deno.lock`
- 읽을 것:
  - 도구: `tools/move-files.ts`(파일·폴더·package 옮기기와 import 고치기. 머리 주석이 mapping 모양을 설명한다), `.claude/skills/wording/SKILL.md`(wording key 이름과 `deno task wording`)
  - architecture: `project-docs/architecture/app-call.md`("선언은 MCP tool 모양 하나다")
  - 제품 결정: `project-docs/plan/domain-entity/README.md`의 "정한 것 > 넘겨받은 이름 정리"
- 계약:
  - 쓰는 것: 앞 task들이 만든 모든 이름
  - 내놓는 것(바뀐 뒤의 이름. 다른 계획이 이 이름을 읽는다)
    - 읽기 route: `app.app_api` → `app.tools`(export `appAppApi` → `appTools`, wire `apps/app_api` → `apps/tools`), `app.app_api_index` → `app.tool_index`(`appAppApiIndex` → `appToolIndex`, `AppApiIndexEntry` → `AppToolIndexEntry`). agent tool `app.app_api` → `app.tools`(`tool-lists.ts`, role 글, 시험 이름 포함).
    - approval intent kind `app_api` → `app_tool`(`mcp_tool`과 짝). grant entry의 `apis`·`api` → `tools`·`tool`, 활성화 Gate 칸 `added_app_apis`(`addedAppApis`, `AddedAppApi`) → `added_tools`(`addedTools`, `AddedTool`), 권한 scope의 `app_apis` → `app_tools`. attestation·desired·probe의 `app_api` → `tools`. blueprint `app_connections[].app_api` → `app_connections[].tools`(`AppApiUseDeclaration` → `AppToolUseDeclaration`). process-wire·broker의 `api` → `tool`. session `tool_calls.app_api`(표 열, `appApiBindingSchema`) → `app_tool`.
    - SDK package `@lophn/cap-app-api` → `@lophn/cap-tool`(폴더 `packages/sdk/cap-app-api` → `packages/sdk/cap-tool`, `sdk_dependencies`·template `deno.json`·`deno.lock`·내장 SDK 설치 목록 포함).
    - file·폴더: `packages/protocol/apps/blueprint/app-api.ts` → `tools.ts`, `packages/core/apps/runtime/entrypoint/app-api-port.ts` → `tool-port.ts`, `packages/core/lophn-agent/tools/app-api/` → `app-tool/`, `packages/shell/preload/app-api.ts` → `app-tool.ts`, `packages/core/apps/packages/template/app/src/app-api.ts.tmpl` → `src/tools.ts.tmpl`.
    - type·함수: `AppApi*`는 `AppTool*`로, `appApi*`는 `appTool*`로, `APP_API_*`는 `APP_TOOL_*`로 바꾼다. 이미 있는 이름과 겹치면 `App`/`app` 접두를 붙여 가른다(예: protocol의 `AppTool`(read 모양)은 그대로이고 harness의 `AppApiTool`은 `AppToolEntry`, `AppApiToolkit`은 `AppToolkit`, `buildAppApiTools`는 `buildAppTools`). `appApiKeySchema`는 `toolKeySchema`가 이미 있으면 `appToolKeySchema`로 한다.
    - 문구·주석·doc: "app-api", "app api", "app_api"라고 쓴 말은 "tool"로 고친다(문장이 어색하면 문장을 고친다). wording key의 `app-api` 조각도 `tool`로 바꾼다(`waiting.label.declared-app-api` → `waiting.label.declared-tool` 같은 식. `deno task wording`으로 생성물을 맞춘다).
    - `packages/protocol/lophn-agent/tool-values.ts`의 `context_binding` 칸은 두 schema에서 지운다(쓰는 곳은 eval fixture `tests/eval/checks/app/fixtures.ts`뿐이다). `.claude/skills/issue/SKILL.md` 26째 줄의 주제 `contexts`는 `domain`으로 바꾼다.

## 할 일

1. 바꿀 곳 목록을 먼저 만든다: `git grep -ilE "app[-_ ]?api" -- packages tests tools .claude ':!tests/eval/runs' ':!tests/eval/experiments' ':!tests/eval/registry' ':!tests/eval/materials'`. 위 계약의 대응표를 `.dev-data/de-names-tool/mapping.json`(worktree 안)과 sed 규칙으로 만든다(scratchpad가 아니라 worktree 안 `.dev-data/<id>/`에 둔다).
2. 먼저 file·폴더·package를 옮긴다: `deno run --allow-read --allow-write --allow-run tools/move-files.ts <mapping.json> --dry-run`으로 보고서를 본 뒤 돌린다. 이어 이름과 문자열을 규칙대로 바꾼다. 긴 이름부터(`appAppApiIndex` → `appToolIndex`, `app_api_index` → `tool_index`, `added_app_apis` → `added_tools`, `AppApi*`/`appApi*`), 마지막에 남은 `app_api`·`app-api`·`app api`를 읽고 고친다. 기계 치환이 뜻을 깨는 곳(예: "the app's API" 같은 산문)은 손으로 읽고 고친다.
3. DB schema step의 열 이름을 바꾼다(`tool_calls.app_api`, grant 저장 JSON의 `apis` 등). migration은 만들지 않고 개발 data는 새로 만든다.
4. `deno.json`·`deno.lock`: SDK package 이름이 바뀌어 lock과 workspace 목록이 바뀐다. `deno task check`가 `frozen` lock 때문에 멈추면 이 task가 lock을 새로 만든다(`deno cache`/`deno install`로, 네트워크가 필요하면 보고에 적고 멈춘다). `packages/shell/main/desktop/core/deno.lock`은 commit하지 않는다.
5. `tests/eval/{registry,runs,experiments,materials}`는 이 계획 뒤에 다시 만들 자료라 고치지 않는다(옛 이름이 남는다. 보고에 적는다). `tests/eval/checks/`·`scenarios/`의 코드는 고친다.
6. 시험은 새로 쓰지 않는다. 이름이 바뀌어 깨지는 test만 맞춘다.

## 끝남

- `deno task check:full`이 통과한다(wireframes와 e2e type 포함).
- 위험 test: 없음(이름 바꾸기다)
- 남지 않음:
  - `git grep -ilE "app[-_ ]?api" -- packages tools .claude tests/support tests/e2e tests/eval/checks tests/eval/scenarios tests/eval/human tests/eval/types.ts`가 0줄이다.
  - `git grep -n "context_binding" -- packages tests/eval/checks`가 0줄이다.
  - `git ls-files | grep -i "app-api"`는 `tests/eval/materials/`의 file만 남는다.

## 보고

- 바꾼 file 수와 옮긴 file 목록
- 통과한 check
- 등록할 것: wording 생성물(`deno task wording`)
- 안 쓰게 된 export
- 정한 것: 겹쳐서 접두를 붙인 이름 목록
- 넘길 줄: `tests/eval/{registry,runs,experiments,materials}`에 남은 옛 이름 목록(다음 계획의 재료)
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**
