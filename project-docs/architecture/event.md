# event

core 안에서 일어난 일은 두 부류로 갈린다. program이나 agent가 꼭 이어서 움직여야 하는 일(꺼졌다 켜져도 그 움직임이 빠지면 안 된다)과, 화면이 알기만 하면 되는 일이다. 앞은 그 일을 아는 command가 상태 변경과 같은 tx에서 하고 event를 거치지 않는다. 뒤는 메모리 Bus로 흘린다. command가 같은 tx에 남기는 `events` 표의 기록은 반응이나 화면 갱신의 계기가 아니다. 셋을 한 길에 섞으면 "이력 겸 화면 갱신 겸 반응 trigger"가 되어 event type이 늘고 의미가 흐려진다. 이 문서는 그 장치(`core/events`, `core/storage`의 ledger)와 화면이 event를 받는 약속을 다룬다.

## 흐름

```
 command (상태 변경) ─ 기록 event, 상태 변경과 같은 tx ─▶ Ledger(events 표, append-only) ─▶ events/list, 관측 읽기, compare 기준 seq
        └ 이어서 움직일 일(맡긴 call 닫기 등)도 같은 tx에서 한다

 apps·kinds wiring ── 남지 않는 event (commit 뒤) ─┐
 approvals ── turn 안 request의 agent event ───────┤
 run-loop ─ child-supervision-protocol ─ core가 publish ─ agent event ─┤
 run-loop ─ model_output(날 글) ─ core live-turns가 redaction ─ ModelOutputStreamed ─┤
 core live-turns ─ 사람 기다림이 닫힘 ─ TurnResumed ─────────────────────┤
 harness adapter ─ agent event ─────────────────────────────────────────┤
                                    ▼
                               Bus(메모리)
                                    ▼
                         Gateway (event-stream) ─▶ shell
   shell: 조건 걸기 ─▶ ready 받기 ─▶ snapshot read ─▶ 이후 event로 store를 고침. 끊기면 처음부터
```

- 기록 event: command가 `tx.emit`으로 상태 변경과 같은 tx에 `events` 표에 남긴다(앱 상태 `AppStarted` 등, tool call 이력, rewind, domain). 읽는 곳은 `events/list`, 관측 읽기, compare 기준(표의 마지막 seq)이다. Bus에 싣지 않고 반응하는 곳이 없다.
- agent event: session에서 일어나는 turn, tool call, 물음(turn 안 request `TurnRequestOpened`·`TurnRequestClosed`, 질문), 쓰는 중인 model 글의 조각(`ModelOutputStreamed`), 저장된 agent message(`MessageRecorded`), 사람 기다림 뒤 다시 도는 순간(`TurnResumed`), 다음 turn 줄의 사람 메시지를 steer로 올리거나 뺀 일(`MessageSteered`·`MessageRemoved`; 입력함이 메모리라 화면이 아는 길이 이 event와 snapshot의 `steering`뿐이다). 메모리뿐이고 seq가 없다. 글이 흐르는 길과 시간은 `architecture/agent-chat.md`다.
- 남지 않는 event: session 밖에서 화면만 알면 되는 일(activation 동의 대기 `ActivationConsentRequested`·`ActivationConsentClosed`, 앱 view 다시 그리기, 설정 바뀜, 앱 재시작 멈춤 `AppRestartHalted`, 새 kind 위반 `KindViolationFound`, workflow instance를 다시 읽으라는 신호 `WorkflowInstanceChanged`, job이나 job run이 바뀌었다는 신호 `JobChanged`). 메모리뿐이다.
- Router는 "agent session에 입력을 넣는" 한 입구다. 사람 메시지, agent call, program의 알림, workflow의 step 메시지가 모두 여기로 들어가 run-loop 입력함으로 간다.
- 구독 조건은 "어느 session의, 어떤 종류"다. 조건 여럿은 OR이고 같은 event는 연결 하나에 한 번만 간다.
- session snapshot은 session의 지금 상태와 대기 중인 turn 안 request(`turn_requests`), 질문을 담는다. lophn session은 아직 저장되지 않은 model 호출 하나의 글(`writing`, redaction을 거친 것)과 도는 turn의 active(`elapsed`), [Send now]로 올렸지만 아직 model 요청에 싣지 않은 steer(`steering`, 기록에는 turn이 비어 있다)도 싣는다. 화면이 붙거나 다시 붙을 때 읽는다.

## 지키는 것

이어서 움직이는 일
- 뒤에 꼭 움직여야 하는 일은 그 일을 아는 command가 상태 변경과 같은 tx에서 한다. event를 남겨 다른 곳이 반응하게 하지 않는다. 따로 하면 꺼진 사이 상태만 바뀌고 반응이 빠지며, 다시 하게 하는 장치(cursor, 멱등 key, backoff)를 져야 한다.
- 꺼진 사이 끝나지 못한 일은 켤 때 그 owner의 복구가 자기 표에서 찾아 닫는다(Router의 call 복구 `RecoverCalls`, `architecture/agent-call.md`).
- program은 스스로 정해 agent를 부르지 않는다. 앱의 오류나 activation 실패로 agent session을 열지 않는다. activation 실패는 `release.activate`를 부른 session에 결과로 돌아간다(`architecture/activation.md`). 앱이 어떻게 도는지는 agent가 앱 상태와 앱 log(`app.status`, `app.logs`, `app.invocations`)를 직접 읽어 안다(`architecture/app-call.md`).
- 정해진 때 agent를 부르는 것은 사람이 시킨 일이다. agent가 만든 job이 차례가 되면 run으로 agent를 부르는데(`architecture/job.md`), 이것은 program이 정한 반응이 아니라 사람이 agent에게 시킨 일의 실행이다. 앱 상태나 event에 반응해 부르는 길이 아니고 시각만 본다.
- job의 scheduler는 기록 event나 Bus에 얹지 않는다. 뒤에 움직일 일은 그 일을 아는 job command가 같은 tx에서 표를 고치고, scheduler는 표를 읽는다. 꺼진 사이 놓친 차례는 켤 때 첫 claim이 표에서 찾아 접는다.
- job이나 job run을 바꾼 command가 commit되면 jobs wiring이 `JobChanged`(subject job, payload `job_run`)를 한 번 낸다. 남지 않는 event다. 받는 곳은 대기 목록(hold card)과 job 화면과 Jobs 탭·overlay와 project 창 오른쪽 sidebar의 Jobs panel이고, 받으면 다시 읽는다. 같은 commit 뒤에 scheduler도 깨워 timer를 다시 건다. 놓친 화면은 열 때 다시 읽고, 정본은 표다(`architecture/job.md`).
- 앱 재시작 멈춤(`AppRestartHalted`)과 새 kind 위반(`KindViolationFound`)은 사람에게 toast만 띄우는 일이라 남지 않는 event다. 앞은 crash loop로 멈춘 기록(`AppUnavailable`)을 commit한 뒤 apps wiring이 내고, 뒤는 kinds dispatcher가 앞 sync에 없던 위반을 볼 때 낸다(`architecture/kinds.md`). 놓쳐도 앱 상태와 `kind.check`가 지금 상태를 보여 준다.
- workflow instance의 행이나 줄을 바꾼 command가 commit되면 workflows wiring이 `WorkflowInstanceChanged`(subject instance, payload project와 workflow)를 한 번 낸다. CLI로 낸 report는 session event가 없어 사람 화면과 instance artifact view가 알 길이 이것뿐이다. 받으면 다시 읽고, 놓친 화면은 열 때 다시 읽는다. 정의 file이 바뀐 것은 알리지 않는다(`architecture/workflow.md`).

events 표
- Ledger 행은 고치거나 지우지 않는다. compare 기준과 관측 읽기가 seq를 가리킨다. 지우는 것은 사람이 요청한 session delete 하나뿐이다.
- 기록 event로 반응을 걸거나 화면을 갱신하지 않는다. 화면에 알릴 것은 commit 뒤 남지 않는 event나 agent event로 따로 낸다.

Bus
- Bus에 내는 것은 반드시 commit 뒤다. command는 writer Worker에서 돌고 Bus는 main thread에 있어서, 낼 것을 모아 두었다가 commit된 결과와 함께 돌려받아 낸다(`after_commit`). 되돌아간 tx의 것은 버린다. 먼저 내면 없던 일을 화면이 본다.
- core 안에서 command를 내는 곳(annotation 전달, activation 동의 묻기, 새 앱의 source 잇기)도 API server와 같은 접힌 writer(`ctx.writer`)를 쓴다. 날 writer(`runtime.writer`)는 commit 뒤 Bus 내기, call 본문 준비, 입력함 적용을 건너뛰어 event가 Bus에 닿지 않고 turn이 열리지 않는다. 날 writer는 접기의 바닥에만 쓴다.
- reader Worker는 모든 등록의 port를 모든 read에 붙인다. read가 다른 등록의 port를 쓰는 일이 있어서다. 같은 port를 두 등록이 내면 기동 때 멈춘다(조용히 덮이지 않게).
- Bus는 놓칠 수 있다. 정본은 각 module의 표와 session 기록이고 놓친 화면은 snapshot을 다시 읽는다. 그래서 commit 뒤 Bus로 내는 데 실패해도 command는 실패하지 않는다.
- Bus는 core 안에 하나뿐이다. agent runtime은 child process라 agent event를 감독 pipe로 보내고 core가 publish한다. 조건 검사와 연결 관리가 한 곳에 있게 하려는 것이다.
- 쓰는 중인 model 글은 agent event가 아니라 날 글(감독 pipe `model_output`)로 core에 간다. core가 쌓인 글 전체를 redaction하고 secret이 시작됐을 수 있는 끝을 붙잡은 뒤 `ModelOutputStreamed`로 낸다. 붙잡는 자리는 child에 알리지 않는다.

agent event와 화면
- agent event는 저장하지 않고 replay하지 않는다. 대화의 정본은 session 기록이고, 놓친 화면은 snapshot을 다시 읽는다. 쓰는 중인 글과 도는 turn의 active는 core 메모리(`packages/core/lophn-agent/run-loop/live-turns.ts`)에만 있고 snapshot이 싣는다. delta의 offset이 snapshot의 글 길이와 맞지 않으면 화면이 snapshot을 다시 읽는다.
- 화면은 조건을 걸고 ready를 받은 뒤에 snapshot을 읽는다. 읽고 나서 걸면 그 사이 event를 놓친다. 끊긴 연결은 replay 없이 처음부터 다시 맞춘다.
- session을 건 조건은 session이 없는 event(남지 않는 event)와 맞지 않는다. 그런 event는 종류 조건으로만 받는다. 섞어 쓰면 전역 대기 목록이 조용히 빈다.
- Gateway는 느린 구독자를 버퍼 한도에서 끊고 Bus는 던진 sink를 해제한다. 구독자 하나 때문에 publish가 막히면 command 경로가 막힌다.
- core는 toast를 모르고 toast는 shell의 정책이다. 끊긴 사이 놓친 toast는 다시 띄우지 않는다. 앱 멈춤과 kind 위반의 toast는 renderer가 남지 않는 event를 듣고 띄운다. agent의 turn 끝·권한 물음·질문 알림은 renderer가 아니라 shell main이 같은 event를 듣고 터미널 agent와 같은 규칙으로 toast나 OS 알림을 정한다(`architecture/terminal-agent.md`).
- 사람 화면에 가는 것은 앱 화면과 agent 결과(대화)뿐이다. call의 진행은 agent끼리의 일이라 화면의 대상이 아니다.
- 꺼졌다 켜지면 돌던 turn은 interrupted로 닫고 그 turn의 turn 안 request와 질문은 cancelled다. activation 동의 대기는 apps의 표에 남는다(`architecture/activation.md`).

## 왜 이 모양인가

- 모든 변경을 event로 만들던 옛 구조는 type이 150개 가까이 되었고 화면 구독도 ledger를 읽었다. 반응이 필요한 10개 안팎을 domain event로 남겼다가, 그 일도 아는 command가 같은 tx에서 하게 되어 domain event와 Reactor를 모두 지웠다. 상태는 각 module의 표가 정본이다.
- 일반 change notification(어느 대상이 바뀜)은 두지 않았다. 받을 화면이 없다. 열린 앱 화면을 다시 그리는 것과 workflow instance, job을 다시 읽는 것만 남지 않는 event로 둔다. workflow는 session 밖(CLI)에서도 바뀌고 job도 scheduler가 바꾸어 session event로 알 수 없다.
- agent event를 저장하는 안은 버렸다. 조사한 harness(Claude Code, Codex, OpenCode, Hermes 등)와 paseo 모두 대화는 session 기록이 정본이고 event는 흘리는 신호다. seq와 replay는 비용만 든다. 대신 snapshot에 대기 중인 요청까지 담아, 늦게 붙은 화면도 답을 기다리는 요청을 본다.
- agent event 집합은 여러 harness의 lifecycle을 나란히 놓고 공통분모로 골랐다. 그때 함께 쓰던 coding session 층은 지웠고(`architecture/coding-agent.md`) 지금은 lophn session만 낸다.
- event에 반응하는 장치(Reactor)를 두지 않는다. 마지막 반응(맡긴 coding session의 끝, 이제 지운 층)도 command가 같은 tx에서 call을 닫게 되어, 반응할 event 없이 cursor, 멱등 key, backoff만 지는 장치가 남아 지웠다. 따로 반응하는 길은 같은 사실을 두 길이 알리게 하기도 했다. lophn 사용자에게 hook을 여는 안도 하지 않았다.
- 앱이 자기 업무 사실을 lophn에 밀어 넣는 길(push)은 없다. agent가 읽기 앱 tool로 읽는다.
- 앱 오류가 나면 앱 place의 session을 자동으로 여는 흐름을 지웠다. problem 상태 machine과 보고 길이 계약에 비해 무거웠고, 진단은 agent가 앱 log를 직접 읽으면 된다. 사람에게는 toast가 남는다.
- program이 agent를 부르는 reaction(새 일 handler와 그 설정)을 모두 지웠다. 마지막 것(activation 실패)은 `release.activate`의 결과가 대신하고 사람에게는 toast가 남는다. 정기적으로 앱을 살피게 하고 싶으면 사람이 시킨다(job이나 workflow). job이 정해진 때 agent를 부르는 것은 반응 장치가 아니라 사람이 시킨 일의 실행이다. 앞서 reaction의 물음(보류 request 길)은 `approval.md`가 지웠다.
