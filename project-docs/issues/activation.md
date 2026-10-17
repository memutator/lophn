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

정한 것: 실제로 막히는 앱이 나올 때까지 둔다.

## activation 요청 읽기(`approval-reads.ts`)가 approvals의 내부 파일을 직접 읽는다

```yaml
kind: defect
modules: [packages/core/main, packages/core/approvals, packages/core/apps]
```

지금: `core/main/daemon/wiring/approval-reads.ts`의 `approvalLedgerRead`가 호출마다 `openConnection(ledgerPath)`로 ledger를 따로 열고, `core/approvals/rows.ts`(`loadRequest`, `REQUEST_COLUMNS`, `requestOf`)를 import해 `approval_requests`를 직접 읽는다. `wiring/apps.ts`가 activation의 `approvals.request/pending`에 끼운다. 이유는 파일 머리 주석대로 `Approvals` port에 읽기가 없어서다.

영향: approvals의 표 모양이나 `rows.ts`를 바꾸면 activation이 조용히 깨진다. 다른 module의 표를 건너 읽는 경계 위반이고 연결도 호출마다 새로 연다.

고치려면: approvals가 `request(id)`, `pending()` 읽기를 공개 API로 내놓고(`ApprovalsService` 또는 reader), wiring은 그걸 끼운다. `approval-reads.ts`는 지운다. 작음. 추천.

## 복구본 보존과 complete 한 tx에 몰린 일

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: 복구본은 blob `permanent`(`data/blobs.ts`)로 두고 앱마다 최근 하나만 둔다(`discardBackups`가 `eraseBlobRefs`로 참조를 지운다). `releases/commands.ts` `completeActivation`은 한 tx에서 active 참조와 `superseded` 전환, `replaceApp`(revision은 `nextRevision` = max(events head, 현재+1)), `syncAppGrants(..., "granted")`, `discardBackups`, 이전으로 돌아가기 요청(`activation_requests`) 삭제를 한다.

영향: 한 tx에 일이 많아 하나를 바꿀 때 나머지가 영향받는다. 다만 architecture 문서가 이 일들이 한 tx여야 하는 이유(중간 상태 금지)를 정해 두었다.

고치려면: 보존 규칙(복구본 몇 개, 언제 지움)과 complete의 일을 함수로 나눠 읽기 쉽게만 한다(작음). tx를 쪼개는 것은 하지 않는다. 추천: 나누지 않고 archived로 닫는다(kept).

## 실패 순서가 정해져 있다

```yaml
kind: defect
modules: [packages/core/apps]
```

지금: `activation/recovery.ts` `rollback`이 종료 확인, 복원·무결성·schema 확인, `recordDataRestore`, `failActivation`, `restartPrevious` 순으로 한다. 복원을 확인한 뒤 실패를 먼저 기록하고 그다음 이전 release를 시작한다. 이유(크래시 뒤 복구본으로 데이터를 두 번 덮지 않게)는 `rollback` 머리 주석이 "앞 단계가 확인되지 않으면 뒤 단계를 하지 않는다"까지만 말하고 정확한 이유는 architecture 문서에만 있다.

영향: 순서에 기대는 복구 규칙이라 단계를 바꾸거나 끼우면 깨지기 쉽다.

고치려면: 줄이려면 이어받기 경로와 함께 단순화해야 한다(위 "끊긴 시도" 절). 추천: 남긴다(archived, kept).

## 이어받기가 `unavailable`로 끝나면 매 sweep(1초) 다시 두드린다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: `core/apps/releases/activation/assembly.ts`의 `runOne`은 종료 확인·복원이 `unavailable`이면 앱을 붙든 채로 둔다. 30초 재시도 표를 지운 뒤라 `sweep`이 `activatingRows()`를 읽을 때마다 같은 시도를 다시 `enqueue`한다. sweep 간격 기본값은 `control.ts`의 `sweepMs ?? 1_000`이다.

영향: supervisor나 data worker가 오래 응답하지 않으면 같은 이어받기가 1초마다 돌고, 실패 기록이나 로그가 그만큼 쌓일 수 있다.

고치려면:
- 그대로 둔다. 이어받기는 남기기로 한 장치이고 한 번 도는 비용이 작으면 문제가 아니다.
- 이어받기 실패 뒤 다음 시도를 sweep 몇 번 건너뛴다(작음. 지운 재시도 시각 표와 비슷해진다).

## 바쁜 앱에 온 activation 시작은 `conflict`로 끝나고 다시 시작되지 않는다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: 앱에 activation이 돌고 있을 때 `TicketVerified`·`ApprovalDecided` handler가 시작하려던 `prepared` release는 `conflict`로 거절되고 `prepared`로 남는다. 자동으로 다시 시작하지 않는다. 이전 release로 돌아가기 요청(`activation_requests`)만 행이 남아 다음 sweep이 다시 본다.

영향: 두 ticket이 거의 같이 확인되면 뒤의 release는 사람이 다시 확인하거나 App Engineer가 새 release를 낼 때까지 켜지지 않는다.

고치려면:
- 그대로 둔다(이슈 "앱별 activation 줄과 30초 재시도"에서 정한 것: 겹치면 conflict).
- 끝난 activation 뒤 같은 앱의 가장 새 `prepared`를 한 번 본다(작음).
