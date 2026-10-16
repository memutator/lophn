# contract-releases-problems-problems

문제 상태(열림, 해결됨, 무시)와 재발, 보고 접수(이름과 message), 발생 근거(줄인 snapshot), 문제 읽기와 상태 바꾸기 route, core problems port를 `packages/protocol/problems`와 `packages/core/problems/ports.ts`에 고정한다. 옛 계약은 지우지 않고 새것을 옆에 더한다. 구현은 넣지 않는다.

- 단위: contract-releases-problems (wave 2)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/problems/` (옛 file은 지우지 않고, 아래 새 file을 더하고 `registry.ts`에 새 route를 더한다)
    - `problem-record.ts` (새)
    - `problem-report.ts` (새)
    - `problem-views.ts` (새)
    - `sdk-problem.ts` (새. 앱 bundle에 들어가는 portable file이라 `zod`를 import하지 않는다)
  - `packages/core/problems/ports.ts` (새)
- 읽을 것:
  - spec: S4 4장(`problem.list`, `problem.get`, `problem.set_state`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`
  - spec: S1 5장(`ProblemOpened`, `ProblemReopened`) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/event.md`
  - spec: S2 5장 끝(문제 결정은 Gate 없음) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/approval.md`
  - inventory: `I1.7#13`(`../assignment.md`에서 이 task가 맡은 줄). 모양의 근거는 wave 3 줄이다: `I1.7#9`, `I1.7#10`, `I1.7#14`, `I2.1#11`, `I2.7#22`~`I2.7#31`, `I3.7#7`~`I3.7#9`, `I3.7#15`
  - 결정: `/home/pyosechang/projects/lophn/project-docs/tmp/inventory/00-decisions.md`의 #81(무시 중인 문제는 재발해도 다시 열지 않는다), #88(제보와 annotation)
  - 지금 코드: `packages/protocol/problems/{problems,reports,snapshots,problem-reads,problem-detail,closing,sdk-report}.ts`
- 계약:
  - 쓰는 것:
    - `ProblemOpened`, `ProblemReopened`의 payload(`{ app, report }`)는 contract-events(S1)가 `protocol/events`에 둔다. 이 task는 event를 정의하지 않는다.
    - 옛 `reports.ts`의 `reportOriginEvidenceInputSchema`, `reportAcceptanceSchema`, `REPORT_ERRORS`, `recordReportCompareSchema`는 그대로 import해 쓴다.
    - `snapshots.ts`의 `logEvidenceSchema`, `logEvidenceInputSchema`, `sourceFrameSchema`, `sourceFrameInputSchema`, `invocationEvidenceSchema`, `invocationEvidenceInputSchema`도 그대로 쓴다.
  - 내놓는 것: 아래 "모양". wave 3 releases-problems-*, coding-agent(CLI의 `problem show`·`problem more`), agent-tools(`problem.*` tool), app-calls(broker의 보고 입력), screens-app-space(Issues 탭)가 쓴다. contract-coding-routes는 옛 `protocol/coding-agent/repair-context.ts`의 근거 읽기를 이 task의 `problem.more`가 대신한다고 기대한다.

## 모양

모든 새 export는 옛 export와 이름이 겹치지 않아야 한다. 이름에 판 표시(`v2`, `new`)를 넣지 않는다. 문제 상태에 `fixing`, 닫힘 근거, 수리 ticket 연결(`work`), 해석 연결(`interpretation`)은 없다(I1.7#13, I1.7#14, I1.7#10).

### `problem-record.ts`

1. 이름
   - `problemNameSchema`: 공백이 아닌 문자가 있고 제어 문자가 없는 1~120자 문자열. 앱이 보고하는 이름이고 문제를 묶는 key의 일부다.
2. 상태 (req-0154)
   - `PROBLEM_STATES = ["open", "resolved", "ignored"]`, `problemStateSchema`, type `ProblemState`
3. 묶는 key (req-0146)
   - `problemGroupKeySchema`(와 strict `problemGroupKeyInputSchema`): `kind`로 가르는 union
     - `{ kind: "named", name: problemName }`: 앱이 이름으로 보고했다. 같은 앱의 같은 이름이 한 문제다.
     - `{ kind: "exception", discriminator: sha256 | Report id }`: 처리되지 않은 오류. 해시는 오류 이름과 앱 source 위치(source map으로 푼 파일·줄)로 만든다. 위치를 못 풀면 그 발생의 Report id를 쓴다(묶이지 않는다).
     - `{ kind: "feedback", discriminator: Report id }`: 제보로 새로 연 문제
   - 옛 `invalid_report` kind는 없다(선언한 code만 받는 guard가 없다).
4. 문제 기록
   - `problemRecordSchema`(type `ProblemRecord`): `{ id: prb, app, group_key, name: problemName, state, state_changed_at: At, seq }`
   - `name`은 처음 발생의 이름이다(오류면 오류 이름, 제보면 상수 `FEEDBACK_PROBLEM_NAME = "User report"`).
   - `state_changed_at`은 `state`가 마지막으로 바뀐 시각이다. 재발 판정이 "해결됨으로 바뀐 시각"으로 쓴다.
5. 재발 규칙 (req-0168, 결정 #81). 이 task는 규칙을 주석 한 단락으로 적는다. 판정 함수는 core가 만든다.
   - 새 발생이 `open` 문제에 오면 쌓기만 한다.
   - `resolved` 문제에 온 발생의 release가 `state_changed_at` 뒤에 활성화됐으면(`ReleaseRecord.activated_at > state_changed_at`) 문제를 `open`으로 다시 열고 `ProblemReopened`를 낸다. 그 전 release에서 늦게 온 발생은 쌓기만 한다.
   - `ignored` 문제는 재발해도 다시 열지 않는다. 쌓기만 한다.
   - 새 문제를 만들 때 `ProblemOpened`를 낸다(mode가 live인 발생만 문제에 붙는다).

### `problem-report.ts`

6. 보고 접수 입력 (req-0106, SDK req-0505): 코드가 아니라 이름과 message다.
   - `problemReportInputSchema`(type `ProblemReportInput`): strict `{ report_id: Report id, name: problemName, message: 공백이 아닌 문자열, observed_at, details?: json, invocation?: invocationEvidenceInput | null }`. 크기 상한은 옛 `reportProblemInputSchema`와 같다(`REPORTING_LIMITS.automatic_body_bytes`).
   - route `problem.report`: kind worker, resource `problems`, method `report_problem`, actors `["app"]`, 출력 `reportAcceptanceSchema`, 오류 `REPORT_ERRORS`.
   - broker(`protocol/apps/broker.ts`, contract-app-calls)의 보고 입력은 이 schema를 가져다 쓴다. 보고에 알린다.
7. 발생 근거 (req-0109). 화면 증거와 "값 또는 이유 하나" 짝 체계는 없다.
   - `problemErrorEvidenceSchema`(와 input): `{ name, message: string | null, frames: sourceFrame[](최대 `REPORTING_LIMITS.snapshot_frames`), stack: sha256 | null, truncation_notes: string[] }`
   - `problemSnapshotSchema`(와 `problemSnapshotInputSchema`, 입력은 JSON 65,536 byte 이하): `{ id: snp, captured_at, invocation: invocationEvidence | null, error: problemErrorEvidence | null, logs: logEvidence | null }`. 앱 release와 실행 구분(live·preview·test)은 snapshot이 아니라 Report가 가진다.
8. 기록 입력
   - `problemReportSchema`(와 input): 옛 `reportSchema`·`reportInputSchema`에서 `code`가 `name`이고, `text`(해시)가 message다. 나머지 칸(`app`, `mode`, `diagnostic_scope`, `release`, `release_missing_reason`, `bundle_hash`, `source`, `details`, `snapshot`, `observed_at`, `principal`, `content_hash`)은 같다. `source`는 `app | exception | feedback`이다. 옛 `validCode`는 없고, `source === "exception"`이면 `name`은 오류 이름, `source === "feedback"`이면 `name === FEEDBACK_PROBLEM_NAME`, `message`는 feedback에서 필수다.
   - `problemReportBlobPurposes = ["report_text", "report_details", "snapshot_stack", "snapshot_logs"]`와 그 입력 schema. `feedback_state`, `feedback_screenshot`은 없다.
   - route `problem.record_report`: kind command, resource `problems`, method `record_problem_report`, actors `["machine"]`. 입력 `{ report, snapshot, group_key, existing_problem: Problem id | null, blobs, origin }`. 옛 `recordReportInputSchema`의 refine(origin과 report 일치, `existing_problem`은 live 제보에서만, blob 해시가 근거와 맞음)를 그대로 옮기고 화면 증거 검사만 뺀다. `compare`는 옛 `recordReportCompareSchema`, 출력은 `reportAcceptanceSchema`.

### `problem-views.ts`

9. 읽기와 상태 바꾸기 route (resource `problems`)

   | name | kind | method | actors | 입력 → 출력 |
   |---|---|---|---|---|
   | `problem.list` | read | `list_problems` | user, coding_agent, agent, machine | `{ app?, state?, since?: At, until?: At, cursor?, limit?(1~100) }` → `{ problems: problemListItem[] }`. 기간은 마지막 발생 시각에 건다(S4 4장) |
   | `problem.get` | read | `get_problem` | 같음 | `{ problem }` → 아래 `problemDetail` |
   | `problem.get_occurrence` | read | `get_occurrence` | 같음 | `{ report }` → `{ occurrence, name, message: { hash, preview(최대 2,000자), truncated } \| null, details_hash: sha256 \| null, snapshot: problemSnapshot }`. 전체 본문은 옛 `reportBody` route로 읽는다 |
   | `problem.more` | read | `more_problem` | 같음 | `{ problem, kind: ProblemMoreKind, cursor?, limit?(1~50) }` → `{ kind, items, next_cursor }`. 종류별 항목은 아래 |
   | `problem.set_state` | command | `set_state` | agent, user | `{ problem, state: problemState, key }` → `{ problem: problemRecord }`. 같은 상태로 바꾸면 그대로 ok. 오류 `not_found`, `forbidden`(App Engineer는 자기 앱의 문제만), `invalid_input`. Gate도 보류 request도 없다 |

   - `PROBLEM_MORE_KINDS`(type `ProblemMoreKind`) `= ["occurrences", "failed_invocations", "logs", "release_changes", "related_problems"]`. `problem.more`의 `items`는 `kind`로 가르는 union이다.
     - `occurrences`: `problemOccurrence[]`
     - `failed_invocations`: `{ report, invocation: Invocation id }[]` (그 문제의 발생 snapshot이 가리키는 invocation. problems는 앱 표를 읽지 못하므로 실패 여부는 확인하지 않는다. 내용은 `app.invocation` read로 본다)
     - `logs`: `{ report, snapshot: Snapshot id, log: logEvidence }[]` (본문은 옛 `GetSnapshotLogs`로 읽는다)
     - `release_changes`: `{ release: releaseRef, previous: releaseRef | null, added_resources: string[], removed_resources: string[] }[]` (발생 release와 그 직전 release의 바깥 자원 선언 차이. 코드 차이는 `problem diff`가 맡는다)
     - `related_problems`: `problemListItem[]` (같은 앱에서 마지막 발생의 release가 같은 다른 문제)
     - "지난 고친 기록"(ticket 완료 보고)과 "첨부"(annotation)는 ticket 쪽 자료라 여기에 없다. contract-coding의 ticket route가 맡는다고 보고에 적는다.
   - `problemListItemSchema`: `{ id, app, state, name, occurrence_count, last_observed_at, seq }`
   - `problemOccurrenceSchema`: `{ report, observed_at, source, release: Release id | null }` (live 발생만 문제에 붙는다)
   - `releaseRefSchema`: `{ id: Release id, number, code_commit }` (발생 release의 source commit, I3.7#15)
   - `problemDetailSchema`: `{ problem: problemRecord, occurrence_count, first_observed_at, last_observed_at, first_release: releaseRef | null, last_release: releaseRef | null, occurrences: problemOccurrence[](최근 20), latest: { occurrence, snapshot: problemSnapshot } | null }`
   - 읽기 envelope(`withReadCommon`)와 오류 목록은 옛 `problems.ts`의 `listProblems`, `getProblem`을 본보기로 한다.
   - `registry.ts`에 `PROBLEM_ROUTES`(위 route 전부와 `problem.report`, `problem.record_report`)를 export하고, 옛 `ROUTES` 배열 끝에 이어 붙인다. 옛 `EVENTS`는 건드리지 않는다.

### `sdk-problem.ts` (portable)

10. 앱 bundle에 들어가므로 `zod`와 core를 import하지 않고, type과 상수만 둔다. 옛 `sdk-report.ts`의 type은 `import type`으로 쓴다.
    - `ProblemReportCall`: `(name: string, message: string, details?: SafeReportDetails) => ReportProblemResult`, 그리고 옛 `ReportProblem`처럼 `retransmit?(reportId, details?)`
    - `ProblemReportRequest`: `{ report_id, name, message, observed_at, details?, invocation? }` (옛 `ReportProblemInput`에서 `code`가 `name`, `text`가 `message`)
    - 처리되지 않은 오류 수집(`ExceptionObservationInput` 등)은 옛 type을 그대로 쓴다. 이름 규칙(오류 이름 + 앱 source 위치)은 core가 정한다(I2.7#26).

### `core/problems/ports.ts` (type만)

11. problems가 밖과 주고받는 것을 type으로 고정한다. module끼리 직접 import하지 않으므로(code-map) 구현은 core 조립(`main/daemon/wiring/problems.ts`)이 끼운다.
    - `ReleaseFact`: `{ id, app, number, code_commit, activated_at: At | null, resources: string[] }`. `resources`는 그 release가 선언한 바깥 자원 이름(`activation`의 `added_resources`와 같은 이름 규칙)이다.
    - `ReleaseLookup`(problems가 받는 것): `{ get(id): Result<ReleaseFact | null>; activeOf(app): Result<ReleaseFact | null>; previousOf(id): Result<ReleaseFact | null> }`. `previousOf`는 같은 앱에서 `number`가 바로 앞인 release다. apps/releases가 구현한다. 재발 판정(`activated_at`), 문제 상세의 source commit, `problem.more`의 `release_changes`가 쓴다.
    - `ProblemCounts`(problems가 내놓는 것): `{ open(app): Result<number> }`. `app.get`의 열린 문제 수(S4)를 위해 apps가 받는다.
    - `Result`는 `../../base/mod.ts`에서 import한다. 구현과 `definePort`는 두지 않는다.

## 할 일

1. `problem-record.ts`를 만든다(모양 1~5).
2. `problem-report.ts`를 만든다(모양 6~8). 옛 `reports.ts`, `snapshots.ts`의 해당 schema를 본보기로 옮기고, 이름과 짝 체계만 바꾼다.
3. `problem-views.ts`를 만든다(모양 9). `registry.ts`에 `PROBLEM_ROUTES`를 더한다.
4. `sdk-problem.ts`를 만든다(모양 10).
5. `core/problems/ports.ts`를 만든다(모양 11).
6. `tests.ts`(`TEST_KINDS`의 `reproduction`, `TEST_SIDES`의 `before`·`after`)는 고치지 않는다. wave 3의 releases-problems-tests가 code에서 거절하고, enum은 cleanup이 줄인다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(계약 단위는 schema와 type만 둔다. 재발 판정은 wave 3의 releases-problems-problem-state가 test한다)
- 남지 않음: `grep -n "fixing\|closure\|interpretation\|\"work\"" packages/protocol/problems/{problem-record,problem-report,problem-views}.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `protocol/problems/mod.ts`에 새 file 네 개의 `export *`(lead). contract-app-calls의 broker 보고 입력(`protocol/apps/broker.ts`)이 `problemReportInputSchema`를 쓰도록 알린다.
- 안 쓰게 된 export(지우지 않는다): `protocol/coding-agent/repair-context.ts`의 summary·bundle·more(contract-coding 소유), `problemSchema`, `PROBLEM_STATUSES`, `closing.ts` 전부, `fixes.ts` 전부, `reconcileProblemWork`·`linkProblemInterpretation`, `ProblemWork*` event, `reportProblem`, `recordReport`, `reportSchema`, `snapshotSchema`, `screenEvidenceSchema`, `problem-codes.ts`, `release-wording.ts`, `ProblemWordingPort`·`ProblemWorkPort`·`ProblemTestPort`
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 계약 바꾸기 요청: 없음(wave 2는 직접 고친다)
