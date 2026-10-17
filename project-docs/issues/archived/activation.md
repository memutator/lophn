# activation (닫음)

## `release.prepare_bundle`의 `ticket_source` 계약과 core가 다르다

```yaml
kind: defect
modules: [packages/core/apps, packages/protocol]
closed: fixed
guard: 없음
```

지금: 계약은 optional인데 core가 필수로 막는다.

영향: 계약과 구현이 어긋난다.

고치려면: 계약을 필수로 맞춘다.

닫음: `protocol/apps/releases.ts`의 `releasePrepareBundleInputSchema`가 `ticket_source: ticketSourceSchema`(필수, strictObject)다. `core/apps/control.ts`의 핸들러에 남은 `body.ticket_source === undefined` 검사는 타입만 optional인 중복 방어다.

## migration 단계마다 PRIMARY KEY 검사와 `-- loss:` 줄 파싱

```yaml
kind: defect
modules: [packages/core/apps, packages/protocol]
closed: kept
guard: 없음
```

지금: `data/worker/db.ts` `applyStep`이 단계 적용 뒤 새 표마다 `pragma table_info`로 PRIMARY KEY 칸 수를 세어 없으면 단계를 되돌리고 실패한다(`tablesWithoutPrimaryKey`). `protocol/apps/activation/migration-sql.ts` `lossOfStepSql`이 파일 머리 `-- loss:` 줄을 정규식으로 읽고 `releases/activation/desired.ts` `dataChangesOf`가 release 준비에서 부른다. 꼴이 틀리면 준비가 거절된다.

영향: 단계마다 검사와 파싱이 붙지만 둘 다 일을 한다. PRIMARY KEY가 없으면 SQLite session이 그 표를 기록하지 않아 rewind가 조용히 틀리고, loss 줄은 사람에게 묻는 판단의 유일한 출처다.

고치려면: 줄일 곳이 없다. 이유를 코드 주석(이미 있음)과 architecture 문서에 두고 이 절을 닫는다(kept). 추천.

닫음: 남긴다. PRIMARY KEY가 없으면 rewind가 조용히 틀리고, loss 줄은 사람에게 묻는 근거다.

## 끊긴 activation 시도를 이어받는다

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: 차례가 온 release가 `activating`이면 새로 시작하지 않고 `recoverActivation`(`activation/recovery.ts`)으로 잇는다(`assembly.ts` `runOne`, `sweep`이 줄에 없는 `activating`을 다시 세움). `continueRecovery`는 ledger가 `active`/`failed`/진행 중인지 보고 셋으로 갈린다. 진행 중으로 닫을 때 실패 code는 `start_failed`다.

영향: 이어받기 경로가 `rollback`과 별도로 있어 core 재시작, 응답 유실, 실패 확정 유실마다 분기가 늘어난다. 이 분기가 architecture 문서의 복구 약속이기도 하다.

고치려면: 기동 때 `activating`을 모두 실패로 닫고 복구본으로 되돌린다(`continueRecovery`의 `active` 분기가 없어져 "commit 뒤 실패는 복원하지 않는다" 약속을 따로 지켜야 함). 중간. 추천은 두는 것이다. 응답 유실 때 이미 채택된 release를 복구본으로 덮는 사고를 막는 게 이 분기다.

닫음: 남긴다. 이미 켜진 새 판의 데이터를 복구본으로 덮지 않게 막는다.
