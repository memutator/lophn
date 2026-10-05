---
type: plan
concerns: [problems]
---
# problems 구현 계획

problems 최상위의 작업 전부다. 앱의 보고·exception·feedback을 불변 Report와 Snapshot으로 받아 Problem에 묶고, test runner가 app test·test command·reproduction test를 격리해 실제로 돌려 Verification을 남기며, 실제 reproduction 근거나 보호된 사람 결정으로만 문제를 닫는다.

정본: [intent](../intent/problems.md), [requirements](../requirements/problems/), [domain model](../domain-model/problems/), [architecture](../architecture/problems.md), flow [report-app-problem](../flows/report-app-problem.md), [app-broken](../flows/app-broken.md), [verify-app-repair](../flows/verify-app-repair.md).

## 순서와 까닭

problems slice는 coding-agent slice 뒤지만, 앞 slice의 flow가 problems를 먼저 쓴다. 그래서 작업을 네 slice에 나눈다.

| slice | problems 작업 | 그 slice에서 쓰는 쪽 |
|---|---|---|
| apps | T1–T12, T16, T27: problem code, 보고 접수(SDK·collector·RecordReport·묶기), view exception 귀속, 문제 read, Verification ledger, test runner control, app test | new-app 8단계·change-app 5단계(같은 hash의 app test 없이는 release 준비 불가, apps/releases#R5), restore-app-release(당시 test result, 복원 뒤 보고), run-app-automation(실패 자리의 운영 보고, 문제 목록) |
| coding-agent | T13–T14: test command와 ticket 조건 연결, 고친 기록 | manage-tickets 6단계 acceptance check, coding agent의 `ticket report` |
| problems | T15, T17–T25: feedback, snapshot 로그·보관, reproduction, work와 해석, 닫힘, flow E2E | report-app-problem, app-broken, verify-app-repair |
| operations | T26: snapshot 큰 자료 정리 뒤 부재 표시 | platform#T44의 blob GC 뒤 problems/snapshots#R17 확인 |

apps slice의 flow E2E는 apps 팀이 돌린다. problems는 그 단계가 기대는 부분을 core 통합 테스트로 먼저 닫는다.

## 자리

| concern | 자리 | architecture 모듈 |
|---|---|---|
| problems/problem-codes | `packages/problems/problem-codes/` | `problem-codes.ts`, `app-test.ts`의 필수 보고 경로 목록 |
| problems/reporting | `packages/problems/reporting/`, `packages/sdk/cap-problem/`(공개 Package `@lophn/cap-problem`, 질문 Q2), `apps/worker/problems/`의 `report-collector` kind | `sdk.ts`, `exception-observer.ts`, `collector.ts`, `reporting-ledger.ts` |
| problems/feedback | `packages/problems/feedback/` | `feedback.ts` (shell 쪽 `feedback-client.ts`는 shell 팀) |
| problems/grouping | `packages/problems/grouping/` | `fingerprint.ts`, `grouping-ledger.ts`, `work-reaction.ts` |
| problems/snapshots | `packages/problems/snapshots/` | `snapshots.ts`, `source-map.ts`, `snapshots-ledger.ts` |
| problems/tests | `packages/problems/tests/`, `apps/worker/problems/`의 `test-runner` kind | `test-runner.ts`, `test-request.ts`, `test-judgment.ts`, `test-harness.ts`, `tests-ledger.ts` |
| problems/repairs | `packages/problems/repairs/` | `repairs-ledger.ts` |
| problems/closing | `packages/problems/closing/` | `closing-reaction.ts`, `closing-ledger.ts` |

- contract는 contracts 팀이 `packages/contracts/problems/`에 먼저 둔다(모두 apps slice): test 실행·ProblemCodeDeclaration·예약 code catalog·관측 frame(이하 C-test실행, contracts#T32), 문제 보고(C-문제보고, contracts#T39), 문제 command·read(C-문제command, contracts#T40).
- core 등록(command·read·event type·ledger schema·worker kind launch spec)은 `apps/core/problems.ts`, worker kind entry는 `apps/worker/problems/`만 problems가 고친다(lead 결정; registry는 platform#T8, T9).
- `report-collector`와 `test-runner`는 core가 감독하는 상시 worker kind다. 실제 test 자식만 요청마다 띄운다(질문 Q1). 감독 통로는 child stdin·stdout 위 길이 prefix binary frame이다(codec contracts#T6).

## apps slice

### T1 problem code 선언 검사와 예약 code

- 등급: 좁은
- concern: problems/problem-codes
- 요구: problems/problem-codes#R1, R2, R3, R5, R6, R7
- 자리: packages/problems/problem-codes/
- 쓰는 contract: C-test실행(contracts#T32)의 ProblemCodeDeclaration schema·예약 code catalog
- 내놓는 contract: 없음(schema와 catalog는 contracts/problems 상수; 이 package는 검사 함수를 problems 안에만 내놓는다)
- slice: apps
- 선행: contracts#T32
- 상태: 완료 (#47)
- 완료:
  - `model_test.ts`: code 정규식(1자·49자·hyphen·대문자 거절, 2자·48자 통과), blueprint 안 중복 거절, message_key·en·fixer 누락·공백·CR/LF·치환 자리표시자 거절, `_`로 시작하는 선언 거절(R1, R2, R5)
  - 예약 3종(`_exception`, `_feedback`, `_invalid_report`)의 key·en·fixer가 catalog와 같고, 앱 선언 0개에서도 3종이 별개로 나온다(R6)
  - 이전 release 선언과 비교해 같은 code의 message·fixer가 바뀐 것을 "의미 변경 확인 대상"으로 돌려준다(R3, 질문 Q5)
  - `fixer`를 근거로 권한·claim·닫힘을 주는 함수가 없고, fixer=user 문제도 closing 쪽 권한 검사를 그대로 받는다는 테스트(R7; T20에서 닫힘 거절로 다시 확인)
  - `requiredReportPaths(bundle)`: 선언 code별 실패 경로, process exception, redaction, 화면 있으면 view exception·feedback, 화면 없으면 이유 있는 `not_applicable` 목록(T9가 씀)

### T2 Report·Snapshot·Problem 접수 ledger (RecordReport)

- 등급: 기본
- concern: problems/reporting, problems/grouping, problems/snapshots
- 요구: problems/reporting#R3, R4, R9, R10, R11, R12; problems/grouping#R1, R7, R10
- 자리: packages/problems/reporting/ (model.ts, commands.ts), packages/problems/grouping/ (model.ts, 접수 transaction 안의 묶기 함수), packages/problems/snapshots/ (model.ts, 접수 안 insert), `reports`·`snapshots`·`problems` ledger schema, apps/core/problems.ts
- 쓰는 contract: platform command(한 transaction 안 여러 표·event, idempotency), 인증(collector machine scope와 원주체 증거), blob(영구 참조 등록)
- 내놓는 contract: C-문제보고의 `POST /v1/problems/record-report`, event `ReportRecorded`, `SnapshotRecorded`, `ProblemOpened`, `ProblemObserved`
- slice: apps
- 선행: contracts#T39, contracts#T6, platform#T1, platform#T2, platform#T4, platform#T9, platform#T14
- 상태: 완료 (#179)
- 완료:
  - `commands_test.ts`(메모리 SQLite): 같은 ID·principal·content hash 재전송은 원래 결과, principal이나 내용이 다르면 `conflict`, 동시 제출에도 Report·Snapshot·Problem이 하나씩(R9)
  - 저장 중 실패 주입 시 Report·Snapshot·Problem·event가 하나도 남지 않고 실패를 돌려준다(R10)
  - 같은 시각·같은 group key라도 ID가 다르면 각각 남고 UPDATE·DELETE 경로가 없다(R11)
  - event envelope 시각으로 앱당 60,000ms 안 새 Report 21번째는 `unavailable`, 같은 ID 재전송은 세지 않는다. `observed_at`으로 창을 우회하지 못한다(R12)
  - 첫 live Report 하나로 `ProblemOpened`, 같은 key는 `ProblemObserved`; 2번째 발생을 기다리는 상태가 없다(reporting#R3, grouping#R1)
  - preview·test는 `problem=null`과 diagnostic scope 필수, 운영 Problem 상태·수가 바뀌지 않는다(reporting#R4, grouping#R7)
  - 닫힌 문제도 `(app, group_key)` unique로 같은 Problem을 찾고 기간 상한이 없다(grouping#R10; reopen 분기는 T21)

### T3 report collector worker와 보고 접수 통로

- 등급: 기본
- concern: problems/reporting, problems/problem-codes
- 요구: problems/reporting#R1, R2, R8, R16; problems/problem-codes#R5
- 자리: packages/problems/reporting/ (work.ts, adapters/core-client.ts), apps/worker/problems/의 `report-collector` kind, apps/core/problems.ts의 launch spec
- 쓰는 contract: platform 인증(앱 실행 credential claim: app, release, bundle_hash, mode, diagnostic_scope), API transport의 worker 전달 route, redaction, diagnostics, command; apps release 준비·적용(credential의 bundle_hash로 찾는 읽기 전용 bundle 사본 `apps/<app ID>/bundles/<bundle hash>/blueprint.json`의 problem code 선언; 경로 계산 함수는 contracts#T36)
- 내놓는 contract: C-문제보고의 `POST /v1/problems/report`, `POST /v1/problems/observe-exception`(process 출처)
- slice: apps
- 선행: problems#T1, problems#T2, contracts#T12, platform#T5, platform#T6, platform#T7, platform#T8, platform#T9, platform#T12, platform#T15, apps#T6
- 상태: 진행 (#198, #216) — 남은 것: 통합 테스트에서 credential 이름 검증에 root 대신 접수 credential을 쓰는 것(lead 몫)
- 완료:
  - collector는 `deno run --no-prompt`에 core loopback `--allow-net`과 준비 폴더 `--allow-read`만 받는다(architecture 2.2)
  - 앱 actor·app·release·mode는 credential에서만 정한다. 본문의 `actor`, 다른 앱, `live` 주장은 `forbidden`, 다른 앱 제출은 거절(R1, R2)
  - release를 모르면 `release_missing_reason`이 남는다(R2)
  - 미선언 code와 `_` 예약 code 직접 제출은 `invalid_input`; 원래 ID에서 결정적으로 정한 별도 ID의 `_invalid_report` 진단은 재전송해도 1개, 진단 실패는 platform/diagnostics로 가고 재귀 보고하지 않는다(reporting#R8, problem-codes#R5)
  - collector 대기 128개·16,777,216 bytes·동시 조립 4개, 자동 보고 본문 262,144 bytes 초과는 실패와 손실 이유(R16)
  - core가 `unavailable`이거나 응답을 잃으면 같은 고정 내용만 다시 보내고 snapshot을 다시 조립하지 않는다(R16)
  - 통합: core를 띄우고 실행 credential로 `/v1/problems/report`를 불러 Report·Problem이 생긴다(run-app-automation 다른 갈래의 기반)

### T4 exception 지문과 오류·invocation snapshot 조립

- 등급: 기본
- concern: problems/grouping, problems/snapshots, problems/reporting
- 요구: problems/grouping#R2, R3, R4, R5; problems/snapshots#R1, R2, R3, R4, R5, R6, R8, R9, R10, R11, R18, R20; problems/reporting#R14
- 자리: packages/problems/grouping/fingerprint.ts, packages/problems/snapshots/ (work.ts, source-map.ts)
- 쓰는 contract: blob(준비), redaction, apps release 준비·적용(읽기 전용 준비 폴더의 source), apps invocation read(ID로 기록 도착 확인)
- 내놓는 contract: 없음(C-문제보고 안의 Snapshot 값)
- slice: apps
- 선행: problems#T3, contracts#T35, apps#T11
- 완료:
  - `fingerprint_test.ts`: 같은 함수에서 줄·열·message·업무 값만 바꾼 오류는 같은 지문, 다른 상위 앱 위치는 다른 지문; 절대 path·SDK·runtime frame 제외; 앱 frame 0개면 Report ID discriminator로 같은 TypeError 2개가 합쳐지지 않는다(grouping#R2, R3)
  - `_invalid_report`는 안전한 잘못된 code로 묶고, 안전하지 않으면 원래 Report ID로 나눈다(grouping#R4)
  - 문제 read와 event 어디에도 지문 일치를 원인 확정으로 적는 필드가 없다(grouping#R5)
  - process stack은 당시 release의 상대 source로 위치를 찾고, 준비 폴더 밖 path·symlink는 읽지 않고 이유를 남긴다. map·앱 frame이 없으면 `source_missing_reason`(snapshots#R6, R11)
  - 오류 frame 최대 32개, redaction된 stack 최대 16,384 bytes, 넘치면 `truncation_notes`·제외 이유(snapshots#R10, R20)
  - SDK·view가 실제 연결한 invocation만 담고, ID를 알지만 기록이 아직 없으면 ID와 `record_missing_reason`, 시간 근접 추정 없음(snapshots#R8, R9)
  - invocation·오류·로그·화면 네 항목 모두 값 또는 공백 아닌 이유 하나; 정상 0줄·잘림·redaction·source 장애·수집 꺼짐·기한 내 미수신을 구별(snapshots#R4, reporting#R14)
  - 전체 2,000ms, 큰 자료 준비 2,359,296 bytes 상한에서 큰 항목부터 제외하고 이유를 고정, 남은 자료로 접수; 작은 Report·Snapshot도 저장 못 하면 접수 실패(snapshots#R5, R18, R20)
  - `captured_at`과 `observed_at`을 따로 두고, 앱 자기 보고·플랫폼 관측·사람 진술 출처를 값에 남긴다. 나중 자료로 UPDATE하지 않는다(snapshots#R1, R2, R3)

### T5 앱 SDK 보고와 process exception observer

- 등급: 기본
- concern: problems/reporting
- 요구: problems/reporting#R1, R5, R13, R16
- 자리: packages/sdk/cap-problem/ (`@lophn/cap-problem` 1.0.0, apps/sdk#R26; catalog 등록은 apps#T5, 진입점 연결은 apps#T7, 질문 Q2)
- 쓰는 contract: C-문제보고의 SDK 모양; transport는 앱 진입점이 넘긴다(live·preview는 apps broker `/problems/report`, test는 private IPC)
- 내놓는 contract: C-문제보고의 SDK `reportProblem(code, details?) → {report_id, completion}`, `installExceptionObserver(transport)`
- slice: apps
- 선행: contracts#T39
- 상태: 완료 (#99)
- 완료:
  - `reportProblem`은 Report ID를 첫 전송 전에 고정하고 실제 invocation 문맥을 붙인 뒤 업무 응답을 막지 않는다; completion은 값으로 끝나 전송 실패가 새 `unhandledrejection`을 만들지 않는다(R1, R13)
  - 대기 32개·4,194,304 bytes 초과는 새 입력 거절, 원문을 디스크에 쓰지 않는다; retry는 일시적 `unavailable`·응답 유실에만 첫 시도 뒤 250/1,000/3,000ms 최대 3회, 같은 고정 내용만(R16)
  - 대기·전송 실패·접수 완료를 completion 값으로 구별하고, retry가 원래 앱 command를 다시 부르지 않는다(R13)
  - observer는 앱 code 로드 전에 `error`, `unhandledrejection`을 잡아 관측 ID를 먼저 정해 보내고 `preventDefault`로 원래 실패를 숨기지 않는다(R5 process 쪽)
  - apps#T7(진입점)·apps#T22(템플릿)의 선행이 된다

### T6 문제 목록·상세·보고 read

- 등급: 기본
- concern: problems/grouping, problems/reporting, problems/problem-codes
- 요구: problems/reporting#R7, R15; problems/grouping#R5, R11, R12; problems/problem-codes#R6
- 자리: packages/problems/grouping/reads.ts, packages/problems/reporting/reads.ts, packages/problems/snapshots/reads.ts
- 쓰는 contract: platform read(scope 검사), redaction(외부 반환 전)
- 내놓는 contract: C-문제command의 `list`, `get`, `list-reports`, `get-report`, `get-snapshot`
- slice: apps
- 선행: problems#T2, problems#T4, contracts#T40
- 완료:
  - `ListProblems`: app·status·cursor·limit(최대 100), seq cursor로 페이지 고정; 기본 항목은 앱·증상·진행·필요한 다음 행동만(grouping#R11)
  - `GetProblem`: 진행·실제 담당·필요한 사람 조치를 먼저, 보고 수·처음/최근 시각·당시 release는 펼친 상세 값; 수는 Report에서 계산하고 별도 counter가 없다; claim·기한·연결 식별자를 내보내지 않는다(grouping#R11, R12)
  - 예약 3종은 catalog key·en 그대로(problem-codes#R6); 선언 code의 문구는 T27이 채우고, 그 전과 선언을 읽을 수 없을 때는 앱 이름과 "확인할 문제" 안내
  - apps#T19를 기다리지 않는다: coding-agent#T18(ticket 생성의 문제 확인)이 이 작업을 기다리고 apps#T19가 coding-agent#T19를 기다리기 때문이다
  - 일반 read 응답과 오류 응답에 raw code·stack이 없고, 수리 조회 권한에서만 redaction된 상세를 준다(reporting#R7)
  - 보고와 원인 가설을 다른 필드로 둔다(grouping#R5)
  - 보고한 앱 범위에서 목록 → 상세 → 보고 → snapshot 순서로 읽힌다(reporting#R15)
  - test·preview 진단은 해당 scope로만 `list-reports`에 나오고 운영 집계에 들어가지 않는다

### T7 Verification ledger와 test 요청·결과 command·read

- 등급: 기본
- concern: problems/tests
- 요구: problems/tests#R1, R2, R3, R4, R5
- 자리: packages/problems/tests/ (model.ts, commands.ts, reads.ts), `verifications`·`verification_reports`·test 요청 기록(append-only) ledger schema, apps/core/problems.ts, docs/domain-model/problems/tests.md·docs/architecture/problems.md(요청 기록 표)
- 쓰는 contract: platform command(idempotency), read, 인증(runner의 고정 machine principal과 결과 전용 scope), blob
- 내놓는 contract: C-test실행의 `request-test`(core 접수 쪽), `record-verification`, `get-test-request`, `get-verification`, `list-verifications`, event `VerificationRecorded`
- slice: apps
- 선행: contracts#T32, platform#T2, platform#T3, platform#T5
- 상태: 완료 (#76)
- 완료:
  - `model_test.ts`: kind별 필드 규칙(app_test는 problem·before/after 없음·reports 빈 목록, reproduction은 problem·report 1개 이상·basis_seq·서로 다른 before/after·target=after, test_command만 ticket), TestMethod timeout 필수 1~300,000ms
  - runner machine만 `RecordVerification`; agent·앱·test 자식 credential은 `forbidden`(R1)
  - 실제 시작하지 않은 요청은 Verification이 없다; timeout·중단·runner 상실·근거 부족은 `inconclusive`(R4)
  - 같은 principal·key·hash는 같은 접수·결과, 다른 hash는 `conflict`, 다시 돌리면 새 key·ID(R3)
  - Verification이 고정 대상·test·입력·기대·runner·환경·시작·끝·종료 이유·출력·제외 범위 참조를 모두 가진다; release 준비 전 bundle hash 대상도 읽힌다(R2)
  - 접수·시작 시도·runner 식별·복구를 problems 소유 append-only 요청 기록 표에 남기고(UPDATE·DELETE 없음), `GetTestRequest`가 요청자 자기 key의 미실행·준비 실패·접수 대기·시작 흔적·결과 참조를 구별한다; 결과 read가 실제 종료 시각·실행 증거를 연다(R5)
  - 같은 PR에서 domain-model/problems/tests의 "별도 test 큐 entity 없음"과 architecture/problems 3.1 표를 이 요청 기록 표에 맞게 고친다(질문 Q14)

### T8 test runner control: 준비·격리 실행·한도·관측 protocol·복구

- 등급: 최상위
- concern: problems/tests
- 요구: problems/tests#R13, R14, R16, R17, R19, R20, R21
- 자리: packages/problems/tests/ (work/: runner, prepare, spawn, ipc, spool, recovery; adapters/: deno process, memory limit), apps/worker/problems/의 `test-runner` kind, apps/core/problems.ts의 launch spec
- 쓰는 contract: platform 프로세스 감독(자식 lifecycle), 인증, blob, redaction, platform/security(process 메모리 한도 adapter), apps release 준비·적용(읽기 전용 bundle 사본 `apps/<app ID>/bundles/<bundle hash>/`), apps 앱 통로의 진입점 protocol(test 앱 자식은 운영과 같은 진입점·두 socket HTTP protocol, runner가 broker와 caller 역할)
- 내놓는 contract: C-test실행의 `request-test`(runner 준비 쪽)
- slice: apps
- 선행: problems#T7, contracts#T34, platform#T7, platform#T8, platform#T12, platform#T30, apps#T6, apps#T7
- 상태: 완료 (#191, #203)
- 완료:
  - 자식은 `deno test --no-prompt --cached-only --frozen-lockfile --v8-flags=--max-old-space-size=256`, 읽기는 고정 source·의존·harness, 쓰기는 side의 scratch·fixture DB, 환경은 명시한 안전 변수만; `-A`·무제한 read/write/env/net·`--allow-run`·FFI 요청은 거절(R13, R14). deno 2.9에 `--locked`가 없어 잠긴 lockfile은 `--frozen-lockfile`이다
  - 운영 DB·backup·keychain·홈 경로 접근이 실패하고 fixture DB만 바뀐다(R13)
  - argv는 허용한 Deno test 진입점만, shell 문법·native 실행 파일·`..`·묶음 밖 symlink·timeout 누락은 시작 전 거절(R16, R19)
  - private IPC 관측 frame 65,536 bytes·side 1,048,576 bytes, side와 test hash 불일치·잘못된·누락·초과 관측은 `inconclusive`; stdout의 pass 문자열과 자식이 만든 파일은 판정에 안 쓴다(R19)
  - 실제 실행 동시 2개·준비 대기 16개(넘치면 접수 전 `unavailable`), 출력 side 1MiB 넘으면 drain 계속하며 잘림 표시, process 메모리 536,870,912 bytes는 platform#T30 interface가 돌려준 방식으로 강제한다: Linux·Windows는 hard(cgroup v2, Job Object), macOS는 soft(V8 heap 상한 + process tree RSS watchdog); 실행 환경과 Verification에 상한 방식 hard/soft를 남기고, 어느 방식도 쓸 수 없으면 `unavailable`; 메모리·timeout 종료는 `inconclusive`(R20)
  - 같은 PR에서 problems/tests#R20을 lead 결정(macOS soft 상한과 방식 기록)에 맞게 고친다(질문 Q8)
  - 시작 시도를 공통 기록에 확정한 뒤에만 spawn; spawn 실패는 Verification 없음; runner를 죽이면 감독이 자식을 회수하고 새 runner가 실제 시작한 요청만 `runner_lost`·`inconclusive`로 기록, 같은 요청을 다시 시작하지 않는다(R17)
  - 확정된 작업 폴더는 바로 정리, 결과 응답 유실 때 redaction 완료 spool로 같은 결과를 다시 보내고, 미확정 spool은 최대 24시간 뒤 판정 불가 복구 후 정리; 시작 여부를 모르면 요청 조회에 확인 불가만 남긴다(R21)
  - test 앱 자식의 SDK 보고는 runner가 broker로 받아 그 요청의 `mode=test`·scope를 붙여 collector에 넘긴다; 자식은 core·collector 주소와 credential을 받지 않고, 자식 메시지로 live 전환·결과 기록을 요청할 수 없다
  - 작업 폴더 0700, spool 0600, credential 없음

### T9 app test: 필수 보고 경로와 선언 검사

- 등급: 기본
- concern: problems/tests, problems/problem-codes
- 요구: problems/tests#R6, R7; problems/problem-codes#R3, R8, R9
- 자리: packages/problems/tests/ (app-test/: 검사 생성·판정, harness/: test 자식 안 플랫폼 harness)
- 쓰는 contract: FrozenTest의 고정 blueprint(apps blueprint 타입), apps 진입점의 ReadyAttestation{bundle_hash, commands(실제 등록 목록), data_schema, process_nonce}과 `/_lophn/control/probe`(contracts#T34), apps/sdk의 고정 SDK 의존, C-문제보고(test scope 보고 접수)
- 내놓는 contract: 없음(C-test실행의 app_test kind)
- slice: apps
- 선행: problems#T1, problems#T3, problems#T5, problems#T8, apps#T2, apps#T6, apps#T7
- 완료:
  - 플랫폼 필수 검사 code는 runner의 불변 설치 자료에서 읽고, bundle 안의 검사 삭제·수정은 실패한다; bundle이 바뀌면 새 hash의 새 app test가 필요하다(tests#R6)
  - 선언·blueprint/handler 일치·고정 SDK·정적/동적 code 사용·SDK 접수(completion을 기다려 실제 접수 확인)·process exception·redaction·permission 거절을 검사하고 각 경로를 하나씩 뺀 fixture는 통과하지 못한다(tests#R7, problem-codes#R8)
  - 선언 code마다 실제 앱 command에 fixture 실패를 주입한 실패 경로 test가 1개 이상 있어야 하고, SDK 직접 호출 test만 있으면 통과하지 못한다(problem-codes#R9)
  - 이전 release 선언과 같은 code의 의미 변경을 관측에 남긴다(problem-codes#R3)
  - 모든 필수 검사가 실제 pass일 때만 `pass`, 검사별 status·reason·evidence가 observations에 있다
  - 통합: 준비된 bundle의 app test pass Verification을 같은 bundle hash로 읽는다(new-app 8단계, apps/releases#R5의 기반; apps#T19의 선행)

### T10 app test: 앱 계약 검사 (migration, read, automation, permission, 대역)

- 등급: 기본
- concern: problems/tests
- 요구: problems/tests#R8, R9, R12, R15
- 자리: packages/problems/tests/ (app-test/의 앱 계약 검사, harness/의 fixture DB·대역)
- 쓰는 contract: apps/worker `data` kind의 migrate job(fixture DB), apps blueprint 타입(read 입력 계약, automation·되돌림 선언), apps 대역 adapter(secret, 외부 쓰기, 문서 저장, 다른 앱), apps/permissions·apps/automations의 실행 가능 범위
- 내놓는 contract: 없음
- slice: apps
- 선행: problems#T9, contracts#T36, apps#T17, apps#T21
- 완료:
  - 빈 test DB 전체 migration과 이전 release schema → 새 schema migration을 각각 돌리고 한쪽 실패면 통과하지 않는다(R8)
  - 잘못된 입력·read의 업무 쓰기·grant 없는 접근·confirm automation은 실패; grant된 secret 대역의 read·write 가져오기·동기화와 한 번 승인한 external automation은 허용; 출력 schema는 필수로 만들지 않는다(R9)
  - net·secret·문서 쓰기는 고정 대역뿐이고 실제 외부 host 접속이 없다(R15)
  - observations가 검사한 고정 기준·입력 범위와 인접 불변식을 별도 항목으로 구별한다(R12)
  - 되돌리기를 지원하는 write는 변경 → 되돌림 → 원래 업무 상태 일치, 후속 변경 뒤 되돌림 충돌, 중복 되돌림 거절을 검사한다(apps/blueprint#R21의 확인; 같은 PR에서 problems/tests#R9와 architecture/problems 7.4를 고친다, 질문 Q10)
  - 통합: change-app 5단계의 migration 2종 app test

### T11 app test: 화면 검사

- 등급: 기본
- concern: problems/tests, problems/problem-codes, problems/reporting
- 요구: problems/tests#R7; problems/problem-codes#R8; problems/reporting#R5
- 자리: packages/problems/tests/ (app-test/의 화면 검사, adapters/의 앱 화면 검사 host client)
- 쓰는 contract: shell 앱 화면 틀의 앱 화면 검사 host(Electron `--app-screen-test`, 사람 token·core 연결 없음, 임시 userData, `app-test-<run>` 메모리 partition, offscreen; runner가 child로 띄우고 상속 fd 3의 JSON lines로 주고받는다; 타입은 contracts/shell)
- 내놓는 contract: 없음
- slice: apps
- 선행: problems#T9, contracts#T38, shell#T46
- 완료:
  - 화면 있는 bundle은 test view에서 view `error`·`unhandledrejection`·루트 render 오류가 test 진단 scope로 접수되는지와 깨진 view의 feedback 경로를 검사한다(tests#R7, problem-codes#R8, reporting#R5 view 쪽)
  - 화면 검사를 띄울 수 없으면 화면 있는 app test는 `pass`가 아니다; 화면 없는 bundle만 이유 있는 `not_applicable`
  - host가 돌려준 view 예외·feedback 관측은 runner가 그 요청의 `mode=test`·scope로 collector에 넘겨 test 진단 scope에만 남는다; test view는 운영 view session·credential·DB를 쓰지 않는다
  - runner의 `--allow-run`에 host 실행 파일이 더해지므로 같은 PR에서 architecture/problems 2.2를 고친다(질문 Q11)
  - 통합: 화면 있는 fixture 앱의 app test가 pass이고, view 예외 수집을 뺀 fixture는 fail

### T12 개발 fixture로 test runner 검증

- 등급: 기본
- concern: problems/tests
- 요구: problems/tests#R18
- 자리: packages/problems/tests/ (fixture 통합 테스트), packages/problems/tests/testdata/ (app test 실패를 일부러 만드는 작은 bundle 변형)
- 쓰는 contract: C-test실행, apps 개발 fixture 앱(rate limit 대시보드 = 집계 기간·시간대·coverage, 할 일 = 파일 편집·변환의 blob·충돌, 캘린더 = 외부 연동 효과 불확실성, 일부러 깨지는 앱)
- 내놓는 contract: 없음
- slice: apps
- 선행: problems#T10, problems#T11, apps#T23, apps#T24, apps#T25, apps#T26
- 완료:
  - 3종 fixture의 app test가 각각 기간·시간대·coverage, blob·충돌, 효과 불확실성 관측을 남기고 pass한다; 새 제품 앱 등록 약속으로 다루지 않는다(R18)
  - 깨지는 앱의 app test가 pass하고(선언 실패 경로·exception·view 오류 경로가 실제로 보고됨), testdata 변형(실패 경로 test 없음, SDK 직접 호출 test만, root 오류 경계 없음, read의 업무 쓰기, confirm automation)은 각각 fail
  - 깨지는 앱의 시나리오 목록은 apps 팀에 보낸다(apps#T26이 만든다)

### T16 view exception 귀속과 화면 source map

- 등급: 기본
- concern: problems/reporting, problems/snapshots
- 요구: problems/reporting#R5, R6; problems/snapshots#R11
- 자리: packages/problems/reporting/ (view 출처 처리), packages/problems/snapshots/source-map.ts
- 쓰는 contract: shell 앱 화면 틀의 view-error 전달(인증된 view binding), apps release 준비·적용(당시 bundle의 source map)
- 내놓는 contract: C-문제보고의 `observe-exception`(view 출처)
- slice: apps
- 선행: problems#T4, contracts#T38, shell#T38
- 완료:
  - view의 `error`·`unhandledrejection`·루트 render 오류가 해당 앱 Report가 되고 원래 실패가 성공으로 바뀌지 않는다(reporting#R5)
  - 다른 앱 이름을 넣은 view 오류도 실제 view 앱의 진단으로만 접수, 페이지의 app·release·mode는 무시(reporting#R6)
  - view stack은 당시 release source map으로 원래 TSX 파일·줄; map이 없으면 위치를 추측하지 않고 이유(snapshots#R11)
  - 앱 자격은 확실한데 앱 frame만 없으면 Report별 key로 받고, 귀속 불명은 platform/diagnostics

### T27 문제 문구: 보고 당시 release 선언

- 등급: 좁은
- concern: problems/problem-codes, problems/grouping
- 요구: problems/problem-codes#R4; problems/grouping#R11
- 자리: packages/problems/grouping/reads.ts (문구 projection)
- 쓰는 contract: apps `/v1/apps/blueprint`(Report의 bundle·release의 problem code 선언 message_key·en)
- 내놓는 contract: C-문제command의 `list`·`get` 문구 필드
- slice: apps
- 선행: problems#T6, apps#T19
- 완료:
  - 선언 code 문제의 증상 문구는 보고 당시 release(또는 bundle)의 선언 message_key·en이다; 새 release에서 선언을 바꾸거나 지워도 이전 보고는 당시 문구다(problem-codes#R4)
  - 당시 선언을 읽을 수 없으면 앱 이름과 "확인할 문제" 안내(problem-codes#R4)
  - 목록의 기본 항목(앱·증상·진행·다음 행동)에 이 문구가 들어간다(grouping#R11; run-app-automation 다른 갈래의 기반)

## coding-agent slice

### T13 test command와 ticket 조건 연결

- 등급: 기본
- concern: problems/tests
- 요구: problems/tests#R4, R5, R16
- 자리: packages/problems/tests/ (test_command kind, TicketTestLink 검사)
- 쓰는 contract: coding-agent의 getTicket read(app, conditions의 position·condition_hash, completion_seq)
- 내놓는 contract: 없음(C-test실행의 test_command kind)
- slice: coding-agent
- 선행: problems#T8, contracts#T41, coding-agent#T18
- 상태: 완료 (#222) — 이어보냄: manage-tickets 6단계 acceptance check가 쓰는 Verification 통합 확인 → coding-agent#T41
- 완료:
  - 분리된 argv·고정 cwd·기대 종료값으로 실행; 다른 종료값은 `fail`, 중단은 `inconclusive`(R4, R16)
  - ticket 없는 test command도 된다; ticket을 붙이면 check index·hash·completion seq가 필수이고 결과에 그대로 남으며 낡은 결과도 보존한다; ticket 판정은 runner가 하지 않는다
  - 완료 보고 뒤 테스트 미실행·실패와 실제 pass를 같은 결과 옆에서 구별해 읽는다(R5)
  - 통합: manage-tickets 6단계의 acceptance check가 쓰는 Verification

### T14 고친 기록

- 등급: 기본
- concern: problems/repairs
- 요구: problems/repairs#R1, R2, R3, R4, R5, R6, R7
- 자리: packages/problems/repairs/ (model.ts, commands.ts, reads.ts)
- 쓰는 contract: platform command·event, blob(summary), apps releases.get(같은 앱·준비됨), coding-agent의 getTicket(문제 포함 여부)과 checkTicketClaim({ticket, claim_seq, actor connection, now}, 같은 core transaction 안)
- 내놓는 contract: C-문제command의 `record-fix`, `list-fixes`, event `ProblemFixRecorded`
- slice: coding-agent
- 선행: problems#T6, problems#T7, contracts#T40, contracts#T41, coding-agent#T18, coding-agent#T19, apps#T19
- 완료:
  - coding_agent actor만; 앱·다른 앱 release·준비되지 않은 release·before=after는 거절; 두 release·summary·인증된 작성자(envelope)·시각을 읽는다(R1)
  - verification 빈 목록도 기록; 다른 bundle·다른 problem의 결과는 거절; shell 로그는 summary 설명일 뿐(R2)
  - 낡은 문제 seq는 `conflict`; 새 기록·늦은 결과가 이전 기록을 고치지 않는다(R3)
  - 새 제출은 ticket·현재 claim seq 필수, 누락·만료·반납·회수·다른 claim은 거절; 과거 null 출처는 읽기만(R4, R5)
  - 제출이 테스트 자식이나 닫힘을 만들지 않는다(R6)
  - 설정·입력 조치는 이 command를 요구하지 않는다(R7; 닫힘은 T21)

## problems slice

### T15 feedback 접수

- 등급: 기본
- concern: problems/feedback, problems/grouping, problems/snapshots
- 요구: problems/feedback#R1, R2, R3, R4, R6, R7, R8, R9, R10, R14; problems/grouping#R6; problems/snapshots#R15
- 자리: packages/problems/feedback/ (model.ts, work.ts), packages/problems/snapshots/의 화면 증거
- 쓰는 contract: shell 앱 화면 틀의 feedback binding(app, release, mode, 관측 시점, 선택, 최종 이미지 hash), 인증(shell user), redaction
- 내놓는 contract: C-문제보고의 `POST /v1/problems/submit-feedback`
- slice: problems
- 선행: problems#T4, contracts#T38, platform#T16 (shell#T52 화면은 이 작업 뒤; binding은 contracts#T38 모양으로 테스트)
- 완료:
  - 인증된 shell user만 `source=feedback`, `code=_feedback`; app·agent 제출은 거절; 글은 redaction 뒤 공백 외 1~500 Unicode scalar(R1)
  - 명세가 없거나 HTTP 200이었던 경우도 거절하지 않는다(R2)
  - 알려진 표시 결과·invocation·automation·고정 판만 지목하고 모르면 모른다고 남긴다; 시작 전 입력 검사 실패는 invocation 없이 "실행 전"(R3, R4)
  - 화면 상태는 화면명·탭·URL path·안전 hash·입력 형태만, query 값·업무 DB·command 원입력·read 결과 전체는 빠지고 이유만(R7)
  - screenshot은 선택 표시와 binding의 최종 hash가 맞을 때만 저장; PNG 머리, 긴 변 1,600px, 2,097,152 bytes; 상태 65,536 bytes; 전체 3,145,728 bytes(R6, R8, R9)
  - 미선택·화면 없음·수집 꺼짐·수집 실패·redaction 제외·저장 실패가 각각 이유로 남고 글은 접수된다(R10, snapshots#R15)
  - `existing_problem`은 같은 앱일 때만 그 key, 아니면 첫 Report ID로 새 문제; 비슷한 글 2개는 별도 문제(grouping#R6)
  - "직접 해 봤지만 안 됩니다"는 새 Report이고 닫힘·오탐 결정이 아니다(R14)

### T17 snapshot의 로그 증거, 수집 범위와 보관

- 등급: 기본
- concern: problems/snapshots
- 요구: problems/snapshots#R6, R7, R12, R13, R14, R16, R17, R19
- 자리: packages/problems/snapshots/ (work.ts의 로그 수집, reads.ts의 허용된 진단 조회)
- 쓰는 contract: apps.logs {app, invocation?, limit, byte 상한} → {lines, collected_at, truncated, state none|off|timeout|ok}, platform/settings(진단 상세 수집 끄기), blob(보존 등급, 정리된 blob의 이유), read
- 내놓는 contract: 없음
- slice: problems
- 선행: problems#T4, apps#T9, platform#T14, platform#T25
- 완료:
  - 알려진 invocation으로 좁힌 최근 최대 30줄·65,536 bytes, 실제 범위·`collected_at`·잘림; 연결 없는 로그는 "앱 로그 조각"; 한 줄 길이 기본값 없음(R12)
  - 앱 buffer를 비운 뒤에도 고정한 로그 조각이 읽힌다(R13)
  - 잘린 로그에서 전체 실패율 같은 값을 만들지 않는다(R14)
  - 수집 꺼짐은 새 상세 수집만 멈추고 기존 snapshot 읽기·invocation 기록은 그대로, 새 자료에 "수집 꺼짐" 이유(R7)
  - 다른 앱 source·DB 전체는 제외되고 안전한 형태만(R6)
  - 앱 프로세스는 snapshot 첨부를 직접 읽지 못하고 허용된 진단 조회만(R16)
  - 큰 자료(첨부 PNG·로그 조각·stack)는 용량 상한 등급, Verification 결과·FixRecord summary·닫힘 근거 참조는 영구 등급으로 등록한다; 닫힘이 정리 계기가 아니다(R17; 실제 정리 뒤 부재 이유는 T26)
  - 디스크 부족 주입 시 기존 snapshot이 남고 새 수집 제한 이유와 내보내기·한도 조정 안내를 읽는다(R19)

### T18 reproduction test

- 등급: 기본
- concern: problems/tests, problems/problem-codes
- 요구: problems/tests#R10, R11, R12, R15; problems/problem-codes#R10
- 자리: packages/problems/tests/ (reproduction kind 준비·판정, 약화 검사)
- 쓰는 contract: apps release read(before·after의 고정 bundle·blueprint), C-문제command의 문제 read(basis seq, reports)
- 내놓는 contract: 없음(C-test실행의 reproduction kind)
- slice: problems
- 선행: problems#T9, problems#T10, problems#T12
- 완료:
  - before·after마다 source read-only·새 fixture DB·같은 FrozenTest·input·expected·environment; 운영 DB 복사와 실계정 재전송 없이 replay·stub(R15)
  - before 원증상 재현 + after 같은 기대 충족 + 약화 없음만 `pass`; before 재현 + after 같은 증상은 `fail`; before도 pass·다른 실패·같은 오류 이름만·timeout은 `inconclusive`(R10)
  - before·after 고정 근거로 problem code·보고 경로 삭제와 기대 약화를 검사하고, 있으면 `inconclusive`와 약화 이유(R11, problem-codes#R10)
  - observations에 원래 증상·변경 후 기대·인접 불변식 확인이 따로 있고 외부 효과 사실은 apps/invocations 참조로만(R12)
  - 한쪽만 시작하면 시작한 side execution과 미시작 이유로 `inconclusive`
  - 깨지는 앱 fixture의 이전·고친 판으로 pass·fail·inconclusive를 각각 만든다

### T19 문제 work reaction과 해석 연결

- 등급: 기본
- concern: problems/grouping
- 요구: problems/grouping#R8, R9, R13, R14
- 자리: packages/problems/grouping/ (commands.ts, work.ts의 `problems.work` subscriber; test-runner kind에서 돈다)
- 쓰는 contract: event 구독(cursor, 반응 key), coding-agent의 getTicket(현재 claim 포함)과 Ticket event(TicketCreated, TicketClaimed, TicketClaimReleased의 reason returned|expired|connection_revoked, TicketCompletionReported, TicketCancelled, TicketCheckFailed, TicketConfirmed), documents의 `/v1/documents/get`·`history`(version 존재·호출자 읽기 권한)와 `/v1/outline/document`(ver 지정, section key 존재)
- 내놓는 contract: C-문제command의 `reconcile-work`, `link-interpretation`, event `ProblemWorkStarted`, `ProblemWorkEnded`, `ProblemInterpretationLinked`
- slice: problems
- 선행: problems#T2, platform#T18, contracts#T40, contracts#T41, contracts#T18, coding-agent#T18, coding-agent#T19, coding-agent#T24, coding-agent#T26, documents#T6, documents#T14
- 완료:
  - 상태는 open·fixing·closed뿐, 문제당 열린 repair ticket 1개를 넘는 연결은 거절(R8)
  - TicketCreated에서 `work`를 잇고 status는 open(질문 Q3); 유효 claim 뒤에만 fixing; claim 해제·만료(`TicketClaimReleased` reason expired, 만료 뒤 최대 약 60초)·완료 보고·취소 뒤 닫힘 근거가 없으면 open; `TicketCheckFailed`를 새 claim으로 보지 않는다; ticket event가 닫힌 문제를 열거나 닫지 않는다(R9)
  - 반응 key `(subscriber, cause_seq, reaction)`, 재시작 뒤 seq로 따라잡는다
  - 담당 App Engineer만 고정 version·section을 연결·해제, 상태는 그대로, 이전 참조는 event에 남는다(R13)
  - `LinkProblemInterpretation`을 tx를 받는 등록 command로 두어 lophn-agent의 ToolCall 성공과 같은 transaction에서 platform#T18 dispatch로 부를 수 있다(질문 Q13)
  - section 존재는 derived라 command 전 read 단계에서 확인한다(missing·unsupported·unverified는 `invalid_input`); command는 version 참조와 문제 seq만 CAS로 비교한다
  - 같은 이전 상태를 읽은 두 변경 중 뒤의 것은 `conflict`(R14)

### T20 테스트로 확인됨 닫힘

- 등급: 기본
- concern: problems/closing, problems/problem-codes
- 요구: problems/closing#R1, R2, R3, R4, R5, R14; problems/problem-codes#R7
- 자리: packages/problems/closing/ (model.ts, commands.ts, work.ts의 `problems.closing` subscriber; test-runner kind에서 돈다)
- 쓰는 contract: event 구독, apps releases.get·list의 활성 release와 `ReleaseActivated`, command
- 내놓는 contract: C-문제command의 `close-verified`, event `ProblemClosed`
- slice: problems
- 선행: problems#T18, problems#T19, apps#T18, apps#T19
- 완료:
  - `VerificationRecorded`·`ReleaseActivated`·`ProblemObserved`에서 reproduction pass만 후보로 다시 읽는다(R3)
  - after가 현재 활성 release이고 `basis_seq` 뒤 같은 문제의 새 live Report가 0개(늦은 이전 release 보고 포함)일 때만 닫는다(R4)
  - quiet 대기 0ms, 날짜 기반 만료 없음; 낡은 seq·release로 보낸 요청은 `conflict`(R5, R14)
  - release 준비·activation·앱 시작·command 성공·app test·test command·ticket 완료·고친 기록·앱 주장만으로는 닫히지 않는다(R2)
  - coding agent·lophn agent·앱·일반 CLI의 닫기는 거절, fixer=user 분류도 권한을 주지 않는다(R1, problem-codes#R7)
  - 이어받음: platform#T39의 ProblemClosed 발생. 닫는 이 작업이 event를 낸다

### T21 사람 결정과 재발

- 등급: 기본
- concern: problems/closing, problems/grouping, problems/repairs, problems/feedback
- 요구: problems/closing#R1, R6, R7, R8, R9, R10, R11, R12, R14; problems/grouping#R10; problems/repairs#R7; problems/feedback#R14
- 자리: packages/problems/closing/ (ApplyProblemDecision, 재발 규칙), packages/problems/grouping/의 접수 묶기 함수(reopen 분기)
- 쓰는 contract: shell confirmation window의 문제 결정(owner_decision_intent; main이 {problem, basis_seq, release, last_report, decision, reason, confirmation_handle}을 보낸다), platform/identity의 handle 검증·소비 helper(command transaction 안), apps 활성 release read, command
- 내놓는 contract: C-문제command의 `apply-decision`, event `ProblemReopened`, `ProblemConfirmationRecorded`
- slice: problems
- 선행: problems#T20, contracts#T13, platform#T56 (shell#T53 결정 window는 이 작업 뒤; handle은 platform#T56으로 테스트)
- 완료:
  - `fixed`는 user_confirmed, `not_visible`은 현재 release·last Report가 맞을 때 recovered, `dismiss`는 공백 아닌 한 줄 이유로 dismissed; 어느 것도 Verification을 만들지 않는다(R6, R7, R8)
  - handle 재사용·release 변경·seq 변경 뒤 적용은 거절; agent·앱·CLI의 사람 주장은 거절(R1, R6, R14)
  - 이어받음: platform#T39의 ProblemReopened 발생. 재발을 여는 이 작업이 event를 낸다
  - reproduction이 없는 코드 수리의 사람 확인은 "내가 확인함"이고 테스트로 확인됨이 아니다(R9); 설정만 고친 문제도 가짜 release 없이 닫힌다(repairs#R7)
  - `not_fixed`는 열린 문제면 `ProblemConfirmationRecorded`, 닫힌 문제면 `ProblemReopened`; 같은 release·같은 근거로는 고쳐짐 확인을 다시 제안하지 않는다(R10)
  - 72시간 무보고만으로 열린 문제가 닫히지 않는다(R7)
  - RecordReport 안에서 닫힌 key의 현재 활성 release live Report는 경과 기간·닫힘 이유와 무관하게 같은 ID로 reopen, 이전 release의 늦은 보고는 `ProblemObserved`로 남고 closed 유지(R11, R12, grouping#R10)
  - 직접 시도 실패 feedback은 새 Report일 뿐 결정이 아니다(feedback#R14)

### T22 문제 상세의 수리·결과·닫힘 표시

- 등급: 기본
- concern: problems/closing, problems/grouping, problems/tests
- 요구: problems/closing#R13; problems/grouping#R12; problems/tests#R5
- 자리: packages/problems/grouping/reads.ts의 상세 projection
- 쓰는 contract: read, coding-agent의 getTicket(state, readiness needs_confirmation|ready, 현재 claim 유무 → 사람이 아는 en 작업 상태)
- 내놓는 contract: C-문제command의 `get` 상세 필드
- slice: problems
- 선행: problems#T14, problems#T21, coding-agent#T18
- 완료:
  - 닫힘 4종(테스트로 확인됨·내가 확인함·현상이 안 보임·더 다루지 않음)이 서로 다른 값이고, 기본은 닫힌 이유와 지금 필요한 주의, 확인 범위·미확인·release·근거는 펼친 상세(closing#R13)
  - 미실행 테스트·외부 효과 미확인·발생 기회 없음을 성공으로 채우지 않는다(closing#R13)
  - 진행·실제 담당·필요한 사람 조치가 먼저, 수리 작업은 en 작업 상태(확인 필요 / 맡길 수 있음 / 작업 중 / 확인 중)로 설명하고 claim·기한·연결 식별자는 없다(grouping#R12)
  - 고쳤다는 주장, 테스트 대기·진행·pass·fail·미확인을 같은 문제 옆에서 구별한다(tests#R5)

### T23 report-app-problem flow E2E

- 등급: 기본
- concern: problems/feedback, problems/reporting, problems/snapshots, problems/grouping
- 요구: problems/feedback#R5, R6, R11, R12, R13
- 자리: e2e/flows/report-app-problem_test.ts
- 쓰는 contract: shell [문제 알리기] 화면(Playwright), C-문제보고, C-문제command
- 내놓는 contract: 없음
- slice: problems
- 선행: problems#T15, problems#T16, problems#T17, contracts#T10, platform#T39, shell#T52
- 완료:
  - 버튼 시점 app view만 캡처하고, confirmation window·lophn dialog가 떠 있거나 view가 가려지면 이미지 없이 이유(R5)
  - 상태만 기본 선택, screenshot은 미리보기 확인 뒤에만 선택·저장(R6)
  - 접수를 막으면 완료 표시 없이 글을 복사할 수 있고 초안 복구를 약속하지 않는다(R11)
  - 제출 전 취소에는 Report가 없고 제출 뒤 닫아도 같은 Report가 읽힌다(R12)
  - 기존 문제 선택 여부가 보이고 제출 뒤 그 문제로 갈 수 있다(R13)
  - flow 1~6단계와 다른 갈래(화면 없음, 시작 전 실패, 취소, 접수 실패, 직접 시도 실패)

### T24 verify-app-repair flow E2E

- 등급: 기본
- concern: problems/repairs, problems/tests, problems/closing, problems/grouping, problems/snapshots
- 요구: problems/repairs#R1, R2, R5; problems/tests#R4, R5, R10; problems/closing#R4, R6, R9, R10, R13
- 자리: e2e/flows/verify-app-repair_test.ts
- 쓰는 contract: coding agent 통로(coding-agent#T47의 fake coding agent 수리 script), apps release activation, shell confirmation window
- 내놓는 contract: 없음
- slice: problems
- 선행: problems#T14, problems#T18, problems#T20, problems#T21, problems#T22, coding-agent#T19, coding-agent#T24, coding-agent#T45, coding-agent#T47, apps#T18, shell#T52, shell#T53
- 완료:
  - flow 1~7단계: 고친 기록 → reproduction → activation → 자동 닫힘(테스트로 확인됨), 사람 확인(내가 확인함), "아직입니다" 뒤 reopen·재요청 억제
  - 다른 갈래: claim 없는 제출 거절, runner 상실·timeout은 판정 불가, 약화 변경은 닫힘 근거 아님, activation 거절이면 열린 채, 이전 release 늦은 보고는 reopen하지 않음

### T25 app-broken flow E2E

- 등급: 기본
- concern: problems/problem-codes, problems/reporting, problems/snapshots, problems/grouping, problems/tests, problems/repairs, problems/closing
- 요구: problems/problem-codes#R2; problems/reporting#R1, R2, R5; problems/grouping#R1, R2, R9, R11, R12; problems/closing#R1, R3
- 자리: e2e/flows/app-broken_test.ts
- 쓰는 contract: lophn-agent의 App Engineer(fake provider), coding agent 통로, coding-agent ticket·session, apps release
- 내놓는 contract: 없음
- slice: problems
- 선행: problems#T19, problems#T24, platform#T39, lophn-agent#T50, coding-agent#T38, coding-agent#T46, coding-agent#T47, shell#T52, shell#T53
- 완료:
  - flow 1~9단계: 선언 실패와 process exception 접수 → 문제 열림 notification 1회 → App Engineer 해석 연결 → repair ticket → claim 뒤 fixing → reproduction·app test → 고친 기록 → activation → 자동 닫힘
  - 다른 갈래: 일부 증거 실패는 이유와 함께 접수, claim 만료 뒤 제출 거절, 재현 실패·약화는 닫힘 아님, 닫힌 뒤 현재 release 재발은 같은 문제 reopen

## operations slice

### T26 snapshot 큰 자료 정리 뒤 부재 표시

- 등급: 좁은
- concern: problems/snapshots
- 요구: problems/snapshots#R17
- 자리: packages/problems/snapshots/ (reads.ts의 정리된 blob 이유), packages/problems/grouping/reads.ts
- 쓰는 contract: blob(정리된 blob 읽기 결과)
- 내놓는 contract: 없음
- slice: operations
- 선행: problems#T17, problems#T22, platform#T44
- 완료:
  - 용량 상한을 넘기면 가장 오래된 첨부 PNG·로그 조각·stack부터 정리되고 GetSnapshot이 그 항목에 "정리됨" 부재 이유를 보인다(R17)
  - 닫힌 문제의 닫힘 근거·고친 기록·확정 Verification 참조는 정리 뒤에도 그대로 읽힌다(R17)

## 팀 사이 선행 요약

| 쪽 | 필요한 것 | 그 팀 작업 | 쓰는 작업 |
|---|---|---|---|
| contracts | C-test실행·ProblemCodeDeclaration·예약 catalog, C-문제보고, C-문제command | contracts#T32, T39, T40 (apps slice) | T1–T27 |
| contracts | platform envelope·등록·Tx·command 결과 조회, event 구독, blob, redaction | contracts#T5, T6, T7, T11, T12 | T2, T3, T7, T17 |
| contracts | confirmation window, 앱 화면 틀·feedback IPC·view-error·화면 검사 host 타입 | contracts#T13, T38 | T11, T15, T16, T21 |
| contracts | 앱 시작 입력(test mode), invocation 전달, release 준비·적용·data job | contracts#T34, T35, T36 | T4, T8, T10 |
| contracts | coding-agent ticket read·event·claim 검사(apps slice), documents outline·read | contracts#T41, T18 | T13, T14, T19 |
| platform | ledger 공통 표·schema, command, read, event 구독 반응 cursor | platform#T1, T2, T3, T4 (skeleton) | T2, T7 |
| platform | credential·claim, API 입구, supervisor kind launch spec(상시 정책), diagnostic pipe, core·worker registry | platform#T5, T6, T7, T8, T9 (skeleton) | T2, T3, T7, T8 |
| platform | worker 전달 route, blob 준비·참조 등록·보존 종류, redaction 엔진·안전 필드 | platform#T12, T13, T14, T15, T16 (documents) | T2, T3, T8, T15, T17 |
| platform | confirmation handle 발급·검증·소비 | platform#T56 (documents) | T21 |
| platform | Tx 안 다른 owner command dispatch, settings registry, test 자식 메모리 상한 | platform#T18, T25, T30 (agent) | T8, T17, T19 |
| platform | 진단 분류, 운영 문제 notification 계기 | platform#T38, T39 (problems) | T15, T23 |
| platform | blob GC와 보존 정리 | platform#T44 (operations) | T26 |
| apps | blueprint 타입 | apps#T2 | T9 |
| apps | bundle 고정·읽기 전용 사본 | apps#T6 | T3, T8, T9 |
| apps | 진입점(observer 설치, test 앱 자식 protocol, 등록 handler 목록) | apps#T7 | T8, T9 |
| apps | supervisor 종료 관측 보고, apps.logs | apps#T9 | T17 |
| apps | invocations.get | apps#T11 | T4 |
| apps | data kind의 migrate job | apps#T17 | T10 |
| apps | ReleaseActivated, activation | apps#T18 | T20, T24 |
| apps | releases.get·list, apps.blueprint read | apps#T19 | T14, T20, T27 |
| apps | 대역 adapter | apps#T21 | T10 |
| apps | 개발 fixture 4개 | apps#T23–T26 | T12, T18 |
| shell | 앱 preload·view-error 전달(apps slice; problems#T3 뒤) | shell#T38 | T16 |
| shell | 앱 화면 검사 host(apps slice) | shell#T46 | T11 |
| shell | feedback binding·캡처·report-problem 화면(problems slice; problems#T15 뒤) | shell#T52 | T23, T24, T25 |
| shell | 문제 결정 window와 Issues 화면(problems slice; problems#T6, T21 뒤) | shell#T53 | T24, T25 |
| coding-agent | getTicket, TicketCreated·Claimed·ClaimReleased | coding-agent#T18 | T13, T14, T19, T22 |
| coding-agent | 현재 claim, checkTicketClaim | coding-agent#T19 | T14, T19, T24 |
| coding-agent | TicketCompletionReported·Cancelled, 완료 보고의 fix_records | coding-agent#T24 | T19, T24 |
| coding-agent | TicketCheckFailed·Confirmed | coding-agent#T26 | T19 |
| coding-agent | reproduction·problems_closed 조건 | coding-agent#T45 | T24 |
| coding-agent | LaunchPlan·첫 prompt([Start]), repair ticket 준비, fake coding agent 수리 script | coding-agent#T38, T46, T47 | T24, T25 |
| documents | version 존재·읽기 권한, section key 존재 | documents#T6, documents#T14 | T19 |
| lophn-agent | App Engineer 해석·ticket 생성 | lophn-agent#T50 (problems slice) | T25 |

거꾸로 problems가 다른 팀의 선행이 되는 자리(각 팀 계획의 `선행:`에서 확인): apps#T6(bundle 준비) ← T1; apps#T9(supervisor 관측 보고)·apps#T13(broker) ← T3; apps#T7·T14·T22·T26(진입점·템플릿·깨지는 앱) ← T5; apps#T19(release 준비) ← T9–T11; apps#T27 ← T9; coding-agent#T18(ticket 생성의 문제 확인)·T35 ← T6; coding-agent#T21(app test·release_prepare tool) ← T7–T9; coding-agent#T24(완료 보고의 fix_records) ← T14; coding-agent#T26(checker) ← T13; coding-agent#T42(repair context) ← T6, T14, T17; coding-agent#T44(MCP·CLI 문제 tool) ← T14, T15, T18, T21; coding-agent#T45 ← T18, T20, T21; lophn-agent#T42(apps slice) ← T6, T7; lophn-agent#T48·T50 ← T19; shell#T38 ← T3; shell#T52 ← T15; shell#T53 ← T6, T21.

## 요구 덮기

| concern | 요구 수 | 덮은 수 | 작업 |
|---|---|---|---|
| problems/problem-codes | 10 | 10 | T1, T3, T6, T9, T11, T18, T20, T25, T27 |
| problems/reporting | 16 | 16 | T2, T3, T4, T5, T6, T11, T16, T25 |
| problems/feedback | 14 | 14 | T15, T21, T23 |
| problems/grouping | 14 | 14 | T2, T4, T6, T15, T19, T21, T22, T25, T27 |
| problems/snapshots | 20 | 20 | T4, T15, T16, T17, T26 |
| problems/tests | 21 | 21 | T7, T8, T9, T10, T11, T12, T13, T18, T22, T24 |
| problems/repairs | 7 | 7 | T14, T21, T24 |
| problems/closing | 14 | 14 | T20, T21, T22, T24, T25 |
| 합계 | 116 | 116 | |

## 질문

- **Q1 프로세스 배치.** architecture/platform은 test runner를 "배정 작업이 있을 때 bounded"로, architecture/problems는 report collector와 test runner control을 상시 프로세스로 둔다(check/problems#Q14). 추천: 둘 다 core가 상시 감독하는 `apps/worker` kind로 두고 실제 test 자식만 요청마다 띄운다. runner control이 `problems.work`·`problems.closing` 반응기를 함께 돌린다. platform 팀이 동의했다(platform 계획 Q8, supervisor kind마다 상시·요청 시 정책, platform#T7).
- **Q2 앱 SDK 자리.** 정함(lead): 보고 SDK `@lophn/cap-problem` 1.0.0(apps/sdk#R26)의 자리 `packages/sdk/cap-problem/`은 problems 팀이 쓴다(code-map에 반영). apps 팀은 catalog 등록(apps#T5)과 진입점 연결(apps#T7)을 맡는다.
- **Q3 Problem.work를 언제 잇나.** architecture/problems 7.6의 반응 event에 ticket 생성이 없다. 추천: `TicketCreated`(연결 문제 포함, readiness 무관)에서 `work`를 잇고 status는 open, 유효 claim에서만 fixing. grouping#R11의 "열린 ticket 기준 탐색"과 R9의 "ticket 생성은 열림"을 함께 지킨다. coding-agent 팀이 구독 가능하다고 답했다. 구현 PR에서 architecture/problems 7.6의 event 목록에 `TicketCreated`를 더한다.
- **Q4 claim 만료 신호.** 정함: 전용 event 없이 `TicketClaimReleased` reason expired로 오고 만료 뒤 최대 약 60초 늦다. 그 사이 쓰기는 checkTicketClaim이 바로 거절하므로 fixing 표시는 event 기준으로 둔다.
- **Q5 problem code 의미 변경의 "확인 대상".** problem-codes#R3은 같은 이름의 다른 증상 선언을 "확인 대상"이라 한다. 기계가 뜻을 판정할 수 없으므로 추천: app test가 이전 release 선언과 비교해 같은 code의 message·fixer 변경을 관측에 남기고 실패로 만들지 않는다. release 검토 화면에서 사람이 본다.
- **Q6 fixture 나눔.** 정함: lead가 fixtures/apps 4개를 apps 팀에 맡겼다. tests#R18의 3종은 rate limit 대시보드(집계)·할 일(파일 편집·변환)·캘린더(외부 연동)로 덮고, problems는 깨지는 앱의 시나리오를 보내고 app test 실패용 작은 변형만 자기 testdata에 둔다.
- **Q7 화면 검사의 통로.** 정함: shell의 앱 화면 검사 host(Electron `--app-screen-test`)를 runner가 child로 띄우고 fd 3 JSON lines로 주고받는다. host는 collector로 보내지 않고 관측만 돌려주며 runner가 test scope로 넘긴다.
- **Q8 메모리 한도 adapter와 macOS.** 정함(lead): platform#T30(agent slice)이 Linux는 cgroup v2, Windows는 Job Object로 hard 상한을 걸고, macOS는 V8 heap 상한과 process tree RSS watchdog으로 soft 상한을 건다. interface가 hard/soft를 돌려주고 test result에 상한 방식을 남긴다. macOS app test를 `unavailable`로 두지 않는다. T8 PR에서 problems/tests#R20을 고친다. 그 뒤 #193이 soft RLIMIT_AS 536,870,912 bytes에서 Deno가 시작 전에 죽는 것(Oilpan heap 예약)을 확인했다. cgroup이 없는 macOS에서 Deno test 자식은 그 상한 아래 시작하지 못하므로 시작 전에 `unavailable`로 거절한다(R20). 이는 "macOS app test를 unavailable로 두지 않는다"와 부딪히고, 그 충돌은 problems/tests#Q5로 남겨 사람이 정한다.
- **Q9 flow E2E의 자리와 주인.** 정함(plan README): `e2e/flows/<flow 이름>_test.ts`, problems slice의 E2E는 problems가 쓴다.
- **Q10 app test의 되돌림 검사.** 정함(lead): apps 팀 요청(apps/blueprint#R21)대로 T10에 넣고, T10 PR에서 problems/tests#R9의 확인과 architecture/problems 7.4 목록에 되돌림을 더한다.
- **Q11 runner의 `--allow-run`.** architecture/problems 2.2는 runner에 승인된 Deno 실행 파일만 준다. 화면 검사 host가 Electron이므로 추천: shell이 설치한 host 실행 파일의 절대 경로 하나를 더한다. T11 PR에서 architecture/problems 2.2를 고친다.
- **Q12 TicketTestLink 필드 이름.** 정함(contracts#T32): `{ticket, check_index, check_hash, completion_seq}`. check_index는 ticket 조건의 position, check_hash는 그 조건의 RFC 8785 정규 JSON sha256이다.
- **Q13 lophn-agent tool과 같은 transaction.** lophn-agent는 `problem.set_interpretation` ToolCall 성공과 LinkProblemInterpretation을 한 core transaction에 확정하려 한다. 다른 최상위는 problems package를 import할 수 없으므로 추천: problems는 이 command를 다른 command처럼 tx를 받는 handler로 core에 등록하고, platform command contract가 "같은 transaction에서 다른 owner command 부르기"를 제공한다. platform#T18(agent slice, Tx 안 등록 command dispatch)이 그 길을 낸다.
- **Q14 RequestTest 기록을 누가 어디서 읽나.** 정함(platform 계획 Q11): `command_results`는 자기 principal만 읽으니 접수·시작 시도·runner 식별·복구는 problems 소유 append-only `test_requests`에 둔다. 상태를 바꾸는 큐가 아니라 단계별 불변 기록이다. domain model과 architecture/problems 3.1을 이 표에 맞췄다. public `RequestTest`는 phase를 바꾸지 않는다. 준비 실패·시작 시도·실제 시작·시작 확인 불가·runner 교체는 신뢰 entry가 owner-local helper로만 append한다. lifecycle wire는 아직 없고 T8 입구가 맡는다. `RecordVerification` 권한은 `route.name`과 현재 credential의 app·request principal·key·hash·현재 runner principal을 함께 본다. body의 runner 주장은 권한이 아니다. cross-owner FK(apps, releases, problems, reports, tickets)는 그 표가 생기기 전에 만들지 않고 신뢰 prepared proof가 참조를 검사한다. 추천(정하지 않음): GetVerification detail 출력은 hash 참조만 두고, body의 blob ref를 두 번째 wire로 만들지 않는다. blob 본문은 `blob.read`가 읽는다.
  T7 owner 검증은 전체 Verification canonical retry, bounded sync request/frozen/execution/observations SHA256 binding, before release prepared target, start_attempt 선행·start_unknown/recovery 뒤 신규 시작 금지, machine request scope와 `RecordVerification`으로 대체할 수 없는 독립 observe/recover operation·previous/new binding CAS를 적용한다. exact retry는 현재 권한을 다시 확인하고 원 seq를 반환한다. phase unique를 두지 않고 PK/unique/rowid replacement를 거절한다. 실제 side 시작 뒤 request-level preparation_failed와 준비 실패 요청의 신규 결과를 거절한다. reports 중복은 invalid_input이며 link는 parent canonical membership·result_ref 이전 등록으로 고정하고 read는 원 reports 순서와 link set을 함께 검사한다. 고정 permanent blob fields/purposes를 core가 내놓으며 failure path는 `verification_failure_path` owner_kind·`<vrf ID>:<index>` owner_key와 `test` field로 보존한다. 파일 SQLite WAL/bigint/rollback handler probe는 T7 범위다. 실제 platform writer harness 통합은 T59 main 뒤 team member가 추가하고 실행 runner/lifecycle wire는 T8, actual blob store·authorizer는 platform T14다. 완료 표시는 PR 확정 뒤 넣는다.
- **Q15 CLI의 사람 `problem report`.** 정함(lead, coding-agent 팀 동의): problems/feedback#R1(인증된 shell의 사람 제출만)과 D27에 따라 problems의 `submit-feedback`은 shell user credential과 shell 출처만 받는다. coding-agent#T44가 고쳐, 사람 전용 `problem report|request-repair|confirm|dismiss`는 core에 쓰지 않고 shell 화면 링크(문제 알리기, ticket 준비, 결정)와 대기 사실만 출력하며 coding credential은 거절한다.
- **Q16 문제 read와 release 준비 사이의 순환.** apps#T19(release 준비) ← coding-agent#T19(claim 검사) ← coding-agent#T18(ticket 생성의 문제 확인) ← problems#T6 ← apps#T19(선언 문구)로 고리가 생겼다. 정함: 선언 문구를 T27로 떼어 T6은 apps#T19를 기다리지 않는다.
- **Q17 `requiredReportPaths`의 입력.** 지금은 검증된 `problem_codes`와 명시적 `has_view` boolean만 받는 최소 bundle descriptor를 쓴다. 추천: apps/blueprint wire(contracts#T33)가 정해지면 그 wire에서 `has_view`를 채워 이 함수를 그대로 쓴다. 그전까지 blueprint schema를 새로 만들지 않는다.
