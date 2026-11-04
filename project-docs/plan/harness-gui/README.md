# harness-gui: `claude gui`, CLI 화면을 대신하는 GUI (단계 8)

- 목표: 터미널에서 `claude gui`(또는 `codex gui`, `opencode gui`)를 치면 그 CLI의 TUI 대신 GUI 창이 뜬다. 뒤에서는 그 CLI 코어가 그대로 돌고, CLI가 내는 이벤트를 ACP로 옮겨 lophn 채팅 화면이 그린다. Claude·Codex 데스크톱이 CLI 코어는 두고 화면만 바꾸는 것과 같은 꼴이다.
- 재료: `project-docs/products/roadmap/agent-platform.md` 단계 8, `/home/pyosechang/projects/harness-lab/cli-to-gui-report.md`(§3·§4: 공식 경계), `/home/pyosechang/projects/harness-lab/chat-ui-ux-report.md`(채팅 화면이 할 일), `project-docs/architecture/acp.md`, `extension.md`.
- 범위 밖: harness agent의 A2A 길(계획 harness-agent의 headless 실행, 그대로 둔다), TUI와 GUI를 한 session에서 오가기, diff 패널·worktree 같은 채팅 밖 기능, 표준 Agent Client Protocol을 lophn ACP로 쓰기(OpenCode에 붙는 쪽에서만 쓴다).

## 정한 것

1. CLI에는 각 CLI의 공식 GUI 경계로 붙는다. Claude Code는 Agent SDK(streaming input), Codex는 `codex app-server`(stdio JSON-RPC), OpenCode는 `opencode acp`(stdio). 사람이 설치하고 로그인한 CLI를 쓴다(보고서 §4). (agent) SDK는 판을 고정해 쓰고, SDK가 끌고 오는 OS별 claude 사본은 root `package.json`의 `overrides`로 빈 package로 바꿔 받지 않는다. 사람 PATH의 `claude`를 넘긴다. (사람, 2026-11-05)
2. GUI는 사람이 쓰는 화면이라 harness의 승인 요청과 질문을 lophn 승인 카드·질문 카드로 묻는다. 글은 흘러나오고 tool 줄은 도는 중부터 보인다. (agent)
3. GUI session은 그 CLI 자신의 session이다. lophn ledger에 기록하지 않고, 친 폴더(cwd)에서 돈다. lophn project가 아니어도 된다. 다시 열기는 `claude gui --resume <id>`처럼 CLI의 resume이다. (사람이 2026-11-04 "CLI 화면을 대체하는 GUI"라고 함)
4. 창은 그 session 하나만 보이는 lophn 창이다. lophn이 꺼져 있으면 띄운다. lophn 터미널 탭에서는 `claude gui`가 바로 되고, 바깥 터미널에서는 `lophn gui claude`로 연다. (agent)
5. 기능 묶음은 extension `harness-gui`(본체와 따로 켠다, 설정 `extensions.harness-gui.enabled`)이고 adapter는 그 안에 있다. extension이 ACP session을 내고 입력을 받는 길은 `ExtensionContext`에 더한다. (사람: 별도 설치, agent: 이름과 길)
6. 첫 판에서 채팅 화면이 받는 입력은 보내기, 멈추기, 실행 중 보내기(steer 또는 queue, CLI가 하는 대로), 승인, 질문 답이다. lophn 전용 기능(model 고르기, rewind, 권한 화면, slash 목록)은 그 창에서 숨긴다. (agent)

## task

| wave | id | 한 줄 |
|---|---|---|
| 1 | `gui-protocol` | extension이 ACP session을 내고 입력을 받는 계약, `lophn gui <harness>`와 open intent, extension `harness-gui` 뼈대 |
| 2 | `gui-claude` | Claude Code adapter(Agent SDK → ACP, ACP 입력 → SDK) |
| 2 | `gui-window` | 그 session 하나를 그리는 창, 채팅 화면의 source, lophn 터미널의 `claude gui` |
| 3 | `gui-codex` | Codex adapter(`codex app-server`) |
| 3 | `gui-opencode` | OpenCode adapter(`opencode acp`) |

## lead가 할 일

- 사람에게 묻는다: adapter parser fixture를 녹화하려면 각 CLI를 실제로 돌려야 한다(실제 model 호출). 허락 전에는 각 CLI 문서와 SDK type으로 만든 fixture로 하고 그렇다고 적는다.
- 사람에게 화면을 한 번 봐 달라고 한다(`claude gui`로 띄운 창).
- merge마다: `architecture/extension.md`, `acp.md`, `terminal-agent.md`(shell 시작 층의 함수)를 고친다. 새 문서 `architecture/harness-gui.md`를 쓰고 registry에 올린다.
- 다 끝나면: `agent-platform.md` 단계 8, change-log 열린 판, 계획 폴더 지우기.
