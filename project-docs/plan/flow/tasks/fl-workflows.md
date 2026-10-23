# fl-workflows

workflows core에 flow 갈래를 연다. flow instance를 handoff 없이 시작하고, program의 report를 받고, `program_exited`를 처리하고, 멈추면 process를 죽이는 port를 부르고, 켤 때 `running`인 flow instance를 닫는다. process를 띄우는 쪽(`fl-host`)이 부를 service 이름을 내놓는다.

- 단위: workflows (wave 2)
- 선행: fl-contract
- 소유(이 task만 고친다):
  - `packages/core/workflows/declaration.ts`
  - `packages/core/workflows/service.ts`
  - `packages/core/workflows/service_test.ts` (새 file)
  - `packages/core/workflows/commands.ts`
  - `packages/core/workflows/commands_test.ts`
  - `packages/core/workflows/store.ts`
  - `packages/core/workflows/rows.ts`
  - `packages/core/workflows/mod.ts`
  - `packages/core/main/daemon/wiring/workflows.ts`
  - `packages/coding-agent/cli/commands/workflow.ts`
- 읽을 것:
  - architecture: `project-docs/architecture/workflow.md`(정의, instance와 줄, report, "켤 때와 멈춤"), `project-docs/architecture/run.md`("켤 때와 session 끝"), `project-docs/architecture/layers.md`(workflows는 다른 feature module을 import하지 않는다. 그래서 process 쪽은 port `WorkflowFlows`로만 부른다)
  - 계획: `project-docs/plan/flow/README.md`의 "선언", "process", "instance와 줄"
  - 코드(먼저 열어 볼 곳):
    - `packages/core/workflows/commands.ts`: `endDraft`(running일 때만 `ended` 줄), `handOff`, `apply`의 `switch (change.kind)`. contract가 끼운 임시 `case`가 여기 있다.
    - `packages/core/workflows/service.ts`: `apply()` 도우미(state_seq compare, 최대 3번), `restarted()`, `reconcile()`.
    - `packages/core/workflows/commands_test.ts`: 있는 test 하나. sqlite(`createSql(new DatabaseSync(":memory:"))`), `workflowsSchemaSteps[0].sql`, tx stub, `createWorkflowCommands(() => ok(router))`의 준비가 service_test의 본보기다.
    - `packages/core/main/daemon/wiring/workflows.ts`: `withStepText`(writer 앞단 redaction), `byOf`, `ctx.peek`.
    - `packages/core/main/daemon/wiring/context.ts`: `Late`, `provide`, `peek`(아직 provide되지 않은 slot을 읽으면 던지는 getter와 던지지 않는 `ctx.peek`).
- 계약:
  - 쓰는 것: `fl-contract`의 `CreateWorkflowInstance`(`handoff` nullable), change `program_exited`·`flow_restarted`, `LineBy` `program`, `FLOW_STEP_BY`, `DefinitionFile.flow`, `WorkflowFlows`(`packages/core/workflows/ports.ts`), `Late.flowHost`.
  - 내놓는 것: `WorkflowService.programExited(input: {instance, code: number | null, stderr_tail: string}): Promise<Result<void>>`(`fl-host`가 process가 끝났을 때 부른다). `createWorkflowService`가 `flows: WorkflowFlows`를 deps로 받는다. `report(input, {kind: "program"})`가 flow의 report 입구다(route가 아니라 core 안 호출이다. host가 부른다). `workflows/mod.ts`가 `WorkflowFlows` type을 내보낸다.

## 할 일

1. `declaration.ts`: flow 선언을 읽는다.
   - `entryOf`의 flow 갈래를 contract가 정한 모양으로 채운다: `startable = file.flow`, 아니면 problem `{reason: "no_flow_file", message: "flow.ts is missing"}`, `steps`는 `Object.keys(declaration.steps)`마다 `{name, by: FLOW_STEP_BY, with: null, next: []}`, `participants: null`.
   - 순수 함수 `flowStepsOf(declaration)`를 `stepsOf` 옆에 더한다. instance에 옮길 `InstanceStep[]`이고 칸은 `{name, by: FLOW_STEP_BY, with: null, prompt: "", in: "", out: "", next: []}`다(flow의 `by`·`prompt` 등은 읽지 않기로 했다). 이유: flow instance도 `steps`를 갖고 화면이 step 목록을 그린다(README "선언").
   - `participantsOf`·`stepsOf`는 `AgentDeclaration`만 받는 채로 둔다. `mod.ts`가 `flowStepsOf`를 내보낸다.
2. `service.start`: flow를 연다(`architecture/workflow.md` "instance와 줄").
   - 지금 `!entry.startable || … || parsed.declaration.kind !== "agent"`로 flow를 거절하는 조건을 kind로 가른다. `startable`이 거짓이면 그대로 `conflict`(메시지는 `entry.problem.message`).
   - flow면: `input.step`이 있으면 `invalid_input`("a flow has no step to start from"). `participants: {}`, `steps: flowStepsOf(...)`, `handoff: null`로 `store.create`한다. 결과의 `handed`는 null이다.
   - 만들어지면(`ok`) `flows.launch({instance: id, project, workflow: name, input})`를 부른다. `input`은 요청의 `input.text`가 아니라 만들어진 instance의 `input`(writer 앞단이 redaction을 거친 글)으로 넘긴다. 이유: 원문 secret이 process 인자로 새지 않게(`wiring/workflows.ts`의 `withStepText`가 줄에 남는 글을 이미 거른다).
   - `launch`가 err면 `programExited({instance: id, code: null, stderr_tail: <err.message>})`로 닫고, `store.read`로 다시 읽은 instance를 결과에 싣는다(안 읽히면 만든 값 그대로). 이유: 시작은 성공이고 기록이 `program_exited` → `ended`로 남아야 사람이 이유를 본다. `start`는 err를 돌려주지 않는다.
   - agent 갈래는 바꾸지 않는다.
3. `service.report`: `by.kind === "program"`이면 `planHandoff`를 부르지 않고 `handoff: null`로 `apply`한다. `next`의 이름이 있는지 검사하지 않는다(lophn은 약하다. roadmap `workflow.md` "원칙"). `commands.ts`의 `case "report"`:
   - 줄은 지금처럼 남긴다.
   - `input.by.kind === "program"`이면 별도 갈래로 처리하고 `hand()`를 부르지 않는다: instance가 `stopped`가 아니고 draft 상태가 `running`일 때만 `draft.current = {step: change.step, human_turn: false}`로 바꾸고, `change.next === "end"`면 `endDraft`. `stopped`이거나 이미 `ended`면 줄만 남긴다(늦게 온 report를 잃지 않는다. flow가 `ended` 뒤 report해도 다시 `running`이 되지 않는다. 다시 여는 것은 handed가 있는 agent 쪽 규칙이다).
   - 그 밖의 `by`는 지금 그대로다.
4. `commands.ts`: contract가 둔 `conflict`("not supported yet") 임시 `case` 둘을 진짜로 바꾼다. 두 줄의 `by`는 `LOPHN`이다.
   - `program_exited`: `addLine({kind: "program_exited", by: LOPHN, code, stderr_tail})`. 그 뒤 `endDraft(scope)`(running일 때만 `ended` 줄을 더 남긴다). 그래서 이미 `ended`나 `stopped`인 instance에도 `program_exited` 줄은 남고 상태는 그대로다. 줄 순서는 `program_exited` → `ended`다. 이유: 남은 참가자가 없어 아무도 이어 갈 수 없다(README "instance와 줄").
   - `flow_restarted`: `addLine({kind: "lophn_restarted", by: LOPHN, step: null, receiver: null})` 뒤 `endDraft(scope)`.
   - `create`: `handoff`가 null이면 `started` 줄 step이 null이고 `handOff`를 건너뛴다(contract가 이미 했는지 보고, 안 했으면 한다).
5. `service.programExited`를 더하고(`apply`로 `{kind: "program_exited", code, stderr_tail}`, `by: {kind: "lophn"}`, `handoff: null`), `service.stop`이 `stopped` 기록을 한 뒤 session을 멈추는 반복 다음에 `await flows.stop(input.instance)`를 부른다. 결과 err는 무시한다(best-effort, 기록하지 않는다. session 멈춤과 같다). agent instance에서는 process가 없어 host가 ok를 준다. 멈춘 기록이 먼저인 까닭: 죽인 process의 `program_exited`가 뒤따라와도 `stopped`인 instance라 줄만 남는다.
6. `service.reconcile`/`restarted`: `store.read`로 읽은 `lines` 가운데 첫 `started` 줄의 `step`이 null이면 flow instance다. 이 갈래는 `handed` 줄을 찾는 코드보다 앞에 둔다(flow에는 `handed`가 없어 지금 순서면 그냥 return한다). `store.apply({instance: id, change: {kind: "flow_restarted"}, by: {kind: "lophn"}, handoff: null}, {state_seq})`를 걸고 실패는 `skip`한다. `flows.launch`를 부르지 않는다. 이유: 다시 띄우면 바깥 효과가 두 번 난다(README "instance와 줄"). agent instance 처리(`handed` 줄, `turns.stepTurn`)는 그대로다. 판별에 `by === FLOW_STEP_BY`를 쓰지 않는다: agent workflow의 참가자 key도 `program`일 수 있다.
7. `wiring/workflows.ts`:
   - `createWorkflowService({…, flows})`에 `WorkflowFlows` 어댑터를 넘긴다. `flows` wiring은 이 wiring보다 뒤에 build되고 `ctx.flowHost`는 provide 전에 읽으면 던지므로, 부를 때 `ctx.peek.flowHost`를 읽는다: `launch`는 없으면 `err({code: "unavailable", message: "flow host is not running"})`, `stop`은 없으면 `ok(undefined)`. 이유: lead가 `flowsWiring`을 등록하기 전에도 core가 뜨고, 늦으면 `start`가 위 2번 길로 instance를 닫는다.
   - `withStepText`: `create` 가지의 `safeHandoff(raw.handoff)`는 `handoff`가 null이면 터진다. `apply` 가지(`raw.handoff === null ? null : …`)처럼 null을 그대로 둔다. 그리고 `change.kind === "program_exited"`의 `stderr_tail`도 `safe()`를 거치게 한다(process stderr는 AI가 짠 code가 쓴 글이다. host가 log file에는 redaction을 하지만 줄에 남는 글은 여기가 마지막 관문이다).
   - `byOf`와 route handler는 바꾸지 않는다. host가 `ctx.workflowService.report(…, {kind: "program"})`를 직접 부른다. `WORKFLOWS_CONTEXT`의 operation 목록도 그대로다(새 command가 없다).
   - `CheckWorkflow`의 `memoryRoutes`·handler는 건드리지 않는다(`fl-check`의 일. contract는 임시 handler를 두지 않는다).
8. `store.ts`, `rows.ts`: 줄 칸 `step`·`data`가 이미 null과 `null` 값 칸을 받으므로(`lineColumns`는 `step ?? null`, `lineFromRow`는 `data`를 그대로 펼친다) 고칠 것이 없을 수 있다. `started`(step null), `lophn_restarted`(step·receiver null), `program_exited`(`code: null`)가 쓰고 읽혀 되돌아오는지 test 6번이 지나가며 보여 준다. 안 되면 여기서 고친다.
9. `packages/coding-agent/cli/commands/workflow.ts`의 `start`: `handed`가 `HandResult | null`이다. `handed?.outcome === "not_handed"`일 때만 stderr 줄을 남기고, null이면 id만 낸다(`--json`이면 `{instance, handed}`에 null 그대로). `handedText`는 이미 null을 받는다. 다른 호출처가 `handed`를 null로 못 받으면 컴파일러가 가리킨다(`wiring/jobs.ts`는 `instance.id`만 쓴다).
10. 위험 test를 쓴다(아래). `commands_test.ts`의 기존 test가 새 모양에서 그대로 통과하는지만 본다. 새 test를 더하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test (새 `workflows/service_test.ts`, 가짜 port와 in-memory sqlite, process 없음): "켤 때 `running`인 flow instance는 `lophn_restarted` 줄(step·receiver null)과 `ended` 줄로 닫혀 `ended` 상태가 되고 `flows.launch`가 다시 불리지 않는다. 같은 때의 agent instance(`handed` 줄 없이 `running`)는 줄이 늘지 않는다."
  - 준비: `commands_test.ts`처럼 `DatabaseSync(":memory:")` + `workflowsSchemaSteps[0].sql` + tx stub으로 `createWorkflowCommands()`를 쓰는 `WorkflowStore` 가짜를 만든다. `create`/`apply`는 `commands.create/apply.handle`을, `read`는 `loadInstance`·`loadLines`·`lastReports`를, `running`은 `runningInstances(sql)`를 부른다. flow instance는 `handoff: null`로 `create`한다(그래서 router가 안 불려 router 가짜가 필요 없다). agent instance는 `insertInstance`와 `appendLine`으로 `started` 줄(step 있음)만 직접 넣는다. `files`·`projects`·`turns`는 `{} as never`(reconcile이 이 갈래에서 안 건드린다), `flows`는 `launch` 호출을 모으는 가짜다.
  - 판정은 `service.reconcile()` 뒤 줄 종류의 목록과 instance 상태, 모은 `launch` 목록이 비었음이다. 호출 횟수를 mock으로 세지 않는다.
- 남지 않음: `grep -rn "not supported yet" packages/core/workflows`가 0줄이다(contract가 둔 임시 `conflict`). `grep -rn "only agent workflows can be started" packages`가 0줄이다.

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: 없음. 새 route, command, operation이 없다. `Late.flowHost`는 `fl-host`의 `flowsWiring`이 provide하고, lead가 그 wiring을 `WIRINGS`에 넣을 때까지는 `ctx.peek` 어댑터가 `unavailable`을 준다(flow를 시작하면 `program_exited`로 닫힌다).
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다)
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 남의 file을 최소로 맞춘 곳
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
