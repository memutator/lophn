# roster-core

core가 명단을 든다: 서명 key, ledger의 명단과 `devices`에서 옮기는 step, 명단과 내민 항목으로 연결을 받아들이기(`join`), 초대장 내기, 빼기가 연결·자격·push에 퍼지기, `roster/*` route. 다른 컴퓨터에 붙는 쪽(link)은 `roster-links`가 한다.

- 단위: roster (wave 2)
- 선행: roster-contract. 그 brief의 "모양"이 이 task의 계약이다.
- 소유(이 task만 고친다):
  - `packages/core/remote/`
  - `packages/core/main/daemon/wiring/remote.ts`, `packages/core/main/daemon/wiring/remote_test.ts`
  - `packages/core/main/daemon/wiring/context.ts`, `packages/core/apps/views/ports.ts`, `packages/core/attention/presence.ts`, `packages/core/attention/mod.ts`(넷 다 `deviceKind` type의 `"desktop"`을 `"computer"`로 바꾸는 줄만)
  - `packages/core/apps/sync/device-fold.ts`(새 file)
  - `tools/remote-dev.ts`
  - `project-docs/flows/areas/core-platform.yaml`, `project-docs/flows/tests/core-rest.yaml`
- 읽을 것:
  - 계획 README "정한 것"(정체, 명단, 들이기, 옮기기)과 "위험 test"
  - `project-docs/plan/device-roster/tasks/roster-contract.md` "모양"과 merge된 `packages/protocol/remote/roster.ts`
  - architecture: `project-docs/architecture/remote.md`(명단 절, 지키는 것 6·9·19~23), `machine.md`("기계에 묶인 상태의 표지"), `approval.md` "폰(기기) 자격"
  - 조사 `reports/multi-device/survey-s2-roster.md` 1.3~1.8, 3(G1·G2·G3·G7·G9), 5.1, 5.2
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `remote`, `project-docs/module-catalog.yaml`의 `packages/core/remote`, `packages/core/main`
  - 지금 code: `packages/core/remote/{host,devices,call,pairing,host-key}.ts`, `packages/core/main/daemon/wiring/remote.ts`, `packages/core/apps/sync/{schema,service}.ts`
- 계약:
  - 쓰는 것: `roster.ts`의 schema·`rosterView`·`mergeRoster`·`checkInvited`·`signRoster`·`generateSigningKey`, frame `join`·`roster`, hello `phone`, route `roster/list|invite|remove|set_terminal_input|rename|leave|statements|store|forget_all`, `devices/connected {phone?}`
  - 내놓는 것(`roster-links`, `roster-cli`, `roster-desktop`이 쓴다): 위 route의 handler, main thread의 명단 cache(지금 statements, reach, view, 이 컴퓨터의 id와 서명 key)를 `roster-links`가 같은 wiring 안에서 읽고 고칠 수 있는 함수(`packages/core/remote/`의 export. 이름은 이 task가 정하고 보고에 적는다)

## 할 일

1. 서명 key. `<data root>/remote/signing-key.json`(`{public_key, secret_key, machine}`, 0600, `wx`로 한 번 만든다)을 `host-key.ts`와 같은 꼴로 둔다. 기계 id 표지가 다르면 host key와 같이 지운다(`forgetClonedDevices`가 `roster/forget_all` 뒤 두 file과 아래 초대 file을 지운다). 근거: README "정체", `machine.md` 표지.
2. ledger. 새 schema step 하나(id 예: `remote.roster`)를 `remoteWiring.schemaStepsAfterTeams` 맨 끝에 더한다(`schema-steps.lock.json`의 `{id, sha256}`은 lead가 붙인다). step은:
   - 명단 statement와 reach를 둘 표를 만든다(모양은 이 task가 정한다. 기기 하나는 여러 서명자와 rev의 statement를 가진다).
   - 지금 `devices`의 phone 행마다 항목 하나를 옮긴다: id, `public_key`→key, 이름(별명 `alias`가 있으면 별명, 없으면 `name`), os, `terminal_input` 그대로, kind phone, rev 1, invite null, 서명자는 이 컴퓨터. SQL은 서명하지 못하므로 "이 컴퓨터가 서명할 것"으로 표시해 두고, core가 서명 key를 가진 첫 때(remote를 켰을 때) 서명해 채운다. 그 전에도 이 행은 이 컴퓨터가 믿는 항목이다.
   - `devices`의 kind desktop 행을 지운다(그 key는 shell main의 것이고 없어진다. README "옮기기").
   - `devices` 표는 이 컴퓨터만의 칸(push, 기준, 화면, 마지막 연결, 마지막으로 받은 알린 이름)을 두는 표로 남는다. `alias` 칸은 더 쓰지 않는다(이름은 명단에 하나다). host key는 바꾸지 않는다.
3. main thread의 명단 cache. 기동 때 `roster/statements`로 읽고 `rosterView(statements, [이 컴퓨터의 host key])`로 계산한다. remote를 켜면 이 컴퓨터의 항목(kind computer, 새 `dev_` id, host key, 서명 key, `mch_`, 기계 이름, os, terminal_input true, rev 1)을 스스로 서명해 둔다. 기계 이름이 바뀌면(`machine/rename`) rev를 올린 새 판을 서명한다. 폰이 hello로 알린 이름이 이 컴퓨터가 마지막으로 받은 알린 이름과 다르면(폰에서 이름을 바꿨다) 이 컴퓨터가 그 이름으로 rev를 올려 서명한다. 알린 이름이 바뀔 때만이라 사람이 `roster/rename`으로 바꾼 이름을 폰이 옛 이름으로 다시 덮지 않는다. 새 statement는 `mergeRoster` 뒤 `roster/store`로 쓰고, view가 바뀌면 아래 6을 한다.
4. host 받아들이기(`host.ts`). 붙은 key를 view에서 찾는다:
   - 첫 frame `join`: 아래 "닿은 statement 받기"를 한 뒤 그 key를 믿으면 붙이고 `result {device, roster}`를 답한다. 아니면 `unauthorized`(details.reason은 `checkInvited`의 것. 빠진 key면 reason `removed`와 그 빼기 statement를 `details.removal`에 싣는다)이고, 틀린 join이 연결마다 5번이면 닫는다(지금 `PAIRING_TRIES`).
   - 닿은 statement 받기(`join`과 `roster` frame에 같다): `mergeRoster`로 합치고, 초대 서명 statement마다 지금 시각으로 `checkInvited`(signer는 view의 컴퓨터, usedBy는 view에서 같은 invite로 든 다른 key)를 부른다. 맞으면 이 컴퓨터가 그 항목에 서명한다(README "믿음은 서명을 따라간다"). 서명자를 아직 몰라 `untrusted`인 것은 남겨 두고(나중에 그 서명자를 믿게 되면 다시 본다), `expired`·`used`·`removed`인 것과 수명이 지난 것은 저장하지 않는다.
   - 아는 key의 첫 frame이 `join`이 아니면 지금처럼 붙인다. 모르는 key의 그런 frame은 지금처럼 `closed(credential_revoked)`.
   - 붙기 전 frame 상한은 `ROSTER_JOIN_MAX_BYTES`다. `pair` frame은 받지 않는다(모르는 frame처럼 닫는다). `core/remote/pairing.ts`와 `pairing/start` handler를 지운다.
   - 붙은 연결(폰과 컴퓨터 모두)의 `roster` frame은 위처럼 받아 저장하고 이 컴퓨터의 snapshot으로 답한다. 폰은 한 컴퓨터에서 받은 것을 다른 컴퓨터에 나르는 운반자다(README "한쪽만 켜진 기계에도 퍼져야 한다").
   - view가 바뀌면 붙은 연결마다 `roster` frame을 민다.
   - 폰이 붙을 때 hello의 `phone`과 이름으로 `devices/connected {id, name, phone}`를 불러 local 행이 없으면 만든다(설정 `shell.devices`의 preview 항목도 지금 `screensPaired`처럼 더한다).
5. 초대장. `roster/invite` handler: remote가 꺼졌거나 listener와 relay가 다 없으면 `unavailable`. 입력 `lifetime`(short | long)으로 `expires_at`을 정하고, 한 번 쓸 ed25519 key를 만들어 이 컴퓨터가 서명하고 `{invite, secret, issuer(이 컴퓨터의 자기 서명 항목), reach(directAddresses, port, relay)}`와 `expires_at`을 낸다. 초대장은 저장하지 않는다(한 번은 명단의 `invite` 칸으로 안다).
6. 빼기와 바뀜이 퍼지기. view가 바뀐 뒤:
   - 빠진 기기: 붙어 있으면 그 빼기가 든 `roster` frame을 먼저 민 뒤 `host.revoked(id)`(자격 거두기, 연결 닫기, presence 지우기), local `devices` 행 지우기(push token도 같이 간다), `shell.devices`의 그 항목 지우기. 지금 `DevicesChange` afterCommit 길을 쓴다.
   - 새 빼기가 컴퓨터 R을 뺐으면, 바뀌기 전 view에서 믿었는데 바뀐 뒤 빠진 항목(그 key가 빠진 것은 아닌 것)에 이 컴퓨터가 서명해 둔다. README "뺀 컴퓨터가 서명한 항목은 빼기를 알기 전에 받은 것만 남긴다".
   - `folded`의 from → to: `roster/store`의 `folds`로 넘겨 같은 transaction에서 local `devices` 행 id, `app_sync_log.device`(`packages/core/apps/sync/device-fold.ts`의 함수. remote가 그 표를 SQL로 직접 만지지 않는다), 설정 `shell.devices[].device`를 바꾸고 옛 id의 자격과 연결을 거둔다.
   - 이 컴퓨터의 key가 빠졌으면(view의 `removed`에 있다) 복사된 data root 길과 같이 한다: `roster/forget_all`, host key·서명 key file 지우기, 붙은 연결 닫기, 경고 log. 다음 reconcile이 새 key와 새 자기 항목(새 id)을 만들고, 사람은 그 컴퓨터를 새 기기로 다시 초대한다(`roster-contract` "빠진 기기가 돌아오기"). 이 컴퓨터를 root로 둔 폰은 새 key의 항목을 다른 컴퓨터의 명단으로 받는다.
7. 자격과 허락. 기기 자격은 지금 모양 그대로(actor user, principal `device:<id>`, scope `REMOTE_ALLOWED_ROUTES`)이고 kind computer에도 같다. 터미널 입력 허락(`ctx.terminalInputGrant`)과 kind(`ctx.deviceKind`, phone|computer)는 view에서 채운다.
8. route handler: `roster/list`(view + local 행의 마지막 연결), `roster/remove`(빼기를 서명해 저장. 이 컴퓨터면 `invalid_input`), `roster/set_terminal_input`(rev+1 서명), `roster/rename`(이름을 바꾼 rev+1 서명), `roster/leave`(principal의 기기를 뺀다), `roster/statements`, `roster/store`, `roster/forget_all`. 옛 `devices/register|revoke|unpair|set_terminal_input|forget_all|rename` handler와 `REMOTE_CONTEXT`의 그 이름을 지운다(route 정의는 cleanup이 지운다). `devices/list|set_primary|set_push|clear_push|push_targets|connected`는 남는다. `devices/list`의 `name`은 명단의 이름을 낸다.
9. `tools/remote-dev.ts`를 `roster/invite`로 바꿔 초대장 글을 찍는다(`remote.relay`를 비우는 줄은 그대로).
10. flows(`flows` skill): `core-platform.yaml`의 pairing flow(`remote-pairing-start`, pair frame flow, 연결 받기)를 `roster/invite`·`join`·`roster/*`로 고치고, `core-rest.yaml`에 바꾸거나 더한 test file을 적는다.

정한 것:
- `roster/*` 쓰기는 memory route가 main thread에서 서명한 뒤 machine 자격 `roster/store`로 쓴다. 이유: 서명 key를 writer Worker에 넘기지 않는다(지금 `pairing/start` → `devices/register`와 같은 꼴).
- 초대장을 저장하지 않는다. 이유: 한 번 쓰였는지는 명단의 `invite` 칸이 영구히 말해 준다.

## 끝남

- `npm run check`가 통과한다. `project-docs/plan/tools/lead/boot.sh`로 core가 두 번 뜬다.
- 위험 test:
  - "`devices`에서 옮긴 뒤 이미 pairing한 폰이 다시 pairing하지 않고 붙는다"(옛 step까지 적용한 ledger에 폰 행을 넣고 새 step 뒤 host에 그 key로 붙는다. in-memory transport, `host_test.ts`의 준비를 쓴다)
  - "뺀 기기는 어느 연결로도 붙지 못하고 붙어 있던 연결은 닫힌다"(README 둘째 test의 붙기 쪽. 늦게 온 항목 쪽은 `roster-contract`)
  - "명단에서 빠진 것을 안 컴퓨터는 명단과 key를 버리고 다음에 새 key로 뜬다"(빼기가 든 statement를 받은 뒤의 key file과 표를 본다. 복사된 data root 갈래와 같은 test file에 둔다)
- 지금 pairing을 지키던 `host_test.ts`·`devices_test.ts`·`remote_test.ts`의 test는 설계와 맞지 않으면 고치지 말고 지운다. 그 test가 지키던 권한 경계(목록 밖 route forbidden, revoke race, unattached 한도)는 남긴다.
- 남지 않음: `grep -rn "createPairingCodes\|PAIRING_CODE_MS\|devicesRegister\|devicesForgetAll" packages/core tools tests`가 0줄이다.
- subprocess, 서버를 띄우는 test를 만들지 않는다. 개발 root에서 remote를 켜 보려면 먼저 `remote.relay`를 비운다(실제 relay에 붙지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). 이 task에서는 새 schema step의 `{id, sha256}`(`schema-steps.lock.json`), `allowlist.ts`에서 `devicesUnpair`를 뺄 것
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(표 모양, cache 함수 이름)
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
