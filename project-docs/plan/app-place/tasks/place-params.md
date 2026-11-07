# place-params

앱 화면이 열릴 때 지금 자리(`place`), 인자(`params`), 지금 workspace(`workspace`)를 알게 한다. 앱은 `@lophn/app-ui`의 `usePlace()`로 읽는다. agent의 app card는 `params`를 넘긴다.

- 단위: place (wave 2)
- 선행: place-declaration
- 소유(이 task만 고친다):
  - `packages/shell/ipc/app-frame.ts`
  - `packages/shell/main/app-frame/{app-connection.ts,view-model.ts,registry.ts,app-protocol.ts}`와 그 폴더의 `*_test.ts`
  - `packages/shell/preload/app.ts`, `packages/shell/preload/app-tool.ts`
  - `packages/protocol/shell/app-bridge-types.ts`
  - `packages/sdk/app-ui/**`
  - `packages/sdk/agent/**`
  - `packages/shell/renderer/app-frame/{embedded-view.tsx,app-views.tsx}`
  - `packages/shell/renderer/workspace/app-panel-tab.tsx`, `packages/shell/renderer/workspace/app-screen-tab.tsx`
  - `packages/shell/renderer/workspace/visuals/app-card-block.tsx`, `packages/shell/renderer/workspace/visuals/registry.ts`
  - `packages/shell/renderer/conversation/message-list/message-body.tsx`
  - `packages/shell/renderer/conversation/{agent-tab-core-source-bodies.ts,agent-tab-source.ts,thread-layout.ts}`
  - `packages/core/apps/agent-tools/visual.ts`, `packages/core/apps/agent-tools/app-card.ts`
  - `packages/protocol/lophn-agent/message-content.ts` (`app_card` part만)
  - `packages/protocol/acp/items.ts` (`AcpCard`만)
  - `packages/core/main/daemon/wiring/acp-build.ts` (`app_card` 줄만)
  - SDK pin이 있는 곳(`packages/core/apps/packages/template/app/**`, `tests/support/app/sample/lophn.ts.tmpl`, `tools/wireframes/package.json`, `package-lock.json`)
- 읽을 것:
  - 계획: `project-docs/plan/app-place/README.md`의 정한 것 2~4
  - roadmap: `project-docs/products/roadmap/app-place.md`의 "1. 앱 화면 체계"
  - architecture: `project-docs/architecture/app-call.md`, `project-docs/architecture/ui-kit.md`(앱이 쓰는 UI SDK), `project-docs/architecture/acp.md`(AcpCard)
  - 지금 길:
    - URL: `packages/shell/main/app-frame/app-protocol.ts` `appEntryUrl`(`lophn-app://<label>/<screen>/index.html?view_session=…`, `registry.ts`가 `&mount=`를 더한다. query는 page에 닿는다).
    - 열기 입력 검사: `view-model.ts` `checkOpen`, `OPEN_KEYS`.
    - app card: `visual.ts`(`visual.show` 입력 `{app, view}`), `message-content.ts`의 `appCardFields`, `acp-build.ts`, renderer card 길(`message-body.tsx`의 `AppCardRef`에서 `app-card-block.tsx`까지).
    - bridge: `useTabHead`가 쓰는 type 사본(`packages/sdk/app-ui/use-tab-head.ts`).
  - SDK 판 규칙: 각 guide의 "version 정책"
- 계약:
  - 쓰는 것: wave 1의 `Place`, `ScreenDeclaration.params`, IPC `place` 칸
  - 내놓는 것:
    - 앱 view 열기 입력(IPC, `EmbeddedView` prop, registry target)에 `params?: JsonObject`, `workspace?: {kind: "project"|"home"|"app", id: string, folders: string[]}`를 더한다.
    - bridge `lophnApp.place: {place, params, workspace}`. 읽기만 하는 값이고 열릴 때 정해진다.
    - `@lophn/app-ui` `usePlace(): {place, params, workspace}`. 앱 view 밖이면 `place: null`이다.
    - wave 3 `shell-sidebar-slots`와 wave 4 `tray`가 `EmbeddedView`에 `place: "sidebar"|"tray"`와 `workspace`를 넘겨 쓴다.

## 할 일

1. **열기 입력**: `ipc/app-frame.ts`의 `appViewOpenSchema`와 main `checkOpen`·`OPEN_KEYS`·`ConnectTarget`에 `params`, `workspace`를 더한다.
   - `params`는 그 화면 선언의 `params` schema로 검사한다(`validateInput`, `packages/protocol/apps/declaration/schema.ts`). 선언에 `params`가 없는데 넘기면 거절한다.
   - 같은 view인지 판정할 때(`sameConnection`류) `params`와 `workspace`도 본다.
2. **URL**: `appEntryUrl`이 `place`, `params`(JSON), `workspace`(JSON)를 query에 싣는다.
3. **bridge**: 앱 preload가 `location.search`에서 읽어 `lophnApp.place`로 내놓는다(`app-bridge-types.ts`의 `LophnApp`). 틀린 값이면 `place: null`이다.
4. **SDK**: `@lophn/app-ui`에 `usePlace()`를 더하고 판을 2.4.0으로 올린다. guide에 예를 쓴다: 자리마다 다른 꼴로 그리기, 크기는 CSS container query로 맞추기. pin이 있는 곳을 모두 고친다(template, sample, wireframes, `package-lock.json`).
5. **renderer가 넘기기**
   - `app-panel-tab.tsx`(panel)와 `app-screen-tab.tsx`(tab)는 지금 workspace를 넘긴다. workspace 값을 얻으려면 `workspace-window.tsx`가 내리는 값이 필요하다. 그 file은 소유 밖이므로 context provider 한 줄이나 prop 한 줄만 고치고 "넘길 줄"에 적는다.
   - 앱 workspace의 tab 화면은 `{kind: "app", id: <app>, folders: []}`, Home은 `{kind: "home", id: "home", folders: []}`, project는 그 project id와 폴더 path 목록이다.
6. **app card params**
   - `visual.show` 입력에 `params?`를 더하고, 선언의 card 화면 `params`로 검사한다.
   - message part `app_card`에 `params?`를 저장한다. 더하기만 하므로 옛 message는 그대로 읽힌다.
   - `AcpCard`와 그 SDK 사본(`packages/sdk/agent/acp-types.ts`)에 `params?`를 더한다. `@lophn/agent`는 1.2.0이고 pin을 고친다.
   - renderer card 길을 따라 `EmbeddedView`까지 넘긴다.
   - `visual.show`의 tool 설명에 params를 쓰는 법을 한 줄 더한다.
7. 문자열 grep: 열기 입력 칸 이름(`params:`, `workspace:`)과 IPC 사용처. `tests/eval/`는 고치지 않는다.

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`가 된다.
- 위험 test(sandbox 경계: 앱 view가 남의 값을 받거나 검사 없는 인자로 열리면 곤란하다):
  - `packages/shell/main/app-frame/registry_test.ts`(또는 view-model test): "선언의 `params` schema에 맞지 않는 인자와 `params`를 선언하지 않은 화면의 인자는 열기가 거절된다"
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴. 바뀐 SDK 판과 pin을 바꾼 file 목록을 적는다.
