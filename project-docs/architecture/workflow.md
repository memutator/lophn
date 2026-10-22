# workflow

workflow는 사람과 agent가 step을 넘기며 도는 일이다. project의 PM이 정의를 쓰고, 사람이 instance를 시작하고, 참가자가 step마다 report를 낸다. lophn은 말한 대로 기록하고 말한 곳에 전할 뿐이다. 이 문서는 정의가 어디에 무엇으로 있고, instance와 그 줄이 어떻게 바뀌고, step 메시지가 누구에게 어떻게 가고, 켤 때와 멈출 때 무엇을 하는지, 누가 정의를 쓰는지, artifact가 instance를 어떻게 그리는지를 정한다. 이 경계가 흐려지면 lophn이 순서나 결과를 판정하기 시작해 agent가 다룰 예외를 막거나, 멈춘 instance가 계속 넘기거나, 켤 때 같은 step이 두 번 돈다. 계약은 `packages/protocol/workflows`, 규칙은 `packages/core/workflows`(workflows), 끼우는 곳은 `packages/core/main/daemon/wiring/workflows.ts`와 `workflows-files.ts`, 사람이 쓰는 입구는 `packages/coding-agent/cli/commands/workflow.ts`다.

## 흐름

```
 사람: 화면 | CLI (lophn workflow start|report|stop|show)      user token
 agent: tool workflow.list | get | report | edit               (시작 tool은 없다)
   │  POST /workflows/list|start|report|edit|stop  (memory)   GET workflow_instances/read|list
   ▼
 workflows service (core/workflows/service.ts)
   │  정의 읽기 ─ port ─▶ workflows-files.ts: <data>/projects/<prj>/workflows/<name>/workflow.yaml
   │  상태 읽기 → plan.ts가 HandoffPlan을 만든다 (받는 곳 풀기, step 메시지 본문)
   │  writer 앞단: 글 redaction, 본문 blob 준비 (machine:workflows 이름으로)
   ▼
 CreateWorkflowInstance | ApplyWorkflowChange  (machine만, 한 tx)
   │  instance 행 고치기, 줄 남기기, delivery가 있으면 Router.route(kind: step, unattended) ─▶ 받는 session
   │  결과를 handed | not_handed 줄로
   └ commit 뒤 afterCommit "workflows.changed" ─▶ Bus WorkflowInstanceChanged (남지 않는 event)
                                                   ─▶ 화면과 artifact view가 다시 읽는다
 켤 때: router가 돌던 turn을 닫은 뒤 reconcile (넘긴 step을 잃었으면 lophn_restarted 줄)
```

- instance 한 행(`workflow_instances`)과 그 줄(`workflow_lines`)이 정본이다. 쓰는 것은 core의 두 command뿐이고 machine 자격만 부른다. 화면, CLI, agent는 route로 읽는다.
- 줄은 고치지도 지우지도 않는다(trigger). instance 행은 상태, 지금 step, step 목록, 끝난 시각이 바뀐다.

## 지키는 것

정의
- 정의는 `<data>/projects/<prj>/workflows/<name>/`의 셋이다. 선언 `workflow.yaml`, 사람과 agent가 읽는 글 `workflow.md`, 고르는 artifact(`artifacts/static/index.html`, `artifacts/instance/index.html`). `<name>`은 slug다.
- workflow의 신원은 `(project id, name)`이다. `<project 이름>/<name>`(key)은 보이는 이름일 뿐이고 도착할 때 project id로 푼다(이름이 여럿이면 `invalid_input`, 없으면 `not_found`). project는 이름을 바꿀 수 있어 이름을 저장하지 않는다.
- lophn이 읽는 칸은 `kind`, `participants`의 `role`·`place`·`name`, `steps`의 `by`·`with`·`prompt`·`in`·`out`·`next`뿐이다. 다른 칸은 두고 읽지 않는다(strict가 아니다). `in`, `out`, `prompt`는 자연어이고 그대로 전한다. 첫 step은 `steps`의 첫 key다.
- role은 `lophn | project_manager | app_engineer | operator | human | harness`다. step 이름 `end`는 예약이다(`next` 안의 끝).
- 선언은 형식만 본다. `by`·`with`·`next`가 가리키는 이름이 있는지는 읽을 때 보지 않는다. 그런 틀림은 넘길 때 `not_handed` 줄이 된다.
- 틀린 선언은 그 workflow만 뺀다. 이유는 `ListWorkflows`의 `problem`(`no_declaration | invalid_yaml | invalid_declaration | not_agent`)에 첫 하나만 싣는다. `kind: flow`는 읽히지만 시작하지 못한다.
- 목록(`ListWorkflows`)의 step에는 `prompt`·`in`·`out`이 없다. 목록을 읽는 참가자가 다른 step의 글을 알면 캡슐화가 깨진다.

instance와 줄
- 시작(`StartWorkflow`)은 사람만 한다(actor user). 입력은 자연어 글이고 step을 고르지 않으면 첫 step이다. 시작할 수 없는 workflow는 `conflict`, 없는 step은 `not_found`다.
- instance는 시작할 때 선언의 참가자와 step 가운데 읽는 칸만 골라 옮겨 갖는다. 그 뒤 선언이 바뀌어도 instance는 그대로이고, instance의 step은 참가자가 `EditWorkflow`로 고친다.
- 상태는 `running | ended | stopped`다.
  - `ended`는 누가 그렇게 말했다는 기록일 뿐이다(report의 `next: end`나 edit의 `end`). `running`이었을 때만 `ended` 줄과 `finished_at`을 쓴다. 그 뒤 report나 `hand_now`가 실제로 넘기면(`handed`) 다시 `running`이 되고 `finished_at`이 비워진다. 넘기지 못했으면 `ended` 그대로다.
  - `stopped`는 사람이 멈춘 것이다(`StopWorkflow`, actor user). 멈춘 instance에는 넘기지 않고 고치기와 다시 멈추기를 `conflict`로 거절한다. report는 줄만 남기고 `handed: null`이다. 늦게 온 report를 잃지 않는다.
- 줄은 여덟 종류다: `started`, `report`, `edit`, `handed`, `not_handed`, `ended`, `stopped`, `lophn_restarted`. seq는 instance 안에서 1부터 잇는다. 줄의 `by`는 부른 자격의 session이 있으면 그 agent, 없으면 user다. `handed`·`not_handed`·`ended`·`lophn_restarted`는 lophn이다.
- 한 command는 instance 행을 한 번 고치고(`state_seq`가 한 번 오른다) commit 뒤 `workflows.changed`를 한 번 낸다. service는 읽은 `state_seq`로 compare를 걸고, `conflict`면 다시 읽어 `state_seq`가 바뀌었을 때만 최대 3번 건다.
- `ReadWorkflowInstance`는 instance, step마다 가장 나중 report(`last_reports`), 줄 200개씩(`cursor`)을 준다. machine 자격도 받는다. `ListWorkflowInstances`는 project(와 workflow, state)로 거르고 새것이 앞이며 50개씩, 줄마다 마지막 줄을 붙인다.

report와 고치기
- report는 instance, step, 글, `next?`, `session?`이다. `next`가 step이면 그 step의 담당에게 넘기고, `end`면 끝 기록이고, 없으면 진행 글이라 넘기지 않는다. lophn은 그 step이 지금 step인지, 글이 무엇을 말하는지 보지 않는다.
- report 글과 `hand_now`의 글은 UTF-8 8 KiB 이하다(`WORKFLOW_TEXT_MAX_BYTES`). 긴 결과는 file에 두고 경로를 쓴다. 시작 입력에는 이 한도가 없다.
- 고치기(`EditWorkflow`)는 `add_step`, `update_step`, `remove_step`, `end`, `hand_now`다. 이름이 겹치는 add는 `conflict`, 없는 이름의 update·remove는 `not_found`다. 가리키는 이름이 있는지와 지우는 step이 지금 step인지는 보지 않는다. 고칠 자격도 보지 않는다. 누가 고쳤는지 `edit` 줄의 `by`와 `detail`(고친 입력 그대로)로 남는다.

넘기기
- 담당 풀기는 command 앞(`plan.ts`)이 한다. step이 instance에 없으면 `unknown_step`, `by`가 참가자에 없으면 `unknown_participant`다.
  - `lophn`은 `{role: lophn}`, `project_manager`는 `place`가 없으면 instance의 project, `operator`는 `place`가 없으면 instance의 project이고 `name`이 꼭 있다, `app_engineer`는 `place: {app}`이 꼭 있다. 모자라면 `unresolved`다.
  - `harness`는 선언으로 받되 넘기지 못한다(`harness`).
  - `human`이면 `with`의 참가자로 같은 풀이를 하고 instance에 사람 차례(`current.human_turn`)를 적는다. `with`가 없으면 `no_with`다.
- `session: same`이면 그 참가자가 이 instance에서 마지막으로 step 메시지를 받은 session(가장 나중 `handed` 줄의 `receiver`)에 `fallback: new`로 보낸다. 없으면 새 session이다. 안 적으면 `new`다.
- command는 받은 plan대로 Router에 넣는다(`from: program`, `reply: none`, `kind: step`, `unattended: true`). Router가 `ok`의 `done`이나 `accepted`를 주면 받은 session으로 `handed` 줄을 남기고 `current`를 그 step으로 한다. `failed`(없는 담당, 닫힌 session)면 `not_handed`(`unresolved`) 줄이다. Router가 `err`를 주면 tx 전체가 되돌아가 줄도 상태도 남지 않는다.
- 담당을 풀 수 없으면 넘기지 않고 그 사실만 줄로 남긴다. 고치는 것은 agent의 일이다.

step 입력
- step 메시지는 입력 종류 `step`이다. 받는 session은 `<lophn-step instance="…" step="…">본문</lophn-step>`과 고정 영어 한 줄("…report it with the workflow.report tool.")로 받는다. 받은 봉투와 `messages` 표(`step_instance`, `step_name`)에 instance와 step이 남아 뒤 turn의 이력이 같은 글을 만든다. call 행은 없다.
- 본문은 그 step의 `prompt`, 빈 줄, `Receives:` `in`, `Received:` 받은 글, `Produces:` `out`, `Next candidates:` `next`다(빈 칸은 줄째 뺀다). 받은 글은 report 글(시작이면 시작 입력, `hand_now`면 그 글 또는 마지막 report 글 또는 시작 입력)이다. `workflow.md`와 다른 step은 싣지 않는다.
- step 입력은 unattended 표시를 실어 그 turn이 묻지 않는다(`architecture/approval.md` "turn mode"). 할당은 넓히지 않는다. 받은 agent는 그래도 자기 할당에 없는 앱 tool을 쓰지 못한다. 사람 step의 대화에서 사람이 보낸 메시지가 연 turn은 attended다.
- step 입력도 call처럼 rewind 시점(checkpoint)이다.
- 시작 입력, report와 `hand_now`의 글, 본문은 writer 앞단에서 redaction을 거친다. 본문은 받는 session 기록에 들어가므로 `machine:workflows` 이름으로 blob을 준비한다(`architecture/agent-call.md`).

켤 때와 멈춤
- 켤 때 입력함은 비고 step 메시지는 다시 넣지 않는다. router가 돌던 turn을 닫은 뒤 `reconcile`이 running instance마다 가장 나중 `handed` 줄을 본다. 그 session이 받은 메시지를 아직 turn이 가져가지 않았거나 가져간 turn이 restart로 끊겼으면 `lophn_restarted` 줄을 남긴다. 그 뒤에 이미 `lophn_restarted` 줄이나 그 step의 report가 있으면 남기지 않는다. 상태와 지금 step은 바꾸지 않는다. 다시 넘기는 일은 agent나 사람의 `hand_now`다.
- `StopWorkflow`는 instance를 먼저 `stopped`로 닫고, 그 instance의 `handed` 줄에 있는 session마다 도는 turn을 멈춘다(best-effort, 실패는 기록하지 않는다). 그 session이 다른 일을 하던 turn도 멈춘다.

쓰기 범위
- project의 `workflows/`는 그 project의 PM만 file tool로 읽고 쓴다(`placeScope`). Operator, App Engineer, lophn에는 열리지 않는다. 폴더는 PM의 turn 시작에 만들고, PM의 place 정보에 `Workflows folder:` 줄로 절대 경로가 보인다. rewind의 쓰기 폴더와 runtime child의 권한도 같은 규칙을 따른다(`architecture/domain.md`).
- 정의를 만들고 고치는 법은 PM의 내장 skill `guide-workflows`다.

agent tool과 CLI
- agent tool `workflow.list`, `workflow.get`, `workflow.report`, `workflow.edit`을 모든 role이 받는다. 누구든 참가자일 수 있다. 시작하는 tool은 없다. `workflow.list`는 project를 주지 않으면 그 agent의 project place를 쓴다.
- 모든 role의 제품 규칙이 step tag의 뜻과 report하는 법을 말한다. agent는 instance 상태를 늘 받지 않고 고칠 일이 있을 때 `workflow.get`으로 읽는다.
- CLI는 `lophn workflow start <workflow> <text>`(`--step`), `report <instance> <step> <text>`(`--next`, `--session`), `stop <instance>`, `show <instance>`다. 자격은 user token이다(`architecture/run.md` "CLI와 자격"). program도 이 입구로 report한다. program 자격을 따로 두는 일은 roadmap의 일이다.

artifact
- workflow artifact는 봉한 view로 연다(`architecture/artifact.md`). source는 `{kind: workflow, project, workflow, view: static | instance, instance?}`이고 root는 그 project의 `workflows/` 안이어야 한다(realpath). instance view는 instance마다 host가 달라 origin이 갈린다.
- 봉한 scheme이 가상 file을 준다. instance view의 `data/_instance.json`(`ReadWorkflowInstance`를 끝까지 읽은 `{instance, last_reports, lines}`, 4 MiB가 넘거나 못 읽으면 503)과 `_lophn/kit.js`·`_lophn/kit.css`(renderer build의 `artifact-kit/entry.js`·`entry.css`)다.
- `WorkflowInstanceChanged`가 오면 그 instance를 여는 view만 다시 load한다.
- kit은 전역 `LophnKit.renderGraph(element, {nodes, edges})`를 내고 node에 `status`(label, tone)와 `note`를 받는다. 상태 값의 뜻은 component가 모르고 artifact가 정한다(`architecture/ui-kit.md`). lophn의 기본 화면은 graph를 그리지 않는다.

## 왜 이 모양인가

- lophn program은 최대한 약하다. 순서, 결과, 고칠 자격을 판정하면 그 코드가 workflow의 정책에 기대고, agent 성능이 오를수록 덜어내야 할 규칙이 된다. 예외는 program이 다룰 수 없어서 workflow 안의 agent가 다룬다. 결정적 제약이 필요하면 그 workflow의 program이 진다(`project-docs/products/roadmap/workflow.md` "원칙").
- `ended`를 굳히지 않는다. 끝을 lophn이 굳히면 다시 열어야 할 예외를 agent가 다루지 못한다. 사람이 멈춘 것만 굳힌다.
- 정본은 표다. CLI로 낸 report는 session event가 없어서 화면이 알 길은 남지 않는 event뿐이고, 놓친 화면은 다시 읽는다(`architecture/event.md`).
- 본문과 받는 곳을 command 앞에서 정한다. 본문은 blob이라 tx 안에서 만들 수 없고, 앞에서 정해 넘기면 command는 받은 대로 넣기만 한다. 줄과 입력이 반쪽만 남지 않게 한 tx다.
- 켤 때 다시 넣지 않는다. 다시 넣으면 바깥 효과가 두 번 날 수 있다. 그래도 말없이 잃지 않게 줄로 남긴다(`architecture/run.md` "켤 때와 session 끝").
- step 메시지는 그 step만 싣는다. agent는 domain처럼 자기 일의 in/out만 알면 되고, system prompt에 workflow를 싣지 않아 cache도 깨지지 않는다.
- module은 lophn-agent와 다른 feature module을 import하지 않는다. 정의 file 읽기, project 이름 풀기, turn 멈추기와 읽기, 기록 command 부르기는 `ports.ts`의 port이고 wiring이 끼운다(`architecture/layers.md`).
