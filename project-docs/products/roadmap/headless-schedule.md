# headless와 schedule: lophn agent를 화면 없이 부르고, 정해진 때 돌린다

상태: 로드맵. 2026-10-20 사람이 방향을 내고 planner가 정리했다. 1단계 headless run은 계획 `headless-run`으로 land했다(run, CLI, run이 연 session. 동작은 `project-docs/architecture/run.md`). 이 문서에 남은 것은 job과 그 뒤다. 권한은 `approval.md`가 다룬다(아래 "권한"). flow는 같은 날 workflow의 kind로 정해 `project-docs/products/roadmap/workflow.md`로 옮겼다. "지금 코드"는 2026-10-22에 개편(`problem-remove`, `approval-simplify`, `ae-builds`, `reactor-remove`, `agent-definition`, `test-restore`)과 `headless-run` 뒤 main에 맞췄다.
배경 문서: `project-docs/architecture/run.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/event.md`, `project-docs/architecture/approval.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/eval.md`, `project-docs/products/AGENT-ROLE.md`.

## 왜

- 사람이 lophn agent에게 일을 시키는 길은 화면(sidebar, 앱 화면, toast)뿐이다. `claude -p`나 `codex exec`처럼 명령 하나로 시키고 결과를 받을 수 없다.
- 그래서 정해진 때 저절로 도는 일을 만들 수 없다. 예: 10일마다 폴더의 파일을 gdrive로 옮긴다. 구독한 뉴스에 새 기사가 오면 번역한다.
- 큰 일은 agent 하나에게 prompt 하나로 맡기기 어렵다. 앱 tool과 agent 호출을 섞어 program처럼 짜야 한다. 그 안에서 agent 호출은 비결정적 함수다.

## 모양

### agent 호출은 비결정적 함수다

- 입력: 받는 agent(lophn, Project Manager, App Engineer, Operator. Operator는 place와 이름), prompt, 입력 JSON(선택), 출력 JSON schema(선택).
- 출력: 그 호출이 연 turn의 마지막 답. schema를 주면 답이 schema에 맞는 JSON이어야 하고, 맞지 않으면 호출이 `invalid_output`으로 실패한다.
- 호출 하나가 session 하나를 연다. 앞 호출의 대화를 이어 받지 않는다. 이어 쓰려면 session을 준다.
- 그 입력이 연 turn이 끝나면 호출이 끝난다. agent가 다른 agent에게 결과를 받는 call을 보내고 turn을 끝내면, 그때의 답이 결과다. 나중에 온 답은 session에 남는다.
- 비동기로 쓴다. 시작하면 run id를 바로 받고, 나중에 기다리거나 읽거나 취소한다. 여러 호출을 동시에 띄울 수 있다.
- 답의 뜻이 맞는지(번역이 맞나)는 program이 모른다. 검증과 다시 하기는 부르는 쪽의 일이다. program이 보는 것은 끝났나, 실패했나, schema에 맞나뿐이다.

### run, job, flow

| 층 | 무엇 | 예 |
|---|---|---|
| run | agent 호출 하나, 또는 앱 tool 호출 하나 | `lophn agent run --async ...` |
| job | 언제(주기) + 무엇(원샷 run 하나, workflow instance 시작, 또는 flow) + 놓쳤을 때 할 일 | 10일마다 `drive.sync_folder` |
| flow | 앱 tool과 agent 호출을 섞어 짠 program. 검증과 오류 처리를 스스로 한다. program이 이끄는 workflow다(`workflow.md`) | 1시간마다 feed를 보고, 새 기사만 Operator에게 번역시켜 저장 |

- 간단한 일은 원샷 run으로 job에 바로 건다. 복잡한 일은 flow로 짜서 job에 건다. 무엇이 간단한지는 job을 만드는 agent가 판단한다.
- event가 일어났는지를 script가 판단하는 일(뉴스 구독)은 flow다. 차례마다 flow가 돌고, 앱 tool로 새 기사를 찾고, 있을 때만 agent를 부른다. core는 주기와 실행만 맡는다.
- lophn 밖의 program(사람의 cron)은 CLI로 run을 부른다. coding session 안에서는 coding token이 먼저라 run을 부르지 못한다(`architecture/coding-agent.md`).

### 놓친 차례

- job은 다음 차례 시각을 기록한다. lophn이 꺼져 있어 차례를 놓쳤으면 켤 때 안다. 여러 번 놓쳐도 한 번으로 친다.
- 놓쳤을 때 할 일은 job마다 고른다.
  - `run`: 켜지면 바로 한 번 돈다.
  - `hold`: 돌리지 않고 사람에게 알린다. 사람이 [지금 실행]이나 [건너뛰기]를 고른다. 알림은 대기 목록에 남아 꺼졌다 켜져도 사라지지 않는다.
- 도는 중에 lophn이 꺼져 끊긴 run도 놓친 차례로 친다. 꺼지면 turn이 interrupted로 닫히기 때문이다(`architecture/place-session.md`).
- 앞 차례가 아직 돌면 이번 차례는 건너뛴다.
- 그 밖의 실패(틀린 답, tool 실패)를 다시 할지는 flow가 정한다. run과 job에는 자동 재시도가 없다.

## 지금 코드

- run은 land했다(`architecture/run.md`). 시작·기다리기·읽기·취소 route(`packages/protocol/runs/runs.ts`), 규칙(`packages/core/runs`), CLI(`lophn agent run`, `lophn tool call`, `lophn run wait|show|cancel`), user token file이 있다. 이 문서의 job은 이것을 부르는 쪽에 scheduler를 더한다.
  - agent run은 `SendMessage`에 `unattended: true`를 실은 사람 메시지로 session을 열어 unattended turn을 연다. 끝은 그 메시지가 들어간 turn의 `TurnEnded`다. 답은 그 turn에서 그 session의 agent가 남긴 마지막 메시지다.
  - tool run의 부른 쪽은 사람이다. program이 부르는 앱 tool 길은 아직 없다.
- turn은 agent runtime child가 500ms마다 입력함을 보고 시작한다(`packages/core/main/agent-runtime/product-driver.ts`의 `startTurnPump`, `PUMP_IDLE_MS`).
- session은 저절로 끝나지 않는다(`architecture/place-session.md`, AGENT-ROLE T11). run이 연 session도 열린 채 남는다. job이 session을 쌓는 문제는 아래 "정할 것".
- 물음은 attended turn에서만 기한 없이 기다린다(turn 안 request `packages/core/approvals/turn-requests.ts`, `ask` 질문 `packages/core/lophn-agent/tools/questions/wait.ts`. 결정 command는 user만 받는다). unattended turn은 shell `ask`를 묻지 않고 `ask` tool은 `unattended`를 바로 돌려준다. turn mode는 `turns.mode`에 있다(`architecture/approval.md`).
- core는 Electron main의 child다.
  - 창을 닫아도 tray에 남고, tray의 Quit만 멈춘다(`packages/shell/main/desktop/quit.ts` 머리 주석).
  - 로그인 때 `--tray`로 켜는 autostart가 있다. packaged build만 된다(`packages/shell/main/desktop/autostart.ts`).
  - data root마다 core는 하나다(instance lock, `packages/base/install/instance-lock.ts`의 `acquireInstanceLock`을 `packages/core/main/daemon/core.ts`가 시작할 때 부른다).
- scheduler가 없다. Clock은 `now()`와 `nowMs()`뿐이다(`packages/base/clock.ts`). 주기 loop는 `setInterval`을 직접 쓴 곳 7개다(`packages/core` 안. 앱 control sweep 1초 `packages/core/apps/control.ts`, annotation sweep, rewind sweep, storage prune, io worker gc 등).
- domain event와 Reactor가 없다(`reactor-remove`). 뒤에 꼭 움직여야 하는 일은 그 일을 아는 command가 같은 tx에서 하고, 사용자 hook을 여는 안은 하지 않았다(`architecture/event.md`).
- 앱 tool
  - 부르는 쪽은 user, agent, app뿐이고 program은 없다(`packages/protocol/apps/calls/call.ts`의 `actors`, `packages/core/apps/calls/caller.ts`의 `CallAuth`와 `VerifiedCaller`).
  - 호출은 120초에 끊긴다(`packages/core/apps/runtime/supervisor/relay.ts`의 `CALL_TIMEOUT_MS`). write는 앱마다 하나씩 돈다(`architecture/app-call.md`).
  - 앱은 invocation 밖(자기 timer)에서 다른 tool, secret, agent를 부르지 못한다. 앱이 부를 수 있는 broker 길은 `apps/call` 하나뿐이다(`packages/protocol/apps/calls/broker.ts`의 `APP_BROKER_PATHS`). 부모 invocation이 없는 호출은 `forbidden`이다(`packages/core/apps/calls/caller.ts`의 `verifyCaller`).
  - 앱이 lophn에 사실을 밀어 넣는 길은 없고, Operator가 읽기 tool로 끌어 읽는다(`architecture/event.md` "왜 이 모양인가").
- 앱 secret은 Bearer만 붙는다(`packages/sdk/cap-secret`). OAuth refresh는 MCP에만 있다(`packages/core/lophn-agent/extensions/mcp-oauth.ts`).
- 사람에게 알리는 길
  - toast 종류 다섯(permission, activation, question, restart-halted, kind-violation)은 renderer가 정한다(`packages/shell/renderer/desktop/connection/events/reactions.ts`의 `REACTION_EVENT_TYPES`).
  - 꺼졌다 켜져도 남는 것은 대기 목록의 activation 동의(`activation_consents` 표)뿐이다.

## 무엇을 만드나

### 1. headless run (land했다)

`architecture/run.md`.

### 2. job

- **core scheduler.**
  - 주입한 Clock과 timer로 돈다.
  - job 표에는 주기, 할 일(원샷 run 또는 flow), 놓친 차례 정책(`run|hold`), 다음 차례 시각, 켜짐을 둔다.
  - 차례마다 job run 기록을 남긴다.
- **주기.** 간격(`every: 10d`)과 하루 중 시각(`at: "09:00"`, 선택)을 쓴다. cron 문법은 쓰지 않는다.
- **원샷.** 차례가 오면 run(`architecture/run.md`)을 연다. 앱 tool을 부르는 쪽에 program을 더한다.
- **workflow 시작.** 차례가 오면 project의 `kind: agent` workflow instance를 시작한다(`architecture/workflow.md`). 지금 시작은 사람(화면, CLI)뿐이다. roadmap `workflow.md`가 시작하는 길로 사람과 job을 정했다.
- **hold 알림.** 대기 목록에 [지금 실행]과 [건너뛰기] card를 둔다.
- **화면.** job 목록과 job run 기록을 어디에 둘지는 계획에서 wireframe으로 정한다. job이 만든 run의 session은 run 아래로 묶는 모양(`architecture/run.md` "화면")을 쓴다.

### 3. flow

- program이 이끄는 workflow다. `workflow.md`로 옮겼다. job은 flow를 원샷 run처럼 차례에 띄운다.

### 따로 필요한 것

- **gdrive.** 앱이 gdrive를 쓰려면 OAuth refresh가 필요한데, 앱 secret은 Bearer만 된다. MCP 쪽 OAuth(`mcp-oauth.ts`)를 앱 secret에도 여는 일이다. gdrive 예를 돌리기 전에 한다.

## 정한 것 (사람, 2026-10-20)

- 간단한 일은 원샷으로 끝내고, 복잡한 일은 flow로 program처럼 짠다.
- agent 호출은 비결정적 함수처럼 쓴다. 앱 tool 호출과 섞어 쓸 수 있다.
- run은 비동기로 쓸 수 있다.
- 검증 체계는 flow를 짜는 agent의 책임이다. program은 뜻을 이해하지 못한다. 놓친 차례 밖의 오류 처리도 flow의 일이다.
- 놓친 차례의 정책은 job마다 둔다: 켜지면 바로 실행, 또는 보류하고 알림. 그러려면 실행되지 않았다는 것을 알 수 있어야 한다.

## 정한 것 (agent)

- run의 끝은 그 입력이 연 turn의 끝이다. 근거: `claude -p`와 같고, core가 메시지와 turn으로 정확히 안다.
- 호출마다 새 session이다. 근거: 함수라서 앞 호출의 상태를 받지 않는다. 이어 쓰려면 `--session`을 준다.
- schema 검사는 program이, 뜻 검사는 flow가 한다. 근거: schema는 결정적으로 판정된다(PRODUCT 3절 program의 몫).
- run과 job에 자동 재시도가 없다. 근거: AGENT-ROLE 7절 "자동 재시도"를 하지 않는다. 사람이 정한 대로 놓친 차례 밖의 다시 하기는 flow가 한다.
- schedule은 lophn(tray 포함)이 켜져 있을 때만 돈다. 상주 daemon이나 OS service를 따로 만들지 않는다. 근거: 창을 닫아도 tray에 core가 남고 autostart가 있다. data root마다 core는 하나다.
- 놓친 차례는 몇 번이든 한 번으로 친다. 근거: 10일 주기를 세 번 놓쳤다고 세 번 옮길 일이 없다. 몇 번 놓쳤는지는 기록에 남긴다.
- 앞 차례가 돌면 이번 차례를 건너뛴다. 근거: 같은 job이 겹쳐 돌면 같은 바깥 효과가 두 번 난다.
- job의 할 일에 workflow instance 시작을 둔다(2026-10-22). 근거: roadmap `workflow.md`가 instance를 시작하는 길로 사람, run, job을 정했다. 앞 instance가 아직 running이면 이번 차례는 건너뛴다(같은 job이 겹쳐 돌지 않는 규칙 그대로).
- schedule을 event 반응에 얹지 않는다. 근거: event에 반응하는 장치가 없고, 뒤에 움직일 일은 그 일을 아는 command가 같은 tx에서 한다(`architecture/event.md`).
- 계속 떠서 push하는 event source(websocket, 상주 script, webhook)는 만들지 않는다. 근거: 끌어 읽기(`architecture/event.md` "왜 이 모양인가")로 충분하다. webhook은 공개 endpoint가 필요해 개인 로컬 작업 공간(PRODUCT 5절)과 맞지 않는다.

## 권한 (`approval.md`)

권한은 같은 날 `project-docs/products/roadmap/approval.md`로 다시 설계했고, 계획 `approval-simplify`가 turn mode(attended, unattended, skip)와 그 전파를 만들었다(`architecture/approval.md`). run은 그 입구를 `SendMessage`의 `unattended: true`로 만들었고, job은 그 run을 부르면 된다.

- headless run과 job, 그리고 그 안의 call 사슬은 unattended다. 물음 없이 돌고, deny만 막힌다. `ask` tool은 "사람이 없다"를 바로 돌려준다.
- job은 agent가 만들고 켠다. 사람이 시킨 것이 승낙이다(사람, 2026-10-20).
- CLI 자격은 가장 단순한 길로 한다. core가 user token을 data root의 file(0600)에 쓰고 CLI가 읽는다(agent). 같은 OS 사용자로 도는 agent가 그 file을 읽어 사람 자격을 쓸 수 있다는 위험은 신경 쓰지 않는다(사람, 2026-10-20).

## 정할 것

1. **job과 job run 기록을 화면 어디에 보이나 (계획에서 wireframe).** run이 연 session은 run 아래로 묶어 보인다(`architecture/run.md` "화면"). job 목록과 job이 만든 run을 어디에서 묶어 보일지는 그 위에 정한다.

flow가 사는 곳과 flow의 preview·test는 `workflow.md` "정할 것" 1로 옮겼다. 앱 tool 하나로는 flow를 짤 수 없다는 사실(호출 120초 제한, 앱마다 write 직렬)도 거기서 본다.

## 단계

- 계획 셋을 순서대로 연다.
  1. `headless-run`(land했다. `architecture/run.md`): core run, CLI, run session의 화면.
  2. `schedule-job`: scheduler, job 표와 기록, program caller, workflow 시작, 놓친 차례, hold card, job 화면. 2026-10-22 headless-run, workflow, workflow-shell이 land한 뒤 계획을 새로 썼다.
  3. flow는 `workflow.md`의 계획이 연다.
- unattended mode(run의 전제)는 `approval-simplify`가 만들었다.
- 개편(`ae-builds`, `reactor-remove`, `agent-definition`)이 끝나고 e2e와 eval도 되살렸다(`test-restore`). `headless-run`은 land했고 `schedule-job`이 다음이다.
- gdrive OAuth는 flow와 따로 열 수 있다.

test(AGENTS.md "속도", `write-test` skill):
- 놓친 차례가 여러 번이어도 job은 한 번만 돈다.
- 앞 차례가 도는 동안 같은 job이 또 돌지 않는다.

계획 끝에 고칠 것:
- `architecture/app-call.md`(program caller), 새 architecture 문서(job)
- `project-docs/products/AGENT-ROLE.md`(program이 Operator를 부르는 때)
- changelog 열린 판

## 끝남 기준

- 10일 주기 job을 lophn이 꺼진 사이 놓치면 `run` 정책은 켜질 때 한 번 돌고, `hold` 정책은 대기 목록에 card를 남긴다.
- 1시간 주기 job이 원샷 run으로 Operator를 부른다. 앞 차례가 도는 동안 온 차례는 건너뛴다.

## 하지 않는 것

- **상주 daemon이나 OS service.** tray와 autostart로 충분하다.
- **push형 event source와 webhook.** 주기 polling으로 끌어 읽는다.
- **자동 재시도.** 다시 하기는 flow가 한다.
- **LLM judge로 run 결과 검증.** 뜻 검증은 flow를 짠 agent의 일이다(`architecture/approval.md`가 LLM judge를 넣지 않은 이유와 같다).
- **cron 문법.** 간격과 하루 중 시각으로 시작하고, 모자라면 그때 더한다.
