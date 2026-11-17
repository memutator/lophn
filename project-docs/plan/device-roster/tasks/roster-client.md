# roster-client

붙는 쪽을 명단으로 바꾼다: `packages/remote-client`가 초대장으로 들어오고(`join`), 붙을 때마다 자기 항목을 내밀고, 받은 명단으로 컴퓨터 목록을 채운다. 폰 앱의 pairing 화면, 컴퓨터 화면, 저장을 그 위로 옮긴다. 폰 하나를 컴퓨터 하나와 pairing하면 나머지 컴퓨터가 목록에 뜬다.

- 단위: roster (wave 2)
- 선행: roster-contract. 그 brief의 "모양"이 이 task의 계약이다.
- 소유(이 task만 고친다):
  - `packages/remote-client/`
  - `packages/mobile/src/pairing/`, `packages/mobile/src/data/{phone.ts,link.ts,local-stores.ts}`
  - `packages/mobile/src/screens/start/`, `packages/mobile/src/screens/settings/index.tsx`, `packages/mobile/src/app/{root-params.ts,computers-sheet.tsx}`
  - `packages/mobile/src/widgets/store.ts`, `packages/mobile/src/parts/offline.tsx`(목록 모양이 바뀐 만큼만)
  - `packages/design/i18n/catalog/mobile-app.ts`
  - `packages/shell/main/desktop/wiring/machines.ts`(remote-client API가 바뀐 call site를 type이 맞게만 고친다. 이 file은 `roster-desktop`이 다시 쓴다)
  - `tools/remote-client.ts`
  - `project-docs/flows/tests/libs-tooling.yaml`
- 읽을 것:
  - 계획 README "정한 것"(들이기, 연결의 "폰은 명단으로 컴퓨터 목록을 채운다", 옮기기의 "폰은 다시 pairing하지 않는다")
  - `project-docs/plan/device-roster/tasks/roster-contract.md` "모양"과 merge된 `packages/protocol/remote/roster.ts`, `client.ts`
  - architecture: `project-docs/architecture/remote.md`(명단 절, 지키는 것 3·4·6·17·19·22, 결정 "폰이 컴퓨터를 지울 때"), `machine.md` "이름"
  - 조사 `reports/multi-device/survey-s2-roster.md` 1.2(폰 저장), 1.4, 3(G4·G5), 5.1(SecureStore에 schema와 판이 없다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/remote-client` notes(protocol과 base만 상대 path로, zod·`node:`·React Native 금지)
  - 지금 code: `packages/remote-client/{computers,connection,pairing}.ts`, `packages/mobile/src/pairing/{store,pair}.ts`, `packages/mobile/src/data/phone.ts`, `packages/mobile/src/screens/start/pairing.tsx`
- 계약:
  - 쓰는 것: `rosterInviteTextSchema`, `rosterView`, `mergeRoster`, `signRoster`, `rosterJoinedSchema`, frame `join`·`roster`, hello `phone`, route `roster/leave`(기기 route 목록에 lead가 넣는다)
  - 내놓는 것(`roster-links`가 core에서 쓴다): `packages/remote-client`의 `join`, `parseInviteText`, `createConnection`의 `join`·`onRoster` 옵션, 명단을 받는 `createComputers`(폰). shell main은 wave 4까지 옛 `pair`·`parsePairingText`·`unpair`·`createConnection`을 쓰므로 그 export와 모양은 남긴다(cleanup이 지운다)

## 할 일

1. `pairing.ts`: `parseInviteText(text)`(`rosterInviteTextSchema`), `join(invite, client & {entry, self?})`를 더한다. `entry`는 부르는 쪽이 지은 자기 항목에서 `invite`·`terminal_input`을 뺀 것이다(폰은 kind phone, 기기 공개 key, 이름, os. id와 rev는 폰이 이미 명단에 있으면(다른 컴퓨터의 초대로 또 들어올 때, 예: dual boot의 둘째 OS) 그 id와 rev+1, 아니면 새 `dev_` id(`createIdSource`, 주입한 clock·random)와 rev 1이다. 그래서 같은 폰의 id가 둘로 갈리지 않는다. `roster-links`는 같은 함수로 kind computer 항목을 낸다). join은 issuer 항목의 자기 서명과 초대장 서명을 확인하고, `invite` = 초대 key와 `terminal_input` = 초대장의 값을 채워 초대 secret으로 서명한 뒤, invite의 reach와 issuer의 key·machine으로 `openFirst` 하고 `join {statements: [초대 서명 statement, 이미 든 자기 statement]}`를 보낸다. 답 `{device, roster}`와 issuer 항목을 돌려준다. 실패 갈래는 지금 `PairFailure`처럼(`unreachable`, `update`, `closed`, `refused`(code와 reason), `this_computer`) 둔다. 근거: README "pairing code는 초대장이다".
2. `connection.ts`: 옵션을 더한다(없으면 지금처럼 돈다. shell이 쓴다). `join`(붙을 때마다 첫 frame으로 낼 자기 key의 statements)과 `onRoster(snapshot)`. channel이 열리면 먼저 `join`을 보내고 그 답의 roster를, 그 뒤 core가 민 `roster` frame을 `onRoster`로 넘긴다. `join`이 거절되면(`unauthorized`) 지금 `credential_revoked`처럼 멈추고 `onRevoked`를 부른다. 거절의 `details.removal`은 4의 "빠진 폰"에서만 쓴다. `createConnection`이 돌려주는 값에 `sendRoster(snapshot)`(client → core `roster` frame, 답 snapshot을 `onRoster`로)을 더한다. `Connection` type은 바꾸지 않는다(`shell/main/desktop/viewer/machine-route_test.ts`가 그 type의 가짜를 만든다). 폰과 `roster-links`의 컴퓨터가 같이 쓴다.
3. `computers.ts`: 목록을 명단에서 짓는다. 저장은 둘이다: 컴퓨터 항목(지금 `Computer`. 별명과 알린 이름이 여기 산다)과 명단(`{statements, reach}`).
   - root는 저장한 컴퓨터의 key들이다. 받은 snapshot은 `mergeRoster`로 합치고 `rosterView(statements, roots)`의 kind computer 기기가 목록이다. 새 컴퓨터는 entry의 key·machine과 reach의 주소로 항목을 만들고 link를 연다. 명단에서 빠진 컴퓨터는 목록과 link에서 뺀다. 컴퓨터가 빠져 새 key로 돌아오면(`roster-contract` "빠진 기기가 돌아오기") 새 항목으로 뜬다. 보이는 이름은 폰의 "Shown as" 별명이 있으면 그것, 없으면 명단 항목의 이름이다(`roster/rename`이 모든 기기에 같게 바꾼다. 폰은 서명하지 못해 `roster/rename`을 부르지 않는다. 폰 별명은 지금처럼 이 폰에만 있다). `Computer.announced`는 명단 이름으로 채운다.
   - 폰은 운반자다(README "한쪽만 켜진 기계에도 퍼져야 한다"). 폰은 받은 statement를 view의 `keep` 그대로(아직 믿지 못하는 것과 초대 서명 statement 포함) 저장하고, 초대장 수명이 폰 시계로 지난 초대 서명 statement만 버린다. 컴퓨터마다 `join` 답을 받은 뒤와 폰이 든 명단이 바뀔 때 붙은 link마다 `sendRoster`로 든 것 전부를 보낸다. 그래서 한 컴퓨터의 소식이 폰이 다음에 붙는 컴퓨터로 가고 그 답이 돌아온다. dual boot는 이 길로 끝난다: A의 긴 초대장으로 B가 `pending`으로 들고, 사람이 B의 초대장으로 폰도 B에 들이면(1의 같은 id), 폰이 B의 초대 서명 statement를 A에 나르고 A의 명단을 B에 나른다.
   - `Computer.device`는 view에서 이 폰 key의 id다(모든 컴퓨터에 같다). 폰 앱 sync의 node가 이 값이다(`local-stores.ts`).
   - `add(invite)`는 `join`이다. `remove`는 "이 폰을 명단에서 빼기"다: 붙은 컴퓨터 하나에 `roster/leave`를 부르고 아래 "빠진 폰"과 같이 잊는다.
   - 빠진 폰: 이 폰의 key가 view의 `removed`에 있으면(받은 명단에서, 또는 `join` 거절의 `details.removal`을 합쳐 root로 확인했을 때만) 컴퓨터 목록, 명단 file, 기기 key(SecureStore `device-key`)를 지우고 시작 화면으로 간다. 다음 pairing은 `deviceKey()`가 새 key를 만들어 새 기기로 든다. 뺀 key는 다시 쓰지 않는다. 확인되지 않은 거절(`untrusted`)로는 아무것도 지우지 않는다.
   - `ComputersDeps`의 `pair`를 `join`으로, `load`·`save`에 명단을 더한다.
4. 폰 저장(`packages/mobile/src/pairing/store.ts`):
   - SecureStore `computers`는 지금 칸(`addresses, port, key, relay?, machine?, name?, announced?`)을 읽는다. 원소마다 schema로 읽고 틀린 원소만 버린다. 옛 원소의 `device`·`revoked`는 무시한다(판 칸을 두지 않는다. 새 모양이 옛 모양의 부분집합이다). 그래서 이미 pairing한 컴퓨터가 root로 남아 다시 붙고, 첫 `join` 답이 명단을 채운다.
   - 명단은 SecureStore가 아니라 app 문서 폴더의 file(`expo-file-system`)에 둔다.
5. 폰 화면: `screens/start/{scan,enter-code,pairing}.tsx`와 `app/root-params.ts`가 `RemotePairing` 대신 `RosterInviteText`를 받는다. `screens/settings/index.tsx`와 `app/computers-sheet.tsx`의 컴퓨터마다 "Remove"는 "Remove this phone from my devices" 하나로 바꾼다. "Pair another computer"는 초대장으로 들어가기로 남는다. 문구는 `mobile-app.ts`의 `mobile.` key다.
6. 폰이 붙을 때 hello에 `phone {os, width, height, dpr}`를 싣는다(`data/phone.ts`의 open과 join).
7. `packages/shell/main/desktop/wiring/machines.ts`: `createComputers`의 새 deps에 맞춰 type만 맞춘다(명단 저장은 빈 것으로 둔다). 동작은 `roster-desktop`이 바꾼다.
8. `tools/remote-client.ts`(개발용 붙는 쪽)를 `join`으로 바꾼다: `pair --qr` 대신 `join --invite '<roster/invite가 준 글>'`.
9. test: `remote-client/{computers,connection}_test.ts`에서 pair에 묶인 경우는 지우거나 join으로 다시 쓴다. flows `libs-tooling.yaml`의 그 두 file 줄을 맞춘다.

정한 것:
- 폰은 컴퓨터를 하나씩 지우지 않고 자기를 명단에서 뺀다. 이유: 목록이 명단에서 오므로 하나만 지우면 다음 명단이 되살린다. 폰은 서명 key가 없어 남을 빼지 못한다(README "폰은 누구도 들이지 못한다").
- 명단 file은 비밀이 아니다(공개 key와 서명). 이유: SecureStore 값은 2048 bytes를 넘으면 실패할 수 있고, 내용은 서명으로 지킨다. root(믿는 컴퓨터 key)는 SecureStore에 남는다.

## 끝남

- `npm run check`가 통과한다.
- `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다.
- 위험 test:
  - "옛 모양의 `computers` 저장을 읽어도 이미 pairing한 컴퓨터를 잃지 않는다"(`packages/mobile/src/pairing/`의 `*.test.ts`. 읽기를 순수 함수로 나눠 본다)
  - "root로 확인하지 못한 거절로는 폰이 컴퓨터와 key를 잊지 않는다"(`packages/remote-client/computers_test.ts`. 확인된 빼기면 잊는 경우를 같은 표에 둔다)
- 남지 않음: `grep -rn "RemotePairing\|parsePairingText\|unpair" packages/mobile tools/remote-client.ts`가 0줄이다(shell과 remote-client 안의 옛 export는 cleanup이 지운다).
- subprocess, 서버를 띄우는 test를 만들지 않는다. 실제 폰과 emulator로 본 것이 없으면 보고의 "알려진 미완 동작"에 적는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳(`shell/main/desktop/wiring/machines.ts`)
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
