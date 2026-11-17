# roster-links

core가 다른 컴퓨터에 붙는다. remote가 켜진 컴퓨터의 core는 명단의 다른 컴퓨터마다 연결 하나를 유지하고 그 연결로 명단을 주고받는다. 이 컴퓨터가 초대장으로 들어가고(`roster/join`), 이 기계의 화면이 부른 `machines/call`·`machines/watch`를 그 연결로 넘긴다.

- 단위: roster (wave 3)
- 선행: roster-core. `roster-client`가 낸 `packages/remote-client`의 `join`·`createConnection` 옵션도 쓴다(wave 2라 이 task 전에 merge된다).
- 소유(이 task만 고친다):
  - `packages/core/remote/`
  - `packages/core/main/daemon/wiring/remote.ts`, `packages/core/main/daemon/wiring/remote_test.ts`
  - `tools/check-deps.ts`(`PACKAGE_DEPENDENCIES.core`에 `remote-client`를 더하는 줄만)
  - `project-docs/flows/areas/core-platform.yaml`, `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것"(연결 전부, 들이기의 "새 기기는 아직 소식을 못 들은 다른 컴퓨터에 붙을 때 자기 항목과 초대장을 내민다")과 "위험 test"
  - `project-docs/plan/device-roster/tasks/roster-contract.md` "모양"(`machines/*`, `MachineFrameReceived`, `roster/join`)
  - roadmap `project-docs/products/roadmap/multi-device.md` "길"(닿는 길 표: 되는 길을 다 걸어 먼저 닿는 쪽)
  - architecture: `project-docs/architecture/remote.md`(명단 절, 지키는 것 1·19·20·24, "desktop에서 다른 기계 보기"의 연결과 판 어긋남), `approval.md` "폰(기기) 자격"
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/remote-client`, `packages/core/remote`, `tools/check-deps.ts`의 `PACKAGE_DEPENDENCIES`
  - 지금 code: `packages/remote-client/{connection,pairing}.ts`(`openFirst`, `createConnection`, `join`), `packages/shell/main/desktop/viewer/links.ts`(shell이 하던 같은 일), `packages/core/remote/relay-client.ts`(`ws`로 socket 열기)
- 계약:
  - 쓰는 것: `roster-core`의 명단 cache 함수와 host, `@lophn/remote-client`의 `createConnection`(`join`, `onRoster`, `sendRoster`), `join`, frame `join`·`roster`, route `roster/join`, `machines/list|call|watch`, event `MachineFrameReceived`
  - 내놓는 것(`roster-cli`, `roster-desktop`이 쓴다): 위 route의 handler와 event

## 할 일

1. core가 `packages/remote-client`를 import하게 한다: `tools/check-deps.ts`의 `core` 목록에 `remote-client`를 더한다. remote-client는 protocol과 base만 import해서 순환이 없다. shell처럼 상대 path로 읽고 `package.json`은 고치지 않는다. module catalog의 notes는 lead가 끝에 고친다(보고에 적는다).
2. link 관리(`packages/core/remote/links.ts`, 새 file). remote가 켜져 있는 동안 view의 kind computer 기기 가운데 이 컴퓨터가 아닌 것마다 `createConnection` 하나:
   - endpoint는 항목의 key·machine과 reach의 addresses·port·relay다. static key는 이 컴퓨터의 host key(README "host key를 받는 쪽과 붙는 쪽 둘 다에 쓴다"), hello 이름은 기계 이름, capabilities는 빈 목록.
   - dial은 core의 `ws`로 연다(`relay-client.ts`의 `openRelayWebSocket`처럼). 직접 주소와 relay는 `openFirst`가 같이 건다.
   - 붙을 때 `join`에 이 컴퓨터 key에 대한 statements(아직 받아들여지지 않았으면 이 컴퓨터의 초대 서명 statement도)를 싣는다. 답과 민 `roster`는 `roster-core`의 "닿은 statement 받기"로 넘긴다. `join` 뒤와 이 컴퓨터가 든 명단이 바뀔 때 붙은 link마다 `sendRoster`로 든 것 전부(아직 믿지 못하는 것과 초대 서명 statement 포함)를 보낸다.
   - view에서 빠진 컴퓨터의 link는 닫고, 새 컴퓨터는 연다. remote를 끄면 모두 닫는다. hello의 주소는 그 컴퓨터의 reach로 저장한다.
   - 상태(`connecting|connected|offline|update`, path, 마지막으로 본 때)가 바뀌면 `StateChanged{remote_devices}`를 낸다.
3. `roster/join` handler: 글을 `parseInviteText`로 읽고(못 읽으면 `invalid_input`), remote가 꺼져 있으면 `unavailable`. issuer 항목의 자기 서명, 초대장 서명, 지금 시각으로 수명을 확인한다(틀리면 `unauthorized`, reason `untrusted`·`expired`). 이 컴퓨터의 자기 항목을 rev+1로 지어 초대 secret으로 서명한 초대 서명 statement를 만들고, 이 컴퓨터가 issuer 항목에 서명해 저장한다(README "컴퓨터 둘이 이어질 때 서로의 항목에 서명하므로 두 명단이 합쳐진다"). 그 뒤 remote-client `join`으로 issuer에 붙어 본다(`self` = 이 기계 id면 `conflict`, reason `this_computer`):
   - 닿으면 받은 명단을 합치고 출력 `{device, machine, pending: false}`.
   - 못 닿으면 초대 서명 statement를 든 채 `{device, machine, pending: true}`다. 그 statement는 issuer link가 다시 붙을 때의 `join`이나, 폰이 이 컴퓨터에서 받아 issuer를 믿는 컴퓨터에 나를 때 받아들여진다(README "초대한 컴퓨터가 꺼져 있어도 되고(dual boot)"). 수명은 그 컴퓨터에 닿을 때 본다. 그래서 같이 켜질 수 없는 기계는 긴 초대장(7일)을 쓴다.
4. `machines/list`: link 상태와 view의 이름. `machines/call`: 그 기계의 link가 열려 있으면 `call` frame으로 넘기고 답을 그대로 낸다(오류의 code·message·details 그대로). 없으면 `unavailable`, 명단에 없으면 `not_found`. 받는 host에서 이 call은 이 컴퓨터의 기기 항목으로 붙은 연결의 보통 `call` frame이다: 지금의 `createRemoteCall`(`packages/core/remote/call.ts`)을 그대로 지나고, 자격은 지금 기기 자격 길(actor user, principal `device:<이 컴퓨터 id>`, scope `REMOTE_ALLOWED_ROUTES`)이며, route 거르기도 같은 `authorize`다. route 목록의 두 번째 사본, 넘긴 call만의 자격이나 거르기를 만들지 않는다(다른 계획 `core-setup`의 grant 검사가 이 길에 기댄다). `machines/watch`: 그 link의 조건을 통째로 바꾸고, 받은 `ready`·`event`·`closed`를 `MachineFrameReceived {machine, frame}`로 이 컴퓨터의 bus에 낸다. link가 다시 열리면 조건을 다시 건다(`createConnection`이 이미 한다).
5. 자격: 세 route와 `roster/*`는 actor user다. agent·app 자격은 route 정의가 막고, 기기 자격은 기기 route 목록에 없어 막힌다(`roster/leave`만 목록에 있다). 넘긴 call을 다시 넘기는 길은 없다(`machines/*`가 목록 밖이다).
6. flows(`flows` skill): `core-platform.yaml`에 `roster/join`, `machines/list|call|watch`, 컴퓨터끼리의 link flow를 더하고, `core-rest.yaml`에 test file을 적는다.

정한 것:
- 컴퓨터 둘은 서로에게 각각 link를 든다(A→B, B→A). 이유: 한쪽만 닿는 network(NAT)에서도 닿는 쪽 link 하나로 명단이 오가고, 받는 쪽 host code를 그대로 쓴다.
- `machines/watch`의 조건은 기계마다 하나다. 이유: 이 계획에서 부르는 쪽은 이 기계의 shell main 하나이고 기계마다 창이 하나다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`로 core가 두 번 뜬다.
- 위험 test:
  - "다른 기계로 넘긴 call이 그 기계에서 기기의 범위를 넘지 못한다"(link 관리 → in-memory transport의 상대 host(`host_test.ts`의 준비) → 기기 route 목록 밖 route가 `forbidden`. 입력부터 받는 쪽 실행기까지 한 번 이어 본다)
  - "agent 자격은 `roster/*`와 `machines/call`을 부르지 못한다"(실제 route 등록과 dispatch로 본다)
- 남지 않음: 이 task는 옛 이름을 지우지 않는다. `grep -rn "TODO\|FIXME" packages/core/remote`가 0줄이다.
- subprocess, 서버를 띄우는 test를 만들지 않는다. 손으로 볼 때는 `npm run dev`와 `npm run dev -- --viewer`의 두 root에서 먼저 `remote.relay`를 비우고 `remote.port`를 서로 다르게 둔 뒤 `remote.enabled`를 켠다(실제 relay에 붙지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task에서는 `project-docs/module-catalog.yaml`의 `packages/remote-client`·`packages/core/remote` notes(core도 remote-client를 쓴다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
