---
type: domain-model
concerns: [problems/reporting]
---
# problems/reporting

발생 한 번의 불변 Report와 접수·중복 처리 제약을 정의한다.

## Report (`rpt`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `rpt` ID | 아니오 | PK; 첫 전송 전에 고정 | 발생 식별자이자 재전송 키 |
| `app` | `app` ID | 아니오 | → apps/registration; 인증된 실행·view 범위와 일치 | 발생 앱 |
| `problem` | `prb` ID | 예 | 운영 접수는 필수, preview·test는 null; 같은 앱; → problems/grouping | 묶인 운영 문제 |
| `source` | enum | 아니오 | `app` / `exception` / `feedback`; credential로 허용 출처 검사 | 앱 주장 / 수집기 관측 / 사람의 글 |
| `mode` | enum | 아니오 | `live` / `preview` / `test`; 실행 자격에서 고정 | 운영 문제와 진단의 구분 |
| `diagnostic_scope` | 문자열 | 예 | 운영은 null; 나머지는 플랫폼이 발급한 preview 또는 test 요청 키 필수 | 운영 문제 없는 보고의 읽기 범위 |
| `release` | `rel` ID | 예 | 해당 앱의 관측 당시 release; → apps/releases | 실제 실행 release |
| `release_missing_reason` | 문자열 | 예 | release가 null일 때만 필수; 빈 값 금지 | release를 확인하지 못한 이유 |
| `bundle_hash` | sha256 | 예 | 알려진 고정 실행 묶음; release가 있으면 그 hash와 일치 | release 전 test·preview 묶음 식별 |
| `code` | 문자열 | 아니오 | `app`은 당시 선언 code; 예약 값은 → problems/problem-codes | 실패 분류 |
| `text` | sha256 blob 참조 | 예 | redaction된 UTF-8 글; → platform/blob-store | feedback 글 또는 안전한 설명 |
| `details` | sha256 blob 참조 | 예 | redaction된 구조화 JSON; 업무 원값 자동 복사 금지 | 추가 세부 |
| `snapshot` | `snp` ID | 아니오 | unique; → problems/snapshots | 고정 증거 |
| `observed_at` | 공통 시각 | 아니오 | UTC 밀리초 문자열; 접수 순서 비교에 쓰지 않음 | 실제 관측 시각 |
| `principal` | 인증 주체 참조 | 아니오 | → platform/identity; token 원문 저장 금지 | 최초 전송의 인증된 주체 |
| `content_hash` | sha256 | 아니오 | 첫 접수 시도 전 최종 불변 입력을 canonical JSON으로 hash | 재전송 내용 비교 |

### 불변 조건

- 접수 뒤 UPDATE·DELETE command가 없다. 새 자료·다른 내용은 새 Report다.
- 같은 ID·principal·content hash는 기존 접수 결과를 반환한다. 하나라도 다르면 `conflict`다.
- hash 입력에는 최종 Report 입력·Snapshot 입력·선택한 기존 문제 참조·blob hash가 포함된다. 서버가 묶은 problem과 event seq는 포함하지 않는다.
- Report·Snapshot·Problem 변경·각 event는 transaction 하나다. 저장 실패를 접수 성공으로 반환하지 않는다.
- 미선언 앱 code의 원래 보고는 `invalid_input`이다. 수집기는 원래 ID에서 결정적으로 정한 별도 `rpt` ID로 `_invalid_report` 진단을 1개만 준비한다. 실패는 → platform/diagnostics이며 재귀 보고하지 않는다.
- SDK와 supervisor가 같은 관측 ID를 공유하면 같은 Report다. 지문만 같고 ID가 다르면 서로 다른 발생이다.
- 플랫폼 오류·출처 불명 관측은 → platform/diagnostics다. 앱 frame이 없어도 앱 자격이 확실하면 예외 보고를 받는다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Report | 발생 앱 | → apps/registration | N:1 | archive 후에도 참조 보존 |
| Report | 운영 묶음 | → problems/grouping | N:0..1 | 참조 삭제 금지 |
| Report | 증거 | → problems/snapshots | 1:1 | 참조 삭제 금지 |
| Report | 실행 release | → apps/releases | N:0..1 | 참조 보존 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `reports` | Report의 불변 필드 | `id` PK | `snapshot` | `(problem, observed_at)`, `(app, mode, observed_at)`, `(diagnostic_scope)` | `app → apps.id`, `problem → problems.id`, `release → releases.id`, `snapshot → snapshots.id`; blob 참조 → platform/blob-store |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `RecordReport` | 범위 제한 machine 수집기; 원출처는 app/user/관측 자격 | 고정 Report·Snapshot, grouping 값, 선택한 기존 문제 | ID·principal·content hash; 실행 자격; 기존 문제 앱·key; 현재 활성 release와 문제 최신 seq | `ReportRecorded`, `SnapshotRecorded`; 문제 event → problems/grouping | `invalid_input`, `unauthorized`, `forbidden`, `conflict`, `unavailable` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ReportRecorded` | Report ID | `app`, `problem?`, `source`, `mode`, `code`, `snapshot`, `observed_at`, `content_hash` | problems/grouping, problems/closing, coding-agent/repair-context |

## 정책

- **예외 관측.** process와 view의 `error`, `unhandledrejection`, view 루트 render 오류를 자동 수집한다. 원래 실패·종료를 성공으로 바꾸지 않는다.
- **비운영 보고.** preview·test는 운영 Problem을 생성·재발시키지 않는다. 진단 scope에만 붙는다.
- **과다 보고.** 첫 판은 앱당 60,000ms 동안 새 보고 최대 20개를 접수한다. 같은 ID 재전송은 추가 발생으로 세지 않는다. 초과는 `unavailable`과 손실 표시이며 이미 접수한 Report를 합치거나 삭제하지 않는다.
- **수집 대기.** 제한된 메모리 대기는 영구 접수가 아니다. 보고 재전송 때문에 원래 앱 command를 다시 호출하지 않는다. 대기·실패·접수 성공은 구별한다.
- **저장 안전.** 모든 문자열·blob은 저장 전에 → platform/redaction을 통과한다.

## 정할 것

- 대기 최대 개수·총 bytes, 재전송 횟수·간격, 자료 수집 timeout 기본값.
- 운영 mode의 실제 credential 값 이름은 → apps/runtime과 맞춘다.
