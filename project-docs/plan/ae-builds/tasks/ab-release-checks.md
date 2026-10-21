# ab-release-checks

release 준비가 그 자리에서 할 data 검사 둘을 함수로 만든다: 의존성(bundle의 import가 선언한 의존을 정확한 version으로 가리키는가)과 migration(activation과 같은 `migrateAppDatabase`를 fixture DB에 걸어 새 schema까지 가는가). test runner의 `dependencies`, `migration_empty`, `migration_upgrade` 검사를 옮긴 것이다(README "release 준비는 한 단계다", roadmap "test runner의 data 검사는 release 준비 안에서 바로 한다"). 이 task는 부르는 곳을 붙이지 않는다. ab-release-prepare가 붙인다. blueprint와 handler 일치는 preview launcher로 보므로 여기 없다.

정한 것(flesh):
- `checks.ts`는 core module graph에 넣지 않는다. `packages/core/apps/releases/mod.ts`에서 내보내지 않고 core file이 import하지 않는다. 이유: 앱 DB를 여는 `packages/core/apps/data/worker/db.ts`는 "core·supervisor는 이 모듈을 import하지 않는다"(머리 주석)이고, 앱이 쓴 migration SQL은 권한을 좁힌 process에서만 돈다. 부르는 곳은 release 준비 자식(`packages/core/main/worker/release-job.ts`) 하나다(ab-release-prepare). Deno는 권한을 좁힌 process에서 `node:sqlite`의 `ATTACH`와 `VACUUM INTO`를 막는다("too many attached databases - max 0", deno 2.9.7에서 확인). `-A`로 도는 process에서는 막지 않는다.
- `previousSchema`가 `dataSchema`보다 크면 떨어뜨린다. 이유: activation의 `migrationPath`가 "data schema does not move backward"로 거절하므로 그 release는 올라갈 수 없다(`packages/core/apps/data/worker/schema.ts` 49-55). 계약은 작은 쪽만 말해 flesh가 더했다.
- fixture DB의 `applied_at`과 결과 칸(`release`, `attempt`)은 고정 값이다. 버리는 DB라 의미가 없다(test runner의 `app-driver.ts`가 같은 모양이다). 그래서 Clock을 받지 않는다.

- 단위: release (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/apps/releases/prepare/checks.ts`(새 file)
  - `packages/core/apps/releases/prepare/checks_test.ts`(새 file)
- 읽을 것:
  - 계획: `project-docs/plan/ae-builds/README.md`의 "release 준비는 한 단계다"(의존성은 manifest로, migration은 activation과 같은 `migrateAppDatabase`를 fixture DB에 걸어서), "뼈대 검토에서 정한 것"의 첫 줄(검사 실패는 오류 code가 아니라 결과다. 그래서 `reason`이 agent에게 닿는 글이다)
  - roadmap: `project-docs/products/roadmap/problem-ticket.md`의 "정한 것(agent)" 가운데 "test runner의 data 검사는 release 준비 안에서 바로 한다", "단계"의 test 목록("migration 검사에 떨어진 release는 activate되지 않는다"), "끝남 기준" 마지막 줄
  - architecture: `project-docs/architecture/activation.md`의 "왜 이 모양인가" 마지막에서 둘째 줄(core는 앱 DB를 열지 않는다), "지키는 것"의 "data 손실은 migration 파일 머리의 `-- loss:` 줄이 유일한 출처다"
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `app-releases`, `app-data`; `project-docs/module-catalog.yaml`의 `packages/core/apps`
  - 코드(줄은 main `dd956b49f`)
    - 옮길 의존성 검사: `packages/core/problems/tests/app-test/generate.ts`의 `EXACT_VERSION`, `REGISTRY_IMPORT`, `SDK_COPY`(102-104), `checkDependencies`(108-155. 129-140의 `frozen.sdk_dependencies` hash 비교는 frozen test 몫이라 옮기지 않는다). 그 test `generate_test.ts`(1-48)
    - 옮길 migration 검사: `packages/core/problems/tests/work/app-driver.ts`의 `migrate`(585-678. 빈 DB와 이전 schema DB 두 갈래), `scripts`(385-405), `seedData`(261-286). 이 driver는 bundle의 `migrations/` 폴더를 훑지만 새 함수는 받은 `dataChanges`로 찾는다.
    - activation 코드: `packages/core/apps/data/worker/migrate.ts`의 `scriptFromBundle`(56-79. bundle 안 `migrations/<from>-<to>.sql`을 읽고 hash를 대조한다), `migrateAppDatabase`(89-177. 단계가 실패하면 `backupPath`의 backup으로 되돌리고 `restored: true`다. backup이 없으면 되돌리기가 실패해 err다. 끝난 뒤 무결성과 schema를 본다), `db.ts`의 `openAppDatabase`(55)와 `applyStep`(96-136. 새 표에 PRIMARY KEY가 없으면 단계 전체를 되돌린다), `backup.ts`의 `createAppBackup`(46-81. DB와 backup이 `dataArea` 안이어야 하고 backup은 `<dataArea>/backups/<name>`이다), `schema.ts`의 `migrationPath`(49-74), activation이 부르는 모양 `job.ts`의 `runMigrate`(135-167)
    - 값: `packages/protocol/apps/releases.ts`의 `dataChangeSchema`(52-62. `script_hash`는 64자 hex), `bundleManifestSchema`(86-106. `dependencies`의 `source`는 `sdk | package | npm | jsr`), `packages/core/apps/releases/activation/desired.ts`의 `dataChangesOf`(70-106. 부르는 쪽이 이것으로 `dataChanges`를 만든다)
- 계약:
  - 쓰는 것: `migrateAppDatabase`, `scriptFromBundle`, `openAppDatabase`, `createAppBackup`(`packages/core/apps/data/worker/`), `BundleManifest`·`DataChange`(`packages/protocol/apps/releases.ts`)
  - 내놓는 것(`checks.ts`):
    - `type CheckOutcome = { ok: true } | { ok: false; reason: string }`. `reason`은 agent가 읽고 고칠 영어 한두 문장이다.
    - `checkDependencies(input: { dependencies: BundleManifest["dependencies"]; imports: Record<string, string> }): CheckOutcome`: import map의 항목마다 선언한 의존(sdk 사본, package, npm, jsr)을 정확한 version으로 가리킨다. 지금 `packages/core/problems/tests/app-test/generate.ts`의 `checkDependencies`와 같은 판정이다.
    - `checkMigration(input: { bundleRoot: string; dataChanges: readonly DataChange[]; dataSchema: number; previousSchema: number | null; area: string }): Promise<CheckOutcome>`: 빈 DB(schema 0)에서 `dataSchema`까지, 그리고 `previousSchema`가 있고 `dataSchema`보다 작으면 그 schema의 DB(bundle의 앞 단계로 만든다)에서 `dataSchema`까지 migration한다. 둘 다 끝난 schema가 `dataSchema`이고 무결성 확인이 통과하고 되돌림(restore)이 없어야 통과다. `previousSchema`가 `dataSchema`보다 크면 떨어진다(위 "정한 것"). `area`는 부르는 쪽이 주는 빈 임시 폴더이고 그 밖에는 쓰지 않는다. 지우는 것도 부르는 쪽이다.
  - test runner의 원본(`packages/core/problems/`)은 지우지 않는다(ab-runner-delete).

## 할 일

1. `checkDependencies`를 옮긴다(근거: README "의존성은 manifest로").
   - `generate.ts` 102-155의 정규식 셋과 판정을 그대로 옮긴다: 정확한 version이 아닌 의존(`inexact`), 선언한 의존을 가리키지 않는 import(`undeclared`). 앱 안 상대 경로와 `file:` 값은 sdk 사본 꼴(`./sdk/[@me/]<이름>/<version>/`)일 때만 본다.
   - frozen test의 hash 비교(129-135)와 `evidence`는 옮기지 않는다.
   - `reason`은 걸린 이름을 싣는다. 예: `dependencies without an exact version: x@^1.2. Pin each one to an exact version.`, `imports that do not point at a declared dependency with its exact version: @me/other. Declare the package with an exact version in the app's imports.` 넘치는 목록은 앞 몇 개만 싣고 수를 덧붙인다.
2. `checkMigration`을 쓴다(근거: README "migration은 activation과 같은 `migrateAppDatabase`를 fixture DB에 걸어서").
   - `dataSchema`가 0이면 바로 통과다(DB를 쓰지 않는 앱).
   - `dataChanges`마다 `scriptFromBundle(bundleRoot, change)`로 script를 읽는다. 못 읽거나 hash가 다르면 떨어진다(reason에 단계 `from-to`와 message).
   - 한 번 돌리기(`area` 안 하위 폴더 하나가 `dataArea`다): 그 폴더에 `app.sqlite`를 `openAppDatabase`로 만들고 닫는다 → `createAppBackup(dataArea, db, <이름>)` → `migrateAppDatabase({ dataArea, databasePath: db, backupPath: <dataArea>/backups/<이름>, targetSchema, scripts, appliedAt: 고정 값, result: { release, attempt: 고정 id, invocation: null } })`. err면 그 message로, `restored`면 "a step failed and was rolled back"으로 떨어진다. 떨어진 reason에는 출발과 도착 schema를 싣고, 되돌림이면 흔한 원인(SQL 오류, PRIMARY KEY 없는 새 표)을 한 마디 덧붙인다. 단계 SQL의 오류 글은 `applyStep`이 버려 싣지 못한다(보고의 "알려진 미완 동작").
   - 빈 DB: `${area}/empty`에서 0 → `dataSchema`.
   - 이전 schema: `previousSchema`가 0보다 크고 `dataSchema`보다 작으면 `${area}/upgrade`에서 먼저 0 → `previousSchema`로 만든다. 거기 닿지 못하면(`migrationPath`가 그 schema에 서지 않음, 단계 실패) "the migrations do not reach schema N, the schema of the active release"로 떨어진다. 닿으면 그 DB의 backup을 새 이름으로 만들고 `previousSchema` → `dataSchema`를 돌린다.
   - `previousSchema`가 `dataSchema`보다 크면 돌리지 않고 떨어진다.
3. 위험 test(아래 "끝남"). `checks_test.ts`는 순수 함수 둘과 임시 폴더만 쓴다. subprocess, Worker, 서버를 띄우지 않는다.
   - migration: 경우마다 `Deno.makeTempDir`로 bundle 폴더(`migrations/<from>-<to>.sql`)와 `area`를 만들고, `DataChange`는 file byte의 `sha256Hex`로 만든다. 표로 돈다.
     - 맞는 bundle: `0-1.sql` `CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`, `1-2.sql` `ALTER TABLE notes ADD COLUMN done INTEGER NOT NULL DEFAULT 0`, `dataSchema` 2, `previousSchema` 1 → `ok: true`
     - 단계 실패: 같은 `0-1.sql`, `1-2.sql`이 `ALTER TABLE missing ADD COLUMN x INTEGER` → `ok: false`
     - PRIMARY KEY 없는 표: `0-1.sql` `CREATE TABLE notes (body TEXT)` → `ok: false`
     - 빈 DB에서 닿지 못함: 단계가 `1-2.sql` 하나, `dataSchema` 2, `previousSchema` null → `ok: false`
     - active release의 schema가 길 위에 없음: 단계가 `0-2.sql` 하나, `dataSchema` 2, `previousSchema` 1 → `ok: false`
     - 판정: `ok`가 위와 같고, 떨어진 경우 `reason`이 비지 않는다.
     - 자원: 임시 폴더는 `finally`에서 지운다. 열린 DB가 남으면 `sanitizeResources`가 떨어뜨린다(끄지 않는다).
   - 의존성: `generate_test.ts`의 표(@me 선언, 내장 SDK, 선언 안 한 @me)를 `checkDependencies`로 옮긴다. 판정은 `ok`다. 이유: @me 설치 경로를 못 읽어 맞는 앱이 떨어지던 것을 고친 적이 있고(commit `bf4b23bb3`), 틀리게 떨어지면 App Engineer가 우회할 길 없이 release가 막힌다. 옛 test는 test runner와 함께 지워진다(ab-runner-delete).

## 끝남

- `deno task check`가 통과한다.
- 바꾼 곳의 test가 통과한다: `deno test --no-check packages/core/apps/releases/prepare`
- 위험 test
  - "migration 단계가 실패하거나 schema에 닿지 못하는 bundle은 migration 검사에서 떨어진다". roadmap test "migration 검사에 떨어진 release는 activate되지 않는다"의 판정 부분이다. 떨어진 준비가 release 행을 남기지 않는 것은 ab-release-prepare가 준비의 순서(검사가 모두 통과한 뒤에만 기록)로 지킨다.
  - "선언한 @me package와 내장 SDK의 import는 의존성 검사를 통과하고 선언하지 않은 @me import는 떨어진다"(옮긴 test)
- 남지 않음: 없음(새 file). 대신 core graph에 들지 않았는지 본다: `git grep -n "prepare/checks" -- packages ':!packages/core/apps/releases/prepare'`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음
- 안 쓰게 된 export: 없음(test runner 쪽 원본은 ab-runner-delete가 지운다)
- 정한 것: 문서에 답이 없어 worker가 정한 것(reason 글의 모양 포함)
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음". 예: 단계가 실패한 이유(SQL 오류 글, PRIMARY KEY 없는 표 이름)는 `db.ts`의 `applyStep`과 `migrateAppDatabase`가 버려서 reason에 싣지 못한다. 실으려면 `migrateAppDatabase`가 실패한 단계와 message를 돌려줘야 한다.
