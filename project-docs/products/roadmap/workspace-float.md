# workspace float: 탭을 띄우고, 접고, 창으로 뗀다

상태: 로드맵. 2026-10-18 planner와 사람이 정했다. floated와 minimized(계획 `workspace-float`)는 land되었고 `project-docs/architecture/workspace-layout.md`가 정본이다. 남은 몫은 detached이고 계획 `workspace-detach`가 한다.
배경 문서: `project-docs/architecture/workspace-layout.md`, `project-docs/architecture/annotation.md`(app view identity), AGENTS.md "속도"·"호환성".
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

- **layout, floats 층, native view 층.** `project-docs/architecture/workspace-layout.md`에 있다. `WorkspaceView`는 `{panes, splitRatio, focusedPane, floats}`이고, `layout.json`은 판 2(`floats`까지)다. 탭을 찾고 바꾸는 곳은 `findTab`, `allTabs`, `mapTabs`로 pane과 floats를 모두 본다.
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
  - **app_panel**: `WebContentsView`는 `entry.window`에 묶인다(`main/app-frame/registry.ts` `owner()`). 창을 바꾸는 API는 없다. 같은 창 안에서는 `ViewKeeps`(`renderer/app-frame/view-keeps.ts`)가 탭 key로 view를 보관해 Float·Dock·접기에서 다시 쓴다. 창마다 하나라 다른 창으로는 넘어가지 않는다.
## 무엇을 만드나

### 1. layout model (renderer, main schema)

- floats 몫은 land되었다(`project-docs/architecture/workspace-layout.md`). 탭 하나는 pane, floats, detached 중 한 곳에만 있다. 바꾸는 함수는 지금처럼 순수 함수다.
  - `detachTab`, `attachDetached`를 더한다.
- schema에 `detached`를 더한다. 항목은 `{tab, bounds}`다. 판을 올리고 옛 판은 읽지 않는다(AGENTS.md "호환성").
- 되살릴 때 `bounds`를 지금 화면 안으로 당긴다. 모니터를 뺐을 때 창이 화면 밖에 남지 않게 하려는 것이다.

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
  - **app_panel, browser popup·DevTools**: native `WebContentsView`를 닫지 않고, 한 창에서 `removeChildView`하고 다른 창에서 `addChildView`한다. 소유 창은 app view는 `main/app-frame/registry.ts`, popup·DevTools는 `main/browser/registry.ts`의 `window`다. popup을 다시 load하면 OAuth의 `window.opener`가 사라진다.
  - **보통 browser 탭**: `<webview>` guest는 처음 붙은 창의 page에 묶여 옮길 수 없다. `toStored`의 URL로 다시 연다. cookie는 partition에 남고 page 상태는 사라진다(사람, `architecture/browser-tab.md`).
  - 나머지(`contexts`, `context`, `search`, `agents`)는 `toStored` 값으로 다시 연다.
- **detached 창 안의 popup.** detached 창에는 floats 층이 없다. 거기서 열린 browser popup은 `features`의 크기로 detached 창 하나로 연다(Chrome과 같다).

### 5. shell

- **wording.** 탭 menu의 Detach, 패널 bar의 [Detach], detached 창의 [Dock]. `wording` skill을 따른다.
- **wireframes gallery.** `tools/wireframes/pages/screens/project-workspace.tsx`에 detached 창 하나(terminal)와 탭 menu의 Detach를 더한다.

## 정한 것

- 상태는 docked, floated, minimized, detached 넷이고, 모든 탭 kind에 준다(사람).
- floated, minimized, detached를 `layout.json`에 저장하고 되살린다. popup으로 생긴 floated 탭은 저장하지 않는다(사람).
- browser popup은 floated로 태어난다(사람, `browser-tab.md`).
- 탭 하나는 한 곳에만 있다(agent). 같은 탭을 두 자리에 그리면, editor는 session이 둘이 되어 conflict가 나고, terminal은 입력할 수 있는 webContents가 하나뿐이다.
- detached 창은 탭 하나만 갖는다(agent). 탭 줄이 있는 detached 창은 workspace를 하나 더 만드는 일이다. 탭 여럿을 보려면 detached 창을 여럿 띄운다.
- minimized는 floated에서만 간다(agent). detached 창의 minimize는 OS가 이미 한다.
- project 창 renderer가 layout 전체를 갖는다(agent). `layout.json`은 파일 하나에 project 하나이고 마지막에 쓴 것이 이긴다. 저장하는 곳이 둘이면 서로 덮는다.
- native view는 창을 옮길 때 다시 만들지 않고 옮겨 붙인다(agent). browser page의 상태와 `window.opener`를 지키려는 것이다.
- detached 창의 [×]는 dock이다(agent). 창을 닫는 손짓이 PTY와 저장 안 된 글을 지우면 안 된다.
- 옛 layout 파일을 옮겨 읽지 않는다(agent, AGENTS.md "호환성").

## 단계

남은 계획은 `workspace-detach` 하나다: detached 창, layout 소유와 main 중계, `transfer`/`receive`, native view 옮겨 붙이기, 되살리기, gallery(1, 4, 5의 detached 몫).

test(AGENTS.md "속도", `write-test` skill):
- layout 순수 함수: detach와 attach를 섞어도 탭이 사라지거나 둘이 되지 않는다(`model_test.ts`의 float 위험 test에 붙인다).
- editor transfer: flush가 실패하면 탭이 남고 글을 잃지 않는다.
- 창을 여럿 띄우는 Electron test는 새로 만들기 전에 사람에게 묻는다.

끝에 고칠 것:
- `project-docs/architecture/workspace-layout.md`에 detached, layout 소유, transfer를 더한다.
- changelog 열린 판.
- 이 문서를 지운다.

## 끝남 기준

- 저장 안 된 글이 있는 editor 탭을 Detach하면 새 창에 같은 글이 있다. 창의 [×]를 누르면 project 창으로 돌아온다.
- 돌고 있는 terminal 탭을 Detach하면 새 창에 지난 출력이 보이고, 입력이 그 창에서 된다.
- lophn을 다시 띄우면 detached 창의 bounds가 돌아온다.

## 하지 않는 것

- 탭을 끌어 패널로 만들기, 패널을 탭 줄에 끌어 놓아 dock하기, 탭을 창 밖으로 끌어 detach하기. menu, 단추, 명령으로만 한다.
- pane 3개 이상, 자유 split(grid). pane은 지금처럼 2개까지다.
- 탭 줄이 있는 detached 창, detached 창끼리 탭 옮기기.
- 패널 snap(가장자리 붙기), 패널 투명도, 늘 위에 두기(always on top) OS 창.
- 다른 project 창으로 탭 옮기기.
- minimized span의 미리 보기(hover thumbnail).
