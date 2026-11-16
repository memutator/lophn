# machine-hello

**opus high.**

remote 연결의 hello를 공개 상태로 만든다: core는 handshake 뒤 hello에 판 범위, capabilities, machine id와 이름을 싣고, 붙는 쪽은 자기 이름을 싣는다. 붙는 쪽이 저장한 machine id와 다르면 channel이 열리지 않는다. core는 기기가 알린 이름을 붙을 때마다 기기 표의 알린 이름 칸에 적는다(사람이 붙인 별명은 건드리지 않는다). host key에 그것을 만든 기계의 id를 찍고, 다른 기계의 key(복제된 data root)면 기기 등록을 모두 버리고 새 key를 만든다. remote protocol 판을 2로 올린다.

- 단위: machine-remote (wave 2)
- 선행: machine-id, machine-device-kind
- 소유(이 task만 고친다):
  - `packages/protocol/remote/frames.ts`
  - `packages/protocol/remote/channel.ts`
  - `packages/protocol/remote/channel_test.ts`
  - `packages/protocol/remote/client.ts`
  - `packages/protocol/remote/mod.ts`
  - `packages/protocol/remote/routes.ts`
  - `packages/core/remote/host.ts`
  - `packages/core/remote/host_test.ts`
  - `packages/core/remote/host-key.ts`
  - `packages/core/remote/host-key_test.ts`(새 file)
  - `packages/core/remote/devices.ts`
  - `packages/core/remote/devices_test.ts`
  - `packages/core/remote/phone-link_test.ts`
  - `packages/core/remote/mod.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/core/main/daemon/wiring/remote_test.ts`
  - `tools/remote-client.ts`
- 읽을 것:
  - 계획: `project-docs/plan/machine-identity/README.md`의 "정한 것"과 "다른 계획이 기대는 계약" 1·2·4·5
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` A("What identifies a computer to a phone", "A copied data root shares"), B(listener 한도, "Pre-credential surfaces today")
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 1.3, 4.3(같은 id 둘, 자격 전 확인), 13.2(판 범위와 capability)
  - architecture: `project-docs/architecture/remote.md`(handshake, hello, 기기 자격, relay, 지키는 것), `project-docs/architecture/platform.md`(listener 한도: 붙지 않은 socket 8, 10초 handshake, 60초 pairing, 4 KiB frame)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `remote-protocol`
  - 앞 task의 결과: `packages/core/machine/mod.ts`(`ctx.machine.status()`, `readMachineId`), `devices.ts`의 kind union과 `DevicesChange`
  - 지금 코드: `channel.ts`의 `open`(initiator가 hello를 먼저 보내고 responder가 판을 본 뒤 답한다), `host.ts`의 `accept`·`serve`·`attach`·`unpaired`, `host-key.ts`, `wiring/remote.ts`의 `reconcile`(key는 `remote.enabled`일 때 늦게 만든다)·`build`·`REMOTE_CONTEXT`·`operations`, `tools/remote-client.ts`
  - data step 본보기: `packages/core/storage/migration/data-steps.ts`의 `DataStep`, `packages/core/main/daemon/wiring/sealed-marker.ts`의 `dataSteps`
- 계약:
  - 쓰는 것: `ctx.machine`, `readMachineId`(machine-id), kind union과 `createDeviceKinds`(machine-device-kind)
  - 내놓는 것(README "다른 계약" 2를 그대로 짓는다. `machine-phone`과 `desktop-remote`가 기댄다):
    - `REMOTE_PROTOCOL_VERSION = 2`, `REMOTE_PROTOCOL_MIN_VERSION = 2`. prologue `lophn-remote/1`은 그대로 둔다(Noise prologue는 판과 다른 것이다).
    - core → client hello `{ type: "hello", version, min_version, capabilities, machine: { id: machineIdSchema, name: machineNameSchema } }`, client → core hello `{ type: "hello", version, min_version, capabilities, name: z.string().trim().min(1).max(64) }`(폰은 자기 이름, desktop client는 자기 기계 이름을 보낸다. 기계 이름이 64자까지라 기기 이름 40자보다 길다). 둘 다 `z.object`(모르는 칸은 버린다). `remoteServerFrameSchema`와 `remoteClientFrameSchema`가 각자의 hello를 쓴다.
    - `pair` frame에서 `name`을 뺀다. 등록 이름은 그 연결의 client hello `name`이다.
    - 판 범위: client의 판이 범위 밖이어도 core는 자기 hello를 먼저 보내고 닫는다. 양쪽의 오류는 `{ code: "conflict", message: "remote protocol version out of range", details: { update: "client" | "host" } }`다. client `version` < core `min_version`이면 `"client"`, core `version` < client `min_version`이면 `"host"`. client는 core hello를 받은 뒤 이 판정을 스스로 하고(core hello의 `machine.name`도 같이 안다), core는 log에 같은 값을 남긴다. `packages/base`의 오류에 `details`를 싣는 꼴을 확인해 따른다.
    - `connectRemote({ transport, staticKey, remoteStatic, capabilities, name, machine?, random, maxFrameBytes? })`: 판이 범위 밖이면 위의 `conflict`, `machine`이 있고 hello의 id와 다르면 `conflict`("a different computer answered")로 닫고 channel을 내지 않는다. 그 전에는 hello 말고 어떤 frame도 보내지 않는다. client channel의 `peer`: `{ publicKey, version, minVersion, capabilities, machine: { id, name } }`.
    - `acceptRemote({ …, machine: { id, name } })`: client hello의 판이 범위 밖이면 자기 hello를 보낸 뒤 위의 `conflict`로 닫는다. server channel의 `peer`: `{ publicKey, version, minVersion, capabilities, name }`.
    - `devices/connected` 입력 `{ id, name }`: `last_connected_at`을 적고, 알린 이름 칸 `name`을 입력으로, `name_announced_at`을 지금으로 적는다. `alias`는 한 경우만 빼고 건드리지 않는다: 그 행의 `name_announced_at`이 아직 null(migration·pairing에서 온 이름)이고 `alias`가 입력 이름과 같으면 `alias`를 null로 거둔다. migration이 옛 이름을 별명으로 지켜 둔 것 가운데 사람이 바꾼 적 없는 것만 거두는 규칙이고, 보이는 글은 바뀌지 않는다. 보이는 이름(`alias ?? name`)이 바뀌었을 때만 `renamed`(보이는 이름)를 낸다(설정 `shell.devices`의 그 기기 항목도 `screensRenamed`로 따라간다).
    - `devices/register`가 hello에서 받은 이름으로 행을 만들 때 `name_announced_at`도 지금으로 적는다.
    - `devices/forget_all`(command, actors `machine`만, `REMOTE_CONTEXT`의 scope와 `operations`에): 입력 `{}`, 출력 `{ count }`, `changes: [{ name: "remote_devices", id: null }]` 꼴(이웃 route를 따른다). 행을 모두 지우고 행마다 `revoked`를 낸다(연결 닫기, 자격 거두기, `shell.devices`, kind·grant 사본이 따라간다).
    - `remote/host-key.json`: `{ public_key, secret_key, machine }`. data step `remote.host-key.machine`.

## 할 일

1. `frames.ts`·`channel.ts`·`client.ts`·`mod.ts`: 위 계약대로 hello 둘, 판 범위 검사(양쪽 모두), client의 machine id 확인, peer 모양. 확인은 channel 안에서 한다: 폰, `desktop-remote`, `tools/remote-client.ts`가 같은 규칙을 쓰고 어느 쪽도 자격(pair code, call, watch)을 먼저 보내지 못한다. hello가 붙지 않은 연결의 frame 상한(4 KiB) 안에 드는지 본다(machine 이름 64자, client 이름 64자, capabilities 64개 × 64자의 상한이 이미 있다. 넘으면 capabilities 상한을 줄이지 말고 보고한다).
2. `host.ts`: `RemoteHostDeps`에 `machine(): { id; name }`를 더하고 `accept`마다 그 값으로 `acceptRemote`를 부른다(사람이 이름을 바꾸면 다음 연결부터 새 이름이다). `unpaired`의 등록 이름은 `channel.peer.name`(64자까지. 설정 `shell.devices`의 항목 이름은 40자 상한이라 `screensPaired`·`screensRenamed`에 넘길 때 40자로 자른다), `attach`는 `deps.devices.connected(device, channel.peer.name)`.
3. `devices.ts`·`routes.ts`: `devices/connected`의 `{ id, name }`(위 계약의 알린 이름과 별명 규칙), register의 `name_announced_at`, `devices/forget_all`. `devices/rename`(별명)은 고치지 않는다. `wiring/remote.ts`의 `devicesOf().connected`와 `REMOTE_CONTEXT`·`operations`를 맞춘다.
4. host key 표지:
   - `host-key.ts`: 새 key를 만들 때 `machine`을 같이 쓴다(`loadHostKey(dir, random, machine)`). `readHostKeyMachine(dir): Promise<"missing" | Id<"mch"> | "unreadable">` 같은 작은 읽기를 더한다.
   - `wiring/remote.ts`의 `build`(`remote.enabled`와 무관하게 기동마다): file의 `machine`이 `ctx.machine.id`와 다르면 이 data root는 다른 기계에서 왔다. 순서대로 `devices/forget_all`을 부르고, `host-key.json`을 지우고, 경고 log 한 줄(옛 id와 지금 id). 중간에 죽으면 다음 기동이 같은 판정으로 다시 한다(둘 다 다시 해도 같다). 그 뒤 `remote.enabled`면 `reconcile`이 지금 id를 찍은 새 key를 만들고 relay에도 새 key로 붙는다(relay 쪽 일은 없다). 못 읽는 key file은 지금처럼 덮지 않는다.
   - data step `remote.host-key.machine`(`remoteWiring.dataSteps`): `<root>/remote/host-key.json`이 있고 `machine`이 없으면 `readMachineId(root)`의 값을 더해 0600으로 temp에 쓰고 rename한다. file이 없으면 할 일이 없다. 이 판 전부터 쓰던 key가 이 기계의 것으로 남아 이미 pairing한 폰이 그대로 붙는다. `ensureMachine`이 data step보다 먼저 돈다(machine-id가 기동 순서를 그렇게 놓았다).
5. `tools/remote-client.ts`: `pair`는 hello의 machine id를 state file에 남기고 `--name`을 client hello로 보낸다. `call`·`file`·`watch`는 그 id를 `connectRemote`의 `machine`으로 준다.
6. test 견본(`host_test.ts`, `phone-link_test.ts`, `remote_test.ts`, `channel_test.ts`)을 새 hello에 맞춘다. `packages/mobile`은 고치지 않는다(`machine-phone`).

## 끝남

- `npm run check`가 통과한다.
- 위험 test:
  - `channel_test.ts`: "client가 준 machine id와 core hello의 id가 다르면 client channel이 열리지 않고 hello 뒤로 아무 frame도 보내지 않으며, 판이 범위 밖이면 core는 자기 hello를 보낸 뒤 닫고 양쪽 다 `conflict`와 맞는 `details.update`(`client` 또는 `host`)로 끝난다"
  - `remote_test.ts` 또는 `devices` test: "붙을 때 알린 이름은 늘 고쳐 적히고 사람이 붙인 별명은 그대로이며, migration이 지킨 옛 이름은 처음 알린 이름과 같을 때만 별명에서 거둬진다"
  - `host-key_test.ts`와 `remote_test.ts` 중 맞는 곳: "host key의 machine이 지금 id와 다르면 기동 뒤 기기 표가 비고(push token 포함) 새 key가 생기며, 같으면 기기와 key가 그대로다. data step은 machine이 없는 key에 지금 id를 찍고 key 값은 바꾸지 않는다"
- subprocess, 서버, 브라우저를 띄우는 test는 만들지 않는다(메모리 전송 꼴을 쓴다).
- 남지 않음: `grep -rn "REMOTE_PROTOCOL_VERSION = 1\|helloFrameSchema" packages tools tests`가 0줄(새 이름으로 갈랐다면).
- flows catalog: 바뀐 `remote-connection`, `remote-pair`, `devices-connected`, 새 `devices/forget_all` route, data step, 새 test file의 줄을 `project-docs/flows/`에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서:

- hello 두 꼴의 실제 JSON 예와 byte 수(붙지 않은 연결의 4 KiB 안인지).
- 개발 core에서 본 것: `npm run dev:core`와 `tools/remote-client.ts pair`·`call`로 붙어 hello의 machine id·이름이 오는지, `machine/rename` 뒤 다음 연결에 새 이름이 오는지, state file의 id를 바꾸면 `call`이 `conflict`로 끝나는지. 사람의 `~/.lophn`과 실제 relay를 쓰지 않는다. 띄운 process는 끝에 모두 정리한다.
- 넘길 줄: `packages/core/main/daemon/assembly.ts`의 `remoteWiring` 위 주석("data step은 없다")을 data step이 생긴 것에 맞게 한 줄 고친다(file 주인은 machine-id였다. 다른 줄은 고치지 않는다).
- lead가 고칠 목록: `architecture/remote.md`(hello, 자격 전 확인, 판 범위, 복제 때 기기 등록 버림, 알린 이름과 별명).
