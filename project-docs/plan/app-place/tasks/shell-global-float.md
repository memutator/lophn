# shell-global-float

desk float 말고 workspace 창에 사는 전역 float를 더한다. 앱 panel 화면을 전역 float로 띄우면 desk와 workspace를 바꿔도 다시 load되지 않고 남는다. 접힘, rect, pin은 `<data>/shell/global-floats.json`에 남아 재시작을 넘는다.

- 단위: shell (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/shell/main/workspace/global-floats.ts`, `packages/shell/main/workspace/global-floats_test.ts` (새로)
  - `packages/shell/main/desktop/core/global-floats-ipc.ts` (새로), `packages/shell/main/desktop/wiring/layout.ts`
  - `packages/shell/ipc/global-floats.ts` (새로)
  - `packages/shell/preload/global-floats-api.ts` (새로), `packages/shell/preload/shell.ts` (expose 한 줄)
  - `packages/shell/renderer/shell/global-floats/**` (새로)
  - `packages/shell/renderer/shell/float-layer.tsx`, `packages/shell/renderer/shell/float-layer.module.css`
  - `packages/shell/renderer/shell/tab-strip.tsx`, `packages/shell/renderer/shell/tab-strip.module.css`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/workspace/workspace-window.tsx`
  - `packages/shell/renderer/desktop/dev-mock/**` (전역 float fake source만)
  - `packages/design/i18n/catalog/shell.ts`
  - `tools/wireframes/pages/screens/shell.tsx`, `tools/wireframes/pages/screens/shell/**`, `tools/wireframes/mock/**`
- 읽을 것:
  - architecture: `project-docs/architecture/workspace-layout.md`의 floats, `<webview>` 그릇, layout 파일, QuickLaunch 절
  - 계획: `project-docs/plan/app-place/README.md`의 정한 것 5~8
  - 본보기 store: `packages/shell/main/workspace/workspace-layout.ts`, `workspace-layout-store.ts`, `atomic-file.ts`, `packages/shell/main/desktop/core/layout-ipc.ts`, `packages/shell/ipc/workspace.ts`, `packages/shell/preload/layout-api.ts`, `packages/shell/renderer/shell/layout-source.ts`
  - float: `packages/shell/renderer/shell/desk-model.ts`(`FloatTab`, `floatTab`, `minimizeFloat`, `restoreFloat`, `pinFloat`, `minimizeLooseFloats`, `setFloatRect`, `dockFloat`, `closeFloat`), `float-layer.tsx`(`NOT_OUTSIDE`, `useOutsidePress`), `tab-strip.tsx`(`data-float-chips`, `MINIMIZED_SHOWN`)
  - `<webview>` 그릇: `packages/shell/renderer/app-frame/webview-host.tsx`(`createWebviewHost`, `WebviewLayer`), `packages/shell/renderer/workspace/use-tab-host-slices.ts`(창마다가 아니라 `WorkspaceWindow`마다 만든다), view keeps
  - 앱 panel: `packages/shell/renderer/workspace/app-panel-tab.tsx`(`AppPanelTab`, `keepKey`), QuickLaunch 앱 panel 열기(`workspace-window.tsx`의 `openPinnedAppPanel`, `quickPins`, `shell.app_launch`의 `rememberFloatRect`)
  - 화면 규칙: `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: 앱 view 열기 IPC(`packages/shell/ipc/app-frame.ts`). wave 1의 `place-declaration`이 `size`를 `place`로 바꾼다. 먼저 merge되는 쪽 이름을 따른다.
  - 내놓는 것:
    - 저장 파일 `<data>/shell/global-floats.json` = `{schema_version: 1, floats: [{app, screen, rect: {x, y, width, height}, minimized, pinned?: true}]}`, floats는 최대 20개. rect는 workspace layout의 float rect와 같은 기준(title bar 아래 창 몸통)이다.
    - IPC `shell:global-floats-read`, `shell:global-floats-save`. desktop host 창만 부른다.
    - renderer context `GlobalFloatsProvider`와 `useGlobalFloats()`: 목록, 펼치기·접기·pin·rect·닫기, desk float ↔ 전역 float 옮기기. wave 2 `shell-taskbar`가 chip을 그리려고 읽는다.

## 할 일

1. **main store**: `global-floats.ts`에 strict zod schema와 `createGlobalFloatsStore(dataRoot)`를 둔다. `read()`는 파일이 없거나 틀리면 빈 목록, `write()`는 `writeFileAtomic`이다. `global-floats-ipc.ts`가 read·save handler를 걸고(호출 창 검사는 `layout-ipc.ts`와 같다), `wiring/layout.ts`가 등록한다. preload `lophnGlobalFloats {read, save}`를 둔다.
2. **창 단위 층** (`renderer/shell/global-floats/`)
   - `Desktop`(`renderer/desktop/main.tsx`)의 `tree`에서 `{space}` 옆에 전역 float 층을 둔다. 이 층은 자기 `createWebviewHost()`, view keeps, `WebviewLayer`, `FloatLayer`를 가지므로 `WorkspaceWindow`가 다시 mount되어도 `<webview>`가 남는다.
   - 층은 title bar 아래 창 몸통을 덮는 절대 위치 상자다. desk float 층보다 위다.
   - route가 project, home, 앱 workspace, Settings일 때만 그린다. detached 창, 앱 전용 창, home gate에서는 그리지 않는다.
   - 본문은 `AppPanelTab`을 그대로 쓴다. 바깥을 누르면 pin 안 한 펼친 전역 float를 접는다(desk float와 같은 규칙).
3. **옮기기**
   - float bar에 단추 하나를 둔다: desk float면 "모든 workspace에 띄우기", 전역 float면 "이 desk로". `FloatLayer`에 prop 하나(예: `onGlobal(key)`와 그 상태)를 더한다.
   - 앱 panel 탭만 이 단추를 보인다(정한 것 5).
   - 옮길 때 rect, 접힘, pin을 그대로 가져간다. desk float에서 옮기면 desk model에서 그 탭을 닫는다(`closeFloat`).
4. **chip**: 지금 tab 줄 끝 chip 묶음에 전역 float chip을 먼저 그린다(전역 표시 아이콘). chip을 누르면 펼치기·접기다. 작업 표시줄은 wave 2다.
5. **QuickLaunch**: 고정된 앱 panel 단추를 누를 때 같은 `{app, screen}`이 전역 float에 있으면 desk에 새로 열지 않고 그 전역 float를 펼쳐 맨 위로 올린다.
6. **저장**: 전역 float 상태가 바뀔 때마다 저장하고(잦은 rect 변화는 layout처럼 모아 쓴다), 창이 뜰 때 읽는다. 다른 창이 바꾼 값은 창 focus 때 다시 읽는다.
7. **gallery**: `shell` 영역에 전역 float가 desk float 위에 떠 있는 page를 하나 더한다(id `shell-global-float`). `npm run dev:mock`이 깨지지 않게 dev-mock에 빈 전역 float source를 둔다.
8. 문구는 `packages/design/i18n/catalog/shell.ts`에 둔다.

## 끝남

- `npm run check:full`이 통과한다. `node packages/shell/renderer/build.ts`와 `npm run wireframes`가 된다.
- 위험 test(사람의 전역 float 배치를 잃으면 곤란하다):
  - `global-floats_test.ts`: "쓴 전역 float 목록이 그대로 읽히고, 틀린 파일이나 다른 schema_version은 빈 목록으로 읽힌다"
- 남지 않음: 새 store가 `workspace-layout.ts`의 schema나 `WORKSPACE_SCHEMA_VERSION`을 바꾸지 않았다.
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴. `npm run dev`에서 확인했는지 적는다: 전역 float로 옮긴 앱 panel이 workspace를 바꿀 때 다시 load되는지, 재시작 뒤 접힘이 남는지. 확인하지 못했으면 "확인 못 함"으로 적는다.
