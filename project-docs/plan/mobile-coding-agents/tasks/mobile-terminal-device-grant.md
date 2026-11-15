# mobile-terminal-device-grant

폰에서 터미널에 치는 것(원격 shell)을 기기마다 사람이 컴퓨터에서 켜는 스위치로 막는다. 기본은 꺼짐이다. ledger의 `devices`에 칸 하나, 그것을 바꾸는 route(폰은 부르지 못한다), Settings › Remote의 기기 줄 스위치, 그리고 `mobile-terminal-core`가 비워 둔 허락 칸(`terminalInputGrant`)을 채우는 것까지 한다.

- 단위: terminal-view (wave 5)
- 선행: mobile-terminal-core
- 소유(이 task만 고친다):
  - `packages/core/remote/devices.ts`
  - `packages/core/main/daemon/wiring/remote.ts`와 `remote_test.ts`
  - `packages/protocol/remote/routes.ts`와 `mod.ts`
  - `packages/core/storage/migration/schema-steps.lock.json`
  - `packages/shell/renderer/desktop/settings/remote/{device-rows.tsx,core-source.ts,source.ts}`와 `testdata/fake-source.ts`
  - `packages/design/i18n/catalog/workspace-settings.ts`(Remote 기기 줄의 새 문구 key만)
- 한 줄씩 허락(공유 file. 한 줄만 더하고 "넘길 줄"에 적는다): `packages/shell/main/desktop/core/allowlist.ts`(desktop renderer가 부를 route 한 줄. 다른 계획 `mobile-attention-desktop`이 같은 file을 고친다), `project-docs/flows/`의 area file와 `tests/*.yaml` 줄
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/coding-agent-relay-survey.md`의 6(1번). README "정한 것"(기본 꺼짐, 기기마다, 사람이 컴퓨터에서)
  - architecture: `project-docs/architecture/remote.md`("지키는 것": 폰 자격의 route 목록, 기기마다 principal `device:<id>`), `settings.md`
  - 이 계획이 먼저 낸 것: `mobile-terminal-core`의 `ctx.terminalInputGrant` 칸(type과 "채워지지 않으면 늘 거절"하는 기본값)과 `terminal_view/snapshot`의 `input`
  - 지금 코드: `packages/core/remote/devices.ts`(`DEVICES_SCHEMA_STEPS`, `DEVICES_COMMANDS`, `rowOf`, `load`), `packages/protocol/remote/routes.ts`(`devicesList`와 `deviceSchema`, `devicesRename` 같은 command 정의), `packages/core/main/daemon/wiring/remote.ts`(`operations`, `build`), `packages/core/storage/migration/schema-steps.lock.json`(이미 낸 step의 SQL은 고치지 않는다. 새 step은 `DEVICES_SCHEMA_STEPS` 끝에 더하고 같은 변경에서 lock 끝에 `{id, sha256}`을 덧붙인다. hash는 `packages/core/main/daemon/schema-steps_test.ts`가 기대하는 값이다. 그 test가 알려 준다), 화면 `packages/shell/renderer/desktop/settings/remote/device-rows.tsx`
  - 다른 계획: `project-docs/plan/mobile-push/tasks/mobile-push-device.md`가 같은 `devices` 표에 push 칸 step을 더하고 같은 file들(`devices.ts`, `routes.ts`, `wiring/remote.ts`, lock)을 고친다. 한쪽이 먼저 merge되면 그 위에서 고치고 step은 lock 끝에 붙인다. 둘 다 `DEVICES_SCHEMA_STEPS` 끝에 더하므로 lead가 합친다(README "돌리기 전에")
- 계약:
  - 쓰는 것: `ctx.terminalInputGrant`(`mobile-terminal-core`)
  - 내놓는 것:
    - ledger step `remote.devices.terminal_input`: `alter table devices add column terminal_input integer not null default 0 check (terminal_input in (0, 1))`
    - `devices/list`의 기기 줄에 `terminal_input: boolean`
    - `devices/set_terminal_input` command `{id: dev, on: boolean}` -> `{id}`, actor `user`, `changes: [{name: "remote_devices", id}]`, 오류 `invalid_input|forbidden|not_found|unavailable`. 폰 자격은 이 route가 목록에 없어 `forbidden`이다(`mobile-coding-mobile-data`·`mobile-terminal-phone`이 allowlist에 더하지 않는다). `devices/rename`처럼 사람(desktop)만 부른다
    - `ctx.terminalInputGrant(principal)`: principal이 `device:<id>`이고 그 기기의 `terminal_input`이 켜져 있으면 true, 그 밖(꺼짐, 끊긴 기기, 기기가 아닌 principal)은 false. 끄거나 기기를 끊으면 다음 입력부터 거절이다(메모리 사본을 `StateChanged{remote_devices}`로 다시 읽거나 호출 때 읽는다. 오래된 값으로 입력이 통과하지 않게 한다)

## 할 일

1. ledger step과 lock 줄, `deviceSchema`·`rowOf`·`devices/list`에 `terminal_input`, `devices/set_terminal_input`의 정의(`routes.ts`, `mod.ts`)와 handler(`devices.ts`).
2. `wiring/remote.ts`의 `build`에서 `ctx.terminalInputGrant`를 채운다.
3. Settings › Remote의 기기 줄: `RemoteDevice`에 `terminalInput`, source의 `setTerminalInput(id, on)`, core-source가 새 route를 부른다. `device-rows.tsx`는 기기 줄(`lineControl`의 오른쪽 끝 고정 열)에 스위치를 둔다. 문구는 `@lophn/i18n`(`workspace-settings.ts`에 `settings.label.remote-terminal-input` 같은 key): 이름 "Allow typing in terminals"와 도움말 "This phone can type into coding agent terminals on this computer. Off by default. Anyone holding the phone could run commands as you." 같은 뜻(영어 한 문장씩). 켤 때 한 번 묻지 않는다(사람이 그 줄에서 직접 하는 일이고 되돌리기 쉽다). desktop renderer allowlist 한 줄.
4. fake-source와 gallery의 Settings › Remote page가 새 줄로 그려지게 맞춘다(`npm run wireframes`).
5. flows catalog와 test.

## 끝남

- `npm run check:full`이 통과한다(`schema-steps_test.ts`와 lock이 맞아야 한다).
- 위험 test:
  - "`devices/set_terminal_input`은 desktop(사람) 자격만 부르고 폰 기기 자격으로 부르면 `forbidden`이다"
  - "기기의 `terminal_input`은 기본 꺼짐이고, 켜져 있는 기기만 `terminalInputGrant`가 true이며 끄거나 끊으면 곧바로 false다"
- 남지 않음: 없음
- 확인: `npm run wireframes`가 되고 Settings › Remote의 기기 줄에 스위치가 보인다. 그림을 `.dev-data/mobile-terminal-device-grant/shots/`에 둔다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 새 step의 id와 hash, route 입력·출력 예, 허락 칸을 채운 방법(메모리 사본인지 호출 때 읽는지), 그림 목록, lead가 `remote.md`(기기 칸과 route)와 flows에서 고칠 것.
