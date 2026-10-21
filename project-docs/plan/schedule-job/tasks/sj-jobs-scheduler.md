# sj-jobs-scheduler

lophn(tray 포함)이 켜져 있는 동안 도는 scheduler loop와 그 wiring을 만든다. 주입한 Clock과 timer로 깨어 `job.claim_due`를 부르고, 받은 job run마다 `headless-run`의 "core의 run 연산"으로 run을 시작하고(그 run의 turn은 unattended다) 끝을 기록한다. Reactor와 domain event에 얹지 않는다.

- 단위: jobs (wave 3)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/core/jobs/scheduler.ts`(새 file)
  - `packages/core/main/daemon/wiring/jobs.ts`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`("Bus와 Reactor": Bus에 내는 것은 commit 뒤, core 안 command는 접힌 writer `ctx.writer`로, 겹쳐 깨워도 한 줄로 돈다, Bus는 놓칠 수 있다), `project-docs/architecture/layers.md`(scheduler는 feature module `jobs`에 두고 조립은 `core/main`이 한다)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `jobs`(lead가 더한다), `events`, `storage`. `project-docs/module-catalog.yaml`의 `packages/core/jobs`
  - 본보기: `packages/core/main/daemon/wiring/apps-tickets.ts`(machine 자격 기록 `records`, `ctx.writer.command`, timer를 `closeWork`에서 멈춤), `packages/core/main/daemon/wiring/router.ts`의 `build`가 내는 `writer: (inner) => ... withAfterCommit(inner, apply)`, `packages/core/main/daemon/wiring/apps.ts`의 `AppViewChanged` 내기(`ctx.peek.bus?.publish`), `packages/core/main/daemon/wiring/context.ts`(hook 순서, `Built.writer`), `packages/core/storage/ledger/after-commit.ts`(`withAfterCommit`, `CommitAction`), `packages/core/main/daemon/wiring/lophn-agent-runtime.ts`의 `createIdSource({clock, random})`
  - 제품 결정: `project-docs/products/roadmap/headless-schedule.md`의 "놓친 차례"와 "정한 것(agent)"(켜져 있을 때만 돈다, 자동 재시도 없음, Reactor에 얹지 않는다), `project-docs/plan/schedule-job/README.md`의 "뼈대 검토에서 정한 것"(timer port, 할당은 부를 때만, 도는 run은 job을 지워도 끝까지)과 "살 단계 검토에서 정한 것"(run 시작 helper, `Late` 칸)
  - `sj-jobs-due`의 `packages/core/jobs/due.ts`(claim이 같은 줄을 두 번 넘기지 않는 규칙)
- 계약:
  - 쓰는 것: `sj-jobs-contract`의 `JobSchedulerDeps`, `JobSchedulerStore`, `JobRunStarter`, `JobScheduler`, `JobTimers`, `JOBS_CHANGED_TOPIC`, scheduler route(`jobClaimDue`, `jobRunStarted`, `jobRunEnded`), 남지 않는 event `JobChanged`. `sj-runs-job-origin`의 helper(예: `runStartOfJobAction`. job에 저장된 AgentRef로 run 시작 입력을 만든다)와 run 시작 `start(input, by)`. `headless-run`의 run 기다리기. run service는 lead가 `packages/core/main/daemon/wiring/context.ts`의 `Late`에 등록한 칸으로 받는다
  - 내놓는 것: `createJobScheduler(deps: JobSchedulerDeps): JobScheduler`. wiring `jobsWiring`: machine 자격 `machine:jobs`(scheduler route만), 환경 `jobs.zone`, `JOBS_CHANGED_TOPIC`을 받아 `JobChanged`를 내고 scheduler를 깨우는 writer 층, start에서 scheduler 시작, closeWork에서 멈춤. 등록할 것(lead): assembly `WIRINGS`

## 할 일

추가(planner, 살 단계 뒤): 아래 "planner가 정한다 / 열지 않는다"로 남긴 시간대는 tx port `jobZonePort {zone(): string}`로 정했다(README). `jobRunEnded`에는 선택 칸 `reason`을 둔다. agent는 자기가 만든 job만 고치고 지운다(사람은 모두).

1. `packages/core/jobs/scheduler.ts`(새 file): `createJobScheduler(deps)`. import는 `packages/base`, `packages/protocol/jobs/`, 같은 module의 `ports.ts`뿐이다. 시각은 `deps.clock`, timer는 `deps.timers`로만 받는다(`setTimeout`, `Date.now`를 쓰지 않는다. `next_due_at` 글을 ms로 바꾸는 `Date.parse`는 된다).
   - 한 번에 한 줄로 돈다(event.md의 Reactor와 같은 까닭). claim 한 번과 받은 줄 시작하기를 "한 바퀴"로 하고, 도는 중에 `wake()`가 오면 표시만 해 두었다가 그 바퀴가 끝나면 한 바퀴 더 돈다.
   - `start()`: `claimDue(true)`로 첫 바퀴를 돌고 `ok`를 돌려준다. claim이 실패해도 core 기동을 막지 않는다. `console.error`로 남기고 1분 뒤 다시 한다.
   - `wake()`: 멈췄으면 아무것도 안 한다. 아니면 `claimDue(false)` 바퀴를 연다(위 한 줄 규칙).
   - 한 바퀴: `claimDue`가 준 `start`의 줄마다 차례로
     1. `deps.runs.start(action, {job, job_run, creator, place})`. 실패면 `deps.store.ended(job_run, "failed")`. 정한 것: 시작하지 못한 run은 job run 실패로 남기고 다시 하지 않는다(roadmap "자동 재시도는 없다").
     2. 성공이면 `deps.store.started(job_run, run, session)`을 기다린다. 실패(job이 지워져 `not_found` 등)는 남기기만 하고 run은 그대로 둔다(README "도는 run은 끝까지 돈다").
     3. `deps.runs.wait(run)`은 기다리지 않고 띄운다. 끝나면 `deps.store.ended(job_run, state)`. wait가 오류면 남기기만 하고 줄은 그대로 둔다. 거짓으로 끝을 적으면 다음 차례가 앞 run과 겹쳐 돈다. 그 줄은 다음 기동이 `interrupted`로 닫는다. reject도 잡는다.
   - 할당: 앱 tool run을 할당이 막으면 그 run이 `failed`로 끝나고 3이 그대로 `failed`를 적는다. 만들 때는 보지 않는다(README "할당은 부를 때만 확인한다").
   - timer: 바퀴가 끝나면 claim이 준 `next_due_at`에 맞춰 건다. 정한 것: 한 번에 최대 1시간까지만 잔다. `setTimeout`은 2^31-1ms(약 24.8일)를 넘는 값을 곧바로 부르고(10d job이 끝없이 claim을 부른다), 시계가 바뀌는 일도 있다. 1시간에 깨어 아직 차례 전이면 claim 없이 다시 건다(claim은 command라 부를 때마다 `command_results` 줄이 하나 남는다). `next_due_at`이 null이면 1시간 뒤 다시 본다.
   - `stop()`: 멈춤 표시, timer 풀기, 도는 바퀴를 기다린다. 띄운 run 기다리기는 기다리지 않는다(agent turn은 길다. 끊긴 run은 다음 기동이 놓친 차례로 센다).
2. `packages/core/main/daemon/wiring/jobs.ts`(새 file): `jobsWiring: WiringFactory`.
   - machine 자격: `principal`·`credential_ref` `"machine:jobs"`, `actor: "machine"`, `scope.operations`는 `jobClaimDue.name`, `jobRunStarted.name`, `jobRunEnded.name` 셋, `targets: {}`, `conditions: {}`. `records: () => [jobsMachineContext as never]`(`apps-tickets.ts` 꼴).
   - `build(ctx)`: `ok({writer: (inner) => withAfterCommit(inner, apply)})`. `apply`는 topic이 `JOBS_CHANGED_TOPIC`인 일마다 `ctx.peek.bus?.publish({type: "JobChanged", subject: job, at: ctx.clock.now(), payload: {job_run}})`를 내고 scheduler를 깨운다. 다른 topic은 건너뛴다. 사람과 agent의 command도 core 안 command도 접힌 writer를 지나므로 여기서 다 받는다.
   - `JobSchedulerStore` adapter: `ctx.writer.command(jobsMachineContext as never, {command: <route>.name, input, compare: {}, idempotency_key, prepared: []})`. 결과는 `done.value.result`다. key는 claim이 `createIdSource({clock: ctx.clock, random: ctx.random}).newId("idk")`, 시작과 끝은 `job.run_started:<job_run>`, `job.run_ended:<job_run>`이다(같은 줄의 같은 일은 한 번이다).
   - `JobRunStarter` adapter: run service는 lead가 `context.ts`의 `Late`에 등록한 칸에서 받는다(README "살 단계 검토에서 정한 것". 칸 이름은 그 등록을 따른다). `start(action, by)`는 `service.start(runStartOfJobAction(action), by)`의 `{run, session}`을 돌려준다(`sj-runs-job-origin`. job에 저장된 AgentRef로 시작한다. 이름을 다시 풀지 않는다). `wait(run)`은 run이 `running`이 아닐 때까지 `headless-run`의 run 기다리기(한 번에 60초까지)를 되풀이하고 끝 상태를 돌려준다.
   - `JobTimers`: `{set: (run, ms) => setTimeout(run, ms), clear: (handle) => clearTimeout(handle as number)}`. 조립이라 global timer를 여기서만 쓴다.
   - `start(ctx)`: scheduler를 만들어 변수에 둔 뒤 `scheduler.start()`를 돌려준다(시작 중 `apply`가 깨워도 그 변수를 본다).
   - `closeWork()`: `await scheduler?.stop()`
   - zone: 뼈대 문제(planner가 정한다). 계약 줄의 "환경 `jobs.zone`"(`environment` hook)은 writer Worker의 command에 닿지 않는다(`sj-jobs-contract` 할 일 7). 추천안대로면 zone은 `sj-jobs-store`의 `jobs-registration.ts`가 tx port로 꽂고 이 wiring은 `environment` hook을 두지 않는다.
   - Reactor(`ctx.reactor.on`)와 domain event를 쓰지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 같은 job이 겹쳐 돌지 않는 것은 표(`claimed_at`, 도는 줄 unique index)가 지키고 `sj-jobs-due`의 test가 본다. timer와 run을 띄우는 test는 만들지 않는다.
- `grep -rn "setTimeout(\|setInterval(\|Date.now(" packages/core/jobs`가 0줄이다(timer와 시각은 주입한다).
- `grep -rn "ctx.reactor\|defineEvent" packages/core/main/daemon/wiring/jobs.ts packages/core/jobs`가 0줄이다(Reactor와 domain event에 얹지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에 `jobsWiring`(events와 run service를 내는 runs wiring 뒤). run service의 `Late` 칸이 아직 없으면 그 칸과 runs wiring의 `ctx.provide`. 등록 뒤 `project-docs/plan/tools/lead/boot.sh`로 core가 두 번 뜨는지 본다(이 task의 worktree에서는 `WIRINGS`에 없어서 기동이 이 wiring을 돌리지 않는다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
