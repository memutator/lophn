# storage-errors

ledger 저장 오류의 글에 원인(disk full, locked, corrupt, io)을 싣는다. corrupt면 그 연결을 fault로 만들어 다시 쓰지 않게 한다(writer 연결이면 `core-lifetime`이 core를 끝낸다).

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/storage/ledger/{sqlite,tx,executor,reader-connection,reads}.ts`
  - `packages/core/storage/ledger/tx_test.ts`(새 file)
  - `packages/core/apps/write-link.ts`
- 읽을 것:
  - 계획 README "정한 것"의 "저장소 오류는 원인(disk full, locked, corrupt, io)을 오류 글에 싣는다"
  - `project-docs/products/roadmap/failure-hardening.md`: runtime #27·#33의 화면 쪽(종류별 toast)과 #26(a)(주기 backup)는 넣지 않는다
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/storage`(boundary `storage`), `packages/core/apps`(`apps`)
- 계약:
  - 쓰는 것: `LedgerConnection.fault()`·`failed()`(`packages/core/storage/ledger/sqlite.ts`). 공통 오류 코드는 그대로 `unavailable`이다. `LophnError.details`는 쓰지 않는다(읽는 쪽이 없다).
  - 내놓는 것: writer 연결의 corrupt는 `connection.fault()`로 끝난다. `core-lifetime`이 `packages/core/storage/ledger/writer-worker.ts`에서 `connection.failed()`를 보고 core를 끝낸다. 이 task는 `writer-worker.ts`를 고치지 않는다.

## 할 일

1. 원인 분류. 지금은 `packages/core/storage/ledger/sqlite.ts`의 `isStorageUnavailable`이 disk full, 잠금, 깨짐, I/O를 모두 같은 참으로만 돌려줘 모든 자리가 같은 글 `ledger에 기록할 수 없다`를 낸다.
   - `isStorageUnavailable` 옆에 `storageReason(thrown): "disk full" | "locked" | "corrupt" | "io"`를 둔다. `isStorageUnavailable`이 참인 값만 받는다. 판정은 지금 표(`STORAGE_CODES`의 primary code `errcode & 255`, `STORAGE_NAMES`, `STORAGE_MARKERS`)를 그대로 나눈다: 13(`SQLITE_FULL`, "database or disk is full") → `disk full`, 5·6(`BUSY`, `LOCKED`, "database is locked") → `locked`, 11·26(`CORRUPT`, `NOTADB`, "disk image is malformed") → `corrupt`, 그 밖(`IOERR`, `READONLY`, `CANTOPEN`, `PROTOCOL`, 남은 marker, `ConnectionUnavailable`) → `io`.
   - 글 꼴은 `<지금 글>: <원인>`이다. 예: `ledger에 기록할 수 없다: disk full`.
2. writer transaction(`packages/core/storage/ledger/tx.ts`). 지금 `storageFailure()`(`settle`, `createTx`의 `totalChanges`, `sqlFailure`가 쓴다)가 원인 없는 `ledger에 기록할 수 없다`를 낸다. corrupt여도 연결을 계속 쓴다.
   - `storageFailure()`가 1의 원인을 글에 싣는다.
   - corrupt로 분류된 실패가 한 번이라도 있었던 `runTransaction`은 돌아가기 전에(commit하지 않은 채, rollback 시도 뒤) `connection.fault()`를 부른다. `createTx`는 연결을 모르므로 분류 결과를 `runTransaction`에 알릴 길을 둔다(예: `createTx`에 `onCorrupt` callback을 넘긴다). `catch` 갈래는 `thrown`을 바로 본다.
   - `rollback()` 실패의 `UNAVAILABLE`도 그 throw의 원인을 싣는다(연결은 지금처럼 fault). 이미 fault된 연결의 조기 거절(`connection.failed()`)은 원인을 모르니 지금 글 그대로 둔다.
3. command 실행기(`packages/core/storage/ledger/executor.ts`). `executeCommand` 바깥 `catch`의 `isStorageUnavailable(thrown)` 갈래와 `readOwnResult`의 `catch`(`ledger를 읽을 수 없다`)가 원인을 싣고, corrupt면 `connection.fault()`를 부른다. `readOwnResult` 앞의 `connection.failed()` 거절은 그대로다.
4. reader(`packages/core/storage/ledger/reader-connection.ts`, `packages/core/storage/ledger/reads.ts`). 지금 `readerStorage()`가 `ReaderStorageError("reader storage unavailable")`를 던지고 `reads.ts`의 read 처리 `catch`가 그것을 원인 없는 `reader 저장소를 사용할 수 없다`로 바꾼다.
   - `ReaderStorageError`(`reads.ts`)에 원인을 싣고(`readerStorage`가 `storageReason(error)`로 채운다) `reads.ts`의 그 갈래가 `reader 저장소를 사용할 수 없다: <원인>`으로 낸다. 원인 없이 던지는 다른 `ReaderStorageError`(snapshot을 닫지 못함 등)는 지금 글 그대로다.
   - reader는 read-only이고 pool이 격리·재기동을 맡으므로 fault하지 않는다.
5. apps write link(`packages/core/apps/write-link.ts`). core main thread가 따로 쥔 연결이고 `transaction()`의 `catch`가 모든 throw를 `ledger에 기록할 수 없다`로 바꾼다.
   - `catch`에서 `isStorageUnavailable(thrown)`이면 원인을 싣는다. 그 밖의 throw는 지금 글 그대로다.
   - corrupt면 rollback 뒤 `connection.fault()`를 부른다. `storageReason`·`isStorageUnavailable`은 `packages/core/storage/ledger/sqlite.ts`에서 바로 import한다(`ledger/mod.ts`는 이 task 것이 아니다. apps에는 이미 `storage/ledger/after-commit.ts`를 바로 부르는 곳이 있다).

### 정한 것

- 원인은 `details`가 아니라 글(message)에 싣는다. README가 "오류 글에 싣는다"로 정했고 지금 `details`를 읽는 화면이 없다. 화면을 새로 만들지 않는다.
- 원인 이름은 README의 네 낱말을 그대로 쓴다. 분류가 안 되는 저장 오류는 `io`다.
- write link의 corrupt는 자기 연결만 fault한다. core를 끝내려면 `packages/core/main/daemon/wiring/apps.ts`(이 계획의 누구 것도 아니다)에 길을 내야 한다. 같은 file을 쓰는 writer Worker가 다음 쓰기에서 같은 corrupt를 만나 core를 끝낸다.
- runtime #26(a)(주기 backup)와 `packages/core/storage/migration/` 쪽 기동 검사는 고치지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "corrupt(`errcode` 11)로 실패한 `runTransaction` 뒤 연결이 fault되고, 다음 `runTransaction`은 SQL을 돌리지 않고 `unavailable`로 끝난다". `tx_test.ts`에 가짜 `LedgerConnection` 하나로 쓴다(예: `exec("begin immediate")`가 `{errcode: 11}`을 단 Error를 던진다). SQLite file을 실제로 깨지 않는다. 글 문구는 test하지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.

- 등록할 것: 새 test file `packages/core/storage/ledger/tx_test.ts`. lead가 `project-docs/flows/tests/core-rest.yaml`에 줄을 더한다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음".
- **알려진 미완 동작**: 예를 들어 write link의 corrupt가 core를 끝내지 않는 것. 없으면 "없음".
