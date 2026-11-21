# a2a access: 사람이 쓰는 coding agent 탭을 팀원으로

상태: 로드맵 초안. 2026-11-21 사람이 방향을 냈고 planner가 썼다. 정할 것은 모두 정했다(2026-11-21). 사람의 검수 전이다. `(agent)`로 적은 것은 planner가 근거를 적어 정한 것이라 검수에서 뒤집을 수 있다. 한 기계 안의 일이다. 기계를 건너는 것은 `a2a-multi-device.md`다.
배경 문서: `project-docs/architecture/{agent-call,coding-agent,harness-gui,terminal-agent,approval,attention,workflow}.md`, `project-docs/products/AGENT.md`, `project-docs/products/roadmap/{agent-surface,agent-platform,tab-owner,agent-profile,a2a-multi-device}.md`.
조사: harness-lab `_report/cross-harness-orchestration/`(T3 Code, Paseo, Orca, Mixdog와 lophn 대조), `_report/codex-multi-agent-report.md`, `_report/antigravity-swarm-orchestration-report.md`.

## 사람의 말 (원문)

2026-11-21:

> a2a , 다른 하네스간 오케스트레이션 및 코디네이터가 조금 더 접근 쉬운 기능이였으면 좋겠다

> workflow나 지침, 프롬프트에서 정할 일이고 agent가 부를 수 있는 길을 마련해놔야지

> 일단 a2a에서 중요한 것은 누구를 부를 수 있는 지에 대한 리스트 , 각 agent에 대한 card는 agent가 볼 수 있어야하고 부를 수 있어야한다. 하지만 그것만으로는 agent가 적재적소에 부를 수 있다는 것이 보장이 안 된다. 그래서 어느 상황에서 누구를 불러야하는 가에 대해서는 지침이 처리해야하는데 프로그램이 결정적으로 처리할 수 없는 부분이다. 그렇다고해서 지침에 누구를 불러야하는 가에 대한 검사를 한다는 것도 아니다. 오로지 지침으로만 처리한다

## 왜

- 사람이 오케스트레이션을 시작하는 길이 lophn agent에게 말로 시키는 것 하나다.
- 사람이 실제로 쓰는 coding agent(터미널 탭의 Claude Code, Codex)는 부를 수도 불릴 수도 없다.
- 다른 harness를 팀원으로 쓰는 길은 화면 없이 도는 headless 3종뿐이고 기본이 꺼져 있다.
- agent끼리 일을 주고받는 동안 사람이 보는 것은 상태가 실시간으로 바뀌지 않는 call card 한 줄이다.

## 지금 코드

- **부르는 명령은 agent만 쓴다.** `calls/send`, `calls/reply`, `team spawn`은 actor agent만 받는다(`packages/cli/commands/call.ts`, `team.ts`). 사람의 터미널에서 도는 coding agent가 부르면 `forbidden`이다(이슈 `cli-help-lists-forbidden-commands`, open).
- **agent가 부를 수 있는 것을 읽는 길은 넷이다.** system prompt의 "Agents you can call"(정의된 agent의 handle과 description, `packages/core/agent-workspaces/workspace/workspace-info.ts`), `session.list`(call을 보낼 수 있는 열린 session), `agent.card`(명함 하나, `callable`이 붙는다), `team.read`(부모, 형제, 자식). 정의된 agent의 목록을 명령으로 다시 읽는 길은 없다. 터미널과 GUI 탭의 coding agent는 어느 목록에도 없다.
- **지침은 스스로 나누라고 한다.** "When work splits into parts that can run at the same time, open team members with `lophn team spawn`"(`packages/core/agent-workspaces/prompts/prompts.ts:62`).
- **다른 harness의 팀원은 headless 3종이다.** `HARNESS_RUNTIMES = ["claude-code", "codex", "opencode"]`(`packages/protocol/lophn-agent/agent-values.ts:151`)이고 `claude -p`, `codex exec`, `opencode run`으로 돈다. 설정 `extensions.harness.enabled`(`packages/core/config/shell-settings.ts:548`)를 사람이 켜야 하고 기본은 꺼져 있다.
- **터미널 탭의 coding agent는 lophn session이 아니다.** lophn은 상태(icon, 점, 알림)만 보인다(`architecture/terminal-agent.md`). harness id 목록은 `packages/protocol/coding-agent/harness-id.ts`다.
- **GUI 보기는 5종이다.** claude, codex, opencode, omp, antigravity(`packages/core/extensions/bundled/harness-gui/`). 그 CLI 자신의 session이고 lophn ledger에 없다(`architecture/harness-gui.md`).
- **call card**(`packages/shell/renderer/conversation/thread/call-block.tsx`)의 제목은 "Asked", "Handoff to", "Working with"다. 상태는 thread를 읽을 때와 Cancel 뒤에만 다시 읽는다.
- **team의 상한**은 팀원 8, 깊이 2다(`packages/protocol/lophn-agent/team.ts`). 자식의 질문과 승인은 부모에게 먼저 간다(`architecture/agent-call.md` 33).
- **reply마다 부모 turn이 깨어난다.** 묶는 장치가 없다(2026-11-08에 미뤘다: `agent-surface.md` "하지 않는 것").
- **`@agent`가 없다.** `at-mention.md`는 file, 폴더, CLI 항목만 다룬다.
- **agent끼리의 call은 사람 화면에 따로 보이지 않는다**(`PRODUCT.md` §4).
- **이미 가진 것**: 자식 승인을 부모가 한 번만 대신하고 설정 변경은 사람만 하는 절충, 한 탭 안의 TUI와 GUI 전환, 여러 기계의 대기를 모으는 Inbox.

## 다른 harness

| | T3 Code | Paseo | Orca | Codex |
|---|---|---|---|---|
| 팀원 | 구조화 연결의 harness 11종 | 구조화 연결 | PTY 45종과 구조화 4계열 | 자기 thread |
| 부르는 길 | HTTP MCP | HTTP MCP와 native tool | CLI와 skill | 내장 tool |
| 사람의 진입 | 말로 | 호스트 설정, profile의 "When to use" | skill 설치, `/orchestration` 예시 | 말로. 기본은 시킬 때만 |
| 자식 보이기 | 숨기고 부모 한 줄에 올린다 | composer 위 track | sidebar tree와 칸반 | thread 사이 전환 |
| 결과 전달 | 묶어서 부모를 한 번 깨운다 | 2초 창으로 묶는다 | 한 줄 pointer를 넣고 당기게 한다 | mail로 쌓고 부모가 기다린다 |
| 승인 | 사람만 | 부모가 대신한다 | 받는 쪽 화면 | 자식이 부모 정책을 물려받는다 |
| 폴더 격리 | worktree | worktree | worktree | 공유 |

Codex 최신 모델은 session 하나가 자기 subagent를 스스로 연다. Antigravity와 Codex는 팀 공유 board를 실험 중이다.

## 무엇을 만드나

### 목록, 명함, 부르는 길

program이 내는 것은 이 셋이다.

- 부를 수 있는 것은 모두 목록에 있고, 목록에 있는 것은 모두 명함을 읽고 부를 수 있다.
- 목록은 정의된 agent와 열린 session을 같이 낸다. 팀원이 된 harness 탭의 session도 든다.
- agent는 목록을 명령으로 다시 읽는다. system prompt의 줄에만 기대지 않는다.
- 어느 상황에서 누구를 부르는지는 지침이 정한다. program은 고르지 않고, 지침이 가리키는 것이 맞는지 검사하지도 않는다.

### 팀원은 탭이다

- GUI 연결이 있는 harness의 session이 lophn session이 된다. call을 받고 보낸다. 사람이 평소 쓰던 그 화면에 call이 들어온다.
- 탭 하나가 팀원 하나다. 사람은 그 탭에서 지켜보고 끼어든다.
- headless 길은 걷어낸다. 그 위에서 돌던 것(job의 무인 실행)은 같은 연결로 옮긴다.

### 범위

- lophn 팀은 harness 사이를 잇는다. harness 안의 병렬은 그 harness의 subagent가 한다. 그 안의 subagent는 지금처럼 그 탭 안에서 본다.
- lophn 자체 agent의 병렬은 지금처럼 `team spawn`이다.

### 사람이 시작하는 길

- composer의 `@handle`: 그 agent를 부른다. 사람이 직접 고르는 길이다.
- agent가 스스로 누구를 부를지는 지침이 정하고 program은 switch를 두지 않는다.

### 전달

- call, reply, 자식의 ask, 사람이 팀원에게 한 말의 알림을 mail 하나로 맞춘다. 깨우는 mail과 쌓기만 하는 mail이 있다.
- 자식의 결과는 쌓이기만 하고 부모가 기다린다. reply마다 turn이 열리지 않는다.
- 기계 사이 mail(`a2a-multi-device.md`)과 같은 꼴이다.

### 보이는 것

- 팀 tree는 sidebar의 desk 아래에 선다(`architecture/workspace-layout.md` "탭의 주인").
- call card의 상태가 실시간으로 바뀐다.
- 사람이 팀원 탭에 직접 한 말은 부모에게 알린다.

## 정한 것

1. program이 내는 것은 부를 수 있는 목록, agent마다의 명함, 부르는 길이다. agent는 목록과 명함을 볼 수 있고 부를 수 있어야 한다. (사람, 2026-11-21)
2. 어느 상황에서 누구를 부르는지는 지침만 정한다. program이 결정적으로 할 수 없는 일이다. program은 고르지 않고, 지침이 가리키는 것이 맞는지 검사하지도 않는다. (사람, 2026-11-21)
3. 2026-11-08에 정한 팀의 뼈대는 그대로다: spawn tree, 규칙 세 줄, 자식의 물음은 부모가 먼저 답한다(`agent-surface.md` 정한 것 1·2·11).
4. lophn 팀은 harness 사이를 잇는다. harness 안의 병렬은 그 harness의 subagent가 하고, lophn은 worker 여럿과 worktree를 관리하지 않는다. (agent: `PRODUCT.md` "coding agent를 만들지 않는다"와 사람이 2026-11-08·09에 정한 "worktree는 lophn이 하지 않는다"의 적용)
5. 사람의 진입은 composer의 `@handle`로 시작한다. desk의 "팀원 추가"는 요구가 생기면 한다. (agent: 가장 단순한 길이고 2026-11-08의 "사람이 손으로 session을 팀에 넣기는 하지 않는다"가 그대로 선다)
6. 내장 지침의 위임 문장("나눌 수 있으면 `team spawn`")은 그대로 둔다. (agent: 지침의 일이고 사람과 workflow의 지침이 그 위에 선다)
7. 사람이 팀원 탭에 직접 말하는 것은 지금처럼 된다. 전달을 mail로 맞출 때 부모에게 알린다. (agent)
8. board는 넣지 않는다. (agent: 요구가 없다. mail 위에 나중에 얹을 수 있다)
9. `PRODUCT.md` §4의 "agent끼리 주고받는 call처럼 agent가 만들고 읽는 것은 사람 화면에 따로 보이지 않는다"를 고친다: 사람이 맡긴 일이 누구에게 가 있는지는 보이고 call의 본문은 따로 보이지 않는다. (agent: 사람이 2026-11-21에 정한 "탭이 agent 사이의 책임을 보여야 한다"의 적용)
10. **평소 쓰는 coding agent의 GUI 탭이 팀원이 된다.** Claude Code, Codex, OpenCode, omp, Antigravity의 session이 lophn session으로 call을 받고 보낸다. 화면 없이 도는 headless 길은 걷어낸다. 먼저 spike를 하고, 막히면 headless를 두고 켜기만 쉽게 한다. (사람, 2026-11-21) `AGENT.md` P6("coding agent는 lophn 밖의 harness다")를 고친다.

## 정할 것

없다.

## 단계

| 단계 | 하는 일 |
|---|---|
| 0 | spike: GUI session에 agent 자격을 주는 법, 창 없는 무인 실행이 그 연결로 도는지 |
| 1 | 전달을 mail 하나로, call card 실시간 상태, 부를 수 있는 목록을 명령으로 읽기 |
| 2 | GUI session을 lophn session으로: call 받기와 보내기, 목록에 들기 |
| 3 | 진입: composer의 `@handle` |
| 4 | headless 길 걷어내기 |

1과 3은 spike와 상관없이 간다. 0이 2와 4를 정한다: spike에서 막히면 2와 4를 하지 않고 headless 설정을 기본으로 켠다.

### 진행 (2026-11-21, branch `feat/gui-member`)

- 0은 됐다(가능, 제한은 승인 card와 restart 탭의 TUI). 2는 코드로 됐다. 설계는 `architecture/harness-gui.md` "팀원".
  - project의 GUI 탭 다섯(Claude Code, Codex, OpenCode, omp, Antigravity)이 lophn 팀원 session이다. call을 받아 그 탭의 turn으로 돌고 마지막 글로 답하며, turn 자격 file로 자기 이름으로 부른다.
  - 탭이 없는 팀원과 project에서 부른 내장 coding agent는 core가 그 project에 탭을 열어 받는다. 답 못 한 call은 보낸 쪽에 실패로 돌아간다.
  - `session list`·`team read`에 탭의 상태로 서고 화면에는 터미널 탭으로만 보인다.
  - 실제 CLI로는 아직 돌려 보지 않았다. 사람이 Claude Code와 Codex 탭으로 해 본 뒤 4로 간다.
- 4(headless 걷어내기)에 남은 것: extension `harness`와 `harness/take|start_turn|record|finish_turn|set_external_id`, headless 명령 표, 설정 `extensions.harness.enabled`, 그 gating을 지운다. Home·앱 workspace의 coding agent, 사람이 정의한 harness agent, 사람이 Agent 탭으로 연 coding session을 어디서 돌릴지 정한다(GUI 탭은 지금 project에만 선다). `harness_gui`는 늘 켜진 값이 되어 지운다. 팀원 session을 끝내는 길(사람이 coding session을 목록에서 지우기)이 아직 없다.

## 하지 않는 것

- lophn이 worker 여럿과 worktree를 관리하기.
- desk의 "팀원 추가", 팀 공유 board. 요구가 생기면 한다.
- 터미널에 글을 쳐 넣어 TUI를 팀원으로 만들기.
- 자식 답을 묶는 별도 장치. mail로 푼다.
- agent끼리 도는 turn에 끼어들기.
- program이 일을 나누기. 나누는 것은 coordinator다(`agent-surface.md` 정한 것 8).
- program이 누구를 부를지 고르기, 지침이 가리키는 agent가 맞는지 검사하기, 위임 강도를 정하는 switch.

## 확인하지 않은 것

- agent 자격은 지금 turn마다 살고 죽는다(`architecture/coding-agent.md`). 상주하는 GUI session에는 session 수명으로 줘야 할 수 있다.
- 창 없는 무인 job이 GUI 연결로 도는지.
- call이나 `team spawn`이 연 session 탭을 사람이 실제 창에서 본 적이 없다(`architecture/agent-call.md` "열린 것").
