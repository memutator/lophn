# mobile-local-apps: 사람의 앱이 폰에서 컴퓨터 없이 돌고, data가 컴퓨터와 맞춰진다

- 목표: roadmap 단계 7. 앱 선언의 `runs_on` 하나로 앱이 어디서 도는지 정한다: `["computer"]`(remote, 단계 6), `["computer","phone"]`(sync), `["phone"]`(standalone). `phone`이 든 앱은 release 준비가 backend를 plain JS 한 file로 묶고, 폰 앱이 그것을 그 앱 화면의 guest runtime 안에서 폰의 SQLite로 돌린다. sync 앱은 컴퓨터가 hub인 sync log로 column 단위 last-write-wins로 맞추고, 폰에서 한 write는 컴퓨터에 닿을 때 invocation이 되어 Activity와 rewind에 든다.
- 재료: `project-docs/products/roadmap/mobile.md`("폰에서 혼자 도는 앱", "단계", "진행"의 "조사 뒤 planner가 정한 것"), spike 보고서 `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-spike.md`(emulator debug·release build에서 실제로 돈 것과 판정. 그림은 같은 폴더), 조사 `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md`(사실, 설계, 계약. 아래 "정한 것"이 다르면 "정한 것"이 이긴다, 그다음 spike, 그다음 조사), spike 코드(버릴 코드, 읽기만) `/home/pyosechang/projects/lophn-worktrees/spike-local-apps`(branch `spike/local-apps`): sync core 원형 `mobile/guest/sync/`(Node와 폰에서 같이 도는 TS), native module `mobile/modules/lophn-app-db/`, backend bundle과 guest 싣기 `mobile/guest/local/`. `project-docs/architecture/{app-call,activation,remote,event}.md`, wireframe `tools/wireframes/drafts/phone/{apps,shell}.tsx`(Calendar, offline 안내). 먼저 도는 계획(`mobile-app`, `mobile-user-apps`, `mobile-push`, `mobile-coding-agents`, `mobile-widgets`)의 README와 `tasks/`(lead worktree `.claude/worktrees/plan-<계획>`).
- 범위 밖: iOS(아래 "사람이 할 것"), core가 Hermes bytecode를 만들기(backend가 커서 느리면 쓰는 fallback이다. 아래 "정한 것"), 컴퓨터가 꺼진 동안 relay가 변경을 맡아 두기(그래서 컴퓨터가 꺼진 동안 두 폰끼리는 맞춰지지 않는다), 충돌을 보이는 화면, background sync(폰 앱이 앞에 있고 컴퓨터에 닿은 동안만 맞춘다), 폰에서 도는 앱의 위젯·홈 화면 아이콘·폰 기능(`@lophn/cap-phone`), 폰에서 network·secret·알림·event 발행·command·agent·job, standalone 앱 data의 backup.
- 단위: `sync`(sync core, 컴퓨터 app runtime, ledger의 sync log), `sdk`(SDK 판, 선언 `runs_on`, agent 지침), `phone-backend`(backend bundle build·검사, release 준비에 걸기), `phone-host`(폰 gate, native SQLite module, guest의 backend runtime, 폰 sync host, 화면). 소유 path는 brief가 정한다.
- 순서(wave는 "앞 wave가 모두 merged"일 때 열린다. 다른 계획의 land를 기다리는 task는 brief "선행"의 둘째 문장이 적었다):
  - wave 1(지금): `mobile-sync-core`, `mobile-local-sdk`.
  - wave 2(지금): `mobile-sync-runtime`, `mobile-local-build`.
  - wave 3(지금): `mobile-sync-ledger`.
  - **여기까지는 다른 계획의 land를 기다리지 않는다**(`packages/mobile`, `packages/design/native`, `packages/protocol/remote/**`, `packages/core/remote/**`, 선언 file, 단계 6 `mobile-build-phone`의 release 준비 file, 앱 template을 건드리지 않는다).
  - **중간 land 한 번**: `mobile-app`과 `mobile-user-apps`가 main에 land된 뒤, wave 4를 띄우기 전에 wave 1~3을 `land.sh`로 올린다(orchestrate "merge"의 "main에서 같은 file을 고치는 다른 계획". wave 4부터는 그 두 계획의 code 위에서 일한다). land 전에 lead가 template pin을 맞춘다(아래 "lead가 할 일").
  - wave 4: `mobile-local-decl`, `mobile-local-db-native`(서로 path가 겹치지 않는다).
  - wave 5: `mobile-local-prepare`, `mobile-local-runtime-phone`, 그리고 `mobile-local-prepare` 뒤에 `mobile-local-gate`(`apps/phone_file`을 연다).
  - wave 6: `mobile-local-sync-phone`.
  - wave 7: `mobile-local-screens`, `mobile-local-guidance`.
  - 마지막 land는 계획 끝에 한 번.

## 정한 것

- (planner) 선언 칸 `runs_on` 하나: `["computer"]`(없을 때의 기본, remote), `["computer","phone"]`(sync), `["phone"]`(standalone). `@lophn/declaration` 4.8.0(4.6.0은 단계 6, 4.7.0은 `mobile-widgets`). SDK는 cap-tool 2.2.0, cap-problem 1.1.0, cap-store 2.0.0(SDK가 정한 `StoreDb`, 인자 없는 `migrate()`, `newId`), app-ui와 app-ui-native는 declaration pin을 따라 올린다. 메모·Instruction diff·pin은 `.claude/skills/sdk-note`대로. **land 순서가 이 가정(4.6.0 → 4.7.0 → 4.8.0)과 다르면 lead가 land 때 판을 다시 매긴다**(메모 file 이름, `Previous:`, pin).
- (planner) 폰의 backend는 그 앱 화면의 guest runtime 안에서 돈다(`base|backend|screen`). read와 write operation은 컴퓨터에 닿을 때도 늘 폰에서 돈다. `external` operation은 outbox를 먼저 push한 뒤 컴퓨터로 가고, 컴퓨터가 없으면 `unavailable`이다. sync 일(clock, outbox, 들어온 변경 적용, migration, snapshot, backup)은 모두 신뢰된 폰 host가 한다.
- (planner) 폰의 SQLite는 우리 작은 native module(C++ JSI, spike의 `lophn-app-db`)이고 host와 guest가 같은 file에 같은 library로 쓴다. expo-sqlite는 쓰지 않는다. guest의 연결은 host가 file 하나에 묶고, authorizer가 ATTACH, VACUUM INTO, extension 싣기, 숨은 `lophn_sync_*` 표 접근을 거절한다. Android만 한다. iOS는 task가 없다.
- (planner) sync model: 컴퓨터가 hub이고 ledger에 순서 있는 sync log가 있다. 폰은 자기 cursor를 쥐고 relay는 아무것도 맡지 않는다. 충돌은 column 단위로 나중 것이 이기고 delete가 이긴다. spike의 고침을 따른다: clock 표는 (table, primary key)마다 한 줄(정수 row clock)과, insert 뒤에 바뀐 column만의 column clock이다. delete 표지는 그 row의 마지막 insert나 delete를 쥐고 delete는 그보다 새로울 때만 적용된다. clock 찍기와 write는 한 transaction이고, 들어온 변경은 guest 호출 사이에만 적용되고 호출 도중에는 적용되지 않는다. 들어온 변경은 `applyChangeset`이 아니라 만든 SQL로 적용한다. sync core는 plain TS module 하나이고 컴퓨터의 app runtime과 폰 host가 같이 쓴다(spike 원형과 그 수렴 사례 11개에서 시작하고, 그것이 위험 test가 된다).
- (planner) 폰에서 한 write는 맞출 때 컴퓨터에서 invocation이 된다(operation 이름, 기기가 붙은 caller, 폰의 시작 시각, 실제로 적용된(effective) changeset). 그래서 컴퓨터의 Activity와 rewind가 덮는다. rewind는 자기 효과를 sync log에 남겨 폰이 받는다. 처음 설치와 release가 바뀔 때마다 컴퓨터 DB의 snapshot을 쓴다. release가 바뀔 때 안 보낸 변경이 있으면 폰이 backup을 뜨고, release의 migration file로 host migrator가 local migration을 돌리고(migration SQL은 앱 code bundle에 넣지 않는다), 남은 변경을 table과 column 이름으로 다시 표현해 새 snapshot 위에 적용하고 push한다.
- (planner) `runs_on`에 `phone`이 있으면 release 검사: 폰 bundle에 `node:` import가 없다, bundle이 빈 context에서 실리고 선언한 handler를 정확히 등록한다, 정수·autoincrement primary key가 없다, trigger가 없다, SDK 하한.
- (planner) 폰 backend bundle은 release 준비 때 core가 만드는 plain JS다(단계 6이 화면에 쓰는 esbuild 설정과 같다). core는 Hermes bytecode를 만들지 않는다: 실제 크기 backend(약 20 KB)는 release build에서 55~139 ms에 시작했고 200 KB는 machine 부하 아래에서만 300 ms를 넘었다. **실제 backend가 크게 나오면 bytecode가 fallback이다**(폰 앱의 Hermes와 맞는 `hermesc`를 core가 든다. spike: 200 KB bytecode 83~129 ms).
- (planner) standalone 앱은 폰에 내놓고 "Only on this phone · not backed up"으로 표시한다. sync 앱은 승인된 wireframe대로 "On this phone · synced <time>"(main의 `tools/wireframes/drafts/phone/apps.tsx`, `shell.tsx`). last-write-wins는 말없이 한다(충돌 화면 없음). 폰의 앱 data는 outbox에 안 보낸 변경이 있는 동안 지우지 않고, standalone 앱의 data는 자동으로 지우지 않는다.
- (planner) 폰에서 컴퓨터 전용 기능(network, secret, 알림, event, command, agent, job)은 `unavailable`이다. 지침이 agent에게 그것을 `external` operation에 두라고 한다.
- (planner) spike가 찾은 단계 6의 고칠 것(guest→host 메시지 합쳐짐, R8 keep 규칙, 같은 origin으로 다시 mount, guest 단추의 손가락 누름)은 단계 6 brief `mobile-phone-guest`에 이미 적혀 있다. 이 계획은 다시 적지 않고, guest를 만지는 task는 그 task가 land된 뒤다.
- worker는 `sonnet-high`다. 어려운 task(`mobile-sync-core`, `mobile-sync-runtime`, `mobile-sync-ledger`, `mobile-local-db-native`, `mobile-local-runtime-phone`, `mobile-local-sync-phone`)는 opus high다(planner). brief 머리에 적었다.
- (agent) 위 결정이 정하지 않아 brief를 쓰며 정한 것:
  - **"clock 찍기와 write는 한 transaction"의 폰 쪽 꼴.** host와 guest는 연결이 따로라 한 SQLite transaction을 나눌 수 없다. 그래서 guest의 base가 local 호출마다 연결에 `BEGIN IMMEDIATE`를 걸고, 호출이 끝나면 native module이 그 호출의 changeset을 같은 transaction 안에서 숨은 `lophn_sync_outbox`에 한 줄로 쓰고 commit한다(C++ 안의 일이라 guest의 JS는 그 표에 닿지 못한다). host는 들어온 변경을 적용하는 자기 transaction의 맨 앞과 push 앞에서 아직 clock이 없는 outbox 줄에 clock을 찍는다. 그래서 write와 그 변경 기록은 늘 같이 commit되고(잃지 않는다), 들어온 변경은 늘 찍힌 clock과 비교된다(spike가 짚은 경합이 없다). 컴퓨터 쪽은 runtime이 같은 연결을 쥐어 write, changeset, clock 찍기를 말 그대로 한 transaction에서 한다. 그래서 cap-store 2.0.0의 `transaction()`은 SAVEPOINT로 바뀐다(바깥 transaction 안에서도 된다).
  - sync core는 `packages/protocol/apps/sync/`에 둔다. 폰 앱은 Metro로 `packages/protocol`을 바로 읽고(단계 6 `phone-screen.ts`와 같다), app process의 entrypoint도 protocol을 상대 path로 읽는다. zod를 쓰지 않는다.
  - 폰 backend가 기대는 host(handler port, `CAP_HOST`, random)를 깔아 주는 prelude는 file 하나(`packages/protocol/apps/phone-backend-host.ts`)이고, release 준비의 load 검사와 폰의 guest base가 같이 쓴다. 그래서 "빈 context에서 실린다"는 검사가 폰과 같은 host를 본다.
  - load 검사는 release 준비가 `eval-declaration`처럼 따로 띄운 짧은 child process 안에서 `node:vm`의 빈 context로 한다. core process 안에서 앱 code를 돌리지 않는다.
  - 폰 schema 검사(정수 PK, AUTOINCREMENT, trigger)는 새 file에 둔다. `migration-sql.ts`는 cap-store 사본에 vendor되어 있어 고치면 cap-store bytes가 바뀐다.
  - 폰에서 온 변경의 invocation: effect는 `write`(read가 쓴 변경도 그렇게 남긴다. invocation 표는 read에 changeset을 받지 않는다), caller는 `{kind: "person", view_session: <폰 변경 id>, device: <기기 id>}`. 새 caller kind를 만들지 않아 ledger schema step이 없다.
  - `["phone"]`은 `commands`, `subscriptions`, `external` operation, 폰 밖 자리, `widgets`를 선언할 수 없다(live에서 그것을 돌릴 곳이 없다).
  - release가 바뀌며 migration이 지운 column·table의 안 보낸 변경은 말없이 버린다(그 migration의 `-- loss:` 줄을 사람이 activation 때 이미 봤다). 조사의 "N changes could not be carried" 상태는 짓지 않는다.
  - 컴퓨터가 write를 commit한 뒤 sync log에 줄을 쓰기 전에 core가 죽으면 그 변경은 폰에 가지 않는다(다음 snapshot까지). 이 계획은 막지 않고 `mobile-sync-ledger`가 이슈로 보고한다.

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `mobile-sync-core` | (opus high) sync core: changeset 읽기(rewind와 같이), 정수 HLC, row·column clock 표, outbox, column 단위 LWW를 SQL로 적용, 이름으로 다시 표현, host migrator. 수렴 위험 test |
| 1 | `mobile-local-sdk` | cap-tool 2.2.0·cap-problem 1.1.0(폰 entry), cap-store 2.0.0(`StoreDb`, driver, 인자 없는 `migrate()`, `newId`, SAVEPOINT, `lophn_sync_*` 빼기), runtime이 주는 migration, 메모 셋 |
| 2 | `mobile-sync-runtime` | (opus high) 컴퓨터 app process: sync 앱의 write를 한 transaction으로 찍기, `apps.sync_apply`(effective changeset), `apps.snapshot`, rewind 적용의 effective와 clock |
| 2 | `mobile-local-build` | 폰 backend bundle build, manifest `backend.json`, 빈 context load 검사, 폰 schema 검사(아직 준비에 걸지 않는다), 공용 host prelude |
| 3 | `mobile-sync-ledger` | (opus high) ledger `app_sync_log`, `app_sync/{push,pull,snapshot,snapshot_file}`, `AppSyncChanged`, 컴퓨터 write와 rewind를 log에, activation·삭제 때 정리 |
| 4 | `mobile-local-decl` | `runs_on`과 검사, `@lophn/declaration` 다음 minor(계획대로면 4.8.0), app-ui·app-ui-native, 메모와 pin. 중간 land 뒤 |
| 4 | `mobile-local-db-native` | (opus high) native module `lophn-app-db`(C++ JSI SQLite, session, guest 묶기와 authorizer, outbox commit), config plugin, R8 규칙. emulator 5622. 중간 land 뒤 |
| 5 | `mobile-local-prepare` | release 준비에 폰 backend build·검사·SDK 하한을 걸고, `apps/phone_screens`에 `runs_on`·`backend`, `apps/phone_file` |
| 5 | `mobile-local-gate` | 폰 allowlist에 `app_sync/*`, `apps/phone_file`, event `AppSyncChanged`(`mobile-local-prepare` 뒤) |
| 5 | `mobile-local-runtime-phone` | (opus high) guest base의 backend prelude, effect로 가르는 `callOperation`, 호출마다 transaction과 outbox, `PHONE_BASE_FORMAT` 2. emulator 5624 |
| 6 | `mobile-local-sync-phone` | (opus high) 폰 host sync: snapshot 설치, clock 찍기와 push, pull과 적용, release 바뀜(backup, migrate, 다시 표현), external 앞 push, 지우기 규칙, standalone, 앱 화면에 싣기. emulator 5626 |
| 7 | `mobile-local-screens` | 폰 앱 목록과 앱 위 줄의 "On this phone · synced <time>"·"Only on this phone · not backed up", offline 안내, 맞추지 못함 상태. emulator 5628 |
| 7 | `mobile-local-guidance` | `design-app`의 "Apps that run on the phone", template `AGENTS.md.tmpl`, SDK guide, 메모의 Instruction diff |

## 돌리기 전에

- 지금 띄워도 되는 것은 wave 1~3이다. wave 4 이후는 중간 land 뒤다. `status.py ready`는 다른 계획의 land를 모르니 lead가 띄우기 전에 main에 그 commit이 있는지 본다.
- 다른 계획과 같은 file을 만지는 곳(brief가 한 줄씩 허락했다. lead가 합칠 때 두 쪽을 다 남긴다):
  - `packages/protocol/events/transient.ts`(`mobile-sync-ledger`의 `AppSyncChanged`. `mobile-push`의 `mobile-attention-core`가 이 file을 소유했고 다른 계획도 event를 더한다. 더하기뿐이다).
  - `packages/protocol/apps/{mod,registry}.ts`, `packages/core/apps/register.ts`, `packages/core/main/daemon/wiring/apps.ts`, `packages/core/main/app-supervisor/assembly.ts`, `packages/core/apps/releases/activation/assembly.ts`, `package-lock.json`, `project-docs/flows/`.
  - ledger schema step(`mobile-sync-ledger`): AGENTS.md대로 WIRINGS 맨 뒤 wiring의 `schemaStepsAfterTeams` 끝과 `packages/core/storage/migration/schema-steps.lock.json` 끝. 지금 맨 뒤는 `remoteWiring`(`wiring/remote.ts`)이고 `mobile-push-device`, `mobile-terminal-device-grant`, `mobile-phone-use-grant`도 거기에 step을 붙인다. land 때 lock의 순서가 main의 순서와 맞도록 lead가 이 계획의 step을 끝으로 옮긴다.
  - 선언 file과 template pin: `mobile-widgets`의 `mobile-widgets-decl`이 같은 file을 소유한다. 그 task가 running이면 `mobile-local-decl`을 띄우지 않는다(`status.py ready`가 막는다).
  - `packages/core/agent-workspaces/skills/design-app/SKILL.md`와 SDK guide: `mobile-user-apps`의 `mobile-agent-guidance`, `mobile-widgets`의 `mobile-widgets-guidance`가 고친다. `mobile-local-guidance`는 main에 있는 것 위에 쓰고, 그 두 task가 running이면 띄우지 않는다.
  - `packages/mobile/{package.json,package-lock.json,app.json}`: `mobile-widgets`의 native task들이 고친다. 겹치면 하나가 끝난 뒤 다른 것을 띄운다(`status.py ready`가 막는다).
- `packages/mobile/src/apps`, `src/screens/apps`, `src/screens/home`의 실제 file 이름은 `mobile-app`·`mobile-user-apps` land 뒤에 lead가 보고 `mobile-local-sync-phone`·`mobile-local-screens` brief를 맞춘다.
- lead가 `mobile-local-screens` 전에 `packages/design/i18n/catalog/mobile-local-apps.ts`를 빈 file로 만들어 `packages/design/i18n/en.ts`에 올린다(`mobile-app`과 같은 길).
- `mobile-local-db-native` merge 뒤 lead가 plan branch에서 dev build(x86_64)를 한 번 지어 `/tmp/lophn-mobile-local-apps-x86_64.apk`에 두고 `mobile-local-runtime-phone`·`mobile-local-sync-phone`·`mobile-local-screens` worker에게 알린다(native module을 더하는 task가 다시 지으면 다시 알린다).
- emulator: 이 계획의 port는 5622~5630(Metro 8262~8270)이다. `mobile-local-db-native` 5622·8262, `mobile-local-runtime-phone` 5624·8264, `mobile-local-sync-phone` 5626·8266, `mobile-local-screens` 5628·8268. AVD `lophn-phone`을 `-read-only -memory 2048 -port <port>`로 띄우고 모든 adb 명령에 `-s emulator-<port>`를 붙이고 끝나면 `adb -s emulator-<port> emu kill`로 끈다. gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m" --max-workers=3`. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일은 하지 않는다. 사람의 실제 폰(serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다.
- 개발 core는 `packages/mobile/README.md`의 `tools/remote-dev.ts` 길(direct)이다. 사람의 `~/.lophn`, 실제 relay(`wss://lophn-relay.fly.dev`), 실제 model provider를 쓰지 않는다. sync·standalone 앱은 worker가 손으로 쓴 작은 앱(`tests/support/app/` 꼴)이다.

## 사람이 할 것

- iOS: 내려받은 backend code를 기기에서 local DB와 같이 돌리는 것은 단계 6의 화면보다 Apple 지침 2.5.2(내려받은 code로 앱 기능을 바꾸기)와 4.7.2(내려받은 code에 native API를 내주기)에 더 강하게 걸린다. iOS 계획을 열기 전에 사람이 App Review pre-submission이나 developer support로 물어야 한다. Apple Developer 계정(연 $99)과 Mac이나 cloud build도 든다. 이 계획은 Android만 짓는다.
- 실제 폰에서 처음 확인하려면 사람이 dev build를 실제 폰에 깔아야 한다. 깔기 전에 planner가 사람에게 묻는다.
- 계정과 key는 들지 않는다.

## lead가 할 일

- merge 때마다: `npm run check`. `packages/mobile`을 고친 task는 `cd packages/mobile && npm run typecheck && npm test`도. 화면 task는 worker가 남긴 emulator 그림(`.dev-data/<id>/shots/`)을 wireframe 그림과 대조한다. 공유 줄은 보고의 "등록할 것"·"넘길 줄"대로 합친다.
- `mobile-sync-ledger` merge 뒤: schema step을 맨 뒤 wiring과 lock 끝에 등록했는지 보고, 개발 core를 두 번 띄워(`boot.sh`) step이 걸리는지 본다. 보고의 "core가 죽으면 log 줄을 잃는다" 이슈를 `issue` skill로 올린다.
- 중간 land 전(`mobile-app`·`mobile-user-apps` land 뒤): template pin을 새 SDK 판으로 고치는 commit을 lead가 쓴다. `packages/core/apps/packages/template/app/{package.json.tmpl,lophn.ts.tmpl}`와 `tests/support/app/sample/lophn.ts.tmpl`의 `@lophn/cap-problem` 1.1.0, `@lophn/cap-store` 2.0.0, `@lophn/cap-tool` 2.2.0 줄(`sdk-note` 2의 grep으로 빠진 곳이 없는지 본다). 이 줄들은 단계 6과 `mobile-widgets`가 고치는 declaration·app-ui 줄 바로 옆이라 wave 1~3에 넣지 않았다. 그 뒤 `land.sh mobile-local-apps`로 wave 1~3을 올린다(change-log 항목은 마지막 land에 넣는다).
- 끝에: 새 `project-docs/architecture/app-sync.md`를 쓴다. 문제(폰에서 컴퓨터 없이 도는 앱과 두 사본), 모델(`runs_on` 셋, backend bundle과 guest 안의 backend, native SQLite와 guest 묶기, hub와 순서 있는 sync log와 폰 cursor, row·column clock과 column 단위 LWW와 delete 규칙, outbox와 "write와 변경 기록은 한 transaction", 폰 write가 invocation이 되는 길과 rewind, snapshot과 release 바뀜의 다시 표현, external의 길), 지키는 것(read·write는 늘 local, sync 일은 신뢰된 host에만, guest는 묶인 file 하나와 숨은 표 금지, 안 보낸 변경이 있는 data는 지우지 않는다, relay는 맡지 않는다, 같은 release끼리만 맞춘다), 결정(expo-sqlite를 버림, 행 단위 clock을 버림, `applyChangeset`을 버림, bytecode를 fallback으로, 충돌 화면 없음). 같이 고친다: `architecture/app-call.md`("모든 호출은 core를 지난다"를 "모든 호출은 core가 기록한다. 폰의 local 호출은 맞출 때 기록된다"로, `runs_on`, 폰 caller의 `device`), `remote.md`(`app_sync/*`, `apps/phone_file`, `AppSyncChanged`, 폰의 앱 data 폴더), `activation.md`(폰 release 검사, activation 때 sync log 정리, standalone은 컴퓨터 data가 없다), `boundary-catalog.yaml`·`module-catalog.yaml`(`protocol/apps/sync`, `core/apps/sync`, `core/apps/releases/phone-backend`, `mobile/modules/lophn-app-db`), `project-docs/flows/`(`flows` skill로 마지막 대조), roadmap `mobile.md`(단계 7 끝남, "폰에서 혼자 도는 앱"의 행 단위 서술을 column 단위로), `packages/mobile/README.md`(native module, 앱 data 폴더, sync 확인 길), `sdk-note`(declaration, app-ui, app-ui-native, cap-tool, cap-problem, cap-store의 판과 `supported_from`), change-log `0.23/mobile-local-apps.yaml`(Android만, 실제 폰 확인 전, bytecode는 fallback, 두 폰은 컴퓨터를 거쳐서만 맞는다), 이슈 정리(`wrap-plan`). 실제 폰에 새 build를 까는 것은 사람에게 묻는다.
