# screen-lists

이 컴퓨터의 창 하나의 목록이 모든 기계를 보인다. 같은 정체의 project는 한 줄이고, 그 안의 session·coding agent·터미널에 기계 꼬리표가 붙는다. 이 기계에 없는 project도 줄로 선다(git이면 [Clone here], 아니면 잇기). Home은 기계마다 "Home · <이름>"이고, 앱은 한 줄이며, 꺼진 기계의 줄은 꺼짐으로 남는다. 기계마다의 창은 그대로 둔다: 그 창과 그 갈래, 시작 기계, 창 자리는 `screen-windows`(wave 3)가 지운다.

- 단위: screen (wave 2)
- 선행: screen-base-core, screen-base-scope. wave 1의 `screen-link`도 merge된 뒤다(잇기 dialog를 줄에 단다).
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/{entry.tsx,main.tsx,router.ts}`, `packages/shell/renderer/workspace/workspace-window.tsx`, `packages/shell/renderer/workspace/sidebar/`, `packages/shell/renderer/workspace/kinds/agent.tsx`
  - `packages/shell/renderer/shell/{left-sidebar.tsx,use-left-sidebar.ts,left-sidebar-workspaces.ts,desk-model.ts,workspaces-panel.tsx}`
  - `packages/shell/renderer/desktop/workspaces/{register-dialog.tsx,folder-browser.tsx}`, `packages/shell/renderer/desktop/workspaces/projects/{remote-group.ts,merged.ts}`(`merged.ts`는 새 file)
  - `packages/shell/renderer/desktop/palette/`, `packages/shell/renderer/apps/app-list.ts`
  - `packages/shell/renderer/desktop/connection/`(export를 더하기만 한다. 아래)
  - `packages/shell/main/desktop/viewer/{machine-route,machine-route_test}.ts`, `packages/shell/main/desktop/wiring/{machines,machine-windows}.ts`(clone-here를 옮기는 것만)
  - `tools/wireframes/pages/screens/shell.tsx`, `tools/wireframes/pages/screens/shell/`(`machine-page-scene.tsx`는 빼고), `tools/wireframes/mock/machines-data.ts`(새 file)
  - `packages/design/i18n/catalog/{remote-desk,left-sidebar}.ts`
  - `project-docs/flows/areas/{ipc,shell-desktop,projects}.yaml`, `project-docs/architecture/project-identity.md`
- 읽을 것:
  - 계획 README "정한 것 › 화면의 바닥"·"목록", roadmap `multi-device.md` "가리키는 법"·"어떻게 보이나"
  - `screen-base-scope`·`screen-base-core` brief의 "같이 쓰는 계약"과 "고정할 모양", merge된 code(`desktop/machines/{scope,data,core-source}`)
  - 조사 `reports/multi-device/survey-n1-one-screen.md` 1.5, 2.4 표, G3·G8, 부록 B(겹치는 key)
  - architecture: `remote.md`(screen-base-scope 초안), `project-identity.md` "다른 기계의 창", `workspace-layout.md` "workspace 종류"
  - 본보기(화면): `tools/wireframes/pages/screens/shell.tsx`의 `shell-left-sidebar*`, `shell-workspaces-panel`, `shell-machine-projects*` page와 `shell/{sidebar-scene,workspaces-scene,machine-projects-scene}.tsx`, `.claude/skills/ui-design/SKILL.md`
- 계약:
  - 쓰는 것: `MachineScope`, `useMachineData`, `MachineRef`, `OnMachine<T>`, `WorkspaceRef.machine`, `workspaceKey`, `TabItem.machine`(screen-base-scope), `LinkProjectDialog`, `ProjectsSource.linkIdentity`(screen-link), `TerminalStore`(`terminal/store.ts`. 다른 기계의 것은 `useMachineData(m).terminal?.store`. 그 기계의 store는 `screen-terminals`가 같은 wave에 채운다), `matchProjects`(`packages/protocol/projects/identity.ts`)
  - 내놓는 것: `Route`(`desktop/router.ts`)의 `machine?: string`. 다른 task는 `openProject`·`openApp`·`openHome`에 기계를 넘겨 그 기계의 것을 연다.

## 할 일

1. wireframe 먼저(`ui-design` skill). 본보기가 없는 모양이라 merge 전에 lead가 사람에게 보인다. `shell.tsx`에 page를 더한다: `shell-left-sidebar-machines`(project 한 줄 안에 두 기계의 session·coding agent·터미널, 줄 끝의 기계 꼬리표), `shell-left-sidebar-not-here`(이 기계에 없는 project: git이면 [Clone here], 아니면 [Link…]로 `LinkProjectDialog`), `shell-left-sidebar-homes`("Home" 다음에 "Home · Home server"), `shell-left-sidebar-offline`(꺼진 기계: 이름과 마지막으로 본 줄이 흐리게, 열리지 않는다), `shell-workspaces-panel-machines`. 가짜 기계 data는 `mock/machines-data.ts`. 기계마다의 창을 그리던 page(`shell-machine-menu`, `shell-machine-window`, `shell-machine-gate-*`, `shell-machine-settings*`, `shell-machine-sign-in`, `shell-machine-register`, `shell-machine-projects*`)와 그것만 쓰던 scene은 gallery에서 지운다(설계의 기준은 새 목록이다. code는 `screen-windows`가 지우고, Settings의 기계 page는 `screen-inbox`가 `settings.tsx`에 다시 그린다). `shell-machine-only-here`와 `core-browser`의 `shell-machine-page*`는 둔다.
2. 목록 data(`projects/merged.ts`와 sidebar hook): 기계마다 `useMachineData(m)`로 project·앱·session 목록을 읽어 `OnMachine<T>`로 합친다.
   - project는 `matchProjects`의 `same`(같은 `pri_`)이면 한 줄이다. 줄의 workspace는 이 기계에 있으면 이 기계의 것(`machine` 없음), 없으면 명단 순서의 첫 connected 기계의 것이다. `remote-group.ts`의 순수 묶기를 쓰거나 옮긴다(기계 창의 popover `remote-group.tsx`는 그대로 둔다).
   - Home은 이 컴퓨터의 "Home"과 다른 기계마다 `{kind: "home", machine}` 줄이다(합치지 않는다).
   - 앱은 id로 한 줄이다. 여는 workspace는 이 기계에 있으면 이 기계의 것, 없으면 가진 기계의 것이고 꼬리표가 붙는다. 그 앱 workspace의 session 줄은 기계 꼬리표를 단다.
   - 꺼진 기계: 이름과 이 실행 동안 마지막으로 본 줄을 남기고 열기를 막는다. 나머지 기계는 그대로다.
3. 겹치는 key의 규칙(이 task가 갖는다): sidebar 줄 key(`lineOf`의 `workspace:<id>`)와 선택은 `workspaceKey(ref)`로 짓는다. `useKnownSessions`의 쌍 key(`agent\0kind\0id`, `use-left-sidebar.ts`)와 `lophn_app_<id>`·`lophn_home`처럼 기계마다 같은 agent id로 짓는 key는 앞에 기계를 붙인다. `desk-model.ts`의 `workspaceKey`는 screen-base-scope 규칙 그대로다.
4. 열기: `Route`에 `machine`을 더하고, `main.tsx`가 route의 기계로 `MachineScope`를 걸고 `WorkspaceWindow`에 그 기계의 source를 넘긴다. session 줄은 `kinds/agent.tsx`의 탭을 `machine`을 달아 연다.
5. 이 기계에 없는 project: [Clone here]는 이 컴퓨터의 창에서 부른다. `shell:machines-clone-here`의 handler를 `wiring/machine-windows.ts`에서 `wiring/machines.ts`로 옮기고, `machine-route.ts`의 `MACHINE_WINDOW_ONLY`에서 그 channel을 빼 이 컴퓨터의 창이 부르게 한다(기계 창도 그대로 부른다). git이 아닌 project에는 [Link…]가 `LinkProjectDialog`를 연다. 후보는 이 컴퓨터의 `repo === "none"`이고 그 id가 아닌 project다.
6. project 등록 dialog는 다른 기계가 connected이고 그 기계의 `grant()`가 허락이면 기계를 고르고 그 기계의 폴더 dialog(`folder-browser.tsx`)를 쓴다(`core-setup`이 기계 창에 연 것을 이 창에서도 지키는 가장 작은 길).
7. `desktop/connection/*`은 폰이 import한다(`packages/mobile/src/data/*`). 있는 export의 모양을 바꾸지 않고 더하기만 한다. 바꿔야 하면 보고한다.
8. 문서와 flows: `project-identity.md` "다른 기계의 창"에 "한 창의 목록"(묶기, Clone here, 잇기)을 더한다(기계 창 절은 `screen-windows`가 지운다). flows `shell-desktop.yaml`(목록), `ipc.yaml`(clone-here를 이 컴퓨터의 창이 부른다), `projects.yaml`(clone과 잇기를 목록에서)을 고친다(`flows` skill).

### 정한 것
- 꺼진 기계의 "마지막으로 본 목록"은 이 실행 동안의 메모리다: 저장하면 새 shell data file과 옮기기가 생긴다.
- 이 기계에 없는 project가 여러 기계에 있으면 명단 순서의 첫 connected 기계의 것을 연다: 고르는 화면 없이 한 줄을 연다.
- 기계마다의 창은 이 task에서 그대로 돈다: 지우는 일은 `screen-windows`가 따로 한다(README).

## 끝남

- `npm run check`가 통과한다. `npm run wireframes`가 되고 gallery의 `shell-left-sidebar-machines`, `shell-left-sidebar-not-here`, `shell-left-sidebar-homes`, `shell-left-sidebar-offline`, `shell-workspaces-panel-machines`가 renderer component로 그려진다. `node packages/shell/renderer/build.ts`가 선다. `desktop/connection`을 건드렸으면 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다.
- 위험 test: 없음(길은 screen-base-core의 `machine-route_test.ts`가 지킨다. 화면은 test하지 않는다). clone-here를 이 컴퓨터의 창에 연 것에 맞춰 `machine-route_test.ts`의 "기계 창만 clone-here" 줄을 고치되, 기계 창이 이 컴퓨터의 다른 channel에 닿지 못하는 검사는 남긴다.
- 남지 않음: `grep -rn "MACHINES_CLONE_HERE" packages/shell/main/desktop/wiring/machine-windows.ts`가 0줄이다.
- 진짜 Electron에서 띄우는 확인과 E2E는 이 task가 만들지 않는다(lead가 wave 2 뒤에 가짜 둘째 기계로 본다).

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

## (lead가 더함)

wave 1(`screen-base-core`, `screen-base-scope`, `screen-link`)이 review를 거쳐 합쳐졌다. brief의 이름이 code와 다르면 code가 맞다. 달라진 것:
- `machineCoreSource`는 넷째 인자 `local`(이 컴퓨터의 `windowCoreSource`)을 받는다. 이 컴퓨터의 core 연결이 내려가면 다른 기계의 범위도 `stale`이다.
- workspace의 기계는 `WorkspaceRef.machine`이 원본이다. `WorkspaceWindow`가 그것과 둘레의 범위가 다를 때만 `MachineScope`로 감싼다. 여는 쪽은 그 기계 묶음의 source를 prop으로 넘긴다.
- 다른 기계의 묶음(`desktop/machines/data.ts`)은 이 컴퓨터의 file, 폴더 고르기, 지침 file, 기계 없는 secret 창에 닿지 않는다(닿는 member는 `unavailable`). 이 규칙을 깨는 source를 묶음에 더하지 않는다(`architecture/remote.md` 지키는 것 42).
- 기계가 있는 탭은 떼어 내기와 전역 float을 내놓지 않는다(`screen-layout`이 연다).
- shell main: 다른 기계를 적은 call과 watch도 보낸 쪽 검사를 거친다. 이 컴퓨터의 id를 아직 모를 때 기계를 적은 call은 `unavailable`이고 watch는 기다린다. watch는 창마다(watcher `w<창 id>`) 따로이고 core가 합을 건다.
- review: `reports/multi-device/review-screen-base-core.md`, `review-screen-base-scope.md`.
- gallery의 `MockDesktop`(`tools/wireframes/mock/mock-desktop.tsx`)이 entry처럼 `MachineHubProvider`를 세우게 하고, `desktop/main.tsx`의 gallery 전용 `useOwnHub`와 그 `as MachineData` cast를 지운다.
- 한 목록의 꼬리표와 묶음은 승인된 wireframe이 없다. gallery page를 먼저 그리고 그 page 이름을 보고의 맨 위에 적는다. lead가 사람에게 보인 뒤에 합친다.
