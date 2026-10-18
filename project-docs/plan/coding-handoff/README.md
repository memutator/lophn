# coding-handoff: coding agent에 맡긴 일이 조용히 멈추지 않게

- 목표: App Engineer가 coding agent(Claude Code)에게 맡긴 일이 사람 모르게 멈추는 두 길을 막는다.
  - coding agent가 `lophn message send`로 물었는데 App Engineer가 글로만 답하면, 그 답은 터미널에 가지 않는다.
  - Claude Code가 새 앱 source 폴더마다 folder trust를 묻는 동안 hook이 돌지 않는다. 그런데 lophn 화면에는 아무것도 보이지 않는다.
- 재료: `project-docs/issues/coding-agent.md`의 두 이슈와 그 정한 것, `project-docs/architecture/coding-agent.md`, `project-docs/architecture/agent-call.md`. 두 bug는 계획 `eval-coding`의 첫 진짜 run이 찾았다.
- 범위 밖:
  - core가 App Engineer의 글을 터미널로 대신 보내기(사람이 버렸다).
  - `~/.claude.json`에 trust를 쓰기, trust 화면 글 긁기(사람이 버렸다).
  - eval(`tests/eval`) 고치기.
- 돌리는 방식: worker를 쓴다. orchestrate skill대로 한다. task id는 `ch-`로 시작한다.
- 순서: wave 1에 `ch-reply`와 `ch-trust`를 같이 돌린다. 소유가 겹치지 않는다.

## 정한 것

- **답하는 길은 봉투와 지침으로 알린다**(사람). coding agent가 보낸 call의 봉투에 한 줄을 넣는다: "글은 터미널에 가지 않는다. `call`의 `to:{session:<id>}`, `reply:"conversation"`으로 답한다". App Engineer 지침에도 같은 길을 적는다. 답할지, 무엇을 답할지는 App Engineer가 정한다. 그 줄은 `from.kind === "coding_agent"`로 정한다. 받은 turn과 뒤 이력이 같은 함수로 같은 bytes를 만들어 cache가 깨지지 않는다(agent).
- **`lophn message send --help`가 `refs`는 ticket id 문자열의 배열이라고 적는다**(agent). 첫 run에서 coding agent가 객체를 넣어 `invalid_input`을 한 번 받았다.
- **trust는 대기 목록으로 알린다**(사람). 터미널을 열었는데 첫 hook 신호가 아직 없는 coding session을 대기 목록에 "터미널에서 Claude Code 확인이 필요할 수 있다"로 보인다. 누르면 그 탭으로 focus가 간다. 첫 신호가 오거나 session이 끝나면 사라진다. 화면 글은 긁지 않는다. architecture "harness의 권한 물음에 lophn 화면으로 답하지 않는다"와 같은 이유다.

## 사람이 정할 것

- 없음.

## lead가 할 일

- 끝나면:
  - `project-docs/architecture/coding-agent.md`와 `agent-call.md`가 코드와 맞는지 본다. ch-reply가 고친 것을 확인하고, ch-trust가 보고에 적은 문서 글을 넣는다.
  - 두 이슈를 `issue` skill대로 archived로 닫는다.
  - `project-docs/products/change-log/`의 열린 판에 항목을 덧붙인다. 결정은 위 "정한 것"의 (사람)·(agent) 그대로 옮긴다.
  - App Engineer 지침과 `packages/core/lophn-agent`가 바뀌면 eval의 `instruction:app-engineer`와 `runtime`이 오른다. 그래서 commit된 run이 낡음으로 보인다. 그대로 두고 changelog 항목에 한 줄 적는다.

## task

| id | wave | 선행 | 하는 일 |
|---|---|---|---|
| `ch-reply` | 1 | 없음 | coding agent call 봉투의 답하는 길 한 줄, App Engineer 지침, `message send --help`의 refs |
| `ch-trust` | 1 | 없음 | 첫 hook 신호가 없는 coding session을 대기 목록에 보이기 |
