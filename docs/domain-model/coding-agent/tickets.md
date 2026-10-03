---
type: domain-model
concerns: [coding-agent/tickets]
---
# coding-agent/tickets

Ticket의 불변 요구, acceptance check, claim, 완료 보고와 machine check를 정의한다.

## Ticket (`tkt`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `tkt` ID | 아니오 | PK, 불변 | |
| `app` | 앱 ID | 아니오 | → apps/registration; 생성 뒤 불변 | 대상 앱 하나 |
| `kind` | `implementation \| repair` | 아니오 | 생성 뒤 불변 | |
| `title` | string | 아니오 | 1~120자; 공백뿐인 문자열 금지; 불변 | 한 줄 제목 |
| `what` | string | 아니오 | 1~2,000자; 공백 금지; 불변 | 요구와 제외 범위 |
| `why` | string | 아니오 | 1~2,000자; 공백 금지; 불변 | 요구의 근거 |
| `references` | TicketReference[] | 아니오 | 1~20개; 중복 금지; 불변 | 기획·설계·해석의 고정 판과 이전 결과 |
| `adoption_questions` | 질문 ID[] | 아니오 | 1개 이상; 중복 금지; 불변; → lophn-agent/questions | 기획·설계 판을 채택한 답 |
| `conditions` | AcceptanceCheck[] | 아니오 | 1~12개; 불변; 0부터의 목록 위치가 조건 번호 | |
| `inspect` | string[] | 아니오 | 0~20개; 공백 항목 금지; 불변 | 앱 source 상대 위치 또는 고정 근거 주소; 권한 아님 |
| `preserve` | string[] | 아니오 | 0~20개; 공백 항목 금지; 불변 | 유지할 제약; 조건의 통과 기준을 대체하지 않음 |
| `problems` | 문제 ID[] | 아니오 | `repair`는 같은 앱의 미해결 문제 1~12개; `implementation`은 빈 목록; 중복 금지; 불변; → problems/grouping | |
| `state` | `open \| claimed \| reported \| confirmed \| check_failed \| cancelled` | 아니오 | 생성은 `open` | |
| `claim` | TicketClaim | 예 | `claimed`일 때만 존재 | 현재 claim |
| `completion` | TicketCompletion | 예 | 최초 보고 전 null; 지난 완료 보고는 재claim·반납·취소에도 보존 | 최신 접수 보고 |
| `checks` | TicketCheckResult[] | 아니오 | 보고 전 빈 목록; 완료 보고당 조건 번호 중복 금지 | 최신 보고의 최신 조건별 결과 |
| `cancel_reason` | string | 예 | `cancelled`일 때 1~200자 한 줄; 다른 상태는 null | |
| `revision` | event seq | 아니오 | 마지막 ticket 변경 event seq | CAS 기준 |

### 상태

| 상태 | 뜻 |
|---|---|
| `open` | claim 없음 |
| `claimed` | 유효 기한을 가진 현재 connection의 claim |
| `reported` | 완료 보고 접수; 미확인 조건이 남을 수 있음 |
| `confirmed` | 모든 조건의 유효한 통과 근거 확인; 종료 |
| `check_failed` | 실제 조건 실패; 새 claim 가능 |
| `cancelled` | 취소; 종료 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `open` | `user` 또는 lophn·담당 App Engineer의 `agent` | 필수값·채택 판·조건·문제 독점 검사 통과 | `TicketCreated` |
| `open` / `check_failed` | `claimed` | 범위 안 `coding_agent` | 현재 revision 일치; claim 없음; 사람 지시 | `TicketClaimed` |
| `claimed` | `claimed` | 현재 `coding_agent` | connection·claim seq 일치; 기한 전 명시적 갱신 | `TicketClaimRenewed` |
| `claimed` | `open` | 현재 `coding_agent` 또는 `machine` | 반납, 만료 또는 connection 회수; 현재 claim 비교 | `TicketClaimReleased` |
| `claimed` | `reported` | 현재 `coding_agent` | 유효 claim; 같은 앱 release와 완료 보고 검사 | `TicketCompletionReported` |
| `reported` | `reported` | `machine` | 최신 보고 비교; 실패 없음; 하나 이상 미확인 | `TicketChecksRecorded` |
| `reported` | `confirmed` | `machine` | 모든 조건 통과; 최신 근거 비교 | `TicketChecksRecorded`, `TicketConfirmed` |
| `reported` | `check_failed` | `machine` | 하나 이상 실제 실패; 최신 근거 비교 | `TicketChecksRecorded`, `TicketCheckFailed` |
| `open` / `claimed` / `reported` / `check_failed` | `cancelled` | `user` 또는 revert 적용 `machine` | 사유·revision 일치; revert는 외부 claim·보고·결과가 한 번도 없을 때만 | `TicketCancelled` |

### 불변 조건

- 본문·근거·채택 질문·조건·대상 문제는 생성 뒤 불변이다. 수정·공개 상태나 command가 없다. 변경은 취소 후 이전 ticket 참조를 포함한 새 ticket이다.
- 사람 화면의 직접 생성은 → coding-agent/tickets#R26에 따라 열린 문제 하나의 repair 입력을 기존 근거에서 준비한다. 없는 재현 기준·채택 답·조건을 자동 생성하거나 생성 검사를 우회하지 않는다. 새 구현 요청·준비 근거 부족은 담당 App Engineer의 대화로 연결하며 UI용 별도 ticket 종류·생성 상태를 만들지 않는다.
- 기획·설계 reference의 판과 채택 질문의 답이 가리킨 판이 같아야 한다. `@version` 없는 최신 주소나 이전 판의 채택 답을 새 판에 붙이면 거절한다. 채택은 approval나 grant가 아니다.
- 구현에는 `app_test`와 실행 가능한 `test_command`가 각각 하나 이상 필요하다. 수리에는 `app_test`, 대상 문제 각각의 `reproduction_test`, `problems_closed`가 필요하다. 빈 조건을 자동 보충하지 않는다.
- 문제당 `confirmed`·`cancelled`가 아닌 repair ticket은 최대 하나다. ticket 생성만으로 문제를 `fixing`으로 바꾸지 않는다(→ problems/grouping).
- 현재 claim은 connection 하나다. connection당 동시 claim 수의 상한은 없다. 과거 claim·완료 보고·check는 event로 보존하며 별도 시도 entity를 두지 않는다.
- `confirmed`·`cancelled`는 다시 열지 않는다. 재발은 → problems/grouping이며 필요한 새 ticket이 이전 ticket을 참조한다.
- 모든 test check는 → problems/tests의 Verification ID만 참조한다. 실행 출력·종료값·test result 정본을 ticket에 복제하지 않는다.

## TicketReference (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `version \| problem \| ticket \| release` | 아니오 | enum | |
| `target` | 대상 ID | 아니오 | kind별 → documents/versions, problems/grouping, 이 파일, apps/releases | 생성 시 존재·읽기 scope 검사 |
| `address` | 고정 version 주소 | 예 | `version`일 때 필수; → documents/addressing | 입력 주소와 해석된 version ID 함께 보존 |
| `section` | string | 예 | `version`에서만 허용; 고정 판에 존재해야 함 | |

## AcceptanceCheck (값)

ID 없는 tagged union이다. 아래에서 해당 kind의 필드만 존재한다.

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `test_command \| app_test \| reproduction_test \| release_active \| problems_closed \| human_confirmation` | 아니오 | enum | |
| `executable` | string | 아니오 (`test_command`만) | 공백 금지; 격리 환경에서 허용된 실행 파일 | shell 문자열 해석 없음 |
| `argv` | string[] | 아니오 (`test_command`만) | 빈 목록 허용; 각 항목 그대로 전달 | |
| `cwd` | string | 아니오 (`test_command`만) | 앱 source 상대 위치; 절대 경로·루트 밖 `..`·외부 symlink 금지 | |
| `timeout_ms` | integer | 아니오 (`test_command`만) | 양의 정수; 해당 테스트의 명시적 제한 | |
| `expected_exit_code` | integer | 아니오 (`test_command`만) | 실제 exit code와 정확히 비교 | |
| `problem` | 문제 ID | 아니오 (`reproduction_test`만) | Ticket.problems의 항목; → problems/grouping | |
| `test_hash` | sha256 | 아니오 (`reproduction_test`만) | 고정 테스트·입력·기대값의 blob; → problems/tests, platform/blob-store | reproduction 기준 |

`app_test`는 보고 release의 bundle hash에 대한 필수 app test 통과, `release_active`는 현재 active release와 보고 release의 일치, `problems_closed`는 Ticket.problems 전부의 닫힘과 이번 보고의 고친 기록·release 연결을 뜻한다. `human_confirmation`은 reproduction test를 만들 수 없는 repair에서만 사람이 confirmation window에서 한 확인이며 라벨은 "내가 확인함"이고 Verification 통과가 아니다. 이 네 kind는 추가 필드가 없다. 재현의 유효성·문제 닫힘 기준은 → problems/tests, problems/closing이다.

## TicketClaim (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `connection` | `cac` ID | 아니오 | active connection; → coding-agent/connection | |
| `seq` | event seq | 아니오 | 이번 `TicketClaimed`의 seq; 갱신으로 바뀌지 않음 | 같은 connection의 재claim 구별 |
| `expires_at` | UTC 시각 | 아니오 | claim 또는 마지막 명시 갱신 시각 + claim 기간 | |

## TicketCompletion (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `seq` | event seq | 아니오 | 이번 `TicketCompletionReported`의 seq | 보고 식별; 별도 ID 없음 |
| `claim_seq` | event seq | 아니오 | 제출 당시의 현재 claim seq | |
| `release` | release ID | 아니오 | 같은 앱; `ticket_source.ticket = Ticket.id`, `ticket_source.claim_seq = claim_seq`; → apps/releases | |
| `summary_hash` | sha256 | 아니오 | 변경 내용·수행한 확인·미실행 확인·한계를 담은 blob; → platform/blob-store | |
| `outputs` | 고정 version 참조[] | 아니오 | 중복 금지; 빈 목록 허용; → documents/versions | 문서 산출물 |
| `fix_records` | event seq[] | 아니오 | `ProblemFixRecorded` 참조; repair는 대상 문제 각각의 고친 기록 필수; 해당 after release·ticket 일치; → problems/repairs | 별도 고친 기록 entity ID 없음 |
| `verifications` | `vrf` ID[] | 아니오 | 중복 금지; 실제 runner 기록만 참조; 빈 목록 허용; → problems/tests | 주장과 실제 결과 구별 |

## TicketCheckResult (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `completion_seq` | event seq | 아니오 | 현재 TicketCompletion.seq | |
| `condition` | integer | 아니오 | 0 이상, conditions 길이 미만 | 불변 조건 번호 |
| `result` | `pass \| fail \| inconclusive` | 아니오 | 실제 실패만 `fail`; 미실행·승인·운영 확인 대기는 `inconclusive` | |
| `reason` | string | 아니오 | pass가 아니면 공백 금지 | |
| `verification` | `vrf` ID | 예 | test kind에서 실행 결과가 있으면 필수; 보고 release의 app·bundle hash와 일치; `test_command`는 → problems/tests의 TicketTestLink가 ticket·condition 번호·고정 조건 hash·이번 completion_seq와 일치; `reproduction_test`는 해당 problem·고정 test_hash·보고 after release 일치; `human_confirmation`과 그 외 kind는 null | → problems/tests |
| `targets` | `{concern, id, revision, release?}[]` | 아니오 | activation·문제 상태 비교는 대상 ID·읽은 변경 seq 필수 | 비교한 실제 대상과 release; entity 정의는 대상 concern |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Ticket | 대상 | App → apps/registration | N:1 | archive는 참조 삭제 아님; 요청 허용은 대상 concern 검사 |
| Ticket | repair 대상 | Problem → problems/grouping | N:N | 종료 뒤에도 이력 보존 |
| Ticket | 채택 답·고정 근거 | Question → lophn-agent/questions, Version → documents/versions | N:N | 답·고정 판 참조 보존; 근거를 최신 판으로 바꾸지 않음 |
| TicketClaim | 현재 담당 | CodingAgentConnection → coding-agent/connection | N:1 | 회수 시 claim 해제 |
| TicketCompletion | 산출물·고친 기록·실제 테스트 | Release → apps/releases, FixRecord → problems/repairs, Verification → problems/tests | N:N | 취소·만료로 삭제하지 않음 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `tickets` | entity 단일값, `inspect, preserve` JSON; `completion_seq` | PK `id` | 없음 | `(app, state, id)`, `(state, id)`, `(completion_seq)` | app → apps/registration; revision·completion_seq → platform/ledger event seq |
| `ticket_references` | TicketReference, `position` | PK `(ticket, position)` | `(ticket, kind, target, address, section)` 논리 중복 금지 | `(kind, target, ticket)` | ticket → `tickets.id`; kind별 대상 concern 참조 검사 |
| `ticket_adoption_questions` | 채택 질문·순서 | PK `(ticket, position)` | `(ticket, question)` | `(question, ticket)` | ticket → `tickets.id`; question → lophn-agent/questions |
| `ticket_conditions` | kind별 입력 JSON, 조건 번호 `position` | PK `(ticket, position)` | 없음 | PK | ticket → `tickets.id`; test_hash → platform/blob-store; problem → problems/grouping |
| `ticket_problems` | 불변 문제 목록, `position` | PK `(ticket, position)` | `(ticket, problem)` | `(problem, ticket)` | ticket → `tickets.id`; problem → problems/grouping |
| `ticket_open_repair_problems` | 종료 전 repair ticket의 독점 예약 | PK `problem` | `(ticket, problem)` | `(ticket)` | `(ticket, problem)` → `ticket_problems`; confirmed·cancelled 때 예약 행 제거; 역사 행 보존 |
| `ticket_claims` | 현재 TicketClaim | PK `ticket` | `seq` | `(connection, ticket)`, `(expires_at, ticket)` | ticket → `tickets.id`; connection → coding-agent/connection; seq → platform/ledger event seq |
| `ticket_completions` | TicketCompletion; outputs·fix_records·verifications는 참조 목록 JSON | PK `(ticket, seq)` | `seq` | `(release, ticket)`, `(claim_seq)` | ticket → `tickets.id`; seq·claim_seq·fix_records → platform/ledger; release → apps/releases; outputs → documents/versions; verifications → problems/tests |
| `ticket_check_results` | 보고별 최신 TicketCheckResult | PK `(ticket, completion_seq, condition)` | 없음 | `(verification)`, `(ticket, completion_seq, result)` | `(ticket, completion_seq)` → `ticket_completions`; `(ticket, condition)` → `ticket_conditions(ticket, position)`; verification → problems/tests |

`position`은 0부터 연속이다. 생성·문제 예약은 한 transaction이며 문제당 열린 ticket 제약을 구독 지연과 무관하게 강제한다. 상태·현재 claim·완료 보고·check projection·event는 해당 command에서 함께 갱신한다. 과거 check 변경은 event로 남으며 과거 completion 행을 삭제하지 않는다. JSON 참조도 command에서 대상 존재·종류·scope를 검사한다.

## command

공통 idempotency key·event envelope·error는 → platform/ledger이다. 모든 command는 actor 범위와 현재 Run의 변경 허용 여부를 검사한다(→ platform/identity, lophn-agent/harness/run-loop).

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `ticket.create` | `user`, lophn·담당 App Engineer `agent` | 불변 필드 전부, idempotency key | 앱·고정 판·채택 답·조건 유효; 문제 revision과 열린 예약 없음 | `TicketCreated` | `invalid_input`, `forbidden`, `not_found`, `conflict` |
| `ticket.claim` | `coding_agent` | ticket, idempotency key | `base_revision`, state open/check_failed, active connection·scope | `TicketClaimed` | `unauthorized`, `forbidden`, `not_found`, `conflict` |
| `ticket.renew_claim` | 현재 `coding_agent` | ticket, claim_seq | `base_revision`, connection·claim_seq 일치, `now < expires_at` | `TicketClaimRenewed` | `unauthorized`, `forbidden`, `conflict` |
| `ticket.release_claim` | 현재 `coding_agent` | ticket, claim_seq | `base_revision`, 현재 유효 claim 일치 | `TicketClaimReleased` | `unauthorized`, `forbidden`, `conflict` |
| `ticket.expire_claim` | `machine` | ticket, claim_seq | 현재 claim 일치, `now >= expires_at` 또는 connection revoked | `TicketClaimReleased` | `conflict` |
| `ticket.report_completion` | 현재 `coding_agent` | ticket, claim_seq, 완료 보고 값(seq 제외) | `base_revision`, 유효 claim·release 출처·참조 일치 | `TicketCompletionReported` | `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `conflict` |
| `ticket.record_checks` | `machine` | ticket, completion_seq, 조건별 결과·Verification 참조·대상 revision | `base_revision`, state reported, 현재 completion_seq·release bundle hash·읽은 대상 revision 일치 | `TicketChecksRecorded`; 전부 pass면 `TicketConfirmed`, 실제 fail이면 `TicketCheckFailed` | `invalid_input`, `forbidden`, `conflict` |
| `ticket.cancel` | `user`, 허용된 revert의 `machine` | ticket, reason; revert 근거는 → lophn-agent/revert | `base_revision`, 종료 전; revert는 외부 claim·보고·결과 이력 없음 | `TicketCancelled` | `invalid_input`, `forbidden`, `conflict` |

release 준비 command는 → apps/releases에서 소유하며 ticket ID·현재 claim seq를 함께 받아 이 파일의 유효 claim 검사를 수행한다. 준비·읽기는 claim을 갱신하지 않는다.

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `TicketCreated` | `tkt` | 불변 필드 또는 큰 내용 blob; `app, kind, problems` | problems/grouping, coding-agent/guides |
| `TicketClaimed` | `tkt` | `app, problems, connection, claim_seq = event seq, expires_at` | problems/grouping, coding-agent/guides |
| `TicketClaimRenewed` | `tkt` | `connection, claim_seq, before_expires_at, expires_at` | coding-agent/guides |
| `TicketClaimReleased` | `tkt` | `app, problems, connection, claim_seq, reason: returned/expired/connection_revoked` | problems/grouping, coding-agent/guides |
| `TicketCompletionReported` | `tkt` | `app, problems, completion_seq = event seq, claim_seq, release, fix_records, summary_hash, outputs, verifications` | coding-agent/tickets, problems/grouping |
| `TicketChecksRecorded` | `tkt` | `completion_seq, checks` 또는 blob | coding-agent/guides |
| `TicketConfirmed` | `tkt` | `app, problems, completion_seq, release, fix_records` | problems/grouping, platform/notifications |
| `TicketCheckFailed` | `tkt` | `app, problems, completion_seq, release, fix_records, failed_conditions` | problems/grouping, platform/notifications |
| `TicketCancelled` | `tkt` | `app, problems, reason, released_claim?, completion_seq?, fix_records` | problems/grouping, coding-agent/guides |

## 정책

- **문자 계산.** 문자 상한은 Unicode code point, 줄 상한은 CRLF를 LF로 정규화한 logical line으로 센다. test_command 실행 파일 허용 목록은 소유 test 실행 spec이 정하며 임의 실행 권한을 추가하지 않는다(→ redesign/coding-agent#Q21).
- **claim 기간.** 기본 `3,600,000ms`이며 claim 생성·명시적 갱신 시점부터 계산한다. 읽기·repair-context·release 요청은 연장하지 않는다. 만료 정리는 60초마다와 재시작 때 하되 모든 쓰기도 즉시 기한을 검사한다.
- **claim 상실.** 만료·반납·취소 뒤 옛 claim 갱신·ticket 근거 release 준비·완료 보고를 거절한다. 같은 connection이 재claim해도 옛 seq는 `conflict`, 회수 credential은 `unauthorized`다.
- **사람 지시.** coding agent는 자기 터미널의 사람 지시 또는 [Start] 첫 prompt로 지정한 ticket만 MCP claim한다. 목록·시작 summary는 지시가 아니다. → coding-agent/sessions의 시작·상태 관측은 claim 생성·갱신·해제를 대신하지 않는다. claim 필드에 외부 session ID를 넣지 않는다. 같은 connection의 여러 session은 claim_seq로 현재 권리를 확인한다.
- **사람 화면.** 진행 정본은 이 파일의 여섯 상태다. → coding-agent/tickets#R27, shell/wording에 따라 영어 화면 말로 표현하고 claim 기한·연결 ID·전체 조건과 보고·test 원문은 기본에서 숨긴다. 화면 라벨을 별도 ledger 상태로 저장하지 않는다.
- **check 판정.** 전부 pass일 때만 confirmed다. 하나라도 실제 fail이면 check_failed, 그 외 미실행·승인·운영 대기는 reported다. 일반 shell log나 완료 주장의 통과 문자열은 machine test result가 아니다. `human_confirmation`의 pass는 "내가 확인함"이며 Verification을 만들지 않는다.
- **check 재접수.** 재시작 때 reported를 읽고 누락 check를 잇는다. `VerificationRecorded`, `ProblemClosed`, `ProblemReopened`, `ReleaseActivated`, `ReleaseSuperseded` 뒤 남은 조건을 재검사한다. model call은 없다.
- **문제 경계.** `TicketConfirmed`로 문제를 닫지 않는다. 문제 작업 상태·열린 ticket 참조는 → problems/grouping이 현재 ticket을 읽어 idempotent command로 적용하고, 닫힘은 → problems/closing에서 먼저 판정한다.
- **종료 보존.** 취소·만료는 release·문서·고친 기록·test result 삭제나 문제 닫힘이 아니다. claim은 source git lock이나 외부 프로세스 제어권이 아니다.
- **모든 coding 작업.** 직접 요청·피드백도 lophn·App Engineer가 검사 가능한 ticket으로 정리한다. code 작업은 MCP claim→작업→보고이며 ticket 없는 수리 fallback은 없다. 과거 고친 기록은 → problems/repairs의 근거로 보존한다. 근거 부족은 무생성·다음 결정 안내이고 취소 ticket을 직접 경로로 완료 처리하지 않는다. App Engineer의 ticket 생성과 사람의 ticket 취소는 확인 창을 열지 않는다.
- **사람 확인 acceptance.** reproduction test를 만들 수 없는 repair만 `human_confirmation`을 조건으로 둔다. 빈 reproduction을 만들어 넣지 않는다. 이 확인은 test 통과가 아니다.
- **activation 조건.** 실제 사용까지 맡긴 구현에만 `release_active`를 명시한다. 숨은 공통 기본값은 없다. activation approval는 → apps/releases, platform/approvals이다.

## 정할 것

없음.
