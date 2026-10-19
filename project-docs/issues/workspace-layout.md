# workspace-layout

project 창의 탭 자리(docked, floated, minimized)와 layout 저장. architecture: `project-docs/architecture/workspace-layout.md`.

## agent 새 탭의 key와 재사용이 pane의 탭만 본다

## 접어 둔 app panel을 다시 펴면 view 상태가 접을 때의 것이다

```yaml
kind: bug
modules: [packages/shell/renderer]
```

지금: `renderer/workspace/kinds/agent.tsx`의 `freshKey`와 `agentTabs`(`reusable`이 쓴다)가 `host.view.panes`만 본다. floats와 detached에 있는 agent 탭의 key를 모르므로 `agent:<agent>:1`이 floated나 detached 탭에 있어도 새 탭에 같은 key를 고른다. 그러면 `Workspace.openTab`이 새로 만들지 않고 그 탭을 고른다(detached면 그 창을 앞으로 가져온다). detached 창에서는 `host.view`가 그 창의 탭 하나뿐이라(`renderer/workspace/detached/detached-space.tsx`) project 창의 pane에 있는 agent 탭과도 겹친다. 이 창의 `openTab`은 project 창에 탭을 열라고 보내고(`open-tab`), project 창은 같은 key의 탭을 고른다.

영향: floated·detached agent 탭이 있거나 detached 창에서 같은 agent의 새 대화를 열면 새 탭 대신 이미 있는 대화가 앞에 온다. 사람은 새 대화를 열 수 없고, 아직 말하지 않은 같은 시작의 탭을 찾는 재사용도 floated·detached 탭을 놓친다.

고치려면: (1) `freshKey`·`agentTabs`가 `allTabs(host.view)`를 본다(작음). project 창 안의 겹침이 없어진다. (2) detached 창에서 연 agent 새 탭은 project 창이 `open-tab`을 받을 때 key가 겹치고 session이 다르면 새 번호로 바꿔 연다(작음). 추천: 둘 다.

지금: `EmbeddedView`(`renderer/app-frame/embedded-view.tsx`)는 mount된 동안만 `subscribeViewState`를 듣는다. Float·Dock·접기로 unmount되면 view는 `ViewKeeps`(`renderer/app-frame/view-keeps.ts`)에 `state`와 함께 보관되고, 그동안 main이 보낸 state(`viewHealth`의 unresponsive·crashed, `connectionState`)는 아무도 받지 않는다. 다시 mount하면 `take`가 준 보관 `state`를 그대로 보인다.

영향: minimized나 다른 자리로 옮기는 사이에 app view가 죽거나 연결이 끊기면, 다시 편 탭이 "정상"으로 보이고 [새 view 열기]가 안 나온다. 사람은 빈 화면이나 멈춘 앱을 보고 탭을 닫았다 열어야 한다.

고치려면: `ViewKeeps`가 보관하는 동안 `subscribeViewState`를 하나 들어 그 session의 `state`를 갱신한다(추천, 몇 줄). 또는 `take` 뒤에 main에 지금 state를 묻는다(새 IPC가 필요하다).

## project를 떠났다 돌아온 detached terminal이 PTY에 다시 붙지 못한다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/main]
```

지금: project 창을 닫거나 다른 공간으로 가면 `Workspace`가 `lophnDetached.close({ key: null })`로 detached 창을 조용히 닫는다(`renderer/workspace/workspace.tsx`). 다시 열면 저장된 값으로 `open({ transfer: null })`만 부른다. terminal 탭의 `terminal_ref`는 `transfer`로만 오고 detached 창의 `TerminalStore`(창마다 `sessionStorage`)는 창과 같이 사라졌으므로, 새 창의 `TerminalTab`(`renderer/terminal/terminal-tab.tsx`)은 runtime 없는 끝난 탭으로 그린다. 같은 실행 안이면 PTY는 terminal host에 그대로 돌고 있다.

영향: 같은 실행에서 project를 다시 열기만 해도 detached terminal의 출력과 돌던 명령(dev server, coding agent)에 다시 닿을 수 없다. PTY는 앱을 끌 때까지 남는다. docked·floated terminal은 같은 경우에 다시 붙는다.

고치려면: (1) main이 조용히 닫은 detached 창 항목의 마지막 탭 값과 transfer를 (project, key)로 이 실행 동안 들고 있다가 같은 key의 `open({ transfer: null })`에 쓴다(중간). terminal의 마지막 `terminal_ref`·`generation`은 detached 창이 `changed`로 알리는 탭 값에 실어야 한다. (2) 떠날 때 detached 창을 닫지 않고 dock시킨다(작음, 대신 다시 열 때 창이 돌아오지 않는다). 추천: (1).

## detached 창 안의 popup이 features의 크기를 따르지 않는다

```yaml
kind: bug
modules: [packages/shell/renderer, packages/shell/main]
```

지금: detached 창 안에서 크기 준 popup이 열리면 `host.openFloat(tab, size)`가 `lophnDetached.open({ bounds: null })`로 또 하나의 detached 창을 연다(`renderer/workspace/detached/detached-space.tsx`). `size`를 버리고 main은 기본 창 크기(960×600, 최소도 같다, `main/desktop/window.ts`)로 연다. roadmap은 "`features`의 크기로 연다(Chrome과 같다)"였다.

영향: detached browser 탭에서 OAuth 로그인 popup이 작은 창이 아니라 큰 창으로 뜬다. 동작은 된다.

고치려면: `open`의 `bounds`에 opener 창 가운데 `size` 크기를 넣고, main이 detached 창에만 작은 최소 크기를 쓴다(작음). 지금 최소 크기를 다른 창과 같게 둔 것은 따로 정할 근거가 없어서다.

