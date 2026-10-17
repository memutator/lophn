# activation

ticket 확인됨 뒤 prepared release를 운영 앱으로 올리는 순서와 실패 복구. `project-docs/architecture/activation.md`.

## write app-api의 rewind 검사가 fail로 나온다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
```

지금: harness `rewind` 검사(`core/problems/tests/harness/checks.ts` `rewind`, `work/app-driver.ts` `rewind`)가 write app-api를 선언 순서대로 하나씩 부른다. 입력은 `validValue(declaration.input)`로 만든 값이라, 앞선 상태(이미 있는 행 등)가 있어야 성공하는 api는 호출이 실패하고 검사는 `fixture 입력의 호출이 성공하지 못했다`로 fail이다. `app-test/generate.ts`는 write가 하나라도 있으면 이 검사를 필수로 둔다.

영향: 정상인 앱도 release 준비의 test가 fail이라 coding agent가 앱 code를 왜곡하거나 막힌다. 앱이 입력을 줄 길이 없다.

고치려면:
- 실제로 막히는 앱이 나올 때까지 둔다(비용 0).
- 앱이 write api마다 fixture 입력을 선언하게 한다(blueprint 확장, 중간 크기).
- 호출이 `invalid_input`/`not_found`로 거절되면 fail 대신 not_applicable로 둔다(작음. 그러나 rewind를 증명 못 한 채 통과).
추천: 막힌 앱이 생길 때까지 둔다.

정할 것: 막히면 fixture를 앱이 주게 할지, 검사를 약하게 할지.

## activation 요청 읽기(`approval-reads.ts`)가 approvals의 내부 파일을 직접 읽는다

```yaml
kind: defect
modules: [packages/core/main, packages/core/approvals, packages/core/apps]
```

지금: `core/main/daemon/wiring/approval-reads.ts`의 `approvalLedgerRead`가 호출마다 `openConnection(ledgerPath)`로 ledger를 따로 열고, `core/approvals/rows.ts`(`loadRequest`, `REQUEST_COLUMNS`, `requestOf`)를 import해 `approval_requests`를 직접 읽는다. `wiring/apps.ts`가 activation의 `approvals.request/pending`에 끼운다. 이유는 파일 머리 주석대로 `Approvals` port에 읽기가 없어서다.

영향: approvals의 표 모양이나 `rows.ts`를 바꾸면 activation이 조용히 깨진다. 다른 module의 표를 건너 읽는 경계 위반이고 연결도 호출마다 새로 연다.

고치려면: approvals가 `request(id)`, `pending()` 읽기를 공개 API로 내놓고(`ApprovalsService` 또는 reader), wiring은 그걸 끼운다. `approval-reads.ts`는 지운다. 작음. 추천.

## npm·jsr 의존을 준비 때 받아 bundle에 통째로 담는다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: release 준비(`releases/prepare/from-source.ts` `fetchExternal`)가 잠근 `npm:`/`jsr:` 값을 `deno cache`로 받아 `vendor/`, `node_modules/`를 만들고, `bundle/vendor.ts` `readVendorFiles`가 symlink를 풀어 전부 읽어 bundle에 담는다(`prepare/flow.ts` `vendorCopies`). `bundle/read.ts`는 `vendor/`, `node_modules/`를 생성 폴더(예약)로 거절한다. 운영 앱이 network 없이 뜨게 하려는 것이다.

영향: bundle 크기와 hash 계산이 의존 크기만큼 커지고, 준비가 network와 `deno cache`에 걸린다. 이 경로 전체(vendor.ts, fetchExternal, 예약 거절, `dependencies` 검사)가 유지 비용이다.

고치려면:
- MVP는 npm·jsr 의존을 막고 sdk와 `@me`만 허용한다. 위 경로를 지운다(중간, 앱이 라이브러리를 못 씀).
- 그대로 둔다(0).
추천: 막는다.

정할 것: MVP 앱이 npm·jsr 라이브러리를 써야 하나.

## 앱별 activation 줄(메모리)과 30초 재시도

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `ApprovalDecided`·`TicketVerified` 뒤 `activation/queue.ts`가 앱마다 Promise 줄을 세우고 차례가 오면 `assembly.ts` `runOne`이 시작한다. 차례에서 비교(`comparisonOf`)를 다시 보고 허락한 값(`approved`)과 다르면 `reconsider`로 다시 묻는다. `unavailable`로 끝난 시도는 `unsettled`에 30초(`ACTIVATION_RETRY_MS`) 뒤 시각을 적고 `sweep`이 그 뒤에 다시 줄에 세운다. 같은 앱 activation이 겹치지 않게 하고 허락과 실제 시작 사이의 변경을 잡으려는 것이다.

영향: 줄, `approved` 비교, 재시도 시각이 따로 상태라 고칠 때 셋을 같이 봐야 한다. 가장 단순한 구현보다 무겁다.

고치려면: 앱마다 한 번에 하나만 받고 나머지는 `conflict`로 거절한다. 재시도는 없앤다(사람이 다시 시작). 중간. 허락 뒤 비교가 달라지는 검사는 남겨야 한다.

정할 것: 겹친 요청과 `unavailable` 실패를 자동으로 이어 줄지, 거절하고 사람이 다시 하게 할지.

## 끊긴 activation 시도를 이어받는다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: 차례가 온 release가 `activating`이면 새로 시작하지 않고 `recoverActivation`(`activation/recovery.ts`)으로 잇는다(`assembly.ts` `runOne`, `sweep`이 줄에 없는 `activating`을 다시 세움). `continueRecovery`는 ledger가 `active`/`failed`/진행 중인지 보고 셋으로 갈린다. 진행 중으로 닫을 때 실패 code는 `start_failed`다.

영향: 이어받기 경로가 `rollback`과 별도로 있어 core 재시작, 응답 유실, 실패 확정 유실마다 분기가 늘어난다. 이 분기가 architecture 문서의 복구 약속이기도 하다.

고치려면: 기동 때 `activating`을 모두 실패로 닫고 복구본으로 되돌린다(`continueRecovery`의 `active` 분기가 없어져 "commit 뒤 실패는 복원하지 않는다" 약속을 따로 지켜야 함). 중간. 추천은 두는 것이다. 응답 유실 때 이미 채택된 release를 복구본으로 덮는 사고를 막는 게 이 분기다.

정할 것: 위험한 분기(채택된 release 보호)를 포기하고 단순화할지.

## 복구본 보존과 complete 한 tx에 몰린 일

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: 복구본은 blob `permanent`(`data/blobs.ts`)로 두고 앱마다 최근 하나만 둔다(`discardBackups`가 `eraseBlobRefs`로 참조를 지운다). `releases/commands.ts` `completeActivation`은 한 tx에서 active 참조와 `superseded` 전환, `replaceApp`(revision은 `nextRevision` = max(events head, 현재+1)), `syncAppGrants(..., "granted")`, `discardBackups`, 이전으로 돌아가기 요청(`activation_requests`) 삭제를 한다.

영향: 한 tx에 일이 많아 하나를 바꿀 때 나머지가 영향받는다. 다만 architecture 문서가 이 일들이 한 tx여야 하는 이유(중간 상태 금지)를 정해 두었다.

고치려면: 보존 규칙(복구본 몇 개, 언제 지움)과 complete의 일을 함수로 나눠 읽기 쉽게만 한다(작음). tx를 쪼개는 것은 하지 않는다. 추천: 나누지 않고 archived로 닫는다(kept).

## migration 단계마다 PRIMARY KEY 검사와 `-- loss:` 줄 파싱

```yaml
kind: defect
modules: [packages/core/apps, packages/protocol]
```

지금: `data/worker/db.ts` `applyStep`이 단계 적용 뒤 새 표마다 `pragma table_info`로 PRIMARY KEY 칸 수를 세어 없으면 단계를 되돌리고 실패한다(`tablesWithoutPrimaryKey`). `protocol/apps/activation/migration-sql.ts` `lossOfStepSql`이 파일 머리 `-- loss:` 줄을 정규식으로 읽고 `releases/activation/desired.ts` `dataChangesOf`가 release 준비에서 부른다. 꼴이 틀리면 준비가 거절된다.

영향: 단계마다 검사와 파싱이 붙지만 둘 다 일을 한다. PRIMARY KEY가 없으면 SQLite session이 그 표를 기록하지 않아 rewind가 조용히 틀리고, loss 줄은 사람에게 묻는 판단의 유일한 출처다.

고치려면: 줄일 곳이 없다. 이유를 코드 주석(이미 있음)과 architecture 문서에 두고 이 절을 닫는다(kept). 추천.

정할 것: kept로 닫아도 되는지.

## 실패 순서가 정해져 있다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `activation/recovery.ts` `rollback`이 종료 확인, 복원·무결성·schema 확인, `recordDataRestore`, `failActivation`, `restartPrevious` 순으로 한다. 복원을 확인한 뒤 실패를 먼저 기록하고 그다음 이전 release를 시작한다. 이유(크래시 뒤 복구본으로 데이터를 두 번 덮지 않게)는 `rollback` 머리 주석이 "앞 단계가 확인되지 않으면 뒤 단계를 하지 않는다"까지만 말하고 정확한 이유는 architecture 문서에만 있다.

영향: 순서에 기대는 복구 규칙이라 단계를 바꾸거나 끼우면 깨지기 쉽다.

고치려면: 줄이려면 이어받기 경로와 함께 단순화해야 한다(위 "끊긴 시도" 절). 추천: 남긴다(archived, kept).
