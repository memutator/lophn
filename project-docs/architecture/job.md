# job

job은 정해진 때 저절로 도는 일 하나다. 때는 주기(`every`, 선택 `at`)이거나 event(앱 event나 core의 session event, "event로 도는 job")이다. 할 일 하나(agent 호출 run, 앱 tool 호출 run, workflow instance 시작)와 놓친 차례 정책(`run`, `hold`)을 갖고, scheduler가 차례마다 job run 한 줄을 남기며 그 일을 시작한다. agent가 만들고 사람이 등록을 한 번 승인해야 돈다. 사람은 화면에서 보고 고치고 끄고 지운다. core가 떠 있는 동안 돌고, 앱을 Quit해도 core가 남으면 계속 돈다. job은 만든 기계(주인 기계)에서만 돈다. 다른 기계의 job은 멈춘 채 보이고 사람이 이 기계로 가져온다.

## 문제

사람이 agent에게 일을 시키는 길이 그때그때의 화면과 CLI뿐이면 "10일마다 폴더를 옮겨라", "매주 workflow를 시작해라" 같은 일을 맡길 수 없다. 정해진 때 도는 일이 생기면 사람이 지켜보지 않는 채로 바깥 효과(파일 옮기기, 앱 data 바꾸기, agent의 작업)가 되풀이된다. 이 경계가 흐려지면 다음이 생긴다.

- lophn이 꺼진 사이 놓친 차례가 몇 번이든 같은 바깥 효과가 여러 번 난다.
- 앞 차례가 아직 도는데 같은 job이 또 돈다.
- 사람이 승인하지 않은 일이 사람 없이 되풀이된다. 승인한 뒤 할 일이 바뀐다.
- 켤 때 끊긴 차례가 영영 `running`으로 남아 그 job이 다시 돌지 않는다.
- 다른 agent가 남의 job을 끄거나 주기를 바꿔 남의 일을 흔든다.
- 한 사람의 data root가 다른 기계로 복사되면(또는 뒤에 기계 사이에 job이 오가면) 같은 job이 두 기계에서 돌아 같은 바깥 효과가 두 번 난다.

## 목표와 비목표

- 목표: 승인한 job은 정해진 주기로 돈다. 놓치거나 겹치거나 끊겨도 같은 바깥 효과가 두 번 나지 않고, 그 일이 사람에게 기록으로 남는다. 사람이 보고 끄고 지울 수 있다.
- 비목표: cron 문법. 간격(분, 시간, 일)과 하루 중 시각으로 쓰려는 일(10일마다, 매일 09:00)이 다 된다. 모자라면 그때 더한다.
- 비목표: 자동 재시도. 같은 바깥 효과가 두 번 날 수 있고, 틀린 답을 다시 하는 것은 부르는 쪽(사람이나 flow)이 정할 일이다.
- 비목표: 사람이 job을 만드는 길. 만드는 것은 agent뿐이고 사람은 승인한다.
- 비목표: job의 할 일을 만든 뒤 바꾸기, `revision`과 동시 고치기 충돌 검사.
- 비목표: event를 믿게 하는 장치(저장, cursor, 재시도). event로 도는 job은 켜져 있는 동안 온 event에만 반응하고 놓친 event는 따라잡지 않는다.
- 비목표: core를 띄우는 일. 꺼진 core는 다음 ensure(앱 실행, CLI 명령)나 사람이 표시한 기계의 로그인 시작이 띄운다(`architecture/platform.md` "늘 켜 둠").
- 비목표: job을 기계 사이에 맞추거나 저절로 옮기기. 옮기는 것은 사람의 take over 하나다.

## 모델

```
 agent: lophn job create | update | delete | list         (어느 workspace 종류의 session이든)
 사람: Jobs 탭(어느 workspace에서든) · Jobs overlay        job.update | delete | list | job_run.list
 사람: 대기 목록의 승인 card                              job.pending | job.approve
 사람: 대기 목록의 hold card                              job.holds | job.decide_hold
 사람: Jobs 탭의 [Run on this computer]                    job.take_over
   │  이름 풀기(agent·앱·project)와 시간대는 port로 받는다
   ▼
 job command (한 tx)  ──▶  jobs 표, job_runs 표 (정본)
   └ commit 뒤 "jobs changed" ─▶ scheduler 깨우기, StateChanged(jobs) (남지 않는 event)
                                   └▶ 화면이 job·hold를 다시 읽는다

 scheduler 바퀴 (한 번에 한 바퀴)         깨우는 것: timer | wake | 최대 잠 1분
   1 열린 줄 닫기   workflow_start의 running 줄: instance가 ended → done, stopped → cancelled
                   그 밖의 running 줄(run이 있음): run이 끝났으면 그 상태로 다시 닫는다 (켜는 첫 바퀴는 제외)
   2 job.claim_due  이 기계의 승인한 job만 본다. 온 차례를 job run 줄로 만들고 시작할 줄(queued)을 한 번만 넘긴다. 다음 차례 시각도 받는다
   3 시작           agent_run | tool_run → run을 연다(origin = job, job run)   workflow_start → workflow instance를 시작(시작한 쪽 = job)
   4 job_run.started  줄을 running으로, run·instance·session id를 적는다
   5 run이면 끝까지 기다렸다가 job_run.ended (done | failed | cancelled)
   6 다음 차례까지 timer를 건다 (최소 1초, 최대 1분)

 tool_run: run 연산이 앱 호출 경로를 program caller로 부른다 ─▶ 승인한 job이라 막지 않는다 (architecture/app-call.md)
 켤 때: 첫 바퀴가 startup claim이다. 도는 중 끊긴 줄을 interrupted로 닫고 꺼진 사이 온 차례를 놓친 차례로 접는다
```

- `jobs` 표(job 한 행)와 `job_runs` 표(차례마다 한 행)가 정본이다. 쓰는 것은 job command(`job.create`, `job.update`, `job.approve`, `job.delete`, `job.decide_hold`, `job.take_over`)와 scheduler의 machine command(`job.claim_due`, `job_run.started`, `job_run.ended`)뿐이다. 화면, CLI, agent는 route로 읽는다.
- 다른 module은 이 표를 SQL로 읽지 않는다. scheduler는 run과 instance를 run service와 workflow service, workflow instance 읽기로만 본다(`architecture/layers.md`).
- scheduler의 core 안 자격은 `machine:jobs`다. operation은 `job.claim_due`, `job_run.open`, `job_run.started`, `job_run.ended`, workflow instance 읽기이고 기동 때 ledger에 기록한다.

### job

- 주기는 `every`와 `at`이다. `every`는 `<수><m|h|d>`(분, 시간, 일, 수는 1~99999)이고 cron 문법은 받지 않는다. `at`(`HH:MM`)은 `d` 단위 주기에만 둘 수 있다(아니면 `invalid_input`). 시각은 이 컴퓨터의 local 시간대이고 시간대는 port로 받는다.
- 할 일은 셋 가운데 하나다.
  - `agent_run`: 부를 agent(`{agent, workspace?}`, agent 이름이고 workspace가 없으면 home)와 prompt, 선택 입력 JSON과 출력 schema.
  - `tool_run`: 앱(id, slug, 이름)과 tool 이름, 선택 입력 JSON.
  - `workflow_start`: `<project 이름>/<name>`, 시작 입력 글, 선택 step. `kind: agent`와 `kind: flow`를 다 시작한다. step은 agent workflow의 시작 자리이고 flow에 주면 차례에 `invalid_input`으로 실패한다.
- 이름은 만들 때(또는 `action`을 바꿀 때) core가 풀어 id로 저장한다(agent는 agent id와 workspace, 앱과 project는 id). 앱의 tool 이름과 workflow file은 차례에 부를 때 본다. 못 풀면 만들지 못하고(`not_found`), 차례에 못 찾으면 그 job run이 실패로 남는다.
- `title`은 1~80자이고 목록, card, run 줄과 instance 줄에 보일 이름이다.
- 놓친 차례 정책은 `run`(켜지면 바로 한 번 돈다)과 `hold`(사람에게 묻는다) 둘이다.
- 켜고 끄기(`enabled`)가 있다. 꺼진 job은 `next_due_at`이 null이고 돌지 않는다. 만들 때 `enabled`는 기본 true다.
- `approved_at`은 사람이 등록을 승인한 때다. null이면 승인 대기이고 `next_due_at`도 null이며 돌지 않는다.
- 만든 쪽(`creator`)은 그 session의 (agent, workspace)이고(`jobs.creator_agent`, `creator_workspace`, home이면 workspace가 null) job에 남는다. job의 workspace는 `creator`에서 나온다.
- `last_run`은 저장하지 않고 읽을 때 그 job의 가장 새 job run으로 채운다.
- `machine`은 주인 기계의 id다(아래 "주인 기계"). `runs_here`는 저장하지 않고 읽을 때 `machine`을 이 기계 id와 견준 것이다.

### 주인 기계

- job은 만든 기계의 id(`machine`, 기계 신분의 `mch_…`)를 싣고 그 기계에서만 돈다. 만들 때 core가 이 기계 id를 찍는다.
- 이 칸이 생기기 전의 job은 `machine`이 null이고 이 기계 것으로 읽는다(`runs_here: true`). 새 판의 첫 startup claim이 null인 job에 이 기계 id를 찍는다. schema step은 기계 id를 모르기 때문이다. 그 뒤 다른 기계로 복사된 data root는 원래 기계의 id를 들고 가므로, 복사본에서는 그 job이 다른 기계의 것이다(기계 신분은 복제를 새 기계로 다룬다).
- `runs_here`가 false인 job(다른 기계의 job)은 차례를 만들지 않고(`job.claim_due`의 질의와 차례 만들기가 둘 다 거른다), 이미 있는 `queued` 줄도 넘기지 않고, event로 열리지 않고(`job.fire_event`와 `job.event_triggers`가 이 기계 job만 본다), 놓친 차례를 [Start now]로 돌리지 못하고(`conflict`), idle-exit의 일로 세지 않는다(`job.activity`). 승인 대기 목록과 hold 목록에도 나오지 않는다. 목록(`job.list`)에는 나오고, 사람은 그 job을 고치고 끄고 지울 수 있다.
- 사람만 부르는 `job.take_over { job }`이 이 기계로 가져온다. `machine`을 이 기계 id로 바꾸고, 켜져 있고 승인된 주기 job은 다음 차례를 지금부터 새로 센다(다른 기계에 있던 동안은 놓친 것으로 치지 않는다). 열린 `held` 줄은 그대로 두어 이제 [Start now]가 된다. 이미 이 기계 것이면 `conflict`, 없으면 `not_found`, agent면 `forbidden`이다. 사람이 고친 것이 아니라 `updated_at`은 그대로다.
- 이 기계 id는 jobs의 port가 `machine.json`에서 읽는다(Worker마다 처음 한 번). 읽지 못하면 그 command와 read가 `unavailable`로 실패한다. 어느 기계의 것인지 모르는 job을 돌리지 않는다.
- 기계를 넘어 오는 job(뒤의 기계 사이 sync)도 같은 칸과 같은 멈춤을 쓴다.

### event로 도는 job

```
 앱 process: publish ─▶ app_events.publish ─┐             lophn: session.* event (core가 낸다) ─┐
                                            ▼                                                  ▼
                              앱 event 전달(createEventDelivery) ── 안 구독자(앱이 아니다, 호출 기록 없음) ─▶ jobs wiring
                                            └▶ job.fire_event (machine, 한 tx)
                                                 승인하고 켜진 job 가운데 이 (source, event)를 때로 가진 것마다:
                                                   볼 event가 아니면 넘김(범위 · 자기 run · 앱 사슬)
                                                   앞 차례가 돎 → 건너뜀 busy | 최소 간격 안 → 건너뜀 too_soon (센다)
                                                   아니면 event를 실은 queued 줄 + scheduler 깨우기 ─▶ 평소 차례와 같은 시작
```

- 때는 `every`(+`at`)와 `trigger` 가운데 정확히 하나다. `trigger`는 `{source, event, min_interval, pass_event}`이고 저장할 때 앱은 id(`app`)와 승인 때의 slug(`source`)로 풀린다. source는 앱 아니면 `lophn`이다.
  - 앱 source: 등록할 때 그 앱의 active release가 그 event를 선언했어야 한다(`invalid_input`). 나중 release가 선언을 빼거나 앱을 보관하면 job은 돌지 않고, `job.list`가 그 job에 `source_gone`을 달아 목록이 "The source no longer publishes this event"를 보인다(읽을 때 선언을 한 번 본다). 앱을 지우면 그 앱을 때로 가진 job도 지운다. 그 앱의 workspace에 job의 workspace가 call 정책으로 닿을 수 있어야 한다(등록 때 `forbidden`, 때가 되면 닿지 못하는 앱의 event는 건너뛰지도 세지도 않고 넘긴다). job이 같은 앱의 tool을 부르는 `tool_run`이면 만들 수 없다(`invalid_input`): 그 앱의 호출이 낸 event는 사슬에 그 앱이 있어 이 job으로 돌아오지 못하니 영영 돌지 않는다. agent_run이나 workflow가 그 앱을 부르게 한다.
  - `lophn` source: core가 내는 `session.started|running|waiting|idle|ended`만이다. 한 앱에게만 가는 `call.settled`는 때가 아니다(`invalid_input`).
  - 다른 컴퓨터의 앱 source: trigger에 `machine`(컴퓨터 이름, `mch_`, `dev_`)을 적으면 core가 저장 전에 그 컴퓨터를 `mch_`로 풀어 `source_machine`으로 저장한다(못 풀면 `not_found`, 같은 이름이 둘이면 후보와 `invalid_input`, 이 컴퓨터면 `invalid_input`이다. `lophn` source와는 같이 쓰지 못한다). 그 앱은 이 컴퓨터에 없을 수 있어 `source`는 앱 id(`app_…`)로 적고 이 컴퓨터의 선언과 call 정책으로 검사하지 않는다(없는 event는 돌지 않을 뿐이다). 구독은 이 컴퓨터의 core가 그 컴퓨터에 걸고(`event.md`의 "다른 컴퓨터의 앱 event를 구독"), 온 event는 `source_machine`이 같은 job만 연다. 이름이 바뀌어도 `mch_`를 저장해 그대로다. private인 workspace의 job은 만들어지지만 구독이 걸리지 않아 돌지 않는다. `job.list`는 그 job에 `source_gone`을 달지 않는다(이 컴퓨터의 선언으로는 알 수 없다). 승인 card, Jobs 목록, 고치기 창, 폰은 때를 말할 때 그 컴퓨터의 이름을 붙인다(이름을 모르면 기계 id): 사람이 승인하는 것은 다른 컴퓨터의 일이다.
  - trigger의 컴퓨터와 주인 기계는 다르다. job은 늘 주인 기계(만든 컴퓨터)에서만 돌고(아래 "주인 기계") trigger의 컴퓨터는 event가 오는 곳일 뿐이다. 그 event로 연 차례는 받은 호출로 표시되지 않아(이 컴퓨터의 agent가 자기 할당으로 일하는 평소의 run이다) 그 agent가 다른 컴퓨터를 부를 수 있다.
- `min_interval`은 `<수><m|h|d>`이고 기본 5분이다. 등록 때 정하고 승인 대상이다(승인한 뒤 고치지 못한다. 때 전체가 그렇다). 같은 job의 두 차례는 마지막으로 연 때에서 이만큼 떨어진다.
- event job에는 `next_due_at`, `at`, 놓친 차례가 없다(저장한 `missed_policy`는 뜻이 없다). 켤 때 닫힌 줄도 놓친 차례를 만들지 않는다. 바뀌는 것: 만들기·승인·고치기·목록. 같은 것: 승인, 한 번 승인한 할 일, 도는 줄(queued, running)·job run 기록, 겹침, 켜고 끄기, 지우기.
- 켜진 job이 있으면 idle-exit가 core를 끄지 않는다(event를 받으려면 떠 있어야 한다). 그래서 켜 둔 event job은 core를 계속 켜 둔다.
- 건너뜀은 job run 줄로 쌓지 않고 job의 `skipped_count`, `last_skipped_at`, `last_skip_reason`(`busy` | `too_soon`)으로 센다. 연 것은 `fired_count`, `last_fired_at`이다. 이유: session event는 흔해서(상태가 바뀔 때마다) 줄로 쌓으면 history가 건너뜀으로 덮인다. 사람과 agent는 `job.list`(Jobs 목록, `lophn job list`)에서 본다. 연 차례는 보통의 job run 줄이고 그 줄이 `event`(`{source, event, payload}`)를 갖는다.
- 보는 범위: `lophn`의 session event는 job의 workspace(만든 session의 workspace, home이면 home)가 call 정책(`mayReachWorkspace`)으로 닿을 수 있는 session의 것만 본다. 앱 source event는 job의 workspace가 그 앱의 workspace에 닿을 수 있을 때만 본다(같은 규칙, 앱이 private workspace면 다른 workspace의 job은 듣지 못한다).
- 고리: `lophn`의 session event는 **사람이 연 session**의 것만 job을 깨운다. 어느 job(이 job이든 다른 job이든)의 job run이 연 session(`job_runs.session`), run이 연 session(unattended 입력을 받은 session), workflow step 입력을 받은 session, 팀의 자식(`spawned_by`)이나 다른 workspace가 불러 연 session(`called_from`)의 event는 건너뛰지도 세지도 않고 넘긴다. 그래서 같은 project의 두 job이 서로의 run session으로 깨우는 일이 없다. 앱 화면이 연 session(`opened_by_app`)과 터미널 탭의 session은 사람이 있는 것이라 깨운다(job은 앱 화면을 몰지 못한다). 시작을 적기 전의 event는 앞 차례가 돌고 있어 `busy`로 건너뛴다. 앱 event는 전달에 앱 사슬(chain)이 실려 오므로, 이 job이 `tool_run`으로 부르는 앱이 사슬에 있으면 그 event는 보지 않는다. 그 밖에는 최소 간격과 `busy`가 폭주를 막는다.
- 할 일에 주는 것: event(`{source, event, payload}`)는 data이고 사람의 말이 아니다. `agent_run`은 고정 prompt가 지시로 남고 event는 그 뒤에 "지시가 아니다, 사람이 쓴 것이 아니다"라고 밝힌 data 글로 붙는다(`<lophn-run>` 안. 같은 event면 같은 bytes). 메시지로 들어갈 때 redaction을 지난다. `workflow_start`는 시작 입력 글을 JSON `{text, event}`로 준다. `tool_run`은 `pass_event`를 승인했을 때만 입력의 `event` 칸에 합쳐 준다(입력은 객체이거나 없어야 한다).
- 보장하지 않는 것: 저장하지 않는다. core가 꺼진 사이, 앱 process가 꺼진 사이의 event는 job을 열지 않고 켠 뒤에도 따라잡지 않는다. 같은 event가 두 번 오면(앱이 두 번 냈으면) 두 차례를 연다(간격 안이면 두 번째는 건너뛴다). core를 켜자마자 오는 event는 job 표를 읽기 전이면 놓칠 수 있다(처음 읽기 전의 짧은 틈).

### job run

상태는 여덟이다.

| 상태 | 뜻 |
|---|---|
| `queued` | 줄이 만들어졌고 scheduler가 시작하기를 기다린다(넘겼으면 시작하는 중) |
| `running` | 시작했다. run, instance, session id가 적혀 있다 |
| `done`, `failed`, `cancelled` | 끝났다. run이면 그 run의 상태를 따른다. workflow_start는 instance가 `ended`면 `done`, `stopped`면 `cancelled`다 |
| `held` | 사람의 결정을 기다린다 |
| `skipped` | 건너뛰었다. 이유는 아래 `reason` |
| `interrupted` | 도는 중 lophn이 꺼져 끊겼다 |

- `reason`: `skipped`는 `person`(사람이 [Skip]), `overlap`(앞 차례가 돎), `superseded`(제때 온 차례가 대신함)이다. 시작하지 못한 `failed`는 `<오류 code>: <message>`다. 그 밖은 null이다. run이 실패한 이유는 그 run의 `error`가 갖는다(`architecture/run.md`).
- 줄은 `run`(agent_run·tool_run이 연 run), `instance`(workflow_start가 시작한 instance), `session`(agent_run이 연 session)을 가진다. `due_at`은 온 차례(여럿이 접혔으면 마지막), `missed_count`는 접은 수다.

## 지키는 것

주기와 정책
1. `every`는 `<수><m|h|d>`만, `at`은 `d` 단위 주기에만 받는다. 어기면 `invalid_input`이다.
2. 놓친 차례 정책은 `run`과 `hold` 둘뿐이다.
3. 꺼진 job과 승인 전 job은 `next_due_at`이 null이고 차례를 만들지 않는다.
4. 주기를 바꾸거나 `at`을 바꾸거나 꺼 둔 job을 다시 켜면 그때부터 새로 센다(`next_due_at`을 지금 뒤의 첫 차례로 다시 잡는다). 놓친 것으로 치지 않는다. 승인 전 job은 `next_due_at`을 null로 둔다.

만들고 고치는 쪽
5. job을 만드는 것은 agent뿐이다(`job.create`의 actor는 agent). 사람은 만들지 못한다.
6. agent는 같은 agent, 같은 workspace가 만든 job만 고치고 지우고 읽는다. 남의 job은 있는지도 알리지 않는다(`not_found`). 사람은 모든 job을 고치고 끄고 지우고 읽는다. 모르는 session이면 `forbidden`이다.
7. 할 일(`action`)은 만든 뒤 바꾸지 못한다(`job.update`에 칸이 없다). 다른 일은 지우고 새 job으로 만든다. 제목, 주기, 놓친 차례 정책, 켜고 끄기는 고쳐도 다시 묻지 않는다.
8. job 지우기는 job과 그 job run을 같은 tx에서 지운다(FK 없이 command가 두 표를 같이 지운다). 도는 run이나 instance는 끝까지 돈다. 지운 job이 남긴 run과 instance에서는 job 제목이 사라진다(id만 남는다).
9. 앱을 지우면 그 앱 workspace가 만든 job과 그 앱을 부르는 job(앱 tool, 앱 workspace의 agent 호출)을 같은 tx에서 지운다. 도는 run은 끝까지 돈다.

승인
10. agent가 만든 job은 승인 대기다. 종류(agent_run, tool_run, workflow_start)와 상관없다. 승인(`job.approve`)은 user만 하고 job마다 한 번이다. 이미 승인한 job에 다시 오면 `conflict`다(단 아래 12a의 `mode_escalated`로 일시 정지된 `workflow_start` job의 재승인은 허용한다).
11. [Approve]는 `approved_at`을 적고(`workflow_start` job이면 현재 해석된 participant별 권한 단계를 `jobs.approved_modes_json`에 함께 스냅샷한다), 켜져 있으면 그 순간부터 센 첫 차례를 `next_due_at`에 잡는다. 기다린 동안은 놓친 것으로 치지 않는다. [Reject]는 job을 지운다.
12. scheduler는 승인한 job만 본다. 차례를 뽑는 질의와 차례를 만드는 쪽이 둘 다 거른다. 승인 전 job의 `held` 줄도 [Start now]가 `conflict`다. 위험 test가 있다(권한 경계).
12a. **`workflow_start` job의 권한 단계 표시와 상향 일시정지(`mode_escalated`)**:
    - `job.pending`·`job.list`는 `workflow_start` job에 현재 해석된 `participant_modes`(기억된 `approvals.workflow_modes` → agent 정의 `permission_mode` → 전역 기본 `approvals.default_mode`)를 붙여 승인 카드가 쓰일 권한 단계를 보이게 한다.
    - 승인 시점의 participant 단계 스냅샷(`jobs.approved_modes_json`, schema step `jobs.approved-modes`)과 현재 기억된 workflow 단계를 비교해, 승인 당시 `full`이 아니었던 participant가 나중 `full`로 올라갔으면 해당 job은 `approval_paused_reason: "mode_escalated"` 상태가 되어 자동 일시정지한다.
    - 일시정지된 job은 `job.claim_due`·`job.fire_event`·scheduler 실행에서 건너뛰고 `job.pending` 대기 목록에 다시 나타나 사람이 새 `full` 단계를 보고 다시 승인(`job.approve`)하기 전까지 돌지 않는다("승인 뒤 할 일의 권한이 몰래 넓어지지 않는다").
13. 승인 칸이 생기기 전의 job은 migration이 승인 대기로 옮겼다.

언제 도나
14. core가 떠 있는 동안 돈다. 이 기계의 켜진 job(승인 대기 포함)이나 그 열린 job run이 있으면 idle-exit가 core를 끄지 않는다(`architecture/platform.md` "core 수명", 읽는 route는 `job.activity`).
15. 깨우는 길은 셋이고 바퀴는 같다. 다음 차례 시각 timer, 깨우기(job command의 commit 뒤), 최대 잠이다. 대기는 다음 차례까지이고 최소 1초, 최대 1분이다(켜진 job이 없으면 1분). 한 번에 한 바퀴만 돌고, 도는 사이 온 깨우기는 바퀴를 끝낸 뒤 한 번 더 돈다.
16. `job.claim_due`가 실패하면 60초 뒤 다시 한다. 첫 claim이 한 번 성공할 때까지는 재시도도 startup claim이다. 켤 때 한 번의 일이 빠지지 않게 하려는 것이다.

놓친 차례
17. 한 번의 `job.claim_due`가 한 job에서 온 차례를 몇 개 보든 job run 줄은 하나다. 마지막 차례를 `due_at`으로 쓰고 접은 수를 `missed_count`에 적는다(제때 온 차례는 0).
    - 켤 때(startup claim)는 온 차례가 모두 놓친 차례다. 도는 중 lophn이 꺼져 끊긴 차례도 놓친 차례로 하나 더 친다. 켜진 채 timer가 늦어 여럿이 한꺼번에 오면 하나는 제때로 치고 나머지가 놓친 차례다.
    - 켜진 채여도 가장 오래된 온 차례(`next_due_at`)보다 10분 넘게 늦게 처리하면 켤 때와 같다. 온 차례가 모두 놓친 차례다(컴퓨터가 잠들었다 깬 경우). 10분 안이면 제때다.
    - 정책 `hold`는 켤 때와 10분 넘게 늦은 놓친 차례에 걸린다. 제때 온 차례는 `run`처럼 돈다.
18. 몇 번을 놓쳐도 한 번만 돈다. 몇 번 놓쳤는지는 기록에 남는다.

겹침
19. 앞 차례가 아직 돌면 이번 차례는 건너뛰고 `skipped`(`reason: overlap`) 줄로 남긴다. 판정은 `job_runs` 표 하나로 한다: 그 job에 `queued`나 `running` 줄이 있으면 돈다. run이든 instance든 같다.
20. 도는 줄(`queued`, `running`)과 기다리는 줄(`held`)은 job마다 하나다. unique index 둘이 코드가 틀려도 표가 한 겹 더 막는다.

hold
21. `hold` job이 놓친 차례를 만나면 줄을 `held`로 남기고 대기 목록에 card가 뜬다. 사람이 [Start now]나 [Skip]을 고른다(`job.decide_hold`). [Skip]은 `skipped`(`person`)이고 [Start now]는 줄을 `queued`로 돌려 scheduler를 깨운다.
22. 기다리는 동안 또 놓친 차례는 같은 줄에 접는다(`due_at`을 옮기고 `missed_count`를 더한다). card가 쌓이지 않는다.
23. 제때 온 차례가 돌게 되면 기다리던 줄은 `superseded`로 닫는다(`skipped`). job이 돌게 되었으니 [Start now]를 기다릴 이유가 없다.
24. 앞 차례가 도는 중 [Start now]를 누르면 `conflict`이고 줄은 `held`로 남아 card가 남는다. card는 꺼졌다 켜져도 남는다. 정본은 `job_runs` 표다.

서머타임
25. 없는 시각(시계가 건너뜀)은 건너뛴 직후의 시각에 돈다. 02:30이 없으면 시계가 건너뛴 순간인 03:00이다.
26. 같은 시각이 두 번 오는 날은 첫 번째에 한 번만 돈다.
27. `at`이 없는 `Nd`는 24시간 × N인 고정 길이다. 서머타임에 local 시각이 밀린다. 시각을 지키려면 `at`을 준다. `at`이 있으면 날짜를 달력으로 더하고 그날의 시각을 푼다.

시작과 끝
28. agent_run은 이름을 푼 agent로 run을 연다. 차례마다 새 session을 열고(그 workspace의 Main desk에 Agent 탭으로도 열린다. `architecture/run.md`) unattended 사람 메시지로 turn을 연다. 끝은 그 run의 상태다. run의 결과 칸은 job run에 옮기지 않고 run 기록에서 읽는다.
29. tool_run은 run 연산이 앱 호출 경로를 program caller로 부른다. 앱이 꺼졌거나 tool이 선언에 없으면 run이 실패하고 job run이 `failed`다.
30. workflow_start는 workflow 시작을 시작한 쪽 `{kind: "job", job}`으로 core 안 service에서 직접 부른다. 사람만 받는 `StartWorkflow` route는 그대로다. flow면 service가 그 process를 띄운다. 시작하지 못하면(`conflict` 등) job run이 `failed`다. 끝은 scheduler가 다음 바퀴에 instance 상태를 읽어 안다: `ended`면 `done`, `stopped`면 `cancelled`. 한 번 닫은 줄은 instance가 다시 열려도 되살리지 않는다.
31. 시작하지 못한 차례(이름이 안 풀림, run 시작 실패)는 그 자리에서 `failed`로 닫는다. run을 기다리다 오류로 그치거나 lophn이 꺼지는 중이면 거짓 끝을 적지 않고 줄을 둔다. 다음 켤 때 `interrupted`로 닫힌다.
32. `job_run.ended`를 오류로 못 적었어도 바퀴마다 run이 있는 열린 줄의 run 상태를 기다리지 않고 한 번 읽어 끝났으면 `ended`를 다시 적는다. 다시 부르기 loop는 없다. 그렇지 않으면 그 job의 차례가 다음 기동까지 모두 `skipped(overlap)`가 된다.
33. `job_run.started`나 `job_run.ended`가 `not_found`(그 사이 job이 지워짐)나 `conflict`(켤 때 이미 닫힘)면 정상이라 넘긴다. 그 밖의 오류는 log 한 줄이다.

켤 때
34. 첫 바퀴의 startup claim이 남은 도는 줄을 먼저 닫는다. `running` 줄과 `queued`인데 넘겨진 줄은 `interrupted`로 닫는다. 넘겼지만 `job_run.started`를 적었는지 알 길이 없는 줄이라 할 일과 상관없이 닫는다.
35. 예외는 workflow_start의 `running` 줄이다. agent instance는 lophn 없이도 돌았으므로 줄을 둔다. 다음 바퀴가 instance 상태를 읽어 닫는다. flow instance는 켤 때 process 없이 `ended`로 닫히므로(다시 띄우지 않는다, `architecture/workflow.md`) 다음 바퀴가 그 줄을 `done`으로 닫고 다음 차례는 평소대로 돈다.
36. 첫 바퀴는 run 줄의 run 상태를 읽지 않는다. runs가 끊긴 run을 이미 `lophn_restarted`로 닫아 두었으므로 읽으면 그 줄이 `failed`로 닫혀 위 `interrupted`와 놓친 차례 계산이 사라진다. workflow 줄은 첫 바퀴도 읽는다.
37. 닫은 줄은 놓친 차례로 하나 더 친다. 그 job은 정책대로 한 번 다시 돌거나(`run`) card로 묻는다(`hold`). 켤 때 run 쪽도 같은 일을 한다(`architecture/run.md`).
38. 켤 때 jobs는 runs와 workflows를 맞춘 뒤에 첫 claim을 한다.

권한
39. scheduler 쪽 route(`job.claim_due`, `job_run.open`, `job_run.started`, `job_run.ended`, `job.activity`)는 machine 자격만 받는다. 쓰는 command 셋은 handler도 한 번 더 본다. 사람 쪽 route(`job.pending`, `job.approve`, `job.holds`, `job.decide_hold`, `job_run.list`, `job.take_over`)는 user만 받는다. `job.take_over`는 handler도 한 번 더 본다.
40. tool_run은 사람이 없는 호출이고 허락은 사람의 등록 승인이다. 앱 호출 경로는 program caller를 막지 않는다. 만든 agent의 할당과 비공개 규칙은 보지 않는다(`architecture/app-call.md`, `architecture/approval.md`).
41. agent_run과 workflow_start의 non-human step이 연 turn은 `unattended`다. `unattended`에서 `ask` 판정은 실행되지 않고 `deny`(`no_person`)로 막히며 이유를 남긴다. 미리 둔 allow 규칙이나 해당 agent·participant의 권한 단계가 ④(`full`)인 것만 무인으로 통과한다(`architecture/approval.md`). 받은 agent는 자기 할당으로 일한다.
42. job이 연 agent run의 agent도 job 명령을 받아 job을 만들 수 있다. 막지 않는다. 고치기는 만든 agent만 하고 사람은 모든 job을 등록 때 보고 승인하며 화면에서 보고 끌 수 있다.

주인 기계
43. job은 주인 기계에서만 돈다. 다른 기계의 job은 차례를 만들지 않고, 넘기지 않고, event로 열리지 않고, [Start now]가 `conflict`이고, idle-exit의 일이 아니다. 차례 뽑기와 차례 만들기가 둘 다 거른다. 위험 test가 있다(같은 바깥 효과가 두 기계에서 난다).
44. job을 다른 기계로 옮기는 것은 사람의 `job.take_over`뿐이다. agent는 옮기지 못한다. 가져온 job은 지금부터 새로 세고 다른 기계에 있던 동안을 놓친 것으로 치지 않는다.
45. 주인 칸이 없던 job은 지우거나 멈추지 않는다. 첫 startup claim이 이 기계 id를 찍기 전까지 이 기계 것으로 읽는다. migration은 행을 하나도 잃지 않는다.
46. 이 기계 id를 읽지 못하면 job을 돌리지 않는다.

## 경계와 계약

### route와 event

| 계약 | 누가 | 뜻 |
|---|---|---|
| `job.create` | agent | job을 승인 대기로 만든다. 오류 `invalid_input`·`not_found`(이름 못 풂)·`forbidden` |
| `job.update` | agent(자기가 만든 것), user | 제목, 주기, `at`, 놓친 차례 정책, `enabled`. 할 일 칸은 없다 |
| `job.delete` | agent(자기가 만든 것), user | job과 job run을 지운다 |
| `job.list` | agent(자기가 만든 것), user(모두) | job 목록. id 순 쪽, `last_run`을 채운다 |
| `job_run.list` | user | 그 job의 job run을 새것부터 쪽으로 준다 |
| `job.pending`, `job.approve` | user | 승인 대기 목록, `approve` \| `reject` |
| `job.holds`, `job.decide_hold` | user | `held` 줄 목록, `run_now`(지금 돌림) \| `skip` |
| `job.take_over` | user | 다른 기계의 job을 이 기계로 가져온다. 오류 `not_found`·`forbidden`·`conflict`(이미 이 기계 것) |
| `job.claim_due`, `job_run.started`, `job_run.ended` | machine | scheduler가 차례를 가져가고 줄을 열고 닫는 command |
| `job.fire_event`, `job.event_triggers` | machine | event가 왔을 때 그 event를 때로 가진 job의 차례를 열거나 건너뛰는 command, 관심 있는 (앱, event) 목록 읽기 |
| `job_run.open`, `job.activity` | machine | 열린 줄과 그 job 읽기, idle-exit가 보는 일(켜진 job이나 열린 job run이 있나) |
| `StateChanged` `jobs` | Bus 남지 않는 event | id는 job. job command의 `changes`와 scheduler가 낸다. 화면이 다시 읽는 신호(`architecture/event.md`) |

- command의 `compare`는 늘 `{}`다(`revision`이 없다).
- 이름 접두사는 `job`(job), `jbr`(job run)다.
- agent가 쓰는 길은 `lophn` tool의 명령 `lophn job create|update|delete|list`다. 세 workspace 종류(Home, project, 앱)의 agent가 모두 쓴다. `job.list`는 agent에게 자기가 만든 job만 준다.
- boundary-catalog ID는 `jobs`다.

### 저장

- `jobs` 표: 한 행에 `title`, `creator_agent`, `creator_workspace`, `every`, `at`, `trigger`(JSON, event job만. every와 trigger는 정확히 하나), `action`(JSON), `missed_policy`, `enabled`, `next_due_at`, `approved_at`, `approved_modes_json`(`workflow_start` job 승인 시점의 participant 권한 단계 스냅샷, nullable, ledger step `jobs.approved-modes`), `machine`(주인 기계 id, 찍기 전 null. ledger step `jobs.machine`), event job의 기록(`fired_count`, `skipped_count`, `last_fired_at`, `last_skipped_at`, `last_skip_reason`), 시각.
- `job_runs` 표: 한 행에 `job`, `due_at`, `missed_count`, `state`, `reason`, `run`, `instance`, `session`, `event`(event job의 차례를 연 event), 넘긴 때, 시작·끝 시각. 넘긴 때는 scheduler에 넘긴 시각이고 record에는 없다. 두 표에 FK는 없고 지우기는 command가 한다.
- unique index: 도는 줄(`queued`, `running`) job마다 하나, `held` 줄 job마다 하나.

### 다른 module과 맞닿는 곳

- run의 origin이 job이다. job이 연 run은 job과 job run을 싣는다. workflow instance의 시작한 쪽은 `{kind: "job", job}`이다(`architecture/workflow.md`).
- 앱 호출의 program caller는 `{kind: "program", job, job_run}`이다. route가 만들지 못하고 core 안 run 연산만 만든다. 본문의 caller는 주장일 뿐이라 core가 만든 자격과 맞춰 본다. 앱 process의 caller parser는 protocol schema의 손 사본이라(앱 process는 Zod를 싣지 않는다) 다섯 종류(person, agent, app, program, flow)를 같이 받아야 한다(`architecture/app-call.md`).
- idle-exit는 `job.activity`로 이 기계의 켜진 job과 그 열린 job run이 있나 읽는다(`architecture/platform.md`).
- 이 기계 id는 기계 신분(`machine.json`)에서 읽는다. jobs는 그 file을 쓰지 않는다.
- 앱을 지우면 그 앱 workspace가 만든 job과 그 앱을 부르는 job을 같은 tx에서 지운다(`architecture/app-call.md`).

### 화면

- Jobs 탭은 모든 job을 한곳에 모은다. desk마다 하나이고 Home·project·앱 어디서든 같은 탭이다(job은 project를 건너고 home에서 만든 job은 workspace가 없어서다). 왼쪽 sidebar의 Jobs 줄은 줄 오른쪽 옆에 Jobs overlay를 열고(줄은 오른쪽 sidebar와 같다) 머리의 [Open in tab]이 이 탭을 연다. Settings에는 job 항목이 없다. 줄마다 제목, 주기, 다음 차례, 마지막 결과, 만든 agent와 그 workspace 이름을 보이고 켜고 끄기, 제목·주기·놓친 차례 정책 고치기, 지우기, 기록(`job_run.list`)을 한다. 할 일을 고치거나 job을 만드는 단추는 없다. 기록 줄에서 session이나 project로 가는 길은 이미 있는 길뿐이다.
- project 창 오른쪽 sidebar의 Jobs panel은 그 project와 걸린 job과 그 규칙을 보인다. 걸린 job은 그 project workspace의 session이 만든 것, 그 project의 agent를 부르는 것, 그 project의 workflow를 시작하는 것이다(`creator`와 `action`으로 읽을 때 가르고 계약은 바꾸지 않는다). 줄은 제목, Switch, 주기, 다음 차례나 대기 상태이고 줄과 "Open all jobs"는 Jobs 탭을 연다.
- 대기 목록의 job card(승인 card와 hold card)는 셋째 read source다(앞 둘은 session snapshot과 activation 동의). `job.pending`과 `job.holds`를 같이 읽어 통째로 맞추고(둘 다 읽혀야 맞춘다) `jobs` 변경(`StateChanged`)을 받을 때 다시 읽는다. 승인 card는 제목, 할 일, 주기, 만든 agent와 workspace를 보이고 [Approve]와 [Reject]는 `job.approve`다. [Start now]와 [Skip]은 `job.decide_hold`다. 결정한 card는 다시 읽을 때 빠지고 toast는 없다.
- Jobs 탭·overlay와 오른쪽 sidebar Jobs panel은 승인 대기 job의 다음 차례 자리에 "Waiting for your approval"을 보인다. 승인은 대기 목록에서만 한다.
- 다른 기계의 job은 다음 차례 자리에 "Belongs to another computer"를 보이고 Jobs 탭의 그 줄에 [Run on this computer](`job.take_over`)가 선다. 화면 source의 선택 함수 `machineName?(machine)`이 그 id의 기계 이름을 알려 주면 "Belongs to <이름>"이다. 지금은 아무도 채우지 않는다(뒤에 기계 기록을 폴더로 받는 쪽이 채운다).
- run 줄과 instance 줄은 job 제목을 보인다. run 줄은 이름 자리에 제목을 두고 agent 이름이나 tool 이름은 둘째 줄이다. instance 줄은 시작한 쪽이 job이면 제목을 보인다. 제목은 읽는 곳이 `job.list`를 읽어 job id로 붙인다. 지운 job의 옛 줄은 제목 없이 원래 이름으로 보인다. 제목은 꾸밈이라 읽기에 실패해도 run과 instance 읽기는 그대로 간다.
- 화면이 다시 읽는 신호는 `jobs` 변경(`StateChanged`)뿐이다. 남지 않는 event라 놓친 화면은 열 때 다시 읽는다(`architecture/event.md`). run과 instance 줄은 지금의 session event와 `workflow_instances` 변경 때 다시 읽으므로 따로 알리지 않는다.

## 결정

- scheduler를 기록 event나 Bus에 얹지 않는다. 이유: 뒤에 꼭 움직여야 하는 일은 그 일을 아는 command가 같은 tx에서 한다(`architecture/event.md`). job command는 표만 바꾸고 commit 뒤 "jobs changed"는 timer를 다시 걸라는 신호일 뿐이다. 신호를 놓쳐도 정본은 표라서 다음 timer나 최대 잠이 같은 표를 다시 읽는다. Reactor 같은 반응 장치(cursor, 멱등 key, backoff)를 지지 않는다. (agent)
- job의 허락을 만든 agent의 할당에서 빌리지 않고 사람의 등록 승인으로 둔다. 이유: 할당으로 판정하면 job 하나를 돌리려고 만든 agent에게 그 앱 전체를 열어 줘야 한다. 그 agent는 다른 session에서도 그 앱의 모든 tool을 부른다. job을 만든 agent는 그 tool을 직접 쓸 이유가 없을 때가 많다(앱 workspace에서 앱을 만든 agent가 그 앱의 수집 job을 만드는 경우). 그 판정에서는 할당이 없어도 job이 만들어지고 차례마다 `gate_blocked`로 말없이 실패했다. 사람이 job 하나를 보고 승인하면 허락이 그 할 일 하나로 맞고, agent가 job으로 권한을 넓히는 길도 승인에서 막힌다. 버린 안: 앱 workspace에서 만든 job이 자기 앱 tool을 부를 때만 할당 검사를 건너뛰기(그 경우만 풀고 근본이 남는다), 만들 때 할당을 검사해 거절하기(필요 없는 할당을 강요한다). (사람)
- 승인은 job마다 한 번이고 다시 묻지 않는다. 할 일은 바꾸지 못하게 해 승인한 일과 도는 일이 어긋나지 않게 한다. (사람, agent)
- [Reject]는 job을 지운다. 이유: 거절한 job을 남겨 둘 쓸모가 없다. (agent)
- agent_run과 workflow_start도 승인을 받는다. 사람 없이 되풀이되는 것은 셋 다 같다. 받은 agent는 자기 할당으로 일한다. (agent)
- 놓친 차례 정책은 job마다 둔다: `run`(켜지면 한 번)과 `hold`(사람에게 묻는다). (사람, 2026-10-20)
- 놓친 차례는 몇 번이든 한 번으로 친다. 이유: 10일 주기를 세 번 놓쳤다고 세 번 옮길 일이 없다. 앞 차례가 돌면 이번 차례를 건너뛰고, 꺼 둔 job을 다시 켜면 그때부터 새로 세고 놓친 것으로 치지 않는다. (agent)
- 차례 시각보다 10분 넘게 늦게 처리한 차례는 켤 때와 같이 놓친 차례다. 이유: 노트북을 덮어 둔 밤을 지나 연 `hold` job이 묻지 않고 돌았다. 버린 안: 지나간 차례가 둘 이상일 때만(하루 안에 연 노트북을 못 잡는다), 주기의 절반보다 늦을 때만(매일 job은 12시간 안을 못 잡는다). (사람, 2026-10-23)
- scheduler의 최대 잠을 1분으로 둔다. 이유: 컴퓨터가 잠든 사이 timer는 가지 않을 수 있어(잠든 시간을 세지 않는 시계로 잰다고 본다) 깬 뒤 늦지 않게 바퀴가 돌아야 한다. 할 일이 없는 바퀴는 읽기뿐이라 1분마다 돌아도 싸고, shell에서 깨어남을 알리는 길을 새로 두지 않아도 된다. 처음 값은 1시간이었다. (agent)
- 끝 기록이 실패한 run 줄은 바퀴마다 한 번 읽어 다시 닫는다. 이유: 그렇지 않으면 그 줄이 `running`으로 남아 다음 기동까지 그 job의 차례가 모두 `skipped(overlap)`가 된다. 그 자리에서 다시 부르는 loop는 두지 않는다. 읽기는 기다리지 않는 한 번이라 jobs의 operation과 runs를 고치지 않는다. (agent)
- 다른 module의 표를 SQL로 읽지 않는다(`architecture/layers.md`). 이유: workflow를 시작한 job run은 scheduler가 닫는다. jobs가 workflows의 표를 읽을 수도 workflows가 jobs를 알 수도 없으니, 켜져 있는 동안 scheduler가 바퀴마다 instance 상태를 읽는 길만 남는다. (agent)
- program은 약하게 둔다. job은 workflow instance의 끝을 판정하지 않고 instance 상태만 읽는다. 끝나지 않은 instance가 이어지면 건너뛴 기록이 쌓이고 사람이 화면에서 본다. (사람, 2026-10-22)
- 겹침 판정을 `job_runs` 표 하나로 한다. 이유: 앞 차례가 run이든 instance든 "도는 줄이 있나"는 같은 질문이라 할 일마다 다른 표를 묻지 않는다. unique index는 코드가 틀려도 같은 바깥 효과가 두 번 나지 않게 하는 한 겹이다. (agent)
- hold를 job마다 한 줄에 접는다. 이유: 몇 번을 놓쳤든 사람에게 같은 질문을 쌓지 않는다. 제때 온 차례가 돌면 그 줄은 쓸모가 없어져 `superseded`로 닫는다. (agent)
- program caller를 앱 호출 경로에 따로 둔다. 이유: 사람이 연 run은 사람의 호출이라 Gate를 거치지 않지만 job의 호출은 사람이 없다. 사람이 승인한 job이라 판정 없이 지나가지만 기록에 어느 job, 어느 차례인지 남아야 하고, 부른 turn이나 tool call이 없어 job과 job run을 싣는다. 버린 안: "사람 caller + run id"로 얼버무리기. (agent)
- job이 부른 agent도 job 명령을 받아 job을 만들 수 있다. 막지 않고, 고치기는 만든 agent만 하며, 사람은 모든 job을 화면에서 본다. (agent)
- 다른 agent가 남의 job을 고치거나 읽지 못한다. 이유: 고칠 수 있으면 남의 job을 끄거나 주기를 바꿔 남의 일을 흔드는 길이 된다. 위험 test가 있다(권한 경계). (agent)
- `revision`과 `compare`를 두지 않는다. 이유: 같은 job을 동시에 고치는 쪽이 사람 화면과 만든 agent 정도라 마지막 쓰기가 이기게 두는 쪽이 단순하다. (agent)
- workspace를 job의 칸으로 두지 않는다. 이유: workspace는 `creator`에서 나오고 job은 project를 건너기도 한다(home에서 만든 job은 workspace가 없다). 칸으로 두면 `creator`나 `action`과 어긋날 수 있다. 화면의 "걸린 job"은 읽을 때 가른다. (agent)
- cron을 쓰지 않는다. 이유: 간격과 하루 중 시각으로 쓰려는 일이 다 된다. 서머타임 규칙도 한 곳에 있다. 모자라면 그때 더한다. 서머타임은 없는 시각이면 건너뛴 직후, 두 번 오는 시각이면 첫 번째 한 번이다. (agent)
- 자동 재시도는 없다. 이유: 같은 바깥 효과가 두 번 날 수 있고, 틀린 답을 다시 하는 것은 부르는 쪽(사람이나 flow)이 정할 일이다(`project-docs/products/AGENT.md` 7절). (agent)
- 지운 job의 run과 instance는 끝까지 돈다. 이유: 바깥 효과를 이미 시작한 일을 job을 지웠다고 끊지 않는다. 제목이 사라질 뿐이다. (agent)
- workflow 시작은 `StartWorkflow` route가 아니라 core 안 service로 한다. 이유: 그 route는 사람만 받는 입구(actor user)이고 job은 사람 자격이 없는 machine이 부르는 일이다. route를 job에도 열면 "시작은 사람의 일"이라는 입구의 뜻이 흐려진다. (agent)
- core를 shell의 child로 두지 않아 job이 앱을 Quit해도 돈다. 이유: job이 Electron 수명에 묶여 앱을 끄면 멈췄고 화면 없는 머신에서 CLI만으로 core를 켤 길이 없었다. 켜진 job(승인 대기 포함)이나 열린 job run이 있으면 idle-exit가 core를 끄지 않는다. (사람, 2026-11-08)
- event로 도는 job을 연다(app-sdk 단계 4). 2026-11-05의 "앱 event로 시작하는 job은 열지 않는다"를 뒤집는다. 닫았던 이유(반응을 믿게 할 장치: 저장, cursor, 재시도)는 약속을 줄여 푼다: 저장하지 않고 켜져 있는 동안 온 event에만 반응한다. 쓰는 예는 한도 앞 대응(`masup`의 `usage.limit` → agent `wrap-up`)과 일이 끝난 뒤의 반응(`lophn`의 `session.idle` → workflow `review`)이다. 나머지는 job 그대로다: 사람이 등록을 승인하고 할 일은 승인한 뒤 바뀌지 않으며 사람 없이 돌고 run과 기록이 같다. (사람, 2026-11-11)
- event job의 때와 최소 간격은 승인 대상이고 고치지 못한다. 폭풍은 앞 차례가 도는 중이면 건너뛰고(`busy`), 마지막으로 연 때에서 최소 간격(기본 5분) 안이면 건너뛴다(`too_soon`). 건너뜀은 줄로 쌓지 않고 센다. 이유: session event는 흔하고 job run 줄은 사람이 읽는 history라서다. (사람이 규칙을 정하고 agent가 세는 자리를 골랐다, 2026-11-11)
- jobs는 앱이 아닌 안 구독자로 앱 event 전달에 붙는다(호출 기록 없음). 이유: job은 앱이 아니고 handler 호출이 아니라 job run이 기록이다. core가 `lophn` event를 낼 때 안 구독자가 있으면 구독 앱이 없어도 session 한 줄을 만든다. (agent)
- 고리를 네 겹으로 막는다: 사람이 연 것이 아닌 session(어느 job의 run, run·workflow step·팀·call로 열린 것)의 event 무시, 이 job이 부르는 앱이 event 사슬에 있으면 무시(같은 앱의 tool은 만들 때 거절), 최소 간격과 `busy`. 앱 event는 job의 workspace가 그 앱 workspace에 닿을 때만 본다. 이유: 한 job이 자기 일의 결과로 다시 깨어나는 길이 둘(session event, 앱 event)이라 둘 다 닫는다. agent_run이 만든 앱 event의 사슬은 agent가 앱을 부르는 호출로 이어지지 않아 사슬로는 못 막고 최소 간격이 막는다. (agent)
- 앱을 지우면 그 앱이 만든 job과 부르는 job도 지운다. 이유: 같은 slug의 새 앱이 옛 앱의 job을 물려받지 않게 한다. (agent)
- 화면의 자리는 처음에 Settings › System과 project 창의 panel(그 project와 걸린 job만)이었다. shell을 하나로 합치면서 Settings에서 빼고 모든 workspace의 Jobs 탭, 왼쪽 sidebar의 Jobs overlay, 오른쪽 sidebar의 Jobs panel로 옮겼다. 처음 자리와 panel은 (사람, 2026-10-22)가 정했고 옮김은 shell 개편의 일부다.
- job 명령 입력의 자유 JSON 칸(할 일의 입력, 출력 schema)은 tool의 JSON Schema로 바꿀 수 있는 형태로 둔다. 그 결과 JSON Schema에 `$defs`/`$ref`가 처음 들어갔고 진짜 Anthropic으로 보내 받아지는 것을 확인했다. OpenAI는 key가 없어 돌리지 못했다(adapter는 `strict`를 켜지 않는다). (agent)

- job은 만든 기계의 id를 싣고 그 기계에서만 돈다. 다른 기계의 job은 멈춘 것으로 보이고 사람이 [Run on this computer]로 가져온다. 이유: 한 사람이 여러 기계를 쓰면(복사한 data root, 뒤의 sync) 같은 job이 두 기계에서 돌아 같은 바깥 효과가 두 번 난다. 버린 길: job을 기계 사이에 맞추거나 저절로 옮기기(어느 기계가 깨어 있는지에 따라 몰래 옮겨 다닌다). (agent, 사람이 맡긴 multi-machine 정책 2026-11-16)
- 이미 있는 job은 새 판의 첫 startup claim이 이 기계 id로 찍는다. 이유: schema step은 기계 id를 모른다. 찍기 전의 null은 이 기계 것으로 읽어 옛 job이 멈추지 않는다. (agent)
- 가져온 주기 job은 지금부터 새로 센다. 이유: 다른 기계에 있던 동안의 차례는 그 기계의 것이고 이 기계가 놓친 것이 아니다. approve와 같은 규칙이다. (agent)
- 다른 기계 job의 화면 글은 "Belongs to another computer"이고 이름은 선택 함수가 알 때만 보인다. 이유: 기계 기록을 다른 기계에 알리는 일은 이 계획 밖(폴더 sync)이라 그쪽에 기대지 않는다. (agent)
- event job의 trigger는 다른 컴퓨터의 앱 event를 적을 수 있고, 그 job은 여전히 주인 기계에서만 돈다. 이유: 내 PC의 job이 VM의 monitoring 앱 event로 돌아야 하는데 job을 기계 사이에 옮기거나 두 기계에서 돌리면 같은 바깥 효과가 두 번 난다(위 "주인 기계"). 그러므로 trigger의 컴퓨터(event가 오는 곳)와 주인 기계(차례를 여는 곳)는 다른 개념이다. 컴퓨터는 만들 때 `mch_`로 풀어 저장해 이름 바꾸기에 흔들리지 않는다. 버린 안: 컴퓨터를 이름으로 저장하기(승인한 때와 다른 컴퓨터를 따라갈 수 있다). (사람 "구독하는 주체가 있을 거 아니야", agent)
- 다른 컴퓨터의 event job도 한 번 승인하면 돈다. 승인 card는 어느 컴퓨터의 event인지 말한다. 이유: 같은 `app_…` id가 이 컴퓨터에도 있을 수 있어 컴퓨터를 말하지 않으면 사람이 이 컴퓨터의 앱 event로 읽고 승인한다. (agent, 독립 review의 지적)
- **`workflow_start` job 승인 카드의 participant 단계 표시와 `full` 상향 시 자동 일시정지(`mode_escalated`)**: workflow의 기억된 권한 단계(`approvals.workflow_modes`)가 승인 시점에는 `workspace` 이하였는데 나중에 `full`로 올라가면, 사람이 승인하지 않은 무인 자율 범위로 job이 돌게 된다. 승인 시점의 단계를 `jobs.approved_modes_json`에 스냅샷해 두고, 어느 participant든 `full`로 올라가면 job을 자동 일시정지(`approval_paused_reason: "mode_escalated"`)해 대기 목록에서 재승인을 받게 한다("승인 뒤 할 일은 바뀌지 않는다" 원칙의 연장). (사람 2026-11-25 방향, 기술 결정 agent)

## 열린 것

- 다른 컴퓨터의 event로 연 차례는 받은 호출로 표시되지 않는다. 그 job의 agent는 자기 할당으로 세 번째 컴퓨터의 앱을 부를 수 있다(받은 호출 안의 앱 호출은 거절하는 것과 다르다). job은 사람이 승인한 것이고 `min_interval`이 속도를 막는 것으로 둔다.
- 다른 컴퓨터의 event에는 보내는 수의 상한이 없다. job은 `min_interval`이 막는다.
- 열린 이슈는 없다. 닫은 이슈는 "job run 끝을 적지 못하면 그 job은 다음 기동까지 돌지 않는다"와 "컴퓨터가 잠든 사이 놓친 hold job의 차례는 묻지 않고 돈다"(둘 다 고침)다.
- 끝나지 않은 workflow instance가 이어지면 그 job의 차례가 건너뛴 기록으로 쌓인다. 사람이 화면에서 보고 정한다(일부러 그렇게 뒀다).
- 컴퓨터가 잠든 사이 timer가 가지 않는다는 것은 가정이다(확인 전). 최대 잠 1분이 그 가정을 덮는다.
- `job.create`와 `job.update`의 `conflict` 선언은 handler가 내지 않는다(`revision`이 없다). 충돌 갈래는 `job.approve`와 `job.decide_hold`에만 있다.
- job run 기록 삭제를 사용자 data로 볼지는 사람이 정할 일이다(flow catalog의 메모).
