# workflow

workflow는 사람과 agent가 step을 넘기며 도는 일(`kind: agent`)이거나, project workspace의 agent가 쓴 code가 agent와 앱 tool을 불러 가며 도는 일(`kind: flow`)이다. project workspace의 session이 정의를 쓰고, 사람이나 job이 instance를 시작하고, 참가자나 flow의 code가 step마다 report를 낸다. lophn은 말한 대로 기록하고 말한 곳에 전할 뿐이다. 순서와 결과를 판정하지 않는다.

## 문제

큰 일은 사람과 agent 여럿이 step을 넘기며 돌고(예: eval loop), 어떤 일은 결정적 처리와 검증이 필요해 agent에게 step을 넘기는 것만으로는 짜기 어렵다. 이 일이 추적되고 화면에 보이려면 lophn이 상태를 가져야 한다. 그런데 lophn이 순서나 결과를 판정하기 시작하면 두 가지를 잃는다.

- agent가 다룰 수 있는 예외를 program이 막는다. 아무리 정형화된 작업도 예외 처리는 program이 할 수 없어서 agent를 쓰는 것인데, 판정이 그 길을 닫는다.
- agent 성능이 오를수록 덜어내야 할 규칙이 lophn 안에 굳는다.

그리고 경계가 흐려지면 이런 일이 생긴다: 멈춘 instance가 계속 넘긴다, 켤 때 같은 step이나 flow가 두 번 돈다(바깥 효과가 두 번 난다), AI가 짠 flow code가 정해진 agent의 할당 밖에서 바깥 효과를 낸다.

## 목표와 비목표

- 목표
  - 정의(선언, 글, artifact)가 어디에 무엇으로 있는지, instance와 그 줄이 어떻게 바뀌는지, step 메시지가 누구에게 어떻게 가는지, 켤 때와 멈출 때 무엇을 하는지를 정한다.
  - flow의 code를 어떻게 띄우고 무엇을 허락하는지를 정한다.
  - instance를 사람이 추적할 수 있다(화면, artifact).
- 비목표(일부러 하지 않는 것)
  - step 통과 판정, 결과 검증, 순서 강제. lophn은 report를 믿는다. 딱딱한 제약이 필요하면 그 workflow의 program(flow)이 진다.
  - 넘기기 정책과 예외 처리(session 고르기, 순서 바꾸기, 다시 하기, instance를 고칠 자격 판정). workflow 안의 agent가 한다.
  - 사람의 "step 옮기기" 단추. 사람은 그 agent에게 말한다.
  - workflow 그림 그리기. 필요하면 workflow의 artifact가 그린다. lophn의 기본 화면은 graph를 그리지 않는다.
  - workflow를 agent prompt에 늘 싣기와 연락처. agent는 자기 step의 prompt와 in/out만 받는다(캡슐화).
  - 선언의 반복·갈라짐 문법. step 안의 일은 담당의 일이다.
  - call 막기. 선언 밖 call도 묻지도 막지도 않는다. 받은 agent의 동작은 그 agent의 할당이 거른다.
  - workflow 안에서 묻기, 비용 관측과 상한, workflow file 안의 일회용 agent 정의.

## 모델

```
 사람: 화면 | CLI (lophn workflow start|report|stop|get)          user token
 agent: tool workflow.list | get | report | edit | check          (시작 tool은 없다. check는 project workspace만)
 job: scheduler가 core 안에서 시작한다 (route 아님, architecture/job.md)
   │  route ListWorkflows | StartWorkflow | ReportWorkflow | EditWorkflow | StopWorkflow | CheckWorkflow
   │        ReadWorkflowInstance | ListWorkflowInstances
   ▼
 workflows (정의 읽기, 받는 곳 풀기, step 메시지 본문 만들기, 글 redaction)
   ▼
 CreateWorkflowInstance | ApplyWorkflowChange   (machine 자격만, 한 transaction)
   │  instance 행 고치기, 줄 남기기, 넘길 곳이 있으면 Router에 step 입력을 넣기 ─▶ 받는 session
   │  결과를 handed | not_handed 줄로
   └ commit 뒤 StateChanged(workflow_instances) (남지 않는 event) ─▶ 화면과 artifact view가 다시 읽는다
 켤 때: router가 돌던 turn을 닫은 뒤 reconcile (넘긴 step을 잃었으면 lophn_restarted 줄, 도는 flow는 닫는다)

 flow: start ─ instance 만들기(넘기기 없음) ─ flow host가 process를 띄운다 (instance마다 하나)
   stdin ◀── start, response          stdout ──▶ agent | tool | report 요청 (JSON 줄)
   agent·tool ─▶ run 시작(origin = 그 instance, creator = 선언의 agent @ project) ─ 끝까지 기다려 응답
   report ─▶ 같은 report, 낸 이는 program
   stderr ─▶ redaction ─▶ <data>/flows/<instance>.log + 끝 10줄
   process 끝 ─▶ 그 instance의 run 취소, program_exited 줄 (running이면 ended)
```

개념과 이름은 계약에 나오는 이름이다.

- workflow: project의 `workflows/<name>/` 폴더 하나. 선언(`workflow.yaml`), 사람과 agent가 읽는 글(`workflow.md`), 고르는 artifact(`artifacts/static`, `artifacts/instance`)로 이루어진다. `kind: flow`는 같은 폴더의 code file(flow code)이 하나 더 있다. 이름은 선언에 적지 않는다.
- 참가자: `{agent, workspace?, on?}`(agent handle, `on`은 그 agent가 있는 사람의 다른 컴퓨터) 또는 `{kind: human}`. step의 `by`가 가리킨다. 사람은 step에서 `with`의 참가자(agent)의 session에서 일한다. 승인 단추가 아니라 실제로 논의하는 자리다.
- instance: 시작한 workflow 한 번. `workflow_instances` 행 하나(상태, 지금 step, step 목록, 끝난 시각, `started_by`)와 `workflow_lines` 줄이 정본이다.
- 줄 아홉 종류: `started`, `report`, `edit`, `handed`, `not_handed`, `ended`, `stopped`, `lophn_restarted`, `program_exited`.
- 상태: `running | ended | stopped`.
- step 메시지: step을 맡은 session에 가는 입력(입력 종류 `step`).
- flow: instance마다 process 하나로 도는 code. 같은 instance와 줄과 화면을 쓴다. 다른 것은 step을 넘기지 않고 code가 직접 report한다는 것뿐이다.

## 지키는 것

정의
1. 정의는 `<data>/projects/<prj>/workflows/<name>/`의 셋(flow는 넷)이다. `<name>`은 slug다. flow code는 같은 폴더의 다른 file을 import할 수 있다.
2. workflow의 신원은 `(project id, name)`이다. `<project 이름>/<name>`(key)은 보이는 이름일 뿐이고 도착할 때 project id로 푼다(이름이 여럿이면 `invalid_input`, 없으면 `not_found`). project는 이름을 바꿀 수 있어 이름을 저장하지 않는다.
3. lophn이 읽는 칸은 `kind`, `participants`의 `agent`·`workspace`·`on`·`kind`, flow의 `agent`, `steps`의 `by`·`with`·`prompt`·`in`·`out`·`next`뿐이다. 다른 칸은 두고 읽지 않는다(strict가 아니다). `kind: flow`에서는 `kind`, `agent`, `steps`의 key(step 이름)만 읽는다. step 이름은 화면과 report의 자리일 뿐이다. `steps`가 비면 틀린 선언이다. `in`, `out`, `prompt`는 자연어이고 그대로 전한다. 첫 step은 `steps`의 첫 key다.
4. step 이름 `end`는 예약이다(`next` 안의 끝).
5. 선언은 형식만 본다. `by`·`with`·`next`가 가리키는 이름이 있는지는 읽을 때 보지 않는다. 그런 틀림은 넘길 때 `not_handed` 줄이 된다.
6. 틀린 선언은 그 workflow만 목록에서 뺀다. 이유는 `ListWorkflows`의 `problem`(`no_declaration | invalid_yaml | invalid_declaration | no_flow_file`)에 첫 하나만 싣는다. flow code가 없는 flow는 시작하지 못하고 `no_flow_file`이다. flow의 목록 step은 `by: program`이고 `with`·`next`가 비어 있다.
7. 목록의 step에는 `prompt`·`in`·`out`이 없다. 목록을 읽는 참가자가 다른 step의 글을 알면 캡슐화가 깨진다.

instance와 줄
8. 정본은 instance 행과 그 줄이다. 쓰는 것은 core 안 두 command(`CreateWorkflowInstance`, `ApplyWorkflowChange`)뿐이고 machine 자격만 부른다. 화면, CLI, agent는 route로 읽고 쓴다.
9. 줄은 고치지도 지우지도 않는다(trigger). instance 행은 상태, 지금 step, step 목록, 끝난 시각이 바뀐다.
10. 시작은 사람(`StartWorkflow`, actor user) 또는 job이다. 시작한 쪽은 `started_by`(`{kind: user}` 또는 `{kind: job, job}`)에 남는다. job은 route가 아니라 core 안에서 시작한다. 입력은 자연어 글이고 step을 고르지 않으면 첫 step이다. 시작할 수 없는 workflow는 `conflict`, 없는 step은 `not_found`다. flow는 step을 받지 않고(주면 `invalid_input`) 넘기지 않아 `handed`가 null이다. flow의 `started` 줄에는 step이 없다.
11. job이 시작하면 그 job의 job run이 instance가 끝날 때까지 도는 줄로 남고 같은 job의 다음 차례는 건너뛴다. job run은 instance 상태를 따라 닫힌다(`ended`면 done, `stopped`면 cancelled, `architecture/job.md`). 지운 job이 시작한 instance는 `started_by`에 id만 남고 제목이 없다.
12. instance는 시작할 때 선언의 참가자와 step 가운데 읽는 칸만 골라 옮겨 갖는다. 그 뒤 선언이 바뀌어도 instance는 그대로이고, instance의 step은 참가자가 `EditWorkflow`로 고친다.
13. `ended`는 누가 그렇게 말했다는 기록일 뿐이다(report의 `next: end`나 edit의 `end`). `running`이었을 때만 `ended` 줄과 끝난 시각을 쓴다. 그 뒤 report나 `hand_now`가 실제로 넘기면(`handed`) 다시 `running`이 되고 끝난 시각이 비워진다. 넘기지 못했으면 `ended` 그대로다.
14. `stopped`는 사람이 멈춘 것이다(`StopWorkflow`, actor user). 멈춘 instance에는 넘기지 않고 고치기와 다시 멈추기를 `conflict`로 거절한다. report는 줄만 남기고 `handed: null`이다. 늦게 온 report를 잃지 않는다.
15. 줄의 `by`는 부른 자격의 session이 있으면 그 agent, 없으면 user다. flow code가 낸 report는 `program`이고, 다른 컴퓨터의 참가자가 낸 report는 `remote`(그 기계, 컴퓨터 이름, 이름)이며, 다른 컴퓨터의 lophn이 쓴 진행 줄(51)은 `remote_lophn`(그 기계, 컴퓨터 이름)이다. `started` 줄만 `started_by`(사람 또는 job)를 그대로 싣는다. `handed`·`not_handed`·`ended`·`lophn_restarted`·`program_exited`는 lophn이다. seq는 instance 안에서 1부터 잇는다.
16. 한 command는 instance 행을 한 번 고치고(`state_seq`가 한 번 오른다) commit 뒤 `workflow_instances` 변경(`StateChanged`)을 한 번 낸다. 쓰는 쪽은 읽은 `state_seq`로 compare를 걸고, `conflict`면 다시 읽어 `state_seq`가 바뀌었을 때만 최대 3번 건다. 안 바뀌었으면 진짜 conflict다.
17. `ReadWorkflowInstance`는 instance, step마다 가장 나중 report(`last_reports`), 줄 200개씩(`cursor`)을 준다. machine 자격도 받는다. `ListWorkflowInstances`는 project(와 workflow, state)로 거르고 새것이 앞이며 50개씩, 줄마다 마지막 줄을 붙인다.

report와 고치기
18. report는 instance, step, 글, `next?`, `session?`이다. `next`가 step이면 그 step의 담당에게 넘기고, `end`면 끝 기록이고, 없으면 진행 글이라 넘기지 않는다. lophn은 그 step이 지금 step인지, 글이 무엇을 말하는지 보지 않는다.
19. report 글과 `hand_now`의 글은 UTF-8 8 KiB 이하다. 긴 결과는 file에 두고 경로를 쓴다. 시작 입력에는 이 한도가 없다.
20. 고치기(`EditWorkflow`)는 `add_step`, `update_step`, `remove_step`, `end`, `hand_now`다. 이름이 겹치는 add는 `conflict`, 없는 이름의 update·remove는 `not_found`다. 가리키는 이름이 있는지와 지우는 step이 지금 step인지는 보지 않는다. 고칠 자격도 보지 않는다. 누가 고쳤는지는 `edit` 줄의 `by`와 `detail`(고친 입력 그대로)로 남는다.

넘기기
21. 담당 풀기는 command 앞에서 한다. step이 instance에 없으면 `unknown_step`, `by`가 참가자에 없으면 `unknown_participant`다.
    - agent 참가자는 `workspace`가 없으면 instance의 project다. handle이 풀리지 않으면(범위 agent가 그 workspace가 아닌 곳이면 포함) `unresolved`다.
    - harness agent(정의의 runtime이 harness)는 이름이 있는 agent라 `{agent}` 참가자로 넘긴다(Router가 harness queue로 보낸다, `architecture/coding-agent.md`).
    - `human`이면 `with`의 참가자로 같은 풀이를 하고 instance에 사람 차례(`current.human_turn`)를 적는다. `with`가 없으면 `no_with`다.
22. `session: same`이면 그 참가자가 이 instance에서 마지막으로 step 메시지를 받은 session(가장 나중 `handed` 줄의 `receiver`)에 `fallback: new`로 보낸다. 없으면 새 session이다. 안 적으면 `new`다.
23. command는 받은 plan대로 Router에 넣는다(보내는 쪽 program, 답 없음, 입력 종류 `step`, unattended). Router가 받았다고 하면 받은 session으로 `handed` 줄을 남기고 `current`를 그 step으로 한다. 못 넘겼다고 하면(없는 담당, 닫힌 session) `not_handed`(`unresolved`) 줄이다. Router가 오류를 주면 transaction 전체가 되돌아가 줄도 상태도 남지 않는다.
24. 담당을 풀 수 없으면 넘기지 않고 그 사실만 줄로 남긴다. 고치는 것은 agent의 일이다.

step 입력
25. 받는 session은 `<lophn-step instance="…" step="…">본문</lophn-step>`과 고정 영어 한 줄("…report it with the workflow.report tool.")로 받는다. 받은 봉투와 `messages` 표(`step_instance`, `step_name`)에 instance와 step이 남아 뒤 turn의 이력이 같은 글을 만든다. call 행은 없다.
26. 본문은 그 step의 `prompt`, 빈 줄, `Receives:` `in`, `Received:` 받은 글, `Produces:` `out`, `Next candidates:` `next`다(빈 칸은 줄째 뺀다). 받은 글은 report 글(시작이면 시작 입력, `hand_now`면 그 글 또는 마지막 report 글 또는 시작 입력)이다. `workflow.md`와 다른 step은 싣지 않는다.
27. step 입력은 unattended 표시를 실어 그 turn이 묻지 않는다(`architecture/approval.md` "turn mode"). 할당은 넓히지 않는다. 받은 agent는 그래도 자기 할당에 없는 앱 tool을 쓰지 못한다. 사람 step의 대화에서 사람이 보낸 메시지가 연 turn은 attended다. job이 시작한 instance의 step 입력도 같다(사람이 없다).
28. step 입력도 call처럼 rewind 시점(checkpoint)이다.
29. 시작 입력, report와 `hand_now`의 글, 본문은 쓰기 앞에서 redaction을 거친다. 본문은 받는 session 기록에 들어가므로 workflows 이름으로 blob을 준비한다(`architecture/agent-call.md`).

켤 때와 멈춤
30. 켤 때 queue는 비고 step 메시지는 다시 넣지 않는다. router가 돌던 turn을 닫은 뒤 running instance마다 가장 나중 `handed` 줄을 본다. 그 session이 받은 메시지를 아직 turn이 가져가지 않았거나 가져간 turn이 restart로 끊겼으면 `lophn_restarted` 줄을 남긴다. 그 뒤에 이미 `lophn_restarted` 줄이나 그 step의 report가 있으면 남기지 않는다. 상태와 지금 step은 바꾸지 않는다. 다시 넘기는 일은 agent나 사람의 `hand_now`다.
31. `StopWorkflow`는 instance를 먼저 `stopped`로 닫고, 그 instance의 `handed` 줄에 있는 session마다 도는 turn을 멈춘다(best-effort, 실패는 기록하지 않는다). 그 session이 다른 일을 하던 turn도 멈춘다. 그 뒤 flow process가 있으면 죽이고 그 instance가 연 run을 취소한다. 뒤따르는 `program_exited` 줄은 `stopped`인 instance에 줄로만 남는다.
32. 켤 때 `running`인 flow instance는 process가 없다(첫 `started` 줄의 step이 null인 instance가 flow다). `lophn_restarted` 줄(step·receiver null)을 남기고 `ended`로 닫는다. 다시 띄우지 않는다. job이 시작한 instance였으면 그 job run은 다음 바퀴에 `done`으로 닫힌다(`architecture/job.md`).

flow
33. instance 하나에 process 하나다. 시작할 때 host가 띄우고, code가 끝나면 끝난다. 다시 띄우지 않는다(자동 재시도 없음). 띄우지 못하면 시작은 그대로 성공이고 그 이유가 `program_exited`(code null) 줄로 남아 instance가 `ended`가 된다.
34. process는 Electron의 Node로 뜨는 설치된 SDK(`@lophn/flow`, `<data>/sdk/flow/<판>`)의 진입 file이고 인자가 그 instance의 flow code다. 권한 제한은 없다(사람이 정했다. 앱 process와 같다). 환경은 HOME·PATH·XDG cache 위치와 Node로 뜬다는 표시뿐이다. 바깥 효과는 앱 tool과 agent를 거쳐야 invocation 기록과 rewind가 선다. 그래서 flow guide와 skill이 그렇게 쓰라고 한다.
    - flow code의 `@lophn/flow`는 모든 flow file의 공통 조상인 `<data>/projects/node_modules/@lophn/flow` symlink가 설치 사본으로 푼다. launch와 `workflow.check`가 그 link를 만든다.
    - process는 V8 heap 한도 512 MiB(`--max-old-space-size=512`)로 뜬다. CPU와 시간 한도는 없다. 멈추는 길은 `StopWorkflow`뿐이다.
35. process와 core는 stdin·stdout의 JSON 줄로 말한다. core가 첫 줄 `start`(instance, 입력 글)를 쓰고, process가 `agent`·`tool`·`report` 요청을 id와 함께 보내면 core가 같은 id의 `response`(`{ok: true, result}` 또는 `{ok: false, reason, message}`)로 답한다. 실패도 값이다. 요청에는 instance가 없다. core가 그 process의 것으로 채운다.
    - 진입 file은 lophn이 쥔 SDK의 것이다. flow code를 import하기 전에 stdout의 write를 stderr로 돌려(console은 이를 따라온다) flow code가 쓴 글이 통로를 깨지 않게 한다. 통로는 SDK module을 읽을 때 잡아 둔 원래 write만 쓰고, 진입 file이 그 module을 먼저 import해 잡기가 돌리기보다 앞선다. stdin이 닫히면 process는 스스로 끝난다(core가 죽어도 고아로 남지 않는다).
    - JSON이 아니거나 id가 없거나 1 MiB를 넘는 줄이 오면 통로가 깨진 것이라 host가 process를 끝낸다. 읽히지만 칸이 틀린 요청은 `invalid_input` 실패 값으로 답한다(오타 하나로 flow 전체가 죽지 않게).
36. `agent` 요청은 run 하나를 열고(받는 agent는 누구든 된다) 끝날 때까지 기다려 답을 준다. `tool` 요청은 tool run 하나다. 둘 다 run의 origin이 그 instance와 그 creator다. creator는 선언의 `agent`(없으면 lophn)를 launch 때 한 번 풀고 workspace는 instance의 project다(`architecture/run.md`). flow가 workspace 없이 agent를 부르면 instance의 project다. `report`는 `kind: agent`의 report와 같은 뜻이고 core 안에서 `by: program`으로 들어간다. 한 process의 report는 순서대로 하나씩 처리하고 agent·tool은 동시에 돌 수 있다.
37. program report는 넘기지 않는다. `running`일 때만 지금 step을 그 report의 step으로 옮기고 `next: end`면 `ended`로 닫는다. `stopped`나 `ended` 뒤의 report는 줄만 남고 다시 `running`이 되지 않는다. step 이름이 선언에 있는지 보지 않는다.
38. flow의 앱 tool 호출은 creator agent의 지금 할당과 비공개 규칙(앱의 비공개 command는 그 앱 workspace만) 안에서만 된다(`architecture/app-call.md`의 flow caller). code로 그 할당을 넓히지 못한다. 사람이 그 agent에게 그 앱을 할당해야 flow가 그 tool을 쓴다. 칸을 안 쓰면 lophn이라 지금처럼 돈다. flow가 부르는 agent는 누구든 되고, 입력은 unattended이며, 받은 agent는 자기 할당으로만 일한다.
39. origin과 flow 자격은 route 입력이 아니다. flow process에는 credential을 주지 않고 통로로 온 요청을 core가 그 instance의 이름으로 한다.
40. stderr는 줄마다 redaction을 거쳐 `<data>/flows/<instance>.log`에 쌓인다(1 MiB에서 멈춘다). workflow 폴더 밖에 둔다. process가 끝나면 host는 그 instance가 연 running run을 취소하고 `program_exited` 줄에 끝 code(신호로 죽으면 null)와 stderr 끝 10줄(줄마다 500자)을 남긴다. 그때 instance가 `running`이면 `ended`로 닫는다(by lophn). 남은 참가자가 없어 아무도 이어 갈 수 없다. lophn은 성공인지 판정하지 않는다.
41. core가 꺼질 때 host는 process를 모두 끝내지만 줄을 쓰지 않는다. instance는 `running`으로 남아 다음 켤 때 닫힌다(32).
42. agent는 instance를 시작하지 못한다. 쓴 flow code는 `workflow.check`(`CheckWorkflow`, project workspace 목록에만)로 본다. 설치된 `@lophn/flow`에 대고 platform의 type check만 돌려(실행하지 않는다) 오류 줄을 돌려준다. 원격·npm import는 오류다.
43. SDK `@lophn/flow`는 `input`, `instance`, `agent(...)`, `tool(...)`, `report(...)` 다섯을 낸다. protocol과 Zod를 import하지 않고 통로 모양을 손으로 옮겼다. 다른 SDK처럼 `<data>/sdk`에 깔린다. 쓰는 법은 project workspace의 내장 skill `write-workflow`의 "Flow workflows"다.

쓰기 범위
44. project의 `workflows/`는 그 project workspace의 session이 file tool로 읽고 쓴다. app workspace와 home에는 열리지 않는다. 폴더는 project workspace의 turn 시작에 만들고, workspace 정보에 `Workflows folder:` 줄로 절대 경로가 보인다. rewind의 쓰기 폴더도 같은 규칙을 따른다(`architecture/workspace-session.md`). 정의를 만들고 고치는 법은 project workspace의 내장 skill `write-workflow`다.

다른 컴퓨터의 참가자
45. agent 참가자는 `on: <컴퓨터>`(명단의 이름이나 `mch_`, `call send --on`과 같은 풀이)를 가질 수 있다. 사람 참가자는 갖지 못한다(틀린 선언). `on`이 없으면 지금과 같다.
46. `on`은 넘길 때마다 푼다. 없거나 여럿에 맞는 이름, 이 컴퓨터, 명단에 없는 컴퓨터는 `not_handed`(`unknown_computer`)다. instance의 project가 private이면 넘기지 않는다(`not_handed` `unresolved`). workspace는 기계를 건너는 이름으로 바꾼다(project는 `pri_`, 없으면 instance의 project의 `pri_`).
47. 다른 컴퓨터로 넘기는 step은 call mail이다(`step: {instance, name}`를 실은 `call`). 그래서 call mail의 규칙이 모두 선다: mail id마다 한 번, 보낸 기계와 받는 기계 확인, 늦은 mail의 대기(사람의 [Start now]·[Skip]), 7일 만료, 먼저 닿은 취소, private, 그 기계의 mail이 연 session에만 이어 들어감, 가져가기 전 받은 기계의 재시작과 받은 session의 끝. 보낸 컴퓨터에는 보낸 쪽이 program인 call 행이 하나 남고 배달 상태(`delivery`)와 받은 session을 그 행이 맡는다.
48. 받는 컴퓨터는 그 agent와 workspace의 step 입력(보낸 쪽 program, 입력 종류 `step`)으로 넣는다. 본문 앞에 다른 컴퓨터에서 온 step이라는 고정 줄 하나를 붙인다. tag, 고정 영어 줄, report하는 법은 이 컴퓨터의 step과 같다. skip은 call처럼 그 컴퓨터의 터미널 입력 허락을 따른다.
49. report는 같은 명령(`workflow report`)이다. 받은 컴퓨터에는 instance가 없으므로, 그 session이 그 instance·step의 step 입력을 다른 컴퓨터에서 받았으면 report를 그 call의 reply mail(`report: {next, session}`, 글은 본문)로 낸다. 그 step을 받은 session만 낼 수 있고, `next`가 있는 report는 그 call을 끝내 한 번뿐이다(진행 글은 call이 열린 동안 여러 번). 다른 session의 report는 이 컴퓨터의 instance를 찾다 `not_found`다.
50. 시작한 컴퓨터는 그 reply mail을 `ApplyWorkflowChange`의 report로 한 transaction에서 적용한다: mail을 본 것으로 적고(한 번), call 행이 그 기계로 보낸 열린 행인지 보고, report 줄(by `remote`)을 남기고, 다음 step을 지금처럼 넘긴다(이 컴퓨터든 다른 컴퓨터든). 다음 step을 넘길 수 없으면(redaction 뒤 64 KiB를 넘는 글, 그 사이 private이 된 project) report는 그대로 남고 다음 step은 `not_handed` 줄이다. 다른 기계나 끝난 call의 report는 아무것도 바꾸지 않는다. instance가 계속 바뀌어 적용하지 못하면 `unavailable`로 답해 그 기계가 같은 mail을 다시 보낸다.
51. 다른 컴퓨터로 넘긴 step이 report 없이 끝나면 늘 시작한 컴퓨터에 `not_handed`(`remote_failed`) 줄과 사람이 읽는 글이 남는다: 그 컴퓨터에서 돌지 못함(건너뜀, 만료, 옛 판, 거절, 없는 받는 곳, 가져가기 전 재시작, 받은 session의 끝), 그 컴퓨터에서 report 아닌 길로 닫힘(사람의 취소, `call reply`), 이 컴퓨터에서 그 call을 취소함. 가져간 뒤 그 컴퓨터의 turn이 실패하거나 멈추거나 재시작으로 끊기면 step은 열린 채다(이 컴퓨터의 step이 실패한 turn으로 닫히지 않는 것과 같다. 뒤에 낸 report가 닿아야 한다). 그때 그 컴퓨터의 program이 진행 줄 하나를 보낸다: reply mail의 `report`에 `ended`(`failed | stopped | restarted`)를 싣고 `next`와 본문은 없다. 시작한 컴퓨터는 그것을 report 줄(by `remote_lophn`, `next` null)로 남기고 글은 자기 명단의 그 컴퓨터 이름으로 쓴다. turn은 한 번만 끝나므로 turn 하나에 줄은 하나다. `next`로 report해 닫힌 step은 보내지 않는다. 진행 글만 낸 turn이 그 뒤 끊겨도 step이 열려 있으므로 보낸다. `StopWorkflow`는 그 instance의 열린 다른 컴퓨터 step call을 취소한다(낼 call mail을 지우고 cancel mail을 낸다). 그 취소는 따로 줄을 남기지 않는다(stopped 줄이 말한다).
52. `handed` 줄은 다른 컴퓨터로 넘긴 때 `receiver`가 null이고 `remote: {machine, computer, call}`을 싣는다. `ReadWorkflowInstance`의 `remote_steps`가 그 call마다 지금 상태(`state`, `delivery`, `fail_reason`, `session`)를 준다. 배달 상태가 바뀌면 `workflow_instances` 변경이 난다. `workflow edit`을 다른 컴퓨터에서 하는 길은 없다.

## 경계와 계약

boundary: `workflows`(정의 읽기·기록·넘기기), `jobs`(job의 `workflow_start`가 instance를 시작한다). flow host는 runs와 apps를 같이 알아야 해서 workflows module 밖(core 조립 쪽)에 있고, workflows module은 정의 file 읽기, project 이름 풀기, turn 멈추기와 읽기, 기록 command 부르기, flow process 띄우기와 멈추기를 port로만 쓴다(`architecture/layers.md`).

route(memory)
- `ListWorkflows`(user, agent), `StartWorkflow`(user만), `CheckWorkflow`(agent), `ReportWorkflow`·`EditWorkflow`(user, agent), `StopWorkflow`(user만). 읽기 route는 `ReadWorkflowInstance`, `ListWorkflowInstances`.
- 사람 화면이 부르는 memory route는 `ListWorkflows`, `StartWorkflow`, `StopWorkflow`뿐이다. report와 고치기는 agent가 한다. 사람이 순서를 바꾸고 싶으면 그 agent에게 말한다.

명령
- workflow 명령 하나(`workflow.<verb>`)를 lophn agent의 `lophn` tool과 binary가 같이 쓴다. `workflow.list`, `workflow.get`, `workflow.report`, `workflow.edit`은 모든 workspace 종류의 agent가 부른다. 누구든 참가자일 수 있다. `workflow.check`는 project workspace만 부른다. `workflow.start`, `workflow.stop`은 route가 사람만 받아 binary 전용이다. agent가 정해진 때 시작하는 길은 job의 `workflow_start`이고 그 job은 `job.create`로 만든다(`architecture/job.md`). `workflow.list`는 project를 주지 않으면 그 agent의 project workspace를 쓴다.
- binary는 `lophn workflow start <workflow> <text>`(`--step`), `report <instance> <step> <text>`(`--next`, `--session`), `stop <instance>`, `get <instance>`(`--lines N`이면 최근 N줄)다. 자격은 user token이다(`architecture/run.md` "CLI와 자격"). lophn 밖의 program도 이 입구로 사람으로서 report한다. flow의 report는 이 입구가 아니라 core 안에서 `by: program`으로 들어간다.
- 모든 workspace 종류의 제품 규칙이 step tag의 뜻과 report하는 법을 말한다. agent는 instance 상태를 늘 받지 않고 고칠 일이 있을 때 `workflow.get`으로 읽는다.

event와 저장
- `StateChanged`의 `workflow_instances`(id는 instance): 남지 않는 event. 놓친 화면은 다시 읽는다(`architecture/event.md`).
- 저장: `workflow_instances`, `workflow_lines`(고치지도 지우지도 않는 trigger), step 입력의 `messages` 열(`step_instance`, `step_name`). 정의는 `<data>/projects/<prj>/workflows/<name>/`, flow의 stderr log는 `<data>/flows/<instance>.log`.
- 선언의 `agent`·`participants`의 agent는 handle이다. 내부 id가 아니다.

다른 컴퓨터의 참가자
- 선언: agent 참가자의 `on`. mail: call mail의 `step: {instance, name}`, reply mail의 `report: {next, session, ended?}`(mail 계약은 `architecture/machine-a2a.md`). 받은 컴퓨터의 report는 core 안 machine 명령 `calls/step-report`가 reply mail로 내고, 시작한 컴퓨터는 `ApplyWorkflowChange`의 `mail` 칸으로 적용한다.
- 줄: `handed`의 `remote: {machine, computer, call}`(receiver null), `not_handed`의 이유 `unknown_computer`·`remote_failed`, report 줄의 `by` `remote {machine, computer, name}`과 `remote_lophn {machine, computer}`(가져간 turn이 report 없이 끝난 진행 줄). 읽기: `ReadWorkflowInstance`의 `remote_steps`(call, step, machine, computer, state, delivery, fail_reason, session). 다른 컴퓨터에서 받은 step의 report 답은 줄이 없어 `line`이 null이다.

flow 통로
- stdin·stdout JSON 줄: `start`, `response`(core → process), `agent`·`tool`·`report` 요청(process → core). 줄 상한 1 MiB. 모양은 SDK와 core가 각자 갖고(손으로 옮김) 어긋나면 host가 값 오류로 돌려보낸다.

artifact
- workflow artifact는 봉한 view로 연다(`architecture/artifact.md`). source는 `{kind: workflow, project, workflow, view: static | instance, instance?}`이고 root는 그 project의 `workflows/` 안이어야 한다(realpath). instance view는 instance마다 host가 달라 origin이 갈린다.
- 봉한 scheme이 가상 file을 준다. instance view의 `data/_instance.json`(`ReadWorkflowInstance`를 끝까지 읽은 `{instance, last_reports, lines}`, 4 MiB가 넘거나 못 읽으면 503)과, 모든 artifact view에 있는 `_lophn/kit.js`·`_lophn/kit.css`다.
- `workflow_instances` 변경이 오면 그 instance를 여는 view만 다시 load한다.
- kit은 전역 `LophnKit.renderGraph(element, {nodes, edges})`를 내고 node에 `status`(label, tone)와 `note`를 받는다. 상태 값의 뜻은 component가 모르고 artifact가 정한다(`architecture/ui-kit.md`).

화면
- workflow 하나가 탭 하나다(kind `workflow`, key `workflow:<name>`, 필드 `{workflow, instance?}`). 탭 안의 화면은 둘이다: workflow 화면과 run 화면. 사람에게 보이는 말은 instance가 아니라 run이다. 고른 run은 layout에 남고 [All runs]로 workflow 화면에 돌아온다.
- workflow 화면은 위에서부터 머리, step 줄, 새 run 칸, run 목록이다. 머리는 이름, 종류와 도는 run 수, [Refresh], static artifact가 있으면 [Open artifact]다. step 줄은 선언의 step을 순서대로 놓고 step마다 맡은 쪽을 보인다: agent는 얼굴과 이름, 사람은 "You"(같이 이야기할 agent가 있으면 그 이름도), flow의 step은 program이다. graph는 그리지 않는다. 새 run 칸은 dialog가 아니라 화면 안에 있다: 입력 글, agent kind에서 step이 둘 이상이면 첫 step 고르기, [Start]. flow는 입력 글만 받는다. flow code가 없는 flow는 이유 한 줄을 보이고 시작하지 못한다. 틀린 선언은 이유 한 줄만 있고 새 run 칸과 목록이 없다.
- run 목록은 세 묶음이다: Needs you(사람 차례), Running, Earlier(끝났거나 멈춘 것, 다섯을 넘으면 [Show all]). 묶음 안은 새것이 앞이다. 줄은 run의 이름(시작 입력의 첫 줄), 상태, 지금 step, 시작하거나 끝난 때이고, job이 시작한 run은 job 제목을 보인다(지운 job이면 제목 없이 "Job"). run 화면의 머리도 같다. 제목은 읽는 쪽이 `job.list`로 붙인다.
- run 화면은 머리, step 줄, "지금" 한 장, step 목록이다. 머리는 run의 이름, 상태, 시작한 때, running이면 [Stop](되돌릴 수 없어 danger), run artifact가 있으면 [Open run artifact]다. step 줄은 step마다 상태를 싣는다.
- "지금" 한 장은 run이 어디에 있는지 한 문장과 사람이 다음에 할 일의 단추다. 사람 차례면 받은 agent와 [Open conversation](가장 나중 `handed` 줄의 `receiver` session)이다. agent가 일하는 중이면 그 agent와 [Open session]이고, 그 session이 사람의 답을 기다리면 사람 차례와 같은 무게로 보인다. 넘기지 못했거나(`not_handed`) lophn이 다시 켜져 끊겼으면(`lophn_restarted`) 이유와 말을 걸 session이다. 끝났으면 마지막 report 글이고, flow는 `program_exited`의 끝 code(신호면 "stopped before it finished")와 stderr 끝 줄을 code block으로 같이 보인다. 멈췄으면 멈춘 때다.
- step 목록은 step마다 맡은 쪽, 상태, 마지막 report 글이다. 그 step의 줄은 접힌 Activity 안에 있다. step을 받은 session이 있으면 [Open session]이 그 대화를 workflow 탭 옆에 연다. 단추는 이 창이 열 수 있는 session(이 workspace의 agent의 session)에만 있다. 다른 workspace의 참가자가 받은 session에는 "지금" 한 장에도 step 목록에도 단추가 없다. `not_handed`와 `lophn_restarted`는 그 step에 이유 한 줄이고 step 줄의 그 칸이 "Not sent"가 된다. flow의 report는 "Program"이 낸 것으로 보이고 flow step에는 담당 글이 없다. step 없는 `edit`과 `lophn_restarted`는 "지금" 한 장 아래 한 줄이다. step을 옮기는 단추는 없다.
- 참가자의 얼굴과 이름은 탭이 그 project의 agent 목록에서 찾는다. 다른 workspace의 agent와 목록에 없는 이름은 선언에 적힌 글 그대로다.
- 다른 컴퓨터의 참가자(`on`)는 이름 뒤에 그 컴퓨터가 붙는다("Eval analyst on Home server"). 그 step을 넘긴 뒤 아직 거기서 돌지 않으면(닿지 않음, 답 없음, 늦게 닿아 그 컴퓨터에서 사람을 기다림) step 줄의 칸과 step 목록의 상태가 "Waiting on <컴퓨터>"이고, "지금" 한 장이 배달 상태마다 한 문장을 쓴다: 그 컴퓨터가 켜지면 간다, 보냈고 답이 아직 없다, 늦게 닿아 그 컴퓨터의 Inbox에서 시작해야 한다(이것만 사람 차례의 색이다), 그 agent가 일하는 중이다. 받은 session은 그 컴퓨터에 있어 [Open session]이 없다. 거기서 돌지 못한 step(`remote_failed`)은 core가 경우마다 적은 글을 그대로 보이고, 그 step의 상태는 step 줄의 칸과 같이 "Not sent"다. 다른 컴퓨터의 참가자가 낸 report는 "<이름> on <컴퓨터>"가 낸 것으로 보인다. 그 step의 가장 나중 줄이 그 컴퓨터의 lophn이 쓴 진행 줄이면 그 줄은 "lophn on <컴퓨터>"가 낸 마지막 글이고, "지금" 한 장은 넘기지 못한 step과 같은 무게로 그 컴퓨터의 session에서 이으라고 말한다. 상태는 Running 그대로다.
- 정의는 탭이 열릴 때와 [Refresh]에서 읽는다. run 목록과 고른 run은 처음, `workflow_instances` 변경이 올 때, 시작·멈춤 뒤에 다시 읽는다. 끊긴 사이 놓친 것은 다시 열거나 [Refresh]로 맞춘다.
- project 창 오른쪽 sidebar의 panel icon tab에 Workflows 항목이 있다. panel은 project의 workflow 목록(이름, 사람 차례인 run 수와 도는 run 수, 틀린 선언 표시)이고 줄을 누르면 그 workflow의 탭을 연다. 목록 아래 [Ask lophn for a workflow]는 그 workspace에서 lophn과 새 대화를 연다(workflow는 agent가 만든다). panel은 열려 있는 동안 열릴 때와 `workflow_instances` 변경 때 읽는다.

## 결정

방향(roadmap)
- lophn program은 최대한 약하다. 순서, 결과, 고칠 자격을 판정하면 그 코드가 workflow의 정책에 기대고, agent 성능이 오를수록 덜어내야 할 규칙이 된다. 예외는 program이 다룰 수 없어서 workflow 안의 agent가 다룬다. 결정적 제약이 필요하면 그 workflow의 program이 진다. (사람, 2026-10-20·22)
- workflow 선언을 domain 밑에 두지 않는다. workflow는 여러 domain에 걸치는 일이 더 많다. 선언에 kind 구분을 둔다. flow도 workflow의 kind다. (사람, 2026-10-22)
- 참가자는 있는 agent이거나 사람이다. workflow file 안에서 일회용 agent를 정의하지 않는다. 사람은 승인 단추가 아니라 실제로 논의하는 참가자이고, 사람 step의 결과는 사람과 맞닿은 가장 가까운 agent가 낸다. (사람, 2026-10-20·22)
- 연락처와 workflow를 agent에게 늘 싣지 않는다. 경계의 가장 큰 이유가 추상화와 캡슐화라서, agent는 자기 일의 in/out만 알면 상대를 전부 알지 않아도 동작한다. 그래서 step 메시지는 그 step만 싣고, system prompt에 workflow를 싣지 않아 cache도 깨지지 않는다. (사람, 2026-10-22)
- workflow 안에서는 묻지 않는다. workflow로 쓴다는 것은 바깥 효과까지 책임지겠다는 뜻이다. (사람, 2026-10-20)
- 진행은 agent가 받은 대로 쓰는 자연어 칸이다. lophn이 그 뜻을 이해하지 않는다. session을 이어 쓸지 같은 정책도 workflow가 정한다. (사람, 2026-10-22)
- instance 상태는 workflow 안에서 고친다. 사람이 화면에서 step을 옮기는 길을 따로 두지 않는다. (사람, 2026-10-22) 사람 화면은 report와 고치기를 부르지 않는다. (agent, roadmap)
- 정의는 셋이다: 선언, 자연어 글(`workflow.md`), artifact(정적인 것과 instance 상태까지 보이는 것). 모든 workflow에 artifact가 필요한 것은 아니다. workflow를 만드는 것은 project workspace의 agent의 책임이다. node 시각화는 kit에서 재사용할 수 있게 만든다. (사람, 2026-10-22) artifact를 둘지와 모양은 사람에게 묻지 않고 agent가 정한다(`products/AGENT.md` F5). (사람, 2026-11-09)
- 사람 화면은 workflow 하나가 탭 하나다. 오른쪽 sidebar는 panel icon tab을 둔다(항목이 많아 segmented control로는 감당하지 못한다). wireframe을 추천안 그대로 승인했다. (사람, 2026-10-22)
- 탭은 run 중심으로 읽힌다: workflow 화면(누가 어느 step을 맡는지와 run 목록)과 run 화면(지금 어디에 있고 사람이 무엇을 하면 되는지)으로 나눈다. 사람이 화면을 통째로 다시 짜라고 했다. (사람, 2026-11-21) 모양은 agent가 정했다: 목록과 고른 것을 한 화면에 쌓으면 사람 차례가 묻히고, step의 대화로 가는 길이 사람 차례에만 있어 agent가 무엇을 하는지 보려면 sidebar에서 session을 찾아야 했다. core와 protocol은 그대로다(사람 화면이 부르는 route는 여전히 List, Start, Stop 셋). (agent, 2026-11-21)
- coding agent 같은 third party harness는 참가자가 된다. harness는 programmatic 실행을 공식으로 지원하므로 사람 없이(workflow, job) 돌려도 된다. 이름 없는 `{kind: harness}` 참가자는 지웠고, harness agent는 이름이 있는 agent라 `{agent}` 참가자다. (사람, 2026-11-04)

기록과 넘기기
- 정본은 core 표다. CLI로 낸 report는 session event가 없어서 화면이 알 길은 남지 않는 event뿐이고, 놓친 화면은 다시 읽는다. 이유: 표가 정본이어야 어느 길로 낸 report도 같은 기록이 된다. (agent)
- instance는 시작할 때 선언의 step을 옮겨 갖고 그 뒤에는 agent가 고친다. 이유: 도는 중에 선언이 바뀌어도 도는 일이 흔들리지 않고, 예외를 agent가 step으로 고칠 수 있다. (agent)
- report 글과 `hand_now` 글은 8 KiB(UTF-8) 이하다. 긴 결과는 file에 둔다. 이유: report 글이 다음 step 메시지 본문에 그대로 실리고 화면이 줄마다 읽는 짧은 메모라서다. (agent)
- 시작과 멈춤은 사람이 한다. agent가 시작하는 tool은 두지 않는다(정해진 때의 시작은 job의 `workflow_start`). (사람, roadmap)
- job은 `StartWorkflow` route가 아니라 core 안에서 시작한다. 이유: 그 route는 사람만 받는 입구(actor user)이고, job은 사람 자격이 없는 machine이 부르는 일이다. route를 job에도 열면 "시작은 사람의 일"이라는 입구의 뜻이 흐려진다. 버린 안: route를 job에도 열기. (agent)
- job은 instance의 끝을 판정하지 않고 상태만 읽는다. 끝나지 않은 instance가 이어지면 건너뛴 기록이 쌓이고 사람이 화면에서 본다. (사람, 2026-10-22) agent가 만든 job은 `workflow_start`도 승인 대기다. 사람 없이 되풀이되는 것은 종류와 같다. (agent)
- `ended`를 굳히지 않는다. 끝을 lophn이 굳히면 다시 열어야 할 예외를 agent가 다루지 못한다. 사람이 멈춘 것만 굳힌다. (agent)
- 본문과 받는 곳을 command 앞에서 정한다. 이유: 본문은 blob이라 transaction 안에서 만들 수 없고, 앞에서 정해 넘기면 command는 받은 대로 넣기만 한다. 줄과 입력이 반쪽만 남지 않게 한 transaction이다. (agent)
- 켤 때 step 메시지를 다시 넣지 않는다. 이유: 다시 넣으면 바깥 효과가 두 번 날 수 있다. 그래도 말없이 잃지 않게 줄로 남긴다(`architecture/run.md`의 지키는 것, 켤 때 복구). (agent)
- workflow engine은 core에 둔다. 이유: 표, router의 `step`, job의 `workflow_start`, flow credential이 core와 한 transaction으로 엮여 있다. module은 lophn-agent와 다른 feature module을 import하지 않고 port로만 닿는다. (agent)
- 사람 화면의 Stop은 되돌릴 수 없어 danger다. (agent)

flow
- flow의 code는 workflow 폴더에 선언 옆 file로 둔다. 선언, 글, code가 한 폴더에 모이고, 쓰는 것은 project workspace session의 file 쓰기라 rewind로 되돌아간다. 버린 안: 앱으로 두기(앱 tool의 120초 제한과 write 직렬화 밖에서 오래 도는 진입과, 앱이 agent를 부르는 SDK를 새로 만들어야 한다), 사람의 저장소에 두기. (사람, 2026-10-23)
- code 이름은 하나로 고정하고 선언에 적지 않는다. lophn이 flow 선언에서 읽는 것은 `kind`, `agent`, `steps`의 key뿐이다. (agent)
- flow는 instance마다 process 하나이고 다시 띄우지 않는다. 켤 때 도는 flow는 닫는다. 이유: 다시 띄우면 바깥 효과가 두 번 난다. 실패 처리와 다시 하기는 code의 일이다. (agent)
- Deno를 떠나 Electron의 Node로 간다. 앱과 flow는 network를 포함해 권한을 막지 않는다. OS sandbox는 두지 않는다. flow는 AI가 짠 code라 권한 제한 없이 띄우되, SDK가 내는 길은 앱 tool과 agent뿐이라 바깥 효과는 그 길로 내라고 guide와 skill이 말한다. 그래야 invocation 기록, 할당, rewind가 그대로 선다. (사람, 2026-10-27)
- 앱 supervisor는 쓰지 않는다. 끝난 child를 다시 띄우고 stdout을 frame 통로로 쓰기 때문이다. (agent)
- flow의 앱 tool은 creator agent의 할당으로 판정한다. code를 쓴 것이 project workspace의 agent라 code로 할당을 넓히지 못한다(job이 만든 agent의 할당을 넘지 못하는 것과 같은 까닭, `architecture/approval.md`). flow가 부르는 agent는 누구든 되고 자기 할당으로만 일한다. (agent)
- flow process에는 credential을 주지 않는다. code가 다른 자격을 빌릴 길도 없다. origin과 flow 자격은 route 입력이 아니고 core가 그 instance의 이름으로 한다. (agent)
- 통로가 깨진 줄은 process를 끝내고, 읽히지만 칸이 틀린 요청은 `invalid_input` 값으로 답한다. 이유: 오타 하나로 flow 전체가 죽지 않게. (agent)
- 시간 한도를 두지 않는다. 오래 도는 flow가 정상이고 멈추는 길은 `StopWorkflow`다. (agent)
- flow code가 stdout에 바로 쓰는 실수는 SDK 진입이 write를 stderr로 돌려 막는다. stdout 스트림 객체 자체는 돌리지 않는다(실수로 부를 만한 길이 아니다). (agent)
- 진짜 flow process를 띄우는 test는 두지 않는다. 손으로 확인한다. (agent)

다른 컴퓨터의 참가자
- 참가자가 컴퓨터를 고를 수 있다. 그 컴퓨터가 꺼져 있으면 기다리고, 늦게 켜지면 늦은 call처럼 대기 card로 선다. 화면은 step이 도는 컴퓨터와 배달 상태를 보인다. (사람, 2026-11-21)
- step과 report는 새 mail 종류가 아니라 `call`·`reply`에 칸(`step`, `report`)을 더해 싣는다. 이유: 받는 쪽 규칙(한 번 적용, 기계 확인, 대기, 만료, 먼저 닿은 취소, private, session 규칙, 재시작 실패)이 모두 call mail과 call 행에 걸려 있어 step이 call이면 그대로 다 선다. 버린 안: `step`·`report` 종류를 더하기(규칙마다 둘째 갈래가 생기고 대기·만료 code가 새 종류를 배워야 한다). (agent)
- 보낸 컴퓨터에 보낸 쪽 program인 call 행을 둔다(agent_calls의 보낸 쪽 칸이 셋 다 빈 행, 다른 컴퓨터로 보낸 행에만). 이유: 배달 상태, 받은 session, 만료, 옛 판, 취소가 이미 call 행에서 돈다. 버린 안: workflow 표에 배달 상태를 따로 두기(같은 상태 기계를 둘 둔다). (agent)
- 다른 컴퓨터의 report는 mail 입구가 workflows에 넘겨 `ApplyWorkflowChange` 하나로 적용한다. 이유: 다음 step 본문은 blob이라 command 앞에서 준비해야 하고, 본 기록과 report 줄과 넘기기가 한 transaction이어야 반쪽이 남지 않는다. 버린 안: `calls/mail-apply` 안에서 줄만 남기고 commit 뒤에 넘기기(그 사이에 꺼지면 넘기지 않은 report가 남는다). (agent)
- 다른 컴퓨터가 가져간 step의 turn이 report 없이 끝나면 step을 닫지 않고 그 컴퓨터의 program이 진행 줄 하나를 보낸다. 새 mail 종류가 아니라 reply mail의 `report`(next 없음)에 `ended`를 더했고, 줄은 report 줄에 `by` `remote_lophn` 갈래 하나다. 글은 시작한 컴퓨터가 쓴다(다른 줄의 컴퓨터 이름과 같은 명단에서 온다). 이유: 닫으면 사람이 그 session을 다시 밀어 낸 report가 거절되고, 아무것도 보내지 않으면 run이 말없이 도는 것처럼 보인다. 버린 안: 그 turn에서 step 닫기, 새 줄 종류 더하기(화면과 읽기가 다 배워야 한다). 이슈 `workflow-remote-step-turn-end-no-line`. (agent)
- 받은 step의 다른 컴퓨터 표시는 본문 앞 고정 줄이다. 이유: step 입력은 보낸 쪽이 program이어야 하고(`messages` 표의 규칙) 이력 재생이 같은 bytes를 만들려면 표시가 저장된 본문에 있어야 한다. (agent)

## 열린 것

- flow process에 CPU 한도가 없다. AI가 짠 flow code가 끝없는 loop에 빠지면 사람이 [Stop]할 때까지(job이 밤에 시작한 flow면 아무도 보지 않는 동안) CPU 하나를 잡는다. memory는 V8 heap 512 MiB에서 막힌다. CPU를 막으려면 OS 한도가 필요하고 core에 실행 허락이 있어야 한다(큼). 앱의 한도를 정할 때 같이 정한다. 이슈: `flow-process-cpu-limit`.
- `workflow.yaml`에 남은 옛 `{kind: harness}` 참가자는 옮기지 않는다. `invalid_declaration`이고 손으로 고친다(agent 이름을 알 수 없다).
