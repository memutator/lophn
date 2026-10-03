---
type: domain-model
concerns: [lophn-agent/conversation]
---
# lophn-agent/conversation

Session과 Message, 입력의 담당 run과 최초 반영 연결을 정의한다.

## Session (`ses`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `ses` ID | 아니오 | PK | 세션 |
| `assignment` | `asg` ID | 아니오 | 불변; → lophn-agent/assignments | 상대 assignment |
| `state` | `open / closed` | 아니오 | 초기 `open` | 새 입력 접수 가능 여부 |
| `continued_from` | Continuation | 예 | 같은 assignment의 세션; 자기 자신 금지 | 사람이 지정한 원문 구간 |
| `closed_reason` | `user_closed / assignment_withdrawn` | 예 | `closed`일 때만 필수 | 종료 이유 |
| `closed_at` | 시각 | 예 | `closed`일 때만 필수 | 종료 확정 시각 |

### 상태

| 상태 | 뜻 |
|---|---|
| `open` | 새 사람 입력을 받음 |
| `closed` | 원문은 읽을 수 있고 새 입력은 받지 않음 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `open` | user | assignment 유효; 이어가기 출처가 같은 assignment | `SessionOpened` |
| `open` | `closed` | user / machine | 미종료 run과 대기 요청 정리 완료; 사람 종료 또는 assignment withdrawn | `SessionClosed` |

### 불변 조건

- `assignment`는 바뀌지 않는다. 같은 assignment의 열린 세션은 여러 개일 수 있다.
- 닫힌 세션은 다시 열지 않는다. 이어가기는 새 세션이며 원문 메시지와 approval request를 복제하지 않는다.
- 세션에는 `archived` 상태, 자동 만료, 열린 세션 수 상한이 없다.
- 화면 닫기, 자정, 연결 끊김, 재시작, assignment의 `paused`는 세션을 닫지 않는다.
- 세션 없는 주기 run에 세션을 자동 생성하지 않는다.

## Message (`msg`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `msg` ID | 아니오 | PK; 접수 idempotency key | 확정 발언 |
| `session` | `ses` ID | 아니오 | FK; 사람 입력은 `open` 세션만 | 세션 |
| `actor` | actor | 아니오 | → platform/identity; 본문과 함께 불변 | 실제 발언자 |
| `body` | sha256 | 아니오 | 불변; redaction을 거친 MessageContent blob; 기존 text blob도 읽음; → platform/blob-store, platform/redaction | 확정 본문·블록 |
| `run` | `run` ID | 예 | 있으면 같은 세션·assignment; → lophn-agent/harness/run-loop | 담당 또는 답을 만든 run |
| `mode` | `request / correction` | 예 | user 입력에 필수; agent·machine 발언에는 null | 새 일 / steering |
| `applied_at_call` | `mcl` ID | 예 | 최초 한 번만 설정; 같은 담당 run; → lophn-agent/harness/usage | 이 입력을 처음 포함한 call |
| `links` | 대상 참조 배열 | 아니오 | 기본 `[]`; 실제 존재하는 대상만; 계획은 생성 링크가 아님 | 문서·version·질문·approval request·call 연결 |

### 상태

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | 확정 메시지 | user | 본문 blob 및 담당 run 접수와 같은 transaction | `MessageReceived` |
| 없음 | 확정 메시지 | agent / machine | 확정 본문; 스트리밍 조각 아님 | `MessageRecorded` |
| 미반영 | 최초 반영 연결 있음 | machine | 입력을 포함하는 ModelCall 시작과 같은 transaction | `MessageApplied` |
| 미반영·담당 미확정 또는 이전 담당 | 새 담당 run | machine | 종료 경계 또는 질문 취소; 하나의 담당만 확정 | `MessageAssigned` |

### 불변 조건

- 작성·스트리밍 상태는 저장하지 않는다. 본문·actor·세션·mode는 덮어쓰지 않으며 정정은 새 메시지다.
- 같은 ID와 같은 접수 내용은 기존 결과를 반환하고 다른 내용이면 `conflict`다.
- 입력 접수와 모델 반영은 별개다. 반영은 run의 성공을 뜻하지 않는다.
- 일반 메시지는 질문 답·승인·멈춤이 아니다. 결정은 → lophn-agent/questions, platform/approvals.
- 생성 event seq가 발언 순서다. steering은 그 순서로 다음 model call에 모두 반영한다.
- 다음 일은 `request`이며 독립 `accepted` run으로 접수한다. `start_after`와 시작 정책은 → lophn-agent/harness/run-loop.
- 종료 경계의 입력은 현재 run 또는 새 run 중 정확히 하나에 남긴다. 종료 뒤 입력을 버리지 않는다.

## MessageContent (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `schema_version` | integer | 아니오 | 첫 판 `1` | 본문 판 |
| `parts` | MessagePart 배열 | 아니오 | 순서 불변; 하나 이상 | 글·시각 블록 순서 |

MessagePart는 `{kind: text, text: string}` 또는 `{kind: visual, block: VisualBlock}`의 tagged 값이다. VisualBlock은 → lophn-agent/visuals가 정의한다. legacy text blob은 text part 하나로 읽는다. 사람 입력은 text만, agent 답은 text·visual, machine 확인은 text만 허용한다. `RecordMessage`는 한 번의 저장에서 모든 part와 출처·상한을 검사하며 부분 저장하지 않는다. 시각 블록 key는 Message 안에서 unique다. `links`에는 실제 문서·call 참조를 유지하며 블록 계획을 문서 생성 링크로 넣지 않는다. 앱 카드 view의 현재 표시 상태는 derived이며 원래 MessageContent를 바꾸지 않는다.

## Continuation (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `session` | `ses` ID | 아니오 | 같은 assignment; 자기 자신 금지 | 원문 세션 |
| `through_seq` | seq | 아니오 | 원문 세션의 확정 메시지 생성 seq; → platform/ledger | 마지막 포함 지점 |

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Session | 상대 | → lophn-agent/assignments | N:1 | withdrawn이면 미종료 run 정리 뒤 닫음; 참조 유지 |
| Session | 이어가기 출처 | Session | N:0..1 | 원문 부재 표시; 다른 세션으로 대체 안 함 |
| Message | 세션 | Session | N:1 | 기록을 연쇄 삭제하지 않음 |
| Message | 담당 | → lophn-agent/harness/run-loop | N:0..1 | 감사 참조 유지 |
| Message | 최초 반영 | → lophn-agent/harness/usage | N:0..1 | call 본문 부재와 반영 사실 구별 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `sessions` | Session 및 생성·최근 상태 seq | PK `id` | 없음 | `(assignment,state)`, `(continued_from_session,continued_from_through_seq)` | `assignment` FK; `continued_from_session` self FK; 삭제 RESTRICT |
| `messages` | Message 및 생성 seq | PK `id` | `created_seq` | `(session,created_seq)`, `(run,created_seq)`, `(run,applied_at_call)` | `session` FK; `run` FK; `applied_at_call` FK; blob 참조 등록 |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `OpenSession` | user | ID, assignment, continued_from? | assignment 현재 상태·출처 seq | `SessionOpened` | `invalid_input`, `forbidden`, `not_found`, `conflict` |
| `CloseSession` | user / machine | 세션, 이유 | 예상 `open`, 상태 seq; 미종료 run 없음 | `SessionClosed` | `conflict`, `forbidden` |
| `ReceiveMessage` | user | ID, 세션, 본문, mode, 대상 run? | 세션 상태 seq; run 상태; ID 내용 일치 | `MessageReceived`; run 접수는 → lophn-agent/harness/run-loop | `invalid_input`, `conflict`, `forbidden` |
| `RecordMessage` | agent / machine | ID, 세션, run?, 본문, links | run·세션 연결; ID 내용 일치 | `MessageRecorded` | `invalid_input`, `conflict`, `forbidden` |
| `ApplyMessages` | machine | 메시지 ID 목록, call | 모두 미반영; call 시작 transaction | `MessageApplied` | `conflict` |
| `AssignMessage` | machine | 메시지, 새 run | 미반영, 이전 담당 run 및 상태 seq | `MessageAssigned` | `conflict`, `invalid_input` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `SessionOpened` | 세션 | assignment, continued_from? | shell/desktop |
| `SessionClosed` | 세션 | 이유, closed_at | shell/desktop, lophn-agent/harness/prompt-assemble |
| `MessageReceived` | 메시지 | 세션, 담당 run, mode, body | lophn-agent/harness/run-loop, shell/desktop |
| `MessageRecorded` | 메시지 | 세션, run?, body, links | shell/desktop |
| `MessageApplied` | 메시지 | call | shell/desktop |
| `MessageAssigned` | 메시지 | 이전 run?, 새 run | lophn-agent/harness/run-loop, shell/desktop |

## 정책

- **이어가기.** summary 준비·선택은 → lophn-agent/harness/prompt-assemble. 세션 종료에 summary 성공을 요구하지 않는다.
- **접수.** Message 및 담당 run 저장 commit 뒤에만 접수 완료를 반환한다.
