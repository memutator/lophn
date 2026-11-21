# @lophn/cap-store

## 목적

앱이 자기 data 영역의 SQLite DB를 여는 얇은 client와 migration 도우미다. 추가
permission은 없다. 앱 process는 권한을 막지 않으므로 기본 경로는 data 영역이지만,
밖의 파일도 OS가 허락하면 열린다.

## 공개 API와 type

```ts
import { openStore } from "@lophn/cap-store";
```

- `openStore({ path?, host?, now? })` — 기본은 `<data 영역>/app.sqlite`이다.
  `Store`를 돌려준다. 앱 data는 앱 DB 하나라서 process 안의 연결도 하나이고,
  `openStore`를 다시 불러도 같은 연결이다. 앱이 폰에서 돌 때는 host가 DB를 열어 준다.
- `store.db` — 앱 자신의 DB(`StoreDb`)다. SQL은 앱이 쓴다. `exec(sql)`과
  `prepare(sql)`의 `get(...params)`, `all(...params)`, `run(...params)`만 있다.
  params는 `null | number | bigint | string | Uint8Array`를 위치 순서로 넘긴다
  (`@name` 같은 이름 붙인 params와 Node 전용 method는 없다. 앱이 폰에서도 도는 길이
  막히지 않게 하려는 것이다). `run`은 `{ changes, lastInsertRowid }`를 돌려준다.
- `store.schema()` — 지금 schema 번호. migration을 적용한 적이 없으면 0이다.
- `store.migrate()` — release의 `migrations/<from>-<to>.sql`을 현재 schema에서
  최신까지 적용한다. 앱의 schema를 맞추는 보통의 길이다. 파일을 직접 읽지 않는다.
  lophn이 돌릴 때는 lophn이 단계를 주고, 앱 test는 앱 폴더(지금 폴더)의
  `migrations/*.sql`을 읽는다.
- `store.migrate(steps, { target? })` — `{ from, to, sql, loss }`
  단계(`Migration`)를 직접 줄 때다. 현재 schema에서 target까지 연속 경로로 적용한다. 단계마다
  한 transaction이고 실패한 단계는 rollback한다. 단계에서 새로 만든 표에 PRIMARY
  KEY가 없으면 그 단계가 `invalid_input`으로 실패한다(write의 변경은 SQLite
  session이 changeset으로 뜨는데 session은 PRIMARY KEY 없는 표의 변경을 기록하지
  못하고, 그러면 rewind가 그 표를 되돌릴 수 없다). 개발·test·preview에서 쓴다.
  운영(live) 앱은 schema를 바꾸지 못한다. 운영의 변경은 activation 때 data
  worker가 backup을 뜬 뒤 같은 단계로 적용한다. 공개한 단계는 고치지 않고 새
  단계를 더한다.
- `migrationOfSql(from, to, sql)` — 단계 파일의 SQL에서 `Migration`을 만든다.
  파일 맨 위 `-- loss: drop_table 표`, `-- loss: drop_column 표.열`,
  `-- loss: narrow_type 표.열` 줄이 손실 선언이다.
- `store.transaction(work)` — 동기 작업 하나를 한 transaction으로 묶는다. 던지면
  이 작업만 rollback한다. 겹쳐 불러도 된다. SQL로 `BEGIN`/`COMMIT`을 직접 쓰지
  않는다: 폰과 sync 앱에서는 호출 하나가 이미 transaction 안에서 돈다.
- `newId(prefix?)` — 기기가 달라도 겹치지 않는 text id다(ULID 꼴이라 만든 시각
  순으로 정렬된다). 두 기기에서 쓰는 앱의 표는 `integer primary key`의 자동
  번호 대신 `text primary key`에 이 id를 넣는다.
- write·external tool과 앱 시작이 도는 동안의 변경은 runtime이 SDK 훅으로
  changeset을 떠서 core에 넘긴다. 앱 code가 따로 할 일은 없다. 모든 표에 PRIMARY
  KEY를 둔다.
- DB를 열지 못하면 `CapabilityError`(`unavailable`)다.
- 앱 file(아래 "앱 file")을 넣고 읽는 `putAppFile`, `readAppFile`, `hasAppFile`.
- type: `Store`, `StoreDb`, `StoreStatement`, `Migration`, `OpenStoreOptions`, `CapabilityError`, `AppFileHandle`,
  `AppFileMeta`, `AppFileOptions`

## 앱 file

앱 file은 사진 같은 바뀌지 않는 bytes다. 이름은 내용의 sha256이고, 앱 data 영역 안 `files/`에 있다(앱을 지우면 같이 지워진다).
file 하나는 64 MiB(`APP_FILE_MAX_BYTES`)까지다. 지우는 길과 용량 한도가 없고 같은 bytes를 다시 넣어도 하나다. file은 바뀌지
않으므로 rewind가 되살린 row의 손잡이가 늘 살아 있다. 사람에게는 이렇게 말한다: 앱에서 사진을 지워도(row를 지워도) 그 사진의 bytes는 앱을 지울 때까지 컴퓨터에 남는다. 화면과 operation에는 bytes가 아니라 손잡이(`AppFileHandle`:
`{ file, type, size, name?, width?, height? }`, 작은 JSON)를 넘기고, 화면은 `@lophn/app-ui`의 `useAppFile`로 그린다.

- `putAppFile(bytes, { type, name? })` — `Uint8Array`를 file로 넣고 손잡이를 돌려준다. `type`은 content type(127자까지),
  `name`은 255자까지다. 64 MiB를 넘으면 `invalid_input`이다. 이미 있는 file이면 아무것도 쓰지 않는다.
- `readAppFile(handleOrSha256)` — 손잡이나 sha256으로 bytes(`Uint8Array`)를 읽는다. 없으면 `not_found`다.
- `hasAppFile(handleOrSha256)` — 있는지 `boolean`으로 답한다.
- 폰에서 도는 backend(`runs_on`에 `phone`)는 손잡이를 받아 row에 두고 넘기기만 한다. 세 함수 모두 `unavailable`이다.
- 앱 file이 생기는 길은 둘이다: 컴퓨터의 backend가 `putAppFile`로 넣거나, 폰 화면이 `@lophn/cap-phone`의 사진·file 기능(`capturePhoto`,
  `pickPhotos`, `pickFiles`)으로 받아 손잡이를 operation에 넘긴다. 컴퓨터에서 도는 앱은 폰이 file을 컴퓨터에 올린 뒤에 손잡이를 주므로
  backend가 받은 손잡이는 곧바로 `readAppFile`로 읽힌다.
- 앱 process 안에서만 쓴다(없으면 `unavailable`). 앱 test는 `{ dataPath }`로 영역을 준다. preview의 영역에는 sample file 둘(PNG
  그림 하나와 짧은 글 하나)이 들어 있다.

```ts
import { putAppFile, readAppFile } from "@lophn/cap-store";

const handle = await putAppFile(bytes, { type: "image/png", name: "receipt.png" });
// handle을 operation의 결과나 DB row에 둔다.
const again = await readAppFile(handle);
```

## 요구 permission

없다. 자기 data 영역은 앱 실행에 기본으로 열린다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { newId, openStore } from "@lophn/cap-store";

const store = openStore();
await store.migrate();
store.transaction((db) => {
  db.prepare("insert into todo (id, title) values (?, ?)").run(
    newId("tdo"),
    "우유 사기",
  );
});
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
