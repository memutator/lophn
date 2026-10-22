# wf-contract

workflow의 protocol 값, route, 기록 command, 남지 않는 event, core 안 port를 고정한다. 다른 task가 기대는 이름과 모양이 여기서 정해진다.

- 단위: workflows (wave 1)
- 선행: 없음
- 소유(이 task만 고친다):
  - `packages/protocol/workflows/mod.ts`(새 file)
  - `packages/protocol/workflows/paths.ts`(새 file)
  - `packages/protocol/workflows/values.ts`(새 file)
  - `packages/protocol/workflows/declaration.ts`(새 file)
  - `packages/protocol/workflows/instances.ts`(새 file)
  - `packages/protocol/workflows/routes.ts`(새 file)
  - `packages/protocol/workflows/commands.ts`(새 file)
  - `packages/protocol/base/ids.ts`
  - `packages/protocol/events/transient.ts`
  - `packages/core/workflows/ports.ts`(새 file)
  - `packages/core/workflows/mod.ts`(lead가 빈 file로 먼저 둔다)
  - `tools/check-deps.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/run.md`(본보기: 기록 한 행, route, 켤 때), `project-docs/architecture/agent-call.md`("지키는 것"의 보낸 쪽 program과 unattended), `project-docs/architecture/event.md`(남지 않는 event), `project-docs/architecture/layers.md`(feature module과 port)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `runs`, `project-docs/module-catalog.yaml`의 `packages/core/runs`(본보기). `workflows` 줄은 lead가 이 task보다 먼저 등록해 둔다.
  - 제품 결정: 계획 README의 "정한 것", roadmap `project-docs/products/roadmap/workflow.md`의 "원칙", "instance와 report", "instance 고치기"
  - 본보기 코드: `packages/protocol/runs/runs.ts`(record schema는 `z.object`, 입력은 `z.strictObject`, `refine`으로 칸 짝 검사, `defineMemory`·`defineRead`·`defineCommand` 꼴), `packages/protocol/events/transient.ts`(`defineTransientEvent`), `packages/core/runs/ports.ts`(port 꼴)
- 계약:
  - 쓰는 것: `packages/protocol/runs/runs.ts`(본보기), `packages/protocol/base/route.ts`(`defineMemory`, `defineRead`, `defineCommand`), `packages/protocol/lophn-agent/calls.ts`(`CallToInput`, `NamedAgent`), `packages/protocol/domains/paths.ts`(import 없는 paths file의 본보기)
  - 내놓는 것: 아래 전부. 이 task는 모양만 정한다. 입력 종류 `step`의 protocol 모양은 `wf-step-input`이 고친다(아래 "step 입력").

## 계약

### 정한 것 (이 task가 정한다)

- **workflow의 신원은 `(project id, workflow name)`이다.** 표, instance 행, artifact root, event, 화면 목록이 모두 이 둘로 가리킨다. project는 이름을 바꿀 수 있어서(`project.update`) 이름은 저장하지 않는다.
- **`<project 이름>/<name>`(`workflowKey`)은 사람과 agent가 보는 이름일 뿐이다.** CLI 인자와 tool 입력에서 받고, 호출이 도착할 때 project id로 푼다(Router가 `{project: 이름}`을 푸는 것과 같다). 저장하지 않는다. 풀리지 않으면 `not_found`다.
- 화면 목록 읽기(`ListWorkflows`)의 entry는 `project`(id)와 `name`을 싣는다. `workflow-shell`이 title bar selector와 자리 key로 쓴다. `key`는 그 순간 project 이름으로 만든 보이는 글이다.
- 선언을 읽는 코드는 형식만 본다. `by`·`with`·`next`가 가리키는 이름이 있는지는 읽을 때 검사하지 않는다. 그런 틀림은 넘길 때 "넘기지 못함" 줄이 된다(README).
- instance 상태는 `running | ended | stopped`다.
  - `ended`는 누가 그렇게 말했다는 기록일 뿐이다(README "끝"). `ended`인 instance에 온 report나 고치기가 실제로 넘기면(`handed`) 상태가 다시 `running`이 되고 `finished_at`이 비워진다. 넘기지 못했거나(`not_handed`) 넘기지 않는 고치기(step 더하기·고치기·지우기, `end`)면 `ended` 그대로다.
  - `stopped`(사람이 멈춤)만 넘기지 않고 `EditWorkflow`·`StopWorkflow`를 `conflict`로 거절한다. `ReportWorkflow`는 `stopped`에서도 줄로 남기되 넘기지 않는다(`handed: null`). 근거: 늦게 온 report를 잃지 않고, 멈춘 instance에는 넘기지 않는다.
  - `StopWorkflow`는 `running`과 `ended`에서 받는다. `finished_at`은 `ended`·`stopped`면 있고 `running`이면 null이다.
- 참가자 `place` 기본값: `project_manager`와 `operator`는 `place`가 없으면 instance의 project, `app_engineer`는 `place`가 꼭 있어야 한다(없으면 `unresolved`). 이 풀이는 `wf-service`가 한다.

### id

- `packages/protocol/base/ids.ts`에 `wfi: "WorkflowInstance"`를 더한다.

### 값 (`values.ts`, `declaration.ts`)

- `WORKFLOW_ROLES = ["lophn","project_manager","app_engineer","operator","human","harness"]`, `workflowRoleSchema`.
- `workflowNameSchema`: slug(`^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, 63자 이하).
- `workflowKeySchema`: `<project 이름>/<name>` 글. `/`가 정확히 하나고 `<name>`이 `workflowNameSchema`다.
- `stepNameSchema`: `^[a-z][a-z0-9_-]*$`, 63자 이하, `end`는 예약이라 step 이름이 될 수 없다. `STEP_END = "end"`.
- `participantKeySchema`: 선언 `participants`의 키(1-63자 글).
- `participantSchema`: `{ role, place?: {project: string} | {app: string}, name?: string }`.
- `SESSION_CHOICES = ["new","same"]`.
- `WORKFLOW_TEXT_MAX_BYTES = 8192`, `workflowTextSchema`: 글 하나(`min 1`)의 UTF-8 길이가 8 KiB 이하다. `ReportWorkflow.text`와 `hand_now`의 `text`가 쓴다. 넘으면 `invalid_input`이다.
- `WORKFLOW_STATES = ["running","ended","stopped"]`, `WORKFLOW_LINE_KINDS`(줄 표의 kind 여덟). `wf-store`의 CHECK가 이 상수를 import한다(runs의 `RUN_STATES` 꼴).
- `workflowDeclarationSchema`(lophn이 읽는 칸만, 나머지 칸은 `z.looseObject`로 두고 읽지 않는다): `kind: "agent" | "flow"`. `agent`는 `participants: Record<participantKey, participant>`, `steps: Record<stepName, {by, with?, prompt, in?, out?, next?}>`가 꼭 있고(`next` 안은 stepName 또는 `end`), `flow`는 `kind`만 꼭 있다. 첫 step은 `steps`의 첫 key다.

### instance와 줄 (`instances.ts`)

```
InstanceStep    = { name, by: participantKey, with: participantKey | null,
                    prompt: string, in: string, out: string, next: string[] }   // in·out은 없으면 "", next 안은 stepName | "end"
LineBy          = { kind: "user" } | { kind: "agent", session: ses } | { kind: "lophn" }
WorkflowInstance = { id: wfi, project: prj, workflow: workflowName, input: string,
                    state: "running" | "ended" | "stopped",
                    participants: Record<participantKey, participant>,   // 시작할 때 선언에서 옮긴 것
                    steps: InstanceStep[],                               // 순서 있음. agent가 고친다
                    current: { step: stepName, human_turn: boolean } | null,
                    started_by: LineBy, created_at, finished_at | null, state_seq }
```

줄(`WorkflowLine`)은 `{ instance, seq(1부터 instance 안에서 이어 센다), at, by: LineBy }`에 `kind`별 칸을 더한 합이다.

| kind | 칸 | by |
|---|---|---|
| `started` | `step`, `text`(시작 입력) | user |
| `report` | `step`, `text`, `next: stepName \| "end" \| null`, `session: "new" \| "same"` | 낸 쪽 |
| `edit` | `op: "add_step" \| "update_step" \| "remove_step" \| "end" \| "hand_now"`, `step: string \| null`, `detail`(고친 입력 그대로, JSON) | 고친 쪽 |
| `handed` | `step`, `participant`(메시지를 받은 agent의 참가자 key. 사람 step이면 `with`의 key), `receiver: ses`, `human_turn: boolean`, `cause: "start" \| "report" \| "edit"`, `session: "new" \| "same" \| null` | lophn |
| `not_handed` | `step: string`, `reason: "unknown_step" \| "unknown_participant" \| "harness" \| "no_with" \| "unresolved"`, `message` | lophn |
| `ended` | (없음) | lophn |
| `stopped` | (없음) | user |
| `lophn_restarted` | `step`, `receiver: ses`(그 step 메시지를 받은 session) | lophn |

- `lophn_restarted`는 lophn이 꺼졌다 켜질 때 넘긴 step 메시지가 turn에 가져가지 않았거나 restart로 끊긴 것을 남기는 줄이다(README "lophn이 꺼졌다 켜졌을 때"). 상태와 `current`를 바꾸지 않는다. 다시 넘기는 일은 agent나 사람의 `hand_now`다.
- `WorkflowEntry`(정의 목록의 한 줄): `{ key, project: prj, name, state: "ok" | "invalid", kind: "agent" | "flow" | null, startable: boolean, problem: { reason: "no_declaration" | "invalid_yaml" | "invalid_declaration" | "not_agent", message } | null, participants: Record<key, participant> | null, steps: { name, by, with: string | null, next: string[] }[] | null, artifacts: { static: boolean, instance: boolean } }`. `problem`은 `startable`이 false일 때만 있다. `kind`가 `flow`면 `state: "ok"`, `startable: false`, `problem.reason: "not_agent"`.
- `WorkflowInstanceSummary`(목록 한 줄): `{ id, project, workflow, state, current, input, created_at, finished_at, last_line: WorkflowLine | null }`.
- `HandResult`: `{ step, outcome: "handed", receiver: ses, human_turn } | { step, outcome: "not_handed", reason, message }`.
- `NotHandedReason`: 위 `not_handed.reason`의 값.

### route (`routes.ts`, 이름은 PascalCase)

memory route는 resource `workflows`, 읽기 route는 resource `workflow_instances`다.

| route | 종류 | 입력 | 출력 | actors |
|---|---|---|---|---|
| `ListWorkflows` `workflows/list` | memory | `{ project?: string }`(prj id 또는 project 이름. agent가 project place에 있으면 생략 가능) | `{ workflows: WorkflowEntry[] }` | user, agent |
| `StartWorkflow` `workflows/start` | memory | `{ workflow: workflowKey, text: string(min 1), step?: stepName }` | `{ instance: WorkflowInstance, handed: HandResult }` | user |
| `ReportWorkflow` `workflows/report` | memory | `{ instance: wfi, step: stepName, text: workflowTextSchema(1~8 KiB), next?: stepName \| "end", session?: "new" \| "same" }` | `{ line: seq, handed: HandResult \| null }` | user, agent |
| `EditWorkflow` `workflows/edit` | memory | `{ instance: wfi } & WorkflowEdit`(아래, `op`로 가르는 평평한 합) | `{ line: seq, handed: HandResult \| null }` | user, agent |
| `StopWorkflow` `workflows/stop` | memory | `{ instance: wfi }` | `{ instance: WorkflowInstance }` | user |
| `ReadWorkflowInstance` `workflow_instances/read` | read | `{ instance: wfi, cursor?: readCursor }` | `withReadCommon({ instance, last_reports: Record<stepName, ReportLine>, lines: WorkflowLine[], next_cursor })` | user, agent, machine |
| `ListWorkflowInstances` `workflow_instances/list` | read | `{ project: prj, workflow?: workflowName, state?, cursor? }` | `withReadCommon({ instances: WorkflowInstanceSummary[] })`, 새것이 앞, 50개씩 | user, agent |

- `WorkflowEdit`(`op`로 가르는 합): `{op:"add_step", step: {name, by, with?, prompt, in?, out?, next?}, after?: stepName}`, `{op:"update_step", name, patch: {by?, with?: key \| null, prompt?, in?, out?, next?}}`, `{op:"remove_step", name}`, `{op:"end"}`, `{op:"hand_now", step: stepName, text?: workflowTextSchema, session?: "new" \| "same"}`. 이름이 겹치는 add는 `conflict`, 없는 name의 update·remove는 `not_found`다. 가리키는 이름이 있는지는 보지 않는다.
- `ReadWorkflowInstance`만 `machine`도 받는다. 이유: core 안 service(`wf-service`)가 상태를 읽어 plan을 만든다(`ListReceivedMessages`가 machine을 받는 것과 같다).
- `ReportWorkflow`·`EditWorkflow`의 `handed`는 넘기지 않았을 때 null이다: `next`가 없거나 `end`인 report, 넘기지 않는 고치기, `stopped`인 instance의 report. `line`은 report·edit 줄의 seq다(뒤따르는 `handed`·`ended` 줄이 아니다).
- `last_reports`는 step마다 가장 큰 seq의 `report` 줄이다. 화면과 artifact가 줄을 다 읽지 않아도 step 옆 글을 그리게 하려는 것이다. `lines`는 seq 오름차순 200개씩이다.
- **report 글은 짧은 메모다. `ReportWorkflow.text`와 `hand_now`의 `text`는 8 KiB(UTF-8) 이하다.** 더 긴 내용은 file에 두고 경로를 글에 적는다. 이유: 이 글은 다음 step 메시지 본문에 그대로 실리고 화면과 artifact가 줄마다 읽는다. 시작 입력(`StartWorkflow.text`)에는 이 한도를 두지 않는다.
- 오류 코드는 일곱 가운데서만 쓴다. `StartWorkflow`는 key나 project가 안 풀리면 `not_found`, 시작할 수 없는 workflow(`startable: false`)는 `conflict`, 없는 `step`은 `not_found`다.

### 기록 command (core 안, machine만 부른다)

resource `workflow_instances`, actors `["machine"]`.

- `CreateWorkflowInstance` `workflow_instances/create`: `{ id: wfi, project: prj, workflow: workflowName, input, participants, steps: InstanceStep[], started_by: LineBy, handoff: HandoffPlan }`. 출력 `{ instance, handed: HandResult }`.
- `ApplyWorkflowChange` `workflow_instances/apply`: `{ instance: wfi, change, by: LineBy, handoff: HandoffPlan | null }`, `compare: { state_seq }`. 출력 `{ instance, line: seq, handed: HandResult | null }`. `change`는 `{kind:"report", step, text, next, session}` | `{kind:"edit", edit: WorkflowEdit}` | `{kind:"stop"}` | `{kind:"lophn_restarted", step, receiver: ses}`다. 마지막은 켤 때 `wf-service`가 `by: {kind:"lophn"}`, `handoff: null`로 부른다.
- `HandoffPlan`: `{ step: string, participant: participantKey | null, human_turn: boolean, cause: "start" | "report" | "edit", session: "new" | "same" | null, delivery: { to: CallToInput, body: string } | null, unresolved: { reason: NotHandedReason, message: string } | null }`. `delivery`와 `unresolved`는 정확히 하나가 있다. 이유: step 메시지 본문은 blob이라 tx 안에서 만들 수 없다. 본문과 받는 곳은 command 앞(`wf-service`)이 정하고 command는 그대로 Router에 넣는다. 본문이 다 정해진 채로 오므로 command는 상태를 읽어 글을 만들지 않는다.
- command는 같은 tx에서 상태를 바꾸고, 줄을 남기고, `delivery`가 있으면 Router로 넣고, 결과를 `handed`나 `not_handed` 줄로 남긴다. commit 뒤 event를 낸다(아래).
- Router가 `ok`로 돌려주는 `RouteResult.state`는 `done`(전달됨, `reply: none`), `accepted`(입력함에 쌓임), `failed`(배달 실패)다. 앞의 둘은 `handed` 줄이고 `failed`는 `not_handed` 줄이 되며 command는 성공이다. Router가 `err`를 돌려주면 tx 전체가 되돌아가고 command가 그 오류를 그대로 돌려준다. 줄도 상태도 반쪽만 남지 않는다(ledger는 handler가 `err`를 돌려주면 tx를 통째로 rollback하고 savepoint가 없다).

### 남지 않는 event (`transient.ts`)

- `WorkflowInstanceChanged`: subject `idSchema("wfi")`, payload `{ project: prj, workflow: workflowName }`. 화면과 artifact view가 다시 읽는 신호다. instance 행이나 줄이 바뀐 command(`CreateWorkflowInstance`, `ApplyWorkflowChange`)가 commit된 뒤 한 번 낸다. 정의 file이 바뀐 것은 알리지 않는다(목록은 화면이 열릴 때 다시 읽는다). 이유: CLI로 낸 report는 session event가 없어(`run.md`) 화면이 알 길이 이것뿐이다. 정본은 표이고 놓친 화면은 다시 읽는다(`event.md`).
- 받는 쪽: shell main(artifact view reload, `wf-artifact-serve`)과 renderer(`wf-screen-source`)가 `{ types: ["WorkflowInstanceChanged"] }` 조건으로 건다.

### paths (`paths.ts`, 가져오는 것 없음)

shell main이 import하므로 import를 두지 않는다. `workflowsFolder(dataRoot, project)` = `<data>/projects/<prj>/workflows`, `workflowFolder(dataRoot, project, name)`, `workflowArtifactFolder(dataRoot, project, name, view: "static" | "instance")` = `<workflowFolder>/artifacts/<view>`, 상수 `WORKFLOW_DECLARATION_FILE = "workflow.yaml"`, `WORKFLOW_DOC_FILE = "workflow.md"`, `WORKFLOW_ARTIFACT_ENTRY = "index.html"`.

### step 입력 (모양만. 구현은 `wf-step-input`)

- 입력 종류 `step`을 `RoutedInputKind`에 더한다. 보낸 쪽은 `{ kind: "program" }`이고 unattended 표시를 싣는다.
- tag: `INPUT_TAGS.step = "lophn-step"`, 속성 `instance`, `step`.
- 받은 봉투에 `step: { instance: wfi, step: stepName } | null`이 더해진다.
- 본문 글은 `wf-service`가 만든다. 고정 영어 label로 줄을 이은 글이다: `{prompt}` 빈 줄 `Receives: {in}` `Received:` `{받은 글}` `Produces: {out}` `Next candidates: {next를 쉼표로}`. `in`·`out`·`next`가 비면 그 줄을 뺀다. 받은 글은 report의 `text`(시작이면 시작 입력, `hand_now`면 `text` 또는 마지막 report 글 또는 시작 입력)다. `workflow.md`와 다른 step은 싣지 않는다.

### agent tool (구현은 `wf-agent-tools`, 모든 role이 받는다)

| tool | route | effect | 입력 |
|---|---|---|---|
| `workflow.list` | `ListWorkflows` | read | `{ project?: string }` |
| `workflow.get` | `ReadWorkflowInstance` | read | `{ instance: wfi }` |
| `workflow.report` | `ReportWorkflow` | write | `ReportWorkflow` 입력 그대로 |
| `workflow.edit` | `EditWorkflow` | write | `EditWorkflow` 입력 그대로 |

시작하는 tool은 없다.

### core port (`packages/core/workflows/ports.ts`)

runs의 `ports.ts`와 같은 꼴이다(메서드는 모두 `Promise<Result<…>>`). 구현은 wiring(`wf-service`, `wf-decl-reader`)이 끼운다.

- `DefinitionFile = { name, declaration: string | null, artifacts: {static, instance} }`.
- `WorkflowFiles.list(project)`: `DefinitionFile[]`(workflows 폴더의 하위 폴더마다).
- `WorkflowProjects.resolve(ref)`: prj id 또는 project 이름 → `{ id, name }`(`not_found`, 이름이 여럿이면 `invalid_input`). `nameOf(id)`.
- `WorkflowTurns.stopSession(session)`: 그 session에서 도는 turn이 있으면 멈춘다. 이미 끝났으면 ok.
- `WorkflowTurns.stepTurn(session, instance, step)`: 그 session이 받은 이 instance·step의 step 메시지 가운데 가장 나중 것의 turn을 돌려준다. `null`이면 그런 메시지가 없다. 있으면 `{ turn: trn | null, state: "running" | "finished" | null, outcome: TurnOutcome | null }`(`turn`이 null이면 아직 가져가지 않았다). 켤 때 `lophn_restarted`를 정하는 데 쓴다.
- `WorkflowStore`: `create(input)`, `apply(input, compare)`(두 command를 machine 자격으로 부른다), `read(instance)`(`ReadWorkflowInstance` 전체 줄), `running()`(모든 project의 `running` instance).

### 그 밖

- `tools/check-deps.ts`의 `CORE_FEATURES`에 `"workflows"`를 더한다(`schedule-job`의 `jobs` 줄과 부딪히면 둘 다 남긴다).
- lead가 하는 등록: `packages/protocol/mod.ts`의 export와 `ALL_ROUTES`, `project-docs/module-catalog.yaml`·`boundary-catalog.yaml` 줄, `packages/core/workflows/mod.ts`의 export, `packages/core/main/daemon/assembly.ts`.

## 할 일

1. **id.** `packages/protocol/base/ids.ts`의 `ID_PREFIXES`에 `wfi: "WorkflowInstance"`를 더한다. 이유: 이 id를 `idSchema("wfi")`로 쓰는 task가 여럿이다. `sj-jobs-contract`도 이 file에 한 줄을 더하므로 한 줄만 더하고 다른 줄은 건드리지 않는다(lead가 rebase 때 둘 다 남긴다).
2. **`paths.ts`.** import 없이 상수와 함수만 쓴다: `WORKFLOWS_FOLDER = "workflows"`, 계약의 `workflowsFolder`·`workflowFolder`·`workflowArtifactFolder`와 세 상수. 이유: shell main이 import하는 file이라 zod를 끌어오면 안 된다(`protocol/domains/paths.ts`와 같다). `<data>/projects/<prj>`는 Operator 정의 `agents/`가 사는 자리와 같다(`packages/core/agent-roles/place/data-folder.ts`).
3. **`values.ts`.** 계약 "값"절의 role, slug, key, step 이름, `STEP_END`, `participantSchema`(strict), `SESSION_CHOICES`, `WORKFLOW_TEXT_MAX_BYTES`·`workflowTextSchema`(`TextEncoder`로 센 byte 길이를 `refine`으로 본다), `WORKFLOW_STATES`, `WORKFLOW_LINE_KINDS`를 만든다. 이유: `declaration.ts`와 `instances.ts`가 같은 값을 import하고, 한도는 route·`workflowEditSchema`가 같은 값 하나를 쓴다.
4. **`declaration.ts`.** `workflowDeclarationSchema`는 `kind`로 가르는 합이다. 각 객체(참가자, step 포함)는 `z.looseObject`라 모르는 칸을 틀렸다고 하지 않는다(참가자는 `participantSchema.shape`로 만든다). `agent`는 `participants`와 `steps`가 꼭 있고 `steps`는 key가 하나 이상이다(`refine`). 이유: 첫 step이 `steps`의 첫 key라서 하나는 있어야 한다. 순서는 object의 key 순서에 기댄다. 이 순서가 깨지는 정수 꼴 key(`"1"`)는 `stepNameSchema`가 글자로 시작하게 해서 이미 막혀 있다. 참가자 key는 `participantKeySchema`, `next` 안은 `stepNameSchema | "end"`다.
5. **`instances.ts`.** `LineBy`, `InstanceStep`, `WorkflowInstance`, 줄(`kind`로 가르는 합, 공통 칸은 helper 하나로), `WorkflowEntry`, `WorkflowInstanceSummary`, `HandResult`, `NotHandedReason`, `workflowEditSchema`(`op`로 가르는 평평한 합. edit 줄의 `detail`과 route·command가 같이 쓴다. `hand_now`의 `text`는 `workflowTextSchema`)를 만든다. `seq`는 `seqSchema`(십진 글)고 `at`은 `atSchema`다. `WorkflowInstance`에 `(finished_at !== null) === (state !== "running")` refine을, `WorkflowEntry`에 `(problem !== null) === !startable` refine을 둔다(runs의 `refine` 꼴). 이유: 표 CHECK와 같은 규칙을 값 하나가 먼저 지켜 저장된 값이 틀리면 `internal`로 드러난다.
6. **`routes.ts`.** 계약 "route"절의 일곱 route를 `workflowList`, `workflowStart`, `workflowReport`, `workflowEdit`, `workflowStop`, `workflowInstanceRead`, `workflowInstanceList`로 만들고 `WORKFLOW_ROUTES`로 모은다. 입력은 `z.strictObject`(`ReportWorkflow.text`는 `workflowTextSchema`), 오류 code는 일곱 안에서만 쓴다(`defineMemory`·`defineRead`가 던진다). `EditWorkflow` 입력은 `workflowEditSchema`의 variant마다 `instance`를 더한 `op` 합이다. actors는 계약 표대로다. 이유: `ReportWorkflow`·`EditWorkflow`·`ListWorkflows`는 agent가 turn마다 부르는 route인데 memory route가 `agent` actor를 받는 선례가 있다(`app.call_tool`: `["user","agent","app"]`, `blueprint.check`, `harness.list`). agent tool은 memory route를 `readOf`로 부른다(`packages/core/apps/agent-tools/app.ts`의 `blueprint.check`).
7. **`commands.ts`.** `workflowInstanceCreate`, `workflowInstanceApply`와 `HandoffPlan` schema, `WORKFLOW_COMMAND_ROUTES`. actors는 `["machine"]`, apply의 `compare`는 `z.strictObject({ state_seq: seqSchema })`다. `HandoffPlan`의 `delivery.to`는 `namedAgentSchema`와 `namedAgentSchema.extend({ session: idSchema("ses"), fallback: z.literal("new") })`의 합이다(`CallToInput`에 대입된다. 맨 `{session}` 꼴은 plan이 만들지 않는다). `delivery`와 `unresolved`가 정확히 하나만 있는지 `refine`으로 본다.
8. **`transient.ts`.** `workflowInstanceChanged`를 `defineTransientEvent("WorkflowInstanceChanged", ...)`로 만들고 `transientEventSchema`의 합에 더한다. 주석 문구는 "다시 읽으라는 신호"로 쓴다(`check-source`가 "바뀜 알림"과 "change notification"을 막는다).
9. **`mod.ts`.** 위 file을 `export *`하고 `ROUTES = [...WORKFLOW_ROUTES, ...WORKFLOW_COMMAND_ROUTES]`를 낸다(`protocol/runs/mod.ts` 꼴). 이름이 겹치면 한 쪽을 고친다.
10. **`packages/core/workflows/ports.ts`.** 계약 "core port"절의 네 port와 `DefinitionFile`, `StepTurn` type. `packages/core/runs/ports.ts`처럼 core를 import하지 않고 protocol type만 쓴다. `mod.ts`는 건드리지 않는다(lead).
11. **`tools/check-deps.ts`.** `CORE_FEATURES`에 `"workflows"`를 더한다. 이유: feature module끼리 import하지 못하게 하는 검사에 이 module이 들어가야 한다.

## 정한 것

- **route 값 이름은 runs를 따른다**(`workflowStart` 등). 다른 task가 이 이름을 import한다.
- **선언 schema는 읽는 칸만 검사하고, instance로 옮길 때는 읽은 칸만 골라 옮긴다**(`wf-decl-reader`의 `stepsOf`·`participantsOf`). 그래서 `z.looseObject`로 읽어도 모르는 칸이 instance 표에 새지 않는다.
- **`ended`는 기록일 뿐이다.** 근거: 끝을 lophn이 굳히면 다시 열어야 할 예외를 agent가 다루지 못한다(roadmap "원칙"). 위 계약의 상태 규칙은 README "끝(`ended`)"을 옮긴 것이다.

## 끝남

- `deno task check`가 통과한다. 새 module 줄이 catalog에 없어 modules check가 막으면 lead가 먼저 등록한 뒤 다시 돌린다.
- 위험 test: 없음(schema 정의뿐이고 판정하는 코드가 없다).
- 남지 않음: `grep -rn "TODO" packages/protocol/workflows packages/core/workflows/ports.ts`가 0줄이다. `packages/protocol/workflows/paths.ts`에 `import`가 없다.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것(lead): `packages/protocol/mod.ts`의 `export * as workflows`와 `ALL_ROUTES`, `project-docs/module-catalog.yaml`·`boundary-catalog.yaml` 줄, `packages/core/workflows/mod.ts`의 export, `packages/core/main/daemon/assembly.ts`(`TEAMS`, `TEAM_MODULES`, `WIRINGS`는 `runsWiring` 바로 뒤).
- 안 쓰게 된 export: 없음.
- 정한 것: 문서에 답이 없어 정한 것(위 "정한 것" 밖).
- 넘길 줄: 남의 file을 맞춘 곳. `ids.ts`·`transient.ts`·`check-deps.ts`는 `schedule-job`과 겹치므로 줄만 더했다고 적는다.
- 계약 바꾸기 요청: 고정 계약을 바꿔야 하면 여기에 적는다.
- **무겁게 짠 것**: 없으면 "없음".
- **알려진 미완 동작**: 없으면 "없음".
