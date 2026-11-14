# phone-runtime-spike: 폰에서 앱 backend와 data를 돌릴 수 있나

- 계획: `project-docs/plan/remote-core/` task `phone-runtime-spike` (2026-11-14)
- 범위: 문서 조사와 폰 도구 없이 되는 확인. 제품 코드는 고치지 않았다.
- 실험 file은 worktree의 `.dev-data/phone-runtime-spike/`에 있다(commit하지 않음). 이 보고서의 명령은 모두 worktree root에서 돌렸다. Node v24.20.0, esbuild 0.28.2(저장소 의존 그대로).

## 판정 요약

| 질문 | 판정 | 한 줄 |
|---|---|---|
| 1. Expo JS engine에서 SDK만 쓰는 backend를 한 file로 bundle해 돌리기 | **조건부** | 한 file(20 KB)로 묶이고 Node 내장 module 없는 빈 JS context에서 handler가 돈다. SDK 세 곳과 앱 template 한 곳을 고쳐야 하고, Hermes에서 실제로 도는지는 아직 못 봤다(아래 "남은 확인") |
| 2. iOS·Android에서 session extension을 쓰는 SQLite binding | **된다** (expo-sqlite) | expo-sqlite가 두 OS 모두 `SQLITE_ENABLE_SESSION`으로 빌드하고 `SQLiteSession`을 내놓는다. 다만 conflict 정책이 native에 REPLACE로 박혀 있어 conflict handler를 줄 수 없다 |
| 3. 폰용 Node(nodejs-mobile) | **안 된다** (지금) | 나온 판이 Node 18.20.4(2024-10)뿐이다. `node:sqlite`(22.5+)와 session API(22.12+)가 없고, 22·24로 올리는 PR은 1년 넘게 merge되지 않았다 |
| 4. changeset 충돌을 "나중에 고친 것이 이긴다"로 풀기, 정수 id | **조건부** | conflict handler만으로는 안 된다. handler가 충돌 종류(숫자 하나)만 받고 row를 보지 못한다. changeset을 미리 읽어 지는 change를 빼는 pre-pass를 두면 두 사본이 같아진다(아래에서 돌림). 정수 id는 어떤 정책으로 풀어도 row 하나를 잃는다. text id로 막는다 |

추천: **Expo 껍데기 안에 앱마다 따로 띄운 Hermes runtime이 esbuild로 묶은 backend를 돌린다. data는 session을 켜고 빌드한 SQLite에 두고, SDK가 changeset을 주고받으며 pre-pass로 LWW를 맞춘다. 폰용 앱의 표는 text id만 쓴다.** 자세한 것은 "추천하는 길"에 있다.

---

## 1. Expo(React Native) JS engine에서 backend를 한 file로 돌리기: 조건부

### 지금 코드가 Node에 기대는 곳

본보기 앱(`tests/support/app/sample/`의 `src/handlers.ts`, `src/items.ts`, `migrations/0-1.sql`과 template의 `main.ts`)을 `.dev-data/phone-runtime-spike/app/`에 복사했다. 그리고 `@lophn/*`를 `packages/sdk/*/mod.ts`로 alias해 esbuild로 묶었다(`platform: "neutral"`, `node:*`는 external).

```
$ node .dev-data/phone-runtime-spike/build.mjs . .dev-data/phone-runtime-spike/out/backend.mjs
node:async_hooks <- packages/sdk/cap-tool/handlers.ts
node:path <- packages/sdk/cap-store/connection.ts, packages/sdk/cap-store/store.ts
node:sqlite <- packages/sdk/cap-store/connection.ts
node:process <- packages/sdk/cap-problem/exception-observer.ts
node:fs <- .dev-data/phone-runtime-spike/app/src/items.ts
inputs: 41 bytes: 17573
```

Node 내장 module은 다섯 개다. 넷은 SDK에서, 하나는 앱 코드에서 온다.

| module | 어디서 | 무엇에 | 폰에서 |
|---|---|---|---|
| `node:async_hooks` | `cap-tool/handlers.ts` | handler port가 없을 때 만드는 fallback port의 `AsyncLocalStorage` | host가 port를 먼저 깔면 쓰이지 않는다. import만 문제다 |
| `node:sqlite` | `cap-store/connection.ts` | `new DatabaseSync`, `createSession`, `applyChangeset` | host가 주는 SQLite driver로 바꾼다 |
| `node:path` | `cap-store/{store,connection}.ts` | `resolve` | 문자열 join이면 된다 |
| `node:process` | `cap-problem/exception-observer.ts` | 예외 observer | bundle에는 쓰이지 않는 side-effect import로만 남는다(`mod.ts` barrel 때문) |
| `node:fs` | 앱 `src/items.ts` | `readFileSync(new URL("../migrations/0-1.sql", import.meta.url))` | 실행 중에 file을 읽지 않는다. bundle할 때 SQL을 text로 넣는다 |

core의 runtime은 이미 자기 port를 깐다(`packages/core/apps/runtime/entrypoint/tool-port.ts`가 `globalThis[Symbol.for("lophn.cap-tool")]`에 설치한다). SDK의 `AsyncLocalStorage`는 SDK가 core 없이 load될 때(앱의 `node --test`)만 쓰인다. 그래서 호출 context는 이미 port 경계 뒤에 있고, 폰 host가 다른 port를 깔면 SDK 코드는 바뀌지 않는다.

### shim을 넣어 Node 없이 돌리기

`node:*`를 shim으로 바꾸고(async_hooks: 쓰면 던짐, sqlite: host global의 driver, path: join, process: `{}`, fs: bundle에 넣은 asset만 읽음), `import.meta.url`은 `define`으로 고정하고, `migrations/*.sql`은 virtual module로 넣어 IIFE 한 file로 묶었다.

```
$ node .dev-data/phone-runtime-spike/phone/build-phone.mjs . .dev-data/phone-runtime-spike/out/phone.js
built-ins shimmed: node:fs, node:process, node:async_hooks, node:path, node:sqlite
bytes: 20183
```

이 file을 `node:vm`의 빈 context에서 돌렸다. 그 context에는 ECMAScript 내장(Promise, Symbol 등)과 `console`만 있고 Node API와 web API는 없다. host 흉내(`phone/host-sim.mjs`)는 다음을 넣는다.
- handler port: `AsyncLocalStorage` 없이 호출을 하나씩 차례로 돌리고 `current`를 변수 하나로 둔다.
- `CAP_HOST`(`mode: "preview"`, `dataPath`)
- `__lophnSqlite.open(path)`: DatabaseSync 꼴의 driver. 실험에서는 바깥의 `node:sqlite`이고, 폰에서는 native binding이다.
- 명령줄에서 고른 web global만

```
$ for give in "" "TextEncoder" "TextEncoder,crypto" "TextEncoder,crypto,URL"; do node phone/host-sim.mjs out/phone.js "$give"; done
### globals given: []
registered: list_items, add_item, page_items, save_item
[inv=inv_0] error store_unavailable: the item store could not be opened {"api":"list_items"}
CALL FAILED: the item store is unavailable
...(TextEncoder, TextEncoder+crypto도 같은 실패)
### globals given: [TextEncoder,crypto,URL]
registered: list_items, add_item, page_items, save_item
add_item: {"out":{"id":1,"title":"milk",...},"sameContextAfterAwait":true} {"out":{"id":2,"title":"eggs",...},"sameContextAfterAwait":true}
changeset bytes from the write: 96
list_items: {"rows":[{"id":2,"title":"eggs",...},{"id":1,"title":"milk",...}],"coverage":"complete","freshness":"fresh","continuation":null}
```

셋 가운데 하나라도 빼면 실패한다(`crypto,URL`, `TextEncoder,URL`, `TextEncoder,crypto` 모두 `store_unavailable`). 필요한 web global은 셋이다.
- `TextEncoder`와 `crypto.subtle.digest`: `cap-store/store.ts`의 `migrate`가 migration SQL의 sha256을 뜰 때 쓴다. 폰에는 activation을 해 줄 data worker가 없어 migration을 폰이 직접 돌리므로 빠질 수 없다. Hermes에는 `TextEncoder`가 있다. `crypto.subtle`은 없고 expo-crypto의 `Crypto.digest(algorithm, data): Promise<ArrayBuffer>`가 같은 꼴이다([expo-crypto](https://docs.expo.dev/versions/latest/sdk/crypto/)). 또는 SDK가 순수 JS sha256을 쓴다.
- `URL`: 앱 코드가 migration file을 찾을 때만 쓴다. bundle 단계에서 SQL을 text import로 바꾸면 필요 없다.

handler 등록, migration, 쓰기, 읽기, write 동안의 changeset 뜨기(`STORE_HOOKS`의 `beginChangeset`/`endChangeset`, 96 bytes)가 모두 Node 없이 돌았다.

### `node:async_hooks` 없이 호출 context를 지키는 길

```
$ node phone/context-demo.mjs
overlapping: inv_1 -> inv_2, inv_2 -> null
serialized: inv_1 -> inv_1, inv_2 -> inv_2
```

- 변수 하나에 context를 두고 호출을 겹쳐 돌리면 `await` 뒤에 다른 호출의 context를 본다. 이렇게 되면 `parent_invocation`과 문제 보고가 엉뚱한 호출에 붙는다.
- **추천: 폰 host의 port가 앱마다 호출을 하나씩 차례로 돌린다.** SDK API는 그대로다. 잃는 것은 한 앱 안의 동시 실행이다. 폰 backend의 DB는 동기 API라 원래 겹치지 않는다. 늦어지는 것은 `await`로 기다리는 network(core broker) 호출뿐이고, 폰 혼자 도는 앱에서는 그 호출이 대개 `unavailable`이다.
- 버린 길: handler 둘째 인자로 context를 넘기기(SDK의 `handle`, `connectCommands`, `publish`, `reportProblem` 모양이 모두 바뀌고 앱 코드가 넘기는 것을 잊는다). `Promise.prototype.then`을 바꿔 context를 실어 나르는 AsyncContext polyfill(engine 안의 native `await`는 바꾼 `then`을 타지 않아 틀린다). TC39 AsyncContext는 Hermes에 없다.

### Hermes에 대해 아는 것과 모르는 것

- React Native 0.84부터 Hermes V1이 기본이다([RN 0.84 blog](https://reactnative.dev/blog/2026/02/11/react-native-0.84)). 지금 최신은 react-native 0.88.1과 expo 58.0.25다(`npm view`, 2026-11-14).
- 옛 Hermes 문서에는 ES6 class가 "Planned"이고 async/await가 "In Progress", local-mode `eval`과 `with`가 빠져 있다([hermes Features.md](https://github.com/facebook/hermes/blob/main/doc/Features.md)). V1에서 어디까지 native로 되는지는 공식 문서에서 확인하지 못했다. Metro와 Babel을 거치지 않고 실행 중에 받는 bundle이라 esbuild의 target이 engine에 맞아야 한다. esbuild는 class를 ES5로 낮추지 못한다.
- `hermes-compiler@260318099.0.5`(RN 0.88이 고정한 판)의 `hermesc`로 bundle을 compile해 보려 했다. **auto-mode classifier가 내려받은 binary 실행을 막았다**("Unauthorized Access"). 우회하지 않고 내려받은 것을 지웠다. "남은 확인" 1이다.

### SDK에서 바뀌어야 하는 곳

- `packages/sdk/cap-tool/handlers.ts`: `AsyncLocalStorage` fallback port를 Node 전용 entry로 옮긴다. package.json `exports`에 조건 `"lophn-phone"`을 더하고 release 준비의 esbuild가 `conditions: ["lophn-phone"]`로 고른다.
- `packages/sdk/cap-problem/exception-observer.ts`: `node:process`를 쓰는 observer를 Node 전용 entry로 옮긴다.
- `packages/sdk/cap-store/store.ts`: `Store.db`의 type이 `node:sqlite`의 `DatabaseSync`다. SDK가 정한 작은 interface(`exec`, `prepare(sql).get/all/run`)로 좁혀, `node:sqlite`와 폰 driver가 둘 다 맞추게 한다. 앱이 Node에서만 되는 method(`backup`, `loadExtension`, `function` 등)를 쓰면 type 검사에서 걸린다. `node:path`를 뺀다. sha256은 host가 주거나 순수 JS로 한다.
- `packages/sdk/cap-store/connection.ts`·`host.ts`: `new DatabaseSync`와 `createSession`을 `CAP_HOST`에 더한 driver로 연다(desktop은 `node:sqlite`, 폰은 native binding).
- 앱 template(`packages/core/apps/packages/template/app`)과 SDK guide: 폰용 앱은 migration SQL을 text import로 읽는다(esbuild `loader: { ".sql": "text" }`). `sdk-note`의 일이다(guide와 template이 바뀌므로 `migrate-sdk` 메모와 Instruction diff).

## 2. iOS·Android SQLite binding과 session extension: 된다 (expo-sqlite)

| binding | session | 근거 |
|---|---|---|
| **expo-sqlite** (SDK 58, 58.0.x) | **있다.** `createSessionSync/Async(dbName?)`, `attachSync(table \| null)`, `enableSync`, `createChangesetSync`, `createInvertedChangesetSync`, `applyChangesetSync(changeset)`, `invertChangesetSync`. `Changeset`은 `Uint8Array` | [expo-sqlite docs](https://docs.expo.dev/versions/latest/sdk/sqlite/) `SQLiteSession` (Android, iOS, macOS, tvOS, Web) |
| | 두 OS 빌드 모두 `-DSQLITE_ENABLE_SESSION=1 -DSQLITE_ENABLE_PREUPDATE_HOOK=1` | [android/build.gradle](https://github.com/expo/expo/blob/main/packages/expo-sqlite/android/build.gradle) 27행, [ios/ExpoSQLite.podspec](https://github.com/expo/expo/blob/main/packages/expo-sqlite/ios/ExpoSQLite.podspec) 39행 |
| | SQLite를 자기가 들고 온다(`vendor/sqlite3`, `SQLITE_VERSION "3.53.3"`, symbol 앞에 `ex`를 붙임). OS의 SQLite에 기대지 않는다 | [vendor/sqlite3/sqlite3.h](https://github.com/expo/expo/blob/main/packages/expo-sqlite/vendor/sqlite3/sqlite3.h) |
| | **conflict handler를 받지 않는다.** native가 늘 `SQLITE_CHANGESET_REPLACE`를 돌려준다 | [NativeSessionBinding.cpp](https://github.com/expo/expo/blob/main/packages/expo-sqlite/android/src/main/cpp/NativeSessionBinding.cpp) 111-114행, [NativeSession.swift](https://github.com/expo/expo/blob/main/packages/expo-sqlite/ios/NativeSession.swift) 133-141행 |
| | 동기 API(`prepareSync`, `runSync`, `getFirstSync`, `getAllSync`)가 있어 SDK의 동기 `DatabaseSync` 꼴에 adapter로 맞출 수 있다 | 같은 docs |
| op-sqlite (0.52.x) | JS API가 없다. `package.json`의 `"op-sqlite": { "sqliteFlags": "-D..." }`로 `SQLITE_ENABLE_SESSION`을 켤 수는 있다. 그러면 C++ 쪽(`cpp_usage`)에서 binding을 직접 써야 한다 | [op-sqlite installation](https://github.com/OP-Engineering/op-sqlite/blob/main/docs/docs/installation.md) |

늘 REPLACE인 것이 문제다. SQLite는 REPLACE를 `DATA`와 `CONFLICT`에만 허용한다. `NOTFOUND`(한쪽이 지운 row를 다른 쪽이 고침)에 REPLACE를 돌려주면 `SQLITE_MISUSE`로 apply 전체가 되돌아간다. expo-sqlite에서 이 경우 `applyChangeset`이 throw한다. `node:sqlite`에서 같은 handler로 재현했다.

```
$ node .dev-data/phone-runtime-spike/sync/handler-args.mjs
onConflict args: [ 2 ] NOTFOUND = 2
Error: bad parameter or other API misuse   { code: 'ERR_SQLITE_ERROR', errcode: 21 }
```

그래서 expo-sqlite를 쓸 때는 질문 4의 pre-pass가 `NOTFOUND`가 될 change(로컬에 없는 row의 UPDATE·DELETE)도 미리 빼야 한다. 빼면 "늘 REPLACE"로도 맞는다(질문 4의 `expo-policy.mjs`).

**무엇을 빌드해야 하나.** shell의 주 JS runtime에서 expo-sqlite를 쓰면 빌드할 것이 없다. 추천대로 앱 backend를 따로 띄운 runtime에서 돌리면, 그 runtime에 expo-sqlite의 JSI module이 깔리는지 모른다("남은 확인" 2). 깔리지 않으면 작은 JSI binding을 만든다. 같은 SQLite amalgamation과 같은 flag로 빌드하고 `prepare/step/bind/column`과 `session create/attach/changeset/apply`를 내놓는다. 이 binding은 conflict handler 안에서 `sqlite3changeset_conflict()`로 로컬 row를 읽을 수 있어, pre-pass 없이 handler만으로 LWW를 풀 수 있다.

## 3. 폰용 Node(nodejs-mobile): 안 된다 (지금)

- 나온 판: [releases](https://github.com/nodejs-mobile/nodejs-mobile/releases)의 최신은 **v18.20.4 (2024-10-07)**다. 그 뒤로는 Android 16 KB page 빌드를 고친 commit(2025-11-13)과 branch `release18-20-4+16kb-fix`뿐이다.
- `node:sqlite`: v22.5.0에 들어왔다. `createSession`, `Session.changeset`, `applyChangeset`(`onConflict`, `filter`)은 v22.12.0과 v23.3.0부터다([Node docs](https://nodejs.org/api/sqlite.html)). Node 18 판에는 없다.
- 판 올리기: "src: update node.js to v22.9.0"([#134](https://github.com/nodejs-mobile/nodejs-mobile/issues/134), 2024-10 이후 멈춤), "Update v24.5.0"([#151](https://github.com/nodejs-mobile/nodejs-mobile/issues/151), open, 2025-11 마지막 갱신), 요청 issue [#152](https://github.com/nodejs-mobile/nodejs-mobile/issues/152)와 [#156](https://github.com/nodejs-mobile/nodejs-mobile/issues/156)이 모두 open이다. #151의 comment에 따르면 그 patch로는 iOS에서 native addon(N-API)이 돌지 않고, 유지보수 사정이 분명하지 않다.
- iOS 제약: iOS 빌드는 V8을 JIT를 끈 채(`jitless`)로 띄운다([BUILDING.md](https://github.com/nodejs-mobile/nodejs-mobile/blob/main/doc_mobile/BUILDING.md) 124행). JIT 없는 V8 interpreter라 Hermes보다 나을 것이 없고 binary는 훨씬 크다.
- 직접 Node 22.12+ fork를 빌드해 유지하는 길은 있다. 하지만 lophn이 mobile용 Node 판을 계속 올려야 한다. 이것은 roadmap이 버린 이유("판이 늦다")를 우리가 지는 것이라 버린다.

## 4. changeset 충돌을 "나중에 고친 것이 이긴다"로: 조건부

### handler만으로는 안 되는 이유

`node:sqlite`의 `onConflict`는 충돌 종류 숫자 하나만 받는다(위 출력 `onConflict args: [ 2 ]`, [Node docs](https://nodejs.org/api/sqlite.html) "receives one argument"). 어느 row인지, 로컬 값이 무엇인지 모르므로 "어느 쪽이 나중인가"를 handler 안에서 정할 수 없다. expo-sqlite는 handler 자체가 없다. SQLite C API는 handler에 iterator를 넘겨 `sqlite3changeset_conflict()`로 로컬 row를 읽게 해 준다. 두 binding이 그것을 감췄을 뿐이다.

### pre-pass로 푼다

받은 changeset을 apply하기 전에 직접 읽는다. format은 `packages/base/changeset-invert.ts`가 이미 읽는 것과 같다. 실험의 `sync/codec.mjs`는 그 reader를 줄인 것이다. change마다 로컬 row를 PK로 찾아 비교하고, 지는 change를 byte 범위째 뺀 changeset을 다시 만든 뒤 apply한다.
- INSERT·UPDATE: 들어온 `updated_at`이 로컬 row보다 나중일 때만 남긴다.
- 로컬에 없는 row의 UPDATE·DELETE: 뺀다(여기서 지웠다, 지운 쪽이 이긴다).
- 남은 change의 `DATA`·`CONFLICT`는 REPLACE로 덮는다. `NOTFOUND`는 OMIT이다.

"나중"은 이 실험에서 표의 `updated_at`(ISO 시각)으로 안다. 두 사본은 같은 base DB에서 시작한다. A는 10:00에, B는 10:05에 같은 row를 고치고, 각자 새 item 하나를 더한 뒤 서로의 changeset을 apply한다.

```
$ node .dev-data/phone-runtime-spike/sync/changeset-sync.mjs
===== id integer primary key =====
-- default (applyChangeset, handler 없음)
  applied A:false B:false
  A: 1:milk (A)@10:00, 2:eggs@10:00
  B: 1:milk (B)@10:05, 2:bread@10:05
  same: false
-- naive-replace (DATA/CONFLICT -> REPLACE, expo-sqlite와 같은 "받은 쪽이 이김")
  applied A:true B:true; [B -> A]; conflict DATA; conflict CONFLICT; [A -> B]; conflict DATA; conflict CONFLICT
  A: 1:milk (B)@10:05, 2:bread@10:05
  B: 1:milk (A)@10:00, 2:eggs@10:00
  same: false
-- later-wins (pre-pass + REPLACE)
  applied A:true B:true; [B -> A]; conflict DATA; conflict CONFLICT; [A -> B]; drop UPDATE item[1] incoming 10:00 <= local 10:05; drop INSERT item[2] incoming 10:00 <= local 10:05
  A: 1:milk (B)@10:05, 2:bread@10:05
  B: 1:milk (B)@10:05, 2:bread@10:05
  same: true            <- 같아졌지만 A가 더한 eggs가 사라졌다

===== id text primary key =====
-- default:        applied A:false B:false, same: false
-- naive-replace:  A: itm_A:eggs, itm_B:bread, itm_base_1:milk (B)
                   B: itm_A:eggs, itm_B:bread, itm_base_1:milk (A)      same: false
-- later-wins:     [A -> B]; drop UPDATE item["itm_base_1"] incoming 10:00 <= local 10:05
                   A: itm_A:eggs@10:00, itm_B:bread@10:05, itm_base_1:milk (B)@10:05
                   B: itm_A:eggs@10:00, itm_B:bread@10:05, itm_base_1:milk (B)@10:05
                   same: true

===== delete vs update (text id, later-wins) =====
  applied A:true B:true; [B -> A]; conflict NOTFOUND; [A -> B]; conflict DATA
  A: (빈 표)  B: (빈 표)  same: true
```

(id의 무작위 꼬리와 날짜는 줄였다. 원본은 `sync/out.txt`.)

- 기본(handler 없음)은 충돌 하나에 전체가 되돌아간다. 지금 `cap-store`의 `applyChangesets`가 이 꼴이다.
- "받은 쪽이 이김"(expo-sqlite의 고정 정책)은 서로 상대 값을 받아 **두 사본이 갈라진다.**
- pre-pass LWW는 두 사본이 같아진다.

expo-sqlite처럼 늘 REPLACE인 apply에서도 pre-pass로 맞는다. `expo-policy.mjs`는 A가 row를 지우고 B가 그 row를 고친 경우를 섞어 돌린다.

```
$ node .dev-data/phone-runtime-spike/sync/expo-policy.mjs
raw csB on A with always-REPLACE throws: bad parameter or other API misuse / A rows still: 2
pre-pass + always-REPLACE: A true B true
A [{"id":"itm_2","title":"tea (B)","updated_at":"T11"},{"id":"itm_A","title":"eggs",...},{"id":"itm_B","title":"bread",...}]
B [{"id":"itm_2","title":"tea (B)","updated_at":"T11"},{"id":"itm_A","title":"eggs",...},{"id":"itm_B","title":"bread",...}]
same: true
```

### 정수 자동 증가 id

`integer primary key`(rowid alias)는 두 기기가 같은 다음 값(위에서 둘 다 `2`)을 만든다. 서로 다른 item이 같은 PK를 가지므로 `CONFLICT`가 나고, OMIT이든 REPLACE든 LWW든 **한쪽 row를 잃는다**(위 integer later-wins에서 `eggs`가 사라짐). 충돌 정책으로는 풀 수 없다. 표가 정수 자동 증가 id를 쓰지 못하게 막는다.
- **text id**: 기기에서 만드는 무작위 id(`itm_<uuid>` 꼴, 폰은 `Crypto.randomUUID()`). text id 실험에서 두 기기의 새 row가 모두 남았다.
- 버린 길: 기기마다 정수 범위를 나누기(기기 등록과 묶여 복잡하고 새 기기가 생기면 다시 나눠야 한다). `id * 기기수 + 기기번호`(같은 문제).

### "나중"을 어떻게 아나 (추천)

실험은 앱의 `updated_at` 칸을 썼다. 제품에서는 앱 schema에 기대지 않는다. runtime이 write마다 changeset을 이미 뜨므로(`STORE_HOOKS.endChangeset`) 그때 changeset의 PK를 읽어 숨은 표 `(table, pk) -> clock`에 적는다. clock은 hybrid logical clock(벽시계와 counter, 같은 값이면 기기 id로 가른다)이다. 보내는 changeset에 그 clock을 붙이고, pre-pass가 로컬 row clock과 비교한다. 앱은 아무것도 하지 않아도 되고, 지운 row도 clock이 남아 "지운 것과 고친 것 가운데 나중"을 시각으로 가를 수 있다. 쓰는 사람이 하나라 기기 시계가 몇 초 어긋나는 것은 받아들인다.

같이 지킬 것:
- 받은 changeset은 session을 걸지 않은 구간에 apply한다. 걸어 두면 다시 로컬 변경으로 기록되어 되돌아간다.
- 숨은 clock 표와 `lophn_data_schema`는 session에서 뺀다.

---

## 추천하는 길

1. **runtime.** Expo 껍데기 안에서 폰용 앱마다 shell의 주 runtime과 다른 Hermes runtime을 띄운다. 그 runtime이 release의 backend bundle 한 file을 source로 받아 돈다. 따로 띄우는 이유는 AI가 짠 backend가 껍데기의 native module(기기 key, 다른 앱의 DB)에 닿지 않게 하는 것이다. 후보는 Margelo [react-native-runtimes](https://github.com/margelo/react-native-runtimes)와 Callstack [react-native-sandbox](https://www.callstack.com/blog/running-multiple-instances-of-react-native-in-sandbox), 아니면 Expo Modules로 만드는 작은 JSI module이다.
2. **host가 그 runtime에 주는 것.** 호출을 차례로 돌리는 handler port, `CAP_HOST`, SQLite driver, `crypto.subtle.digest`(또는 SDK의 순수 JS sha256)다. `TextEncoder`는 Hermes에 있다. `URL`과 file system은 주지 않는다.
3. **data.** session을 켠 SQLite를 쓴다. 주 runtime이면 expo-sqlite, 따로 띄운 runtime이면 같은 amalgamation으로 만든 JSI binding이다. 앱마다 DB file 하나를 둔다.
4. **sync.** 지금처럼 write마다 changeset을 뜬다. 거기에 row clock을 남긴다. core에 닿으면 마지막으로 맞춘 뒤의 changeset을 주고받고 pre-pass LWW로 apply한다. 같은 release일 때만 맞춘다(roadmap 그대로).
5. **SDK 꼴.** `lophn-phone` 조건 export로 Node 전용 부분을 가르고, `Store.db`를 SDK interface로 좁힌다. 앱 API(`handle`, `openStore`, `store.db.prepare`)는 그대로다.

## 버린 길

| 길 | 버린 이유 |
|---|---|
| 폰에 Node 싣기(nodejs-mobile) | 질문 3. 판이 Node 18이고 `node:sqlite`가 없다. fork를 직접 유지해야 하고 iOS는 jitless V8이다 |
| backend를 shell의 주 RN runtime에서 돌리기 | 빌드할 것이 가장 적다(expo-sqlite 그대로). 하지만 AI가 짠 코드가 껍데기의 native module과 모든 앱의 DB에 닿는다. AGENTS.md가 막으라는 "AI가 만든 코드"의 실수를 막을 경계가 없다 |
| backend를 숨은 WebView(JavaScriptCore/WebView JS)에서 돌리기 | web global이 다 있고 iOS 4.7의 "JavaScript mini apps"에 가장 잘 맞는다. 하지만 SQLite가 native 쪽이면 bridge가 비동기라 SDK의 동기 DB API와 맞지 않는다. wasm SQLite+OPFS로 WebView 안에 두면 data 보존(WebView storage 정리)과 session build를 따로 확인해야 한다 |
| 호출 context를 handler 인자로 넘기기, AsyncContext polyfill | 질문 1. SDK API가 넓게 바뀌거나 native `await`에서 틀린다 |
| expo-sqlite의 "늘 REPLACE"를 그대로 쓰기 | 두 사본이 갈라지고(`naive-replace`), 지운 row를 고친 경우 apply가 throw한다 |
| 정수 id를 기기마다 범위로 나누기 | 기기 등록과 묶여 복잡하다. text id가 더 단순하다 |
| 받은 bundle을 computer에서 Hermes bytecode로 compile해 보내기 | bytecode 판이 껍데기의 Hermes 판에 묶인다. source를 보내고 폰에서 compile하는 것이 판 차이에 덜 깨진다(성능이 모자라면 그때 본다) |

## release 검사가 바뀌어야 하는 곳

폰에서 도는 앱(declaration에서 sync나 독립을 고른 앱)에만 건다.
- **bundle 검사:** release 준비가 backend를 `platform: "neutral"`, `conditions: ["lophn-phone"]`, `format: "iife"`로 한 file로 묶는다. `node:*`나 Node에 기대는 npm package가 하나라도 남으면 실패한다. 이 spike의 `build-phone.mjs`처럼 shim이 없는 `node:` import를 `onResolve`에서 error로 낸다. `@lophn/cap-fs`(`node:fs`)도 여기서 걸린다.
- **load 검사:** 그 bundle을 `node:vm`의 빈 context에서 폰 host와 같은 global만 주고 load해, 선언한 operation·command가 모두 등록되는지 본다. 이 spike의 `host-sim.mjs`와 같은 일이다. 서버와 subprocess 없이 computer에서 돈다.
- **schema 검사:** `packages/protocol/apps/activation/migration-sql.ts`의 `tablesWithoutPrimaryKey` 옆에 정수 key 검사를 더한다. 새 표의 PK가 `INTEGER PRIMARY KEY`(rowid alias)이거나 `AUTOINCREMENT`이면 실패한다. `cap-store/store.ts`의 `migrate`도 같은 검사를 부른다(지금 PK 없는 표를 막는 자리).
- **asset:** migration SQL이 bundle 안에 text로 들어갔는지 본다(실행 중에 file을 읽지 않는다).

## 남은 확인 (폰 도구나 허락이 필요해 하지 않은 것)

1. **Hermes에서 bundle이 compile되고 도는지.** RN 0.88이 고정한 `hermes-compiler@260318099.0.5`의 `hermesc -emit-binary`로 `out/phone.js`(target es2020·es2017)를 compile해 보는 것은 auto-mode classifier가 막았다(내려받은 binary 실행). 사람이 허락하면 폰 없이 Linux에서 바로 할 수 있다. 실제 기기에서 실행 중에 source를 `eval`할 때의 속도와 Hermes V1에서 async/class가 native로 되는지도 본다.
2. **따로 띄운 Hermes runtime에서 expo-sqlite를 쓸 수 있는지**, 아니면 JSI binding을 직접 만들어야 하는지. react-native-runtimes와 react-native-sandbox가 Expo Modules JSI module을 둘째 runtime에 까는지 본다(Android dev build, emulator 필요).
3. expo-sqlite `SQLiteSession`을 실제 기기(iOS, Android)에서 써 보기: changeset bytes가 `node:sqlite`와 서로 apply되는지(같은 SQLite format이라 될 것으로 본다), 늘 REPLACE에 pre-pass를 더해 맞는지.
4. App Store: guideline 4.7은 "HTML5 and JavaScript mini apps"를 허용하지만, 2.5.2는 기능을 바꾸는 code를 내려받아 실행하는 것을 막는다. 4.7.2는 그 software에 native platform API를 여는 것을 Apple의 사전 허락 없이 못 하게 한다([guidelines](https://developer.apple.com/app-store/review/guidelines/)). 사용자 앱 backend를 Hermes에서 돌리는 것이 4.7에 드는지, 위젯·위치 같은 폰 기능 command(roadmap 단계 7)가 4.7.2에 걸리는지는 심사로만 안다. 제품 방향에 걸린 위험이라 planner가 사람에게 올릴 일이다.
5. Android dev build에서 Expo 껍데기 + 둘째 runtime + SQLite의 크기와 기동 시간.
