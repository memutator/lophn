# roster-cleanup

옛 pairing 길을 지운다: `pair` frame과 pairing code 모양, host마다 따로 만들던 기기 등록 route, 붙는 쪽의 host마다 따로이던 code(`pair`, `unpair`, 기기 id를 컴퓨터마다 든 것), 남은 옛 이름. flows와 module·boundary catalog를 지금 code에 맞춘다.

- 단위: roster (wave 5)
- 선행: roster-client, roster-cli, roster-desktop
- 소유(이 task만 고친다):
  - `packages/protocol/remote/{frames.ts,routes.ts,client.ts,channel.ts,roster.ts}`
  - `packages/remote-client/`
  - `packages/core/remote/`, `packages/core/main/daemon/wiring/remote.ts`
  - `packages/shell/main/desktop/`, `packages/shell/renderer/desktop/settings/remote/`(남은 옛 이름만)
  - `packages/mobile/src/`(남은 옛 이름만)
  - `tools/check-deps.ts`, `tools/dev.ts`(주석만)
  - `project-docs/flows/`, `project-docs/module-catalog.yaml`, `project-docs/boundary-catalog.yaml`
- 읽을 것:
  - 계획 README 전부(특히 "옮기기"의 "`v2` 길을 만들지 않는다")
  - `project-docs/plan/device-roster/tasks/` 앞 task들의 brief와 보고(lead가 prompt로 준 "안 쓰게 된 export" 목록)
  - architecture: `project-docs/architecture/remote.md`(명단 절, 경계와 계약)
  - `flows` skill, `.claude/skills/orchestrate/SKILL.md` "막힘과 겪은 함정"의 마지막 항목(지운 층의 화면 문구 key grep)
- 계약:
  - 쓰는 것: 앞 task가 낸 모든 것
  - 내놓는 것: 없음. 지우는 export는 아래 목록뿐이다. `devices/list`의 출력 모양을 줄이는 것은 이 task가 계약을 고치는 것이다(아래 3).

## 할 일

1. protocol(`packages/protocol/remote/`):
   - `frames.ts`: `pair` frame, `remotePairingSchema`·`RemotePairing`, `desktopPairingSchema`, `deviceKindSchema`, `pairFields`를 지운다. `phonePairingSchema`는 hello `phone`이 쓰면 이름을 그 뜻으로 바꾼다(예: `phoneScreenSchema`). `remoteDeviceSchema`는 설정 `shell.devices`가 쓰므로 남긴다.
   - `routes.ts`: `pairingStart`, `devicesRegister`, `devicesRevoke`, `devicesUnpair`, `devicesSetTerminalInput`, `devicesForgetAll`, `devicesRename`(이름은 `roster/rename`), `remotePairedSchema`를 지운다. `devices/list` 출력의 `alias`·`announced_name`도 뺀다(이름은 명단의 이름 하나다).
   - `client.ts`: 지운 것의 export를 뺀다.
   - `mod.ts`와 `allowlist.ts`는 lead가 고친다(보고의 "등록할 것"에 지울 export와 `devicesUnpair`를 적는다).
2. `packages/remote-client/`: `pair`, `parsePairingText`, `unpair`, `PairDevice`, `Computer.revoked`(명단에서 정해지면), shell만 쓰던 옵션과 type을 지운다. module catalog의 notes를 "폰과 core가 같이 쓴다"로 고친다.
3. core: `devices` local 행은 폰만 남는다. `devices/list` 출력에서 `kind`와 `terminal_input`을 뺀다(명단이 든다. 표의 칸은 지우지 않는다: 표 다시 만들기를 이 판에 한 번 더 하지 않는다). `devices.ts`의 desktop 갈래, `createDeviceKinds`가 옛 kind를 쓰면 지운다. `ctx.deviceKind`의 남은 `"desktop"`을 grep한다.
4. shell: `tools/check-deps.ts`의 `shell` 목록에서 `remote-client`를 쓰지 않게 됐으면 뺀다. `packages/shell/main/desktop/`에 남은 remote-client import와 기기 key 이야기를 지운다. module catalog의 `packages/shell/main` notes에서 "desktop/viewer/는 ... 기기 key와 기계 목록 file의 유일한 주인"을 지금 일(창과 core 길로 기계 고르기, 시작 기계)로 고친다.
5. `tools/dev.ts`의 `--viewer` 주석("pairing이 남는다")을 명단으로 고친다.
6. flows(`flows` skill): `node tools/flows.ts check`와 `report`를 돌려 지운 route·frame·IPC·test file을 가리키는 줄, 옛 이름(pairing code, `pair`, `devices/register|revoke|unpair|set_terminal_input|forget_all|rename`, `pairing/start`, viewer key)을 고친다. `areas.yaml`의 remote 묶음 설명("remote listener, pairing, 기기 연결")을 명단으로 고친다.
7. boundary catalog의 `remote-protocol`, `remote-client`, `remote` 설명을 지금 계약(명단, `join`·`roster` frame, `roster/*`, `machines/*`)으로 고친다.

## 끝남

- `npm run check`가 통과한다. `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다. `node packages/shell/renderer/build.ts`가 된다.
- 위험 test: 없음. 지우는 test가 지키던 권한 경계(기기 route 목록 밖 forbidden)는 지우지 않는다.
- 남지 않음(모두 `--exclude-dir=dist --exclude-dir=node_modules`):
  - `grep -rn "pairingStart\|pairing/start\|pairing\.start\|remotePairingSchema\|RemotePairing\b\|devicesRegister\|devicesRevoke\|devicesUnpair\|devicesSetTerminalInput\|devicesForgetAll\|devicesRename\|remotePairedSchema\|desktopPairingSchema\|parsePairingText" packages tools tests`가 0줄이다.
  - `grep -rn 'type: "pair"\|id: "pair"\|kind: "desktop"' packages tools tests`가 0줄이다. `grep -rn '"desktop"' packages/core packages/protocol/remote packages/remote-client`는 remote와 상관없는 줄만 남고, 남은 줄을 보고에 적는다.
  - `grep -rn "devices/register\|devices/revoke\|devices/unpair\|devices/set_terminal_input\|devices/forget_all\|devices/rename" packages tools tests project-docs/flows`가 0줄이다.
  - 지운 화면과 명령의 i18n key로 한 번 더 grep한다(`settings.*remote-pair*`, `mobile.*pair*`). 남은 key가 쓰이는 곳이 없으면 지운다. catalog file은 이 task의 소유가 아니므로 지울 key를 보고에 적는다.
- core가 `project-docs/plan/tools/lead/boot.sh`로 두 번 뜬다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task에서는 `packages/protocol/remote/mod.ts`에서 뺄 export, `allowlist.ts`의 `devicesUnpair`, 지울 i18n key
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
