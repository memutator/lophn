# harness-gui-tab: 터미널 탭 안 GUI와 TUI toggle (단계 8 다음 판)

- 목표: lophn 터미널 탭에서 `claude gui`(`codex gui`, `opencode gui`, `omp gui`)를 치면 그 탭이 GUI로 바뀌고, 같은 대화를 GUI와 그 CLI 자신의 TUI 사이에서 오간다. GUI에는 그 CLI에서 되는 채팅 기능을 다 넣는다(기준: Claude·Codex·OpenCode·omp 데스크톱 앱).
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 8과 정한 것 8~12, `project-docs/architecture/harness-gui.md`(첫 판), `acp.md`, `terminal-agent.md`, `agent-chat.md`, `project-docs/issues/harness-gui.md`, lab `/home/pyosechang/projects/harness-lab/`(각 CLI·데스크톱 앱 소스와 notes, happy와 multi-harness, `chat-ui-ux-report.md`, `cli-to-gui-report.md`), 조사 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`(code, claude, codex, opencode, omp, wrappers).
- 범위 밖: (조사 뒤 정한다)

## 정한 것

1. GUI는 lophn 터미널 탭 안에서 연다. 친 그 탭이 GUI로 바뀐다. lophn 밖 터미널에서는 하지 않는다. (사람, 2026-11-05)
2. 탭은 같은 대화를 GUI와 그 CLI의 TUI 사이에서 toggle한다. Claude는 전환 때 process를 끄고 같은 session으로 resume하며 그 전에 modal로 알린다. (사람, 2026-11-05)
3. GUI에는 그 CLI에서 되는 채팅 기능을 다 넣는다: slash 명령, model 고르기, rewind, fork 등. (사람, 2026-11-05)
4. 대상은 Claude Code, Codex, OpenCode, omp다. (사람, 2026-11-05)
5. 대화 밖 session 기능(model 목록·고르기, mode, 명령 목록·실행, rewind, fork, compact, 사용량, session 제목, CLI session id)을 ACP의 입력과 갱신으로 올린다. lophn core는 그 입력을 지금 route로 옮기고(lophn agent의 동작은 그대로), harness adapter는 각 CLI 경계 호출로 옮긴다. 채팅 화면은 lophn agent든 harness든 ACP 하나로 그리고, 첫 판의 `external` 숨김은 source가 그 기능을 가졌는지 보는 검사로 바뀐다. 근거: `acp.md`가 ACP를 "third-party GUI도 같은 입구"로 만들었는데 session 관리를 뺀 것이 harness GUI에서 걸렸다. (사람, 2026-11-05)
6. `claude gui`는 앱 argv와 open intent가 아니라 그 탭의 hook socket(`LPN_TERMINAL_HOOK`)으로 shell main에 닿는다. shell main이 그 key로 탭을 알고, tracker가 탭의 harness·session id·상태를 이미 안다. 첫 판의 data root·argv bug가 생길 자리가 없어진다. (agent, 근거 `.cache/harness-gui-research/code.md` §2)

## task

(조사 보고를 검토한 뒤 쓴다)

## lead가 할 일

(task와 같이 쓴다)
