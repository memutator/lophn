# roster-desktop

desktop이 다른 기계를 core의 길로 본다. 다른 기계의 창은 shell main의 연결 대신 이 컴퓨터 core의 `machines/call`·`machines/watch`를 쓰고, shell main의 연결·key·목록 code와 file은 지운다(data step). Settings › Remote를 "내 기기" 목록 하나(초대, 들어가기, 빼기, 기기마다 터미널 입력)로 바꾼다.

- 단위: roster (wave 4)
- 선행: roster-links
- 소유(이 task만 고친다):
  - `packages/shell/main/desktop/viewer/`
  - `packages/shell/main/desktop/wiring/{machines.ts,machine-windows.ts,desktop-window.ts}`
  - `packages/shell/main/desktop/core/`
  - `packages/shell/ipc/machines.ts`
  - `packages/shell/preload/{shell.ts,remote.ts,machines-api.ts}`
  - `packages/shell/renderer/desktop/settings/remote/`, `packages/shell/renderer/desktop/machines/`
  - `packages/design/i18n/catalog/{remote-desk.ts,workspace-settings.ts}`
  - `tools/wireframes/pages/screens/{settings-pages.tsx,settings-frame.tsx}`
  - `packages/core/main/daemon/wiring/remote.ts`, `packages/core/main/daemon/wiring/remote_test.ts`(data step 하나와 그 test만)
  - `project-docs/flows/areas/{ipc.yaml,shell-desktop.yaml,core-platform.yaml}`, `project-docs/flows/tests/shell.yaml`
- 읽을 것:
  - 계획 README "정한 것"(연결의 "다른 기계를 부르는 길은 core의 route 하나다", 허락, 옮기기의 "컴퓨터끼리는 한 번 다시 잇는다")
  - `project-docs/plan/device-roster/tasks/roster-contract.md` "모양"(`roster/*`, `machines/*`, `MachineFrameReceived`)
  - architecture: `project-docs/architecture/remote.md` "desktop에서 다른 기계 보기"(창, gate, 시작 기계, 지키는 것 1·24)와 명단 절, `machine.md` "이름"
  - 조사 `reports/multi-device/survey-s2-roster.md` 1.10, 3(G4·G5·G6), 5.1(viewer file)
  - 본보기(화면): gallery `tools/wireframes/pages/screens/settings-pages.tsx`의 `SettingsRemote*`(지금 Settings › Remote. "내 기기" wireframe은 아직 없다. 아래 정한 것)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/main` notes(desktop/viewer/)
- 계약:
  - 쓰는 것: route `roster/list|invite|join|remove|set_terminal_input|rename`, `machines/list|call|watch`, event `MachineFrameReceived`, `StateChanged{remote_devices}`
  - 내놓는 것: 없음(IPC `shell:machines-*`는 이 task 안의 계약이다)

## 할 일

1. 다른 기계의 창이 core를 거친다. `viewer/machine-route.ts`가 창에 묶는 `Connection` 자리에, 이 컴퓨터 core에 사람 자격으로 붙은 shell main의 길로 짓는 같은 꼴의 adapter를 둔다:
   - `call` → `machines/call {machine, resource, method, body}`
   - `watch(conditions)` → `machines/watch {machine, conditions}`. shell main의 Gateway 조건에 `MachineFrameReceived`를 더하고 그 `frame`을 그 기계의 창으로 보낸다(`ready`면 창이 snapshot부터 다시 읽는다).
   - 상태(`current`, 붙음·끊김·길·판 어긋남)는 `machines/list`와 `StateChanged{remote_devices}`에서 온다.
   창의 IPC guard, 허락 목록, `this-read`·`clone-here`, presence(`presence/report`는 `machines/call`로 간다)는 그대로다(`remote.md` 지키는 것 24).
2. 기계 목록. `MachineList`(`shell/ipc/machines.ts`)를 core의 `machines/list`와 `roster/list`로 짓는다. 명단에서 빠진 기계의 열린 창은 removed gate다. 기계 이름은 명단의 이름 하나다: `MachineRow`의 `alias`·`announced`와 `shell:machines-rename`은 지우고, 이름 바꾸기는 "내 기기"의 `roster/rename`이 한다(모든 기계에 같다). `shell:machines-pair|remove`도 지운다(Settings가 `roster/*`를 바로 부른다).
3. 지우기: `viewer/store.ts`, `viewer/links.ts`와 그 test, shell main의 기기 key 만들기, `@lophn/remote-client`의 `createComputers`·`pair`·`createConnection` 사용. `viewer/window-places.ts`(`viewer/windows.json`)는 남긴다. 시작 기계 규칙(고른 기계, 마지막에 쓴 기계, core를 기다리지 않고 연다)은 남기고 그 값은 새 file `<data root>/shell/viewer/start.json`(`{machine(이 기계 id 표지), start, last, last_name}`, 0600, temp에 쓰고 rename)에 둔다.
4. data step(remote wiring의 `dataSteps`, id 예: `shell.viewer.roster`): `viewer/machines.json`이 있으면 `start`·`last`와 `last`인 기계의 보이는 이름(별명 ?? 알린 이름)을 `viewer/start.json`으로 옮기고, `viewer/key.json`과 `viewer/machines.json`을 지운다. `viewer/windows.json`은 건드리지 않는다. 표지가 이 기계와 다른 file은 옮기지 않고 지운다. 다시 돌아도 같은 결과다. 근거: README "옮기기", AGENTS.md 호환성.
5. Settings › Remote(`renderer/desktop/settings/remote/`): "Computers you view"(`viewed-machines.tsx`)와 pairing 칸을 "내 기기" 목록 하나로 바꾼다:
   - 목록: `roster/list`의 기기마다 이름, kind와 os, 이 컴퓨터 표시, 컴퓨터면 `machines/list`의 상태, 터미널 입력 스위치(`roster/set_terminal_input`), [Rename](`roster/rename`. 이 컴퓨터 줄은 지금 "This computer"의 `machine/rename`이다), [Remove](`roster/remove`, 확인을 받는다. 이 컴퓨터 줄에는 없다).
   - [Invite]: 터미널 입력(기본 켬)과 수명을 정하고 `roster/invite` → QR과 "Show as text", 끝나는 때, [New invite]. 수명은 스위치 하나다: "The new device can't be on at the same time as this computer"(dual boot, 집과 직장)를 켜면 `lifetime: "long"`(7일), 기본은 `"short"`(30분)다. 지금 QR 칸과 같은 자리다.
   - [Join with an invite]: 붙여 넣은 글로 `roster/join`. 거절 이유(`expired`, `used`, `untrusted`, `removed`, `this_computer`, 판 어긋남, remote 꺼짐)를 말한다. `pending`이면 "초대한 컴퓨터에 아직 닿지 않았다. 그 컴퓨터를 아는 기기(폰)가 붙으면 끝난다"를 말한다.
   - 폰 기준(`devices/set_primary`)과 keep running 칸은 그대로다. 폰 별명(`devices/rename`)은 `roster/rename`으로 바뀐다.
   - renderer allowlist와 route 목록(`shell/main/desktop/core/{allowlist.ts,routes.ts}`)에서 `pairing/start`, `devices/revoke`, `devices/set_terminal_input`, `devices/rename`을 빼고 쓰는 `roster/*`를 넣는다.
   - 문구는 `remote-desk.ts`·`workspace-settings.ts`의 key다. 지운 화면의 key도 지운다.
6. gallery: `testdata/fake-source.ts`를 새 source 모양으로 바꾸고 `settings-pages.tsx`의 `SettingsRemote*` 상태(목록, 초대 QR과 긴 수명, 들어가기 실패, `pending`)를 실제 component로 그린다. 새 page를 더하면 `pages/index.ts` 등록은 보고에 적는다.
7. flows(`flows` skill): `ipc.yaml`의 viewer·pairing flow를 지우거나 고치고, `core-platform.yaml`의 Settings 쪽 code 목록, `tests/shell.yaml`의 지운 test file 줄을 맞춘다.

정한 것:
- "내 기기" 화면은 승인된 wireframe 없이 지금 Settings › Remote의 자리와 component(목록 줄, QR 칸, 스위치)로 짓고 gallery 상태로 보인다. 이유: README가 화면 내용을 정했고 새 component를 만들지 않는다. 사람은 gallery로 본다.
- viewer의 옛 기계 별명은 옮기지 않는다. 이유: 그 기계들은 초대로 한 번 다시 이어지고(README "옮기기") 그때 명단 이름이 생긴다. 바꿀 이름은 `roster/rename`으로 다시 준다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 된다. `npm run wireframes`가 되고 gallery의 `SettingsRemote*`가 바뀐 component로 그려진다.
- 위험 test: "data step이 창 자리와 시작 기계를 남기고 옛 key와 기계 목록 file만 지운다"(`remote_test.ts`, 임시 data root)
- 남지 않음: `grep -rn --exclude-dir=dist "viewer/key\|key\.json\|machines\.json\|createViewerStore\|MACHINES_PAIR_CHANNEL\|MACHINES_REMOVE_CHANNEL\|MACHINES_RENAME_CHANNEL\|pairing/start\|pairingStart" packages/shell tools/wireframes tests`가 0줄이다(`window-places.ts`의 주석도 고친다. data step 안의 옛 file 이름은 예외).
- 지운 화면의 문구 key로 한 번 더 grep해 그 key를 쓰던 component와 prop이 남지 않았는지 본다.
- 진짜 Electron과 두 core로 본 것이 없으면 보고에 적는다(lead가 merge 전에 확인한다). 손으로 볼 때는 `npm run dev`와 `npm run dev -- --viewer`의 두 root에서 먼저 `remote.relay`를 비우고 `remote.port`를 다르게 둔다. E2E와 브라우저 test는 새로 만들지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다). `@lophn/remote-client`에서 shell이 더 쓰지 않게 된 것을 적는다(cleanup이 지운다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
