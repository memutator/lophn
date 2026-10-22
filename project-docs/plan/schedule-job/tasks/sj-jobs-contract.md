# sj-jobs-contract

job과 job run의 type·표·route·tool 입력, scheduler·시간대 port, 그리고 다른 task가 만드는 접점(program caller, run의 `job` 칸, job이 시작한 instance, 화면 신호)의 모양을 한 곳에 고정한다. 이 task는 protocol `jobs`와 core `jobs`의 port file만 쓰고, 접점의 구현은 "접점" 절이 가리키는 task가 한다.

- 단위: jobs (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/jobs/{values,jobs,mod}.ts` (새 file)
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/events/transient.ts`
  - `packages/core/jobs/ports.ts` (새 file)
  - `packages/core/jobs/mod.ts` (lead가 빈 file로 먼저 둔다)
  - `tools/check-deps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/run.md`("읽기": 화면이 session event 때 다시 읽고 run event가 계약에 없는 이유), `project-docs/architecture/workflow.md`("흐름": 남지 않는 event `WorkflowInstanceChanged`), `project-docs/architecture/event.md`(남지 않는 event, 뒤에 움직일 일은 같은 tx), `project-docs/architecture/app-call.md`(부르는 쪽 `CallAuth`와 `VerifiedCaller`: "접점"의 모양을 맞추려고 읽는다. 이 task는 그 file을 고치지 않는다), `project-docs/architecture/layers.md`(feature module과 `core/main`)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `jobs`와 `agent-tool-spi`, `project-docs/module-catalog.yaml`의 `packages/core/jobs`(lead가 먼저 등록한다)
  - 본보기 코드: `packages/protocol/runs/{runs,mod}.ts`(route 정의 꼴: `defineCommand`·`defineRead`, 입력 `z.strictObject`, `RUN_ROUTES`와 `ROUTES`, `withReadCommon`, 입력에 refine을 두지 않는 이유 주석), `packages/protocol/workflows/{instances,commands,routes}.ts`(machine만 받는 command와 read의 actors·errors), `packages/protocol/domains/domains.ts`(`domain.create` 꼴 route name), `packages/protocol/events/transient.ts`의 `workflowInstanceChanged`, `packages/protocol/base/{ids,ports}.ts`, `packages/core/runs/ports.ts`·`packages/core/workflows/ports.ts`(core port type 꼴), `packages/core/domains/ports.ts`(`definePort` 쓰는 곳), `packages/protocol/apps/calls/caller.ts`·`packages/core/apps/calls/caller.ts`(접점이 더할 갈래의 자리), `tools/check-deps.ts`의 `CORE_FEATURES`·`FEATURE_TOOL_PLACES`
  - 제품 결정: 계획 README의 "정한 것"(주기, 놓친 차례 정책, 할 일, 누가)
- 계약:
  - 쓰는 것
    - `idSchema`(`packages/protocol/base/ids.ts`), `defineCommand`·`defineRead`(`packages/protocol/base/route.ts`), `definePort`(`packages/protocol/base/ports.ts`)
    - `agentRefOutputSchema`·`placeOutputSchema`(`packages/protocol/lophn-agent/places.ts`), `namedAgentSchema`(`packages/protocol/lophn-agent/calls.ts`), `toolNameSchema`(`packages/protocol/apps/channel-values.ts`), `workflowKeySchema`·`workflowNameSchema`·`stepNameSchema`(`packages/protocol/workflows/values.ts`)
    - 자유 JSON 칸은 `jsonValueSchema`(`z.custom`)가 아니라 `z.json()`을 쓴다(아래 "정한 것")
    - `atSchema`·`readCursorSchema`(`packages/protocol/base/values.ts`), `withReadCommon`(`packages/protocol/base/envelope.ts`)
    - `Clock`·`Result`(`packages/base`)
  - 내놓는 것(다른 task가 import하거나 기대는 이름과 모양. 바꾸려면 계약 바꾸기 요청이다)
    - **id 접두사** `packages/protocol/base/ids.ts`: `job`(Job), `jbr`(JobRun)
    - **값** `packages/protocol/jobs/values.ts`
      - `jobIdSchema = idSchema("job")`, `jobRunIdSchema = idSchema("jbr")`
      - `jobTitleSchema`: 1~80자
      - `jobEverySchema`: `^[1-9][0-9]{0,4}[mhd]$`(`"30m"`, `"1h"`, `"10d"`). cron 문법은 받지 않는다.
      - `jobAtSchema`: `^([01][0-9]|2[0-3]):[0-5][0-9]$`. `every`가 `d` 단위일 때만 쓴다. 이 컴퓨터의 local 시간대의 시각이다.
      - `MISSED_POLICIES = ["run", "hold"]`, `missedPolicySchema`
      - `JOB_RUN_STATES = ["queued", "running", "done", "failed", "cancelled", "held", "skipped", "interrupted"]`
      - `JOB_ACTION_KINDS = ["agent_run", "tool_run", "workflow_start"]`
      - `jobActionInputSchema`(`JobActionInput`, route와 tool이 받는 꼴). 자유 JSON 칸(`agent_run.input`, `schema`의 값, `tool_run.input`)은 모두 `z.json()`이다. `sj-jobs-tools`가 이 schema를 tool 입력으로 그대로 쓰므로 `z.toJSONSchema`가 던지지 않아야 한다.
        - `{kind: "agent_run", agent: NamedAgent, prompt: string(min 1), input?: json, schema?: Record<string, json>}`. `agent`는 call tool과 같은 `{role, place?, name?}`다.
        - `{kind: "tool_run", app: string(min 1), tool: ToolName, input?: json}`. `app`은 앱 id, slug, 이름 가운데 하나다.
        - `{kind: "workflow_start", workflow: "<project 이름>/<name>", text: string(min 1), step?: StepName}`
      - `jobActionSchema`(`JobAction`, 저장하고 읽는 꼴. 만들거나 바꿀 때 core가 이름을 풀어 저장한다)
        - `{kind: "agent_run", agent: AgentRef, agent_place: Place | null, prompt, input?: json, schema?}`. `agent_place`는 부를 agent의 place(lophn은 null, Operator는 정의의 place)다.
        - `{kind: "tool_run", app: Id<"app">, tool, input?: json}`
        - `{kind: "workflow_start", project: Id<"prj">, workflow: WorkflowName, text, step?}`. project 이름은 바뀌므로 id로 저장한다.
    - **record** `packages/protocol/jobs/jobs.ts`
      - `JobRecord`(`jobRecordSchema`): `{id, title, creator: AgentRef, every, at: string | null, action: JobAction, missed_policy, enabled: boolean, next_due_at: At | null, last_run: {job_run, state, due_at, started_at: At | null, ended_at: At | null} | null, created_at, updated_at}`
        - `creator`는 `lophn | project_manager | app_engineer`뿐이다(Operator는 job을 만들지 못한다). 만든 agent의 place는 `placeOfAgentRef(creator)`로 얻는다.
        - `last_run`은 저장하지 않고 읽을 때 그 job의 가장 새 job run으로 채운다. `next_due_at`은 꺼져 있으면 null이다.
      - `JobRunRecord`(`jobRunRecordSchema`): `{id, job, due_at, missed_count: int >= 0, state, reason: string | null, run: Id<"run"> | null, instance: Id<"wfi"> | null, session: Id<"ses"> | null, started_at: At | null, ended_at: At | null, created_at}`
        - `due_at`은 이 줄이 답하는 차례(놓친 것이 여럿이면 마지막 차례), `missed_count`는 이 줄이 대신해 접은 놓친 차례 수(제때 온 차례는 0)다.
        - `run`은 agent_run·tool_run이 연 run, `instance`는 workflow_start가 시작한 instance, `session`은 agent_run이 연 session이다.
        - `reason`: skipped 줄은 `person`(사람이 건너뜀) | `overlap`(앞 차례가 아직 돌아 건너뜀) | `superseded`(제때 온 차례가 돌아 기다리던 hold 줄을 닫음). run이나 instance를 시작하지 못한 failed 줄은 `<code>: <message>`. 그 밖은 null이다. 다른 실패의 이유는 그 run 기록의 `error`에 있다.
      - `JobTurn = {job: JobRecord, job_run: JobRunRecord}`. `JobHold`(hold card 한 장), `QueuedJobRun`(scheduler가 받는 시작할 줄), `OpenJobRun`(도는 줄)은 모두 이 꼴의 별칭이다.
    - **route** `packages/protocol/jobs/jobs.ts`. command는 모두 `compare: z.strictObject({})`이고 입력은 `z.strictObject`다. read 출력은 `withReadCommon`으로 감싼다. `JOB_ROUTES`와 `ROUTES`(`mod.ts`)로 낸다.

      | name | resource/method | 종류 | actors | 입력 | 출력 |
      |---|---|---|---|---|---|
      | `job.create` | `jobs/create` | command | agent | `{title, every, at?, action: JobActionInput, missed_policy, enabled?}`(`enabled` 기본 true) | `{job: JobRecord}` |
      | `job.update` | `jobs/update` | command | agent, user | `{job, title?, every?, at?: string \| null, action?: JobActionInput, missed_policy?, enabled?}` | `{job: JobRecord}` |
      | `job.delete` | `jobs/delete` | command | agent, user | `{job}` | `{job}` |
      | `job.list` | `jobs/list` | read | agent, user | `{cursor?}` | `{jobs: JobRecord[]}` |
      | `job_run.list` | `job_runs/list` | read | user | `{job, cursor?}` | `{job_runs: JobRunRecord[]}` |
      | `job.holds` | `jobs/holds` | read | user | `{}` | `{holds: JobHold[]}` |
      | `job.decide_hold` | `jobs/decide_hold` | command | user | `{job_run, choice: "run_now" \| "skip"}` | `{job_run: JobRunRecord}` |
      | `job.claim_due` | `jobs/claim_due` | command | machine | `{startup: boolean}` | `{start: QueuedJobRun[], next_due_at: At \| null}` |
      | `job_run.open` | `job_runs/open` | read | machine | `{}` | `{open: OpenJobRun[]}` |
      | `job_run.started` | `job_runs/started` | command | machine | `{job_run, run: Id<"run"> \| null, instance: Id<"wfi"> \| null, session: Id<"ses"> \| null}` | `{job_run: JobRunRecord}` |
      | `job_run.ended` | `job_runs/ended` | command | machine | `{job_run, state: "done" \| "failed" \| "cancelled", reason?: string}` | `{job_run: JobRunRecord}` |

      - **TS export 이름**(`packages/protocol/jobs/jobs.ts`. 뒤 task와 화면 task가 이 이름으로 import한다): `job.create` = `jobCreate`, `job.update` = `jobUpdate`, `job.delete` = `jobDelete`, `job.list` = `jobList`, `job_run.list` = `jobRunList`, `job.holds` = `jobHolds`, `job.decide_hold` = `jobDecideHold`, `job.claim_due` = `jobClaimDue`, `job_run.open` = `jobRunOpen`, `job_run.started` = `jobRunStarted`, `job_run.ended` = `jobRunEnded`.
      - errors는 공통 일곱 안에서 일어나는 것만 적는다. `job.create`는 만든 agent가 lophn·Project Manager·App Engineer가 아니면 `forbidden`이다.
      - `job.list`는 agent에게는 자기와 같은 creator(AgentRef가 같은 것)의 job만, user에게는 모든 job을 준다. id 순이고 50개씩이다. `job_run.list`는 새것이 앞이고 50개씩이다.
    - **표** (만드는 쪽: `sj-jobs-store`. 개발 data는 schema가 바뀌면 지운다)
      - `jobs`: `id` PK, `title`, `creator_role`, `creator_id`(lophn은 NULL, Project Manager는 prj id, App Engineer는 app id), `every`, `at`(NULL 가능), `action`(`JobAction` JSON), `missed_policy`, `enabled`(0|1), `next_due_at`(NULL 가능), `created_at`, `updated_at`
      - `job_runs`: `id` PK, `job`, `due_at`, `missed_count`, `state`, `reason`, `run`, `instance`, `session`, `claimed_at`(scheduler에 넘긴 때. 안쪽 칸이라 record에 없다), `started_at`, `ended_at`, `created_at`. unique index 둘: 도는 줄은 job마다 하나(`state IN ('queued', 'running')`), 기다리는 줄도 하나(`state = 'held'`). FK는 두지 않는다.
      - schema step id는 `jobs.tables` 하나다.
    - **남지 않는 event** `packages/protocol/events/transient.ts`: `JobChanged`(subject = job id, payload `{job_run: Id<"jbr"> | null}`). job이나 그 job run이 바뀐 command가 commit된 뒤 낸다. 대기 목록과 job 화면이 다시 읽으라는 신호다(run과 workflow의 `WorkflowInstanceChanged` 본보기).
    - **core port** `packages/core/jobs/ports.ts`. 이 file은 `packages/base`, `packages/protocol`의 type과 `definePort`만 import한다.
      - `JobTimers = {set(run: () => void, ms: number): unknown; clear(handle: unknown): void}`
      - 시간대 port: `jobZonePort = definePort<{zone(): string}>("jobs.zone")`. IANA 이름. 구현은 `sj-jobs-store`의 `jobs-registration.ts`가 `Intl.DateTimeFormat().resolvedOptions().timeZone`으로 꽂는다.
      - 풀기 port: `jobTargetsPort = definePort<JobTargets>("jobs.targets")`
        - `creatorOf(session: Id<"ses">): AgentRef | undefined`
        - `resolveAgent(named: NamedAgent): Result<{agent: AgentRef; place: Place | null}>`. coding agent는 `invalid_input`.
        - `resolveApp(ref: string): Result<Id<"app">>`, `resolveProject(ref: string): Result<Id<"prj">>`. 없으면 `not_found`.
      - `JOBS_CHANGED_TOPIC = "jobs.changed"`, data `{job: Id<"job">, job_run: Id<"jbr"> | null}`. job command가 commit 뒤 할 일로 싣는다.
      - scheduler가 기대는 것
        - `JobSchedulerStore = {claimDue(startup: boolean): Promise<Result<{start: JobTurn[]; next_due_at: string | null}>>; open(): Promise<Result<JobTurn[]>>; started(jobRun, found: {run, instance, session}): Promise<Result<void>>; ended(jobRun, state: "done" | "failed" | "cancelled", reason?: string): Promise<Result<void>>}`
        - `JobStarter = {start(job: JobRecord, jobRun: JobRunRecord): Promise<Result<{run: Id<"run"> | null; instance: Id<"wfi"> | null; session: Id<"ses"> | null}>>; waitRun(run: Id<"run">): Promise<Result<{state: "done" | "failed" | "cancelled"}>>; instanceState(instance: Id<"wfi">): Promise<Result<"running" | "ended" | "stopped">>}`
        - `JobSchedulerDeps = {clock: Clock; timers: JobTimers; store: JobSchedulerStore; starter: JobStarter}`
        - `JobScheduler = {start(): Promise<Result<void>>; wake(): void; stop(): Promise<void>}`
    - **접점**(이 task는 모양만 고정한다. 구현하는 task가 같은 모양을 쓴다)
      - **program caller**(`sj-apps-program-caller`)
        - 앱 호출 wire의 부른 쪽 `appToolCallerSchema`(`packages/protocol/apps/calls/caller.ts`)에 `{kind: "program", job: Id<"job">, job_run: Id<"jbr">}`를 더한다. `idSchema`로 쓰고 `protocol/jobs`를 import하지 않는다(import 순환).
        - `CallAuth`(`packages/core/apps/calls/caller.ts`)에 `{actor: "program", program: {job, job_run, agent: AgentRef, place: Place | null}}` 갈래를 더한다. `agent`는 job을 만든 agent(creator)다. route `app.call_tool`의 actors는 그대로라 사람, agent, 앱은 이 caller를 만들지 못한다. core 안 run 연산만 만든다.
        - `VerifiedCaller`에 `{kind: "program", job, job_run, agent, place}`. 판정은 creator의 지금 할당(`judge`, mode `unattended`)과 creator의 tool 목록에 뜰 tool인가(공개 tool이거나 creator가 맡은 domain의 tool)다. 막히면 handler에 가기 전에 invocation을 `denied`(`gate_blocked`)로 남기고 outcome `denied`를 돌려준다.
        - `AppToolLookup.find`가 `{release, effect, public: boolean, domain: string}`을 돌려준다.
      - **run의 `job` 칸**(`sj-runs-job-origin`)
        - `runRecordSchema`와 `CreateRun` 입력에 `job: Id<"job"> | null`, `runs` 표에 `job` 칸. job이 연 run만 값이 있다. 화면 route `StartRun`의 입력은 바꾸지 않는다.
        - core 안 시작: `RunService.start(input, origin?)`. `origin = {job, job_run, creator: AgentRef, creator_place: Place | null}`. 입력에 이미 푼 agent로 부르는 갈래 `{kind: "agent_resolved", agent: AgentRef, place: RunPlace | null, prompt, input?, schema?}`(늘 새 session)를 더한다. tool run은 `origin`이 있으면 program caller로 부른다(`RunTools.call(run, app, tool, input, origin?)`).
      - **job이 시작한 instance**(`sj-workflows-job-start`)
        - `startedBySchema = user | {kind: "job", job: Id<"job">}`(`packages/protocol/workflows/instances.ts`). `workflow_instances.started_by` JSON, `CreateWorkflowInstance`의 `started_by`, `started` 줄의 `by`, `workflowInstanceSummarySchema.started_by`(새 칸)가 쓴다. `lineBySchema`는 그대로다.
        - 시작: `workflowService.start({workflow: "<prj id>/<name>", text, step?}, {kind: "job", job})`. 사람만 받는 `StartWorkflow` route와 그 actors는 그대로다.
      - **wiring이 나누는 값**(lead가 이 계약 wave와 함께, wave 2 전에 `packages/core/main/daemon/wiring/context.ts`의 `Late`에 등록한다. wave 2의 `sj-workflows-job-start`와 wave 3의 `sj-runs-job-origin`이 `ctx.provide`하므로 그때 칸이 있어야 한다): `runService`(runs wiring이 `provide`), `workflowService`(workflows wiring이 `provide`). jobs wiring이 읽는다.
      - **화면 신호**: `JobChanged`가 전부다. 대기 목록은 받으면 `job.holds`를 다시 읽고, job 화면은 `job.list`와 `job_run.list`를 다시 읽는다. run 줄과 instance 줄은 새 신호 없이 지금의 session event와 `WorkflowInstanceChanged` 때 다시 읽는다. 그 줄의 job 제목은 `job.list`를 읽어 job id로 붙인다.

## 정한 것

- 사람은 job을 만들지 못한다(README "agent가 만들고 켠다"). user는 `job.update`, `job.delete`, `job.list`와 job run 읽기, hold 결정만 부른다.
- "자기가 만든 job"은 AgentRef가 같은 것이다(session이 아니라 agent). lophn은 하나의 agent라 lophn의 어느 session이든 lophn이 만든 job을 고친다.
- `revision`과 `compare`를 두지 않는다. job을 동시에 고치는 쪽이 사람 화면과 agent 정도라 마지막 쓰기가 이기게 둬도 잃는 것이 없다(AGENTS.md "속도").
- `place`를 job 칸으로 두지 않는다. creator가 lophn·Project Manager·App Engineer뿐이라 `placeOfAgentRef(creator)`로 나온다.
- tool_run의 `app`은 이름이어도 만들 때 `Id<"app">`로 풀어 저장하고 못 풀면 `not_found`다. tool 이름이 앱에 있는지는 만들 때 보지 않는다(run과 같다. 부를 때 `tool_denied`로 실패한다). workflow_start의 project는 만들 때 풀어 id로 저장하고, 정의 file이 있는지는 만들 때 보지 않는다(file이라 tx 밖이다. 시작 때 `not_found`나 `conflict`로 실패한다).
- 앞 차례가 도는지는 `job_runs` 표 하나로 판정한다. 다른 module의 표(runs, workflow_instances)를 SQL로 읽지 않는다. 그래서 workflow_start의 job run은 scheduler가 instance 상태를 보고 닫는다(`sj-jobs-scheduler`). run을 가진 job run은 scheduler가 run을 기다려 닫는다.
- 접점은 program caller를 "사람 caller + run id"로 얼버무리지 않고 wire에 `program`을 더한다. 그래야 invocation 기록과 rewind 화면이 job이 한 호출을 가려 보인다. 대신 SDK `AppToolCaller` type과 앱 process의 caller 검사에 갈래가 하나 늘고, 화면 세 곳의 switch가 같이 바뀐다.
- 화면 낱말: 사용자에게 보이는 영어 이름은 "Scheduled job(s)"이다. [지금 실행]은 "Start now", [건너뛰기]는 "Skip"이다(wording 규칙이 `run`, `claim`, `call`, `grant`를 화면 글에 못 쓰게 한다).
- `tools/check-deps.ts`: `CORE_FEATURES`에 `jobs`, `FEATURE_TOOL_PLACES`에 `packages/core/jobs/agent-tools.ts`를 더한다.
- 자유 JSON 칸은 `z.json()`이다. `jsonValueSchema`는 `z.custom`이라 `z.toJSONSchema`가 던지는데, job tool 입력이 이 schema를 그대로 쓰기 때문이다(`sj-jobs-tools`). 확인한 것: `runs.ts`의 route 입력이 이미 `z.record(z.string(), z.json())`을 쓰고, ALL_ROUTES의 schema를 걸어 검사하는 check나 test는 없으며, `jobActionInputSchema`(discriminatedUnion)를 `z.toJSONSchema`에 넣으면 `$defs`/`$ref`로 바뀐다. 따로 맞출 것은 없다. 다른 점은 `z.json()`이 own `__proto__` 키를 지우고 `NaN`·`Infinity`를 거절하는 것(`jsonValueSchema`는 canonical 검사만 한다)인데, job은 받은 값을 그대로 저장하고 부를 때 run이 다시 검사하므로 문제없다.
- route 변수 이름은 `jobCreate`, `jobUpdate`, `jobDelete`, `jobList`, `jobRunList`, `jobHolds`, `jobDecideHold`, `jobClaimDue`, `jobRunOpen`, `jobRunStarted`, `jobRunEnded`다. 뒤 task가 import하므로 계약 task에서 고정한다. 본보기는 `runCreate`·`runSettle`의 camelCase다.
- `core/jobs/mod.ts`는 `ports.ts`만 내보낸다. 이유: 뒤 task의 소유 목록에 `mod.ts`가 없다. 뒤 task는 file 경로로 import한다.

## 할 일

1. **`packages/protocol/base/ids.ts`.** `ID_PREFIXES`에 `job: "Job"`, `jbr: "JobRun"`을 `wfi` 아래에 더한다. 이유: 접두사 목록은 이 file만 갖는다. 다른 file에 사본을 만들지 않는다.
2. **`packages/protocol/jobs/values.ts`(새).** 위 "값"을 그대로 쓴다.
   - `jobActionInputSchema`와 `jobActionSchema`는 `kind`로 가르는 `z.discriminatedUnion`이다. 입력 쪽은 각 갈래가 `z.strictObject`이고 `namedAgentSchema`·`toolNameSchema`와 `z.json()`을 쓴다(`jsonValueSchema`는 쓰지 않는다). 저장하고 읽는 쪽은 output 꼴(`agentRefOutputSchema`, `placeOutputSchema`)이다(`runRecordSchema`와 같은 구분).
   - `schema?: Record<string, json>`은 `z.record(z.string(), z.json())`다. `runs.ts`의 같은 schema는 export가 아니라서 여기 한 줄을 따로 둔다.
   - 칸 사이 검사("`at`은 `every`가 `d` 단위일 때만")는 schema에 refine으로 두지 않는다. `sj-jobs-store`의 command가 본다. 이유: 같은 판정을 두 곳에 두지 않는다(`runs.ts`가 `startRunInputSchema`에 refine을 두지 않은 이유와 같다).
3. **`packages/protocol/jobs/jobs.ts`(새).** record schema(`jobRecordSchema`, `jobRunRecordSchema`), `jobTurnSchema`(`{job, job_run}`)와 type 별칭(`JobTurn`, `JobHold`, `QueuedJobRun`, `OpenJobRun`), 위 표의 route 열한 개, `JOB_ROUTES`를 둔다.
   - 변수 이름을 이 task가 정한다(다른 task가 import한다): `jobCreate`, `jobUpdate`, `jobDelete`, `jobList`, `jobRunList`, `jobHolds`, `jobDecideHold`, `jobClaimDue`, `jobRunOpen`, `jobRunStarted`, `jobRunEnded`. route `name`은 표의 `job.create` 꼴, `resource`·`method`는 표의 `jobs`·`create` 꼴이다(`^[a-z][a-z0-9_-]*$`).
   - command는 모두 `compare: z.strictObject({})`다. read 출력은 `withReadCommon`으로 감싼다(목록이 아닌 `job.holds`·`job_run.open`도 `next_cursor`는 null로 낸다).
   - errors는 공통 일곱 안에서 `runs.ts`의 같은 종류 route를 따른다. 근거: 오류 코드는 경계에서 일곱만 쓴다(AGENTS.md "코드").
4. **`packages/protocol/jobs/mod.ts`(새).** `export *`로 두 file을 내고 `export const ROUTES = [...JOB_ROUTES] as const;`(`protocol/runs/mod.ts` 꼴).
5. **`packages/protocol/events/transient.ts`.** `jobChanged = defineTransientEvent("JobChanged", { subject: idSchema("job"), payload: z.strictObject({ job_run: idSchema("jbr").nullable() }) })`를 더하고 `transientEventSchema`의 union 끝에 넣는다. 주석에 "job이나 job run이 바뀐 command가 commit된 뒤 낸다. 대기 목록과 job 화면이 다시 읽으라는 신호"를 `workflowInstanceChanged`처럼 쓴다.
6. **`packages/core/jobs/ports.ts`(새).** 위 "core port"를 그대로 쓴다. `definePort`는 `packages/protocol/base/ports.ts`에서 가져온다. `packages/base`의 `Clock`·`Result`와 protocol의 type만 import한다. 이유: 이 file은 writer·reader Worker와 wiring이 모두 싣는다(`architecture/layers.md` "실행 때 import가 뜻하는 것").
7. **`packages/core/jobs/mod.ts`.** `export * from "./ports.ts";` 하나만 둔다. 뒤 task(store, due, scheduler)는 `mod.ts`를 고치지 않고 file 경로로 import한다(`architecture/layers.md`: 다른 module을 `mod.ts`로만 import하는 규칙을 두지 않는다). lead가 합치며 필요하면 더한다.
8. **`tools/check-deps.ts`.** `CORE_FEATURES`에 `"jobs"`, `FEATURE_TOOL_PLACES`에 `"packages/core/jobs/agent-tools.ts"`를 더한다. 이유: jobs도 lophn-agent와 다른 feature module을 import하지 못하고, tool 정의 file이 DB 코드를 끌어오면 안 된다(`sj-jobs-tools`가 만든다).
9. 접점(program caller, run의 `job` 칸, `started_by`, wiring이 나누는 값)은 이 task가 코드로 만들지 않는다. 위 모양이 각 task의 brief "내놓는 것"과 글자까지 같은지 대조만 한다.

## 끝남

- `deno task check`가 통과한다. `z.toJSONSchema(jobActionInputSchema)`가 던지지 않는지 한 번 손으로 돌려 본다(test는 만들지 않는다. 뒤에 `packages/core/main/agent-tools_test.ts`가 tool 입력으로 지킨다). 모양이 틀리면 뒤 task의 type check가 잡으므로 이 task에 따로 test는 없다.
- 위험 test: 없음(모양은 schema가 지킨다).
- 남지 않음: `grep -rn "TODO" packages/protocol/jobs packages/core/jobs`가 0줄이다. `grep -n "Date.now\|setTimeout" packages/core/jobs/ports.ts`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것(lead):
  - `packages/protocol/mod.ts`: `export * as jobs from "./jobs/mod.ts"`, `import { ROUTES as jobsRoutes } from "./jobs/mod.ts"`, `ALL_ROUTES`의 `...workflowsRoutes` 뒤에 `...jobsRoutes`.
  - `packages/core/main/daemon/wiring/context.ts`: `Late`와 `LATE_KEYS`에 `runService`(`RunService`, `packages/core/runs/mod.ts`)와 `workflowService`(`ReturnType<typeof createWorkflowService>`, `packages/core/workflows/mod.ts`). 계약 wave와 함께, wave 2 전에 둔다. 채우는 쪽은 `sj-runs-job-origin`·`sj-workflows-job-start`, 읽는 쪽은 `sj-jobs-scheduler`다.
  - `packages/core/main/daemon/assembly.ts`는 `sj-jobs-store`(TEAMS·TEAM_MODULES)와 `sj-jobs-scheduler`(WIRINGS)의 보고를 따른다.
  - `project-docs/module-catalog.yaml`·`boundary-catalog.yaml`의 `jobs`는 lead가 이 task보다 먼저 둔다(README "lead가 할 일").
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: 남의 file을 최소로 맞춘 곳.
- 계약 바꾸기 요청: 계약의 이름·모양을 바꿔야 하면 고치지 말고 여기 적는다. 특히 route `name`·변수 이름, `JobRunRecord`의 칸, `JobSchedulerStore`·`JobStarter`의 모양.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음".
