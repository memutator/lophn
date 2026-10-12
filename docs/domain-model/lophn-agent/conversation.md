---
type: domain-model
concerns: [lophn-agent/conversation]
---
# lophn-agent/conversation

Session(agent·자리 고정, 제목, archive, 복사, 요약)과 Message, 입력의 담당 run과 최초 반영 연결을 정의한다.

## Session (`ses`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `ses` ID | 아니오 | PK | 세션 |
| `assignment` | `asg` ID | 아니오 | 불변; → lophn-agent/assignments | 상대 agent(assignment) |
| `work_place` | WorkPlace | 아니오 | 불변; OpenSession에서 확정; AE/Operator는 assignment 범위와 같음 | 고정 자리 |
| `title` | string | 예 | 비어 있거나 공백뿐인 글 금지; 자동 제목은 60자, rename은 120자 이하; redaction을 거친 글 | 제목 |
| `archived` | boolean | 아니오 | 초기 `false` | 기본 목록에서 숨김 |
| `state` | `open / closed` | 아니오 | 초기 `open` | 새 입력 접수 가능 여부 |
| `forked_from` | ForkOrigin | 예 | 같은 assignment; 불변; FK 아님 | Fork 출처 |
| `opening_context` | OpeningContext | 예 | 불변; OpenSession에서만 설정 | toast에서 연 첫 context |
| `model_selection` | ModelChoice | 예 | null이면 agent 기본값을 따름 | 이 session의 model·option |
| `compaction` | Compaction | 예 | 없으면 null; Compact마다 새 값으로 교체 | 사람이 부른 요약의 마지막 구간 |
| `closed_reason` | `assignment_withdrawn` | 예 | `closed`일 때만 필수 | 닫힘 이유 |
| `closed_at` | 시각 | 예 | `closed`일 때만 필수 | 닫힘 확정 시각 |

### 상태

| 상태 | 뜻 |
|---|---|
| `open` | 새 사람 입력을 받음(assignment가 enabled인 동안) |
| `closed` | 원문은 읽을 수 있고 새 입력은 받지 않음 |

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | `open` | user | assignment enabled; paused·withdrawn 거절; 자리가 role 규칙에 맞는 active project/app | `SessionOpened` |
| 없음 | `open` | user | Fork: 같은 assignment enabled; 출처 세션에 미종료 run 없음 | `SessionForked` |
| `open` | `closed` | machine | assignment withdrawn; 미종료 run과 대기 요청 정리 완료 | `SessionClosed` |
| 있음 | 없음 | user | 미종료 run 없음; 복구 불가 | `SessionDeleted` |

`archived`, `title`, `model_selection`, `compaction`은 `state`와 별개로 바뀐다(아래 command).

### 불변 조건

- `assignment`와 `work_place`는 바뀌지 않는다. role을 바꾸는 command가 없다. 같은 assignment·같은 자리의 세션은 여러 개일 수 있다.
- 닫힌 세션은 다시 열지 않는다. 사람이 세션을 치우는 길은 archive와 delete다(사람이 `closed`로 만드는 command는 없다).
- archive는 목록 표시만 바꾼다. 메시지·run·진행 중 일·입력 접수에 영향이 없다. 풀면 기본 목록으로 돌아온다.
- 세션에는 자동 만료와 열린 세션 수 상한이 없다.
- 화면 닫기, 자정, 연결 끊김, 재시작, assignment의 `paused`는 세션을 닫지 않는다. `paused`인 동안 세션은 읽기만 되고 새 사람 입력은 거절한다.
- `title`은 첫 사람 `request` 메시지를 접수하는 transaction에서 `title`이 null일 때만 그 본문의 앞 60자(글자 기준, 줄바꿈은 공백으로)로 정한다. rename한 제목은 다시 정하지 않는다. 번호 이름은 만들지 않는다.
- 세션 없는 run에 세션을 자동 생성하지 않는다. Lophn Workspace에는 세션이 없다.

## WorkPlace (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `kind` | `project / app` | 아니오 | 실제 개설 자리; file cwd 아님; `global` 없음 | 자리 종류 |
| `id` | Project 또는 App ID | 아니오 | active 대상 참조 | 작업 대상 |

App Engineer는 Assignment.scope app, Operator는 scope의 project/app으로 고정한다. lophn은 연 project 또는 app, Context Engineer는 연 project(app은 거절)로 OpenSession의 shell 개설 자리에서 시작한다. app의 project 관계는 owner contract로 resolve한다. 탭·초점·TurnContext·handoff는 이 값을 바꾸지 않고, 자리를 바꾸는 command는 없다.

## ForkOrigin (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `session` | `ses` ID | 아니오 | 같은 assignment; 자기 자신 금지; FK 아님 | 출처 세션 |
| `through_seq` | seq | 아니오 | 출처 세션의 확정 메시지 생성 seq; → platform/ledger | 마지막 복사 지점 |

출처 세션을 delete해도 복사본은 남고 출처 부재만 표시한다. 다른 세션으로 대체하지 않는다.

## OpeningContext (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `source_seq` | event seq | 아니오 | notification의 원래 event; → platform/notifications, platform/ledger | toast를 만든 사건 |
| `target` | 대상 참조 | 아니오 | 사건이 가리키는 소유 concern의 ID | 첫 context 대상 |

사건 글을 복사하지 않고 참조만 둔다. 내용은 읽는 때 소유 concern에서 가져오는 자료이며 지시가 아니다. 어떤 사건이 `OpeningContext`를 만드는지는 → platform/notifications의 `ask_agent` 계기 표.

## SessionModel (값)

이 session의 model 선택은 → lophn-agent/harness/model의 **ModelChoice**(`provider`(`pvd`), `model_name`, `option_values` — 그 model이 가진 축과 값만, 빈 객체 허용) 그대로다. 따로 모양을 두지 않는다.

null은 agent 기본값을 따른다. 이 값은 Run 시작 때 resolve해 RunBasis에 고정한다. 진행 중 run에는 영향이 없다.

## Compaction (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `through_seq` | seq | 아니오 | 이 세션의 확정 메시지 생성 seq | 요약에 포함한 마지막 지점 |
| `summary_call` | `mcl` ID | 아니오 | 완전 성공한 organizing 요약 call; → lophn-agent/harness/usage | 실제 요약 call |

요약 본문은 derived이고 원문을 대체하지 않는다. 구조와 생성은 → lophn-agent/harness/prompt-assemble의 SummaryRef.

## Message (`msg`)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `id` | `msg` ID | 아니오 | PK; 접수 idempotency key | 확정 발언 |
| `session` | `ses` ID | 아니오 | FK; 사람 입력은 `open` 세션만 | 세션 |
| `actor` | actor | 아니오 | → platform/identity; 본문과 함께 불변 | 실제 발언자 |
| `body` | sha256 | 아니오 | 불변; redaction을 거친 MessageContent blob; 기존 text blob도 읽음; → platform/blob-store, platform/redaction | 확정 본문·블록 |
| `run` | `run` ID | 예 | 있으면 같은 세션·assignment; Fork로 복사한 메시지는 null; → lophn-agent/harness/run-loop | 담당 또는 답을 만든 run |
| `mode` | `request / correction` | 예 | 접수한 user 입력에 필수; agent·machine 발언과 Fork 복사본에는 null | 새 일 / steering |
| `applied_at_call` | `mcl` ID | 예 | 최초 한 번만 설정; 같은 담당 run; → lophn-agent/harness/usage | 이 입력을 처음 포함한 call |
<<<<<<< HEAD
| `links` | 대상 참조 배열 | 아니오 | 기본 `[]`; 실제 존재하는 대상만; 계획은 생성 링크가 아님 | 문서·version·질문·approval request·call 연결 |
| `copied_from` | `msg` ID | 예 | Fork 복사본에만; 불변; FK 아님 | 복사한 원래 메시지 |
=======
| `links` | 대상 참조 배열 | 아니오 | 기본 `[]`; 실제 존재하는 대상만; 계획은 생성 링크가 아님 | 문서·version·context·질문·approval request·call 연결 |
>>>>>>> origin/main

### 상태

| 전 | 후 | actor | 조건 | event |
|---|---|---|---|---|
| 없음 | 확정 메시지 | user | enabled만; 본문 blob 및 담당 run 접수와 같은 transaction; paused·withdrawn 거절 | `MessageReceived` |
| 없음 | 확정 메시지 | machine | Fork와 같은 transaction; 출처의 확정 메시지를 `through_seq`까지 같은 순서로 복사(같은 actor·본문·links); run·반영 연결 없음 | `SessionForked` |
| 없음 | 확정 메시지 | agent / machine | 확정 본문; 스트리밍 조각 아님 | `MessageRecorded` |
| 미반영 | 최초 반영 연결 있음 | machine | 입력을 포함하는 ModelCall 시작과 같은 transaction | `MessageApplied` |
| 미반영·담당 미확정 또는 이전 담당 | 새 담당 run | machine | 종료 경계 또는 질문 취소; 하나의 담당만 확정 | `MessageAssigned` |

### 불변 조건

- 작성·스트리밍 상태는 저장하지 않는다. 본문·actor·세션·mode는 덮어쓰지 않으며 정정은 새 메시지다.
- 같은 ID와 같은 접수 내용은 기존 결과를 반환하고 다른 내용이면 `conflict`다.
- 입력 접수와 모델 반영은 별개다. 반영은 run의 성공을 뜻하지 않는다.
- 일반 메시지는 질문 답·승인·멈춤이 아니다. 결정은 → lophn-agent/questions, platform/approvals.
- 생성 event seq가 발언 순서다. steering은 그 순서로 다음 model call에 모두 반영한다.
- enabled의 다음 일은 `request`이며 독립 `accepted` run으로 접수한다. `start_after`와 시작 정책은 → lophn-agent/harness/run-loop.
- enabled의 종료 경계 입력은 현재 run 또는 새 run 중 정확히 하나에 남긴다. 종료 뒤 접수한 원문을 버리지 않는다.
- Fork 복사본은 지난 발언이다. 미반영 입력으로 세지 않고 새 run이나 correction의 대상이 되지 않는다.

## MessageContent (값)

| 필드 | 타입 | null | 제약 | 뜻 |
|---|---|---|---|---|
| `schema_version` | integer | 아니오 | 첫 판 `1` | 본문 판 |
| `parts` | MessagePart 배열 | 아니오 | 순서 불변; 하나 이상 | 글·시각 블록 순서 |

요청은 본문을 hash가 아니라 값으로 싣는다. core가 값을 redaction해 정규 직렬화 bytes의 blob으로 준비하고 command가 같은 transaction에서 그 blob의 영구 참조를 등록한다. `body`는 그 blob의 hash다. 정규 직렬화 상한은 사람·machine 64KiB, agent 240KiB다. 확정 메시지 하나의 본문은 사람·그 assignment의 agent·machine만 읽고(`ReadMessageBody`), 그 밖은 없는 메시지와 같다.

MessagePart는 `{kind: text, text: string}` 또는 `{kind: visual, block: VisualBlock}`의 tagged 값이다. VisualBlock은 → lophn-agent/visuals가 정의한다. legacy text blob은 text part 하나로 읽는다. 사람 입력은 text만, agent 답은 text·visual, machine 확인은 text만 허용한다. `RecordMessage`는 한 번의 저장에서 모든 part와 출처·상한을 검사하며 부분 저장하지 않는다. 시각 블록 key는 Message 안에서 unique다. `links`에는 실제 문서·call 참조를 유지하며 블록 계획을 문서 생성 링크로 넣지 않는다. 앱 카드 view의 현재 표시 상태는 derived이며 원래 MessageContent를 바꾸지 않는다. context 링크(`{kind: context, context}`)는 `ContextCreated`가 있는 context만 가리키고, 답 메시지에는 그 run이 `context.create`로 만들었거나 `context.read_contract`로 계약을 읽은 context를 건다. 목록·검색 결과의 context는 링크가 아니다.

## 관계

| from | 관계 | to | 다중도 | 대상이 사라지면 |
|---|---|---|---|---|
| Session | 상대 | → lophn-agent/assignments | N:1 | withdrawn이면 미종료 run 정리 뒤 닫음; 참조 유지 |
| Session | Fork 출처 | Session | N:0..1 | 원문 부재 표시; 다른 세션으로 대체 안 함 |
| Session | 첫 context | → platform/notifications의 원래 event와 대상 | N:0..1 | 고정 참조·원래 사실 유지; 대상이 사라지면 부재 표시 |
| Message | 세션 | Session | N:1 | Session을 delete하면 함께 지움 |
| Message | 담당 | → lophn-agent/harness/run-loop | N:0..1 | 감사 참조 유지(그 session이 delete되면 run도 함께 지움) |
| Message | 최초 반영 | → lophn-agent/harness/usage | N:0..1 | call 본문 부재와 반영 사실 구별 |

## ledger 표

| 표 | 담는 것 | 키 | unique | index | 참조 |
|---|---|---|---|---|---|
| `sessions` | Session 및 생성·최근 상태 seq | PK `id` | 없음 | `(assignment,work_place_kind,work_place_id,archived)`, `(assignment,state)` | `assignment` FK; `forked_from_session`은 FK 아님; DeleteSession만 행을 지운다 |
| `session_compact_requests` | Compact 요청 하나(요청 event seq, 세션, `requested`·`compacted`·`failed`, 실패 이유) | PK `request_seq` | 세션마다 `requested` 하나(partial) | 없음 | `session` FK; DeleteSession이 함께 지운다. 요청의 진행은 `sessions` 행(상태 seq)을 바꾸지 않는다 |
| `messages` | Message 및 생성 seq | PK `id` | `created_seq` | `(session,created_seq)`, `(run,created_seq)`, `(run,applied_at_call)` | `session` FK; `run` FK; `applied_at_call` FK; blob 참조 등록; `copied_from`은 FK 아님 |

## command

| command | actor | 입력 | 비교 기준 | event | 거절(error code) |
|---|---|---|---|---|---|
| `OpenSession` | user | ID, assignment, WorkPlace, opening_context? | assignment enabled·현재 revision; paused·withdrawn 거절; 자리가 role 규칙(AE=담당 app, Operator=scope, lophn=project/app, CE=project)에 맞고 active; opening_context의 event 존재 | `SessionOpened` | `invalid_input`, `forbidden`, `not_found`, `conflict` |
| `RenameSession` | user | 세션, 제목 글, 상태 seq | 세션 존재(open·closed·archived 무관); 공백뿐인 글·120자 초과 거절 | `SessionRenamed` | `invalid_input`, `not_found`, `conflict` |
| `ArchiveSession` | user | 세션, 상태 seq | 세션 존재; 이미 archived면 기존 결과 | `SessionArchived` | `not_found`, `conflict` |
| `UnarchiveSession` | user | 세션, 상태 seq | 세션 존재; 이미 풀렸으면 기존 결과 | `SessionUnarchived` | `not_found`, `conflict` |
| `DeleteSession` | user | 세션, 상태 seq | 세션 존재; 진행 중·대기 중 run 없음; 같은 transaction에서 메시지·그 세션의 run 기록·질문·approval request를 지움; 문서·앱 변경은 지우지 않음 | `SessionDeleted` | `not_found`, `conflict`, `forbidden` |
| `ForkSession` | user | 새 세션 ID, 출처 세션, through_seq | 출처 세션 존재·같은 assignment enabled; 미종료 run 없음; through_seq는 출처의 확정 메시지 seq; ID 내용 일치 | `SessionForked` | `invalid_input`, `not_found`, `conflict`, `forbidden` |
| `RequestSessionCompact` | user | 세션, 상태 seq | 세션 open·미종료 run 없음; 이미 덮은 구간 뒤에 확정 메시지가 있음; 끝나지 않은 요청이 있으면 그 요청 | `SessionCompactRequested` | `conflict`, `forbidden`, `not_found` |
| `CompactSession` | machine | 세션, 요약 call, 덮는 마지막 메시지 seq, 열린 요청 seq | 세션 open·미종료 run 없음; 열린 요청 하나; 이 세션에 묶인(run 없는) 요청 뒤에 시작한 완전 성공 organizing 요약 call; Model for summaries가 있으면 그 model; 구간 끝은 세션의 확정 메시지이고 앞서 덮은 구간 뒤 | `SessionCompacted` | `conflict`, `forbidden`, `invalid_input`, `not_found`, `unavailable` |
| `FailSessionCompact` | machine | 세션, 이유(`nothing_to_summarize`·`model_unavailable`·`model_failed`·`too_large`·`summary_too_long`·`session_changed`), 열린 요청 seq | 열린 요청 하나; 세션·원문·상태 seq는 바꾸지 않음 | `SessionCompactFailed` | `conflict`, `forbidden`, `not_found` |
| `ChangeSessionModel` | user | 세션, ModelChoice 또는 null, 상태 seq | 세션 open; catalog에 있는 model과 그 model의 option 값만; null은 기본값으로 돌아감 | `SessionModelChanged` | `invalid_input`, `not_found`, `conflict` |
| `CloseSession` | machine | 세션, 이유 | 예상 `open`, 상태 seq; assignment withdrawn; 미종료 run 없음 | `SessionClosed` | `conflict`, `forbidden` |
| `ReceiveMessage` | user | ID, 세션, 본문 값(MessageContent 글 part), mode, 대상 run? | 세션 open·상태 seq; assignment enabled·revision; correction은 같은 세션의 담당 run 검사 및 종료 경계 정책; ID 내용 일치; 첫 request면 title 자동 설정 | `MessageReceived`; run 접수는 → lophn-agent/harness/run-loop | `invalid_input`, `conflict`, `forbidden` |
| `RecordMessage` | agent / machine | ID, 세션, run?, 본문 값(MessageContent), links | run·세션 연결; ID 내용 일치 | `MessageRecorded` | `invalid_input`, `conflict`, `forbidden` |
| `ApplyMessages` | machine | 메시지 ID 목록, call | 모두 미반영; call 시작 transaction | `MessageApplied` | `conflict` |
| `AssignMessage` | machine | 메시지, 새 run | 미반영, 이전 담당 run 및 상태 seq | `MessageAssigned` | `conflict`, `invalid_input` |

Compact는 세 걸음이다. 사람이 요청하고(`RequestSessionCompact`), agent runtime이 끝나지 않은 run이 없는 세션의 열린 요청을 읽어(`ListSessionCompactRequests`) 앞 구간(앞서 덮은 구간의 요약과 그 뒤 확정 메시지)을 prompt-assemble의 요약 규칙으로 요약하는 model call을 한 뒤(Workspace의 Model for summaries, 비면 그 세션 agent의 model; run과 agent 대신 세션에 묶인 call이라 run이 한 번도 없는 세션도 요약한다), 끝까지 성공한 call을 `CompactSession`으로 잇거나 `FailSessionCompact`로 요청만 닫는다. 요약 본문은 그 call의 출력 blob이고 `ReadSessionSummary`가 읽는다. 끝나지 않은 run이 있을 때 부른 `/compact`는 commands의 줄이 그 run이 끝난 뒤 한 번 요청한다.

세션 목록은 read다: 입력 `(assignment, work_place)`(필수)와 `archived` 거름. 제목 검색은 목록 결과에서 제목만 대상으로 한다(메시지 본문을 읽지 않는다).

## event

| event | subject | payload | 구독(concern) |
|---|---|---|---|
| `SessionOpened` | 세션 | assignment, work_place, opening_context? | shell/desktop |
| `SessionRenamed` | 세션 | 전후 제목 | shell/desktop |
| `SessionArchived` / `SessionUnarchived` | 세션 | 없음 | shell/desktop |
| `SessionDeleted` | 세션 | assignment, deleted_at(지운 내용은 싣지 않는다) | shell/desktop |
| `SessionForked` | 새 세션 | 출처 세션, through_seq, 복사한 메시지 수 | shell/desktop |
| `SessionCompactRequested` | 세션 | 없음(event seq가 요청 이름) | shell/desktop |
| `SessionCompacted` | 세션 | 전후 Compaction | lophn-agent/harness/prompt-assemble, shell/desktop |
| `SessionCompactFailed` | 세션 | 요청 seq, 이유 | shell/desktop |
| `SessionModelChanged` | 세션 | 전후 ModelChoice | shell/desktop |
| `SessionClosed` | 세션 | 이유, closed_at | shell/desktop, lophn-agent/harness/prompt-assemble |
| `MessageReceived` | 메시지 | 세션, 담당 run, mode, body | lophn-agent/harness/run-loop, shell/desktop |
| `MessageRecorded` | 메시지 | 세션, run?, body, links | shell/desktop |
| `MessageApplied` | 메시지 | call | shell/desktop |
| `MessageAssigned` | 메시지 | 이전 run?, 새 run | lophn-agent/harness/run-loop, shell/desktop |

## 정책

- **고정.** 세션은 agent 하나와 자리 하나에 고정된다. 다른 agent나 다른 자리의 일은 새 세션이다. role이나 자리를 바꾸는 command가 없고, 세션 사이로 메시지·요약이 자동으로 넘어가지 않는다. Fork와 Compact만 명시적으로 쓴다.
- **제목·목록.** 제목은 첫 사람 request에서 한 번 정하고 이후엔 사람의 rename만 바꾼다. 목록은 agent·자리별이며 archived는 기본에서 뺀다. 검색은 제목만 본다.
- **archive와 delete.** archive는 표시만 바꾼다. delete는 되돌릴 수 없다. 세션·메시지·그 세션 run의 호출·tool·사용량·trace·질문·approval request·rewind 기록을 지우고, 그 run이 만든 문서·release·앱 data 변경은 지우지 않는다. 지운 사실의 최소 기록(`SessionDeleted`)만 남는다. 실제 지움과 blob 정리 방식은 → platform/ledger, platform/blob-store.
- **Fork.** 사람이 고른 지점까지의 확정 메시지를 새 세션에 복사한다(새 ID, 같은 actor·본문 blob·links, run·반영 연결 없음). 새 세션은 출처의 assignment·work_place·title·opening_context·model_selection을 이어받고 `compaction`은 이어받지 않는다. run·질문·approval request·진행 일·이미 생긴 효과는 복사하지 않는다. 복사한 메시지의 blob 참조는 새 메시지가 따로 등록한다.
- **Compact.** 사람이 부를 때만 한다. 요약 방법·길이·실패 처리는 → lophn-agent/harness/prompt-assemble. 성공하면 `compaction`이 마지막 구간으로 바뀌어 이후 call의 조립이 그 구간 앞 원문 대신 요약을 쓴다. 원문 메시지는 남는다. 실패는 세션을 바꾸지 않는다.
- **model 선택.** `model_selection`은 세션에만 있다. agent 기본값·다른 세션을 바꾸지 않는다. 다음 StartRun이 resolve해 RunBasis에 고정하고, 진행 중 run은 영향을 받지 않는다. 유효한 model·option, 지원 안 되는 값의 처리는 → lophn-agent/harness/model.
- **첫 context.** `opening_context`는 OpenSession에서만 정한다. 사건 글을 복사하지 않고 참조를 두며, 읽는 내용은 자료로 취급한다. → lophn-agent/harness/safety
- **접수.** enabled는 Message 및 담당 run 저장 commit 뒤에 접수 완료를 반환한다. paused·withdrawn은 새 입력을 거절한다. archived 여부는 접수에 영향이 없다.
- **작업 자리.** AE/Operator는 assignment 담당 범위로 고정하고 lophn/CE는 열 때 고른 자리로 고정한다. 매 call 준비 직전에 현재 자리와 지침 판을 함께 snapshot하여 ContextBasis에 기록한다. 지침 편집은 다음 call부터, 과거 call 근거는 불변이다. 세션 없는 run(handoff 수신)은 Assignment.scope를 쓴다. → lophn-agent/instructions
- **명령과 화면.** `/` 명령의 Rename·Archive·Fork·Compact는 위 command를 그대로 부른다. 명령 목록과 진행 중 실행 가능 여부는 → lophn-agent/commands.
