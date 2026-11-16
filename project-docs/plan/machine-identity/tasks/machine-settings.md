# machine-settings

desktop Settings › Remote에 이 계획의 이름 둘을 보인다. 맨 위 "This computer" section은 폰과 다른 기기에 알리는 이 컴퓨터의 이름을 보고 바꾸고(비우면 hostname을 다시 따른다), 이 data root가 다른 컴퓨터에서 복사되어 새 기계가 되었으면 그 사실과 할 일을 알린다. 기기 줄은 사람이 붙인 별명이 있으면 별명을, 없으면 기기가 알린 이름을 보이고, 둘이 다르면 알린 이름을 아래에 작게 보이며, 별명을 지워 알린 이름으로 돌아가는 길을 둔다. 새 화면은 만들지 않는다.

- 단위: machine-settings (wave 2)
- 선행: machine-id, machine-device-kind
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/settings/remote/this-computer.tsx`(새 file. "This computer" section component)
  - `packages/shell/renderer/desktop/settings/remote/remote-panel.tsx`(section을 다는 한 줄과 그 import만)
  - `packages/shell/renderer/desktop/settings/remote/device-rows.tsx`
  - `packages/shell/renderer/desktop/settings/remote/source.ts`
  - `packages/shell/renderer/desktop/settings/remote/core-source.ts`
  - `packages/shell/renderer/desktop/settings/remote/testdata/fake-source.ts`
  - `packages/shell/renderer/desktop/settings/remote/remote.module.css`
  - `packages/shell/main/desktop/core/allowlist.ts`
- 읽을 것:
  - 계획: `project-docs/plan/machine-identity/README.md`의 "정한 것"(별명과 알린 이름, 기계 자기 이름, 복제는 새 기계)과 "다른 계획이 기대는 계약" 1·4
  - program: `/home/pyosechang/projects/lophn/reports/multi-machine/program.md`의 "Settings › Remote" 줄(`desktop-remote`와 `always-on`도 이 pane을 고친다. 이 계획은 자기 section component에 둔다)
  - architecture: `project-docs/architecture/settings.md`(Settings 화면의 원칙), `project-docs/architecture/remote.md`(Settings › Remote)
  - 본보기(화면): gallery `tools/wireframes/pages/screens/settings-pages.tsx`의 `SettingsRemote`(실제 panel을 `testdata/fake-source.ts`로 그린다), `remote-panel.tsx`의 켜기 줄과 group 꼴, `device-rows.tsx`의 [Rename] sheet
  - 앞 task의 결과: `packages/protocol/machine/mod.ts`의 `machineStatus`·`machineRename`과 `MachineStatus`(machine-id), 화면 쪽 `RemoteDevice`의 `kind`·`announcedName`·`alias`와 `rename(id, name | null)`(machine-device-kind)
  - renderer가 memory route를 부르는 길: `core-source.ts`의 `call(core, "memory", "pairing", "start", {})`, shell main `allowlist.ts`의 `RENDERER_MEMORY_ROUTES`(machine route는 protocol `ROUTES`에 있어 `SHELL_ROUTES`에 이미 든다. 확인한다)
  - i18n: `packages/design/i18n/catalog/workspace-settings.ts`의 `settings.*` key(key만 더한다)
- 계약:
  - 쓰는 것: `machine/status`, `machine/rename`(memory, actors `user`), `devices/list`의 `name`·`announced_name`·`alias`, `devices/rename { id, name: string | null }`
  - 내놓는 것: 없음(화면)

## 할 일

1. `allowlist.ts`의 `RENDERER_MEMORY_ROUTES`에 `memory:machine/status`, `memory:machine/rename`을 더하고 위 주석 목록에 한 줄("이 컴퓨터의 이름 읽기·바꾸기. Settings › Remote")을 더한다.
2. `source.ts`의 `RemoteSettingsSource`에 `machine(): Promise<SourceResult<MachineStatus>>`와 `renameMachine(name: string | null): Promise<SourceResult<MachineStatus>>`(화면 쪽 type은 `MachineStatus`의 칸을 camelCase로 옮긴 interface), `core-source.ts`가 두 memory route로 짓고, `fake-source.ts`가 메모리로 짓는다(option `machine?`로 복제된 상태를, 견본 기기 하나에 별명을 준다).
3. `this-computer.tsx`: `remote-panel.tsx` 맨 위(켜기 줄 위, remote가 꺼져 있어도 보인다)에 한 줄로 단다.
   - Name 줄: 지금 이름을 input에 보이고 Enter나 blur에 저장한다. 사람이 지은 이름이면 [Use computer name] 단추가 null로 되돌린다. hostname을 따르는 중이면 input 아래 note "Follows this computer's name (<hostname>)". 저장 실패는 이 pane의 다른 줄과 같은 오류 글(`settings.error.value-not-saved`)이다. note 한 줄: 바꾼 이름은 붙은 기기에 다음 연결부터 보이고, 기기가 따로 붙인 이름이 있으면 그 기기에서는 그 이름이 보인다.
   - 복제 note: `clonedFrom`이 있고 기기 목록이 비어 있으면 note 하나: "This lophn was copied from another computer, so it is now a new computer. Phones paired with the other computer need to pair again here." 닫기 단추는 두지 않는다(기기를 하나 pairing하면 사라진다).
4. `device-rows.tsx`: 줄 제목은 `name`(별명이 있으면 별명). 별명이 있고 알린 이름과 다르면 제목 아래에 알린 이름을 작게("Pixel 9" 아래 "Calls itself SM-S918N" 꼴). [Rename] sheet는 그대로 두고, 별명이 있을 때 sheet에 [Use the device's name] 단추(`rename(id, null)`)를 더한다. sheet input의 placeholder는 알린 이름이다. 기기 줄의 kind와 os 글은 `machine-device-kind`가 맞춘 대로다(desktop이면 "Desktop · Linux" 꼴로 읽히는지만 본다).
5. 새 문구 key를 `workspace-settings.ts`에 더한다(`settings.heading.this-computer`, `settings.label.computer-name`, `settings.note.computer-name-follows`, `settings.button.computer-name-reset`, `settings.note.computer-name-next-connect`, `settings.notice.computer-cloned`, `settings.label.device-announced-name`, `settings.button.device-name-reset` 같은 이름. 이웃 key의 꼴을 따른다).
6. gallery의 `SettingsRemote`가 새 section과 별명 있는 기기 줄을 그리는지 본다. 복제 note는 fake option으로 한 번 그려 본다. gallery page를 새로 더할 필요는 없다.

## 끝남

- `npm run check`가 통과한다.
- `npm run wireframes`가 되고, gallery의 `SettingsRemote`가 "This computer" section과 별명·알린 이름을 실제 panel로 그린다.
- 위험 test: 없음(화면과 문구).
- 남지 않음: 없음.
- flows catalog: 사람이 Settings › Remote에서 컴퓨터 이름을 바꾸는 줄(entry `route:machine/rename`, area `shell-desktop`), 기기 별명 지우기 갈래(`devices-rename`의 null), renderer allowlist 줄을 `project-docs/flows/`에서 고친다(자기 줄만). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: gallery 그림 세 장(기본, 별명 있는 기기 줄, 복제 note)의 path, lead가 고칠 목록(`architecture/remote.md`의 Settings › Remote 서술).
