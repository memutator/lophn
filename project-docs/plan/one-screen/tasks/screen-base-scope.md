# screen-base-scope

renderer에 "어느 기계"를 고르는 범위(scope)를 놓는다. 범위 안의 읽기·부르기·event는 그 기계로 가고, 기계마다의 source 묶음은 hub가 든다. `entry.tsx`와 `workspace-window.tsx`의 창 단위 "다른 기계" 갈래를 범위가 주는 능력으로 바꾸고, wave 2 task가 고칠 factory 자리(터미널, 앱 화면)를 따로 둔다. 탭과 목록 줄과 workspace가 기계를 드는 type을 정하고 `architecture/remote.md`를 새 모양으로 초안한다. preload·shell main·core 쪽은 `screen-base-core`가 같은 wave에 나란히 짓는다. 기계마다의 창은 지우지 않는다(`screen-windows`).

- 단위: screen (wave 1)
- 선행: 없음. `multi-device-fixes`가 main에 올라가고, 아래 "같이 쓰는 계약"의 lead commit이 plan branch에 있을 때 띄운다.
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/connection/connection.ts`, `packages/shell/renderer/desktop/connection/events/hooks.tsx`
  - `packages/shell/renderer/desktop/machines/{context.tsx,scope.tsx,data.ts,core-source.ts,tab-scope.tsx}`(뒤 넷은 새 file)
  - `packages/shell/renderer/desktop/{entry.tsx,main.tsx}`, `packages/shell/renderer/workspace/{workspace-window.tsx,model.ts}`, `packages/shell/renderer/workspace/kinds/{kind.ts,host.ts}`, `packages/shell/renderer/shell/{desk-model.ts,layout-source.ts}`
  - `packages/shell/renderer/terminal/machine-deps.ts`(새 file), `packages/shell/renderer/app-frame/machine-deps.ts`(새 file)
  - `packages/shell/renderer/desktop/settings/core-call.ts`, `packages/shell/renderer/conversation/input-request-card/input-request-card.tsx`(보호 창을 여는 줄만)
  - `project-docs/architecture/remote.md`
- 읽을 것:
  - 계획 README "정한 것" 전부, roadmap `project-docs/products/roadmap/multi-device.md` "가리키는 법"·"어떻게 보이나"
  - 조사 `reports/multi-device/survey-n1-one-screen.md` 1.3·1.6, G2·G3, 4(seam: `EventClient.core`), 9(병렬 위험), 부록 B(겹치는 key)
  - architecture: `project-docs/architecture/remote.md` "desktop에서 다른 기계 보기"와 지키는 것, `workspace-layout.md` "저장"
  - 지금 code: `desktop/connection/core-read.ts`(`useCoreRead`가 `client.core`를 읽는다), `events/client.ts`(고치지 않는다), `desktop/machines/source.ts`, 폰의 같은 묶음 `packages/mobile/src/data/link.ts`(`dataOf`)
- 계약:
  - 쓰는 것: 아래 "같이 쓰는 계약", `CoreSource`, `EventClient`, `MachinesSource`
  - 내놓는 것: 아래 "고정할 모양". wave 2·3 task는 이 이름만 쓴다.

시작 전에 다시 볼 것: `multi-device-fixes`가 renderer에서 바꾼 것(`fix-setup`의 화면만 막던 로그인 종류, `fix-terminals`의 터미널 열기)이 `entry.tsx`·`input-request-card.tsx`의 갈래를 바꿨는지 merge된 code와 댄다. `core-browser`의 `page-view-desktop`이 먼저 main에 올라갔으면 `workspace-window.tsx`의 `onPages` 갈래(`machine !== null`)도 아래 규칙으로 바꾼다(`data.here`가 아닐 때).

## 같이 쓰는 계약(screen-base-core와 screen-base-scope의 brief에 같은 글)

lead가 두 task를 띄우기 전에 plan branch에 계약 commit으로 넣는다. 두 task는 이 file들을 고치지 않는다.
- `packages/shell/ipc/core.ts`: `coreCallSchema`, `coreWatchSchema`, `coreEventMessageSchema`의 세 variant에 `machine`(`mch_<ULID>`) optional. 없으면 이 컴퓨터, 있으면 그 기계다.
- `packages/shell/ipc/core-api.ts`: `CoreApi.watch(conditions, machine?)`.
- `packages/shell/ipc/machines.ts`: `machineConnectionState(row: MachineRow | undefined): { state: "starting" | "ready" | "stale"; confirmedAt: number | null }`. 규칙은 지금 `wiring/machines.ts`의 `stateOf`다(connecting → starting, connected → ready, 그 밖과 목록에 없음 → stale).
- `packages/shell/ipc/secret-input.ts`: `secretInputOpenSchema`의 각 갈래에 `machine` optional(값이 갈 기계).

두 쪽이 기대는 동작:
- shell main은 `core-call`의 `machine`이 이 컴퓨터가 아니면 그 기계의 `machines/call`로만, 없거나 이 컴퓨터의 id면 이 컴퓨터 core로만 보낸다. 기계에 묶인 창(지금의 기계 창)은 `machine`이 없거나 묶인 기계일 때만 통하고 다른 기계면 `forbidden`이다.
- `core-watch`에 `machine`이 있으면 (보낸 창, 기계)마다의 조건이다. 그 기계의 frame은 `machine`을 달고 `shell:core-event`로 그 기계를 보는 창에만 간다. 한 창의 watch에 답한 `ready`는 그 창에만, 그 밖의 `ready`와 `event`·`closed`는 그 기계를 보는 모든 창에 간다. `machine` 없는 message는 이 컴퓨터 core의 것이다.
- 다른 기계의 연결 상태는 IPC로 묻지 않고 `MachineList`(`shell:machines-changed`)의 줄을 `machineConnectionState`로 읽는다. `shell:core-state-get`은 그대로다.
- 보호 secret 창을 `machine`과 함께 열면 값과 읽기는 그 기계의 link로만 간다. 없으면 지금처럼(이 컴퓨터, 기계 창이면 묶인 기계)이다.
- 어느 쪽이 짓나: preload, shell main, core는 `screen-base-core`, renderer는 `screen-base-scope`다.

## 고정할 모양

- `desktop/machines/scope.tsx`: `type MachineRef = string | null`(null이 이 컴퓨터. 이 컴퓨터의 id를 ref에 넣지 않는다), `MachineHubProvider`, `MachineScope({machine, children})`, `useScopeMachine(): MachineRef`, `useMachineData(machine?: MachineRef): MachineData`(인자가 없으면 지금 범위).
- `desktop/machines/data.ts`: `MachineData`(`machine`, `here: boolean`, `core`, `events`, `stores`, `workspace`, `projects`, `apps`, `catalog`, `jobs`, `settings`, `settingsPanels`, `quickPrefs`, `agentViewSource`, `editor?`, `appDetail?`, `folders`, `picker`, `terminal`, `appViews`, `projectIcons`, `grant()`), `createMachineHub(deps)`(`get(machine)`, `stop()`. 다른 기계의 묶음은 처음 쓸 때 짓고 명단에서 빠지면 멈춘다), `type OnMachine<T> = T & { readonly machine: MachineRef }`(목록 줄).
- `desktop/machines/core-source.ts`: `machineCoreSource(machine, bridge, machines): CoreSource`. call·watch는 `machine`을 싣고, `onEvent`는 그 기계의 message만, `subscribe`·`current`는 `machineConnectionState`다. 이 컴퓨터의 `windowCoreSource`(`desktop/connection/connection.ts`)의 `onEvent`는 `machine`이 없는 message만 듣는다.
- `MachineScope`는 그 기계의 `stores`로 events context를 준다. `events/hooks.tsx`에 `createEventStores(client, terminals?)`를 더하고 `EventsProvider`는 만든 `stores`도 받는다(`client` prop은 그대로: 폰이 쓴다). `useCoreRead`는 고치지 않아도 범위의 기계를 읽는다.
- factory 자리: `terminal/machine-deps.ts`의 `machineTerminalDeps(machine, core, events): TerminalDeps | undefined`(이 컴퓨터: 지금 `entry.tsx`의 것. 다른 기계: `undefined`. `screen-terminals`가 채운다), `app-frame/machine-deps.ts`의 `machineAppViews(machine, core, views, appDetail): AppViewsDeps | null`(다른 기계: `null`. `screen-apps`가 채운다).
- `desktop/machines/tab-scope.tsx`의 `TabScope({tab, workspaceMachine, children})`: `tab.machine ?? workspaceMachine`의 범위를 준다. 그 기계가 connected가 아니면 본문 대신 이름과 상태 한 줄이다(`machine-gate.tsx`의 글을 쓴다).
- 탭: `TabItem.machine?: string`(`workspace/model.ts`). 없으면 그 workspace의 기계다(이 컴퓨터의 workspace면 이 컴퓨터, "Home · X"면 X). 같은 정체의 project 한 줄 안에서 다른 기계의 session·터미널을 열 때 단다. `layout-source.ts`는 `machine`이 있는 탭을 저장하지 않는다(`screen-layout`이 저장한다. 그 전에 저장하면 다른 기계의 터미널 참조가 이 컴퓨터의 것으로 되살아난다).
- `TabHost`(`kinds/host.ts`)에 `machine: MachineRef`(workspace의 기계)와 `machineData(machine: MachineRef): MachineData`(hub의 `get`). kind의 hook 아닌 자리(`iconOf`, `dotOf`, `transfer`)가 탭의 기계 묶음을 이것으로 찾는다.
- workspace: `WorkspaceRef = ({kind:"home"} | Workspace) & { readonly machine?: string }`(`shell/desk-model.ts`). `workspaceKey`는 이 컴퓨터면 지금처럼 `home` | id, 다른 기계면 `home-<mch>` | `<id>-<mch>`다(layout file 이름 규칙 `^[A-Za-z0-9_-]{1,64}$` 안이다). Home key와 기계를 건너 같은 앱 id가 layout key에서 겹치는 것은 이 규칙이 막는다.
- `useWindowMachine()`(`desktop/machines/context.tsx`)은 이름은 두고 범위의 기계를 돌려준다(이름은 `screen-cleanup`이 바꾼다). `useMachineGrant`는 범위 묶음의 `grant()`를 묻는다. 이 둘을 쓰는 file은 고치지 않아도 범위를 따른다.

## 할 일

1. 바닥: `scope.tsx`, `data.ts`, `core-source.ts`, `tab-scope.tsx`, 두 `machine-deps.ts`, `hooks.tsx`, `context.tsx`, `connection.ts`(renderer).
2. `entry.tsx`: module 수준 source를 hub로 옮긴다. 갈래마다 갈 곳(줄은 지금 main):
   - `:122-123` `machines`·`remote` → root `MachineScope`의 기계(`thisWindow()`. 기계 창이 없어지면 늘 null).
   - `:124`·`:182` `remoteLayouts`, `files: []`와 메모리 layout → `data.ts`의 다른 기계 `workspace`.
   - `:126` editor, `:138` appDetail → `data.ts`(이 컴퓨터만).
   - `:130` 폴더 고르기 → `data.ts`의 `folders`·`picker`. `folders.Host`는 `MachineScope`가 그린다.
   - `:145` `jobsSwitchOnly`, `:148` settingsPanels, `:177` 메모리 quickPrefs, `:197` `{device: true}` → `data.ts`.
   - `:248` terminal → `terminal/machine-deps.ts`. `:326` appViews → `app-frame/machine-deps.ts`.
   - `:202` `machineGrant`, `:395-401` provider → `data.ts`의 `grant()`와 `MachineHubProvider`.
3. `main.tsx`: `Desktop`은 root 범위의 `useMachineData()`로 source를 꺼내 지금처럼 `WorkspaceWindow`에 props로 넘긴다. `:336-347` live gate는 root 범위의 기계로 본다.
4. `workspace-window.tsx`: `:411`의 `useWindowMachine()`을 `useScopeMachine()`과 `useMachineData()`로 바꾸고 갈래는 기계가 아니라 필요한 능력으로 본다:
   - 앱 화면(`:542`, `:1208`, `:2745`, `:2976`, `:3079`) → `data.appViews !== null`.
   - 설정 탭(`:1075`, `:1082`), 팔레트 project 설정 행(`:1742`), `explorer.focus`(`:2056`), 오른쪽 sidebar `otherMachine`(`:2582`), file 끌어 놓기(`:2673`), Agents(`:2969`, `:3108`), tray(`:3115`, `:3140`) → `data.here`.
   - 탭 본문(`:1398`): 모든 본문을 `TabScope`로 감싸고, 탭의 기계가 이 컴퓨터가 아니고 kind가 `thisComputerOnly`면 `OnlyHere`다. wave 2 task는 자기 kind file에서 `thisComputerOnly`를 빼는 것으로 연다.
   - `:2903` `MachineSwitcher`는 그대로(`screen-windows`가 지운다).
5. `kinds/kind.ts`의 `thisComputerOnly` 설명을 "탭의 기계가 이 컴퓨터가 아니면 본문 대신 OnlyHere"로, `host.ts`에 위 두 칸.
6. 보호 secret 창을 여는 renderer 두 곳(`settings/core-call.ts`, `input-request-card.tsx`)이 범위의 기계를 `machine`으로 싣는다(기계 창 안에서는 묶인 기계와 같다).
7. `architecture/remote.md` "desktop에서 다른 기계 보기"와 그 지키는 것을 README "정한 것"의 모양(창 하나, 범위, 구독자들의 합, 받는 기계가 권한을 본다)으로 초안한다. code path는 쓰지 않는다. 지금 남은 기계 창은 "계획이 끝나면 없어진다"로 적는다.

### 정한 것
- 갈래는 기계가 아니라 능력(`here`, `appViews`, `terminal`)으로 본다: wave 2 task가 자기 factory만 고치면 갈래가 저절로 열린다.
- `Desktop`·`WorkspaceWindow`의 props 모양은 그대로 둔다: 범위에서 꺼내 넘기면 3259줄 file의 props를 다시 짜지 않는다.
- 다른 기계 workspace의 layout은 아직 메모리다: 저장 모양은 `screen-layout`이 판을 올리며 정한다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 선다. renderer의 `connection`·`events` file을 폰이 import하므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다.
- 위험 test: 없음(길은 `screen-base-core`의 `machine-route_test.ts`가 지킨다. 화면과 내부 구현은 test하지 않는다). 새 test file을 만들지 않는다.
- 남지 않음: `grep -n "const remote = \|remote ?" packages/shell/renderer/desktop/entry.tsx`와 `grep -n "useWindowMachine()" packages/shell/renderer/workspace/workspace-window.tsx`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
