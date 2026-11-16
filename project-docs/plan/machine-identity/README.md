# machine-identity: 기계마다 id와 이름을 갖고, 붙는 쪽이 자격을 보내기 전에 상대를 안다

- 목표: roadmap `multi-machine.md` "순서" 0과 "모양" 1. 설치마다 기계 id가 하나 생기고, data root를 복사해 생긴 두 번째 기계는 기동 때 알아채 새 기계가 된다. 컴퓨터는 자기 이름(기본 hostname)을 갖고 붙는 쪽에 hello로 알리며, 폰은 주소 대신 그 이름을 보인다(사람이 붙인 별명이 있으면 별명). 폰도 자기 이름을 알리고 컴퓨터는 별명이 없으면 그것을 보인다. 기기 표가 kind(phone, desktop)를 가져 폰에만 맞는 동작이 kind phone에만 걸린다. 사람의 `~/.lophn`, 이미 붙인 별명, 이미 pairing한 폰은 다시 pairing하지 않고 이어진다.
- 재료: `/home/pyosechang/projects/lophn/reports/multi-machine/program.md`(여섯 계획의 경계와 정한 정책. roadmap과 다르면 이것이 새것이다), `project-docs/products/roadmap/multi-machine.md`(사람의 말, 원칙, "모양" 1, "조사에서 가져온 규칙"), 코드 조사 `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md`(A, B, C, H, I와 끝의 표), harness 비교 `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md`(1, 2, 3, 4절, 14절 (iii)·(v)), `project-docs/architecture/{remote,platform,attention,app-sync,phone-screen}.md`.
- 범위 밖(가는 계획):
  - desktop 쪽 client: desktop이 다른 기계에 kind desktop 기기로 pairing해 보기, 기계 고르기, 보는 쪽마다의 기본 기계, desktop의 기기 key와 컴퓨터 목록, 공용 연결 module, desktop이 다른 기계에 붙이는 별명: `desktop-remote`. 이 계획은 core가 kind `desktop`을 받을 수 있게만 한다.
  - 앱 변경·release·source·기계 기록을 폴더로, agent가 읽는 환경 정보(기계 목록, 이 기계 이름), data root가 공유 저장소 위인지 검사: `app-folder-sync`.
  - project의 기계를 넘는 신분: `project-identity`.
  - "늘 켜 둠"과 OS 서비스 등록, 예약 작업의 주인 기계(복제된 root에서 온 예약을 멈추는 규칙 포함): `always-on`.
  - 판이 다른 기계 사이의 화면과 안내("이 기계를 올려라"), 같은 앱의 다른 release: `machine-update`. 이 계획은 hello에 판 범위만 싣고 범위 밖이면 `conflict`로 닫는다.
  - 기계 이름의 유일성 검사와 겹친 이름의 표시 규칙(기계 목록이 생기는 `app-folder-sync`).

## 정한 것

- "main" 기계를 하나 두지 않는다. 기본 보기는 보는 쪽마다(`desktop-remote`), 늘 켜 둠은 기계마다(`always-on`) (사람, roadmap).
- 기계와 폰에 이름을 짓는다 (사람, 2026-11-16).
- 보는 쪽 별명은 남는다. 기계가 알린 이름을 기본으로 보이고, 보는 쪽이 별명을 붙였으면 별명을 보인다. 양쪽(폰이 컴퓨터에 붙인 "Shown as", 컴퓨터가 폰에 붙인 `devices/rename`)이 같다. 보는 쪽은 받은 이름을 별명과 따로 두고 연결마다 고치며, 별명은 스스로 바뀌지 않고 사람이 지우면 받은 이름이 다시 보인다. 이미 붙인 별명은 migration을 그대로 지난다 (사람, 2026-11-16).
- 기계 자기 이름은 그 기계에 산다: 컴퓨터는 `machine.json`의 `name`(기본 hostname, 사람이 바꾸면 고정, 비우면 다시 hostname), 폰은 폰 앱의 이름(기본 기기 model). 연결마다 hello로 알린다: 폰과 desktop 여럿이 같은 기본 이름을 봐야 한다 (planner).
- 기계 id는 `<root>/machine.json`에 한 번 만든다. ledger 밖 file이라 ledger만 담는 recovery 복구본에 실리지 않고, 다른 기계로 가는 기록은 id 값을 출처로만 싣는다. 그 file 자체는 backup·export·폴더 어디로도 내보내지 않는다 (planner, 조사 규칙).
- 복제는 OS의 기계 값(Linux `/etc/machine-id`, macOS `IOPlatformUUID`, Windows `MachineGuid`)을 machine id로 HMAC한 binding으로 알아챈다. data root path와 hostname은 넣지 않는다: 같은 기계에서 새 disk로 옮기거나 hostname을 바꿔도 복제가 아니어야 한다 (planner).
- 알아챈 복제는 새 기계다: 새 id, 이름은 hostname으로, 새 host key, 기기 등록과 relay 등록은 이어받지 않고, app sync node는 새로 받는다. 같은 id 둘은 서로의 변경과 push를 덮는다 (planner).
- 같은 기계인지 알 수 없는 경우(OS 재설치 뒤 복원, VM image 복제, 이 판 전에 복사한 root)는 알 수 있는 쪽으로만 판정한다: OS 값이 바뀌면 새 기계(폰을 다시 pairing하는 비용이 같은 신분 둘보다 싸다), OS 값이 같거나 binding이 없으면 같은 기계 (planner).
- 기계에 묶인 상태는 만든 기계의 id를 같이 적고, 읽을 때 지금 id와 다르면 다른 기계의 것으로 보고 버리거나 새로 만든다. host key와 app sync node가 첫 둘이다: 복제 처리가 소비자 목록을 몰라도 된다 (planner, program 규칙).
- 공개 상태는 따로 열지 않고 Noise handshake 뒤의 hello에 싣는다. 붙는 쪽은 QR로 이미 key를 알아야 handshake를 하고, hello는 pair code나 call보다 먼저 온다. 평문 HTTP 답은 LAN의 누구에게나 이름과 id를 보인다 (planner).
- 붙는 쪽은 hello의 machine id를 pairing 때 저장한 것과 비교한 뒤에만 frame을 보내고, 같은 id의 두 항목은 하나로 접는다(별명은 남긴다) (planner, 조사 규칙).
- remote protocol 판을 2로 올리고 하한도 2다. 옛 폰 앱은 새 core에 붙지 못하므로 폰 앱과 core를 같이 올린다. hello는 모르는 칸을 무시해 다음부터는 칸을 더해도 깨지지 않는다 (planner).
- 기기 kind는 이 계획에서 더한다(`phone`, `desktop`). 기존 행은 phone이다. 기준 폰, preview 기기 화면(`shell.devices`), push token, phone preview view, presence의 폰 규칙은 phone에만 걸린다. desktop 보기를 위한 다른 것은 짓지 않는다 (planner).
- desktop 기기의 권한은 폰과 같다(보기, 말하기, 승인·질문 답, 앱 쓰기). 다른 기계의 관리는 없다. 그래서 allowlist와 `app_sync/*`는 kind로 가르지 않고, kind로 가르는 것은 위의 폰 장치(기준, 화면 칸, push token)뿐이다 (planner, program 14).
- agent 정의, skill, 설정은 기계 사이에 맞추지 않는다 (planner, program 13).
- 자격은 기계를 넘지 않는다. 복제가 들고 온 provider key와 secret은 사람이 스스로 복사한 것이라 지우지 않는다 (planner, program 16).
- 깨진 `machine.json`은 덮지 않고 기동을 거절한다. 새 id로 덮으면 host key 표지가 어긋나 기기 등록이 모두 버려진다 (planner).
- SDK와 앱 선언은 바뀌지 않는다. sdk-note가 필요 없다 (planner).
- worker는 `sonnet-high`, `machine-id`와 `machine-hello`는 opus high다(brief 머리에 적었다) (planner).

## 다른 계획이 기대는 계약

기기 kind, hello, 기계 기록, 이름은 이 계획만 정한다. 다른 계획은 아래를 읽기만 하고 `machine.json`이나 hello에 칸을 더하지 않는다. 칸이 필요하면 자기 README의 "계약 바꾸기 요청"에 적고 planner가 정한다.

1. **기계 기록.** `<root>/machine.json`(0600, temp에 쓰고 rename): `{ "id": "mch_<ULID>", "name": string | null, "binding": "<64 hex>" | null, "created_at": at, "cloned_from": "mch_…" | null, "cloned_at": at | null }`. `packages/core/machine`만 읽고 쓴다. 접두사 `mch`는 `packages/protocol/base/ids.ts`에 있다.
   - core 안에서는 `ctx.machine`(Late, 기동이 data step과 wiring build보다 먼저 채운다): `{ id: Id<"mch">; status(): MachineStatus; rename(name: string | null): Promise<Result<MachineStatus>> }`.
   - wiring 밖(data step, app supervisor process)은 `packages/core/machine/mod.ts`의 `readMachineId(root): Promise<Result<Id<"mch">>>`. 비동기 기동 앞에서 도는 code(`always-on`)는 같은 file의 `readMachineIdSync(root): Result<Id<"mch">>`(같은 판정, 동기 읽기).
   - `MachineStatus`(`packages/protocol/machine/`): `{ id, name, name_source: "hostname" | "person", hostname, cloned_from: Id<"mch"> | null, cloned_at: at | null }`. `name`은 1~64자다.
   - route: `machine/status`(memory, actors `user`, 출력 `MachineStatus`), `machine/rename`(memory, actors `user`, 입력 `{ name: string(1..64, trim) | null }`, 출력 `MachineStatus`. null이면 hostname을 다시 따른다). agent가 읽는 길은 `app-folder-sync`가 더한다.
   - 기계에 묶인 상태의 표지: `remote/host-key.json`의 `machine`, sync 앱 DB `lophn_sync_state`의 key `machine`. 뒤 계획의 기계별 상태(폴더의 자기 하위 폴더 상태, 서비스 등록, job 주인)도 같은 규칙을 쓴다.
2. **hello(공개 상태).** handshake 뒤 client가 먼저, core가 그 뒤에 보낸다. 모르는 칸은 무시한다.
   - core → client: `{ type: "hello", version: 2, min_version: 2, capabilities: string[], machine: { id: Id<"mch">, name: string } }`(core의 capabilities는 지금 빈 목록).
   - client → core: `{ type: "hello", version: 2, min_version: 2, capabilities: string[], name: string(1..64) }`(capabilities는 지금처럼 기기가 답하는 `request` kind). 폰은 자기 이름을, desktop client(`desktop-remote`)는 자기 기계 이름(`machine/status`의 `name`)을 보낸다.
   - 판: 상대의 `version`이 내 `min_version`보다 낮거나 내 `version`이 상대의 `min_version`보다 낮으면 `conflict`로 닫는다. client의 판이 범위 밖이어도 core는 자기 hello를 **먼저 보내고** 닫는다. 그래서 양쪽 다 두 hello를 보고 닫으며, 오류는 `{ code: "conflict", details: { update: "client" | "host" } }`다: client의 `version`이 core의 `min_version`보다 낮으면 `"client"`(이 앱을 올려라), core의 `version`이 client의 `min_version`보다 낮으면 `"host"`(<name>의 lophn을 올려라). client는 core hello의 `machine.name`으로 그 이름을 안다.
   - `connectRemote({ …, name, machine?: Id<"mch"> })`는 `machine`을 주면 hello의 id가 다를 때 channel을 열지 않고(`conflict`) 아무 frame도 보내지 않는다. client의 `RemotePeer`는 `{ publicKey, version, minVersion, capabilities, machine: { id, name } }`, core 쪽은 `machine` 대신 `name`이다.
   - 붙는 쪽 규칙: pairing 때 hello의 id를 저장하고, 저장한 것이 있으면 늘 `machine`으로 준다. 같은 id의 항목은 하나로 접는다.
3. **기기 kind.** `devices.kind` `'phone' | 'desktop'`, `devices.os` `'ios' | 'android' | 'linux' | 'macos' | 'windows'`, `width`·`height`·`dpr`은 phone만 있고 desktop은 null. `pair` frame은 `kind`로 갈린다: phone `{ os: ios|android, width, height, dpr }`, desktop `{ os: linux|macos|windows }`. core 안에서는 `ctx.deviceKind(principal): "phone" | "desktop" | null`(기기가 아니면 null). desktop 기기는 기준이 되지 못하고(`devices/set_primary`는 `invalid_input`), `shell.devices`에 들지 않고, `devices/set_push`는 `forbidden`이고, presence에서 desktop 규칙(idle 한도)을 따른다. 그 밖의 route(allowlist 전체, `app_sync/*`)는 kind와 상관없다.
4. **이름.** 보이는 이름 = 보는 쪽 별명이 있으면 별명, 없으면 기계가 마지막으로 알린 이름.
   - 컴퓨터 자기 이름: `machine.json`의 `name`, `machine/status|rename`, Settings › Remote의 "This computer". hello `machine.name`으로 알린다.
   - 폰 자기 이름: 폰 앱 Settings › This phone(SecureStore `phone-name`, 기본 기기 model). client hello `name`으로 알린다.
   - 컴퓨터가 아는 기기 이름(`devices` 표): `name`(그 기기가 마지막으로 알린 이름, not null), `alias`(사람이 붙인 별명, null이면 없음), `name_announced_at`(hello로 받은 때. null이면 pairing·migration에서 온 값). `RemoteDevice`(`devices/list`)는 `{ name: alias ?? 알린 이름, announced_name, alias, … }`라 지금 `name`을 읽는 곳(기준 폰 이름, `shell.devices`, host queue 글)은 보이는 이름을 그대로 받는다. `devices/connected { id, name }`이 알린 이름을 적고, `devices/rename { id, name: string | null }`이 별명을 두거나(null이면) 지운다.
   - 폰이 아는 컴퓨터 이름(SecureStore `computers`의 `Computer`): `name?`(사람의 "Shown as" 별명. 지금 칸 그대로), `announced?`(그 컴퓨터가 마지막으로 알린 이름), `machine?`(그 컴퓨터의 `mch_` id).
   - `desktop-remote`는 desktop이 다른 기계에 붙이는 별명을 같은 규칙(알린 이름과 별명을 따로)으로 둔다.
5. **ledger schema step(이 순서로 낸 목록 끝에).** `remote.devices.kind` 하나(kind, 넓힌 os, 화면 칸 null, `alias`, `name_announced_at`을 한 번의 표 다시 만들기로). data step은 `remote.host-key.machine`(remote wiring) 하나. machine id는 data step이 아니라 기동마다 도는 `ensureMachine`이 처음 한 번 만든다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `machine-id` | `packages/core/machine`: `machine.json`, OS 값 binding과 복제 판정, 이름(hostname 기본), `machine/status·rename`, `ctx.machine`, 기동 순서. 복제 위험 test |
| 1 | `machine-device-kind` | schema step `remote.devices.kind`(kind, 이름 칸 셋을 한 번에), `pair`의 kind, 기준·`shell.devices`·push를 phone만, `devices/rename`은 별명을 두고 지우기, `ctx.deviceKind`. migration 위험 test |
| 2 | `machine-hello` | hello의 판 범위·machine·이름, 붙을 때 알린 이름 적기, host key의 machine 표지와 다른 기계의 key면 기기 등록 버리기(`devices/forget_all`, data step), protocol 판 2 |
| 2 | `machine-consumers` | presence와 phone preview view를 kind로, app sync node에 machine 표지를 찍고 다르면 새 node |
| 2 | `machine-settings` | desktop Settings › Remote: "This computer" section(이름, 복제 알림), 기기 줄의 별명과 알린 이름·kind |
| 3 | `machine-phone` | 폰: hello의 이름과 id, id 확인과 접기, "Shown as" 별명과 알린 이름, 폰의 이름, `pair`의 kind. emulator 5632 |

## lead가 할 일

- 돌리기 전에: 같은 때 열린 계획이 `packages/core/remote/**`, `packages/protocol/remote/**`, `wiring/remote.ts`, `schema-steps.lock.json`을 고치면 `status.py ready`가 막는다. 막힌 task는 그 task가 끝난 뒤 띄운다.
- 공유 줄: `packages/core/main/daemon/wiring/context.ts`는 `machine-id`(`machine`)와 `machine-device-kind`(`deviceKind`)가 Late 칸 한 줄씩과 `LATE_KEYS` 한 줄씩만 더하고 "넘길 줄"에 적는다. 합칠 때 두 쪽을 다 남긴다. i18n catalog는 key만 더한다. Settings › Remote는 `desktop-remote`·`always-on`도 고치므로 이 계획은 "This computer"를 자기 section component file에 두고 panel에는 한 줄로 단다.
- wave 1이 `pair` frame을, wave 2가 hello를 바꾸므로 `packages/mobile`의 typecheck는 `machine-phone`이 merge될 때까지 깨져 있다. land는 `machine-phone` 뒤 계획 끝에 한 번이다.
- merge 때마다 `npm run check`. `machine-device-kind` 뒤에는 `check:full`(schema step lock), `machine-phone` 뒤에는 `cd packages/mobile && npm ci && npm run typecheck && npm test`와 emulator 그림을 wireframe(`tools/wireframes/drafts/phone/{start,more}.tsx`)과 대조한다.
- wave 2 뒤: 개발 core를 두 번 띄워(`boot.sh`) `machine.json`이 한 번만 생기고 data step이 걸리는지, `.dev-data`를 다른 path로 복사해 띄워도 같은 id인지 본다. binding 값을 손으로 바꿔 띄우면 새 id, 빈 기기 목록, 새 host key가 되는지 본다. 사람의 `~/.lophn`은 쓰지 않는다.
- land 뒤: protocol 판이 2가 되므로 실제 폰에는 새 폰 앱 build가 있어야 붙는다. lead가 arm64 release APK를 짓고 사람이 깐다(lead는 실제 폰에 명령을 보내지 않는다).
- land 전에: 사람에게 알린다. 이 판이 들어가면 실제 폰에 새 폰 build를 깔아야 붙는다(옛 build는 protocol 1이다). 실제 폰에 build를 까는 것은 사람에게 묻는다.
- 끝에(문서): 새 `project-docs/architecture/machine.md`(문제: 기계 하나의 신분과 이름, 복제. 모델: `machine.json`, binding, 복제 판정, 기계에 묶인 상태의 표지 규칙, 자기 이름과 보는 쪽 별명. 지키는 것: id file은 어디로도 내보내지 않는다, 깨진 file은 덮지 않는다, 알 수 없으면 같은 기계, 별명은 스스로 바뀌지 않는다. 결정: path·hostname을 binding에서 뺌, 복제는 새 기계), `remote.md`(hello의 판 범위·machine·이름, 자격 전 id 확인, 기기 kind와 phone만의 장치, desktop 권한은 폰과 같다, 알린 이름과 별명, 복제 때 기기 등록 버림), `platform.md`(기동 순서에 `ensureMachine`, 공유 data root는 복제로 판정됨), `phone-screen.md`(기준은 phone만), `app-sync.md`(node의 machine 표지), `attention.md`(presence는 kind로), `boundary-catalog.yaml`·`module-catalog.yaml`(`machine-id` task가 넣은 항목 다듬기), `project-docs/flows/`(`flows` skill로 마지막 대조), roadmap `multi-machine.md`(순서 0 끝남), `packages/mobile/README.md`(폰 이름, 같이 올리기), change-log `0.23/machine-identity.yaml`(복제 판정의 한계, protocol 2로 폰 앱을 같이 올려야 함, 별명과 알린 이름). `sdk-note`는 필요 없다.
