# coding-visible: 열린 coding session이 어디서나 보이게

- 목표: 도는 coding agent(Claude Code)를 App Engineer와 사람이 놓치지 않게 한다. 계획 `coding-handoff`가 남긴 빈틈 둘을 막는다.
  - App Engineer의 `session.list`에 열린 coding session이 없다. 그래서 봉투가 없는 turn에서는 도는 coding agent에게 말을 걸 id를 모른다. 예: 같은 앱의 새 App Engineer session, 사람이 "그 coding agent에게 이렇게 전해"라고 할 때.
  - "Check the terminal" 항목(`coding_start`)은 터미널이 열릴 때 runtime을 받은 창에만 뜬다. 뒤에 연 창에는 없다. event stream이 다시 붙은 뒤에는 이미 시작한 session에 잘못 뜰 수 있다.
- 재료: `project-docs/issues/coding-agent.md`의 두 이슈("App Engineer의 `session.list`는 …", "첫 신호 대기 항목은 …"), `project-docs/architecture/coding-agent.md`, `project-docs/architecture/agent-call.md`.
- 범위 밖:
  - codex hooks trust 이슈.
  - eval(`tests/eval`) 고치기.
  - 화면 글 긁기, `~/.claude.json` 쓰기(계획 `coding-handoff`에서 사람이 버렸다).
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `cv-`로 시작한다.
- 순서: wave 1에 `cv-list`와 `cv-start`를 같이 돌린다. 소유가 겹치지 않는다.

## 정한 것

- **`session.list`가 열린 coding session을 싣는다**(agent). 이슈의 추천안이다.
  - `withCodingSessions`(`packages/core/main/daemon/wiring/router-registration.ts`)가 `listOpen`에 끝나지 않은 coding session을 더한다.
  - Router의 `describe`가 coding session의 place(그 앱)와 state(`stateOf`)를 낸다. `waiting`은 coding session만 낸다. lophn session은 지금처럼 구별하지 않는다.
  - 고르는 규칙은 지금 그대로다. grant가 deny인 상대는 `CallGate.visible`이 뺀다. 자기 자신은 뺀다.
  - `queued_coding`은 그대로 둔다. 줄에 선 맡기기는 아직 session이 없다.
- **App Engineer 지침에 한 줄을 더한다**(agent). 도는 coding agent는 `session.list`에도 보이고, 그 session에 `call`을 `to:{session}`, `reply:"conversation"`으로 보낸다는 줄이다. 줄이 없으면 App Engineer가 봉투 밖에서 이 길을 쓸 근거가 없다.
- **coding session snapshot이 harness를 싣는다**(agent). 뒤에 연 창은 터미널 runtime을 받지 않았다. 그래서 그 session이 SessionStart hook이 있는 harness인지 snapshot으로 알아야 한다. 없는 harness(OpenCode)는 첫 신호가 첫 turn 끝이라 항목이 오래 남는다.
- **대기 항목은 snapshot으로도 센다**(agent). snapshot에서 `unknown`이고 SessionStart가 있는 harness인 coding session도 runtime으로 센 것과 같은 delay를 건다. snapshot에서 첫 신호를 들은 session은 다시 세지 않는다. 그래서 다시 붙은 뒤 온 runtime event가 항목을 띄우지 않는다.

## 사람이 정할 것

- 없음.

## lead가 할 일

- 끝나면:
  - `project-docs/architecture/coding-agent.md`와 `agent-call.md`가 코드와 맞는지 본다.
  - 두 이슈를 `issue` skill대로 archived로 닫는다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다. 결정은 위 "정한 것"의 (사람)·(agent) 그대로 옮긴다.
  - `packages/core`, `packages/protocol`, App Engineer 지침이 바뀌어 eval의 `core`와 `instruction:app-engineer`가 오른다. commit된 run은 낡음으로 보인다. 그대로 두고 changelog 항목에 한 줄 적는다.
- 계획 `eval-experiment`가 기준 run을 다시 돌리기 전에 land한다. 뒤에 land하면 그 기준 run이 다시 낡는다. land하면 planner 세션 `lophn-ee`에 한 줄 보낸다.

## task

| id | wave | 선행 | 하는 일 |
|---|---|---|---|
| `cv-list` | 1 | 없음 | `session.list`에 열린 coding session 싣기, App Engineer 지침 한 줄 |
| `cv-start` | 1 | 없음 | snapshot에 harness 싣기, 뒤에 연 창과 다시 붙은 창의 `coding_start` 항목 맞추기 |
