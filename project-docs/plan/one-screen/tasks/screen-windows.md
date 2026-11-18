# screen-windows

기계마다의 창을 지운다. 이제 이 컴퓨터의 창 하나가 모든 기계를 보이므로(`screen-lists`), 다른 기계의 창, 그 창을 묶던 표와 IPC guard, remote preload, 시작 기계와 창 자리, 기계 고르기와 창 gate, 그리고 기계에 묶인 창에서만 쓰던 renderer 갈래를 걷는다. 쓰지 않게 된 `shell/viewer/` file은 data step으로 지운다.

- 단위: screen (wave 3)
- 선행: screen-lists.
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/viewer/`, `packages/shell/main/desktop/wiring/{machines,machine-windows,context,desktop-window,secret-input}.ts`, `packages/shell/main/desktop/main.ts`(`machineWindows` 줄), `packages/shell/main/build.ts`, `packages/shell/main/secret-input/ipc.ts`
  - `packages/shell/ipc/machines.ts`, `packages/shell/preload/{remote,machines-api}.ts`
  - `packages/shell/renderer/desktop/{entry.tsx,main.tsx}`, `packages/shell/renderer/workspace/workspace-window.tsx`, `packages/shell/renderer/shell/shell-frame.tsx`
  - `packages/shell/renderer/desktop/machines/{machine-switcher.tsx,machine-switcher.module.css,machine-gate.tsx,machine-gate.module.css,remote-settings.tsx,remote-settings.module.css,source.ts,window-source.ts}`, `packages/shell/renderer/desktop/machines/testdata/`
  - `packages/shell/renderer/desktop/settings/remote/`, `packages/shell/renderer/desktop/workspaces/home-gate.tsx`, `packages/shell/renderer/desktop/workspaces/projects/{remote-group.tsx,remote-group.module.css}`
  - `packages/core/main/daemon/wiring/{remote,remote_test}.ts`(`dataSteps`만)
  - `project-docs/flows/areas/{ipc,shell-desktop}.yaml`, `project-docs/architecture/project-identity.md`("다른 기계의 창" 절)
- 읽을 것:
  - 계획 README "정한 것 › 화면의 바닥"의 "창은 기계에 묶이지 않는다", "저장과 알림"의 `shell/viewer/`
  - architecture: `project-docs/architecture/remote.md`(screen-base-scope 초안: 남은 기계 창), `project-identity.md`(screen-lists가 고친 "한 창의 목록")
  - 조사 `reports/multi-device/survey-n1-one-screen.md` 1.1·1.3·2.1, 5의 "Viewer start and places" 줄
  - 본보기(data step): `packages/core/main/daemon/wiring/remote.ts`의 `viewerRosterStep`(`shell.viewer.roster`)
- 계약:
  - 쓰는 것: screen-base-core의 shell main 고르기(`machine`이 실린 `core-call`·`core-watch`, `ctx.machines`, 보호 창 열기의 `machine`), screen-base-scope의 `MachineScope`·`useScopeMachine`, screen-lists의 목록과 `Route.machine`
  - 내놓는 것: 없음

## 할 일

1. shell main: `wiring/machine-windows.ts`(창 열기·presence·`this-read`·창 frame)와 `main.ts`의 `machineWindows` 줄, `context.ts`의 `machineWindows`·`machineOf`, `machine-route.ts`의 `bind`·`unbind`·`machineOf`·`linkOf`·`passes`·`MACHINE_WINDOW_CHANNELS`·`MACHINE_WINDOW_ONLY`와 `context.ts`에서 묶인 창을 거르던 갈래(`ipcMain.on`의 `passes`)를 지운다. `ctx.handle`이 `core-call`·`core-watch`의 `machine`을 고르는 길(screen-base-core)은 남긴다. `viewer/{start,window-places}.ts`, `viewer/list.ts`의 start·last, `desktop-window.ts`의 시작 기계(`startMachine`), `build.ts`의 `preload-remote` entry와 `preload/remote.ts`를 지운다.
2. IPC: `shell:machines-{start,open,this-window,visible,this-read}`, `THIS_COMPUTER_READS`, `MachineList`의 `start`·`last`, `MachineWindow`를 지운다. `shell:machines-list|changed|clone-here`는 남긴다. preload `machines-api.ts`를 맞춘다.
3. 보호 secret 창: `secret-input/ipc.ts`·`wiring/secret-input.ts`에서 창 묶음(`linkOf`)으로 고르던 갈래를 지운다. 기계는 열기 요청의 `machine`만 정한다(screen-base-core가 열었다).
4. renderer:
   - `entry.tsx`: `thisWindow()`와 `MachinesProvider`의 창 기계를 지운다. root 범위는 늘 이 컴퓨터다.
   - `main.tsx`: 기계 창의 live gate와 `HomeGate`의 기계 갈래(`:336-347` 둘레), `home-gate.tsx`의 기계 갈래.
   - `workspace-window.tsx`·`shell-frame.tsx`: `MachineSwitcher`와 `machineSwitcher` slot.
   - `machine-switcher.tsx`, 창 gate(`machine-gate.tsx`. `tab-scope.tsx`가 쓰는 글과 component는 남긴다: 그 file은 `screen-layout`의 것이다), `remote-settings.tsx`와 Settings › Remote의 시작 기계 고르기(`settings/remote/`), 기계 창 popover `remote-group.tsx`, `MachinesSource`의 `thisWindow`·`setStart`·`open`·`thisRead`(`source.ts`, `window-source.ts`, `testdata/`).
   - 지운 것을 쓰던 남의 file(같은 wave의 `context.tsx`는 `screen-inbox`, `tab-scope.tsx`·`data.ts`는 `screen-layout`, `add-tab-menu.tsx`는 `screen-pages`)은 고치지 않고 "넘길 줄"에 적는다.
5. data step: `remote.ts`의 `dataSteps` 끝(`viewerRosterStep` 뒤)에 `shell.viewer.drop`을 더한다. `shell/viewer/start.json`과 `windows.json`을 지우고 폴더가 비면 지운다. 없으면 아무것도 하지 않는다. 다른 file이 그 폴더에 있으면 둔다. 이 step은 기기 자격도 ledger도 건드리지 않는다.
6. 문서: `project-identity.md`의 "다른 기계의 창" 절(기계 창의 줄, `this-read`, 그 창의 popover)을 지우고 `screen-lists`가 더한 "한 창의 목록"만 남긴다. `remote.md`는 `screen-cleanup`이 마감한다.
7. flows: `ipc.yaml`(지운 channel, 기계 창의 IPC guard)과 `shell-desktop.yaml`(기계 창 열기·닫기·시작 기계·창 자리)의 줄을 지우고 고친다(`flows` skill). `machine-route_test.ts`에서 기계 창 guard test는 지우되, screen-base-core의 위험 test(기계 A로 부른 것이 A에만 간다)는 남긴다.

### 정한 것
- `shell/viewer/` file은 step으로 지운다: 다시 읽는 code가 없어 남기면 사람의 data root에 쓰레기가 된다. 이 task가 그 file을 읽던 code를 지우므로 step도 이 task가 갖는다.
- 기계 창이 하던 presence는 여기서 지우고 다시 짓지 않는다: 같은 wave의 `screen-inbox`가 이 창에서 기계마다 보낸다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 선다. `project-docs/plan/tools/lead/boot.sh`로 새 data root가 두 번 뜬다.
- 위험 test(`remote_test.ts`에 더한다. 새 test file을 만들지 않는다): "`shell.viewer.drop`은 `start.json`과 `windows.json`만 지우고 같은 폴더의 다른 file과 `remote/` key file은 그대로 두며, 두 번 돌려도 같다."
- 남지 않음: `grep -rn "MACHINE_WINDOW_CHANNELS\|preload-remote\|viewer/start\|window-places\|MACHINES_THIS_WINDOW\|MACHINES_THIS_READ\|MACHINES_START\|MACHINES_VISIBLE\|machineWindows\|MachineSwitcher\|thisWindow()" packages tools tests`(옮기는 step과 그 test의 file 이름은 뺀다)와 `grep -rn "shell:machines-\(start\|open\|this-window\|visible\|this-read\)" packages tools tests project-docs/flows`가 0줄이다.
- 진짜 Electron 확인과 E2E는 만들지 않는다(lead가 본다).

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
