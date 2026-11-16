# desktop-remote: desktop 앱이 다른 기계의 lophn을 그 기계의 창으로 연다

- 목표: roadmap `multi-machine.md` "순서" 1과 "모양" 2. desktop 앱이 다른 기계의 core에 kind `desktop` 기기로 pairing해(그 기계가 보이는 pairing text를 붙여 넣는다) 그 기계의 session, 대화, 승인, Inbox를 폰처럼 본다. 기계마다 창이 하나이고, title bar의 기계 고르기가 이 컴퓨터와 짝지은 기계를 이름, online, 마지막으로 본 때와 함께 보이며, 시작 때 여는 기계(보는 쪽마다의 기본)를 정한다. 연결 조각은 폰과 desktop이 같이 쓰는 workspace package로 옮긴다.
- 재료: `/home/pyosechang/projects/lophn/reports/multi-machine/program.md`(계획 경계와 정한 정책. roadmap과 다르면 이것이 새것이다), `project-docs/products/roadmap/multi-machine.md`, 코드 조사 `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md`(B, C, A와 끝의 표), `project-docs/plan/machine-identity/README.md`의 "다른 계획이 기대는 계약"(이 계획은 그 계획의 land 뒤에 돈다), harness 비교 `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 3·4·5절과 `paseo.md`·`mixdog.md`·`open-code.md`·`emdash.md`의 "lophn에 주는 것", `project-docs/architecture/{remote,attention,acp,workspace-layout,settings,platform}.md`.
- 범위 밖(가는 계획):
  - 다른 기계 관리(설정, secret, provider 설정, 거기서의 기기 등록), 화면 없는 기계: 보류(roadmap "보류"). 각 기계의 처음 설정은 그 기계의 화면에서 한다.
  - 다른 기계의 앱 화면(앱 panel, 앱 창, 앱 view): 띄우지 않는다. 뒤 계획도 없다(사람, 2026-11-16). sync 앱은 폴더로 각 기계에 사본이 있어 그 기계에서 직접 연다.
  - agent가 다른 기계에 일을 보내기: 보류(roadmap).
  - 폴더 sync, 기계 기록을 폴더로, agent가 읽는 환경 도구: `app-folder-sync`. 이 계획은 그 도구에 줄 사실만 아래 계약 6에 적는다.
  - 기계 사이에서 같은 project 묶기(다른 기계 창의 project를 이 기계의 것과 잇기): `project-identity`의 마지막 task.
  - 기기 kind, hello, 기계 기록, 이름, 복제 판정: `machine-identity`.
  - "늘 켜 둠"과 Settings › Remote의 그 스위치: `always-on`. 판이 다른 기계 사이의 안내: `machine-update`.

## 정한 것

- 다른 기계의 앱 화면은 띄우지 않는다. 미룬 것이 아니라 하지 않는 것이다: 다른 기계에서 필요한 것은 session, 대화, 승인이고, 앱은 그 기계나 폰에서 쓰거나 sync 앱이면 이 기계의 사본을 쓴다 (사람, 2026-11-16).

- desktop 기기의 권한은 폰과 같다(보기, 말하기, 승인·질문 답, 앱 쓰기). allowlist는 kind로 가르지 않고 desktop 때문에 관리 route를 넣지 않는다 (사람·planner, program 14).
- 더하는 route는 `unseen/list|dismiss` 둘뿐이다: 보는 것이 읽음을 만들고 읽음은 host에 둔다(조사 `open-code.md` 13). 폰도 같이 받는다 (planner).
- 한 창은 사는 동안 한 기계만 본다. 기계를 바꾸면 그 기계의 창을 열거나 앞으로 가져온다. 기계마다 창은 하나다. renderer가 창마다 core 하나를 module 수준에서 잡고 source 스무 개를 그 위에 지으며(`renderer/desktop/entry.tsx`) layout도 그 기계의 id에 묶여 있어서다 (planner).
- 다른 기계와의 연결은 shell main이 든다(renderer CSP `connect-src 'self'`). 그 기계의 창은 지금의 `lophnCore` 통로를 그대로 쓰고, main이 보낸 창(webContents)으로 어느 기계인지 가른다. renderer가 기계를 주장하지 못한다 (planner).
- 다른 기계의 창은 따로 preload를 받는다(core, 기계 목록, overlay, 창 조작, 단축키만). 이 컴퓨터의 shell host가 필요한 bridge가 없으니 renderer는 bridge가 없을 때의 길로 그 기능을 감추고, main은 그 창이 보낸 그 밖의 IPC를 한 곳에서 거절한다 (planner).
- 다른 기계의 창에서 끄는 것: 터미널과 coding agent 터미널·GUI, 편집기·file tree·file 열기, 지침·memory 편집, secret 창, browser·artifact 탭, agent가 여는 탭(host link), 앱 화면·앱 panel·앱 창, detached 탭, Settings, provider 설정, agent·앱·project·job 만들기와 고치기, extension, thread bookmark, 그 기계의 OS 알림. 단추는 보이지 않고, 그런 탭이 설 자리에는 "This opens only on <이름>"이 선다. 이 컴퓨터의 shell host가 필요하거나 기기가 부를 수 없는 route라서다 (planner).
- 다른 기계 창의 Settings 자리에는 "<이름>의 설정은 그 기계에서 바꾼다"와 이 컴퓨터 창을 여는 단추만 있다. 짝지은 기계의 관리는 이 컴퓨터 창의 Settings › Remote가 한다 (planner).
- 다른 기계 창의 layout(탭, desk)은 저장하지 않는다. 다시 열면 Home이다. layout file이 기계 안 id에 묶이고 detached 창까지 다른 기계에 묶는 일이 따라와서다 (planner).
- 어느 기계를 보는지 늘 이름으로 보인다: title bar 왼쪽의 기계 고르기(보이는 이름 = 별명 ?? 알린 이름)와 OS 창 제목 "<이름> — lophn". 짝지은 기계가 없으면 고르기를 그리지 않아 한 대만 쓰는 사람의 화면은 그대로다 (planner).
- 공용 연결 조각은 새 package `packages/remote-client`(`@lophn/remote-client`)다: 연결(주소 경주, 재연결, dial), 기계 목록 store, pairing text 읽기와 pair, unpair. 폰만의 것(컴퓨터의 `request`에 답하기, SecureStore, 화면 칸, sample 컴퓨터)은 폰에 남는다. protocol은 구현을 두지 않아서(module-catalog) 따로 둔다 (planner).
- desktop의 기기 key와 기계 목록은 `<root>/shell/viewer/`의 `key.json`·`machines.json`(0600, temp에 쓰고 rename)이고 이 기계의 machine id를 표지로 적어 다르면 버린다(복제된 data root). core의 host key와 같은 보호다. OS keyring(safeStorage)은 쓰지 않는다: 같은 자리의 host key가 이미 0600 평문이고 keyring 없는 Linux에서 실패 갈래만 는다 (planner).
- 그 file은 ledger 밖이라 recovery 복구본, 내보내기, 폴더 어디에도 실리지 않는다. 못 읽는 file은 덮지 않고 기계 보기를 끈 채 오류를 보인다 (planner, 조사 규칙).
- desktop은 짝지은 기계마다 연결 하나를 앱이 도는 동안 든다(폰과 같다). 기계 목록의 online과 마지막으로 본 때가 그 연결에서 온다. 꺼진 기계는 backoff로 다시 붙고 아무 창도 막지 않는다 (planner, 조사 규칙).
- pairing은 이 컴퓨터 창의 Settings › Remote "Computers you view"에서 pairing text를 붙여 넣어 한다. 카메라 길은 없다. hello의 machine id가 이 기계의 것이면 pair frame을 보내지 않고 거절한다(자기 자신) (planner, 조사 `paseo.md`).
- desktop은 client hello `name`으로 이 기계의 이름(`machine/status`)을, `capabilities`로 빈 목록을 보내고, `pair`는 kind `desktop`과 os다 (planner, machine-identity 계약 2·3).
- 시작 때 여는 기계는 보는 쪽마다 하나다: "마지막에 쓴 기계"(기본) 또는 고른 기계. 마지막에 쓴 기계는 연결된 채 focus를 받은 마지막 창의 기계다(성공한 전환만 남는다). 정한 기계가 목록에서 빠졌거나 지워졌으면 이 컴퓨터다 (planner, 조사 `hermes`·`herdr`).
- 정한 기계가 꺼져 있어도 그 창을 바로 연다. 창은 "offline · 마지막으로 본 때"와 [Try again]·[This computer]를 보인다(꺼진 기계가 창을 막지 않는다) (planner, 조사 `mixdog.md`).
- 시작 기계인 기계를 지울 때 확인 dialog가 그것을 알리고, 지운 뒤에는 "마지막에 쓴 기계"로 돌아간다 (planner, 조사 `orca.md`).
- 창이 하나도 없을 때 여는 길(시작, tray Open, 두 번째 실행)은 시작 기계를 연다. agent와 이 컴퓨터의 core가 쓰는 창(browser, 탭, 알림, 전역 키, agent 창)은 늘 이 컴퓨터의 창이다 (planner).
- presence: 다른 기계의 창이 focus를 가졌거나 보이는 session이 바뀌면 shell main이 그 기계에 `presence/report`(focused, idle_ms, looking)를 기기 자격으로 보낸다. kind desktop의 presence 규칙, push 없음, 기준 아님, preview frame 없음은 machine-identity가 짓는다. 이 컴퓨터의 알림과 presence는 다른 기계의 창을 세지 않는다 (planner).
- 두 기기가 한 session에 쓸 때: 보내기가 그 화면이 아는 마지막 사람 메시지(`seen`)를 싣고, 그 뒤에 다른 사람 메시지가 있으면 core가 같은 transaction 안에서 `conflict`로 거절하고 아무것도 넣지 않는다. 화면은 "다른 기기에서 바뀌었다"를 보이고 대화를 다시 읽는다. 합치지 않는다. 같은 renderer source를 쓰는 폰과 이 컴퓨터 창도 같다. coding agent(harness) session은 대상이 아니다 (planner, 조사 `mixdog.md` 6.1).
- 꺼진 기계에 맡겨 두는 queue는 없다. 연결이 없으면 보내기는 `unavailable`로 끝나고 화면은 쓴 글을 남긴다 (사람·planner, roadmap).
- 기계 목록은 main이 통째로 밀고 renderer가 한 번에 바꾼다. 기계 사이의 session 목록 합치기는 없다(창마다 한 기계) (planner, 조사 규칙).
- 다른 기계(host) 쪽 문구: Settings › Remote의 "phone"을 "phone or computer"로 바꾼다. 같은 code로 컴퓨터도 짝지어서다. 기기 줄의 kind 표시는 machine-identity가 한다 (planner).
- worker는 `sonnet-high`, `remote-desk-client`·`remote-desk-viewer`·`remote-desk-windows`·`remote-desk-renderer`는 opus high다(brief 머리에 적었다) (planner).

## 다른 계획이 기대는 계약

1. **공용 연결 package** `packages/remote-client/mod.ts`(`@lophn/remote-client`. protocol과 base만 import한다. `node:`도 React Native도 import하지 않는다. 폰은 상대 path, shell main은 상대 path로 읽는다): `openFirst`, `createConnection`, `dialWebSocket`(표준 전역 WebSocket: React Native, Node 24, Electron main), type `Connection`·`CoreSource`·`CoreCall`·`CoreReply`·`CoreEventMessage`·`ConnectionState`·`Endpoint`·`Dial`·`ConnectionPath`; `createComputers`와 `Computer`(`Endpoint & { device, revoked, name?(보는 쪽 별명), announced?, machine? }`)·`Computers`·`Link`·`ComputerItem`; `parsePairingText`, `pair`, `PairFailure`, `PairDevice`; `unpair`. 모양은 `tasks/remote-desk-client.md`의 "내놓는 것"이다. 이 package 밖에서 Noise 연결을 새로 짜지 않는다.
2. **desktop 기기 저장.** `<root>/shell/viewer/key.json`(`{ machine, secret_key }`)과 `machines.json`(`{ machine, computers, start, last, seen }`), 둘 다 0600. shell main의 `packages/shell/main/desktop/viewer/`만 읽고 쓴다. `machine`이 이 기계의 id와 다르면 둘 다 버리고 새로 시작한다. 어느 내보내기에도 넣지 않는다.
3. **renderer가 읽는 기계 목록** `MachineList`(`packages/shell/ipc/machines.ts`): `{ state: "starting"|"ready"|"unreadable", this: { id, name } | null, machines: [{ id, name, announced, alias, status: "connecting"|"connected"|"offline"|"removed", path: "direct"|"relay"|null, last_seen_at }], start: { mode: "last" } | { mode: "machine", machine }, last: id | null }`. id는 모두 `mch_`다("local" 같은 값을 쓰지 않는다).
4. **IPC 이름**(preload bridge `lophnMachines`): `shell:machines-list`, `shell:machines-changed`(main→renderer, 목록 통째), `shell:machines-pair`, `shell:machines-remove`, `shell:machines-rename`, `shell:machines-start`(viewer task), `shell:machines-open`, `shell:machines-this-window`, `shell:machines-visible`(windows task). 다른 기계의 창도 `shell:core-call|core-watch|core-state-get|core-state|core-event`를 그대로 쓴다.
5. **창 규칙.** 한 창은 한 기계다. 다른 기계의 창은 `ctx.windows`에 들지 않고(이 컴퓨터의 알림, presence, surface, 전역 키가 그 창을 보지 않는다) `ctx.machineOf(webContents): Id<"mch"> | null`로 찾는다.
6. **`app-folder-sync`의 환경 도구에 줄 사실**(planner가 넘긴다): 이 컴퓨터가 보는 기계 목록(id, 보이는 이름, online, 마지막으로 본 때)과 시작 기계. 정본은 shell main의 위 2이고 core는 모른다. 싣는다면 shell main이 core에 알리는 길을 그 계획이 정한다.

## 계약 바꾸기 요청

- `machine-identity`에: client hello `name`을 1~64자로 넓혀 주기(지금 1~40, 기기 표 `name`과 `devices/connected`·`devices/rename` 입력도 같이). desktop은 이 기계의 이름(`MachineStatus.name`, 1~64)을 알린다. 받지 않으면 desktop이 40자로 자른다(`remote-desk-viewer`가 그렇게 짓는다).

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `remote-desk-client` | (opus high) `packages/remote-client`를 만들고 폰의 연결·기계 store·pairing을 옮긴다. 폰은 거기서 import한다. 자격 전 id 확인 위험 test |
| 1 | `remote-desk-screens` | 화면 조각을 fake source로: 기계 고르기, Settings › Remote "Computers you view"(붙여 넣기 pairing, 별명, 지우기, 시작 기계), 다른 기계 창의 gate·자리 표시·Settings 자리, host 쪽 문구. gallery page |
| 2 | `remote-desk-stale-send` | 보내기의 `seen`과 core의 `conflict`(같은 transaction), desktop과 폰의 composer가 `seen`을 채우고 거절 뒤 글을 남기고 다시 읽는다. 위험 test |
| 2 | `remote-desk-viewer` | (opus high) shell main: 기기 key와 기계 목록 저장(표지, 0600), 기계마다 연결, 붙여 넣기 pairing(kind desktop), `shell:machines-*` IPC와 `lophnMachines`. 저장 위험 test |
| 3 | `remote-desk-windows` | (opus high) 기계마다 창 하나: remote preload, core 통로를 창으로 가르기, 그 밖 IPC 거절, 창 제목, presence, 시작 기계, 개발용 두 번째 data root. 권한 경계 위험 test |
| 3 | `remote-desk-renderer` | (opus high) renderer의 다른 기계 모드: source를 다시 짓고 끄는 기능을 감추고 자리 표시, gate, 기계 고르기를 title bar에, Settings section을 실제 source에, allowlist의 `unseen` |

## 사람이 정할 것

- `remote-desk-screens`의 gallery(Screens › Settings의 Remote, Screens › Shell의 기계 고르기와 다른 기계 창)를 보고 승인한다. 승인 전에 `remote-desk-renderer`를 띄우지 않는다.

## lead가 할 일

- 돌리기 전에: `machine-identity`가 main에 land된 뒤에 연다(모든 task가 그 hello, kind, 별명 위에 선다). 띄우기 전에 그 README의 "다른 계획이 기대는 계약"(특히 별명 칸 이름과 `connectRemote`의 `name`·`machine`)을 brief와 대조하고 다르면 brief의 이름만 고친다. 위 "계약 바꾸기 요청"의 답을 `remote-desk-viewer` 전에 받는다.
- 공유 file(합칠 때 두 쪽을 다 남긴다):
  - `packages/shell/renderer/desktop/settings/remote/remote-panel.tsx`: `machine-identity`("This computer"), 이 계획(`remote-desk-screens`의 section 한 줄), `always-on`(스위치)이 각자 section component를 한 줄로 단다.
  - `packages/design/i18n/catalog/workspace-settings.ts`, 새 `packages/design/i18n/catalog/remote-desk.ts`(`remote-desk-screens`가 만든다), `conversation.ts`: key만 더한다. wave 3의 두 task가 `remote-desk.ts`에 같이 더한다.
  - `packages/shell/main/desktop/wiring/desktop.ts`(시작과 tray Open): `always-on`도 고친다(자동 시작).
  - `packages/shell/main/desktop/main.ts`: viewer와 windows가 등록 한 줄씩.
  - `packages/protocol/remote/allowlist.ts`, `project-docs/flows/areas/{ipc,shell-desktop,core-platform,sessions}.yaml`: 자기 줄만.
  - `tools/check.ts`, `tools/check-deps.ts`, `package-lock.json`, `project-docs/{module,boundary}-catalog.yaml`: `remote-desk-client`만 고친다.
- merge 때마다 `npm run check`. `remote-desk-client` 뒤에는 `cd packages/mobile && npm ci && npm run typecheck && npm test`와 worker가 남긴 emulator 그림을 본다.
- wave 3이 다 merge된 뒤 손으로 볼 것(Electron 창. 자동 check가 보지 못한다). host는 plan worktree의 개발 core(`npm run dev:core`, `npm run dev:remote`로 pairing text, port 47432), viewer는 `remote-desk-windows`가 더한 두 번째 data root로 띄운 desktop이다. 사람의 `~/.lophn`, 실제 relay, 실제 model provider는 쓰지 않는다(relay 길은 `npm run dev:relay`).
  1. viewer의 Settings › Remote "Computers you view"에 text를 붙여 넣어 pairing한다. host의 Settings › Remote 기기 목록에 "Desktop · Linux" 줄이 생기고 기준 폰은 그대로다. 자기 자신의 text는 거절된다. 틀린 text, 지난 code는 각자의 문구다.
  2. title bar에 기계 고르기가 생기고 이 컴퓨터가 맨 위, host가 그 아래(이름, online)다. host를 고르면 새 창이 "<host 이름> — lophn"으로 열리고 title bar에 그 이름이 보인다. 다시 고르면 같은 창이 앞으로 온다.
  3. host 창에서 Home의 session 목록, 대화 읽기와 보내기, 승인 답, Inbox, job 켜고 끄기가 된다. 터미널·편집기·browser·앱 화면·Settings 단추가 없고, 그런 탭 자리에는 "This opens only on <이름>"이다. 끄는 기능 목록(위 "정한 것")을 하나씩 본다.
  4. host 창에서 본 session은 host 창 안에서 finished 점이 꺼진다. host 창에 focus가 있는 동안 폰 push가 조용하다(quiet when present).
  5. 같은 session을 host 자신의 창과 viewer의 host 창에 띄우고 한쪽에서 보낸 뒤 다른 쪽이 새 글을 받기 전에 보내면 "changed on another device"로 거절되고 대화가 다시 읽힌다.
  6. host core를 멈추면 host 창이 마지막 화면 위에 끊김 한 줄을 보이고 기계 고르기는 offline·마지막으로 본 때다. viewer를 다시 켜면(시작 기계 = 마지막에 쓴 기계 = host) host 창이 offline gate로 바로 열리고 [This computer]가 이 컴퓨터 창을 연다. host를 다시 켜면 창이 저절로 붙는다.
  7. 시작 기계를 host로 고정한 채 Settings에서 host를 지우면 dialog가 알리고, host 창이 닫히며 다음 시작은 이 컴퓨터다. host에서 이 desktop을 Unpair하면 viewer의 host 창이 "removed" gate가 된다.
  8. relay 길: host의 주소를 막고(dev relay를 켠 채) 붙으면 기계 고르기의 path가 relay다.
  9. 기계 창에서 palette, 메뉴, dialog(overlay)가 뜨고 창 단추가 된다. 이 컴퓨터 창의 알림·tray·전역 키는 그대로다.
- 끝에(문서): `architecture/remote.md`(desktop 기기와 기계마다 창, 공용 package, desktop 기기 key의 자리와 규칙으로 "지키는 것" 4를 고침, `unseen`이 기기 route에 듦), `architecture/attention.md`(다른 기계 창의 presence, 이 컴퓨터의 알림이 그 창을 세지 않음), `architecture/acp.md`나 `agent-chat.md`(`seen`과 stale 거절), `architecture/workspace-layout.md`(다른 기계 창의 layout은 저장하지 않음), `architecture/settings.md`(Computers you view, 시작 기계), `boundary-catalog.yaml`·`module-catalog.yaml`(`remote-client` 다듬기), `project-docs/flows/`(`flows` skill로 마지막 대조), roadmap `multi-machine.md`(순서 1 끝남, 앱 화면을 끈 것), `packages/mobile/README.md`(연결 조각이 `packages/remote-client`에 있음), change-log `0.23/desktop-remote.yaml`(꺼진 기능 목록, 앱 화면, layout 저장 안 함, 붙여 넣기 pairing만). 사람이 앱 화면을 미루면 이슈 하나(누가 무엇을 못 하나).
