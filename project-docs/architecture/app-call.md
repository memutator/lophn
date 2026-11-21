# app-call

앱은 선언에서 두 층을 내놓는다. 화면과 앱 자신이 쓰는 저수준 동작인 operation(`operations[]`)과, 앱이 골라 바깥에 내놓는 command(`commands[]`)다. operation은 사람이 연 앱 화면과 그 앱 workspace session의 preview만 부른다. command를 부르는 길은 넷이다: agent의 명령 `lophn <app> <command>`(`<app>`은 앱 slug), 다른 앱, job이 연 tool run(program), flow instance가 연 tool run(flow). 앱이 내는 event를 받은 구독 handler(event)도 같은 호출 경로의 호출이다(아래 "앱 event"). 다른 컴퓨터의 앱 command는 agent와 앱이 `remote` target으로 부르고 받는 컴퓨터는 그 호출을 caller `remote`로 지난다(아래 "다른 컴퓨터의 앱 부르기"). 어느 길이든 같은 판정(부른 쪽 확인, 막기)과 같은 기록(invocation)과 같은 직렬화(write는 앱마다 하나씩)를 거치고, write 동안의 앱 DB 변경은 changeset으로 떠서 invocation에 붙여 보관한다. 그래서 "이 호출이 앱 data에 한 일"을 호출 단위로 알고, 사람이 고른 시점으로 앱 data를 되돌릴 수 있다(rewind). 같은 문서가 앱의 화면과 agent의 접점(앱 화면이 쓰는 agent session), 앱 log, 앱 process가 바깥으로 나가는 길(net, secret, OAuth, fs), 보관한 앱의 지우기도 다룬다.

## 문제

- 앱 tool을 부르는 길이 여럿(사람의 화면, agent, 다른 앱, job, flow)이면 판정, 기록, 줄 세우기가 길마다 흩어진다. 한 길이 빠지면 그 호출의 변경이 기록에 없어 되돌릴 수 없고, 막아야 할 호출이 지나간다.
- 앱 data는 앱 코드(AI가 만든 코드일 수 있다)가 바꾼다. 앱이 되돌림 기능을 따로 짜게 하면 앱마다 맞게 짜야 하고 틀려도 알 수 없다. 사람은 "이 호출이 무엇을 바꿨나"를 알고 한 시점으로 앱 data를 되돌릴 수 있어야 한다.
- 화면용 저수준 동작이 모두 agent tool이 되면 agent 계약(할당, 결과 크기)이 화면 기능을 깎는다.
- 앱 코드는 바깥(network, secret)으로 나간다. 값이 앱에 닿으면 응답, 오류, log로 새는 길을 앱 코드마다 막아야 한다.
- 앱이 무슨 일을 했는지 남지 않으면 agent도 사람도 앱을 진단하지 못한다.

## 목표와 비목표

- 목표: 모든 앱 호출이 같은 길(core)을 지나 판정, 기록, 직렬화되고 호출 단위로 changeset이 붙는다. 사람이 시점을 골라 앱 data를 되돌린다. 앱의 진단 단서(invocation, 상태, log)를 agent가 읽는다. 앱의 바깥 접촉은 사람이 선언과 grant로 허락한 만큼이고 secret 값은 앱 코드가 보지 못한다.
- 비목표:
  - 호출 하나만 빼는 되돌리기와 되돌린 것을 다시 하기(redo)는 없다. 읽기 의존을 알 수 없다.
  - agent에게 rewind tool을 주지 않는다.
  - 앱 process의 OS 권한(network, 파일)을 막지 않는다. 사람이 정했다. 허락은 lophn SDK를 지나는 요청에만 걸린다.
  - 저장하는 problem 모델(열림·닫힘 상태, 묶음)은 없다. lophn은 log를 남기고 읽게만 한다.
  - 앱이 되돌림 tool을 선언하게 하지 않는다.
  - 호출에 호출자 범위를 싣지 않는다.

## 모델

### 선언의 두 층

- 선언은 두 목록이다. operation은 `{name, title, effect}`이고 입력 schema가 없다(입력 검사는 앱 코드의 일이다). command는 `{name, description, inputSchema, effect, public}`이다. 두 목록을 합쳐 이름이 하나이고 handler는 이름 하나로 등록한다.
- `effect`는 `read`, `write`, `external`이다. program이 강제한다(write 줄, 기록). command의 `public`은 그 앱 workspace 밖에 보이는지다.
- 이름은 1~64자 `[A-Za-z0-9_.-]`이고 command schema의 root는 `object`다(인자가 없으면 `inputSchema: null`). agent wire 이름 `<slug>_<command>`의 64자 한도와 이름 겹침은 slug를 아는 쪽(`declaration.check`와 release 기록)이 검사한다. SDK의 선언 정의는 slug를 모른다.
- 선언 이름은 handler·grant·job이 참조하는 ID다. CLI는 그 이름의 `.`을 낱말 경계로, `_`를 `-`로 바꾼다. 선언 검사와 CLI·prompt·help는 같은 변환을 쓰고, 변환 후 command 이름이 겹치면 slug 없이도 선언을 거절한다. 최상위 입력 필드의 flag도 `_`를 `-`로 바꾸며, boolean의 `--no-`까지 포함해 겹치면 거절한다. nested object는 JSON 값이므로 flag 충돌 검사 대상이 아니다. 선언과 저장된 입력의 원래 이름은 바꾸지 않는다.
- 내장 명령 묶음 이름은 앱 slug로 쓰지 못한다. `app.create`가 `invalid_input`으로 거절한다.
- 선언의 `events`와 `subscriptions`는 앱 사이의 알림이다(없어도 되는 칸). `events`는 `{name, description, payloadSchema}`(payload는 command의 `inputSchema`와 같은 규칙, root는 object)이고 `subscriptions`는 `{source, event}`(source는 발행 앱의 slug나 `lophn`)다. 구독 handler의 이름은 `on.<source>.<event>`로 정해져 operation·command와 한 handler 이름 공간에 들고, 64자를 넘거나 다른 이름과 겹치면 선언 오류다. 앱 slug `lophn`은 쓰지 못한다(core가 발행자일 때의 source 이름). 칸이 없거나 비면 정본 json에 칸을 두지 않아 옛 선언의 hash가 그대로다.
- 선언의 `skills`는 앱이 내놓는 skill이다(없어도 되는 칸). 항목은 `{name, public, commands}`다. `name`은 skill 폴더 이름 규칙(소문자·숫자·`-`, 64자까지)이고 겹치지 못하며, `commands`는 이 선언의 command 이름이다. `public`이 true인 skill은 다른 agent에게도 가므로 `commands`가 모두 public command여야 한다. 없는 command나 비공개 command를 쓰는 public skill은 선언 오류다. 칸이 없거나 비면 정본 json에 칸을 두지 않아 옛 선언의 hash가 그대로다.
- 선언의 화면은 `{key, label, path, places, params?, tray?}`이고 `places`가 그 화면이 열릴 수 있는 자리다. 자리는 `tab | panel | card | sidebar | tray | phone`이다. `tab`은 앱 workspace 본문과 앱 전용 창(둘 다 `tab` 자리를 가진 첫 화면), `panel`은 project dock·desk float·전역 float, `card`는 대화의 앱 카드, `sidebar`는 오른쪽 sidebar, `tray`는 작업 표시줄 tray, `phone`은 폰 앱이 그리는 React Native 화면이고 혼자 선다(소스, build, 폰의 guest runtime은 `architecture/phone-screen.md`). `places`는 비어 있거나 겹칠 수 없다.
  - `params`는 화면이 받는 인자의 입력 schema(root는 object)이고 없으면 그 화면은 인자를 받지 않는다.
  - `tray`는 tray popup의 크기 `{width?, height?}`(px)이고 `places`에 `tray`가 있을 때만 둔다. 각 쪽은 숫자(고정)나 `{min?, max?}`(내용에 맞춤)다. 없는 칸은 정본 json에 두지 않아 옛 선언의 hash가 그대로다.
  - 옛 `sizes`(`full`)는 `places`(`tab`)가 됐다. 저장된 release 행의 선언은 ledger step `apps.releases.declaration-places`가 옮기고(`declaration_hash`는 준비 때 낸 값이라 그대로), `sizes`로 봉인한 bundle은 manifest hash가 묶여 있어 뜨지 않으며 앱을 다시 release해야 한다. 선언에서 `domain` 칸을 지운 판 뒤로도 옛 판으로 봉인한 bundle은 뜨지 않고 다시 release해야 한다.

### 호출의 흐름

```
 person ── shell 앱 화면 (operation) ──┐
 agent  ── lophn <app> <command> ──────┼─ core-api(app.call_tool) ─▶ 호출 경로
 app    ── sdk ─ broker (command) ─────┤              1 부른 쪽 확인        (credential, 도는 turn·부모 invocation·job run·instance)
 program ── job run의 tool run ─────────┤   (core 안 run 연산만. route로는 못 연다)
 flow  ── instance의 tool run ──────────┤   (같다)
 event ── 앱이 낸 event를 받은 구독 handler ┤   (core 안 발행 처리만. route로는 못 연다)
 remote ── 다른 컴퓨터의 core가 넘긴 호출 ──┘   (받는 기계의 apps/remote_call만 만든다. route로는 못 연다)
                                             2 막기               agent는 할당(judge), program은 통과(사람이 등록을 승인한 job), flow는 project workspace의 agent의 할당(unattended)과 비공개 거르기, event는 통과(구독은 발행 앱이 내놓은 event를 받겠다는 선언),
                                                                  앱은 active 앱 grant의 app.call. 묻지 않는다
                                             3 write·external이면 앱별 줄을 얻는다. read는 바로
                                             4 invocation 시작을 남긴다        ─▶ storage (ledger + changeset blob)
                                             5 보낸다
                                                │ child-supervision-protocol (supervisor가 길만 이어 준다)
                                                ▼
                                    앱 process (sdk runtime): handler 실행
                                    write·external 동안만 SQLite session ─▶ 결과와 changeset을 응답에 싣는다
                                                │
                                             6 invocation을 끝으로 남기고 changeset을 붙인다 ─▶ 부른 쪽에 결과

 rewind (사람만): 되돌릴 목록 ─▶ 앱 접수 닫기·drain ─▶ changeset을 최신부터 뒤집기(base)
                  ─▶ 앱 process가 한 transaction으로 적용(sdk) ─▶ 되돌림 표시, 접수 열기
 session rewind에서 사람이 앱을 고르면 같은 rewind로 간다 (workspace-session)
```

invocation의 끝 상태는 성공, 실패, 막힘(`denied`), 결과 모름(`unknown`)이고, 되돌림이 끝난 행에는 되돌림 표시가 붙는다. `caller_kind`는 person, agent, app, program, flow, event, remote 일곱이다.

다른 기계의 앱을 부르는 호출은 이 흐름의 1 앞에서 갈린다. agent와 앱이 `app.call_tool`의 target `{mode: remote, machine, app}`으로 부르면 부른 쪽 확인(1) 바로 뒤에 core가 command인지, caller가 agent나 앱인지 보고 그 기계로 넘긴다(그 기계의 앱을 이 기계의 선언·Gate·줄·기록으로 다루지 않는다). 받는 기계는 새 입구 route `apps/remote_call`로 받아 자기 호출 경로를 caller `remote`로 지난다. 호출 기록은 받는 기계에 `remote`(어느 컴퓨터의 누가)로 남는다. 요청한 쪽과 받는 기계가 요청한 쪽마다 하는 일은 `architecture/approval.md`의 "다른 기계로 넘긴 call"이다.

### 다른 컴퓨터의 앱 부르기

내 컴퓨터들은 같은 사람의 것이고 앱 id는 컴퓨터 사이에 같다. agent, 앱, 사람의 터미널이 다른 컴퓨터의 앱 command 하나를 부르는 길이다. 대상은 command뿐이다(operation과 다른 컴퓨터의 agent에게 일 맡기기는 아니다).

```
 agent ── lophn <앱> <command> (할당 줄 (컴퓨터, 앱)) ─┐
 앱 ── connectCommands(…, {on: "컴퓨터"}) ────────────┼─ app.call_tool(target remote) ─ 부른 쪽 확인 ─ 보내기 전 검사 ─▶ link ─┐
 사람의 터미널 ── lophn <앱> <command> --on 컴퓨터 ── machines/call (terminal) ─────────────────────────────────────────▶ link ─┤
                                                                                  받는 컴퓨터: apps/remote_call ◀──────────────┘
```

- 누가 부르나: agent는 사람이 부르는 컴퓨터에서 그 agent에 할당한 `(컴퓨터, 앱)` 줄이 있고 command가 뺀 것이 아닐 때, 앱은 active grant의 `app.call`이 그 앱을 덮을 때, 사람의 터미널은 `lophn <앱> <command> --on <컴퓨터>`다. 컴퓨터는 이름, `mch_`, `dev_`로 고르고 같은 이름이 둘이면 후보를 보이며(`invalid_input`) 이 컴퓨터를 고르면 `invalid_input`이다. 앱이 붙이는 칸은 broker 본문의 `machine`이고 SDK `connectCommands`의 `on`이 채운다. 앱의 command는 최상위 입력 필드 `on`을 선언하지 못한다(CLI의 `--on`과 부딪힌다).
- 판정은 두 번 한다. 부르는 컴퓨터가 보내기 전에 지금 규칙을 먼저 본다: 부른 쪽 workspace의 private, 받은 호출을 다시 넘기지 않기(둘 다 `forbidden`), 할당과 grant(없으면 `denied(gate_blocked)`). 아니면 아무것도 보내지 않는다. 받는 컴퓨터가 자기 data로 다시 본다: 요청한 컴퓨터가 명단에 있는지, 터미널 입력 허락이 있는지, command가 `public`인지, 대상 앱의 workspace가 private이 아닌지(`approval.md`). 앞의 판정이 뒤를 대신하지 않고 뒤의 판정이 앞을 다시 따지지 않는다. 컴퓨터는 서로 대등하다.
- 받는 컴퓨터는 호출을 caller `remote {machine, device, requester}`로 지난다. 요청한 쪽(`screen`, `terminal`, `agent`, `app`)은 call frame의 `by`로만 오고 부른 컴퓨터가 쓴 값이라 이름은 주장된 대로 기록한다. 받는 컴퓨터의 handler가 자격을 만들고 `app.call_tool`로는 이 caller를 주장하지 못한다.
- 받은 호출은 다른 컴퓨터로 다시 넘기지 않는다. 받는 컴퓨터에서 도는 앱이나 다른 컴퓨터의 event(또는 받은 호출이 낳은 이 기계의 event)로 연 job의 tool·agent가 `remote` target을 부르면 부르는 쪽 컴퓨터가 거절한다.
- 다른 컴퓨터가 준 글은 믿지 않는다. agent가 보는 command 목록(`machines/app_tools`가 그 컴퓨터의 `apps/tools`를 읽는다)은 이 컴퓨터가 낸 선언이 지나는 이름 규칙과 schema 검사로 다시 거르고(틀린 command만 뺀다), 설명·schema·개수·답 전체에 상한을 두고, 읽는 데 짧은 시한(5초)을 둔다(닿지 않으면 "지금 닿지 않는다"). agent에게는 컴퓨터 이름을 붙여 보이고(tool 이름 `<slug>.<command>.on_<컴퓨터 id의 끝 8자>`) 결과가 말하는 빠진 secret은 그 컴퓨터에서 채우라고만 말한다.
- 연결에서 앱 command는 화면이 부르는 `machines/call`·나르기와 자리를 나눠 쓴다(`command` 자리 4개, 시한 10분; 화면·나르기는 8개, 120초). 보냈는데 답을 잃은 호출은 `unknown`이고 보내지 못한 호출은 `unavailable`이다(`details.sent`가 나갔는지 말한다).
- 부르는 컴퓨터는 보낼 때 가벼운 기록(`app_remote_calls`: caller, 대상 컴퓨터·앱·command, 시작·끝 시각, 상태 또는 `unknown`, 오류 한 줄)을 남긴다. changeset과 rewind는 없고, `app.remote_calls`로 읽어 App details의 Activity가 다른 컴퓨터로 보낸 호출로 함께 보인다(받는 컴퓨터가 꺼져 있어도 읽힌다). 기동 때 `running`으로 남은 줄은 `unknown`으로 닫는다.

### 앱 event

한 앱이 사실을 내고 여러 앱이 듣는 일대다를 위한 길이다(사용량 앱이 한도를 감지해 알리면 다른 앱이 반응한다). 계약은 `architecture/event.md`의 "앱 event"다. 여기에는 호출 경로에 닿는 부분만 적는다.

- 발행은 앱 process의 `publish(name, payload)`(`@lophn/cap-tool`) → broker → core route `app_events.publish`(actor app)다. 앱은 입력에 없고 자식 credential이 정한다. 부모 invocation이 돌고 있지 않아도 된다(시작 코드, timer). core가 active release의 `events` 선언에 그 event가 있고 payload가 `payloadSchema`와 맞는지 본다(아니면 `invalid_input`).
- 전달은 발행 앱의 slug로 `subscriptions`를 선언한 active 앱 가운데 지금 그 release로 떠서 받는 앱마다 구독 handler를 호출 경로로 부르는 것이다. 발행은 구독자의 답을 기다리지 않고, 저장도 재시도도 없다. 켜져 있지 않은 구독자는 받지 못하고 발행 기록의 `unreachable`로 센다.
- 다른 기계에서 온 event(선언 `across_machines`, `event.md`)도 같은 길이다. 도착한 기계의 core가 그 기계의 구독자를 같은 전달로 부르고, caller의 `machine`과 발행 기록의 `machine`이 난 기계를 싣는다. 사슬(`chain`)은 도착한 앱 하나에서 새로 시작한다(다른 기계의 호출 사슬은 오지 않는다).
- 호출 기록의 caller가 발행자와 event를 싣고, 발행 기록(`app_event_publications`)의 id와 trace id를 같이 싣는다. 그래서 `lophn app invocations`의 한 줄이 "어느 앱의 어느 event가 불렀나"를 말하고, `lophn app event-publications`가 같은 trace id로 몇 구독자에게 갔는지를 말한다.

### 앱의 session 시야

앱 process와 앱 화면은 lophn의 agent session을 읽고 멈춘다(`architecture/workspace-session.md`의 session lifecycle). 앱 process는 broker(`/_lophn/broker/sessions/*`) → core route `app_sessions.list|status|stop`(actor app, 자식 credential 허용 목록)만 쓰고(열기·끝내기·call 보내기는 앱 process에 없다), 앱 화면은 `lophnApp.sessions`를 shell main이 사람 자격으로 부르며 sender view의 앱을 입력에 싣는다. 보이는 session은 그 앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace의 것뿐이고(`mayReachWorkspace`: agent 쌍 규칙 없이 workspace 쌍 규칙, 같은 workspace, private) 안 보이는 session은 없는 session과 같다. 멈춘 것은 program 기록(`session_stopped_by_app`)으로 남는다. 부모 invocation이 돌고 있지 않아도 된다.

앱 **화면**은 agent에게 call을 보내는 쪽이기도 하다(`architecture/agent-call.md`의 "앱이 보낸 call"). 한 IPC 통로(`app:agents`, `{op, input}`)로 core의 `app_calls.*`·`app_agents.list`·`app_sessions.end`를, `lophnApp.agent.open`으로 `app_sessions.open`을 부른다(shell main이 앱을 싣는다). 앱 process에는 call 보내기와 session 열기·끝내기 길이 없다(상한 없는 unattended turn을 막는다). 앱이 열 수 있는 session은 기본이 그 앱 workspace이고 call 정책이 닿게 허락한 workspace에도 열 수 있다(`opened_by_app` 표시). 끝낼 수 있는 session은 자기가 연 것뿐이다. call의 끝남은 `lophn`의 `call.settled` event로 그 앱의 화면에만 간다.

### 앱 log

앱이 무엇을 했는지는 호출 기록(invocation)과 앱 log가 말해 준다. log는 앱마다 file 하나로 쌓고 supervisor 한 곳만 쓴다.

```
 앱 stdout·stderr (SDK reportProblem의 줄 포함, `[inv=<id>] ` 머리는 떼어 invocation 칸에) ─┐
 잡히지 않은 예외 (SDK가 frame 풀이 전의 stack을 broker로 보냄) ──────────────────────────┤
 앱 process의 비정상 종료 (supervisor가 관측) ───────────────────┤
 화면 오류 ── shell main ─ core(app.log_view_error) ─ supervisor ─┤
                                                                 ▼
                       app supervisor: 줄마다 redaction ─▶ 300자로 자름 ─▶ 줄 하나 ({ at, invocation, text })
                                                                 ▼
              <data root>/apps/<app>/logs/app.log  ── 8 MiB를 넘길 줄이면 app.log.1로 옮기고 새로 쓴다
 읽기: app.logs ─ core가 app.log.1, app.log를 직접 읽어 거르고 알려진 secret 값을 한 번 더 지운다 (supervisor가 없어도 읽힌다)
```

### 화면과 agent session

앱 화면은 preload의 `lophnApp`으로 host(desktop은 shell main)에 닿는다. host는 화면마다 view id를 붙여 core의 view 표에 열고, operation 호출과 앱 event는 그 view id로만 core를 지난다. 어느 앱·release에 묶였는지, 무엇을 부를 수 있는지는 core가 정한다. 화면이 열릴 때 자리, 인자, workspace가 정해지고 열려 있는 동안 바뀌지 않는다. 화면이 앱 workspace의 agent session과 이야기하는 길(`lophnApp.agent`)은 ACP를 지나고, 앱 화면이 보낸 것은 operation처럼 "그 앱을 쓰는 사람의 메시지"로 core에 간다.

## 지키는 것

### 호출 경로

1. 모든 호출은 core가 기록한다. 화면에서 앱으로, 앱에서 앱으로 가는 직통 통로를 두지 않는다. 막기, 기록, write 줄이 core 한 곳에 있어야 changeset이 빠지지 않는다. 예외 하나: 폰에서도 도는 앱(선언 `runs_on`에 `phone`)의 폰 화면이 부르는 read와 write operation은 컴퓨터에 닿을 때도 폰 안에서 돌아 core를 지나지 않는다. 그 호출은 폰이 컴퓨터에 닿을 때 `app_sync/push`로 오고 core가 그때 invocation 하나로 기록한다(caller는 기기가 붙은 `person`, effect는 `write`, 바뀐 것은 effective changeset). 그래서 Activity와 rewind가 덮는다. 같은 앱의 `external` operation은 폰이 outbox를 먼저 보낸 뒤 이 문서의 길(view 표)로 컴퓨터를 지난다. 폰에서 도는 앱의 길은 `app-sync.md`다. 다른 기계에서 폴더로 온 변경도 같다: 그 기계에서 이미 기록된 호출이고, 받는 컴퓨터가 변경 하나를 invocation 하나로 기록한다(caller는 출처 기계가 붙은 `person`, operation과 시작 시각은 주인 것, 바뀐 것은 effective changeset. `folder-sync.md`).
2. 부른 쪽은 호출 본문이 주장하는 대로 믿지 않고 core가 확인한다. credential의 종류와 caller 종류가 맞아야 하고, agent는 지금 도는 turn의 tool call이어야 하고, 앱은 활성 release이면서 부모 invocation이 지금 도는 호출이어야 하고, program은 본문의 job과 job run이, flow는 본문의 instance가, event는 본문의 발행자·event·publication·trace id·부모 invocation이 core가 만든 자격과 같아야 하고, remote는 본문의 컴퓨터·기기·요청한 쪽이 받는 기계의 입구가 call frame에서 만든 자격과 같아야 한다. 끝난 turn이나 꺼진 판의 호출이 섞이면 막기와 기록이 틀린다. agent, 앱, program, flow, event, remote는 늘 live 활성 release만 부른다(agent와 앱의 `remote` target은 그 기계에서 같은 규칙을 지난다).
3. tool 호출은 부른 workspace를 싣지 않는다. 어느 workspace가 불렀는지는 부른 session의 workspace로 안다. 앱 코드가 호출자별로 data를 나누는 관례는 core가 지키지 못하므로 호출에 범위를 싣지 않는다.
4. operation은 사람(화면)과 그 앱 workspace session의 preview만 부른다. agent, 다른 앱, job, flow가 operation을 부르면 handler에 보내기 전에 `denied(gate_blocked)`다. 화면용 저수준 동작이 agent 계약(할당, 결과 크기)에 묶이지 않게 하려는 것이다. 화면의 호출은 core의 view 표(`app_views.call`)를 지나고, 그 view에 묶인 release(preview는 preview bundle)의 선언에 있는 operation만 부른다. command, 구독 handler, 다른 앱의 이름은 호출 경로까지 가지 않고 같은 `forbidden`(operation is not available)이다. 호출 대상(앱, release, preview nonce)과 caller(`{kind: person, view_session: <view id>}`)는 표의 binding에서만 온다.
5. 호출 경로는 묻지 않고 막기만 한다. 판정 자리는 write 줄 앞이다. 막히면 `denied(gate_blocked)`다.
   - agent의 호출은 그 agent의 지금 할당을 `judge`로 본다(할당 안 된 앱, 뺀 tool이면 막는다). 사람에게 묻는 자리는 run-loop tool gate 하나다(`architecture/approval.md`). agent의 호출이 여기 닿았으면 물을 것은 이미 물었다.
   - 앱의 호출은 부른 앱의 active grant 가운데 `app.call`이 그 대상 앱의 그 tool을 덮는지 본다. 앱이 앱을 부르는 것은 activation 때 사람이 grant로 허락한 것이라 묻지 않는다.
6. program은 job이 연 tool run의 호출이다(`architecture/job.md`). 부른 쪽 사람이 없고 부른 turn도 없다. 자격(job, job run)은 route가 만들지 못하고 core 안 run 연산이 만든다. caller 본문은 `{kind: program, job, job_run}`뿐이고 자격과 같아야 한다.
   - 판정은 하지 않고 통과한다. 허락은 사람이 그 job의 등록을 승인한 것이다(`architecture/job.md`의 지키는 것, 등록 승인). scheduler는 승인한 job만 돌리고, 할 일(앱, tool, 입력)은 승인 뒤 바뀌지 않고, program 자격은 core 안 run 연산만 만든다. 만든 agent의 할당과 비공개 규칙은 보지 않는다.
   - 그 밖의 줄, 기록, 직렬화는 다른 호출과 같다.
7. flow는 workflow instance가 연 tool run의 호출이다(`architecture/workflow.md`). program과 같은 길이지만 판정이 있다. 자격(instance, 그 project workspace와 그 agent)은 core 안 run 연산만 만들고, caller 본문 `{kind: flow, instance}`의 instance가 자격과 같아야 한다. 판정은 그 project workspace의 agent의 지금 할당과 비공개 규칙(그 agent가 놓인 workspace)이다. code를 쓴 것이 그 agent라 code로 그 할당을 넓히지 못한다. 사람이 그 agent에게 그 앱을 할당해야 flow가 그 tool을 쓴다.
8. 앱 process의 caller parser, SDK의 호출 context, invocation의 caller 모양은 protocol schema의 손 사본이라(앱 process는 schema 검증 library를 싣지 않는다) caller 일곱 종류를 protocol과 같이 받아야 한다(손 사본은 SDK `cap-tool`의 호출 문맥, 앱 process entrypoint의 caller parser, core의 invocation 문맥 셋이다). 하나라도 빠지면 그 caller의 호출이 앱에서 말없이 거절된다. invocation 표의 `caller_kind` CHECK는 literal 목록이라 종류를 더할 때마다 표를 다시 짜는 ledger step이 필요하다(`apps.invocations.event-caller`가 `event`를, `apps.invocations.remote-caller`가 `remote`를 더하며 행, index, trigger를 그대로 옮겼다). 손 사본의 `remote` caller, event의 `machine`, broker 본문의 `machine?`은 protocol과 같은 모양이어야 한다.
9. 앱 호출 사슬은 같은 앱이 다시 나오면(`call_loop`) 또는 깊이 한도를 넘으면 handler에 가기 전에 막는다. 앱끼리 서로 부르다 줄이 영영 풀리지 않는 것을 막는다.
10. event 전달은 앱 호출 경로의 호출 하나다(caller `{kind: event, publisher, event, publication, trace_id, chain, parent_invocation, machine?}`). 구독 handler는 operation 자리로 부르고(선언에 따로 없는 이름이라 core의 선언 찾기가 구독만 operation으로 찾아 준다) effect는 write로 고정한다. 앱 DB를 바꿀 수 있어 changeset을 뜨고 rewind 대상이어야 하기 때문이다. 사람이나 다른 caller가 그 이름을 부르면 `denied(not_declared)`다. Gate는 묻지 않는다: 구독은 발행 앱이 내놓은 event를 받겠다는 선언이고 사람 허락을 두지 않았다. event로 이어지는 고리는 살아 있는 호출 사슬로 끊을 수 없다(전달은 구독자를 기다리지 않아 발행 앱의 호출이 먼저 끝난다). 그래서 caller의 `chain`(이 event를 부른 인과의 앱들, 발행자 포함)이 사슬을 싣고 간다: 구독 handler 안에서 낸 event의 chain은 그 handler가 불린 caller의 chain(호출 기록에서 읽는다)에 이어진다. 구독자가 chain에 이미 있거나 chain이 깊이 한도에 닿았으면 호출을 넘기지 않고 발행 기록의 `refused`에 센다.
11. 다른 기계의 앱은 command만, agent와 앱만 부른다. target이 `remote`인 호출에서 operation이거나 caller가 사람·program·flow·event·`remote`이면 `forbidden`이다. 사람의 화면과 터미널은 이 길이 아니라 `machines/call`로 다른 기계를 부른다. 부르는 기계가 보는 것은 할당과 private뿐이고(`architecture/approval.md`), 받는 기계가 자기 규칙(명단, 터미널 입력 허락, 대상 앱 workspace의 private, `public` command)을 따로 본다. 요청한 쪽은 call frame의 `by`로만 오고 `apps/remote_call`의 입력에는 그 칸이 없다. 받는 기계의 handler는 `by`가 없는 호출을 거절한다. 부르는 기계의 `remote` target은 Gate를 지나지 않으므로 보내는 쪽이 할당(`remote_apps`의 줄과 뺀 command), 앱의 `app.call` grant, 부른 workspace의 private을 보낸 뒤가 아니라 보내기 전에 본다.
12. 받은 call은 다른 기계로 다시 넘기지 않는다. 도는 호출(flight)이 caller가 `remote`이거나, 다른 기계의 event로 불린 handler·job(`program`, `agent`)이거나, 부모 호출이 그렇다는 표시를 쥐고, 그 안에서 `remote` target을 부르면 부르는 기계가 거절한다. 그러지 않으면 A의 요청이 B를 거쳐 C까지 닿아 B의 허락이 A에 넓어진다.

### 공개 범위와 사용 관계

1. 비공개 command는 그 앱 workspace의 session만 본다. 다른 workspace(home, project, 다른 앱)의 session은 `public` command만 본다. agent가 command를 찾는 길, `app.tool_index`, Grants 탭 후보가 같은 규칙이다. flow instance가 연 tool run은 목록이 없어 부를 때 instance의 agent(`workflow.yaml`의 `agent`)가 놓인 workspace로 같은 규칙을 본다. job이 연 tool run은 사람이 승인한 job이라 거르지 않는다. core의 할당 쓰기는 거르지 않으므로 agent에게 막는 곳은 이 거르기다.
2. 사용 관계(`app.usage`)의 쓰는 쪽은 그 앱 command를 부른 agent session의 workspace다. invocation 기록에서만 세고, home과 그 앱 자신의 workspace는 세지 않는다. 쓰는 곳이 있는 public command를 지우거나 비공개로 바꾸는 release는 막지 않고 `release.prepare`가 결과의 `removed_public_tools`에 그 command를 싣는다. 앱 prompt는 그런 release를 activate하기 전에 사람에게 묻지 않고 home의 lophn에게 결과를 받는 call로 알리라고 한다(home이 쓰는 workspace에 묻는다).
3. 공개였던 skill을 지우거나 비공개로 바꾸는 release도 막지 않는다. `release.prepare`가 결과의 `removed_public_skills`에 싣는다. skill이 부르는 command를 지우는 일은 `removed_public_tools`가 따로 싣는다.
4. 공유되는 skill은 active release의 것이고 core read `app.skills`(actor user·machine)가 읽는다. 입력은 앱 slug 목록(64개까지)이고 slug마다 active release 선언의 `skills[].public`인 skill을 bundle 사본의 `.lophn/skills/<name>/`에서 읽는다. 선언에 없는 폴더는 열지 않는다. 없는 slug, 보관한 앱, active release가 없는 앱, 읽을 수 없는 skill(폴더 없음, 큼, 머리 틀림, 폴더 이름과 `name`이 다름, bundle 밖을 가리키는 symlink)은 오류 없이 뺀다. 결과는 skill마다 `{app, slug, release, name, description, skill_md, files}`이고 `skill_md`는 SKILL.md 전체, `files`는 옆에 딸린 `.md`다. 같은 이름을 두 앱이 내면 받는 쪽이 slug 순으로 정한다. 파일을 읽으므로 메인 스레드 read다. 읽는 쪽은 할당받은 agent(`architecture/agent-definition.md`)와 coding agent의 사본(`architecture/coding-agent.md`)이다.
   - skill 본문은 앱 source의 commit 파일 `.lophn/skills/<name>/SKILL.md`다. 앱 template의 `.gitignore`는 SDK 설치 사본 `.lophn/sdk/`만 뺀다(옛 앱은 `.lophn/` 전체를 뺀 것을 앱 agent가 고친다).
   - release 준비는 선언한 skill마다(공개 여부와 관계없이) 그 파일이 commit에 있는지 본다. 없으면 `failed`이고 이유에 `.gitignore`가 `.lophn/`을 통째로 빼면 `.lophn/sdk/`로 바꾸라고 싣는다.

### 보관한 앱과 지우기

1. archived 앱은 agent에게 없는 앱이다. agent actor가 archived 앱을 읽거나 부르면 없는 앱과 같은 `not_found`이고, 목록은 그 앱을 뺀다. 사람(user)은 계속 본다(되살리기가 사람의 화면에서 일어난다). 필터는 앱 접근 판정 한 곳에 있고 앱 read·command가 모두 거치므로 `app read|status|logs|invocations|tools`, release 목록·읽기, rewind가 한 번에 닫힌다. 이 밖의 길 셋만 따로 같은 규칙을 둔다: `app.usage`의 앱 하나 읽기, release 준비와 `declaration.check`, 앱 command 호출(agent에게는 `not_found`로 바뀌고 사람 화면에는 `denied`다). `app.tool_index`, `app.skills`, 공유 skill·command 목록은 처음부터 active만 읽는다. `lophn package read <name> --version`의 사용처는 active 앱의 지금 켜진 release만 센다. 지난 release와 archived 앱은 그 SDK 판으로 더 돌지 않아, 센다면 home lophn이 고칠 곳을 잘못 짚는다.
2. 보관한 앱은 사람만 영구히 지운다(`app.delete`). 보관 → 지움 두 걸음이고 active 앱은 `conflict`다. actor는 user뿐이다(agent는 `forbidden`). 지운 뒤에는 되돌릴 수 없다.
   - ledger는 한 Tx에서 먼저 지운다. 순서는 blob 참조(복구본, changeset, annotation screenshot), annotation, 앱 알림, 그 다음 `activation_consents`·`activation_requests`·`app_data_records`·`invocations`·`app_rewinds`·`grants`·`releases`·`app_folders`·`app_icons`·`apps` 행이다. 이 가운데 DELETE trigger가 평소 막는 표를 위해 새 schema step `apps.delete.erase-windows`가 trigger를 erase window 조건부로 바꿨다(session delete와 같은 장치). 창은 이 command의 Tx 안에서만 열린다. 이 지우기는 invocation 기록을 지우지 않는다는 규칙의 유일한 예외다.
   - 같은 Tx에서 앱 workspace에 딸린 다른 module의 기록도 지운다: 그 앱 workspace의 session 전부(session delete 그대로: turn 닫기, 되돌리기 기록, blob 참조), 그 앱에 범위가 있는 agent 정의, 다른 agent의 할당(정의 파일 `apps`와 deny 규칙에서 이 앱을 뺀다), 그 앱을 부르는 job과 그 앱 workspace가 만든 job, 열린 앱 공유 요청. 파일 할당 정리는 앱 행이 있을 때 해야 deny 규칙을 풀 수 있어 앱 행보다 먼저다.
   - 그 앱의 process가 지금 살아 있으면(멈추는 중 포함) `unavailable`이다. 살아 있는 supervisor에 물어 process가 있을 때만 거절한다. ledger의 마지막 `AppStarted`는 보지 않는다: core가 꺼질 때는 `AppStopped`를 남기지 않아, 켜져 있다 꺼진 뒤 보관한 앱에 옛 사실이 영영 남기 때문이다. supervisor에 닿지 못하면 자식도 없는 것으로 본다. 살아 있는 preview는 먼저 멈춘다.
   - commit 뒤 파일과 설정을 정리한다. `<data>/apps/<app>/`(source 저장소, bundle, data DB, log, preview)를 지우고(읽기 전용 폴더가 있어도), 지운 session의 `tool-results/<session>`과 되돌리기 저장소를 지우고, 설정에서 이 앱을 가리키는 것을 뺀다(`shell.quick_launch`의 고정, `shell.app_launch`의 `<app>:*`, `shell.sidebar_panels_off`·`shell.tray_off`·`shell.tray_order`, coding agent 공유 slug). `source_path`를 data root 밖 폴더로 이은 앱은 그 폴더를 지우지 않는다(사람의 폴더다). 끊기면 ledger는 이미 지워져 앱은 없고 남는 것은 이름 없는 폴더뿐이다(실패는 log로 남는다).
   - shell은 남지 않는 event `AppRemoved`를 받아 정리한다. main이 browser 저장소(`persist:app-<app>:live`와 `persist:app-<app>:preview-*` partition: 저장소를 비우고 폴더를 지운다), 그 앱 workspace의 layout 파일, 전역 float 목록의 그 앱 float을 지우고, 열린 창의 전역 float 층도 그 앱의 float을 닫는다. 다른 workspace의 탭, 앱 panel, 고정 단추는 지우지 않는다: 보관한 앱은 이미 "앱이 없다" 안내나 건너뜀으로 그려지고 지운 앱도 같다. tray 값은 읽을 때 걸러져 사라지고 sdk status는 앱 목록에서 계산해 남는 것이 없다.
   - 지우지 않는 것: `events`(immutable이라 `AppCreated` 등과 새 `AppDeleted`가 남는다)와 `command_results`; program 알림(`notices.source='program'`, 기록이다. 읽는 쪽이 `apps`를 left join하므로 앱 이름이 빈 채로 읽힌다); 이 앱이 다른 앱 command를 부른 기록(그 다른 앱의 `invocations` 행이라 남고 caller에 지운 앱 id만 남는다); session의 되돌리기 결과(`rewind_apps`)와 `tool_calls`의 `app_tool`(다른 workspace의 기록); job run 기록, `runs`, `workflow_lines`(이력); 공개 SDK package와 판(지운 앱이 주인이던 package는 `owner_app`이 비어 다음에 publish한 앱이 이어받는다); secret 값(이름은 전역이라 다른 앱이 같은 이름을 쓴다); 이미 쓴 credential(`ended`로 닫히고, 열려 있어도 앱 대상 판정이 `not_found`다).

### write 직렬화와 changeset

1. write와 external은 앱마다 한 번에 하나다. core의 줄과 앱 process 안의 mutex, 두 겹이다. read는 동시에 돈다. SQLite session은 연결 단위라 두 write가 겹치면 한 changeset에 두 호출의 변경이 섞여 호출 단위로 되돌릴 수 없다. 줄을 쥔 호출이 돌아오지 않아도 줄이 영영 막히지 않게 abandon이 줄을 비운다.
2. changeset은 앱 process(sdk)만 뜨고 적용한다. 앱 DB는 그 앱의 process만 열기 때문이다. core는 보관하고, 뒤집고, 지휘한다.
   - sdk migration으로 만드는 표는 PRIMARY KEY가 필수다. 없으면 SQLite session이 그 표의 변경을 기록하지 않아, 되돌릴 수 없는데 되돌린 것처럼 보인다.
   - read tool이 DB를 바꾸지 않는다는 선언은 믿고 검사하지 않는다. 틀린 선언이 rewind를 충돌시키면 통째로 취소되고 이유가 남는다.
3. 보냈는데 응답을 못 받은 호출은 실패가 아니라 결과 모름(unknown)이다. 추정하지 않고 같은 일을 다시 부르지 않는다. 보내기 전에 막힌 것(앱이 멈춤, 연결 없음)은 `unavailable`로 구분한다. core가 다시 켜질 때 running으로 남은 invocation도 unknown으로 닫는다. 쓰기가 일어났는지 모르는 채 성공이나 실패로 적으면 rewind와 재호출이 틀린다. 한 앱의 문제가 부른 쪽의 다른 일을 멈추지 않는다.
4. invocation 기록은 지우지 않는다(앱을 지울 때만 예외). 끝난 행은 되돌림 표시와 changeset 정리 말고는 바뀌지 않고(trigger), rewind 기록도 불변이다. 성공한 read는 남기지 않고, 실패한 read와 막힌 호출(denied)은 남긴다. 감사와 session rewind 연결(session·turn별 write 목록)이 이 기록에서 나온다.
5. 크기 한도가 frame 한도와 어긋나 호출이 결과 모름이 되는 일이 없다. command 호출의 입력과 응답, operation 호출의 입력은 supervisor control frame 하나씩으로 오간다.
   - command의 결과 상한은 frame 한도에서 결과 밖 칸 몫(1 KiB)을 뺀 값이라, 상한 안의 결과는 changeset을 빼면 늘 frame에 든다. 입력 상한도 frame 한도 아래(target·envelope 몫 2 KiB를 뺀 값)이고, 넘는 입력은 core가 보내기 전에 `invalid_input`으로 거절한다. 큰 값은 blob이나 file로 넘긴다. command는 agent가 읽을 작은 결과가 맞아 frame 하나에 둔다.
   - 응답이 상한을 넘으면 앱 process가 changeset만 빼고 `changeset_dropped: "too_large"`를 싣는다. 호출은 결과 모름이 아니라 성공·실패로 닫히고 요약에 `changeset_dropped`가 남는다. 빼지 않으면 frame에서 거절되어 결과 모름이 되고 rewind가 통째로 막힌다.
   - operation의 응답이 frame 하나를 넘으면 supervisor가 같은 channel의 bytes frame과 `end`로 보낸다(응답 payload `{stream: <channel>}`). 응답 상한은 shell과 같은 8 MiB이고, operation의 결과 상한은 거기서 1 KiB를 뺀 값이다. 화면 목록 같은 큰 읽기를 전송 단위에 묶지 않으려는 것이다. 받다 끊기거나 기한이 지나면 결과 모름이다.

### rewind

1. rewind는 사람만 하고 시점 단위다. 고른 invocation부터 최신까지 live, 활성 release 안, 아직 되돌리지 않은 write·external을 모두 되돌린다. 누가 한 호출이든 같다. 읽기 의존을 알 수 없어 호출 하나만 빼낼 수 없고, 그 앱을 쓴 모두의 변경이 함께 사라지므로 agent에게 rewind tool을 주지 않는다.
2. rewind는 접수를 닫고 도는 호출을 drain한 뒤 적용한다(유예를 넘으면 취소). 어떤 길로 끝나도 접수를 다시 연다. 앱마다 applying rewind는 하나다.
3. changeset은 최신부터 뒤집어 한 transaction으로 적용하고, 충돌하면 통째로 취소한다. 반쯤 되돌아간 DB를 남기지 않는다. 그래서 뒤집은 changeset 전부가 요청 하나로 간다.
   - core는 control frame 한도를 넘을 수 있는 이 본문을 json 요청(`apps.apply`, payload는 `{ app }`) 뒤 같은 channel의 bytes frame과 `end`로 supervisor에 보낸다. 보내다 실패하거나 기한이 지나면 `abort`를 보내고 `unavailable`로 끝낸다. write 하나씩 나눠 보내면 중간 실패 때 일부만 되돌아간다.
   - 앱 process에 닿기 전에 막히면 rewind는 취소(`app_unavailable`)다. 보낸 뒤 답을 잃으면(끊김, 기한) 앱 DB가 되돌려졌는지 모르므로 취소가 아니라 결과 모름(`unknown`)으로 끝난다. 보낸 invocation 목록과 이유를 남기고 되돌림 표시와 sync log의 `rewind` 줄은 남기지 않는다. 다시 rewind하면 이미 되돌린 행은 앱이 충돌로 거절한다. App details는 `unknown`을 따로 그리지 않고 충돌 단계에 이유 글로 보인다.
4. 결과 모름으로 닫혀 changeset이 없는 write가 범위에 있으면 rewind를 막는다. 얼마나 바뀌었는지 모르기 때문이다. 크기 한도로 changeset을 못 붙인 write는 막지 않고 "DB를 되돌리지 못함"으로 표시한다.
5. 되돌린 invocation은 지우지 않고 표시한다. release를 넘는 rewind는 없다. activation이 끝나면 이전 release의 changeset을 지운다(invocation 기록은 남는다). 이전 release로 돌아가는 것은 activation의 일이다.
6. sync 앱(폰에서도 돌거나 `sync_to`가 있는 앱, `app-sync.md`)의 rewind는 적용한 effective 변경과 새 clock을 그 앱의 sync log에 `rewind` 줄로 남겨 폰이 받고 폴더로도 나간다. 폰이나 다른 기계에서 온 invocation도 범위에 다른 live write처럼 든다. rewind 전에 폰에서 했으나 그 뒤에 push된 변경은 규칙대로 적용된다(rewind는 그 시각의 컴퓨터 DB를 되돌리는 것이다).
7. session rewind는 앱 data를 저절로 되돌리지 않는다. 사람이 앱을 골랐을 때만, 함께 되돌아갈 목록을 보인 뒤 같은 rewind로 간다.

### preview

1. preview는 따로 띄운 process와 일회용 DB로 돈다. invocation을 남기지 않고(응답의 `invocation`은 null) rewind 대상이 아니다. 운영 앱의 drain과 정지에도 걸리지 않는다.
2. preview 호출은 그 preview bundle의 선언으로 tool과 effect를 판정한다. 아직 release에 없는 새 앱과 새 tool도 부를 수 있다. ledger의 `release`는 비울 수 없어 release 없는 bundle의 호출은 기록할 자리도 없다.
3. preview를 부르는 쪽은 사람과 그 앱 workspace의 session(`preview.call`)이다. agent caller는 그 앱 workspace의 session일 때만 preview target을 부르고, 다른 workspace의 session은 `forbidden`이다. 앱 workspace의 session이 지은 release를 운영 data 없이 확인하는 길이다. agent의 live 호출 규칙(활성 release, `release` 없음)은 그대로다.
4. preview는 shell의 preview 탭(`app_preview`, `workspace-layout.md` "agent가 연 탭")으로 본다. `lophn preview start`가 ready 뒤 그 탭을 열고, 사람은 앱 화면 탭의 [Preview]로 연다. 앱 live 화면은 preview 탭이 되지 않는다.

### 앱 화면

1. 화면이 열릴 때 자리·인자·workspace가 정해지고 열려 있는 동안 바뀌지 않는다(dock·float·전역 float는 모두 `panel`이라 자리가 바뀌는 경우가 없다).
   - view 열기 입력은 `place`와 선택 `params`, `workspace`(`{kind: project | home | app, id, folders}`. project면 기계를 넘는 id `identity`(pri | null)와 그 project가 전에 가졌던 id `formerIdentities`(오래된 것이 앞)도 싣는다)를 싣고, `card`는 `place`가 `card`일 때만 있다. live 열기는 release 판이 필수이고 preview만 판이 null일 수 있다. 판 없이 live를 여는 호출은 입력 type에서 막히고, shell main도 IPC 입력의 모양을 같은 규칙으로 한 번 본다(선언과 `params` 검사는 core가 한다).
   - core의 view 표(`app_views.open`)가 `params`를 그 release 선언의 그 화면 `params` schema로 검사해 정규화한다. `params`를 받지 않는 화면에 인자를 주거나 schema에 맞지 않으면 `invalid_input`이다. 선언을 읽을 수 있으면(live, release 있는 preview) 화면이 선언에 있고 자리가 그 화면의 `places`에 들어야 한다. 값은 화면의 주소 query(`place`, `params`, `workspace`)로 간다.
   - 화면은 preload의 `lophnApp.place`(`{place, params, workspace}`)를 읽고 SDK의 `usePlace()`가 그것을 감싼다. query가 없거나 틀리면 `place`가 null이고 `params`는 `{}`다. 전역 float는 workspace를 주지 않아 `workspace`가 null이다.
2. agent의 `visual.show {app, view, params?}`도 `params`를 받는다. `view`는 `card` 자리를 가진 화면이어야 하고(아니면 `not_found`) `params`는 그 화면의 schema로 검사해 맞지 않으면 `invalid_input`이다. 통과한 값은 message의 `app_card` part와 ACP의 `AcpCard`에 `params`로 실려 카드 view의 인자가 된다.
3. view binding은 core의 view 표다(`app_views.open|call|close`, 메모리에만 있다). view 하나가 어느 앱·release·process(bundle hash, process nonce)에 묶였는지, 어떤 operation을 부를 수 있는지, 어떤 앱 event를 받는지를 core가 정한다. desktop과 폰 host가 같은 표를 쓴다.
   - 신원은 host가 붙인 view id와 요청 credential의 principal(owner. shell main과 CLI는 `user`, 폰은 `device:<id>`)이다. 표의 key는 (owner, view)이고 다른 owner의 view는 없는 view와 같다. 화면 page가 낸 값은 신원이 아니다.
   - live view는 지금 도는 release를 따르고 card view는 묶인 release에 고정된다. 같은 인자로 다시 열면 지금 binding을 다시 읽어 돌려준다(host가 끊겼다 돌아올 때). card가 아닌 live view의 `release`는 처음 열 때의 전제일 뿐 신원이 아니라 다시 열기에서 견주지 않는다. 그래서 host는 다시 열 때 `release: null`을 보내, core가 view를 잃었어도(core 재시작, 내보냄) 지금 도는 release로 다시 연다. owner마다 64개이고 넘치면 가장 오래 쓰지 않은 view를 내보낸다. core가 shell보다 오래 살아 옛 view가 남기 때문이다.
   - release가 바뀌면(`AppViewChanged`) 표가 그 앱의 view를 다시 묶어 `AppViewEvent`(`rebound`나 `lost`)를 내고, 앱 event는 묶인 release가 구독을 선언한 live view에만 `AppViewEvent`(`event`)로 간다. `AppViewEvent`는 view를 연 owner의 Gateway 연결에만 간다(`architecture/event.md`).
   - shell main은 host다. view id를 정해 열고, 처음 보낸 열기 요청을 쥐었다가 다시 묶을 때(`rebound`·`lost`를 받았을 때, core에 다시 붙었을 때, core가 view를 모른다고 답했을 때) 같은 요청을 다시 보낸다. `app:call-operation`은 page 값에서 `{operation, input}`만 꺼내 그 view id로 `app_views.call`에 넘기고, `app:event`는 받은 `AppViewEvent`(`event`)를 그 view의 page에 옮긴다. 화면의 바깥 host(CSP)와 화면 byte는 shell main이 그 binding으로 정한다.
4. 다른 기계의 앱 화면. 이 컴퓨터의 창은 다른 기계의 앱 화면(탭의 앱 화면, 앱 panel, 세션 카드)을 그 기계의 view 표로 연다. 다른 기계의 앱은 live 화면과 읽기만 하는 App details를 연다: preview는 개발이라 이 컴퓨터의 것만 연다. 다른 기계의 App details는 그 기계의 core를 기기 route로 읽어(실행 상태, 이은 폴더, release 줄, Activity, grant, SDK 판, 따라가기 상태) 보이고, 이름·보관·icon과 실행 switch·폴더 더하기/빼기·돌아가기·거두기·secret·rewind 단추는 그리지 않는다(쓰는 route가 기기 목록에 없거나 이 컴퓨터의 창 통로를 거친다). secret이 든 지는 사람의 route(`secrets/status`)라 허락 없는 기기에는 모른다고 보인다. 동의 card는 그 기계 사람의 것이라 이 컴퓨터의 대기 panel로 열지 않는다.
   - 탭의 기계 범위가 다른 기계면 view 열기 입력에 그 기계가 실린다. 이 컴퓨터에 같은 앱 id가 있어도 탭의 기계의 것을 연다(기계마다 data가 다르다). 그 기계가 꺼져 있으면 탭 범위가 꺼짐 안내를 보인다.
   - binding은 그 기계의 `app_views.open|call|close`이고 shell main이 이 컴퓨터 core의 `machines/call`로 보낸다. owner는 그 기계가 보는 이 컴퓨터(`device:<이 컴퓨터>`)다. 화면 byte는 그 기계의 `apps/screen_file`(기기 call은 JSON이라 base64, 한 file 8 MiB), 바깥 host는 그 기계의 grant와 선언이다.
   - 앱 preload의 통로(`app:call-operation`, agent, session, call, project 읽기, 화면 오류)는 sender view가 묶인 기계의 core로만 간다. 그 기계는 이 컴퓨터를 기기로 보고 기기 route 목록으로 거른다. 목록에 없는 route는 그 기계가 `forbidden`으로 거절하고 shell main은 그 거절을 화면에 그대로 돌려준다(화면이 숨기지 않는다).
   - 앱 session·call route(`app_sessions.*`, `app_calls.*`, `app_agents.list`)는 사람 자격이면 입력의 앱을 쓰므로, 기기 owner는 앱 대신 자기가 연 view를 싣고 그 기계의 core가 view 표에서 앱을 정한다(view 없음·live 아님·묶음 잃음·다른 앱은 `forbidden`, 그 기기의 view가 아니면 `not_found`. `approval.md`의 기기 자격). 기기가 단 앱 이름표(`via_app`)도 그 앱의 live view가 있을 때만 붙는다.
   - 그 view가 열거나 읽은 agent session의 `AcpUpdated`는 구독자 `app-views`가 그 기계에 그 session만 걸어 받고(view를 닫으면 뺀다), 그 기계에 묶인 view에만 보낸다. 기계마다 session id가 따로라 다른 기계의 view로 가지 않는다.
   - 격리 자리: 이 컴퓨터의 앱은 `persist:app-<app>:live`와 host `app-<앱 ULID>`(바꾸지 않는다: 사람의 앱 저장소가 거기 있다), 다른 기계의 앱은 `persist:app-<app>:machine-<기계 ULID>`와 host `app-<앱 ULID>-<기계 ULID>`다. protocol handler와 network 판정은 host label을 견주므로 기계까지 견준다.
   - `AppViewEvent`는 shell main의 구독자 `app-views`가 기계마다 걸어(`machines/watch`) 받는다. 그 기계가 release를 바꾸면 이 컴퓨터의 view에도 `rebound`·`lost`가 온다. link가 끊기면 그 기계가 이 컴퓨터의 view를 모두 지우고(기기 연결이 닫힐 때와 같다), 다시 붙으면 shell main이 그 기계의 view를 같은 요청으로 다시 연다. 그 기계에서 지운 앱(`AppRemoved`)은 이 컴퓨터에 둔 그 기계의 partition만 비운다. 이 컴퓨터에서 지운 앱은 이 컴퓨터의 partition(live, preview)만 비운다.

### 앱 화면의 agent session

앱 화면은 자기 앱 workspace의 agent session과 ACP로 이야기한다(`lophnApp.agent`의 `open`, `snapshot`, `onUpdate`, `send`). shell main이 sender view에서 앱을 정하고 사람 자격(`coreInternal`)으로 core에 넘긴다. 따로 허락 단계가 없다.

1. `open({agent, title?})`의 `agent`는 agent의 handle이다. main이 core의 `app_sessions.open`을 부르고 core가 그 앱 workspace에서 보이는 agent(전역과 그 앱의 범위 agent, 그 workspace의 lophn) 가운데 handle로 id를 풀고, 못 찾으면(없거나 다른 workspace의 범위 agent) `not_found`다. `open`은 선택 `workspace`(`{kind: project|app, id}`)를 받는다. 빼면 그 view의 앱 workspace에 열고, 주면 그 앱이 call로 닿을 수 있는 workspace(call 정책)에만 열린다(아니면 `forbidden`). 열린 session에는 `sessions.opened_by_app`이 달린다. 보통 lophn session이라 sidebar와 채팅 탭에도 보인다. 앱은 고르는 workspace가 정책 안이어야 할 뿐 앱 id는 고르지 못한다. `title`을 주면 core가 연 직후 `RenameSession`으로 붙인다(이름을 못 붙여도 session은 열린 채다). 주지 않으면 제목은 첫 prompt 글이다.
2. `send`는 ACP 입력 `send`, `stop`, `answer`, `rename`만 넘기고(`send`에는 이 view의 앱을 이름표 `via_app`으로 싣는다: 앱 화면이 보낸 사람 메시지가 채팅 탭에서 친 것과 구별되게 채팅이 "via <앱>"을 붙인다. 이름표일 뿐 메시지는 사람의 것이다. page가 준 값은 덮는다. `architecture/acp.md`) 나머지(`decide`, `rewind`, `fork`, `run_shell` …)는 core에 닿기 전에 `forbidden`이다. 앱 코드는 AI가 만든 코드일 수 있고, 승인은 사람이 채팅 탭에서만 한다. 허용 목록이라 ACP에 입력이 늘어도 앱은 닿지 못한다.
3. `snapshot`·`send`는 먼저 그 session이 이 앱에 보이는지 core에 묻고(`app_sessions.list`의 session 한 건, 읽을 때마다), 안 보이거나 없거나 터미널 탭(`term:`)이면 `forbidden`이다. 보이는 session은 workspace와 상관없이 붙는다(앱 workspace에서 call로 닿을 수 있는 workspace의 lophn·harness session, private workspace는 안 보인다). 보내는 body의 상한과 입력 검사는 ACP 입력의 것이고 bridge는 자르지 않는다.
4. 앱 view는 보이지 않는 session을 읽지도 보내지도 못하고, 열기는 call 정책이 닿는 workspace이며, 갱신은 그 view가 읽은 session의 것만 받는다. 정책이 바뀌어 안 보이게 된 session은 다음 읽기·보내기부터 막히고, 이미 붙은 view의 갱신은 그 view가 다시 읽을 때까지 멈추지 않는다(알려진 한계).
5. `AcpUpdated`는 main이 type으로 구독해 그 session을 열었거나 읽은 view로만 보낸다. 그래서 앱이 기억해 둔 session에 다시 붙을 때는 `snapshot`부터 읽어야 갱신이 온다. view가 새로 열리면 기억도 비어 있다.
6. 앱 화면이 연 session은 알림 규칙이 다르다. 앱이 turn마다 agent를 부려 쓰므로(오목의 수마다 한 turn) turn 끝(완료·실패)은 알리지 않고 못 본 점(Finished)도 찍지 않는다. 승인·질문은 사람이 가야 풀리므로 그대로 알리되, 그 session을 쥔 앱 view가 focus 창에 보이면 보고 있는 것으로 쳐서 알리지 않는다. "앱이 연 session"은 core의 `sessions.opened_by_app`이 정한다(앱 화면이 연 것과 앱이 call로 열게 한 것. shell 메모리가 아니라 ledger라 shell을 다시 켜도 남는다). "쥔 view"는 그 session을 읽은 view별로 세는 소유다. 앱 view가 보이는지는 view가 보이는 동안 shell이 notice 쪽에 `{view_session, visible}`로 알린다. 그 session을 채팅 탭으로 보고 있을 때의 규칙은 그대로다(`architecture/terminal-agent.md`의 "알림").
7. bridge의 type은 일반 `LophnAppAgent<State, Update, Input>`이고 SDK가 ACP의 상태·갱신·입력 type을 채운다. 이 portable entry가 ACP protocol을 import하면 shell main의 type 검사가 base까지 읽어 깨지기 때문이다.

SDK `@lophn/agent`는 앱 코드가 bridge를 직접 부르지 않게 한다(template이 의존으로 싣는다).

1. `useAgentSession({agent, title?, session?})`는 `session`이 없으면 첫 `send`에서 `title`로 session을 연다. 화면을 연 것만으로 열면 sidebar에 빈 session이 쌓인다. `session`을 주면 그 앱 workspace의 기존 session에 다시 붙는다: 바로 snapshot을 읽고 `send`도 거기로 가므로, 화면이 다시 load돼도(workspace를 떠났다 돌아온 경우) 앱이 저장한 id로 진행 중 turn의 답을 이어 받는다. 앞 session에 다시 붙으려면 앱이 그 session id를 저장해 두었다가 넘겨야 하고, 넘기지 않으면 화면이 열릴 때마다 첫 `send`에서 새 session이다. `agent`나 `session`이 바뀌면 session을 바꾼다. `rename(title)`은 ACP `rename`이고, `reset()`은 지금 session을 잊어 다음 `send`가 새 session을 열게 한다(`close()`는 구독만 푼다).
2. 보내는 중이거나 turn이 도는 동안(`state.turn`이 `ended`가 아닐 때)은 SDK가 스스로 `lophnApp.setKeepAlive(true, <key>)`를 켜서 workspace를 떠나도 page를 살려 둔다(앱의 `useKeepAlive`와 key가 달라 서로 끄지 않는다. `architecture/workspace-layout.md`). 열자마자 snapshot을 읽고, 그동안 온 갱신은 모았다가 접고, `reread`가 서면 다시 읽는다.
3. 앱 context는 `contextBlock({name, mimeType, text})`가 `resource` block(uri `app-context:<name>`)으로 싼다. prompt 조립은 앱 코드의 몫이다.
4. 꼴이 있는 답은 `send(blocks, {reply: schema})`다. SDK가 꼴을 알리는 글 block을 덧붙이고, 그 turn이 끝나면 마지막 agent 메시지 글의 마지막 ```` ```json ```` 블록(없으면 글 전체)을 꺼내 schema의 `type`·`properties`·`required`·`items`·`enum`만 검사한다. 맞지 않으면 값이 아니라 오류(`{ok: false}`)이고, 멈추거나 실패한 turn도 오류다. core는 꼴을 모른다.
5. SDK가 보내는 입력은 `send`, `stop`, `answer`, `rename`뿐이다. 승인 결정과 줄 고치기는 lophn 채팅 탭에서 한다.

### 앱 화면의 project 읽기

project별 data를 다루는 앱은 project를 따로 만들지 않고 lophn project를 기준으로 쓴다. 앱 data는 project의 `identity ?? id`를 key로 붙이고, 화면이 project workspace에서 열리면 그 project로 거르고 그 밖에서는 모든 project를 묶어 보인다. 앱 data는 기계 사이에 맞춰지므로(`folder-sync.md`, 폰) key는 다른 기계에서도 같은 project를 가리키는 `identity`(`project-identity.md`)여야 한다. `id`(`prj_`)는 이 기계에서만 뜻이 있다. `identity`가 null인 project(아직 나누지 않은 git project)는 `id`로 붙고 그 data는 이 기계에 머물며, 나중에 `identity`가 생기면 앱이 `id`로 붙은 줄을 `identity`로 옮긴다(SDK guide "project에 붙는 앱"). `identity`가 다른 값으로 바뀌면(사람이 잇거나 나눈다, id file이 ledger의 id를 대신한다) 옛 값이 `formerIdentities`에 남고 앱은 같은 write operation으로 옛 값으로 붙은 줄도 옮긴다(`project-identity.md` "옛 identity").

1. 화면은 `lophnApp.projects.list()`로 모든 project(보관 포함)를 읽는다. shell main이 sender view를 확인하고 사람 자격(`coreInternal`)으로 core `projects.list`를 끝 page까지 읽는다. 따로 허락 단계나 선언 permission이 없다.
2. 앱에는 `{id, identity, formerIdentities, name, title, purpose, status}`만 준다(`formerIdentities`는 core `projects.list`의 `former_identities`). 폴더 path는 주지 않는다. 앱 code(AI가 만든 code일 수 있다)가 모든 project의 폴더 위치를 알 까닭이 없고, 지금 열린 project의 폴더는 `place.workspace.folders`로 이미 간다.
3. 읽기만 연다. project 만들기와 고치기는 사람이 lophn 화면에서 한다. 변경 push는 없다. 화면이 다시 읽는다(SDK `useProjects().reload`).

### 앱의 컴퓨터 명단 읽기

앱이 "내가 어느 컴퓨터에서 도나, 다른 컴퓨터는 무엇이 있나"를 알아야 하는 때(`connectCommands`의 `on`으로 다른 컴퓨터의 앱을 부르려고 컴퓨터를 고른다)를 위해 core가 한 읽기를 준다. 앱이 data root(`machine.json`)나 hostname, `/proc`으로 알아내지 않게 하려는 것이다.

1. core 읽기 `machine/computers`(`machine.computers`)는 사람의 컴퓨터 명단(폰 제외)에 이 컴퓨터를 더해 `{id(mch_), name, status, current, always_on}`로 돌려준다. 새로 저장하는 상태는 없다: 이 컴퓨터는 machine 신원과 always-on 표시에서, 다른 컴퓨터는 명단의 link 상태(`machines/list`와 같다. `connected`는 `online`)와 폴더로 받은 기계 기록의 `always_on.keep_running`(기록이 아직 없으면 null)에서 합친다. 한 core가 답하므로 `current`는 그 core의 컴퓨터다.
2. "이 컴퓨터"는 앱 backend가 도는 컴퓨터다. 앱 backend는 broker `/_lophn/broker/machines/list`로 부르고(자식 연결이 앱을 정하고 그 자식의 app credential로 이 route를 부른다), 앱 화면은 `lophnApp.machines.list()`(IPC `app:machines-list`)다. shell main이 sender view를 확인하고 `projects`와 같이 view의 기계(`view.machine`)의 core로 부른다. 그래서 다른 컴퓨터의 창에 그려진 화면은 그 화면의 backend가 도는 컴퓨터의 core가 답하고 자기를 `current`로 적는다. 이 route는 기기 route 목록(`REMOTE_ALLOWED_ROUTES`)에 있다.
3. 사람 허락(grant)도 선언 permission도 없다. 컴퓨터 이름과 켜짐 상태이고, 사람이 연 앱이 자기 컴퓨터를 아는 것은 앱의 기본 사실이다(`projects` 읽기와 같다). 읽기만 연다. 켜짐 상태의 push는 없고 화면이 `reload`로 다시 읽는다. `always_on`은 기록이 마지막으로 읽힌 때의 값이다(실시간이 아니다).
4. SDK: 화면 `@lophn/app-ui`의 `useMachines()`, backend `@lophn/cap-tool`의 `machines()`. 둘 다 같은 모양이고 `status`의 이름이 `@lophn/ui`의 `MachineOption`과 같아 `MachineSelector`에 그대로 넘긴다. `id`는 `connectCommands(…, { on })`에 그대로 쓴다.

### 앱 log

1. 앱 log는 앱마다 `<data root>/apps/<app>/logs/app.log`와 돌린 앞 file `app.log.1` 둘이다. file 하나는 8 MiB까지이고 앱마다 합쳐 16 MiB다. 줄을 더해 8 MiB를 넘게 되면 `app.log`를 `app.log.1`로 옮기고(앞 `.1`은 버린다) 새 `app.log`에 쓴다.
2. JSON Lines이고 줄마다 `{ at, invocation, text }`다. `invocation`은 아는 줄에만 있고 아니면 null이다. 앱 안에서 SDK가 invocation 문맥으로 찍는 줄(`reportProblem`, 잡히지 않은 예외)만 invocation을 싣고, 그 밖의 stdout·stderr 줄은 null이라 시각으로 찾는다.
3. 쓰는 쪽은 app supervisor 하나다. 앱 process에 log를 쓰게 하지 않는다.
4. 줄의 출처는 다섯이고 `text`의 꼴이 다르다. 앱의 stdout·stderr 한 줄은 그대로(머리 `[inv=<id>] `만 떼어 `invocation`으로), SDK `reportProblem(name, message?, details?)`은 `error <name>[: <message>][ <details JSON>]`, 잡히지 않은 예외는 `exception <name>: <message>` 한 줄에 이어 봉인된 bundle의 source map으로 원래 source 줄로 푼 frame마다 `  at <path>:<line>:<column>`, 화면 오류는 `view_error <observation> <name>: <message>`(observation은 page가 낸 `error`·`unhandledrejection`·`render_error`와, handler에 닿기 전에 거절된 화면의 operation 호출을 host가 쓰는 `call_rejected`다. `call_rejected`의 name은 operation 이름이고 message는 `<code>: <message>`다. 그 실패를 말하는 invocation이 있으면 쓰지 않고, 같은 view binding에서 같은 거절은 한 번만 쓴다), 앱 process의 비정상 종료는 `process_exit <근거>: <message>`다(근거는 `unexpected_exit`, `v8_oom`, `start_failed`, `ready_timeout`, `crash_loop`). 의도한 정지는 쓰지 않는다. preview 자식(release 준비의 handler 검사 포함)의 출력과 오류는 쓰지 않고, 화면 오류도 live 화면의 것만 쓴다.
5. 줄마다 redaction을 하고 그 뒤에 300자로 자른다. 순서가 바뀌면 자른 줄에 secret 일부가 남는다. supervisor의 redaction은 credential pattern과, core에서 받아 앱에 건넨 secret 값(`apps.secret_value`)을 지운다. log가 disk에 남으므로 바깥 응답에 되돌아온 secret을 앱이 찍어도 file에 남지 않게 하려는 것이다.
6. 읽기는 core route `apps/logs`(`app.logs`)다. core가 두 file을 바로 읽어 `invocation`, `since`(포함), `until`(제외)로 거르고 가장 최근 `limit`줄(기본 200, 최대 1000)을 오래된 것부터 준다. supervisor를 거치지 않으므로 앱이 멈췄거나 crash loop여도 읽힌다. 읽을 때 알려진 secret 값으로 한 번 더 지우고, 안전하게 만들지 못한 줄이 있으면 읽기 전체가 `unavailable`이다.
7. actor는 user, agent, app이다. agent는 tool `app.logs`로 부른다. 앱 상태(`app.status`)와 호출 기록(`app.invocations`)도 같은 식으로 읽어, 앱을 진단하는 쪽은 이 셋을 본다.

### 앱 process의 바깥 접촉

1. 앱 process는 권한을 막지 않는다(사람이 정했다). SDK 다섯(`@lophn/cap-net`, `@lophn/cap-secret`, `@lophn/cap-fs`, `@lophn/cap-notify`, `@lophn/cap-phone`)으로 나가는 일은 선언에 적고, net과 secret과 notify와 phone은 broker가 요청마다 선언 사실 ∩ 사람의 grant를 본다(notify는 `architecture/app-notice.md`, phone은 폰의 위치를 읽는 `phone.use {capability}`이고 `architecture/remote.md`). fs는 선언이 무엇에 닿는지 보이는 값일 뿐 막지 않는다. fs 경로는 절대 경로이거나 사람의 home 기준 `~`·`~/…`다(슬래시만, `.`·`..` 조각과 `~user`·`~\`는 거절): 컴퓨터마다 home이 달라도 한 release가 모든 컴퓨터에서 돌게 하려는 것이다. `~`는 선언·grant·동의 글에 적은 그대로 저장하고 보이며(grant 키도 그 글이다) core는 펴지 않는다. 펴는 것은 앱 code의 `@lophn/cap-fs`이고 이 컴퓨터의 `os.homedir()`다. 사람이 grant를 거두는 것은 앱 process가 떠 있어도 바로 commit되고, broker가 요청마다 다시 읽으므로 다음 요청부터 거절된다. 이미 시작한 요청은 끝까지 간다.
2. broker는 live 자식의 요청만 받는다. 준비 모드와 preview의 자식이 같은 통로를 부르면 거절한다. SDK의 stand-in이 그 자리를 채운다.
3. `@me` package의 permission은 publish와 release prepare가 지킨다. `package.publish`는 package.json의 `@lophn/cap-*` 의존이 요구하는 permission을 낸 `permissions`가 덮지 않으면 `invalid_input`이다. `release.prepare`는 선언의 `sdk_dependencies` 중 `@me` 의존마다 그 정확한 판의 catalog `permissions`를 모두 선언의 `permissions`에서 요구하고, 없으면 `invalid_input`(`@me/foo@1.2.0 needs net.fetch in the declaration permissions`)이다. `@me` package가 다른 `@me` package에 기대는 경우는 따라가지 않는다(열린 것).
4. net: SDK의 요청은 앱 supervisor의 broker(`net/fetch`)가 보낸다. broker가 요청마다 목적지(host·port)를 선언 사실 ∩ grant로 검사한다. 앱 process의 network는 막지 않으므로 이 검사는 이 client를 지나는 요청에만 걸린다. redirect는 한 단계마다 같은 검사를 다시 받고, 플랫폼 port는 grant가 있어도 막는다. 이 검사가 틀리면 supervisor가 아무 곳이나 간다.
   - loopback 목적지는 http, 그 밖은 https다. 사람이 켠 같은 컴퓨터의 서비스를 부르려는 것이고 기계 밖으로 나가지 않는다. https에서 http로 내려가는 redirect는 거절한다.
   - 앱은 요청에 본문(글 또는 bytes, 풀어 쓴 크기 10 MiB까지)과 header(32개까지)를 싣는다. `Authorization`·`Cookie`·`Host`·`Content-Length`·`Proxy-Authorization`은 schema가 거절하고 `GET`·`HEAD`에는 본문이 없다. 인증은 앱이 아니라 secret 길이 붙인다. redirect가 301·302(GET·HEAD 아님)·303이면 `GET`으로 바꾸고 본문과 `content-type`을 버리며, 307·308은 method와 본문을 그대로 다시 보낸다. 앱 header는 처음 목적지와 같은 origin의 hop에만 실린다. 응답은 1 MiB 이하의 글·JSON이다.
5. secret: 앱의 `useSecret`은 이름과 목적지를 말할 뿐 값을 읽지 못한다. broker가 secret 이름 선언 사실 ∩ grant와 그 목적지의 `net.fetch` 허락을 검사하면, supervisor가 core route `apps.secret_value`로 값을 한 번 받는다. 이 route는 supervisor의 machine 자격만 부르고, 부른 supervisor가 지금 보는 live 자식과 맞을 때, core가 현재 선언 사실 ∩ active grant로 다시 판정해 통과할 때, 알려진 값 registry가 그 값을 알 때만 값을 준다. 모르는 값은 redaction이 지우지 못해서다.
   - 값이 없거나(`not_found`) OAuth sign-in이 필요해서(`conflict`) 값을 못 준 호출은 그 호출의 빈 자리 `{app, secret}`을 core가 기억하고(supervisor가 `apps.secret_value`에 invocation을 싣는다), 호출이 `failed`로 끝날 때 결과의 `missing`에 싣는다. agent의 `lophn <slug> <command>` 결과는 그 자리와 `lophn ask secret --app <id> --secret <name>` 문장을 앱이 쓴 오류 글과 따로 보인다. 앱 SDK(`CapabilityError`)는 바뀌지 않는다: 앱이 오류를 삼키거나 다른 글로 바꿔도 core가 본 사실이 간다. 앱이 삼켜 성공으로 끝난 호출의 기억은 상한(256)을 넘으면 오래된 것부터 버린다.
   - supervisor는 받은 값을 같은 invocation의 같은 (host, port) 요청에만 `Authorization: Bearer`로 붙이고, 60초가 지나면 버린다. redirect로 목적지가 바뀌면 값을 다시 찾아 붙지 않는다. 앱의 응답과 오류에 값이 없고, 앱이 찍어도 log의 redaction이 지운다. Bearer 말고 다른 방식의 인증은 쓰는 앱이 생길 때 더한다.
6. OAuth secret: 선언의 `secret.use`에 `oauth`(authorize·token 끝점, scope, 추가 authorize parameter)가 있으면 그 이름의 값은 사람이 sign-in해 받은 access token이다. 끝점은 https이거나 loopback http다.
   - 사람이 앱 Access 탭에서 client id와 client secret(선택)을 넣고 [Sign in]을 누르면 core가 loopback callback을 열고 authorize URL(PKCE)을 만들고 shell이 OS browser로 연다. core가 background에서 callback을 받아 token으로 바꾸고 화면은 상태(`apps/oauth_state`)를 다시 읽는다. 발급자가 거절하면(사람이 browser에서 거부) 실패 이유는 `exchange_failed`("The service rejected the sign-in.")이고, 시한이 지나거나 취소되면 `callback_timeout`이다.
   - 값은 `apps.secret_value`가 보내기 직전에 core가 refresh한다(남은 시간 5분 이하, 이름마다 한 번에 하나, 발급자 호출 대기열). 발급자가 400·401·`invalid_grant`로 거절하면 access·refresh·meta를 지우고 상태를 `failed`(`refresh_rejected`)로 두며 앱은 `conflict`("oauth sign-in required")를 받는다. 닿지 못하거나 5xx면 지금 token이 만료 전일 때 그 token을 보내고, 만료 뒤면 `unavailable`이다. client id나 선언의 끝점·scope·parameter가 바뀌면 옛 token을 쓰지 않는다(상태 `none`).
   - refresh token, meta, client id·secret은 `app-oauth.<이름>.refresh|.meta|.client_id|.client`에 두고 어느 호출로도 보내지 않는다. OAuth가 없는 secret의 값도 사람이 같은 탭에서 보호된 입력 창으로 넣는다.
   - 사람은 같은 탭에서 값을 지운다. plain secret의 [Remove value]는 `secrets/delete`이고, OAuth secret의 [Sign out]은 `apps.oauth_sign_out`이 진행 중인 시도를 버리고 access·refresh·meta를 지운다(client id·secret은 남는다). grant [Revoke]는 값을 지우지 않는다. 앱 secret 이름은 전역이라 같은 이름을 선언한 다른 앱도 그 값을 쓴다.
7. fs: `@lophn/cap-fs`는 OS가 허락하는 파일을 어디든 읽고 쓴다. 선언의 `fs.read`·`fs.write`(경로)는 앱이 무엇에 닿는지 보이는 값이고 선언 검사가 그것을 요구한다(경로 꼴은 위 1번). 운영 bundle의 사본은 file 0444·폴더 0555다.

## 경계와 계약

- core 경계: route `app.call_tool`이 호출 경로의 입구다. program, flow, event 자격은 route로는 열 수 없고 core 안 연산만 만든다(event는 발행을 받은 core의 전달). 다른 컴퓨터가 넘긴 호출의 입구는 `apps/remote_call`이고 `remote` 자격은 그 handler만 만든다. `app.call_tool`의 target은 `live`, `preview`, `remote {machine, app}`이다(`machine`은 컴퓨터 이름, `mch_`, `dev_`). 앱 process의 broker 본문 `target_app`에는 `machine?`이 붙고 SDK `@lophn/cap-tool` 2.3.0 이후(지금 2.4.0)의 `connectCommands(app, commands, {on})`가 채운다. 앱 process와는 `child-supervision-protocol`(supervisor가 길만 이어 준다)로 이야기한다.
- caller 본문은 일곱 종류다: `{kind: person, view_session, device?, machine?}`(`device`는 폰에서 한 write가 컴퓨터에 맞춰질 때 그 기기의 id, `machine`은 다른 기계에서 온 변경(어느 길로 왔든)을 적용할 때 출처 기계의 id이고 `view_session`은 주인 sync log의 seq다. 둘은 core 안 sync 적용만 붙이고, 화면이나 다른 credential의 호출이 `device`나 `machine`을 주장하면 막는다), agent(도는 turn과 tool call), 앱(부모 invocation), `{kind: program, job, job_run}`, `{kind: flow, instance}`, `{kind: event, publisher, event, publication, trace_id, chain, parent_invocation, machine?}`(publisher는 앱 id나 `lophn`. `machine`은 선언의 `across_machines`로 다른 기계에서 와서 이 기계가 낸 event의 난 기계이고 이 기계에서 난 event에는 없다), `{kind: remote, machine, device, requester}`(다른 컴퓨터의 core가 넘긴 호출. machine과 device는 부른 컴퓨터이고 requester는 그 안에서 시킨 쪽 `screen`·`terminal`·`agent`·`app`이다. 받는 기계의 `apps/remote_call`만 만들고 `app.call_tool`로 이 종류를 주장하면 `forbidden`이다. `person`의 `device`·`machine`, `event`의 `machine`과 뜻이 다르다).
- 호출 결과의 막힘 code는 `denied(gate_blocked)`(막기), `denied(call_loop)`(같은 앱이 사슬에 다시 나옴), `denied(call_too_deep)`(깊이 한도), `denied(app_archived)`(보관한 앱. 사람 화면에만 이대로 가고 agent에게는 `not_found`)다. 결과 모름은 `unknown`, 보내기 전에 막힌 것은 `unavailable`이다.
- route와 tool 이름: `app.call_tool`, `app.remote_call`(`apps/remote_call`. 받는 기계의 입구), `machines/app_tools`(agent runtime이 할당된 다른 기계 앱의 command 목록을 읽는다), `app_views.open|call|close`(앱 화면 host → core의 view 표), `app.phone_target`(agent가 기준 폰을 읽는다), `app.phone_screens`(폰이 받을 폰 화면 목록과 폰에서 도는 앱의 `runs_on`·backend manifest), `app.phone_file`(폰에서 도는 앱의 backend와 migration file), `app_sync.push|pull|snapshot|snapshot_file`(폰에서도 도는 앱의 sync log, `app-sync.md`), `app.tool_index`, `app.usage`, `app.skills`, `app.status`, `app.invocations`, `app.event_publications`(발행 기록, CLI `lophn app event-publications`), `app_events.publish`(앱 process → core), `app_sessions.list|status|stop`(앱 → core), `app.logs`(`apps/logs`), `app.log_view_error`(shell main → core), `app.delete`, `app.create`, `release.prepare`(결과의 `removed_public_tools`, `removed_public_skills`), `declaration.check`, `package.publish`, `apps.apply`(rewind 적용), `apps.secret_value`, `apps.oauth_sign_out`, `apps/oauth_state`, `preview.call`, `visual.show`.
- 선언: `operations[]`, `commands[]`, `skills[]`, 화면 `{key, label, path, places, params?, tray?}`, `permissions`, `sdk_dependencies`, `secret.use`(`oauth`), `fs.read|fs.write`. 정본 json은 비었거나 없는 칸을 두지 않는다.
- 화면 bridge: 폰 화면의 `lophnApp`은 `place`, `callOperation`, `events`뿐이고 이름과 모양이 desktop과 같다(`architecture/phone-screen.md`). desktop은 `lophnApp.callOperation`(SDK의 `useOperation`, `OperationButton`), `lophnApp.place`, `lophnApp.agent`(`open`, `snapshot`, `onUpdate`, `send`), `lophnApp.events`(`subscribe`, SDK의 `useEvent`), `lophnApp.sessions`(`list`, `status`, `stop`, SDK의 `useSessions`), `lophnApp.setKeepAlive`. 화면 주소 query는 `place`, `params`, `workspace`다. 앱 화면의 agent 입력은 `send`·`stop`·`answer`·`rename`만 허용된다.
- 저장: `<data root>/apps/<app>/`(source 저장소, bundle, data DB, `logs/app.log`·`app.log.1`, preview). log 줄 모양은 `{ at, invocation, text }`. 앱 source의 `.lophn/skills/<name>/SKILL.md`. OAuth 값은 `app-oauth.<이름>.*` secret 항목.
- ledger: 표 `invocations`(끝 상태, `caller_kind`, changeset blob 참조, 되돌림 표시), `app_event_publications`(발행 기록), `app_rewinds`(rewind 기록, 불변. 끝 상태 applied, cancelled, unknown. `unknown`은 step `apps.rewind.unknown`이 표를 다시 짜 더했다), `grants`, `releases`, 선언 hash(`declaration_hash`). 옮기기 step: `apps.invocations.event-caller`와 `apps.invocations.remote-caller`(표를 다시 짠다), `apps.events.publications`, `apps.releases.declaration-places`, `apps.releases.declaration-no-domain`(저장된 선언의 `commands[].domain`을 지운다. `declaration_hash`는 그대로), `apps.delete.erase-windows`, data step `approvals.deny-rule-slug`(정의 파일의 `lophn(<domain> …)`을 그 domain을 가진 앱의 slug로. 못 찾은 규칙은 그대로).
- event: `AppStarted`, `AppStopped`, `AppCreated`, `AppDeleted`(남는다), `AppRemoved`(남지 않는다, shell 정리용), `AcpUpdated`, `AppEventPublished`(남지 않는다, core의 view 표가 받아 앱 화면에 앱 event를 전하는 신호), `AppViewEvent`(남지 않는다, view를 연 owner에게 가는 `event`·`rebound`·`lost`), `AppSyncChanged`(남지 않는다, sync log에 줄이 생겼다는 신호. `app-sync.md`).
- 설정 key: `shell.quick_launch`, `shell.app_launch`, `shell.sidebar_panels_off`, `shell.tray_off`, `shell.tray_order`.
- 정의의 deny 규칙은 `lophn(<slug> <낱말>)`이다.
- agent 명령: `lophn <app> <command>`(`lophn <slug> --help`가 description과 입력을 보인다). 기록 이름은 `<slug>.<command>`(argv 낱말은 `.`로 나누고 `_`는 `-`)이고 effect는 선언에서 온다. 사람은 binary의 `lophn <slug> <command>`로 run을 거쳐 부른다.
- 앱 workspace의 command 안내는 선언 ID 대신 그대로 호출할 수 있는 CLI 문법과 앱별 help 경로를 보여 준다. 잘못된 이름이 현재 부를 수 있는 command의 `.`·`_` 표기를 그대로 쓴 경우 정확한 호출법을 `invalid_input`에 안내하고 실행하지 않는다. 할당 밖 command를 추천하지 않는다. 현재 group에 속한 다른 잘못된 명령도 group의 help 경로를 알려 준다.
- 같이 보는 문서: `architecture/phone-screen.md`(폰 화면), `architecture/approval.md`(tool gate), `architecture/job.md`(program), `architecture/workflow.md`(flow), `architecture/activation.md`(release 교체와 grant), `architecture/workspace-session.md`(session rewind), `architecture/workspace-layout.md`, `architecture/agent-definition.md`, `architecture/coding-agent.md`, `architecture/app-notice.md`.

## 결정

- core 경유로 일원화했다. 이전에는 부르는 쪽이 core가 서명한 연결로 앱 process socket을 직접 부르고 앱이 invocation을 나중에 알렸다. 판정, 기록, 줄 세우기가 흩어지고 신원 증명(proof) 장치가 따로 필요했다. 지금은 경로가 하나다.
- 선언을 operation과 command 두 층으로 나눴다. 한 목록이던 때는 화면이 앱 process에 닿는 길이 tool뿐이라 화면용 저수준 동작이 모두 agent tool이 되었고, agent 계약의 결과 상한이 화면 기능을 깎았다(Mahas 세션 목록이 200행으로 줄었다). 앱 고유의 저수준 동작은 operation으로 화면과 앱이 쓰고, agent와 다른 앱에는 앱이 고른 의미 단위 command만 내놓는다. command handler는 앱 코드의 같은 함수를 감싼다. MCP 모양과 annotation은 바깥에 내놓는 MCP endpoint가 없어 지웠다. (사람, 2026-11-01)
- agent는 앱 command를 명령으로 부른다(`lophn <app> <command>`). 앱 command마다 provider tool을 만들면 tool 정의가 앱 수만큼 늘고 늦게 싣기 장치가 필요했다. 지금은 `lophn` tool이 부를 때 지금 할당, 활성 release의 command 선언, 비공개 규칙(그 앱 workspace면 전부, 아니면 public)으로 찾는다. 앱 command는 session 시작 때 고정하지 않아 `tools_changed` notice가 없다. 내장 명령 묶음 이름은 앱 slug로 쓰지 못한다. (사람, 2026-11-01. 앱 단위로 접은 것은 2026-11-03)
- domain을 지우고 command를 앱 하나로 접었다. 처음에는 command가 앱 안의 domain에 속해 `lophn <domain> <command>`였다. domain은 직관적이지 않고 쓰임이 없었다(대부분 그릇과 1:1). domain이 앱 하나뿐이던 앱은 이름 글자가 그대로다. 같은 앱의 domain 둘이 같은 이름의 command를 냈으면 저장된 선언은 그대로 두고 다음 release 기록이 겹침으로 거절한다. 선언의 `domain` 칸을 지우고 SDK 판을 올려, 봉인한 옛 bundle은 새 판에서 뜨지 않고 다시 release한다(앞 선례). (사람 2026-11-03. 칸 지우기와 SDK 판 올리기는 agent, 사람이 답하지 않아 추천대로)
- 공유 skill의 원본은 앱 source의 `.lophn/skills`이고 release와 같이 봉한다. lophn data 자리에 두면 command를 바꾸는 commit과 skill이 따로 움직인다. 앱 source에 두면 CLI를 바꾸는 commit에 skill이 같이 들어가고, 공유되는 판이 active release의 것이라 HEAD의 작업 중 판은 새지 않으며 activation이 곧 갱신이다. 앱 agent가 쓰는 자리와 공유 원본이 같아 따로 옮기는 단계도 없다. 비공개 skill은 그 앱 workspace의 `app` source로만 보인다. (agent)
- 앱 skill 공유는 할당에 붙인다. 앱을 할당받은 agent가 그 앱의 public skill도 받고, 공유 skill을 적는 칸을 agent 정의에 따로 두지 않는다. 따로 두면 아는 것과 부를 수 있는 것이 두 칸으로 갈라져 어긋난다. (사람)
- 화면 체계를 "화면은 인자를 받는 앱의 부분, 자리는 lophn이 정함, 크기는 앱 CSS"로 고쳤다. 옛 `sizes`를 `places`로 바꾸므로 사람의 앱도 다시 release한다. 전역 float는 `panel` 자리 앱 화면만, workspace 창에 산다(detached·앱 전용 창 제외). 전역 float에는 workspace를 주지 않는다. (사람이 체계를 정했다. 이름 바꾸기와 전역 float 규칙은 agent)
- archived 앱은 agent에게 없는 앱이다. archived 앱은 lophn이 볼 수도 없고 migration 조사 대상도 아니어야 한다. 사람이 lophn에게 보관한 앱을 되살려 달라고 해도 lophn은 그 앱을 못 찾는다. 되살리기는 사람이 화면에서 한다. 필터를 앱 접근 판정 한 곳에 둬서 읽기와 command가 한꺼번에 닫힌다. (사람, 2026-11-07)
- 보관한 앱은 사람이 영구히 지울 수 있다(`app.delete`). 지우는 순서와 지우지 않는 것은 위에 있다. 이 앱의 invocation 기록은 지운다(append-only trigger는 erase window로 풀었다): 앱의 data 변경분(changeset)을 담고 있어 앱이 사라진 뒤 남길 이유가 없다. (사람, 2026-11-07. invocation 지우기는 agent)
- 다른 기계의 앱 화면은 그 기계의 core가 binding과 화면 byte를 내고 이 컴퓨터의 창이 그린다. partition과 host label에 기계를 넣고 이 컴퓨터의 이름(`:live`, `app-<앱>`)은 그대로 둔다. 이유: 같은 앱 id라도 기계마다 data가 다르니 저장소가 섞이면 한 기계의 cookie·storage가 다른 기계의 화면에 보인다. 이 컴퓨터의 이름을 바꾸면 사람의 앱 저장소를 옮기는 step이 든다. 권한은 받는 기계가 기기 route 목록으로 보고 화면이 숨기지 않는다. (agent)
- 화면 view의 binding을 shell main이 아니라 core가 쥔다(view 표 `app_views.*`). 이유: desktop 창과 폰 앱이 같은 판정(어느 앱·release인지, 부를 operation, 받을 event, release가 바뀔 때 다시 묶기)을 두 벌 들지 않게 하고, 신원을 host가 붙인 view id와 credential의 principal로 좁혀 화면 page가 낸 값을 믿지 않게 한다. 버린 안: host마다 binding을 들기. 대가: core가 shell보다 오래 살아 옛 view가 남는다(owner당 64개 LRU로 푼다). 그 덕에 preview 화면의 operation 호출도 core가 preview bundle의 선언으로 판정해 부른다. (agent)
- 앱이 project data를 `identity ?? id`로 key한다. 이유: 앱 data는 다른 기계로 맞춰지는데 `prj_`는 기계마다 달라 다른 기계에서 주인 없는 줄이 된다. `identity`가 null인 동안 `id`로 붙이는 것은 그 project가 아직 기계를 넘지 않아 data도 이 기계의 것이기 때문이다. 버린 길: `prj_`를 기계 사이에 맞추기(`project-identity.md`), SDK가 key를 감추는 helper(앱 DB 안의 옛 줄을 옮기는 일은 어차피 앱 code가 한다). (agent, roadmap `multi-device` "순서 1")
- `phone`은 한 화면의 `places`에 혼자 서고 desktop 자리와 섞지 않는다. 이유: source가 DOM이 아니라 React Native라 한 key에 두 program을 두지 않는다. 한 화면을 두 곳에 반응하게 하는 길을 버렸다. (agent)
- 앱 화면에서 agent에게 보내는 것은 그 앱을 쓰는 사람의 메시지이고 따로 허락 단계를 두지 않는다. (사람, 2026-11-04)
- 앱 화면이 보낼 수 있는 ACP 입력은 허용 목록(`send`, `stop`, `answer`, `rename`)이다. 승인은 사람이 채팅 탭에서만 한다. (사람, 2026-11-07)
- 앱 화면의 turn이 도는 동안 page를 살려 둔다. 오목 앱 화면이 agent 답을 기다리는 중에 다른 project에 다녀오면 답을 잃고 새 session이 열렸다. 모두 살리면 자원을 쓰고 program은 page 안의 뜻을 모르므로, page를 짓는 builder가 신호로 정한다. (사람, 2026-11-07)
- 앱 process는 권한을 막지 않는다. process 권한으로는 목적지를 가둘 수 없어, 요청마다 현재 선언 사실 ∩ grant를 읽는 broker를 골랐다. cap 셋(net, secret, fs, 이어 notify)을 모두 살린다: 앱은 사람이 켠 바깥 서비스(같은 컴퓨터의 서비스 포함)로만 나가고, 비밀값은 lophn이 붙이며 앱은 값을 보지 못한다. (사람. 구현 방식은 agent)
- secret은 값을 앱에 주지 않고 전송 직전에 붙인다. 앱이 값을 쥐면 응답, 오류, log로 새는 길을 앱 코드마다 막아야 한다. 앱은 쓰겠다는 요청만 내고, 값은 core가 supervisor에게 한 번 주어 붙인다. 과하다고 본 장치 가운데 앱 log를 읽을 때의 redaction(core만 아는 값을 지운다), supervisor의 60초 보관과 redirect 뒤 다시 붙이지 않기(invocation 끝을 모르는 supervisor와 바깥 서버의 redirect를 막는다)는 남긴다. (agent)
- OAuth access token은 선언한 secret 이름 그대로 둔다. 그러면 broker의 판정, `apps.secret_value`, supervisor의 Bearer 붙이기가 OAuth를 몰라도 된다. OAuth가 더하는 것은 값을 보내기 직전의 refresh 하나다. 앱이 token을 받아 직접 refresh하면 refresh token이 앱 코드에 닿는다. (agent)
- refresh 거절만 sign-in을 끝낸다. 앱 OAuth와 MCP OAuth, provider 구독 OAuth 모두 400·401·`invalid_grant`만 거절로 본다. 발급자의 일시 오류(5xx, 닿지 못함)에는 만료 전 token을 그대로 쓴다. 사람이 다시 sign-in해야 하는 일을 막으려는 것이다. (agent)
- client는 사람이 그 서비스에 만든 것을 넣는다. dynamic client registration은 하지 않는다. Google 같은 곳은 자동 등록이 없고, lophn이 자기 client를 들고 다니려면 서비스마다 심사를 받아야 한다. OAuth는 표준 authorization code와 PKCE로만 열고 서비스에 맞춘 것은 선언의 추가 parameter(`access_type=offline` 같은 것)뿐이다. (agent)
- 빈 자리는 앱 SDK가 아니라 core가 호출 결과에 싣는다. 앱 코드가 오류를 어떻게 던지든(자유 글) agent가 "무엇을 청해야 하는지"를 알아야 하는데, SDK에 칸을 더하면 앱마다 판을 올리고 앱이 그 칸을 채워야 한다. core는 값을 못 준 사실을 이미 보고 있다. 앱 호출 사이의 기억은 invocation id 하나로 이어 다른 호출에 섞이지 않는다. (agent)
- grant [Revoke]는 앱 secret 값을 지우지 않는다. 이름이 전역이라 다른 앱이 같은 값을 쓴다. 값을 지우는 길은 같은 탭의 [Remove value]와 [Sign out]이다. (agent)
- 앱이 되돌림 tool을 선언하게 하는 모델을 버렸다. 앱마다 맞게 짜야 하고 틀려도 알 수 없다. SQLite session의 changeset은 앱 코드와 무관하게 DB 변경을 호출 단위로 잡는다.
- changeset 뒤집기는 직접 구현했다. node:sqlite에는 session과 apply는 있고 changeset을 뒤집는 함수(`sqlite3changeset_invert`)가 없다. changeset에는 UPDATE와 DELETE의 원래 값이 들어 있어, SQLite 문서의 changeset format을 읽는 순수 함수로 뒤집는다(base). patchset은 원래 값이 없어 뒤집지 못한다.
- 호출 단위가 아닌 시점 단위로 되돌린다. write가 무엇을 읽고 썼는지 모르니, 호출 하나만 빼면 뒤 호출의 전제가 깨진다.
- 되돌린 invocation을 지우지 않고 표시한다. 기록은 감사에 쓰이고, 반쯤 되돌아간 DB는 남기지 않는다. 되돌린 것을 다시 하기(redo)는 없다.
- session rewind가 앱 data를 저절로 되돌리지 않는다. 시점 단위라 그 사이 다른 쪽의 변경도 함께 사라지기 때문이다. 사람이 앱을 골랐을 때만, 함께 되돌아갈 목록을 보인 뒤 같은 rewind로 간다(Claude Code의 rewind 메뉴가 코드와 대화를 따로 고르게 하는 것과 같다).
- changeset이 frame에 안 들어가면 앱이 빼고 `too_large`로 알린다. core는 그 write만 "되돌리지 못함"으로 표시하고 나머지 rewind는 막지 않는다. 막힘을 표시로 바꾸고, 큰 write가 실제로 나오면 changeset을 frame 밖으로 넘기는 길을 본다.
- rewind 적용은 write 하나씩 나누지 않고 본문을 bytes frame stream으로 보낸다. 나누면 중간 실패에서 일부만 되돌아간다.
- program caller를 따로 둔다. 사람이 연 run의 호출은 사람의 호출이라 Gate를 거치지 않는다. job의 호출은 사람이 등록을 승인한 job의 호출이라 판정 없이 지나가지만, 기록에는 어느 job, 어느 차례가 불렀는지 남아야 한다. agent caller는 도는 turn과 tool call을 싣고 그것으로 확인하는데 job에는 그것이 없다. 그래서 job과 job run을 싣고 core가 만든 자격과 맞춰 본다. agent를 빌려 쓰면 없는 turn을 만들어야 한다. invocation 기록과 rewind 화면이 job이 한 호출을 가려 보인다. (agent)
- job의 허락은 만든 agent의 할당이 아니라 사람의 등록 승인이다. 할당으로 판정하면 job 하나를 돌리려고 만든 agent에게 그 앱 전체를 열어 줘야 하고(그 agent는 다른 session에서도 그 앱의 모든 tool을 부른다), job을 만든 agent는 그 tool을 직접 쓸 이유가 없을 때가 많다(앱 workspace에서 앱을 만든 agent가 그 앱의 수집 job을 만드는 경우). 할당이 없으면 job은 만들어지고 차례마다 말없이 막혔다. 사람이 job 하나(주기와 할 일)를 보고 승인하면 허락의 범위가 그 job의 할 일 하나로 맞는다.
- flow caller를 program에서 가른다. flow instance의 호출도 사람이 없지만 자격의 agent(`workflow.yaml`의 `agent`, 없으면 lophn)의 할당으로 판정한다. job이 없으니 본문과 자격이 맞춰 볼 것이 instance다. 같은 kind에 job과 instance를 nullable로 두면 parser 손 사본마다 둘 중 하나만 있는지를 다시 검사해야 한다.
- event caller를 따로 둔다. 구독 handler의 호출은 사람도 agent도 job도 아니고 어느 앱의 어느 event가 불렀는지가 기록에 남아야 한다. 기존 kind를 빌리면(app caller) 부른 앱이 호출을 직접 한 것처럼 grant `app.call`을 요구하고 "event 때문"이 한 줄에 보이지 않는다. kind를 더하는 값은 표를 다시 짜는 step 하나다. 구독 handler의 effect는 write로 고정한다. 구독 선언에 effect를 두면 handler마다 앱이 골라야 하고 read로 선언한 handler가 DB를 바꾸면 changeset이 없어 rewind가 틀린다. 구독 handler는 별도 호출 종류(`kind`)를 만들지 않고 operation 자리로 부르고 caller로 막는다. 호출 종류를 늘리면 invocation의 operation 모양, process wire, SDK context가 모두 바뀐다. (agent)
- preview 호출은 기록을 남기지 않는다. ledger의 `release`를 비울 수 없어 release 없는 bundle의 호출은 기록할 자리가 없고, preview는 일회용 DB라 rewind 대상이 아니다. coding agent의 MCP 호출은 새 caller 종류 없이 `person` caller와 preview 전용 자격으로 들어간다. 새 종류는 ledger의 caller CHECK, caller 판정, rewind를 바꿔야 하는데 preview 호출은 기록이 없다. (agent)
- `app.usage`는 invocation만 센다. 할당받은 agent의 열린 session place를 세던 안은 session을 열고 닫을 때마다 결과가 바뀌어 버렸다. (agent)
- 앱 log를 앱마다 file로 남기고 쓰는 쪽을 supervisor 하나로 했다. 앱 안에서 쓰게 하면 앱 코드가 log를 지우거나 고칠 수 있다. supervisor는 이미 앱의 stdout·stderr를 쥐고 있고 lophn의 코드라, 앱이 쓴 줄과 lophn이 아는 사실(비정상 종료, 화면 오류)을 같은 file에 같은 redaction으로 쌓는다. 메모리 buffer가 아니라 file인 것은 앱이 죽거나 supervisor가 다시 뜬 뒤에도 원인을 읽어야 해서다. 이전 log는 supervisor 메모리에만 있어 재시작하면 사라졌다. (agent)
- 저장하는 problem 모델 대신 log를 primitive로 둔다. 오류를 상태 machine(열림, 닫힘), 묶음, 보고 표로 올리면 계약과 tool이 앱 쪽 진단보다 무거워진다. lophn은 줄을 남기고 읽게만 하고, 무엇이 문제인지 읽고 판단하는 일은 agent가 한다. 닫기 gate와 reaction은 규칙마다 agent가 외울 계약이 됐고 규칙끼리 부딪혔다. (사람, 2026-10-20)
- console 출력을 invocation 표시로 감싸지 않는다. invocation은 SDK가 쓰는 줄에만 싣고, 나머지는 시각으로 찾는다. SDK `reportProblem`은 남기고 앱 log에 error 한 줄을 쓴다(앱과 test 재료가 이미 부르고, 이름 붙은 오류는 log에서도 쓸모 있는 신호다). preview와 test mode의 오류는 log에 쓰지 않는다. (agent)
- 앱 process에는 crash handler를 새로 걸지 않는다. 이미 SDK의 crash exit, exception observer, supervisor의 crash 관측이 stderr와 log에 남긴다. (agent)
- 예외 stack은 쓸 때 원래 source 줄로 푼다. 봉인된 bundle 사본은 agent의 file 범위 밖이라 agent가 stack의 bundle 위치를 직접 풀 수 없다. 당시 release의 source map으로 supervisor가 풀어 읽을 수 있는 줄만 남긴다.
- 앱 secret 값과 OAuth sign-in을 지울 길을 Access 탭에 둔다. plain은 `secrets/delete`, OAuth는 새 route `apps.oauth_sign_out`이 access·refresh·meta를 지우고 client id·secret은 남긴다. grant revoke에 묶으면 같은 이름을 쓰는 다른 앱의 값까지 지워진다.
- 앱 호출 큰 입력·결과의 한도를 frame 한도에서 파생한다(상한은 값이 아니라 관계로 정한다). 결과 상한이 frame보다 크면 changeset을 빼도 응답이 거절되어 결과 모름이 된다.

- 다른 기계의 앱을 부르는 길은 새 route가 아니라 `app.call_tool`의 `remote` target이고, 받는 기계의 입구는 새 route `apps/remote_call`이다. 이유: 부른 쪽 확인(도는 turn, 부모 invocation)이 호출 경로 service 안에 있어 target 하나로 두면 agent와 앱이 같은 확인을 받는다. 받는 쪽은 기기 자격이 `person` caller가 되는 `apps/call_tool`을 쓰면 Gate를 건너고 operation까지 닿으므로 `remote` caller를 만드는 입구가 따로 있어야 한다. (agent)
- 앱의 `app.call` grant는 기계와 상관없이 그 앱을 덮는다. 이유: 앱 id는 기계 사이에 같고 grant 모양을 바꾸지 않았다. 다른 기계의 앱을 부르는 앱의 허락은 부르는 기계의 grant가 아니라 `remote` target에서 받는 기계가 보는 규칙이다. (agent)
- 다른 컴퓨터의 앱을 부를 때 판정은 부르는 컴퓨터(할당, grant, 부른 쪽 private)와 받는 컴퓨터(명단, 터미널 입력 허락, 대상 앱 private, `public`)가 각자 자기 data로 한다. 부른 쪽의 할당을 받는 컴퓨터가 다시 따지지 않는다. 이유: 내 컴퓨터들은 대등하고 한 사람의 것이라 두 컴퓨터의 설정이 어긋나 안 되는 이유를 찾을 수 없게 하지 않는다. 대신 받는 컴퓨터는 자기 것을 늘 본다. (사람 "기존의 approval이랑 크게 다를 게 없을 거 같은데", agent)
- 받은 호출은 다시 넘기지 않는다. 이유: 넘기면 A의 요청이 B를 거쳐 C까지 닿아 B가 A에게 준 허락이 A가 C에게 받은 것처럼 넓어진다. 받는 컴퓨터가 낳은 호출의 flight에 표시를 달고 보내는 쪽 컴퓨터가 거절하는 것으로 지킨다. (agent)
- 다른 컴퓨터가 준 command 목록과 결과의 글은 데이터이고 이 컴퓨터가 낸 선언처럼 믿지 않는다. 이유: 그 컴퓨터의 release가 언제든 이름과 설명을 바꿀 수 있고 이 컴퓨터의 사람은 그것을 보지 못한 채 model의 입력이 된다. 이름·schema 검사, 상한, 컴퓨터 이름 표시로 다룬다. 버린 안: 목록을 한 번 사람이 승인하기(할당이 허락이라는 모델과 어긋난다). (agent, 독립 review의 지적)
- 사람의 터미널은 `machines/call`로 `terminal`이라는 요청한 쪽을 달고 보낸다(새 route를 두지 않는다). `lophn <명령> --on <컴퓨터>`는 받는 컴퓨터의 기기 route 목록에 있는 명령만 된다. (agent)

## 열린 것

열린 이슈는 topic이 `app-call`인 이슈다.

- 다른 컴퓨터로 보낸 command는 화면의 `machines/call`과 연결 하나의 call 8개와 120초를 같이 쓴다. 120초를 넘기는 command는 결과 모름(`unknown`)으로 끝난다.
- 다른 컴퓨터를 부른 agent나 앱의 호출 기록은 부른 컴퓨터에 없다. 받는 컴퓨터의 `remote` 행만 남는다.
- 받은 호출을 다시 넘기지 않는 표시는 앱 호출 사슬로만 이어진다. 받은 호출 안에서 앱이 연 agent session, program, flow는 표시가 없고, 받은 호출이 낳은 event로 도는 job과 그 agent가 자기 할당으로 세 번째 컴퓨터를 부를 수 있다(`event.md`, `job.md`).
- 허락은 컴퓨터마다 하나라 "터미널은 되지만 agent와 앱은 안 된다"는 고를 수 없다.

- core를 다시 켜면 앱 OAuth sign-in 실패 이유가 사라진다. 실패 이유는 메모리에만 있어 refresh가 거절된 뒤 core가 다시 뜨면 Access 탭이 "Not signed in"만 보인다. 동작(앱은 `conflict`를 받는다)은 같고 이유 글만 잃는다. 추천은 실패 이유를 `app-oauth.<이름>.meta`에 남기는 것이다.
- 앱 e2e 여섯(앱 tool 호출, activation, 앱 data rewind, 앱 재시작)이 test 앱에 patch를 얹지 못하고 시작에서 실패한다. 이 길이 깨져도 land가 잡지 못한다.

- 기동 옮기기가 옛 `@me` 판에 bundle blob을 못 붙일 수 있다. `package.json`을 다시 쓴 모양이 원래와 다르면 hash가 달라 blob을 붙이지 못하고 기동마다 건너뜀만 남긴다. 설치 사본이 유일한 byte로 남는다.
- `app_grants/revoke`는 거두기가 process 상태를 보지 않게 된 뒤에도 `unavailable`을 오류로 선언한다(내지 않는 code).
- 새 data root에는 옛 SDK 판 사본이 없다. 옛 판에 고정된 앱은 release 준비가 `sdk_not_installed`로 실패하고 이유에 앱의 SDK 판을 올리라고 싣는다(앱 agent가 바로 고친다). 옛 판 사본은 싣지 않기로 했다.
- agent가 archived 앱 workspace를 범위로 agent를 만드는 것은 아직 막지 않는다.
