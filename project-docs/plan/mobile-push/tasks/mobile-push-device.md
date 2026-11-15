# mobile-push-device

기기(폰)의 push token과 알림 설정을 core에 두고, 폰이 자기 것만 고칠 수 있는 길(`devices/set_push`)과 폰이 부를 `presence/report`를 allowlist에 더하고, 기기 목록과 보내기를 `mobile-attention-core`의 주의 모양에 잇는다(`bindPush`). 연결이 끊긴 기기의 보고를 지운다. 이로써 core가 실제로 push를 보내는 길이 닫힌다(fake push server까지).

**시작 조건: 계획 `phone-app`이 main에 올라가 있어야 한다.** 이 task는 그 계획이 쓰는 `packages/core/remote/**`, 폰 allowlist, `wiring/remote.ts`를 고친다. lead가 확인한 뒤에만 띄운다.

- 단위: mobile-push (wave 3)
- 선행: mobile-attention-core, mobile-push-send, mobile-attention-desktop
- 소유(이 task만 고친다):
  - `packages/core/remote`
  - `packages/protocol/remote/routes.ts`
  - `packages/protocol/remote/allowlist.ts`
  - `packages/protocol/remote/mod.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/core/main/daemon/wiring/remote_test.ts`
  - `packages/core/storage/migration/schema-steps.lock.json`
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/push-survey.md`의 2.3(device side), 3.5, 5
  - architecture: `project-docs/architecture/remote.md`(폰 자격의 route 목록, 지키는 것), `project-docs/plan/mobile-push/README.md`의 "정한 것"
  - 앞 task의 결과: `packages/protocol/attention/`(`presence/report`, `pushPrefsSchema`), `packages/core/attention/ports.ts`(`PushPorts`, `PushDevice`, `Attention`)와 `wiring/attention.ts`(`ctx.attention`), `packages/core/attention/push/mod.ts`(`createExpoPushSender`), 설정 `remote.push`(`shell-settings.ts`)
  - 지금 코드: `packages/core/remote/devices.ts`(`DEVICES_SCHEMA_STEPS`, `DEVICES_COMMANDS`, `load`, `revoke`), `packages/core/remote/host.ts`(`Connection`, `cleanups`, `revoked`), `packages/core/remote/call.ts`(`devicePrincipal`, 기기 자격의 scope가 `REMOTE_ALLOWED_ROUTES`), `wiring/remote.ts`(`operations`, `REMOTE_CONTEXT`, `build`)
  - ledger step 규칙: 이미 낸 step의 SQL은 고치지 않는다. 새 step은 `DEVICES_SCHEMA_STEPS` 끝에 더한다(`remoteWiring`이 맨 뒤 wiring의 `schemaStepsAfterTeams`다). 같은 변경에서 `schema-steps.lock.json` 끝에 `{id, sha256}`을 덧붙인다(hash는 `packages/core/main/daemon/schema-steps_test.ts`가 기대하는 값이다. 그 test가 알려 준다)
- 계약:
  - 쓰는 것: 위 앞 task의 모양
  - 내놓는 것(`mobile-push-phone`이 기댄다):
    - **devices/set_push** (command, actors `user`. 호출한 쪽의 principal이 `device:<id>`일 때만 그 기기 자신의 것을 고친다): 입력 `z.strictObject({ token: z.string().regex(/^Expo(nent)?PushToken\[[^\]]+\]$/).max(200).nullable(), prefs: pushPrefsSchema })`(id 칸이 없다. id는 `ctx.principal`에서 뽑는다), 출력 `{ id }`, `changes: [{ name: "remote_devices", id }]`. `token: null`은 그 기기의 push 끔(token을 지운다. prefs는 저장한다). principal이 `device:`로 시작하지 않으면 `forbidden`, 그 행이 없으면 `not_found`, 입력이 틀리면 `invalid_input`.
    - **devices/clear_push** (command, actors `machine`만): 입력 `{ id, token }`, 출력 `{ id }`. 그 기기의 token이 입력과 같을 때만 지운다(token이 그 사이 바뀌었으면 그대로 둔다). 죽은 token을 core가 거둘 때 쓴다.
    - **devices/push_targets** (read, actors `machine`만): 출력 `withReadCommon({ devices: [{ id, token, prefs }] })`. token이 있는 기기만. 폰이 부를 수 없다.
    - 폰 allowlist에 `presence/report`와 `devices/set_push`를 더한다. `devices/clear_push`, `devices/push_targets`는 더하지 않는다. `RemoteDevice`(`devices/list`)는 token과 prefs를 내지 않는다(그대로).

## 할 일

1. ledger step `remote.devices.push`: `alter table devices add column push_token text`, `alter table devices add column push_prefs text not null default '{}'`. `DEVICES_SCHEMA_STEPS` 끝에 더하고 lock에 `{id, sha256}`을 덧붙인다. `rowOf`는 그대로 둔다(token을 읽기에 싣지 않는다).
2. 위 command 둘과 read 하나를 `packages/protocol/remote/routes.ts`에 정의(`mod.ts`로 내보냄)하고 `devices.ts`에 handler를 짓는다(`DEVICES_COMMANDS`, 새 `devicesPushTargetsRead`와 reader 등록). machine 둘은 `wiring/remote.ts`의 `operations`에 `devicesRegister`와 같은 꼴로 올리고 `REMOTE_CONTEXT.scope.operations`에 더한다. prefs는 JSON으로 저장하고 읽을 때 `pushPrefsSchema`로 확인한다.
3. 폰 allowlist(`allowlist.ts`): `presenceReport`와 `devicesSetPush`를 `REMOTE_ALLOWED_ROUTES`에 더한다.
4. `host.ts`: `RemoteHostDeps`에 `deviceGone?(device: string): void`를 더하고, 그 기기의 마지막 연결이 닫힐 때(`connections`에 같은 `device`가 더는 없을 때)와 `revoked(id)`에서 부른다.
5. `wiring/remote.ts`의 `build`에서 연결한다: `createExpoPushSender({ fetch, url: () => ctx.settings.get(remotePushSetting), timers: systemTimers, onDeadToken })`를 만들고, `ctx.attention.bindPush({ devices, send, host })`를 부른다. `devices()`는 메모리 사본(시작할 때 `devices/push_targets`로 읽고, `StateChanged{remote_devices}`를 받을 때 다시 읽는다. 기존 bus 구독을 따라 한다), `send`는 sender의 `send`, `host()`는 host key의 공개 key 글(`remoteKeyText`, 시작할 때 한 번 풀어 둔다. 풀리기 전에는 `devices()`가 빈 목록이라 아무것도 보내지 않는다). `onDeadToken(token)`은 사본에서 그 token을 가진 기기를 찾아 `devices/clear_push {id, token}`을 부른다. `deviceGone`은 `ctx.attention.forgetReporter(devicePrincipal(id))`를 부른다. 닫을 때 sender를 `close()`한다. `PushMessage`·`PushPorts` 모양이 두 task에서 따로 적혔으므로 여기서 type이 맞는지 확인한다. 어긋나면 이 task의 file(연결하는 쪽)에서 맞추고 앞 task의 file은 고치지 않는다. 그렇게 맞출 수 없으면 "계약 바꾸기 요청"으로 보고한다.
6. 끝에서 개발 core로 확인한다: `npm run dev:core`(fake push server가 같이 뜬다)와 `packages/mobile/README.md`/`tools/remote-dev.ts`의 길로 Node client가 pairing해 `devices/set_push`(fake token `ExponentPushToken[lophn-dev-1]`)와 `presence/report`를 부르고, 개발 core에서 승인 대기나 앱 `notify()`를 하나 일으켜(방법은 보고에 적는다) fake push server가 받은 글(stdout 한 줄)을 본다. 확인한 것과 못 한 것을 적는다. 사람의 `~/.lophn`, 실제 relay, 실제 Expo endpoint를 쓰지 않는다. 끝나면 띄운 process를 모두 정리한다.

## 끝남

- `npm run check:full`이 통과한다(`schema-steps_test.ts`와 lock이 맞아야 한다).
- 위험 test:
  - "`devices/set_push`는 호출한 기기 자신의 행만 고친다: 입력에 id가 없고, 기기가 아닌 자격은 `forbidden`, 끊긴 기기는 `not_found`"
  - "폰 자격으로 `devices/push_targets`와 `devices/clear_push`를 부르면 거절되고, `devices/list`는 token을 내지 않는다"
  - "`devices/clear_push`는 token이 그 사이 바뀌었으면 지우지 않는다"
- subprocess, 서버, 브라우저를 띄우는 test와 E2E는 새로 만들지 않는다(기존 `host_test.ts`의 메모리 전송 꼴로 쓴다).
- 남지 않음: 없음(지우는 것이 없다).

- flows catalog: 이 task가 더하거나 지우는 route, CLI 명령, IPC channel, test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 새 step의 id와 hash, 세 route의 입력·출력 예, `bindPush`로 이은 것, 개발 core에서 확인한 것(fake가 받은 글 한 줄)과 못 한 것, lead가 고칠 목록(`architecture/remote.md`의 폰 route 목록과 devices 열, `flows`).
