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

## write app-api의 rewind 검사가 fail로 나온다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
closed: fixed
guard: packages/core/problems/tests/harness/checks_test.ts, packages/core/problems/tests/harness/examples_test.ts, packages/core/problems/tests/unproven_test.ts
```

지금: harness `rewind` 검사(`core/problems/tests/harness/checks.ts` `rewind`, `work/app-driver.ts` `rewind`)가 write app-api를 선언 순서대로 하나씩 부른다. 입력은 `validValue(declaration.inputSchema)`로 만든 값이라, 앞선 상태(이미 있는 행 등)가 있어야 성공하는 api는 호출이 실패하고 검사는 `fixture 입력의 호출이 성공하지 못했다`로 fail이다. `app-test/generate.ts`는 write가 하나라도 있으면 이 검사를 필수로 둔다.

영향: 정상인 앱도 release 준비의 test가 fail이라 coding agent가 앱 code를 왜곡하거나 막힌다. 앱이 입력을 줄 길이 없다.

고치려면:
- 실제로 막히는 앱이 나올 때까지 둔다(비용 0).
- 앱이 write api마다 fixture 입력을 선언하게 한다(blueprint 확장, 중간 크기).
- 호출이 `invalid_input`/`not_found`로 거절되면 fail 대신 not_applicable로 둔다(작음. 그러나 rewind를 증명 못 한 채 통과).
추천: 막힌 앱이 생길 때까지 둔다.

정한 것: 실제로 막히는 앱이 나올 때까지 둔다.

막힌 앱이 나왔다: 계획 `domain-tools`의 손 확인에서 내장 template 앱(write tool `add_item`)이 release 준비의 app test에서 "필수 검사 1개가 통과하지 못했다: rewind"로 떨어져 활성화되지 않았다. e2e `tests/e2e/app-release_test.ts`의 두 test도 같은 문구로 떨어진다. rewind 호출이 왜 실패했는지는 보지 못했다(검사 detail은 coding·user token 모두 `forbidden`). 정한 것을 다시 정해야 한다.

바로잡음(계획 `rewind-check`의 진단): 위 실패는 이 이슈의 입력 문제가 아니었다. 계획 `domain-tools`가 process wire에서 `context.project`를 지웠는데 `packages/core/problems/tests/work/app-driver.ts`가 아직 `project: null`을 실어, 앱 runtime이 harness의 모든 호출을 400 `invalid_input "call request is invalid"`로 거절했다. 세 줄을 지우면 template 앱은 통과한다. 이 이슈(만든 입력이 앞선 상태를 요구하는 tool에서 실패함)는 그대로 남고 아래 다시 정한 것으로 고친다.

다시 정한 것(사람, 2026-10-19): 검사 입력을 새로 만들지 않고, 실제로 성공한 write 호출을 되돌려 본다.
- 앱 자신의 test(ticket check `app_test`)나 ticket `examples`가 부른 write 호출의 changeset을 뒤집어 적용해, 호출 전 상태로 돌아오는지 본다.
- 만든 입력의 호출 자체가 실패한 write tool은 fail이 아니라 "증명 못 함"이다. activation을 막지 않는다.
- 증명 못 한 tool은 examples ticket일 때만 problem으로 알린다(planner, 계획 `rewind-check` 진단 뒤). examples run이 끝날 때 같은 (app, bundle_hash) app test의 증명 못 함에서 그 examples가 되돌리기를 증명한 tool을 뺀 것만 낸다. examples가 아닌 ticket은 app test 증거와 pass 이유 한 줄로만 남긴다.
  - 근거: release마다 그대로 올리면 examples가 이미 증명한 tool도 매번 경고가 되어 아무도 보지 않게 된다. examples run과 app test는 (app, bundle_hash)로 이미 이어져 있어 problems 안에서 차이를 낼 수 있다. examples가 아닌 ticket을 activation 때 알리려면 activation이 모르는 app test 증거와 ticket check 종류를 apps → problems 경계 너머로 이어야 해 비싸다. 그 ticket은 업무 규칙 확인이 애초에 없고 examples를 넣는 것이 증명하는 길이다.
- tool 선언에 test 전용 fixture 칸은 두지 않는다. 운영과 무관한 data가 선언에 들어가고, 앞 호출이 만든 id를 고정 값으로 맞출 수 없다.
- 먼저 할 것:
  1. template `add_item`(앞선 상태가 필요 없는 tool)이 왜 실패했는지 진단한다. 입력 문제가 아닌 다른 bug일 수 있다.
  2. 검사 detail이 coding·user token 모두에 `forbidden`인 것도 같이 본다.
  3. harness가 앱 test·examples 안의 호출마다 changeset을 받을 수 있는지 확인한다.

닫음: harness가 process wire에 `context.project`를 싣지 않는다. app test `rewind`는 호출이 성공한 write만 되돌려 보고, 호출이 실패한 tool은 "증명 못 함"(증거 `unproven`, pass 이유 한 줄)으로 두어 떨어뜨리지 않는다(`packages/core/problems/tests/harness/checks.ts`). ticket `examples`는 모두 맞으면 예시 write의 changeset을 뒤집어 첫 호출 전으로 돌아오는지 보고 아니면 fail이다(`harness/examples.ts`, 증거 `proven`). examples run이 끝나면 같은 bundle app test의 증명 못 함에서 그 examples가 증명한 tool을 뺀 것을 앱 problem `rewind_unproven`으로 알린다(`packages/core/problems/tests/unproven.ts`, `work/runner-service.ts`). user token도 검사 결과를 읽는다. examples가 아닌 ticket을 알리지 않는 것은 열린 이슈로 남는다.

## app test 검사별 detail을 아무도 읽지 못한다

```yaml
kind: defect
modules: [packages/core/problems, packages/core/storage]
closed: kept
guard: 없음
```

지금: 검사마다의 이유와 증거는 verification의 `observations` blob에 있다. 그 칸은 `general_read: false`로 등록돼(`packages/core/problems/tests/blobs.ts`의 `TEST_BLOB_FIELDS`) `blob.read`가 어느 actor에게도 주지 않는다(`packages/core/storage/blobs/refs.ts`의 `generalReadAllowed`). `GetVerification`의 `detail: true`는 별도 권한을 보지만(`packages/core/problems/tests/reads.ts`의 `readVerification`) 허락돼도 hash만 든 같은 Verification을 돌려준다. 그래서 detail은 disk에서만 읽힌다.

영향: 검사가 떨어진 이유를 coding agent와 사람이 화면·CLI로 볼 수 없다. 계획 `rewind-check` 진단은 data root의 blob 파일을 직접 열어 원인을 찾았다. fail 이유 한 줄에 검사별 이유를 실어 지금 필요한 만큼은 보인다. 증명 못 한 write tool도 같은 까닭에 core가 app test pass 이유 한 줄을 parse해 읽는다(`packages/core/problems/tests/unproven.ts`의 `unprovenOfReason`).

고치려면:
- 그대로 둔다(비용 0). fail 이유 한 줄이 검사별 이유를 싣는다. 추천.
- `detail: true`가 허락된 자격에 observations 내용을 싣는다(작음~중간. 그 blob에 앱 출력이 들어 있어 누가 읽을지 정해야 한다).

닫음: 남긴다. 검사가 떨어지면 fail 이유 한 줄이 검사별 이름과 이유(`필수 검사 N개가 통과하지 못했다: <검사>(<이유>)`, `app-test/judge.ts`의 `judgeAppTest`)를 싣고 coding agent와 사람은 그 줄을 읽는다. 증명 못 한 write tool도 pass 이유 한 줄에 실려 core가 그 줄을 읽는다(`unprovenOfReason`). observations blob의 원문(앱 출력이 든다)은 읽을 사람이 필요해질 때 `detail: true` 자격과 함께 정한다.

## examples가 아닌 ticket의 release에서 "증명 못 함" write tool을 알리지 않는다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/apps]
closed: kept
guard: 없음
```

지금: app test `rewind` 검사가 만든 입력의 호출이 실패한 write tool을 "증명 못 함"으로 두고(증거 `unproven`, pass 이유 한 줄), problem은 examples ticket의 examples run이 끝날 때만 낸다(`project-docs/issues/archived/activation.md`의 "write app-api의 rewind 검사가 fail로 나온다"의 다시 정한 것). check가 `app_test`·`text`인 ticket의 release는 증명 못 한 write tool이 있어도 problem이 없다.

지금 이미 하는 것: App Engineer 지침이 write tool을 바꾸는 ticket에 examples check를 쓰게 하고 `rewind_unproven` problem을 받으면 그 tool의 examples ticket을 만들게 한다(`packages/core/agent-roles/roles/app-engineer/prompt.md`). 지침이라 program이 막지는 않는다.

영향: App Engineer가 지침을 어기고 examples 없이 활성화한 release의 write tool은 되돌리기가 틀려도 아무도 모른다. rewind가 그 tool의 호출을 틀리게 되돌리면 사람이 고른 시점의 앱 data가 어긋난다.

고치려면: activation 때 그 release의 app test 증거에서 `unproven`을 읽어 problem으로 낸다(중간. activation(`packages/core/apps/releases/activation`)이 app test 증거를 모르므로 apps → problems port가 필요하다). 지침이 지켜지는지 보고 필요해질 때 한다.

닫음: 남긴다. 알릴 길(앱 problem `rewind_unproven`)을 지웠다. program은 증명 못 한 write tool을 agent에게 알리지 않고, 그 결과는 app test pass 이유 한 줄(`packages/core/problems/tests/unproven.ts`의 `unprovenNote`)에만 남는다. rewind 증명 자체는 ticket과 test runner를 지우는 계획이 같이 지운다.

## release 준비가 떨어진 이유가 고칠 곳을 가리키지 않는다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main]
closed: fixed
guard: packages/core/apps/releases/prepare/checks_test.ts
```

지금: `release.prepare`는 떨어진 단계와 이유를 `{status: "failed", stage, reason}`으로 돌려주지만(`packages/core/apps/control.ts`의 `releasePrepareHandler`), 세 단계의 이유가 모두 짧다.
- migration: 검사(`packages/core/apps/releases/prepare/checks.ts`의 `checkMigration`)는 activation과 같은 `migrateAppDatabase`(`packages/core/apps/data/worker/migrate.ts`)를 fixture DB에 건다. 단계가 실패하면 `applyStep`(`packages/core/apps/data/worker/db.ts`)이 SQL 오류를 `catch {}`로 버리고 "migration step rolled back"만 돌려주고, PRIMARY KEY 없는 새 표의 이름이 담긴 오류도 `migrateAppDatabase`가 `failed = true`로만 받아 버린다. 결과는 `restored: true` 하나라 reason은 "a step failed and was rolled back. Check the SQL of each step …" 같은 일반 글이다.
- build: 준비 자식(`packages/core/main/worker/release-job.ts`)의 실패 이유는 `prepareFromSource`(`packages/core/apps/releases/prepare/from-source.ts`)의 code(`blueprint_eval_failed`, `deno_json_missing` 같은 것)뿐이고 blueprint를 평가한 deno의 출력이 없다.
- handlers: preview launcher(`packages/core/apps/preview/launcher.ts`)가 선언한 tool과 앱이 알린 tool이 다르면 "handler or schema mismatch"만 낸다. 그 자리에서 두 목록을 갖고 있지만 어느 tool이 빠지거나 더해졌는지 싣지 않는다.

영향: App Engineer는 어디를 고칠지 모른 채 다시 짓는다. shell에서 `deno task check`나 단계 SQL을 따로 돌려 이유를 다시 찾아야 하고, 그동안 release를 못 낸다. activation의 migration 실패 이유도 같은 자리에서 사라진다.

고치려면:
- migration: `applyStep`이 sqlite 오류 글을 message에 싣고, `migrateAppDatabase`가 실패한 단계(`from-to`)와 그 message를 `restored: true` 결과에 함께 돌려준다. 검사는 그 글을 reason에 붙인다(작음. 앱이 쓴 SQL의 오류 글이라 secret 경계가 아니다).
- build: blueprint 평가가 실패하면 deno stderr의 앞 몇 줄을 reason에 붙인다(작음).
- handlers: launcher가 빠진 tool과 더해진 tool의 이름, schema 차이를 summary에 싣는다(작음).
- 셋 다 한다. **추천.**

닫음: migration은 `applyStep`(`packages/core/apps/data/worker/db.ts`)이 SQLite 오류 글을 한 줄 300자로 싣고, `migrateAppDatabase`가 되돌린 결과에 실패한 단계(`from-to`)와 그 글(`failed`)을 함께 돌려주고, 준비 검사(`packages/core/apps/releases/prepare/checks.ts`의 `migrateOnce`)가 reason에 붙인다. build는 blueprint 평가, 화면 build, 의존 받기가 실패하면 deno stderr의 앞 5줄 500자를 색 escape와 staging 경로를 지워 code 뒤에 붙인다(`packages/core/apps/releases/prepare/from-source.ts`의 `denoHead`). handlers는 preview launcher(`packages/core/apps/preview/launcher.ts`)가 handler 없는 tool과 선언 없는 tool(각 5개와 "and N more"), data schema 차이를 summary에 싣는다. activation의 `migration_failed` summary는 그대로다(열린 이슈 "activation의 migration 실패 이유가 실패한 단계와 SQLite 오류 글을 싣지 않는다").
