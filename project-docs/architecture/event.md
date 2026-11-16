# event

core 안에서 일어난 일은 세 부류로 갈린다. program이나 agent가 꼭 이어서 움직여야 하는 일(꺼졌다 켜져도 그 움직임이 빠지면 안 된다), 나중에 읽으려고 남겨 두는 기록, 화면이 알기만 하면 되는 일이다. 첫째는 그 일을 아는 command가 상태 변경과 같은 tx에서 하고 event를 거치지 않는다. 둘째는 같은 tx에서 `events` 표(Ledger)에 남긴다. 셋째는 메모리 Bus로 흘려 화면이 구독해 받는다. 상태를 바꾸는 route는 무엇을 바꾸는지 선언하고, core가 commit 뒤 그 선언을 `StateChanged` 하나로 내어 누가 바꿨든(다른 창, CLI, agent, scheduler) 열린 화면이 다시 읽는다. 이 구분과 별개로 앱이 "일이 일어났다"고 다른 앱에 알리는 길(앱 event)이 있다. 일이 일어난 뒤의 알림이고 한 번만 전달하며 저장하지 않는다. 이 문서는 이 구분과 Bus·Gateway, 화면이 event를 받는 약속, 앱 event를 다룬다.

## 문제

셋을 한 길에 섞으면 event 하나가 "이력 겸 화면 갱신 겸 반응 trigger"가 되어 type이 늘고 의미가 흐려진다. 모든 변경을 event로 만들던 옛 구조는 type이 150개 가까이 되었고 화면 구독도 Ledger를 읽었다. 반응하는 장치를 두면 꺼진 사이 놓친 반응을 다시 하게 하는 짐(cursor, 멱등 key, backoff)을 지고, 같은 사실을 두 길이 알리게 되기도 한다. 반대로 화면이 event를 놓치거나 늦게 붙어도 어긋난 채 남지 않아야 하고, 느린 화면 하나가 command 경로를 막아서도 안 한다.

## 목표와 비목표

- 목표: 뒤에 꼭 움직여야 하는 일은 어떤 경우에도 빠지지 않는다. 화면은 붙거나 다시 붙을 때 정본에서 자기 상태를 다시 맞출 수 있다. 되돌아간 tx의 일을 화면이 보지 않는다.
- 목표: 앱 하나가 낸 사실(사용량 한도에 닿음)을 여러 앱이 듣는다. 발행과 구독이 어느 쪽도 상대의 답을 기다리지 않고, 놓친 것을 믿게 하는 장치를 만들지 않는다. 발행과 거기서 나온 호출을 한 trace로 읽을 수 있다.
- 비목표: event에 반응하는 장치(Reactor)와 domain event. lophn 사용자에게 hook(시작 전에 막기)을 여는 것. 앱이 자기 업무 사실을 lophn에 밀어 넣어 core가 반응하게 하는 길(push). program이 event를 듣고 agent session을 스스로 여는 것(사람이 승인한 job이 event로 도는 것은 이 선 안이다). 앱 event의 저장, 구독자 cursor, 재시도, 멱등 key. agent event의 저장과 replay. (event로 도는 job은 2026-11-11에 열었다: 아래 "앱 event"의 안 구독자) event를 듣고 core가 일하는 것(`StateChanged`는 화면만 듣는다. 예외는 주의(`attention.md`) 하나다: 몇 event를 듣고 사람의 기기에 알리거나 못 본 turn 끝을 든다. 저장·cursor·재시도가 없는 메모리 구독이고 사람에게 알리는 것뿐이다). 바뀐 내용을 event에 실어 화면이 읽지 않고 고치게 하는 것. 이유는 모두 "결정"에 있다.

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
- session 밖에서 화면만 알면 되는 일이다. 메모리뿐이다. session이 없어 `subject`가 앱·release거나 null이다. `AcpUpdated`만 envelope에 `session`이 있어 session 조건에 걸린다.
- 종류: `AppViewChanged`(activation·grant·rewind 뒤 열린 앱 view를 다시 그리라는 신호), `AppRemoved`, `StateChanged`, `TerminalScreenChanged`(폰이 보는 coding session 터미널의 화면이 바뀐 뒤 한 번. subject는 `terminal:<터미널 탭 참조>`, payload는 `{terminal, seq}`뿐이고 내용은 싣지 않는다. 폰이 `terminal_view/snapshot`을 다시 읽는다. 기록도 replay도 없다), `AppRestartHalted`, `ActivationConsentRequested`·`ActivationConsentClosed`, `ShareRequestOpened`·`ShareRequestClosed`, `JobHeld`(job의 놓친 차례가 새 held 줄로 commit된 뒤 한 번. subject는 job. 폰 push의 계기이고 폰 event 목록에는 없다), `NoticePosted`·`NoticeClosed`·`NoticeRead`, `AppEventPublished`, `AppViewEvent`, `AcpUpdated`.
- `StateChanged`는 "이 대상이 바뀌었으니 다시 읽어라"뿐이다. payload는 `{changes: [{name, id}]}`이고 내용을 싣지 않는다. `name`은 화면이 읽는 단위의 닫힌 목록(`CHANGE_NAMES`: agents, projects, apps, app_runtime, app_grants, app_activity, releases, sessions, jobs, workflow_instances, settings, tray, secrets, providers, models, `unseen`, `coding_sessions` 등)이고 `id`는 그 단위 안의 대상(앱, job, session, 설정 key, secret 이름)이거나 null(단위 전체)이다. `unseen`은 못 본 turn 끝이 서거나 꺼질 때 core가 route 밖에서 내고 `id`는 session 참조(`ses_…`, 터미널은 `term:<탭>`)다. 화면은 `unseen/list`를 다시 읽는다. `coding_sessions`는 폰이 보는 coding session 목록이 바뀌었을 때(터미널이 오르내림, view 바꿈, 연결이 열리고 닫힘)는 `id`가 null이고, core의 사본이 snapshot으로 갈아 끼워지거나 사라질 때는 `id`가 그 session이다. core가 route 밖에서 내고 폰이 `coding_sessions/list`나 `acp/snapshot`을 다시 읽는다.
- `AppEventPublished`는 앱(또는 core)이 event를 낸 뒤 열린 앱 화면이 받게 하는 신호다(subject는 발행 앱, core면 null. payload는 `{source, event, payload}`). core의 view 표만 듣고 `AppViewEvent`로 바꿔 view를 연 host에 보낸다. 저장하지 않는다.
- `AppViewEvent`는 core의 view 표(`architecture/app-call.md`의 "앱 화면")가 view 하나에 내는 신호다. subject는 그 view의 앱이고 payload는 `{owner, view}`와 `kind`로 가르는 셋 중 하나다: `event`(묶인 release가 구독을 선언한 앱 event, `{source, event, payload}`), `rebound`(`AppViewChanged` 뒤 다시 묶음, `{release, bundle_hash, process_nonce}`. binding이 그대로여도 낸다), `lost`(다시 묶지 못함, `reason`: `app_stopped`, `app_archived`, `conflict`, `evicted`). 저장하지 않는다.
- 쓸 수 있는 type은 이 두 집합(agent event, 남지 않는 event)뿐이고 이름은 서로 겹치지 않는다. Bus에는 둘만 오른다.

session snapshot
- session의 지금 상태, 대기 중인 turn 안 request(`turn_requests`), 질문을 담는다. 읽는 곳은 대기 목록과 session 목록이다. 대화 화면이 읽는 상태(쓰는 중인 model 글, 도는 turn의 active, 올린 steer)는 ACP snapshot `AcpSnapshot`이 싣는다. 둘 다 화면이 붙거나 다시 붙을 때 읽는다.

입구
- Router는 "agent session에 입력을 넣는" 한 입구다. 사람 메시지, agent call, program의 알림, workflow의 step 메시지가 모두 여기로 들어가 run-loop queue로 간다.

### 앱 event

```
 앱 process: publish(name, payload) ── broker ─▶ core app_events.publish (actor app)
   · 발행 앱의 active release가 events에 선언한 event인가, payload가 payloadSchema와 맞는가(아니면 invalid_input)
   · 구독을 선언한(source = 발행 앱의 slug) active 앱 가운데 지금 그 release로 떠서 받는 앱을 모은다
   · 발행 기록 한 줄(누가, 어느 event, 언제, trace id, 켜져 있던 구독자 수 reachable, 닿지 못한 수 unreachable, 고리·깊이로 넘기지 않은 수 refused. payload 없음)
   ├▶ 구독 앱마다: 앱 호출 경로의 호출 하나(caller event). 구독 handler를 부르고 기다리지 않는다
   └▶ Bus: AppEventPublished ─ core view 표 ─ AppViewEvent(event, owner 거르기) ─ Gateway(owner) ─ shell main ─▶ 그 view의 화면(useEvent)
```

- 앱은 선언에 낼 event(이름, 설명, payload schema)와 들을 event(source, 이름)를 적는다. source는 발행 앱의 slug이거나 core가 내는 event의 `lophn`이다. 구독에 사람 허락은 없다. event는 발행 앱이 내놓겠다고 선언한 것이다.
- 전달은 구독 앱의 handler 호출 하나이고 그 순간 켜져 있는 구독 앱이 받는다. 저장, 구독자 cursor, 재시도가 없다. 놓쳐도 되도록 정본은 발행 앱의 read command이고, 구독 앱은 켜질 때 그것을 한 번 읽고 event로 고친다(lophn 화면이 snapshot을 읽고 event로 고치는 약속과 같다).
- 안 구독자: core 안의 jobs가 같은 전달에 앱이 아닌 구독자로 붙는다(`architecture/job.md`의 "event로 도는 job"). 앱이 낸 event와 core가 낸 `lophn` event를 모두 받고, 호출 기록도 발행 기록 수(reachable·unreachable)도 남기지 않는다. 승인하고 켜진 event job이 그 `lophn` event를 때로 가진 동안은 구독 앱이 없어도 core가 session 한 줄을 만든다. 저장하지 않고 켜져 있는 동안만 받는다. 앱 event의 사슬(chain)은 안 구독자에게도 간다(job이 부르는 앱이 사슬에 있으면 그 event를 보지 않는다). 안 구독자도 앱 구독자와 같은 보이는 범위를 지킨다: job은 그 앱(또는 session)의 workspace에 job의 workspace가 call 정책으로 닿을 때만 본다.
- 앱 화면은 같은 구독을 `lophnApp.events`(SDK `useEvent`)로 받는다. 화면이 떠 있는 동안만 받고, 그 화면의 release가 구독을 선언한 event만 받는다.
- 관측: 구독 handler의 호출은 앱 호출 기록(`app.invocations`)에 caller kind `event`로 남아 발행자와 event가 보인다. 발행 기록은 앱마다 최근 200개만 두고 payload를 남기지 않으며 agent가 `app.event_publications`(`lophn app event-publications`)로 읽는다. 발행과 거기서 나온 호출은 같은 trace id를 싣는다(`architecture/observability.md`).

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
17. 상태를 바꾸는 route는 무엇을 바꾸는지 route 정의의 `changes`에 적는다. command와 upload는 필수라 적지 않으면 build가 서지 않고, memory route는 상태를 바꾸는 것만 적는다. 대화(session, turn, message, tool call)처럼 agent event와 `AcpUpdated`가 이미 알리는 것은 빈 목록이다. command는 writer Worker가 그 tx에서 돈 command(`tx.call`로 다른 command 안에서 돈 것 포함)의 선언을 입력·결과로 풀어 모으고 commit된 결과에 실어, main thread가 `StateChanged` 하나로 낸다(같은 `{name, id}`는 한 번). 되돌아간 tx와 replay된 결과는 싣지 않는다. memory route와 upload는 입구가 handler 성공 뒤에 낸다.
18. route를 거치지 않고 core가 화면이 읽는 상태를 바꾸는 곳은 같은 내는 함수를 부른다: 설정 store(route, file watch, core 안 정리 모두 바뀐 key마다 `settings`), job scheduler, 앱 호출 기록(모든 호출의 시작·끝에 `app_activity`), 앱 OAuth 로그인 끝(`secrets`), preview의 시작·ready·끝(`app_runtime`, ready·끝은 supervisor가 `apps/record_preview`로 알린다), activation 진행(`releases`). core는 `StateChanged`를 듣고 일하지 않는다. job command 뒤 scheduler를 깨우는 것은 그 command의 commit 뒤 할 일로 따로 한다.

agent event와 화면
19. agent event는 저장하지 않고 replay하지 않는다. 대화의 정본은 session 기록이고, 놓친 화면은 snapshot을 다시 읽는다. 쓰는 중인 글과 도는 turn의 active는 core 메모리에만 있고 ACP snapshot이 싣는다. `writing_streamed`의 offset이 snapshot의 글 길이와 맞지 않으면 `reread`가 서고 화면이 snapshot을 다시 읽는다.
20. 화면은 조건을 걸고 `ready`를 받은 뒤에 snapshot을 읽는다. 읽고 나서 걸면 그 사이 event를 놓친다. 끊긴 연결은 replay 없이 처음부터 다시 맞춘다. 화면이 core 상태를 읽는 공통 길은 하나다(`useCoreRead`). read route 정의의 `reads`가 그 읽기가 기대는 이름(과 입력에서 뽑은 id)이고, 이름이 같고 어느 쪽 id가 null이거나 둘이 같은 `StateChanged`나 `ready`가 오면 다시 읽는다. 읽는 동안 온 것은 끝난 뒤 한 번만 다시 읽는다. 끊기면 옛 값을 stale로 둔다. check가 "`reads`의 이름을 내는 곳이 하나도 없다"를 잡는다. 내용을 접는 store(session 목록, Inbox, 대화)는 이 길을 쓰지 않고 내용 있는 event를 접는다.
21. 서버는 `watch` frame마다 받은 차례로 `ready` 하나를 답한다. shell main은 그 차례로 짝지어, 한 창이 조건을 바꿔 건 `watch`의 `ready`는 그 창에만 보내고 새로 붙은 연결의 `ready`만 모든 창에 보낸다. 창 안에서도 그 `watch`를 걸 때 아직 `ready`를 못 받은 구독자만 다시 읽는다. 기존 구독자는 서버가 동기로 다시 구독해 event를 잃지 않는다. tab 하나를 열고 닫을 때마다 모든 창이 snapshot을 다시 읽던 것을 막는다.
22. session을 건 조건은 session이 없는 event(남지 않는 event)와 맞지 않는다. 그런 event는 종류 조건으로만 받는다. 섞어 쓰면 전역 대기 목록이 조용히 빈다. `AcpUpdated`는 subject가 null이지만 envelope의 session이 조건에 걸린다.
23. 구독 조건은 "어느 session의, 어떤 종류"다. 조건 여럿은 OR이고 같은 event는 연결 하나에 한 번만 간다. 조건 없는 구독은 아무 event도 받지 않는다. `AppViewEvent`는 조건과 따로 payload의 owner가 그 연결의 owner(사람 token 연결은 credential의 principal)일 때만 간다. owner를 받지 않은 연결에는 가지 않는다. view는 그것을 연 사람·기기의 것이라 다른 연결이 그 화면의 앱 event와 binding을 보면 안 된다.
24. core는 toast를 모르고 toast는 shell의 정책이다. 끊긴 사이 놓친 toast는 다시 띄우지 않는다. 앱 멈춤(`AppRestartHalted`)·activation 동의 요청·앱 공유 요청의 toast는 renderer가 남지 않는 event를 듣고 띄운다. agent의 turn 끝·권한 물음·질문 알림은 renderer가 아니라 shell main이 같은 event를 듣고 터미널 agent와 같은 규칙으로 toast나 OS 알림을 정한다(`architecture/terminal-agent.md`).
25. 사람 화면에 가는 것은 앱 화면과 agent 결과(대화)뿐이다. call의 진행은 agent끼리의 일이라 화면의 대상이 아니다.
26. 꺼졌다 켜지면 돌던 turn은 interrupted로 닫고 그 turn의 turn 안 request와 질문은 cancelled다. activation 동의 대기는 apps의 표에 남는다(`architecture/activation.md`).

앱 event
27. 발행은 반드시 발행 앱의 active release가 선언한 event이고 payload가 선언한 schema(와 16 KiB 한도)에 맞는다. 아니면 `invalid_input`이고 아무에게도 가지 않고 기록도 없다. 발행 앱은 입력에 없다. 앱 자식 credential이 정한다.
28. 발행은 구독자를 기다리지 않는다. 부모 invocation이 돌고 있지 않아도 된다. 구독자가 늦거나 실패해도 발행은 그대로다. 구독자 호출의 결과는 그 호출의 invocation 기록이 말한다.
29. 구독 선언 없이 받지 않는다. 앱 process는 active release가 선언한 (source, event)의 구독자일 때만 호출을 받고, 앱 화면은 그 화면의 release가 선언한 것만 받는다. 켜져 있지 않은 구독자는 받지 못하고 그 수는 발행 기록의 `unreachable`이다(process handler를 등록했는데 받을 수 없는 구독자만 센다. process가 떠 있고 handler를 등록하지 않은, 화면만 구독하는 앱은 process 전달 대상이 아니라 reachable도 unreachable도 아니다). 나중에 따라잡게 하는 저장은 없다.
30. 구독 handler의 호출은 앱 호출 경로의 호출이라 호출 기록, write 줄, changeset(rewind 대상)을 다른 호출처럼 거친다. 전달은 구독자를 기다리지 않아 발행 앱의 호출이 이미 끝난 뒤에 구독자가 다시 낼 수 있으므로, 고리는 살아 있는 호출 표가 아니라 event가 싣고 온 chain(이 event를 부른 인과의 앱들, 발행자 포함)으로 끊는다. 구독 handler 안에서 낸 event의 chain은 그 handler가 불린 event의 chain(호출 기록에서 읽는다)에 이어지고, 구독자가 chain에 이미 있거나 chain이 깊이 한도(8)에 닿았으면 호출을 넘기지 않는다. 넘기지 않은 수는 발행 기록의 `refused`에 남는다(말없이 버리지 않는다).
31. 발행 기록에 payload 본문을 남기지 않는다. 기록은 앱마다 최근 200개다.
32. 앱 event는 core가 반응하는 길이 아니다. core 로직은 앱 event를 듣고 일하지 않고(반응은 위 1~5와 같은 이유로 그 일을 아는 command가 한다), program이 event로 agent session을 열지 않는다.
33. core도 발행자다(`lophn`). core가 낸 event(`session.started|running|waiting|idle|ended`, `architecture/workspace-session.md`)는 같은 전달 길을 쓰되 앱마다 볼 수 있는 것만 간다: 그 앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace의 session(call 정책)만 구독자 호출과 앱 화면(`AppEventPublished`의 `audience`)에 간다. 같은 길로 `call.settled`(call, state, fail_reason)가 앱이 보낸 call이 끝났을 때 그 앱에만 간다(`audience`가 보낸 앱 하나, 그 앱의 열린 화면이 듣는다. 켤 때 닫힌 call(`lophn_restarted`)의 event는 가지 않는다. `architecture/agent-call.md`의 "앱이 보낸 call"). core event의 payload schema는 선언이 아니라 protocol에 있다. 앱의 발행과 달리 chain은 비어 있고(앱의 호출 사슬이 아니다) 발행 기록은 publisher `lophn`으로 남되, 볼 수 있는 구독자가 하나도 없으면 기록도 announce도 하지 않는다(상태가 바뀔 때마다 표에 쓰지 않는다).
34. 앱은 자기가 낸 event를 받지 않는다. event의 chain에는 늘 발행자가 들어 있어(발행 handler 밖에서 낸 것도 그렇다) 발행자 자신의 구독은 구독자 목록에서 refused로 센다. 앱이 자기 event에 반응하는 길은 없다.
35. core의 session event는 상태가 바뀐 순간에만 간다. core를 다시 켠 뒤에는 돌던 session이 `session.idle`을 내지 않는다(켤 때 모든 turn이 interrupted로 닫히고 그 닫힘은 상태 변화로 세지 않는다). 앱은 켤 때와 core가 다시 떴을 때 목록을 다시 읽는다. 터미널 session은 shell main이 다시 알린 집합으로 채워진다.

## 경계와 계약

boundary: `events`(commit 뒤 agent event와 남지 않는 event를 화면에 내는 Bus와 Gateway), `event-stream`(core가 확정한 event의 stream).

- Gateway: WebSocket, subprotocol `lophn.gateway.1`. 받는 principal은 사람 token(shell main)이다. `AppViewEvent`는 연결의 owner(principal)가 연 view의 것만 받는다. replay도 ack도 없다. pairing한 폰은 remote 연결 안에서 같은 frame(`watch`, `ready`, `event`, `closed`)을 같은 Bus 구독과 느린 구독자 한도로 받는다. principal은 `device:<id>`이고 구독 조건의 모양은 사람 token과 같다. 다만 core가 기기에는 event 종류 목록(`REMOTE_ALLOWED_EVENTS`: session·turn의 시작과 끝, turn request·질문·activation 동의·공유 요청의 열림과 닫힘, `AcpUpdated`, notice, 화면 갱신의 `StateChanged`, `TerminalScreenChanged`)의 type만 보낸다. 조건에 types가 없어도 같다. 앱 event(`AppEventPublished`)와 설정·앱 설치 event는 폰에 가지 않는다.
  - client frame은 `watch {conditions}` 하나다. 연결 안에서 다시 보내면 조건을 통째로 바꾼다. 잘못된 frame은 `closed` 없이 끊는다.
  - server frame은 `ready`(조건이 적용됐다), `event {event}`, `closed {reason}`(`slow_consumer` | `credential_revoked` | `shutdown`)다. 느린 구독자는 `closed` 뒤 1013으로 끊는다.
- `/host-link`는 Gateway가 아니다. shell main이 core와 요청·보고·coding session·터미널 화면 frame을 주고받는 따로 열린 연결이고 event를 구독하지 않는다. 연결은 한 번에 하나이고 event 연결 한도(32·principal당 4)에 들지 않는다([platform.md](platform.md)).
- 구독 조건: `{session?, types?}`. 생략한 칸은 제한하지 않는다. event가 맞으려면 (session이 없거나 event의 session과 같고) 그리고 (types가 없거나 event의 type이 들어 있다).
- shell main은 renderer들이 건 조건과 자기 조건을 합쳐 같은 것은 한 번만 걸고, 연결이 끊기면 마지막 확인 시각을 남긴 채 stale로 알리고 다시 붙는 것은 connection이 맡는다.
- 앱 event(core가 낸 `session.*`도 같은 전달 길): route `app_events.publish`(actor app, memory), 읽기 `app.event_publications`(`app` 필수, 선택 `event`, cursor, limit ≤ 200. actor user·agent·machine. 범위 밖 앱은 `not_found`). 호출 caller `{kind: event, publisher, event, publication, trace_id, chain, parent_invocation}`. ledger 표 `app_event_publications`(`id` `pub_…`, `publisher`, `release`, `event`, `trace_id`, `at`, `reachable`, `unreachable`, `refused`).
- 읽기: `events/list`(`after_seq`, 필터 `types`·`subjects`, `limit`; 응답에 `scanned_through_seq`, `head_seq`; actor user·agent·app·machine). `session_snapshots/list`(`sessions` 생략하면 열린 session 전부, 없는 id는 뺀다; actor user). 대화 상태는 `AcpSnapshot`.
- 기록 event의 모양: `seq`, `type`, `subject`, `actor`, `turn`, `payload`, `at`. agent event의 모양: `session`, `type`, `at`, `payload`. 남지 않는 event의 모양: `type`, `subject`, `at`, `payload`.
- type 이름은 `<Entity><과거형 동사>` PascalCase다.
- 주요 payload: `ModelOutputStreamed {turn, model_call, kind: text|reasoning, offset, text}`(offset은 같은 model_call·kind에서 앞서 낸 글의 UTF-16 길이이고 redaction을 거친 글로 센다. 다른 model_call의 조각이 오면 앞 model 호출의 쓰는 중인 글을 버린다). `TurnEnded`의 `active_ms`(사람 기다림을 뺀 일한 시간). `NoticePosted`의 payload는 notice 행 한 건. `StateChanged {changes: [{name, id: string | null}]}`(하나 이상). `AppRestartHalted {app_name, release, crashes}`.
- session snapshot 한 건: `session`, `agent`, `workspace`, `state`, `turn_requests`, `questions {group, turn, tool_call, to_parent}`. 질문 내용은 싣지 않고 질문 read가 준다.
- `events` 표의 저장 모양과 immutable 보장은 storage의 ledger가 맡는다.

## 결정

- 반응할 domain event를 모두 지우고 Reactor(cursor, 멱등 key, backoff, 5초 poll)도 지웠다. 반응이 필요한 10개 안팎을 domain event로 남겼으나 그 일도 아는 command가 같은 tx에서 하게 되었고, 마지막 반응(맡긴 coding session의 끝)도 command가 같은 tx에서 call을 닫게 되어 반응할 event 없이 장치만 남았다. 같은 사실을 두 길이 알리게 하는 문제도 있었다. 버린 안: Reactor 유지, lophn 사용자에게 hook을 여는 것. 상태는 각 module의 표가 정본이다. (agent)
- core가 Bus event를 듣는 것은 주의(`attention.md`)에 한정한다. 이유: 승인·질문·turn 끝·앱 동의·job의 놓친 차례를 아는 곳이 Bus이고, 사람의 폰에 알리려면 core가 그것을 듣고 보고 있는 기기를 알아야 한다. 저장도 cursor도 재시도도 없이 사람에게 알릴 뿐이라 지운 Reactor의 짐이 돌아오지 않는다. 사람에게 보이는 알림이 아닌 일(agent나 앱에 반응)은 여전히 듣지 않는다. (agent)
- 일반 change notification(`StateChanged`)을 둔다. 전에는 "받을 화면이 없다"며 두지 않고 job, workflow instance, 설정, tray만 종류마다 "다시 읽어라" event를 두었다. 이제 화면이 는다(창 둘, 폰). 바꾸는 쪽도 는다(CLI, agent, scheduler, 앱). 기능마다 손으로 단 event는 상태를 바꾸는 route 절반 가까이에서 빠져 있었다. 그래서 그 넷을 `StateChanged` 하나로 합쳤다. 화면 갱신만 하고 core는 듣지 않아 옛 Reactor의 짐(저장, cursor, 재시도)이 돌아오지 않는다. (사람이 방향을 냄, 2026-11-14. 모양은 agent)
- 선언은 handler가 아니라 route 정의에 둔다. 이유: 내는 것을 잊지 못하게 type으로 막고, 화면 쪽이 같은 계약에서 읽기의 기댐(`reads`)을 읽는다. 버린 안: handler마다 event를 내기(지금까지의 방식), route의 `resource`를 그대로 대상으로 쓰기(다른 resource를 바꾸는 command와 여러 표를 모아 읽는 read가 많다). (agent)
- `StateChanged`에 내용을 싣지 않는다. 실으면 event마다 schema와 접는 코드가 생겨 손으로 다는 것으로 돌아간다. 잃는 것은 줄 하나가 바뀌어도 그 읽기를 통째로 다시 하는 것이고, 한 사람이 쓰는 양에서는 문제가 아니다. 잦은 것(대화)은 내용 있는 event를 그대로 쓴다. (agent)
- 열린 앱 view를 다시 bind하라는 `AppViewChanged`, shell의 정리 신호 `AppRemoved`, 내용을 싣는 event, toast 계기는 `StateChanged`로 합치지 않았다. 다시 읽기가 아니라 다른 일을 시킨다. (agent)
- agent event를 저장하는 안은 버렸다. 조사한 harness(Claude Code, Codex, OpenCode, Hermes 등)와 paseo 모두 대화는 session 기록이 정본이고 event는 흘리는 신호다. seq와 replay는 비용만 든다. 대신 snapshot에 대기 중인 요청까지 담아, 늦게 붙은 화면도 답을 기다리는 요청을 본다.
- agent event 집합은 여러 harness의 lifecycle을 나란히 놓고 공통분모로 골랐다. 그때 함께 쓰던 coding session 층은 지웠고(`architecture/coding-agent.md`) 지금은 lophn session만 낸다. model 호출의 시작·끝은 event로 두지 않고 쓰는 중인 글만 흐른다.
- 맡긴 coding session의 끝은 새 event 없이 그 끝을 아는 command가 같은 tx에서 call을 닫는다. 줄에서 띄우지 못한 call은 `failed`고, 켤 때는 Router의 복구가 닫는다. (agent)
- program이 agent를 부르는 reaction을 모두 지웠다. 앱 오류가 나면 앱 workspace의 session을 자동으로 여는 흐름은 problem 상태 machine과 보고 길이 계약에 비해 무거웠고 진단은 agent가 앱 log를 직접 읽으면 된다. 마지막 것(activation 실패)은 `release.activate`의 결과가 대신하고 사람에게는 toast가 남는다. 정기적으로 앱을 살피게 하려면 사람이 시킨다(job이나 workflow). (사람, 2026-10-20: 앱 문제로 agent를 자동으로 열지 않는다. 나머지 reaction 정리는 agent)
- 앱이 자기 업무 사실을 lophn에 밀어 넣어 core가 반응하게 하는 길(push)은 없다. agent가 읽기 앱 tool로 읽는다. event로 도는 job은 이 선 밖의 별개 길이다(2026-11-11, 아래 안 구독자). 사람에게 알리기(cap-notify)는 앱이 연 길이다. 캘린더의 일정 알림이나 사용량 앱의 한도 경고처럼 사람이 알아야 하는 일을 앱이 알릴 길이 없었고, 받는 쪽이 사람의 Inbox와 toast뿐이라 agent나 program의 반응을 일으키지 않는다. (사람, 2026-11-05. 받는 쪽은 사람뿐이라는 모양은 agent의 추천을 사람이 받음)
- "일하는 시간"(active)은 사람 기다림을 뺀다. 이를 아는 core가 `TurnResumed`를 내고 turn이 끝난 순간까지 active를 마감해 `TurnEnded`에 싣는다. 멈춤·실패·끊김으로 끝나는 turn도 같다. (agent)
- 쓰는 중인 model 글은 core가 쌓인 글 전체를 redaction하고 secret이 시작됐을 수 있는 끝을 붙잡은 뒤 낸다. 조각 단위로 거르면 조각 경계에 걸친 secret이 샌다. 붙잡는 자리는 child에 알리지 않는다.
- 한 창이 건 `watch`의 `ready`는 그 창에만 보낸다. 창 하나가 조건을 바꿀 때마다 모든 창이 snapshot을 다시 읽던 낭비와, `ready`를 기다리는 동안 쌓인 event를 읽기가 끝나지 않았다고 버리던 문제를 막는다. (agent)
- core 안에서 command를 내는 곳은 접힌 writer를 쓴다. 날 writer를 쓰던 때 event가 Bus에 닿지 않고 call 본문 준비와 queue 적용이 빠져 reaction이 session을 열지 못하고 annotation 전달이 turn을 열지 못했다. (agent)
- `session_snapshots/list`를 core가 단다. snapshot은 화면이 붙거나 다시 붙을 때 대기 중인 허락 request와 질문을 맞추는 계약인데 한때 handler가 없어 읽기가 `unavailable`이었다.
- ledger의 쓰이지 않던 domain event 제한 옵션은 지웠다. 반쯤 만들고 안 쓰는 길은 지우고 필요해지면 그때 다시 만든다.

- 앱 event를 연다. 앱끼리의 일대다(한 앱이 사실을 내고 여러 앱이 듣는다)가 많을 것이라는 사람의 요구다. 2026-11-05에 닫았던 이유는 "반응을 믿게 할 장치(저장, 구독자 cursor, 재시도, 멱등 key)가 다시 필요하다"였고, 그 약속을 하지 않으면 장치가 필요 없다. event는 일이 일어난 뒤의 알림이고 core는 답을 기다리지 않으며(hook이 아니다) 전달은 한 번이고 저장하지 않는다. 놓쳐도 되도록 정본은 발행 앱의 read이고 구독 앱은 켤 때 한 번 읽는다. 쓰는 예(구독 한도 감지, process 감시)는 지금 상태가 중요한 일이라 이 약속으로 된다. 버린 안: 저장하는 event(구독자 cursor와 재시도), hook. (사람, 2026-11-10)
- 구독에 사람 허락을 두지 않는다. event는 발행 앱이 내놓겠다고 선언한 것이다. (사람, 2026-11-10, 추천대로)
- 구독 handler는 별도 호출 종류가 아니라 operation 자리의 이름 `on.<source>.<event>`로 부르고 선언에 따로 이름을 적지 않는다. 이유: handler 이름 공간을 하나로 둔 채(겹침 검사, ready probe의 선언·등록 대조. 구독 handler는 등록이 필수가 아니다: 화면만 구독하는 앱은 등록하지 않고, core는 probe가 알린 등록 이름으로 handler가 없는 앱 process에는 보내지 않는다) 앱 process의 `subscribe(source, event, handler)`가 이름 하나로 등록하고, 호출 종류를 늘리지 않는다. 구독마다 handler 이름을 따로 고르게 하면 선언과 코드가 어긋날 곳만 는다. (agent)
- 구독 handler의 effect는 write로 고정한다. 앱 DB를 바꿀 수 있어 changeset을 뜨고 rewind 대상이어야 하고, 선언에 effect를 두면 read로 선언한 handler가 DB를 바꿨을 때 rewind가 틀린다. 읽기만 하는 handler도 write로 기록되는 값이 든다. (agent)
- 발행 기록은 ledger 표에 앱마다 최근 200개만 두고 payload를 남기지 않는다. 숫자는 앱의 영구 알림 한도(app-notice.md)와 같다. 메모리에만 두면 재시작 뒤 "어제 낸 event가 누구에게 갔나"를 읽을 수 없다. 표는 invocation 기록과 같은 짧은 연결로 쓰고 event를 남기지 않는다. (agent)
- 발행과 거기서 나온 호출은 같은 trace id를 싣는다. trace는 요청 하나(발행 route)의 trace이고, 발행 기록과 호출 caller에 같은 id를 적는다. invocation 표에 trace 칸을 따로 두지 않았다. 그 id는 호출 caller 본문에 있어 기록의 caller로 읽는다. (agent)

## 열린 것

- 기동 중에 쓴 notice는 shell main이 core의 hello 전이라 `NoticePosted`를 받지 못해 toast가 뜨지 않는다. 배지와 History로만 보인다(`project-docs/issues/`의 shell 이슈).
