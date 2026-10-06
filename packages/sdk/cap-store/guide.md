# @lophn/cap-store

## 목적

앱이 자기 data 영역의 SQLite DB를 여는 얇은 client와 migration 도우미다
(apps/sdk#R24). 추가 permission은 없다. 앱 프로세스는 자기 data 영역에만
읽기·쓰기 flag를 가지며 다른 앱 DB와 플랫폼 파일은 열 수 없다.

## 공개 API와 type

```ts
import { openStore } from "@lophn/cap-store";
```

- `openStore({ path?, host?, now? })` — 기본은 `<data 영역>/app.sqlite`이다.
  `Store`를 돌려준다.
- `store.db` — 앱 자신의 `node:sqlite` `DatabaseSync`. SQL은 앱이 쓴다.
- `store.schema()` — 지금 schema 번호. migration을 적용한 적이 없으면 0이다.
- `store.migrate(steps, { target? })` — `{ from, to, sql }` 단계를 현재
  schema에서 target까지 연속 경로로 적용한다. 단계마다 한 transaction이고 실패한
  단계는 rollback한다. 개발·test·preview에서 쓴다. 운영(live) 앱은 schema를
  바꾸지 못한다. 운영의 변경은 activation 때 data worker가 backup을 뜬 뒤 같은
  단계로 적용한다. 공개한 단계는 고치지 않고 새 단계를 더한다.
- `store.transaction(work)` — 동기 작업 하나를 한 transaction으로 묶는다.
- 자기 data 영역 밖 경로는 `CapabilityError`(`forbidden`, `fs.write`와 경로)다.
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

- **patch**: API·동작을 유지한 내부 수정·문서·예제 개선이다.
- **minor**: 기존 API를 유지한 추가다.
- **major**: API·동작의 제거나 변경이다. 요구 permission의 증가도 major다.
