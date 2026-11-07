# harness-gui-dogfood2

- 목표: 사람이 써 보고 말한 셋을 고친다. (1) 답 안의 code block이 가로로 넘쳐 scroll이 생긴다. (2) `!`로 시작하는 code block에 복사 단추 왼쪽 bash 단추를 두어 누르면 그 명령이 composer의 shell 모드로 들어가게 한다. composer에 넣은 shell 토글 단추는 사람이 원한 것이 아니라 뺀다. (3) workspace에 갔다 오면 GUI 탭 이름이 잠깐 터미널 경로로 보였다 돌아온다.
- 재료: `project-docs/architecture/agent-chat.md`, `project-docs/architecture/harness-gui.md`, `.claude/skills/harness-gui/SKILL.md`
- 범위 밖: streaming이 끝에 한꺼번에 나오는 문제(측정이 먼저다).
- 순서: wave 1에 둘. 소유가 겹치지 않는다.
- 사람이 정할 것: 없음.
- lead가 할 일: merge, 문서(`agent-chat.md` shell mode·code block, `harness-gui.md` 탭 이름), changelog, land.
