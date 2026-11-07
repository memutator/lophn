# harness-gui-dogfood

- 목표: 사람이 harness GUI를 써 보고 말한 넷을 고친다. (1) 입력칸에 칠 때 lag. (2) 글이 한두 글자 나오다 끝에 한꺼번에 나온다. (3) Claude GUI가 처음에 사람 설정 mode(auto) 대신 "Ask before edit"를 보이다 turn이 시작되면 바뀐다. "Default" model은 실제 model 이름을 보여야 한다. (4) turn 밖에서 도는 `!` 명령을 멈출 단추가 없다.
- 재료: `project-docs/architecture/harness-gui.md`, `project-docs/architecture/acp.md`, `project-docs/architecture/agent-chat.md`, `.claude/skills/harness-gui/SKILL.md`
- 범위 밖: 채팅 화면 가상화(lag 원인이 그것뿐이면 보고한다).
- 순서: wave 1 `chat-render-perf`, `claude-meta`. wave 2 `shell-stop`(adapter 넷과 `agent-thread.tsx`를 고쳐 wave 1 뒤).
- 정한 것(agent): `!` 명령 멈춤은 그 줄의 단추가 ACP 새 입력 `stop_shell {item}`을 보낸다. 쓰는 곳이 이 계획뿐이라 `shell-stop`이 계약까지 고친다.
- 사람이 정할 것: 없음.
- lead가 할 일: merge마다 확인, 끝나면 architecture 문서와 changelog, land.
