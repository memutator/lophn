---
type: domain-model
concerns: [problems/tests]
---
# problems/tests

test runner가 실제로 돌린 테스트의 불변 Verification과 종류별 결과 제약을 정의한다.

## Verification (`vrf`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `vrf` ID | 아니오 | PK; 시작한 테스트 1회당 하나 | test result 식별자 |
| `request_key` | 문자열 | 아니오 | 인증 주체와 함께 unique; 재시험은 새 키 | 요청 중복 방지 |
| `request_principal` | 인증 주체 참조 | 아니오 | → platform/identity; token 원문 금지 | 요청 주체 |
| `request_hash` | sha256 | 아니오 | 고정 요청 canonical JSON의 hash | 동일 키 내용 비교 |
| `kind` | enum | 아니오 | `app_test` / `reproduction` / `test_command` | 테스트 종류 |
| `app` | `app` ID | 아니오 | 요청 범위 안; → apps/registration | 대상 앱 |
| `target` | TestTarget | 아니오 | 실행 전에 고정; reproduction은 after 대상 | 실제 대상 묶음 |
| `problem` | `prb` ID | 예 | reproduction에서만 필수; 같은 앱; → problems/grouping | 재현할 문제 |
| `basis_seq` | event seq 정수 | 예 | reproduction에서만 필수; 양의 정수 | 요청 때 읽은 문제 최신 변경 seq |
| `reports` | `rpt` ID 목록 | 아니오 | reproduction은 1개 이상, 나머지는 빈 목록; 해당 problem; → problems/reporting | 원래 증상 근거 |
| `before` / `after` | `rel` ID | 예 | reproduction에서만 모두 필수; 서로 다름·같은 앱; → apps/releases | 이전·고친 release |
| `ticket` | TicketTestLink | 예 | test_command에서만 허용 | 티켓 조건 연결 |
| `test` | sha256 blob 참조 | 아니오 | FrozenTest JSON; 실행 전에 고정; → platform/blob-store | 같은 테스트·입력·기대값·실행 방법 |
| `execution` | sha256 blob 참조 | 아니오 | ExecutionEvidence 목록; 실제 시작한 1회 또는 reproduction 양쪽 | 관측 기록 |
| `result` | enum | 아니오 | `pass` / `fail` / `inconclusive` | 종류별 판정 |
| `reason` | 문자열 | 아니오 | redaction된 공백 외 설명 | 판정 이유와 한계 |
| `observations` | sha256 blob 참조 | 아니오 | 종류별 검사·업무 관측 JSON; 출력 `pass` 문자열 자체는 근거 아님 | 판정 증거 |

### 불변 조건

- 실제 시작한 실행만 결과를 만든다. 요청 거절·실행 전 준비 실패는 Verification이 없다. 진행 상태·별도 AppTest 결과 entity는 없다.
- test runner 제어 프로세스의 범위 제한 machine만 결과를 기록한다. 앱·테스트 자식과 agent에게 결과 쓰기 자격을 주지 않는다.
- 같은 request key·principal·hash는 같은 기록을 가리킨다. 내용 변경은 `conflict`다. 결과를 UPDATE하지 않으며 다시 돌리면 새 request key·ID다.
- `target.release`가 있으면 앱·bundle hash가 그 release와 같아야 한다. release 준비 뒤 ID 없는 결과를 수정하지 않는다.
- reproduction의 `target.release=after`이며 이전 묶음 hash도 실제 execution에 남긴다. 같은 FrozenTest hash를 양쪽에 적용한다.
- 티켓 확인·release 준비·문제 닫힘은 이 ID만 참조한다. 실행 결과 정본을 다른 concern에 복제하지 않는다.

## TestTarget (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `bundle_hash` | sha256 | 아니오 | 실제 실행한 고정 묶음 전체 hash | 준비 전에도 유효한 대상 |
| `release` | `rel` ID | 예 | 존재하면 해당 앱·bundle hash 일치; → apps/releases | release 연결 |

## TicketTestLink (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `ticket` | `tkt` ID | 아니오 | 같은 앱; → coding-agent/tickets | 조건 소유 ticket |
| `check_index` | 정수 | 아니오 | 0 이상; 고정 acceptance check 목록 안 | test command 조건 번호 |
| `check_hash` | sha256 | 아니오 | 고정 조건 값의 hash | 실제 검사한 조건 |
| `completion_seq` | event seq 정수 | 아니오 | 양의 정수; 해당 완료 보고 | 검사한 완료 보고 |

## FrozenTest (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `code` | sha256 blob 참조 | 아니오 | 고정 테스트 code | 실행할 테스트 |
| `input` | sha256 blob 참조 | 아니오 | redaction된 고정 입력·대역; 입력 없음도 명시 JSON | 동일 입력 |
| `expected` | sha256 blob 참조 | 아니오 | 고정 업무 기대·증상 판별; 종료값만으로 재현을 인정하지 않음 | 같은 기대값 |
| `method` | TestMethod | 아니오 | shell 문자열 해석 없음 | 실행 방법 |
| `blueprint` | sha256 blob 참조 | 예 | app_test는 필수; → apps/blueprint | 고정 선언 |
| `sdk_dependencies` | sha256 blob 참조 | 예 | app_test는 필수; → apps/sdk | 고정 SDK 의존 |
| `failure_paths` | JSON 목록 | 예 | app_test는 필수; 각 `{code: 문자열, test_hash: sha256}`; 선언마다 1개 이상 | 실제 실패 경로 테스트 |
| `symptom` | sha256 blob 참조 | 예 | reproduction은 필수; 원래 reports·판별·업무 기대 포함 | 원래 증상 판별 |

## TestMethod (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `argv` | 문자열 목록 | 아니오 | 길이 1 이상; 실행 파일과 분리된 인자; 자유 shell 문자열 금지 | 실제 command |
| `cwd` | 상대 path 문자열 | 아니오 | 고정 source 안; `..`·symlink로 작업 폴더 밖 접근 금지 | 작업 위치 |
| `timeout_ms` | 정수 | 아니오 | 1 이상; 생략 금지 | 유한 시간 제한 |
| `expected_exit_code` | 정수 | 아니오 | 실제 종료값과 비교 | 기대 종료값 |
| `environment` | sha256 blob 참조 | 아니오 | 안전한 환경·대역 정의; 실제 secret 금지 | 고정 테스트 환경 |

## ExecutionEvidence (값)

`execution` blob은 다음 값의 목록이다. reproduction 준비 후 한쪽만 시작했다면 시작한 쪽만 기록하고 미시작 이유를 observations에 남긴다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `side` | enum | 아니오 | `single` / `before` / `after`; 같은 side 중복 금지 | 실제 실행 구분 |
| `bundle_hash` | sha256 | 아니오 | 실제 설치·실행한 묶음 | 실행 사실 |
| `test_hash` | sha256 | 아니오 | Verification.test와 일치 | 같은 고정 테스트 |
| `started_at` | 공통 시각 | 아니오 | runner가 직접 관측 | 시작 |
| `ended_at` | 공통 시각 | 아니오 | 종료·중단 관측; start 이상 | 끝 |
| `exit_code` | 정수 | 예 | 실제 종료값; 종료값 없으면 null | process 결과 |
| `end_reason` | enum | 아니오 | `exited` / `timeout` / `killed` / `runner_lost` / `start_failed` | 종료 이유 |
| `runner_version` | 문자열 | 아니오 | 빈 값 금지 | 관측기 version |
| `environment` | sha256 blob 참조 | 아니오 | 실제 OS·runtime·대역·격리 한도 | 실제 환경 |
| `output` | sha256 blob 참조 | 예 | redaction된 stdout·stderr | 실제 출력 |
| `output_missing_reason` | 문자열 | 예 | output이 null일 때 필수 | 출력 없는 이유 |
| `truncated` | boolean | 아니오 | 출력이 잘렸으면 true | 출력 범위 |
| `redaction_notes` | 문자열 목록 | 아니오 | 원값 포함 금지; 없으면 빈 목록 | 제외 내역 |

## 종류별 판정 (값)

| kind | 필수 observations | pass | fail | inconclusive |
|---|---|---|---|---|
| `app_test` | 각 검사 `{name, status: pass/fail/not_applicable, reason, evidence_hash?}` | 모든 필수 검사 실제 통과 | 검사 실패 | 중단·준비 뒤 시작 실패·판정 불가 |
| `reproduction` | before/after 각각 `{symptom_reproduced, expectation_met, actual_hash, reason}`와 선언·보고 경로·기대 약화 검사 | before 원래 증상 재현 + after 같은 업무 기대 충족 + 약화 없음 | before 원래 증상 재현 + after 같은 증상 남음 | before도 통과·다른 실패·시간 초과·기대 약화·판정 불가 |
| `test_command` | 기대/실제 종료값·출력 참조 | 고정 command가 기대 종료값으로 종료 | 다른 종료값 | 중단·판정 불가 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Verification | 묶음 release | → apps/releases | N:0..1 | 참조된 release 보존 |
| Verification | 재현 문제·보고 | → problems/grouping, → problems/reporting | N:0..1 문제, N:N 보고 | 사실 참조 보존 |
| Verification | 조건 | → coding-agent/tickets | N:0..1 | 완료 보고·고정 조건 이력 보존 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `verifications` | Verification; target·ticket link는 열, 나머지 큰 내용은 hash | `id` PK | `(request_principal, request_key)` | `(app, kind, target_bundle_hash, result)`, `(problem, basis_seq)`, `(ticket, completion_seq, check_index)` | `app → apps.id`, `target_release/before/after → releases.id`, `problem → problems.id`, `ticket → tickets.id`; 삭제 RESTRICT; blob 영구 참조 → platform/blob-store |
| `verification_reports` | reproduction의 원래 보고 연결 | `(verification, report)` PK | PK | `(report)` | `verification → verifications.id`, `report → reports.id`; 삭제 RESTRICT |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `RequestTest` | user / coding_agent / 범위 제한 machine | request key, kind, app, target, 고정 test, 종류별 연결 | 주체·키·request hash; app 범위; 대상 hash·ticket 완료 seq; reproduction의 문제 basis seq | 실행 접수·시작 흔적은 → platform/ledger의 공통 command 기록; domain event 없음 | `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `conflict`, `unavailable` |
| `RecordVerification` | test runner의 machine | 고정 Verification | 요청 key·hash·대상·test hash와 runner scope; 같은 결과 ID 내용 | `VerificationRecorded` | `invalid_input`, `forbidden`, `not_found`, `conflict` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `VerificationRecorded` | Verification ID | `kind`, `app`, `target`, `problem?`, `basis_seq?`, `ticket?`, `result`, `test`, `execution` | apps/releases, problems/closing, coding-agent/tickets, coding-agent/repair-context |

## 정책

- **app test 필수 검사.** 선언·SDK 보고·선언별 실제 실패 경로·정적/동적 code 사용·process 예외·view 예외·feedback·redaction, blueprint/handler 일치·permission 거절·고정 SDK를 검사한다. 화면 없는 묶음의 화면 검사는 이유 있는 `not_applicable`이다.
- **플랫폼 검사.** 플랫폼 필수 검사 code는 앱 묶음 밖의 고정 runner 소유이며 coding agent가 바꿀 수 없다. 앱 code·화면·blueprint·의존·테스트 변경은 새 hash와 새 app test를 요구한다.
- **격리.** 운영 DB·backup·keychain·사람 파일·일반 홈·실제 외부 서비스 접근 금지다. 고정 source는 읽기 전용, 쓰기는 테스트 폴더·테스트 DB만 허용한다. secret·network·문서 쓰기는 고정 대역이다.
- **시작과 복구.** 자식 시작 전에 공통 command 기록에 시작 사실을 남긴다. 시작한 실행이 끊기면 실제 기록과 `inconclusive`를 남긴다. 복구를 이유로 같은 요청을 몰래 재실행하지 않는다.
- **낡은 근거.** 문제·ticket이 바뀐 뒤 끝난 결과도 실행 사실로 보존한다. 닫힘·ticket 확인 시 별도 CAS를 적용한다.
- **권한.** 일반 shell의 agent 테스트 로그는 → problems/repairs의 설명일 뿐 Verification으로 등록하지 않는다. 이 event는 notification을 만들지 않는다.

## 정할 것

- 지원 runtime별 테스트 진입점·판정 protocol, observations JSON schema의 세부. 종료값만으로 reproduction 증상을 증명하는 형식은 허용하지 않는다.
- timeout 상한·기본값, 출력·메모리 한도와 runner 작업 폴더 보관 기간.
- 공통 command 기록의 요청·시작·복구 필드 지원은 → platform/ledger와 맞춘다. 별도 test 큐 entity는 만들지 않는다.
