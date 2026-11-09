# event

core 안에서 일어난 일은 세 부류로 갈린다. program이나 agent가 꼭 이어서 움직여야 하는 일(꺼졌다 켜져도 그 움직임이 빠지면 안 된다), 나중에 읽으려고 남겨 두는 기록, 화면이 알기만 하면 되는 일이다. 첫째는 그 일을 아는 command가 상태 변경과 같은 tx에서 하고 event를 거치지 않는다. 둘째는 같은 tx에서 `events` 표(Ledger)에 남긴다. 셋째는 메모리 Bus로 흘려 화면이 구독해 받는다. 이 문서는 이 구분과 Bus·Gateway, 화면이 event를 받는 약속을 다룬다.

## 문제

셋을 한 길에 섞으면 event 하나가 "이력 겸 화면 갱신 겸 반응 trigger"가 되어 type이 늘고 의미가 흐려진다. 모든 변경을 event로 만들던 옛 구조는 type이 150개 가까이 되었고 화면 구독도 Ledger를 읽었다. 반응하는 장치를 두면 꺼진 사이 놓친 반응을 다시 하게 하는 짐(cursor, 멱등 key, backoff)을 지고, 같은 사실을 두 길이 알리게 되기도 한다. 반대로 화면이 event를 놓치거나 늦게 붙어도 어긋난 채 남지 않아야 하고, 느린 화면 하나가 command 경로를 막아서도 안 한다.

## 목표와 비목표

- 목표: 뒤에 꼭 움직여야 하는 일은 어떤 경우에도 빠지지 않는다. 화면은 붙거나 다시 붙을 때 정본에서 자기 상태를 다시 맞출 수 있다. 되돌아간 tx의 일을 화면이 보지 않는다.
- 비목표: event에 반응하는 장치(Reactor)와 domain event. lophn 사용자에게 hook을 여는 것. 앱이 자기 업무 사실을 lophn에 밀어 넣는 길(push). agent event의 저장과 replay. "어느 대상이 바뀜"을 알리는 일반 change notification. 이유는 모두 "결정"에 있다.

## 모델

event는 셋이다.

```
 command (상태 변경) ─ 기록 event, 같은 tx ─▶ Ledger(events 표, append-only)
        │                                      └▶ events/list, 관측 읽기, compare 기준 seq
        └ 이어서 움직일 일(맡긴 call 닫기 등)도 같은 tx에서 한다

 command가 commit된 뒤 ── 남지 않는 event ──────────────────┐
 session에서 일어난 일 ── agent event (run-loop, core의 approvals·live turn,
                          harness adapter, 감독 pipe로 온 agent runtime의 것) ─┤
                                                             ▼
                                                        Bus(메모리)
                                                             ▼
                                           Gateway (event-stream) ─▶ shell ─▶ 화면
   화면: 조건 걸기 ─▶ ready 받기 ─▶ snapshot read ─▶ 이후 event로 store를 고침. 끊기면 처음부터
```

기록 event
- command가 상태 변경과 같은 tx에 `events` 표에 남긴다(앱 상태 `AppStarted`·`AppUnavailable` 등, tool call 이력, rewind). 읽는 곳은 `events/list`, 관측 읽기, compare 기준(표의 마지막 seq)이다. Bus에 싣지 않고 반응하는 곳이 없다.

agent event
- session에서 일어나는 일이다. 메모리뿐이고 seq가 없다. 종류: `SessionStarted`·`SessionEnded`, `MessageReceived`·`MessageRecorded`, `MessageSteered`·`MessageRemoved`, `ShellRan`, `TurnStarted`·`TurnEnded`·`TurnResumed`, `ModelOutputStreamed`, `ToolCallStarted`·`ToolCallEnded`, turn 안 request(`TurnRequestOpened`·`TurnRequestClosed`), 질문(`QuestionAsked`·`QuestionResolved`), `CompactStarted`·`CompactEnded`.
- `ModelOutputStreamed`는 쓰는 중인 model 글의 조각이다. `TurnResumed`는 사람 기다림 뒤 turn이 다시 일하는 순간이다. `MessageSteered`·`MessageRemoved`는 다음 turn 줄의 사람 메시지를 steer로 올리거나 뺀 일이다(그 줄이 메모리라 화면이 아는 길이 이 event와 ACP snapshot의 `queued`뿐이다).
- 화면은 agent event를 직접 접지 않는다. core가 ACP 갱신으로 바꾼 것(`AcpUpdated`)을 접는다. 글이 흐르는 길과 시간은 `architecture/agent-chat.md`, ACP는 `architecture/acp.md`다.
- 팀 자식의 물음은 부모가 푸는 것이라 request와 `TurnRequestOpened`·`QuestionAsked`, snapshot의 질문 항목에 `to_parent`가 붙고 대기 목록과 알림이 그것으로 거른다.

남지 않는 event
- session 밖에서 화면만 알면 되는 일이다. 메모리뿐이다. session이 없어 `subject`가 앱·release·instance·job이거나 null이다. `AcpUpdated`만 envelope에 `session`이 있어 session 조건에 걸린다.
- 종류: `AppViewChanged`(activation·grant·rewind 뒤 열린 앱 view를 다시 그리라는 신호), `AppRemoved`, `SettingsChanged`, `AppRestartHalted`, `ActivationConsentRequested`·`ActivationConsentClosed`, `ShareRequestOpened`·`ShareRequestClosed`, `NoticePosted`·`NoticeClosed`·`NoticeRead`, `AppTrayChanged`, `WorkflowInstanceChanged`, `JobChanged`, `AcpUpdated`.
- 쓸 수 있는 type은 이 두 집합(agent event, 남지 않는 event)뿐이고 이름은 서로 겹치지 않는다. Bus에는 둘만 오른다.

session snapshot
- session의 지금 상태, 대기 중인 turn 안 request(`turn_requests`), 질문을 담는다. 읽는 곳은 대기 목록과 session 목록이다. 대화 화면이 읽는 상태(쓰는 중인 model 글, 도는 turn의 active, 올린 steer)는 ACP snapshot `AcpSnapshot`이 싣는다. 둘 다 화면이 붙거나 다시 붙을 때 읽는다.

입구
- Router는 "agent session에 입력을 넣는" 한 입구다. 사람 메시지, agent call, program의 알림, workflow의 step 메시지가 모두 여기로 들어가 run-loop queue로 간다.

## 지키는 것

이어서 움직이는 일
1. 뒤에 꼭 움직여야 하는 일은 그 일을 아는 command가 상태 변경과 같은 tx에서 한다. event를 남겨 다른 곳이 반응하게 하지 않는다. 따로 하면 꺼진 사이 상태만 바뀌고 반응이 빠진다.
2. 꺼진 사이 끝나지 못한 일은 켤 때 그 owner의 복구가 자기 표에서 찾아 닫는다(Router의 call 복구, `architecture/agent-call.md`).
3. program은 스스로 정해 agent를 부르지 않는다. 앱의 오류나 activation 실패로 agent session을 열지 않는다. activation 실패는 `release.activate`를 부른 session에 결과로 돌아가고(`architecture/activation.md`), 앱이 어떻게 도는지는 agent가 앱 상태와 앱 log(`app.status`, `app.logs`, `app.invocations`)를 직접 읽어 안다(`architecture/app-call.md`).
4. 정해진 때 agent를 부르는 것은 사람이 시킨 일이다. agent가 만든 job이 차례가 되면 run으로 agent를 부르는데(`architecture/job.md`), 이것은 program이 정한 반응이 아니라 사람이 agent에게 시킨 일의 실행이다. 앱 상태나 event에 반응해 부르는 길이 아니고 시각만 본다.
5. job의 scheduler는 기록 event나 Bus에 얹지 않는다. 뒤에 움직일 일은 그 일을 아는 job command가 같은 tx에서 표를 고치고, scheduler는 표를 읽는다. 꺼진 사이 놓친 차례는 켤 때 첫 claim이 표에서 찾아 접는다.

events 표
6. Ledger 행은 고치거나 지우지 않는다. compare 기준과 관측 읽기가 seq를 가리킨다. 지우는 것은 사람이 요청한 session delete 하나뿐이다.
7. 기록 event로 반응을 걸거나 화면을 갱신하지 않는다. 화면에 알릴 것은 commit 뒤 남지 않는 event나 agent event로 따로 낸다.

Bus
8. Bus에 내는 것은 반드시 commit 뒤다. command는 writer Worker에서 돌고 Bus는 main thread에 있어서, 낼 것을 모아 두었다가 commit된 결과와 함께 돌려받아 낸다. 되돌아간 tx의 것은 버린다. 먼저 내면 없던 일을 화면이 본다.
9. core 안에서 command를 내는 곳(annotation 전달, activation 동의 묻기, 새 앱의 source 잇기, notice 기록)도 API server와 같은 접힌 writer를 쓴다. 날 writer는 commit 뒤 Bus 내기, call 본문 준비, queue 적용을 건너뛰어 event가 Bus에 닿지 않고 turn이 열리지 않는다. 날 writer는 접기의 바닥에만 쓴다.
10. reader Worker는 모든 등록의 port를 모든 read에 붙인다. read가 다른 등록의 port를 쓰는 일이 있어서다. 같은 port를 두 등록이 내면 기동 때 멈춘다(조용히 덮이지 않게).
11. Bus는 놓칠 수 있다. 정본은 각 module의 표와 session 기록이고 놓친 화면은 snapshot이나 표를 다시 읽는다. 그래서 commit 뒤 Bus로 내는 데 실패해도 command는 실패하지 않는다.
12. Bus는 core 안에 하나뿐이다. agent runtime은 child process라 agent event를 감독 pipe로 보내고 core가 publish한다. 조건 검사와 연결 관리가 한 곳에 있게 하려는 것이다.
13. 쓰는 중인 model 글은 agent event가 아니라 날 글(감독 pipe `model_output`)로 core에 간다. core가 쌓인 글 전체를 redaction하고 secret이 시작됐을 수 있는 끝을 붙잡은 뒤 `ModelOutputStreamed`로 낸다. 붙잡는 자리는 child에 알리지 않는다.
14. publish는 동기이고 막히지 않는다. Gateway는 느린 구독자를 버퍼 한도에서 끊고, 던진 구독자는 Bus가 해제한다. 구독자 하나 때문에 publish가 막히면 command 경로가 막힌다.

남지 않는 event를 내는 때
15. 앱 재시작 멈춤(`AppRestartHalted`)은 crash loop로 멈춘 기록(`AppUnavailable`)을 commit한 뒤 낸다. 사람에게 toast만 띄우는 일이다. 놓쳐도 앱 상태가 지금 상태를 보여 준다.
16. 사람에게 한 알림(앱이 cap-notify로 한 것과 core가 남긴 기록)은 `notices` 표에 쓴 command가 commit된 뒤 `NoticePosted`(payload가 줄 한 건)를 낸다. 휘발 줄이 표에서 빠지면 `NoticeClosed`, 영구 기록을 읽음으로 바꾸면 `NoticeRead`다. 받는 곳은 Inbox와 shell main의 toast·OS 알림뿐이고 반응하는 곳은 없다. 놓친 화면은 열 때 표를 다시 읽는다(`architecture/app-notice.md`).
17. job이나 job run을 바꾼 command가 commit되면 `JobChanged`(subject job, payload `job_run`)를 한 번 낸다. 받는 곳은 대기 목록(hold card)과 job 화면과 Jobs 탭·overlay와 project 창 오른쪽 sidebar의 Jobs panel이고, 받으면 다시 읽는다. 같은 commit 뒤에 scheduler도 깨워 timer를 다시 건다. 놓친 화면은 열 때 다시 읽고 정본은 표다(`architecture/job.md`).
18. workflow instance의 행이나 줄을 바꾼 command가 commit되면 `WorkflowInstanceChanged`(subject instance, payload project와 workflow)를 한 번 낸다. CLI로 낸 report는 session event가 없어 사람 화면과 instance artifact view가 알 길이 이것뿐이다. 받으면 다시 읽고, 놓친 화면은 열 때 다시 읽는다. 정의 file이 바뀐 것은 알리지 않는다(`architecture/workflow.md`).

agent event와 화면
19. agent event는 저장하지 않고 replay하지 않는다. 대화의 정본은 session 기록이고, 놓친 화면은 snapshot을 다시 읽는다. 쓰는 중인 글과 도는 turn의 active는 core 메모리에만 있고 ACP snapshot이 싣는다. `writing_streamed`의 offset이 snapshot의 글 길이와 맞지 않으면 `reread`가 서고 화면이 snapshot을 다시 읽는다.
20. 화면은 조건을 걸고 `ready`를 받은 뒤에 snapshot을 읽는다. 읽고 나서 걸면 그 사이 event를 놓친다. 끊긴 연결은 replay 없이 처음부터 다시 맞춘다.
21. 서버는 `watch` frame마다 받은 차례로 `ready` 하나를 답한다. shell main은 그 차례로 짝지어, 한 창이 조건을 바꿔 건 `watch`의 `ready`는 그 창에만 보내고 새로 붙은 연결의 `ready`만 모든 창에 보낸다. 창 안에서도 그 `watch`를 걸 때 아직 `ready`를 못 받은 구독자만 다시 읽는다. 기존 구독자는 서버가 동기로 다시 구독해 event를 잃지 않는다. tab 하나를 열고 닫을 때마다 모든 창이 snapshot을 다시 읽던 것을 막는다.
22. session을 건 조건은 session이 없는 event(남지 않는 event)와 맞지 않는다. 그런 event는 종류 조건으로만 받는다. 섞어 쓰면 전역 대기 목록이 조용히 빈다. `AcpUpdated`는 subject가 null이지만 envelope의 session이 조건에 걸린다.
23. 구독 조건은 "어느 session의, 어떤 종류"다. 조건 여럿은 OR이고 같은 event는 연결 하나에 한 번만 간다. 조건 없는 구독은 아무 event도 받지 않는다.
24. core는 toast를 모르고 toast는 shell의 정책이다. 끊긴 사이 놓친 toast는 다시 띄우지 않는다. 앱 멈춤(`AppRestartHalted`)·activation 동의 요청·앱 공유 요청의 toast는 renderer가 남지 않는 event를 듣고 띄운다. agent의 turn 끝·권한 물음·질문 알림은 renderer가 아니라 shell main이 같은 event를 듣고 터미널 agent와 같은 규칙으로 toast나 OS 알림을 정한다(`architecture/terminal-agent.md`).
25. 사람 화면에 가는 것은 앱 화면과 agent 결과(대화)뿐이다. call의 진행은 agent끼리의 일이라 화면의 대상이 아니다.
26. 꺼졌다 켜지면 돌던 turn은 interrupted로 닫고 그 turn의 turn 안 request와 질문은 cancelled다. activation 동의 대기는 apps의 표에 남는다(`architecture/activation.md`).

## 경계와 계약

boundary: `events`(commit 뒤 agent event와 남지 않는 event를 화면에 내는 Bus와 Gateway), `event-stream`(core가 확정한 event의 stream).

- Gateway: WebSocket, subprotocol `lophn.gateway.1`. 받는 principal은 사람 token 하나(shell main)다. replay도 ack도 없다.
  - client frame은 `watch {conditions}` 하나다. 연결 안에서 다시 보내면 조건을 통째로 바꾼다. 잘못된 frame은 `closed` 없이 끊는다.
  - server frame은 `ready`(조건이 적용됐다), `event {event}`, `closed {reason}`(`slow_consumer` | `credential_revoked` | `shutdown`)다. 느린 구독자는 `closed` 뒤 1013으로 끊는다.
- 구독 조건: `{session?, types?}`. 생략한 칸은 제한하지 않는다. event가 맞으려면 (session이 없거나 event의 session과 같고) 그리고 (types가 없거나 event의 type이 들어 있다).
- shell main은 renderer들이 건 조건과 자기 조건을 합쳐 같은 것은 한 번만 걸고, 연결이 끊기면 마지막 확인 시각을 남긴 채 stale로 알리고 다시 붙는 것은 connection이 맡는다.
- 읽기: `events/list`(`after_seq`, 필터 `types`·`subjects`, `limit`; 응답에 `scanned_through_seq`, `head_seq`; actor user·agent·app·machine). `session_snapshots/list`(`sessions` 생략하면 열린 session 전부, 없는 id는 뺀다; actor user). 대화 상태는 `AcpSnapshot`.
- 기록 event의 모양: `seq`, `type`, `subject`, `actor`, `turn`, `payload`, `at`. agent event의 모양: `session`, `type`, `at`, `payload`. 남지 않는 event의 모양: `type`, `subject`, `at`, `payload`.
- type 이름은 `<Entity><과거형 동사>` PascalCase다.
- 주요 payload: `ModelOutputStreamed {turn, model_call, kind: text|reasoning, offset, text}`(offset은 같은 model_call·kind에서 앞서 낸 글의 UTF-16 길이이고 redaction을 거친 글로 센다. 다른 model_call의 조각이 오면 앞 model 호출의 쓰는 중인 글을 버린다). `TurnEnded`의 `active_ms`(사람 기다림을 뺀 일한 시간). `NoticePosted`의 payload는 notice 행 한 건. `JobChanged {job_run | null}`. `WorkflowInstanceChanged {project, workflow}`. `AppRestartHalted {app_name, release, crashes}`.
- session snapshot 한 건: `session`, `agent`, `workspace`, `state`, `turn_requests`, `questions {group, turn, tool_call, to_parent}`. 질문 내용은 싣지 않고 질문 read가 준다.
- `events` 표의 저장 모양과 immutable 보장은 storage의 ledger가 맡는다.

## 결정

- 반응할 domain event를 모두 지우고 Reactor(cursor, 멱등 key, backoff, 5초 poll)도 지웠다. 반응이 필요한 10개 안팎을 domain event로 남겼으나 그 일도 아는 command가 같은 tx에서 하게 되었고, 마지막 반응(맡긴 coding session의 끝)도 command가 같은 tx에서 call을 닫게 되어 반응할 event 없이 장치만 남았다. 같은 사실을 두 길이 알리게 하는 문제도 있었다. 버린 안: Reactor 유지, lophn 사용자에게 hook을 여는 것. 상태는 각 module의 표가 정본이다. (agent)
- 일반 change notification(어느 대상이 바뀜)은 두지 않았다. 받을 화면이 없다. 열린 앱 view를 다시 그리는 것과 workflow instance, job을 다시 읽는 것만 남지 않는 event로 둔다. workflow는 session 밖(CLI)에서도 바뀌고 job도 scheduler가 바꾸어 session event로 알 수 없다.
- agent event를 저장하는 안은 버렸다. 조사한 harness(Claude Code, Codex, OpenCode, Hermes 등)와 paseo 모두 대화는 session 기록이 정본이고 event는 흘리는 신호다. seq와 replay는 비용만 든다. 대신 snapshot에 대기 중인 요청까지 담아, 늦게 붙은 화면도 답을 기다리는 요청을 본다.
- agent event 집합은 여러 harness의 lifecycle을 나란히 놓고 공통분모로 골랐다. 그때 함께 쓰던 coding session 층은 지웠고(`architecture/coding-agent.md`) 지금은 lophn session만 낸다. model 호출의 시작·끝은 event로 두지 않고 쓰는 중인 글만 흐른다.
- 맡긴 coding session의 끝은 새 event 없이 그 끝을 아는 command가 같은 tx에서 call을 닫는다. 줄에서 띄우지 못한 call은 `failed`고, 켤 때는 Router의 복구가 닫는다. (agent)
- program이 agent를 부르는 reaction을 모두 지웠다. 앱 오류가 나면 앱 workspace의 session을 자동으로 여는 흐름은 problem 상태 machine과 보고 길이 계약에 비해 무거웠고 진단은 agent가 앱 log를 직접 읽으면 된다. 마지막 것(activation 실패)은 `release.activate`의 결과가 대신하고 사람에게는 toast가 남는다. 정기적으로 앱을 살피게 하려면 사람이 시킨다(job이나 workflow). (사람, 2026-10-20: 앱 문제로 agent를 자동으로 열지 않는다. 나머지 reaction 정리는 agent)
- 앱이 자기 업무 사실을 lophn에 밀어 넣는 길(push)은 없다. agent가 읽기 앱 tool로 읽는다. 앱 event의 발행·구독과 event로 시작하는 job은 반응을 믿게 할 장치(저장, cursor, 재시도)가 다시 필요해 열지 않았다. 하나 연 길은 사람에게 알리기(cap-notify)다. 캘린더의 일정 알림이나 사용량 앱의 한도 경고처럼 사람이 알아야 하는 일을 앱이 알릴 길이 없었고, 받는 쪽이 사람의 Inbox와 toast뿐이라 agent나 program의 반응을 일으키지 않는다. (사람, 2026-11-05. 받는 쪽은 사람뿐이라는 모양은 agent의 추천을 사람이 받음)
- "일하는 시간"(active)은 사람 기다림을 뺀다. 이를 아는 core가 `TurnResumed`를 내고 turn이 끝난 순간까지 active를 마감해 `TurnEnded`에 싣는다. 멈춤·실패·끊김으로 끝나는 turn도 같다. (agent, planner)
- 쓰는 중인 model 글은 core가 쌓인 글 전체를 redaction하고 secret이 시작됐을 수 있는 끝을 붙잡은 뒤 낸다. 조각 단위로 거르면 조각 경계에 걸친 secret이 샌다. 붙잡는 자리는 child에 알리지 않는다.
- 한 창이 건 `watch`의 `ready`는 그 창에만 보낸다. 창 하나가 조건을 바꿀 때마다 모든 창이 snapshot을 다시 읽던 낭비와, `ready`를 기다리는 동안 쌓인 event를 읽기가 끝나지 않았다고 버리던 문제를 막는다. (agent)
- core 안에서 command를 내는 곳은 접힌 writer를 쓴다. 날 writer를 쓰던 때 event가 Bus에 닿지 않고 call 본문 준비와 queue 적용이 빠져 reaction이 session을 열지 못하고 annotation 전달이 turn을 열지 못했다. (agent)
- `session_snapshots/list`를 core가 단다. snapshot은 화면이 붙거나 다시 붙을 때 대기 중인 허락 request와 질문을 맞추는 계약인데 한때 handler가 없어 읽기가 `unavailable`이었다.
- ledger의 쓰이지 않던 domain event 제한 옵션은 지웠다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

## 열린 것

- 기동 중에 쓴 notice는 shell main이 core의 hello 전이라 `NoticePosted`를 받지 못해 toast가 뜨지 않는다. 배지와 History로만 보인다(`project-docs/issues/`의 shell 이슈).
