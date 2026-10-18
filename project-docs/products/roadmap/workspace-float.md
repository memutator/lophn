# workspace float: 탭을 띄우고, 접고, 창으로 뗀다

상태: 로드맵. 아직 계획으로 열지 않았다. 2026-10-18 planner와 사람이 정했다.
배경 문서: `project-docs/architecture/annotation.md`(app view identity), AGENTS.md "속도"·"호환성".
이어지는 roadmap: `browser-tab.md`. browser popup이 floated 탭으로 태어난다.

## 왜

- 탭은 지금 pane의 탭 줄에만 있다. pane은 최대 2개다. terminal을 보면서 editor와 browser를 같이 보려면 셋 중 하나를 탭 뒤에 숨겨야 한다.
- OAuth popup처럼 잠깐 떴다 사라지는 화면을 둘 자리가 없다(`browser-tab.md` popup).
- 화면이 둘인 사람은 탭 하나를 다른 모니터로 옮길 길이 없다.

## 상태

탭 하나는 아래 넷 중 하나다. 모든 탭 kind에 같다.

```
docked(pane의 탭) ⇄ floated(workspace 위 패널) ⇄ minimized(상단 bar span)
docked, floated  →  detached(OS 창)  →  docked
browser popup    →  floated로 태어남
```

- **docked**: 지금의 탭이다.
- **floated**: lophn 창 안에서 workspace 위에 떠 있는 패널이다. 옮기고 크기를 바꿀 수 있다. 위에는 icon, 제목, [Minimize], [Dock], [Detach], [Close]가 있다.
- **minimized**: floated 패널을 접은 것이다. 상단 bar에 `[icon 제목]` span으로 남는다. 누르면 접기 전의 위치와 크기로 돌아간다.
- **detached**: 탭 하나가 OS 창 하나를 채운다. 창 위 bar에 제목, [Dock], 창 단추가 있다. OS의 minimize는 OS가 맡는다.

## 지금 코드

- **layout model.** `packages/shell/renderer/workspace/model.ts`.
  - `TabItem`(72-93)은 key, kind, title과 kind가 쓰는 `fields`, `readPosition`, `preview`를 갖는다. `PaneState`(95-98)는 `{tabs, selected}`, `WorkspaceView`(100-105)는 `{panes, splitRatio, focusedPane}`다.
  - pane은 최대 2개이고, `PANE_MIN` 480px다. 바꾸는 함수는 모두 순수 함수다: `normalizePane`, `moveTab`, `shiftTab`, `moveTabBy`, `reopenTab`, `openTabIn`, `pinTab`, `closeTab`.
  - preview 탭은 따로 칸이 없고 `TabItem.preview === true`다. `moveTab`과 `reopenTab`이 이 표시를 지운다.
- **저장.** `<dataRoot>/shell/layout.json` 파일 하나에 project 하나다(`main/workspace/layout-store.ts`, atomic write, 0600).
  - schema는 `main/workspace/schema.ts`의 strict object다(`LAYOUT_SCHEMA_VERSION = 1`). 칸은 `project`, `window_bounds`, `last_space`, `panes`(1-2개, pane마다 탭 200개까지), `split_ratio`, `focused_pane`다. floated, minimized, detached를 둘 칸이 없다.
  - `window_bounds`는 main이 보낸 창에서 채운다(`main/desktop/core/layout-ipc.ts:132`). 쓰기만 하고 읽어서 창을 되살리지는 않는다.
  - renderer는 바뀔 때마다 곧바로 저장한다(`renderer/workspace/workspace.tsx:354` `update` → `persist`). 200ms 지연 저장(`persistLater`)은 `readPosition`에만 쓴다.
- **탭 본문.** `renderer/workspace/panes/panes.tsx`의 `Panes`, `PaneView`가 그린다.
  - 선택된 탭만 mount한다. `keep`을 둔 kind(지금은 `app_panel`뿐, `kinds/app-panel.tsx:51`)만 `<div data-kept-tab hidden>`으로 계속 mount한다.
  - terminal은 다시 mount하면 snapshot으로 다시 그린다.
  - workspace에 떠 있는 DOM 층은 없다. context menu anchor(`position: fixed`)와 divider 손잡이만 있다.
- **탭 끌기.** HTML5 DnD(`application/x-lophn-tab`, `renderer/parts/tab-strip/tab-strip.tsx`)로 탭 줄 안이나 다른 pane의 탭 줄로 옮긴다. pane 본문이나 창 밖에 놓는 길은 없다.
  - 명령은 `tab.to-prev-pane`, `tab.to-next-pane`, `pane.split`이다(`workspace.tsx:847` `runCommand`, keybinding은 `ipc/keybindings.ts`).
- **탭 menu.** `panes.tsx`의 `menuItems`(250), `chooseMenu`(306)에 있다. 항목은 close, others, right, saved, all, copy-path, copy-relative-path, reveal, keep-open이다. 문구는 `packages/design/wording/catalog/project.ts`의 `project-workspace.button.tab-*`, icon은 `renderer/icons/workspace.ts`에 있다.
- **상단 bar.** `renderer/desktop/top-bar/top-bar.tsx`, 높이는 36px다.
  - `.leading`(flex 1)에는 launcher와 breadcrumbs가, `.trailing`에는 waiting, notices, palette, settings가 있다. 그 뒤가 창 단추다.
  - breadcrumbs와 `.trailing` 사이는 비어 있는 drag 자리다. bar 전체가 `-webkit-app-region: drag`이고, button과 `[tabindex]`만 no-drag다.
- **native view.** `main/app-frame/`이 맡는다.
  - DOM 자리 → bounds: `renderer/app-frame/embedded-view.tsx`, `bounds.ts`. 자리 `<div>`를 재고, clip하는 조상으로 자르고, `useViewCover`로 등록한 cover를 뺀다. 남는 것 중 가장 큰 사각형 하나만 쓴다.
  - 순서: `main/app-frame/view-order.ts`는 `{overlay, attach, raise, remove}`뿐이고, overlay를 늘 맨 위로 다시 붙인다. 본문 view끼리는 순서 개념이 없다. 지금은 view끼리 겹치지 않기 때문이다.
  - menu, dialog, tooltip은 따로 띄운 overlay `WebContentsView`에 그린다(`main/app-frame/overlay.ts`). 그래서 native view를 가리지 않는다.
- **창 여럿.** shell 창은 이미 여럿 뜬다(`main/desktop/wiring/desktop-window.ts:61` `openDesktopWindow`, `ctx.windows`).
  - 창마다 overlay, `ContentsRegistry` 등록, `CloseGuard`, app view 소유가 따로 있다. `ipc-guard.ts`의 `checkCaller`는 webContents id로 보므로 창이 여럿이어도 된다.
  - renderer는 같은 `lophn-shell://desktop/index.html`에 hash route(`#project=`, `#settings`, `#app=`)로 시작 자리를 고른다(`renderer/desktop/router.ts`).
  - 앱 전용 창(`main/desktop/app-window.ts`)은 shell preload가 없는 framed 창에 app view 하나다. bounds는 되살리지 않는다.
- **kind별로 다른 창에 다시 붙이기.**
  - **terminal**: PTY는 terminal host에 있다. key는 `terminal_ref`와 `generation`이다(`main/terminal/supervisor.ts`). 어느 renderer든 `snapshot({terminal_ref, after_seq: 0})`로 다시 그릴 수 있다.
    - 탭 key → `terminal_ref` 표인 `TerminalStore`(`renderer/terminal/store.ts`)는 창마다 `sessionStorage`에 있다.
    - 입력은 `TerminalFocusTable`(`main/terminal/controller.ts`)에 등록된 webContents만 보낼 수 있다.
  - **editor**: 저장 안 된 글은 그 창 renderer 메모리의 `SaveSession`에 있다(`renderer/editor/save-state.ts`, autosave 800ms). `EditorSessions`는 창마다 하나다(`renderer/editor/window-deps.ts`). `detach(path)`가 flush한다.
    - 두 창이 같은 file을 열면 session이 따로다. 저장할 때 `base_hash`가 다르면 `conflict`다(`main/editor/file-adapter.ts`).
  - **agent**: session과 thread는 core에 있다. composer draft는 창마다 있는 `DraftStore`(`renderer/conversation/drafts.ts`)에만 있다.
  - **app_panel**: `WebContentsView`는 `entry.window`에 묶인다(`main/app-frame/registry.ts` `owner()`). 창을 바꾸는 API는 없다. `EmbeddedView`가 unmount되면 view를 닫는다.
- **kit.** `packages/design/components/overlay/`에 Dialog, Sheet, Popover, Menu, Palette, Toast, Tooltip이 있다. 옮기거나 크기를 바꾸는 패널 component는 없다. `_shared/resize.ts`가 있다.

## 무엇을 만드나

### 1. layout model (renderer, main schema)

- `WorkspaceView`에 `floats`를 더한다. 항목 하나는 `{tab, rect, minimized, origin_pane}`이다. 배열 순서가 위아래 순서이고, 마지막이 맨 위다.
- 탭 하나는 pane, floats, detached 중 한 곳에만 있다. 바꾸는 함수는 지금처럼 순수 함수다.
  - `floatTab`: preview 표시를 지운다. `moveTab`과 같다.
  - `dockTab`: 떠나 온 pane에 넣는다. 그 pane이 없으면 focus pane에 넣는다.
  - `minimizeFloat`, `restoreFloat`, `raiseFloat`, `detachTab`, `attachDetached`.
- schema에 `floats`와 `detached`를 더한다. `detached` 항목은 `{tab, bounds}`다.
  - popup으로 생긴 floated 탭은 저장하지 않는다(`TabItem`에 `transient` 표시).
  - 옛 layout 파일은 읽지 않는다. 개발 데이터는 지우고 새로 만든다(AGENTS.md "호환성").
- 되살릴 때 `rect`와 `bounds`를 지금 창과 화면 안으로 당긴다. 모니터를 뺐을 때 창이 화면 밖에 남지 않게 하려는 것이다.

### 2. floated (renderer)

- **층.** workspace `.content` 안, `Panes` 옆에 `.floats` 층을 둔다. pane의 자식이 아니다. 그래서 pane의 clip에 잘리지 않는다.
- **패널.** `packages/design`에 `FloatPanel` component를 새로 둔다(`ui-design` skill).
  - 위 bar를 끌면 옮겨지고, 가장자리와 모서리를 끌면 크기가 바뀐다. 끌기는 `renderer/workspace/drag.ts`의 `startPointerDrag`를 쓴다.
  - 가장 작은 크기는 320×200이다. 패널은 workspace `.content` 밖으로 나가지 못한다. 창이 줄면 안으로 당긴다.
  - 누르거나 focus가 들어오면 맨 위로 온다(`raiseFloat`).
- **본문.** floated 탭은 늘 보이므로 늘 mount한다. kind의 `render`를 그대로 부른다. kind마다 따로 할 일은 없다.
- **여는 길.**
  - 탭 menu에 Float와 Detach를 더한다.
  - 명령 `tab.float`, `tab.detach`, `tab.dock`, `float.minimize`를 더한다. 단축키는 `ipc/keybindings.ts` 표에 둔다.
  - 새 패널의 첫 rect는 `.content` 가운데, 너비와 높이의 60%다.
- **native view 층.** `view-order.ts`를 세 층으로 바꾼다: pane view < floated view(`floats` 순서) < overlay.
  - floated app panel이나 browser는 pane의 native view 위에 온다.
  - DOM 패널(terminal, editor, …)이 pane의 native view 위에 뜨면, 패널마다 `useViewCover`로 cover를 등록한다. native view는 패널 자리를 뺀 칸 중 가장 큰 사각형에 그린다(`renderer/app-frame/bounds.ts`의 `subtractCover`).

### 3. minimized (renderer)

- 상단 bar의 breadcrumbs 뒤, `.trailing` 앞에 span 줄을 둔다. span 하나는 `[icon 제목]` button이다. button이라 no-drag가 된다.
- span이 bar의 빈 자리를 넘으면, 넘는 것들을 `+N` button 하나로 묶는다. `+N`을 누르면 Menu로 고른다.
- 접힌 탭은 고르지 않은 docked 탭과 같이 다룬다. `keep` kind는 mount한 채 숨기고, 나머지는 unmount한다. terminal은 다시 펼 때 snapshot으로 다시 그린다.
- span의 right-click menu에는 Restore, Dock, Close가 있다.

### 4. detached (main, renderer)

- **창.** `openDesktopWindow`로 shell 창을 하나 더 띄운다. hash route `#detached=<tab key>`로 시작한다.
  - 이 창은 탭 하나만 그린다. 탭 줄도 sidebar도 없다. 위 bar에 제목, [Dock], 창 단추가 있다.
  - frameless이고, 상단 bar는 지금 `TopBar`를 쓴다.
- **누가 layout을 갖나.** project 창 renderer가 detached 항목까지 포함한 layout 전체를 갖고 저장한다.
  - detached 창은 자기 탭 하나를 main을 거쳐 받는다.
  - [Dock]을 누르거나 창을 닫으면 main에 알리고, main은 project 창에 `attachDetached`를 시킨다.
  - 창 bounds는 main이 저장할 때 채운다. 지금 `window_bounds`를 채우는 길과 같다.
- **창을 닫을 때.**
  - detached 창의 [×]는 탭을 닫지 않고 project 창으로 dock한다. 실수로 terminal을 잃지 않으려는 것이다. 탭을 닫으려면 탭 menu의 Close를 쓴다.
  - project 창을 닫으면 그 project의 detached 창도 함께 닫는다. 상태는 `detached`로 저장해 두었다가, 다시 열 때 되살린다.
- **탭 옮기기(transfer).** 저장 꼴(`toStored`)만으로는 살아 있는 상태가 옮겨지지 않는다. `TabKindDef`에 `transfer`(보내는 쪽)와 `receive`(받는 쪽)를 더한다. 값은 main을 거쳐 같은 project의 창끼리만 오간다.
  - **terminal**: `terminal_ref`와 `generation`을 넘긴다. 받는 창은 `snapshot`을 0부터 받고 focus를 등록한다. PTY는 그대로 산다.
  - **editor**: 보내기 전에 `detach(path)`로 flush하고, 받는 창은 disk에서 다시 연다. flush가 실패하면 옮기지 않고 탭을 그대로 둔다. 저장 안 된 글을 잃지 않는다.
  - **agent**: `DraftStore`의 그 탭 draft를 같이 넘긴다.
  - **app_panel, browser**: `WebContentsView`를 닫지 않고, 한 창에서 `removeChildView`하고 다른 창에서 `addChildView`한다. registry의 `entry.window`와 `owner()`, `closeWindow`를 함께 고친다. browser page를 다시 load하면 쓰던 form과 OAuth popup의 `window.opener`가 사라진다.
  - 나머지(`contexts`, `context`, `search`, `agents`)는 `toStored` 값으로 다시 연다.
- **detached 창 안의 popup.** detached 창에는 floats 층이 없다. 거기서 열린 browser popup은 `features`의 크기로 detached 창 하나로 연다(Chrome과 같다).

### 5. shell

- **wording.** 탭 menu의 Float, Detach, 패널 bar 단추 넷, span menu, detached 창의 [Dock]. `wording` skill을 따른다.
- **wireframes gallery.** `tools/wireframes/pages/screens/project-workspace.tsx`와 `project-window.tsx`에 다음 상태를 더한다.
  - docked editor 위의 floated terminal
  - floated 패널 둘이 겹친 모습(위아래)
  - 상단 bar의 minimized span 셋과 `+N`
  - 탭 menu의 Float, Detach
  - detached 창 하나(terminal)
  - docked app panel 위의 floated DOM 패널(cover로 줄어든 app view)

## 정한 것

- 상태는 docked, floated, minimized, detached 넷이고, 모든 탭 kind에 준다(사람).
- minimized는 상단 bar의 span이다(사람).
- floated, minimized, detached를 `layout.json`에 저장하고 되살린다. popup으로 생긴 floated 탭은 저장하지 않는다(사람).
- browser popup은 floated로 태어난다(사람, `browser-tab.md`).
- 탭 하나는 한 곳에만 있다(agent). 같은 탭을 두 자리에 그리면, editor는 session이 둘이 되어 conflict가 나고, terminal은 입력할 수 있는 webContents가 하나뿐이다.
- detached 창은 탭 하나만 갖는다(agent). 탭 줄이 있는 detached 창은 workspace를 하나 더 만드는 일이다. 탭 여럿을 보려면 detached 창을 여럿 띄운다.
- minimized는 floated에서만 간다(agent). detached 창의 minimize는 OS가 이미 한다.
- project 창 renderer가 layout 전체를 갖는다(agent). `layout.json`은 파일 하나에 project 하나이고 마지막에 쓴 것이 이긴다. 저장하는 곳이 둘이면 서로 덮는다.
- native view는 창을 옮길 때 다시 만들지 않고 옮겨 붙인다(agent). browser page의 상태와 `window.opener`를 지키려는 것이다.
- detached 창의 [×]는 dock이다(agent). 창을 닫는 손짓이 PTY와 저장 안 된 글을 지우면 안 된다.
- 옛 layout 파일을 옮겨 읽지 않는다(agent, AGENTS.md "호환성").
- DOM 패널이 docked native view(app panel, browser) 위에 뜨면 cover로 native view를 줄인다(agent). native view는 DOM 위에 그려지므로, 그대로 두면 floated terminal이 browser page 밑에 깔린다.
  - cover 길은 side panel과 project picker가 이미 쓰고 있어서 새 코드가 거의 없다. page도 계속 살아 있어서 HMR이 그대로 보인다.
  - 잃는 것: 패널을 옮길 때마다 page 크기가 바뀌어 다시 layout된다.
  - 버린 안: 겹치는 동안 마지막 `capturePage` 그림을 보이기(page가 멈춘다). DOM 패널도 native view로 띄우기(패널마다 shell renderer 하나라 가장 크다). cover가 쓰기 불편하면 그림 안으로 바꾼다.

## 단계

계획 둘로 연다. `browser-tab` 계획은 1이 land된 뒤에 연다.

1. **`workspace-float`**: layout model과 schema(floats), floated 층, `FloatPanel`, native view 세 층, minimized span, 탭 menu와 명령, gallery(1, 2, 3, 5의 floated·minimized).
   - layout model의 순수 함수와 schema를 첫 task로 둔다. 나머지가 모두 그 위에 선다.
2. **`workspace-detach`**: detached 창, layout 소유와 main 중계, `transfer`/`receive`, native view 옮겨 붙이기, 되살리기, gallery(1의 detached, 4, 5의 detached).

test(AGENTS.md "속도", `write-test` skill):
- layout 순수 함수 몇 개: float, dock, minimize, detach를 이어서 해도 탭이 사라지거나 둘이 되지 않는다.
- schema: popup 탭(`transient`)이 저장되지 않는다.
- editor transfer: flush가 실패하면 탭이 남고 글을 잃지 않는다.
- 창을 여럿 띄우는 Electron test는 새로 만들기 전에 사람에게 묻는다.

계획마다 끝에 고칠 것:
- `project-docs/architecture/workspace-layout.md`를 새로 쓴다: 탭 상태 넷, layout 소유, native view 층, transfer. `project-docs/context-component-registry.yaml`에 올린다.
- changelog 열린 판.
- 이 문서에서 그 계획 몫을 지운다.

## 끝남 기준

- terminal 탭을 Float하면 패널이 되고, 옮기고 크기를 바꾸고, 접으면 상단 bar span이 된다. span을 누르면 같은 자리로 돌아오고, Dock하면 떠나 온 pane으로 간다. 그동안 terminal 출력이 끊기지 않는다.
- floated browser 패널이 docked browser 탭 위에 보인다. floated terminal이 docked browser 탭 위에 보이고, browser page는 패널을 피한 칸에서 계속 돈다.
- 저장 안 된 글이 있는 editor 탭을 Detach하면 새 창에 같은 글이 있다. 창의 [×]를 누르면 project 창으로 돌아온다.
- 돌고 있는 terminal 탭을 Detach하면 새 창에 지난 출력이 보이고, 입력이 그 창에서 된다.
- lophn을 다시 띄우면 floated 패널의 위치, 접힌 span, detached 창의 bounds가 돌아온다. popup으로 뜬 패널은 돌아오지 않는다.

## 하지 않는 것

- 탭을 끌어 패널로 만들기, 패널을 탭 줄에 끌어 놓아 dock하기, 탭을 창 밖으로 끌어 detach하기. menu, 단추, 명령으로만 한다.
- pane 3개 이상, 자유 split(grid). pane은 지금처럼 2개까지다.
- 탭 줄이 있는 detached 창, detached 창끼리 탭 옮기기.
- 패널 snap(가장자리 붙기), 패널 투명도, 늘 위에 두기(always on top) OS 창.
- 다른 project 창으로 탭 옮기기.
- minimized span의 미리 보기(hover thumbnail).
