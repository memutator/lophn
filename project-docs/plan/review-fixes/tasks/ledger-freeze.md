# ledger-freeze

낸 ledger schema step의 SQL을 상수 끼우기 없는 literal로 얼리고, step id·hash를 고정하는 lock test를 더한다.

- 단위: ledger (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/router/schema.ts`
  - `packages/core/runs/schema.ts`
  - `packages/core/jobs/schema.ts`
  - `packages/core/workflows/schema.ts`
  - `packages/core/lophn-agent/run-loop/schema.ts`
  - `packages/core/storage/ledger/schema.ts`
  - `packages/core/storage/migration/migrations.ts`
  - `packages/core/storage/migration/migrations_test.ts`
  - `packages/core/storage/migration/schema-steps.lock.json` (새 file)
  - 추가 소유: schema step SQL에 상수를 끼우는 그 밖의 `packages/core/**/schema.ts`와 `packages/core/lophn-agent/session/model.ts`(step SQL 부분만), 공용 trigger 상수(`TERMINAL_TRIGGER`, `RELEASES_IMMUTABLE`, `REWIND_FILES_IMMUTABLE`, `IMMUTABLE()`)를 정의한 file(그 상수만)
- 읽을 것:
  - AGENTS.md "호환성"의 ledger 규칙
  - `packages/core/storage/migration/migrations.ts`(적용기, `content_hash` 대조, `guardedTablesOf`)
  - `project-docs/architecture/`에서 ledger·migration topic
- 계약:
  - 쓰는 것: `packages/protocol`의 enum(`CALL_FAIL_REASONS`, `TURN_MODES`, `HARNESS_RUNTIMES` 등). 고치지 않는다.
  - 내놓는 것: 없음

## 할 일

1. 지금 등록된 schema step을 모두 "낸 step"으로 본다. 각 step의 SQL에서 `${...}` 끼우기(protocol enum, 공용 trigger 상수, `IMMUTABLE()` 같은 helper)를 지금 만들어지는 문자열 그대로의 literal로 바꾼다. **hash가 한 byte도 바뀌면 안 된다**(실제 `~/.lophn`이 기동을 거절한다). 바꾸기 전에 모든 step의 id→sha256을 뽑아 두고, 바꾼 뒤 같은지 대조한다.
2. 얼린 뒤 쓰는 곳이 없어진 공용 trigger 상수와 helper는 지운다. 새 step을 쓸 때 쓰게 남길 만한 것이 있으면 남기되, 낸 step은 그것을 참조하지 않는다.
3. `schema-steps.lock.json`: 등록 순서대로 `[{id, sha256}]`. test 하나: lock의 모든 id가 같은 순서로 등록되어 있고 hash가 같으며, lock에 없는 step은 목록 끝에만 붙는다. 실패 message에 "낸 step은 고치지 말고 새 step을 더한다, 새 step이면 lock에 덧붙인다"를 적는다. lock을 갱신하는 방법(손으로 덧붙이기 또는 작은 script)을 test file 주석에 적는다.
4. `migrations_test`에서 step을 목록 가운데에 넣는 것을 허용·검사하는 test가 있으면 지운다(append-only가 규칙이 된다).
5. `guardedTablesOf` trigger 검사(`migrations.ts` 약 205-235행)는 소문자 정규식이라 대문자 `CREATE TRIGGER` step을 다 놓치고, 이름에서 표를 짐작한다. 지운다(integrity·FK 검사는 이미 돈다). 그것만 보는 test도 지운다.
6. `run-loop/schema.ts`의 drop/recreate step이 trigger를 손으로 다시 친 곳은 원래 step의 literal과 같은지 확인만 한다(낸 SQL은 고치지 않는다). 다르면 보고한다.

## 끝남

- `npm run check:full`이 통과한다(lead가 준 Windows 기준선 실패는 빼고).
- 위험 test: "등록된 schema step의 id·순서·hash가 lock과 같고 새 step은 끝에만 붙는다"
- 남지 않음: 낸 step SQL 안에 `${`가 0개다(`grep -n '\${' <schema files>`로 step SQL 부분 확인).
- `project-docs/plan/tools/lead/boot.sh`가 `boot 1 exit 0`, `boot 2 exit 0`.

## 보고

brief-template의 보고 꼴. 특히 hash 대조 결과(step 수, 모두 같음)를 적는다.
