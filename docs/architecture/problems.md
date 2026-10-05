---
type: architecture
concerns: [problems]
---
# problems

## 1. 맡는 것과 맡지 않는 것

앱의 선언 보고·자동 exception 관측·사람 feedback을 불변 Report와 Snapshot으로 받고 운영 Problem에 묶는다. 고정 bundle의 app test·reproduction test·test command를 실제로 돌려 Verification을 남기며, 실제 reproduction 근거 또는 보호된 사람 결정으로 문제를 닫는다.

- 앱 시작·direct call·invocation·release·앱 DB는 apps의 contract를 쓴다. 보고를 위해 운영 command를 core로 우회하거나 재실행하지 않는다.
- 버튼·앱 view·캡처·사람 미리보기·confirmation window는 shell의 contract를 쓴다.
- redaction 정책·credential·blob·ledger writer·notification은 platform의 contract를 쓴다.
- 원인 해석은 App Engineer, 코드 수리는 외부 coding agent, ticket·claim·acceptance check 판정과 repair context 조립은 coding-agent가 맡는다. 보고 접수가 agent를 자동 실행시키지 않는다.
- `Report`, `Snapshot`, `Verification`은 확정 뒤 수정하지 않는다. `Problem`에는 `open / fixing / closed`만 있고 episode·별도 수집 상태·별도 app test 정본·앱별 journal은 없다.

## 2. 프로세스

### 2.1 배치와 수명

problems가 소유하는 장기 프로세스는 **report collector**와 **test runner control** 둘이다. core의 프로세스 감독이 시작·종료·재시작한다. 둘을 나눠 긴 테스트가 제보와 snapshot 조립을 막지 않게 한다. 실제 앱·테스트 code는 요청별 자식 프로세스에서만 돈다.

```text
앱 프로세스: SDK + error/unhandledrejection 관측
  └─ loopback HTTP ──────────────────────────────┐
앱 supervisor: 안전한 로그 조각·종료 관측 ─ IPC ──┤
shell main: view 예외·feedback + 캡처 binding ─ HTTP ┤
                                                  ▼
                            report collector (Deno)
                       출처 확인 → redaction → source map
                       → 지문 → snapshot → blob 준비
                              │ RecordReport command
                              ▼
 core API ─ read 연결        core command 처리 (유일한 ledger writer)
      ▲                        reports + snapshots + problems + events
      │                                    ▲
      │ RequestTest                        │ RecordVerification / CloseProblemVerified
coding agent 통로 ──────────► test runner control (Deno)
                                  ├─ 고정 source·test·대역 준비
                                  ├─ Deno test 자식 (요청마다)
                                  ├─ 격리 test 앱 자식 (bundle마다)
                                  └─ 화면 검사: shell의 test용 앱 화면 틀
                                  │
                      event 구독 → work·closing 재평가 → command
```

| 실행 자리 | 모듈 | 하는 일 | 시작·끝 |
|---|---|---|---|
| 앱 프로세스 | `problems/sdk.ts`, `problems/exception-observer.ts` | 선언 보고 ID, 실제 invocation 문맥, process exception 관측 | apps의 앱 진입점이 설치; 앱 종료와 함께 끝남 |
| shell main·앱 preload | `problems/view-reporting.ts`, `problems/feedback-client.ts` | 인증된 view 식별, view exception 전달, 사람 선택 자료 전달 | shell의 앱 화면 틀과 함께 설치·회수 |
| report collector | `problems/collector.ts`, `snapshots.ts`, `fingerprint.ts`, `source-map.ts` | 자유 문자열·이미지 처리, 증거 조립, hash, blob 준비 | core가 하나를 감독; 종료 때 미확정 메모리 버림 |
| test runner control | `problems/test-runner.ts`, `test-request.ts`, `test-judgment.ts` | 준비·자식 감독·실제 결과 판정·결과 기록; work·closing event 반응 | core가 하나를 감독; 요청별 자식은 결과 확정/중단 뒤 종료 |
| test 자식·test 앱 자식 | `problems/test-harness.ts`와 고정 앱 진입점 | fixture로 실제 command·automation·실패 경로 실행 | runner가 요청마다 띄움; before/after는 각각 새 DB·환경 |
| core command 처리·read 연결 | `problems/reporting-ledger.ts`, `grouping-ledger.ts`, `tests-ledger.ts`, `repairs-ledger.ts`, `closing-ledger.ts`, `read.ts` | 준비 참조 검사·짧은 transaction·범위별 조회 | core와 수명 같음; 파일 처리·앱 실행·test 판정 code를 넣지 않음 |

### 2.2 통신과 권한

- collector의 ingress는 loopback HTTP JSON이다. 5장의 problems RPC를 platform API transport에 등록하고 collector로 전달한다. 전달·본문 처리·redaction은 command write 줄 밖에서 한다. collector의 결과만 `RecordReport`로 core에 간다. HTTP 주소·Host/Origin·credential 검사는 **인증** contract를 따른다.
- collector·runner는 core의 **command**, **read**, **blob**을 loopback HTTP로 호출하고 **event 구독**을 WebSocket으로 받는다. core 감독과 자식의 ready·exit·취소 통지는 상속된 private IPC로 한다. token을 URL·stdout·임의 요청 본문에 싣지 않는다.
- 앱 SDK는 자기 앱 보고만 가능한 실행 credential을 쓴다. collector는 실행 credential에서 app·당시 release·bundle·mode·diagnostic scope를 얻고 인증된 원주체를 준비 참조에 묶는다. 수집기 machine으로 전달해도 원출처의 app/user/관측 자격을 잃지 않는다. 본문의 `actor`, 다른 앱, `live` 주장으로 바꾸지 못한다.
- collector는 `deno run --no-prompt`에 core/ingress의 정확한 loopback 주소만 `--allow-net`으로 준다. 고정 bundle·source map은 **release 준비·적용** contract가 내준 읽기 전용 준비 폴더만 `--allow-read`로 받는다. blob은 contract로 준비하므로 blob store·ledger 파일을 직접 열지 않는다. `--allow-write`, `--allow-run`, `--allow-ffi`, 일반 `--allow-env`는 없다.
- runner control은 플랫폼 code다. 준비 폴더와 runner 작업 root만 읽고 쓰며 승인된 Deno 실행 파일만 `--allow-run=<absolute-deno-path>`로 받는다. 운영 앱 DB·backup·source working tree·keychain·일반 홈은 권한 목록에 없다. core 접근은 정확한 loopback 주소와 요청별 좁은 machine credential로 한다.
- 앱 code·test code 자식에는 collector/runner의 credential과 core HTTP 접근을 주지 않는다. SDK 보고는 자식의 private test IPC를 통해 runner에 보내고 runner가 해당 요청의 `mode=test`와 scope를 붙여 collector에 전달한다. IPC 메시지로 live 전환·결과 기록을 요청할 수 없다.
- Deno test 자식의 기준은 `deno test --no-prompt --cached-only --locked`다. 읽기는 고정 source·의존·플랫폼 harness, 쓰기는 해당 side의 scratch·fixture DB, 환경은 명시한 안전한 변수만 허용한다. 필요 없는 permission은 플래그 자체를 생략한다. network 대역은 가능하면 in-process replay/stub를 쓰고, HTTP가 필요한 대역만 정확한 loopback host:port를 허용한다. core/collector 주소와 실제 외부 host는 허용하지 않는다.
- 자식에 `-A`, `--allow-all`, 무제한 `--allow-read/write/env/net`, `--allow-run`, FFI를 허용하지 않는다. permission prompt도 없다. `TestMethod.argv`는 허용한 Deno test 진입점으로만 해석하며 shell·bash·임의 native 실행 파일은 준비 단계에서 거절한다. source·cwd·fixture의 real path와 symlink를 검사하고 묶음 밖 참조를 거절한다.
- 화면 검사는 **앱 화면 틀** contract의 test mode를 쓴다. 운영 view session·credential·DB와 공유하지 않는다. test의 feedback과 예외는 test 진단 scope에만 남는다. 화면 검사를 띄울 수 없으면 화면 있는 app test를 통과시키지 않는다.
- process timeout과 출력 cap은 runner가 강제한다. Deno 자식 heap은 `--v8-flags=--max-old-space-size=256`으로 제한하고 실행 환경에 기록한다. 이 값은 전체 OS 메모리 한도의 대체가 아니다. **platform/security**의 process memory 한도까지 강제 가능한 환경에서만 테스트를 접수하며 강제할 수 없으면 `unavailable`이다. 종료·timeout·runner 상실에는 모든 test 자식과 test view를 회수한다.

### 2.3 수집 한도

problems/reporting#R12,R16·problems/feedback#R8,R9·problems/snapshots#R10,R12,R20·problems/tests#R19-R21의 첫 한도를 그대로 쓴다. 모두 collector/runner의 검증된 설정이며 요청이 상한을 넓힐 수 없다.

| 항목 | 기본·상한 | 초과 처리 |
|---|---|---|
| 새 Report 접수 | 앱당 최근 60,000ms 최대 20개 | 기존 ID retry 먼저 확인; 새 발생만 `unavailable`, 손실 표시 |
| SDK 대기 | 앱당 32개·redaction 전 메모리 총 4MiB | 새 입력 거절; 원문을 디스크 spool로 쓰지 않음 |
| collector 대기·동시 조립 | 전체 128개·16MiB, 동시 4개 | 넘친 새 입력 `unavailable` |
| snapshot 조립 | 전체 2,000ms, 오류 frame 최대 32개, 로그 최대 30줄·65,536 bytes | 남은 항목에 실제 timeout/잘림/제외 이유 |
| 자동 보고 본문 | 최대 262,144 bytes | `invalid_input`; 자유 문자열은 안전한 형태로 제한 |
| snapshot 준비 bytes | 최대 2,359,296 bytes | 큰 항목부터 제외하고 이유 고정; 작은 Report는 접수 가능 |
| feedback | 글 1~500 Unicode scalar, 상태 65,536 bytes, PNG 긴 변 1,600px·2,097,152 bytes, 전체 전송 3,145,728 bytes | 항목 검증 오류; 사람이 첨부를 빼고 새 제출 가능 |
| 보고 retry | 첫 시도 뒤 최대 3회, 간격 250/1,000/3,000ms | 일시적 `unavailable`/응답 유실만 retry; 마지막 실패 표시 |
| test 동시 요청 | 실제 실행 전체 2개, 준비 대기 16개 | 대기 cap 초과는 접수 전 `unavailable` |
| test timeout | 요청 필수, 최대 300,000ms; 클라이언트 제안 60,000ms | 누락/상한 초과 `invalid_input`; 실행 timeout은 `inconclusive` |
| test 출력·메모리 | side마다 안전 출력 1MiB, process 메모리 512MiB | 출력은 계속 drain하며 잘림 표시; 메모리 종료는 `inconclusive` |

과다 보고는 core의 접수 transaction에서 다시 검사해 collector 재시작이나 동시 요청으로 상한을 넘지 못하게 한다. 접수 시각은 event envelope를 쓰며 `observed_at`으로 창을 우회할 수 없다. 같은 지문이라는 이유로 서로 다른 발생을 버리지 않는다. disk가 부족해도 기존 evidence를 몰래 지우지 않는다.

## 3. 저장

### 3.1 ledger 소유

`~/.lophn/lophn.db` 하나를 core writer만 쓴다. 아래 모듈은 core에 등록된 problems 모듈이지 별도 writer가 아니다.

| ledger 표·기록 | 소유 모듈 | 내용 |
|---|---|---|
| `reports` | `problems/reporting-ledger.ts` | 불변 Report, 원주체·content hash·당시 실행 범위·Snapshot 참조 |
| `snapshots` | `problems/snapshots-ledger.ts` | 증거 값과 항목별 누락 이유, 큰 내용은 blob hash |
| `problems` | `problems/grouping-ledger.ts` | app+canonical group key unique, 3상태, work·interpretation·closure |
| `test_requests` | `packages/problems/tests` | 접수·준비 실패·시작 시도·실제 시작·시작 확인 불가·runner 교체·결과 참조. append-only이며 상태를 바꾸는 큐가 아니다 |
| `test_side_starts` | `packages/problems/tests` | 접수 hash·시작 당시 runner·side·bundle·test·실제 시작 시각. recovery는 바꾸지 않는다 |
| `verifications` | `packages/problems/tests` | 불변 Verification 전체 canonical, 요청 principal/key/hash, 고정 대상·test·execution·관측 hash |
| `verification_reports` | `packages/problems/tests` | reproduction과 원래 Report 연결 |
| `events`의 `ProblemFixRecorded` | payload는 `problems/repairs-ledger.ts`, 표는 platform | FixRecord; 전용 repair 표 없음; 식별은 event seq |
| 공통 `command_results`, `subscriber_cursors` | platform | command idempotency와 event 반응 위치. test 요청 정본은 `test_requests`다 |

`reports`·`snapshots`·`problems`의 신규 변경과 event 및 영구 blob 참조 등록은 `RecordReport` transaction 하나다. 첫 접수 시도 전에 collector가 최종 Report·Snapshot·선택 문제·blob hash를 canonical JSON으로 hash한다. 서버가 정한 problem ID와 event seq는 그 hash에 넣지 않는다. 같은 ID·원주체·내용이면 원래 결과, 다른 내용이면 `conflict`다.

tests owner는 bounded canonical JSON sync SHA256로 request·FrozenTest·execution·observations를 저장 hash에 묶는다. 전체 Verification canonical retry는 준비 TTL 이후에도 원 event seq이며 현재 runner/request scope를 다시 검사한다. lifecycle은 아직 public wire가 아니며 `RecordVerification`과 독립된 owner-local observe/recover operation과 trusted proof의 이전/새 runner binding을 인증 ctx·CAS에 결합한다. start_attempt 없는 actual 시작과 start_unknown/recovery 뒤 새 side 시작은 금지다. 같은 phase는 unique가 아니어서 두 reproduction actual_started와 여러 recovery를 append한다. owner 표의 PK·unique·implicit rowid replacement는 immutable trigger로 막는다. 실제 side 시작 뒤 request-level preparation_failed는 conflict이고 준비 실패 요청은 신규 결과가 없다. reports 중복은 invalid_input이며 parent canonical에 선언한 link만 result_ref 전에 등록하고 read는 canonical 순서와 link set 일치를 지킨다.

core의 problems 정의는 고정 blob purpose와 permanent/general_read=false field도 내놓는다. failure path는 `verification_failure_path`, `<vrf ID>:<index>`, `test`로 영구 등록해서 같은 code의 여러 hash를 보존한다. 부모 권한 해석은 platform blob authorizer가 조립한다. GetTestRequest의 request seq는 event seq가 아니고 accepted는 event 없는 snapshot 0에서도 보인다. Verification list는 request-specific scope를 SQL LIMIT 전에 적용하며 event visibility는 전체 scope·ticket·recorded_seq/event seq와 snapshot을 비교한다. 세부 불변 조건은 domain-model/problems/tests가 정한다.

문제의 수·처음/최근 시각·대표 보고·최신 변경 seq는 Report와 event로 조회한다. 별도 counter 정본이나 health 상태를 만들지 않는다. `work`는 하나지만 ticket은 여러 문제를 가리킬 수 있다. 닫힘·feedback·problem code에는 전용 표가 없다.

### 3.2 파일과 blob

| 위치 | 저장할 것 | 쓰지 않을 것 |
|---|---|---|
| platform의 `~/.lophn/blobs/` | redaction된 글·JSON·stack·로그, 사람이 고른 PNG, FrozenTest와 code/input/expected/environment, 실제 execution/output/observations, FixRecord summary | raw 오류·선택하지 않은 screenshot·실제 secret |
| `~/.lophn/work/problems/tests/<vrf-id>/` | 고정 요청 manifest, `before/after/single/source/`, side별 `scratch/`·fixture DB, redaction 완료 result spool | 운영 DB·backup 사본, 앱별 journal, credential 파일 |
| collector·SDK·shell 메모리 | 미확정 입력, 원문을 redaction하는 동안의 buffer, feedback 초안·캡처, 동일 retry용 최종 내용 | 영구 접수됐다는 주장 |
| derived store | 이 concern의 전용 derived DB 없음; 요약·목록은 read에서 계산 | Problem·Verification 정본 복제 |
| 앱 DB·keychain | 이 concern은 읽거나 쓰지 않음 | 자동 업무 데이터 snapshot, secret 사본 |

runner 작업 폴더는 0700, spool 파일은 0600이며 credential은 포함하지 않는다. test code의 출력은 redaction을 거쳐야 spool과 blob에 들어간다. 자식의 임시 업무 값은 격리 scratch에만 있고 테스트가 끝나면 제거한다. 결과 command 응답을 잃으면 안전한 최종 spool은 확정 여부를 확인할 때까지 유지한다. 미확정 spool은 최대 24시간 뒤 판정 불가 복구를 확정한 뒤 제거하고, 확정된 작업 폴더는 바로 정리한다. 큰 관측 blob(첨부 이미지·로그 조각·stack)은 용량 상한을 넘으면 오래된 것부터 정리하고 변경 기록·닫힘 결정·확정된 결과 참조는 영구 보존하며 문제 닫힘도 삭제 계기가 아니다. blob의 물리 배치·설치·GC는 **blob** contract만 따른다.

## 4. concern 배치표

| concern | 프로세스 | 모듈 | 저장 | 주로 쓰는 contract |
|---|---|---|---|---|
| problems/problem-codes | collector·test runner·core | `problem-codes.ts`, `app-test.ts` | 고정 blueprint blob; 별도 표 없음 | release 준비·적용, test 실행, read |
| problems/reporting | 앱 SDK·collector·core | `sdk.ts`, `collector.ts`, `reporting-ledger.ts` | `reports`, 안전 blob, 제한 메모리 | 문제 보고, 인증, redaction, command |
| problems/feedback | shell main·collector·core | `feedback-client.ts`, `feedback.ts` | Report·Snapshot, 안전 blob; 초안 메모리 | 앱 화면 틀, 문제 보고, redaction |
| problems/grouping | collector·runner의 반응기·core | `fingerprint.ts`, `grouping-ledger.ts`, `work-reaction.ts` | `problems`, Report/event 조회 | command, read, event 구독 |
| problems/snapshots | collector·core | `snapshots.ts`, `source-map.ts`, `snapshots-ledger.ts` | `snapshots`, 안전 증거 blob | blob, redaction, 앱 통로, read |
| problems/tests | runner control·test 자식·core | `test-runner.ts`, `test-harness.ts`, `tests-ledger.ts` | `verifications`, `verification_reports`, test blob·작업 폴더 | test 실행, release 준비·적용, command |
| problems/repairs | core; 제출은 coding agent 통로 | `repairs-ledger.ts` | `ProblemFixRecorded` event·summary blob | command, read, coding agent 통로 |
| problems/closing | runner의 반응기·core; 사람 결정은 shell | `closing-reaction.ts`, `closing-ledger.ts` | `problems.closure`, 닫힘·재발 event | event 구독, command, confirmation window |

leaf concern 8개 전부를 배치한다. collector가 grouping **값을 준비**하는 것과 core가 기존 Problem을 찾아 **상태를 확정**하는 것은 다르다.

## 5. 내놓는 contract

소유 contract는 **문제 보고**, **test 실행**이다. 이들의 상태·repair·결정 command와 조회도 problems 모듈이 소유한다. 아래 모든 RPC는 `POST /v1/<resource>/<method>`이며 공통 request/response envelope·오류·seq 문자열은 platform의 API 규칙을 쓴다. 외부 MCP·CLI 이름은 **coding agent 통로**가 정한다.

### 5.1 문제 보고

| RPC·SDK 이름 | 실행 자리 | 입력 | 출력 |
|---|---|---|---|
| `reportProblem(code, details?)` | 앱 SDK | 선언 code, 안전한 구조화 details; invocation은 실제 문맥에서 | 즉시 `{report_id, completion}`; completion은 접수 결과/실패 값으로 끝남 |
| `POST /v1/problems/report` | collector | 고정 `report_id`, code, 안전 설명·details·observed_at, 실제 invocation 연결 | `{report, snapshot, problem}` 또는 비운영의 `{report, snapshot, diagnostic_scope}` |
| `POST /v1/problems/observe-exception` | collector | 플랫폼 observer의 관측 ID, 오류·stack, process/view의 인증된 binding | 같은 접수 결과; 예약 `_exception`은 collector가 설정 |
| `POST /v1/problems/submit-feedback` (`SubmitFeedback`) | collector | Feedback와 shell이 고정한 선택 자료·view binding·기존 문제 선택 | 같은 접수 결과; `_feedback`·source는 shell 출처로 고정 |
| `POST /v1/problems/record-report` (`RecordReport`) | core, collector 전용 | 준비한 Report·Snapshot·GroupKey·불변 blob 참조·원출처 증거 | 원자적 접수 결과·event 범위 |

SDK는 `completion` 실패를 값으로 제공해 SDK 내부 전송 실패가 새로운 `unhandledrejection`을 만들지 않게 한다. 업무 응답은 이 completion을 기다리지 않는다. 플랫폼 app test는 completion을 명시적으로 기다려 실제 접수를 검사한다. 메모리에 들어간 것과 core가 확정한 것은 각각 대기·접수로 표시한다.

**검증과 오류**

- `invalid_input`: code 정규식 `^[a-z][a-z0-9_]{1,47}$`, 미선언/예약 code, 잘못된 JSON·크기·PNG·글 길이·binding. 당시 고정 blueprint를 검사한다. 잘못된 원보고는 성공으로 바꾸지 않는다.
- `unauthorized` / `forbidden`: credential 없음, 다른 앱·view·diagnostic scope, agent/app의 사람 feedback 위조, 준비 권한 없는 `RecordReport`.
- `conflict`: 같은 Report ID의 원주체/내용 변경, 다른 앱의 기존 문제, 낡은 접수 비교 기준.
- `unavailable`: 수집 대기·접수 빈도 초과, 전체 저장 불가, 준비 프로세스/저장소 불가. 일부 evidence 실패는 전체 오류 대신 Snapshot의 이유다.
- 미선언 code·잘못된 보고 선언의 진단은 원래 ID로부터 결정적으로 정한 별도 Report ID 하나로 `_invalid_report`를 준비한다. 안전한 잘못된 code를 discriminator로 쓰고, 안전하지 않으면 원래 Report ID를 쓴다. 진단 실패를 같은 경로로 재귀 보고하지 않고 platform/diagnostics로 보낸다.

**보장**: 자기 앱 보고에 별도 grant 불필요, 원출처·당시 실행 묶음 유지, 저장 전 redaction, 불변 발생과 동일 retry, 첫 유효 live 보고부터 묶기, Report·Snapshot·Problem 원자적 확정. **보장하지 않음**: 전원 종료 직전 무손실, 지문이 근본 원인의 증명, 모든 자료의 동시 원자 캡처, 모든 screenshot 수집, 업무 입력·DB 전체 보관, report만으로 닫힘.

### 5.2 문제 command와 read

| RPC | command/read 이름 | 입력·출력 | 오류·권한·비교 |
|---|---|---|---|
| `/v1/problems/reconcile-work` | `ReconcileProblemWork` | problem·ticket·원 ticket event seq → 현재 status/work·변경 event | machine만; 문제 seq/work·현재 ticket/claim 비교; `not_found/conflict/forbidden` |
| `/v1/problems/link-interpretation` | `LinkProblemInterpretation` | problem·고정 version/section 또는 null → 현재 참조 | 담당 App Engineer; scope·판 읽기 권한·문제 seq/기존 참조; `invalid_input/not_found/forbidden/conflict` |
| `/v1/problems/record-fix` | `RecordProblemFix` | problem·FixRecord·key → `ProblemFixRecorded` seq | coding_agent만; 문제 seq·before/after·결과 연결·있으면 현재 claim; `invalid_input/not_found/forbidden/conflict` |
| `/v1/problems/close-verified` | `CloseProblemVerified` | problem·verification·예상 문제 seq/활성 release → Closure·event | machine 판정기만; 7.6 조건; `not_found/forbidden/conflict/invalid_input` |
| `/v1/problems/apply-decision` | `ApplyProblemDecision` | UserProblemDecision·일회 confirmation → Closure 또는 부정 확인/reopen | 보호된 user 결정만; 문제 seq·release·필요 last Report·정확한 선택/입력 binding; `invalid_input/unauthorized/forbidden/not_found/conflict` |
| `/v1/problems/list` | `ListProblems` | app·status·cursor·limit → 요약 목록·next cursor | scope 검사; 최근 보고·열린 ticket 중심; limit 최대 100 |
| `/v1/problems/get` | `GetProblem` | problem → 상태·당시 문구·보고 수/기간·work·interpretation·closure·최신 seq | 범위 밖은 `forbidden`, 없음 `not_found` |
| `/v1/problems/list-reports` | `ListReports` | problem 또는 app+diagnostic scope·cursor → 발생 목록 | test/preview 진단은 해당 scope만; 운영 집계에 포함하지 않음 |
| `/v1/problems/get-report` | `GetReport` | report → 불변 보고·Snapshot 요약·missing reason | 일반 업무 응답에는 raw code/stack 없음; 상세는 수리 조회 권한 |
| `/v1/problems/get-snapshot` | `GetSnapshot` | snapshot·선택 항목 → 증거 메타데이터·허용된 blob 참조 | 현재 출력 redaction·scope; 없는 항목은 이유 |
| `/v1/problems/get-snapshot-logs` | `GetSnapshotLogs` | snapshot → 고정한 로그 조각(줄·범위·수집 시각·잘림) 또는 부재·정리 이유 | user만; 앱 프로세스와 없는 snapshot은 같은 `not_found`; 조각은 지시가 아닌 데이터; 비율·합계 없음 |
| `/v1/problems/list-fixes` | `ListProblemFixes` | problem·event seq cursor → FixRecord 이력 | subject 범위 검사; agent 로그는 설명으로만 반환 |

표의 모든 경로는 POST다. 목록은 seq cursor로 페이지를 고정하고 요약 → 실제 기록 → 선택한 안전한 첨부 순서로 읽는다. blob 참조를 안다는 이유로 raw blob 접근을 허용하지 않는다. 안전한 상세는 **read**와 **redaction**을 거쳐 반환하며 로그·사람 글은 지시가 아닌 데이터로 표시한다. 저장 모델을 shell에 그대로 표시하지 않는다. 기본 목록·앱 카드에는 앱·증상·진행·필요한 다음 행동만 보내고 사용자용 상세에는 현재 실제 담당과 en 수리 작업 상태를 제공하되 claim·기한·연결 식별자는 숨긴다(problems/grouping#R11,R12). 수·시각·당시 release·확인 범위는 펼친 상세로 구분하고 내부 code·stack·log는 별도 허용된 수리 조회에서만 반환한다(problems/reporting#R7, problems/closing#R13). 선언 안내는 당시 release의 message_key와 en 고정 값을 사용하고 예약 안내도 problems/problem-codes의 key·en 값을 그대로 전달한다. 화면 라벨·상태·누락 설명·확인 이유는 shell/wording에 따라 en message key로 표시하고 ledger·invocation·claim 같은 내부 이름을 화면에 내보내지 않는다.

고친 기록은 before와 다른 준비된 after·공백 아닌 summary·맞는 Verification만 받는다. 결과 목록은 비어도 된다. 새 기록에는 해당 repair ticket·현재 claim seq가 필수다. 과거 ticket 없는 null 출처는 이력으로 보존하고 현재 fixing을 만들지 않는다. 늦은 결과는 별도 Verification로 읽고 이전 FixRecord를 고치지 않는다. 앱 `clear`·agent `close`·보고 삭제·증거 UPDATE API는 없다.

### 5.3 test 실행

| RPC | 이름·실행 자리 | 입력 | 출력 |
|---|---|---|---|
| `POST /v1/problems/request-test` | `RequestTest`; runner 준비 후 core 접수 | request key·kind·app·TestTarget·FrozenTest hash·종류별 연결 | `{request_key, accepted, result_ref}`; 접수는 통과 아님 |
| `POST /v1/problems/record-verification` | `RecordVerification`; core, runner 전용 | 실제 시작한 실행의 고정 Verification·blob 준비 참조 | Verification ID·`VerificationRecorded` seq |
| `POST /v1/problems/get-test-request` | `GetTestRequest`; core read | 요청 principal에 속한 key | 미실행/준비 실패/접수 대기/시작 흔적/결과 참조와 이유; Verification 상태를 새로 만들지 않음 |
| `POST /v1/problems/get-verification` | `GetVerification`; core read | Verification ID·상세 선택 | kind·대상 hash·test hash·result/reason·execution/관측 참조 |
| `POST /v1/problems/list-verifications` | `ListVerifications`; core read | app·problem 또는 ticket·kind·cursor | 결과 목록·next cursor; 현재 적용 가능성은 해당 concern에서 판정 |

- 공통 입력은 TestMethod의 분리된 `argv`, source 안 상대 `cwd`, 필수 유한 `timeout_ms`, 기대 종료값, 안전한 환경 hash다. 요청은 source HEAD나 최신 release를 다시 읽지 않는다.
- `app_test`는 release 준비 전 bundle도 받는다. 고정 blueprint·SDK 의존·선언별 실패 경로 목록이 필수다. `problem/reports/before/after`는 없고 reports는 빈 목록이다.
- `reproduction`은 같은 앱 problem·해당 Report 1개 이상·문제 basis seq·서로 다른 before/after release가 필수다. target은 after다. 동일 FrozenTest hash를 양쪽에 적용한다.
- `test_command`는 ticket 없이 가능하다. ticket을 붙이면 고정 check index/hash·완료 보고 seq가 필수다. ticket 판정은 이 runner가 하지 않는다.
- `invalid_input`: unsafe path/argv/secret 입력, timeout 없음·초과, 종류별 필드 오류. `unauthorized/forbidden`: 앱 scope 밖·결과 쓰기 위조·격리 우회. `not_found`: 고정 bundle/test/대상 없음. `conflict`: 같은 principal/key의 다른 hash 또는 접수 시 문제/ticket 기준 불일치. `unavailable`: 격리·화면·worker·작업 공간 준비 불가/대기 cap 초과.
- 시작 전 거절·준비 실패는 Verification을 만들지 않는다. 실제 시작 뒤 timeout·중단·판정 불가는 `inconclusive`다. 늦은 결과는 사실로 저장하고 ticket 확인/닫힘에서 현재 CAS를 별도로 적용한다.

**보장**: 고정 대상·동일 요청 1회·운영 자원 차단·runner만 결과 쓰기·실제 시작/종료/출력/관측과 한계·세 종류 결과의 한 정본. **보장하지 않음**: 임의 native command 지원, agent 판별기의 의미 전체 증명, 실계정 외부 효과 재현, test pass가 모든 기능 정상이라는 증명, 접수 또는 app test pass만으로 activation/닫힘.

### 5.4 내놓는 event

**event 구독**에 다음 type을 등록한다. `SnapshotRecorded`·`ReportRecorded`와 해당 Problem event는 같은 접수 transaction이다.

| event | subject·주요 payload | 뜻 |
|---|---|---|
| `ReportRecorded` | report; app·problem?·source·mode·code·snapshot·observed_at·content_hash | 발생 접수 |
| `SnapshotRecorded` | snapshot; report·captured_at·evidence hash·누락 이유 | 증거 확정 |
| `ProblemOpened` | problem; app·group_key·첫 report | 첫 운영 발생 |
| `ProblemObserved` | problem; report·관측 release·접수 당시 활성 release·이전 status | 추가 발생; 이전 release의 늦은 보고 포함 |
| `ProblemWorkStarted` / `ProblemWorkEnded` | problem; ticket·claim seq 또는 종료 이유·근거 event seq | 현재 유효 claim 기반 상태 변화 |
| `ProblemInterpretationLinked` | problem; previous/current 고정 참조 | 해석 연결 변경 |
| `ProblemFixRecorded` | problem; FixRecord | 고쳤다는 coding agent의 주장 |
| `VerificationRecorded` | verification; kind·app·target·problem?·basis_seq?·ticket?·result·test·execution | 실제 test result |
| `ProblemClosed` | problem; 이전 status·Closure | 근거별 닫힘 |
| `ProblemReopened` | problem; 이전 Closure·새 report 또는 보호된 결정 | 같은 ID 재발 |
| `ProblemConfirmationRecorded` | problem; UserProblemDecision | 열린 문제의 부정 확인; 상태 유지 |

notification 계기는 운영 `ProblemOpened / ProblemReopened / ProblemClosed`뿐이다. 반복 발생·test result·진단·해석·고친 기록은 notification이나 agent run을 만들지 않는다.

## 6. 쓰는 contract

| contract | 쓰는 자리 |
|---|---|
| command | 준비한 Report·Snapshot 접수, test 접수/결과·work·해석·고친 기록·닫힘; 공통 key·CAS |
| read | 고정 blueprint/release·invocation·문제 기준·ticket 조건·결과; write 줄 밖 |
| event 구독 | runner control의 work/closing 반응기; seq cursor로 현재 상태 재평가 |
| blob | redaction 완료 evidence·고정 test·실제 결과 준비, command에서 영구 참조 |
| 인증 | 앱 실행·shell view·collector·요청별 runner scope; actor는 credential에서 |
| redaction | 로그 buffer 전, snapshot/blob/spool 전, model 전달/외부 read 전; 실패하면 원문 제외 |
| 앱 통로, invocation 전달 | 실제 invocation 문맥·안전한 로그·실행 binding; 업무 direct call은 변경하지 않음 |
| release 준비·적용 | 고정 bundle/당시 source map·SDK 자료, 같은 hash app test gate, 활성 release 확인 |
| 앱 화면 틀 | 버튼 시점 view binding·안전 캡처·사람 선택, test mode 화면 검사 |
| confirmation window | 정확한 문제/release/seq/선택에 묶인 사람 닫힘·부정 확인 |
| coding agent 통로 | 범위별 테스트 요청·결과/증거 읽기·고친 기록 제출; repair context는 그 소유 |
| notification | 정해진 운영 Problem event의 전달; problems가 직접 OS notification을 만들지 않음 |

다른 소유자의 DB·buffer·source 파일을 직접 열지 않는다. 필요한 자료는 해당 contract의 허용된 읽기/준비 참조로 받는다.

## 7. 흐름

### 7.1 앱 SDK 보고와 자동 exception

```text
[앱 프로세스] 실제 실패 자리 → reportProblem → ID·invocation 문맥 고정 → 앱 응답 계속
  → [collector] credential 검증·당시 선언 조회 → redaction·snapshot·GroupKey·blob 준비
  → [core command] RecordReport → 보고+증거+묶기+재발+event 한 transaction
  → [collector→SDK] completion에 report/snapshot/problem 또는 실패 반환
```

1. 플랫폼 앱 진입점은 앱 code를 로드하기 전에 `error`, `unhandledrejection` observer를 설치한다. 관측 ID를 먼저 정하고 exception ingress로 보낸다. observer는 `preventDefault`로 원래 종료를 숨기지 않는다.
2. view는 플랫폼 preload의 `error / unhandledrejection`, 템플릿의 루트 render 오류 경계가 같은 통로를 쓴다. preload→shell main IPC sender의 실제 view 연결로 귀속을 정하고 main→collector로 전달한다. 페이지의 app/release/mode는 믿지 않는다.
3. SDK 전달 전에 process가 죽으면 앱 supervisor가 확보한 안전한 stderr·관측 ID로 보충한다. 공유 ID이면 같은 발생, ID가 없으면 지문만으로 중복 제거하지 않는다. 오류 상세를 못 얻으면 이유를 남긴다.
4. 앱 자격은 확실한데 앱 frame만 없으면 exception을 받아 Report별 key로 분리한다. 플랫폼 code 오류 또는 출처 불명은 platform/diagnostics로 보내며 앱 탓으로 확정하지 않는다.
5. retry는 최종 고정 Report 입력만 다시 보낸다. 첫 시도 후 로그/화면을 다시 모아 같은 ID의 내용을 바꾸지 않고 원래 앱 command도 다시 호출하지 않는다.

### 7.2 shell의 [문제 알리기]

```text
[shell 앱 화면 틀] 버튼
  → [shell main] dialog 전 app view·시점·release/mode·binding·안전 상태 고정
  → [사람] 글·상태·이미지 미리보기/선택
  → [shell main→collector] SubmitFeedback → 최종 redaction·snapshot·hash
  → [core command] RecordReport → _feedback의 새 key 또는 선택 문제 key
  → [shell] 접수된 문제 열기 / 실패 이유와 복사 가능한 글 유지
```

1. 캡처는 앱 view만 대상으로 한다. feedback dialog는 shell overlay view에 그리고 보호된 결정은 요청 창의 child modal BrowserWindow에서 받으며 어느 쪽도 app view를 숨기지 않는다. 보호 화면·lophn dialog가 이미 떠 있거나 view가 가려졌으면 이미지 없이 이유를 기록한다. 캡처 await 동안 view가 교체/이동되어 당시 연결을 확인하지 못하면 이미지를 제외한다. 제출 시점 화면으로 교체하지 않는다.
2. 안전한 상태는 화면명·탭·URL path/안전 hash·입력 형태만 자동 준비한다. 실제 표시 결과·문서 판·invocation을 아는 경우만 참조로 지목하며 read 결과 전체나 URL query를 붙이지 않는다. 입력 검사로 command가 시작하지 않았으면 invocation을 만들지 않는다.
3. 상태만 기본 선택하고 PNG는 미리보기를 사람이 확인한 뒤 선택한다. PNG는 가리지 않는다(D32). 픽셀은 메모리에만 있고 blob/temp 파일에 먼저 쓰지 않는다. 사람이 포함을 눌러도 secret 저장 허가가 되지 않는다.
4. main은 같은 캡처의 binding·관측 시점·선택 상태·최종 이미지 hash를 전달한다. collector는 shell 출처와 binding을 검증하고 글·상태를 다시 redaction한 뒤 글 길이·PNG header/크기·전체 전송 크기를 검사한다. PNG는 redaction하지 않는다.
5. 첨부 실패/제외여도 글은 접수한다. 기존 문제는 같은 앱의 명시적 선택일 때만 쓴다. 취소하면 미제출 메모리를 버리며 이미 접수한 Report는 삭제하지 않는다. feedback 제출은 사람 닫힘 확인이 아니다.

### 7.3 snapshot 조립·문제 묶기·재발

```text
[collector] 당시 증거 source별 제한 읽기 → 항목 redaction·missing reason
  → source map/지문·blob·최종 hash
  → [core command] RecordReport → 동일 ID 검사 → live만 GroupKey 조회
     ├─ 없음: ProblemOpened
     ├─ open/fixing: ProblemObserved
     ├─ closed + 현재 활성 release 보고: ProblemReopened
     └─ closed + 이전 release 늦은 보고: ProblemObserved, closed 유지
```

| 증거 | collector가 받는 source와 조립 | 얻지 못하면 |
|---|---|---|
| invocation | SDK/view의 실제 `inv`와 binding; **read**로 해당 ID의 기록 도착 확인 | ID를 알면 그대로+미도착 이유; 모르면 연결 모름; 시간 근접 추정 금지 |
| 오류 | 플랫폼 관측; process 상대 source, view는 당시 bundle source map; stack 최대 16,384 bytes | 이름/메시지/위치별 이유; map path·symlink로 묶음 밖 파일 읽기 금지 |
| 로그 | 앱 supervisor의 redaction 완료 buffer를 contract로 받음; 실제 inv로 가능한 만큼 좁힌 최근 30줄 | 없음/수집 꺼짐/기한 내 미수신/실패/잘림을 구별; 정상 0줄은 값 |
| 화면 | shell이 고정하고 사람이 고른 안전 상태·PNG | automation/미선택/숨김/실패 이유; 앱 선언을 픽셀 관측으로 승격하지 않음 |

collector는 한도 안에서 source 읽기를 병행하고 모든 항목에 값 또는 공백 아닌 이유 하나를 만든다. observed_at과 captured_at, 화면의 실제 관측 시각·로그 범위가 다르면 그대로 둔다. blob 저장 실패 항목은 제외 이유로 고정한다. snapshot은 전체 시스템의 한 시각 원자 캡처가 아니다.

지문은 오류 이름과 상위 최대 3개 앱 frame의 **상대 path·function** canonical JSON 전체 SHA-256이다. line/column/message/업무 값/절대 path/SDK/runtime frame을 빼고 사람이 읽을 원래 위치는 ErrorEvidence에 남긴다. 앱 frame 0개는 Report ID를 discriminator로 쓴다. 선언 보고는 app+code, 새 feedback은 app+첫 Report ID, 선택 feedback은 선택 Problem key다.

core는 지문을 계산하지 않는다. 신뢰 collector의 준비 참조·key 형식·scope를 검사하고 unique key로 기존 문제를 찾으며 접수 시 현재 활성 release와 문제 seq를 비교한다. closed의 재발 판정도 **같은 transaction**에 있다. preview/test는 `problem=null`과 진단 scope를 쓰고 운영 상태·수를 바꾸지 않는다.

### 7.4 app test와 release 준비 관문

```text
[release 준비·적용] code·화면·blueprint·의존·test 포함 bundle hash 고정
  → [coding agent 통로→runner] RequestTest(app_test)
  → [runner] FrozenTest·필수 플랫폼 검사 준비 → [core command] 접수/시작 흔적
  → [test 자식·test 앱·test view] 실제 fixture 실행 → test scope 보고 접수
  → [runner] 검사별 관측·redaction·판정 준비
  → [core command] RecordVerification
  → [release 준비·적용] 같은 bundle hash의 pass Verification 참조
```

플랫폼 필수 검사 code는 runner의 불변 설치 자료에서 읽으며 앱 bundle/agent가 고칠 수 없다. 앱이 작성한 code별 실패 경로 test는 실제 앱 command/화면에 fixture 실패를 주입해야 한다. SDK 직접 호출만으로 실패 경로를 통과시키지 않는다.

검사는 선언·blueprint/handler 일치·고정 SDK·정적/동적 code 사용·SDK 접수·선언별 실패 경로·process/view exception·깨진 view의 feedback·redaction·permission 거절이다. apps/data의 빈 fixture DB 전체 migration과 이전 release schema→새 schema migration, read의 입력 계약·업무 및 외부 상태 불변, automation의 command·고정 입력·grant와 confirm 금지, external은 사람이 켤 때 command·입력·주기를 한 번 승인한 것만 허용함을 각 apps contract로 검사한다. grant된 secret의 가져오기·동기화는 대역으로 허용하며 호출마다 approval을 요구하거나 호출 주체가 automation이라는 이유로 막지 않는다. apps/blueprint가 아직 선언하지 않는 출력 schema는 필수 검사로 새로 만들지 않는다. 화면 없는 bundle만 화면 검사에 이유 있는 `not_applicable`을 남긴다.

출력 `pass` 문자열이나 생성 test 파일 존재는 근거가 아니다. runner가 검사별 status/reason/evidence를 모아 모든 필수 검사 실제 통과일 때만 `pass`다. 변경된 bundle은 새 app test가 필요하며 release 준비 자체는 runner가 하지 않는다.

### 7.5 reproduction·test command·고친 기록

```text
[coding agent 통로] 문제/보고/고정 release 읽기 → FrozenTest 준비 → RequestTest
  → [runner] 요청 hash·문제 basis/조건 완료 seq 고정 → [core command] 접수/시작 흔적
  → [runner→자식] before/after 또는 single의 독립 fixture 실행
  → [runner] 실제 종료·업무 관측·약화 검사·redaction → blob 준비
  → [core command] RecordVerification → [read] 같은 결과 ID
```

- reproduction은 before/after마다 source read-only·새 fixture DB·같은 FrozenTest/input/expected/environment를 사용한다. 운영 앱 DB를 복사하거나 실계정 외부 효과를 다시 보내지 않고 replay/stub/sandbox를 사용한다.
- harness는 side별 `symptom_reproduced`, `expectation_met`, 실제 값 hash·이유를 보낸다. runner는 process 시작/종료를 직접 관측하고 결과 protocol과 선언/보고 경로/기대 약화 검사를 함께 해석한다. before가 원증상을 재현하고 after가 같은 기대를 충족하며 약화가 없을 때만 pass; before 재현+after 같은 증상은 fail; before도 pass/다른 실패/timeout/약화는 inconclusive다.
- test command는 분리된 argv·고정 cwd·기대 종료값으로 실행한다. 기대 종료값과 다르면 fail, 중단은 inconclusive다. 결과의 ticket link가 있으면 실행한 고정 조건 hash·완료 보고 seq를 그대로 남기며 낡은 결과도 보존한다.
- 관측 protocol은 stdout와 분리한 private IPC의 길이 제한 JSON frame이다. frame은 `{side, test_hash, name, actual, symptom_reproduced?, expectation_met?, reason}`이며 side와 test hash는 runner가 시작한 대상과 일치해야 한다. app test의 name은 플랫폼 검사 또는 고정 failure_paths의 항목만 허용한다. reproduction은 before/after 각각 원래 증상·동일 기대의 관측을 모두 요구한다. runner가 actual JSON을 redaction·blob 준비하고 최종 observations에는 그 actual_hash만 넣는다. IPC frame 하나 최대 65,536 bytes, side별 총 1MiB로 제한하고 잘못된/누락된 protocol은 판정 불가로 남긴다.
- 자식은 관측 protocol만 내며 Verification 본문·ID·결과 쓰기 자격은 없다. stdout의 pass나 자식이 만든 임의 결과 파일은 판정에 쓰지 않는다. runner가 실제 execution과 test hash를 대조하고 최종 result를 만든다. agent 작성 판별기의 의미 전체를 증명하지 못한다는 한계도 reason에 남긴다.
- coding agent의 별도 `RecordProblemFix`는 준비된 before/after·summary·맞는 결과 ID를 기록한다. 새 제출은 ticket·현재 claim을 검사하며 없으면 거절한다. 과거 직접 수리 null 출처는 읽기만 유지한다. 제출 자체는 테스트를 시작하거나 닫지 않는다.

### 7.6 work와 닫힘 판정

```text
[event 구독→runner 반응기]
  Ticket 관련 event → 현재 work/ticket/claim 읽기 → ReconcileProblemWork command
  VerificationRecorded / ReleaseActivated / ProblemObserved
    → 현재 problem·활성 release·reproduction 결과·basis 뒤 운영 Report 읽기
    → 조건 충족 때 CloseProblemVerified command
    → [core] 짧은 최종 CAS·근거 검사 → ProblemClosed

[shell confirmation window] 실제 사람 선택
  → ApplyProblemDecision command → [core] 일회 binding·seq·release 재검사
  → ProblemClosed / ProblemReopened / ProblemConfirmationRecorded
```

1. runner의 `work-reaction.ts`는 `TicketClaimed`, `TicketClaimReleased`, `TicketCompletionReported`, `TicketCheckFailed`, `TicketCancelled`, `TicketConfirmed`와 claim 만료 시점을 받아 현재 사실을 다시 읽는다. `TicketCheckFailed`를 새 claim으로 보지 않는다. 닫힌 문제를 ticket event로 열지 않는다.
2. `closing-reaction.ts`는 reproduction pass만 후보로 읽는다. before 원증상 재현·after 같은 업무 기대·약화 없음, after가 현재 활성 release, `Verification.basis_seq` 뒤 같은 문제의 **모든 새 live Report가 0개**인지 확인한다. 늦은 이전 release 보고도 이 0개 조건에 포함된다.
3. 반응기는 현재 문제 최신 seq·활성 release를 compare에 넣어 `CloseProblemVerified`를 낸다. core는 참조된 신뢰 runner 결과의 kind/대상/판정과 현재 조건을 transaction 안에서 다시 검사한다. 자료 해석·테스트는 하지 않는다. 동시 보고/activation/ticket 변화로 seq가 달라지면 `conflict`이며 다시 읽는다. 추가 quiet 대기는 0ms, 날짜 기반 결과 만료는 없다.
4. `fixed`는 user_confirmed, `not_visible`는 recovered, 한 줄 이유 있는 `dismiss`는 dismissed다. `not_fixed`는 closed면 reopen하고 열린 문제면 부정 확인 event만 쓴다. 사람이 본 현재 release·문제 seq·필요한 last Report와 일회 handle을 검증한다. Verification을 만들어 대신하지 않는다.
5. 같은 release·같은 근거에서 부정 확인한 뒤 고쳐짐 확인을 반복 요청하지 않는다. 기존 `ProblemConfirmationRecorded`/`ProblemReopened`를 읽어 새 release나 새 근거가 있을 때만 다시 제안한다. 자동 recovered/quiet close·앱 clear·agent close는 없다.
6. event 반응 key는 공통 `(subscriber, cause_seq, reaction)`이다. 반응 command 확정/조건 불충족 확인 뒤 cursor를 올린다. 대표 subscriber는 `problems.work`, `problems.closing`이며 재시작 때 seq로 따라잡는다.

## 8. 실패와 재시작

| 상황 | 처리 |
|---|---|
| collector/core 잠시 불가 | 제한 메모리·유한 retry; 앱 업무 응답을 막지 않음. overflow/마지막 실패는 접수 실패·손실로 표시 |
| 일부 evidence timeout/저장 실패 | 그 항목에 이유를 고정하고 나머지 접수; 뒤에 얻은 자료로 UPDATE하지 않음 |
| Report commit 뒤 응답 유실 | 같은 ID·원주체·최종 content hash로 retry/read; 재조립·새 발생 ID·앱 command 재실행 금지 |
| collector 사망 | core가 재시작; 미확정 raw 메모리는 잃을 수 있음. SDK/shell이 보유한 최종 retry 자료만 다시 제출 |
| shell 취소/종료 | 미제출 글·화면은 메모리에서 사라짐. 제출 완료 후 창 닫기는 삭제 아님; 실패 글은 살아 있는 dialog에서 복사 가능 |
| SDK 전달 전 앱 사망 | supervisor가 실제 확보한 exception만 보충; 원래 발생을 만들려고 앱을 재실행하지 않음 |
| test 요청 준비 실패·미시작 | RequestTest 접수 결과에 미실행 이유; Verification 없음. 같은 key 재전달로 몰래 재실행하지 않음 |
| runner 사망/timeout | core 감독이 runner의 test 자식·view를 회수. 새 runner가 요청/시작 흔적과 안전 spool을 읽고 실제 관측 가능한 시작만 `runner_lost`·inconclusive로 기록 |
| 시작 흔적 기록 직후 spawn 실패 | 흔적은 실행 허가/시도이며 실제 시작 증거와 구별. 자식이 실제 시작하지 않았으면 Verification 없음; 미시작 이유 보존 |
| 한쪽 reproduction만 시작 | 시작한 side의 execution만 남기고 미시작 side 이유를 observations에 넣어 inconclusive |
| 결과 준비 후 command 응답 유실 | 안전 spool로 동일 Verification ID/내용을 재전달; 이미 확정됐다면 원래 결과 반환 |
| 실제 시작은 확인했으나 최종 spool 손실 | 관측된 시작·회수·출력 부재 이유로 inconclusive. pass 추정 금지 |
| 결과 완료 때 문제/ticket 변경 | 실행 사실은 보존. 현재 닫힘/acceptance check가 별도 CAS로 거절; 낡은 근거를 현재 보고에 붙이지 않음 |
| source map·binding 출처 불명 | map/frame 부재는 이유·Report별 key; 실행 귀속 자체가 불명인 관측은 platform/diagnostics |
| 디스크 부족 | 기존 blob 삭제로 숨기지 않음. 큰 신규 항목 제외/작은 접수 실패, 공간·내보내기·한도 조정 안내 |

test 요청 접수·고정 입력 참조·시작 시도·runner 식별·복구 처리 위치는 problems 소유 `test_requests`의 append-only 기록이다. side별 실제 시작은 `test_side_starts`다. platform 공통 command 기록은 이 정본이 아니다. 시작 시도를 확정하기 전 자식을 띄우지 않되 그 기록만으로 실제 execution을 만들지 않는다. runner가 spawn 성공·실제 started_at을 관측한 사실과 감독의 자식 lifecycle을 복구 근거로 쓴다. 시작 여부 자체를 모르면 실제 시작/성공을 꾸미지 않고 GetTestRequest에 확인 불가로 남긴다. lifecycle wire는 T8 입구가 맡는다.

이미 시작한 요청은 재시작으로 처음부터 다시 돌리지 않는다. 재실행은 새 request key·Verification ID다. 복구 runner도 해당 요청의 결과 기록만 가능한 machine scope를 받으며 테스트 자식은 받지 않는다. 작업 폴더가 결과 정본이 되지 않고 유일한 확정 사실은 ledger다.

## 9. 이전과 달라진 것

- 이전: daemon이 source map·지문·snapshot·test를 직접 처리 / 지금: collector와 runner control이 준비하고 core는 짧은 command만 확정 / 이유: 수리 증거 수집·긴 테스트가 다른 앱과 읽기를 막지 않는다.
- 이전: 앱+code+업무 대상, message 정규화와 짧은 hash로 묶기 / 지금: app+code, exception은 message 없는 앱 frame 최대 3개와 전체 SHA-256 / 이유: 행·문구·줄 이동으로 같은 문제를 쪼개지 않는다.
- 이전: 앱 frame 없는 오류를 앱 문제가 아니라고 처리 / 지금: 앱 귀속이 확실하면 예외로 받고 발생별 key·위치 부재 이유 / 이유: 위치 미수집과 플랫폼 오류를 혼동하지 않는다.
- 이전: 같은 지문 60초 1회·같은 code 10초 1회로 발생을 합치기 / 지금: 같은 관측 ID retry만 중복 제거하고 서로 다른 발생은 불변 Report / 이유: 전송 중복과 실제 반복 발생은 다르다.
- 이전: preview 보고를 기록하지 않음 / 지금: preview/test 진단 scope에 Report·Snapshot을 기록하고 운영 Problem은 제외 / 이유: 수리 중 접수·보고 경로를 실제로 검사할 근거가 필요하다.
- 이전: read 결과·행 표본·원본 screenshot 자동 첨부, 앱별 첨부 폴더와 90일 삭제 / 지금: 안전한 형태만, 사람 선택 PNG(가리지 않음), 글·상태는 redaction 전 메모리, 큰 자료는 용량 상한 초과 시 오래된 것부터 정리하고 변경 기록·결정·확정 결과는 영구 보존 / 이유: 업무 원값 자동 수집과 과거 근거 소실을 막으면서 큰 자료를 무제한으로 쌓지 않는다.
- 이전: 앱 clear·quiet·health 성공·배포로 닫힘, 여러 상태·episode·repair attempt / 지금: reproduction+현재 activation+새 live Report 0개 또는 보호된 사람 결정, 3상태와 Closure / 이유: 조용함·주장·실제 수리 확인을 구별한다.
- 이전: test용 host journal·lease·여러 실행 token과 broad Deno 권한 / 지금: 요청별 scratch·fixture DB·명시 permission, 신뢰 runner만 결과 command / 이유: 필요한 격리는 유지하되 별도 writer와 허가 단계를 만들지 않는다.
- 이전: 재현 fixture 존재나 agent 로그를 검사 근거로 사용 / 지금: 동일 FrozenTest의 실제 before/after 업무 관측과 불변 Verification / 이유: pass 문자열과 실행 사실은 다르다.
