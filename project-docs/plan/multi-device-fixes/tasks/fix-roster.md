# fix-roster

내 기기 명단의 믿음 규칙 넷(쓰인 초대, key로만 세는 빼기, 모르는 서명자 상한, 엇갈린 빼기 다시 빼기)을 고치고 protocol 판을 올린다. 기기 id 모으기를 저장마다 다시 하게 하고 그 test를 쓴다. 폰 target 이름을 명단에서 읽고, lophn 터미널 탭 안에서 명단을 바꾸는 CLI를 거절하고, review가 찾은 옛 문구와 문서를 고친다.

- 단위: fix (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/remote/{roster.ts,roster_test.ts,frames.ts,routes.ts}`
  - `packages/core/remote/{roster.ts,devices.ts,host_test.ts}`
  - `packages/core/main/daemon/wiring/{remote.ts,remote_test.ts}`
  - `packages/core/apps/phone/{target.ts,target_test.ts}`
  - `packages/core/apps/views/mod.ts`(주석 한 줄), `packages/core/machine/identity.ts`(message 한 줄)
  - `packages/cli/main.ts`, `packages/cli/commands/remote.ts`
  - `packages/shell/renderer/desktop/settings/remote/{my-devices.tsx,source.ts,core-source.ts,testdata/fake-source.ts}`
  - `tools/wireframes/pages/screens/{settings.tsx,settings-pages.tsx}`, `tools/wireframes/drafts/phone/start.tsx`(옛 글만)
  - `packages/design/i18n/catalog/{workspace-settings.ts,mobile-app.ts}`
  - `packages/mobile/src/gallery/screens.tsx`, `packages/mobile/README.md`
  - `project-docs/architecture/{remote.md,settings.md,phone-screen.md}`
  - `project-docs/flows/areas/{core-platform.yaml,cli.yaml,sessions.yaml,app-runtime.yaml}`, `project-docs/flows/areas.yaml`
- 읽을 것:
  - 계획 README "정한 것 › 명단", "경계"의 CLI 줄, "data", "위험 test", "lead가 할 일"
  - review `reports/multi-device/review-device-roster.md` 전부(F1~F13, "Docs and catalog pieces checked", "Not determined"의 첫 항목). `review-core-terminals.md` finding 10의 `remote.md:345`, `review-core-setup.md` finding 9의 `remote.md:55`
  - architecture: `project-docs/architecture/remote.md`의 명단 절(믿음 계산 규칙 1~6, "컴퓨터가 명단을 고치는 순서", 판 규칙 `:46-48`, `:302`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `remote-protocol`
  - 본보기(화면): `tools/wireframes/pages/screens/settings.tsx`의 `settings-remote-waiting`
- 계약:
  - 쓰는 것: `rosterView`, `checkInvited`, `mergeRoster`, `rosterFresh`(`packages/protocol/remote/roster.ts`), `createRoster`(`packages/core/remote/roster.ts`), `ctx.deviceKind`
  - 내놓는 것: `RosterView.removed[]`의 새 칸 `entry: RosterEntryBody | null`, 상수 `ROSTER_UNKNOWN_MAX = 512`, `roster/list` 출력 device의 새 칸 `disputed: boolean`, `REMOTE_PROTOCOL_VERSION = 4`·`REMOTE_PROTOCOL_MIN_VERSION = 4`. 폰(`packages/remote-client`)은 같은 `rosterView`를 쓰므로 고치지 않는다.

시작 전에 다시 볼 것: lead가 띄우기 전에 plan branch에 `machinesCall`·`machinesWatch` input의 `shell_capability` 칸을 계약 commit으로 넣는다(`fix-setup`이 쓴다). `routes.ts`의 그 두 route는 고치지 않는다.

## 할 일

명단 규칙(`packages/protocol/remote/roster.ts`). 모두 statement 집합과 root만으로 정해지고(받은 순서·시각을 보지 않는다) `rosterView(view.keep, roots)`가 같은 view를 내는 성질을 지킨다.

1. 쓰인 초대(F4, README "쓰인 초대장은 그것으로 든 기기를 빼도 쓰인 것이다"). `invites`(`used`)를 빼기 전 믿음으로 센다: T0(`t0.accepted`)이 받아들인 서명 항목 가운데 `invite !== null`인 것의 (invite, key)와, 초대 key 서명이 맞는 초대 서명 statement의 (invite key, key)다. 대상 key가 빠졌는지 보지 않는다(`invitedValid`의 `!excluded(...)`를 이 셈에서 뺀다). `conflictsOf`의 `invite` 묶음도 빠진 key의 T0 항목을 같이 센다: 빠진 key가 쓴 초대로 든 다른 key는 `invite` 충돌이다. `keep`은 빠진 key의 T0 항목이라도 `invite !== null`이면 (서명자, key, id, invite, 모양) 묶음마다 앞선 하나를 남긴다(지금은 컴퓨터 항목만 남긴다). 그래야 keep만으로 다시 계산해도 쓰인 초대가 남는다.
2. 빼기는 key로만 센다(F2). `Excluded`에서 `ids`를 지운다. 빼기가 빼는 것은 `body.key`와 `body.signing_key`뿐이다. 빼기 body의 `id` 칸은 schema에 남긴다(저장한 statement와 서명이 그 body를 덮는다). 대상의 id는 T0이 받아들인 그 key의 항목에서 얻는다(접기 규칙대로 가장 작은 id). `RosterView.removed`의 항목에 `entry`(그 key의 T0 이긴 항목, id는 접힌 id. 항목이 없으면 null)를 더한다. id가 필요한 곳은 모두 `entry?.id`를 쓴다: `keep`이 빠진 서명자의 statement를 버리는 검사(지금 `removedOut.ids.has(statement.by)`), `checkInvited`의 removed 검사(`r.id === body.id`), core의 `refusal`.
3. 모르는 서명자 상한(F3). `ROSTER_UNKNOWN_MAX = 512`를 더한다. keep에서 "믿음에 들지 않은 statement"를 따로 센다: T0이 받아들이지 않은 서명 statement(지금 line 704~710이 남기는 것)와, 초대장 서명자(`invite.body.by`)가 T0의 서명자가 아니거나 초대장 서명이 맞지 않는 초대 서명 statement다. 넘으면 canonical 글 순서로 앞선 512개만 남긴다. 믿는 statement, 빼기, 믿는 컴퓨터가 낸 초대장의 초대 서명 statement는 이 셈에 들지 않고 밀려나지 않는다. 이 상한이 `ROSTER_STATEMENTS_MAX`(4096) 안에 믿는 쪽 자리를 남긴다.
4. 엇갈린 빼기를 사람이 다시 뺀다(F1). core `createRoster().remove(id)`(`packages/core/remote/roster.ts:405`): `view.devices`에 없으면 `view.removed` 가운데 `settled: false`이고 `entry?.id === id`인 것을 찾아 그 key·서명 key로 이 컴퓨터가 빼기에 서명한다. root가 서명한 빼기라 이 view에서 처음부터 IN이고, 대상이 낸 빼기가 OUT이 되어 대상이 뺀 쪽이 돌아온다. 둘 다 없으면 지금처럼 `not_found`다.
5. "엇갈림"을 보인다. `routes.ts`의 `rosterList` 출력 device에 `disputed: boolean`을 더한다. `wiring/remote.ts`의 `list`는 `view.devices`(`disputed: false`) 뒤에 `settled: false`이고 `entry`가 있는 `view.removed`를 `disputed: true`로 싣는다(`pending: false`, `this: false`, 나머지 칸은 `entry`에서). 화면(`ui-design` skill): `my-devices.tsx`가 그 줄에 "Disputed" 표지와 한 줄 설명(두 컴퓨터가 서로 뺐다, 믿지 않는 쪽을 여기서 빼면 다른 쪽이 돌아온다)과 Remove만 보인다. 이름 바꾸기와 터미널 입력 toggle은 그 줄에 없다. `source.ts`의 `RemoteDevice`에 `disputed`, `core-source.ts`가 옮기고, `testdata/fake-source.ts`의 `sampleDevices`는 그대로 두고 gallery `settings-pages.tsx`에 `SettingsRemoteDisputed`를, `settings.tsx`에 page `settings-remote-disputed`를 더한다. 문구는 `workspace-settings.ts`의 key(`settings.label.remote-disputed`, `settings.note.remote-disputed`).
6. protocol 판(README "protocol 판을 올려 섞이지 않게 한다", `remote.md:302` "판을 올릴 때 하한도 같이"): `frames.ts`의 `REMOTE_PROTOCOL_VERSION`과 `REMOTE_PROTOCOL_MIN_VERSION`을 4로. `remote.md:46-48`의 판 문단에 "판 4는 명단 규칙(쓰인 초대, key로만 세는 빼기, 모르는 서명자 상한)이다. 판 3과 같은 명단을 다르게 보므로 섞이지 않는다"를 적는다. `packages/core/main/daemon/wiring/folder.ts:318`은 같은 상수를 실어 그대로 따른다(고치지 않는다).
7. 기기 id 모으기(F6, README "id를 모으는 고침은 다시 해도 같다"). `devices.ts`의 `rosterStoreCommand`가 `input.folds`의 쌍마다 `folded` 변경을 늘 낸다(행이 옮겨졌는지 보지 않는다). `wiring/remote.ts`의 `editScreens`는 고친 목록이 지금과 같으면 쓰지 않는다(저장마다 설정을 쓰지 않게). `screensFolded`가 `from`이 없는 목록을 그대로 돌려주는지 본다.
8. 폰 target 이름(F5, README "폰 target의 이름은 명단에서 온다"). `target.ts`의 `coalesce(alias, name)`을 지우고 기준 폰 행의 `public_key`로 `roster_statements`의 그 key 항목 가운데 이긴 것의 이름을 읽는다. 없으면 `devices.name`. `devices.ts`의 `entriesByKey`를 export해 같이 쓴다. `target_test.ts`가 `alias`를 넣지 않게 고친다.
9. 명단 CLI 거절(README "명단을 바꾸는 CLI 명령은 lophn의 터미널 탭 안에서 거절한다"). 먼저 확인한 것: 터미널 탭의 shell env는 host가 `LOPHN_*`를 지우고(`packages/core/terminals/host/env.ts:6`) `LOPHN_SESSION_ID=term:<trm_>`만 넣는다(`packages/core/terminals/host/main.ts:131`). 그래서 `LOPHN_AGENT_CREDENTIAL`·`LOPHN_AGENT_SHELL`이 없고 `openConnection`(`packages/cli/connection/core.ts:200`)이 사람 token(`ensureAndJoin`)을 쓴다. 그 탭의 coding agent도 같다. 그러니 만든다: `cliMain`(`packages/cli/main.ts`)이 env `SESSION_ENV_NAME`이 `TERMINAL_SESSION_PREFIX`(`packages/protocol/lophn-agent/session-tag.ts`)로 시작하고 명령이 `remote.invite`·`remote.join`·`remote.remove`이면 core에 붙기 전에 `forbidden`으로 끝낸다. 글은 Settings › Remote나 SSH 터미널에서 하라고 말한다. `remote.devices`와 `remote.on`은 된다. 이름 목록은 `remote.ts`가 export한다. agent가 env를 지우면 지나가는 실수 막기다(remote.md에 그렇게 적는다).
10. 확인한 뒤 고칠 것(PLAUSIBLE. 안 맞으면 하지 않고 보고에 적는다):
    - F12: 연결된 컴퓨터도 `roster/leave`를 부른다. `leave`(`wiring/remote.ts`)가 부른 기기의 kind가 `computer`이면 `forbidden`이다(컴퓨터는 빼기로만 나간다).
    - F9: 같은 `machine`을 든 key 둘. 충돌 묶음은 더하지 않는다: `roster/forget_all` 뒤 같은 기계가 새 key로 다시 들 때 옛 key가 아직 믿는 채이면 그 묶음이 다시 든 컴퓨터를 뺀다. `remote.md`에 "`machines/call`은 그 기계를 든 첫 key로 간다. 복제된 key와 같은 열린 것이다"를 적는다.
    - F13: `reach`가 서명되지 않아 붙은 기기가 다른 컴퓨터의 주소를 덮을 수 있다는 것이 `remote.md`에 없으면 한 문장 적는다. code는 고치지 않는다.
11. 옛 문구(F10): `mobile-app.ts`의 "Codes last five minutes", "A code works once, for five minutes"(초대장 수명은 30분과 7일), "Settings › Remote › Add a phone", "pair with a new code"; `packages/mobile/src/gallery/screens.tsx:126`과 `tools/wireframes/drafts/phone/start.tsx`의 "Enter a pairing code instead"와 다섯 분 문구; `packages/cli/commands/remote.ts:53,78`의 "Enter code on the phone"(폰의 실제 글 "Paste the invite instead"를 mobile 화면에서 확인해 쓴다); `apps/views/mod.ts:37`의 "desktop 기기"; `host_test.ts:574` test 이름과 `:602` 주석; `machine/identity.ts:68`의 "폰을 다시 pairing". 안 쓰는 export `RosterInvite`는 지운다. `readHostKeyMachine`(`core/remote/mod.ts:29`, test만 쓴다)은 보고에 적는다.
12. 문서(F8, F11과 다른 review의 `remote.md` 줄):
    - `remote.md`: `:43,71` "Enter a pairing code instead", `:43` 폰 명단은 secure store가 아니라 app file `roster.json`, `:156` 모으기가 저장마다 다시 한다(7의 결과), `:207-208` 엇갈린 빼기는 사람이 그 컴퓨터에서 다시 빼 푼다(4·5), 규칙 1~3의 새 문장, README "명단의 컴퓨터는 서로 대등하다"(컴퓨터 하나가 뚫리면 명단 전체가 뚫린 것으로 본다. 컴퓨터의 터미널 입력 허락은 정직한 code에만 묶이고 폰의 허락은 폰이 서명하지 못해 지켜진다), `machines/call|watch`는 shell main이 받은 capability가 있어야 한다(`fix-setup`), `:55` 다른 기기의 loopback 로그인은 core가 거절한다(`fix-setup`), `:345` 지운 fake coding host와 `terminal_view/open`.
    - `settings.md:50`("Computers you view"와 shell의 기계 목록 file), `phone-screen.md:36`(별명과 kind desktop), `packages/mobile/README.md:64,73,93`(옛 단추 글).
13. flows(`flows` skill): `core-platform.yaml`의 `roster-list`(disputed 줄), `roster-remove`(엇갈린 key 빼기), `roster-commit`(모르는 서명자 상한, 모으기 다시 하기), hello 판 줄. `cli.yaml`의 `remote-join-command`와 `cli:remote.invite`·`cli:remote.remove`에 터미널 탭 거절 outcome. `app-runtime.yaml`의 `apps/phone_target` 이름 줄. 낡은 줄: `sessions.yaml:1916`("kind desktop 기기"), `areas.yaml:458`("컴퓨터 지우고 다시 pairing").

정한 것:
- 모르는 statement 상한은 512이고 canonical 글 순서로 앞선 것을 남긴다: 받은 순서와 상관없이 모든 기계가 같은 것을 남기고, 밀려난 정직한 statement는 그 출처가 link나 폰으로 다시 보낸다.
- 빼기 body의 `id` 칸은 지우지 않는다: 저장된 빼기 statement가 strict schema에 걸려 빼기를 잃는다.
- 엇갈린 줄은 `roster/list`의 `devices`에 칸 하나로 싣는다: 새 route 없이 Remove가 같은 `roster/remove {id}`를 쓴다.

## 끝남

- `npm run check`가 통과한다. `node packages/shell/renderer/build.ts`가 된다. `cd packages/mobile && npm ci && npm run typecheck && npm test`가 통과한다.
- `npm run wireframes`가 되고 gallery의 `settings-remote-disputed`가 renderer component로 그려진다.
- 위험 test(`packages/protocol/remote/roster_test.ts`, 순수 함수):
  - "쓰인 초대장으로 든 기기를 뺀 뒤에도 그 초대장으로 다른 key가 들지 못한다"(`checkInvited`가 `used`. view와 `rosterView(view.keep)` 둘 다)
  - "남의 id를 실은 빼기가 그 id의 기기를 지우지 못한다"(`{id: Y의 id, key: X}` 빼기로 Y가 남는다. Y를 root로 본 view와 bystander view)
  - "모르는 서명자의 항목이 상한에 닿아도 빼기가 저장된다"(모르는 statement 수천 개와 빼기 하나를 합친 keep에 빼기와 믿는 항목이 다 있고 모르는 것은 512개, keep은 4096 이하)
  - "엇갈린 빼기에 걸린 key를 사람이 다시 빼면 빠진 쪽만 남고 뺀 쪽이 돌아온다". 지금 "빠진 뒤의 빼기" 줄(`roster_test.ts:480-487`, root Y에서 `gone: [x, r]`을 맞다고 박은 것)은 남기지 않고 이 test로 다시 쓴다: 다시 빼기 전 Y의 view에서 X와 R이 `settled: false`이고 `entry`가 있다. Y가 R의 빼기에 서명한 뒤 `gone: [r]`, 모두 settled다.
- 위험 test(`packages/core/main/daemon/wiring/remote_test.ts`): "폰 하나에 id가 둘이던 data root에서 id를 모은 뒤 `app_sync_log`와 `shell.devices`가 같은 id를 가리킨다". 기기 행과 sync log가 이미 옮겨진 뒤(행이 바뀌지 않는) 저장도 `shell.devices`를 고친다.
- subprocess·server를 띄우는 test와 E2E를 새로 만들지 않는다(실제 컴퓨터 둘과 폰은 lead가 사람에게 부탁한다).
- 남지 않음: `grep -rn --exclude-dir=dist "coalesce(alias, name)\|Enter a pairing code instead\|Enter code on the phone\|Codes last five minutes\|for five minutes" packages tools tests project-docs/architecture`가 0줄이다.
- merge 전에 lead가 다른 worker(opus) 하나에게 규칙 review를 맡긴다(README "lead가 할 일").

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, gallery `pages/index.ts`, `package.json`). `boundary-catalog.yaml`의 `remote-protocol`(판 4, `core`의 `depends_on`에 `remote-client`, `:189`의 shell 의존)과 tests yaml의 covers 줄(`remote_test.ts`, `roster_test.ts`)도 여기 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
