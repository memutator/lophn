# remote-desk-client

**opus high.** 폰 앱에만 있던 remote 연결 조각(주소 경주와 재연결, 기계 목록 store, pairing text 읽기와 pair, unpair, WebSocket dial)을 root workspace의 새 package `packages/remote-client`로 옮기고, 폰 앱이 거기서 import하게 한다. desktop의 shell main이 같은 조각을 쓰게 될 바탕이다. 폰은 지금과 똑같이 돌아야 한다. 폰만의 것(컴퓨터의 `request`에 답하기, SecureStore, 폰의 화면 칸, sample 컴퓨터, expo-crypto)은 폰에 남는다.

- 단위: remote-client (wave 1)
- 선행: 없음. `machine-identity`가 main에 land된 뒤에 띄운다(그 계획의 `machine-phone`이 고친 `connection.ts`·`computers.ts`·`pair.ts`를 옮긴다).
- 소유(이 task만 고친다):
  - `packages/remote-client`(새 package. `package.json`, `tsconfig.json`, `mod.ts`, `connection.ts`, `connection_test.ts`, `socket.ts`, `computers.ts`, `computers_test.ts`, `pairing.ts`)
  - `packages/mobile/src`(옮긴 file을 지우고 import를 고치는 곳. 아래 할 일 3)
  - `tools/check.ts`
  - `tools/check-deps.ts`
  - `package-lock.json`
  - `project-docs/module-catalog.yaml`
  - `project-docs/boundary-catalog.yaml`
  - `project-docs/flows/areas/core-platform.yaml`
  - `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - 계획: `project-docs/plan/desktop-remote/README.md`의 "정한 것"(공용 package)과 "다른 계획이 기대는 계약" 1
  - 앞 계획의 계약: `project-docs/plan/machine-identity/README.md`의 "다른 계획이 기대는 계약" 2(hello, `connectRemote`의 `name`·`machine`, 접기)·4(폰이 아는 컴퓨터 이름: 별명 `name`, `announced`, `machine`)
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` B("What the phone app adds": `connection.ts`가 generic code와 폰만의 `answerRequest`를 섞었다)
  - architecture: `project-docs/architecture/remote.md`(지키는 것 2·3·5·6)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/protocol`(구현을 두지 않는다)과 `packages/mobile`, `project-docs/boundary-catalog.yaml`의 `remote-protocol`, import 규칙 `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`
  - 폰 개발: `packages/mobile/README.md`(명령, emulator 규칙, `tools/remote-dev.ts`로 개발 core와 pairing하는 길). `packages/mobile`은 root workspace와 `npm run check` 밖이다
  - 지금 코드(land된 판으로 다시 읽는다): `packages/mobile/src/connection/{connection.ts,socket.ts,connection.test.ts}`(`openFirst`, `createConnection`, `answerRequest`·`phoneCapabilities`를 부르는 곳), `src/data/computers.ts`·`computers.test.ts`(`createComputers`, `defaultName`, `sampleFor`, 접기), `src/pairing/pair.ts`(`parseQr`, `thisDevice`, `pair`), `src/pairing/store.ts`(`Computer`, SecureStore), `src/pairing/unpair.ts`(renderer `commandCall`을 쓴다), `src/data/phone.ts`(`createPhoneComputers`, `callOnce`), `src/data/link.ts`, `src/link/answer.ts`, `src/remote.ts`; Metro가 `packages/`를 읽는 규칙 `packages/mobile/metro.config.js`(bare import는 폰의 node_modules로 풀린다)
  - 새 package 본보기: `packages/base/{package.json,tsconfig.json}`, `packages/protocol/package.json`. check 등록: `tools/check.ts`의 `ALL_PACKAGES`·`TSC_PROJECTS`, `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`
  - command 봉투: `packages/shell/renderer/command-call.ts`의 `commandBody`(봉투 정본은 protocol의 `commandRequestSchema`)
- 계약:
  - 쓰는 것: `packages/protocol/remote/client.ts`(`connectRemote`의 `name`·`machine`, `RemotePeer.machine`, `remotePairingSchema`, `relayPhoneUrl`, `REMOTE_PATH`), `packages/protocol/remote/frames.ts`의 kind로 갈린 `pair` frame, `packages/protocol/remote/routes.ts`의 `devicesUnpair`, `packages/protocol/events/bus.ts`의 `eventConditionSchema`, `packages/base`의 `RandomSource`
  - 내놓는 것(`packages/remote-client/mod.ts`. README 계약 1. `remote-desk-viewer`와 폰이 기댄다. 이름은 이대로 짓고 land된 machine-identity와 맞지 않는 칸만 그쪽 이름을 따른다):
    - `connection.ts`: `ConnectionState { state: "starting"|"ready"|"stale"; confirmedAt: number|null }`, `CoreCall { kind?; resource; method; body }`, `CoreReply`, `CoreEventMessage`, `WatchConditions`, `CoreSource { subscribe; current; call; watch; onEvent }`(desktop renderer의 `CoreSource`와 같은 모양), `ConnectionPath = "direct"|"relay"`, `Connection = CoreSource & { path(); pause(); resume(); close() }`, `Endpoint { addresses; port; key; relay? }`, `Dial = (url) => Promise<RemoteTransport>`.
    - `Client = { key: KeyPair; dial: Dial; random: RandomSource; name: string; capabilities: string[] }`(폰의 `phone`이던 칸이 `key`다).
    - `openFirst(endpoint, client & { machine?: Id<"mch"> }): Promise<{ channel; path } | undefined>`. `machine`을 주면 다른 기계가 답한 주소는 닿지 않은 것과 같다(machine-identity의 `connectRemote`가 아무 frame도 보내지 않고 닫는다).
    - `createConnection(client & { endpoint; machine?; now; wait; onRevoked(); onPeer?(peer: RemotePeer): void; answer?(frame, isActive): Promise<response | undefined> }): Connection`. `answer`가 없으면 core의 `request`는 버린다(desktop은 답하는 kind가 없다).
    - `socket.ts`: `dialWebSocket(url): Promise<RemoteTransport>`(표준 전역 `WebSocket`, `binaryType = "arraybuffer"`).
    - `computers.ts`: `Computer = Endpoint & { device; revoked; name?(보는 쪽 별명); announced?; machine? }`(machine-identity가 정한 칸 그대로), `createComputers<D>(deps)`, `Computers<D>`, `ComputersDeps<D>`(`load(): { key, computers }`, `save`, `open(computer, key, onRevoked)`, `pair(qr: RemotePairing, key)`, `sample?`), `Link<D>`, `LinkState`, `ComputerItem`, `ComputersState`, `defaultName`, `sampleFor`. 같은 key나 같은 `machine`의 항목은 하나로 접는다(machine-identity 계약 2).
    - `pairing.ts`: `parsePairingText(text): RemotePairing | undefined`(옛 `parseQr`), `PairFailure = { kind: "unreachable" } | { kind: "closed" } | { kind: "refused"; code } | { kind: "this_computer" }`, `PairDevice`(pair frame에서 `type`·`id`·`code`를 뺀 kind union), `pair(qr, client & { device: PairDevice; self?: Id<"mch"> })`: `self`와 hello의 machine id가 같으면 pair frame을 보내지 않고 `this_computer`, `unpair(core: Pick<CoreSource, "call">, key: string): Promise<void>`(`devices/unpair` command 봉투를 protocol 모양으로 짓는다).

## 할 일

1. package를 만든다: `packages/remote-client/package.json`(`@lophn/remote-client`, `version` 0.0.0, `type: module`, `exports: ./mod.ts`, dependencies는 `@lophn/protocol`·`@lophn/base`의 0.0.0만), `tsconfig.json`(base 본보기). import는 `../protocol/…`·`../base/…` 상대 path만 쓰고 `node:`, React Native, expo, zod 직접 import를 두지 않는다(Metro가 폰의 node_modules로 풀 수 있어야 한다. zod가 필요하면 protocol의 schema를 쓴다).
2. 옮긴다(로직은 그대로, 이름은 위 계약대로):
   - `connection.ts`: 폰의 `openFirst`·`createConnection`에서 `phoneCapabilities()`와 `answerRequest`를 인자(`capabilities`, `answer`)로 바꾼다. `PROBE_MS`, backoff, watch 거르기, `credential_revoked` 처리, `pause`/`resume`은 그대로다.
   - `socket.ts`: 폰의 `dialSocket`을 `dialWebSocket`으로.
   - `computers.ts`: `createComputers`와 type들. 폰의 `phone` 칸을 `key`로, `pair(qr, phone)`를 `pair(qr, key)`로.
   - `pairing.ts`: `parseQr` → `parsePairingText`, `pair`는 `thisDevice()` 대신 `device` 인자를 받고 `self` 검사를 더한다. `unpair`는 renderer의 `commandCall`을 쓰지 않고 같은 봉투(`input`, `idempotency_key`, `compare`, `prepared`)를 짓는다(package는 shell을 import하지 못한다).
   - test: `connection.test.ts` → `connection_test.ts`, `computers.test.ts` → `computers_test.ts`(root check의 `*_test.ts`. `node:test`와 `node:assert`는 test에서만 쓴다).
3. 폰을 맞춘다(`packages/mobile/src`):
   - 옮긴 file(`connection/connection.ts`·`socket.ts`·test, `data/computers.ts`·test)을 지운다. 폰만의 조립은 남는 file에 둔다: `data/phone.ts`가 `createConnection`에 `capabilities: phoneCapabilities()`, `answer: answerRequest`(`link/answer.ts`), `dial: dialWebSocket`을 준다. `pairing/pair.ts`는 `thisDevice()`(kind phone, os, 화면 칸)와 그것을 넣어 package `pair`를 부르는 얇은 함수만 남긴다. `pairing/store.ts`는 SecureStore와 `random`만 남기고 `Computer` type은 package에서 온다. `pairing/unpair.ts`는 지우고 `data/link.ts`가 package `unpair`를 부른다(key는 지금처럼 `crypto.randomUUID()`).
   - 옮긴 이름을 import하던 file(지금 약 20개: `grep -rln "connection/connection\|data/computers\|pairing/pair\|pairing/store\|pairing/unpair\|connection/socket" packages/mobile/src`)이 package에서 직접 import한다. 다시 내보내는 층을 두지 않는다. `src/remote.ts`는 그대로다(protocol의 좁은 입구).
   - 폰 화면의 `parseQr` 이름(`screens/start/scan.tsx`, `enter-code.tsx`)을 `parsePairingText`로.
4. 등록: `tools/check.ts`의 `ALL_PACKAGES`와 `TSC_PROJECTS`(`"remote-client": ["packages/remote-client"]`)와 shell main 단계가 도는 조건(`has("shell", "protocol", …)`에 `"remote-client"`), `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`(`"remote-client": ["protocol", "base"]`, `shell`에 `"remote-client"`를 더한다. shell main이 wave 2에서 쓴다), `npm install --package-lock-only`로 `package-lock.json`에 workspace를 올린다(다른 판은 바꾸지 않는다. diff를 본다), `module-catalog.yaml`에 `packages/remote-client`(notes: 폰과 desktop shell main이 같이 쓰는 remote client. 폰은 Metro가 source를 읽어 `node:`·React Native import가 없다), `boundary-catalog.yaml`에 component `remote-client`(remote 연결의 client 쪽: 주소 경주, 재연결, 기계 목록, pairing. used_by mobile, shell).
5. flows: `areas/core-platform.yaml`의 `code`에 있는 `packages/mobile/src/connection/connection.ts`를 새 path로, 새 test file 둘을 `tests/libs-tooling.yaml`에 올린다. 폰 test file이 catalog에 있으면 지운다. `node tools/flows.ts check`.

## 끝남

- `npm run check`가 통과한다.
- `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다.
- 위험 test(`packages/remote-client/connection_test.ts`, 메모리 전송 꼴): "저장한 machine id와 다른 기계가 답하면 `createConnection`은 hello 뒤로 `watch`도 `call`도 보내지 않고 stale로 남으며, 같은 기계가 답하면 `watch`를 보내고 ready가 된다". 옮긴 test(접기, 지우기, 재연결)는 그대로 통과한다.
- emulator 확인: port 5636, Metro 8276. AVD `lophn-phone`을 `-read-only -memory 2048 -port 5636`으로 띄우고 모든 adb 명령에 `-s emulator-5636`을 붙이고 끝나면 `adb -s emulator-5636 emu kill`로 끈다. JS만 바뀌므로 있는 dev build로 되면 다시 짓지 않는다. 개발 core(`tools/remote-dev.ts`, direct)와 붙여 넣기로 pairing하고 Home의 session 목록이 오는지, 컴퓨터 목록의 이름과 online이 보이는지 본다. 그림은 `.dev-data/remote-desk-client/shots/`. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일은 하지 않는다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. 사람의 `~/.lophn`과 실제 relay를 쓰지 않는다.
- 남지 않음: `grep -rn "parseQr\|dialSocket\|connection/connection.ts\|data/computers.ts" packages tools tests project-docs/flows`가 0줄이다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 옮긴 file과 새 이름의 표, 폰에 남긴 조각과 이유, `package-lock.json` diff 줄 수, emulator 그림 path, lead가 고칠 목록(`packages/mobile/README.md`의 "연결 조각은 `packages/remote-client`", `architecture/remote.md`의 boundary 절).
