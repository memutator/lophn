# workflow

workflow는 사람, agent, 앱 tool, 앱 event를 비결정적 함수처럼 조합해 돌리는 일이다. project workspace의 session이 정의를 쓰고, 사람·승인된 job·상위 workflow가 instance를 시작하며, lophn은 시작·진행·checkpoint·산출물 참조를 기록하고 화면과 SDK에 그대로 드러낸다. lophn core는 도메인별 통과 판정이나 결과 검증을 하지 않는다.

## 문제

큰 일은 사람과 agent 여럿이 step을 넘기며 돌고, 어떤 일은 결정적 처리·분기·앱 event 제어가 필요하다. 그런데 1단계 workflow는 YAML relay(`kind: agent`)와 코드 실행(`kind: flow`)이 두 engine으로 갈라져 있어 다음 문제가 생겼다.

- 사람과 논의하는 단계(`human`), 앱 tool·event 기반의 동적 worker 선택·교체(예: 구독 한도 앱 event로 worker 변경), sub-workflow 조합을 한 workflow 안에서 함께 쓸 수 없다.
- flow는 단일 process 메모리에만 기대어 lophn 재시작을 넘기면 그대로 종료되고, 반대로 무조건 자동 재실행하면 바깥 효과가 두 번 난다.
- agent 호출의 끝을 "turn 끝"으로만 보면, 하위 worker를 `team spawn`으로 띄워 두고 reply를 기다리며 turn을 마친 세션이 조기 종료되거나, 열린 call이 모두 닫힌 뒤 새 turn 없이 멈추거나, 명시적 report 없이 실패·중단된 세션이 조용히 멈춰(stall) 사람이 알지 못한다.
- workflow와 연결된 세션들(담당 세션, `spawned_by` 자식 worker, 실패 사유, 최근 assistant 발화, 명시적 산출물 경로)의 연결 고리가 없어, Run 화면·instance artifact·title bar desk switcher·앱 SDK가 진행 상태를 드러내지 못한다.
- 실행 cwd가 다른 project인 참가자 세션의 탭이 원 workflow의 desk가 아니라 다른 workspace에 흩어지고, 병렬 worker 탭이 화면을 어지럽힌다.

## 목표와 비목표

- 목표
  - **단일 통합 engine**: programmatic 실행(`flow`)을 기본으로 하고, 코드가 필요 없는 단순 선언은 같은 primitive·checkpoint 위에서 도는 내장 interpreter(YAML 축약형)로 통합한다.
  - **비결정적 함수 + Soft I/O**: `agent`, `human`, `workflow`, `tool`, `onEvent`를 조합하되, output은 자연어 요약과 명시적 산출물 경로(`refs`)가 기본이고 구조화 `data`는 선택으로 둔다.
  - **중복 바깥 효과 없는 Durable 실행**: 시작과 결과를 2단계로 checkpoint해 재시작을 넘기되, 돌던 `agent`·`tool`은 절대 자동 재실행하지 않는다. core가 켜져 있는 동안 `human()` 대기 process는 내려놓지 않는다.
  - **단일 `workflow_origin` 기반 관측·배치**: step을 넘길 때마다 세션에 origin을 기록·갱신하고 `spawned_by` 자식만 상속해, Run 화면·instance artifact·title bar·`@lophn/agent` SDK·Cross-workspace Workflow Desk가 모두 같은 정본을 읽는다.
  - **명시적 실패·stall 드러내기와 사람 복구**: 로컬 non-human step도 명시적 완료 없이 끊기면 `blocked`로 드러내고 `[Open session]`, `[Retry]`(같은 session 이어가기), flow 재개(`[Resume]` 및 `[Resume with updated code]`)를 제공한다.
- 비목표(일부러 하지 않는 것)
  - 도메인별 step 통과 판정, 결과 검증, 비즈니스 규칙의 core 내장. lophn program은 최대한 약하게 둔다.
  - workflow output의 강제 정량 스키마화.
  - 산출물 파일의 자동 감시·확장자(`.md`) 기반 추정 수집(무엇이 산출물인지 lophn이 판정하지 않는다).
  - 최근 assistant message의 LLM 요약(추가 모델 호출·비용 없음. 앞 160자 평문 절단만 쓴다).
  - 모든 workflow instance에 상시 coordinator agent를 시스템이 강제 배정하기.
  - 재시작 시 돌던 `agent`·`tool`의 자동 재실행.
  - 재시작을 넘어 영속 event를 기다리기(`job`의 비영속 event 원칙과 일관).
  - 사람의 임의 "step 옮기기" 단추(사람은 그 agent에게 말한다), workflow 기본 화면의 graph 그리기(필요하면 artifact가 그린다).
  - workflow 파일 안의 일회용 agent 정의, unattended approval 규칙 변경, 비용 상한 강제 차단.

## 모델

```
 사람: 화면(StartBox 폼, Run 화면, [Retry], [Resume], [Stop]) | CLI           user 자격
 agent: tool workflow.list | get | report | edit | check                      agent 자격
 job: scheduler가 core 안에서 시작 (주기 · 앱 event · session event)          machine 자격
 상위 workflow: workflow() primitive로 같은 project 안 sub-workflow 시작      core 안 자격
   │  route ListWorkflows | StartWorkflow | ReportWorkflow | EditWorkflow
   │        RetryWorkflowStep | ResumeWorkflow | StopWorkflow | CheckWorkflow
   │        ReadWorkflowInstance | ListWorkflowInstances | WorkflowInstanceActivity
   ▼
 workflows (선언·inputs 검증, code snapshot, derived_status 계산, redaction)
   ▼
 CreateWorkflowInstance | ApplyWorkflowChange | UpsertWorkflowCheckpoint      한 transaction
   │  workflow_instances(저장 상태: running|ended|stopped, inputs_json, code_snapshot)
   │  workflow_lines(append-only 이력, 13종)
   │  workflow_checkpoints(key별 started|completed|failed|interrupted)
   │  sessions.workflow_origin ← 로컬 step/agent/human 넘길 때마다 기록·갱신 (spawned_by 자식만 상속)
   └ commit 뒤 StateChanged(workflow_instances) ─▶ Run 화면, DeskSwitcher, artifact view 갱신

 단일 실행 engine (instance마다 하나)
   ├─ flow code 있음 ─▶ flow process (stdin/stdout JSON 줄, code snapshot 실행; core 생존 중 유지)
   └─ flow code 없음 ─▶ 내장 YAML interpreter (같은 primitive·checkpoint 사용)
        primitive: step(key, fn) | agent(mode, signal) | human | workflow | tool | onEvent | report | escalate
        SDK helper(core 밖): withFallback (공통 reason 기반 on-demand fallback agent)
```

### 핵심 개념

- **workflow 정의**: `<data>/projects/<prj>/workflows/<name>/` 폴더 하나. 선언(`workflow.yaml`), 사람·agent용 설명(`workflow.md`), 선택적 flow code, 선택적 artifact(`artifacts/static`, `artifacts/instance`)로 구성된다.
  - 선언은 `inputs`(선언적 입력 스키마), `outputs`(반환 설명·선택 schema), `participants`, `agent`(flow의 앱 tool creator), `steps`를 가진다. `kind: agent | flow` 구분은 제거하고 폴더의 flow code 유무로 실행 모드를 결정한다.
- **`workflow_origin`**: 세션이 어느 workflow instance와 step에 속하는지 나타내는 단일 정본 `{ project, workflow, instance, step }`.
  - workflow의 `agent()`·`human()`·YAML step 입력을 로컬 세션에 **넘길 때마다** 같은 transaction 안에서 기록·갱신한다(`session: same`으로 같은 세션이 다음 step을 받으면 `step`이 최신 값으로 갱신된다).
  - 그 세션이 `team spawn`으로 띄운 자식(`spawned_by`, lophn session·GUI 팀원 session)은 생성 시점의 부모 `workflow_origin`을 상속한다.
  - `fork`나 이미 열려 있던 다른 세션에 일반 `agent call`로 말을 건 경우, 그리고 다른 컴퓨터로 보내는 `--on` mail step에는 기록·상속하지 않는다.
- **Soft I/O**:
  - 입력: `StartWorkflow`는 구조화 `inputs`(선언적 폼/호출 인자 JSON)와 요약/자유 글 `text`(flow에서는 `input`)를 받는다. `inputs` 선언이 없는 workflow는 기존처럼 시작 입력 글만 받는다.
  - 출력(`SoftOutput`): `{ summary: string, refs?: string[], data?: unknown }`. `summary`는 자연어 요약, `refs`는 agent가 명시적으로 report/output에 담은 파일 경로 목록, `data`는 선택적 JSON 값이다.
- **실패 값 모양 (`Outcome<T>`)**:
  - `@lophn/flow`의 모든 primitive 반환 모양은 하나로 통일한다: `{ ok: true, result: T } | { ok: false, reason, message, session? }`.
  - 경계(route, command, protocol)는 기존 공통 오류 코드 일곱(`invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`, `internal`)만 유지하고 늘리지 않는다.
  - `Outcome`의 `reason`은 경계 오류 코드 일곱과 실행 사유 넷(`cancelled`, `interrupted`, `stalled`, `model_error`)으로 구성된다. `session`은 끊기거나 실패한 대상 세션이 있을 때 그 session id를 싣는다.
- **저장 상태 vs 계산 상태**:
  - 저장 상태(`workflow_instances.state`): **`running | ended | stopped`** 셋만 둔다.
  - 계산 상태(`derived_status`, 읽을 때 `workflow_lines`, `workflow_checkpoints`, 연결된 세션의 live 상태, 원격 step 상태에서 계산):
    - `working`: 실행 중이며 막히거나 사람을 기다리지 않는다.
    - `needs_you`: 연결된 활성 세션의 approval/question 대기, `human` 대기(`human_turn` 또는 `started`인 `human` checkpoint), `escalated` 줄 대기, 또는 원격 step의 late mail `held` 중 하나 이상이 있다.
    - `blocked`: 로컬/원격 non-human step의 `step_stalled`, `not_handed`, `lophn_restarted` 끊김, 미처리 `interrupted` checkpoint, 처리되지 않은 flow 예외/`program_exited` 비정상 종료로 진행이 멈춰 있다.
    - `ended` / `stopped`: 저장 상태 그대로다.
- **줄 열세 종류 (`workflow_lines`)**: `started`, `report`, `edit`, `handed`, `not_handed`, `ended`, `stopped`, `lophn_restarted`, `program_exited`, `step_stalled`, `retried`, `escalated`, `code_updated`.
- **checkpoint (`workflow_checkpoints`)와 key 규칙**:
  - durable 실행의 정본이다. `(instance, key)`마다 `kind`(`step | agent | human | workflow | tool`), `state`(`started | completed | failed | interrupted`), `handle_ref`(session id, 자식 instance id, invocation id, 원격 call id), `output_json`, `error_json`, `started_at`, `finished_at`을 가진다.
  - **`step(key, fn)`의 `key` 명시는 필수다**(예: `step("review-1", ...)`, `step("research-orca", ...)`). 그 `step` 안에서 순차 호출되는 primitive만 `AsyncLocalStorage`로 격리된 `step` 내부 순번(`${key}/${kind}#${n}`)을 자동 부여받는다. `step` 밖에서 명시적 `key` 없이 `agent`·`human`·`workflow`·`tool`을 부르면 즉시 오류를 던진다. `Promise.all`처럼 순서가 비결정적인 병렬 호출은 각 항목을 고유 `step(key, ...)`로 감싸거나 명시적 `key`를 부여한다.
  - `workflow_checkpoints`는 며칠 묵은 instance에 남는 저장 데이터이므로, SDK·통로 모양이 바뀔 때 기존 저장 checkpoint를 새 모양으로 옮기는 ledger migration 규칙이 적용된다.
- **`agent()` 완료 조건, `stall`, `cancel`**:
  - `mode: "turn"`(단발 기본): 해당 호출이 연 turn이 `completed`로 끝나고 그 세션이 보낸 열린 outgoing `agent_calls`(`ask` 제외)·대기 중 미소비 입력·실행 중인 후속 turn이 모두 없을 때 마지막 assistant 응답을 `SoftOutput`으로 반환한다. 열린 `agent_calls`나 대기 입력이 남아 있으면 정산·후속 turn까지 대기하되, **열린 call이 모두 닫혔는데(실패·전달 실패 포함) 짧은 grace window 안에 후속 turn이 시작되지 않고 끝난 경우** `{ ok: false, reason: "stalled", session, message }`로 종료해 영구 대기를 막는다. turn이 `failed`·`interrupted`로 끝나면 정확한 `reason`과 `session`을 담은 실패 `Outcome`을 반환한다.
  - `mode: "report"`(복합 step·YAML 축약형 기본): 해당 세션이 `workflow.report`로 명시적 완료를 낼 때 종료한다. 명시적 완료 없이 turn이 끝났고 열린 outgoing `agent_calls`·대기 중 미소비 입력·이미 열린 후속 turn이 모두 없으면 `step_stalled` 줄을 남긴다(사람 step은 제외하고 같은 넘김/retry 시도당 최대 1회).
  - **cancel**: `signal`(`AbortSignal`)이 취소되면 core가 해당 실행(turn 중단, 열린 tool/자식 workflow/원격 call 취소)을 멈추고 `{ ok: false, reason: "cancelled", message, session? }`를 돌려준다.
- **`human()`**: 사람-agent 대화 step primitive다. `with` 참가자 세션에 `workflow_origin`과 `human_turn = true`로 입력을 넣고 checkpoint를 `started`로 남긴다. 사람이 그 세션에서 논의해 해당 agent가 `workflow.report`로 완료를 내면 checkpoint가 `completed`가 되고 `SoftOutput`을 돌려받는다. 사람 step은 stall 판정 대상에서 제외한다.
- **`workflow()` (sub-workflow 호출)**: 같은 project 안의 다른 workflow를 비동기 함수처럼 호출한다. 자식 instance의 `started_by`는 `{ kind: "workflow", instance: <부모> }`이며, 자식이 `ended`되면 최종 `SoftOutput`(마지막 `report` 줄 우선, 없으면 마지막 완료 checkpoint의 `SoftOutput`)을, `stopped`되면 `{ ok: false, reason: "cancelled", message }`를 돌려받는다.
- **`onEvent()`**: 실행 중인 flow가 앱 event 또는 lophn session event를 구독한다. `job`의 event 규칙과 동일하게 **비영속**이다(저장·재전송하지 않음). process가 살아 있는 동안 이 기계에서 도착하는 event에만 반응하며, 재시작 뒤 현재 상태가 필요한 값은 `tool()`로 다시 조회한다.
- **`[Retry]`와 `[Resume]`의 분리**:
  - `RetryWorkflowStep` (`[Retry]`): **같은 session에 이어서 하라는 입력을 넣는 동작** 하나로 통일한다(YAML 축약형과 flow의 막힌 step 공통). 아직 세션이 열리기 전(`not_handed`)인 경우에만 넘기기를 다시 시도한다. 새 session으로 처음부터 다시 하는 것은 flow 코드나 agent의 일이다.
  - `ResumeWorkflow` (`[Resume]` / `[Resume with updated code]`): flow process가 처리되지 않은 예외·`interrupted`·코드 버그로 멈춘(`blocked`) `running` instance의 flow process를 다시 띄워 replay로 이어간다. 기본은 시작 시점 code snapshot을 쓰고, 사람이 명시적으로 `use_latest_code: true`를 고르면 현재 최신 flow code로 snapshot을 갱신하고 `code_updated` 줄을 남긴 뒤 완료된 checkpoint를 건너뛰며 이어간다.
- **SDK `withFallback` helper**: core 밖(`@lophn/flow`)의 helper다. 실패한 `Outcome`(공통 `reason`·`message`·`session`)과 문맥을 fallback agent에게 넘겨 `retry | substitute | throw | escalate` 중 하나의 결정을 받아 이어간다.

## 지키는 것

### 정의와 선언
1. 정의는 `<data>/projects/<prj>/workflows/<name>/`에 둔다. `<name>`은 slug이고 신원은 `(project id, name)`이다. `<project 이름>/<name>`(key)은 보이는 이름일 뿐이고 도착할 때 project id로 푼다(이름이 여럿이면 `invalid_input`, 없으면 `not_found`). flow code는 같은 폴더의 다른 file을 상대 경로로 import할 수 있다.
2. 선언은 `inputs`, `outputs`, `participants`, `agent`, `steps`의 정의된 칸만 읽고 나머지 칸은 보존한다(non-strict). `kind` 칸은 제거하되, 기존 선언에 남아 있으면 보존·무시하고 폴더의 flow code 유무로 실행 모드를 판정한다. step 이름 `end`는 예약이다(`next` 안의 끝). 선언 읽기에서는 형식만 보고 `by`·`with`·`next`의 참조 대상 유무는 넘길 때 판정한다(`not_handed`).
3. flow code가 없으면 `participants`와 비어 있지 않은 `steps`가 있어야 한다(YAML 축약형). flow code가 있으면 `steps`는 화면 표시와 report 자리표시용으로 선택이다.
4. `inputs` 필드 타입은 `string`, `text`, `number`(`min?`, `max?`), `boolean`, `select`(`options`), `multiselect`(`options`), `agent`, `path`(`kind?: file | dir | any`), `project` 아홉이고, 조건부 표시·검증 규칙 `when`을 가질 수 있다. `when`은 `{ field, equals }`, `{ field, in: [...] }`, `{ field, truthy: true | false }` 단일 조건 또는 AND 배열이다. 조건이 거짓인 숨겨진 필드는 required 검사에서 제외되고 검증 결과에서 생략된다. 알 수 없는 대상·자기 참조·의존 cycle·잘못된 기본값은 선언 검증(`invalid_inputs`)에서 거절된다. `agent` 필드는 시작 시점의 workspace에서 호출 가능한 agent 목록(`ListWorkflows`의 `callable_agents`)으로 채운다. 필드의 선택 칸 `steps`(step 이름 목록)는 그 입력을 쓰는 step을 적는다. 시작 화면이 그 step 자리에 칸을 둘 뿐이고 값의 검증·전달과는 상관없다(이름이 선언의 step인지 검증하지 않는다).
5. YAML 축약형에서 입력된 `inputs` 값은 첫 step 입력 본문의 `Inputs:` 절에 구조화된 key-value로 주입된다. 시작 입력·`inputs`·step 본문·report/`hand_now` 글·`refs`·`data`·checkpoint `output`/`error`·`step_stalled` 오류·`retried` 본문은 저장·전달 전에 redaction을 거친다.
6. 틀린 선언은 그 workflow만 목록에서 빼고 `ListWorkflows`의 `problem`(`no_declaration | invalid_yaml | invalid_declaration | invalid_inputs | no_flow_file | broken_flow`)에 첫 이유 하나를 싣는다.
7. 목록의 step에는 `prompt`·`in`·`out`을 싣지 않는다(캡슐화 유지). step 메시지는 `<lophn-step instance="…" step="…">본문</lophn-step>`과 고정 영어 안내 줄(`lophn team spawn` 권장·`lophn workflow report` 안내)로 전달되며 rewind 시점(checkpoint)이 된다. non-human step은 `unattended` turn을 열고, 사람 step(`human_turn: true`, `by: me`·`human()`)은 첫 turn부터 `ask`와 사람 승인이 동작하도록 `attended` turn을 연다.

### instance, 상태, 줄, checkpoint
8. 정본은 `workflow_instances`, `workflow_lines`, `workflow_checkpoints` 세 표다. 쓰기는 core 안 machine 자격 command(`CreateWorkflowInstance`, `ApplyWorkflowChange`, `UpsertWorkflowCheckpoint`)만 수행한다. 한 command는 instance 행을 한 번 고치고(`state_seq` 비교·재시도 최대 3회) commit 뒤 `StateChanged(workflow_instances)`를 한 번 낸다.
9. `workflow_lines`는 고치지도 지우지도 않는다(trigger 유지). `workflow_instances.state`는 `running | ended | stopped` 셋뿐이고 `needs_you`·`blocked`는 읽을 때 계산한다.
10. 시작 주체는 사람(`StartWorkflow`, user 자격), 승인된 `job`(core 안, `workflow_start`가 `inputs`도 함께 저장·전달), 실행 중인 같은 project의 상위 `workflow`(core 안) 셋뿐이다. 일반 agent 대화에서는 workflow를 시작하지 못한다. `started_by`는 `{ kind: "user" } | { kind: "job", job } | { kind: "workflow", instance }`다. job이 시작한 instance의 job run은 instance 상태를 따라 닫힌다(`architecture/job.md`).
11. instance는 시작 시 선언의 참가자·step·정규화된 `inputs` 값과, flow code가 있으면 **시작 시점의 code snapshot(workflow 폴더 source file들의 content-addressed permanent blob manifest, `artifacts/`·`node_modules/`·symlink 제외)**을 고정해 가진다. 실행 도중 정의나 flow code가 바뀌어도 사람이 `ResumeWorkflow(use_latest_code: true)`를 명시적으로 고르기 전까지는 시작 시점 snapshot으로 replay한다.
12. `ended`는 완료 기록일 뿐이다(YAML 축약형의 `hand_now`나 report가 실제로 넘기면 다시 `running`이 될 수 있다). `stopped`는 사람이 멈춘 최종 상태이며, `StopWorkflow`는 해당 instance와 모든 실행 중인 자식 sub-workflow instance를 연쇄로 `stopped`로 닫고 관련 turn·in-flight primitive·flow process·원격 step call을 중단한다. 멈춘 instance의 `EditWorkflow`와 재중지는 `conflict`로 거절하고, 늦게 온 report는 줄만 남기고 넘기지 않는다.
13. `workflow_checkpoints`는 `(instance, key)`마다 시작 시점(`started` + `handle_ref`)과 완료/실패/중단 시점(`completed | failed | interrupted`)의 2단계로 기록한다. `step(key, fn)`의 `key` 명시는 필수이며(`step` 밖에서 명시적 `key` 없이 primitive를 부르면 즉시 던짐), 이미 `completed` 또는 `failed`인 key는 replay가 저장된 결과를 그대로 돌려주고 바깥 호출을 다시 실행하지 않는다. YAML 축약형 내장 interpreter도 넘김·report·재시작·retry마다 `workflow_checkpoints`를 함께 기록한다.
14. `workflow_checkpoints`의 `output_json`·`error_json`과 flow 통로 저장 모양이 바뀌면, 기존 저장된 checkpoint를 새 모양으로 옮기는 ledger migration을 같은 변경에 포함한다.

### `workflow_origin`과 관측
15. `sessions.workflow_origin`은 `{ project, workflow, instance, step }`이다. workflow가 로컬 step/`agent()`/`human()`으로 세션에 입력을 **넘길 때마다** 같은 transaction에서 기록·갱신한다(`session: same`으로 다음 step을 받으면 `step`이 최신으로 갱신된다). 원격 `--on` mail step에는 기록하지 않으며, `workflow_origin`에는 불변 trigger를 두지 않는다.
16. `team spawn`(`spawned_by`)으로 생성된 자식 세션(lophn session·GUI 팀원 session)은 생성 시점의 부모 `workflow_origin`을 자동으로 상속한다. `fork`와 이미 열려 있던 세션으로의 일반 `agent call`은 기록·상속하지 않는다.
17. `ReadWorkflowInstance`는 `instance`, `derived_status`, `last_reports`, `lines`(200개씩 cursor 페이지), `checkpoints`, `sessions`(해당 instance의 `workflow_origin`을 가진 세션 트리: `session`, `parent`, `agent`, `workspace`, `step`(`workflow_origin.step`), `state`, `waiting_for`, `last_assistant_preview`, `last_error`), `refs`(명시적 report/output 파일 경로 목록), `children`(자식 sub-workflow 요약과 자식별 `derived_status`), `remote_steps`를 돌려준다. `derived_status`와 `refs`는 200줄 cursor 페이지가 아니라 표의 전체 이력에서 직접 계산한다. `ListWorkflowInstances`는 project(와 workflow, state)로 거르고 새것이 앞이며 50개씩, 마지막 줄과 `derived_status`를 붙인다.
18. 최근 assistant message 미리보기(`last_assistant_preview`)는 마지막 assistant 텍스트의 앞 160자 평문 절단이며 LLM 요약을 호출하지 않는다. 자르기 전에 known-secret redaction을 먼저 적용해 경계에 걸친 secret 앞부분 유출을 막고, 알려진 secret 목록이 아직 준비되지 않았으면 `null`로 fail-closed한다. `refs`는 agent가 명시적으로 report/output에 기재한 파일 경로만 중복 없이 순서대로 모으며 파일 시스템 자동 감시·확장자 필터링을 하지 않는다.
19. `@lophn/agent`(1.17.0 이상) SDK의 `SessionInfo.workflow`는 `sessions.workflow_origin`을 검증해 그대로 투영한다. `workflow_origin`이 없는 일반 세션(및 `terminal` session으로 노출되는 GUI 탭 세션)은 `null`이다.

### `agent()` 완료, stall, 실패 사유, `[Retry]`·`[Resume]`
20. `agent()`는 열린 outgoing `agent_calls`(`ask` 제외)·대기 중 미소비 입력·실행 중인 후속 turn이 남아 있는 동안 turn 종료만으로 완료 처리하지 않는다. `mode: "turn"`에서 열린 call이 모두 닫혔는데(실패·전달 실패 포함) 짧은 grace window 안에 후속 turn이 시작되지 않고 끝난 경우 `{ ok: false, reason: "stalled", session, message }`로 종료한다.
21. `mode: "report"`(YAML 축약형 non-human step 포함)에서 명시적 완료 report 없이 turn이 끝났고 열린 outgoing `agent_calls`·대기 중 미소비 입력·이미 열린 후속 turn이 모두 없으면 `step_stalled` 줄을 남기고 계산 상태를 `blocked`로 올린다(로컬 YAML step은 `TurnEnded` commit 뒤 세션별 직렬화 구독으로 기록). **사람 step(`human` / `by: me`)은 stall 판정에서 제외하고, 같은 넘김/retry 시도(attempt)당 `step_stalled` 줄은 최대 1회만 남긴다**. `step_stalled`·`lophn_restarted`로 막힌 step의 담당 세션에서 사람이 직접 새 turn을 시작하면(GUI 터미널 탭의 직접 입력 포함) 중복 입력 없이 `retried` 줄을 남겨 `working` 상태로 즉시 복구하고, 그 turn이 다시 report와 열린 outgoing `agent_calls`·후속 입력 없이 끝나면 새 시도에 대해 `step_stalled`를 기록한다.
22. harness 또는 lophn agent turn이 실패하면 redaction된 오류 메시지와 정확한 `reason`(경계 오류 코드 일곱 또는 `cancelled | interrupted | stalled | model_error`)을 turn/checkpoint/`step_stalled` 줄에 보존한다. 모든 실패를 `model_error` 하나로 뭉개지 않는다.
23. `RetryWorkflowStep`(user 자격만)은 `running` 상태이면서 계산 상태가 `blocked`인 step에만 허용된다(`stopped`나 정상 `working` 중이면 `conflict`). `retried` 줄을 남기고, 기록된 session이 있으면 `fallback: new` 없이 **그 같은 session에만 이어서 진행하라는 입력을 넣는다**(닫힌 session이면 transaction 전체를 `conflict`로 되돌려 조용히 새 session을 열지 않는다). 아직 session이 열리기 전(`not_handed`)인 경우에만 넘기기를 다시 시도한다.
24. `ResumeWorkflow`(user 자격만)는 flow process가 종료돼 `blocked` 상태인 `running` flow instance의 process를 다시 띄워 replay로 이어간다. `use_latest_code: true`가 주어지면 현재 workflow 폴더의 최신 flow code로 `code_snapshot`을 갱신하고 `code_updated` 줄을 남긴 뒤 replay한다.

### Durable 실행, process 수명, 재시작 복구
25. core가 켜져 있는 동안 `human()`·`escalate()` 대기 중인 flow process는 내려놓지 않는다. durable replay는 core 재시작과 `ResumeWorkflow`에서만 일어난다. core가 꺼질 때는 진행 중 checkpoint를 덮어쓰지 않고 child process·구독·snapshot 임시 폴더만 정리해, 다음 기동 reconcile이 끊김을 확정하게 한다.
26. 켤 때 router가 돌던 turn을 닫은 뒤, `running`인 모든 workflow instance를 2단계로 reconcile한다(1단계: 모든 running instance의 checkpoint·`lophn_restarted` 확정, 2단계: `code_snapshot`이 있는 durable flow instance 재기동 — 부모가 자식 sub-workflow에 재부착할 때 자식이 이미 정리돼 있도록 보장).
27. 재시작 시 `state === "started"`로 남아 있는 checkpoint는 **절대 자동 재실행하지 않는다**:
    - `human`이 사람의 다음 입력을 기다리며 쉬고 있던 상태(turn이 열려 있지 않았음): 끊김으로 치지 않고 `started`(`needs_you`) 그대로 유지한다. replay 시 flow process가 같은 `human` checkpoint에 다시 붙어 report를 기다린다.
    - turn이 돌다가 재시작으로 끊긴 `agent` / `human`과 돌던 `tool`: 모두 `interrupted`로 확정하고 `lophn_restarted` 줄을 남긴다. flow code에는 `{ ok: false, reason: "interrupted", message, session? }` 실패 값으로 돌려준다.
    - 자식 `workflow`: 기록된 자식 instance id에 다시 붙는다.
28. reconcile 2단계에서 `code_snapshot`이 있는 `running` flow instance는 고정된 code snapshot으로 flow process를 다시 띄워 replay한다. `interrupted` 실패 값을 code가 받아 처리하면 그대로 진행하고, code가 처리하지 않고 throw하거나 0이 아닌 종료 코드/신호로 process가 끝나면(`program_exited`, 정상 종료 `code === 0`만 `ended`로 닫음) `running`(`blocked`) 상태로 남아 `[Resume]`으로 이어 갈 수 있다. `code_snapshot`이 없는 구(pre-Phase-4) flow와 YAML 축약형(내장 interpreter)은 자동 재실행 없이 `lophn_restarted`를 남기고 `blocked` 상태로 멈춘다.

### `workflow()` (sub-workflow)와 권한
29. `workflow()` 호출은 **같은 project 안의 workflow만** 허용한다(다른 project 지정은 `forbidden`).
30. 조상 instance chain에 같은 `(project, workflow)`가 있으면 cycle로 `conflict` 거절한다. 최대 중첩 깊이는 5단계다(root 0, child 1..5 허용, 초과 시 `conflict`).
31. sub-workflow 안의 앱 `tool()` 호출은 그 sub-workflow 선언의 creator `agent` 할당을 그대로 사용한다(교집합 제한을 두지 않는다). flow의 앱 tool 호출은 선언의 `agent`(없으면 lophn)의 지금 할당과 비공개 규칙(앱의 비공개 command는 그 앱 workspace만) 안에서만 된다(`architecture/app-call.md`).

### `onEvent`와 `job` 정합성
32. flow의 `onEvent({ source, event, workspace? }, handler)`는 비영속 메모리 구독이다. process가 꺼진 사이의 event는 저장·재전송하지 않으며 이 기계에서 발생한 event만 전달한다. 재시작 replay 시 handler가 변경했던 메모리 변수는 복원되지 않으므로, 현재 상태가 필요한 값은 `tool()`로 다시 조회한다.
33. `onEvent`는 `job`과 공용 event 정책을 사용해 `mayReachWorkspace` 범위 검사(workflow의 project가 source 앱·session workspace에 닿을 수 있어야 함)와 고리 방지 규칙(자기 workflow instance 인과 사슬의 앱 event, 비사람·workflow·job이 연 session event 제외)을 적용한다.

### 원격 참가자(`on: <컴퓨터>`), flow process, 쓰기 범위
34. 다른 컴퓨터의 참가자(`on: <컴퓨터>`, agent 참가자만 가능하며 사람 참가자와 private project는 불가)는 `call` mail(`step: { instance, name }`)과 `reply` mail(`report: { next, session, ended? }`) 기반 규칙(`architecture/machine-a2a.md`)을 단일 engine의 `agent({ on })` 및 YAML step 넘기기에서 그대로 유지한다.
    - `on`은 넘길 때마다 풀며(미등록·모호·자기 기계면 `not_handed` `unknown_computer`), 보낸 컴퓨터에 보낸 쪽 program인 `agent_calls` 행과 `handed` 줄(`receiver: null`, `remote: { machine, computer, call }`)을 남기고 `ReadWorkflowInstance`의 `remote_steps`로 배달 상태(`pending | unknown | held | running`)와 실패 사유를 드러낸다.
    - 받는 컴퓨터는 step 입력으로 넣고 본문 앞에 다른 컴퓨터 출처 고정 줄을 붙인다. report는 같은 `workflow.report` 명령으로 그 step을 받은 session만 낼 수 있으며(`next`가 있는 report는 call을 닫고 1회만), 시작한 컴퓨터는 한 transaction에서 `ApplyWorkflowChange`로 적용한다(`by: remote`).
    - 원격 step이 report 없이 닫히면 `not_handed`(`remote_failed`) 줄을 남긴다. 가져간 뒤 그 컴퓨터의 turn이 실패·중단·재시작으로 끝나면 step을 닫지 않고 그 컴퓨터의 program이 `report.ended`(`failed | stopped | restarted`) 진행 줄을 보내 시작한 컴퓨터에 `by: remote_lophn` report 줄로 남긴다. `StopWorkflow`는 열린 원격 step call을 취소한다.
35. 쓰기 범위·실행 제약·안전 규칙을 유지한다:
    - `<data>/projects/<prj>/workflows/`는 그 project workspace의 session만 file tool로 읽고 쓰며(rewind 쓰기 범위 동일, `architecture/workspace-session.md`), workspace 정보의 `Workflows folder:`로 절대 경로를 제공한다.
    - report 글과 `hand_now` 글은 UTF-8 8 KiB 이하다(긴 결과는 file에 두고 경로를 `refs`나 글에 쓴다). 시작 입력에는 이 한도가 없다.
    - flow process는 Electron의 Node로 설치된 `@lophn/flow`(v2.0.0, `<data>/sdk/flow/<판>`)의 진입 file을 띄우고, code snapshot은 `<data>/projects/.flow-snapshots/<instance>-<runId>/`에 복원해 실행한다(`<data>/projects/node_modules/@lophn/flow` symlink로 SDK 해석). V8 heap 한도는 512 MiB(`--max-old-space-size=512`), 환경은 `HOME`·`PATH`·`XDG_CACHE_HOME`뿐이며 credential을 넘기지 않는다.
    - SDK 진입 file이 `stdout` write를 `stderr`로 돌려 통로 오염을 막고, `stderr`는 줄마다 redaction을 거쳐 `<data>/flows/<instance>.log`(1 MiB 상한)에 쌓이며 `program_exited` 줄에 끝 code와 stderr 끝 10줄(줄당 500자)을 남긴다. 깨진 JSON·id 누락·1 MiB 초과 줄은 process를 끝내고, 읽히지만 칸이 틀린 요청은 `invalid_input` 실패 값으로 답한다.
    - agent가 쓴 flow code는 `workflow.check`(`CheckWorkflow`, project workspace 전용)로 설치된 `@lophn/flow`에 대고 실행 없이 type check·erasable 문법 검사를 돌린다.

## 경계와 계약

- **boundary**: `workflows`, `jobs`, `lophn-agent`(세션 `workflow_origin`), `coding-agent`(GUI 탭 배치·실패 사유 보존), `attention`(unseen·알림). `workflows` module은 다른 feature module을 직접 import하지 않고 port와 공용 바닥 module로만 닿는다(`architecture/layers.md`).
- **route (memory / read)**:
  - `ListWorkflows`(user·agent, `callable_agents` 포함), `StartWorkflow`(user만, `inputs` 객체 추가), `ReportWorkflow`(user·agent, `refs`·`data` 선택 칸 추가), `EditWorkflow`(user·agent, YAML 축약형 전용), `RetryWorkflowStep`(user만, 같은 session 이어가기), `ResumeWorkflow`(user만, `use_latest_code?`), `StopWorkflow`(user만, 자식 연쇄 중지), `CheckWorkflow`(agent, project workspace 전용), `ExportWorkflow`(user, workflow 폴더의 파일 묶음 내보내기), `ImportWorkflow`(user, 대상 project의 workflows 폴더에 묶음 쓰기·선택적 덮어쓰기).
  - 읽기 route: `ReadWorkflowInstance`(user·agent·machine, `instance`, `derived_status`, `last_reports`, `lines`, `checkpoints`, `sessions`, `refs`, `children`, `remote_steps`), `ListWorkflowInstances`(user·agent, `derived_status` 요약 포함), `WorkflowInstanceActivity`(machine, idle-exit용).
  - 모든 경계 route·command 오류는 공통 오류 코드 일곱(`invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`, `internal`)만 사용한다.
- **agent tool / CLI**:
  - `workflow.list` / `workflow.get` / `workflow.report`(`--next`, `--session`, `--refs`, `--data`) / `workflow.edit`은 모든 workspace 종류의 agent와 CLI가 같이 쓴다. `workflow.check`는 project workspace 전용이다.
  - user 전용 CLI 명령: `lophn workflow start <workflow> <text>`(`--step`, `--inputs <json>`), `lophn workflow retry <instance> [step]`, `lophn workflow resume <instance> [--latest-code]`, `lophn workflow stop <instance>`.
  - 내장 지침: project workspace의 `write-workflow` skill, SDK 판 올림 메모 `migrate-sdk`.
- **event**:
  - `StateChanged(workflow_instances)`: instance·줄·checkpoint·연결 세션의 주요 상태 전이 시 발행. Run 화면, `DeskSwitcher`, artifact view가 다시 읽는다.
  - `TurnEnded`(commit 뒤) 및 router의 outgoing `agent_calls` 정산 알림: 로컬 step stall 감지와 통합 `agent()` primitive가 구독한다.
- **저장 (ledger migration & blob)**:
  - `workflow_instances`: `inputs_json`, `code_snapshot`, `open_mode`, `title` 열 포함(기존 행은 null). `workflow_instance.code_snapshot` permanent blob field 등록(`workflow_snapshot` purpose). `StartWorkflow`에 선택 `title`을 넘기면 그 값을 그대로 저장하고 AI 제목 생성을 건너뛴다. 비워 시작하면 입력 첫 60자(또는 첫 문자열 input)로 초기 `title`을 적고, `agent-runtime`이 전역 기본 model(`model-default`)로 2~6단어 AI 제목을 생성해 `SetWorkflowInstanceAiTitle`로 반영한다(그 사이 사람이 `RenameWorkflowInstance`로 이름을 바꿨으면 덮어쓰지 않는다).
  - `workflow_lines`: `kind` 13종(`started`, `report`, `edit`, `handed`, `not_handed`, `ended`, `stopped`, `lophn_restarted`, `program_exited`, `step_stalled`, `retried`, `escalated`, `code_updated`), 고치기와 지우기를 막는 append-only trigger 유지.
  - `workflow_checkpoints`: `(instance, key)` PK, `kind`, `state`, `handle_ref`, `output_json`, `error_json`, `started_at`, `finished_at`, `workflow_checkpoints_instance` 인덱스. 저장 데이터이므로 이후 모양 변경 시 ledger migration 필수.
  - `sessions`: `workflow_origin` JSON 열(`{ project, workflow, instance, step }`, nullable) + `(workflow_origin ->> '$.instance')` partial 인덱스. step 입력의 `messages` 열(`step_instance`, `step_name`).
  - 파일 저장: 정의 `<data>/projects/<prj>/workflows/<name>/`, flow stderr log `<data>/flows/<instance>.log`, 실행 시 snapshot 임시 폴더 `<data>/projects/.flow-snapshots/<instance>-<runId>/`.
- **flow 통로 (`@lophn/flow` 2.1.0 ↔ core stdin/stdout JSON 줄, 상한 1 MiB)**:
  - core → process: `start`(`instance`, `input`, `inputs?`, `checkpoints?`), `response`(`id`, `outcome`: `{ ok: true, result }` | `{ ok: false, reason, message, session? }`), `event`(`subscription_id`, `source`, `event`, `payload`).
  - process → core: `step_begin` / `step_end`(`key` 필수), `agent`(`key`, `agent`, `prompt`, `input?`, `schema?`, `mode?`, `session?`, `open?`, `step?`, `on?`, `cancel_id?`), `human`(`key`, `with`, `prompt`, `input?`, `step?`, `session?`, `open?`, `cancel_id?`), `workflow`(`key`, `workflow`, `input?`, `inputs?`, `cancel_id?`), `tool`(`key`, `app`, `tool`, `input?`, `cancel_id?`), `cancel`(`cancel_id`), `subscribe`(`subscription_id`, `source`, `event`, `workspace?`) / `unsubscribe`(`subscription_id`), `report`(`step`, `text`, `refs?`, `data?`, `next?`), `escalate`(`step?`, `reason`).
  - SDK 공개 API(`@lophn/flow` 2.1.0): `input`, `inputs`, `instance`, `step`, `agent`, `human`, `workflow`, `tool`, `onEvent`, `report`, `escalate`, `withFallback`.
  - **session 열기 방식(`open: "tab" | "background"`)**: `StartWorkflow`의 run 덮어쓰기(`open`·`step_open`) → 선언 `steps.<name>.open` / `agent({ open })` / `human({ open })` → `participants.<key>.open` → `human` step 기본(`"tab"`) → agent 정의 `open` → 내장 기본(내장 coding agent `"tab"`, 그 밖 `"background"`) 순으로 결정한다. `"tab"`이면 project harness agent(custom harness 포함, 해당 agent의 `harness_config`·`deny` 적용)는 workflow desk에 GUI 터미널 탭(`harness_gui = 1`)을, `lophn`·`custom` agent는 workflow desk에 Agent 탭을 연다. `"background"`이면 탭을 자동으로 열지 않고 뒤에서 돌린다.
- **SDK (`@lophn/agent`)**:
  - `SessionInfo`에 선택적 `workflow?: { project, workflow, instance, step } | null` 추가(1.17.0).
- **artifact (`artifacts/static`, `artifacts/instance`)**:
  - 봉한 view(`architecture/artifact.md`)로 열며 source는 `{ kind: workflow, project, workflow, view: static | instance, instance? }`다.
  - instance view의 가상 file `data/_instance.json`은 `ReadWorkflowInstance`를 끝까지 읽어 `{ instance, derived_status, last_reports, lines, checkpoints, sessions, refs, children }`을 제공한다(UTF-8 4 MiB 초과 또는 읽기 실패 시 503). `workflow_instances` 변경 시 해당 instance view만 다시 load한다.
  - 모든 artifact view에 `_lophn/kit.js`·`_lophn/kit.css`(`LophnKit.renderGraph`)를 제공한다(`architecture/ui-kit.md`).
- **화면 (Workflow 화면 · Run 화면 · Title Bar · Layout)**:
  - step은 두 화면 모두 선언 순서대로 위에서 아래로 선다(graph가 아니다). 이웃한 step들이 같은 `next`를 가지고 서로에게 넘기지 않으면 한 단계의 선택지로 묶는다(양자택일: relay는 한 번에 한 step만 돌아서 그런 step들은 둘 중 하나만 지나간다). 세부(설정, 시작 입력, Activity, checkpoint)는 접혀 있고 사람이 골라 연다.
  - Workflow 화면: 도는 run(Needs you / Blocked / Running)이 먼저 오고, 새 run 칸(`StartBox`), 지난 run(Earlier)이 온다. 새 run 칸은 입력 글 아래에 step이 서고 step마다 접힌 설정을 가진다: 그 step이 쓰는 입력(선언의 `inputs.<key>.steps`), 그 step의 session 열기(`tab | background`), 그 step에서 시작하기. 시작 단계의 선택지는 radio로 하나를 고르고 그 step이 시작 step이 된다. step에 붙지 않은 입력과 flow의 session 열기는 "Run settings"에 접혀 있다. 접힌 설정은 지금 값을 한 줄로 보이고, 값을 꼭 채워야 하거나 검증에서 틀린 칸이 있는 설정은 열린다. `when` 실시간 평가, `callable_agents` 기반 `agent` 선택, `project`/`path` 입력, `invalid_inputs`·`broken_flow` 문제 표시는 그대로다.
  - Run 화면: step마다 맡은 쪽과 상태가 있고, 그 step의 `sessions` 트리(agent 얼굴과 이름·상태·실패 사유·마지막 assistant 앞 160자·cross-workspace `[Open session]`), 마지막 report, 그 step의 report가 적은 `refs`(클릭 시 에디터/뷰어 열기), Activity가 그 step에 붙는다. session은 `sessions[].step`(`workflow_origin.step`)과 그 session에 넘긴 `handed` 줄로 step에 붙고, 어느 step에도 붙지 않으면 아래 "Other sessions"다. 지금 일이 있는 step만 펼쳐져 있고 지난 step은 report 두 줄로 접혀 있다. `NowCard`(사람 차례·`human` checkpoint 대기 시 `[Open session]`, `blocked` 시 `[Retry]` 및 flow instance의 `[Resume]`·`[Resume with updated code]`, 종료 시 마지막 report/`program_exited` stderr)는 지금 step이 있으면 그 step 안에, 없으면 step 위에 선다. 선택지 가운데 run이 지나가지 않은 step은 한 줄로만 남는다. 그 아래에 `children` sub-workflow 목록(클릭 이동), 접힌 `checkpoints` 목록이 있고, 머리에 `started_by.workflow` 출처와 접힌 시작 입력·`inputs` 값이 있다. 원격 step 배달 상태는 그 step의 상태 글과 `NowCard`가 보인다. session을 돌리는 agent는 id가 아니라 이름과 아이콘으로 보인다(내장 coding agent는 제품 이름과 vendor 아이콘).
  - `DeskSwitcher`: divider 위(`Desks`)에 `Main`·사용자 desk와 함께 실행 중인 workflow instance별 전용 desk(자체 `title`, 계산 상태 dot + step/요약, rename 단추; 끝난 instance desk는 닫기 단추 포함)를 두고, divider 아래(`Workflows`)에는 workflow 정의 목록을 둔다. 상단 Desk 버튼에는 활성 workflow instance 요약 indicator(`needs_you > blocked > working`)를 보인다.
  - Layout: workflow instance마다 전용 desk(`key = instance id`, `workflow`, `workflow_instance`)를 가지며 `workflow_origin`을 가진 세션 탭은 실행 cwd가 다른 project여도 원 workflow instance의 desk에 열리고, 같은 `(instance, step/부모)`에서 병렬 생성된 탭은 통합 단일 탭 묶음(비분할 접힘 bundle, layout schema 13)으로 자동 묶인다(`architecture/workspace-layout.md`). 왼쪽 sidebar의 desk 구분 머리글은 instance desk일 때 `<title>/<workflow>` 형식으로 보이며, hover 시 전체 이름 tooltip을 띄우고 클릭하면 해당 desk로 전환한다.

## 결정

- **lophn program은 최대한 약하다**: 도메인별 통과 판정, 결과 검증, 고칠 자격 판정을 core에 넣지 않는다. 결정적 제약과 분기는 각 workflow의 flow code나 참가자 prompt가 진다. (사람, 2026-10-20·22)
- **참가자는 있는 agent(harness agent 포함) 또는 사람**: workflow file 안에 일회용 agent를 정의하지 않는다. 사람은 승인 단추가 아니라 실제로 논의하는 참가자다. step 메시지에는 그 step의 정보만 실어 캡슐화와 prompt cache를 유지한다. (사람, 2026-10-20·22, 2026-11-04)
- **단일 통합 engine + YAML 내장 interpreter**: 두 engine을 남기면 관측·checkpoint·`human()`·`inputs`를 두 벌로 짓게 된다. 하나의 programmatic engine으로 합치고 flow code가 없는 YAML 선언은 그 위의 내장 interpreter로 돌린다. 선언의 `kind` 칸은 제거하고 flow code 유무로 실행 모드를 결정한다. 버린 안: 두 kind engine 병행 유지. (agent 제안 · 사람 승인, 2026-11-23)
- **선언적 `inputs` 9종 + `when` 최소 문법(`equals` / `in` / `truthy`, 단일 또는 AND 배열)**: `string`, `text`, `number`, `boolean`, `select`, `multiselect`, `agent`, `path`, `project` 9종과 3종 조건자(+ AND 배열, 고정점 가시성 평가, cycle 거절)로 `StartBox`, CLI `--inputs`, `job` `workflow_start`, sub-workflow `workflow()` 계약을 하나로 통일한다. (agent 제안 · 사람 승인, 2026-11-23)
- **`agent()` 완료는 열린 outgoing `agent_calls`(`ask` 제외) 정산 / 명시적 report 기준 + `mode: "turn"` 영구 대기 방지**: worker를 띄워 두고 turn을 마친 채 대기하는 패턴에서 "turn 끝 = 완료"는 오동작한다. 반대로 열린 call이 모두 실패·전달 실패로 닫혔는데 짧은 grace window 안에 후속 turn이 없으면 `stalled`로 닫아 영구 대기를 막는다. 사람 step은 stall 판정에서 빼고 같은 넘김/retry 시도당 `step_stalled` 줄은 최대 1회만 남긴다. (agent, 2026-11-23)
- **`[Retry]`는 "같은 session에 이어서 하라는 입력" 하나로 통일**: YAML과 flow 양쪽에서 뜻이 같아야 하고, 새 session으로 처음부터 다시 돌리면 이미 낸 바깥 효과가 두 번 날 수 있다. 이미 열린 session이 있으면 `fallback: new` 없이 그 같은 session에만 입력을 넣는다(닫힌 session이면 `conflict`). 새 session 재시도는 flow 코드나 agent가 한다. 버린 안: 새 session에서 step 처음부터 다시 실행. (사람, 2026-11-23)
- **재시작 시 끊긴 `agent()`·`tool()` 모두 `interrupted` 실패 값으로 code에 반환**: 둘 다 자동 재실행 없이 `interrupted`(대상 `session` 포함) 값으로 code에 넘기고, code가 처리하지 않고 throw/비정상 종료하면 `running`(`blocked`)으로 남아 사람이 `[Resume]`할 수 있다. `program_exited`는 정상 종료(`code === 0`)만 `ended`로 닫는다. `reconcile()`는 2단계로 나눠 부모가 자식에 재부착할 때 자식이 이미 정리돼 있게 한다. 버린 안: `agent()`만 process 미기동, 자동 재실행, 또는 비정상 종료를 `ended`로 닫기. (agent 제안 · 사람 승인, 2026-11-23)
- **기본은 시작 시점 code snapshot 고정, 멈춘 run에서 사람이 "고친 code로 이어 가기" 허용**: 평소 replay 안정성은 content-addressed permanent blob snapshot으로 지키되, 며칠 돈 긴 run이 flow 코드 버그 하나로 날아가지 않게 사람이 명시적으로 `ResumeWorkflow(use_latest_code: true)`를 골라 최신 코드를 적용해 이어 갈 수 있게 한다. 버린 안: snapshot 완전 고정(버그 시 Stop 후 처음부터). (사람, 2026-11-23)
- **`human()` 대기 중 flow process는 core 생존 중 유지**: 쉬는 Node process의 메모리 비용이 작고, replay 횟수를 줄여 `onEvent` 상태 유실과 비결정성 사고 여지를 최소화한다. durable replay는 core 재시작과 `ResumeWorkflow`에만 쓴다. daemon 종료 시에는 활성 checkpoint를 덮어쓰지 않아 다음 기동 reconcile이 끊김을 확정한다. 버린 안: `human()` 진입 시 process 내려놓기. (사람, 2026-11-23)
- **`step(key, fn)`의 `key` 명시 필수**: `Promise.all`과 `onEvent` 안의 호출은 실행 순서가 매번 달라 전역 자동 순번이 replay 때 엉뚱한 호출에 붙는다. `step` key를 필수로 두고 `AsyncLocalStorage`로 격리된 step 안 순번만 자동 부여한다. 버린 안: 전역 호출 순번 자동 부여. (agent, 2026-11-23)
- **실패 값 모양은 `@lophn/flow`의 `{ ok: false, reason, message, session? }` 하나로 통일, 경계 오류 코드 7개 유지**: 공통 경계 오류 코드 7개를 늘리지 않으면서, flow 실행 사유(`cancelled | interrupted | stalled | model_error`)를 `reason`에 명확히 싣는다. (agent, 2026-11-23)
- **저장 상태 3개(`running | ended | stopped`) 유지, `needs_you`·`blocked`는 계산 상태**: 저장 상태 전이 race를 피하고 원격 step 계산 모델과 맞춘다. (agent 제안 · 사람 승인, 2026-11-23)
- **`workflow_origin`은 넘길 때마다 갱신 + `spawned_by`만 상속**: `session: same`으로 같은 세션이 다음 step을 받을 때 `step`이 낡지 않게 넘길 때마다 갱신한다(`workflow_origin` 불변 trigger 없음). `fork`와 이미 열린 타 세션으로의 일반 `agent call`은 상속하지 않는다. (agent, 2026-11-23)
- **sub-workflow는 같은 project만 + 자식 creator 할당 그대로 사용**: 같은 project의 agent가 두 선언의 `agent:` 칸을 모두 쓸 수 있어 교집합 제한은 실익 없이 정상 동작하는 sub-workflow만 깨뜨린다. 대신 다른 project 호출을 `forbidden`으로 막고, cycle과 최대 깊이 5 초과를 `conflict`로 거절하며, `StopWorkflow`는 자식까지 연쇄 중지한다. (agent, 2026-11-23)
- **최근 assistant 앞 160자 평문 절단(redaction 선적용 · fail-closed) & 명시적 `refs`만 수집**: LLM 요약은 비용·지연·비결정성을 만들고, 자른 뒤 redaction하면 경계에 걸친 secret 앞부분이 샐 수 있으며, 파일 자동 감시·`.md` 필터링은 harness별 편차와 산출물 판정을 core에 끌어들인다. (agent, 2026-11-23)
- **fallback은 core 정책이 아니라 SDK helper(`withFallback`)**: 흐름이 JS call stack에 있으므로 core가 임의 수정(`edit`)을 할 수 없고, 정책을 core에 굳히지 않기 위해 SDK helper로 둔다. (agent 제안 · 사람 승인, 2026-11-23)
- **`onEvent`는 비영속 + `job`과 공용 바닥 정책 공유**: event 저장소를 두지 않는 `job` 원칙과 일관되게, 재시작을 넘는 대기는 `tool()` 조회나 외부 event `job`에 맡긴다. 도달·고리 정책은 바닥 core module에 두어 feature module 간 cross-import 없이 공유한다. (agent, 2026-11-23)
- **원격 참가자(`on`)는 `call`·`reply` mail에 칸(`step`, `report`)을 더해 재사용**: 받는 쪽 규칙(한 번 적용, 기계 확인, 대기, 만료, 취소, private, 재시작)이 모두 call mail과 call 행에 걸려 있어 새 mail 종류를 두지 않는다. 가져간 turn이 report 없이 끝나면 step을 닫지 않고 `remote_lophn` 진행 줄만 보낸다(이슈 `workflow-remote-step-turn-end-no-line`). (사람·agent, 2026-11-21)
- **기존 `stack`과 비분할 `tab group`을 단일 탭 묶음 개념으로 통합**: layout migration 비용이 들더라도 사람이 배울 개념을 split + 단일 탭 묶음 둘로 유지한다(`architecture/workspace-layout.md`). (사람, 2026-11-23)

## 열린 것

- **flow process CPU 한도**: AI가 짠 flow code가 끝없는 loop에 빠지면 사람이 `[Stop]`할 때까지(job이 밤에 시작한 flow면 아무도 보지 않는 동안) CPU 하나를 잡는다. memory는 V8 heap 512 MiB에서 막히지만 CPU를 막으려면 OS 한도(`prlimit`)와 실행 허락이 필요하다. 앱의 한도를 정할 때 같이 정한다(이슈 `flow-process-cpu-limit`).
- **`workflow.yaml`에 남은 옛 `{ kind: harness }` 참가자**: 자동 migration하지 않는다. `invalid_declaration`으로 드러나며 손으로 고친다(agent 이름을 알 수 없다).
