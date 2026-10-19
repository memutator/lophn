# dt-sdk

앱이 쓰는 SDK를 tool 이름으로 바꾼다. handler 등록 `appApi`→`tool`, 다른 앱 tool 호출 client, `@lophn/app-ui`의 hook·버튼, 앱 화면의 `window.lophnApp.callTool`을 쓰는 type, 앱 template, SDK guide. project를 아는 SDK `@lophn/cap-project`(`currentProject`, `listProjects`)와 호출 문맥의 `project`는 지운다.

- 단위: domain-tools (wave 2)
- 선행: dt-call-route
- 소유(이 task만 고친다):
  - `packages/sdk/cap-app-api`
  - `packages/sdk/cap-project`
  - `packages/sdk/app-ui`
  - `packages/sdk/blueprint`
  - `packages/sdk/cap-net/host.ts`
  - `packages/sdk/cap-net/guide.md`
  - `packages/sdk/cap-secret/host.ts`
  - `packages/sdk/cap-secret/guide.md`
  - `packages/sdk/cap-store/guide.md`
  - `packages/core/apps/packages/template/app`
  - `tools/wireframes/pages/kit/app-ui/order-actions.tsx`
  - `tools/wireframes/pages/kit/input/orders-filters.tsx`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(앱이 바깥으로 나가는 길, 앱이 다른 앱을 부르는 길), `project-docs/architecture/ui-kit.md`(AppApiButton 절)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `sdk-api`, `app-capability`, `project-docs/module-catalog.yaml`의 `packages/sdk`
  - 계획: `project-docs/plan/domain-tools/README.md`의 "SDK", "bridge"
  - 지금 코드: `packages/sdk/cap-app-api/{handlers,connect,rejection,context}.ts`, `packages/sdk/app-ui/{use-app-api.ts,app-api-button.tsx}`, `packages/core/apps/invocations/context.ts`(SDK와 같은 port 모양. 이 쪽은 `dt-call-route`가 이미 고쳤다)
- 계약:
  - 쓰는 것: `ToolDeclaration`(`dt-decl`의 계약 모양). bridge는 아래 "내놓는 것"을 `dt-shell-bridge`와 같이 따른다
  - 내놓는 것: 아래 이름들

## 계약 모양

`@lophn/cap-app-api`(패키지 이름·폴더·version `1.0.0`은 그대로. 이름 바꾸기와 version 정책은 `domain-rename`)
- `tool(name, handle)` — 옛 `appApi(key, handle)`. blueprint `tools`에 선언한 `name`의 handler를 등록한다. 같은 이름을 두 번 등록하면 던진다(메시지의 "app-api"를 "tool"로).
- `registeredTools()` — 옛 `registeredAppApis()`. 등록된 이름 목록.
- `ToolRejection(code, message)` — 옛 `AppApiRejection`. 코드 `invalid_input|forbidden|conflict|unavailable`. 마커 symbol `Symbol.for("lophn.app-api-rejection")`과 port symbol `Symbol.for("lophn.cap-app-api")`는 core(`packages/core/apps/invocations/context.ts`)와 맞물려 있으므로 바꾸지 않는다.
- `connectTools(app, tools)` — 옛 `connectAppApi(app, apis)`. 돌려주는 client는 `{ app, tools, callTool(name, input?) }`(옛 `call`). 열지 않은 이름은 `forbidden` 결과다. broker 요청 본문의 `api` 칸 이름은 그대로 쓴다(`APP_CALL_PATH`도 같다).
- type: `ToolClient`(옛 `AppApiClient`), `ToolOutcome`(옛 `AppApiOutcome`), `ToolCallOutput`(옛 `AppApiCallOutput`). `AppResult`, `AppError`, `ReadQuery` 등은 그대로.
- `InvocationContext`에서 `project`를 뺀다. `api?`·`inputHash?`·`caller?` 칸 이름은 그대로.
- `currentContext`, `runWith`, `readResult`, `traceName`, `RegisteredHandler`(칸 `api`)와 port type은 그대로다.

`@lophn/app-ui`
- `useTool(tool, bridge?)` — 옛 `useAppApi`. `tool`은 `Pick<ToolSpec, "name">`. `{ state, run }`의 모양은 그대로.
- `ToolButton({ tool, input?, children?, app?, onDone?, onFailed?, variant?, size?, disabled? })` — 옛 `AppApiButton`. `tool`은 blueprint 선언의 `name`·`title`이고 버튼 글은 `children ?? tool.title`이다. `app` prop은 bridge이며 이름을 그대로 둔다. DOM mark는 `data-tool={tool.name}`, `componentMark("ToolButton")`.
- `AppBridge`는 `callTool(tool: string, input: ToolInput): Promise<unknown>` 하나다(옛 `call(api, input)`). `appBridge()`는 `window.lophnApp`을 돌려준다.
- type: `ToolSpec = Pick<ToolDeclaration, "name" | "title">`(`@lophn/blueprint` type import를 되살린다. `dt-decl`이 임시로 로컬 type으로 바꿔 두었다), `ToolInput`(옛 `AppApiInput`), `ToolState`, `ToolResult`, `UseTool`, `ToolButtonProps`. `AppErrorBoundary`, `RENDER_ERROR_EVENT`는 그대로.
- 파일 이름은 `use-tool.ts`, `tool-button.tsx`로 바꾼다(SDK 패키지 안이라 영향이 없다).

**화면 bridge**(`dt-shell-bridge`와 같은 값): `window.lophnApp.callTool(tool, input)`과 `openExternal(url)`. 옛 `call`은 없다. 실패는 지금처럼 `"<code>: <message>"` Error다.

**지운다**: `packages/sdk/cap-project` 전체, `InvocationContext.project`, `cap-net`·`cap-secret`의 `host.ts`가 복사해 둔 호출 문맥 type의 `project` 칸.

## 할 일

1. `packages/sdk/cap-app-api`: 위 이름으로 바꾼다(`handlers.ts`, `rejection.ts`, `connect.ts`, `context.ts`, `mod.ts`). 주석과 오류 메시지의 "app-api"를 "tool"로 맞춘다. `guide.md`를 새 이름과 예제로 다시 쓴다.
2. `packages/sdk/app-ui`: 위 이름으로 바꾼다. `guide.md`의 사용 예(`blueprint.app_api.find(...)`)를 `blueprint.tools.find((tool) => tool.name === "archive-shipped")`로 고친다.
3. `packages/sdk/cap-project`를 폴더째 지운다. 이 package를 가리키는 곳이 있으면 같이 정리한다(`grep -rn "cap-project" packages tools`는 `dt-coding-text`가 쓰는 skill 글 외에 남지 않아야 한다).
4. `packages/sdk/blueprint`: `mod.ts`(type 이름은 `dt-decl`이 맞췄다)에서 `ToolDeclaration`, `ToolEffect`를 확인하고 `guide.md`의 "blueprint 칸" 절을 새 모양(`tools` 항목 `{name, title, description, inputSchema, outputSchema?, effect, public}`)으로 쓴다. `public`의 뜻은 "다른 project에 보이는지"이고 읽는 쪽은 이 계획 밖이라고 한 줄만 적는다. 예제의 `app_api: []`를 `tools: []`로.
5. `packages/sdk/cap-net/{host.ts,guide.md}`, `cap-secret/{host.ts,guide.md}`, `cap-store/guide.md`: `project` 칸과 "app-api" 표현을 정리한다.
6. 앱 template(`packages/core/apps/packages/template/app`): `blueprint.ts.tmpl`(`tools: [...]`, 항목 칸 `name/title/inputSchema/public: false`, `project_scope` 삭제), `src/app-api.ts.tmpl`(`tool`, `ToolRejection`, 등록 함수 이름 `registerTools`. 파일 이름 `app-api.ts`는 둔다), `main.ts.tmpl`, `src/screens/items/bridge.ts.tmpl`(`callTool`), `tests/{blueprint,items,wording}_test.ts.tmpl`(`registeredTools`, `blueprint.tools.map((tool) => tool.name)`), `AGENTS.md.tmpl`의 app-api 표현을 바꾼다. 템플릿 화면이 `@lophn/app-ui` 버튼을 쓰면 새 이름으로 바꾼다(`grep -rn "AppApi" .`).
7. wireframe kit 두 곳(`order-actions.tsx`의 `AppApiButton`·`AppApiSpec`, `orders-filters.tsx`의 주석)을 새 이름으로 바꾼다. 화면을 다시 그리지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음 — 이름 바꾸기와 type 정리이고 사용자 data·권한 경계를 바꾸지 않는다. 템플릿의 `tests/*.tmpl`이 새 앱에서 도는 `blueprint 선언 = 등록된 handler` 검사를 이미 지킨다.
- 남지 않음:
  - `grep -rnE "appApi\b|AppApiRejection|connectAppApi|registeredAppApis|AppApiClient|useAppApi|AppApiButton|AppApiSpec|AppApiInput|cap-project|currentProject|listProjects" packages tools --include=*.ts --include=*.tsx --include=*.tmpl --include=*.md`가 0줄이다(`packages/coding-agent/guides`와 `project-docs`는 다른 task·lead의 몫이라 제외).
  - `grep -rn "project" packages/sdk packages/core/apps/packages/template --include=*.ts --include=*.tsx --include=*.tmpl --include=*.md`에 호출 문맥의 project가 없다.
- (화면) `deno task wireframes`가 되고 gallery의 kit page `app-ui`가 새 버튼으로 그려진다.
- template 파일의 자리 표시(`{{TITLE}}` 등)를 건드리지 않았는지 `git diff`로 본다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음 예상
- 안 쓰게 된 export: 위 옛 이름들(앱 source가 쓰던 이름이다. 새 template과 skill이 새 이름을 쓴다)
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 이미 만든 앱(개발 data)의 source는 옛 이름을 쓰므로 새로 만든다

## lead가 더함

- `dt-decl`이 `packages/sdk/app-ui/use-app-api.ts`의 `AppApiSpec`을 `{ key: string; label: string }` 로컬 type으로 바꿔 두었다. 계약대로 `ToolSpec = Pick<ToolDeclaration, "name" | "title">`로 되돌린다.
- `tests/eval/materials/*`와 `tests/eval/registry/*`는 옛 이름을 쓰지만 이 task가 고치지 않는다(이슈 `project-docs/issues/eval.md`).
