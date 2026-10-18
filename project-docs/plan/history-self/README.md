# history-self: session이 자기 답을 history에서 자기 말로 읽게 한다

- 목표: 앞 turn에서 agent가 남긴 자기 답이 뒤 turn의 history에 다른 agent의 call(user role)로 들어가는 bug를 고친다.
- 재료: `project-docs/issues/agent-call.md`의 "session이 자기 답으로 남긴 메시지가 뒤 turn의 history에서 다른 agent의 call로 들어간다", `project-docs/architecture/agent-call.md`, `project-docs/architecture/agent-definition.md`
- 범위 밖: 받은 메시지 봉투의 저장 꼴(계획 `prompt-text`가 바꿨다), call·reply·reaction의 글.
- 돌리는 방식: **worker를 쓰지 않는다.** lead가 lead worktree에서 직접 고친다(task 하나).
- 단위: `tasks/*.md`. task id는 `hs-`로 시작한다.
- 순서: wave 하나.
- 시작 조건: 없음. 계획 `settings-mcp`, `reuse-diagnose`와 같이 돌아도 소유가 겹치지 않는다.

## 정한 것

- history는 받은 메시지 가운데 보낸 쪽이 그 session 자신인 것(`from.kind === "agent"`이고 `from.session`이 그 session)을 `assistant` role로, 본문 글 그대로 넣는다. tag로 싸지 않는다(agent, 이슈 추천).
- 다른 session이 보낸 call, reply, reaction, 사람 메시지는 지금처럼 user role로 둔다.

## 사람이 정할 것

없음.

## lead가 할 일

- 끝나면 이슈를 archived로 옮기고, `project-docs/products/change-log/0.3.0.md`에 항목을 덧붙이고, history 설명이 있는 architecture 문서를 맞춘 뒤 `land.sh`로 올린다.
