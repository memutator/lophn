# sj-workflows-job-start

job이 workflow instance를 시작하는 core 안 길을 둔다. 사람만 받는 `StartWorkflow` route는 그대로 두고, instance 줄과 `started` 줄에 시작한 쪽 `job`을 남기며, workflows service를 jobs wiring이 쓰게 낸다.

- 단위: workflows (wave 2)
- 선행: `sj-jobs-contract`
- 소유(이 task만 고친다):
  - `packages/protocol/workflows/instances.ts`
  - `packages/protocol/workflows/commands.ts`
  - `packages/core/workflows/`
  - `packages/core/main/daemon/wiring/workflows.ts`
- 읽을 것:
  - 계획: `project-docs/plan/schedule-job/README.md`의 "정한 것" 중 "할 일"(workflow 시작: 시작한 쪽은 `job:<id>`, `StartWorkflow` route는 그대로), `tasks/sj-jobs-contract.md`의 "접점 › job이 시작한 instance"
  - architecture
    - `project-docs/architecture/workflow.md`: "instance와 줄"(시작은 사람만, 줄의 `by`는 session이 있으면 agent 없으면 user), "넘기기"(command가 Router에 `unattended: true`로 넣는다), "step 입력"(할당은 넓히지 않는다), "화면"(instance 줄이 `ListWorkflowInstances`·`ReadWorkflowInstance`로 읽힌다)
    - `project-docs/architecture/approval.md`의 "turn mode"(workflow가 넣은 step 입력도 unattended)
    - `project-docs/architecture/layers.md`: `workflows`는 lophn-agent와 다른 feature module을 import하지 않고 `ports.ts`의 port를 wiring이 끼운다
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `workflows`(와 `core-api`), `project-docs/module-catalog.yaml`의 `packages/core/workflows`
  - 코드
    - `packages/protocol/workflows/instances.ts`: `lineBySchema`, `workflowInstanceSchema`, `workflowLineSchema`(`started` 줄의 `userBy`), `workflowInstanceSummarySchema`. `commands.ts`: `workflowInstanceCreate`. `routes.ts`: `workflowStart`(actors `user`)
    - `packages/core/workflows/`: `service.ts`(`start`, 맨 위 `createWorkflowService`), `commands.ts`(`create`, `addLine`로 `started` 줄을 남기는 곳과 `input.started_by as { kind: "user" }` cast), `store.ts`(`insertInstance`), `rows.ts`(`instanceFromRow`, `lineFromRow`는 schema로 읽는다), `reads.ts`(`list`가 summary를 만든다), `mod.ts`, `commands_test.ts`
    - `packages/core/main/daemon/wiring/workflows.ts`: `byOf`, `workflowStart` memory handler, `withStepText`(시작 입력 redaction과 본문 blob 준비), `build`의 service 조립
  - 시작한 쪽을 읽는 곳(아래 "할 일" 8이 하나씩 처리한다)
    - 바꾸지 않는다: `packages/coding-agent/cli/commands/workflow.ts`(`start`, `show`가 route 출력을 그대로 낸다), `packages/shell/main/desktop/wiring/artifact.ts`의 `readInstance`(`_instance.json`이 `ReadWorkflowInstance`를 그대로 담는다), `packages/core/workflows/agent-tools.ts`의 `workflow.get`(instance를 그대로 준다)
    - `sj-shell-job-labels`가 맞춘다: `packages/shell/renderer/workspace/source.ts`의 `WorkflowLineBy`·`WorkflowInstanceView.started_by`·`WorkflowInstanceSummaryView`, `workspace/core-source.ts`의 `workflowInstances`(summary 칸을 하나씩 옮겨 `started_by`가 빠진다), `workflow/instance-view.tsx`의 `whoOf`
- 계약:
  - 쓰는 것: `idSchema("job")`(`packages/protocol/base/ids.ts`, `sj-jobs-contract`)
  - 내놓는 것(`sj-jobs-contract`의 "job이 시작한 instance"가 정한 모양 그대로)
    - `startedBySchema = {kind: "user"} | {kind: "job", job: Id<"job">}`와 type `StartedBy`. `workflowInstanceSchema.started_by`, `CreateWorkflowInstance` 입력의 `started_by`, `started` 줄의 `by`가 이것을 쓰고, `workflowInstanceSummarySchema`에 `started_by`를 더한다(`ListWorkflowInstances`의 줄마다). `lineBySchema`(`user | agent | lophn`)는 그대로다.
    - `createWorkflowService`의 `start(input, by)`가 `by: StartedBy`를 받는다. job은 `{workflow: "<prj id>/<name>", text, step?}`와 `{kind: "job", job}`으로 부른다(`projects.resolve`가 project id도 받는다).
    - workflows wiring이 service를 `ctx.provide("workflowService", ...)`로 낸다. `Late` 칸은 lead가 계약 wave와 함께 등록한다(이 task가 뜨기 전, wave 2 전).
    - `StartWorkflow` memory route의 입력과 actors(`user`)는 그대로다.

## 정한 것

- 시작 입력과 step 메시지의 redaction, 본문 blob 준비는 지금 길(접힌 writer의 `withStepText`)을 그대로 지난다. job 길이 따로 우회하지 않는다.
- instance가 끝나는 것은 참가자가 말한 기록일 뿐이라(`architecture/workflow.md`) 이 task는 끝을 판정하지 않는다. 앞 차례의 instance가 `running`인지는 `sj-jobs-scheduler`가 `ReadWorkflowInstance`로 본다.
- `workflow_instances.started_by`는 JSON 글이라 표를 바꾸지 않는다.
- `workflow_lines.by`도 JSON 글이라 표를 바꾸지 않는다. 그래서 이 task에는 DDL이 없고 schema step도 개발 data를 지울 일도 없다(옛 `{kind: "user"}` 행은 새 schema로도 읽힌다). 같은 계획에서 표를 그 자리에서 고치는 task는 `sj-runs-job-origin`(`runs.job`)과 `sj-apps-program-caller`(`invocations.caller_kind`)다.
- `workflowInstanceSchema.started_by`를 `lineBySchema`에서 `startedBySchema`로 바꾸면 instance에서 `agent`·`lophn` 갈래가 사라진다. 시작은 사람(`StartWorkflow`)뿐이었으니 지금 data에도 그 갈래의 행이 없다.
- 시작 입력 8 KiB 한도 같은 규칙은 늘리지 않는다. job이 보내는 `text`도 route와 같게 `min(1)`만 본다(계약 `workflow_start.text`가 이미 `min 1`).
- job으로 시작한 instance의 step 메시지도 지금처럼 `unattended: true`로 간다(`handOff`). 할당은 넓히지 않는다. 받은 agent는 자기 할당으로만 일한다.

## 할 일

1. `protocol/workflows/instances.ts`
   - `startedBySchema = z.discriminatedUnion("kind", [userBy, z.strictObject({ kind: z.literal("job"), job: idSchema("job") })])`와 `type StartedBy`를 export한다. `userBy` const는 지금 `workflowInstanceSchema` 아래에 있어서 `startedBySchema`가 먼저 쓰면 아직 만들어지지 않은 값이다. 위로 올려 `startedBySchema`와 `stopped` 줄이 같이 쓴다.
   - `workflowInstanceSchema.started_by`를 `startedBySchema`로, `started` 줄 `line("started", userBy, ...)`의 `by`를 `startedBySchema`로 바꾼다. `stopped` 줄은 `userBy` 그대로다.
   - `workflowInstanceSummarySchema`에 `started_by: startedBySchema`를 더한다.
2. `protocol/workflows/commands.ts`: `workflowInstanceCreate`의 `started_by`를 `startedBySchema`로 바꾼다(`lineBySchema` import가 남는 곳은 `workflowInstanceApply.by`다).
3. `core/workflows/store.ts`: `insertInstance`의 `started_by` type을 `StartedBy`로 바꾼다. `rows.ts`는 schema로 읽으므로 고칠 것이 없다(확인만. `NewLine`은 `WorkflowLine`에서 나오므로 `started` 줄의 `by`가 저절로 넓어진다).
4. `core/workflows/commands.ts`: `started` 줄의 `by: input.started_by as { kind: "user" }` cast를 지운다(type이 이제 맞다). `stopped` 줄의 `input.by as { kind: "user" }`는 `ApplyWorkflowChange.by`가 `lineBySchema`라 남긴다.
5. `core/workflows/service.ts`: `start(input, by: StartedBy)`로 바꾸고 `LineBy` import는 `report`·`edit`·`stop`이 쓰므로 남긴다. `store.create({ ..., started_by: by })`는 그대로다. `type WorkflowService = ReturnType<typeof createWorkflowService>`를 export하고 `mod.ts`가 낸다(lead가 `Late`에 type을 적을 때 쓴다).
6. `core/workflows/reads.ts`: `list`의 summary에 `started_by: instance.started_by`.
7. `wiring/workflows.ts`
   - `workflowStart` memory handler를 `built.start(i, { kind: "user" })`로 바꾼다. 지금은 `byOf(who)`를 넘기는데 `LineBy`가 `StartedBy`와 달라 type 오류가 나고, route의 actors가 `user`뿐이라 상수가 맞다. `byOf`는 report·edit·stop이 계속 쓴다.
   - `build`에서 `service = built` 다음에 `ctx.provide("workflowService", built)`. `Late` 칸은 lead가 계약 wave와 함께 이미 등록했다(wave 2 전). 칸이 없어 type check가 막히면 고치지 말고 멈춰서 보고한다.
8. 읽는 쪽 점검(바꾸지 않는다). 위 "읽을 것"의 두 묶음을 실제로 열어 확인하고 보고에 한 줄씩 적는다.
   - CLI `workflow start|show`, `_instance.json`, `workflow.get`은 JSON을 그대로 내므로 `{kind: "job", job}`이 그대로 실린다. `guide-workflows` skill은 `started_by`를 설명하지 않는다(`grep started_by packages/core/agent-roles/skills`가 0줄).
   - renderer 쪽은 `sj-shell-job-labels`가 맞춘다. 지금 코드 그대로면 `started` 줄의 `by.kind === "job"`이 `instance-view.tsx`의 `whoOf`에서 agent 갈래로 떨어져(`line.by.session`이 undefined) "Unknown" 글이 붙는다. summary 목록은 `core-source.ts`가 `started_by`를 옮기지 않아 빠진다. 이 task는 renderer를 고치지 않는다.
9. 확인: `deno test --no-check packages/core/workflows`.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: 없음(권한 경계는 route actors가 지키고 바뀌지 않았다).
- 남지 않음
  - `grep -n "input.started_by as" packages/core/workflows/commands.ts`가 0줄이다.
  - `grep -n "started_by: LineBy" -r packages/core/workflows`가 0줄이다.
  - `workflowStart` handler가 `byOf`를 쓰지 않는다: `grep -n "workflowStart" -A3 packages/core/main/daemon/wiring/workflows.ts`에 `byOf`가 없다.
  - `StartWorkflow`의 입력과 actors는 그대로다(`git diff packages/protocol/workflows/routes.ts`가 비어 있다).

## 보고

- 바꾼 file
- 통과한 check
- 등록할 것: `Late`의 `workflowService: WorkflowService`(`packages/core/workflows/mod.ts`의 type)와 `LATE_KEYS` 줄은 lead가 계약 wave와 함께 이미 더했다. 칸의 type이 이 task가 낸 `WorkflowService`와 다르면 어디가 다른지 적는다.
- 안 쓰게 된 export(남이 쓰던 것은 지우지 않는다): 없음 예상
- 정한 것: 문서에 답이 없어 worker가 정한 것
- 넘길 줄: 없음
- 계약 바꾸기 요청: 고정된 계약을 바꿔야 하면 고치지 말고 여기 적는다
- 읽는 쪽 점검 결과: 위 "할 일" 8의 한 줄씩(CLI, `_instance.json`, `workflow.get`, renderer 셋)
- 고치지 않은 문서(lead가 끝에 고친다): `architecture/workflow.md`(시작한 쪽, job이 시작한 instance, "시작은 사람만"의 예외)
- **무겁게 짠 것**: 가장 단순한 구현(AGENTS.md "속도")보다 무겁게 짠 곳마다 `무엇 / 왜 / 줄인다면 / 어디`. 없으면 "없음"
- **알려진 미완 동작**: 지금 안 되는 동작과 고치려면 필요한 것. 없으면 "없음"
