# job

job은 정해진 때 저절로 도는 일 하나다. 주기(`every`, 선택 `at`)와 할 일 하나(agent 호출 run, 앱 tool 호출 run, workflow instance 시작)와 놓친 차례 정책(`run`, `hold`)을 갖고, scheduler가 차례마다 job run 한 줄을 남기며 그 일을 시작한다. agent가 만들고 켜고, 사람은 화면에서 보고 고치고 끄고 지운다. 이 문서는 job이 무엇이고 누가 만들고 고치는지, scheduler가 언제 깨어 무엇을 하는지, 놓친 차례와 겹침과 hold와 서머타임을 어떻게 다루는지, 할 일마다 어떻게 시작하고 끝을 아는지, 권한과 화면을 정한다. 이 경계가 흐려지면 꺼진 사이 놓친 차례가 몇 번이든 같은 바깥 효과가 여러 번 나거나, 앞 차례가 도는데 같은 job이 또 돌거나, agent가 남이 만든 job을 고쳐 남의 할당으로 일을 시키거나, 켤 때 끊긴 차례가 영영 running으로 남는다. 여러 곳에 걸쳐 있다. 계약은 `packages/protocol/jobs`, 규칙은 `packages/core/jobs`(jobs), 끼우는 곳은 `packages/core/main/daemon/wiring/jobs.ts`와 `jobs-registration.ts`, agent tool은 `packages/core/jobs/agent-tools.ts`, 화면은 `packages/shell/renderer/desktop/settings/jobs/`다.

## 흐름

```
 agent: tool job.create | update | delete | list         (lophn, Project Manager, App Engineer)
 사람: Settings › System › Scheduled jobs 화면            job.update | delete | list | job_run.list
 사람: 대기 목록의 hold card                              job.holds | job.decide_hold
   │  이름 풀기(agent·앱·project)와 시간대는 port (jobs.targets, jobs.zone)
   ▼
 job command (core/jobs, 한 tx)  ──▶  jobs 표, job_runs 표 (정본)
   └ commit 뒤 afterCommit "jobs.changed" ─▶ Bus JobChanged (남지 않는 event) + scheduler.wake()
                                              └▶ 화면이 job·hold를 다시 읽는다

 scheduler 바퀴 (core/jobs/scheduler.ts, 한 번에 한 바퀴)      깨우는 것: timer | wake | 최대 잠 1분
   1 store.open      도는 줄 가운데 workflow_start의 running 줄: instance가 ended → done, stopped → cancelled
                     그 밖의 running 줄(run이 있음): run이 끝났으면 그 상태로 다시 닫는다 (켜는 첫 바퀴는 제외)
   2 job.claim_due   온 차례를 job run 줄로 만들고 시작할 줄(queued)을 한 번만 넘긴다. 다음 차례 시각도 받는다
   3 starter.start   agent_run | tool_run → runService.start(…, origin)   workflow_start → workflowService.start(…, {kind: "job"})
   4 job_run.started 줄을 running으로, run·instance·session id를 적는다
   5 run이면 waitRun으로 기다렸다가 job_run.ended (done | failed | cancelled)
   6 다음 차례까지 timer를 건다 (최소 1초, 최대 1분)

 tool_run: run 연산이 앱 호출 경로를 program caller로 부른다 ─▶ 만든 agent의 할당과 domain 거르기 (architecture/app-call.md)
 켤 때: 첫 바퀴가 startup claim이다. 도는 중 끊긴 줄을 interrupted로 닫고 꺼진 사이 온 차례를 놓친 차례로 접는다
```

- `jobs` 표(job 한 행)와 `job_runs` 표(차례마다 한 행)가 정본이다. 쓰는 것은 job command(`create`, `update`, `delete`, `decide_hold`)와 scheduler의 machine command(`claim_due`, `started`, `ended`)뿐이다. 화면, CLI, agent는 route로 읽는다.
- 다른 module은 이 표를 SQL로 읽지 않는다. scheduler는 run과 instance를 `runService`와 `workflowService`, `workflowInstanceRead`로만 본다(`architecture/layers.md`).
- scheduler의 core 안 자격은 `machine:jobs`(operation은 `job.claim_due`, `job_run.open`, `job_run.started`, `job_run.ended`, `ReadWorkflowInstance`)다. 기동 때 ledger에 기록한다.

## 지키는 것

job
- 주기는 `every`와 `at`이다. `every`는 `<수><m|h|d>`(분, 시간, 일, 수는 1~99999)이고 cron 문법은 받지 않는다. `at`(`HH:MM`)은 `d` 단위 주기에만 둘 수 있다(아니면 `invalid_input`). 시각은 이 컴퓨터의 local 시간대이고 시간대는 port로 받는다(`jobs.zone`, 구현은 wiring이 `Intl.DateTimeFormat`으로 꽂는다).
- 할 일은 셋 가운데 하나다.
  - `agent_run`: 부를 agent(`{role, place?, name?}`)와 prompt, 선택 입력 JSON과 출력 schema.
  - `tool_run`: 앱(id, slug, 이름)과 tool 이름, 선택 입력 JSON.
  - `workflow_start`: `<project 이름>/<name>`, 시작 입력 글, 선택 step. `kind: agent`와 `kind: flow`를 다 시작한다. step은 agent workflow의 시작 자리이고 flow에 주면 차례에 `invalid_input`으로 실패한다.
- 이름은 만들 때(또는 `action`을 바꿀 때) core가 풀어 id로 저장한다(agent는 AgentRef와 place, 앱과 project는 id). 앱의 tool 이름과 workflow file은 차례에 부를 때 본다. 못 풀면 만들지 못하고(`not_found`, coding agent는 `invalid_input`), 차례에 못 찾으면 그 job run이 실패로 남는다.
- `title`은 1~80자이고 목록, card, run 줄과 instance 줄에 보일 이름이다.
- 놓친 차례 정책은 `run`(켜지면 바로 한 번 돈다)과 `hold`(사람에게 묻는다) 둘이다.
- 켜고 끄기(`enabled`)가 있다. 꺼진 job은 `next_due_at`이 null이고 돌지 않는다. 만들 때 `enabled`는 기본 true다.
- `last_run`은 저장하지 않고 읽을 때 그 job의 가장 새 job run으로 채운다. place도 칸이 아니라 `creator`에서 `placeOfAgentRef`로 나온다.

만들고 고치는 쪽
- job을 만드는 것은 agent뿐이다(`job.create`의 actor는 agent). 만든 session의 agent가 lophn, Project Manager, App Engineer가 아니면 `forbidden`이다. 만든 agent(`creator`)가 job에 남고 그 agent의 지금 할당이 tool_run의 허락이 된다.
- agent는 자기 `creator`와 같은 agent(AgentRef가 같은 것)가 만든 job만 고치고 지우고 읽는다. 남의 job은 있는지도 알리지 않는다(`not_found`). 사람은 모든 job을 고치고 끄고 지우고 읽는다. 사람은 만들지 못한다.
- 다른 agent가 고칠 수 있으면 남의 할당으로 일을 시키는 길이 되기 때문이다. 위험 test가 있다(`packages/core/jobs/commands_test.ts`).
- job이 연 agent run의 agent도 job tool을 받아 job을 만들 수 있다. 막지 않는다. program은 약하게 두고, 고치기는 만든 agent만 하며, 사람은 모든 job을 화면에서 본다.
- job 지우기는 job과 그 job run을 지운다(FK 없이 command가 두 표를 같이 지운다). 도는 run이나 instance는 끝까지 돈다. 지운 job이 남긴 run과 instance에서는 job 제목이 사라진다(id만 남는다).
- `revision`과 `compare`는 없다(`compare`는 늘 `{}`). 같은 job을 동시에 고치는 쪽이 사람 화면과 만든 agent 정도라 마지막 쓰기가 이긴다.

언제 도나
- lophn(tray 포함)이 켜져 있을 때만 돈다. 상주 daemon이나 OS service는 없다. scheduler는 주입한 Clock과 작은 timer port(`set`, `clear`)로 깨어난다(`packages/base`의 Clock은 `now()`와 `nowMs()` 그대로다).
- 깨우는 길은 셋이고 바퀴는 같다. 다음 차례 시각 timer, `wake()`(job command의 commit 뒤), 최대 잠이다. 대기는 다음 차례까지이고 최소 1초, 최대 1분이다(켜진 job이 없으면 1분). 컴퓨터가 잠든 사이 timer는 가지 않을 수 있어(잠든 시간을 세지 않는 시계로 잰다고 본다) 깬 뒤 늦지 않게 바퀴가 돌도록 최대 잠을 짧게 둔다. 할 일이 없는 바퀴는 읽기뿐이라 싸다. 한 번에 한 바퀴만 돌고, 도는 사이 온 wake는 바퀴를 끝낸 뒤 한 번 더 돈다.
- `claim_due`가 실패하면 60초 뒤 다시 한다. 첫 claim이 한 번 성공할 때까지는 재시도도 startup claim이다. 켤 때 한 번의 일이 빠지지 않게 하려는 것이다.
- 주기를 바꾸거나 `at`을 바꾸거나 꺼 둔 job을 다시 켜면 그때부터 새로 센다(`next_due_at`을 지금 뒤의 첫 차례로 다시 잡는다). 놓친 것으로 치지 않는다.

놓친 차례
- 한 번의 `claim_due`가 한 job에서 온 차례를 몇 개 보든 job run 줄은 하나다. 마지막 차례를 `due_at`으로 쓰고 접은 수를 `missed_count`에 적는다(제때 온 차례는 0).
  - 켤 때(startup claim)는 온 차례가 모두 놓친 차례다. 도는 중 lophn이 꺼져 끊긴 차례도 놓친 차례로 하나 더 친다(`closeLeftovers`). 켜진 채 timer가 늦어 여럿이 한꺼번에 오면 하나는 제때로 치고 나머지가 놓친 차례다.
  - 켜진 채여도 가장 오래된 온 차례(`next_due_at`)보다 10분 넘게 늦게 처리하면 켤 때와 같다. 온 차례가 모두 놓친 차례다(컴퓨터가 잠들었다 깬 경우). 10분 안이면 제때다.
  - 정책 `hold`는 켤 때와 10분 넘게 늦은 놓친 차례에 걸린다. 제때 온 차례는 `run`처럼 돈다.
- 몇 번을 놓쳐도 한 번만 돈다. 10일 주기를 세 번 놓쳤다고 세 번 옮길 일이 없어서다. 몇 번 놓쳤는지는 기록에 남는다.

겹침
- 앞 차례가 아직 돌면 이번 차례는 건너뛰고 `skipped`(`reason: overlap`) 줄로 남긴다. 판정은 `job_runs` 표 하나로 한다: 그 job에 `queued`나 `running` 줄이 있으면 돈다. run이든 instance든 같다.
  - agent_run과 tool_run은 그 run이 끝나면 줄이 닫힌다. workflow_start는 그 instance가 `running`인 동안 줄이 `running`이다. instance의 끝은 참가자가 말한 기록일 뿐이라(`architecture/workflow.md`) 끝나지 않은 instance가 이어지면 건너뛴 기록이 쌓이고 사람은 화면에서 본다.
- unique index 둘(`job_runs_open`, `job_runs_held`)이 코드가 틀려도 표가 한 겹 더 막는다. 도는 줄(`queued`, `running`)과 기다리는 줄(`held`)은 job마다 하나다.

hold
- `hold` job이 켤 때(또는 10분 넘게 늦게 처리한) 놓친 차례가 있으면 줄을 `held`로 남기고 대기 목록에 card가 뜬다. 사람이 [Start now]나 [Skip]을 고른다(`job.decide_hold`). [Skip]은 `skipped`(`person`)이고 [Start now]는 줄을 `queued`로 돌려 scheduler를 깨운다.
- 기다리는 동안 또 놓친 차례는 같은 줄에 접는다(`due_at`을 옮기고 `missed_count`를 더한다). card가 쌓이지 않는다.
- 제때 온 차례가 돌게 되면 기다리던 줄은 `superseded`로 닫는다(`skipped`). job이 돌게 되었으니 [Start now]를 기다릴 이유가 없다.
- 앞 차례가 도는 중 [Start now]를 누르면 `conflict`이고 줄은 `held`로 남아 card가 남는다.
- card는 꺼졌다 켜져도 남는다. 정본은 `job_runs` 표다.

서머타임(`schedule.ts`의 순수 함수)
- 없는 시각(시계가 건너뜀)은 건너뛴 직후의 시각에 돈다. 02:30이 없으면 시계가 건너뛴 순간인 03:00이다.
- 같은 시각이 두 번 오는 날은 첫 번째에 한 번만 돈다.
- `at`이 없는 `Nd`는 24시간 × N인 고정 길이다. 서머타임에 local 시각이 밀린다. 시각을 지키려면 `at`을 준다. `at`이 있으면 날짜를 달력으로 더하고 그날의 시각을 푼다.

job run
- 상태는 여덟이다.

| 상태 | 뜻 |
|---|---|
| `queued` | 줄이 만들어졌고 scheduler가 시작하기를 기다린다(넘겼으면 시작하는 중) |
| `running` | 시작했다. run, instance, session id가 적혀 있다 |
| `done`, `failed`, `cancelled` | 끝났다. run이면 그 run의 상태를 따른다. workflow_start는 instance가 `ended`면 `done`, `stopped`면 `cancelled`다 |
| `held` | 사람의 결정을 기다린다 |
| `skipped` | 건너뛰었다. 이유는 아래 표 |
| `interrupted` | 도는 중 lophn이 꺼져 끊겼다 |

- `reason`: `skipped`는 `person`(사람이 [Skip]), `overlap`(앞 차례가 돎), `superseded`(제때 온 차례가 대신함)이다. 시작하지 못한 `failed`는 `<오류 code>: <message>`다. 그 밖은 null이다. run이 실패한 이유는 그 run의 `error`가 갖는다(`architecture/run.md`).
- 줄은 `run`(agent_run·tool_run이 연 run), `instance`(workflow_start가 시작한 instance), `session`(agent_run이 연 session)을 가진다.
- 자동 재시도는 없다. 실패한 차례는 기록에 남고, 다시 하기는 사람이나 flow의 일이다.

할 일마다 시작과 끝
- agent_run은 이름을 푼 agent로 run을 연다(`runService.start`의 `agent_resolved` 갈래). 차례마다 새 session을 열고 unattended 사람 메시지로 turn을 연다. 끝은 `waitRun`이 돌려준 run의 상태다. `ended` 기록이 오류로 못 적혔어도 바퀴마다 열린 run 줄의 run 상태를 한 번 읽어(`starter.runState`, 기다리지 않는다) 끝났으면 `ended`를 다시 적는다. 다시 부르기 loop는 없다. 그렇지 않으면 그 job의 차례가 다음 기동까지 모두 `skipped(overlap)`가 된다. run의 결과 칸은 job run에 옮기지 않고 run 기록에서 읽는다.
- tool_run은 run 연산이 앱 호출 경로를 program caller로 부른다(아래 권한). 막히면 run이 `tool_denied`로 실패하고 job run이 `failed`다.
- workflow_start는 `workflowService.start`를 시작한 쪽 `{kind: "job", job}`으로 직접 부른다. 사람만 받는 `StartWorkflow` route는 그대로다. flow면 service가 그 process를 띄운다. job 쪽은 agent workflow와 다를 것이 없다. 시작하지 못하면(`conflict` 등) job run이 `failed`다. 끝은 scheduler가 다음 바퀴에 instance 상태를 읽어 안다: `ended`면 `done`, `stopped`면 `cancelled`. 한 번 닫은 줄은 instance가 다시 열려도 되살리지 않는다.
- 시작하지 못한 차례(이름이 안 풀림, run 시작 실패)는 그 자리에서 `failed`로 닫는다. `waitRun`이 오류로 그치거나 lophn이 꺼지는 중이면 거짓 끝을 적지 않고 줄을 둔다. 다음 켤 때 `interrupted`로 닫힌다.
- `started`나 `ended`가 `not_found`(그 사이 job이 지워짐)나 `conflict`(켤 때 이미 닫힘)면 정상이라 넘긴다. 그 밖의 오류는 log 한 줄이다.

켤 때
- 첫 바퀴는 run 줄의 run 상태를 읽지 않는다. runs가 끊긴 run을 이미 `lophn_restarted`로 닫아 두었으므로 읽으면 그 줄이 `failed`로 닫혀 아래 `interrupted`와 놓친 차례 계산이 사라진다. workflow 줄은 첫 바퀴도 읽는다.
- 첫 바퀴의 startup claim이 남은 도는 줄을 먼저 닫는다. `running` 줄과 `queued`인데 넘겨진(`claimed_at`) 줄은 `interrupted`로 닫는다. 넘겼지만 `started`를 적었는지 알 길이 없는 줄이라 action과 상관없이 닫는다.
- 예외는 workflow_start의 `running` 줄이다. agent instance는 lophn 없이도 돌았으므로(켤 때 `architecture/workflow.md`가 보는 것은 넘긴 step뿐이다) 줄을 둔다. 다음 바퀴가 instance 상태를 읽어 닫는다. flow instance는 켤 때 process 없이 `ended`로 닫히므로(다시 띄우지 않는다) 다음 바퀴가 그 줄을 `done`으로 닫고 다음 차례는 평소대로 돈다.
- 닫은 줄은 놓친 차례로 하나 더 친다. 켤 때 run 쪽도 같은 일을 한다: 끊긴 run은 `lophn_restarted`로 닫히고(`architecture/run.md`) job run은 `interrupted`다. 그 job은 정책대로 한 번 다시 돌거나(`run`) card로 묻는다(`hold`).
- wiring 순서에서 jobs는 runs와 workflows 뒤다(`packages/core/main/daemon/assembly.ts`의 `WIRINGS`). 켤 때 둘을 맞춘 뒤에 첫 claim이 돈다.

권한
- job tool(`job.create`, `job.update`, `job.delete`, `job.list`)은 lophn, Project Manager, App Engineer가 받는다. Operator는 job이 부르는 쪽이라 받지 않는다(`packages/core/agent-roles/tool-lists.ts`의 `JOB_TOOL_NAMES`). `job.list`는 agent에게 자기가 만든 job만 준다.
- scheduler 쪽 route(`job.claim_due`, `job_run.open`, `job_run.started`, `job_run.ended`)는 machine 자격만 받는다. command 셋은 handler도 한 번 더 본다. 사람 쪽 route(`job.holds`, `job.decide_hold`, `job_run.list`)는 user만 받는다.
- tool_run은 사람이 없는 호출이라 만든 agent의 지금 할당과 domain 거르기로 판정한다. mode는 unattended이고, 할당은 호출 때 읽는다. 막히면 호출이 `denied(gate_blocked)`로 기록되고 run은 실패한다(`architecture/app-call.md`, `architecture/approval.md`).
- agent_run이 연 turn은 unattended다. 묻지 않고 deny만 막힌다. 사람이 agent에게 시킨 것이 승낙이다. 사람은 모든 job을 화면에서 보고 끌 수 있고, job의 일은 만든 agent의 할당 안에서만 돈다.

화면
- Settings › System › Scheduled jobs는 모든 job을 한곳에 모은다(job은 project를 건너고 lophn이 만든 job은 place가 없다). 줄마다 제목, 주기, 다음 차례, 마지막 결과를 보이고 켜고 끄기, 제목·주기·놓친 차례 정책 고치기, 지우기, 기록(`job_run.list`)을 한다. 할 일(`action`)을 고치거나 job을 만드는 단추는 없다. 기록 줄에서 session이나 project로 가는 길은 이미 있는 길(`onOpenSession`, [Open project])뿐이다.
- project 창 activity bar의 Scheduled jobs panel은 그 project와 걸린 job과 그 규칙을 보인다. 걸린 job은 그 project의 Project Manager가 만든 것, 그 project의 agent를 부르는 것, 그 project의 workflow를 시작하는 것이다(`creator`와 `action`으로 가르고 계약은 바꾸지 않는다). 줄은 제목, Switch, 주기, 다음 차례나 대기 상태이고 줄과 "Open all jobs"는 Settings의 같은 화면을 연다(`packages/shell/renderer/workspace/sidebar/job-panel.tsx`, 거르기는 `desktop/settings/jobs/model.ts`의 `jobsOfProject`).
- 대기 목록의 hold card는 셋째 read source다(앞 둘은 session snapshot과 activation 동의). `job.holds`로 통째로 맞추고 `JobChanged`를 받을 때 다시 읽는다(`packages/shell/renderer/desktop/connection/waiting/`의 `cards/job-hold-card.tsx`). [Start now]와 [Skip]은 `job.decide_hold`다. 결정한 card는 다시 읽을 때 빠지고 toast는 없다.
- run 줄과 instance 줄은 job 제목을 보인다. run 줄은 이름 자리에 제목을 두고 agent 이름이나 tool 이름은 둘째 줄이다. instance 줄은 시작한 쪽이 job이면 제목을 보인다. 제목은 읽는 곳이 `job.list`를 읽어 job id로 붙인다(`packages/shell/renderer/workspace/core-source.ts`). 지운 job의 옛 줄은 제목 없이 원래 이름으로 보인다. 제목은 꾸밈이라 읽기에 실패해도 run과 instance 읽기는 그대로 간다.
- 화면이 다시 읽는 신호는 `JobChanged`(subject job, payload `job_run`)다. 남지 않는 event라 놓친 화면은 열 때 다시 읽는다(`architecture/event.md`). run과 instance 줄은 지금의 session event와 `WorkflowInstanceChanged` 때 다시 읽으므로 따로 알리지 않는다.

## 왜 이 모양인가

- scheduler를 기록 event나 Bus에 얹지 않는다. 뒤에 꼭 움직여야 하는 일은 그 일을 아는 command가 같은 tx에서 한다(`architecture/event.md`). job command는 표만 바꾸고, commit 뒤 `jobs.changed`는 timer를 다시 걸라는 신호일 뿐이다. 신호를 놓쳐도 정본은 표라서 다음 timer나 최대 잠이 같은 표를 다시 읽는다. Reactor 같은 반응 장치(cursor, 멱등 key, backoff)를 지지 않는다.
- 다른 module의 표를 SQL로 읽지 않는다(`architecture/layers.md`). 그래서 workflow job run은 scheduler가 닫는다. jobs가 workflows의 표를 읽을 수도 workflows가 jobs를 알 수도 없으니, 켜져 있는 동안 scheduler가 바퀴마다 instance 상태를 읽는 길만 남는다.
- 겹침 판정을 `job_runs` 표 하나로 한다. 앞 차례가 run이든 instance든 "도는 줄이 있나"는 같은 질문이라 할 일마다 다른 표를 묻지 않는다. unique index는 코드가 틀려도 같은 바깥 효과가 두 번 나지 않게 하는 한 겹이다.
- hold를 job마다 한 줄에 접는다. 몇 번을 놓쳤든 사람에게 같은 질문을 쌓지 않는다. 제때 온 차례가 돌면 그 줄은 쓸모가 없어져 `superseded`로 닫는다.
- program caller를 앱 호출 경로에 따로 둔다. 사람이 연 run은 사람의 호출이라 Gate를 거치지 않지만, job의 호출은 사람이 없다. 만든 agent의 할당 안이어야 하므로 agent caller와 같은 판정을 받되, 부른 turn이나 tool call이 없어 job과 job run을 싣는다. 그 자격(`CallAuth.program`)은 route가 만들지 못하고 core 안 run 연산만 만든다. 본문의 caller는 주장일 뿐이라 core가 만든 자격과 맞춰 본다. 앱 process의 caller parser(`packages/core/apps/runtime/entrypoint/wire.ts`)는 protocol schema의 손 사본이라(앱 process는 Zod를 싣지 않는다) 네 종류를 같이 받아야 한다. 하나를 놓치면 job의 앱 호출이 모두 말없이 거절된다.
- `revision`과 `compare`를 두지 않는다. 동시에 고치는 쪽이 사람 화면과 만든 agent 정도라 마지막 쓰기가 이기게 두는 쪽이 단순하다.
- place를 job의 칸으로 두지 않는다. place는 `creator`에서 나오고 job은 project를 건너기도 한다(lophn이 만든 job은 place가 없다). 칸으로 두면 `creator`나 `action`과 어긋날 수 있다. 화면의 "걸린 job"은 읽을 때 가른다.
- cron을 쓰지 않는다. 간격과 하루 중 시각으로 쓰려는 일(10일마다, 매일 09:00)이 다 된다. 서머타임 규칙도 한 곳(`schedule.ts`)에 있다. 모자라면 그때 더한다.
- 자동 재시도는 없다. 같은 바깥 효과가 두 번 날 수 있고, 틀린 답을 다시 하는 것은 부르는 쪽(사람이나 flow)이 정할 일이다(`project-docs/products/AGENT-ROLE.md` 7절).
- 지운 job의 run과 instance는 끝까지 돈다. 바깥 효과를 이미 시작한 일을 job을 지웠다고 끊지 않는다. 제목이 사라질 뿐이다.
- 알려진 미완은 `project-docs/issues/job.md`다.
