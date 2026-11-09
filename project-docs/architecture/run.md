# run

run은 화면 없이 부르는 lophn agent 호출 하나, 또는 앱 tool 호출 하나다. `claude -p`나 `codex exec`처럼 명령 하나로 시키고 결과를 받는다. CLI가 사람의 명령으로 열고, job과 flow도 같은 길로 연다. 부른 쪽은 run 기록 한 행을 받아 끝날 때까지 기다리거나 나중에 다시 읽는다.

## 문제

lophn agent를 화면 밖에서 부르고 결과를 받는 길이 없으면, 정해진 때 저절로 도는 일(job)도, flow가 agent에게 일을 시키는 것도, eval이 답을 받는 것도 만들 수 없다. 끝을 짐작하는 방식(eval은 1초 조용하면 끝으로 봤다)은 같은 session에 먼저 들어온 다른 입력의 답을 돌려줄 수 있다. 경계가 흐려지면 다음이 생긴다.

- 끝을 짐작하다 다른 입력의 답을 돌려준다.
- 켤 때 이미 닫힌 run 뒤에 같은 일이 한 번 더 돌아 바깥 효과가 두 번 난다.
- 끝난 session이 run을 영영 running으로 붙잡는다.
- 사람 없이 도는 일이 사람에게 묻느라 멈춘다.

## 목표와 비목표

- 목표: agent 호출 하나나 앱 tool 호출 하나를 시작하고, 끝났다고 정확히 알고, 답이나 결과와 실패 이유를 기록 한 행에 남긴다. 취소, 켤 때 복구, session 끝이 run을 항상 닫는다.
- 목표: 사람이 쓰는 CLI 입구와 job·flow가 쓰는 core 안 입구가 같은 시작과 끝 규칙을 쓴다.
- 비목표: 자동 재시도. 다시 하기는 부르는 쪽의 일이다. 재시도가 바깥 효과를 두 번 낼 수 있어서다.
- 비목표: run event. 화면은 session event 때 다시 읽는다.
- 비목표: 끝난 run의 재개나 되돌리기. 끝난 행은 다시 바뀌지 않는다.

## 모델

run 기록 한 행(`runs` 표)이 정본이다. 화면과 CLI는 읽고, 쓰는 것은 core뿐이다.

```
 CLI (agent run | <app> <command> | run wait|show|cancel)   user 자격
   │  StartRun | WaitRun | CancelRun | ReadRun | ListRuns
   ▼
 runs 규칙 ── port ──▶ 끼우는 쪽 ──▶ lophn agent, 앱 호출 경로, ledger
   │
   ├ agent run: 이름 풀기 ─▶ run 행(running) ─▶ session 열기(새 run일 때) ─▶ 사람 메시지 넣기(unattended)
   │               끝 ◀── 그 메시지를 가져간 turn의 TurnEnded ── 답 읽기 ─▶ SettleRun
   │
   └ tool run: 앱 이름 풀기 ─▶ run 행 ─▶ 앱 호출 경로 ─▶ SettleRun

 job scheduler, flow host (core 안, route 아님): 같은 시작 길에 origin을 붙여 연다
 Bus: TurnEnded, SessionEnded ─▶ 깨어서 표를 다시 본다 (정본은 표)
 켤 때: router가 돌던 turn을 닫은 뒤 reconcile
```

**종류.** `agent`(agent 호출)와 `tool`(앱 command 호출)이다.

**상태.** `running`, `done`, `failed`, `cancelled`이고 running에서만 바뀐다. 끝난 행은 저장소가 막아 다시 바뀌지 않는다. `failed`만 `error`를 갖고, running이 아니면 `finished_at`이 있다.

**기록의 칸.**

- `target`: agent run은 이름을 푼 (agent, workspace), tool run은 앱과 tool 이름이다.
- `session`, `session_opened`, `input_message`, `turn`: agent run만 갖는다. `session_opened`는 run이 session을 연 것인지, `input_message`는 run이 넣은 메시지, `turn`은 그 메시지가 연 turn이다(끝을 안 뒤에 채운다).
- `invocation`: tool run만 갖는다. 기록이 남지 않은 읽기면 null이다.
- `schema`: agent run의 출력 JSON Schema다.
- `result`: done의 값이다. agent는 답 글(schema가 있으면 읽은 JSON 값), tool은 tool 결과다.
- `job`, `instance`: job이 연 run만 `job`에 그 job의 id를, flow instance가 연 run만 `instance`에 그 instance의 id를 갖는다. 둘이 함께 값이 되지 않는다. FK가 없어 job이나 instance가 지워져도 run은 남는다. job이 run을 여는 것은 `architecture/job.md`, flow가 여는 것은 `architecture/workflow.md` "flow"다.
- 거르기용 key: workspace와 agent는 만들 때 정해 바뀌지 않는다. agent key는 `<agent id>`(home) 또는 `<agent id>@<workspace id>`다. workspace는 agent run이면 그 session의 workspace(home은 없음), tool run이면 그 앱이다.

**실패 이유.** `error.reason`은 경계의 오류 코드 일곱이 아니라 기록의 칸이다.

| 이유 | 뜻 |
|---|---|
| `invalid_output` | schema를 주었는데 답이 JSON이 아니거나 schema에 맞지 않는다 |
| `no_answer` | turn이 completed로 끝났는데 그 turn에 agent가 남긴 답이 없다 |
| `turn_failed` | turn outcome이 failed다. message에 그 reason |
| `turn_interrupted` | turn이 user_stopped나 session_ended로 끝났다 |
| `start_failed` | session을 열거나 메시지를 넣지 못했다. message에 오류 code |
| `tool_failed` | 앱 handler 오류 |
| `tool_denied` | handler까지 가지 못했다(이름 없는 tool 포함) |
| `tool_unknown` | 결과를 모른다 |
| `lophn_restarted` | 끝나기 전에 lophn이 꺼졌다 켜졌다 |

## 지키는 것

시작

1. 이름을 다 푼 뒤에 session을 열고 run을 만든다. 이름이 안 풀린(`not_found`) 첫 시도는 session도 run도 남기지 않는다. CLI가 project 먼저, app 나중으로 다시 시도해도 session이 쌓이지 않게 하려는 것이다.
2. 순서는 run 행(running) → session 열기 → 메시지 넣기다. 열기나 넣기가 실패하면 그 run을 `start_failed`로 닫는다.
3. agent run은 `agent`(agent 이름과 workspace, workspace가 없으면 home)와 `session`(이어 쓸 열린 session) 가운데 정확히 하나를 받는다. 둘 다이거나 둘 다 아니거나, 읽을 수 없는 schema, 너무 긴 prompt는 `invalid_input`이다. `session`이 열린 session이 아니면 `conflict`다.
4. 호출마다 새 session이다. `session`을 주면 그 session에 이어 넣고, 그 run은 session을 열지 않는다. run이 연 session은 열린 채 남는다.
5. agent에게 보내는 글은 prompt에, 입력 JSON과 "이 JSON Schema에 맞는 JSON 하나만 답하라"는 고정 영어 문장을 붙인 것이다.
6. 자동 재시도는 없다.

끝을 아는 법

7. 끝은 늘 run의 `input_message`를 가져간 turn에서만 본다. 받은 메시지의 `turn`을 읽고 그 turn의 state와 outcome을 읽는다. Bus 이벤트가 알려 준 turn id는 어느 run의 것인지 찾는 데만 쓰고 믿지 않는다. 같은 session에 먼저 들어온 다른 입력의 답을 돌려주면 안 된다.
8. Bus는 놓칠 수 있다. 정본은 표이고, `TurnEnded` 구독과 `WaitRun`의 깨움은 표를 다시 보게 하는 신호일 뿐이다. `WaitRun`은 기다리기 전과 깬 뒤에 표를 읽고, 끝나지 않은 agent run이면 turn을 직접 한 번 본다. `ReadRun`과 `ListRuns`는 표만 읽는다.
9. 답은 그 turn에서 그 session의 agent가 남긴 마지막 메시지의 글이다(text part를 줄바꿈으로 이은 것). agent message는 model 응답마다 하나이고 마지막 응답은 글이 비어도 남는다(`architecture/agent-chat.md`). 그래서 마지막 응답의 글이 비면 앞 응답의 글("X를 확인하겠다")로 내려가지 않고 답이 없다. 같은 규칙으로 bare의 result call 자동 답을 읽는다(`architecture/agent-call.md`). agent가 다른 agent에게 call을 보내고 turn을 끝내면 그때의 답이 결과이고, 나중에 온 답은 session에만 남는다.
10. schema가 있으면 글 전체를 감싼 code fence 하나는 벗기고 JSON으로 읽어 schema로 검사한다. 그 밖에는 글을 고치지 않는다. 틀리면 `invalid_output`이다.
11. outcome이 failed면 `turn_failed`, interrupted면 `turn_interrupted`(reason이 `restarted`면 `lophn_restarted`), completed인데 답이 없으면 `no_answer`다.
12. 같은 run을 둘이 `SettleRun`해도 하나만 받는다(running일 때만 받는 compare). 진 쪽은 지금 기록을 읽어 쓴다.

unattended

13. run 입력은 `SendMessage`에 `unattended: true`를 실은 사람 메시지다. 이 메시지가 연 turn은 unattended라 묻지 않고, 그 turn이 보낸 call 사슬도 unattended다(`architecture/approval.md` "turn mode", `architecture/agent-call.md`).
14. 표시는 `messages.unattended` 열에 남지만 tag 글과 받은 봉투에는 실리지 않는다. 화면의 메시지는 이 표시를 싣지 않고 run만 싣는다. CLI가 여는 run은 별도 flag 없이 처음부터 unattended다. 사람 메시지가 아닌 unattended 입력은 workflow의 step 입력이다(`architecture/workflow.md`).

취소

15. `CancelRun`은 run을 먼저 `cancelled`로 닫고 뒷일을 한다. 뒷일의 오류는 기록에 남기지 않는다. 이미 끝난 run은 `conflict`다.
16. 입력을 turn이 아직 안 가져갔으면 queue와 접수 기록에서 그 메시지를 뺀다. 그 사이 가져갔으면(`conflict`) 도는 turn을 본다.
17. 도는 turn이면 `StopTurn`을 보낸다. turn의 `state_seq` compare가 checkpoint 때문에 어긋나 `conflict`면 다시 읽어 최대 3번 건다.
18. tool run을 취소해도 이미 보낸 앱 호출은 멈추지 않는다. run만 `cancelled`가 되고 호출은 저절로 끝난다. 그 결과는 이미 닫힌 행에 쓰이지 않는다.
19. flow instance가 끝나면 그 instance가 연 running run을 모두 같은 길로 취소한다(best-effort). 주인 없는 agent run이 계속 돌지 않게 한다. 이미 끝난 run은 버리고 process는 건드리지 않는다.

켤 때와 session 끝

20. 켤 때 queue는 비고, run 입력은 다시 줄 세우지 않는다(`architecture/workspace-session.md`). 먼저 `TurnEnded`와 `SessionEnded`를 구독하고 reconcile한다. router가 돌던 turn을 닫은 뒤여야 해서 기동 순서에서 runs는 router 뒤다.
21. reconcile에서 running인 tool run은 `lophn_restarted`다. 호출의 결과를 알 길이 없다.
22. reconcile에서 agent run은 turn을 다시 본다. 끝난 turn이면 그 결과로 닫고, 아직 turn이 가져가지 않았으면 `lophn_restarted`다. 도는 turn은 그 turn의 `TurnEnded`가 끝낸다.
23. job이 연 run도 같다. 끊긴 run은 `lophn_restarted`로 닫히고, 그 job의 job run은 `interrupted`이며 놓친 차례로 친다(`architecture/job.md` "켤 때").
24. session이 archive되거나 지워지면 그 session에서 running인 run을 `turn_interrupted`(session_ended)로 닫는다. 입력이 줄에 있는 채로 session이 끝나면 turn이 열리지 않아 `TurnEnded`가 오지 않고, run이 영영 running으로 남기 때문이다. 먼저 turn을 한 번 보고 이미 끝난 결과가 있으면 그것을 쓴다.

tool run

25. 앱을 id, slug, 이름으로 푼다(없으면 `not_found`). `StartRun`은 run 행을 만들고 기다리지 않고 돌려준다. 호출은 뒤에서 돌고 끝나면 `SettleRun`한다. 성공이면 `done`이고 result가 tool 결과다.
26. tool은 앱의 command 이름이다. 사람 화면 전용인 operation은 run이 부르지 못한다(`architecture/app-call.md`).
27. 부른 쪽은 사람이다. 앱 화면에서 사람이 누르는 것과 같은 길이고 Gate를 거치지 않는다(`architecture/app-call.md`). run은 session이 없고 호출 기록의 `view_session`에 run id를 싣는다.
28. `origin`이 있는 tool run은 사람이 아니다. job이 연 것은 program caller로 부르고, 사람이 승인한 job이라 통과한다(`architecture/app-call.md`, `architecture/job.md`). flow instance가 연 것은 flow caller로 부르고, 그 instance의 agent(`workflow.yaml`의 `agent`)와 project workspace의 지금 할당과 비공개 거르기를 받는다. 막히면 run이 `tool_denied`다.
29. tool 이름이 앱에 없는 것은 `StartRun`에서 막지 않는다. run이 `tool_denied`로 실패한다.

읽기

30. `ListRuns`는 `session`, `agent`, `workspace`, `state`로 거르고(준 칸은 모두 맞아야 한다) 새것이 앞이며 50개씩 `cursor`로 읽는다. `agent`는 agent id로 그 agent의 run을 workspace와 상관없이 거른다. `workspace: {app}` 하나로 그 앱 workspace의 agent run과 tool run을 같이 읽는다. 화면이 session event마다 읽고 뒤에 job이 run을 쌓으므로 거르기는 core가 한다.

## 경계와 계약

**route**(boundary-catalog의 `runs`). 사람 쪽 route는 user 자격만 받는다.

| route | 입력과 뜻 | 오류 |
|---|---|---|
| `StartRun` | `kind: agent`는 `agent` 또는 `session`, `prompt`, 선택 `input`(JSON), 선택 `schema`(JSON Schema 객체). `kind: tool`은 `app`, `tool`, 선택 `input`. run 기록을 돌려준다 | `invalid_input`, `not_found`, `conflict`, `forbidden`, `unauthorized`, `unavailable` |
| `ReadRun`, `ListRuns` | 위 읽기 규칙 | `invalid_input`, `unauthorized`, `forbidden`, `not_found`, `unavailable` |
| `WaitRun` | `timeout_ms`(1에서 60초). 끝났거나 시간이 지나면 돌려준다. 그때는 running일 수 있다 | 읽기와 같다 |
| `CancelRun` | 취소 규칙 | 읽기 오류와 `conflict` |
| `CreateRun`, `SettleRun` | core 안 machine 자격만. 만들기와 끝내기 | |
| `run.activity` | running인 run이 있으면 `busy`. core가 idle일 때 스스로 끝나는지 정하는 입력이다(`architecture/platform.md` "core 수명") | |

- core 안 시작은 route 밖의 `start(input, origin?)`다. `origin`은 job 갈래(job과 job run)와 instance 갈래(flow instance와 그 instance의 agent·project workspace) 가운데 하나다. 메모리에만 있고 route 입력에는 없다. 있으면 run의 `job`이나 `instance` 칸을 채운다.
- agent run은 이름을 이미 푼 (agent id, workspace)를 주는 갈래도 받는다. job이 만들 때 이름을 풀어 저장해 두기 때문이다. 이름 풀기를 건너뛰고 나머지(session 열기, 입력, 끝을 아는 법)는 같다.
- core 안 자격은 둘이다. 사람 입력으로 session을 열고 메시지를 읽고 turn을 멈추는 `machine:runs`(actor user), 그리고 run 행을 만들고 끝내고 queue에서 메시지를 빼는 `machine:runs-settle`(actor machine)다.
- 규칙은 runs 모듈이 갖고 lophn agent와 다른 feature 모듈은 import하지 않는다. 이름 풀기, 메시지 넣기, turn 읽기, 앱 호출은 port이고 기동 쪽이 끼운다(`architecture/layers.md`).

**CLI와 자격**(`architecture/coding-agent.md`)

- 명령은 `lophn agent run <prompt>`(`--agent`, `--project`, `--app`, `--session`, `--schema`, `--data`, `--async`), `lophn <app> <command>`(앱 command, command의 입력 칸이 flag다), `lophn run wait|show|cancel <run>`이다. 이 명령들은 workspace 종류가 비어 binary만 부른다.
- `lophn <domain> <command>`는 첫 낱말이 명령 표에 없으면 binary가 사람 자격으로 `domain.list`와 `app.tools`를 읽어 찾고 tool run(`StartRun` `kind: tool`)으로 부른 뒤 기다린다. 사람은 그 domain의 command를 모두 본다.
- `--agent`는 agent 이름(없으면 lophn)이고 `--project`나 `--app`이 workspace(이름이나 id, 둘을 같이 쓰지 않는다, 없으면 home)다. `--session`은 셋과 같이 쓰지 않는다. 이어 쓰는 session의 agent와 workspace는 열 때 정해졌다. `--schema`는 JSON 글이고 `--data`는 agent에게 입력 JSON으로 보인다.
- 결과는 stdout에 낸다. 답이 글이면 그대로, 아니면 JSON이고 `--json`이면 run 전체다. `agent run --async`는 run id(`--json`이면 run)를 내고 바로 끝난다. 기다리는 명령은 `WaitRun`을 되풀이한다. 끝은 core가 정한다.
- 종료 코드는 0 성공, 1 internal, 2 invalid_input, 3 unauthorized·forbidden, 4 실패, 5 unavailable, 6 쓰기 응답을 잃음(effect_unknown)이다. 실패하거나 취소된 run은 `--json`이 없으면 stdout을 비우고 stderr에 한 줄(`failed: <reason>: <message>` 또는 `cancelled`)을 쓰고 4로 끝난다. `--json`이면 run을 stdout에 내고 4로 끝난다. `--async`, `run show`, `run cancel`은 명령 자체가 되면 0이다.
- 자격은 control `connect {client: cli}`가 주는 user token이다. 사람의 명령은 공용 ensure로 core에 붙고, 꺼져 있으면 core를 띄운 뒤 부른다(`architecture/coding-agent.md`, `architecture/platform.md` "core 수명"). token은 CLI 메모리에만 있고 file로 쓰지 않는다. `LOPHN_AGENT_CREDENTIAL`이 있으면 그 자격만 쓰고 user connect로 바꾸지 않는다.

**화면**

- run이 연 session은 sidebar에 그대로 두지 않고 그 run 아래로 묶어 보인다. 쌓일 session을 그대로 두면 job이 하루에 session을 수십 개 만든다. 묶는 것은 `session_opened`가 true인 run의 session뿐이다. `--session`으로 이어 쓴 session은 원래 자리에 둔다.
- project workspace의 session은 project sidebar의 Background 칸에서, 앱 workspace의 session은 그 앱 workspace의 Logs panel에서 묶는다. home의 session은 Home 창의 agent 탭의 것이다. tool run은 session이 없어 run 목록에만 보인다. Agent 탭의 session 목록(session popover)은 모든 session을 찾는 곳이라 run이 연 session도 그대로 보인다.
- project 창은 처음과 session 상태가 바뀔 때마다 `ListRuns`를 `workspace: { project }`로 읽는다. 앱 workspace는 Logs panel이 열려 있는 동안 `workspace: { app }`으로 읽는다. 읽는 곳은 workspace source의 `runs` 하나다.
- job이 연 run 줄(그 job이 아직 있을 때)은 이름 자리에 job 제목을 보이고 agent 이름이나 tool 이름은 둘째 줄이다. 제목은 읽는 곳이 `job.list`로 붙인다. 지운 job의 run 줄은 일반 run과 같다.
- run 줄은 이름 아래에 시작한 시각을 둔다. run 아래에 session 줄이 있으면 running 점은 그 session 줄에만 보인다.

## 결정

- 끝은 짐작하지 않고 turn에서 안다. 이유: 1초 조용하면 끝으로 보면 session에 먼저 있던 입력의 답을 돌려줄 수 있다. 입력 메시지 → 그 메시지의 turn → `TurnEnded`는 core가 정확히 아는 길이다.
- 정본은 표이고 event는 표를 다시 보게 하는 신호다. 이유: Bus는 구독이 죽으면 놓친다. 같은 run을 둘이 `SettleRun`해도 compare가 하나만 받는다.
- run의 turn은 unattended다. CLI에 `--dangerously-skip-permissions` 같은 flag는 없다. 이유: run은 사람이 곁에 없는 일이고 묻는 길이 없다. (사람, 2026-10-20)
- 호출마다 새 session이고 이어 쓰려면 `--session`을 준다. 자동 재시도는 없다. (사람, 2026-10-20)
- 자격은 가장 단순한 길이다. 같은 OS 사용자로 도는 agent가 control socket에 붙어 사람 자격을 받을 수 있다는 위험은 신경 쓰지 않는다. 사람 결정 handle만은 shell capability로 따로 지킨다(`architecture/approval.md`). (사람, 2026-10-20)
- CLI도 ensure로 core를 띄운다. 이유: 화면 없는 머신에서 CLI만으로 core를 켤 길이 있어야 한다. (사람이 추천을 받음, 2026-11-08)
- run 화면은 wireframe 모양에서 두 가지만 고쳐 쓴다: 시각을 이름 아래 줄로 내리고, running 점은 run이 연 session 줄에만 둔다. (사람, 2026-10-22)
- `invalid_output`을 오류 코드가 아니라 실패 이유로 둔다. 이유: 경계의 오류 코드는 일곱으로 두고, run이 어떻게 끝났는지는 run의 기록이다. (agent)
- run 입력을 켤 때 다시 줄 세우지 않는다. 이유: 다시 돌면 이미 `lophn_restarted`로 닫힌 run 뒤에 attended turn이 생기고 바깥 효과가 두 번 난다. (agent)
- tool 이름이 없는 것을 `StartRun`에서 막지 않고 run이 `tool_denied`로 실패하게 둔다. 이유: 선언을 미리 볼 port를 두지 않는 쪽이 단순하다. (agent)
- run이 연 session은 열린 채 남고 화면은 그 run 아래로 묶는다. `--session`으로 이어 쓴 session은 원래 자리다. run이 연 session도 Agent 탭의 session 목록에는 보인다. (agent)
- `origin`과 `agent_resolved`는 route 입력에 없고 core 안 시작만 받는다. 이유: `origin`이 program·flow 자격으로 앱 tool을 부르게 하므로, route 입력으로 열려 있으면 누구든 job이나 flow의 이름으로 앱을 부르는 길이 된다. flow process에는 credential을 주지 않고 origin과 flow 자격은 core가 그 instance의 이름으로 만든다. (agent, planner)
- 새 session을 열기 전에 이름을 먼저 푼다. 이유: 안 풀린 채 session부터 열면 CLI의 project 먼저, app 나중 재시도가 session을 남긴다.
- 취소할 때 run을 먼저 닫는다. 이유: 뒷일(입력 빼기, turn 멈추기)이 실패해도 run의 상태는 사람이 요청한 대로 남는다.
- tool run은 사람이 부르는 길이다. 이유: 사람이 시킨 일이 승낙이고(`architecture/approval.md`), CLI는 사람의 입구다.
- 안 가져간 입력을 취소하면 기록을 먼저 지우고 queue에서 뺀다. 이미 가져간 메시지는 기록 삭제가 `conflict`로 막아 도는 turn 멈추기로 넘어간다.

## 열린 것

- tool run을 취소해도 이미 보낸 앱 호출은 멈추지 않는다. 호출 취소 길은 없다.
- 이 topic의 열린 이슈는 없다.
