# workflow (2단계 architecture 초안)

> 상태: 초안 (`project-docs/products/roadmap/workflow.md` 단계 1). 지금 동작하는 1단계 설계는 `project-docs/architecture/workflow.md`다. 단계 2~4 구현을 land할 때 이 문서를 `project-docs/architecture/workflow.md`로 승격한다. `project-docs/architecture/README.md` 형식을 따른다(code path와 구현 파일 이름을 적지 않는다).

workflow는 사람, agent, 앱 tool, 앱 event를 비결정적 함수처럼 조합해 돌리는 일이다. project workspace의 session이 정의를 쓰고, 사람·승인된 job·상위 workflow가 instance를 시작하며, lophn은 시작·진행·checkpoint·산출물 참조를 기록하고 화면과 SDK에 그대로 드러낸다. lophn core는 도메인별 통과 판정이나 결과 검증을 하지 않는다.

## 문제

1단계 workflow는 YAML relay(`kind: agent`)와 코드 실행(`kind: flow`)이 두 engine으로 갈라져 있었다.

- 사람과 논의하는 단계(`human`), 앱 tool·event 기반의 동적 worker 선택·교체(예: 구독 한도 앱 event로 worker 변경), sub-workflow 조합을 한 workflow 안에서 함께 쓸 수 없다.
- flow는 단일 process 메모리에만 기대어 lophn 재시작을 넘기면 그대로 종료되고, 반대로 무조건 자동 재실행하면 바깥 효과가 두 번 난다.
- agent 호출의 끝을 "turn 끝"으로만 보면, 하위 worker를 `team spawn`으로 띄워 두고 reply를 기다리며 turn을 마친 세션이 조기 종료되거나, 열린 call이 모두 닫힌 뒤 새 turn 없이 멈추거나, 명시적 report 없이 실패·중단된 세션이 조용히 멈춰(stall) 사람이 알지 못한다.
- workflow와 연결된 세션들(담당 세션, `spawned_by` 자식 worker, 실패 사유, 최근 assistant 발화, 명시적 산출물 경로)의 연결 고리가 없어, Run 화면·instance artifact·title bar desk switcher·앱 SDK가 진행 상태를 드러내지 못한다.
- 실행 cwd가 다른 project인 참가자 세션의 탭이 원 workflow의 desk가 아니라 다른 workspace에 흩어지고, 병렬 worker 탭이 화면을 어지럽힌다.

## 목표와 비목표

- 목표
  - **단일 통합 engine**: programmatic 실행(`flow`)을 기본으로 하고, 코드가 필요 없는 단순 선언은 같은 primitive 위에서 도는 내장 interpreter(YAML 축약형)로 통합한다.
  - **비결정적 함수 + Soft I/O**: `agent`, `human`, `workflow`, `tool`, `onEvent`를 조합하되, output은 자연어 요약과 명시적 산출물 경로(`refs`)가 기본이고 구조화 `data`는 선택으로 둔다.
  - **중복 바깥 효과 없는 Durable 실행**: 시작과 결과를 2단계로 checkpoint해 재시작을 넘기되, 돌던 `agent`·`tool`은 절대 자동 재실행하지 않는다. core가 켜져 있는 동안 `human()` 대기 process는 내려놓지 않는다.
  - **단일 `workflow_origin` 기반 관측·배치**: step을 넘길 때마다 세션에 origin을 기록·갱신하고 `spawned_by` 자식만 상속해, Run 화면·instance artifact·title bar·`@lophn/agent` SDK·Cross-workspace Workflow Desk가 모두 같은 정본을 읽는다.
  - **명시적 실패·stall 드러내기와 사람 복구**: 로컬 non-human step도 명시적 완료 없이 끊기면 `blocked`로 드러내고 `[Open session]`, `[Retry]`(같은 session 이어가기), flow 재개(`고친 code로 이어 가기` 포함)를 제공한다.
- 비목표(일부러 하지 않는 것)
  - 도메인별 step 통과 판정, 결과 검증, 비즈니스 규칙의 core 내장. lophn program은 최대한 약하게 둔다.
  - workflow output의 강제 정량 스키마화.
  - 산출물 파일의 자동 감시·확장자(`.md`) 기반 추정 수집(무엇이 산출물인지 lophn이 판정하지 않는다).
  - 최근 assistant message의 LLM 요약(추가 모델 호출·비용 없음. 앞 N자 절단만 쓴다).
  - 모든 workflow instance에 상시 coordinator agent를 시스템이 강제 배정하기.
  - 재시작 시 돌던 `agent`·`tool`의 자동 재실행.
  - 재시작을 넘어 영속 event를 기다리기(`job`의 비영속 event 원칙과 일관).
  - workflow 파일 안의 일회용 agent 정의, unattended approval 규칙 변경, 비용 상한 강제 차단.

## 모델

```
 사람: 화면(StartBox 폼, Run 화면, [Retry], [Resume], [Stop]) | CLI           user 자격
 agent: tool workflow.list | get | report | edit | check                      agent 자격
 job: scheduler가 core 안에서 시작 (주기 · 앱 event · session event)          machine 자격
 상위 workflow: workflow() primitive로 같은 project 안 sub-workflow 시작      core 안 자격
   │  route ListWorkflows | StartWorkflow | ReportWorkflow | EditWorkflow
   │        RetryWorkflowStep | ResumeWorkflow | StopWorkflow | CheckWorkflow
   │        ReadWorkflowInstance | ListWorkflowInstances
   ▼
 workflows (선언·inputs 검증, code snapshot, derived status 계산, redaction)
   ▼
 CreateWorkflowInstance | ApplyWorkflowChange | UpsertWorkflowCheckpoint      한 transaction
   │  workflow_instances(저장 상태: running|ended|stopped)
   │  workflow_lines(append-only 이력)
   │  workflow_checkpoints(key별 started|completed|failed|interrupted)
   │  sessions.workflow_origin ← step/agent/human 넘길 때마다 기록·갱신 (spawned_by 자식만 상속)
   └ commit 뒤 StateChanged(workflow_instances) ─▶ Run 화면, DeskSwitcher, artifact view 갱신

 단일 실행 engine (instance마다 하나)
   ├─ flow code 있음 ─▶ flow process (stdin/stdout JSON 줄, code snapshot 실행; core 생존 중 유지)
   └─ flow code 없음 ─▶ 내장 YAML interpreter (같은 primitive·checkpoint 사용)
        primitive: step(key, fn) | agent(mode, signal) | human | workflow | tool | onEvent | report | escalate
        SDK helper(core 밖): withFallback (공통 reason 기반 on-demand fallback agent)
```

### 핵심 개념

- **workflow 정의**: `<data>/projects/<prj>/workflows/<name>/` 폴더 하나. 선언(`workflow.yaml`), 사람·agent용 설명(`workflow.md`), 선택적 flow code, 선택적 artifact(`artifacts/static`, `artifacts/instance`)로 구성된다.
  - 선언은 `inputs`(선언적 입력 스키마), `outputs`(반환 설명·선택 schema), `participants`, `agent`(flow의 앱 tool creator), `steps`를 가진다. `kind: agent | flow` 구분은 없애고 flow code 유무로 실행 모드를 결정한다.
- **`workflow_origin`**: 세션이 어느 workflow instance와 step에 속하는지 나타내는 단일 정본 `{ project, workflow, instance, step }`.
  - workflow의 `agent()`·`human()`·YAML step 입력을 세션에 **넘길 때마다** 기록·갱신한다(`session: same`으로 같은 세션이 다음 step을 받으면 `step`이 최신 값으로 갱신된다).
  - 그 세션이 `team spawn`으로 띄운 자식(`spawned_by`)은 생성 시점의 부모 `workflow_origin`을 상속한다.
  - 이미 열려 있던 다른 세션에 `agent call`로 말을 건 경우는 기록·상속하지 않는다.
- **Soft I/O**:
  - 입력: `StartWorkflow`는 구조화 `inputs`(선언적 폼/호출 인자 JSON)와 요약/자유 글 `input`을 받는다. `inputs` 선언이 없는 workflow는 기존처럼 `input` 문자열 하나만 받는다.
  - 출력(`SoftOutput`): `{ summary: string, refs?: string[], data?: unknown }`. `summary`는 자연어 요약, `refs`는 agent가 명시적으로 report/output에 담은 파일 경로 목록, `data`는 선택적 JSON 값이다.
- **실패 값 모양 (`Outcome<T>`)**:
  - `@lophn/flow`의 모든 primitive 반환 모양은 하나로 통일한다: `{ ok: true, result: T } | { ok: false, reason, message, session? }`.
  - 경계(route, command, protocol)는 기존 공통 오류 코드 일곱(`invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`, `internal`)만 유지하고 늘리지 않는다.
  - `Outcome`의 `reason`은 경계 오류 코드 일곱과 실행 사유(`cancelled`, `interrupted`, `stalled`, `model_error`)로 구성된다. `session`은 끊기거나 실패한 대상 세션이 있을 때 그 session id를 싣는다.
- **저장 상태 vs 계산 상태**:
  - 저장 상태(`workflow_instances.state`): **`running | ended | stopped`** 셋만 둔다.
  - 계산 상태(`derived`, 읽을 때 `workflow_lines`, `workflow_checkpoints`, 연결된 세션의 live 상태에서 계산):
    - `working`: 실행 중이며 막히거나 사람을 기다리지 않는다.
    - `needs_you`: `human` 대기, `escalate` 대기, 연결된 활성 세션의 approval/question 대기, 또는 원격 step의 late mail `held` 중 하나 이상이 있다.
    - `blocked`: 로컬/원격 non-human step의 `stall`, `not_handed`, `lophn_restarted` 끊김(미처리 `interrupted`), 처리되지 않은 flow 예외/`program_exited` 비정상 종료로 진행이 멈춰 있다.
    - `ended` / `stopped`: 저장 상태 그대로다.
- **checkpoint (`workflow_checkpoints`)와 key 규칙**:
  - durable 실행의 정본이다. `(instance, key)`마다 `kind`(`step | agent | human | workflow | tool`), `state`(`started | completed | failed | interrupted`), `handle_ref`(session id, 자식 instance id, invocation id, 원격 call id), `output_json`, `error_json`을 가진다.
  - **`step(key, fn)`의 `key` 명시는 필수다**(예: `step("review-1", ...)`, `step("research-orca", ...)`). 그 `step` 안에서 순차 호출되는 primitive만 `step` 내부 순번(`review-1/agent#1`, `review-1/tool#1`)으로 자동 부여된다. `Promise.all`처럼 순서가 비결정적인 병렬 호출은 각 항목을 고유 `step(key, ...)`로 감싸거나 명시적 `key`를 부여한다.
  - `workflow_checkpoints`는 며칠 묵은 instance에 남는 저장 데이터이므로, SDK·통로 모양이 바뀔 때 기존 저장 checkpoint를 새 모양으로 옮기는 ledger migration 규칙이 적용된다.
- **`agent()` 완료 조건, `stall`, `cancel`**:
  - `mode: "turn"`(단발 기본): 해당 호출이 연 turn이 `completed`로 끝나고 그 세션이 보낸 열린 `agent_calls`가 0개일 때 마지막 assistant 응답을 결과로 반환한다. 열린 `agent_calls`가 남아 있으면 정산될 때까지 대기하되, **열린 call이 모두 닫혔는데(실패·전달 실패 포함) 새 turn이 시작되지 않고 끝난 경우** `{ ok: false, reason: "stalled", session, message }`로 종료해 영구 대기를 막는다. turn이 `failed`·`stopped`로 끝나면 실패 `Outcome`을 반환한다.
  - `mode: "report"`(복합 step·YAML 축약형 기본): 해당 세션이 `workflow.report`로 명시적 완료를 낼 때 종료한다. 명시적 완료 없이 turn이 끝났고 열린 `agent_calls`도 0개이면 `step_stalled` 줄을 남긴다(단, 아래 규칙대로 사람 step은 제외하고 같은 넘김당 1회만 남긴다).
  - **cancel**: `signal`(`AbortSignal`)이 취소되면 core가 해당 실행(turn 중단, 열린 tool/자식 workflow 취소)을 멈추고 `{ ok: false, reason: "cancelled", message, session? }`를 돌려준다.
- **`human()`**: 사람-agent 대화 step primitive다. `with` 참가자 세션에 `workflow_origin`과 `human_turn = true`로 입력을 넣고 checkpoint를 `started`로 남긴다. 사람이 그 세션에서 논의해 해당 agent가 `workflow.report`로 완료를 내면 checkpoint가 `completed`가 되고 `SoftOutput`을 돌려받는다. 사람 step은 stall 판정 대상에서 제외한다.
- **`workflow()` (sub-workflow 호출)**: 같은 project 안의 다른 workflow를 비동기 함수처럼 호출한다. 자식 instance의 `started_by`는 `{ kind: "workflow", instance: <부모> }`이며, 자식이 `ended`되면 최종 `SoftOutput`을, `stopped`되면 `{ ok: false, reason: "cancelled", message }`를 돌려받는다.
- **`onEvent()`**: 실행 중인 flow가 앱 event 또는 lophn session event를 구독한다. `job`의 event 규칙과 동일하게 **비영속**이다(저장·재전송하지 않음). process가 살아 있는 동안 도착하는 event에만 반응하며, 재시작 뒤 현재 상태가 필요한 값은 `tool()`로 다시 조회한다.
- **`[Retry]`와 `[Resume]`의 분리**:
  - `RetryWorkflowStep` (`[Retry]`): **같은 session에 이어서 하라는 입력을 넣는 동작** 하나로 통일한다(YAML 축약형과 flow의 `agent`/`human` 세션 공통). 아직 세션이 열리기 전(`not_handed`)인 경우에만 넘기기를 다시 시도한다. 새 session으로 처음부터 다시 하는 것은 flow 코드나 agent의 일이다.
  - `ResumeWorkflow` (`[Resume]` / `[Resume with updated code]`): flow process가 처리되지 않은 예외·`interrupted`·코드 버그로 멈춘(`blocked`) `running` instance의 flow process를 다시 띄워 replay로 이어간다. 기본은 시작 시점 code snapshot을 쓰고, 사람이 명시적으로 `use_latest_code: true`를 고르면 현재 최신 flow code로 snapshot을 갱신한 뒤 완료된 checkpoint를 건너뛰며 이어간다.
- **SDK `withFallback` helper**: core 밖(`@lophn/flow`)의 helper다. 실패한 `Outcome`(공통 `reason`·`message`·`session`)과 문맥을 fallback agent에게 넘겨 `retry | substitute | throw | escalate` 중 하나의 결정을 받아 이어간다.

## 지키는 것

### 정의와 선언
1. 정의는 `<data>/projects/<prj>/workflows/<name>/`에 둔다. `<name>`은 slug이고 신원은 `(project id, name)`이다.
2. 선언은 `inputs`, `outputs`, `participants`, `agent`, `steps`의 정의된 칸만 읽고 나머지 칸은 보존한다(non-strict). `kind` 칸은 제거하되, 기존 선언의 `kind` 칸은 무시하고 flow code 유무로 실행 모드를 판정한다.
3. flow code가 없으면 `steps`가 비지 않아야 한다(YAML 축약형). flow code가 있으면 `steps`는 화면 표시와 report 자리표시용으로 선택이다.
4. `inputs` 필드 타입은 `text`, `select`, `multiselect`, `boolean`, `agent`, `path`, `project` 일곱이고, 조건부 표시 규칙 `when`을 가질 수 있다. `agent` 필드는 시작 시점의 workspace/기계에서 호출 가능한 agent 목록으로 채운다.
5. YAML 축약형에서 입력된 `inputs` 값은 첫 step 입력 본문의 `Inputs:` 절에 구조화된 key-value로 주입된다.
6. 틀린 선언은 그 workflow만 목록에서 빼고 `ListWorkflows`의 `problem`(`no_declaration | invalid_yaml | invalid_declaration | invalid_inputs | broken_flow`)에 첫 이유 하나를 싣는다.
7. 목록의 step에는 `prompt`·`in`·`out`을 싣지 않는다(캡슐화 유지).

### instance, 상태, 줄, checkpoint
8. 정본은 `workflow_instances`, `workflow_lines`, `workflow_checkpoints` 세 표다. 쓰기는 core 안 machine 자격 command(`CreateWorkflowInstance`, `ApplyWorkflowChange`, `UpsertWorkflowCheckpoint`)만 수행한다.
9. `workflow_lines`는 고치지도 지우지도 않는다(trigger 유지). `workflow_instances.state`는 `running | ended | stopped` 셋뿐이고 `needs_you`·`blocked`는 읽을 때 계산한다.
10. 시작 주체는 사람(`StartWorkflow`, user 자격), 승인된 `job`(core 안), 실행 중인 같은 project의 상위 `workflow`(core 안) 셋뿐이다. 일반 agent 대화에서는 workflow를 시작하지 못한다. `started_by`는 `{ kind: "user" } | { kind: "job", job } | { kind: "workflow", instance }`다.
11. instance는 시작 시 선언의 참가자·step·`inputs` 스키마와, flow code가 있으면 **시작 시점의 code snapshot(content-addressed blob)**을 고정해 가진다. 실행 도중 정의나 flow code가 바뀌어도 사람이 `ResumeWorkflow(use_latest_code: true)`를 명시적으로 고르기 전까지는 시작 시점 snapshot으로 replay한다.
12. `ended`는 완료 기록일 뿐이다(YAML 축약형의 `hand_now`나 사람 `[Retry]`로 다시 `running`이 될 수 있다). `stopped`는 사람이 멈춘 최종 상태이며, `StopWorkflow`는 해당 instance와 모든 실행 중인 자식 sub-workflow instance를 연쇄로 `stopped`로 닫고 관련 turn·run·flow process·원격 step call을 중단한다.
13. `workflow_checkpoints`는 `(instance, key)`마다 시작 시점(`started` + `handle_ref`)과 완료/실패/중단 시점(`completed | failed | interrupted`)의 2단계로 기록한다. `step(key, fn)`의 `key` 명시는 필수이며, 이미 `completed` 또는 `failed`인 key는 replay가 저장된 결과를 그대로 돌려주고 바깥 호출을 다시 실행하지 않는다.
14. `workflow_checkpoints`의 `output_json`·`error_json`과 flow 통로 저장 모양이 바뀌면, 기존 저장된 checkpoint를 새 모양으로 옮기는 ledger migration을 같은 변경에 포함한다.

### `workflow_origin`과 관측
15. `sessions.workflow_origin`은 `{ project, workflow, instance, step }`이다. workflow가 step/`agent()`/`human()`으로 세션에 입력을 **넘길 때마다** 기록·갱신한다(`session: same`으로 다음 step을 받으면 `step`이 최신으로 갱신된다).
16. `team spawn`(`spawned_by`)으로 생성된 자식 세션은 생성 시점의 부모 `workflow_origin`을 자동으로 상속한다. 이미 열려 있던 세션에 `agent call`로 말을 건 경우는 기록·상속하지 않는다.
17. `ReadWorkflowInstance`는 instance, `derived_status`, `last_reports`, `lines`, `checkpoints`, `sessions`(해당 instance의 `workflow_origin`을 가진 세션 트리: 상태, `waiting_for`, 마지막 assistant 텍스트 앞 160자 절단, 실패 사유), `refs`(명시적 report/output 파일 경로 목록), `children`(자식 sub-workflow 요약), `remote_steps`를 돌려준다.
18. 최근 assistant message 미리보기는 마지막 assistant 텍스트의 앞 N자 절단(redaction 적용)이며 LLM 요약을 호출하지 않는다. `refs`는 agent가 명시적으로 report/output에 기재한 파일 경로만 모으며 파일 시스템 자동 감시·확장자 필터링을 하지 않는다.
19. `@lophn/agent` SDK의 `SessionInfo.workflow`는 `sessions.workflow_origin`을 그대로 투영한다. `workflow_origin`이 없는 일반 세션은 `null`이다.

### `agent()` 완료, stall, 실패 사유, `[Retry]`·`[Resume]`
20. `agent()`는 열린 하위 `agent_calls`가 남아 있는 동안 turn 종료만으로 완료 처리하지 않는다. `mode: "turn"`에서 열린 call이 모두 닫혔는데(실패·전달 실패 포함) 새 turn이 시작되지 않고 끝난 경우 `{ ok: false, reason: "stalled", session, message }`로 종료한다.
21. `mode: "report"`(YAML 축약형 non-human step 포함)에서 명시적 완료 report 없이 turn이 끝났고 열린 `agent_calls`도 0개이면 `step_stalled` 줄을 남기고 계산 상태를 `blocked`로 올린다. **사람 step(`human` / `by: me`)은 stall 판정에서 제외하고, 같은 넘김(attempt)당 `step_stalled` 줄은 최대 1회만 남긴다**(사람이 세션에 들어가 추가 대화를 해도 중복 기록하지 않는다).
22. harness 또는 lophn agent turn이 실패하면 redaction된 오류 메시지와 정확한 `reason`(경계 오류 코드 일곱 또는 `cancelled | interrupted | stalled | model_error`)을 turn/checkpoint에 보존한다. 모든 실패를 `model_error` 하나로 뭉개지 않는다.
23. `RetryWorkflowStep`(user 자격만)은 `running` 상태이면서 계산 상태가 `blocked`인 step/checkpoint에만 허용된다(`stopped`나 정상 `working` 중이면 `conflict`). `retried` 줄을 남기고, 기록된 session이 있으면 **그 같은 session에 이어서 진행하라는 입력을 넣는다**(새 session으로 처음부터 돌리지 않는다). session이 열리기 전(`not_handed`)인 경우에만 넘기기를 다시 시도한다.
24. `ResumeWorkflow`(user 자격만)은 flow process가 종료돼 `blocked` 상태인 `running` flow instance의 process를 다시 띄워 replay로 이어간다. `use_latest_code: true`가 주어지면 현재 workflow 폴더의 최신 flow code로 `code_snapshot`을 갱신하고 `code_updated` 줄을 남긴 뒤 replay한다.

### Durable 실행, process 수명, 재시작 복구
25. core가 켜져 있는 동안 `human()`·`escalate()` 대기 중인 flow process는 내려놓지 않는다. durable replay는 core 재시작과 `ResumeWorkflow`에서만 일어난다.
26. 켤 때 router가 돌던 turn을 닫은 뒤, `running`인 모든 workflow instance를 reconcile한다.
27. 재시작 시 `state === "started"`로 남아 있는 checkpoint는 **절대 자동 재실행하지 않는다**:
    - `human`이 사람의 다음 입력을 기다리며 쉬고 있던 상태(turn이 열려 있지 않았음): 끊김으로 치지 않고 `started`(`needs_you`) 그대로 유지한다. replay 시 flow process가 같은 `human` checkpoint에 다시 붙어 report를 기다린다.
    - turn이 돌다가 재시작으로 끊긴 `agent` / `human`과 돌던 `tool`: 모두 `interrupted`로 확정하고 `lophn_restarted` 줄을 남긴다. flow code에는 `{ ok: false, reason: "interrupted", message, session? }` 실패 값으로 돌려준다.
    - 자식 `workflow`: 기록된 자식 instance id에 다시 붙는다.
28. reconcile 뒤 `running`인 flow instance는 고정된 code snapshot으로 flow process를 다시 띄워 replay한다. `interrupted` 실패 값을 code가 받아 처리하면 그대로 진행하고, code가 처리하지 않고 throw해 process가 끝나면 그때 `blocked` 상태가 된다. YAML 축약형(내장 interpreter)은 `interrupted`를 받으면 자동으로 다시 넘기지 않고 `blocked` 상태로 멈춘다.

### `workflow()` (sub-workflow)와 권한
29. `workflow()` 호출은 초기에는 **같은 project 안의 workflow만** 허용한다(다른 project 지정은 `forbidden`).
30. 조상 instance chain에 같은 `(project, workflow)`가 있으면 cycle로 `conflict` 거절한다. 최대 중첩 깊이는 5단계다(초과 시 `conflict`).
31. sub-workflow 안의 앱 tool 호출은 그 sub-workflow 선언의 creator agent 할당을 그대로 사용한다(교집합 제한을 두지 않는다).

### `onEvent`와 `job` 정합성
32. flow의 `onEvent(source, event)`는 비영속 구독이다. process가 꺼진 사이의 event는 저장·재전송하지 않는다. 재시작 replay 시 handler가 변경했던 메모리 변수는 복원되지 않으므로, 현재 상태가 필요한 값은 `tool()`로 다시 조회한다.
33. `onEvent`는 `job`의 event 규칙과 동일하게 `mayReachWorkspace` 범위 검사(workflow의 project가 source 앱·session workspace에 닿을 수 있어야 함)와 고리 방지 규칙(자기 instance 사슬의 앱 event, 비사람/workflow/job이 연 session event 제외)을 적용한다.

### 원격 참가자(`on: <컴퓨터>`)와 쓰기 범위
34. 다른 컴퓨터의 참가자(`on`)는 기존 call mail 기반 규칙(`architecture/workflow.md` 45~52, `architecture/machine-a2a.md`)을 단일 engine의 `agent({ on })` primitive로 그대로 유지한다.
35. `<data>/projects/<prj>/workflows/` 쓰기 범위, redaction, 8 KiB report 텍스트 상한(긴 결과는 파일에 쓰고 `refs`로 경로 전달), flow process 메모리 한도(V8 heap 512 MiB)와 credential 비전달 규칙은 기존대로 유지한다.

## 경계와 계약

- **boundary**: `workflows`, `jobs`, `lophn-agent`(세션 `workflow_origin`), `terminal-agents`(GUI 탭 배치·실패 사유 보존), `attention`(unseen·알림). `workflows` module은 다른 feature module을 직접 import하지 않고 port로만 닿는다.
- **route (memory)**:
  - 기존 유지·확장: `ListWorkflows`, `StartWorkflow`(`inputs` 객체 추가), `ReportWorkflow`(`refs`, `data` 선택 칸 추가), `EditWorkflow`(YAML 축약형 전용), `StopWorkflow`(자식 연쇄 중지), `CheckWorkflow`, `ReadWorkflowInstance`(`derived_status`, `checkpoints`, `sessions`, `refs`, `children` 추가), `ListWorkflowInstances`(`derived_status` 요약 추가).
  - 신규: `RetryWorkflowStep`(user 자격만, 같은 session 이어가기), `ResumeWorkflow`(user 자격만, `use_latest_code?`).
  - 모든 경계 route·command 오류는 공통 오류 코드 일곱(`invalid_input`, `not_found`, `forbidden`, `unauthorized`, `conflict`, `unavailable`, `internal`)만 사용한다.
- **agent tool / CLI**:
  - `workflow.report`에 `--refs <path,...>`와 `--data <json>` 선택 인자 추가.
  - `workflow.list` / `workflow.get` / `workflow.edit` / `workflow.check` 유지.
  - CLI `lophn workflow start`에 `--inputs <json>` 추가, `lophn workflow retry <instance> [step]`, `lophn workflow resume <instance> [--latest-code]` 추가.
- **event**:
  - `StateChanged(workflow_instances)`: instance·줄·checkpoint·연결 세션의 주요 상태 전이 시 발행. Run 화면, `DeskSwitcher`, artifact view가 다시 읽는다.
- **저장 (ledger migration)**:
  - `workflow_instances`: `inputs_json`, `code_snapshot` 열 추가(기존 행은 null).
  - `workflow_lines`: `kind`에 `step_stalled`, `retried`, `escalated`, `code_updated` 추가(append-only trigger 유지).
  - `workflow_checkpoints`: 신규 표 `(instance, key)` PK, `kind`, `state`, `handle_ref`, `output_json`, `error_json`, `started_at`, `finished_at`. 저장 데이터이므로 이후 모양 변경 시 ledger migration 필수.
  - `sessions`: `workflow_origin` JSON 열 추가(`{ project, workflow, instance, step }`, nullable) + `(workflow_origin ->> '$.instance')` 인덱스.
- **flow 통로 (`@lophn/flow` ↔ core stdin/stdout JSON 줄)**:
  - core → process: `start` (`instance`, `input`, `inputs`, `checkpoints`), `response` (`{ ok: true, result }` | `{ ok: false, reason, message, session? }`), `event` (`subscription_id`, `source`, `event`, `payload`).
  - process → core: `step_begin` / `step_end` (`key` 필수), `agent` (`key`, `mode`, `cancel_id`), `human` (`key`), `workflow` (`key`), `tool` (`key`), `cancel` (`cancel_id`), `subscribe` / `unsubscribe`, `report` (`step`, `text`, `refs?`, `data?`, `next?`), `escalate` (`step`, `reason`).
  - SDK 공개 API(`@lophn/flow`): `input`, `inputs`, `instance`, `step`, `agent`, `human`, `workflow`, `tool`, `onEvent`, `report`, `escalate`, `withFallback`.
- **SDK (`@lophn/agent`)**:
  - `SessionInfo`에 선택적 `workflow?: { project, workflow, instance, step } | null` 추가.
- **artifact (`_instance.json`)**:
  - `ReadWorkflowInstance`의 확장 결과(`instance`, `derived_status`, `last_reports`, `lines`, `checkpoints`, `sessions`, `refs`, `children`)를 그대로 제공(4 MiB 상한 유지).
- **화면 (Run 화면 · Title Bar · Layout)**:
  - Run 화면: 세션 트리(상태·실패 사유·마지막 assistant 앞 160자), 명시적 `refs` 파일 목록(클릭 시 에디터/뷰어 열기), cross-workspace `[Open session]`, `blocked` 시 `[Retry]`·`[Resume]`(및 `[Resume with updated code]`).
  - `DeskSwitcher`: 드롭다운 workflow desk 줄에 계산 상태(dot + step/요약), 상단 Desk 버튼에 현재 workspace 활성·대기·막힘 workflow 요약 indicator.
  - Layout: `workflow_origin`을 가진 세션 탭은 실행 cwd가 다른 project여도 원 workflow의 desk에 열리고, 같은 `(instance, step/부모)`에서 병렬 생성된 탭은 통합 단일 탭 묶음(기존 `stack` + 비분할 `tab group` 통합, 별도 단계에서 layout migration)으로 자동 묶인다(`architecture/workspace-layout.md` 함께 갱신).

## 결정

- **단일 통합 engine + YAML 내장 interpreter**: 두 engine을 남기면 관측·checkpoint·`human()`·`inputs`를 두 벌로 짓게 된다. 하나의 programmatic engine으로 합치고 코드가 없는 YAML 선언은 그 위의 내장 interpreter로 돌린다. 버린 안: 두 kind engine 병행 유지. (agent 제안 · 사람 승인, 2026-11-23)
- **`agent()` 완료는 열린 call 정산 / 명시적 report 기준 + `mode: "turn"` 영구 대기 방지**: worker를 띄워 두고 turn을 마친 채 대기하는 패턴에서 "turn 끝 = 완료"는 오동작한다. 반대로 열린 call이 모두 실패·전달 실패로 닫혔는데 새 turn이 없으면 `stalled`로 닫아 영구 대기를 막는다. 사람 step은 stall 판정에서 빼고 같은 넘김당 stall 줄은 1회만 남긴다. (agent, 2026-11-23)
- **`[Retry]`는 "같은 session에 이어서 하라는 입력" 하나로 통일**: YAML과 flow 양쪽에서 뜻이 같아야 하고, 새 session으로 처음부터 다시 돌리면 이미 낸 바깥 효과가 두 번 날 수 있다. 새 session 재시도는 flow 코드나 agent가 한다. 버린 안: 새 session에서 step 처음부터 다시 실행. (사람, 2026-11-23)
- **재시작 시 끊긴 `agent()`·`tool()` 모두 `interrupted` 실패 값으로 code에 반환**: `tool()`만 code에 주고 `agent()`는 process를 안 띄우면 code가 `Promise.all` 끊김 등을 일괄 판단할 수 없다. 둘 다 자동 재실행 없이 `interrupted`(대상 `session` 포함) 값으로 code에 넘기고, code가 처리하지 않고 throw하면 그때 `blocked`가 된다. 버린 안: `agent()`만 `blocked`로 process 미기동, 또는 자동 재실행. (agent 제안 · 사람 승인, 2026-11-23)
- **기본은 시작 시점 code snapshot 고정, 멈춘 run에서 사람이 "고친 code로 이어 가기" 허용**: 평소 replay 안정성은 snapshot으로 지키되, 며칠 돈 긴 run이 flow 코드 버그 하나로 날아가지 않게 사람이 명시적으로 최신 코드를 적용해 이어 갈 수 있게 한다. 버린 안: snapshot 완전 고정(버그 시 Stop 후 처음부터). (사람, 2026-11-23)
- **`human()` 대기 중 flow process는 core 생존 중 유지**: 쉬는 Node process의 메모리 비용이 작고, replay 횟수를 줄여 `onEvent` 상태 유실과 비결정성 사고 여지를 최소화한다. durable replay는 core 재시작과 `ResumeWorkflow`에만 쓴다. 버린 안: `human()` 진입 시 process 내려놓기. (사람, 2026-11-23)
- **`step(key, fn)`의 `key` 명시 필수**: `Promise.all`과 `onEvent` 안의 호출은 실행 순서가 매번 달라 전역 자동 순번이 replay 때 엉뚱한 호출에 붙는다. `step` key를 필수로 두고 내부 순차 호출만 step 안 순번을 쓴다. 버린 안: 전역 호출 순번 자동 부여. (agent, 2026-11-23)
- **실패 값 모양은 `@lophn/flow`의 `{ ok: false, reason, message, session? }` 하나로 통일, 경계 오류 코드 7개 유지**: AGENTS.md의 공통 경계 오류 코드 7개를 늘리지 않으면서, flow 실행 사유(`cancelled | interrupted | stalled | model_error`)를 `reason`에 명확히 싣는다. (agent, 2026-11-23)
- **저장 상태 3개(`running | ended | stopped`) 유지, `needs_you`·`blocked`는 계산 상태**: 저장 상태 전이 race를 피하고 기존 원격 step 계산 모델과 맞춘다. (agent 제안 · 사람 승인, 2026-11-23)
- **`workflow_origin`은 넘길 때마다 갱신 + `spawned_by`만 상속**: `session: same`으로 같은 세션이 다음 step을 받을 때 `step`이 낡지 않게 넘길 때마다 갱신한다. 이미 열린 타 세션으로의 `agent call`은 상속하지 않는다. (agent, 2026-11-23)
- **sub-workflow는 초기 같은 project만 + 자식 creator 할당 그대로 사용**: 같은 project의 agent가 두 선언의 `agent:` 칸을 모두 쓸 수 있어 교집합 제한은 실익 없이 정상 동작하는 sub-workflow만 깨뜨린다. 대신 다른 project 호출을 막고 `StopWorkflow`는 자식까지 연쇄 중지한다. (agent, 2026-11-23)
- **최근 assistant 앞 N자 절단 & 명시적 `refs`만 수집**: LLM 요약은 비용·지연·비결정성을 만들고, 파일 자동 감시·`.md` 필터링은 harness별 편차와 산출물 판정을 core에 끌어들인다. (agent, 2026-11-23)
- **fallback은 core 정책이 아니라 SDK helper(`withFallback`)**: 흐름이 JS call stack에 있으므로 core가 임의 수정(`edit`)을 할 수 없고, 정책을 core에 굳히지 않기 위해 SDK helper로 둔다. (agent 제안 · 사람 승인, 2026-11-23)
- **`onEvent`는 비영속 + `job`과 같은 범위·고리 규칙**: event 저장소를 두지 않는 `job` 원칙과 일관되게, 재시작을 넘는 대기는 `tool()` 조회나 외부 event `job`에 맡긴다. (agent, 2026-11-23)
- **기존 `stack`과 비분할 `tab group`을 단일 탭 묶음 개념으로 통합**: layout migration 비용이 들더라도 사람이 배울 개념을 split + 단일 탭 묶음 둘로 유지한다. (사람, 2026-11-23)

## 열린 것

- **선언적 `inputs` 조건식(`when`) 문법**: `equals` / `in` / `truthy` 3종으로 충분한지(단계 3 구현 전 확정).
- **flow process CPU 한도**: 1단계와 동일한 알려진 한계(이슈 `flow-process-cpu-limit`).
