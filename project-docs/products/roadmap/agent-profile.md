# agent profile: agent 정의를 한 장으로

상태: 로드맵 초안. 2026-11-21 사람이 방향을 냈고 planner가 썼다. 정할 것은 모두 정했다(2026-11-21). 사람의 검수 전이다. `(agent)`로 적은 것은 planner가 근거를 적어 정한 것이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/architecture/{agent-definition,coding-agent,harness-gui,terminal-agent}.md`, `project-docs/products/AGENT.md`, `project-docs/products/roadmap/{agent-platform,harness-config,a2a-access,browser-profile,tab-owner}.md`.
조사: harness-lab `_report/agent-profile-report.md`, `_report/codex-multi-agent-report.md`, `_report/cross-harness-orchestration/`, `_report/multi-device/hermes.md`.

## 사람의 말 (원문)

2026-11-21:

> agent profile이 조금 더 직관적이게 되었으면 좋겠다

> agent profile은 무조건적인 동기화는 안 함, 환경이 다르고 지침이 다르고 암튼 다름. 그 기계*workspace에 정의된 agent list를 불러와서 보고 고르는거임 혹은 지침에 미리 고정되어 있다거나

## 왜

- 같은 Claude Code가 세 가지(터미널 TUI, 그 탭의 GUI, headless agent)로 따로 있고 화면마다 다른 것을 가리킨다.
- harness runtime의 agent에는 model과 effort가 가지 않는다. `codex-high`처럼 model과 effort를 정한 worker를 정의로 만들 수 없다.
- 설정 자리가 넷이고 runtime마다 조용히 안 먹는 칸이 있다.

## 지금 코드

- **`avatar`는 그림 칸이다.** `{kind: "character", shape, color}`나 `{kind: "image", image}`이고 기본은 arch·sage다(`packages/protocol/lophn-agent/agent-avatar.ts`). 옛 이름 `profile`은 0.23.126에서 바뀌었다(data step `agents.avatar`).
- **정의의 칸**(`packages/protocol/lophn-agent/agent-values.ts`): handle, name, workspace, avatar, runtime, description, tools, skills, modality, model, skills_off, mcp_off, mcp_servers, apps, remote_apps, extensions, permissions, skip, 본문. 사람만 쓰는 칸은 mcp_servers, apps, remote_apps, extensions, permissions, skip이다. 정의 file은 `<data>/agents/<id>.md`다.
- **runtime과 `harness_config` (완료, 2026-11-23):** 5종 harness(`claude-code`, `codex`, `opencode`, `omp`, `antigravity`) 모두 단일 상주 어댑터(`tab`·`background` 모드)와 `harness_config` (`model`·`options`)를 지원하며, daemon-level `HarnessCatalogManager`가 lazy probe·passive warming·disk cache로 모델·축을 제공하고, 편집기 `Runs on`이 즐겨찾기 연동 runtime 선택과 `HarnessModelField`를 제공한다. 구 일회성 headless 실행기(`claude -p`, `codex exec`, `opencode run`)는 제거했다.
- **runtime마다 안 먹는 칸.** harness runtime은 lophn `model`, skill, tool, MCP, memory를 쓰지 않는다(`harness_config`를 쓴다). custom은 전역·workspace 지침과 memory, `skills_off`를 쓰지 않는다(`architecture/agent-definition.md`).
- **편집기는 7탭이다**: General, Runtime, Instructions, Skills, Memory, Tools, Grants(`packages/shell/renderer/workspace/agents/editor/`).
- **설정 자리가 넷이다**: Settings › Agents(전역 model, 전역 지침, call 정책), workspace의 Agents 탭(workspace 층과 agent 목록), 편집기, session(model, skip).
- **새 session 메뉴**(`packages/shell/renderer/shell/agent-sections.tsx`): lophn agents와 Coding agents 두 줄이다. Coding agents는 터미널 TUI를 연다. 내장 `coding_*` agent는 이 메뉴에 없고 Agents 탭의 Coding agents 절에만 있다.
- **CLI**: `agent.card`, `agent.create`, `agent.update`, `agent.run`(`packages/cli/commands/agent.ts`, `run.ts:115`). list, delete, 복제가 없다.
- **명함**은 program이 정의에서 계산한다. 사람이 쓰는 것은 description(200자) 하나다(`architecture/agent-definition.md` 54).
- **harness의 GUI 연결은 5종이다**(`packages/core/extensions/bundled/harness-gui/`: claude, codex, opencode, omp, antigravity). headless runtime은 3종이다.
- **정의는 기계마다 따로다**(`multi-machine.md`).

## 다른 harness

| 제품 | profile이 가리키는 것 | 담는 것 | 주소 |
|---|---|---|---|
| Paseo | launch preset | provider, model, mode, thinking, 사람이 쓰는 `notes`("When to use"). 지침은 일부러 뺐다 | 없다. 적용하면 복사되고 끊긴다 |
| Codex | role | 지침, model, effort를 덮는 얇은 file. 권한은 넓히지 못한다 | role이 아니라 띄울 때 짓는 자리 이름 |
| Hermes | agent의 집 전체 | 설정, memory, skill, vault, browser profile. 복제할 때 자격은 뺀다 | (기계, profile) 쌍 |
| Mixdog | 역할 9종 | 역할마다 provider, model, effort. 기본 꺼짐 | 역할 이름 |
| T3 Code | 저장하지 않는다 | 위임할 때 driver, model, role을 직접 적는다 | 없다 |

lophn은 handle 하나로 부르고 명함을 program이 계산한다. Paseo는 orchestrator가 preset 값을 손으로 옮겨 적는다.

## 무엇을 만드나

### 정의를 네 묶음으로 보인다

1. **누구**: 이름, avatar, 역할 한 줄.
2. **무엇으로 도나**: runtime, model, effort.
3. **무엇을 보나**: browser profile, workspace 범위, 앱 grant, MCP.
4. **어떻게 일하나**: 지침, skill, memory.

카드 앞면과 편집기의 첫 화면이 이 넷을 한 장에 보인다. 지금 7탭은 이 넷 아래로 다시 묶는다.

### 무엇으로 도나가 harness에도 닿는다

- 정의의 model과 effort를 harness runtime에도 전달한다. harness마다 전달하는 법이 다르므로 adapter가 맡는다.
- runtime이 자기 것을 쓰는 칸(harness의 skill, tool, memory)은 숨기지 않고 "이 runtime은 자기 것을 쓴다"로 보인다.
- runtime 목록은 GUI 연결이 있는 harness까지 넓힌다(`a2a-access.md`).

### preset

- preset은 따로 두지 않는다. 지침이 빈 얇은 agent가 preset이다(`codex-high`).
- 복제를 더한다.
- 띄울 때 model과 effort를 덮을 수 있다(session 층은 이미 있다).

### 기계

- 정의는 기계마다 따로다. 다른 기계의 agent는 그 기계·workspace의 목록과 명함을 읽어 고른다(`architecture/machine-a2a.md`).

## 정한 것

1. agent 정의는 기계 사이에 무조건 맞추지 않는다. 환경과 지침이 기계마다 다르다. (사람, 2026-11-21)
2. agent는 부를 수 있는 agent의 목록과 명함을 볼 수 있어야 한다. 어느 상황에서 누구를 부르는지는 지침만 정하고 program은 검사하지 않는다. (사람, 2026-11-21. `a2a-access.md`)
3. 정의의 그림 칸 이름은 `avatar`다(한 일: browser profile, agent profile과 말이 겹쳐 `profile`에서 바꿨다). (agent)
4. 정의는 한 장 profile로 간다: 누구, 무엇으로 도나, 무엇을 보나, 어떻게 일하나. preset은 따로 두지 않고 지침이 빈 얇은 agent와 복제로 만든다. (agent: 개념이 하나이고, handle 하나로 부르는 것이 정한 것 2의 "목록, 명함, 부르는 길"과 맞는다. 신원과 preset을 나누면 부를 때 둘을 지정해야 한다)
5. 명함에 "언제 쓰나" 칸을 두지 않는다. (agent: 정한 것 2. 명함에 두면 같은 것이 두 곳에 생긴다)
6. harness runtime에는 model과 effort를 전달한다. mode(권한 mode, 계획 mode)는 그 harness의 자기 설정에 둔다. (agent: harness마다 이름과 뜻이 다르다)
7. 기본으로 주는 agent를 늘리지 않는다. (agent: `PRODUCT.md` "미리 범용으로 만들어 두지 않는다")

## 정할 것

없다. 화면 모양(카드 앞면, 편집기)은 wireframe으로 검수받는다.

## 단계

| 단계 | 하는 일 |
|---|---|
| 1 | 카드 앞면, 복제(`avatar` 이름 바꾸기는 끝났다) |
| 2 | harness runtime에 model과 effort 전달 |
| 3 | 편집기를 네 묶음으로 다시 짜기, Coding agents 두 자리를 하나로 |

1은 따로 간다. 2와 3은 `a2a-access.md`의 spike 뒤에 한다: GUI 탭이 팀원이 되면 runtime 목록과 model·effort를 전하는 길이 그 연결로 바뀐다.

## 하지 않는 것

- agent 정의를 기계 사이에 맞추기.
- 대화 중에 agent 바꾸기(`AGENT.md` P3).
- 정체 없는 preset 목록을 따로 두기.
- 명함에 "언제 쓰나" 칸 두기.

## 확인하지 않은 것

- Claude Code, Codex, OpenCode의 headless 명령과 GUI 연결이 model과 effort를 어떤 인자로 받는지는 확인하지 않았다.
