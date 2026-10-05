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
| `work_place` | WorkPlace | 아니오 | OpenSession에서 확정; AE/Operator는 assignment 범위와 같음 | 지침 선택 자리 |
| `work_place_revision` | 양의 정수 | 아니오 | 초기 1; 명시 변경마다 증가 | 자리 CAS |
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
| 없음 | `open` | user | assignment enabled 또는 paused; withdrawn 거절; 이어가기 출처가 같은 assignment | `SessionOpened` |
| `open` | `closed` | user / machine | 미종료 run과 대기 요청 정리 완료; 사람 종료 또는 assignment withdrawn | `SessionClosed` |

### 불변 조건

- `assignment`는 바뀌지 않는다. 같은 assignment의 열린 세션은 여러 개일 수 있다.
- 닫힌 세션은 다시 열지 않는다. 이어가기는 새 세션이며 원문 메시지와 approval request를 복제하지 않는다.
- 세션에는 `archived` 상태, 자동 만료, 열린 세션 수 상한이 없다.
- 화면 닫기, 자정, 연결 끊김, 재시작, assignment의 `paused`는 세션을 닫지 않는다.
- 세션 없는 주기 run에 세션을 자동 생성하지 않는다.

## WorkPlace (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `global / project / app` | 아니오 | 실제 개설 자리; file cwd 아님 | 자리 종류 |
| `id` | Project 또는 App ID | 예 | global이면 null; 나머지는 active 대상 참조 | 작업 대상 |

App Engineer는 Assignment.scope app, Operator는 project/app으로 고정한다. lophn·Context Engineer는 OpenSession의 shell 개설 자리로 시작하며 자리 없는 전역 화면은 global이다. app의 project 관계는 owner contract로 resolve한다. 이어가기 summary는 작업 자리를 상속하는 동작이 아니며 새 세션 개설 자리나 사람의 명시 선택을 쓴다. 탭·초점·TurnContext·handoff는 이 값을 바꾸지 않는다.

## Message (`msg`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `msg` ID | 아니오 | PK; 접수 idempotency key | 확정 발언 |
| `session` | `ses` ID | 아니오 | FK; 사람 입력은 `open` 세션만 | 세션 |
| `actor` | actor | 아니오 | → platform/identity; 본문과 함께 불변 | 실제 발언자 |
| `body` | sha256 | 아니오 | 불변; redaction을 거친 MessageContent blob; 기존 text blob도 읽음; → platform/blob-store, platform/redaction | 확정 본문·블록 |
| `run` | `run` ID | 예 | 있으면 같은 세션·assignment; paused에서 보존한 user request는 실행 선택 전 null; → lophn-agent/harness/run-loop | 담당 또는 답을 만든 run |
| `mode` | `request / correction` | 예 | user 입력에 필수; agent·machine 발언에는 null | 새 일 / steering |
| `applied_at_call` | `mcl` ID | 예 | 최초 한 번만 설정; 같은 담당 run; → lophn-agent/harness/usage | 이 입력을 처음 포함한 call |
| `links` | 대상 참조 배열 | 아니오 | 기본 `[]`; 실제 존재하는 대상만; 계획은 생성 링크가 아님 | 문서·version·질문·approval request·call 연결 |

### 상태

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | 확정 메시지 | user | enabled는 본문 blob 및 담당 run 접수와 같은 transaction; paused request는 run=null 원문만 저장; withdrawn 거절 | `MessageReceived` |
| 없음 | 확정 메시지 | agent / machine | 확정 본문; 스트리밍 조각 아님 | `MessageRecorded` |
| 미반영 | 최초 반영 연결 있음 | machine | 입력을 포함하는 ModelCall 시작과 같은 transaction | `MessageApplied` |
| 미반영·담당 미확정 또는 이전 담당 | 새 담당 run | machine | 종료 경계·질문 취소 또는 사람이 보존한 요청 실행 선택; 하나의 담당만 확정 | `MessageAssigned` |

### 불변 조건

- 작성·스트리밍 상태는 저장하지 않는다. 본문·actor·세션·mode는 덮어쓰지 않으며 정정은 새 메시지다.
- 같은 ID와 같은 접수 내용은 기존 결과를 반환하고 다른 내용이면 `conflict`다.
- 입력 접수와 모델 반영은 별개다. 반영은 run의 성공을 뜻하지 않는다.
- 일반 메시지는 질문 답·승인·멈춤이 아니다. 결정은 → lophn-agent/questions, platform/approvals.
- 생성 event seq가 발언 순서다. steering은 그 순서로 다음 model call에 모두 반영한다.
- enabled의 다음 일은 `request`이며 독립 `accepted` run으로 접수한다. paused의 request는 담당 run 없이 보존하며 재개만으로 접수하지 않는다. `start_after`와 시작 정책은 → lophn-agent/harness/run-loop.
- enabled의 종료 경계 입력은 현재 run 또는 새 run 중 정확히 하나에 남긴다. paused로 바뀌었으면 request를 run 없이 보존하고 correction은 접수 완료로 표시하지 않는다. 종료 뒤 접수한 원문을 버리지 않는다.

## MessageContent (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `schema_version` | integer | 아니오 | 첫 판 `1` | 본문 판 |
| `parts` | MessagePart 배열 | 아니오 | 순서 불변; 하나 이상 | 글·시각 블록 순서 |

요청은 본문을 hash가 아니라 값으로 싣는다. core가 값을 redaction해 정규 직렬화 bytes의 blob으로 준비하고 command가 같은 transaction에서 그 blob의 영구 참조를 등록한다. `body`는 그 blob의 hash다. 정규 직렬화 상한은 사람·machine 64KiB, agent 240KiB다. 확정 메시지 하나의 본문은 사람·그 assignment의 agent·machine만 읽고(`ReadMessageBody`), 그 밖은 없는 메시지와 같다.

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
| `OpenSession` | user | ID, assignment, 개설 WorkPlace, continued_from? | assignment enabled/paused·현재 revision; withdrawn 거절·출처 seq | `SessionOpened` | `invalid_input`, `forbidden`, `not_found`, `conflict` |
| `ChangeSessionWorkPlace` | user | 세션, 새 WorkPlace | 세션 open·work_place_revision CAS·대상 active; lophn/CE만; 다음 call 적용 | `SessionWorkPlaceChanged` | invalid_input, conflict, forbidden, not_found |
| `CloseSession` | user / machine | 세션, 이유 | 예상 `open`, 상태 seq; 미종료 run 없음 | `SessionClosed` | `conflict`, `forbidden` |
| `ReceiveMessage` | user | ID, 세션, 본문 값(MessageContent 글 part), mode, 대상 run? | 세션 open·상태 seq; assignment 현재 상태·revision; correction은 enabled·같은 세션의 담당 run 검사 및 종료 경계 정책; ID 내용 일치 | `MessageReceived`; enabled run 접수는 → lophn-agent/harness/run-loop; paused request는 run=null | `invalid_input`, `conflict`, `forbidden` |
| `RecordMessage` | agent / machine | ID, 세션, run?, 본문 값(MessageContent), links | run·세션 연결; ID 내용 일치 | `MessageRecorded` | `invalid_input`, `conflict`, `forbidden` |
| `ApplyMessages` | machine | 메시지 ID 목록, call | 모두 미반영; call 시작 transaction | `MessageApplied` | `conflict` |
| `AssignMessage` | machine | 메시지, 새 run | 미반영, 이전 담당 run 및 상태 seq; run 없는 보존 request는 ExecuteStoredRequest의 사람 선택 필요 | `MessageAssigned` | `conflict`, `invalid_input` |
| `ExecuteStoredRequest` | user | 보존 message ID, 예상 assignment revision | 현재 enabled·세션 open·user request·run/applied_at_call null; 중복은 같은 담당 결과 | `RunAccepted` 및 `MessageAssigned` 같은 transaction | `conflict`, `forbidden`, `invalid_input` |

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `SessionOpened` | 세션 | assignment, work_place, work_place_revision, continued_from? | shell/desktop |
| `SessionWorkPlaceChanged` | 세션 | 전후 work_place·revision | lophn-agent/harness/prompt-assemble, shell/desktop |
| `SessionClosed` | 세션 | 이유, closed_at | shell/desktop, lophn-agent/harness/prompt-assemble |
| `MessageReceived` | 메시지 | 세션, 담당 run, mode, body | lophn-agent/harness/run-loop, shell/desktop |
| `MessageRecorded` | 메시지 | 세션, run?, body, links | shell/desktop |
| `MessageApplied` | 메시지 | call | shell/desktop |
| `MessageAssigned` | 메시지 | 이전 run?, 새 run | lophn-agent/harness/run-loop, shell/desktop |

## 정책

- **이어가기.** summary 준비·선택은 → lophn-agent/harness/prompt-assemble. 세션 종료에 summary 성공을 요구하지 않는다.
- **접수.** enabled는 Message 및 담당 run 저장 commit 뒤에 접수 완료를 반환한다. paused request는 Message만 commit하고 보존·미실행임을 반환한다. withdrawn은 세션 정리 전에도 새 입력을 거절한다.
- **보존한 요청 실행.** ExecuteStoredRequest는 명시적인 사람 선택에만 AcceptRun과 AssignMessage를 함께 적용한다. 같은 원문을 복제하지 않고 새 run 출처는 그 message ID다. 현재 선행 run의 failed/stopped 확인 등 시작 정책은 → lophn-agent/harness/run-loop를 그대로 따르며 재개 event·재시작·일반 메시지로 자동 실행하지 않는다.

- **작업 자리.** AE/Operator는 assignment 담당 범위로 고정하고 lophn/CE는 Session 값으로 유지한다. 매 call 준비 직전에 현재 자리와 지침 판을 함께 snapshot하여 ContextBasis에 기록한다. 변경은 다음 call부터, 과거 call 근거는 불변이다. 세션 없는 Operator 회차는 Assignment.scope를 쓴다. → lophn-agent/instructions.
