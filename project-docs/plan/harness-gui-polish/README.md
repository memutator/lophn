# harness-gui-polish

- 목표: 사람이 harness GUI를 써 보고 말한 넷을 고친다. (1) 다른 workspace에서 본 GUI 탭 이름이 shell 경로 제목으로 보인다. (2) 사람이 돌린 `!` 명령 줄이 가로로 넘쳐 scroll이 생긴다. (3) composer에 shell(`!`) 모드로 들어가는 단추와 tooltip이 없다. (4) 다른 탭에 갔다 오면 GUI 입력칸에 쳐 둔 글이 사라진다.
- 재료: `project-docs/architecture/harness-gui.md`, `project-docs/architecture/agent-chat.md`, `.claude/skills/harness-gui/SKILL.md`
- 범위 밖: 채팅 화면 가상화, ACP 확장.
- 단위: `gui`(터미널 탭의 GUI 상태), `chat`(채팅 화면 부품). 소유는 brief가 정한다.
- 순서: wave 1에 셋 다. 소유가 겹치지 않는다.
- 사람이 정할 것: 없음.
- 정한 것(agent): i18n catalog `packages/design/i18n/catalog/conversation.ts`는 `composer-shell-button`만 고친다. 다른 task는 있는 key를 쓰거나 보고한다.
- lead가 할 일: merge마다 확인, 다 끝나면 architecture 문서(`harness-gui.md` 탭 이름·draft, `agent-chat.md` shell 단추)와 changelog를 고치고 land한다. 사람에게 해 볼 것 목록을 준다.
