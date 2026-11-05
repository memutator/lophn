# harness-gui-tab: 터미널 탭 안 GUI와 TUI toggle (단계 8 다음 판)

- 목표: lophn 터미널 탭에서 `claude gui`(`codex gui`, `opencode gui`, `omp gui`)를 치면 그 탭이 GUI로 바뀌고, 같은 대화를 GUI와 그 CLI 자신의 TUI 사이에서 오간다. GUI에는 그 CLI에서 되는 채팅 기능을 다 넣는다(기준: Claude·Codex·OpenCode·omp 데스크톱 앱).
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 8과 정한 것 8~12, `project-docs/architecture/harness-gui.md`(첫 판), `acp.md`, `terminal-agent.md`, `agent-chat.md`, `project-docs/issues/harness-gui.md`, lab `/home/pyosechang/projects/harness-lab/`(각 CLI·데스크톱 앱 소스와 notes, happy와 multi-harness, `chat-ui-ux-report.md`, `cli-to-gui-report.md`), 조사 보고 `/home/pyosechang/projects/lophn/.cache/harness-gui-research/`(code, claude, codex, opencode, omp, wrappers).
- 범위 밖: Home place(터미널이 없다. GUI는 project place의 터미널 탭에서만 된다). lophn 밖 터미널의 `claude gui`(첫 판의 `lophn gui`와 open intent는 지운다). 채팅 밖 기능(diff panel, worktree 관리, file browser). 이미 도는 TUI에 GUI를 live로 붙이기(Claude·omp는 local 길이 없다). OS 앱 바로가기의 `--open-app`.

## 정한 것

1. GUI는 lophn 터미널 탭 안에서 연다. 친 그 탭이 GUI로 바뀐다. lophn 밖 터미널에서는 하지 않는다. (사람, 2026-11-05)
2. 탭은 같은 대화를 GUI와 그 CLI의 TUI 사이에서 toggle한다. Claude는 전환 때 process를 끄고 같은 session으로 resume하며 그 전에 modal로 알린다. (사람, 2026-11-05)
3. GUI에는 그 CLI에서 되는 채팅 기능을 다 넣는다: slash 명령, model 고르기, rewind, fork 등. (사람, 2026-11-05)
4. 대상은 Claude Code, Codex, OpenCode, omp다. (사람, 2026-11-05)
5. 대화 밖 session 기능(model 목록·고르기, mode, 명령 목록·실행, rewind, fork, compact, 사용량, session 제목, CLI session id)을 ACP의 입력과 갱신으로 올린다. lophn core는 그 입력을 지금 route로 옮기고(lophn agent의 동작은 그대로), harness adapter는 각 CLI 경계 호출로 옮긴다. 채팅 화면은 lophn agent든 harness든 ACP 하나로 그리고, 첫 판의 `external` 숨김은 source가 그 기능을 가졌는지 보는 검사로 바뀐다. 근거: `acp.md`가 ACP를 "third-party GUI도 같은 입구"로 만들었는데 session 관리를 뺀 것이 harness GUI에서 걸렸다. (사람, 2026-11-05)
6. `claude gui`는 앱 argv와 open intent가 아니라 그 탭의 hook socket(`LPN_TERMINAL_HOOK`)으로 shell main에 닿는다. shell main이 그 key로 탭을 알고, tracker가 탭의 harness·session id·상태를 이미 안다. 첫 판의 data root·argv bug가 생길 자리가 없어진다. (agent, 근거 `.cache/harness-gui-research/code.md` §2)

7. CLI마다 toggle: Claude와 omp는 한쪽 process를 끝까지 끈 뒤 같은 session id로 다른 쪽을 띄운다(modal, 돌던 turn과 background task는 멈춘다). 다시 띄울 때 그 session의 허락 규칙·권한 mode·model·effort를 flag로 넘긴다. Codex와 OpenCode는 탭 전용 server에 TUI와 GUI가 같이 붙고 toggle은 보이는 쪽만 바꾼다. (agent, 근거 `.cache/harness-gui-research/claude.md` §3, `omp.md` §3, `codex.md` §3, `opencode.md` §3, `wrappers.md` §1)
8. 같이 붙는 탭 전용 server는 `codex gui`·`opencode gui`로 시작한 대화만 쓴다. 그냥 `codex`·`opencode`로 시작한 TUI 대화는 GUI로 처음 넘길 때 한 번 껐다 켠다(modal). 평소 TUI 사용(`--no-daemon`, `--standalone`)은 그대로다. (사람, 2026-11-05)
9. OpenCode는 `opencode acp`를 버리고 데스크톱 앱처럼 OpenCode server API(HTTP+SSE)를 쓴다. 시작할 때 server 판을 보고 녹화한 판과 다르면 창에 알린다. (사람, 2026-11-05)
10. 경계: Claude는 Agent SDK, Codex는 app-server(같이 붙을 때는 unix socket, `codex --remote`), omp는 `omp --mode rpc-ui`(질문 dialog가 켜지는 RPC mode). (agent, 데스크톱 앱들이 쓰는 경계)
11. CLI 환경: login shell의 env 전체를 받는다(PATH만이 아니다. API key가 rc file에 있다). 상위 session 표지는 `packages/shell/terminal-host/env.ts`의 목록으로 지운다. CLI는 process group째 끈다. (agent, `wrappers.md` §3, `omp.md`, `claude.md` §4)
12. 권한: 사람 설정을 따른다. Codex만 사람 설정이 `never`이거나 `danger-full-access`일 때 `on-request`·`workspace-write`로 바꾼다. "이 session 동안"은 그 CLI session 안에서만이고, 영구 규칙이 되는 선택(Codex "비슷한 명령 늘 허락", OpenCode·omp always)은 영구라고 적어 내놓는다. (agent)
13. 녹화: 새 기능과 toggle을 CLI 넷 모두 실제로 녹화해 fixture로 쓴다. 녹화는 lead가 돌린다. (사람, 2026-11-05)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `acp-session` | ACP에 대화 밖 session 기능(정한 것 5)과 source의 capability를 더하고, adapter의 toggle port를 정한다 |
| 2 | `acp-core` | lophn core가 새 ACP 입력·갱신을 지금 route로 채운다 |
| 2 | `acp-screen` | 채팅 화면이 그 기능을 ACP로 그리고 보낸다. `external` 숨김을 capability 검사로 바꾼다 |
| 2 | `tab-gui` | 터미널 탭이 xterm과 채팅 화면을 오간다. `gui` 함수가 hook socket으로 탭에 닿는다. toggle·modal·PTY 쓰기·TUI 끄기, CLI 환경(정한 것 11) |
| 3 | `adapter-claude` | Claude adapter: 기능 전부, toggle(재시작), 첫 판 결함 |
| 3 | `adapter-codex` | Codex adapter: 기능 전부, 탭 전용 app-server와 `--remote`, 첫 판 결함 |
| 3 | `adapter-opencode` | OpenCode adapter를 server API로 다시 짠다: 기능 전부, 탭 전용 server와 `--server` |
| 3 | `gui-cleanup` | 첫 판의 별도 창·open intent·`lophn gui`를 지운다 |
| 3 | `adapter-omp` | omp adapter(새로): RPC mode, 기능 전부, toggle(재시작), omp hook의 session id 갱신 |

## lead가 할 일

- 녹화(정한 것 13): wave 3 task가 녹화 script와 scenario를 보고하면 lead가 실제 CLI로 돌려 fixture 재료를 건넨다. 녹화 원본은 저장소 밖(`.cache/`)에 두고 scrub한 것만 commit된다.
- 사람에게 화면을 봐 달라고 한다: wave 2 뒤(탭 toggle과 ACP 화면, lophn agent 포함), wave 3 뒤(CLI 넷).
- merge마다 `architecture/acp.md`, `harness-gui.md`, `terminal-agent.md`, `agent-chat.md`, `extension.md`를 고친다. 열린 이슈(`project-docs/issues/harness-gui.md`)를 이 계획이 고친 대로 닫는다.
- 다 끝나면: roadmap 단계 8, change-log 열린 판, 계획 폴더 지우기.
