# wf-service

memory route 다섯(`ListWorkflows`, `StartWorkflow`, `ReportWorkflow`, `EditWorkflow`, `StopWorkflow`)의 service와 wiring을 만든다. 상태를 읽어 step 메시지 본문과 받는 곳을 정하고(`HandoffPlan`), blob을 준비한 뒤 ledger command를 부른다. commit 뒤 Bus event를 낸다.

- 단위: workflows (wave 4)
- 선행: wf-commands, wf-decl-reader
- 소유(이 task만 고친다):
  - `packages/core/workflows/service.ts`(새 file)
  - `packages/core/workflows/plan.ts`(새 file)
  - `packages/core/main/daemon/wiring/workflows.ts`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/run.md`("켤 때와 session 끝", "취소": 본보기), `project-docs/architecture/agent-call.md`("지키는 것"의 body는 redaction 뒤에만 받는 session 기록에 들어간다, 고정 문구와 body는 command 앞단이 blob으로 준비한다, 입력함은 메모리라 꺼지면 사라진다), `project-docs/architecture/approval.md`("turn mode"), `project-docs/architecture/event.md`(남지 않는 event), `project-docs/architecture/layers.md`, `project-docs/architecture/place-session.md`("켤 때": 입력함, 다시 넣지 않는 입력)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `workflows`, `project-docs/module-catalog.yaml`의 `packages/core/workflows`(lead가 먼저 등록한다)
  - 본보기 코드: `packages/core/runs/service.ts`(`start`, `cancel`, `reconcile`), `packages/core/main/daemon/wiring/runs.ts`(통째로. 두 내부 자격, 접은 `ctx.writer`, `ledgerSnapshot`, memory handler, 켤 때 reconcile), `packages/core/main/daemon/wiring/router.ts`(`createCallBodyPreparer`, `prepareTexts`, `withCallBody`), `packages/core/main/daemon/wiring/apps.ts`의 `withAfterCommit` 쓰는 곳(자기 topic만 보고 `bus.publish`), `packages/core/main/daemon/wiring/context.ts`(writer를 "앞이 안쪽"으로 접는 규칙), `packages/core/server/workspace.ts`의 `ctx.conditions.session`(agent 자격에서 session 알기), `packages/protocol/lophn-agent/received-messages.ts`·`turn-reads.ts`(machine이 읽는 route)
  - 제품 결정: 계획 README의 "report, 고치기, 넘기기", "시작과 멈춤", "lophn이 꺼졌다 켜졌을 때"
- 계약:
  - 쓰는 것: `wf-contract`(route, command, `HandoffPlan`, port), `wf-decl-reader`의 `entryOf`·`parseDeclaration`·`stepsOf`·`participantsOf`·`workflows-files.ts`, `wf-commands`의 command와 topic `workflows.changed`(`WORKFLOW_CHANGED_TOPIC`), `wf-store`의 `runningInstances`, `wf-step-input`이 export하는 `wiring/router.ts`의 `prepareTexts`. 본보기는 `packages/core/runs/service.ts`와 `packages/core/main/daemon/wiring/runs.ts`(접은 writer, 내부 자격, memory handler), `wiring/router.ts`의 `createCallBodyPreparer`(본문 blob 준비)
  - 내놓는 것:
    - `plan.ts`(순수 함수): 참가자 → `CallToInput` 풀이, 본문 글 만들기, `HandoffPlan` 만들기.
      - 참가자 풀이(정한 것): `lophn` → `{role:"lophn"}`. `project_manager` → `{role, place:{project: <place.project ?? instance의 project id>}}`. `operator` → `{role, place: <place ?? {project: instance의 project id}>, name}`(name이 없으면 `unresolved`). `app_engineer` → `{role, place:{app}}`(place가 없으면 `unresolved`). `harness` → `not_handed`·`harness`. `human` → `with`의 참가자로 같은 풀이를 하고 `human_turn: true`(`with`가 없으면 `no_with`). `by`·`with`가 참가자에 없으면 `unknown_participant`, `next`가 steps에 없으면 `unknown_step`.
      - `session: "same"`이면 그 참가자가 이 instance에서 마지막으로 받은 session(`sameSession`. 읽은 줄의 가장 나중 `handed` 줄 `receiver`)이 있을 때 `{...named, session, fallback:"new"}`, 없으면 `new`로 풀어 그냥 `NamedAgent`로 낸다. 줄에는 요청한 `session` 값을 그대로 적는다.
      - 본문 글은 `wf-contract`의 "step 입력" 절대로 만든다.
    - `service.ts`: `list/start/report/edit/stop`과 `reconcile`. 상태를 읽고 plan을 만들어 command를 `compare: {state_seq}`로 부른다. `conflict`면 다시 읽어 `state_seq`가 바뀌었을 때만 최대 3번 건다(`runs`의 `stop`과 같은 반복. 안 바뀌었으면 진짜 `conflict`다). `StartWorkflow`: key를 project id로 풀고(`WorkflowProjects.resolve`), 정의를 읽어 `startable`이 아니면 `conflict`, `step`이 없으면 첫 step, instance id를 만든 뒤 `CreateWorkflowInstance`를 부른다. `StopWorkflow`: command로 `stopped`를 먼저 닫고, 그 instance의 `handed` 줄에 있는 session마다 `WorkflowTurns.stopSession`을 best-effort로 부른다(실패는 기록에 남기지 않는다. `CancelRun`과 같다). 줄의 `by`는 호출한 자격에서 정한다(`conditions.session`이 있으면 `{kind:"agent", session}`, 없으면 `{kind:"user"}`). 자격 판정은 하지 않는다.
    - `reconcile()`(켤 때 한 번): `running`인 instance마다 가장 나중 `handed` 줄의 step 메시지를 본다. 그 session이 받은 메시지를 아직 turn이 가져가지 않았거나, 가져간 turn이 restart로 끊겼으면(`interrupted`·`restarted`) `lophn_restarted` 줄을 남긴다(`change: {kind:"lophn_restarted"}`, `by: {kind:"lophn"}`). 다시 넣지 않는다. 이미 그 뒤에 `lophn_restarted` 줄이 있으면 또 남기지 않는다. 다시 넘기는 일은 agent나 사람이 `hand_now`로 한다(README). 근거: 다시 넣으면 바깥 효과가 두 번 날 수 있지만 말없이 잃지도 않는다(`architecture/run.md` "켤 때와 session 끝", `architecture/agent-call.md`).
    - `wiring/workflows.ts`: 내부 자격 `machine:workflows`(상태 쓰기와 읽기), 접은 writer를 감싸는 본문 준비기(command 입력의 글을 redaction하고 `handoff.delivery.body`는 그 자격 이름으로 blob 준비. `createCallBodyPreparer` 꼴), memory handler 다섯, after-commit applier(`workflows.changed` → Bus `WorkflowInstanceChanged`), port 구현(`WorkflowProjects`, `WorkflowTurns`의 `stopSession`·`stepTurn`, `WorkflowStore`), 켤 때 `service.reconcile()`을 부르는 `start`. runs와 같은 자리다: router가 돌던 turn을 닫은 뒤여야 해서 wiring 순서에서 router 뒤다.
- 등록(lead): `packages/core/main/daemon/assembly.ts`의 registration·wiring 목록(wiring은 router 뒤), `wiring/context.ts`가 필요하면 그 칸.

## 할 일

1. **`plan.ts`(순수 함수, I/O 없음).**
   - `planHandoff({ instance, step, cause, session, received, sameSession })`가 `HandoffPlan`을 낸다. `instance`는 `participants`·`steps`·`id`·`project`를 가진 읽은 값이고, `session`은 요청한 `"new" | "same" | null`(report·`hand_now`는 안 적으면 `"new"`, 시작은 null), `received`는 받은 글, `sameSession(participantKey)`는 그 참가자가 이 instance에서 마지막으로 step 메시지를 받은 session(없으면 null)이다. `session`이 `"same"`이고 `sameSession(participant)`가 있으면 `to`는 `{...named, session, fallback: "new"}`, 아니면 `named`다. 줄의 `session`은 요청한 값 그대로다. 이유: 이 판정을 command 안에서 하면 tx 안에서 상태와 blob을 함께 만져야 한다. 앞에서 정해 넘기면 command는 받은 대로 넣기만 한다(계약).
   - 풀이 순서: step이 `instance.steps`에 없으면 `unknown_step`(`participant`는 null). `by`가 참가자에 없으면 `unknown_participant`. `by`가 `human`이면 `with`로 같은 풀이를 하고 `human_turn: true`(`with`가 없거나 `human`이면 `no_with`, 참가자에 없으면 `unknown_participant`). `harness`면 `harness`. 그 밖은 계약의 참가자 풀이(`lophn`, `project_manager`, `operator`, `app_engineer`)다. `unresolved`의 message는 짧은 영어 한 문장이다(agent가 `workflow.get`으로 읽는다).
   - `stepBody({ step, received })`가 본문 글을 계약의 "step 입력" 절 그대로 만든다. 이유: 고정 영어 label이라 받는 쪽 이력의 글이 바뀌지 않는다.
2. **`service.ts`: `createWorkflowService({ files, projects, turns, store, ids })`.** `list/start/report/edit/stop/reconcile`을 낸다. 오류는 일곱 code의 `Result`다.
   - `list(input, defaultProject)`: `input.project`가 있으면 `projects.resolve`, 없으면 `defaultProject`(wiring이 agent의 place에서 정한다), 둘 다 없으면 `invalid_input`("give a project"). `files.list`를 `entryOf`로 옮긴다. key는 `<project 이름>/<name>`이다.
   - `start(input, by)`: 계약대로. key를 `/`로 가르고 project를 풀어(`not_found`), `files.list`에서 그 이름을 찾아(`not_found`) `entryOf`가 `startable`이 아니면 `conflict`(message는 `problem.message`)다. `parseDeclaration`으로 선언을 얻어 `stepsOf`·`participantsOf`로 instance 칸을 만든다. 시작 step은 `input.step ?? 첫 step`이고 없으면 `not_found`다. id는 `ids.newId("wfi")`. `received`는 `input.text`다. `store.create`를 부른다.
   - `report(input, by)`: instance를 읽고(없으면 `not_found`) `stopped`가 아니고 `next`가 step 이름이면 plan을 만든다(`end`·없음·`stopped`는 plan 없이 `handoff: null`). `received`는 `input.text`, `sameSession`은 읽은 줄에서 그 참가자의 가장 나중 `handed` 줄의 `receiver`다. `store.apply`에 `change: {kind: "report", step, text, next: next ?? null, session: session ?? "new"}`를 싣는다. 반환 `{ line, handed }`.
   - `edit(input, by)`: 읽고 `stopped`면 바로 `conflict`다. `hand_now`면 plan(`cause: edit`)을 만든다. `received`는 `text ?? (가장 큰 seq의 report 줄 글) ?? instance.input`. 그 밖의 `op`는 `handoff: null`이다. 반환 `{ line, handed }`.
   - `stop(input, by)`: 읽고 `stopped`면 `conflict`다. command로 `stopped`를 먼저 닫고(`change: {kind: "stop"}`), 읽은 줄의 `handed` 줄에 있는 session마다 `turns.stopSession`을 best-effort로 부른다(실패는 기록하지 않는다. `CancelRun`과 같다). 반환 `{ instance }`.
   - `reconcile()`: 위 계약대로. 오류는 그 instance를 건너뛰고 `console.error` 한 줄이다(runs의 reconcile과 같다). `apply`가 `conflict`여도 건너뛴다.
   - 줄의 `by`는 wiring이 정해 넘긴다. 이유: 자격은 service가 모른다.
3. **`wiring/workflows.ts`: `workflowsWiring`.**
   - **자격.** `WORKFLOWS_CONTEXT`(principal `machine:workflows`, actor `machine`)의 `scope.operations`에 `workflowInstanceCreate`·`workflowInstanceApply`·`workflowInstanceRead`·`receivedMessageList`·`turnRead`·`turnList`·`stopTurn`·`agentSessionRead`의 이름을 둔다. `records: () => [WORKFLOWS_CONTEXT]`. 이유: 본문 blob은 command를 부른 자격 이름으로 준비돼 있어야 받는 session 기록이 읽는다(`agent-call.md`). 쓰기와 읽기를 한 자격으로 둔다(`runs`는 둘로 나눴지만 여기는 actor를 user로 쓸 일이 없다).
   - **writer.** `build`가 `writer: (inner) => withStepText(withAfterCommit(inner, applyChanged), prepare)`를 낸다. `applyChanged`는 `action.topic === WORKFLOW_CHANGED_TOPIC`일 때만 `ctx.bus.publish({ type: "WorkflowInstanceChanged", subject: instance, at: ctx.clock.now(), payload: { project, workflow } })`를 한다(다른 topic은 router의 applier가 본다). `prepare`는 `CreateWorkflowInstance`·`ApplyWorkflowChange`만 보고, 다음 글을 `createProductRedactor`(`./context.ts`에서 가져온다)로 redaction한다: 시작 입력, report의 `text`, `hand_now`의 `text`, `handoff.delivery.body`. redaction이 끝나지 않으면 `unavailable`이다. 본문(`delivery.body`)만 `prepareTexts`(`./router.ts`)로 blob을 준비한다. 이유: 본문은 받는 session 기록에 들어가므로 call 본문과 같은 규칙을 지킨다. 줄의 글도 ledger에 원문 secret이 남지 않게 같은 redactor를 지난다.
   - **memory handler 다섯.** key는 `route`의 `resource/method`다. `by`는 `who.conditions.session`이 있으면 `{kind: "agent", session}`, 없으면 `{kind: "user"}`다. 자격 판정은 하지 않는다. `ListWorkflows`는 `input.project`가 없을 때 `who.conditions.session`으로 `agentSessionRead`를 읽어 place가 project면 그 id를 `defaultProject`로 넘긴다.
   - **port 구현.** `WorkflowFiles`: `createWorkflowFiles(ctx.root.path)`(`wf-decl-reader`). `WorkflowProjects`: `ledgerSnapshot` + `placeDepsOf(lookup.sql).projects`(`projectByName`은 id와 이름을 둘 다 받는다. 없으면 `not_found`). `WorkflowTurns.stopSession`: `turnList({session, state: "running"})`의 turn마다 `StopTurn`(`runs` wiring의 `stop`과 같은 반복: `state_seq` compare가 어긋나면 다시 읽어 최대 3번). `WorkflowTurns.stepTurn`: `receivedMessageList({session})`을 끝까지 읽어 `step`이 `(instance, step)`인 마지막 메시지를 고르고, `turn`이 있으면 `turnRead`로 `state`·`outcome`을 붙인다. `WorkflowStore.create/apply`: `ctx.writer.command(WORKFLOWS_CONTEXT, ...)`(`apply`는 `compare: {state_seq}`), `read`: `workflowInstanceRead`를 `cursor`를 따라 끝까지 모으기, `running`: `ledgerSnapshot` + `runningInstances`.
   - **`start(ctx)`.** `service.reconcile()`을 try/catch로 부르고 실패는 `console.error` 한 줄이다. 구독은 없다.
   - 파일 머리에 "router 뒤에 돈다"는 이유를 한 줄 쓴다(`runs.ts`와 같은 이유).
4. **test는 만들지 않는다.** 위험 규칙(stopped는 넘기지 않음)은 `wf-commands`가 보고, 이 task는 그 앞뒤를 잇는다.

## 정한 것

- **켤 때의 일(reconcile)을 이 task가 한다.** README는 "넘겼는데 turn이 가져가지 않은 step, restart로 끊긴 step에는 `lophn_restarted` 줄을 남기고 다시 넣지 않는다"고 정했다. runs가 `architecture/run.md` "켤 때"에서 하는 자리(wiring `start`, router 뒤)에 같이 둔다. 줄 종류는 새 kind `lophn_restarted`다(`not_handed`의 reason이 아니다). 이유: `not_handed`는 lophn이 넘기려다 못 넘긴 것이고 이것은 넘겼는데 잃은 것이라, 화면과 agent가 구별해야 한다.
- **끊긴 step을 가리는 근거는 `messages`의 step 칸과 `turn`이다.** `ListReceivedMessages`가 `step`을 싣고(`wf-step-input`) `turn`이 null이면 아직 안 가져간 것이다. SQL을 직접 읽지 않고 공개 읽기 route만 쓴다.
- **`stopSession`은 그 session에서 도는 모든 turn을 멈춘다**(README "그 session에서 도는 turn"). 같은 session이 다른 일을 하고 있었어도 멈춘다. 근거: 멈춘 turn은 사람이 다시 시킬 수 있고, instance의 step을 가져간 turn만 가리려면 `stepTurn`으로 메시지마다 찾아야 해서 무겁다.
- **`same` session은 읽은 줄에서 푼다.** `store.read`가 이미 줄 전부를 주므로 plan이 메모리에서 푼다. 그래서 store에 따로 읽는 함수를 두지 않는다.
- **report 글과 `hand_now` 글은 route 입력에서 8 KiB(UTF-8)로 막힌다**(`wf-contract`의 `WORKFLOW_TEXT_MAX_BYTES`). 이유: report는 짧은 메모고 긴 결과는 file에 두고 경로를 report하게 하는 것이 선언의 `in`·`out` 취지다. 이 task는 그 한도를 다시 검사하지 않는다. 받은 글 + 고정 label 본문이 한 message의 크기 한도(`MESSAGE_CONTENT_MAX_BYTES`)를 넘으면 그 요청은 여전히 `invalid_input`이다(`prepareTexts`가 그렇게 돌려준다. report가 통째로 거절되고 줄도 남지 않는다). 한도(240 KiB)는 8 KiB 글에는 넉넉해서 실제로는 시작 입력(`StartWorkflow.text`는 8 KiB 한도가 없다)이 아주 클 때나 걸린다.
- **보관한 project도 풀린다.** 시작하면 담당 session을 여는 것이 Router에서 `closed`로 막혀 `not_handed` 줄이 남는다. 따로 막지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음
- 남지 않음: `grep -rn "TODO" packages/core/workflows/service.ts packages/core/workflows/plan.ts packages/core/main/daemon/wiring/workflows.ts`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것(lead): `packages/core/main/daemon/assembly.ts`의 `WIRINGS`에 `workflowsWiring`을 `runsWiring` 바로 뒤에, `packages/core/workflows/mod.ts`의 export(`createWorkflowService`, `runningInstances`, `WORKFLOW_CHANGED_TOPIC`, decl-reader 함수들).
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: `runs` wiring의 `stop` 반복을 베낀 곳(runs.ts는 이 task의 소유가 아니다).
- 계약 바꾸기 요청: `wf-contract`의 port나 `HandoffPlan`을 바꿔야 하면 여기에 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음".

## (lead가 더함)

- **추가 소유: `packages/core/main/daemon/assembly.ts`의 정확히 세 자리.** 이유: `register.ts`(`wf-commands`)의 memory route 다섯은 handler(이 task의 wiring)와 같이 붙어야 core가 뜬다(`core.ts`의 `memoryRouteMismatch`). 그래서 등록과 wiring을 이 task가 같이 넣고 `boot.sh`로 확인한다.
  - import `createLedgerRegistration as createWorkflowsRegistration`(`../../workflows/register.ts`)와 `workflowsWiring`(`./wiring/workflows.ts`).
  - `TEAMS`에 `{ createLedgerRegistration: createWorkflowsRegistration }`를 runs 줄 바로 뒤에, `TEAM_MODULES`에 `new URL("../../workflows/register.ts", import.meta.url).href`를 runs 줄 바로 뒤에.
  - `WIRINGS`에 `workflowsWiring`을 `runsWiring` 바로 뒤에. `WIRINGS` 위 주석 목록에 "workflows는 runs와 같은 이유로 router 뒤다" 한 줄.
  - 다른 줄은 고치지 않는다(계획 `schedule-job`도 이 file에 줄을 더한다).
- `packages/core/workflows/mod.ts`는 lead가 고친다. export할 이름을 "등록할 것"에 적는다.
- 끝나면 `boot.sh`의 두 기동이 `exit 0`이어야 한다. memory route와 handler가 어긋나면 기동이 "memory route와 handler가 맞지 않는다"로 멈춘다.
