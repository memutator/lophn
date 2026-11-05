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

14. 사람이 실제로 써 보고 찾은 것을 고친다(2026-11-05): 명령이 아무것도 안 함, subagent 화면·todo가 없음, harness 아이콘 대신 글자, omp role 없음, `/` palette 순위·분류·아이콘. 원인과 고칠 것은 점검 보고 `.cache/harness-gui-research/audit-{claude,codex,opencode,omp}.md`와 `ui-reference.md`에 있다. (사람)
15. ACP를 더 넓힌다: 명령 출력 블록, 명령의 출처·별칭·화면 동작(`opens`), subagent(자식 대화, 멈추기, 말 넣기), background task와 멈추기, 사용 한도, 켜고 끄는 상태(Codex plan, omp fast/slow), goal, model role, 숨긴 메시지 되살리기, todo 취소됨, harness vendor 아이콘, tool 줄의 입력·출력 본문(펼치기), plan 승인 카드(plan 내용과 다음 mode). (사람이 방향, agent가 모양)
16. 명령은 데스크톱 앱처럼 셋으로 나눈다: 화면 동작으로 처리(`/model`, `/effort`, `/permissions`, `/plan`, `/rename`, `/rewind`, `/fork`, `/status`, `/usage`, `/context`, `/compact` 등. `/clear`·`/new`는 lophn이면 화면이 새 session을 열고 harness면 adapter가 같은 탭에 새 session을 연다), CLI에 보내고 출력을 그림, TUI 전용은 숨김. `/` palette 순위는 이름 정확 > 이름 앞부분(짧을수록 위) > 별칭 > 이름 조각 > 설명이고, 글자를 치면 묶음 머리 없이 한 목록에 출처 배지를 단다. harness 내장 명령은 vendor 아이콘. (사람이 문제, agent가 레퍼런스로 정함)
17. thread index를 둔다(Codex 데스크톱의 navigation rail): 사람 메시지 4개 이상일 때, 눈금은 사람 메시지 하나, 제목은 그 메시지 첫 줄, hover card는 답 미리보기 2줄과 bookmark, 기존 popover를 쓴다. bookmark는 shell data 쪽 file 하나에 둔다(lophn agent와 harness 공통, session id 기준. harness 대화는 ledger에 없다). (사람, 2026-11-05)
18. omp role은 "이 session만 이 role의 model로"(`/switch @role`)만 넣는다. role 배정(`~/.omp` 설정)은 바꾸지 않는다. (사람, 2026-11-05)
19. 끝났다고 말하기 전에 실제 앱으로 확인한다: Electron 앱을 몰아 기능 목록을 하나씩 해 보고 화면을 찍는 script를 둔다(E2E 꼴, 사람이 허락). 실제 CLI는 싼 model로(Claude haiku, OpenCode `openrouter/deepseek/deepseek-v4.1-flash-1017`, Codex·omp는 그 CLI의 가장 싼 model). 녹화 원본은 worktree 밖 `.cache/harness-gui-recordings/<harness>-v2/`에 둔다(worktree는 merge 뒤 지워진다). (사람, 2026-11-05)

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
| 4 | `acp-more` | ACP 확장(정한 것 15)과 명령 칸(출처, 별칭, `opens`), adapter·source가 따를 계약 |
| 5 | `core-commands` | lophn core가 lophn 명령에 출처·별칭·`opens`를 채운다 |
| 5 | `screen-thread` | 화면의 대화 쪽: info·명령 출력, 명령 세 갈래, `/` palette, vendor 아이콘, tool 본문 펼치기, plan 승인 카드 |
| 5 | `claude-fix` | Claude adapter: 명령 분류와 출력, subagent, todo, background task 멈추기, `/clear`, 사용 한도·goal(있으면), tool 본문, 녹화 다시 |
| 5 | `codex-fix` | Codex adapter: 명령 분류와 출력, `/review`, subagent, plan 상태, 빠진 명령, 사용 한도·goal(있으면), tool 본문, 녹화 다시 |
| 5 | `opencode-fix` | OpenCode adapter: 명령 분류와 출력, undo·redo·new, todo, subagent, 되살리기, 사용 한도·goal(있으면), tool 본문, 녹화 다시 |
| 5 | `omp-fix` | omp adapter: 명령 출력 블록, 도는 중 명령, `!cmd`, role, fast/slow, subagent, 사용 한도·goal(있으면), tool 본문, 녹화 다시 |
| 6 | `screen-dock` | 화면의 composer dock: todo, subagent 보기, background task, 대기열, 켜고 끄기, goal, role, 사용 한도 |
| 7 | `thread-index` | thread index rail, hover card, bookmark 저장(shell data file, IPC) |
| 8 | `app-check` | 실제 앱 확인 script(Electron을 몰아 기능 목록을 해 보고 화면을 찍는다)와 그 기능 목록 |

## lead가 할 일

- 녹화(정한 것 13): wave 3 task가 녹화 script와 scenario를 보고하면 lead가 실제 CLI로 돌려 fixture 재료를 건넨다. 녹화 원본은 저장소 밖(`.cache/`)에 두고 scrub한 것만 commit된다.
- 사람에게 화면을 봐 달라고 한다: wave 2 뒤(탭 toggle과 ACP 화면, lophn agent 포함), wave 3 뒤(CLI 넷), wave 8 `app-check`를 lead가 돌려 기능 목록이 다 된 것을 본 뒤.
- merge마다 `architecture/acp.md`, `harness-gui.md`, `terminal-agent.md`, `agent-chat.md`, `extension.md`를 고친다. 열린 이슈(`project-docs/issues/harness-gui.md`)를 이 계획이 고친 대로 닫는다.
- 다 끝나면: roadmap 단계 8, change-log 열린 판, 계획 폴더 지우기.
