# use-grant

터미널 입력 허락을 받는 컴퓨터의 것으로 옮긴다. 지금은 명단 항목의 칸(`terminal_input`)이라 명단의 컴퓨터가 자기 허락을 스스로 켤 수 있고 다른 컴퓨터가 그것을 받아들인다(이슈 `roster-computer-self-grants-terminal-input`). 이 task 뒤에는 각 컴퓨터가 "여기서 허락한 기기"를 자기 ledger에 두고 그것만 읽는다. 명단은 누가 내 기기인지만 말하고, 무엇을 해도 되는지는 받는 컴퓨터가 정한다.

- 단위: use (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/remote/grants.ts`(새 file: 이 표의 machine 자격 route), `packages/core/remote/grants.ts`(새 file: 표, step, command·read, 메모리 사본), `packages/core/remote/grants_test.ts`(새 file)
  - `packages/core/remote/{roster,devices,mod}.ts`, `packages/core/remote/host_test.ts`(허락과 명단 칸을 채우는 자리만)
  - `packages/core/main/daemon/wiring/remote.ts`, `packages/core/main/daemon/wiring/remote_test.ts`, `packages/core/main/daemon/wiring/folder.ts`(따라가기 port를 읽는 한 자리)
  - `packages/protocol/remote/{roster,roster_test,carry_test}.ts`, `packages/remote-client/{join,computers_test}.ts`, `tools/remote-dev.ts`
  - `packages/core/folder/import/follow.ts`, `packages/core/folder/folder_test.ts`(따라가기 표만)
  - `packages/shell/renderer/desktop/settings/remote/`(`my-devices.tsx`, `add-device.tsx`, `source.ts`, `core-source.ts`, `testdata/fake-source.ts`)
  - `packages/cli/commands/remote.ts`(`remote join`의 `--no-terminal-input`과 새 명령 포함)
  - `packages/design/i18n/catalog/workspace-settings.ts`(`settings.*remote-*terminal-input` 문구)
  - `tools/wireframes/pages/screens/settings-pages.tsx`(My devices page), `tools/wireframes/pages/screens/settings-frame.tsx`(`fakeRemote`), `tools/wireframes/pages/screens/settings.tsx`(page 설명 글만)
  - `project-docs/architecture/remote.md`, `project-docs/architecture/terminal-agent.md`, `project-docs/architecture/folder-sync.md`, `project-docs/architecture/settings.md`(허락을 말하는 문장만)
  - `project-docs/flows/areas/{core-platform,cli}.yaml`, `project-docs/flows/tests/core-rest.yaml`
- 남의 file 한 줄(소유가 아니다. 보고의 "넘길 줄"에 적는다):
  - `packages/core/main/daemon/wiring/context.ts`(`use-contract` 소유): `Late`와 `LATE_KEYS`에 따라가기용 칸 `computerGranted` 하나(`computerSigningKey` 바로 아래에 둔다. `use-contract`는 `phoneLink` 아래에 `machineLinks`를 더한다. 자리가 달라 git이 합친다)
  - `packages/protocol/remote/routes.ts`(`use-contract` 소유): `rosterJoin`의 입력에 `terminal_input: z.boolean().optional()`(생략하면 켬. 초대장의 기본과 같다) 한 줄을 더한다(`machinesCall` 쪽을 고치는 `use-contract`와 자리가 달라 merge가 합친다). `rosterSetTerminalInput`·`rosterInvite`·`rosterList` 위 주석의 "모든 기계에 같다"는 "이 컴퓨터의 허락"으로 고칠 문장만 적어 lead에게 넘긴다
  - `project-docs/architecture/approval.md`(`use-contract` 소유): 고칠 문장은 아래 "할 일" 10에 줄로 있다. 새 문장을 보고에 적어 lead가 merge 때 넣는다
- 읽을 것:
  - 이슈 `project-docs/issues/roster-computer-self-grants-terminal-input.yaml`, review `reports/multi-device/review-carry-folder.md`의 "Round 2" N1(재현 입력, 왜 명단 view로는 "이 컴퓨터의 사람이 허락했다"를 가르지 못하는가: `core/remote/roster.ts`의 `settle`이 서명 안 된 body에 이 컴퓨터가 같이 서명한다)
  - 계획 README "정한 것"의 "허락은 받는 컴퓨터가 정한다", "받는 기계는 자기 규칙을 본다"
  - architecture: `remote.md`("내 기기 명단", "터미널 보기"), `approval.md`("폰(기기) 자격", 사람 route 목록), `folder-sync.md`("따라가기", 325줄), `terminal-agent.md`(68·78·162·180줄)
  - 변경 기록: `project-docs/products/change-log/0.23/one-screen.yaml`(터미널의 "그 컴퓨터가 이 컴퓨터에 준 허락", `terminals/close|restart`를 같은 허락에 걸었다), `carry-paths.yaml`(따라가기를 늘 묻게 둔 까닭)
  - skill: `.claude/skills/write-test/SKILL.md`, `.claude/skills/ui-design/SKILL.md`, `.claude/skills/flows/SKILL.md`
- 계약:
  - 쓰는 것: `ctx.peek.terminalInputGrant(principal)`(읽는 자리는 그대로 둔다. 읽는 곳: `createRemoteCall`의 `granted`와 `wiring/{terminals,lophn-agent,host-queue,terminal-view}.ts`), route `roster/set_terminal_input`·`roster/invite`·`roster/list`(`protocol/remote/routes.ts`), `roster/statements`의 `adopt`, `checkInvited`(`protocol/remote/roster.ts`), `applyChange`(`wiring/remote.ts`)
  - 내놓는 것:
    - ledger 표 `remote_grants(key, granted_at)`: 이 컴퓨터가 허락한 기기. key는 명단 항목의 `key`(host key 글)이고 id가 아니다(id는 접힐 수 있다). 표 `remote_grants_seed`(한 행): 옮기기를 했다는 표지. schema step id `remote.grants`(export `GRANTS_SCHEMA_STEPS`). 등록은 lead가 `schemaStepsAfterTeams` 끝과 `schema-steps.lock.json` 끝에 한다.
    - machine 자격 route(`protocol/remote/grants.ts`. 이름은 worker가 정하고 보고한다. 추천): read `roster/grants` → `{keys: string[], seeded: boolean}`, command `roster/grant_set {key, on}`, command `roster/grants_seed {keys}`(표지가 없을 때만 행과 표지를 한 transaction에 쓴다). `operations`(`wiring/remote.ts`의 `roster/statements`와 같은 자리)와 `READS`·`COMMANDS` 목록에 올린다.
    - `ctx.terminalInputGrant(principal)`의 뜻: "이 컴퓨터에서 허락한 기기인가". 명단 항목의 값을 읽지 않는다.
    - `ctx.computerGranted(machine)`(새 Late 칸): 그 machine의 컴퓨터가 이 컴퓨터에서 허락한 기기인가(명단 view에 그 machine의 컴퓨터 항목이 하나뿐일 때만. `computerSigningKey`와 같은 규칙).
    - `roster/set_terminal_input {id, on}`: 이 컴퓨터의 표만 고친다. 명단 statement를 내지 않는다.
    - `roster/list`의 기기마다 `terminal_input`: 이 컴퓨터의 표에서 읽은 값(화면과 CLI가 그대로 쓴다. 폰은 이 값을 읽지 않는다).

## 확인한 지금 code(2026-11-19, main 0.23.90)

- 허락을 읽는 곳은 `wiring/remote.ts` 855줄 한 자리다: `ctx.provide("terminalInputGrant", (principal) => deviceOf(principal)?.terminal_input === true)`. `deviceOf`는 명단 view에서 id로 항목을 찾는다. 읽는 쪽 다섯은 모두 `ctx.peek.terminalInputGrant?.(principal) ?? false`(`createRemoteCall`만 `granted`라는 dep으로 받는다. 704줄)라 이 자리 하나를 바꾸면 따라온다. 읽는 route는 `terminals/open|input|restart|close`(`wiring/terminals.ts`), `page_view/input|control|open`(`wiring/host-queue.ts`), `terminal_view/snapshot`의 `input`(`wiring/terminal-view.ts`), 앱·provider·설정의 사람 route와 확인이 필요한 command(`createRemoteCall`). `wiring/lophn-agent.ts` 205줄도 같은 peek이다.
- 켜는 곳은 하나다: 화면 `my-devices.tsx`의 스위치 → `source.setTerminalInput`(`settings/remote/core-source.ts` 225줄) → shell main 허용 목록의 `memory:roster/set_terminal_input`(`packages/shell/main/desktop/core/allowlist.ts` 70줄) → `wiring/remote.ts`의 `setTerminalInput`(1005줄) → `roster.setTerminalInput`(`core/remote/roster.ts` 415줄, 이긴 항목에 rev+1로 서명). 폰은 켜지 못하고(route가 기기 route 목록에 없다) CLI에도 켜는 명령이 없다. `lophn remote invite`의 `--no-terminal-input`만 있다.
- 초대장의 값은 지금 명단으로 퍼진다: `roster.invite`(`core/remote/roster.ts` 542줄)가 초대장 body에 `terminal_input`을 싣고, 들어오는 기기의 항목은 같은 값이어야 한다(`checkInvited`, `protocol/remote/roster.ts` 958줄). 초대장을 받아들이는 쪽은 `core/remote/roster.ts`의 `join`(붙는 쪽의 `join` frame)과 `add`(명단 frame·폰이나 폴더가 나른 statement)가 모두 `commit(settle(...))`을 지난다. 그래서 값이 그 항목으로 모든 컴퓨터에 선다.
- 컴퓨터는 자기 항목을 처음 낼 때 `terminal_input: true`로 서명한다(`ensureSelf`, 336줄). 그래서 지금은 명단의 컴퓨터 누구나 다른 컴퓨터에서 터미널 입력이 허락된 것으로 읽힌다. 폰의 옛 기기 표 행(`devices.terminal_input`, ledger에 칸이 남아 있다)은 `roster/statements`의 `adopt`로 한 번 항목이 된다.
- 폰이 읽는 것: 폰 source에는 `terminal_input`을 읽는 줄이 없다(`grep -rn terminal_input packages/mobile`이 0줄). 폰은 터미널을 열 때 `terminal_view/snapshot`의 `input`(core가 `terminalInputGrant`로 채운다)과 `page_view`의 `control`, 설정·앱을 부를 때 `forbidden`을 받아 "View only"나 "Settings › Remote › My devices on {computer}에서 켜라"를 보인다(`design/i18n/catalog/mobile-*.ts`, 이미 컴퓨터마다의 말이다). 그래서 폰 code는 바뀌지 않는다. 폰이 같이 쓰는 protocol type은 바뀌므로 `packages/mobile` check는 돈다.
- Settings의 다른 기계 고르기(`machine-picker.tsx`)는 `MACHINE_PANES`(General, Providers, Agents, Tools and skills, Shell rules, Diagnostics)만 다른 컴퓨터로 연다. Remote와 Sync는 이 컴퓨터의 shell에 붙어 있어 늘 이 컴퓨터의 것이다. 그러므로 "다른 컴퓨터의 My devices 스위치를 읽기만 되게" 할 일은 없다.
- `multi-device-fixes`가 `lophn remote invite|join|remove`를 lophn 터미널 탭 안에서 core에 붙기 전에 거절한다(`ROSTER_CHANGING_COMMANDS`, `cli/commands/remote.ts` 235줄. `cli/main.ts`가 본다).
- 위 화면의 문구: 스위치 `settings.label.remote-terminal-input`("Allow typing in terminals"), 초대장의 `settings.label.remote-invite-terminal-input`, 설명 `settings.note.remote-invite-terminal-input`·`settings.note.remote-device-terminal-input`(모두 `workspace-settings.ts`).

## 할 일

1. 표와 `grants.ts`: 위 계약의 표 둘, step, route 둘과 하나, 메모리 사본(`Map<key, true>`: 기동 때 `roster/grants`로 읽고, 쓸 때 command 뒤에 같이 고친다. 입력마다 동기로 묻기 때문이다). `core/remote/devices.ts`의 `forgetAll`(`roster/forget_all`)이 `remote_grants`도 비운다(복사된 data root나 명단에서 빠진 컴퓨터가 옛 허락을 들고 새 key로 서지 않게. 표지 행은 둔다). 명단에서 정해진 빼기로 빠진 기기(`change.after.removed`의 `settled`)의 행은 `applyChange`가 지운다(다시 들면 새 key다).
2. `wiring/remote.ts` 855줄을 `terminalInputGrant = (principal) => grants.has(deviceOf(principal)?.key)`로 바꾼다. 읽는 쪽 다섯은 고치지 않는다. 바뀐 자리가 이 하나인지 `grep -rn "terminalInputGrant" packages --include=*.ts`로 확인한다. `ctx.computerGranted`도 여기서 낸다(machine → 명단의 컴퓨터 항목이 하나뿐일 때 그 key → 표).
3. 켜고 끄기: `wiring/remote.ts`의 `setTerminalInput`이 명단에서 id로 기기를 찾고(없으면 `not_found`) `roster/grant_set`을 부르고 메모리 사본을 고친다. `roster/list`의 `row()`(`terminal_input: body.terminal_input` 줄)는 표에서 읽는다(엇갈려 빠진 기기는 false). 이 컴퓨터 자기 줄은 허락이 뜻이 없다(자기가 자기에게 원격으로 치지 않는다): 화면은 그 줄의 스위치를 그리지 않는다.
4. 초대장(두 방향): 한 초대장으로 짝이 되면 두 컴퓨터가 서로 허락해 둔 상태가 되는 편의를 지킨다. 각 컴퓨터는 자기 앞에 앉은 사람이 켠 것만 따른다는 규칙은 그대로다.
   - 초대한 쪽: 초대장을 낸 컴퓨터가 그 초대로 든 기기를 받아들일 때 그 기기의 허락을 초대장의 `terminal_input`으로 자기 표에 적는다. 자리는 `core/remote/roster.ts`의 `commit` 하나다(`join`과 `add`가 모두 지난다): 이번에 합친 statement 가운데 초대 서명 statement(`RosterInvitedStatement`)의 `invite.body.by`가 이 컴퓨터의 id이고, 그 기기의 key가 commit 앞 view에 없고 뒤 view에 있을 때만 `deps.granted(key, on)`을 부른다(wiring이 표에 쓴다). 이미 있는 key에는 하지 않는다: 사람이 끈 허락이 같은 statement가 다시 닿아 켜지는 일이 없게 한다. 다른 컴퓨터는 그 기기의 허락을 얻지 않는다(꺼져 있다). 폰이 컴퓨터에 들 때는 폰에 허락할 것이 없다(아무도 폰에 치지 않는다): 폰 쪽은 아무것도 쓰지 않는다.
   - 합류하는 쪽: 합류하는 컴퓨터 앞의 사람이 `roster/join`을 하므로 그 컴퓨터가 초대한 컴퓨터를 허락한다. 입력은 `rosterJoin`의 `terminal_input`(기본 켬)이다. `wiring/remote.ts`의 `joinRoster`(1044줄. `roster.storeJoin` 호출은 1117줄)가 `roster.storeJoin`이 성공한 뒤(issuer가 거절하면 아무것도 쓰지 않는다. 못 닿아 `pending`이어도 쓴다: 사람이 여기서 켠 것이다) 초대한 컴퓨터의 key(`prepared.value.issuer.key`)로 `roster/grant_set`을 부른다. 껐으면 쓰지 않는다. 이 컴퓨터의 표에만 쓴다.
   - 입력이 오는 자리: 화면은 `add-device.tsx`의 `sendJoin`(152줄)이 `source.join(text)`을 부르고(`source.ts` 131줄의 `join(text)`, `core-source.ts` 137줄이 `{text}` body로 `roster/join`) 그 합류 줄(`joinLine`, 열린 상태)에 스위치를 더한다. CLI는 `lophn remote join '<invite>'`(`cli/commands/remote.ts` 114줄. 입력 `{text}`)에 `--no-terminal-input`을 더한다(`remote invite`와 같다). 문구는 초대장의 스위치와 같은 말로: 초대 스위치 "Let the new device type in terminals"에 맞춰 "Let the inviting computer type in terminals"와 설명 한 줄을 `workspace-settings.ts`에 더한다.
5. 명단 항목의 `terminal_input` 칸을 없앤다: `protocol/remote/roster.ts`의 `rosterEntryBodySchema`(70줄)와 type(117줄), `ahead`의 "허락을 거둔 쪽이 이긴다" 비교(279줄), `checkInvited`의 `body.terminal_input !== invite.body.terminal_input`(958줄), `core/remote/roster.ts`의 `ensureSelf`(336·357줄)·`prepareJoin`(508줄)·`revise`의 edit 칸·`setTerminalInput`(415줄), `remote-client/join.ts` 105줄. 이미 저장된 옛 statement는 서명한 bytes에 그 칸이 있으므로 검증이 계속 되어야 한다. 가장 단순한 길: body schema가 `terminal_input`을 optional로 받아 서명 검증(canonical 글)에만 쓰고 새 statement는 싣지 않는다. 그 칸을 읽는 곳은 8의 옮기기 하나뿐이다. 초대장 body의 `terminal_input`은 남는다(초대장을 낸 컴퓨터가 쓴다). 판: 명단 항목 모양이 바뀌므로 판을 올려야 하는데 판 상수는 `use-contract`(`frames.ts`)가 5로 올린다. 이 task는 상수를 고치지 않고 보고에 "판 5에 얹는다"고 적는다(같은 wave라 둘이 올리면 겹친다).
6. 따라가기: `followAsksPerson(offers)`(`import/follow.ts`, 지금은 `computers`로만 온 release를 모두 묻는다)에 `granted(machine)`을 받게 한다: 묻지 않는 것은 이름 붙인 폴더로 온 release이거나, 그 release를 낸 컴퓨터가 여기서 허락한 컴퓨터일 때다. 그 밖은 지금처럼 묻는다. 값은 `ctx.peek.computerGranted?.(machine) ?? false`를 `wiring/folder.ts` 597줄의 `activate`가 넘긴다(`folderWiring`이 `remoteWiring`보다 앞이라 늦게 채워지는 칸으로 읽는다). 머리 주석의 "터미널 허락으로 묻지 않는 길은 두지 않았다"를 이 뜻으로 고친다. `folder_test.ts` 1221줄의 표에 줄을 더한다.
7. 화면(wireframe 먼저): My devices의 스위치 문구가 "이 컴퓨터에서"임을 말한다(문구 한 줄. 새 화면 없음). 초대장 화면의 문구도 같다. 합류 화면(`settings-pages.tsx` 417~447줄의 join page들, `data-remote-join-*`)에 4의 스위치 한 줄을 더한다("On by default: the new device can type into terminals on your computers" → 이 컴퓨터의 터미널). 이름과 문구는 `workspace-settings.ts` catalog에 있다. `settings-pages.tsx`의 `fakeRemote`가 쓰는 `terminalInput`은 값 그대로 둔다.
8. 옮기기(데이터): 첫 기동에서 한 번, 표지(`remote_grants_seed`)가 없을 때 `wiring/remote.ts`의 `build`가 `roster.load()`와 `roster.useKeys` 뒤에 한다. 옮길 것은 이 컴퓨터의 명단 view(자기 서명 key를 root로 계산한 것)에서 자기가 아닌 `devices` 가운데 `body.terminal_input === true`인 기기의 key와, 같은 기동의 `roster/statements`가 준 `adopt` 가운데 `terminal_input`이 true인 폰의 key다. 둘을 `roster/grants_seed`로 쓴다(표지도 같은 transaction). 엇갈려 빠진 기기와 꺼진 값은 옮기지 않는다. 컴퓨터 항목은 기본이 true였으므로(`ensureSelf`) 다른 컴퓨터의 허락도 옮겨진다. 이 기동 바로 전까지 이 컴퓨터에 치던 기기가 새 판에서 끊기지 않는 것이 이유다. SQL step이 아니라 이 자리인 까닭: 이긴 항목은 서명을 확인한 view에서만 정해지고 SQL은 그것을 계산하지 못한다. 표지는 remote를 켠 적이 없어 명단이 비어 있어도 쓴다(그 뒤에 드는 기기는 4가 다룬다). 이 읽기가 옛 칸을 읽는 유일한 자리이고 거기에 "옮기기 전용"이라고 주석을 단다. 8 뒤에 `terminal_input`을 읽는 줄은 `grants.ts`·`roster/list` 출력·초대장 body뿐이다.
9. CLI: `lophn remote invite`의 `--no-terminal-input`(그 초대로 든 기기에 이 컴퓨터가 터미널 입력을 허락하지 않는다)과 `lophn remote devices`의 `terminal_input` 설명을 "이 컴퓨터가 허락한"으로 고친다. `lophn remote join`의 `--no-terminal-input`은 4에 있다. 그 둘로 한 초대장의 두 방향은 선다. 그 밖에(나중에 끄거나 켜기, 초대 없이 든 세 번째 컴퓨터, 화면 없는 컴퓨터) 허락을 바꾸는 길이 필요하므로(`remote-use`의 목표: PC의 agent가 VM의 앱을 부르려면 VM이 PC를 허락해야 한다) 새 명령을 더한다: `lophn remote terminal-input <id> [--off]`(`roster/set_terminal_input`. flag 이름에 `--on`을 쓰지 않는다: `use-cli`가 전역 flag로 쓴다). `ROSTER_CHANGING_COMMANDS`에 더한다(lophn 터미널 탭 안의 coding agent가 허락을 켜지 못하게).
10. 문서(architecture, flows): 
    - `remote.md`: 항목 표(119줄)에서 `terminal_input` 칸을 빼고, 초대장(121줄·178~183줄: "항목의 `invite`·`kind`·`terminal_input`이 초대장과 다름"에서 `terminal_input`을 뺀다), 규칙 6(138줄)과 34번(262줄)의 "허락을 거둔 쪽이 이긴다"를 지우고, "이름과 허락"(197줄)·"명단의 컴퓨터는 서로 대등하다"(223줄: 컴퓨터의 허락은 정직한 code에만 묶인다는 문단을 "허락은 받는 컴퓨터의 것이라 대등하지 않다"로)·"My devices"(212줄)·route 목록(282줄)·ledger `devices`의 옛 칸(387줄)을 새 모델로 고친다.
    - `terminal-agent.md` 68줄("입력은 기기마다 허락이다. 기기의 `terminal_input`(명단 항목의 칸)"), 78·162(19번)·180줄, `folder-sync.md` 325줄("`computers`로만 온 release는 늘 사람의 동의를 기다린다 …"를 "허락한 컴퓨터의 것은 묻지 않는다"로), `settings.md` 50줄(My devices의 "터미널 입력").
    - `approval.md`(`use-contract` 소유라 새 문장을 보고에 적는다): 179·181·182·203줄과 224줄의 "버린 안: … 컴퓨터마다 따로인 허락"(이 task가 그 안을 받아들인다. 근거: 이슈 `roster-computer-self-grants-terminal-input`, 사람 2026-11-19).
    - flows(`flows` skill): `core-platform.yaml`의 `roster-set-terminal-input`(2445줄. steps와 `risk`), `roster-list`, `roster-invite`(1962줄)와 초대 확인의 outcome(1937줄), 명단 자기 항목(2253·2254줄), 명단 view의 `terminalInputGrant`(2287줄), 초대 수락의 새 step, `cli.yaml`의 새 명령, `tests/core-rest.yaml`의 `covers`.

정한 것:
- 합류하는 컴퓨터가 초대한 컴퓨터를 허락한다(합류하는 사람이 그 컴퓨터 앞에 앉아 있다). 한 초대장으로 두 방향이 서는 편의를 지키면서 "컴퓨터는 거기서 켠 것만 따른다"를 깨지 않는다. 스위치 기본은 초대장의 기본(켬)과 같다. 사람: lead 결정.
- 허락은 명단으로 퍼지지 않고 서명하지 않는다: 서명한 값은 명단의 컴퓨터 누구나 다시 서명할 수 있어 경계가 되지 못한다.
- 허락은 기기의 key에 건다: 같은 기기가 다시 들면(새 key) 다시 켠다.
- 초대장의 기본값(켬)은 그대로다. 달라지는 것은 그 값이 초대장을 낸 컴퓨터에만 선다는 것이다.

## 끝남

- `npm run check`가 통과한다. core 기동(`lead/boot.sh`). 폰이 같이 쓰는 protocol이 바뀌므로 `cd packages/mobile && npm ci && npm run typecheck && npm test`도 통과한다.
- 위험 test:
  - "명단의 컴퓨터가 자기 항목이나 다른 기기의 항목을 어떻게 서명해도 이 컴퓨터의 터미널 입력 허락은 켜지지 않는다" (스스로 서명한 높은 `rev`, 꼭두각시 컴퓨터를 거친 서명, 다른 컴퓨터가 보낸 명단 frame. 옛 칸 `terminal_input: true`를 실은 statement도 포함: 8 뒤에는 읽지 않는다)
  - "초대장의 허락은 초대장을 낸 컴퓨터에만 선다" (4. 같은 statement가 다시 닿아도 사람이 끈 허락이 켜지지 않는다)
  - "스위치를 끄고 합류하면 초대한 컴퓨터는 이 컴퓨터에서 허락이 없고, 켜고 합류하면 허락은 합류한 컴퓨터에만 쓰인다" (4. 초대한 컴퓨터가 합류한 컴퓨터를 허락하는 쪽은 위 줄이 본다. 폰이 컴퓨터에 들어도 허락은 쓰이지 않는다)
  - "옮기기는 켜져 있던 허락을 이 컴퓨터의 표로 옮기고 꺼져 있던 것은 켜지 않으며 한 번만 돈다" (8. 두 번째 기동은 표지 때문에 아무것도 쓰지 않는다)
  - "여기서 허락하지 않은 컴퓨터의 release는 묻고, 허락한 컴퓨터의 것은 묻지 않고 따라간다" (6. 따라가기 표의 줄)
- 남지 않음: `grep -rn "terminal_input" packages tools tests --include=*.ts --include=*.tsx`가 명단 항목에서 허락을 읽는 줄을 내지 않는다: 남는 것은 `grants.ts`와 `roster/list`·`roster/invite`의 입출력, 초대장 body, 8의 옮기기 읽기(주석 있음), 그 칸을 받는 optional schema, 그것을 그리는 화면 줄이다. `tests/`도 본다. `grep -rn "computerTerminalInput" packages`는 0줄이다.
- subprocess·서버 test와 E2E는 만들지 않는다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: schema step(id와 sha256: `schema-steps.lock.json` 끝, `schemaStepsAfterTeams` 끝에 `...GRANTS_SCHEMA_STEPS`), `protocol/remote/mod.ts`의 새 route 이름, `use-contract`의 step과 함께 넣는 차례, 판 5에 얹었다는 것
- 안 쓰게 된 export
- 정한 것: 문서에 답이 없어 worker가 정한 것(특히 5의 길)
- 넘길 줄: `context.ts` 한 줄, `routes.ts` 주석, `approval.md` 새 문장
- 계약 바꾸기 요청
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 없으면 "없음". 적어도 하나: 초대 없이 명단에 든 컴퓨터(세 번째 컴퓨터가 다른 컴퓨터의 명단으로 든 경우)는 서로의 허락을 CLI(9)나 화면으로 따로 켜야 한다

## 시작 전에 다시 볼 것

- 없음(이 brief를 쓴 날 code로 위를 확인했다). 시작할 때 `git log --oneline -5 -- packages/core/remote/roster.ts packages/core/main/daemon/wiring/remote.ts`로 그 사이 바뀐 줄만 본다.
- 권한 경계를 바꾼다. merge 전에 다른 worker에게 review를 맡긴다(계획 README).
