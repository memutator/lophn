# workspace-layout (닫음)

project 창의 탭 자리(docked, floated, minimized)와 layout 저장. architecture: `project-docs/architecture/workspace-layout.md`.

## 다시 띄운 plain terminal과 app panel 탭의 제목이 비어 있다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/main]
closed: fixed
guard: 없음
```

- 지금: `renderer/workspace/kinds/terminal.tsx`의 `fromStored`는 coding이 아닌 terminal을 `title: ""`로 되살리고, 제목은 PTY가 뜬 뒤 `onStarted`의 `patchTab`이 채운다. `kinds/app-panel.tsx`는 `toStored`에 제목을 남기지 않고 `fromStored`가 `title: ""`를 내며, 앱을 고를 때 말고는 제목을 채우는 곳이 없다. 탭 줄(`parts/tab-strip/tab-strip.tsx`), floated 패널 bar(`workspace/floats/floats.tsx`), 접힌 span(`workspace/minimized/minimized-bar.tsx`)은 `tab.title`을 그대로 그린다.
- 영향: lophn을 다시 띄우면 고르지 않은 terminal 탭, 접힌 terminal span, app panel 탭과 그 패널 bar·span이 아이콘만 남고 이름이 없다(접힌 terminal은 mount되지 않아 펴기 전까지 그대로다). app panel이 docked면 breadcrumbs 끝도 빈다. 사람이 어느 패널인지 모르고 span을 하나씩 눌러 봐야 한다. gallery `new-float-minimized`가 이 때문에 coding terminal만 쓴다.
- 고치려면:
  - 작음(추천): 두 kind의 `toStored`·`fromStored`가 제목을 저장하고 되살린다. layout schema의 그 kind 탭 schema에 `title` 칸을 더한다(판 2 안에서, 개발 data는 지운다).
  - 작음: 그리는 세 곳이 빈 제목이면 kind 이름(`tabKindLabel`)을 쓴다. 저장은 그대로지만 terminal 여럿이 모두 "Terminal"로 보인다.
- 닫음: plain terminal과 app panel 탭이 `layout.json`에 선택 칸 `title`을 남기고 되살린다(main `workspace/kinds/terminal.ts`·`app-panel.ts`의 schema, renderer `kinds/terminal.tsx`·`app-panel.tsx`의 `toStored`·`fromStored`). coding terminal은 전처럼 `coding.title`이다.

## 접어 둔 app panel을 다시 펴면 view 상태가 접을 때의 것이다

```yaml
kind: bug

## detached 창의 TabHost slice가 Workspace의 사본이다

```yaml
kind: defect
modules: [packages/shell/renderer]
closed: fixed
guard: 없음
```

- 지금: `EmbeddedView`(`renderer/app-frame/embedded-view.tsx`)는 mount된 동안만 `subscribeViewState`를 듣는다. Float·Dock·접기로 unmount되면 view는 `ViewKeeps`(`renderer/app-frame/view-keeps.ts`)에 `state`와 함께 보관되고, 그동안 main이 보낸 state(`viewHealth`의 unresponsive·crashed, `connectionState`)는 아무도 받지 않는다. 다시 mount하면 `take`가 준 보관 `state`를 그대로 보인다.
- 영향: minimized나 다른 자리로 옮기는 사이에 app view가 죽거나 연결이 끊기면, 다시 편 탭이 "정상"으로 보이고 [새 view 열기]가 안 나온다. 사람은 빈 화면이나 멈춘 앱을 보고 탭을 닫았다 열어야 한다.
- 고치려면: `ViewKeeps`가 보관하는 동안 `subscribeViewState`를 하나 들어 그 session의 `state`를 갱신한다(추천, 몇 줄). 또는 `take` 뒤에 main에 지금 state를 묻는다(새 IPC가 필요하다).
- 닫음: `ViewKeeps.watch`가 `subscribeViewState`를 창마다 한 번 들어, mount된 view든 보관 중인 view든 session이 같은 `state`를 최신으로 갱신한다(`renderer/app-frame/view-keeps.ts`, `embedded-view.tsx`가 mount 때 `watch`를 건다). 다시 mount(`take`)와 Detach(`lookup`)가 접힌 사이의 unresponsive·crashed·connection 상태를 본다.

- 지금: `renderer/workspace/detached/detached-space.tsx`의 `DetachedTab`이 `Workspace`(`renderer/workspace/workspace.tsx`)가 `TabHost`를 만드는 줄을 따라 썼다: `useSidebarAgents`·`useSessions`·`useConversation`과 `localDrafts`, `contexts` slice(`readContexts`, `titleOf`, `openPath`, `askProjectManager`), `agentView`·`agents` slice, `createViewCovers`·`createViewKeeps`·`createWebviewHost`와 provider. 벌써 갈라졌다: `contexts.openPath`가 상대 path를 `Workspace`처럼 열린 파일 목록에서 찾지 않고 첫 폴더에 붙인다.
- 영향: `TabHost` slice를 고치면 두 곳을 고쳐야 하고, 빠뜨리면 같은 탭이 detached 창에서만 다르게 동작한다(위 `openPath`처럼 다른 폴더의 같은 이름 파일을 연다).
- 고치려면: 두 곳이 같이 쓰는 hook(`useTabHostSlices(project, sources)`)으로 slice를 모은다(중간). 추천.
- 닫음: `renderer/workspace/use-tab-host-slices.ts`의 `useTabHostSlices`가 `Workspace`와 `DetachedTab`의 sidebar agents·sessions·conversation·drafts·contexts·agent view·agents slice와 view 보관소(covers, keeps, webviews)를 한 곳에서 만든다. detached 창의 `contexts.openPath`도 이제 열린 파일 목록을 먼저 본다.

## agent 새 탭의 key와 재사용이 pane의 탭만 본다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: `renderer/workspace/kinds/agent.tsx`의 `freshKey`와 `agentTabs`(`reusable`이 쓴다)가 `host.view.panes`만 본다. floats와 detached에 있는 agent 탭의 key를 모르므로 `agent:<agent>:1`이 floated나 detached 탭에 있어도 새 탭에 같은 key를 고른다. 그러면 `Workspace.openTab`이 새로 만들지 않고 그 탭을 고른다(detached면 그 창을 앞으로 가져온다). detached 창에서는 `host.view`가 그 창의 탭 하나뿐이라(`renderer/workspace/detached/detached-space.tsx`) project 창의 pane에 있는 agent 탭과도 겹친다. 이 창의 `openTab`은 project 창에 탭을 열라고 보내고(`open-tab`), project 창은 같은 key의 탭을 고른다.
- 영향: floated·detached agent 탭이 있거나 detached 창에서 같은 agent의 새 대화를 열면 새 탭 대신 이미 있는 대화가 앞에 온다. 사람은 새 대화를 열 수 없고, 아직 말하지 않은 같은 시작의 탭을 찾는 재사용도 floated·detached 탭을 놓친다.
- 고치려면: (1) `freshKey`·`agentTabs`가 `allTabs(host.view)`를 본다(작음). project 창 안의 겹침이 없어진다. (2) detached 창에서 연 agent 새 탭은 project 창이 `open-tab`을 받을 때 key가 겹치고 session이 다르면 새 번호로 바꿔 연다(작음). 추천: 둘 다.
- 닫음: `freshKey`와 `agentTabs`가 `allTabs(host.view)`를 본다. detached 창이 연 agent 새 탭은 project 창이 `open-tab`을 받을 때 `distinctAgentTab`이 key가 겹치고 session이 다르면 새 번호로 바꿔 연다(`renderer/workspace/kinds/agent.tsx`).

## detached 창에서 DevTools를 floated로 옮기면 DevTools가 보이지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

- 지금: DevTools 자리 menu(`renderer/browser/browser-toolbar.tsx`의 `float`)를 고르면 `setDevtools`(`renderer/workspace/kinds/browser-devtools.tsx`)가 탭의 `fields.devtools.place`를 `float`로 바꾸고 `host.openFloat`로 `browser_devtools` 패널을 연다. detached 창의 `host.openFloat`는 `fields.adopt`가 있는 popup만 열고 나머지는 아무것도 하지 않는다(`renderer/workspace/detached/detached-space.tsx`). 그 창에는 floats 층이 없다. 그래서 탭은 DevTools를 탭 안(`right`·`bottom`)에도 따로 뜬 창(`window`)에도 그리지 않는다.
- 영향: detached browser 탭에서 DevTools를 floated로 옮긴 사람은 DevTools를 잃는다. 다시 보려면 자리를 다시 골라야 한다.
- 고치려면: (1) detached 창에서는 자리 menu에 `float`를 두지 않는다(작음, 추천). (2) detached 창의 `openFloat`가 DevTools 패널을 받으면 `window`로 바꾼다(작음).
- 닫음: detached 창 안의 browser toolbar는 DevTools 자리 menu에서 `float`를 뺀다. `DetachedTab`이 `DetachedWindowProvider`(`renderer/browser/detached-window.ts`)로 알리고 `BrowserToolbar`가 읽는다.

## detached 창 안의 popup이 features의 크기를 따르지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/main]
```

- 지금: detached 창 안에서 크기 준 popup이 열리면 `host.openFloat(tab, size)`가 `lophnDetached.open({ bounds: null })`로 또 하나의 detached 창을 연다(`renderer/workspace/detached/detached-space.tsx`). `size`를 버리고 main은 기본 창 크기(960×600, 최소도 같다, `main/desktop/window.ts`)로 연다. roadmap은 "`features`의 크기로 연다(Chrome과 같다)"였다.
- 영향: detached browser 탭에서 OAuth 로그인 popup이 작은 창이 아니라 큰 창으로 뜬다. 동작은 된다.
- 고치려면: `open`의 `bounds`에 opener 창 가운데 `size` 크기를 넣고, main이 detached 창에만 작은 최소 크기를 쓴다(작음). 지금 최소 크기를 다른 창과 같게 둔 것은 따로 정할 근거가 없어서다.
- 닫음: `DetachedTab`의 `openFloat`가 opener 창 가운데 popup `size`(page 영역이라 상단 바 높이를 더한다)를 `open`의 bounds로 보낸다. main은 detached 창에만 최소 크기 320×240을 쓰고(`window.ts`의 `detached` 옵션) 화면 작업 영역 안으로 당긴다.

## project를 떠났다 돌아온 detached terminal이 PTY에 다시 붙지 못한다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/main]
```

- 지금: project 창을 닫거나 다른 공간으로 가면 `Workspace`가 `lophnDetached.close({ key: null })`로 detached 창을 조용히 닫는다(`renderer/workspace/workspace.tsx`). 다시 열면 저장된 값으로 `open({ transfer: null })`만 부른다. terminal 탭의 `terminal_ref`는 `transfer`로만 오고 detached 창의 `TerminalStore`(창마다 `sessionStorage`)는 창과 같이 사라졌으므로, 새 창의 `TerminalTab`(`renderer/terminal/terminal-tab.tsx`)은 runtime 없는 끝난 탭으로 그린다. 같은 실행 안이면 PTY는 terminal host에 그대로 돌고 있다.
- 영향: 같은 실행에서 project를 다시 열기만 해도 detached terminal의 출력과 돌던 명령(dev server, coding agent)에 다시 닿을 수 없다. PTY는 앱을 끌 때까지 남는다. docked·floated terminal은 같은 경우에 다시 붙는다.
- 고치려면: (1) main이 조용히 닫은 detached 창 항목의 마지막 탭 값과 transfer를 (project, key)로 이 실행 동안 들고 있다가 같은 key의 `open({ transfer: null })`에 쓴다(중간). terminal의 마지막 `terminal_ref`·`generation`은 detached 창이 `changed`로 알리는 탭 값에 실어야 한다. (2) 떠날 때 detached 창을 닫지 않고 dock시킨다(작음, 대신 다시 열 때 창이 돌아오지 않는다). 추천: (1).
- 닫음: detached 창이 `changed`의 `resume`(kind의 `resume`, terminal은 PTY 참조)을 알리고 main이 `DetachedRegistry`에 이 실행 동안만 들고 있다가, project를 떠나며 조용히 닫힌 창의 값을 (project, key)로 남겨 같은 key의 `open({ transfer: null })`에 한 번 쓰고 지운다. 개별 close·dock·remove와 앱 종료에서도 지우고 디스크에는 쓰지 않는다.
