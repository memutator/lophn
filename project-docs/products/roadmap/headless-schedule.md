# headless와 schedule: lophn agent를 화면 없이 부르고, 정해진 때 돌린다

상태: 로드맵. 2026-10-20 사람이 방향을 내고 planner가 정리했다. 1단계 headless run은 계획 `headless-run`으로(run, CLI, run이 연 session. 동작은 `project-docs/architecture/run.md`), job(scheduler, job 표와 기록, program caller, workflow 시작, 놓친 차례, hold card, job 화면)은 계획 `schedule-job`으로 land했다. 동작은 `project-docs/architecture/job.md`다. 이 문서에 남은 것은 flow와 gdrive OAuth다. 권한은 `approval.md`가 다룬다(아래 "권한"). flow는 같은 날 workflow의 kind로 정해 `project-docs/products/roadmap/workflow.md`로 옮겼다. "지금 코드"는 flow와 gdrive에 닿는 것만 `schedule-job` 뒤 main에 맞췄다.
배경 문서: `project-docs/architecture/job.md`, `project-docs/architecture/run.md`, `project-docs/architecture/place-session.md`, `project-docs/architecture/event.md`, `project-docs/architecture/approval.md`, `project-docs/architecture/app-call.md`, `project-docs/architecture/eval.md`, `project-docs/products/AGENT-ROLE.md`.

## 왜

- 사람이 lophn agent에게 일을 시키는 길은 화면뿐이어서 명령 하나로 시키고 결과를 받을 수 없었다(`claude -p`, `codex exec`처럼). run과 CLI가 이것을 풀었고, 정해진 때 저절로 도는 일은 job이 풀었다(10일마다 폴더의 파일을 옮긴다).
- 남은 것은 새 기사가 오는지를 script가 판단하는 일(구독한 뉴스에 새 기사가 오면 번역한다)이다.
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
| job | 언제(주기) + 무엇(원샷 run 하나, workflow instance 시작) + 놓쳤을 때 할 일. land했다(`architecture/job.md`). flow를 띄우는 할 일은 flow가 열릴 때 더한다 | 10일마다 `drive.sync_folder` |
| flow | 앱 tool과 agent 호출을 섞어 짠 program. 검증과 오류 처리를 스스로 한다. program이 이끄는 workflow다(`workflow.md`) | 1시간마다 feed를 보고, 새 기사만 Operator에게 번역시켜 저장 |

- 간단한 일은 원샷 run으로 job에 바로 건다. 복잡한 일은 flow로 짜서 job에 건다(flow를 job의 할 일로 거는 것은 아직 없다). 무엇이 간단한지는 job을 만드는 agent가 판단한다.
- event가 일어났는지를 script가 판단하는 일(뉴스 구독)은 flow다. 차례마다 flow가 돌고, 앱 tool로 새 기사를 찾고, 있을 때만 agent를 부른다. core는 주기와 실행만 맡는다.
- lophn 밖의 program(사람의 cron)은 CLI로 run을 부른다. coding session 안에서는 coding token이 먼저라 run을 부르지 못한다(`architecture/coding-agent.md`).

### 다시 하기

- 틀린 답과 tool 실패를 다시 할지는 flow가 정한다. run과 job에는 자동 재시도가 없다.

## 지금 코드

- 앱 tool
  - 부르는 쪽은 user, agent, app, program이다. program은 job이 연 tool run의 호출이다(`packages/protocol/apps/calls/caller.ts`, `architecture/app-call.md`).
  - 호출은 120초에 끊긴다(`packages/core/apps/runtime/supervisor/relay.ts`의 `CALL_TIMEOUT_MS`). write는 앱마다 하나씩 돈다(`architecture/app-call.md`).
  - 앱은 invocation 밖(자기 timer)에서 다른 tool, secret, agent를 부르지 못한다. 앱이 부를 수 있는 broker 길은 `apps/call` 하나뿐이다(`packages/protocol/apps/calls/broker.ts`의 `APP_BROKER_PATHS`). 부모 invocation이 없는 호출은 `forbidden`이다(`packages/core/apps/calls/caller.ts`의 `verifyCaller`).
  - 앱이 lophn에 사실을 밀어 넣는 길은 없고, Operator가 읽기 tool로 끌어 읽는다(`architecture/event.md` "왜 이 모양인가").
- 앱 secret은 Bearer만 붙는다(`packages/sdk/cap-secret`). OAuth refresh는 MCP에만 있다(`packages/core/lophn-agent/extensions/mcp-oauth.ts`).

## 무엇을 만드나

### flow

- program이 이끄는 workflow다. `workflow.md`로 옮겼다. job은 flow를 원샷 run처럼 차례에 띄운다.

### 따로 필요한 것

- **gdrive.** 앱이 gdrive를 쓰려면 OAuth refresh가 필요한데, 앱 secret은 Bearer만 된다. MCP 쪽 OAuth(`mcp-oauth.ts`)를 앱 secret에도 여는 일이다. gdrive 예를 돌리기 전에 한다.

## 정한 것 (사람, 2026-10-20)

- 간단한 일은 원샷으로 끝내고, 복잡한 일은 flow로 program처럼 짠다.
- agent 호출은 비결정적 함수처럼 쓴다. 앱 tool 호출과 섞어 쓸 수 있다.
- run은 비동기로 쓸 수 있다.
- 검증 체계는 flow를 짜는 agent의 책임이다. program은 뜻을 이해하지 못한다. 놓친 차례 밖의 오류 처리도 flow의 일이다.

## 정한 것 (agent)

- run의 끝은 그 입력이 연 turn의 끝이다. 근거: `claude -p`와 같고, core가 메시지와 turn으로 정확히 안다.
- 호출마다 새 session이다. 근거: 함수라서 앞 호출의 상태를 받지 않는다. 이어 쓰려면 `--session`을 준다.
- schema 검사는 program이, 뜻 검사는 flow가 한다. 근거: schema는 결정적으로 판정된다(PRODUCT 3절 program의 몫).
- run과 job에 자동 재시도가 없다. 근거: AGENT-ROLE 7절 "자동 재시도"를 하지 않는다. 사람이 정한 대로 놓친 차례 밖의 다시 하기는 flow가 한다.
- 계속 떠서 push하는 event source(websocket, 상주 script, webhook)는 만들지 않는다. 근거: 끌어 읽기(`architecture/event.md` "왜 이 모양인가")로 충분하다. webhook은 공개 endpoint가 필요해 개인 로컬 작업 공간(PRODUCT 5절)과 맞지 않는다.

## 권한 (`approval.md`)

권한은 같은 날 `project-docs/products/roadmap/approval.md`로 다시 설계했고, 계획 `approval-simplify`가 turn mode(attended, unattended, skip)와 그 전파를 만들었다(`architecture/approval.md`). run은 그 입구를 `SendMessage`의 `unattended: true`로 만들었고, job은 그 run을 부른다(land했다. `architecture/job.md`).

- headless run과 job, 그리고 그 안의 call 사슬은 unattended다. 물음 없이 돌고, deny만 막힌다. `ask` tool은 "사람이 없다"를 바로 돌려준다.
- job은 agent가 만들고 켠다. 사람이 시킨 것이 승낙이다(사람, 2026-10-20).
- CLI 자격은 가장 단순한 길로 한다. core가 user token을 data root의 file(0600)에 쓰고 CLI가 읽는다(agent). 같은 OS 사용자로 도는 agent가 그 file을 읽어 사람 자격을 쓸 수 있다는 위험은 신경 쓰지 않는다(사람, 2026-10-20).

## 정할 것

flow가 사는 곳과 flow의 preview·test는 `workflow.md` "정할 것" 1로 옮겼다. 앱 tool 하나로는 flow를 짤 수 없다는 사실(호출 120초 제한, 앱마다 write 직렬)도 거기서 본다.

## 단계

- `headless-run`(run, CLI)과 `schedule-job`(job)은 land했다. flow는 `workflow.md`의 계획이 연다. flow가 열릴 때 job의 할 일에 flow 시작을 더한다.
- gdrive OAuth는 flow와 따로 열 수 있다.

## 끝남 기준

- 앱이 gdrive를 OAuth refresh로 쓴다. 10일마다 폴더의 파일을 옮기는 job이 그 앱 tool을 부른다.
- flow 쪽의 끝남 기준은 `workflow.md`다.

## 하지 않는 것

- **상주 daemon이나 OS service.** tray와 autostart로 충분하다.
- **push형 event source와 webhook.** 주기 polling으로 끌어 읽는다.
- **자동 재시도.** 다시 하기는 flow가 한다.
- **LLM judge로 run 결과 검증.** 뜻 검증은 flow를 짠 agent의 일이다(`architecture/approval.md`가 LLM judge를 넣지 않은 이유와 같다).
- **cron 문법.** 간격과 하루 중 시각으로 시작하고, 모자라면 그때 더한다.
