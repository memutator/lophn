# workflow

workflow는 사람과 agent가 step을 넘기며 도는 일(`kind: agent`)이거나, PM이 쓴 code가 agent와 앱 tool을 불러 가며 도는 일(`kind: flow`)이다. project의 PM이 정의를 쓰고, 사람이나 job이 instance를 시작하고, 참가자나 flow의 code가 step마다 report를 낸다. lophn은 말한 대로 기록하고 말한 곳에 전할 뿐이다. 이 문서는 정의가 어디에 무엇으로 있고, instance와 그 줄이 어떻게 바뀌고, step 메시지가 누구에게 어떻게 가고, 켤 때와 멈출 때 무엇을 하는지, 누가 정의를 쓰는지, artifact가 instance를 어떻게 그리는지, flow의 code를 어떻게 띄우고 무엇을 허락하는지를 정한다. 이 경계가 흐려지면 lophn이 순서나 결과를 판정하기 시작해 agent가 다룰 예외를 막거나, 멈춘 instance가 계속 넘기거나, 켤 때 같은 step이나 flow가 두 번 돌거나, AI가 짠 flow code가 PM의 할당과 sandbox 밖에서 바깥 효과를 낸다. 계약은 `packages/protocol/workflows`, 규칙은 `packages/core/workflows`(workflows), 끼우는 곳은 `packages/core/main/daemon/wiring/workflows.ts`와 `workflows-files.ts`, flow process를 띄우는 host와 `workflow.check`는 `packages/core/main/flow-host/`(끼우는 곳 `wiring/flows.ts`), flow code가 쓰는 SDK는 `packages/sdk/flow`(`@lophn/flow`), 사람이 쓰는 입구는 `packages/coding-agent/cli/commands/workflow.ts`다.

## 흐름

```
 사람: 화면 | CLI (lophn workflow start|report|stop|show)      user token
 agent: tool workflow.list | get | report | edit | check       (시작 tool은 없다. check는 PM만)
 job: scheduler ─ workflowService.start(…, {kind: "job", job})   (core 안. route 아님, architecture/job.md)
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
 켤 때: router가 돌던 turn을 닫은 뒤 reconcile (넘긴 step을 잃었으면 lophn_restarted 줄, 도는 flow는 닫는다)

 flow: start ─ CreateWorkflowInstance(handoff 없음) ─ WorkflowFlows.launch ─▶ flow host (core/main/flow-host)
   deno run <sandbox flag> <data>/sdk/flow/<v>/entry.ts <workflow 폴더>/flow.ts   instance마다 process 하나
   stdin ◀── start, response          stdout ──▶ agent | tool | report 요청 (JSON 줄)
   agent·tool ─▶ RunService.start(…, {instance, PM}) ─ wait ─▶ 응답    report ─▶ service.report(…, by program)
   stderr ─▶ redaction ─▶ <data>/flows/<instance>.log + 끝 10줄
   끝 ─▶ cancelOfInstance ─▶ programExited (program_exited 줄, running이면 ended)
```

- instance 한 행(`workflow_instances`)과 그 줄(`workflow_lines`)이 정본이다. 쓰는 것은 core의 두 command뿐이고 machine 자격만 부른다. 화면, CLI, agent는 route로 읽는다.
- 줄은 고치지도 지우지도 않는다(trigger). instance 행은 상태, 지금 step, step 목록, 끝난 시각이 바뀐다.
- flow도 instance와 줄, 화면이 `kind: agent`와 같다. 다른 것은 step을 넘기지 않고 code가 report한다는 것뿐이다.

## 지키는 것

정의
- 정의는 `<data>/projects/<prj>/workflows/<name>/`의 셋이다. 선언 `workflow.yaml`, 사람과 agent가 읽는 글 `workflow.md`, 고르는 artifact(`artifacts/static/index.html`, `artifacts/instance/index.html`). `<name>`은 slug다. `kind: flow`는 code `flow.ts`가 넷째다(이름은 선언에 적지 않는다). `flow.ts`는 같은 폴더의 다른 file을 import할 수 있다.
- workflow의 신원은 `(project id, name)`이다. `<project 이름>/<name>`(key)은 보이는 이름일 뿐이고 도착할 때 project id로 푼다(이름이 여럿이면 `invalid_input`, 없으면 `not_found`). project는 이름을 바꿀 수 있어 이름을 저장하지 않는다.
- lophn이 읽는 칸은 `kind`, `participants`의 `role`·`place`·`name`, `steps`의 `by`·`with`·`prompt`·`in`·`out`·`next`뿐이다. 다른 칸은 두고 읽지 않는다(strict가 아니다). `kind: flow`에서는 `kind`와 `steps`의 key(step 이름)만 읽는다. step 이름은 화면과 report의 자리일 뿐이고 `participants`와 step의 다른 칸은 읽지 않는다. `steps`가 비면 틀린 선언이다. `in`, `out`, `prompt`는 자연어이고 그대로 전한다. 첫 step은 `steps`의 첫 key다.
- role은 `lophn | project_manager | app_engineer | operator | human | harness`다. step 이름 `end`는 예약이다(`next` 안의 끝).
- 선언은 형식만 본다. `by`·`with`·`next`가 가리키는 이름이 있는지는 읽을 때 보지 않는다. 그런 틀림은 넘길 때 `not_handed` 줄이 된다.
- 틀린 선언은 그 workflow만 뺀다. 이유는 `ListWorkflows`의 `problem`(`no_declaration | invalid_yaml | invalid_declaration | no_flow_file`)에 첫 하나만 싣는다. `flow.ts`가 없는 flow는 시작하지 못하고 `no_flow_file`이다. flow의 목록 step은 `by: program`(`FLOW_STEP_BY`)이고 `with`·`next`가 비어 있다.
- 목록(`ListWorkflows`)의 step에는 `prompt`·`in`·`out`이 없다. 목록을 읽는 참가자가 다른 step의 글을 알면 캡슐화가 깨진다.

instance와 줄
- 시작은 사람(`StartWorkflow`, actor user) 또는 job이다. 시작한 쪽은 instance 행의 `started_by`(`{kind: user}` 또는 `{kind: job, job}`)에 남는다. job은 `StartWorkflow` route가 아니라 core 안 `workflowService.start(input, by)`를 부른다. 어느 쪽이든 입력은 자연어 글이고 step을 고르지 않으면 첫 step이다. 시작할 수 없는 workflow는 `conflict`, 없는 step은 `not_found`다. flow는 step을 받지 않고(주면 `invalid_input`) 넘기지 않아 `handed`가 null이다. flow의 `started` 줄에는 step이 없다.
  - job이 시작하면 그 job의 job run이 instance가 끝날 때까지 도는 줄로 남고 같은 job의 다음 차례는 건너뛴다. job run은 instance 상태를 따라 닫힌다(`ended`면 done, `stopped`면 cancelled, `architecture/job.md`). 지운 job이 시작한 instance는 `started_by`에 id만 남고 제목이 없다.
- instance는 시작할 때 선언의 참가자와 step 가운데 읽는 칸만 골라 옮겨 갖는다. 그 뒤 선언이 바뀌어도 instance는 그대로이고, instance의 step은 참가자가 `EditWorkflow`로 고친다.
- 상태는 `running | ended | stopped`다.
  - `ended`는 누가 그렇게 말했다는 기록일 뿐이다(report의 `next: end`나 edit의 `end`). `running`이었을 때만 `ended` 줄과 `finished_at`을 쓴다. 그 뒤 report나 `hand_now`가 실제로 넘기면(`handed`) 다시 `running`이 되고 `finished_at`이 비워진다. 넘기지 못했으면 `ended` 그대로다.
  - `stopped`는 사람이 멈춘 것이다(`StopWorkflow`, actor user). 멈춘 instance에는 넘기지 않고 고치기와 다시 멈추기를 `conflict`로 거절한다. report는 줄만 남기고 `handed: null`이다. 늦게 온 report를 잃지 않는다.
- 줄은 아홉 종류다: `started`, `report`, `edit`, `handed`, `not_handed`, `ended`, `stopped`, `lophn_restarted`, `program_exited`. seq는 instance 안에서 1부터 잇는다. 줄의 `by`는 부른 자격의 session이 있으면 그 agent, 없으면 user다. flow code가 낸 report는 `program`이다. `started` 줄만 `started_by`(사람 또는 job)를 그대로 싣는다. `handed`·`not_handed`·`ended`·`lophn_restarted`·`program_exited`는 lophn이다.
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
- step 입력은 unattended 표시를 실어 그 turn이 묻지 않는다(`architecture/approval.md` "turn mode"). 할당은 넓히지 않는다. 받은 agent는 그래도 자기 할당에 없는 앱 tool을 쓰지 못한다. 사람 step의 대화에서 사람이 보낸 메시지가 연 turn은 attended다. job이 시작한 instance의 step 입력도 같다(사람이 없다).
- step 입력도 call처럼 rewind 시점(checkpoint)이다.
- 시작 입력, report와 `hand_now`의 글, 본문은 writer 앞단에서 redaction을 거친다. 본문은 받는 session 기록에 들어가므로 `machine:workflows` 이름으로 blob을 준비한다(`architecture/agent-call.md`).

켤 때와 멈춤
- 켤 때 입력함은 비고 step 메시지는 다시 넣지 않는다. router가 돌던 turn을 닫은 뒤 `reconcile`이 running instance마다 가장 나중 `handed` 줄을 본다. 그 session이 받은 메시지를 아직 turn이 가져가지 않았거나 가져간 turn이 restart로 끊겼으면 `lophn_restarted` 줄을 남긴다. 그 뒤에 이미 `lophn_restarted` 줄이나 그 step의 report가 있으면 남기지 않는다. 상태와 지금 step은 바꾸지 않는다. 다시 넘기는 일은 agent나 사람의 `hand_now`다.
- `StopWorkflow`는 instance를 먼저 `stopped`로 닫고, 그 instance의 `handed` 줄에 있는 session마다 도는 turn을 멈춘다(best-effort, 실패는 기록하지 않는다). 그 session이 다른 일을 하던 turn도 멈춘다. 그 뒤 flow process가 있으면 죽이고 그 instance가 연 run을 취소한다(`WorkflowFlows.stop`). 뒤따르는 `program_exited` 줄은 `stopped`인 instance에 줄로만 남는다.
- 켤 때 `running`인 flow instance는 process가 없다. 첫 `started` 줄의 step이 null인 instance가 flow다. `lophn_restarted` 줄(step·receiver null)을 남기고 `ended`로 닫는다. 다시 띄우지 않는다. job이 시작한 instance였으면 그 job run은 다음 바퀴에 `done`으로 닫힌다(`architecture/job.md`).

flow
- instance 하나에 process 하나다. 시작할 때 host가 띄우고(`WorkflowFlows.launch`), code가 끝나면 끝난다. 다시 띄우지 않는다(자동 재시도 없음). 띄우지 못하면 시작은 그대로 성공이고 그 이유가 `program_exited`(code null) 줄로 남아 instance가 `ended`가 된다.
- process는 `deno run`이고 앱 process와 같은 꼴의 sandbox다(`packages/core/main/flow-host/flags.ts`의 `flowFlags`). 읽기는 그 workflow 폴더와 설치된 SDK(`<data>/sdk`)뿐이고 쓰기, 네트워크, 다른 program 실행, 환경 변수가 없다. flag는 `--no-prompt --no-config --no-remote --no-npm --cached-only --no-lock --quiet`, `--allow-read` 하나, 폴더 밖 symlink의 `--deny-read`, memory 한도, SDK import map(`<data>/flows/import-map.json`) 순이다. 바깥 효과는 모두 앱 tool과 agent를 거친다. 그래야 invocation 기록과 rewind가 선다.
  - Deno는 허락한 폴더 안의 symlink를 따라간다. 그래서 launch 때 host가 workflow 폴더 전체를 훑어(앱과 같은 `realPathResolver`의 `linksIn`) 실제 경로가 폴더 밖이거나 풀리지 않는 link마다 `--deny-read=<그 lexical 경로>`를 더한다. 훑기와 launch 사이에 새로 생긴 link는 막지 못한다(앱의 `permissions.limit.symlink-changes`와 같은 한계). flow process는 쓰기 허락이 없어 link를 만들지 못한다. 만드는 길은 PM의 `shell.run`이다.
  - memory는 `--v8-flags=--max-old-space-size=512`(512 MiB)다. flow는 agent와 앱 tool을 부르는 순서를 짜는 code라 넉넉하다. 넘으면 process가 죽고 `program_exited` 줄에 끝 code와 stderr 끝이 남는다. CPU와 시간 한도는 없고 멈추는 길은 `StopWorkflow`뿐이다.
- process와 core는 stdin·stdout의 JSON 줄로 말한다(`packages/protocol/workflows/flow-wire.ts`). core가 첫 줄 `start`(instance, 입력 글)를 쓰고, process가 `agent`·`tool`·`report` 요청을 id와 함께 보내면 core가 같은 id의 `response`(`{ok: true, result}` 또는 `{ok: false, reason, message}`)로 답한다. 실패도 값이다. 요청에는 instance가 없다. core가 그 process의 것으로 채운다.
  - 진입 file은 lophn이 쥔 SDK의 `entry.ts`다. `flow.ts`를 import하기 전에 `console`과 `process.stdout`의 `write`를 stderr로 돌려 `flow.ts`가 쓴 글이 통로를 깨지 않게 한다. 통로는 `wire.ts`를 읽을 때 잡아 둔 원래 `write`만 쓰고, `entry.ts`가 `wire.ts`를 먼저 import해 잡기가 돌리기보다 앞선다. stdin이 닫히면 process는 스스로 끝난다(core가 죽어도 고아로 남지 않는다).
  - JSON이 아니거나 id가 없거나 1 MiB를 넘는 줄이 오면 통로가 깨진 것이라 host가 process를 끝낸다. 읽히지만 칸이 틀린 요청은 `invalid_input` 실패 값으로 답한다(오타 하나로 flow 전체가 죽지 않게).
- `agent`는 run 하나를 열고(받는 agent는 누구든 된다) 끝날 때까지 `WaitRun`을 되풀이해 답을 준다. `tool`은 tool run 하나다. 둘 다 run의 origin이 그 instance와 그 project의 PM이다(`architecture/run.md`). `report`는 `kind: agent`의 report와 같은 뜻이고 core 안에서 `by: program`으로 들어간다. 한 process의 report는 순서대로 하나씩 처리하고 agent·tool은 동시에 돌 수 있다.
- program report는 넘기지 않는다. `running`일 때만 지금 step을 그 report의 step으로 옮기고 `next: end`면 `ended`로 닫는다. `stopped`나 `ended` 뒤의 report는 줄만 남고 다시 `running`이 되지 않는다. step 이름이 선언에 있는지 보지 않는다.
- flow의 앱 tool 호출은 그 project PM의 지금 할당과 맡은 domain 안에서만 된다(`architecture/app-call.md`의 flow caller). code를 쓴 것이 PM이라 code로 PM의 할당을 넓히지 못한다. 사람이 PM에게 그 앱을 할당해야 flow가 그 tool을 쓴다. flow가 부르는 agent는 누구든 되고, 입력은 unattended이며, 받은 agent는 자기 할당으로만 일한다.
- origin과 flow 자격은 route 입력이 아니다. flow process에는 credential을 주지 않고 통로로 온 요청을 core가 그 instance의 이름으로 한다.
- stderr는 줄마다 redaction을 거쳐 `<data>/flows/<instance>.log`에 쌓인다(1 MiB에서 멈춘다). PM의 workflow 폴더 밖이라 flow가 읽지 못한다. process가 끝나면 host는 그 instance가 연 running run을 취소하고(`cancelOfInstance`) `program_exited` 줄에 끝 code(신호로 죽으면 null)와 stderr 끝 10줄(줄마다 500자)을 남긴다. 그때 instance가 `running`이면 `ended`로 닫는다(by lophn). 남은 참가자가 없어 아무도 이어 갈 수 없다. lophn은 성공인지 판정하지 않는다.
- core가 꺼질 때 host는 process를 모두 끝내지만 줄을 쓰지 않는다. instance는 `running`으로 남아 다음 켤 때 닫힌다(위 "켤 때와 멈춤").
- PM은 instance를 시작하지 못한다. 쓴 `flow.ts`는 `workflow.check`(`CheckWorkflow`, PM만)로 본다. 설치된 `@lophn/flow`에 대고 `deno check`만 돌려(실행하지 않는다) 오류 줄을 돌려준다(`packages/core/main/flow-host/check.ts`). 원격·npm import는 오류다.
- SDK `@lophn/flow`는 `input`, `instance`, `agent(...)`, `tool(...)`, `report(...)` 다섯을 낸다. protocol과 Zod를 import하지 않고 통로 모양을 손으로 옮겼다. 다른 SDK처럼 `<data>/sdk`에 깔린다. 쓰는 법은 PM의 내장 skill `guide-workflows`의 "Flow workflows"다.

쓰기 범위
- project의 `workflows/`는 그 project의 PM만 file tool로 읽고 쓴다(`placeScope`). Operator, App Engineer, lophn에는 열리지 않는다. 폴더는 PM의 turn 시작에 만들고, PM의 place 정보에 `Workflows folder:` 줄로 절대 경로가 보인다. rewind의 쓰기 폴더도 같은 규칙을 따른다(`architecture/domain.md`).
- 정의를 만들고 고치는 법은 PM의 내장 skill `guide-workflows`다.

agent tool과 CLI
- agent tool `workflow.list`, `workflow.get`, `workflow.report`, `workflow.edit`을 모든 role이 받는다. `workflow.check`는 PM만 받는다("flow"). 누구든 참가자일 수 있다. 시작하는 tool은 없다. 정해진 때 시작하는 길은 job의 `workflow_start`이고 그 job은 `job.create`로 만든다(`architecture/job.md`). `workflow.list`는 project를 주지 않으면 그 agent의 project place를 쓴다.
- 모든 role의 제품 규칙이 step tag의 뜻과 report하는 법을 말한다. agent는 instance 상태를 늘 받지 않고 고칠 일이 있을 때 `workflow.get`으로 읽는다.
- CLI는 `lophn workflow start <workflow> <text>`(`--step`), `report <instance> <step> <text>`(`--next`, `--session`), `stop <instance>`, `show <instance>`다. 자격은 user token이다(`architecture/run.md` "CLI와 자격"). lophn 밖의 program도 이 입구로 사람으로서 report한다. flow의 report는 이 입구가 아니라 core 안에서 `by: program`으로 들어간다.

artifact
- workflow artifact는 봉한 view로 연다(`architecture/artifact.md`). source는 `{kind: workflow, project, workflow, view: static | instance, instance?}`이고 root는 그 project의 `workflows/` 안이어야 한다(realpath). instance view는 instance마다 host가 달라 origin이 갈린다.
- 봉한 scheme이 가상 file을 준다. instance view의 `data/_instance.json`(`ReadWorkflowInstance`를 끝까지 읽은 `{instance, last_reports, lines}`, 4 MiB가 넘거나 못 읽으면 503)과, 모든 artifact view에 있는 `_lophn/kit.js`·`_lophn/kit.css`(renderer build의 `artifact-kit/entry.js`·`entry.css`)다.
- `WorkflowInstanceChanged`가 오면 그 instance를 여는 view만 다시 load한다.
- kit은 전역 `LophnKit.renderGraph(element, {nodes, edges})`를 내고 node에 `status`(label, tone)와 `note`를 받는다. 상태 값의 뜻은 component가 모르고 artifact가 정한다(`architecture/ui-kit.md`). lophn의 기본 화면은 graph를 그리지 않는다.

화면
- workflow 하나가 탭 하나다(kind `workflow`, key `workflow:<name>`, 필드 `{workflow, instance?}`). 탭 안에서 instance를 고르고, 고른 instance는 layout에 남는다(`packages/shell/renderer/workspace/kinds/workflow.tsx`, 본문 `packages/shell/renderer/workflow/`).
- 탭 머리는 이름, kind, 도는 instance 수, [Start], static artifact가 있으면 [Open artifact]다. 틀린 선언과 `flow.ts`가 없는 flow는 이유 한 줄을 보이고 시작하지 못한다. flow의 [Start] dialog는 입력 글만 받는다(첫 step을 고르지 않는다). instance 목록은 새것이 앞이고 job이 시작한 instance 줄은 시작한 쪽으로 job 제목을 보인다(지운 job이면 제목 없이 "Scheduled job"). 고른 instance의 머리도 같다. 제목은 읽는 곳이 `job.list`로 붙인다(`packages/shell/renderer/workspace/core-source.ts`). 고른 instance는 step마다 상태, 마지막 report 글, 그 step의 줄을 보이고, step 없는 줄(`ended`, `stopped`, `program_exited`, step 없는 `edit`과 `lophn_restarted`)은 머리에 둔다. `program_exited`는 끝 code(신호면 "stopped before it finished")와 stderr 끝 줄을 code block으로 보인다. flow의 report는 "Program"이 낸 것으로 보이고 flow step에는 담당 글이 없다. `not_handed`와 `lophn_restarted`는 그 step 줄 안에 이유 한 줄이다. 사람 차례면 받은 agent와 [Open conversation](가장 나중 `handed` 줄의 `receiver` session)을, running이면 [Stop]을, instance artifact가 있으면 [Open instance artifact]를 둔다. graph는 그리지 않는다.
- 사람 화면이 부르는 memory route는 `ListWorkflows`, `StartWorkflow`, `StopWorkflow`뿐이다(`packages/shell/main/desktop/core/allowlist.ts`). report와 고치기는 agent가 한다. 사람이 순서를 바꾸고 싶으면 그 agent에게 말한다.
- 정의는 탭이 열릴 때와 [Refresh]에서 읽는다. instance 목록과 고른 instance는 처음, `WorkflowInstanceChanged`가 올 때, 시작·멈춤 뒤에 다시 읽는다. 끊긴 사이 놓친 것은 다시 열거나 [Refresh]로 맞춘다.
- project sidebar의 activity bar에 Workflows 항목이 있다. panel은 project의 workflow 목록(이름, 도는 instance 수, 틀린 선언 표시)이고 줄을 누르면 그 workflow의 탭을 연다. panel은 열려 있는 동안 열릴 때와 `WorkflowInstanceChanged` 때 읽는다.

## 왜 이 모양인가

- lophn program은 최대한 약하다. 순서, 결과, 고칠 자격을 판정하면 그 코드가 workflow의 정책에 기대고, agent 성능이 오를수록 덜어내야 할 규칙이 된다. 예외는 program이 다룰 수 없어서 workflow 안의 agent가 다룬다. 결정적 제약이 필요하면 그 workflow의 program이 진다(`project-docs/products/roadmap/workflow.md` "원칙").
- `ended`를 굳히지 않는다. 끝을 lophn이 굳히면 다시 열어야 할 예외를 agent가 다루지 못한다. 사람이 멈춘 것만 굳힌다.
- 정본은 표다. CLI로 낸 report는 session event가 없어서 화면이 알 길은 남지 않는 event뿐이고, 놓친 화면은 다시 읽는다(`architecture/event.md`).
- job은 `StartWorkflow` route가 아니라 core 안 service로 시작한다. 그 route는 사람만 받는 입구(actor user)이고, job은 사람 자격이 없는 machine이 부르는 일이라서다. route를 job에도 열면 "시작은 사람의 일"이라는 입구의 뜻이 흐려진다.
- 본문과 받는 곳을 command 앞에서 정한다. 본문은 blob이라 tx 안에서 만들 수 없고, 앞에서 정해 넘기면 command는 받은 대로 넣기만 한다. 줄과 입력이 반쪽만 남지 않게 한 tx다.
- 켤 때 다시 넣지 않는다. 다시 넣으면 바깥 효과가 두 번 날 수 있다. 그래도 말없이 잃지 않게 줄로 남긴다(`architecture/run.md` "켤 때와 session 끝").
- step 메시지는 그 step만 싣는다. agent는 domain처럼 자기 일의 in/out만 알면 되고, system prompt에 workflow를 싣지 않아 cache도 깨지지 않는다.
- module은 lophn-agent와 다른 feature module을 import하지 않는다. 정의 file 읽기, project 이름 풀기, turn 멈추기와 읽기, 기록 command 부르기, flow process 띄우기와 멈추기는 `ports.ts`의 port이고 wiring이 끼운다(`architecture/layers.md`).
- flow의 code는 workflow 폴더에 둔다. 선언, 글, code가 한 폴더에 모이고, 쓰는 것은 PM의 file 쓰기라 rewind로 되돌아간다. 앱으로 두지 않은 것은 앱 tool의 120초 제한과 write 직렬화 밖에서 오래 도는 entry와 앱이 agent를 부르는 SDK를 새로 만들어야 해서다(roadmap `workflow.md` 2026-10-23).
- flow는 instance마다 process 하나이고 다시 띄우지 않는다. 다시 띄우면 바깥 효과가 두 번 난다. 실패 처리와 다시 하기는 code의 일이다.
- flow는 AI가 짠 code라 앱과 같은 sandbox에 넣고 바깥 효과를 앱 tool과 agent로만 내게 한다. 그래야 invocation 기록, 할당, rewind가 그대로 선다. 앱 supervisor(`createSupervisor`)는 쓰지 않는다. 끝난 child를 다시 띄우고 stdout을 frame 통로로 쓰기 때문이다.
- flow의 앱 tool은 PM의 할당으로 판정한다. job이 만든 agent의 할당을 넘지 못하는 것과 같은 까닭이다(`architecture/approval.md`). code에 credential을 주지 않으므로 code가 다른 자격을 빌릴 길도 없다.
