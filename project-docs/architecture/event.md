# event

core 안에서 일어난 일은 두 부류로 갈린다. program이나 agent가 꼭 이어서 움직여야 하는 일(꺼졌다 켜져도 그 움직임이 빠지면 안 된다)과, 화면이 알기만 하면 되는 일이다. 앞은 영구 기록과 at-least-once 반응이 필요하고, 뒤는 메모리로 흘리면 충분하다. 둘을 한 길에 섞으면 "이력 겸 화면 갱신 겸 반응 trigger"가 되어 event type이 늘고 의미가 흐려진다. 이 문서는 둘을 가르는 장치(`core/events`, `core/storage`의 ledger)와 화면이 그것을 받는 약속을 다룬다.

## 흐름

```
 command (domain 변경) ─ domain event, 상태 변경과 같은 tx ─▶ Ledger(events 표, append-only)
        │                                                        │ cursor 뒤부터 읽음
        └ commit 뒤 같은 event ─▶ Bus(메모리) ──깨우기──▶ Reactor ─▶ handler ─▶ Router ─▶ 받는 session
                                    ▲                                 └▶ 보류 request (approvals)
 approvals ── 남지 않는 event (commit 뒤) ─┤
 run-loop ─ child-supervision-protocol ─ core가 publish ─ agent event ─┤
 harness adapter ─ agent event ─────────────────────────────────────────┤
                                    ▼
                         Gateway (event-stream) ─▶ shell
   shell: 조건 걸기 ─▶ ready 받기 ─▶ snapshot read ─▶ 이후 event로 store를 고침. 끊기면 처음부터
```

- domain event: Ledger에 남고 Reactor가 반응한다. 새 일(agent session을 연다), call 닫음(맡긴 call을 닫는다), program 일(agent를 부르지 않는다) 셋이다.
- agent event: session에서 일어나는 turn, tool call, 물음. 메모리뿐이고 seq가 없다.
- 남지 않는 event: session 밖에서 화면만 알면 되는 일(보류 request 생김, 앱 view 다시 그리기, 설정 바뀜). 메모리뿐이다.
- Router는 "agent session에 입력을 넣는" 한 입구다. 사람 메시지, agent call, program이 연 일(근거 domain event seq를 단다)이 모두 여기로 들어가, lophn agent는 run-loop 입력함으로 coding agent는 harness adapter로 간다.
- 구독 조건은 "어느 session의, 어떤 종류"다. 조건 여럿은 OR이고 같은 event는 연결 하나에 한 번만 간다.
- session snapshot은 session의 지금 상태와 대기 중인 권한 요청, 질문을 담는다. coding session은 harness도 싣는다. 화면이 붙거나 다시 붙을 때 읽는다.

## 지키는 것

domain event
- "그 뒤에 누가 꼭 움직여야 하는 일"에만 만든다. 이력, 감사, 화면 갱신용은 안 된다. Ledger가 곧 Reactor의 일감 목록이라 늘면 handler마다 뜻이 흐려진다.
- 상태를 바꾸는 command와 같은 tx에서 쓴다. 따로 쓰면 꺼진 사이 상태만 바뀌고 반응이 영영 빠진다.
- Ledger 행은 고치거나 지우지 않는다. cursor와 근거 seq가 행 번호를 가리킨다. 지우는 것은 사람이 요청한 session delete 하나뿐이다.
- 새 일 event만 reaction grant로 끌 수 있다. call 닫음은 끌 수 없다. 끄면 맡긴 call이 열린 채 남는다.
- 새 일 event를 받는 agent는 늘 한 project의 Project Manager다. 앱에 관한 event(문제 열림·다시 열림, 재시작 멈춤, activation 실패)는 앱이 묶인 project의 Project Manager가 받고, `KindViolationFound`와 `PublicToolsChanged`는 payload의 project의 Project Manager가 받는다. `PublicToolsChanged`는 공개 tool이 바뀌거나 지워진 release가 project마다 하나씩 낸다.
- call 닫음 handler는 call 닫기와 Project Manager에게 넣는 입력을 같은 tx에서 한다. 따로 하면 Router의 실패 알림이 같은 사실을 한 번 더 보낸다.
- program 일 event(`ApprovalDecided`, `TicketVerified`, `VerificationRecorded`)는 agent를 부르지 않고 program handler만 깨운다. `VerificationRecorded`는 test 결과를 기록하는 command(`RecordVerification`)가 같은 tx에서 쓰고, `examples` check의 결과를 ticket에 남기는 handler가 받는다. 다른 kind의 기록은 handler가 무시한다. 이 event가 Ledger에 있어야 core가 꺼졌다 켜져도 끝난 예시 검증의 결과가 ticket에 남는다.

Bus와 Reactor
- Bus에 내는 것은 반드시 commit 뒤다. command는 writer Worker에서 돌고 Bus는 main thread에 있어서, 낼 것을 모아 두었다가 commit된 결과와 함께 돌려받아 낸다. 되돌아간 tx의 것은 버린다. 먼저 내면 없던 일을 화면과 Reactor가 본다.
- core 안에서 command를 내는 곳(reaction, annotation 전달, 승인 적용)도 API server와 같은 접힌 writer(`ctx.writer`)를 쓴다. 날 writer(`runtime.writer`)는 commit 뒤 Bus 내기, call 본문 준비, 입력함 적용을 건너뛰어 event가 Bus에 닿지 않고 turn이 열리지 않는다. 날 writer는 Reactor cursor와 접기의 바닥에만 쓴다.
- reader Worker는 모든 등록의 port를 모든 read에 붙인다. read가 다른 등록의 port를 쓰는 일이 있어서다. 같은 port를 두 등록이 내면 기동 때 멈춘다(조용히 덮이지 않게).
- Bus는 놓칠 수 있고 정본은 Ledger다. Reactor는 Bus 도착을 깨우기로만 쓰고 주기적으로 표를 직접 읽는다. Bus 도착으로 일하게 하면 한 번 놓친 반응이 영영 없다. 그래서 commit 뒤 Bus로 내는 데 실패해도 command는 실패하지 않는다.
- Bus는 core 안에 하나뿐이다. agent runtime은 child process라 agent event를 감독 pipe로 보내고 core가 publish한다. 조건 검사와 연결 관리가 한 곳에 있게 하려는 것이다.
- Reactor는 겹쳐 깨워도 한 번에 한 줄로 돈다. 두 줄이 돌면 같은 event를 동시에 처리하고 cursor가 뒤섞인다.
- 반응은 최소 한 번, 효과는 한 번이다. idempotency key는 handler 이름, 근거 seq, 반응 이름으로 만든다. handler 이름을 바꾸면 한 반응을 다시 하므로 이름은 key의 일부다.
- handler가 unavailable이나 throw로 끝나면 cursor를 올리지 않고 backoff로 다시 한다. 뒤 event가 앞 event를 앞지르지 못하게 한다. 다시 해도 같은 결과일 오류는 기록하고 넘어간다. 영구 실패 한 건이 줄 전체를 막으면 안 된다.
- cursor는 그 event의 handler가 모두 끝난 뒤에만 올린다.

agent event와 화면
- agent event는 저장하지 않고 replay하지 않는다. 대화의 정본은 session 기록이고, 놓친 화면은 snapshot을 다시 읽는다.
- 화면은 조건을 걸고 ready를 받은 뒤에 snapshot을 읽는다. 읽고 나서 걸면 그 사이 event를 놓친다. 끊긴 연결은 replay 없이 처음부터 다시 맞춘다.
- session을 건 조건은 session이 없는 event(domain event, 남지 않는 event)와 맞지 않는다. 그런 event는 종류 조건으로만 받는다. 섞어 쓰면 전역 대기 목록이 조용히 빈다.
- Gateway는 느린 구독자를 버퍼 한도에서 끊고 Bus는 던진 sink를 해제한다. 구독자 하나 때문에 publish가 막히면 command 경로가 막힌다.
- domain event로 사람 화면을 갱신하지 않는다. core는 toast를 모르고 toast는 renderer의 정책이다. 그래서 reaction을 꺼도 toast는 뜨고, 끊긴 사이 놓친 toast는 다시 띄우지 않는다.
- 사람 화면에 가는 것은 앱 화면과 agent 결과(대화)뿐이다. ticket, claim, call의 진행은 agent끼리의 일이라 화면의 대상이 아니다.
- 꺼졌다 켜지면 돌던 turn은 interrupted로 닫고 그 turn의 대기 권한 요청과 질문은 cancelled다. 보류 request는 표에 남는다. coding agent는 신호를 받기 전까지 unknown이다.

## 왜 이 모양인가

- 모든 domain 변경을 event로 만들던 옛 구조는 type이 150개 가까이 되었고 화면 구독도 ledger를 읽었다. 이력과 감사는 쓰는 곳이 없어서 반응이 필요한 10개 안팎만 남겼다. 상태는 각 domain 표가 정본이다.
- 일반 change notification(어느 대상이 바뀜)은 두지 않았다. 받을 화면이 없다. 열린 앱 화면을 다시 그리는 것만 남지 않는 event 하나로 둔다.
- agent event를 저장하는 안은 버렸다. 조사한 harness(Claude Code, Codex, OpenCode, Hermes 등)와 paseo 모두 대화는 session 기록이 정본이고 event는 흘리는 신호다. seq와 replay는 비용만 든다. 대신 snapshot에 대기 중인 요청까지 담아, 늦게 붙은 화면도 답을 기다리는 요청을 본다.
- agent event 집합은 여러 harness의 lifecycle을 나란히 놓고 공통분모로 골랐다. turn 시작 신호가 없는 곳(Claude Code)과 session 시작이 첫 turn인 곳(Hermes, OpenClaw)이 있어서, coding agent는 harness가 알려 준 것만 바꾸고 나머지는 process 종료로 알거나 unknown으로 둔다.
- coding agent의 "끝남"은 turn 종료가 아니라 CLI 완료 보고다. turn이 끝난 것은 멈췄다는 뜻일 뿐 일을 해냈다는 뜻이 아니다.
- Reactor를 rule engine으로 만드는 안과 lophn 사용자에게 hook을 여는 안은 하지 않았다. handler는 평범한 코드다.
- 앱이 자기 업무 사실을 lophn에 밀어 넣는 길(push)은 없다. Operator가 read app-api로 읽는다.
- 새 일 handler는 agent를 직접 부르지 않고 approvals를 거친다. 꺼짐, 묻지 않음, 물음을 reaction grant 하나로 정하려는 것이다(`approval.md`).
