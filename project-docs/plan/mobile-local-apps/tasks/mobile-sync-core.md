# mobile-sync-core

**opus high.** sync core를 짓는다: 앱 DB 두 사본(컴퓨터와 폰)을 column 단위 last-write-wins로 맞추는 plain TypeScript module 하나. 컴퓨터의 app runtime(`mobile-sync-runtime`)과 폰 host(`mobile-local-sync-phone`)가 같은 file을 쓴다. IO는 driver interface(`SyncDb`) 하나로만 하고 Node(`node:sqlite`)와 폰(Hermes, native module)에서 같이 돈다. spike의 원형과 수렴 사례 11개에서 시작한다.

- 단위: sync (wave 1)
- 선행: 없음. 다른 계획의 land를 기다리지 않는다
- 소유(이 task만 고친다):
  - `packages/protocol/apps/sync`(새 폴더: `changeset.ts`, `clock.ts`, `tables.ts`, `local.ts`, `apply.ts`, `snapshot.ts`, `reexpress.ts`, `migrate.ts`, `mod.ts`와 test. 이름은 바꿔도 된다)
  - `packages/base/changeset-invert.ts`(changeset 읽기를 export하는 만큼)
- 읽을 것:
  - spike 판정: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-spike.md`의 "Check 3"(사례, 고친 설계: `col=-1`이 row의 존재 clock, 찍기와 적용의 경합), "Check 5"(clock 표 크기와 고른 꼴)
  - spike 원형(읽기만, 옮겨 쓰고 이 task의 file로 만든다): `/home/pyosechang/projects/lophn-worktrees/spike-local-apps/mobile/guest/sync/{changeset.ts,core.ts,scenario.ts}`, `node/{nodedb.ts,check3.ts,check5.ts}`
  - 조사: `/home/pyosechang/projects/lophn/reports/mobile-program/local-apps-survey.md` 2(c)(단위, 규칙, 다시 표현), 6의 위험 test 1·2
  - 계획 `README.md` "정한 것"(clock 표 꼴, outbox와 한 transaction의 폰 쪽 꼴)
  - 지금 changeset 읽기: `packages/base/changeset-invert.ts`(rewind가 쓴다. `packages/core/apps/rewind/run.ts`, test는 `rewind_test.ts`)
  - 컴퓨터의 migration 적용(host migrator의 본보기): `packages/core/apps/data/worker/migrate.ts`의 `migrateAppDatabase`, `scriptFromBundle`, 표 `lophn_data_schema`(`packages/sdk/cap-store/connection.ts`의 `SCHEMA_TABLE`), `packages/protocol/apps/activation/migration-sql.ts`(`migrationOfSql`, `-- loss:`)
- 계약:
  - 쓰는 것: 없음(zod를 쓰지 않는다. import는 `packages/base`의 순수 file만. 폰 앱이 Metro로 이 폴더를 바로 읽고 app process entrypoint도 상대 path로 읽는다)
  - 내놓는 것(`mod.ts`. 뒤 task가 이것만 쓴다):
    - `SyncDb`: `exec(sql)`, `all(sql, params?)`, `run(sql, params?)`, `session(): {changeset(): Uint8Array; close(): void}`(user 표 전부에 거는 SQLite session. 다시 표현할 때만 쓴다). params는 `null | number | bigint | string | Uint8Array`의 배열. Node 쪽 adapter(`node:sqlite` `DatabaseSync` 위)도 이 폴더에 둔다(test와 runtime이 쓴다)
    - 숨은 표(`ensureSyncTables(db)`가 만든다. 이름은 모두 `lophn_sync_`로 시작한다. cap-store session과 guest authorizer가 이 접두사로 거른다):
      - `lophn_sync_row(tbl, pk BLOB, hlc INTEGER, deleted INTEGER, PRIMARY KEY(tbl, pk)) WITHOUT ROWID`: row의 마지막 insert나 delete의 clock
      - `lophn_sync_col(tbl, pk BLOB, col INTEGER, hlc INTEGER, PRIMARY KEY(tbl, pk, col)) WITHOUT ROWID`: insert 뒤에 바뀐 column만
      - `lophn_sync_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)`: node, 마지막 HLC, cursor, release
      - `lophn_sync_outbox(id TEXT PRIMARY KEY, operation TEXT NOT NULL, started_at TEXT NOT NULL, changeset BLOB NOT NULL, hlc INTEGER)`: 폰에서만 쓴다. `hlc`가 null이면 아직 clock을 찍지 않은 줄이다. **native module(`mobile-local-db-native`)이 앞의 네 칸을 C++에서 쓴다. 칸 이름과 뜻을 바꾸면 그 task가 따라 바꿔야 한다**
    - HLC: SQLite INTEGER 하나로 둔다. 한 replica 안에서 늘 커지고, 두 replica의 clock이 같아도 모든 replica가 같은 쪽을 고르게 한다(node 몫을 정수에 넣거나 같은 값일 때의 고정 규칙). JS number로 안전하지 않으면 bigint로 일관되게 다룬다. `Clock`: `next(nowMs)`, `observe(hlc)`, state 표에 읽고 쓰기
    - `stampLocal(db, changeset, hlc)`: 이 replica가 한 변경의 clock을 쓴다(컴퓨터 runtime이 write와 같은 transaction에서 부른다)
    - `stampOutbox(db, clock)`: outbox에서 `hlc`가 null인 줄을 id 순서로 찍는다(폰 host가 부른다)
    - `applyRemote(db, changes: {hlc, changeset}[], clock)`: 들어온 변경을 규칙대로 만든 SQL로 적용한다. 부르는 쪽이 연 transaction 안에서 돈다(transaction과 `foreign_keys` 끄기를 부르는 쪽이 하는지 이 함수가 하는지는 정하고 적는다. 컴퓨터 runtime은 같은 transaction 안에서 session으로 effective changeset을 뜬다)
    - `adoptSnapshot(db, {node, cursor, release})`: 다른 replica의 snapshot file을 내 사본으로 받는다(state의 node·cursor를 바꾸고 outbox를 비운다. clock 표는 둔다)
    - `reexpress(...)`: 아래 할 일 5
    - `migrate(db, steps, target)`: host migrator. 아래 할 일 6
    - test용 `dumpData(db)`, `dumpClocks(db)`

## 할 일

1. changeset 읽기: `packages/base/changeset-invert.ts`의 reader를 export한다(change마다 table, op, PK 표시, old·new cell). rewind의 `invertAll`은 그 위에 그대로 남고 동작이 같다(`rewind_test.ts`가 통과). spike `changeset.ts`의 PK 부호화(clock 표의 `pk` BLOB)는 이 폴더에 둔다. spike는 PK bytes와 값 type이 Node와 폰에서 같았다(정규화 없음).
2. clock 표를 계획 "정한 것"의 꼴로 바꾼다(spike는 column마다 text clock 줄이라 data의 1.84배였다. 고른 꼴은 insert만 한 data에서 0.21배). 규칙(spike가 11/11로 확인한 것): UPDATE는 들어온 clock이 그 column의 clock(없으면 row clock)보다 클 때만 그 column을 쓴다. row가 없으면 버린다(delete가 이긴다). DELETE는 row clock보다 새로울 때만 적용하고 row clock을 그 값으로, `deleted`를 1로 둔다. 없는 row의 INSERT는 row clock(묘비)보다 새로울 때만. 있는 PK의 INSERT는 모든 column의 UPDATE다. 비교는 엄격히 크다(같은 변경을 두 번 적용해도 그대로다). column clock은 insert 때 만들지 않는다(그 column의 clock은 row clock이다). delete는 그 row의 column clock을 지운다(spike `dropColumnClocks`). 이 줄이기가 수렴을 깨지 않는지는 아래 위험 test가 본다.
3. SQL 적용: spike `core.ts`의 `applyOne`처럼 table마다 `pragma table_info`로 column 이름을 읽어 `INSERT`/`UPDATE … SET`/`DELETE`를 만든다. 정수는 SQL literal로 넣어 driver가 INTEGER와 REAL을 고르지 않게 하고(64-bit 최소값 포함), 빈 blob `X''`가 NULL이 되지 않게 한다(spike가 폰 driver에서 본 일). `lophn_` 표의 change는 건너뛴다.
4. 찍기와 적용의 순서: 폰에서는 write가 outbox 줄과 함께 commit되고 clock은 나중에 찍힌다. `applyRemote`를 부르는 쪽은 같은 transaction의 맨 앞에서 `stampOutbox`를 부른다는 것을 `mod.ts` 맨 위 주석과 함수 주석에 적는다(왜: spike "Check 3"의 마지막 문단의 경합). `stampOutbox`와 `applyRemote`를 한 번에 하는 함수 하나(`applyIncoming`)를 두어 부르는 쪽이 순서를 틀릴 수 없게 해도 된다.
5. 다시 표현(release가 바뀔 때 폰의 안 보낸 변경): 입력은 옛 schema DB의 outbox 줄(changeset), 그 changeset을 local로 migrate한 DB(column 이름으로 값을 읽는 곳), 새 release의 snapshot DB. 각 변경을 table과 column **이름**으로 다시 쓴다: INSERT는 migrate한 DB의 그 row 전부, UPDATE는 바뀐 column의 migrate한 값. migration이 지운 table·column(또는 PK column)의 변경은 버리고 버린 수를 돌려준다. 다시 쓴 변경을 새 snapshot 위에 last-write-wins로 적용하며 `SyncDb.session()`으로 새 changeset을 떠서 outbox 줄을 바꾼다(id와 operation, started_at, hlc는 그대로). 함수는 file을 옮기지 않는다(backup과 file 바꿔치기는 폰 host의 일이다).
6. host migrator: `migrateAppDatabase`의 규칙(단계마다 한 transaction, 실패하면 그 단계 rollback, `lophn_data_schema`에 `sha256:` hash와 함께 남김, PRIMARY KEY 없는 새 표 거절)을 `SyncDb` 위에 옮긴다. 입력은 `{from, to, sql, sha256}[]`과 target이고, sql의 hash가 맞지 않으면 아무것도 하지 않고 실패한다. hash 계산은 부르는 쪽이 주는 함수로 받는다(폰에 `crypto.subtle`이 없을 수 있다).
7. Node adapter와 test(`node --test`, `node:sqlite`): spike `scenario.ts`의 사례를 표로 옮긴다.

## 끝남

- `npm run check`가 통과한다. `packages/protocol/apps/sync`의 file은 zod와 `node:` module을 import하지 않는다(Node adapter와 test file만 예외. adapter는 따로 file로 두어 폰이 import하지 않게 한다).
- 위험 test:
  - "두 replica가 같은 base에서 시작해 서로의 변경을 두 순서로 주고받으면 data dump와 clock dump가 같고, 충돌하지 않는 편집은 잃지 않는다": 같은 column(어느 쪽이 나중이든), 다른 column, 다른 column 두 번 적용, delete 뒤 update, update 뒤 delete, 한 id의 insert/insert, 묘비 대 나중 insert, insert 대 더 새 묘비, type(64-bit 끝값, `-0.0`, `1e308`, 정수와 실수, NULL, 빈 blob과 binary blob, blob PK, real PK, 한글·emoji·따옴표), PK 셋인 표. 그리고 "outbox에 clock 없이 commit된 local 변경이 있을 때 같은 row의 원격 변경을 적용해도 수렴한다"
  - "release가 바뀌어도 안 보낸 변경은 이름으로 살아남고, migration이 지운 table·column의 변경만 버려지며, migration이 실패하면 DB와 outbox가 그대로다"
  - (기존) `rewind_test.ts`가 그대로 통과한다
- clock 표 크기: 10k row(spike `check5.ts`의 data)에서 clock 표가 data보다 작은지 재서 보고한다.
- flows catalog: 이 task가 더하는 test file의 줄은 이 task가 project-docs/flows 에서 고친다(자기 줄만. 꼴은 .claude/skills/flows/SKILL.md). `node tools/flows.ts check`가 통과해야 한다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴. 더해서: `mod.ts`가 내놓는 함수와 type 목록(한 줄씩), HLC 정수의 꼴과 같은 값일 때의 규칙, `applyRemote`가 transaction을 여는지, clock 표 크기 측정값, spike 원형과 다르게 한 곳과 이유.
