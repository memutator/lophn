---
type: domain-model
concerns: [problems/repairs]
---
# problems/repairs

문제에 덧붙이는 불변 고친 기록의 값과 제출 규칙을 정의한다.

## FixRecord (값)

`ProblemFixRecorded` payload다. 별도 entity·ID·상태·claim은 없다. 기록의 식별자는 event seq다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `before` | `rel` ID | 아니오 | 해당 problem 앱; after와 다름; → apps/releases | 이전 release |
| `after` | `rel` ID | 아니오 | 해당 problem 앱; 실제 준비된 release; → apps/releases | 고쳤다고 알린 release |
| `summary` | sha256 blob 참조 | 아니오 | redaction된 UTF-8; 공백 외 설명 필수; → platform/blob-store | 변경 내용·실행하지 않은 테스트·남은 한계 |
| `verification` | `vrf` ID 목록 | 아니오 | 중복 없음; 없으면 빈 목록; 해당 앱·after 묶음과 일치; reproduction이면 해당 problem·before·after 일치; → problems/tests | 실제 test result 참조 |
| `ticket` | `tkt` ID | 예 | 새 제출은 필수; 과거 null 이력만 허용; 해당 problem을 포함한 repair ticket; → coding-agent/tickets | 티켓 수리의 출처 |
| `claim_seq` | event seq 정수 | 예 | 새 제출은 필수; 과거 ticket 없는 이력만 null; 제출 시 현재 유효 claim과 일치 | 어느 claim에서 나온 기록인지 |

### 불변 조건

- problem은 → problems/grouping이며 event subject로만 지정한다. 사람·시각·run은 → platform/ledger의 event envelope가 정한다. payload의 actor·at 주장을 받지 않는다.
- 과거 직접 수리의 `ticket=null`, `claim_seq=null`은 불변 이력으로 읽는다. 새 코드 수리 제출에는 ticket·현재 claim이 필수이고 과거 기록에 가짜 출처를 보충하지 않는다.
- ticket 수리는 현재 claim을 가진 coding_agent만 제출한다. 새 ticket·claim 없는 제출은 거절하며 과거 null 출처를 현재 수리 claim으로 승격하지 않는다.
- code·commit·blueprint·묶음 hash는 release에서 읽으며 기록에 복제하지 않는다.
- verification 빈 목록도 유효하다. agent의 테스트 로그는 summary의 설명일 뿐 machine 결과로 승격하지 않는다.
- 테스트가 나중에 끝나면 → problems/tests의 event와 관계 조회로 새 사실을 읽는다. 기존 FixRecord를 수정하지 않는다.
- 고친 기록·release 준비·test 요청·ticket 완료 보고는 닫힘이 아니다. 판정은 → problems/closing이다.
- 사람의 설정·입력 조치에는 가짜 release를 만들지 않는다. 보호된 사람 확인은 → problems/closing이다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| FixRecord event | 문제 | → problems/grouping | N:1 | 이력 보존 |
| FixRecord | 이전·고친 release | → apps/releases | N:2 | 참조된 release 보존 |
| FixRecord | 실제 테스트 | → problems/tests | N:N | 불변 결과 보존 |
| FixRecord | 수리 출처 | → coding-agent/tickets | N:0..1 | ticket·claim event 이력 보존 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `events` (→ platform/ledger) | type=`ProblemFixRecorded`의 FixRecord payload; 전용 표 없음 | `seq` PK | 공통 idempotency key는 → platform/ledger | 공통 `(subject, seq)`, `(type, seq)` | subject·release·Verification·ticket·claim seq는 command에서 검사; summary blob 영구 참조 |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `RecordProblemFix` | coding_agent | problem, FixRecord, idempotency key | 문제 최신 seq; 연결 앱 scope; release·Verification 내용; 새 제출은 ticket·현재 claim seq 필수 | `ProblemFixRecorded` | `invalid_input`, `not_found`, `forbidden`, `conflict` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `ProblemFixRecorded` | Problem ID | FixRecord | problems/closing, coding-agent/tickets, coding-agent/repair-context |

## 정책

- **기록 보존.** 재발·새 수리·새 결과가 기존 고친 기록을 덮어쓰지 않는다. 지난 기록은 subject별 event seq로 읽는다.
- **test 요청.** 자기 터미널 수리도 ticket→MCP claim을 거치고 → problems/tests의 `RequestTest`는 별도 요청으로 쓴다. ticket 전 baseline·근거 조사 테스트와 과거 기록 조회를 금지하지 않는다. 고친 기록 제출이 자동 test 실행이나 문제 상태 변경을 뜻하지 않는다.
