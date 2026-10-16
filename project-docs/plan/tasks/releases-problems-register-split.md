# releases-problems-register-split

`core/problems/register.ts`(355줄, problems의 등록 file 하나)를 leaf마다의 `register.ts`와 얇은 조립 file로 쪼갠다. 동작은 바꾸지 않는다. 쪼개고 나면 problems의 다른 task 네 개가 자기 leaf의 등록 file만 고쳐 병렬로 돈다.

- 단위: releases-problems (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/problems/register.ts`
  - `packages/core/problems/worker-root.ts` (새)
  - `packages/core/problems/grouping/register.ts` (새. 끝나면 `releases-problems-problem-state`의 것)
  - `packages/core/problems/reporting/register.ts` (새. 끝나면 `releases-problems-problem-state`의 것)
  - `packages/core/problems/reporting/worker/register.ts` (새. 끝나면 `releases-problems-intake`의 것)
  - `packages/core/problems/snapshots/register.ts` (새. 끝나면 `releases-problems-intake`의 것)
  - `packages/core/problems/repairs/register.ts` (새. 끝나면 `releases-problems-repairs`의 것)
  - `packages/core/problems/tests/register.ts` (새. 끝나면 `releases-problems-tests`의 것)
- 읽을 것:
  - spec: 없음(구조만 바꾼다)
  - inventory: 이 task에 배정된 줄은 없다. 쪼개는 대상은 `I2.7#38`(설정 항목 `detailCollectionSetting`)이 들어 있는 file이다.
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/code.md`("모듈 모양"), `/home/pyosechang/projects/lophn/project-docs/dev/code-map.md`("core 안 module")
  - 지금 코드: `packages/core/problems/register.ts`, 이 file을 import하는 곳(`grep -rn "problems/register" packages --include=*.ts`: `main/daemon/main.ts`, `storage/blobs/child-prepare.ts`, `main/daemon/core.ts` 또는 core-wiring이 쪼갠 `wiring/problems.ts`)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것: 지금 `register.ts`가 내보내는 이름과 모양을 그대로 내놓는다: `problemsTestDefinitions`, `problemsReportDefinitions`, `detailCollectionSetting`, `problemsDefinitions`, `createLedgerRegistration`, `createEventRegistration`, `createReaderRegistration`. 밖에서 이 file을 import하는 곳은 하나도 고치지 않는다.

## 할 일

1. `worker-root.ts`를 만들고 `workerRoot()`(LOPHN_HOME/HOME에서 data root 찾기)를 옮긴다.
2. 각 leaf의 `register.ts`는 그 leaf가 등록하는 조각 `ProblemsPart`를 낸다. 조각의 type은 `register.ts`에 `export type ProblemsPart`로 두고(`import type`으로 불러 순환을 피한다) 칸은 지금 정의 객체가 가진 것의 부분집합이다: `schema`, `blobFields`, `blobPurposes`, `commands`, `subscribers`, `reads`, `apiReads`, `ports`, `workers`, `workerRoutes`, `uploadRoutes`, `events`, `visibility`, `readerReads`, `readerPorts`, `settings`, `ledgerApiReads`(`createLedgerRegistration`의 것). 모두 선택 칸이다.
3. 나누는 법(지금 `register.ts`의 위 아래 순서대로 옮긴다):

   | file | 가져가는 것 |
   |---|---|
   | `tests/register.ts` | `problemsTestDefinitions`의 내용 전부(`TEST_SCHEMA_STEPS`, `TEST_BLOB_*`, test command 다섯, test read 셋, `verificationRecordedForChecker` visibility, `testTxPorts()`, `testRunnerWorkers()`), event `verificationRecorded`, reader read 셋 |
   | `reporting/register.ts` | `REPORTS_SCHEMA_STEPS`, `recordReportCommand`, `listReportsRead`, `getReportRead`, reader read `getSnapshotRead`(`reporting/reads.ts`에 있다) |
   | `reporting/worker/register.ts` | `REPORT_SIZE`, `REPORT_BLOB_FIELD_FIELDS`와 `reportBlobField`·`REPORT_BLOB_PURPOSES` 조립, `unattachedReportBodyRead`, `reportCollectorWorkers()`, `workerRoutes`(`reportProblem`, `observeException`, `observeViewError`, `submitFeedback`) |
   | `snapshots/register.ts` | `SNAPSHOTS_SCHEMA_STEPS`, `snapshotViewApiRead()`, `UNATTACHED_SNAPSHOT_LOGS`와 `snapshotLogsRead`(`createLedgerRegistration`의 몫), `detailCollectionSetting`과 `settings` |
   | `grouping/register.ts` | `listProblemsRead`, `getProblemRead`, `reconcileProblemWorkCommand`, `linkProblemInterpretationCommand`, `closeProblemVerifiedCommand`, `applyProblemDecisionCommand`, `problemsWorkSubscribers()`, `problemsClosingSubscribers()`, event 셋(`problemWorkStarted`, `problemWorkEnded`, `problemInterpretationLinked`), `problemsClosingVisibility` 정책, `isTicketCheckFeed` 쓰는 `visibleToChecker` 정책 |
   | `repairs/register.ts` | `FIX_BLOB_FIELDS`, `FIX_BLOB_PURPOSES`, `recordProblemFixCommand`, `listProblemFixesRead`, `uploadRoutes`(`problemsUploadFixSummary`), event `problemFixRecorded` |

4. `register.ts`는 조각을 이어 붙여 지금과 같은 이름의 정의를 만든다: `problemsTestDefinitions`는 `tests/register.ts`의 조각 그대로, `problemsReportDefinitions`는 나머지 다섯의 조각을 칸마다 이어 붙인 것, `createEventRegistration()`은 조각의 `events`·`visibility`와 아직 leaf에 안 가는 정책(`notificationsOnlyVisibility(problemOpened)`, `visibleToChecker(notificationsOnlyVisibility(problemReopened|problemClosed))`, `ticketCheckFeedVisibility(problemConfirmationRecorded)`, `problemsClosingVisibility(problemObserved)`)을 모은 것, `createReaderRegistration()`은 조각의 `readerReads`와 `ports`(`ProblemWorkPort`, `ProblemTestPort`, `ProblemWordingPort` 세 개 그대로)를 모은 것이다.
5. 칸 이어 붙이는 순서는 지금 배열의 순서와 같게 한다(등록 순서가 의미를 가질 수 있다).
6. `deno task check`로 type만 확인하는 구조 변경이다. 새 test는 만들지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: 조립 `register.ts`는 leaf 안의 구체 command·read 이름을 import하지 않고 각 leaf의 `register.ts`만 import한다. 예외는 event 정책에 쓰는 `closing/connection.ts`와 `apps/tickets/checker/connection.ts`의 import뿐이다.

## 보고

- 바꾼 file
- 등록할 것: 없음(밖에서 쓰는 이름이 그대로다)
- 안 쓰게 된 export: 없음
- 정한 것: 조각의 칸 이름과 나눈 경계(문서에 답이 없어 worker가 정한 것)
- 소유 바꾸기: 위 소유 항목의 새 `register.ts` 여섯 → 각 후속 task. 오케스트레이터가 merge 뒤 `ownership.md`에 반영한다.
