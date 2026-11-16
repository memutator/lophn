# remote-desk-renderer

**opus high.** renderer가 다른 기계의 창에서 그 기계의 lophn을 그린다. 창이 다른 기계의 것이면(`lophnMachines.thisWindow()`) 같은 `windowCoreSource()` 위에 볼 수 있는 source만 짓고, 이 컴퓨터의 shell host가 필요하거나 기기가 부를 수 없는 기능은 감추며 그런 탭 자리에는 `OnlyHere`를 세운다. 처음 붙기 전과 지워졌을 때는 `MachineGate`, Settings 자리는 `RemoteSettings`다. 모든 창의 title bar에 `MachineSwitcher`를 달고, 이 컴퓨터 창 Settings › Remote의 "Computers you view"를 실제 source에 잇는다. 기기 route 목록에 `unseen/list|dismiss`를 더한다.

- 단위: desk-renderer (wave 3)
- 선행: remote-desk-screens, remote-desk-viewer. 사람이 `remote-desk-screens`의 gallery를 승인한 뒤에 띄운다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/entry.tsx`
  - `packages/shell/renderer/desktop/main.tsx`
  - `packages/shell/renderer/desktop/machines`(실제 bridge의 `window-source.ts`를 더하고 조각을 맞춘다)
  - `packages/shell/renderer/desktop/connection/connection.tsx`
  - `packages/shell/renderer/desktop/settings/settings-space.tsx`
  - `packages/shell/renderer/desktop/workspaces`
  - `packages/shell/renderer/desktop/jobs`
  - `packages/shell/renderer/desktop/palette`
  - `packages/shell/renderer/workspace`
  - `packages/shell/renderer/shell`
  - `packages/protocol/remote/allowlist.ts`
  - `packages/design/i18n/catalog/remote-desk.ts`(key만 더한다)
  - `project-docs/flows/areas/core-platform.yaml`
  - `project-docs/flows/areas/shell-workspace.yaml`
  - `project-docs/flows/journeys`
  - `project-docs/flows/scenarios`
- 읽을 것:
  - 계획: `project-docs/plan/desktop-remote/README.md`의 "정한 것"(권한은 폰과 같다, `unseen`, 창마다 한 기계, 끄는 기능과 자리 표시, Settings 자리, layout 저장 안 함, 이름이 늘 보인다, 꺼진 기계가 막지 않음, queue 없음)과 "다른 계획이 기대는 계약" 3·4
  - 앞 task의 결과: `packages/shell/renderer/desktop/machines/*`와 `settings/remote/viewed-machines.tsx`(screens), `packages/shell/ipc/machines.ts`의 `LophnMachinesApi`와 `MachineList`(viewer, windows), windows 보고의 "renderer가 그 창에서 부르다 거절된 channel"과 허락한 bridge 목록(`remote-desk-windows.md`의 "내놓는 것")
  - architecture: `project-docs/architecture/remote.md`(지키는 것 1: 화면이 목록 밖 route를 부르는 단추를 보이지 않는다, 2: desktop 화면에 폰 분기가 없다), `project-docs/architecture/workspace-layout.md`, `project-docs/architecture/attention.md`(unseen과 finished 점), `project-docs/architecture/settings.md`
  - 기기 route 목록: `packages/protocol/remote/allowlist.ts`의 `REMOTE_ALLOWED_ROUTES`와 그 머리 주석(무엇을 넣지 않는가), `packages/protocol/attention/routes.ts`의 `unseenList`·`unseenDismiss`
  - 지금 코드: `desktop/entry.tsx`(module 수준 `core`와 source 스무 개, bridge를 `globalThis`에서 읽는 곳, mock 꼴), `desktop/main.tsx`(`Desktop` prop은 거의 다 선택이다), `connection/connection.tsx`(`ConnectionGate`, `ConnectionNotice`, `retryConnection`), `shell/layout-source.ts`(`lophnLayout`이 없으면 메모리), `workspace/add-tab-menu.tsx`(새 탭 menu), `workspace/kinds`(탭 종류), `workspace/workspace-window.tsx`·`settings/settings-space.tsx`·`workspaces/home-gate.tsx`(`ShellFrame`을 쓰는 셋), `conversation/report-visible.ts`(`lophnNotice.visible`), 폰이 같은 data를 그리는 방식 `packages/mobile/src/data/link.ts`(event client, Inbox store, 대화 source만)
- 계약:
  - 쓰는 것: `MachinesSource`·`MachinesProvider`·`MachineSwitcher`·`MachineGate`·`OnlyHere`·`RemoteSettings`·`ViewedMachines`(screens), `LophnMachinesApi`(viewer, windows), 다른 기계의 창 preload가 여는 bridge(windows)
  - 내놓는 것: `machines/window-source.ts`의 `windowMachinesSource(): MachinesSource | null`(bridge가 없으면 null), `REMOTE_ALLOWED_ROUTES`의 `unseenList`·`unseenDismiss`

## 할 일

1. `entry.tsx`: mount 전에 `lophnMachines?.thisWindow()`를 한 번 기다린다(지금 mock처럼 top-level await). null이면 지금과 같다(그리고 `MachinesProvider`에 `windowMachinesSource()`를 준다). 기계가 있으면 다른 기계 모드다:
   - 짓는 것: `core`, `events`, `projects`(folder picker 없이), `apps`, `catalog`, `jobs`, `workspace`, `agentViewSource`(`signIn` 없이), `projectIcons`, palette의 검색(file 검색은 `project_search`).
   - 짓지 않는 것: `settings`, `settingsPanels`, `quickPrefs`의 core 쓰기(읽기가 `forbidden`이면 기본값으로 메모리에서만), `appDetail`의 관리, `views`·`appViews`·`annotate`·`browser`·`artifact`, `hookPrompt`, `detached`, 터미널 bridge, 편집기 deps. bridge가 없을 때 이미 감추는 곳은 그대로 두고, 비어서 깨지거나 단추가 남는 곳만 고친다.
   - React context로 "이 창의 기계"(`{ id, name }`)를 내려 아래 2·3이 읽는다(prop을 여러 층으로 내리지 않는다). 폰을 위한 분기가 아니라 desktop 자신의 모드다.
2. 감추기와 자리 표시(README "정한 것"의 끄는 목록을 하나씩): 새 탭 menu에서 터미널·파일·browser·앱 화면·coding agent 줄을 뺀다. 앱 공간은 session과 실행 기록만이고 앱 화면 탭과 App details의 관리 단추가 없다. 다른 이유로 그런 탭이 열리려 하면(저장된 링크, palette의 file 결과, 대화 안 file 링크) 그 탭 자리에 `OnlyHere`. coding agent session은 목록에 내지 않는다(그 기계의 터미널에 있다). Jobs는 켜고 끄기만(만들기·고치기·거절 없음). project 등록·보관·설정, agent 만들기·고치기, extension, thread bookmark를 감춘다. Settings 공간은 `RemoteSettings`. 이 기계의 창에서 렌더러가 부르는 route 가운데 `forbidden`이 오는 것을 개발에서 모두 찾아(windows 보고, devtools) 그 단추나 칸을 감춘다(remote.md 지키는 것 1).
3. gate(`connection.tsx`와 `main.tsx`): 다른 기계 모드에서 한 번도 ready가 아니었으면 `ConnectionGate` 대신 `MachineGate`(그 기계의 status가 connecting·offline·removed). [Try again]은 지금의 `retryConnection`(main이 그 연결을 다시 붙인다), [This computer]는 `open(this.id)`. 한 번 붙은 뒤의 끊김은 지금의 `ConnectionNotice`다. status가 removed가 되면 언제든 `MachineGate`(removed).
4. title bar: `ShellFrame`을 쓰는 세 곳(`workspace-window.tsx`, `settings-space.tsx`, `home-gate.tsx`)이 `machineSwitcher={<MachineSwitcher onPairAnother={…} />}`를 준다. 이 컴퓨터 창에서 줄을 누르면 `open(id)`, "Pair another computer…"는 이 컴퓨터 창이면 그 창의 Settings › Remote로 가고, 다른 기계 창이면 `open(this.id)`로 이 컴퓨터 창을 앞으로 가져오기만 한다(창 사이에 길을 새로 만들지 않는다).
5. `window-source.ts`: `LophnMachinesApi`를 `MachinesSource`로(snake_case → camelCase, `onChanged`가 통째로 바꾼다, pair reason 옮기기). entry가 `MachinesProvider`로 준다. 이 컴퓨터 창의 Settings › Remote "Computers you view"가 그것으로 돈다.
6. 기기 route 목록: `REMOTE_ALLOWED_ROUTES`에 `unseenList`, `unseenDismiss`를 더하고 머리 주석에 한 줄(보는 것이 읽음을 만든다. 읽음은 host에 있다). `StateChanged{unseen}`는 이미 받는다. 이 밖에 더하지 않는다. 더 필요해 보이면 관리 route인지 보고 넣지 않고 보고한다.
7. 보이는 것 알리기: `report-visible.ts`는 그대로 `lophnNotice.visible`을 부른다(다른 기계의 창에서는 preload가 그 기계 presence로 보낸다). 확인만 한다.
8. i18n: 새 문구는 `remote-desk.ts`에 key만.
9. flows: `areas/core-platform.yaml`의 기기 route 목록 flow에 `unseen/*`, `areas/shell-workspace.yaml`에 다른 기계 모드의 화면 흐름(`ui:` flow. 감추는 것과 자리 표시, gate), journey 하나 "이 desktop에서 다른 컴퓨터의 lophn 열기"(pairing → 고르기 → 대화와 승인 → 꺼짐과 다시 붙음. screen은 `remote-desk-screens`의 gallery id)와 그 scenario. `node tools/flows.ts check`.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 선다.
- `npm run wireframes`가 되고 `shell-machine-*` page가 실제 감추기와 함께 그려진다(gallery가 쓰는 shell scene이 이 모드를 받으면).
- 위험 test: 없음(화면. 권한 경계는 host의 기기 route 목록과 `remote-desk-windows`의 test가 본다).
- 개발에서 본다: `remote-desk-windows`의 두 번째 desktop(`tools/dev.ts` option)과 개발 core(host)로 README "lead가 할 일"의 손 확인 1~7을 먼저 돌려 보고 결과를 적는다. 그림은 `.dev-data/remote-desk-renderer/shots/`. 사람의 `~/.lophn`, 실제 relay, 실제 provider를 쓰지 않는다. 띄운 process는 끝에 모두 정리한다.
- 남지 않음: 다른 기계의 창에서 `forbidden`을 받는 단추가 없다(개발에서 찾은 목록과 고친 곳을 보고한다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 끄는 기능마다 무엇이 그것을 감추는지(bridge 없음 / context로 감춤 / 자리 표시) 표, 다른 기계 창에서 부르는 route 목록과 그 결과, 손 확인 1~7의 결과와 그림 path, lead가 고칠 목록(`architecture/remote.md`, `architecture/workspace-layout.md`, `architecture/settings.md`).
