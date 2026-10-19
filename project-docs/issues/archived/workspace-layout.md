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
