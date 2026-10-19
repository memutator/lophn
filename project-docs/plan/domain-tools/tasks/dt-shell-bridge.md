# dt-shell-bridge

앱 화면 bridge를 tool 호출 하나로 바꾸고(`window.lophnApp.call` → `callTool`, preload, IPC, shell main의 `app-call.ts`), 앱 view의 project picker와 view의 project 묶음(`setProject`/`setViewProject`)을 지운다. `openExternal`은 그대로다.

- 단위: domain-tools (wave 2)
- 선행: dt-call-route
- 소유(이 task만 고친다):
  - `packages/protocol/shell/app-bridge-types.ts`
  - `packages/shell/ipc/app.ts`
  - `packages/shell/ipc/app-frame.ts`
  - `packages/shell/preload/app-api.ts`
  - `packages/shell/preload/app.ts`
  - `packages/shell/preload/views-api.ts`
  - `packages/shell/main/app-frame/app-call.ts`
  - `packages/shell/main/app-frame/app-call_test.ts`
  - `packages/shell/main/app-frame/app-connection.ts`
  - `packages/shell/main/app-frame/app-ipc.ts`
  - `packages/shell/main/app-frame/blueprint-source.ts`
  - `packages/shell/main/app-frame/registry.ts`
  - `packages/shell/main/app-frame/view-ipc.ts`
  - `packages/shell/main/app-frame/view-model.ts`
  - `packages/shell/main/app-frame/visibility.ts`
  - `packages/shell/main/browser/frame-router.ts`
  - `packages/shell/main/desktop/wiring/app-calls.ts`
  - `packages/shell/main/desktop/wiring/app-views.ts`
  - `packages/shell/renderer/app-frame/app-space.tsx`
  - `packages/shell/renderer/app-frame/app-bar.tsx`
  - `packages/shell/renderer/app-frame/app-bar.module.css`
  - `packages/shell/renderer/app-frame/embedded-view.tsx`
  - `packages/shell/renderer/app-frame/side-panel.tsx`
  - `packages/shell/renderer/app-frame/project-picker.tsx`
  - `packages/shell/renderer/app-frame/project-picker.module.css`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/desktop/dev-mock/app-space.ts`
  - `packages/design/wording/catalog/app-space.ts`
  - `tools/wireframes/pages/screens/app-space.tsx`
  - `tools/wireframes/pages/screens/app-space`
- 읽을 것:
  - architecture: `project-docs/architecture/app-call.md`(흐름: shell 앱 화면이 core를 거친다), `project-docs/architecture/annotation.md`(화면 신원. `annotate.ts`는 `artifact` 계획이 고치므로 건드리지 않는다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `shell`, `project-docs/module-catalog.yaml`의 `packages/shell`
  - 계획: `project-docs/plan/domain-tools/README.md`의 "bridge", "project 범위 지우기"와 "같이 도는 계획" 표(`domain-place`가 같은 shell app-frame 파일들에 앱 place 화면을 고친다. 충돌은 lead가 푼다)
  - 지금 코드: `packages/shell/main/app-frame/app-call.ts`(`checkCall`, `DENIAL_CODES`), `packages/shell/preload/app-api.ts`(`createAppApi`), `packages/shell/renderer/app-frame/app-space.tsx`(`needsProject`, `ProjectPicker`)
- 계약:
  - 쓰는 것: `dt-call-route`가 고친 route `apps/call_tool`(입력 `{target, tool, input?, caller}`)과 `dt-decl`의 읽기 출력 `tools`(`name, title, effect, inputSchema`)
  - 내놓는 것(`dt-sdk`의 `@lophn/app-ui`가 같은 값을 따른다):
    - `LophnApp`(`packages/protocol/shell/app-bridge-types.ts`): `callTool(tool: string, input: Json): Promise<unknown>`, `openExternal(url: string): Promise<void>`. 옛 `call`은 없다. 실패는 `"<code>: <message>"` Error다.
    - IPC channel `APP_CALL_TOOL_CHANNEL = "app:call-tool"`(`packages/shell/ipc/app.ts`. 옛 `APP_CALL_CHANNEL`을 대신한다). 페이지가 보내는 payload는 `{ tool, input }`뿐이다(앱·release·mode·caller는 main이 sender view에서 정한다).

## 할 일

1. bridge 이름: `app-bridge-types.ts`, `ipc/app.ts`, `preload/app-api.ts`(`createAppApi`의 `call`→`callTool`. 파일·함수 이름은 둔다), `main/app-frame/app-ipc.ts`(channel 등록), `main/app-frame/app-call.ts`를 위 계약대로 바꾼다. `app-call.ts`의 `Blueprint`는 `tools`를 읽고(`blueprint-source.ts`가 `found.value.tools`에서 `name, title, effect, hasInput`을 만든다), `checkCall`은 키 `tool,input`을 받으며, route에는 `tool: declared.name`을 싣는다. 선언에 없는 tool은 지금처럼 `forbidden`으로 같은 답을 준다.
2. `app-call.ts`의 `DENIAL_CODES`에서 `project_mismatch`, `project_required`, `project_not_found`를 지우고 호출에 `project`를 싣는 줄을 지운다.
3. view의 project 묶음 지우기: `ipc/app-frame.ts`(`appViewOpenSchema.project`, `VIEW_PROJECT_CHANNEL`, `viewProjectRequestSchema`, `AppFrameViewState.project`, `LophnShellViewsApi.setViewProject`), `preload/views-api.ts`, `main/app-frame/{view-ipc.ts,visibility.ts,registry.ts,view-model.ts,app-connection.ts}`(`setProject`, `target.project`, `PROJECT_ID`), `main/browser/frame-router.ts`(`setProject` 라우팅), `main/desktop/wiring/app-views.ts`를 지운다. 새 view state 모양이 바뀌면 `registry.ts`의 push 판정도 맞춘다.
4. renderer: `project-picker.tsx`·`.module.css`를 지운다. `app-space.tsx`에서 `needsProject`, `projectFailed`, `useProjectName`, `projects`·`project` prop, `views.setViewProject` 호출과 picker 렌더를 지운다. `app-bar.tsx`의 project 이름 표시(`project` prop과 `data-app-project`), `embedded-view.tsx`의 `project` prop과 signature, `side-panel.tsx`·`desktop/main.tsx`(`ProjectsRead`, `projectsRead`, `projects={...}`)·`desktop/dev-mock/app-space.ts`의 project 흔적을 지운다. 화면을 다시 그리지 않는다. 지운 자리를 접을 뿐이다.
5. wording: 안 쓰게 된 key를 `packages/design/wording/catalog/app-space.ts`에서 지운다: `app-space.empty.no-projects`, `app-space.error.project-failed`, `app-space.heading.choose-project`, `app-space.label.in-project`, `app-space.label.your-projects`, `app-space.notice.no-project-list`, `app-space.text.choose-project`. 각 key를 `grep -rn "<key>" packages tools`로 확인한 뒤 지우고 `deno task wording`으로 생성물을 다시 만든다. 다른 task도 이 catalog를 고친다(충돌은 두 쪽 key를 다 남기고 생성물을 다시 만든다).
6. wireframe: `tools/wireframes/pages/screens/app-space.tsx`의 gallery page `new-app-project-picker`와 `app-space/pages.tsx`의 `ProjectPickerInView`, `app-space/space.tsx`의 `picker`·`project` 인자를 지운다.
7. 위험 test 하나를 새로 만들지 말고 기존 `app-call_test.ts`의 "페이지가 보낸 앱·release·project·caller 주장은 쓰이지 않는다"를 새 계약에 맞춘다(제목에서 project를 빼고, 페이지가 보낸 `app`·`release`·`caller` 주장이 route 입력에 쓰이지 않고 `tool` 이름만 쓰이는 것을 본다). 이 test는 페이지가 다른 앱·사람 신원을 사칭하는 길을 막는 경계 test이므로 지우지 않는다.

## 끝남

- `deno task check`가 통과한다. shell main은 `check`가 따로 돌린다(`shell main`, `shell main test`).
- 위험 test: "앱 화면 페이지가 보낸 앱·release·caller 주장은 호출에 쓰이지 않고 그 view의 고정 blueprint가 선언한 tool만 core로 간다" — `packages/shell/main/app-frame/app-call_test.ts`.
- 남지 않음:
  - `grep -rnE "setProject|setViewProject|VIEW_PROJECT_CHANNEL|viewProjectRequestSchema|ProjectPicker|ProjectsRead|project-picker|APP_CALL_CHANNEL" packages tools --include=*.ts --include=*.tsx`가 0줄이다.
  - `grep -rnE "lophnApp\.call\b|\bcall\(api" packages tools --include=*.ts --include=*.tsx --include=*.md`에서 이 task의 소유 밖(`dt-sdk`·`dt-coding-text`가 맞출 곳)이 아닌 줄이 0줄이다.
  - `grep -n "project" packages/shell/main/app-frame/app-call.ts packages/shell/main/app-frame/blueprint-source.ts`가 0줄이다.
- (화면) `deno task wireframes`가 되고 gallery의 `app-space` page들이 그려진다. `deno run -A packages/shell/renderer/build.ts`가 된다(check:full이 못 보는 build).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: wording 생성물(`packages/design/wording/`)
- 안 쓰게 된 export
- 정한 것
- 넘길 줄
- 계약 바꾸기 요청
- **무겁게 짠 것**
- **알려진 미완 동작**: 앱 화면은 project 없이 열린다. 앱이 project에 묶이는 것은 `domain-place`다

## lead가 더함

- `packages/shell/main/app-frame/app-call.ts`에 file 안 `interface AppApiDeclaration`(17행 근처)이 남아 있다. `dt-decl`이 protocol의 같은 이름을 지웠다. 새 선언 모양(`name`, `title`, `effect`, `hasInput`)으로 바꾸며 이름도 `ToolDeclaration` 같은 것으로 바꾼다.
- `packages/shell/main/desktop/wiring/app-views.ts`의 앱 전용 창 주석(196행 근처)이 "`/apps/blueprint`가 정한다. 아직 core 통로가 없어 unavailable"이라고 적혀 있다. 코드는 이미 `apps/app_api`를 읽는다. 주석을 지금 코드에 맞춘다.
