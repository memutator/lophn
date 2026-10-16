# S1. event

상태: **확인됨** (2026-10-15). 설계는 `../architecture/event.md`(사람 확인)에서 왔고, 이 spec을 쓰며 사람과 다시 정한 것이 더해졌다(`../docs-review.md` "S1 event 핑퐁"). 이 spec이 확인되면 그 문서 대신 이것을 본다.

## 1. 범위

core 안에서 일어난 일을 다루는 길이다. 무엇이 영구로 남고, 무엇이 메모리로만 흐르고, 누가 무엇에 반응하는지, 화면(renderer)이 그것을 어떻게 받는지를 정한다. Gate와 grant의 판정은 S2(approval), call 봉투와 받는 곳 고르기는 S3(agent call), 앱 화면이 앱 data 바뀜을 다시 그리는 것은 S5, activation 흐름은 S7이 맡고, 여기는 접점만 적는다.

## 2. 원칙과 말

**원칙**
- 사람 화면에 가는 것은 자기 도메인(앱 화면)과 agent 결과를 추상화한 것(MVP에서는 대화)이다. agent끼리 만들고 읽는 것(ticket, claim, call의 진행)은 사람 화면의 대상이 아니다(`../../PRODUCT.md` 4절 축 2).
- domain event로 사람이 보는 화면을 갱신하지 않는다. domain event는 program이 이어 움직이기 위한 것이다.
- toast 같은 화면 반응은 renderer의 책임이다. core는 toast라는 개념을 모른다.

**말**

| 말 | 뜻 | 남나 |
|---|---|---|
| event | 아래 것들을 아우르는 말 | |
| domain event | lophn domain에서 일어나 program이 반드시 이어 움직여야 하는 일. Ledger에 남고 Reactor가 반응한다 | 남음 |
| agent event | session에서 일어나는 일(turn, tool call, 물음 등). 대화가 이 길로 흐른다 | 안 남음 |
| 남지 않는 event | session에 속하지 않고 화면만 알면 되는 일. 지금은 `ApprovalRequested`와 앱 view 다시 그리기(7장) | 안 남음 |

- core에 일반 change notification(어느 대상이 바뀌었다는 신호)을 두지 않는다. 받을 사람 화면이 없다. invalidation은 shell 안의 동작을 말할 때만 쓴다.

**domain event인지 가리는 법:** 그 일 뒤에 program이나 agent가 꼭 움직여야 하고, 꺼졌다 켜져도 그 움직임이 빠지면 안 될 때만 domain event다. 이력이나 감사, 화면 갱신을 위해 만들지 않는다.

## 3. 부품

```
            만드는 쪽                         core 안                                  받는 쪽
 ┌─────────────────────────┐
 │ run-loop (lophn agent)  │──agent event────────────┐
 │ harness adapter         │──agent event────────────┤
 │ command (domain 변경)    │──domain event(같은 tx)─▶ Ledger ──▶ Reactor ──▶ Gate(S2) ──▶ Router
 │                         │      └ commit 뒤 ───────┤
 │ Approvals(보류 request)  │──ApprovalRequested──────┴──▶ Bus(메모리) ──▶ Gateway ──▶ renderer
 └─────────────────────────┘                                                ▲
                                                                            └ 처음과 다시 붙을 때 snapshot 읽기
                     사람 메시지, agent call ──▶ Router (S3의 봉투를 붙여 session에 입력)
                                                   ├──▶ run-loop 입력함
                                                   └──▶ harness adapter → coding agent
```

| 부품 | 맡는 일 | 저장 | 지금 코드 |
|---|---|---|---|
| command 층 | domain을 바꾸는 command가 domain event를 domain 변경과 같은 transaction에 쓴다. commit 뒤 그 domain event를 Bus에도 낸다 | domain 표 | 있음. 지금은 domain마다 event type을 만들어 모든 변경을 ledger에 쓴다 |
| Ledger | domain event만 남는 append-only 표. 읽는 것은 Reactor뿐이다 | SQLite, 고칠 수 없음 | 있음 |
| Reactor | Ledger를 cursor로 이어 읽고 domain event 종류마다 handler를 부른다. handler는 평범한 코드다. idempotency key로 두 번 반응하지 않는다. agent를 부르는 handler는 intent를 만들어 Gate(S2)에 넣는다 | cursor, 처리 결과 | 있음(`reaction.ts`, cursor 표) |
| Bus | core 안 메모리 pub/sub. agent event, commit 뒤의 domain event, 남지 않는 event를 싣는다. topic을 미리 나누지 않고, 구독은 event의 칸(session, 종류)에 거는 조건이다 | 안 함 | 없음 |
| Router | "agent session에 입력을 넣는다" 한 입구. 봉투와 받는 곳 고르기는 S3. lophn agent면 run-loop 입력함으로, coding agent면 harness adapter로 넣는다 | 입력은 받는 session 기록에 | 일부(run 출처 `message`, `handoff`) |
| Run-loop | lophn agent를 돌리고 agent event를 Bus에 낸다. 대화 기록(message, tool call과 결과, compact 경계)은 session 기록에 쓴다 | session 기록 | 있음. 지금은 agent event를 ledger에 쓴다 |
| Harness adapter | harness마다 하나. coding agent를 띄우고, harness 신호를 agent event로 바꿔 Bus에 내고, Router 입력을 coding agent에 넣는다. 자세한 것은 S6 | 외부 session ID 연결만 | 일부 |
| Gateway | renderer의 WebSocket. 처음 붙을 때 read API로 snapshot을 읽게 하고, 그 뒤 renderer가 건 조건으로 Bus를 걸러 보낸다. 끊겼다 붙으면 다시 snapshot부터 | 안 함 | 있음(ledger 기반) |

**말 주의:** 코드의 `packages/core/storage/ledger`는 core DB 층 전체(domain 표, command 실행, read)의 이름이다. 이 spec의 Ledger는 그 안의 append-only event 표 하나를 말한다.

## 4. 봉투와 구독

| 메시지 | 칸 | 보장 |
|---|---|---|
| domain event | `seq`(전역), `type`, `subject`(대상 ID), `actor`, `at`, `payload` | Ledger 쪽은 영구. Reactor에 최소 한 번 + idempotent 처리 = 효과는 한 번. Bus 쪽은 메모리라 놓칠 수 있다 |
| agent event | `session`, `type`, `at`, `payload` | 메모리. 한 연결 안에서 순서대로. 놓치면 snapshot을 다시 읽는다. seq를 두지 않는다 |
| 남지 않는 event | `type`, `subject`, `at`, `payload` | 메모리. 놓쳐도 그 대상은 표에 남아 있으니 snapshot으로 맞춘다 |

- `type` 이름은 지금 코드의 규칙 `<Entity><과거형 동사>`를 따른다.
- **구독:** renderer는 "어느 session의, 어떤 종류"를 조건으로 건다. session ID를 몰라도 종류만으로 모든 session의 event를 받을 수 있다. 같은 event를 두 번 내지 않는다.
- **session snapshot:** 지금 상태(running, waiting, idle, unknown)와 대기 중인 권한 요청을 담는다.

## 5. domain event 목록

성격:
- **새 일**: agent에게 새 일을 연다. Settings의 reaction grant로 끄거나 묻게 할 수 있다(req-1494).
- **call 닫음**: 맡긴 call을 닫는다. 끌 수 없고 늘 맡긴 App Engineer에게 간다(req-1494).
- **program 일**: agent를 부르지 않고 program이 이어서 한다.

| domain event | 주인 | 언제 쓰나 | 성격 | 반응 |
|---|---|---|---|---|
| `ProblemOpened` | problems | 문제가 처음 열림(처리 안 된 오류, 앱의 보고) | 새 일 | 그 앱의 App Engineer 새 session |
| `ProblemReopened` | problems | 해결됨인 문제가 그 뒤 활성 release에서 다시 남 | 새 일 | 같음 |
| `AppRestartHalted` | app-runtime | 짧은 시간에 거듭 죽어 자동 재시작을 멈춤 | 새 일 | 그 앱의 App Engineer 새 session |
| `ReleaseActivationFailed` | app-releases | activation이 실패함 | 새 일 | 그 release의 App Engineer 새 session |
| `ContextViolationFound` | contexts | 계약 위반이 새로 생김(이전 검사와 위반 집합을 비교. 개수가 아니다) | 새 일 | 위반이 생긴 project의 Project Manager 새 session |
| `TicketCompletionReported` | app-tickets | coding agent가 CLI로 완료를 보고함 | call 닫음 | 맡긴 App Engineer session(열린 session, 없으면 새 session). handler가 그 call을 닫는다 |
| `TicketClaimExpired` | app-tickets | claim이 기한이 지나 정리됨 | call 닫음 | 같음 |
| `CodingSessionEndedUnreported` | coding-agent | 완료 보고 없이 coding agent session이 끝남 | call 닫음 | 같음 |
| `ApprovalDecided` | approvals | 보류 request에 사람이 결정함 | program 일 | 그 request 종류의 handler가 다시 검사하고 실행한다(S2) |
| `TicketVerified` | app-tickets | App Engineer가 ticket을 확인됨으로 둠 | program 일 | activation handler가 그 ticket에 이은 release를 activate한다(S7) |

- **새 일의 반응:** handler가 reaction grant를 본다(S2). 꺼져 있으면 agent를 부르지 않는다. 열고 묻지 않음이면 Router에 call을 넣는다(`from` program과 근거 seq, `to` 새 session의 role과 place, `reply` none). 물음이면 보류 request를 만든다.
- **call 닫음의 반응:** handler가 맡긴 session에 그 사실을 새 입력으로 넣고(program이 보낸 입력이라 `agent_calls` 행이 없다), 같은 일 안에서 닫히는 원래 call(`agent_calls`의 한 행)의 상태를 닫는다. 같은 사실이 Router의 실패 알림으로 한 번 더 가지 않는다(S3).
- **activation의 계기:** 새 release는 그 release를 이은 ticket이 확인됨이 되면 activate된다(req-1507). ticket을 확인됨으로 두는 tx가 `TicketVerified`를 남기고, Reactor의 activation handler가 연다(S7 5장). release 준비 끝남은 domain event가 아니다.

**domain event가 아닌 것**

- 상태가 바뀔 뿐 반응할 쪽이 없는 것: 열린 문제의 또 다른 발생, release 준비, activation 성공, 앱 시작과 멈춤, 위반이 고쳐짐, context 판 적용과 되돌림, saved view, 용어집, 설정, agent 정의, session 이름과 archive, claim 시작·갱신·반납, request의 상태, call의 상태.
- 호출 결과로 바로 돌려주는 것: release 준비 중 test 실패(coding agent에게), 새 context 판의 test 실패(Project Manager에게).
- 의존성 새 version(lophn update의 SDK, 사용자 package): 앱 의존은 정확한 version으로 고정되어 새 release 전에는 바뀌지 않는다. App Engineer는 그 앱을 고칠 때 목록을 보고 판단한다.
- 다루지 않는 것: npm·jsr package의 새 version과 취약점, agent tool call과 app-api 호출(agent event와 invocation이 맡는다).

## 6. agent event

| event | lophn agent | coding agent |
|---|---|---|
| `SessionStarted` | ○ | ○ (외부 session ID를 잇는 근거) |
| `MessageReceived` | ○ | ○ (App Engineer가 보내는 첫 prompt와 추가 메시지) |
| `TurnStarted` | ○ | ○ |
| `TurnEnded` (completed, failed, interrupted) | ○ | ○ |
| `ToolCallStarted`, `ToolCallEnded` | ○ | × |
| `PermissionRequested`, `PermissionResolved` | ○ | harness가 물어 올 때만 |
| `QuestionAsked`, `QuestionResolved` | ○ | × |
| `CompactStarted`, `CompactEnded` | ○ | × |
| `SessionEnded` (reason) | ○ | ○ |

- session 상태는 core가 이 event에서 계산한다.
- Router 입력(사람 메시지, call, call의 답)은 받는 session에서 `MessageReceived`로 보이고 봉투가 붙는다. call의 표시는 이것으로 한다(8장).
- 사람이 steer로 보낸 메시지는 도는 turn 안에서 `MessageReceived`가 난다. 그래서 turn 하나에 `MessageReceived`가 여럿일 수 있다(req-1509).
- `QuestionAsked`는 agent가 사람에게 묻는 tool을 불렀을 때, `QuestionResolved`는 답, 그 session에 온 사람 메시지, turn의 끝으로 질문이 풀렸을 때 난다(req-1510).
- 끝난 session을 되살리면(나중, S3) `SessionStarted`를 다시 내고 payload에 되살림을 적는다.
- subagent와 model 호출은 event로 두지 않는다.
- coding agent는 harness가 알려 준 것만 바꾸고, 없는 것은 process 종료로 알거나 unknown으로 둔다.

## 7. 남지 않는 event

| event | 언제 | 왜 |
|---|---|---|
| `ApprovalRequested` | 보류 request(activation 허락, 물음인 reaction)를 표에 쓰고 commit한 뒤 | 사람이 답할 것이 생긴 것을 renderer가 알게 한다. core에서 반응할 쪽이 없으니 domain event가 아니다. 놓쳐도 request는 표에 남는다 |
| 앱 view 다시 그리기 | activation, 앱 grant 바뀜, 앱 rewind가 끝난 뒤 | 열린 앱 화면이 다시 그린다. 반응할 core 쪽이 없으니 domain event가 아니다(2026-10-15 결정, `../inventory/00-decisions.md` B 17) |

## 8. renderer 쪽 계약

core는 event를 흘리고, renderer는 아래 층으로 받는다. 모듈 이름과 위치는 refactor session의 code-map이 정한다.

```
Gateway (WebSocket)
   ▼
event client ── 연결 하나. 아래 층들이 선언한 구독 조건을 합친다. 끊기면 다시 붙고 snapshot부터 읽는다
   ├──▶ store 층 ── event로 상태를 고친다. 처음과 다시 붙을 때는 read API로 snapshot을 읽는다
   └──▶ 반응 층 ── event → 부수 효과(toast, 눌렀을 때 agent 부르기). event를 넣으면 반응 목록이 나오는 순수 함수
   ▼
UI component ── hook으로 store만 읽는다. event도 연결도 모른다. toast는 overlay가 그린다
```

**구독 (기본)**

| 쓰는 곳 | 조건 |
|---|---|
| session 목록, 대기 목록 | 모든 session의 `SessionStarted`, `SessionEnded`, 상태를 바꾸는 event, `PermissionRequested`, `PermissionResolved`, `QuestionAsked`, `QuestionResolved`. 그리고 `ApprovalRequested` |
| 열어 둔 대화 탭 | 그 session의 모든 agent event |
| toast | 아래 반응 표에 있는 종류 |

**반응 (기본)**

| event | store | toast |
|---|---|---|
| `PermissionRequested` | 대기 목록에 넣는다 | 띄운다 |
| `PermissionResolved` | 대기 목록에서 뺀다 | |
| `ApprovalRequested` | 대기 목록에 넣는다(한 목록, req-1498) | 띄운다 |
| `QuestionAsked` | 대기 목록에 넣는다. 권한 요청과 종류를 구별한다(req-1498) | 띄운다 |
| `QuestionResolved` | 대기 목록에서 뺀다 | |
| `SessionStarted`, `SessionEnded`, 상태 | session 목록과 상태를 고친다 | |
| `AppRestartHalted` | | 띄운다 |
| `ContextViolationFound` | | 띄운다. 누르면 reaction이 이미 연 Project Manager session으로 간다. reaction이 꺼져 있으면 그때 위반을 붙여 새로 연다(req-0083, 0085. 2026-10-15 결정) |
| 그 밖의 domain event | | 띄우지 않는다. App Engineer가 맡고 결과를 대화로 올린다 |

- coding agent의 `PermissionRequested`는 대기 목록에서 누르면 그 session의 터미널 탭으로 focus를 옮긴다. 답은 harness의 TUI에서 한다(S6 2장 5).
- toast는 renderer 정책이라 reaction grant(core가 agent를 부를지)와 따로다. agent 부르기를 꺼도 위 toast는 뜬다.
- 연결이 끊긴 사이 놓친 toast는 다시 띄우지 않는다. 사람이 답할 것은 다시 붙을 때 snapshot의 대기 목록으로 맞춘다.
- call은 대화 안에서 보인다. 받은 session의 메시지에 보낸 쪽 chip이 붙고, 누르면 맡긴 글, 근거, 보낸 session을 읽어 보인다. 보낸 session의 call 블록을 누르면 그때의 상태를 읽어 보인다(req-1506). 따로 구독하지 않는다.
- Context 탭(도메인 모델, 위반 목록, saved view, 용어집, 계약은 Contract 탭)은 열 때 읽는다(shell req-0075, 0077).

## 9. 흐름

1. **사람 메시지:** shell → Router(보낸 쪽 사람) → run-loop → agent event가 Bus → Gateway → 그 session을 연 대화 탭.
2. **program이 agent를 부름:** command가 domain 변경과 domain event를 한 tx로 쓴다 → Reactor handler → reaction grant(S2) → Router(보낸 쪽 program, 근거 seq) → 새 session. renderer는 모든 session의 `SessionStarted`를 구독하므로 session 목록에 바로 뜬다.
3. **agent가 agent를 부름:** run-loop의 call tool → Gate(agent grant, S2) → Router → 받는 session. 답은 같은 길로 보낸 session에 새 입력으로 돌아온다(S3).
4. **coding agent:** App Engineer의 call → Router → harness adapter가 첫 prompt를 넣는다. harness 신호 → adapter → agent event가 Bus로. 완료 보고, claim 만료, 보고 없는 끝은 domain event → Reactor 한 길로만 맡긴 App Engineer에게 간다. coding agent가 App Engineer에게 하는 말은 CLI → Router → 맡긴 App Engineer session이고 Ledger에 쓰지 않는다. 개발 진행은 따로 동기화하지 않는다(S6).
5. **turn gate:** run-loop가 Gate에서 물음을 받으면 session snapshot에 대기 요청을 두고 `PermissionRequested`를 낸다. renderer가 대기 목록에 넣고 toast를 띄운다. 사람이 답하면 `PermissionResolved`가 나고 turn이 이어 간다(S2).
6. **보류 gate:** request를 `approval_requests` 표에 쓰고 commit 뒤 `ApprovalRequested`를 낸다. renderer가 대기 목록에 넣고 toast를 띄운다. 사람이 결정하면 결정과 `ApprovalDecided`를 한 tx로 쓴다 → Reactor → 그 종류의 handler(S2).
7. **질문:** run-loop가 묻는 tool을 받으면 session snapshot에 질문을 두고 `QuestionAsked`를 낸다. renderer가 대기 목록에 넣고 toast를 띄운다. 사람이 답하거나 그 session에 메시지를 보내면 `QuestionResolved`가 나고, 답이나 그 메시지가 tool 결과로 가서 turn이 이어 간다(req-1510).

## 10. 꺼졌다 켜질 때

- Bus와 Gateway 구독은 사라진다. renderer는 다시 붙어 snapshot부터 읽는다.
- Reactor는 cursor 뒤의 domain event부터 이어 반응한다. 반응은 idempotent라 두 번 일어나지 않는다.
- 돌던 lophn agent turn은 다시 켤 때 interrupted로 닫는다. 그 turn의 대기 권한 요청과 질문은 cancelled다. 보류 request는 표에 남는다.
- coding agent는 adapter가 새 신호를 받기 전까지 unknown이다.
- lophn이 꺼지면 터미널 탭의 coding agent process도 끝나 그 session이 끝난다. 그 session에 넣으려고 기다리던 입력은 버려진다. token을 회수하고 claim을 반납하며, 완료 보고가 없었으면 `CodingSessionEndedUnreported`가 남는다.

## 11. 주인과 저장

| 사실 | 주인 | 다른 곳은 |
|---|---|---|
| 대화(message, tool call과 결과) | agent session 기록 | ID로 가리킨다 |
| 호출별 사용량과 비용 | 남긴다. 저장 위치는 refactor session이 정한다 | agent event로 남기지 않는다 |
| coding agent의 대화 | 그 harness | 외부 session ID만 잇는다 |
| domain 상태 | 각 concern의 표 | read API로 읽는다 |
| 반응할 일 | Ledger | seq로 가리킨다(입력의 근거) |
| call 상태 | `agent_calls` 표(S3) | 누를 때 읽는다 |
| 보류 request | `approval_requests` 표(S2) | `ApprovalRequested`, snapshot |
| 앱 호출 기록(invocation) | apps(S5) | tool call 기록이 invocation ID를 가리킨다 |
| 앱 log | app-runtime. 앱마다 최근 일정 양 | invocation에 묶인 log는 그 invocation에서 읽는다 |

## 12. 지울 옛 것

- 화면 구독이 ledger를 읽는 것(`packages/core/events/subscribe.ts` 등) → Bus와 snapshot.
- ledger에 쓰는 event type 약 150개 → 5장의 domain event 10개. 빠지는 것:
  - 지운 개념의 type: `Document*`, `Version*`, `Series*`, `Snapshot*` 등.
  - agent 일생: `Run*`, `ToolCall*`, `ModelCall*`, `Message*`, `Session*`.
  - 상태 일생: `ApprovalRequest*`(→ 표, `ApprovalRequested`, `ApprovalDecided`), `TicketClaimed`·`TicketClaimRenewed`·`TicketClaimReleased`, `ReleasePrepared`, `ProblemFixRecorded`·`ProblemConfirmationRecorded` 등 지운 problem 장치.
- run 출처: `message`, `handoff` → Router 입력의 보낸 쪽(사람, program과 근거 seq, agent session).
- renderer: 기능마다 따로 구독하고 따로 띄우는 것(`workspace/contexts/context-watch.ts`, `workspace/contexts/violation-toast.tsx`, 등) → 8장의 층. `desktop/notification-chip/ask-agent-toast.tsx`는 부르는 곳이 없는 죽은 코드다. `workspace/notice-card.tsx`는 event를 쓰지 않아 그대로 둔다.

## 13. 하지 않는 것

- 모든 domain 변경을 event type으로 만들기, 이력과 사후 감사.
- core의 일반 change notification, core가 toast를 정하는 것(`notice`).
- lophn domain 상태(ticket, claim, call의 진행)를 사람 화면에 따로 보이는 것.
- agent event의 저장과 replay.
- Ledger를 화면이나 외부 구독자가 읽는 것.
- 반응 rule engine.
- lophn 사용자에게 hook을 여는 것.
- subagent event, model 호출 event.
- 앱이 자기 업무 사실을 lophn에 알리는 길(push). Operator는 read app-api로 읽는다.

## 14. 다른 spec에 넘긴 것

- 앱 화면이 앱 data 바뀜을 다시 그리는 것: S5.
- ticket 확인됨이 activation을 여는 방법, activation 순서와 drain(req-1508), data를 잃는 migration: S7.
