# machine-device-kind

기기 표에 kind(`phone`, `desktop`)를 더하고 기존 행을 phone으로 옮기며, pairing이 kind를 싣게 하고, 지금 모든 `device:`에 걸리던 폰만의 장치(기준 폰, preview 기기 화면 `shell.devices`, push token)를 phone에만 건다. 같은 표 다시 만들기에서 기기 이름을 둘로 나눈다: 기기가 알린 이름(`name`)과 사람이 컴퓨터에서 붙인 별명(`alias`). `devices/rename`은 별명을 두고 지우는 route가 된다. 이미 붙인 별명은 그대로 남는다. core 안에서 kind를 묻는 `ctx.deviceKind`를 낸다. desktop을 등록하는 client는 `desktop-remote`가 짓는다.

- 단위: machine-remote (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/remote/devices.ts`
  - `packages/core/remote/devices_test.ts`(새 file)
  - `packages/core/remote/host.ts`
  - `packages/core/remote/host_test.ts`
  - `packages/core/remote/mod.ts`
  - `packages/protocol/remote/frames.ts`
  - `packages/protocol/remote/routes.ts`
  - `packages/protocol/remote/mod.ts`
  - `packages/core/main/daemon/wiring/remote.ts`
  - `packages/core/main/daemon/wiring/remote_test.ts`
  - `packages/core/storage/migration/schema-steps.lock.json`
  - `packages/core/apps/phone/target.ts`
  - `packages/shell/renderer/desktop/settings/remote`
  - `tools/remote-client.ts`
- 읽을 것:
  - 계획: `project-docs/plan/machine-identity/README.md`의 "정한 것"(별명, kind, desktop 권한)과 "다른 계획이 기대는 계약" 3·4·5
  - 조사: `/home/pyosechang/projects/lophn/reports/multi-machine/code-survey.md` A(기기 표와 gate, 이름이 오는 곳), C(모든 `device:`가 폰으로 다뤄지는 곳)
  - architecture: `project-docs/architecture/remote.md`(기기 자격, 기준 기기, 지키는 것), `project-docs/architecture/phone-screen.md`(`apps/phone_target`은 기준 기기)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `remote`, `remote-protocol`, `project-docs/module-catalog.yaml`의 `packages/core/remote`
  - 지금 코드: `devices.ts`(`DEVICES_SCHEMA_STEPS`, `register`의 `is_primary=1`, `setPrimary`, `setPush`, `rename`, `rowOf`, `DevicesChange`, `screensRenamed`, `createTerminalInputGrants`), `wiring/remote.ts`(`schemaStepsAfterTeams` 순서, `devicesOf().register`의 `editScreens(screensPaired)`, build의 `grants.load`와 `ctx.provide`, `withAfterCommit`의 `renamed` 처리), `host.ts`의 `unpaired`(pair frame → `devices.register`), `frames.ts`의 `remoteDeviceSchema`(설정 `shell.devices`가 `packages/core/config/shell-settings.ts`에서 같은 schema를 쓴다), `packages/core/apps/phone/target.ts`(`select name, os, … where is_primary = 1`), `RemoteDevice.name`을 읽는 `packages/core/main/daemon/wiring/host-queue.ts` 750줄 근처(고치지 않는다. 보이는 이름을 그대로 받게 한다)
  - ledger step 본보기: `packages/core/apps/permissions/schema.ts`의 `apps.permissions.notify_kind`(CHECK를 바꾸려 표를 다시 만든다)
  - ledger step 규칙: AGENTS.md "호환성". 이미 낸 step의 SQL은 고치지 않는다
- 계약:
  - 쓰는 것: 없음(wave 1. `ctx.machine`은 쓰지 않는다)
  - 내놓는 것(README "다른 계약" 3·4를 짓는다):
    - `frames.ts`: `deviceKindSchema = z.enum(["phone", "desktop"])`. `remoteDeviceSchema`는 이름과 모양을 그대로 둔다(폰의 화면 칸이다. 설정 `shell.devices`가 쓴다. 주석을 "폰의 것"으로 고친다). `pair` frame은 `kind`로 갈린 union이다: `{ type: "pair", id, code, kind: "phone", name, os: "ios"|"android", width, height, dpr }`(지금 칸 + kind) | `{ type: "pair", id, code, kind: "desktop", name, os: "linux"|"macos"|"windows" }`. (`name`은 `machine-hello`가 client hello로 옮긴다. 이 task에서는 그대로 둔다.)
    - `routes.ts`: `RemoteDevice`(`devices/list`의 항목)에 `kind`, `os`는 다섯 값, `width`·`height`·`dpr`은 nullable, `name`은 보이는 이름(`alias ?? announced_name`), 새 칸 `announced_name: string`(기기가 마지막으로 알린 이름)과 `alias: string | null`. `devicesRegister` 입력은 pair frame과 같은 kind union + `public_key`. `devicesRename`은 남고 입력이 `{ id, name: string(1..64) | null }`이 된다(알린 이름이 64자까지라 별명도 같다): 이름이면 별명을 두고, null이면 별명을 지워 알린 이름이 다시 보인다.
    - `devices.ts`: `DevicesChange`에 `{ type: "registered"; id: string; kind: "phone" | "desktop" }`. `renamed`는 보이는 이름이 바뀔 때마다 그 이름을 싣는다. `createDeviceKinds()`(`createTerminalInputGrants` 옆): `load(devices)`, `apply(change)`, `of(principal: string): "phone" | "desktop" | null`(`device:<id>`가 아니거나 모르는 id면 null).
    - Late 칸 `deviceKind: (principal: string) => "phone" | "desktop" | null`(`wiring/context.ts`. 아래 "넘길 줄"). remote wiring의 build가 `ctx.provide("deviceKind", kinds.of)`. `machine-consumers`가 presence와 view에서 읽는다.
    - ledger step `remote.devices.kind`(이 계획의 유일한 ledger step).

## 할 일

1. ledger step `remote.devices.kind`: `devices`를 다시 만든다(`devices_next`를 만들고 옮기고 지우고 rename. 이 표를 가리키는 FK와 따로 만든 index는 없다. 확인한다). `STRICT`. 칸:
   - 지금 칸 모두 + `kind text not null check (kind in ('phone','desktop'))`, `os` check는 다섯 값, `width`·`height`·`dpr`은 null 허용.
   - 이름: `name text not null`(기기가 알린 이름), `alias text`(사람의 별명, null이면 없음), `name_announced_at text`(hello로 이름을 받은 때. null이면 pairing·migration에서 온 이름).
   - 표 CHECK 하나: phone이면 `os in ('ios','android')`이고 화면 칸 셋이 null이 아니다. desktop이면 `os in ('linux','macos','windows')`, 화면 칸 셋이 null, `is_primary = 0`, `push_token is null`.
   - 옛 행은 `kind = 'phone'`, `name`과 `alias` 둘 다 옛 `name`, `name_announced_at = null`로 옮긴다(id, public_key, push_token, push_prefs, terminal_input, is_primary, 시각 모두 그대로). 옛 `name`이 pairing 때 폰이 보낸 이름인지 사람이 바꾼 별명인지 표에 흔적이 없어서 별명으로 지킨다. 첫 hello 때 알린 이름과 같으면 `machine-hello`가 그 별명을 거둔다(보이는 글은 바뀌지 않는다). 사람이 바꾼 별명은 알린 이름과 달라 그대로 남는다.
   - step은 `DEVICES_SCHEMA_STEPS` 끝이 아니라 **새 상수**(예: `DEVICES_KIND_STEPS`)로 두고 `remoteWiring.schemaStepsAfterTeams`의 맨 끝(`PERMISSIONS_PHONE_KIND_STEPS` 뒤)에 붙인다. 지금 배열 순서가 낸 순서라 `DEVICES_SCHEMA_STEPS` 끝에 넣으면 lock 순서와 어긋난다.
   - `schema-steps.lock.json` 끝에 `{id, sha256}`을 덧붙인다(hash는 `packages/core/main/daemon/schema-steps_test.ts`가 알려 준다).
2. `register`: 새 행은 `name` = 보낸 이름, `alias = null`. kind phone이면 지금처럼 다른 기준을 내리고 새 기기를 기준으로 한다. desktop이면 `is_primary = 0`이고 다른 기기의 기준을 건드리지 않는다. 같은 key의 옛 등록을 바꾸는 규칙은 그대로다(옛 행의 별명은 다시 pairing이 새 기기라 남기지 않는다. 지금과 같다). commit 뒤 `registered { id, kind }`를 낸다.
3. `rename`(`devices/rename`): `alias`를 입력 이름으로 두거나(null이면 지우고), 보이는 이름이 바뀌었으면 `renamed`(보이는 이름)를 낸다. `rowOf`는 `name`을 `alias ?? name`으로, `announced_name`을 `name` 칸으로, `alias`를 그대로 낸다. `packages/core/apps/phone/target.ts`의 select는 `coalesce(alias, name) as name`으로 고쳐 agent가 보는 기준 폰 이름이 보이는 이름이 되게 한다. host queue 글은 `RemoteDevice.name`을 읽으므로 고칠 것이 없다.
4. `setPrimary`: desktop 행이면 `invalid_input`("only a phone can be the primary device"). `setPush`: 부른 기기가 desktop이면 `forbidden`("only a phone sets push"). allowlist와 다른 route는 kind로 가르지 않는다(desktop 권한은 폰과 같다. README "정한 것").
5. `wiring/remote.ts`: `devicesOf().register`가 `shell.devices`에 항목을 더하는 것(`editScreens(screensPaired)`)을 kind phone일 때만 한다. build에서 `createDeviceKinds`를 표로 채우고 `ctx.provide("deviceKind", kinds.of)`, commit 뒤 바뀜마다 `kinds.apply(change)`(지금 `grants.apply` 옆). `renamed`의 `screensRenamed`는 그대로 둔다.
6. `host.ts`의 `unpaired`: pair frame의 kind union을 그대로 `devices.register`에 넘긴다(`RemoteDevices.register` 입력 type도 맞춘다).
7. Settings › Remote(`settings/remote/{source.ts,core-source.ts,device-rows.tsx,testdata/fake-source.ts}`)는 type만 맞춘다: 화면 쪽 `RemoteDevice`에 `kind`, `announcedName`, `alias`를 더하고 `os`를 다섯 값으로 넓힌다. `rename(id, name: string | null)`. 새 os 셋의 이름 key(`settings.label.device-linux|macos|windows`)를 `packages/design/i18n/catalog/workspace-settings.ts`에 더한다(key만). desktop 행에는 [Make primary]를 내지 않는다. 별명과 알린 이름을 같이 보이는 것과 별명 지우기 단추는 `machine-settings`가 한다.
8. `tools/remote-client.ts`의 `pair`가 `kind: "phone"`을 싣는다. `host_test.ts`·`remote_test.ts`의 pair frame과 기기 견본에 kind를 더한다. `packages/mobile`은 고치지 않는다(`machine-phone`이 고친다. 그때까지 mobile typecheck는 깨져 있다).

## 끝남

- `npm run check:full`이 통과한다(`schema-steps_test.ts`와 lock이 맞아야 한다).
- 위험 test(`packages/core/remote/devices_test.ts`. 옛 step까지만 건 ledger에 행을 넣고 `remote.devices.kind`를 건다):
  - "`remote.devices.kind` 뒤 옛 기기 행이 kind phone으로 남고 id, public_key, push_token, push_prefs, terminal_input, is_primary가 그대로이며, 옛 이름은 `devices/list`에 같은 글로 보이고 별명으로 남는다"
  - "`devices/rename`은 별명만 바꾸고 null이면 알린 이름이 다시 보이며, desktop 등록은 기준을 바꾸지 않고 desktop 행에 push token이나 기준을 넣는 쓰기는 거절된다"(표 CHECK와 command 둘 다)
- subprocess, 서버, 브라우저를 띄우는 test는 만들지 않는다.
- 남지 않음: 없음(지우는 것이 없다).
- flows catalog: 바뀐 `devices-rename`(별명 두고 지우기), `remote-pair`, `devices-register`, `devices-list` 줄과 새 test file 줄을 `project-docs/flows/`에서 고친다(자기 줄만. 꼴은 `.claude/skills/flows/SKILL.md`). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서:

- 넘길 줄: `packages/core/main/daemon/wiring/context.ts`의 `Late`에 `deviceKind: (principal: string) => "phone" | "desktop" | null;`(주석 한 줄: "remote가 낸다. 기기 principal의 kind") 한 줄과 `LATE_KEYS`에 `deviceKind: true` 한 줄만 더한다. 이 file은 `machine-id`도 한 줄씩 더한다.
- 새 step의 id와 hash, 옛 행과 별명이 옮겨진 것을 본 방법.
- lead가 고칠 목록: `architecture/remote.md`(기기 kind, phone만의 장치, 알린 이름과 별명), `architecture/phone-screen.md`(기준은 phone만).
