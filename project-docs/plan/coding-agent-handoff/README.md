# coding-agent-handoff

- 목표: lophn agent가 사람이 즐겨찾기한 coding agent에게 일을 넘긴다. 사람이 이어서 만질 handoff는 그 project의 새 터미널 탭에 TUI로 열고, 사람 손이 필요 없는 일회성 일은 headless로 보낸다. agent 정의 file 없이 된다.
- 재료: `project-docs/architecture/coding-agent.md`, `project-docs/architecture/agent-definition.md`, `project-docs/architecture/workspace-layout.md`("agent가 연 탭"), `project-docs/architecture/agent-call.md`, `project-docs/issues/opencode-agent-uses-user-permissions.yaml`
- 범위 밖: harness-gui(터미널 탭의 GUI)의 권한 mode, omp headless adapter, 사람이 연 터미널에 메시지 넣기, TUI 결과를 lophn에 돌려받기

## 정한 것

- **즐겨찾기 coding agent가 내장 agent다.** `shell.coding_agents.favorites` 가운데 headless runtime이 있는 것(claude → `claude-code`, codex, opencode)이 전역 내장 agent다. id `coding_<harness id>`, handle은 harness id(`claude`, `codex`, `opencode`), name은 adapter label. `extensions.harness.enabled`가 켜지고 즐겨찾기에 있을 때만 목록·명함·handle 풀기에 보인다. id로 읽기(열린 session, harness host의 `agents/read`)는 늘 된다. (사람: "agent definition 없어도 즐겨찾기한 agent들 쓸 수 있게")
- 내장 coding agent는 lophn처럼 file이 없으면 기본 정의다. 사람이 Agents 탭에서 고치면 file이 생긴다. handle·runtime·범위는 잠기고 Delete가 없다. 세 handle은 예약이다. (agent: lophn 내장 정의와 같은 길, data 모양이 안 바뀌어 migration 없음)
- **두 길을 다 둔다.** handoff(사람이 이어서 만질 일)는 `lophn tab open --coding <harness> --handoff <글>`로 TUI 탭, 일회성 일은 `team spawn`·`call send`로 headless다. 지침(project prompt, 내장 skill `lophn-agent`, CLI help)이 이 기준을 말한다. (사람)
- TUI handoff 탭은 사람의 터미널이다(`+` 메뉴의 즐겨찾기와 같은 명령, 사람이 고친 명령 포함). lophn session을 만들지 않고 hold도 없다. project workspace의 agent만 연다. 대상은 즐겨찾기 가운데 adapter가 첫 prompt 인자를 아는 것이다. (agent: 사람의 터미널과 같아야 사람이 이어서 쓴다)
- **handoff 글은 shell이 해석하지 않는다.** core가 글을 `<data root>/handoffs/<tab>.md`(0600)에 쓰고, 터미널에는 lophn이 정한 고정 글과 그 path만 친다("Read the handoff at <path> and continue …"). (agent: agent가 쓴 글을 shell마다 quoting하지 않는다)
- **permission mode는 lophn이 정하지 않는다.** headless에서 Claude Code `--permission-mode acceptEdits`, Codex `-s workspace-write`(resume의 `sandbox_mode`)를 뺀다. 사람의 CLI 기본 설정대로 돈다. lophn을 부르는 길(`--allowed-tools "Bash(lophn *)"`, Codex `network_access=true`)과 정의 deny 옮기기는 남긴다. (사람: "permission mode는 사용자가 기본 세팅 해놓은대로")
- `agent.card`의 not_found는 handle을 모른다고 말하고 부를 수 있는 handle을 싣는다. `lophn agent create` help가 harness runtime을 적는다. 왼쪽 sidebar에 Agents 입구를 되살린다(Jobs 아래 줄. Settings는 작업 표시줄이 켜지면 sidebar에서 빠진다). (agent)

## task

| wave | id | 선행 | 한 줄 |
|---|---|---|---|
| 1 | `coding-builtin` | 없음 | 내장 coding agent, headless 권한 flag 빼기, agent.card 메시지, agent create help, 편집기 잠금 |
| 1 | `agents-entry` | 없음 | 왼쪽 sidebar의 Agents 입구 |
| 2 | `tui-handoff` | `coding-builtin` | `tab open --coding --handoff`, handoff file, 터미널 탭 열기, 지침 |

`tui-handoff`는 계획 browser-vault의 `vault-request`와 file이 겹친다(host-queue protocol·handler, `lophn-agent` skill). `status.py ready`가 거른다.

## lead가 할 일

- merge 뒤: `project-docs/flows/`(agent-card-read, host-tab-open 옆 새 flow, agent-tab-request, cli `tab.open`, 새 test file), `architecture/coding-agent.md`(결정 22와 headless 명령, 내장 coding agent, TUI handoff), `architecture/agent-definition.md`(내장 coding agent), `architecture/workspace-layout.md`(handoff 탭, sidebar Agents).
- land 전: 이슈 `opencode-agent-uses-user-permissions` 닫기, root `version` PATCH와 change-log 항목.
