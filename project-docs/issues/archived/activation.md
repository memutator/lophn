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

## npm·jsr 의존을 준비 때 받아 bundle에 통째로 담는다

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: release 준비(`releases/prepare/from-source.ts` `fetchExternal`)가 잠근 `npm:`/`jsr:` 값을 `deno cache`로 받아 `vendor/`, `node_modules/`를 만들고, `bundle/vendor.ts` `readVendorFiles`가 symlink를 풀어 전부 읽어 bundle에 담는다(`prepare/flow.ts` `vendorCopies`). `bundle/read.ts`는 `vendor/`, `node_modules/`를 생성 폴더(예약)로 거절한다. 운영 앱이 network 없이 뜨게 하려는 것이다.

영향: bundle 크기와 hash 계산이 의존 크기만큼 커지고, 준비가 network와 `deno cache`에 걸린다. 이 경로 전체(vendor.ts, fetchExternal, 예약 거절, `dependencies` 검사)가 유지 비용이다.

고치려면:
- MVP는 npm·jsr 의존을 막고 sdk와 `@me`만 허용한다. 위 경로를 지운다(중간, 앱이 라이브러리를 못 씀).
- 그대로 둔다(0).
추천: 막는다.

닫음: 남긴다. 앱은 자기 의존성(예: 공휴일 data를 주는 라이브러리)을 쓸 수 있어야 한다. 그런 것을 coding agent가 다 짜거나 SDK가 다 줄 수 없다.

## 앱별 activation 줄(메모리)과 30초 재시도

```yaml
kind: defect
modules: [packages/core/apps]
closed: fixed
guard: 없음
```

지금: `ApprovalDecided`·`TicketVerified` 뒤 `activation/queue.ts`가 앱마다 Promise 줄을 세우고 차례가 오면 `assembly.ts` `runOne`이 시작한다. 차례에서 비교(`comparisonOf`)를 다시 보고 허락한 값(`approved`)과 다르면 `reconsider`로 다시 묻는다. `unavailable`로 끝난 시도는 `unsettled`에 30초(`ACTIVATION_RETRY_MS`) 뒤 시각을 적고 `sweep`이 그 뒤에 다시 줄에 세운다. 같은 앱 activation이 겹치지 않게 하고 허락과 실제 시작 사이의 변경을 잡으려는 것이다.

영향: 줄, `approved` 비교, 재시도 시각이 따로 상태라 고칠 때 셋을 같이 봐야 한다. 가장 단순한 구현보다 무겁다.

고치려면: 앱마다 한 번에 하나만 받고 나머지는 `conflict`로 거절한다. 재시도는 없앤다(사람이 다시 시작). 중간. 허락 뒤 비교가 달라지는 검사는 남겨야 한다.

정한 것: 줄과 30초 재시도를 없앤다. 겹치면 conflict로 거절하고 실패는 실패로 끝내 사람이 다시 누른다. 허락과 시작 사이에 비교가 달라지면 다시 묻는 검사는 남긴다.

닫음: `queue.ts`의 앱별 Promise 줄을 앱마다 job 하나로 바꿔, 돌고 있으면 `conflict`로 거절한다. `ACTIVATION_RETRY_MS`와 `unsettled`(30초 재시도)를 지웠다. `activatePrevious`도 진행 중 activation이 있으면 `conflict`다. 끊긴 activation 이어받기는 매 sweep 그대로 한다.

## 복구본 보존과 complete 한 tx에 몰린 일

```yaml
kind: defect
modules: [packages/core/apps]
closed: kept
guard: 없음
```

지금: 복구본은 blob `permanent`(`data/blobs.ts`)로 두고 앱마다 최근 하나만 둔다(`discardBackups`가 `eraseBlobRefs`로 참조를 지운다). `releases/commands.ts` `completeActivation`은 한 tx에서 active 참조와 `superseded` 전환, `replaceApp`(revision은 `nextRevision` = max(events head, 현재+1)), `syncAppGrants(..., "granted")`, `discardBackups`, 이전으로 돌아가기 요청(`activation_requests`) 삭제를 한다.

영향: 한 tx에 일이 많아 하나를 바꿀 때 나머지가 영향받는다. 다만 architecture 문서가 이 일들이 한 tx여야 하는 이유(중간 상태 금지)를 정해 두었다.

고치려면: 보존 규칙(복구본 몇 개, 언제 지움)과 complete의 일을 함수로 나눠 읽기 쉽게만 한다(작음). tx를 쪼개는 것은 하지 않는다. 추천: 나누지 않는다.

닫음: 복구본 보존 규칙과 complete의 일을 함수로 나눠도 얻는 것은 읽기 쉬움뿐이고, 한 tx여야 하는 이유(중간 상태 금지)는 architecture 문서가 정했다. 나누지 않는다.

## activation 요청 읽기(`approval-reads.ts`)가 approvals의 내부 파일을 직접 읽는다

```yaml
kind: defect
modules: [packages/core/main, packages/core/approvals, packages/core/apps]
closed: fixed
guard: 없음
```

지금: `core/main/daemon/wiring/approval-reads.ts`의 `approvalLedgerRead`가 호출마다 `openConnection(ledgerPath)`로 ledger를 따로 열고, `core/approvals/rows.ts`(`loadRequest`, `REQUEST_COLUMNS`, `requestOf`)를 import해 `approval_requests`를 직접 읽는다. `wiring/apps.ts`가 activation의 `approvals.request/pending`에 끼운다. 이유는 파일 머리 주석대로 `Approvals` port에 읽기가 없어서다.

영향: approvals의 표 모양이나 `rows.ts`를 바꾸면 activation이 조용히 깨진다. 다른 module의 표를 건너 읽는 경계 위반이고 연결도 호출마다 새로 연다.

고치려면: approvals가 `request(id)`, `pending()` 읽기를 공개 API로 내놓고(`ApprovalsService` 또는 reader), wiring은 그걸 끼운다. `approval-reads.ts`는 지운다. 작음. 추천.

정한 것: 줄인다. `approvals`가 `request(id)`·`pending()` 읽기를 공개 API로 내놓고(`ApprovalsService` 또는 reader) wiring이 그걸 끼운다. `approval-reads.ts`는 지운다.

닫음: `Approvals` port가 `request(id)`·`pending()`을 내놓는다. `ApprovalLedger`가 machine read `approvalsRequest`(새것)와 `approvalsPending`(actors에 `machine`을 더함)을 reader로 부르고, `wiring/apps.ts`는 `ctx.approvals`의 두 메서드를 activation에 끼운다. `approval-reads.ts`는 지웠고 approvals 밖에서 `rows.ts`를 읽는 곳이 없다.

## activation이 가끔 새 앱의 ready를 못 보고 start_failed로 끝난다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main/app-supervisor]
closed: fixed
guard: 없음
```

지금: activation 허락 뒤 release가 `failed`, failure `{code: "start_failed", summary: "the new app did not become ready"}`로 끝나고 runtime은 `preparing`에 머문다. `tests/e2e/app-sandbox_test.ts`를 약 200번 돌린 중 5번 났고 부하(load average 6~10)가 높을 때 잦았다. core.log는 비고 앱 stderr를 볼 길이 없어 원인은 모른다. 의심: `packages/core/main/app-supervisor/assembly.ts`의 `probeChild`(ready 기한, "exited before ready"), `packages/core/apps/releases/activation/orchestrator.ts`의 `startCandidate`.

영향: 사람이 허락한 release가 이유 없이 실패로 남고 App Engineer에게 `ReleaseActivationFailed` reaction이 간다. 앱 E2E가 모두 이 길을 지나 가끔 실패한다.

고치려면: 반복 실행으로 재현해 ready 관측과 기한 중 어디서 놓치는지 찾는다. 앱 stderr를 실패 진단에 남기면 다음 원인 찾기가 싸진다.

닫음: 원인은 앱 socket 폴더였다. `${XDG_RUNTIME_DIR}/lophn`의 고정 slot 경로를 같은 사용자의 core가 모두 써서, 한 core의 supervisor가 다른 core 앱의 socket 파일을 지우거나 덮었다(ready 확인과 운영 link 연결이 거절됨). socket 폴더를 data root마다 나눈 뒤(`apps/runtime/processes/socket-dir.ts`의 `socketRootKey`) `tests/e2e/app-sandbox_test.ts` 90번, `tests/e2e/app-restart_test.ts` 4개 동시 16번이 모두 통과했다(고치기 전 각각 약 200번 중 8번, 16번 중 6번 실패).

## running으로 보인 직후의 앱 call이 app_unavailable로 거절된다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: 없음
```

지금: 앱 상태가 `running`·ready·accepting으로 읽힌 직후의 `appCallApi`가 `{status: "denied", denial: {code: "app_unavailable", message: "the app is not running"}}`다. `tests/e2e/app-sandbox_test.ts`를 약 200번 돌린 중 3번 났다. 의심: `packages/core/apps/calls/service.ts`에서 `deps.link.call`이 `sent: false`를 돌려주는 곳. 후보 관측의 ready·accepting과 운영 link 등록(`openAfterCommit`) 사이에 틈이 있을 수 있다.

영향: activation이 끝났다고 보고 부른 사람·agent의 첫 call이 거절된다. 앱 E2E가 가끔 실패한다.

고치려면: 상태가 running으로 보이는 시점과 call link가 열리는 시점을 같은 commit 뒤로 맞춘다.

닫음: 원인은 앱 socket 폴더였다. `${XDG_RUNTIME_DIR}/lophn`의 고정 slot 경로를 같은 사용자의 core가 모두 써서, 한 core의 supervisor가 다른 core 앱의 socket 파일을 지우거나 덮었다(ready 확인과 운영 link 연결이 거절됨). socket 폴더를 data root마다 나눈 뒤(`apps/runtime/processes/socket-dir.ts`의 `socketRootKey`) `tests/e2e/app-sandbox_test.ts` 90번, `tests/e2e/app-restart_test.ts` 4개 동시 16번이 모두 통과했다(고치기 전 각각 약 200번 중 8번, 16번 중 6번 실패).
