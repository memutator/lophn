# remote-desk-screens

다른 기계를 보는 화면 조각을 renderer component로 짓고 fake source로 gallery에 그린다: title bar의 기계 고르기, 이 컴퓨터 창 Settings › Remote의 "Computers you view" section(붙여 넣기 pairing, 별명, 지우기, 시작 기계), 다른 기계 창의 gate(붙는 중, offline, 지워짐), "This opens only on <이름>" 자리 표시, 다른 기계 창의 Settings 자리. 실제 IPC에 잇는 일은 `remote-desk-renderer`가 한다. 사람이 이 gallery를 보고 승인한다.

- 단위: desk-screens (wave 1)
- 선행: 없음. `machine-identity`가 main에 land된 뒤에 띄운다(같은 Settings › Remote pane에 "This computer" section이 먼저 서 있어야 한다).
- 소유(이 task만 고친다):
  - `packages/shell/renderer/desktop/machines`(새 폴더: `source.ts`, `context.tsx`, `testdata/fake-source.ts`, `machine-switcher.tsx`, `machine-gate.tsx`, `only-here.tsx`, `remote-settings.tsx`와 각자의 `.module.css`)
  - `packages/shell/renderer/desktop/settings/remote/viewed-machines.tsx`(새 file)
  - `packages/shell/renderer/desktop/settings/remote/viewed-machines.module.css`(새 file)
  - `packages/shell/renderer/desktop/settings/remote/remote-panel.tsx`(section을 다는 한 줄과 import만)
  - `packages/shell/renderer/shell/shell-frame.tsx`(title bar 왼쪽 구역의 slot 하나)
  - `packages/shell/renderer/shell/shell-frame.module.css`
  - `packages/design/i18n/catalog/remote-desk.ts`(새 file)
  - `packages/design/i18n/en.ts`(import와 펼치기 한 줄씩)
  - `packages/design/i18n/catalog/workspace-settings.ts`(아래 할 일 6의 값만)
  - `tools/wireframes/pages/screens/settings-pages.tsx`
  - `tools/wireframes/pages/screens/settings-frame.tsx`
  - `tools/wireframes/pages/screens/shell.tsx`
  - `tools/wireframes/pages/screens/shell/shell-scene.tsx`
- 읽을 것:
  - 계획: `project-docs/plan/desktop-remote/README.md`의 "정한 것"(창마다 한 기계, 끄는 기능과 자리 표시, 기계 이름이 늘 보인다, 시작 기계, 꺼진 기계가 막지 않음, 자기 자신 거절, host 쪽 문구)과 "다른 계획이 기대는 계약" 3
  - 비교: `/home/pyosechang/projects/harness-lab/_report/multi-device/comparison.md` 3.3(기본 기계의 안전 규칙), 5.2(꺼진 기계는 지우지 않고 마지막 상태로)
  - 화면 규칙: `.claude/skills/ui-design/SKILL.md`("모든 화면의 규칙", 새 화면 만들기, CSP·끌기 영역 함정)
  - architecture: `project-docs/architecture/settings.md`, `project-docs/architecture/ui-kit.md`, `project-docs/architecture/appearance.md`
  - 본보기(화면): `packages/shell/renderer/shell/desk-switcher.tsx`(title bar 왼쪽 구역의 menu 단추), `packages/shell/renderer/desktop/settings/remote/{remote-panel.tsx,device-rows.tsx,this-computer.tsx}`(group 꼴, [Rename] sheet, 확인 dialog), `packages/shell/renderer/desktop/connection/connection.tsx`(`ConnectionGate`, `ConnectionNotice`), gallery `tools/wireframes/pages/screens/settings-pages.tsx`의 `SettingsRemote*`와 `shell.tsx`의 `shell-desk-menu`
  - renderer source 꼴: `packages/shell/renderer/desktop/settings/remote/{source.ts,testdata/fake-source.ts}`, `packages/shell/renderer/source-result.ts`
  - i18n: `packages/design/i18n/en.ts`, 이웃 catalog(`workspace-settings.ts`)의 key 꼴 `<screen>.<part>.<name>`
- 계약:
  - 쓰는 것: 없음(fake source만)
  - 내놓는 것(`remote-desk-renderer`가 실제 bridge로 짓는다):
    - `machines/source.ts`: `MachineStatus = "connecting"|"connected"|"offline"|"removed"`, `MachineItem { id; name; announcedName: string|null; alias: string|null; status; path: "direct"|"relay"|null; lastSeenAt: string|null }`, `MachinesView { state: "starting"|"ready"|"unreadable"; thisComputer: { id; name } | null; machines: readonly MachineItem[]; start: { mode: "last" } | { mode: "machine"; machine: string }; last: string|null }`(`starting`은 이 컴퓨터의 id를 아직 모른다, `unreadable`은 저장 file을 못 읽었다), `PairOutcome = { ok: true; machine: string } | { ok: false; reason: "invalid_text"|"unreachable"|"refused"|"expired"|"closed"|"this_computer"|"unavailable" }`, `MachinesSource { get(): MachinesView; subscribe(listener): () => void; thisWindow(): { id; name } | null; pair(text): Promise<PairOutcome>; remove(id): Promise<SourceResult<void>>; rename(id, alias: string|null): Promise<SourceResult<void>>; setStart(start): Promise<SourceResult<void>>; open(id): Promise<SourceResult<void>> }`. `thisWindow()`가 null이면 이 컴퓨터의 창이다.
    - `machines/context.tsx`: `MachinesProvider`, `useMachines(): MachinesSource | null`(provider가 없으면 null이고 기계 조각은 아무것도 그리지 않는다).
    - component: `MachineSwitcher({ onPairAnother })`(기계 목록은 context에서 읽는다), `MachineGate({ machine, connection, onRetry })`, `OnlyHere({ machine })`, `RemoteSettings({ machine })`, `ViewedMachines`(Settings section).
    - `ShellFrame`의 새 prop `machineSwitcher?: ReactNode`(왼쪽 구역, desk 단추 앞).

## 할 일

1. `source.ts`, `context.tsx`, `testdata/fake-source.ts`: 위 모양. fake는 option으로 기계 수, 각 상태, 시작 기계, 이 창의 기계, pair의 결과를 받는다(gallery가 상태를 고정한다).
2. `MachineSwitcher`: title bar 왼쪽 구역의 단추. 지금 창의 기계 이름(이 컴퓨터 창이면 이 컴퓨터의 이름)을 늘 글로 보이고 누르면 menu다: 맨 위 이 컴퓨터(이름과 "This computer"), 그 아래 짝지은 기계(보이는 이름, 상태 점과 글: connected는 path, offline은 "Last seen <때>", removed는 "Removed this desktop"), 지금 창의 기계에 표시, 맨 아래 "Pair another computer…"(prop `onPairAnother`를 부른다. 어디로 갈지는 `remote-desk-renderer`가 정한다). 줄을 누르면 `open(id)`. 짝지은 기계가 없고 이 창이 이 컴퓨터면 단추를 그리지 않는다. menu는 `desk-switcher.tsx`와 같은 overlay 길을 쓴다. 끌기 영역에서 `no-drag`를 준다.
3. `ViewedMachines`(Settings › Remote, 이 컴퓨터 창에서만 그린다: `thisWindow()`가 null일 때): heading "Computers you view", 줄마다 보이는 이름(별명이 있고 알린 이름과 다르면 그 아래 작게 알린 이름), 상태, 마지막으로 본 때, 오른쪽 끝 [Rename]·[Remove]. [Rename]은 `device-rows.tsx`의 sheet 꼴(placeholder는 알린 이름, 별명이 있으면 [Use its own name]). [Remove]는 확인 dialog: 그 기계가 시작 기계면 "lophn opens <이름> at start. After removing it, lophn opens the computer you used last." 한 줄을 더한다. [Add computer]는 여러 줄 입력 칸(붙여 넣기)과 [Pair], 결과 글(성공 "Paired with <이름>", 각 실패 이유의 글: 틀린 text, 닿지 않음, code가 지났거나 쓰였음(`refused`의 not_found는 `expired`), 끊김, 자기 자신 "This is the pairing code of this computer", 기계 보기를 쓸 수 없음). note 한 줄: 그 컴퓨터의 Settings › Remote에서 "Add phone or computer"를 누르고 "Show as text"를 복사해 온다. 시작 기계 줄: select "The computer I used last"(기본) | 이 컴퓨터 | 짝지은 기계들. `state`가 `starting`이면 section 자리에 "Starting…" 한 줄, `unreadable`이면 오류 한 줄("Could not read the list of computers you view. lophn left the file as it is.")만 보이고 단추는 없다.
4. `MachineGate`: 다른 기계 창이 아직 한 번도 붙지 않았거나 지워졌을 때 창 전체 자리. connecting "Connecting to <이름>…"(shimmer), offline "<이름> is offline" + 마지막으로 본 때 + [Try again]·[This computer], removed "<이름> removed this desktop. Pair again in Settings › Remote on this computer." + [This computer]. 한 번 붙은 뒤의 끊김은 지금의 `ConnectionNotice`(마지막 화면 위 한 줄)를 그대로 쓰므로 여기서 다시 그리지 않는다.
5. `OnlyHere`: 탭 본문 가운데 기둥에 "This opens only on <이름>." 한 줄만 둔다. 단추는 없다(이 컴퓨터의 터미널이나 파일을 대신 열자는 뜻이 아니다). `RemoteSettings`: 다른 기계 창의 Settings 자리. "<이름>'s settings are changed on <이름>." 한 줄과 [Open this computer](`open(this.id)`).
6. host 쪽 문구(`workspace-settings.ts`의 값만. key는 그대로): Settings › Remote가 폰만 말하는 곳을 폰과 컴퓨터로 바꾼다. `settings.button.remote-pair` "Add phone or computer", `settings.heading.remote-pair`, `settings.heading.remote-devices` "Devices", `settings.label.remote-enabled`, `settings.note.remote-enabled`, `settings.note.remote-scan`(QR은 폰, text는 다른 컴퓨터의 lophn에 붙여 넣기), `settings.notice.remote-devices-empty`, `settings.notice.remote-off`, `settings.notice.remote-expired`, `settings.error.remote-devices-failed`, `settings.intro.remote`. 다른 key는 고치지 않는다.
7. i18n: 새 catalog `packages/design/i18n/catalog/remote-desk.ts`(`export const remoteDesk = { … }`)를 만들어 `en.ts`에 올리고 이 task의 모든 새 문구를 key(`machines.*`)로 둔다. wave 3 task도 여기에 key만 더한다.
8. `ShellFrame`: `machineSwitcher` slot을 왼쪽 구역 desk 단추 앞에 둔다(없으면 지금과 같다).
9. `remote-panel.tsx`: `ViewedMachines`를 "This computer" section 아래, 켜기 줄 위에 한 줄로 단다(remote가 꺼져 있어도 보인다. 다른 기계를 보는 데 이 컴퓨터의 listener는 필요 없다).
10. gallery(`settings-pages.tsx`, `settings-frame.tsx`에 fake machines option, `shell.tsx`, `shell/shell-scene.tsx`에 switcher slot): page를 더한다. id는 `settings-remote-viewed`(기계 셋: connected relay, offline, removed. 시작 기계 고정), `settings-remote-viewed-add`(붙여 넣기 칸 열림), `settings-remote-viewed-remove-start`(시작 기계 지우기 dialog), `shell-machine-menu`(이 컴퓨터 창에서 menu 열림), `shell-machine-window`(다른 기계 창: title bar에 그 이름, Home), `shell-machine-gate-offline`, `shell-machine-gate-removed`, `shell-machine-only-here`, `shell-machine-settings`. title은 영어, description은 한국어 한두 문장. 다른 기계 창 page는 shell scene에 fake source의 `thisWindow`를 주어 그린다(끄는 기능을 실제로 감추는 일은 wave 3이라 여기서는 title bar와 자리 표시만 맞으면 된다).

## 끝남

- `npm run check`가 통과한다.
- `npm run wireframes`가 되고 gallery의 위 page들이 이 component로 그려진다(light·dark). `node packages/shell/renderer/build.ts`가 선다.
- 위험 test: 없음(화면).
- flows: 입구가 없다. 고칠 줄이 없으면 그대로 둔다(journey는 `remote-desk-renderer`가 쓴다).

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: page id 목록과 각 그림(`.dev-data/remote-desk-screens/shots/`, headless Chrome `--screenshot`), 사람이 보고 고를 곳(menu의 줄 모양, 상태 글, 시작 기계 select의 자리), "모든 화면의 규칙"과 부딪힌 곳.
