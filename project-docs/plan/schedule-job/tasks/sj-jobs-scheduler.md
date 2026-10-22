# sj-jobs-scheduler

lophn(tray 포함)이 켜져 있는 동안 도는 scheduler loop와 그 wiring을 만든다. 주입한 Clock과 timer port로 깨어 `job.claim_due`를 부르고, 받은 job run마다 run을 열거나 workflow instance를 시작하고, 끝을 job run에 적는다. 기록 event나 Bus에 얹지 않는다(`architecture/event.md`).

- 단위: jobs (wave 4)
- 선행: `sj-jobs-due`, `sj-runs-job-origin`, `sj-workflows-job-start`
- 소유(이 task만 고친다):
  - `packages/core/jobs/scheduler.ts` (새 file)
  - `packages/core/jobs/scheduler_test.ts` (새 file)
  - `packages/core/main/daemon/wiring/jobs.ts` (새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`(scheduler를 기록 event나 Bus에 얹지 않는다. 화면 신호는 남지 않는 event), `project-docs/architecture/run.md`("끝을 아는 법", "켤 때와 session 끝", `WaitRun`이 최대 60초만 기다리는 이유), `project-docs/architecture/workflow.md`(instance 상태 `running|ended|stopped`와 끝은 기록일 뿐이라는 것, 시작 route는 사람만), `project-docs/architecture/approval.md`(unattended), `project-docs/architecture/layers.md`(wiring의 자리)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `jobs`, `project-docs/module-catalog.yaml`의 `packages/core/jobs`와 `packages/core/main`
  - 본보기 코드:
    - wiring 전체: `packages/core/main/daemon/wiring/runs.ts`(machine 자격 둘, `command`·`read` helper, 접은 writer 사용, `start`·`closeIntake`), `packages/core/main/daemon/wiring/workflows.ts`(`withAfterCommit`으로 topic을 Bus event로 바꾸는 `writer` 층, `store.read`·`readAll`)
    - 값 나누기와 구동 순서: `packages/core/main/daemon/wiring/context.ts`(`Late`, `LATE_KEYS`, 위 머리 주석의 구동·종료 순서), `packages/core/main/daemon/assembly.ts`(`WIRINGS` 주석: runs·workflows가 router 뒤인 이유)
    - 서비스: `packages/core/runs/service.ts`(`start`, `wait`의 60초 상한과 `close()`), `packages/core/workflows/service.ts`의 `start(input, by)`
    - timer 대역: `packages/core/runs/ports.ts`의 `Timers`·`systemTimers`, `packages/core/runs/service_test.ts`(`timers: { set: () => 0, clear: () => {} }`)
    - 수동 clock: `packages/base/clock.ts`의 `manualClock`
  - 제품 결정: 계획 README의 "정한 것"의 "언제 도나", "할 일"(workflow 시작, 앱 tool 호출)
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 `JobSchedulerDeps`·`JobSchedulerStore`·`JobStarter`·`JobScheduler`·`JobTimers`·`JOBS_CHANGED_TOPIC`, route `job.claim_due`·`job_run.open`·`job_run.started`·`job_run.ended`(TS export 이름 `jobClaimDue`·`jobRunOpen`·`jobRunStarted`·`jobRunEnded`), 남지 않는 event `JobChanged`. `Late`의 `runService`·`workflowService`(`sj-runs-job-origin`, `sj-workflows-job-start`가 낸다)
  - 내놓는 것
    - `createJobScheduler(deps: JobSchedulerDeps): JobScheduler`
    - `jobsWiring: WiringFactory`: machine 자격 `machine:jobs`(scope는 `job.claim_due`, `job_run.open`, `job_run.started`, `job_run.ended`, `ReadWorkflowInstance`), `JOBS_CHANGED_TOPIC`을 받아 `JobChanged`를 내고 scheduler를 깨우는 writer 층(`withAfterCommit`), `start`에서 scheduler 시작, `closeWork`에서 멈춤. `JobStarter` adapter(`runService`·`workflowService` 사용). 등록할 것(lead): `assembly.ts`의 `WIRINGS`(runs와 workflows wiring 뒤), `Late` 칸.

## 정한 것

- 한 번에 한 바퀴만 돈다. **깨어나는 길이 무엇이든(timer, `wake()`, 1시간 상한) 바퀴는 같다.** 바퀴:
  1. `open()`으로 도는 줄을 읽고, action이 `workflow_start`이고 `running`이며 `instance`가 있는 줄마다 `instanceState`로 instance를 본다. `running`이 아니면 닫는다(`ended`는 `done`, `stopped`는 `cancelled`). `running`이면 그대로 둔다(그동안 같은 job의 새 차례는 claim이 `overlap`으로 건너뛴다). 읽기가 실패한 줄은 그대로 둔다. **이 단계는 claim 앞에서 한다.** 이유: 차례가 온 순간의 겹침 판정(`job.claim_due`)이 지금 instance 상태를 보게 하려는 것이다. 이미 끝난 instance의 줄을 열어 두면 새 차례가 잘못 건너뛴다.
  2. `claimDue(startup)`.
  3. 받은 줄마다 차례로 `starter.start`. 실패하면 `ended(failed, "<code>: <message>")`. 성공하면 `started(...)`를 적고, run이 있으면 `waitRun`을 기다리지 않고 띄워 끝나면 `ended`를 적는다. instance를 시작한 줄은 `waitRun`이 없고 다음 바퀴의 1이 닫는다.
  4. claim이 준 `next_due_at`으로 timer를 건다.
  도는 중에 `wake()`가 오면 표시만 해 두었다가 바퀴가 끝나면 한 바퀴 더 돈다(합쳐서 한 번).
- `start()`는 첫 바퀴를 `startup: true`로 돌린다. **`startup`은 claim이 한 번 성공할 때까지 `true`다.** claim이 실패하면 core 기동을 막지 않고 1분 뒤 다시 하는데, 그 재시도도 `startup: true`다(켤 때 한 번의 일이 빠지지 않게 한다).
- timer: `next_due_at`에 맞추되 한 번에 최대 1시간까지만 잔다(`setTimeout` 상한과 시계가 바뀌는 일). `next_due_at`이 null이어도 1시간 뒤 다시 본다(workflow instance의 끝을 보려면 깨야 한다). **1시간에 깨어도 같은 바퀴를 돈다**(claim은 차례가 없으면 빈 답을 주는 싼 호출이다). 이유: 1을 깰 때마다 해야 하고 길을 둘로 나누지 않는다. 잠은 최소 1초다(`next_due_at - clock.nowMs()`를 1초~1시간으로 자른다). 이유: writer의 `tx.now()`가 아주 조금 앞서 claim이 비어도 `next_due_at`이 이미 지난 때로 남아 곧바로 다시 깨는 loop가 되는 것을 막는다.
- `waitRun`이 오류거나 종료로 그치면 거짓 끝을 적지 않는다. 그 줄은 다음 기동이 `interrupted`로 닫는다.
- `started`·`ended`가 `not_found`(그 사이 job이 지워짐)나 `conflict`(켤 때 이미 닫힘)를 돌려주면 정상으로 본다. 그 밖의 오류는 `console.error`로 한 줄 남기고 그대로 둔다(다음 기동이 닫는다).
- `stop()`은 timer를 풀고 도는 바퀴를 기다린다. 띄운 `waitRun`은 기다리지 않는다. `start()` 전과 `stop()` 뒤의 `wake()`는 아무것도 하지 않는다(첫 바퀴가 `startup: true`로 돌기 전에 다른 바퀴가 먼저 돌면 안 된다).
- 자동 재시도는 없다. 시작하지 못한 차례는 failed 줄로 남고 다음 차례를 기다린다.
- global timer(`setTimeout`)와 `Date.now`는 쓰지 않는다. scheduler는 주입한 `JobTimers`와 `Clock`만 쓰고, wiring은 `runs/mod.ts`의 `systemTimers`(모양이 `JobTimers`와 같다)를 넘긴다.
- `workflow_start`가 `not_handed`로 돌아와도 instance가 만들어졌으면 시작한 것으로 본다(`started`에 instance를 적는다). instance가 `running`인 동안은 겹침이고, 사람이 workflow 탭에서 멈추면 닫힌다(README "끝나지 않은 instance가 이어지면 건너뛴 기록이 쌓이고 사람은 그것을 화면에서 본다").

## 할 일

1. **`scheduler.ts`: `createJobScheduler(deps: JobSchedulerDeps): JobScheduler`.** 상태는 닫힘 안에 둔다(timer handle, 도는 바퀴의 promise, `again` 표시, `stopped`, `startupDone`). 전역 상태를 두지 않는다. `start()`, `wake()`, `stop()`은 "정한 것"대로다. 상수는 file 위에 이름을 붙인다(`HOUR_MS`, `RETRY_MS = 60_000`, `MIN_SLEEP_MS = 1_000`).
   - 시작 helper는 action별로 가르지 않는다. `starter.start(job, jobRun)`이 알아서 하고, scheduler가 아는 것은 돌려받은 `{run, instance, session}` 가운데 `run`이 있으면 `waitRun`을 띄운다는 것뿐이다. 이유: run과 instance의 차이는 `JobStarter` 뒤에 있다.
   - 이 file은 `core/runs`·`core/workflows`를 import하지 않는다(feature module끼리 import 금지). `ports.ts`의 type만 쓴다.
2. **`scheduler_test.ts`: 위험 test 하나.** 아래 "끝남"을 본다. 준비: `manualClock`, 호출을 기록하는 가짜 `timers`(`set`이 `{run, ms}`를 모으고 `clear`가 뺀다), 가짜 `store`(`open`이 돌려줄 줄을 test가 바꾼다, `claimDue`는 `{start: [], next_due_at: null}`, `ended` 호출을 기록한다), 가짜 `starter`(`instanceState`가 test가 바꾸는 값을 준다). 모두 이미 풀린 promise를 돌려주므로 microtask를 몇 번 흘리면(`for (let i = 0; i < 10; i++) await Promise.resolve()`) 바퀴가 끝난다. 실제로 기다리지 않는다.
3. **`wiring/jobs.ts`: `jobsWiring: WiringFactory`.** `runs.ts`·`workflows.ts` 꼴이다.
   - **자격.** `machine:jobs`(actor machine, scope operations는 `job.claim_due`, `job_run.open`, `job_run.started`, `job_run.ended`, `ReadWorkflowInstance`의 route `name`). `records: () => [JOBS_CONTEXT]`.
   - **`build(ctx)`.** `command`·`read` helper는 `runs.ts` 그대로다(접은 `ctx.writer.command`, `ctx.runtime.reads.get(...)`. `ctx.writer`는 build가 끝난 뒤 채워지므로 부를 때 읽는다). `store`(`JobSchedulerStore`)는 route 넷을 그대로 감싼다(`claimDue(startup)` → `{start, next_due_at}`, `open()` → `.open`, `started`, `ended`의 `reason`은 있을 때만 싣는다). `starter`는 아래. `createJobScheduler({clock: ctx.clock, timers: systemTimers, store, starter})`.
   - **`starter`.** `runService`와 `workflowService`는 `ctx.runService`·`ctx.workflowService`(`Late`)이고 build가 아니라 부를 때 읽는다.
     - `start(job, jobRun)`: `agent_run`이면 `runService.start({kind: "agent_resolved", agent: action.agent, place: runPlaceOf(action.agent_place), prompt, ...input, ...schema}, {job: job.id, job_run: jobRun.id, creator: job.creator, creator_place: placeOfAgentRef(job.creator) ?? null})` → `{run: run.id, instance: null, session: run.session}`. `tool_run`이면 `runService.start({kind: "tool", app: action.app, tool, ...input}, origin)` → `{run: run.id, instance: null, session: null}`. `workflow_start`면 `workflowService.start({workflow: `${action.project}/${action.workflow}`, text, ...step}, {kind: "job", job: job.id})` → `{run: null, instance: instance.id, session: null}`. 없는 칸은 `...(x === undefined ? {} : {x})` 꼴로 싣는다(`exactOptionalPropertyTypes`).
     - `waitRun(run)`: `runService.wait(run, 60_000)`을 run이 `running`을 벗어날 때까지 되풀이한다. 오류면 그 오류를 돌려주고, wiring이 `closeWork`에서 세운 `closing`이면 `unavailable`을 돌려 멈춘다. 이유: `wait`는 최대 60초만 기다리고(`run.md`), `runService.close()`가 걸린 wait를 풀어 주기 때문이다.
     - `instanceState(instance)`: `ReadWorkflowInstance`를 `{instance}`만 주고 한 번 읽어 `.instance.state`를 돌려준다(첫 쪽이면 충분하다. 줄 쪽 넘기기는 필요 없다).
     - `runPlaceOf(place: Place | null): RunPlace | null`은 `wiring/runs.ts`의 같은 이름 함수와 같은 여섯 줄이다. wiring file끼리 import하지 않으므로 여기 한 벌을 다시 둔다.
   - **`writer` 층.** `workflows.ts`처럼 `withAfterCommit(inner, actions => ...)`. `JOBS_CHANGED_TOPIC`만 보고(다른 topic은 건드리지 않는다), 각 action마다 `ctx.bus.publish({type: "JobChanged", subject: data.job, at: ctx.clock.now(), payload: {job_run: data.job_run}})`를 내고, 한 묶음에 한 번 `scheduler.wake()`를 부른다. 이유: job을 만들거나 켜거나 hold를 결정하면 다음 차례 시각이 바뀌므로 timer를 다시 건다. 이 신호는 scheduler가 부른 `started`·`ended`에서도 오는데, 바퀴가 합쳐지고(`again`) 빈 claim은 신호를 내지 않아 끝난다.
   - **`start(ctx)`.** `await scheduler.start()` 뒤 `ok(undefined)`. 이 hook은 `runsWiring`·`workflowsWiring`의 `start`(reconcile) 뒤에 도는 순서여야 한다(그래서 `WIRINGS`에서 workflows 뒤). 이유: 켤 때 run과 instance를 먼저 맞춘 뒤에 첫 claim이 도는 차례를 낸다.
   - **`closeWork()`.** `closing = true` 뒤 `await scheduler.stop()`.
4. 이 task는 `packages/core/main/daemon/wiring/context.ts`와 `assembly.ts`를 고치지 않는다(소유 밖). `Late`의 `runService`·`workflowService` 칸은 lead가 계약 wave와 함께 등록했다(wave 2 전). 칸이 없어 type check가 막히면 고치지 말고 멈춰서 보고한다. 아래 "보고"의 등록 목록을 lead에게 넘긴다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test(`packages/core/jobs/scheduler_test.ts`): "workflow를 시작하는 job은 앞 차례가 시작한 instance가 running인 동안 job run을 닫지 않고, running이 아니면 닫는다". 표 둘(`ended` → `done`, `stopped` → `cancelled`)로 본다. 판정은 가짜 store의 `ended` 호출과 호출 순서로 한다.
  - `start()` 한 바퀴: `open`이 `workflow_start`의 `running` 줄(instance 있음)을 주고 `instanceState`가 `running`이면 `ended`가 불리지 않는다. 호출 순서가 `open` → `instanceState` → `claimDue(startup: true)`다(겹침 판정 앞에서 읽는다).
  - 기록한 timer를 불러(또는 `wake()`) 다음 바퀴를 돌린다. `instanceState`를 `ended`(또는 `stopped`)로 바꾸면 그 바퀴가 `ended(jobRun, "done")`(또는 `"cancelled"`)을 한 번 부르고, 이 바퀴의 `claimDue`는 `startup: false`다.
  - 건 timer의 `ms`는 1시간을 넘지 않는다.
- 남지 않음: `grep -rn "setTimeout\|setInterval\|Date.now" packages/core/jobs packages/core/main/daemon/wiring/jobs.ts`가 0줄이다. `grep -rn "TODO" packages/core/jobs/scheduler.ts packages/core/jobs/scheduler_test.ts packages/core/main/daemon/wiring/jobs.ts`가 0줄이다.
- 돌리는 법: `deno test --no-check packages/core/jobs/scheduler_test.ts`.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것(lead):
  - `packages/core/main/daemon/assembly.ts`: `import { jobsWiring } from "./wiring/jobs.ts"`와 `WIRINGS`의 `workflowsWiring` 바로 뒤, `lophnAgentExtensionsWiring` 앞에 `jobsWiring`. 목록 위 주석에 "jobs는 runs·workflows 뒤다. 켤 때 둘을 맞춘 뒤에 첫 claim이 돈다"를 더한다.
  - `packages/core/main/daemon/wiring/context.ts`: `Late`와 `LATE_KEYS`의 `runService`·`workflowService`는 `sj-jobs-contract` 보고의 목록과 같다. 이 task는 읽기만 한다.
  - (`TEAMS`·`TEAM_MODULES`는 `sj-jobs-store`의 보고다.)
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: 남의 file을 최소로 맞춘 곳.
- 계약 바꾸기 요청: `JobSchedulerStore`·`JobStarter`·`JobScheduler`의 모양을 바꿔야 하면 고치지 말고 여기 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음". 예: `ended`가 일시 오류로 실패하면 그 줄이 다음 기동까지 `running`이라 그 job의 차례가 계속 건너뛰는 것(고치려면 바퀴마다 `running` run 줄을 다시 `waitRun`에 붙이는 일), 시간대나 시계가 크게 바뀐 뒤 `next_due_at`을 다시 계산하지 않는 것.
