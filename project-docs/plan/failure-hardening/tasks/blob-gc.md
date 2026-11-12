# blob-gc

GC가 blob 본문을 지울 때 같은 hash의 목적 기록과 미참조 표지도 지우고, 이미 남은 고아 기록을 정지 유지보수가 한 번에 정한 수만큼 쓸어 지운다. 이슈 `blob-metadata-left-after-gc`를 닫는 task다.

- 단위: core (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/storage/blobs/worker/maintenance.ts`
  - `packages/core/storage/blobs/worker/maintenance_test.ts`(새 file)
- 읽을 것:
  - 계획 README "정한 것"의 "blob 부속 기록은 본문이 없다고 확인된 것만 지운다"
  - 이슈: `project-docs/issues/blob-metadata-left-after-gc.yaml`(`decided`: 줄인다)
  - boundary·module: `project-docs/module-catalog.yaml`의 `packages/core/storage`(boundary `storage`)
- 계약:
  - 쓰는 것: 경로 helper `objectPathFor`, `purposesPathFor`, `unreferencedPathFor`, `isSha256Hash`(`packages/core/storage/blobs/mod.ts`). `GcDeps.removeBlob`(`packages/core/storage/blobs/worker/gc.ts`): `collectGarbage`와 `trimCapacity`가 같이 부른다.
  - 내놓는 것: 없음. 고치는 곳은 `runMaintenanceGc`와 그 deps뿐이다.

## 사실(지금 코드)

- 지우는 곳은 core가 멈출 때 도는 유지보수 child 하나다. `packages/core/main/daemon/wiring/storage.ts`의 `runStoppedMaintenance`가 `packages/core/main/worker/maintenance-entry.ts`를 `MAINTENANCE_TIMEOUT_MS = 30_000` 안에 돌리고, 그것이 `runMaintenanceGc`를 부른다. 새 준비, command, writer가 모두 멈춘 뒤다(`fullyStopped`).
- 24시간마다 도는 GC(`packages/core/main/worker/io.ts`의 `observeBlobGc`)는 관찰만 한다. 그 쪽은 고치지 않는다.
- `trimCapacity`(`gc.ts`)는 설치된 blob 하나라도 할당이 없으면 `unavailable`로 아무것도 지우지 않는다. 할당은 목적 기록에서 온다(`readPurposeRecords` → `assignmentOf`). 그래서 본문이 있는 hash의 목적 기록을 지우면 다음부터 용량 정리가 통째로 멈춘다.
- 사람 data root에 본문 25,046개, 목적 기록 25,279개, 본문 없는 미참조 표지 233개가 있었다(이슈 `now`).

## 할 일

1. `maintenanceObservation`의 `removeBlob`. 지금은 `rm(objectPathFor(...))`로 본문만 지워서 blob 하나를 지울 때마다 목적 기록 `blobs/purposes/<2>/<62>.json`과 미참조 표지 `blobs/unreferenced/<2>/<62>.json`이 남아 쌓인다.
   - 순서: 본문 → 목적 기록 → 미참조 표지.
   - 본문 `rm`이 성공했거나 `ENOENT`(`errorCode`, `packages/base/errors.ts`)면 본문이 없다고 확인된 것이다. 그때만 두 기록을 지운다. 기록 `rm`의 `ENOENT`는 넘어가고, 그 밖의 실패도 blob 삭제 결과를 바꾸지 않는다(남은 기록은 2의 sweep이 다음에 지운다).
   - 본문 `rm`이 `ENOENT` 밖의 이유로 실패하면 지금처럼 `err`를 돌려주고 기록은 건드리지 않는다.
2. 고아 기록 sweep. 지금은 이미 남은 기록을 지우는 곳이 없다.
   - 새 함수(예: `sweepOrphanRecords(root)`)를 `runMaintenanceGc`에서 `fullyStopped` 확인 바로 뒤, `listReferenceRows` 앞에 부른다. sweep은 ledger 참조에 기대지 않으므로 참조 읽기가 실패해도 돈다.
   - 후보: `blobs/purposes`와 `blobs/unreferenced`의 file 이름(`<2>/<62>.json`, `isSha256Hash`인 것만)에서 얻은 hash 가운데 `blobs/sha256/<2>/<62>`에 이름이 없는 것. 목록은 `readdirSync` 이름만 본다(지금 `readRecordDir`는 file 내용을 다 읽으므로 쓰지 않는다).
   - 후보마다 본문을 `stat`해 `ENOENT`일 때만 그 hash의 두 기록을 지운다. 그 밖의 오류나 본문이 있으면 둔다.
   - 한 번에 보는 후보는 `ORPHAN_SWEEP_MAX = 2_000`개까지다. 남은 것은 다음 정지 때 이어진다.
   - sweep의 실패는 GC 결과를 바꾸지 않는다(삼키고 넘어간다).

### 정한 것

- sweep은 정지 유지보수에만 둔다. 지우기를 정지 시각 밖으로 옮기면 준비 중인 blob과 경합한다(README "정한 것").
- 상한은 후보 2,000개다. 지금 쌓인 고아는 목적 기록 수백 개 수준이고, 1의 짝 삭제가 새 고아를 거의 만들지 않으므로 한 번에 다 비운다. 30초 기한에서 목록 읽기(이름만)와 2,000번의 `stat`·`rm`은 작다.
- migration은 없다. 기록의 모양이 바뀌지 않고 이미 남은 file을 지우는 청소다.
- `packages/core/storage/blobs/worker/gc.ts`(`trimCapacity`)는 고치지 않는다. 열린 이슈 `model-call-body-capacity-not-enforced`는 따로다.
- diagnostics 집계(지운 수)는 더하지 않는다.

## 끝남

- `npm run check`가 통과한다.
- 위험 test: "정지 유지보수 한 번 뒤 본문이 있는 hash의 목적 기록·표지는 남고, 본문이 없는 hash의 목적 기록·표지와 GC가 지운 blob의 두 기록은 없다". `maintenance_test.ts`에 임시 폴더 하나와 `runMaintenanceGc`(조건 셋 모두 참, `listReferenceRows`는 빈 목록, `fields`는 빈 목록, 유예기간이 지난 표지를 가진 미참조 blob 하나)로 쓴다. 설치된 본문은 모두 목적 기록을 가져야 한다(없으면 `trimCapacity`가 `unavailable`로 끝난다). subprocess를 띄우지 않는다.

## 보고

`.claude/skills/orchestrate/brief-template.md`의 "보고" 꼴을 따른다.

- 등록할 것: 새 test file `packages/core/storage/blobs/worker/maintenance_test.ts`. lead가 `project-docs/flows/tests/core-rest.yaml`에 줄을 더한다. 이슈 `blob-metadata-left-after-gc`는 lead가 닫는다.
- **무겁게 짠 것**: `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음".
- **알려진 미완 동작**: 없으면 "없음".
