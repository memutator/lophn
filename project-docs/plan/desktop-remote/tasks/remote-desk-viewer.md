# remote-desk-viewer

**opus high.** desktop이 다른 기계를 보는 기기가 되는 shell main 쪽 바탕을 짓는다: 이 desktop의 기기 key와 짝지은 기계 목록·시작 기계를 `<root>/shell/viewer/`에 두고(이 기계의 machine id 표지, 0600), 짝지은 기계마다 `@lophn/remote-client` 연결 하나를 앱이 도는 동안 들며, 붙여 넣은 pairing text로 kind `desktop` 기기로 pairing하고, 기계 목록과 관리 IPC(`shell:machines-*`)와 preload bridge `lophnMachines`를 낸다. 창을 기계에 묶는 일은 `remote-desk-windows`가 한다.

- 단위: desk-viewer (wave 2)
- 선행: remote-desk-client
- 소유(이 task만 고친다):
  - `packages/shell/ipc/machines.ts`(새 file)
  - `packages/shell/preload/machines-api.ts`(새 file)
  - `packages/shell/preload/shell.ts`(`lophnMachines`를 여는 한 줄과 import만)
  - `packages/shell/main/desktop/viewer`(새 폴더: `store.ts`, `store_test.ts`, `list.ts`, `list_test.ts`, `links.ts`)
  - `packages/shell/main/desktop/wiring/machines.ts`(새 file)
  - `packages/shell/main/desktop/main.ts`(등록 한 줄과 import만)
  - `project-docs/flows/areas/ipc.yaml`
  - `project-docs/flows/tests/shell.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/desktop-remote/README.md`의 "정한 것"(기기 key와 목록의 자리와 보호, 늘 드는 연결, 붙여 넣기 pairing과 자기 자신 거절, hello 이름, 시작 기계, 지울 때)과 "다른 계획이 기대는 계약" 2·3·4, "계약 바꾸기 요청"(답에 따라 이름을 40자로 자르거나 그대로)
  - 앞 계획의 계약: `project-docs/plan/machine-identity/README.md`의 "다른 계획이 기대는 계약" 1(`machine/status`, 기계에 묶인 상태의 표지 규칙)·2(hello, `connectRemote`의 `name`·`machine`, 접기)·3(desktop `pair` frame `{ kind: "desktop", os }`)·4(보는 쪽 별명과 알린 이름)
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 3.3(성공한 전환만 기억, 기본이 사라지면 돌아감), 4.3(자격 전 확인, 같은 기계는 접기), `paseo.md` 13 "가져올 만한 것" 1·2(`self_host` 거절)
  - architecture: `project-docs/architecture/remote.md`(지키는 것 4·6: 기기 key, unpair), `project-docs/architecture/platform.md`(data root, 0600)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/shell/main`, `packages/remote-client`, import 규칙 `tools/check-deps.ts`
  - 앞 task의 결과: `packages/remote-client/mod.ts`(`createComputers`, `createConnection`, `dialWebSocket`, `pair`, `parsePairingText`, `unpair`, `Computer`, `Connection`)
  - 지금 코드: shell main 영역 등록 꼴 `packages/shell/main/desktop/wiring/{context.ts,core.ts,layout.ts}`(`ctx.ipc`, `ctx.relay.ready`, `ctx.coreInternal`, `overlays.overlayRegistry()`와 `checkCaller`), `packages/shell/main/desktop/core/layout-ipc.ts`(IPC handler와 입력 검사 꼴), `packages/shell/main/workspace/window-state.ts`(data root 안 shell file 쓰기), `packages/shell/ipc/core.ts`(channel 상수와 zod 꼴), `packages/shell/preload/{shell.ts,core-api.ts}`(bridge 꼴), 폰의 같은 조립 `packages/mobile/src/data/phone.ts`(`createPhoneComputers`)와 `src/pairing/store.ts`(key 만들기)
- 계약:
  - 쓰는 것: `@lophn/remote-client`, memory route `machine/status`(사람 자격, `ctx.coreInternal`로 부른다), 기기 route `devices/unpair`
  - 내놓는 것(README 계약 2·3·4):
    - `packages/shell/ipc/machines.ts`: `MachineList = { state: "starting"|"ready"|"unreadable"; this: { id; name } | null; machines: MachineRow[]; start: { mode: "last" } | { mode: "machine"; machine: Id<"mch"> }; last: Id<"mch"> | null }`, `MachineRow = { id; name; announced: string|null; alias: string|null; status: "connecting"|"connected"|"offline"|"removed"; path: "direct"|"relay"|null; last_seen_at: string|null }`(`state`가 `starting`이면 이 기계의 id를 아직 모른다, `unreadable`이면 저장 file을 못 읽었다). channel `MACHINES_LIST_CHANNEL = "shell:machines-list"`(→ `MachineList`), `MACHINES_CHANGED_CHANNEL = "shell:machines-changed"`(main→renderer, 목록 통째), `MACHINES_PAIR_CHANNEL = "shell:machines-pair"`(`{ text: string(1..4096) }` → `{ ok: true; machine } | { ok: false; reason: "invalid_text"|"unreachable"|"refused"|"expired"|"closed"|"this_computer"|"unavailable" }`), `MACHINES_REMOVE_CHANNEL = "shell:machines-remove"`(`{ machine }`), `MACHINES_RENAME_CHANNEL = "shell:machines-rename"`(`{ machine, alias: string(1..64, trim) | null }`), `MACHINES_START_CHANNEL = "shell:machines-start"`(`start` 모양). 실패는 `{ ok: false, code }`(공통 code). 입력 schema는 `strict`.
    - `LophnMachinesApi`(같은 file): `list()`, `onChanged(listener)`, `pair(text)`, `remove(machine)`, `rename(machine, alias)`, `setStart(start)`. `remote-desk-windows`가 `open(machine)`과 `thisWindow()`를 더한다.
    - `wiring/machines.ts`의 `register(ctx): Machines & Registered`: `Machines = { list(): MachineList; subscribe(listener): () => void; connection(machine): Connection | undefined; markUsed(machine): void; startMachine(): Id<"mch"> | null }`. `startMachine`은 아래 할 일 5의 규칙, `markUsed`는 `last`를 적는다(부르는 쪽이 "연결된 채 focus를 받았다"를 본다).

## 할 일

1. `viewer/store.ts`(Electron 없이 fs와 시각을 인자로): `<root>/shell/viewer/key.json`(`{ machine, secret_key }`. `remoteKeyText` 꼴)과 `machines.json`(`{ machine, computers: Computer[], start, last, seen: Record<Id<"mch">, at> }`). 폴더 0700, file 0600, temp에 쓰고 rename. 열 때 이 기계의 machine id를 받는다: file이 없으면 새 key를 만들어 쓴다. `machine`이 다르면 두 file을 지우고 새로 시작한다(복제된 data root. 로그 한 줄). JSON이 깨졌거나 모양이 틀리면 덮지 않고 `unreadable`을 돌려준다(그 동안 key를 새로 만들지 않는다).
2. `viewer/links.ts`: 기계마다 link. `createConnection({ endpoint, machine: computer.machine, key, dial: dialWebSocket, random: cryptoRandom, name, capabilities: [], now, wait, onRevoked, onPeer })`. 상태는 `starting→connecting`, `ready→connected`, `stale→offline`, path, `unpair`는 package `unpair`. `name`은 이 기계의 `MachineStatus.name`(계약 바꾸기 요청의 답이 없으면 40자로 자른다). `onPeer`가 알린 이름과 machine id를 store(`announced`, `machine`)에 적는다(package store의 규칙대로). connected가 되거나 끊길 때 `seen[id]`를 그때로 적는다(전이 때만 쓴다). Electron main의 전역 `WebSocket`(Node 24, `core/node-io.ts`가 이미 쓴다)을 그대로 쓴다.
3. `wiring/machines.ts`: `ctx.relay.ready`에서 `ctx.coreInternal("memory", "machine", "status", {})`로 이 기계의 id와 이름을 처음 한 번 받은 뒤 store를 열고 `createComputers`(load는 store, save는 store, open은 links, pair는 할 일 4)로 연결을 연다. 그 전과 store가 `unreadable`인 동안은 `state`만 다른 목록을 낸다. 목록이 바뀌면 `MACHINES_CHANGED_CHANNEL`로 `ctx.windows`(이 컴퓨터의 창)에 통째로 민다. `subscribe`로도 알린다(`remote-desk-windows`가 다른 기계의 창에 민다). `stop`은 연결을 닫는다(core와 다른 기계는 그대로).
4. pairing(`MACHINES_PAIR_CHANNEL`): `parsePairingText`가 실패하면 `invalid_text`. package `pair(qr, { key, dial, random, name, capabilities: [], device: { kind: "desktop", os }, self: this.id })`. os는 `process.platform`의 `linux`→`linux`, `darwin`→`macos`, `win32`→`windows`. 실패를 reason으로 옮긴다(`refused`의 `not_found`는 `expired`). 성공하면 store가 같은 key나 같은 machine id의 항목을 접는다.
5. 관리 channel: `remove`는 연결돼 있으면 `unpair` 뒤 닫고 목록에서 뺀다(닿지 않으면 그냥 뺀다. 지금 폰과 같다). 지운 기계가 `start.machine`이면 `start`를 `{ mode: "last" }`로, `last`면 `last`를 이 기계 id로. `rename`은 별명을 두거나 지운다. `setStart`는 목록에 있는 기계나 이 기계만 받는다(`invalid_input`). `startMachine()`: 이 기계의 id를 모르면 null. `start`가 machine이고 그 기계가 목록에 있고 removed가 아니면 그것, 아니면 `last`가 목록에 있고 removed가 아니면 그것, 아니면 이 기계.
6. `viewer/list.ts`: store와 link 상태로 `MachineList`를 짓는 순수 함수와 `startMachine` 규칙. 보이는 이름은 별명 ?? 알린 이름 ?? `defaultName`.
7. IPC: 각 handler는 `checkCaller`(overlay registry)로 desktop 창 본문만 받고 입력을 `checkInput`으로 본다(`core/layout-ipc.ts` 꼴). preload `machines-api.ts`의 `createMachinesApi(ipcRenderer)`가 위 channel을 부르고 `onChanged`가 push를 schema로 거른다. `preload/shell.ts`가 shell role에 `lophnMachines`를 연다.
8. `main.ts`: `add(machines.register(ctx))`를 core 연결 다음에 둔다(돌려준 값은 `remote-desk-windows`가 받는다).
9. flows: `areas/ipc.yaml`에 여섯 channel의 flow(입구, sender 검사의 `forbidden`, 입력 `invalid_input`, pair의 실패 갈래), `tests/shell.yaml`에 새 test file. `node tools/flows.ts check`.

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - `viewer/store_test.ts`: "key는 한 번 만들어지고(0600) 다시 열면 같은 key이며, 다른 machine id가 적힌 저장은 버려져 새 key와 빈 목록이 되고, 깨진 `machines.json`은 덮이지 않고 `unreadable`이며 그 동안 key가 새로 생기지 않는다"
  - `viewer/list_test.ts`: "시작 기계가 목록에서 빠졌거나 removed면 마지막에 쓴 기계로, 그것도 없으면 이 기계로 열고, 지운 기계가 시작 기계였으면 `start`가 last가 된다"
- subprocess, 서버, 브라우저를 띄우는 test는 만들지 않는다.
- 개발에서 본다: 개발 core(`npm run dev:core`, `npm run dev:remote`의 pairing text, port 47432)에 이 desktop(같은 `.dev-data`여도 된다. 자기 자신 거절을 먼저 본다)으로 pairing해 `this_computer`가 나는지 본다. 다른 data root로 띄우는 길은 `remote-desk-windows`가 만들므로 여기서는 `tools/remote-client.ts`나 test의 메모리 core로 pairing·접기·지우기를 본다. 사람의 `~/.lophn`과 실제 relay를 쓰지 않는다. 띄운 process는 끝에 모두 정리한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `key.json`·`machines.json`의 실제 예(secret은 가린다), 이 기계의 machine id를 받기 전 상태가 얼마나 가는지, `Machines` API를 `remote-desk-windows`가 쓰는 법 한 단락, lead가 고칠 목록(`architecture/remote.md`의 desktop 기기 key 규칙, `architecture/settings.md`).
