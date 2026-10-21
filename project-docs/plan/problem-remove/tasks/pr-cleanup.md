# pr-cleanup

쓰는 곳이 없어진 problem 계약을 protocol에서 지우고, 쓰는 곳 없는 blob 보존 종류 셋(`snapshot_attachment`, `trace_body`, `operational_log`)을 지운다. 마지막으로 남은 옛 이름을 찾는다.

- 단위: cleanup (wave 5)
- 선행: pr-problems-core, pr-log-read, pr-log-view-error, pr-agent-tools, pr-role-prompts. 다른 task가 쓰는 곳을 다 끊은 뒤다.
- 소유(이 task만 고친다):
  - `packages/protocol/projects/kinds-work.ts`
  - `packages/core/server/identity/model.ts`
  - `packages/core/server/identity/app-credential.ts`
  - `packages/protocol/server/identity.ts`
  - `packages/protocol/supervision/supervision.ts`
  - `packages/core/diagnostics/log.ts`
  - `packages/protocol/problems/sdk-report.ts`
  - `packages/protocol/problems/problems.ts`
  - `packages/protocol/problems/closing.ts`
  - `packages/protocol/problems/problem-reads.ts`
  - `packages/protocol/problems/problem-detail.ts`
  - `packages/protocol/problems/reports.ts`
  - `packages/protocol/problems/problem-views.ts`
  - `packages/protocol/problems/problem-report.ts`
  - `packages/protocol/problems/problem-feedback.ts`
  - `packages/protocol/problems/problem-record.ts`
  - `packages/protocol/problems/problem-codes.ts`
  - `packages/protocol/problems/feedback.ts`
  - `packages/protocol/problems/domain-problems.ts`
  - `packages/protocol/problems/report-body.ts`
  - `packages/protocol/problems/report-blobs.ts`
  - `packages/protocol/problems/release-wording.ts`
  - `packages/protocol/problems/snapshots.ts`
  - `packages/protocol/problems/exception-observation.ts`
  - `packages/protocol/problems/registry.ts`
  - `packages/protocol/problems/mod.ts`
  - `packages/protocol/mod.ts`
  - `packages/protocol/apps/blueprint-types.ts`
  - `packages/protocol/lophn-agent/sessions.ts`
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/storage/blob.ts`
  - `packages/core/storage/blobs/gc.ts`
- 읽을 것:
  - 계획: `project-docs/plan/problem-remove/README.md`의 "정한 것"(죽은 problem 계약과 쓰는 곳 없는 blob 종류 셋을 지운다, 옛 표·event·route는 migration 없이 지운다), roadmap `project-docs/products/roadmap/problem-ticket.md`의 "지우는 것"
  - architecture: `project-docs/architecture/layers.md`(`packages/protocol`은 경계 사이의 약속이다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `problems`, `storage`, `agent-sessions`, `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/storage`
  - 앞 task가 끊은 곳(brief는 `project-docs/plan/problem-remove/tasks/`): `pr-log-exception.md`(`packages/protocol/apps/broker.ts`·`packages/protocol/apps/calls/broker.ts`), `pr-log-sdk.md`(`sdk-report.ts`·`sdk-problem.ts`), `pr-cli-problem.md`, `pr-agent-tools.md`, `pr-problems-core.md`, `pr-issues-ui-main.md`, `pr-issues-ui-screen.md`, `pr-problem-refs.md`, `pr-reactions.md`, `pr-kinds-toast.md`, `pr-log-view-error.md`
  - 코드: `packages/protocol/problems/tests.ts`(`problem-codes.ts`의 `problemCodeSchema`를 쓴다. `ae-builds`가 다룬다), `packages/protocol/apps/broker.ts`(`exceptionObservationInputSchema`를 쓴다), `packages/core/apps/runtime/observations/stack-frames.ts`(`pr-log-exception`이 만든 file. `snapshots.ts`의 `SourceFrame`을 쓰는지 본다)
- 계약:
  - 쓰는 것: 없음
  - 내놓는 것:
    - `packages/protocol/problems/`에 남는 것: test runner 계약(`tests.ts`, `app-test-lookup.ts`, `test-frames.ts`. `ae-builds`가 다룬다), SDK portable file(`sdk-report.ts`, `sdk-problem.ts`), app→broker 예외 관측(`exception-observation.ts`와 그것이 쓰는 칸. `snapshots.ts`에서 쓰는 몫만 남기거나 옮긴다)
    - 지운다: `problems.ts`, `closing.ts`, `problem-reads.ts`, `problem-detail.ts`, `reports.ts`, `problem-views.ts`, `problem-report.ts`, `problem-feedback.ts`, `problem-record.ts`, `feedback.ts`, `domain-problems.ts`, `report-body.ts`, `report-blobs.ts`, `release-wording.ts`, 쓰는 곳이 없으면 `problem-codes.ts`; `registry.ts`의 그 route들
    - blob 보존 종류는 `model_call_body` 하나다(`packages/protocol/storage/blob.ts`의 `BLOB_RETENTION_CATEGORIES`, `packages/core/storage/blobs/gc.ts`의 상한).
    - session 첫 context의 대상(`openingTargetSchema`)에서 problem id(`prb`)를 뺀다. id 접두사 `prb`, `snp`(와 쓰는 곳이 없어지면 `rpt`)를 `ID_PREFIXES`에서 지운다.

## 할 일

1. 지우기 전에 지울 file마다 export 이름을 `git grep -nw`로 찾아 소유 밖 importer가 없는지 본다. barrel(`packages/protocol/problems/mod.ts`)과 `packages/protocol/mod.ts`의 `problems` namespace를 지나는 것도 이름으로 걸린다. 남은 importer가 있으면 그 file은 지우지 않고 file:줄을 보고한다(앞 task의 빠짐이다).
2. `packages/protocol/problems/`에서 지운다: `problems.ts`, `closing.ts`, `problem-reads.ts`, `problem-detail.ts`, `reports.ts`, `problem-views.ts`, `problem-report.ts`, `problem-feedback.ts`, `problem-record.ts`, `feedback.ts`, `domain-problems.ts`, `report-body.ts`, `report-blobs.ts`, `release-wording.ts`.
3. `packages/protocol/problems/problem-codes.ts`: `tests.ts`가 `problemCodeSchema`를 쓰므로 file은 남는다. `problemCodeSchema`만 남기고 `ProblemCodeDeclaration`, `reservedProblemCodeSchema`, message key·message·fixer schema를 지운다. 정한 것: `tests.ts`는 `ae-builds`가 다루므로 file을 옮기지 않고 죽은 몫만 덜어낸다.
4. 예외 관측:
   - `packages/protocol/problems/exception-observation.ts`가 `snapshots.ts`에서 가져오는 `missingReasonInputSchema`(`{ reason }`)와 `invocationEvidenceInputSchema`(`{ id: inv id, record_missing_reason }`)를 이 file 안으로 옮긴다. 입력(strict) 모양만 옮긴다.
   - `snapshots.ts`의 나머지 export(`sourceFrameSchema`, `SourceFrame` 등)를 소유 밖에서 쓰는지 본다(`packages/core/apps/runtime/observations/stack-frames.ts`). 안 쓰면 `snapshots.ts`를 지운다. 쓰면 그 symbol만 남기고 `snapshotSchema`, `idSchema("snp")`가 든 몫을 지운다.
5. `packages/protocol/problems/registry.ts`: `ROUTES`를 test runner route(`requestTest`, `recordVerification`, `observeTestRequest`, `startTestSide`, `stageTestEvidence`, `getTestRequest`, `getVerification`, `listVerifications`)로 줄인다. `PROBLEM_ROUTES`와 지운 file의 import를 지운다.
6. `packages/protocol/problems/mod.ts`: 지운 file의 `export *` 줄을 지운다. `packages/protocol/mod.ts`는 `problems` namespace와 `ROUTES`를 그대로 쓰므로 바꿀 것이 없으면 그대로 둔다.
7. `packages/protocol/apps/blueprint-types.ts`: `ProblemCodeDeclaration`을 가리키는, 뒤에 아무 정의도 없는 주석 한 줄을 지운다.
8. `packages/protocol/lophn-agent/sessions.ts`: `openingTargetSchema`에서 `idSchema("prb")`를 빼고 위 주석의 "문제·앱·release"를 고친다.
9. `packages/protocol/base/ids.ts`: `ID_PREFIXES`에서 `prb`, `snp`를 지운다. `rpt`는 남는다. `exceptionObservationInputSchema`의 `report_id`가 쓴다(그 사이 쓰는 곳이 모두 없어졌으면 지우고 보고한다).
10. blob 보존 종류: `packages/protocol/storage/blob.ts`의 `BLOB_RETENTION_CATEGORIES`를 `["model_call_body"]`로, `packages/core/storage/blobs/gc.ts`의 `BLOB_CAPACITY_MAX_BYTES`에서 `snapshot_attachment`, `trace_body`, `operational_log`를 지운다.
11. 남은 옛 이름 찾기: 아래 "남지 않음"의 grep을 모두 돌리고, `git grep -n -i "problem" -- packages/design/wording/catalog packages/shell packages/core packages/sdk`를 훑어 쓰는 곳이 없어진 wording key, 주석, 상수(예: `packages/protocol/problems/sdk-report.ts`의 `REPORTING_LIMITS` 칸, `diagnostic_scope` 조건 key)를 찾는다. 소유 밖이면 고치지 않고 file:줄로 보고한다.

추가(planner): 마지막 grep에서 찾는 남은 것 가운데 아래는 보고만 하지 않고 지운다(소유에 더했다).
- credential 조건 key와 앱 credential 칸 `diagnostic_scope`: `packages/core/server/identity/model.ts`, `app-credential.ts`, `packages/protocol/server/identity.ts`, `packages/protocol/supervision/supervision.ts`의 `appCredentialRequestSchema`
- 아무도 내지 않는 진단 종류 `invalid_report`: `packages/protocol/supervision/supervision.ts`, `packages/core/diagnostics/log.ts`
- 쓰는 곳 없는 `REPORTING_LIMITS` 칸: `packages/protocol/problems/sdk-report.ts`
- 쓰는 곳 없는 `KINDS_DISPATCH_PRINCIPAL`: `packages/protocol/projects/kinds-work.ts`

## 끝남

- `deno task check`가 통과한다(protocol을 바꾸므로 거의 모든 package가 돈다).
- 위험 test: 없음.
- 남지 않음:
  - `git ls-files packages/protocol/problems`에 `app-test-lookup.ts`, `exception-observation.ts`, `mod.ts`, `problem-codes.ts`, `registry.ts`, `sdk-problem.ts`, `sdk-report.ts`, `test-frames.ts`, `tests.ts`(와 4에서 남긴 경우의 `snapshots.ts`)만 있다.
  - `git grep -nE "problems/(problems|closing|problem-reads|problem-detail|reports|problem-views|problem-report|problem-feedback|problem-record|feedback|domain-problems|report-body|report-blobs|release-wording)\.ts" -- packages tools`가 0줄이다.
  - `git grep -nE 'idSchema\("(prb|snp)"\)|newId\("(prb|snp)"\)|prb_|snp_' -- packages tools`가 0줄이다.
  - `git grep -nE "snapshot_attachment|trace_body|operational_log" -- packages tools`가 0줄이다.
  - `git grep -nE '"problem\.(list|get|body|set_state|more|get_occurrence|report|record_report|submit_feedback|sync_domain|list_domain)"|"problems\.report_body"' -- packages tools`가 0줄이다.
  - `git grep -nwE "ObserveException|ObserveViewError|RecordReport|LinkProblemInterpretation|ApplyProblemDecision|ListProblems|GetProblem|ListReports|GetReport|GetSnapshot|GetSnapshotLogs|ProblemWordingPort|FEEDBACK_PROBLEM_NAME" -- packages tools`가 0줄이다.
  - 위 grep에 소유 밖 줄이 남으면 고치지 않고 보고한다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file(`protocol/*/mod.ts`, core 조립 목록, wording 생성, gallery `pages/index.ts`, `deno.json`). 이 task는 `packages/protocol/problems/mod.ts`와 `packages/protocol/mod.ts`를 소유하므로 직접 고치고 여기에 적는다
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 남은 옛 이름: 11에서 찾은 소유 밖의 것을 file:줄과 무엇인지로
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
