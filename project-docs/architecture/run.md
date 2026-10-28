# run

run은 화면 없이 부르는 lophn agent 호출 하나, 또는 앱 tool 호출 하나다. `claude -p`나 `codex exec`처럼 명령 하나로 시키고 결과를 받는다. 이 문서는 run이 무엇이고, 언제 시작해서 어떻게 끝났다고 아는지, 취소와 켤 때 복구와 session 끝이 run을 어떻게 닫는지, CLI와 자격, 화면이 run을 어떻게 보이는지를 정한다. 이 경계가 흐려지면 끝을 짐작하다 다른 입력의 답을 돌려주거나, 켤 때 닫힌 run 뒤에 같은 일이 한 번 더 돌거나, 끝난 session이 run을 영영 running으로 붙잡는다. 여러 곳에 걸쳐 있다. 계약은 `packages/protocol/runs`, 규칙은 `packages/core/runs`(runs), 끼우는 곳은 `packages/core/main/daemon/wiring/runs.ts`, 사람이 쓰는 입구는 `packages/coding-agent/cli/commands/run.ts`다.

## 흐름

```
 CLI (lophn agent run | tool call | run wait|show|cancel)      user token
   │  POST /runs/start | wait | cancel | read | list
   ▼
 runs service (core/runs)  ── port ──▶ wiring/runs.ts ──▶ lophn-agent 연산, 앱 호출 경로, ledger
   │
   ├ agent run: 이름을 다 푼다 ─▶ run 행 만들기(running) ─▶ session 열기(새 run일 때) ─▶ 사람 메시지 넣기
   │            (resolve / agentOf)   CreateRun              OpenSession                  SendMessage unattended:true
   │                                                              │ 입력함 → turn이 가져감 (unattended turn)
   │            끝 ◀── 그 메시지가 들어간 turn의 TurnEnded ───────┘
   │            SettleRun: done(답) | failed(이유) | cancelled
   │
   └ tool run: 앱 이름을 푼다 ─▶ run 행 ─▶ 앱 호출 경로(사람이 부르는 것과 같은 길, Gate 없음) ─▶ SettleRun

 job scheduler (core 안, route 아님): RunService.start(input, origin) ─ 같은 길. agent는 이름을 이미 푼 agent_resolved 갈래
   origin이 있는 tool run만 앱 호출 경로를 program caller로 부른다 (만든 agent의 할당과 domain 거르기)
 flow host (core 안, route 아님): RunService.start(input, origin) ─ 같은 길. origin은 instance와 그 project의 PM
   tool run은 앱 호출 경로를 flow caller로 부른다 (PM의 할당과 domain 거르기)

 Bus: TurnEnded, SessionEnded ─▶ service가 깨어 표를 다시 본다 (정본은 표)
 켤 때: router가 돌던 turn을 닫은 뒤 reconcile
```

- run 기록 한 행(`runs` 표)이 정본이다. 화면과 CLI는 `ReadRun`, `ListRuns`, `WaitRun`으로 읽고, 쓰는 것은 core뿐이다(`CreateRun`, `SettleRun`은 machine 자격만).
- 상태는 `running`, `done`, `failed`, `cancelled`이고 running에서만 바뀐다. 끝난 행은 trigger가 막아 다시 바뀌지 않는다.
- job이 연 run만 `job` 칸에 그 job의 id를, flow instance가 연 run만 `instance` 칸에 그 instance의 id를 갖는다(아니면 null, 둘이 함께 값이 되지 않는다). FK는 없어서 job이나 instance가 지워져도 run은 남는다. job이 run을 여는 것은 `architecture/job.md`, flow가 여는 것은 `architecture/workflow.md` "flow"다.
- 실패 이유(`error.reason`)는 경계의 오류 코드 일곱이 아니라 기록의 칸이다.

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
- `StartRun`은 이름을 다 푼 뒤에 session을 열고 run을 만든다. 이름이 안 풀린(`not_found`) 첫 시도는 session도 run도 남기지 않는다.
  - CLI는 `operator:<x>/<이름>`의 `<x>`를 project로 먼저 부르고 `not_found`면 앱으로 다시 부른다. 첫 시도가 무엇이든 남기면 둘째 시도가 일을 두 번 만든다.
  - 순서는 run 행(running) → session 열기 → 메시지 넣기다. 열기나 넣기가 실패하면 그 run을 `start_failed`로 닫는다.
- core 안 시작은 `RunService.start(input, origin?)`다. `origin`은 job 갈래(job, job run, 그 job을 만든 agent와 place)와 instance 갈래(flow instance, 그 project의 PM과 project place) 가운데 하나이고, tag 없이 `job` 키와 `instance` 키로 가른다(`packages/core/runs/ports.ts`의 `RunOrigin`). 메모리에만 있고 route 입력(`StartRun`)에는 없다. 있으면 run의 `job`이나 `instance` 칸을 채운다. agent run은 `agent_resolved` 갈래도 받는다: 이름을 이미 푼 AgentRef와 place를 주므로 이름 풀기를 건너뛴다. job이 만들 때 이름을 풀어 저장해 두기 때문이다. 나머지(session 열기, 입력, 끝을 아는 법)는 같다.
- agent run은 `agent`(NamedAgent)와 `session`(이어 쓸 열린 session) 가운데 정확히 하나를 받는다. role `coding_agent`, 읽을 수 없는 schema, 너무 긴 prompt는 `invalid_input`이다. 호출마다 새 session이고, `session`을 주면 그 session에 이어 넣는다(열린 session이 아니면 `conflict`).
- 보내는 글은 prompt에, 입력 JSON과 "이 JSON Schema에 맞는 JSON 하나만 답하라"는 고정 영어 문장을 붙인 것이다(`runMessageText`).
- run이 연 session은 열린 채 남는다(`session_opened`). `session`으로 이어 쓴 run은 session을 열지 않는다.
- 자동 재시도는 없다. 다시 하기는 부르는 쪽의 일이다.

끝을 아는 법
- 끝은 늘 run의 `input_message`를 가져간 turn에서만 본다. 받은 메시지의 `turn`을 읽고 그 turn의 state와 outcome을 읽는다. Bus 이벤트가 알려 준 turn id는 어느 run의 것인지 찾는 데만 쓰고 믿지 않는다. 같은 session에 먼저 들어온 다른 입력의 답을 돌려주면 안 된다.
- Bus는 놓칠 수 있다. 정본은 표이고, `TurnEnded` 구독과 `WaitRun`의 깨움은 표를 다시 보게 하는 신호일 뿐이다. `WaitRun`은 기다리기 전과 깬 뒤에 표를 읽고, 끝나지 않은 agent run이면 turn을 직접 한 번 본다. `ReadRun`과 `ListRuns`는 표만 읽는다.
- 답은 그 turn에서 그 session의 agent가 남긴 마지막 메시지의 글이다(text part를 줄바꿈으로 이은 것). agent message는 model 응답마다 하나이고 마지막 응답은 글이 비어도 남는다(`architecture/agent-chat.md`). 그래서 마지막 응답의 글이 비면 앞 응답의 글("X를 확인하겠다")로 내려가지 않고 답이 없다. agent가 다른 agent에게 call을 보내고 turn을 끝내면 그때의 답이 결과이고, 나중에 온 답은 session에만 남는다.
- schema가 있으면 글 전체를 감싼 code fence 하나는 벗기고 JSON으로 읽어 schema로 검사한다. 그 밖에는 고치지 않는다. 틀리면 `invalid_output`이다.
- outcome이 failed면 `turn_failed`, interrupted면 `turn_interrupted`(reason이 `restarted`면 `lophn_restarted`), completed인데 답이 없으면 `no_answer`다.
- `WaitRun`은 끝났거나 `timeout_ms`(최대 60초)가 지나면 돌려준다. 그때는 running일 수 있어 CLI가 되풀이해 기다린다.

unattended
- run 입력은 `SendMessage`에 `unattended: true`를 실은 사람 메시지다. 이 메시지가 연 turn은 unattended라 묻지 않고, 그 turn이 보낸 call 사슬도 unattended다(`architecture/approval.md` "turn mode", `architecture/agent-call.md`).
- 표시는 `messages.unattended` 열에 남지만 tag 글과 받은 봉투에는 실리지 않는다. 화면의 메시지는 이 표시를 싣지 않고 run만 싣는다(core 안 자격 `machine:runs`). CLI가 여는 run은 `--dangerously-skip-permissions` 없이 처음부터 unattended다. 사람 메시지가 아닌 unattended 입력은 workflow의 step 입력이다(`architecture/workflow.md`).

취소
- `CancelRun`은 run을 먼저 `cancelled`로 닫고 뒷일을 한다. 뒷일의 오류는 기록에 남기지 않는다.
  - 입력을 turn이 아직 안 가져갔으면 입력함과 접수 기록에서 그 메시지를 뺀다. 그 사이 가져갔으면(`conflict`) 도는 turn을 본다.
  - 도는 turn이면 `StopTurn`을 보낸다. `state_seq` compare가 checkpoint 때문에 어긋나 `conflict`면 다시 읽어 최대 3번 건다.
- 이미 끝난 run은 `conflict`다.
- tool run을 취소해도 이미 보낸 앱 호출은 멈추지 않는다. run만 `cancelled`가 되고 호출은 저절로 끝난다. 그 결과는 이미 닫힌 행에 쓰이지 않는다.
- `RunService.cancelOfInstance(instance)`는 그 instance가 연 running run을 모두 같은 길로 취소한다(best-effort, core 안). flow host가 process를 끝낸 뒤 부른다. 주인 없는 agent run이 계속 돌지 않게 한다.

켤 때와 session 끝
- 켤 때 입력함은 비고, run 입력은 다시 줄 세우지 않는다(`architecture/place-session.md`). 먼저 `TurnEnded`와 `SessionEnded`를 구독하고 `reconcile`한다. router가 돌던 turn을 닫은 뒤여야 해서 wiring 순서에서 runs는 router 뒤다.
  - running인 tool run은 `lophn_restarted`다. 호출의 결과를 알 길이 없다.
  - agent run은 turn을 다시 본다. 끝난 turn이면 그 결과로 닫고, 아직 turn이 가져가지 않았으면 `lophn_restarted`다. 도는 turn은 그 turn의 `TurnEnded`가 끝낸다.
- job이 연 run도 같다. 끊긴 run은 `lophn_restarted`로 닫히고, 그 job의 job run은 `interrupted`이며 놓친 차례로 친다(`architecture/job.md` "켤 때").
- session이 archive되거나 지워지면 그 session에서 running인 run을 `turn_interrupted`(session_ended)로 닫는다. 입력이 줄에 있는 채로 session이 끝나면 turn이 열리지 않아 `TurnEnded`가 오지 않고, run이 영영 running으로 남기 때문이다. 먼저 turn을 한 번 보고 이미 끝난 결과가 있으면 그것을 쓴다.

tool run
- 앱을 id, slug, 이름으로 푼다(없으면 `not_found`). `StartRun`은 run 행을 만들고 기다리지 않고 돌려준다. 호출은 뒤에서 돌고 끝나면 `SettleRun`한다.
- 부른 쪽은 사람이다. 앱 화면에서 사람이 누르는 것과 같은 길이고 Gate를 거치지 않는다(`architecture/app-call.md`). run은 session이 없고 `view_session`에 run id를 싣는다.
  - `origin`이 있는 tool run은 사람이 아니다. job이 연 것은 같은 길을 program caller로, flow instance가 연 것은 flow caller로 부른다. 자격은 그 job을 만든 agent와 place, 또는 그 project의 PM과 project place를 싣는다(`packages/core/main/daemon/wiring/runs.ts`의 `tools.call`). 그 agent의 지금 할당과 domain 거르기를 받고 막히면 run이 `tool_denied`다(`architecture/app-call.md`).
- tool 이름이 없는 것은 `StartRun`에서 막지 않는다. run이 `tool_denied`로 실패한다. 선언을 미리 볼 port를 두지 않는 쪽이 단순하다.
- 성공이면 `done`이고 result가 tool 결과다. 기록이 남지 않은 읽기면 `invocation`이 null이다.

읽기
- `ListRuns`는 `session`, `agent`, `place`, `state`로 거르고(모두 맞아야 한다) 새것이 앞이며 50개씩 `cursor`로 읽는다. 화면이 session event마다 읽고 뒤에 job이 run을 쌓으므로 거르기는 core가 한다.
- place는 만들 때 기록한다. agent run은 그 agent의 place(lophn은 없음), tool run은 그 앱이다. `place: {app}` 하나로 그 앱의 App Engineer run, 앱 place Operator run, tool run을 같이 읽는다. place는 표의 칸이고 run 기록에는 싣지 않는다.
  - Operator의 place는 `AgentRef`에 없어서(`placeOfAgentRef`) 이름을 푸는 쪽(wiring)이 이름을 풀 때, 또는 `session`으로 이어 쓸 때 그 session을 읽어 place를 정해 `CreateRun`에 싣는다.
- run event는 계약에 없다. 화면은 session event 때 다시 읽는다.

CLI와 자격(`architecture/coding-agent.md`)
- 명령은 `lophn agent run <prompt>`(`--agent`, `--session`, `--schema`, `--input`, `--async`), `lophn tool call <app> <tool>`(`--input`, `--async`), `lophn run wait|show|cancel <run>`이다. `--agent`는 `lophn`(기본), `pm:<project>`, `ae:<app>`, `operator:<이름>`, `operator:<project 또는 app>/<이름>`, NamedAgent JSON을 받는다. `--schema`는 JSON 글이다.
- 결과는 stdout에 낸다. 답이 글이면 그대로, 아니면 JSON이고 `--json`이면 run 전체다. `--async`는 run id(`--json`이면 run)를 내고 바로 끝난다.
- 종료 코드는 0 성공, 1 internal, 2 invalid_input, 3 unauthorized·forbidden, 4 실패, 5 unavailable, 6 쓰기 응답을 잃음(effect_unknown)이다. 실패하거나 취소된 run은 `--json`이 없으면 stdout을 비우고 stderr에 한 줄(`failed: <reason>: <message>` 또는 `cancelled`)을 쓰고 4로 끝난다. `--json`이면 run을 stdout에 내고 4로 끝난다. `--async`, `run show`, `run cancel`은 명령 자체가 되면 0이다.
- 자격은 `<data root>/run/user-token`이다. core가 부모가 있을 때 hello frame을 쓰며 같은 token을 0600 file로 쓴다. 켤 때(lock을 잡은 뒤)와 종료, 기동 실패 때 지운다. file을 쓰지 못하면 core는 시작을 멈춘다. file이 없으면 lophn이 꺼진 것이고 CLI는 core를 띄우지 않고 `unavailable`(exit 5)로 끝난다.
- CLI 표(`CODING_CLI_COMMANDS`)의 이 다섯 명령은 `route`가 없고 `output`이 `z.unknown()`이다. protocol에서 coding-agent → runs → lophn-agent → coding-agent가 import 순환이 되기 때문이다. 명령(`cli/commands/run.ts`)이 `protocol/runs`의 route를 직접 부른다.

화면
- run이 연 session은 sidebar에 그대로 두지 않고 그 run 아래로 묶어 보인다. 쌓일 session을 그대로 두면 job이 하루에 session을 수십 개 만든다. 묶는 것은 `session_opened`가 true인 run의 session뿐이다. `--session`으로 이어 쓴 session은 원래 자리에 둔다.
  - project agent(lophn, Project Manager)의 session은 project sidebar의 Background 칸에서, App Engineer와 앱 place Operator의 session은 그 앱 공간의 agent 목록(Background)에서 묶는다. tool run은 session이 없어 run 목록에만 보인다.
  - Agent 탭의 session 목록(session popover)은 모든 session을 찾는 곳이라 run이 연 session도 그대로 보인다.
- project 창은 처음과 session 상태가 바뀔 때마다 `ListRuns`를 `place: { project }`와 `agent: { role: "lophn" }`로 두 번 읽어 합친다. 앱 공간은 Background 목록이 열려 있는 동안 `place: { app }`으로 읽는다. 읽는 곳은 workspace source의 `runs` 하나다(`packages/shell/renderer/workspace/core-source.ts`).
- job이 연 run 줄(그 job이 아직 있을 때)은 이름 자리에 job 제목을 보이고 agent 이름이나 tool 이름은 둘째 줄이다. 제목은 읽는 곳이 `job.list`로 붙인다(`packages/shell/renderer/workspace/core-source.ts`). 지운 job의 run 줄은 일반 run과 같다.
- run 줄은 이름 아래에 시작한 시각을 둔다. run 아래에 session 줄이 있으면 running 점은 그 session 줄에만 보인다.

## 왜 이 모양인가

- 끝을 짐작하지 않고 turn에서 안다. eval은 1초 조용하면 끝으로 보지만, 그러면 session에 먼저 있던 입력의 답을 돌려줄 수 있다. 입력 메시지 → 그 메시지의 turn → `TurnEnded`는 core가 정확히 아는 길이다.
- 정본은 표다. Bus는 구독이 죽으면 놓친다. 그래서 event는 표를 다시 보게 하는 신호이고, 같은 run을 둘이 `SettleRun`해도 compare가 하나만 받는다(진 쪽은 지금 기록을 읽는다).
- run 입력을 켤 때 다시 줄 세우지 않는다. 다시 돌면 이미 `lophn_restarted`로 닫힌 run 뒤에 attended turn이 생기고 바깥 효과가 두 번 난다.
- 규칙은 `core/runs`가 갖고 module은 lophn-agent와 다른 feature module을 import하지 않는다. 이름 풀기, 메시지 넣기, turn 읽기, 앱 호출은 `ports.ts`의 port이고 wiring이 끼운다(`architecture/layers.md`). wiring은 core 안 두 자격을 쓴다: 사람 입력으로 session을 열고 메시지를 읽는 `machine:runs`(actor user)와 run 행과 입력함 정리를 쓰는 `machine:runs-settle`(actor machine).
- 새 session을 열 때 이름을 먼저 푼다. 안 풀린 채 session부터 열면 CLI의 project 먼저, app 나중 재시도가 session을 남긴다.
- 취소할 때 run을 먼저 닫는다. 뒷일(입력 빼기, turn 멈추기)이 실패해도 run의 상태는 사람이 요청한 대로 남는다.
- tool run은 사람이 부르는 길이다. 사람이 시킨 일이 승낙이고(`architecture/approval.md`), CLI는 사람의 입구다.
- `origin`과 `agent_resolved`는 route 입력에 없고 core 안 `RunService.start`만 받는다. `origin`이 만든 agent(또는 PM)의 할당으로 앱 tool을 부르는 program·flow 자격이 되므로, route 입력으로 열려 있으면 누구든 남의 할당을 빌려 쓰는 길이 된다.
- 자격은 가장 단순한 길이다. 같은 OS 사용자로 도는 agent가 file을 읽어 사람 자격을 쓸 수 있다는 위험은 신경 쓰지 않는다.
- `invalid_output`을 오류 코드가 아니라 실패 이유로 둔다. 경계의 오류 코드는 일곱으로 두고, run이 어떻게 끝났는지는 run의 기록이다.
