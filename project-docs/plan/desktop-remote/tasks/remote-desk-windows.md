# remote-desk-windows

**opus high.** 다른 기계를 그 기계의 창으로 연다. 기계마다 창 하나를 따로 preload로 열고, 그 창의 `shell:core-*` 통로를 이 컴퓨터의 core가 아니라 그 기계의 연결로 보내며, 그 창이 보낸 그 밖의 IPC(터미널, file, browser, 앱 view, secret, layout…)는 한 곳에서 거절한다. 창 제목에 기계 이름을 싣고, 그 창이 보는 것을 그 기계에 presence로 알리고, 시작 때와 창이 없을 때 시작 기계를 연다. 개발에서 두 번째 desktop을 다른 data root로 띄우는 길을 더한다.

- 단위: desk-windows (wave 3)
- 선행: remote-desk-viewer
- 소유(이 task만 고친다):
  - `packages/shell/ipc/machines.ts`(channel 셋과 api method 둘을 더한다)
  - `packages/shell/preload/machines-api.ts`
  - `packages/shell/preload/remote.ts`(새 file)
  - `packages/shell/main/build.ts`(preload entry 한 줄)
  - `packages/shell/main/desktop/machine-route.ts`(새 file)
  - `packages/shell/main/desktop/machine-route_test.ts`(새 file)
  - `packages/shell/main/desktop/wiring/machine-windows.ts`(새 file)
  - `packages/shell/main/desktop/wiring/context.ts`
  - `packages/shell/main/desktop/wiring/core.ts`
  - `packages/shell/main/desktop/wiring/desktop-window.ts`
  - `packages/shell/main/desktop/wiring/desktop.ts`
  - `packages/shell/main/desktop/window.ts`
  - `packages/shell/main/desktop/main.ts`(등록 한 줄과 import만)
  - `packages/shell/main/desktop/viewer/store.ts`(시작 기계를 core 없이 읽는 함수 하나만)
  - `tools/dev.ts`
  - `project-docs/flows/areas/ipc.yaml`
  - `project-docs/flows/areas/shell-desktop.yaml`
  - `project-docs/flows/tests/shell.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/desktop-remote/README.md`의 "정한 것"(창마다 한 기계, main이 연결을 든다, 따로 preload, 끄는 기능, 이름이 늘 보인다, 시작 기계와 꺼진 기계, 창이 없을 때, presence)과 "다른 계획이 기대는 계약" 4·5
  - 앞 task의 결과: `packages/shell/main/desktop/wiring/machines.ts`의 `Machines`(`list`, `subscribe`, `connection`, `markUsed`, `startMachine`), `packages/shell/ipc/machines.ts`, `packages/shell/preload/machines-api.ts`, `@lophn/remote-client`의 `Connection`
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/mixdog.md` 4.1(기계마다 창, 창은 연결 하나만 몰고 로컬로 넘어가지 않는다, 전환기는 이름 목록만 받는다)
  - architecture: `project-docs/architecture/remote.md`(지키는 것 1·3), `project-docs/architecture/attention.md`(presence 보고와 kind desktop 규칙), `project-docs/architecture/platform.md`(shell main이 core와 붙는 길)
  - 지금 코드: `wiring/context.ts`(`ctx.ipc` 둘레, `windows`·`detached`·`appWindows`, `shellWindowOf`, `desktop.open|openInactive|show`, `connectCore`를 부르는 곳), `wiring/core.ts`(`ipc.handle`을 `ipcMain.handle`에 바로 넘김, 창 load 때 core 상태 push), `core/connection.ts`(`CORE_CALL|WATCH|STATE_GET_CHANNEL` handler, `targets`로 모든 창에 미는 상태와 event, `upload`·`file` kind), `wiring/desktop-window.ts`(`openDesktopWindow`, `recentWindow`, `sendIntent`, `showDesktopWindow`, `windowHooks.created`), `wiring/desktop.ts`(시작, tray, 두 번째 실행), `window.ts`(`windowTitle`), `security.ts`, `preload/shell.ts`(bridge 목록과 role), `preload/core-api.ts`, `main/notice/presence.ts`(`createPresenceReporter`), `wiring/notice.ts`(focus를 `ctx.windows.has`로 본다), `app-frame/electron-overlay.ts`(창마다 overlay를 붙이고 registry에 올린다), 다른 기계의 byte route 꼴 `packages/core/remote/call.ts`(upload는 `{ input, base64 }`, file 답은 `{ content_type, base64 }`), `tools/dev.ts`(data root `.dev-data`, Electron을 `--home`으로 띄우는 줄)
- 계약:
  - 쓰는 것: `Machines`(viewer), `shell:core-*` 상수와 schema(`packages/shell/ipc/core.ts`), `presence/report` 입력(`packages/protocol/attention/routes.ts`)
  - 내놓는 것(README 계약 4·5. `remote-desk-renderer`가 기댄다):
    - channel `MACHINES_OPEN_CHANNEL = "shell:machines-open"`(`{ machine }` → `{ ok }`. 그 기계의 창을 열거나 앞으로 가져온다. 이 컴퓨터의 id면 이 컴퓨터의 창), `MACHINES_THIS_WINDOW_CHANNEL = "shell:machines-this-window"`(→ `{ machine: { id, name } | null }`. 보낸 창이 다른 기계의 창이면 그 기계), `MACHINES_VISIBLE_CHANNEL = "shell:machines-visible"`(`noticeVisibleSchema`의 session 꼴. 다른 기계의 창만 부른다). `LophnMachinesApi`에 `open(machine)`, `thisWindow()`.
    - 다른 기계의 창 preload(`preload-remote.cjs`)가 여는 bridge: `lophnCore`, `lophnMachines`, `lophnShell`(overlay와 `openExternal`만. secret 입력, 결정 handle, 앱 view, annotate는 없다), `lophnShortcuts`, `lophnIntents`, `lophnWindow`, `lophnNotice`(`visible`만 `shell:machines-visible`로 가고 `open`은 아무것도 안 하며 toast·reveal은 오지 않는다). 그 밖의 bridge(`lophnTerminal`, `lophnFiles`, `lophnFolders`, `lophnLayout`, `lophnGlobalFloats`, `lophnBrowser`, `lophnArtifact`, `lophnDetached`, `lophnAppWindows`, `lophnCoding`, `lophnExtensions`, `lophnHarnessGuiTab`, `lophnInstructions`, `lophnMemory`, `lophnThreadBookmarks`, `lophnSurface`, `lophnAppearance`)는 없다.
    - `ctx.machineOf(contents): Id<"mch"> | null`. 다른 기계의 창은 `ctx.windows`·`detached`·`appWindows`에 들지 않는다.

## 할 일

1. `machine-route.ts`(Electron 없이): 보낸 webContents id로 기계를 찾는 표(`bind(contentsId, machine)`, `unbind`, `machineOf`)와, 다른 기계의 창이 보낸 IPC를 고르는 규칙. core 통로 셋(`shell:core-call`, `shell:core-watch`, `shell:core-state-get`)은 그 기계의 `Connection`으로 간다: call은 `{ resource, method, body }`로(kind는 core가 route 표로 안다), `upload`는 `bytes`를 `{ input: body, base64 }`로, `file` 답 `{ content_type, base64 }`는 `{ bytes, contentType }`으로 바꾼다. 연결이 없으면 `unavailable`이고 그 기계의 연결에 `resume()`을 건다(다시 시도 단추가 `platform/status`를 불러도 이 길로 다시 붙는다). watch는 그 연결의 `watch`, state-get은 그 연결의 지금 상태(`starting|ready|stale`, `confirmedAt`). 그 밖에 허락하는 channel의 목록(기계 목록 channel, 창 조작, overlay, 단축키·intent, 외부 열기)을 한 상수로 두고 나머지는 `{ ok: false, error: { code: "forbidden" } }`(handle) 또는 무시(on)다.
2. `context.ts`: `ctx.ipc.handle`과 `ctx.ipc.on`이 listener 앞에서 `machineOf(sender)`를 보고 다른 기계의 창이면 1의 규칙을 탄다(영역마다 고치지 않는 한 곳). `connectCore`에 넘기는 `ipc.handle`도 같은 둘레를 탄다(`wiring/core.ts`: core 통로 셋은 다른 기계의 창이면 1로, 아니면 지금 handler로). `shellWindowOf`가 다른 기계의 창도 찾아 창 단추가 된다. `machineOf`를 낸다.
3. `machine-windows.ts`(`register(ctx, machines)`): 
   - 창 열기: 기계마다 하나. 이미 있으면 앞으로. `openWindow`로 `preload-remote.cjs`, 주소는 이 컴퓨터 창과 같은 `DESKTOP_URL`(기계는 주소가 아니라 main의 표가 정한다), 제목 `windowTitle`의 기계 꼴("<이름> — lophn"), 자리는 이 컴퓨터의 마지막 창 자리. `overlays.attach`와 창 단추 상태, 끌기·navigation guard, main이 문서마다 넣는 appearance CSS(이 desktop의 모양이다)는 이 컴퓨터 창과 같고 `ctx.windowHooks.created`(core 상태 push 등 이 컴퓨터의 반응)는 부르지 않는다. 닫히면 표에서 빼고 그 연결의 watch를 비운다.
   - 그 기계의 연결 상태와 event를 그 창에만 민다(`CORE_STATE_CHANNEL`, `CORE_EVENT_CHANNEL`). 기계 목록이 바뀌면 `MACHINES_CHANGED_CHANNEL`을 다른 기계의 창에도 민다. 보이는 이름이 바뀌면 창 제목을 고친다. 목록에서 빠진 기계의 창은 닫는다(removed는 닫지 않는다: 창이 그 gate를 보인다).
   - `MACHINES_OPEN_CHANNEL`, `MACHINES_THIS_WINDOW_CHANNEL`, `MACHINES_VISIBLE_CHANNEL` handler(이 컴퓨터의 창도 open·thisWindow를 부른다).
   - presence: 다른 기계의 창마다 `createPresenceReporter`(view: 그 창의 focus와 `MACHINES_VISIBLE_CHANNEL`로 받은 session, idle: `powerMonitor`, send: 그 연결로 memory `presence/report`). 창이 닫히면 `focused: false`를 한 번 보낸다. 연결이 다시 ready가 되면 다시 보낸다.
   - 마지막에 쓴 기계: 창이 focus를 받을 때 그 창의 기계 연결이 ready면 `machines.markUsed(id)`, 이 컴퓨터 창이면 이 컴퓨터 id.
4. 시작과 창이 없을 때(`desktop-window.ts`, `desktop.ts`, `context.ts`의 `desktop.open|show`): 창이 하나도 없을 때 여는 길(앱 시작, tray Open, 두 번째 실행, macOS activate)은 시작 기계를 연다. 시작 기계는 core를 기다리지 않고 `viewer/store.ts`의 읽기 함수(`machines.json`의 `start`·`last`와 그 기계가 목록에 있는지만 본다. key와 표지는 보지 않는다)로 고른다. 못 읽거나 이 컴퓨터면 지금처럼 이 컴퓨터의 창이다. 나중에 표지가 달라 저장이 버려지면 그 창은 목록에서 빠져 닫히고 이 컴퓨터의 창이 열린다. 창이 있으면 가장 최근 창(어느 기계든)을 앞으로. `openInactive`(agent 창), `sendIntent`, `recentWindow`, 알림, surface는 지금처럼 이 컴퓨터의 창만 본다.
5. `remote.ts` preload와 `build.ts` entry: 위 계약의 bridge만 연다. `machines-api.ts`에 `open`, `thisWindow`.
6. `tools/dev.ts`: 두 번째 desktop을 `<저장소>/.dev-data/viewer`(자기 core와 shell. fake provider는 같은 것)로 띄우는 option 하나(`npm run dev -- --viewer` 꼴. 이름은 dev.ts의 이웃 option을 따른다). 사람의 `~/.lophn`은 읽지도 쓰지도 않는다.
7. 이 task는 화면 문구를 더하지 않는다(창 제목은 기계 이름과 제품 이름뿐이다). 문구가 필요하면 보고의 "넘길 줄"에 적고 `remote-desk-renderer`가 key를 둔다.
8. flows: `areas/ipc.yaml`에 channel 셋, `areas/shell-desktop.yaml`에 다른 기계의 창 열기·시작 기계·창이 없을 때 여는 것의 흐름, `tests/shell.yaml`에 새 test. `node tools/flows.ts check`.

## 끝남

- `npm run check`가 통과한다.
- 위험 test(`machine-route_test.ts`): "다른 기계의 창이 보낸 `shell:core-call`은 그 기계의 연결로만 가고 이 컴퓨터의 core는 불리지 않으며, 같은 창이 보낸 이 컴퓨터 전용 channel(터미널 열기, file 읽기, secret 입력 열기, layout 쓰기)은 `forbidden`이고 handler가 불리지 않으며, 이 컴퓨터의 창이 보낸 같은 call은 이 컴퓨터의 core로 간다"
- subprocess, 서버, 브라우저를 띄우는 test는 만들지 않는다.
- 개발에서 본다: plan worktree에서 개발 core(`npm run dev:core`, `npm run dev:remote`, port 47432)를 host로, 6의 두 번째 desktop을 viewer로 띄워 Settings가 아직 없으면 `lophnMachines.pair`를 devtools로 불러 pairing하고, 다른 기계의 창이 그 이름으로 열려 session 목록을 받는지, 터미널 bridge가 없는지, host core를 멈추면 창이 stale이고 다시 켜면 붙는지, 다시 시작하면 그 창이 먼저 열리는지 본다. 그림은 `.dev-data/remote-desk-windows/shots/`. 사람의 `~/.lophn`, 실제 relay, 실제 provider를 쓰지 않는다. 띄운 process는 끝에 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 다른 기계의 창에 허락한 channel 목록과 이유, renderer가 그 창에서 부르다 거절된 channel(개발에서 본 것. `remote-desk-renderer`가 감출 곳), `tools/dev.ts`의 새 option 쓰는 법, lead가 고칠 목록(`architecture/remote.md`의 기계마다 창과 IPC 둘레, `architecture/attention.md`의 다른 기계 창 presence, `architecture/platform.md`).
