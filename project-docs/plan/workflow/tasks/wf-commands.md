# wf-commands

instance를 만들고 바꾸는 ledger command 둘(`CreateWorkflowInstance`, `ApplyWorkflowChange`)과 ledger 등록을 만든다. 같은 tx에서 상태를 바꾸고 줄을 남기고 Router로 step 메시지를 넣고 commit 뒤 event를 낸다.

- 단위: workflows (wave 3)
- 선행: wf-store, wf-step-input
- 소유(이 task만 고친다):
  - `packages/core/workflows/commands.ts`(새 file)
  - `packages/core/workflows/commands_test.ts`(새 file)
  - `packages/core/workflows/register.ts`(새 file)
- 읽을 것:
  - architecture: `project-docs/architecture/agent-call.md`("지키는 것"의 program이 보낸 입력은 call 행이 없다, 실패를 조용히 버리지 않는다, unattended), `project-docs/architecture/approval.md`("turn mode"), `project-docs/architecture/run.md`("켤 때와 session 끝": 다시 넣지 않는 이유), `project-docs/architecture/event.md`(남지 않는 event)
  - boundary·module: `project-docs/boundary-catalog.yaml`의 `workflows`, `project-docs/module-catalog.yaml`의 `packages/core/workflows`(lead가 먼저 등록한다)
  - 본보기 코드: `packages/core/runs/commands.ts`·`register.ts`(machine만 받는 command, 등록 꼴), `packages/core/apps/coding/close-call.ts`(tx 안에서 program이 Router로 넣는 법), `packages/core/router/router.ts`의 `route`(보낸 쪽 program이 받는 `RouteResult`), `packages/core/router/environment.ts`의 `routerFor`, `packages/core/storage/ledger/tx.ts`의 `runTransaction`(handler가 `err`를 돌려주면 tx를 통째로 rollback한다), `packages/core/storage/ledger/after-commit.ts`, `packages/core/router/router_test.ts`의 `setup`(Router를 port 대역으로 세우는 꼴), `packages/core/runs/store_test.ts`(in-memory SQLite)
  - 제품 결정: 계획 README의 "report, 고치기, 넘기기", "시작과 멈춤"
- 계약:
  - 쓰는 것: `wf-contract`의 command·`HandoffPlan`·줄 표, `wf-store`의 함수, `routerFor(tx)`(`packages/core/router/mod.ts`), `afterCommit` port(`packages/core/storage/ledger/after-commit.ts`). 본보기는 `packages/core/runs/{commands,register}.ts`와 `packages/core/apps/coding/close-call.ts`(tx 안에서 program이 Router로 넣는 법)
  - 내놓는 것:
    - `createLedgerRegistration()`(schemaSteps: `wf-store`의 표, commands: 둘, reads: `wf-store`의 둘, memoryRoutes: 다섯 memory route)와 `createReaderRegistration()`. 모양은 `runs/register.ts`와 같다. Worker가 싣는 file이라 service를 import하지 않는다. memoryRoutes에 넣어야 agent credential이 닿는 route 목록(`ctx.allRoutes`)에 든다.
    - 상태 전이(정한 것). `ended`는 기록일 뿐이라 넘기면 `running`으로 돌아온다. 사람이 멈춘 `stopped`만 넘기지 않는다.
      - `report`: 줄을 남긴다. 그 뒤는 상태와 `next`로 가른다. `stopped`면 거기서 끝이다(`handed: null`). `next`가 없으면 거기서 끝이다(진행 글). `next`가 `end`면, `running`이었을 때만 `ended` 줄을 더 남기고 `state: ended`, `current: null`, `finished_at`을 채운다(이미 `ended`면 report 줄만이다). `next`가 step이면 `handoff`를 실행한다.
      - `edit`: `stopped`면 `conflict`이고 아무것도 쓰지 않는다. `add_step`·`update_step`·`remove_step`은 `steps`만 고치고 `edit` 줄 하나를 남긴다(상태는 그대로, `ended`여도 그대로). `end`는 `edit` 줄을 남기고, `running`이었을 때만 `ended` 줄과 `state: ended`, `current: null`, `finished_at`을 더한다. `hand_now`는 `edit` 줄을 남기고 `handoff`를 실행한다.
      - `stop`: `stopped`면 `conflict`다. `running`과 `ended`는 `stopped` 줄을 남기고 `state: stopped`, `human_turn: false`, `finished_at`(이미 있으면 그대로)로 한다. `current`는 그대로 둔다.
      - `lophn_restarted`: 그 줄만 남긴다. 상태와 `current`는 그대로다.
      - 줄의 `by`는 `started`·`report`·`edit`·`stopped`가 command 입력의 `by`(`started`는 `started_by`)고, `handed`·`not_handed`·`ended`·`lophn_restarted`는 `{kind:"lophn"}`다. `edit` 줄의 `detail`은 고친 입력(`op` 포함, `instance` 제외)이다. 결과의 `line`은 `report`·`edit`·`stopped` 줄의 seq다.
    - `handoff` 실행(`handoff`가 null이거나 `stopped`면 하지 않는다):
      - `unresolved`가 있으면 그 이유로 `not_handed` 줄을 남기고 `HandResult`는 `not_handed`다.
      - `delivery`가 있으면 `routerFor(tx)`로 `router.route(tx, { from:{kind:"program"}, to, reply:"none", body, refs:[], reply_to:null, dedup:null, options:null, kind:"step", delivery:"next_turn", step:{instance, step}, unattended:true })`를 부른다.
      - `RouteResult.state`로 가른다. `done`(전달됨, `reply: none`이라 바로 끝난다)과 `accepted`(입력함에 쌓임)는 받은 session(`result.session`)으로 `handed` 줄을 남기는 경우고, `failed`(Router가 `ok`로 돌려주는 `not_found`·`closed`)는 `not_handed`(reason `unresolved`, message는 `FAILURE_TEXTS[fail_reason]`) 줄이다. `handed` 줄을 남기면 `current = { step, human_turn }`으로 한다. `ended`였다면 이때 `state: running`, `finished_at: null`이 된다. `not_handed`면 `ended`는 그대로다.
      - Router가 `err`를 돌려주면 그 `err`를 그대로 올린다. tx 전체가 되돌아가므로 줄도 상태도 남지 않고, 부른 쪽이 오류 code를 받는다.
    - 거절: `compare.state_seq`가 지금 instance와 다르면 `conflict`, 없는 instance는 `not_found`, id가 이미 있는 `create`는 `conflict`, machine이 아닌 자격은 `forbidden`이다.
    - 한 command는 instance 행을 한 번만 고친다(`state_seq`가 한 번 오른다). commit 뒤 `afterCommit.push("workflows.changed", { instance, project, workflow })`를 한 번 낸다. 이 topic을 Bus event `WorkflowInstanceChanged`로 바꾸는 것은 `wf-service`의 wiring이다.

## 할 일

1. **`commands.ts`: `createWorkflowCommands(router = routerFor)`.** `{ create, apply }`를 낸다(`runs/commands.ts` 꼴). `router`는 `(tx) => Result<Router>`고 test가 대역을 넘기는 자리다(기본은 `routerFor`). `WORKFLOW_CHANGED_TOPIC = "workflows.changed"`를 export한다. 두 handler 모두 먼저 machine이 아니면 `forbidden`이다.
   - **`create`.** id가 있으면 `conflict`. `insertInstance`(`current` null)로 행을 넣고, `started` 줄(`step`은 `handoff.step`, 글은 입력 `input`, `by`는 `started_by`)을 남기고, `handoff`를 실행하고(`cause: start`), 행을 한 번 갱신하고, event를 낸다. 결과 `{ instance, handed }`.
   - **`apply`.** instance를 읽고(없으면 `not_found`) `compare.state_seq`를 본 뒤(다르면 `conflict`), 메모리의 `draft`(`state`, `current`, `steps`, `finished_at`)에 변화를 모아 계약의 전이대로 줄을 남기고, 끝에 `updateInstance`를 한 번 부르고, event를 낸다. 결과 `{ instance, line, handed }`.
   - **`edit`의 step 고치기.** `add_step`은 같은 이름이 있으면 `conflict`, `after`가 있는데 없는 step이면 `not_found`, 빠진 칸은 `with: null`, `in`·`out`: `""`, `next`: `[]`로 채우고 `after` 다음(없으면 맨 끝)에 넣는다. `update_step`은 없는 이름이면 `not_found`, `patch`에 준 칸만 덮는다(`with: null`은 비운다). `remove_step`은 없는 이름이면 `not_found`다. 가리키는 이름이 있는지(`by`·`with`·`next`)와 지우는 step이 `current`인지는 보지 않는다. 이유: 그런 틀림은 넘길 때 `not_handed` 줄이 되고 고치는 것은 agent의 일이다(README).
   - **검사 순서를 따로 지키지 않는다.** 줄을 남긴 뒤에 `conflict`·`not_found`가 나와도 handler가 `err`를 돌려주면 tx가 통째로 되돌아가 반쪽이 남지 않는다.
   - **`handoff` 실행은 함수 하나(`handOff`)로 둔다.** `create`·`report`·`hand_now`가 같이 쓴다. 계약의 순서대로 `not_handed`/`handed` 줄을 남기고 `draft.current`와 `ended`에서 돌아오는 상태를 갱신한다. Router가 `err`를 주면 그 `err`를 `Result`로 올려 handler가 그대로 돌려준다.
   - 근거: 상태 규칙은 README "끝(`ended`)", "시작과 멈춤"이다. `report`가 `stopped`인 instance에서도 줄은 남기는 이유는 늦게 온 report를 잃지 않으려는 것이다.
2. **`register.ts`.** `createLedgerRegistration()`과 `createReaderRegistration()`을 `runs/register.ts` 꼴로 만든다. `schemaSteps`는 `workflowsSchemaSteps`, `commands`는 `[create, apply]`, `reads`는 `createWorkflowReads()`의 둘, `memoryRoutes`는 `[workflowList, workflowStart, workflowReport, workflowEdit, workflowStop]`이다. `service.ts`를 import하지 않는다(Worker가 싣는 file). 이유: writer Worker는 `TEAM_MODULES`의 `router-registration.ts`를 같이 싣고 거기서 Router 환경이 깔린다. 이 module의 command가 `routerFor`를 쓰므로 둘이 같은 Worker에 있어야 한다.
3. **`commands_test.ts`: 위험 test 하나.** "끝남"을 본다. 준비는 이 file 안에서 작게 한다: in-memory `DatabaseSync` + `workflowsSchemaSteps` + `createSql`(`runs/store_test.ts` 꼴), 최소 `Tx` 대역(`sql`, `now`, `newId`, `port(afterCommit)`), `router_test.ts`의 `setup` 꼴로 port 대역을 세운 진짜 `createRouter`(`transport.deliver`가 받은 입력을 모은다). 준비가 이보다 커지면 만들지 말고 보고한다.

## 정한 것

- **Router `err`는 command 전체의 실패다.** 확인한 것: handler가 `err`를 돌려주면 `runTransaction`이 통째로 rollback하고, ledger SQL은 `savepoint`를 막아(`sqlite.ts`의 `FORBIDDEN_FIRST`) 일부만 되돌릴 수도 없다. Router에서 `err`가 나오는 곳은 이름을 푸는 단계(`resolveAgent`의 모호한 이름, `startSession`의 role·place 불일치)와 배달·기록의 저장소 오류다. 앞의 것은 `wf-service`의 plan이 이름을 형식에 맞게 만들어 거의 나오지 않고, 뒤의 것은 반쪽 쓰기가 남아서는 안 되는 경우다. 그래서 `err`를 `not_handed`로 바꾸지 않는다. 존재하지 않는 담당(`not_found`)과 닫힌 session(`conflict`)은 Router가 `ok`의 `failed`로 돌려주므로 `not_handed` 줄이 된다. 단일 결과: command는 성공해 줄이 남거나, 실패해 아무것도 남지 않는다.
- **`handed` 줄은 Router가 실제로 입력을 넣었을 때만 남고 `ended`가 `running`으로 돌아오는 것도 그때뿐이다.** 근거: 넘기지 못한 고치기가 `ended` instance를 `running`으로 만들면 아무도 일하지 않는 running이 된다.
- **`stop`은 `ended`에도 받는다.** 근거: 사람이 멈춘 instance만 넘기기를 거절하는데(README), 끝난 instance를 사람이 멈춰 되살아나지 못하게 할 수 있어야 한다.
- **`ended` 줄과 `finished_at`은 `running`이었을 때만 쓴다.** 근거: 같은 끝을 두 번 기록하지 않는다.

## 끝남

- `deno task check`가 통과한다.
- 위험 test: "stopped인 instance에는 report에 `next`가 있어도 step 메시지가 나가지 않고 줄만 남는다". `commands_test.ts`의 test 하나(표로 두 경우): (1) `stopped` 전 같은 report가 Router로 입력을 하나 넣는다(비어 있지 않음을 먼저 보여 test가 헛돌지 않게 한다). (2) `stopped` 뒤 `report`+`next`+`handoff`는 `ok`, `handed: null`, 새 입력 없음, 줄은 `report`만 늘었다. (3) 같은 `stopped`에서 `edit`의 `hand_now`는 `conflict`이고 줄도 입력도 늘지 않는다. 이름은 결과 한 문장이다. 판정은 `transport.deliver`로 간 입력과 줄 표로 한다.
- 남지 않음: `grep -rn "TODO" packages/core/workflows/commands.ts packages/core/workflows/commands_test.ts packages/core/workflows/register.ts`가 0줄이다.

## 보고

- 바꾼 file, 통과한 check.
- 등록할 것(lead): `packages/core/workflows/mod.ts`의 export(`createLedgerRegistration`, `createReaderRegistration`, `WORKFLOW_CHANGED_TOPIC`), `packages/core/main/daemon/assembly.ts`의 `TEAMS`·`TEAM_MODULES`에 `register.ts`.
- 안 쓰게 된 export: 없음.
- 정한 것: 위 "정한 것" 밖에 worker가 정한 것.
- 넘길 줄: 남의 file을 맞춘 곳.
- 계약 바꾸기 요청: 계약의 전이나 `HandoffPlan`을 바꿔야 하면 여기에 적는다.
- **무겁게 짠 것**, **알려진 미완 동작**: 없으면 "없음".
