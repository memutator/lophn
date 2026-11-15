# mobile-local-sync-phone

**opus high.** 폰 host의 sync를 짓는다: 폰에서 도는 앱을 처음 설치하고(backend와 migration file, sync 앱은 컴퓨터 DB의 snapshot, standalone 앱은 빈 DB에서 local migration), local 호출이 남긴 outbox에 clock을 찍어 컴퓨터로 push하고, 컴퓨터의 sync log를 pull해 last-write-wins로 적용하고, release가 바뀌면 backup·local migration·다시 표현·snapshot으로 넘어가고, external 호출 앞에 outbox를 먼저 보내고, 앱 data를 지우는 규칙을 지킨다. 그리고 앱 화면이 폰에서 도는 앱을 컴퓨터 없이 연다. 모든 sync 일은 신뢰된 host(폰 앱의 주 runtime)가 native module의 host 연결로 한다.

- 단위: phone-host (wave 6)
- 선행: mobile-local-runtime-phone, mobile-local-gate, mobile-local-prepare, mobile-sync-ledger, mobile-sync-core. 중간 land 뒤다(선행이 그 뒤라서)
- 소유(이 task만 고친다). `packages/mobile/src/screens/apps`와 그 아래 file 이름은 단계 6 land 뒤 lead가 실제 이름으로 맞춘다:
  - `packages/mobile/src/apps/local`(새 폴더: 설치, 앱 폴더와 file, sync loop, release 바뀜, external 앞 push, 지우기, test)
  - `packages/mobile/src/data/{local-apps,local-apps.test}.ts`(새 file)
  - `packages/mobile/src/screens/apps`(폰에서 도는 앱을 여는 길: `GuestScreen`에 `appDb`·`backendFile`·`local`·`onLocalChange`를 주고 external을 host의 길로 보내는 만큼)
- 공유 줄 허락(한 줄, 보고의 "넘길 줄"에): `packages/mobile/src/data/mod.ts`(`local-apps.ts` 내보내기)
- 읽을 것:
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md` 2(c) 전부(특히 "Transport", "External operations", "First install and snapshots", "Release change", "What is stored where, and pruning"), 6의 위험 test 2·5
  - spike: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-spike.md`의 "File write returned early"(snapshot을 열기 전에 크기와 sha256을 확인한다), "Check 3"·"Check 5"(1,000 변경 적용 51~54 ms)
  - 계획 `README.md` "정한 것"(read·write는 늘 local, outbox와 찍기의 순서, 지우지 않는 규칙, release 바뀜, 말없는 LWW)
  - sync core: `packages/protocol/apps/sync/mod.ts`(`ensureSyncTables`, `Clock`, `stampOutbox`·`applyRemote`(또는 `applyIncoming`), `adoptSnapshot`, `reexpress`, `migrate`)
  - route: `packages/protocol/apps/app-sync.ts`(`push`, `pull`, `snapshot`, `snapshot_file`, 오류 갈래와 `conflict`의 `active_release`), `packages/protocol/apps/phone.ts`(`apps/phone_screens`의 `runs_on`·`backend`, `apps/phone_file`), event `AppSyncChanged`, 단계 6의 `app_views/*`
  - 폰: `packages/mobile/modules/lophn-app-db/index.ts`(host `bind`·`openHost`·`session`), `packages/mobile/src/apps/guest/mod.ts`(`GuestScreen`의 새 props와 `mobile-local-runtime-phone` 보고), 단계 6의 앱 화면(`packages/mobile/src/screens/apps`, `packages/mobile/src/apps`의 bundle cache와 view 열기, `mobile-phone-apps` 보고), `packages/mobile/src/data/{link.ts,mod.ts}`(컴퓨터마다 `CoreSource`, 연결 상태, 앱이 앞인지), 기기 id(pairing store), `@noble/hashes`(sha256)
  - 개발 core와 fixture: `packages/mobile/README.md`의 `tools/remote-dev.ts`, `tests/support/app/local`(sync fixture)
- 계약:
  - 쓰는 것: 위 route·event, sync core, native host API, `GuestScreen` props
  - 내놓는 것(`packages/mobile/src/data/local-apps.ts`. `mobile-local-screens`가 이것만 쓴다): 컴퓨터마다 설치된 폰에서 도는 앱의 목록과 상태 `{app, name, icon, kind: "sync" | "standalone", release, last_synced_at: string | null, pending: number, state: "ready" | "installing" | "syncing" | "failed", failure?: string}`, `syncNow(app)`, 설치 시작

## 할 일

1. 앱 폴더(`src/apps/local/`): 컴퓨터와 앱마다 `files/apps/<computer>/<app>/`에 `app.sqlite`(data, clock, outbox), `release/<rel>/{backend.js, backend.json, migrations/}`, release 바뀜의 backup `app.before-<rel>.sqlite`. 설치된 앱의 목록은 그 폴더 안 작은 JSON(어느 release, kind, 마지막 맞춘 시각). 받은 file은 크기와 sha256을 manifest와 대조한 뒤에만 쓴다(spike: file 쓰기가 일찍 돌아왔다. 다 써진 것을 확인한 뒤 연다).
2. 처음 설치: `apps/phone_screens`의 항목이 `runs_on`에 `phone`을 가지면 `apps/phone_file`로 `backend.js`·`backend.json`·migration file을 받는다. sync 앱은 `app_sync/snapshot` → `snapshot_file`을 8 MiB씩 → sha256 확인 → `adoptSnapshot`(node는 기기 id, cursor는 snapshot의 seq). standalone은 빈 DB를 만들고 sync core `migrate`로 0에서 `data_schema`까지 올린다. 둘 다 `ensureSyncTables`.
3. sync loop(sync 앱, 폰 앱이 앞에 있고 그 컴퓨터에 닿은 동안만): 계기는 `onLocalChange`, 연결됨, `AppSyncChanged`, push 뒤, `syncNow`. push: host transaction 하나로 `stampOutbox` → outbox의 줄을 256개씩 `app_sync/push` → `applied`·`duplicate`인 줄만 지운다(답을 받지 못한 줄은 남는다). pull: `after = cursor`로 `more`가 false일 때까지, 받은 묶음마다 host transaction 하나로 찍기 먼저 그다음 적용(sync core가 정한 순서) → cursor를 같은 transaction에서 올린다. guest 호출은 transaction이 끝날 때까지 기다린다(`busy_timeout`). 
4. release 바뀜(`conflict`의 `active_release`, `apps/phone_screens`의 새 release, `snapshot_needed`): 화면의 guest를 내린다 → `app.sqlite`를 backup → outbox가 비었으면 새 release의 file과 snapshot으로 바꾸고 끝. 비지 않았으면 새 release의 migration으로 local migrate → `reexpress`로 남은 변경을 새 snapshot 위에 다시 표현 → file을 바꿔치고 push. 어느 단계든 실패하면 backup으로 되돌리고 outbox를 그대로 두고 실패 상태로 둔다(다음 계기에 다시 한다). backup은 새 release에서 처음 push가 성공할 때까지 둔다. standalone은 snapshot 없이 local migrate만 한다.
5. external 앞 push: guest의 `call`(external)이 오면 outbox를 먼저 push하고(실패하면 그 호출은 `unavailable`로 답하고 보내지 않는다), 그다음 단계 6의 `app_views/call`로 보낸다. view는 컴퓨터에 닿을 때 연다(닿지 않으면 화면은 그대로 열리고 external만 `unavailable`이다). 결과로 컴퓨터에서 바뀐 것은 다음 pull로 온다.
6. 지우기: 앱이 컴퓨터의 목록에서 빠지면 outbox가 빈 경우에만 앱 폴더를 지운다. standalone 앱의 data는 자동으로 지우지 않는다(컴퓨터의 목록에서 빠져도 폰의 목록에 남고 그대로 열린다). 옛 release 폴더는 바꾼 뒤에 지운다.
7. 앱 화면(`src/screens/apps`): 폰에서 도는 앱은 컴퓨터에 닿지 않아도 연다. 설치가 안 됐으면 설치하고 연다. `GuestScreen`에 `appDb: {path, record: kind === "sync"}`, `backendFile`, `local`, `onLocalChange`, `call`(external은 5의 길). 위 줄의 글과 상태 화면은 `mobile-local-screens`가 짓는다.
8. `src/data/local-apps.ts`: 위 계약의 store와 hook. 순수 logic(sync loop의 순서, outbox 지우기, release 바뀜의 단계와 되돌리기, 지우기 규칙)은 React Native와 native module 없이 `node --test`로 돈다(가짜 연결은 `node:sqlite` 위의 sync core adapter, 가짜 route).
9. Android 확인(아래 규칙): 개발 core(`tools/remote-dev.ts`)에 sync fixture 앱(`tests/support/app/local`)과 standalone 꼴 하나를 올리고 pairing한 뒤: (a) 설치(snapshot), (b) 컴퓨터를 끊고 폰에서 write, 다시 붙으면 컴퓨터 DB에 들어가고 그 앱의 Activity(invocation 읽기 route)에 폰 write가 보인다, (c) 컴퓨터 write가 폰에 온다, (d) 같은 row의 다른 column을 양쪽에서 고쳐도 둘이 같아진다, (e) 안 보낸 변경이 있을 때 새 release를 활성하면 변경이 살아남는다, (f) 컴퓨터에서 rewind하면 폰에도 간다, (g) external 호출이 outbox 뒤에 간다, (h) core를 끈 채 standalone 앱이 열리고 쓴다.

## Android 확인 규칙

- emulator는 AVD `lophn-phone`을 `-read-only -memory 2048 -port 5626`으로 띄우고 모든 adb 명령에 `-s emulator-5626`을 붙인다. 끝나면 `adb -s emulator-5626 emu kill`로 끈다. Metro는 port 8266이다.
- native module을 더하지 않는다. lead가 지어 둔 dev build `/tmp/lophn-mobile-local-apps-x86_64.apk`를 쓴다. gradle을 돌려야 하면 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m" --max-workers=3 -PreactNativeArchitectures=x86_64`.
- 사람의 실제 폰(adb serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일을 하지 않는다. 띄운 process(개발 core, Metro, emulator)는 직접 끈다.
- 개발 core는 `.dev-data/` 아래 data root로 `tools/remote-dev.ts` 길(direct)이다. 사람의 `~/.lophn`, 실제 relay, 실제 model provider를 쓰지 않는다.
- 그림은 `.dev-data/mobile-local-sync-phone/shots/`에 둔다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다.
- 위험 test(node):
  - "outbox 줄은 push의 답(`applied`·`duplicate`)을 받은 것만 지워지고, 안 보낸 변경이 있는 앱 폴더는 앱이 목록에서 빠져도 지워지지 않고, standalone 앱의 data는 자동으로 지워지지 않는다"
  - "release 바뀜에서 migration이나 다시 표현이 실패하면 backup으로 돌아가고 outbox가 그대로이며, backup은 새 release의 첫 push가 성공할 때까지 남는다"
  - "external 호출은 outbox push가 성공한 뒤에만 컴퓨터로 가고, push가 실패하면 보내지 않고 `unavailable`이다"
  - "pull로 받은 묶음은 찍기와 적용과 cursor 올리기가 한 transaction이다: 도중에 실패하면 cursor가 그대로다"
- 9번 (a)~(h)의 결과를 보고에 적는다(못 본 것은 "확인 못 함").
- flows catalog: 이 task가 더하는 test file과 폰 동작의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: 9번 표, 숫자(설치 시간, 1,000 변경 push·pull 시간), `local-apps.ts`가 내놓는 것, `mobile-local-screens`가 보일 상태와 그 뜻, 폰 앱 폴더의 꼴.

## lead가 더함 (`mobile-sync-core` 결과, 2026-11-15)

- sync core가 내놓은 것은 `packages/protocol/apps/sync/mod.ts`다(`ensureSyncTables(db, node)`, `openClock`, `stampLocal`, `stampOutbox`, `applyRemote`, `applyIncoming`, `adoptSnapshot`, `reexpress({old, migrated, snapshot})`, `migrate`, `dumpData`, `dumpClocks`, `readOutbox`). HLC는 63 bit 정수 하나이고 JS에서는 늘 bigint다. `applyRemote`·`applyIncoming`은 transaction을 열지 않는다: 부르는 쪽이 `pragma foreign_keys = off`를 먼저 하고 transaction을 열고, 오류 result면 rollback한다. outbox는 commit 순서(rowid)로 읽고 찍는다.
- **다른 기기에는 원래 changeset과 hlc를 보낸다.** 값이 같은 update나 없는 줄의 delete는 clock만 움직이고 session changeset에 남지 않는다. 폰에서 온 변경을 적용한 뒤의 effective changeset만 sync log에 실으면 다른 폰의 clock이 컴퓨터와 어긋나고, 시계가 어긋난 기기가 있으면 나중에 data가 갈라진다. 그래서 sync log가 가리키는 것은 폰이 보낸 원래 changeset과 그 hlc이고, effective changeset은 그 invocation의 기록(Activity와 rewind)에만 쓴다. 컴퓨터 자신의 write는 원래 것이 곧 effective다.
- **적용이 제약에 걸려도 맞추기가 멈추면 안 된다.** 폰에서 도는 앱은 release 검사가 PK 밖의 UNIQUE와 CHECK를 거절한다(`mobile-local-build`). 그래도 적용 중 제약 오류가 나면 그 변경 하나만 건너뛰고 앱의 problem으로 기록한 뒤 나머지를 이어 간다. 같은 batch를 끝없이 되돌리지 않는다. 건너뛴 변경이 있었다는 것은 응답과 log에 남는다.
- `reexpress`는 old DB(backup)도 받는다(changeset은 column 자리로 적혀 옛 column 이름이 든다). 먼저 outbox를 모두 찍고(`stampOutbox`), snapshot DB에 `adoptSnapshot`을 한 뒤에 부른다. 다시 쓴 changeset이 비면 outbox에 넣지 않는다.

## lead가 더함 (`mobile-sync-runtime` 결과, 2026-11-15)

- pull이 '다시 snapshot'을 알리면(너무 큰 변경이 컴퓨터에 있었다) release가 바뀔 때와 같은 길로 새 snapshot을 받고 보내지 않은 변경을 그 위에 다시 얹는다. push 응답의 건너뛴 변경은 outbox에서 지운다.
