# releases-problems-problem-state

문제를 열림·해결됨·무시 세 상태로 다시 짠다. 새 발생을 받아 문제를 열거나 쌓거나 다시 여는 `problem.record_report`, App Engineer나 사람이 상태를 바꾸는 `problem.set_state`, 기간으로 거르는 목록과 발생 release·commit을 붙이는 상세를 만든다. 수리 ticket 연결(`problems.work`, `fixing`), 해석 연결, 닫기 규칙과 닫힘 근거 넷, 그것들의 반응기를 지운다.

- 단위: releases-problems (wave 3)
- 선행: `releases-problems-register-split`, `releases-problems-intake`(`snapshots/mod.ts`의 `insertProblemSnapshot`과 새 snapshot 표를 쓴다)
- 소유(이 task만 고친다):
  - `packages/core/problems/grouping/` (전부. `register.ts`는 register-split이 만든다)
  - `packages/core/problems/closing/` (전부)
  - `packages/core/problems/problem-codes/` (wave 1이 지웠으면 건너뛴다)
  - `packages/core/problems/reporting/commands.ts`, `model.ts`, `reads.ts`, `schema.ts`, `mod.ts`, `register.ts`
  - `packages/core/problems/mod.ts`
  - `packages/core/problems/register.ts` (조립 file)
- 읽을 것:
  - spec: S4 4장(`problem.list`, `problem.get`, `problem.set_state`), S1 5장(`ProblemOpened`, `ProblemReopened`), S2 5장 끝(문제 결정은 Gate 없음) — `/home/pyosechang/projects/lophn/project-docs/tmp/specs/agent-definition.md`, `.../event.md`, `.../approval.md`
  - inventory(`/home/pyosechang/projects/lophn/project-docs/tmp/implementation-inventory.md`): `I1.7#10`, `I1.7#13`, `I1.7#14`, `I2.1#2`(자기 path), `I2.1#11`, `I2.1#19`(problems 쪽 둘: `problems/grouping/connection.ts`, `problems/closing/connection.ts`), `I2.7#22`, `I2.7#23`(저장·읽기 쪽), `I2.7#27`, `I2.7#28`, `I2.7#29`, `I2.7#30`, `I3.7#7`, `I3.7#8`, `I3.7#9`, `I3.7#15`
  - 결정: `/home/pyosechang/projects/lophn/project-docs/tmp/inventory/00-decisions.md`의 #81(무시 중인 문제는 재발해도 다시 열지 않는다)
  - 규칙: `/home/pyosechang/projects/lophn/project-docs/dev/testing.md`
  - 지금 코드: `packages/core/problems/{grouping,closing,reporting}/`, `packages/protocol/problems/{problems,closing,problem-detail,reports}.ts`
- 계약:
  - 쓰는 것(contract-releases-problems-problems가 고정): `problemRecordSchema`, `problemStateSchema`, `problemGroupKeySchema`, route `problem.record_report`·`problem.set_state`·`problem.list`·`problem.get`·`problem.get_occurrence`, `problemListItemSchema`, `problemDetailSchema`, `releaseRefSchema`. 재발 규칙은 그 계약 file의 주석이 정본이다. `core/problems/ports.ts`의 `ReleaseLookup`(받는 것), `ProblemCounts`(내놓는 것). domain event `ProblemOpened{ app, report }`, `ProblemReopened{ app, report }`는 contract-events의 것이고 같은 transaction에 쓴다(S1 3장). `releases-problems-intake`가 내놓은 `insertProblemSnapshot`.
  - 내놓는 것: 위 route의 handler. `ProblemCounts` 구현(`open(app)`).

## 할 일

1. 표 (I2.7#22, I3.7#8). `reporting/schema.ts`의 `problems` 표를 새 꼴로 고친다(개발 data는 지운다. schema step을 그대로 고친다).
   - 칸: `id`, `app`, `group_key`(canonical JSON), `name`, `state`(`open`/`resolved`/`ignored`), `state_changed_at`, `seq`(변할 때마다 1씩 올리는 정수. 지금 `events`에서 읽던 문제 seq를 대신한다).
   - `status`, `work`, `interpretation_*`, `closure` 칸과 `problems_work`, `problems_interpretation_version` index를 뺀다. `(app, group_key)` unique는 둔다.
   - `reports` 표: `code`가 `name`이고 `text`가 message이다. `problem-codes` 관련 CHECK를 뺀다.
2. `problem.record_report` (I2.7#27, I2.1#11). `reporting/commands.ts`에 새 handler `recordProblemReportCommand`를 더한다(옛 `recordReportCommand`는 `register`가 쓰지 않게 하되 지우지 않는다).
   - 같은 tx 안에서: report 행과 snapshot(`insertProblemSnapshot`)을 쓰고, live 발생만 문제에 붙인다. 문제가 없으면 새로 만들어 `state = open`, `name`은 이 발생의 이름이고, `ProblemOpened`를 쓴다.
   - 이미 있는 문제에 대해: `open`이면 쌓기만 한다. `resolved`이고 발생의 release가 `state_changed_at`보다 뒤에 활성화됐으면(`ReleaseLookup.get(report.release).activated_at > state_changed_at`) `open`으로 다시 열고(`state_changed_at`을 지금으로) `ProblemReopened`를 쓴다. 그 전 release의 늦은 보고는 쌓기만 한다. `ignored`이면 쌓기만 한다(다시 열지 않는다, 결정 #81).
   - 재발 판정은 순수 함수 `reopenDecision({ state, state_changed_at }, releaseActivatedAt)`로 `reporting/model.ts`에 두고 handler가 부른다. 옛 `activeReleaseOf` 비교(`closed`이고 보고의 release가 지금 활성이면 연다)는 쓰지 않는다.
   - 같은 report id 재전송, 앱당 60초 20개 상한, `existing_problem`(제보가 고른 같은 앱의 live 문제) 처리는 지금 규칙을 유지한다.
   - `reportRecorded`, `snapshotRecorded`, `problemObserved` ledger event를 더 쓰지 않는다(S1 5장: 열린 문제의 또 다른 발생은 domain event가 아니다).
3. `problem.set_state` (I3.7#7, I3.7#8, I2.7#30). `grouping/commands.ts`에 handler를 더한다. 입력 `{ problem, state }`. App Engineer(actor `agent`)는 그 앱의 문제만(아니면 `forbidden`), 사람은 모두. 같은 상태로 바꾸면 그대로 ok(`seq`를 올리지 않는다). 바꾸면 `state_changed_at`을 지금으로, `seq`를 올린다. event를 쓰지 않고 Gate도 보류 request도 없다. 사람이 `ignored`·`resolved`에서 `open`으로 되돌리는 것도 이 command다.
4. 읽기 (I2.7#28, I2.7#29, I3.7#9, I3.7#15). `grouping/reads.ts`, `grouping/detail.ts`:
   - `problem.list`: `app`, `state`, `since`, `until`(마지막 발생 시각에 건다)로 거르고 커서로 이어 읽는다. 한 줄은 `{ id, app, state, name, occurrence_count, last_observed_at, seq }`.
   - `problem.get`: `problemDetail`. 발생 수, 처음·마지막 시각, `first_release`·`last_release`(`ReleaseLookup`으로 `number`, `code_commit`을 붙인다), 최근 발생 20개, `latest`(최근 발생의 snapshot). `ReleaseLookup`은 port라서 없으면 `release` 칸을 id만으로 채우지 않고 `unavailable`로 답한다.
   - `problem.get_occurrence`: 한 발생의 report 요약과 message 앞 2,000자(`preview`, `truncated`), `details_hash`, snapshot.
   - 지운다: `grouping/detail.ts`의 repair 진행·테스트 사실·닫힘·"고쳤다는 주장" 투영(`WorkState`, `RepairTicketFact`, `ProblemTestFact` 읽기), `ProblemWordingPort`/`DECLARED_FALLBACK`/`reservedProblemCodes` 기반 증상 문구(문제의 증상은 `name`이다). 읽기가 `events` 표를 보던 곳(`select ... from events where subject`)은 `problems.seq`로 바꾼다.
5. 지운다 (I1.7#10, I1.7#13, I1.7#14, I2.1#19).
   - `closing/` 전체(`commands.ts`, `connection.ts`, `model.ts`, `work.ts`, `adapters/`)와 `problem.close_verified`·`apply_problem_decision`의 handler 등록. `problems.closing` 반응기와 `grouping/connection.ts`·`grouping/work.ts`(`problems.work` 반응기), `grouping/commands.ts`의 `reconcileProblemWork`·`linkProblemInterpretation`, `grouping/interpretation.ts`, `grouping/work-ids.ts`, `grouping/fingerprint.ts`.
   - 단, 다른 task의 file이 import하는 것은 지우지 않는다. `grep -rn "grouping/\|closing/" packages --include=*.ts`로 확인한다. 알려진 것: `core/problems/tests/work/runner-service.ts`가 `grouping/work.ts`의 `reactWork`를 import한다(`releases-problems-tests`가 끊는다), `core/server/credentials.ts`가 `grouping/work-ids.ts`와 `closing/connection.ts`를 import한다(events 단위 몫), `core/apps/register.ts`가 `closing/connection.ts`의 `visibleToProblemsClosing`을 import한다(app-calls 몫), `core/apps/tickets/problem-work.ts`와 `checker`가 쓰는 옛 protocol type(coding-agent 몫). 못 지운 것은 보고의 "안 쓰게 된 export"에 적는다.
6. `core/problems/mod.ts`, `register.ts`(조립), `grouping/register.ts`, `reporting/register.ts`를 새 모양에 맞춘다: 새 command·read 등록, 옛 command(`recordReport`, `reconcileProblemWork`, `linkProblemInterpretation`, `closeProblemVerified`, `applyProblemDecision`)와 두 반응기 subscriber, `problemWorkStarted/Ended`·`problemInterpretationLinked`·`problemConfirmationRecorded`·`problemClosed` 등록을 뺀다. `createEventRegistration`의 visibility 정책 가운데 `problems.work`·`problems.closing`·notifications 전용인 것을 뺀다(events 단위가 visibility 장치를 지운 뒤 맞춘다. 지금 깨지지 않게 하는 선에서 한다). `createReaderRegistration`의 `ports`에서 `ProblemWorkPort`, `ProblemTestPort`, `ProblemWordingPort`를 뺀다.
7. `ProblemCounts` 구현을 `grouping/`에 두고(`open(app)`: `state = 'open'`인 문제 수) wiring이 apps에 넘긴다(보고).
8. `from events`(I2.1#2): 이 task의 path에서 `events` 표를 상태 근거로 읽는 곳을 각 표 읽기로 바꾼다.

- (lead가 더함, releases-problems-intake가 넘긴 것) `reporting/reads.ts`의 `SNAP_COLS`와 snapshot 읽기가 걷은 열(`screen_*`, `*_missing_reason`)을 select한다. 새 `readProblemSnapshot(sql, id)`로 바꾼다(그 전까지 옛 `GetSnapshot`·`GetSnapshotLogs`·`GetReport`는 실행 때 실패한다). `problem.record_report` handler를 짓는다(collector의 제출 경로 `/v1/problems/record_problem_report`). `collectorOperationPolicies()`에 남긴 옛 `getProblem.name`은 problems.work 반응기를 지울 때 같이 지운다. `grouping/fingerprint.ts`는 쓰는 곳이 없다.

- (lead가 더함, screens-app-space-detail이 넘긴 것) 앱 상세 Issues 탭은 재발(이전 해결 시각, 다시 난 release)을 그릴 수 있지만 `ProblemRecord`와 `problem.get`에 그 칸이 없어 core source가 `recurred: null`이다. 재발 상태를 읽기에 싣는다(`app-detail/issues/core-read.ts`의 그 줄도 맞춘다).

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "무시한 문제는 재발해도 열지 않는다" — `reporting/model_test.ts`에 `reopenDecision` 표 test. 줄: `open`+어느 release든 → 쌓기; `resolved`+해결 뒤 활성화된 release → 다시 열기; `resolved`+해결 전 활성화된 release → 쌓기; `ignored`+해결 뒤 활성화된 release → 쌓기(열지 않는다); release를 모름(`null`) → 쌓기.
- 남지 않음: `grep -rn "fixing\|closure\|interpretation_version\|PROBLEMS_WORK\|reconcileProblemWork\|linkProblemInterpretation" packages/core/problems/grouping packages/core/problems/reporting packages/core/problems/register.ts packages/core/problems/mod.ts`가 0줄이다.

## 보고

- 바꾼 file
- 등록할 것: `problem.record_report`·`problem.set_state`·`problem.list`·`problem.get`·`problem.get_occurrence` 연결은 이 task의 `register.ts`들이 한다. 소유 밖: `ProblemCounts` 구현을 apps에 끼우는 wiring(`main/daemon/wiring/problems.ts`·`apps.ts`), `ReleaseLookup`을 apps/releases 구현으로 끼우는 wiring(releases 쪽 구현은 `releases-problems-activation`의 `store.ts` 읽기를 감싼다)
- 안 쓰게 된 export: 못 지운 것 목록(위 5)
- 정한 것: 문서에 답이 없어 worker가 정한 것(예: `problems.seq` 열, `set_state`가 같은 상태면 no-op, 상세에서 발생 20개)
- 계약 바꾸기 요청(wave 3): 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
