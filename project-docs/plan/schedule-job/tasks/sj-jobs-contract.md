# sj-jobs-contract

job과 job run의 모양, job route(job tool 입출력, hold card의 읽기와 결정 command, scheduler command), 남지 않는 event, scheduler port를 새 file로 고정한다. job의 원샷 run 칸과 run id는 `headless-run`의 "run의 모양"(run 시작 입력, run id, 상태 `running|done|failed|cancelled`)을 그대로 따른다. 구현은 하지 않고 다른 task가 import할 이름과 모양만 낸다.

- 단위: jobs (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/jobs/`(새 폴더)
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/events/transient.ts`
  - `packages/core/jobs/ports.ts`(새 file)
  - `packages/core/jobs/mod.ts`(새 file)
  - `tools/check-deps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/event.md`("남지 않는 event", "Bus"의 commit 뒤 내기), `project-docs/architecture/layers.md`(feature module, "harness와 lophn feature module"의 tool 정의 file 규칙)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `protocol`, `events`, `event-stream`, `agent-tool-spi`와 lead가 더한 `jobs`. `project-docs/module-catalog.yaml`의 `packages/core/jobs`(lead가 더한다)
  - 본보기: `packages/protocol/domains/domains.ts`(record와 route 정의), `packages/protocol/domains/mod.ts`(`ROUTES`), `packages/protocol/events/transient.ts`의 `AppViewChanged`, `packages/core/domains/ports.ts`(`definePort`), `packages/core/storage/ledger/after-commit.ts`(`afterCommit`, `CommitAction`), `packages/core/lophn-agent/run-loop/topics.ts`(topic 이름)
  - 제품 결정: `project-docs/plan/schedule-job/README.md`의 "정한 것"과 "뼈대 검토에서 정한 것", `project-docs/products/roadmap/headless-schedule.md`의 "놓친 차례"
  - `headless-run`이 낸 것(land 뒤 path를 다시 맞춘다): `packages/protocol/runs/runs.ts`의 run id(`idSchema("run")`)와 `StartRun` 입력, `packages/protocol/lophn-agent/calls.ts`의 `namedAgentSchema` export
- 계약:
  - 쓰는 것: `idSchema`(`packages/protocol/base/ids.ts`), `defineCommand`·`defineRead`(`packages/protocol/base/route.ts`), `definePort`(`packages/protocol/base/ports.ts`), `agentRefSchema`·`placeSchema`(`packages/protocol/lophn-agent/places.ts`), `namedAgentSchema`·`NamedAgent`(`packages/protocol/lophn-agent/calls.ts`. call tool의 받는 이름 `{role, place?, name?}`. `headless-run`이 export한다), `jsonValueSchema`·`toolNameSchema`(`packages/protocol/apps/channel-values.ts`), `atSchema`(`packages/protocol/base/values.ts`), `Clock`·`Result`(`packages/base`), `headless-run`의 run id와 run 시작 입력
  - 내놓는 것(다른 task가 import하는 이름. 이 이름과 모양을 바꾸지 않는다):
    - `packages/protocol/base/ids.ts`: 접두사 `job`(Job), `jbr`(JobRun)
    - `packages/protocol/jobs/values.ts`
      - `jobIdSchema = idSchema("job")`, `jobRunIdSchema = idSchema("jbr")`
      - `jobEverySchema`: `<양의 정수><m|h|d>` 문자열(`"30m"`, `"1h"`, `"10d"`). cron 문법은 받지 않는다.
      - `jobAtSchema`: 하루 중 시각 `"HH:MM"`(선택). 이 컴퓨터의 local 시간대다. `every`가 `d` 단위일 때만 받는다.
      - `missedPolicySchema`: `"run" | "hold"`
      - `jobActionInputSchema`(`JobActionInput`): `{kind: "agent_run", agent: NamedAgent, prompt, input?, schema?}` | `{kind: "tool_run", app: Id<"app">, tool, input?}`. route와 tool이 받는 모양이다. 받는 agent는 call tool과 같은 꼴(`{role, place?, name?}`)로 받는다.
      - `jobActionSchema`(`JobAction`): 같은 꼴에 `agent: AgentRef`다. job을 만들거나 action을 바꿀 때 core route가 이름을 AgentRef로 풀어 저장한다(tool file은 풀지 않는다). 칸은 `headless-run`의 run 시작 입력과 같다. 차례마다 새 session이라 `session` 칸은 없다.
      - `jobRunStateSchema`(`JobRunState`): `queued | running | done | failed | cancelled | held | skipped | interrupted`
    - `packages/protocol/jobs/jobs.ts`
      - `jobRecordSchema`(`JobRecord`): `{id, title, creator: AgentRef, place: Place | null, every, at: string | null, action: JobAction, missed_policy, enabled, next_due_at: At | null, last_run: {job_run, state, due_at, started_at, ended_at} | null, revision, created_at, updated_at}`. `creator`는 만든 agent, `place`는 그 agent의 place(lophn은 null)다.
      - `jobRunRecordSchema`(`JobRunRecord`): `{id, job, due_at, missed_count, state, reason: string | null, run: <run id> | null, session: Id<"ses"> | null, started_at: At | null, ended_at: At | null, created_at}`. `due_at`은 이 줄이 답하는 차례(놓친 것이 여럿이면 마지막 차례), `missed_count`는 이 줄이 대신하는 놓친 차례 수(제때면 0)다. `session`은 agent run이 연 session이다.
      - `JobHold = {job: JobRecord, job_run: JobRunRecord}`: hold card 한 장
      - job route(creator는 agent 자격의 session으로 풀고 입력으로 받지 않는다)
        - command `jobCreate`(`job.create`, actor agent): 입력 `{title, every, at?, action: JobActionInput, missed_policy, enabled?}`(enabled 기본 true) → `JobRecord`
        - command `jobUpdate`(`job.update`, actor agent·user): 입력 `{job, title?, every?, at?(null이면 지움), action?: JobActionInput, missed_policy?, enabled?}` → `JobRecord`. agent에게 남이 만든 job은 `not_found`다. user는 어느 job이든 고친다(사람이 job 화면에서 끄고 켠다). 꺼 둔 job을 다시 켜면 그때부터 새로 센다.
        - command `jobDelete`(`job.delete`, actor agent·user): 입력 `{job}` → `{job}`. job과 그 job run 줄을 지운다. 도는 run은 끝까지 돈다. agent에게 남이 만든 job은 `not_found`다.
        - read `jobList`(`job.list`, actor agent·user): 입력 `{creator?, place?, cursor?, limit?}` → `{jobs, next_cursor}`. 거르기 칸은 user만 쓰고 agent는 늘 자기가 만든 것만 읽는다.
      - 사람 route(actor user)
        - read `jobRunList`(`job_run.list`): 입력 `{job, cursor?, limit?}`(새것부터) → `{job_runs, next_cursor}`
        - read `jobHolds`(`job.holds`): 입력 `{}` → `{holds: JobHold[]}`(state `held`인 줄 전부)
        - command `jobDecideHold`(`job.decide_hold`): 입력 `{job_run, choice: "run_now" | "skip"}` → `JobRunRecord`. `run_now`는 `queued`로, `skip`은 `skipped`(reason `person`)로 바꾼다. held가 아니면 `conflict`, 없으면 `not_found`. 같은 job에 `queued`나 `running` 줄이 있으면 `run_now`는 `conflict`이고 줄은 `held`로 남는다(card가 남는다).
      - scheduler route(actor machine, `machine:jobs`만)
        - command `jobClaimDue`(`job.claim_due`): 입력 `{startup: boolean}` → `{start: QueuedJobRun[], next_due_at: At | null}`. `QueuedJobRun = {job_run, job, creator, place, action}`. 한 tx에서 차례가 된 job마다 정책대로 job run 줄을 만들고 `next_due_at`을 다음 미래 차례로 옮긴다. `startup`이면 남은 `running` 줄을 `interrupted`로 닫고 놓친 차례로 센다. `hold`는 기다리는 `held` 줄이 있으면 새 줄을 만들지 않고 그 줄에 접는다(`missed_count`를 더하고 `due_at`을 옮긴다). 제때 온 차례가 `queued`가 되면 기다리던 `held` 줄은 `skipped`(reason `superseded`)로 닫는다.
        - command `jobRunStarted`(`job.run_started`): 입력 `{job_run, run, session: Id<"ses"> | null}` → `JobRunRecord`(`queued` → `running`)
        - command `jobRunEnded`(`job.run_ended`): 입력 `{job_run, state: "done" | "failed" | "cancelled"}` → `JobRunRecord`
      - `JOB_ROUTES`
    - `packages/protocol/events/transient.ts`: 남지 않는 event `JobChanged`(subject `job`, payload `{job_run: Id<"jbr"> | null}`). job이나 그 job run이 바뀐 commit 뒤에 낸다. 대기 목록과 job 화면이 다시 읽는 신호다.
    - `packages/core/jobs/ports.ts`
      - `JobTimers = {set(run: () => void, ms: number): unknown; clear(handle: unknown): void}`
      - `JobSchedulerDeps = {clock: Clock; timers: JobTimers; store: JobSchedulerStore; runs: JobRunStarter}`
      - `JobSchedulerStore = {claimDue(startup: boolean): Promise<Result<{start: QueuedJobRun[]; next_due_at: string | null}>>; started(job_run, run, session): Promise<Result<void>>; ended(job_run, state): Promise<Result<void>>}`. wiring이 `machine:jobs` 자격으로 위 scheduler command를 부르는 adapter로 낸다.
      - `JobRunStarter = {start(action: JobAction, by: {job, job_run, creator: AgentRef, place: Place | null}): Promise<Result<{run: <run id>; session: Id<"ses"> | null}>>; wait(run): Promise<Result<{state: "done" | "failed" | "cancelled"}>>}`. wiring이 `sj-runs-job-origin`의 helper(예: `runStartOfJobAction`. job에 저장된 AgentRef로 run 시작 입력을 만든다)와 run 시작(`by`)·`headless-run`의 run 기다리기를 감싸 낸다.
      - `JobScheduler = {start(): Promise<Result<void>>; wake(): void; stop(): Promise<void>}`
      - tx port `jobCreatorPort`: `creatorOf(session: Id<"ses">) → {agent: AgentRef; place: Place | null} | undefined`는 job command가 부른 agent를 푼다. `resolveAgent(named: NamedAgent) → Result<AgentRef>`는 job이 부를 agent의 이름을 푼다(Router와 같은 이름 풀기. coding agent는 `invalid_input`). 구현은 wiring registration이 꽂는다.
      - after-commit topic `JOBS_CHANGED_TOPIC`(data `{job, job_run: Id<"jbr"> | null}`). job command가 commit 뒤 할 일로 싣고, jobs wiring이 `JobChanged`를 내고 scheduler를 깨운다.
      - `at`을 푸는 time zone은 writer 등록 환경의 `jobs.zone`(IANA 이름)으로 받는다. wiring이 `environment` hook으로 넣는다.
    - `tools/check-deps.ts`: `CORE_FEATURES`에 `jobs`, `FEATURE_TOOL_PLACES`에 `packages/core/jobs/agent-tools.ts`

## 할 일

추가(planner, 살 단계 뒤): 아래 "planner가 정한다 / 열지 않는다"로 남긴 시간대는 tx port `jobZonePort {zone(): string}`로 정했다(README). `jobRunEnded`에는 선택 칸 `reason`을 둔다. agent는 자기가 만든 job만 고치고 지운다(사람은 모두).

0. 시작 전에 `project-docs/module-catalog.yaml`과 `project-docs/boundary-catalog.yaml`에 `packages/core/jobs`(boundary `jobs`) 줄이 있는지 본다. lead가 이 task보다 먼저, 또는 같이 commit한다(README "lead가 할 일"). 없으면 `check-modules`가 떨어진다. worker는 `project-docs`를 고치지 않고, 없으면 보고한다.
1. `packages/protocol/base/ids.ts`: `ID_PREFIXES`의 `dom` 뒤에 `job: "Job"`, `jbr: "JobRun"`을 더한다.
2. `packages/protocol/jobs/values.ts`(새 file). import는 `../base/ids.ts`, `../lophn-agent/places.ts`, `../lophn-agent/calls.ts`, `../apps/channel-values.ts`처럼 file을 바로 가리킨다(barrel `mod.ts`를 지나지 않는다, `layers.md` "실행 때 import").
   - `jobIdSchema`, `jobRunIdSchema`
   - `jobEverySchema = z.string().regex(/^[1-9][0-9]{0,4}[mhd]$/)`. 정한 것: 숫자는 다섯 자리까지다(99999d를 ms로 바꿔도 safe integer 안이다. 넘으면 다음 차례 셈이 틀린다).
   - `jobAtSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)`
   - `missedPolicySchema`, `JOB_RUN_STATES`와 `jobRunStateSchema`
   - `jobActionInputSchema`: `z.discriminatedUnion("kind", [...])`. agent_run은 `z.strictObject({kind, agent: namedAgentSchema, prompt: z.string().min(1), input: jsonValueSchema.optional(), schema: z.record(z.string(), z.json()).optional()})`, tool_run은 `z.strictObject({kind, app: idSchema("app"), tool: toolNameSchema, input: jsonValueSchema.optional()})`. 칸 이름과 제약은 `headless-run`의 `StartRun` 입력과 같게 둔다.
   - `jobActionSchema`: 같은 두 꼴을 `z.object`로, agent는 `agentRefOutputSchema`로 둔다(record는 output schema를 쓴다. `packages/protocol/domains/domains.ts`의 `domainRecordSchema`와 같은 꼴). type `JobActionInput`, `JobAction`을 낸다.
3. `packages/protocol/jobs/jobs.ts`(새 file): record, route, `QueuedJobRun`.
   - `jobRecordSchema`, `jobRunRecordSchema`(위 계약 칸 그대로. `revision`은 `revisionSchema`(`packages/protocol/projects/values.ts`), 시각은 `atSchema`, place는 `placeOutputSchema.nullable()`), `jobHoldSchema`(`JobHold`), `queuedJobRunSchema`(`QueuedJobRun`).
   - `jobRunRecordSchema.reason` 위에 값을 주석으로 적는다: `person`(사람이 건너뜀), `overlap`(앞 차례가 아직 돌아 건너뜀), `superseded`(제때 온 차례가 돌아 기다리던 hold 줄을 닫음). 그 밖은 null이다. type은 계약대로 `string | null`이다.
   - route. 정한 것: resource/method는 아래로 둔다(화면이 resource·method 문자열로 부른다).

     | 이름 | name | resource/method | 종류 | actors |
     |---|---|---|---|---|
     | `jobCreate` | `job.create` | `jobs/create` | command | agent |
     | `jobUpdate` | `job.update` | `jobs/update` | command | agent, user |
     | `jobDelete` | `job.delete` | `jobs/delete` | command | agent, user |
     | `jobList` | `job.list` | `jobs/list` | read | agent, user |
     | `jobRunList` | `job_run.list` | `job_runs/list` | read | user |
     | `jobHolds` | `job.holds` | `jobs/holds` | read | user |
     | `jobDecideHold` | `job.decide_hold` | `jobs/decide_hold` | command | user |
     | `jobClaimDue` | `job.claim_due` | `jobs/claim_due` | command | machine |
     | `jobRunStarted` | `job.run_started` | `job_runs/started` | command | machine |
     | `jobRunEnded` | `job.run_ended` | `job_runs/ended` | command | machine |

   - command의 `compare`는 모두 `z.strictObject({})`다(revision 비교 없음). 입력은 `z.strictObject`다. read 출력은 `withReadCommon(z.object({...}))`로 감싼다(`next_cursor`와 `as_of_seq`가 붙는다). `jobList`의 `limit`은 `packages/protocol/domains/domains.ts`의 `domainList`와 같은 꼴이다.
   - `jobCreate` 입력은 `at`이 있으면 `every`가 `d`로 끝나야 한다는 refine을 단다. `jobUpdate`는 두 칸이 따로 올 수 있어 합친 값을 handler가 본다(`sj-jobs-store`).
   - errors는 공통 일곱 안에서 고른다. command는 `invalid_input`, `forbidden`, `not_found`, `conflict` 가운데 일어나는 것만, read는 `domainList`의 `readErrors`와 같은 목록이다.
   - `export const JOB_ROUTES = [jobCreate, jobUpdate, jobDelete, jobList, jobRunList, jobHolds, jobDecideHold, jobClaimDue, jobRunStarted, jobRunEnded] as const`
4. `packages/protocol/jobs/mod.ts`(새 file): `values.ts`와 `jobs.ts`를 다시 내보내고 `export const ROUTES = [...JOB_ROUTES] as const`(`packages/protocol/domains/mod.ts` 꼴).
5. `packages/protocol/events/transient.ts`: `defineTransientEvent("JobChanged", {subject: idSchema("job"), payload: z.strictObject({job_run: idSchema("jbr").nullable()})})`를 더하고 `transientEventSchema` union에 넣는다. 위에 "job이나 그 job run이 바뀐 commit 뒤에 낸다. 대기 목록과 job 화면이 다시 읽는 신호다" 주석을 단다.
6. `packages/core/jobs/ports.ts`(새 file): 계약 칸의 type 다섯(`JobTimers`, `JobSchedulerDeps`, `JobSchedulerStore`, `JobRunStarter`, `JobScheduler`), `JobCreatorLookup`(`creatorOf`, `resolveAgent`)과 `jobCreatorPort = definePort<JobCreatorLookup>("jobs.creator")`, `JOBS_CHANGED_TOPIC = "jobs.changed"`와 그 data type `JobsChanged`. import는 `packages/base`, `packages/protocol/base/`, `packages/protocol/jobs/`, `packages/protocol/lophn-agent/places.ts`·`calls.ts`(type)만 한다. 이 file은 writer Worker와 main thread가 같이 싣는다.
7. time zone. 뼈대 문제(planner가 정한다): 계약 줄은 "writer 등록 환경의 `jobs.zone`"인데 writer Worker는 `environment` hook 값을 받지 않는다. `packages/core/storage/ledger/writer-assembly.ts`의 `teamRegistration`이 `createLedgerRegistration({} as never)`를 부르고, reader Worker는 `createReaderRegistration()`을 인자 없이 부른다. 환경은 main thread의 `assemble`(route 목록, `apiReads`)에만 닿는다. 그래서 `job.create`와 `job.claim_due`가 zone을 받지 못한다. 추천안: `ports.ts`에 tx port `jobZonePort = definePort<{zone(): string}>("jobs.zone")`(IANA 이름)를 두고, `sj-jobs-store`의 `jobs-registration.ts`가 `Intl.DateTimeFormat().resolvedOptions().timeZone`으로 꽂는다(조립이 이 컴퓨터의 시간대를 읽고 module은 port로 받는다). planner가 계약 줄을 고치기 전에는 이 task를 열지 않는다.
8. `packages/core/jobs/mod.ts`(새 file): `ports.ts`의 이름만 다시 내보낸다. 다른 file은 아직 없고, 쓰는 쪽은 file을 바로 import한다(`layers.md` "두지 않는 규칙").
9. `tools/check-deps.ts`: `CORE_FEATURES`에 `"jobs"`, `FEATURE_TOOL_PLACES`에 `"packages/core/jobs/agent-tools.ts"`를 더한다. jobs는 다른 feature module(apps, projects, problems, domains, `headless-run`의 runs)과 `agent-roles`를 import하지 않는다. 그 둘이 필요한 일은 port와 wiring이 한다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음. 모양은 schema가 지킨다.
- `grep -rn "jobs.zone" packages`가 time zone 결정(할 일 7)과 맞는다. 추천안이면 `ports.ts`의 port 이름 한 줄만 나온다.
- `grep -rn "from \"\.\./lophn-agent/mod.ts\"\|from \"\.\./apps/mod.ts\"" packages/protocol/jobs`가 0줄이다(barrel을 지나지 않는다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: lead가 고칠 목록 file. `packages/protocol/mod.ts`에 `export * as jobs from "./jobs/mod.ts"`와 `ALL_ROUTES`에 jobs `ROUTES`(shell main의 route 목록 `packages/shell/main/desktop/core/routes.ts`가 `ALL_ROUTES`로 사람 화면의 route를 연다)
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
