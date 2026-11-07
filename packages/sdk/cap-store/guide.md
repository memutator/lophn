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
  `openStore`를 다시 불러도 같은 연결이다.
- `store.db` — 앱 자신의 `node:sqlite` `DatabaseSync`. SQL은 앱이 쓴다.
- `store.schema()` — 지금 schema 번호. migration을 적용한 적이 없으면 0이다.
- `store.migrate(steps, { target? })` — `{ from, to, sql, loss }`
  단계(`Migration`)를 현재 schema에서 target까지 연속 경로로 적용한다. 단계마다
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
- `store.transaction(work)` — 동기 작업 하나를 한 transaction으로 묶는다.
- write·external tool과 앱 시작이 도는 동안의 변경은 runtime이 SDK 훅으로
  changeset을 떠서 core에 넘긴다. 앱 code가 따로 할 일은 없다. 모든 표에 PRIMARY
  KEY를 둔다.
- DB를 열지 못하면 `CapabilityError`(`unavailable`)다.
- type: `Store`, `Migration`, `OpenStoreOptions`, `CapabilityError`

## 요구 permission

없다. 자기 data 영역은 앱 실행에 기본으로 열린다.

## peer 의존

정확한 peer는 없다(단독 사용).

## 예제

```ts
import { openStore } from "@lophn/cap-store";

const store = openStore();
store.db.prepare("insert into todo (title) values (?)").run("우유 사기");
```

## version 정책

판마다 바뀐 점과 앱 code를 옮기는 법은 `migrate-sdk` skill의 메모 `<이름>-<판>.md`(예: `declaration-4.0.0.md`)에 있다(이 SDK의 판을 올리면 그 메모를 같이 쓴다).

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
