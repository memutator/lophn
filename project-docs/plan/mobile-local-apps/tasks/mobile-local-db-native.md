# mobile-local-db-native

**opus high.** 폰 앱에 우리 작은 SQLite native module `lophn-app-db`(C++ JSI, Android)를 짓는다. 폰 host(앱의 주 runtime)와 사용자 앱 화면의 guest runtime이 같은 library로 같은 file을 쓴다. guest의 연결은 host가 file 하나에 묶고 authorizer가 ATTACH, VACUUM INTO, extension 싣기, 숨은 `lophn_sync_*` 표를 막는다. guest의 호출 하나를 transaction 하나로 감싸고 그 changeset을 같은 transaction 안에서 outbox에 쓰는 일도 C++가 한다(계획 README "정한 것"). spike의 module(240줄 C++, 76줄 Kotlin)이 debug와 release에서 통과했고 이 task는 그것을 제품으로 옮긴다.

- 단위: phone-host (wave 4)
- 선행: 없음. **중간 land 뒤에 띄운다**(계획 README. `packages/mobile`과 단계 6의 guest runtime `mobile-phone-guest`가 main에 있어야 한다). `mobile-widgets`의 native task(`packages/mobile/{app.json,package.json,package-lock.json}`)가 running이면 끝난 뒤에 띄운다
- 소유(이 task만 고친다):
  - `packages/mobile/modules/lophn-app-db`(새 폴더: `package.json`, `index.ts`(JS API와 type), `android/`(Kotlin, `jni/` C++와 CMake, SQLite source))
  - `packages/mobile/plugins/with-app-db.js`(새 file: config plugin)
  - `packages/mobile/src/apps/guest`(`GuestScreen`에 앱 DB 묶기 prop과 module 대체 한 항목을 더하는 만큼)
  - `packages/mobile/guest/fixtures`와 `packages/mobile/guest/lab`(확인용 fixture 화면과 lab 목록 줄만)
  - `packages/mobile/package.json`
  - `packages/mobile/package-lock.json`
  - `packages/mobile/app.json`
  - `packages/mobile/README.md`(native module 절만)
- 읽을 것:
  - spike 판정: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-spike.md`의 "Check 2"(특히 (b), "What a production `mobile-local-db-native` must own", "Sandbox and harness pitfalls"), "Check 5"(크기)
  - spike code(읽기만, 옮겨 쓰고 이 task의 file로 만든다): `/home/pyosechang/projects/lophn-worktrees/spike-local-apps/mobile/modules/lophn-app-db/{package.json,android/build.gradle,android/src/main/java/dev/lophn/appdb/LophnAppDb.kt,android/src/main/jni/AppDb.cpp,android/src/main/jni/CMakeLists.txt,android/src/main/jni/sqlite_names.h}`, `mobile/guest/local/android-edits.md.txt`(`MainApplication`의 `registerSubstitutionPackages`, ProGuard, gradle 메모리), `mobile/src/spike/local-screen.tsx`(host 쪽 사용)
  - 단계 6 guest: `packages/mobile/src/apps/guest/mod.ts`(`GuestScreen`, `allowedTurboModules`), `packages/mobile/plugins/`(guest의 config plugin과 R8 keep 규칙), `packages/mobile/guest/{lab,fixtures}`, `packages/mobile/README.md`의 guest 절과 "Android 확인"
  - sync core의 숨은 표: `packages/protocol/apps/sync/mod.ts`(`lophn_sync_outbox`의 칸 `id, operation, started_at, changeset, hlc`. C++는 앞의 넷만 쓴다)
  - 계획 `README.md` "정한 것"(native module, outbox와 한 transaction)
- 계약:
  - 쓰는 것: sync core의 outbox 칸 이름. 단계 6 `GuestScreen`의 view id(= guest의 origin)
  - 내놓는 것(`packages/mobile/modules/lophn-app-db/index.ts`):
    - host(앱의 주 ReactHost에서만. 다른 context에서 부르면 거절): `bind(origin, path, {record: boolean})`, `unbind(origin)`, `openHost(path): AppDbConnection`
    - `AppDbConnection`(host): 동기 `exec(sql)`, `prepare(sql)` → `{all(params), get(params), run(params)}`, `session()` → `{changeset(): Uint8Array, close()}`(user 표 전부, `lophn_` 표 빼고), `close()`. 값: JS number→REAL, bigint→INTEGER, `Uint8Array`→BLOB(빈 배열은 `zeroblob(0)`), 읽을 때 INTEGER는 number, 2^53을 넘으면 bigint. WAL, `busy_timeout` 5 s
    - guest(guest runtime 안에서 `TurboModuleRegistry.get("LophnAppDb").install()`. runtime마다 **한 번만** handle을 준다. 둘째부터는 던진다): 그 origin에 묶인 file 하나의 연결. `exec`, `prepare`(host와 같은 값 규칙), `beginCall()`(`BEGIN IMMEDIATE`와 session), `endCall({id, operation, started_at})`(changeset이 비어 있지 않고 `record`이면 `lophn_sync_outbox`에 한 줄을 같은 transaction에서 쓰고 commit. 돌려주는 것 `{bytes}`), `abortCall()`(rollback), `randomBytes(n)`
    - guest 연결의 막음: path는 host가 정한다(`open(다른 path)` 없음), `SQLITE_LIMIT_ATTACHED` 0, authorizer가 ATTACH·DETACH(VACUUM INTO 포함)와 `lophn_sync_*`의 읽기·쓰기를 거절한다(`endCall`의 outbox 쓰기만 C++ 안에서 예외), `SQLITE_OMIT_LOAD_EXTENSION`, `SQLITE_DBCONFIG_DEFENSIVE`, 한 statement가 5 s를 넘으면 progress handler로 끊는다, `SQLITE_LIMIT_LENGTH`(예: 64 MiB)
    - `GuestScreen`의 새 prop `appDb?: {path: string, record: boolean}`: 있으면 mount 전에 `bind(view, path, …)`, unmount 때 `unbind`, guest의 module 대체에 `LophnAppDb`를 더한다(spike: sandbox는 대체에만 `configureSandbox`를 부른다). 없으면 guest는 module에 닿지 못한다(지금 동작)

## 할 일

1. module 옮기기: spike의 C++·Kotlin·CMake를 `packages/mobile/modules/lophn-app-db/`로. SQLite는 expo-sqlite의 사본에 기대지 않는다: amalgamation(spike와 같은 3.53.x)을 정확한 판과 hash로 고정해 이 module에 둔다(저장소에 넣을지, 정확한 판의 npm package에서 가져올지 정하고 보고한다). 빌드 flag `SQLITE_ENABLE_SESSION`, `SQLITE_ENABLE_PREUPDATE_HOOK`, `SQLITE_OMIT_LOAD_EXTENSION`, `SQLITE_THREADSAFE=1`, 비공개 link(`-fvisibility=hidden`, `--exclude-libs,ALL`). 빈 blob 고침(`sqlite3_bind_zeroblob`)을 그대로 가져온다.
2. 위 계약의 더할 것: `beginCall`/`endCall`/`abortCall`(outbox 쓰기는 C++의 고정 SQL 하나이고 authorizer는 그 한 statement 동안만 허락한다), guest handle 한 번만, progress handler, length 상한, host의 `unbind`(guest의 연결을 닫고 표에서 지운다), host가 아닌 context의 `bind`·`openHost` 거절.
3. config plugin `with-app-db.js`와 `app.json`의 `plugins`: `MainApplication`에 대체 package 등록(`registerSubstitutionPackages`), R8 keep 규칙(이 module의 class. spike는 R8이 JNI가 이름으로 부르는 method를 지워 release가 죽었다). prebuild를 다시 돌려도 한 번만 들어간다. `android/`는 git에 넣지 않는다.
4. `GuestScreen`의 `appDb` prop(위 계약).
5. lab 확인(아래 "Android 확인 규칙"): `packages/mobile/guest/fixtures/`에 확인용 fixture 화면 하나(guest 안에서 `install()`하고 아래 probe를 돌려 결과를 host로 보낸다)와 lab 목록 줄. **debug와 release 둘 다**: (a) guest의 `pragma database_list`가 묶인 file 하나, (b) ATTACH, VACUUM INTO, `lophn_sync_*` 읽기·쓰기, 둘째 `install()`이 거절된다, (c) host 500 + guest 500의 엇갈린 write 뒤 `pragma integrity_check`가 ok, (d) `beginCall`→write→`endCall`이 outbox 한 줄을 쓰고 host가 그 줄을 읽는다, `abortCall`은 아무것도 남기지 않는다, (e) 5 s 넘는 query(재귀 CTE)가 끊기고 guest와 host가 계속 돈다, (f) unmount 뒤 `unbind`된 origin의 handle이 더 쓰이지 않는다. 숫자: `liblophnappdb.so` 크기(x86_64, arm64를 지을 수 있으면 둘 다), guest PSS 차이, 1,000 write 시간.
6. 문서: `packages/mobile/README.md`에 native module 절(무엇을 막나와 이유, SQLite 판을 올리는 법, lab 확인). expo-sqlite를 더하지 않는다(있으면 보고한다: 한 process에 SQLite 사본 둘이 한 file을 열면 lock이 깨진다).

## Android 확인 규칙

- emulator는 AVD `lophn-phone`을 `-read-only -memory 2048 -port 5622`로 띄우고(`-no-window -no-audio -no-boot-anim`) 모든 adb 명령에 `-s emulator-5622`를 붙인다. 끝나면 `adb -s emulator-5622 emu kill`로 끈다. Metro는 port 8262다.
- gradle은 `--no-daemon -Pkotlin.compiler.execution.strategy=in-process "-Dorg.gradle.jvmargs=-Xmx4g -XX:MaxMetaspaceSize=1536m" --max-workers=3 -PreactNativeArchitectures=x86_64`로 돌린다. daemon을 남기지 않는다.
- 사람의 실제 폰(adb serial `R3CT90K6G2X`)에는 어떤 명령도 보내지 않는다. `pkill`·`killall`과 `ps`로 process를 찾아 죽이는 일을 하지 않는다. 띄운 process는 직접 끈다.
- release build는 debug 서명의 `assembleRelease`다. core, relay, 실제 model provider, 사람의 `~/.lophn`을 쓰지 않는다(lab만으로 확인한다).
- 그림은 `.dev-data/mobile-local-db-native/shots/`에 둔다.

## 끝남

- `cd packages/mobile && npm run typecheck && npm test`와 root `npm run check`가 통과한다. 깨끗한 `npm ci`와 prebuild 뒤 debug·release build가 된다.
- 위험 test(sandbox 경계라 둔다. emulator 확인이고 결과를 보고에 적는다. 통과하지 않으면 끝남이 아니다): "guest의 연결은 묶인 file 하나만 보고, ATTACH·VACUUM INTO·extension·`lophn_sync_*` 접근과 둘째 handle이 거절되며, host와 guest가 같은 file에 엇갈려 써도 `integrity_check`가 ok다"(debug와 release)
- 남지 않음: 없음(더하기).
- flows catalog: 이 task가 더하는 native module export와 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: JS API 최종 모양, 5번 probe 표(debug와 release), 숫자, SQLite source를 어디서 왜 가져왔는지, spike와 다르게 한 곳, lead가 지을 dev build에 바뀐 것(lead가 wave 5 이후 worker에게 알릴 APK).

## lead가 더함 (`mobile-sync-core` 결과, 2026-11-15)

- sync core의 driver interface는 `packages/protocol/apps/sync/db.ts`의 `SyncDb`·`SyncSession`이다(값 규칙이 file 머리에 있다: 정수는 text로 cast해 읽으니 number든 bigint든 된다, 빈 blob은 NULL이 아니라 빈 blob이다). 이 module의 host 쪽 연결이 그 interface를 채운다. spike가 찾은 '빈 blob이 NULL로 온다'가 다시 생기지 않는지 test한다.
