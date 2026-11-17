# call record: 호출 한 건의 기록으로 앱 문제의 책임을 가른다

상태: 로드맵. 방향과 정할 것은 사람이 정했다(2026-11-17). 계획 `call-record`(`project-docs/plan/call-record/`)이 덩어리 1~5를 가져간다. 6은 남는다.
배경 문서: `project-docs/architecture/app-call.md`(호출 경로, 앱 log, 10-20의 "log를 primitive로" 결정), `project-docs/architecture/observability.md`(core log, trace id), `project-docs/architecture/phone-screen.md`.
조사(2026-11-17, main `4148bf373`, code를 열어 path와 줄로 적은 것): `research_notes/call-record-survey/spine.md`(core 호출 경로와 화면이 아닌 caller), `screen.md`(화면에서 core까지), `read-side.md`(agent가 읽는 것, log, id, 지침, invocation 표에 기대는 것).
이슈: `view-call-undefined-input-rejected`(fixed), `view-call-rejection-unrecorded`(fixed, 땜질. 이 일이 대신한다).

## 왜

사람이 Mahas 앱에서 "세션 목록이 안 뜬다"고 했다. 원인은 lophn이었다: shell main이 화면 입력을 그대로 core client에 넘겼고 client의 입력 검사가 값이 undefined인 칸을 거절했다. 요청은 core에 닿지 않았다. 앱 workspace의 lophn agent는 약 15분 동안 `app.invocations` 10번, `app.logs` 2번, `app.status` 1번, `preview.call` 10번, `shell.run` 42번을 쓰고도 찾지 못했다. 진단 read는 모두 비어 있었다.

agent가 도구를 안 쓴 것이 아니라 써도 답이 없는 구조다.

1. 기록은 앱 handler 문 앞에서야 생긴다. 그 앞에서 끝난 호출은 없던 일이다.
2. 성공한 read는 남기지 않아서 "기록 없음"이 안 불렀다, 잘 됐다, 앞에서 죽었다 셋을 뜻한다.
3. 실패에 주인이 없다. 같은 code와 문구가 앱 잘못에도 lophn 잘못에도 나온다.
4. agent가 재현하는 길(`preview.call`)이 사람 화면이 타는 길과 다르다.

## 지금 코드 (조사)

숫자는 조사 file의 집계다. 굵은 것은 planner가 code에서 다시 확인했다.

- **호출 id(invocation id)는 `packages/core/apps/calls/service.ts`에서 intake, 보관 검사, 선언 조회 뒤에 만들어진다.** 그 앞의 거절은 id도 기록도 없다.
- core 호출 경로의 끝나는 자리는 47곳이고 33곳이 ledger 기록을 남기지 않는다. 호출 경로의 어느 file도 log를 쓰지 않는다.
- **handler에 닿기 전의 거절은 이유가 버려진다.** `service.ts`는 `link.call`의 `sent`만 보고 `error`를 읽지 않는다. 앱이 꺼짐, 뜨는 중, release 교체, supervisor pipe 실패, 앱 process가 lophn의 메시지를 거절한 것이 모두 `denied(app_unavailable)` "the app is not running"이다. 실제 이유는 `runtime/supervisor/relay.ts`의 `rejectionOf`까지 와 있다.
- 남는 기록은 `{outcome, error_code}`뿐이다. 오류 문구, 입력, 결과는 어디에도 없다. `detail_hash` 칸은 쓰는 곳이 없다.
- 같은 code와 문구가 서로 다른 책임에 쓰이는 묶음이 호출 경로에 7, 화면 길에 8이다(`unavailable: app is not available`, `forbidden: operation is not available`, `invalid_input: call is invalid` 등).
- 화면 길(desktop)의 끝나는 자리는 22곳이다. 앱이 준 입력은 JSON 왕복을 세 번 거치고(shell main, core view 표, 그 사이 schema 검사), 같은 schema가 client와 server에서 두 번 돈다. 폰은 64 KiB 상한을 두 곳에 따로 가진다.
- 폰 화면 길은 끝나는 자리 14곳 모두 기록이 없다. host가 읽지 못한 guest 메시지는 말없이 버려지고 호출마다의 timeout이 없다. core의 모든 오류 code가 폰에서는 `unavailable`이 된다.
- preview 호출은 ledger도 앱 log도 쓰지 않는다. `preview.call`은 `apps/call_tool`을 바로 불러 shell main, view 표, 화면 쪽 검사와 결과 옮기기를 모두 건너뛴다.
- 화면 SDK는 실패를 남기지 않는다. `useOperation`은 code만 두고 문구를 버리며 `ErrorState`는 원인을 받는 prop이 없다("Couldn't load {target}.").
- **agent가 받는 tool 실패 문구는 code마다 고정 문장이다**(`packages/core/lophn-agent/tools/work.ts`의 `FAILURE_SUMMARIES`). `invalid_input` 등 몇 경우만 원문이 간다. 오류 봉투의 `hint`와 `trace_id`를 읽는 client는 없다.
- 오류 type 어디에도 책임, 층, 단계를 말하는 칸이 없다. `stage`는 release 준비 결과에만 있다. `failed.error.code`는 앱이 정한 code와 lophn 진입점이 낸 code(`internal: handler failed`, `result exceeds the size limit`)가 섞인 자유 문자열이다.
- trace id가 있는 층은 셋(core API, ledger span, agent runtime)이고 shell main, page, supervisor, 앱 process, 앱 log 줄 등 여섯 층에는 없다. core span에는 앱, operation, invocation id가 실리지 않는다.
- agent 지침(`prompts/app.md`, `home.md`, `repair-app`, SDK guide, 앱 template)에 앱 bug와 lophn bug를 가르는 법, lophn 쪽 문제를 알리는 법이 없다. 알릴 tool도 없다.
- `invocations` 표에는 rewind, session rewind, sync backfill, changeset 예산, usage, Activity 화면이 기댄다. rewind 쪽은 모두 `effect`가 read가 아니고 `status`가 denied가 아닌 줄만 본다. 표는 `release`가 NOT NULL이라 preview 줄을 담지 못한다.

## 정한 것

사람(2026-11-17):

- 기록의 primitive를 log 줄에서 호출 한 건의 기록으로 바꾼다. 10-20에 지운 problem 모델(열림·닫힘 상태, 묶음, 닫기 gate)은 되살리지 않는다. lophn은 사실을 남기고 판단은 agent가 한다는 것은 그대로다.
- 책임은 오류 code가 아니라 호출이 끝난 자리로 정한다. 구분은 넷이다: `app`(handler나 화면 code가 던졌다), `contract`(앱이 lophn을 틀리게 불렀다. 어긴 규칙을 같이 적는다), `platform`(lophn이 자기 약속을 못 지켰다), `state`(앱이 꺼짐, 보관됨, grant 없음, core 재시작 중. 누구의 bug도 아니다).
- `platform`이면 앱 agent는 앱을 고치지 않고 멈춰서 lophn 쪽 문제라고 알린다. 앱에서 우회하는 것은 사람이 원할 때만 한다.
- lophn 쪽 문제(`platform`)는 사람에게 조용히 보인다. 앱의 Activity 화면이 그 호출에 lophn 쪽 문제라고 표시하고, Settings › Diagnostics가 lophn이 실패한 호출 목록을 보인다. toast와 Inbox 알림은 내지 않는다. 버린 길: toast나 Inbox 알림(화면이 되풀이해 부르면 시끄럽고 사람이 할 수 있는 일이 없다).
- 앱 화면의 실패 표시(SDK의 `ErrorState`, `OperationButton`)는 `platform`과 `state`일 때만 lophn이 정한 한 줄을 더한다(`platform`: 앱이 아니라 lophn 쪽 문제, `state`: 사람이 할 일). `app`과 `contract`는 지금 문구 그대로다. SDK 판이 오르고 이미 만든 앱은 새 SDK로 옮겨야 보인다. 버린 길: 화면은 그대로 두고 Activity와 agent만 책임을 알기(사람이 화면만 봐서는 앱 고장인지 lophn 고장인지 모른다).

agent(근거는 AGENTS.md "설계 방향"과 위 조사):

- 호출 id는 invocation id 하나이고 core가 호출을 받는 첫 줄에서 만든다. ledger 줄, 앱 log의 `invocation` 칸, 호출 기록이 같은 id를 쓴다. 버린 길: 호출 id를 따로 두기(같은 호출을 가리키는 id가 둘이 된다).
- 앱이 준 값의 검사는 core 입구에서 한 번만 한다. host(shell main, 폰 host)는 신원만 붙이고 `operation`과 `input`을 열어 보지 않고 넘긴다. 그 뒤 hop이 lophn 자신의 메시지를 거절하면 언제나 `platform`이다. 지금은 같은 검사가 세 곳에 있고 그중 하나가 오늘 bug를 냈다.
- 끝나는 자리는 닫힌 목록이고 자리마다 stage와 책임이 하나다. 호출 경로의 code는 목록에 없는 오류로 호출을 끝낼 수 없다(type으로 막는다). 두 원인을 한 문구로 내는 묶음(호출 경로 7, 화면 길 8)은 자리마다 책임이 하나가 될 때까지 가른다. 버린 길: 실행 중에 오류 문구를 보고 책임을 추측하기.
- 호출 기록은 `invocations`와 따로 앱마다 둔다. 성공이 아닌 끝은 한 건씩 남기고 core를 다시 켜도 남는다(사람은 다음 날 말한다). 앱마다 최근 것만 남기는 표다(`app_event_publications`와 같은 꼴). 성공은 이름마다 횟수와 마지막 시각만 core 메모리에 두고, 읽을 때 언제부터 센 것인지 같이 준다. 본문은 남기지 않되, 성공이 아닌 호출의 입력은 재현에 쓰도록 상한까지 잘라 redaction을 거쳐 남긴다. lophn 쪽 목록은 이 표에서 책임이 `platform`인 줄을 읽는다(따로 쌓지 않는다). 버린 길: 모든 호출을 `invocations`에 넣기(화면이 주기적으로 읽는 호출이 영구 기록을 채우고, preview는 release가 없어 들어가지 못한다), 성공까지 file이나 표에 쓰기(읽기마다 쓰기가 생긴다).
- ledger의 `invocations`는 앱 data를 바꿨을 수 있는 호출(write, external, 시작, sync)의 기록으로 남는다. rewind의 재료다. 진단만을 위해 쓰던 줄(denied, 실패한 read)은 호출 기록으로 옮기고 ledger에 새로 쓰지 않는다. 이미 있는 줄은 그대로 둔다.
- 호출한 쪽이 받는 결과의 네 상태(succeeded, failed, denied, unknown)는 남긴다. "돌았나, 안 돌았나, 모르나"는 책임과 다른 축이고 write를 다시 부를지 정하는 데 쓴다. 여기에 호출 id, stage, 책임, 이유를 더한다. denial code는 책임이 하나가 되게 다시 나눈다.
- preview 호출도 호출 기록을 남긴다. agent가 재현한 것이 사람 화면의 실패와 같은 모양의 증거로 남는다.
- agent의 진단 read는 하나다(`app.calls`). 이름마다 성공 횟수와 마지막 성공, 책임별 실패 수를 먼저 주고, 성공이 아닌 호출을 최신 순으로 준다. `app.invocations`는 "data를 바꾼 호출" 목록으로, `app.logs`는 process 출력(stdout, 예외 stack, process 종료)으로 남는다.
- 오늘 넣은 땜질(`view_error call_rejected` 줄, core `logRejected`, shell main `callRejected`, `app.log_view_error`의 `call_rejected`)은 호출 기록이 서면 지운다.
- core span에 호출 id, 앱, 이름을 싣는다. trace id를 앱 process까지 나르지 않는다(호출 id가 그 일을 한다).

## 모델

```
 화면 / agent tool / job / event / 다른 앱 / flow
        │  host는 신원만 붙인다(검사 없음)
        ▼
 core 입구 ── id를 만든다 ── 호출 기록을 연다
        │ ① 입구 검사(앱이 준 값, 선언, 크기)     끝나면 contract 또는 state
        │ ② caller 확인, Gate                      contract 또는 state (lophn이 만든 caller가 틀리면 platform)
        │ ③ 줄 서기, 전달(supervisor, 앱 process)  state(꺼짐, 교체 중) 또는 platform
        │ ④ handler                                app
        │ ⑤ 결과 검사와 돌려주기                   contract(결과 규칙) 또는 platform
        ▼
 호출 기록을 닫는다: { id, 앱, 입구 종류, 이름, caller, mode, 시작, 끝, stage, 책임, code, 이유 }
        ├▶ 호출한 쪽: 네 상태 + id, stage, 책임, 이유
        ├▶ 앱마다의 호출 기록(성공은 횟수, 성공이 아닌 것은 한 건씩)
        ├▶ data를 바꿨을 수 있으면 ledger invocation(같은 id)
        └▶ lophn 쪽 목록은 같은 기록에서 책임이 platform인 것을 읽는다
```

- 호출 기록에는 상태가 없다. 열림, 닫힘, 묶음, 닫기 gate가 없고 고쳤다는 표시도 없다. 한 번 쓰고 읽기만 한다.
- 앱 log 줄은 호출에 매달린다. 줄의 `invocation` 칸이 호출 id다.
- agent의 진단 순서는 하나다. `app.calls`를 읽는다. 호출이 없으면 화면이 부르지 않은 것이다(화면 render 오류를 본다). 있으면 책임으로 간다: `app`은 handler나 화면을 고친다. `contract`는 적힌 규칙대로 앱의 호출을 고친다. `state`는 사람이 할 일을 말한다. `platform`은 멈추고 호출 id와 함께 lophn 쪽 문제라고 알린다.

## 지키는 것 (계획이 check나 type으로 잡을 것)

1. 호출 경로에서 호출을 끝내는 모든 자리는 닫힌 목록의 값 하나를 쓴다. 목록 밖 오류로 끝낼 수 없다.
2. 목록의 값마다 stage 하나와 책임 하나가 있다.
3. 앱이 준 값을 검사하는 자리는 입구 하나다. host와 뒤 hop에는 없다.
4. core 입구를 지난 호출은 어떻게 끝나든 호출 기록이 하나 있다. 성공한 read도 횟수에 든다.
5. 호출한 쪽이 받는 실패에는 언제나 호출 id와 책임이 있다(화면, agent tool, CLI, 다른 앱).
6. agent가 받는 앱 호출의 실패에는 이유 문구가 실린다. 다른 workspace의 이름과 존재를 가리는 고정 문장(`forbidden`, `not_found`)은 그대로다.

## 일의 덩어리와 순서

1. **계약 고정.** 끝나는 자리 목록(stage, 책임), 호출 기록의 모양, 호출한 쪽이 받는 결과, `app.calls`의 출력. protocol만 고친다. 뒤 덩어리가 모두 여기에 기댄다.
2. **core 호출 경로.** id를 입구에서 만들기, 모든 끝에 목록 값 달기, 버려지던 이유 살리기, 한 문구로 뭉친 원인 가르기, 호출 기록 쓰기(preview 포함), ledger에는 data를 바꾼 호출만.
3. **화면 길.** shell main과 폰 host에서 검사 빼기, 입구 검사 하나로 모으기, 화면이 받는 결과에 id와 책임, 땜질 지우기.
4. **읽기.** `app.calls` route와 CLI와 agent 출력, Activity 화면, core span의 호출 id.
5. **SDK와 지침.** `useOperation`과 `ErrorState`, 앱 간 호출 결과, SDK guide, `prompts/app.md`·`home.md`·`repair-app`·앱 template의 진단 순서. `sdk-note`가 걸린다.
6. **뒤로.** view 열기의 실패(desktop 13곳, 문구가 버려지고 code만 간다), 화면 bridge의 다른 채널(19곳), 폰에서 도는 앱의 local 호출.

1과 2는 한 줄이다(2가 1의 목록을 채우며 고친다). 3, 4, 5는 1과 2가 끝나면 path가 갈려 나란히 돌 수 있다. 계획을 열 때 다시 본다.

## 범위 밖

- agent 쪽 실패(provider 실패, turn 실패, tool 실패)의 책임 가르기. 이 일은 AI가 만든 code와 lophn이 만나는 앱 호출 경계만 본다.
- 기록된 호출을 다시 보내는 tool. 이유와 입력이 남으면 agent가 `preview.call`로 재현한다.
- log 내보내기, OTel SDK(`observability.md`의 비목표 그대로).
- rewind의 동작.

## 조사에서 같이 나온 것

계획에서 다루거나 따로 이슈로 올릴 후보다. worker 보고이고 planner가 code로 확인한 것은 아니다.

- `app-call.md`가 denial code를 넷이라고 적는다(code는 여섯). `app.invocations` 설명은 denied 호출이 남는다고 하지만 `not_declared`와 보관된 앱의 거절은 남지 않는다.
- intake가 닫힌 동안(activation, rewind) 호출이 timeout 없이 기다린다.
- 폰 host가 읽지 못한 guest 메시지를 말없이 버려 guest의 호출이 끝나지 않는다.
- `app.logs` 결과가 24 KiB를 넘으면 agent가 받는 preview가 가장 오래된 줄 쪽이다.
- event 전달이 `denied`, `failed`, `unknown`으로 끝나도 아무것도 남기지 않는다(route 오류와 throw만 warn log).
- handler가 `HandlerRejection`으로 거절하거나 `Error`가 아닌 값을 던지면 앱 log에 줄이 없다.
- 사람 터미널의 `lophn preview call`이 `view_session` 없는 person caller를 보낼 수 있다.
- `diagnostics/list`는 읽는 곳이 없고 `app_invocation_delivery_loss` 종류는 내는 곳이 없다.
