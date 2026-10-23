# fl-contract

flow가 기댈 공용 모양을 `packages/protocol`(과 공용 port 둘)에 고정한다. 옛 모양은 옆에 두지 않고 고치고, 그 모양을 쓰던 곳은 `deno task check`가 통과할 만큼만 맞춘다(아래 "넘길 줄"). 이 task가 merge되기 전에는 다른 task를 띄우지 않는다.

- 단위: contract (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/workflows/values.ts`
  - `packages/protocol/workflows/instances.ts`
  - `packages/protocol/workflows/declaration.ts`
  - `packages/protocol/workflows/commands.ts`
  - `packages/protocol/workflows/routes.ts`
  - `packages/protocol/workflows/paths.ts`
  - `packages/protocol/workflows/mod.ts`
  - `packages/protocol/workflows/flow-wire.ts` (새 file)
  - `packages/protocol/runs/runs.ts`
  - `packages/protocol/apps/calls/caller.ts`
  - `packages/protocol/apps/calls/call.ts`
  - `packages/core/workflows/ports.ts`
  - `packages/core/runs/ports.ts`
  - `packages/core/main/daemon/wiring/context.ts`
- 추가 소유(넘길 줄 한정. check를 통과시키는 최소만 고치고 나머지는 뒤 wave의 owner가 끝낸다):
  - `packages/core/workflows/declaration.ts`
  - `packages/core/workflows/commands.ts`
  - `packages/core/main/daemon/wiring/workflows-files.ts`
  - `packages/core/runs/service.ts`
  - `packages/core/runs/store.ts`
  - `packages/core/runs/schema.ts`
  - `packages/core/main/daemon/wiring/runs.ts`
  - `packages/core/main/daemon/wiring/workflows.ts`
  - `packages/core/runs/store_test.ts`
  - `packages/shell/renderer/app-frame/app-detail/core-source.ts`
  - `packages/shell/renderer/conversation/agent-tab-core-source-rewind.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/workflow.md`("지키는 것"의 정의, instance와 줄), `project-docs/architecture/run.md`("시작"의 origin), `project-docs/architecture/app-call.md`(program caller, 손 사본 parser)
  - 계획: `project-docs/plan/flow/README.md`의 "정한 것" 전부
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `workflows`, `runs`, `apps`, `protocol`, `project-docs/module-catalog.yaml`의 `packages/protocol`, `packages/core/workflows`, `packages/core/runs`, `packages/core/main`
  - protocol 본보기: `packages/protocol/workflows/{values,instances,commands,routes,declaration,paths,mod}.ts`(고칠 곳), `packages/protocol/runs/runs.ts`(`startRunInputSchema`의 칸 모양을 `flow-wire.ts`의 agent·tool 요청이 그대로 쓴다), `packages/protocol/apps/calls/{caller,call}.ts`
  - core 쪽 소비자(넘길 줄에서 고칠 곳): `packages/core/workflows/{declaration,commands,service,rows,store}.ts`, `packages/core/runs/{service,store,schema,commands}.ts`, `packages/core/main/daemon/wiring/{workflows,workflows-files,runs}.ts`, `packages/core/apps/calls/caller.ts`(읽기만: 아래 "넘길 줄" 참고)
  - 확인해 둔 것(고칠 필요 없음):
    - `core/workflows/schema.ts`의 `workflow_lines.kind` CHECK는 `WORKFLOW_LINE_KINDS`로 만들어진다. `core/workflows/rows.ts`의 `lineColumns`·`lineFromRow`는 `step`이 null이어도, 모르는 칸이 있어도 그대로 돈다.
    - `core/main/daemon/core.ts`의 `memoryRouteMismatch`는 등록된 route(`allRoutes`)와 handler만 맞춰 본다. `WORKFLOW_ROUTES`에만 있는 `CheckWorkflow`는 기동을 막지 않는다(임시 handler가 필요 없다).
    - shell renderer의 workflow 쪽(`workspace/source.ts`, `core-source.ts`)은 `reply.value as ...` 로 읽는 자기 view type이라 protocol 변경에 컴파일이 깨지지 않는다. 화면 쪽은 `fl-shell`이 맞춘다.
- 계약:
  - 쓰는 것: 지금의 `packages/protocol/workflows/*`, `packages/protocol/runs/runs.ts`, `packages/protocol/apps/calls/caller.ts`.
  - 내놓는 것: 아래 "모양". 뒤 wave의 worker는 이 이름을 그대로 쓰고 바꾸지 않는다.

## 모양

workflow protocol (`packages/protocol/workflows`)
- `values.ts`: `WORKFLOW_LINE_KINDS`에 `program_exited`를 더한다. `FLOW_STEP_BY = "program"`을 내놓는다(flow instance의 step `by`. flow는 참가자가 없다).
- `paths.ts`: `WORKFLOW_FLOW_FILE = "flow.ts"`.
- `instances.ts`:
  - `lineBySchema`에 `{kind: "program"}`을 더한다.
  - `started` 줄의 `step`은 `stepNameSchema.nullable()`이다(flow는 null).
  - `lophn_restarted` 줄의 `step`은 `string | null`, `receiver`는 `Id<"ses"> | null`이다(flow는 둘 다 null).
  - 새 줄 `program_exited`: by `lophn`, 칸 `code: int | null`(신호로 죽으면 null), `stderr_tail: string`.
  - `workflowEntrySchema.problem.reason`은 `no_declaration | invalid_yaml | invalid_declaration | no_flow_file`이다(`not_agent`를 지운다). flow entry는 `kind: "flow"`, `startable`은 `flow.ts` 유무, `participants: null`, `steps`는 `[{name, by: FLOW_STEP_BY, with: null, next: []}]`이다.
- `declaration.ts`: flow 선언은 `kind: "flow"`와 비어 있지 않은 `steps`(key는 `stepNameSchema`, 값은 `z.unknown()`)뿐이다. `participants`와 step의 다른 칸은 읽지 않는다.
- `commands.ts`:
  - `CreateWorkflowInstance.input.handoff`는 `handoffPlanSchema.nullable()`(null이면 flow. `started` 줄 step이 null이고 넘기지 않는다). `output.handed`는 `handResultSchema.nullable()`.
  - `ApplyWorkflowChange`의 change에 둘을 더한다: `{kind: "program_exited", code: int | null, stderr_tail: string}`(줄을 남기고 `running`이면 `ended`로 닫는다. by lophn), `{kind: "flow_restarted"}`(`lophn_restarted` 줄(step null, receiver null)을 남기고 `running`이면 `ended`로 닫는다. by lophn).
  - `by: LineBy`에 `program`이 오면 report는 넘기지 않고 지금 step을 그 report의 step으로 바꾼다(`running`일 때만. 구현은 `fl-workflows`).
- `routes.ts`:
  - `StartWorkflow.output.handed`는 nullable.
  - 새 route `workflowCheck`: resource `workflows`, method `check`, name `CheckWorkflow`, input `{workflow: workflowKeySchema}`, output `{errors: string[]}`(비면 통과), actors `["agent"]`, errors는 `readErrors`와 같다. `WORKFLOW_ROUTES`에 넣는다.
- `flow-wire.ts`(새 file, `mod.ts`가 export): flow process와 core의 stdin·stdout JSON 줄 약속.
  - core → process: `flowStartMessageSchema = {type: "start", instance: Id<"wfi">, input: string}`(첫 줄). `flowResponseSchema = {type: "response", id: string, outcome: flowOutcomeSchema}`.
  - `flowOutcomeSchema = {ok: true, result: json} | {ok: false, reason: string, message: string}`. `reason`은 run의 `error.reason`, `"cancelled"`, 또는 경계 오류 코드(요청이 시작되지 못했을 때)다. 실패도 값이다.
  - process → core: `flowRequestSchema`는 `type`으로 가르는 합이다. `{type: "agent", id, agent: NamedAgent, prompt, input?, schema?}`, `{type: "tool", id, app, tool, input?}`, `{type: "report", id, step, text, next?}`(`text`와 `next`는 `workflowTextSchema`·`stepNextSchema`). `agent`·`tool`의 `result`는 run의 `result`, `report`의 `result`는 null이다.
  - 상수: `FLOW_SDK_NAME = "@lophn/flow"`, `FLOW_SDK_VERSION = "1.0.0"`, `FLOW_ENTRY_FILE = "entry.ts"`(SDK 설치 사본 안 lophn 진입 file).
  - 요청에는 instance가 없다. core가 그 process의 instance로 채운다.

run protocol (`packages/protocol/runs/runs.ts`)
- `runRecordSchema`와 `runCreate.input`에 `instance: idSchema("wfi").nullable()`을 `job` 옆에 더한다. job과 instance가 함께 값이면 틀린 기록이다(refine).

app call protocol (`packages/protocol/apps/calls/caller.ts`)
- `appToolCallerSchema`에 `z.strictObject({kind: "flow", instance: idSchema("wfi")})`를 더한다. 기존 `program`(job)은 그대로다. 그래서 `caller_kind`는 `flow`가 더해지고(`fl-runs`가 CHECK를 고친다), job의 호출 경로는 바뀌지 않는다. `call.ts`의 "program은 route의 actor가 아니다" 주석에 flow를 같이 적는다.

core 공용 type
- `packages/core/workflows/ports.ts`: `DefinitionFile`에 `flow: boolean`(`flow.ts` 유무). 새 port:
  - `WorkflowFlows = { launch(start: {instance: Id<"wfi">, project: Id<"prj">, workflow: string, input: string}): Promise<Result<void>>; stop(instance: Id<"wfi">): Promise<Result<void>> }`. `launch`가 err면 service가 `programExited`로 instance를 닫는다. `stop`은 process를 죽이고 그 instance가 연 run을 취소한다. process가 없으면 ok.
- `packages/core/runs/ports.ts`: `RunOrigin = JobOrigin | InstanceOrigin`. `JobOrigin`은 지금 모양 그대로(`job`, `job_run`, `creator`, `creator_place`). `InstanceOrigin = {instance: Id<"wfi">, creator: AgentRef, creator_place: Place | null}`(creator는 그 project의 PM). 합은 tag 없이 `job` 키와 `instance` 키로 가른다. `bs-jobs`가 소유한 `wiring/jobs.ts`를 건드리지 않으려는 것이다.
- `packages/core/main/daemon/wiring/context.ts`: `Late`에 `flowHost: WorkflowFlows`와 `LATE_KEYS` 줄.

뒤 task가 구현할 service 이름(이 task는 만들지 않는다, 이름만 고정)
- `WorkflowService.programExited(input: {instance: Id<"wfi">, code: number | null, stderr_tail: string}): Promise<Result<void>>` — `fl-workflows`.
- `RunService.cancelOfInstance(instance: Id<"wfi">): Promise<void>` — `fl-runs`.

## 할 일

순서는 아래대로 한다. 각 단계 뒤에 `deno check <고친 file>`로 컴파일러가 가리키는 곳을 먼저 보고, 마지막에 `deno task check`를 돈다. 주석은 "왜"만 쓴다. TODO와 작업 번호(`T12` 같은 것)는 `tools/check-source.ts`가 거절한다.

1. `packages/protocol/workflows/values.ts`: `WORKFLOW_LINE_KINDS` 끝에 `"program_exited"`를 더하고 `FLOW_STEP_BY = "program"`을 내놓는다(주석: flow instance의 step `by`. flow는 참가자가 없다). `paths.ts`: `WORKFLOW_FLOW_FILE = "flow.ts"`(이 file은 shell main이 import하므로 import를 두지 않는다. 상수만).
2. `packages/protocol/workflows/instances.ts`:
   - `lineBySchema`에 `z.strictObject({kind: z.literal("program")})`.
   - `workflowLineSchema`의 `started`는 `step: stepNameSchema.nullable()`, `lophn_restarted`는 `step: z.string().nullable()`, `receiver: idSchema("ses").nullable()`. 새 줄 `line("program_exited", lophnBy, {code: z.number().int().nullable(), stderr_tail: z.string()})`.
   - `workflowEntrySchema.problem.reason`의 enum에서 `not_agent`를 지우고 `no_flow_file`을 더한다. 기존 `.refine`(problem이 있으면 startable이 아님)은 그대로 맞는다.
3. `packages/protocol/workflows/declaration.ts`: flow 갈래를 `z.looseObject({kind: z.literal("flow"), steps: z.record(stepNameSchema, z.unknown()).refine(비어 있지 않음)})`로 바꾼다. agent 갈래의 "steps needs at least one step" 검사를 상수나 함수 하나로 묶어 두 갈래가 같이 쓴다. `participants`와 step의 다른 칸은 읽지 않는다(`looseObject`가 지나가게 둔다). 근거: README "선언".
4. `packages/protocol/workflows/commands.ts`: `workflowInstanceCreate`의 `input.handoff`는 `handoffPlanSchema.nullable()`, `output.handed`는 `handResultSchema.nullable()`. `changeSchema`에 `{kind: "program_exited", code: int|null, stderr_tail: string}`와 `{kind: "flow_restarted"}`를 더한다(위 `lophn_restarted` 주석처럼 누가 언제 부르는지 한 줄). `routes.ts`: `workflowStart.output.handed`를 nullable로, `workflowCheck`(`defineMemory`, resource `workflows`, method `check`, name `CheckWorkflow`, input `z.strictObject({workflow: workflowKeySchema})`, output `z.object({errors: z.array(z.string())})`, actors `["agent"]`, errors `[...readErrors]`)를 더하고 `WORKFLOW_ROUTES`에 넣는다.
5. `packages/protocol/workflows/flow-wire.ts`(새 file)와 `mod.ts`의 `export * from "./flow-wire.ts"`: 위 "모양"의 schema·상수 그대로.
   - `agent` 요청의 `prompt`·`input`·`schema`와 `tool` 요청의 `app`·`tool`·`input`은 `runs.ts`의 `startRunInputSchema`와 같은 칸 모양을 쓴다(`z.string().min(1)`, `jsonValueSchema.optional()`, `z.record(z.string(), z.json()).optional()`, `toolNameSchema`). `outputSchemaSchema`는 runs.ts의 비공개 const라 새로 한 줄 쓴다. agent 요청에는 `session`이 없다(flow는 session을 이어 쓰지 않는다).
   - `FLOW_SDK_VERSION = "1.0.0"`은 `fl-sdk`가 만드는 `packages/sdk/flow/deno.json`의 `version`과 같아야 한다. 주석에 적는다.
   - 요청마다 `id: z.string().min(1)`이고 응답이 같은 `id`를 되돌린다.
6. `packages/protocol/runs/runs.ts`: `runRecordSchema`와 `runCreate.input`에 `instance: idSchema("wfi").nullable()`을 `job` 바로 아래 더하고, 둘 다에 `(v) => v.job === null || v.instance === null` refine("a run has a job or an instance, not both")을 더한다. `packages/protocol/apps/calls/caller.ts`: `appToolCallerSchema`에 `z.strictObject({kind: z.literal("flow"), instance: idSchema("wfi")})`를 program 아래 더한다. `call.ts`의 "program은 route의 actor가 아니고…" 주석에 flow를 같이 적는다. 근거: `architecture/app-call.md`의 program caller 절. flow caller의 판정은 `fl-runs`가 쓴다.
7. `packages/core/workflows/ports.ts`: `DefinitionFile.flow: boolean`과 `WorkflowFlows`. `packages/core/runs/ports.ts`: `JobOrigin`(지금 `RunOrigin`의 모양 그대로), `InstanceOrigin`, `RunOrigin = JobOrigin | InstanceOrigin`을 내놓고 `RunTools.call`·`RunService.start`가 쓰는 `RunOrigin`은 합이 된다(주석: tag 없이 `job` 키와 `instance` 키로 가른다. 이유는 모양 절). `packages/core/main/daemon/wiring/context.ts`: `Late.flowHost`, `LATE_KEYS.flowHost`. 타입은 `../../../workflows/ports.ts`에서 가져온다(`workflows/mod.ts`는 `fl-workflows` 소유라 export를 더하지 않는다). 주석: flows wiring이 낸다. workflows wiring이 먼저 만들어지므로 부를 때 읽는다.
8. "넘길 줄"을 맞추고 `deno task check`를 통과시킨다. `deno fmt`로 고친 file을 정리한다.

## 넘길 줄

check를 통과시키려고 최소로 고치는 곳이다. 뒤 wave의 owner가 이 줄들을 진짜 구현으로 바꾼다. 임시 줄의 글은 아래 그대로 쓴다(뒤 task의 "남지 않음" grep이 이 글을 찾는다). `fl-workflows`가 찾는 "not supported yet"과 `fl-runs`가 찾는 "not wired yet"이 서로 안 겹친다.

| file | 고칠 것 | 바꿀 task |
|---|---|---|
| `core/workflows/declaration.ts` | `entryOf`의 flow 갈래: `startable: file.flow`, `problem: file.flow ? null : {reason: "no_flow_file", message: "flow.ts is missing"}`, `steps: Object.keys(declaration.steps).map((name) => ({name, by: FLOW_STEP_BY, with: null, next: []}))`. `service.start`는 `parsed.declaration.kind !== "agent"`로 flow를 계속 거절하므로 손대지 않는다(`problem`이 null이면 "workflow cannot be started"로 간다) | `fl-workflows` |
| `core/workflows/commands.ts` | `create`: `started` 줄의 `step: input.handoff?.step ?? null`, `handed`는 `input.handoff === null ? ok(null) : handOff(...)`. `apply`의 `switch`에 `program_exited`·`flow_restarted` case를 더해 `return fail("conflict", "not supported yet")` | `fl-workflows` |
| `core/main/daemon/wiring/workflows-files.ts` | `files.push({... flow: await isFile(`${workflowFolder(dataRoot, project, name)}/${WORKFLOW_FLOW_FILE}`)})`. 이건 진짜 구현이다 | (끝) |
| `core/main/daemon/wiring/workflows.ts` (소유에 없음) | `withStepText.prepare`의 create 갈래: `handoff: raw.handoff === null ? null : safeHandoff(raw.handoff)`. 안 고치면 nullable `handoff`가 `safeHandoff`에서 컴파일이 깨진다 | `fl-workflows`가 `flows` 배선과 함께 본다 |
| `core/runs/schema.ts` | `runs.tables` step에 `instance TEXT`를 `job` 아래 더한다(migration 없음, 주석의 "job은…" 줄 옆에 instance 설명) | (끝) |
| `core/runs/store.ts` | `runFromRow`에 `instance: row.instance`, `insertRun` 입력에 `instance: string \| null`을 더하고 INSERT의 칸·`?`·값을 하나 늘린다(`?` 개수를 세어 맞춘다) | (끝) |
| `core/runs/store_test.ts` (소유에 없음, `fl-runs` 소유) | `insertRun` 호출에 `instance: null` 한 줄 | (끝) |
| `core/runs/service.ts` | `originColumns(origin: RunOrigin \| undefined): {job: Id<"job"> \| null; instance: Id<"wfi"> \| null}`(`"job" in origin`, `"instance" in origin`으로 가른다) 한 함수를 만들고 `startAgent`·`startTool`의 `store.create`가 `...originColumns(origin)`을 쓴다. `callTool`은 origin을 그대로 넘긴다 | `fl-runs`가 `cancelOfInstance`와 같이 확인 |
| `core/main/daemon/wiring/runs.ts` | `tools.call`: 맨 앞에 `if (origin !== undefined && "instance" in origin) return Promise.resolve(err({code: "unavailable" as const, message: "flow tool calls are not wired yet"}))`. 그 아래 삼항(`origin === undefined ? person : program`)은 `JobOrigin`으로 좁혀져 그대로 컴파일된다 | `fl-runs` |
| `core/apps/calls/caller.ts` | 고칠 것 없음. `verifyCaller`의 `KIND_OF_ACTOR[auth.actor] !== caller.kind` 비교가 `caller.kind`에서 `flow`를 걸러 내서 아래 `caller.app`이 그대로 컴파일된다. flow 본문은 어떤 credential로도 "caller kind does not match the credential" `forbidden`이 된다. 임시 줄을 넣지 않는다 | `fl-runs`가 flow 갈래를 쓴다 |
| `shell/renderer/app-frame/app-detail/core-source.ts` | `callerOf`의 `switch`: `case "program":` 옆에 `case "flow":`를 같이 두어 `{kind: "program"}` | `fl-shell`이 flow 갈래를 따로 둔다("Workflow" 문구) |
| `shell/renderer/conversation/agent-tab-core-source-rewind.ts` (소유에 없음) | `callerName`: `caller.kind === "program"`을 `caller.kind === "program" \|\| caller.kind === "flow"`로. 안 고치면 아래 `caller.app`이 깨진다 | `fl-shell`이 flow 갈래를 따로 둔다("Workflow" 문구) |

- 위 밖에 컴파일러가 가리키는 곳이 있으면 같은 식으로 최소만 고치고 보고에 적는다. "소유에 없음"으로 표시한 세 곳(`wiring/workflows.ts`, `runs/store_test.ts`, `agent-tab-core-source-rewind.ts`)은 계약이 바뀌면 같이 깨지는 곳이라 이 task가 고친다(보고에 적는다).
- 모양을 쓰던 test와 fake: `core/workflows/commands_test.ts`와 `core/runs/service_test.ts`는 `handoff`·`handed`가 넓어지기만 하고 `RunStore` fake는 입력을 그대로 펼쳐서 고칠 것이 없다. 컴파일이 가리키면 같이 맞춘다.
- 이 계약 하나로 `deno task check`가 통과하는지 brief를 쓸 때 repo 밖 복사본(protocol·core·coding-agent·sdk·shell renderer·tools·tests의 `deno check` 전부, `check-deps`, `check-source`, workflows·runs·apps/calls·invocations·protocol test)에 위 변경을 해 보고 확인했다. 컴파일러가 가리킨 곳은 표의 `workflows-files`, `workflows`, `runs`, `shell` 두 곳이 전부였고, `caller.ts`는 임시 줄이 필요 없었다. 표 밖에서 더 가리키면 같은 식으로 고치고 보고에 적는다.

## 끝남

- `deno task check`가 통과한다. 기동(`deno task dev`, `lead/boot.sh`)은 막히지 않는다(`CheckWorkflow`는 등록되지 않은 route라 `memoryRouteMismatch`에 걸리지 않는다. 막히면 원인을 보고에 적고 임시 handler를 두지 말고 멈춘다).
- 위험 test: 없음 (계획의 위험 test 넷은 뒤 task가 소유한다).
- 남지 않음: `grep -rn "not_agent" packages/protocol packages/core`가 0줄이다. `packages/shell/renderer/workspace/fake-source.ts`의 `reason: "not_agent"`는 `string` 칸이라 컴파일이 되고 `fl-shell`이 지운다(이 task가 건드리지 않는다).
- 남지 않음: `grep -rn "WorkflowFlows" packages`에서 `workflows/ports.ts`(정의)와 `wiring/context.ts` 말고 쓰는 곳이 없다(쓰는 쪽은 뒤 task).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음. `protocol/workflows/mod.ts`의 `flow-wire.ts` export는 이 task가 직접 하고 `protocol/mod.ts`는 `export *`라 손댈 것이 없다. `CheckWorkflow`의 `memoryRoutes`·handler·`workflow.check` tool·role tool 목록은 `fl-check`와 lead의 몫이다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상. `not_agent`는 값이라 지웠다.
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 위 표에서 실제로 고친 곳과 표 밖에서 더 고친 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 이 task 뒤에도 안 되는 것을 그대로 적는다. 예상: flow는 시작되지 않는다(`fl-workflows`), flow 앱 tool 호출은 `forbidden`·`unavailable`이다(`fl-runs`), invocation의 `caller_kind` CHECK는 아직 `flow`를 모른다(`fl-runs`), app 활동 화면과 session rewind 목록이 flow 호출을 "Scheduled job"으로 보인다(문구를 새로 만들지 않았다. `fl-shell`이 flow 갈래와 "Workflow" 문구를 더한다).
