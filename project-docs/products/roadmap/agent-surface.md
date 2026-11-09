# agent surface: agent가 팀을 늘리고 탭을 연다

상태: 끝남. 단계 0은 계획 agent-scope, 단계 1~3은 계획 agent-surface, 팀 물음(정한 것 11~15)은 계획 agent-team이 만들었다(2026-11-08, changelog 0.22.0). 2026-11-08 사람이 방향을 냈고 planner가 정리했다.
배경 문서: `project-docs/architecture/{workspace-layout,agent-call,agent-definition,acp,coding-agent,harness-gui,browser-tab,terminal-agent}.md`, `project-docs/products/roadmap/{agent-platform,browser-tab,standalone-core}.md`. 짝 로드맵: `tool-extension.md`(같은 host queue를 쓴다).

## 사람의 말 (원문)

2026-11-08:

> 지금 desk, group, pane, tab 등의 개념이 단순하게 layout의 개념만이 아니라 agent 협업에도 적용되었으면 함
> agent가 lophn shell layout에서 tab을 열고 배치하고 이러한 기능들이 필요한데 lophn agent가 tui를 열 수 있어야하기도하고 이후에는 browse-use 같은 기능도 들어올 것이기 때문에
> (browse use 로드맵은 이번 목표는 아님, 브라우즈를 띄울 수 있고 알 수 있는 그런 경로만 둔다는 말)

> 막 탭을 열고 같은 그룹 간의 agent끼리 연락처를 제공하고 소통하고 새로 또 스폰하고 하는 것들이 acp, a2a protocol 기반으로 동작했으면 좋겠어, 필요한만큼 최소한으로 넓혀도 됨

> (협업 단위) desk 인데 이게 경우에 따라서 group 단위도 될 수 있을 거 같은데 … 예를 들어서 병렬 세션은 pane에다 multi tab에다 둘 수 있고 순차적 단계는 group으로 추상화해서 각 그룹의 cordinator끼리 desk 위치의 cordinator끼리 대화한다거나

> 이게 단순하게 call만 하는 게 추가로 동적으로 늘릴 수도 있어야해 작업 도중에 아 번역팀 너무 느린데? 양이 많으니까 병렬 세션 추가로 연다던가

사람이 확인한 것: ACP·A2A는 표준이 아니라 lophn 규격을 넓힌다. agent는 탭을 열고 배치하고 browser 상태를 읽는 데까지이고 앱 화면을 읽거나 조작하지 않는다. TUI는 harness agent session을 TUI로 여는 것이다. 팀 구조는 아래 spawn tree다(2026-11-08).

## 왜

- agent끼리 일을 나눌 수는 있다(`call.send`, `to: {agent, workspace}`가 새 session을 연다). 하지만 누가 누구를 위해 열렸는지 기록이 없어 팀이 없다. 연락처는 workspace 전체(`session list`)라 열 개 넘게 돌면 누구에게 말할지 모른다. 작업 중에 일손을 늘리고 줄이는 규칙도 없다.
- agent가 연 동료, TUI, browser를 사람이 보려면 사람이 직접 찾아 열어야 한다. agent는 탭을 열 길이 없다.

## 지금 코드

layout (`project-docs/architecture/workspace-layout.md`)
- workspace(home, project, app)마다 layout file 하나 `<data>/shell/workspaces/<workspace>.json`(`schema_version: 10`). desk는 그 안의 이름 있는 layout이다(`_default`, `desk-<time>-<n>`, workflow desk는 workflow 이름). desk는 `tabs[]`, `selected`, `groups[]`, `floats[]`, `detached[]`를 갖는다.
- group은 tab strip의 탭 2~4개를 한 칸에 나눠 보이는 split tree다(`GroupNode = {tab} | {dir, ratio, a, b}`). 옛 6칸 pane tree는 없다.
- 탭 kind는 `packages/shell/main/workspace/kinds/registry.ts`(agent, terminal, browser, artifact 등 14개).
- layout을 바꾸는 것은 renderer뿐이다(`renderer/shell/desk-model.ts`, 저장은 IPC `shell:workspace-layout-save`). core는 layout을 모른다.
- 바깥에서 탭을 여는 길은 shell 안쪽 push뿐이다: `$BROWSER` bridge(`shell:terminal-bridge-open`, renderer `useBridgeOpenRequests`가 1500 ms 안에 ack), browser popup, toast(`shell:notice-open`). 놓는 자리는 `renderer/workspace/open-policy.ts`의 `openAt()`이 정한다.

agent 사이 (`project-docs/architecture/agent-call.md`)
- `call.send {to, reply, body, refs, dedup}`(`packages/protocol/lophn-agent/calls.ts:184-203`, actor agent만). `to: {agent, workspace}`면 Router가 `SessionDirectory.open`으로 새 session을 연다(`packages/core/lophn-agent/workspaces/directory.ts`). 연 쪽을 session에 남기지 않는다.
- 판정은 call policy `mayCall`(`packages/protocol/lophn-agent/call-policy.ts`: agent 쌍 → workspace 쌍 → 같은 workspace 허용 → private → 기본 허용)과 명함의 modality·replies다.
- 연락처는 `session list`(그 session이 call을 보낼 수 있는 열린 session)와 `agent card`다. prompt에는 "Agents you can call"(정의 목록)이 실린다.
- agent가 session을 끝내는 길은 없다(Compact·archive는 사람과 machine).

TUI와 browser
- harness agent(`runtime: claude-code|codex|opencode`)는 extension `harness`가 turn마다 headless로 돌린다(`project-docs/architecture/coding-agent.md`의 harness agent). session에 CLI session id(`sessions.harness_session`)가 있어 resume할 수 있지만, 그 session을 TUI로 여는 화면은 없다.
- 터미널 탭은 shell main의 `terminal-host` process가 PTY를 띄운다. core는 터미널을 모른다(`architecture/terminal-agent.md`).
- browser 탭은 `<webview>`이고 url·title·loading·favicon이 main → renderer로 push된다(`architecture/browser-tab.md`). agent나 core가 읽는 길은 없다. `roadmap/browser-tab.md`의 하지 않는 것이 agent의 browser 보기·조작을 뺐다(뒤에 계획 `browser-use`가 열었다).

## 무엇을 만드나

### 팀 = spawn tree

```
desk coordinator (root, 사람이 연 session)
 ├─ 번역 coordinator ── 번역 a, 번역 b, 번역 c   (병렬. 느리면 coordinator가 더 연다)
 └─ 검수 coordinator ── 검수 a                   (번역이 끝난 뒤 root가 연다)
```

- `team spawn`(새 명령)으로 연 session은 연 session의 자식이다. core는 session에 `spawned_by`를 남긴다. 자식이 있는 session이 그 무리의 coordinator다.
- 팀은 root가 있는 desk에 그린다. 같은 workspace의 자식은 같은 desk에서 부모 옆 group에 열리고(4개를 넘으면 옆 탭), 다른 workspace의 자식은 tree에는 있지만 그 desk에는 그리지 않는다(agent 탭은 자기 workspace 창에만 그려진다).
- layout은 보이는 방식일 뿐이다. 사람이 탭을 끌어 옮겨도 팀은 바뀌지 않는다.

### 규칙 세 줄

1. **spawn은 내 밑으로만.** 어느 session이든 자기 자식을 연다. worker는 형제를 늘리지 못하고 부모에게 call로 청한다.
2. **spawn된 session의 call은 부모, 형제, 내 밑 전체로만.** 위에서는 아래 어디든 닿고 아래에서는 한 칸 위까지다. workspace 사이 규칙(`mayCall`, private)은 그 위에 그대로 겹친다. 사람의 메시지와 팀 밖에서 팀원에게 오는 call은 지금 규칙 그대로다.
3. **끝내기도 내 밑만.** coordinator가 자식(과 그 밑)을 멈추고 닫는다. 일이 줄면 scale down이다.

### 연락처와 소통 (A2A 확장)

- `team read`: 부모, 형제, 자식의 handle·description·runtime·상태. 명함 전체는 지금처럼 `agent card`.
- 연락처는 system prompt에 싣지 않는다. 부모·형제·자식이 늘고 줄면 notice `team_changed`(고정 글)만 대화 끝에 간다. `tools_changed`처럼 turn을 준비할 때 앞에 본 팀과 비교해 붙이므로 그 session의 다음 turn에 닿는다. 쉬던 session을 깨우지 않는다.
- 소통은 지금 `call.send|reply|cancel` 그대로다. 새 call 꼴을 만들지 않는다.

### 탭 열기

- `tab open`: 대상은 셋이다.
  - **agent session**: 팀원(또는 자기)의 대화 탭. 화면은 지금 ACP 그대로다.
  - **harness agent의 TUI**: runtime이 harness인 session을 터미널 탭에서 그 CLI의 resume 명령으로 연다(cwd는 session workspace 폴더, `coding-agent.md`의 headless와 같은 자리).
  - **browser**: `{url}`. 
- 놓는 자리는 `beside | group | float` 힌트 하나이고 실제 자리는 `openAt()`이 정한다. agent가 연 탭은 focus를 뺏지 않는다.
- agent는 자기가 연 탭만 닫는다. 옮기고 크기를 바꾸는 것은 사람이다.
- `browser read {tab}`: url, title, loading. page 내용·screenshot·조작은 계획 browser-use가 더했다(changelog 0.22.0).

### host queue

- core → shell 요청 통로가 없다. harness queue(`harness/take` → `start_turn`, extension `harness`가 1초마다 가져감)와 같은 꼴로 core 메모리의 host queue 하나를 새로 두고, shell main이 가져가 그 workspace를 보이는 창에 push한다(`$BROWSER` bridge와 같은 push·ack). `tool-extension.md`의 extension tool 호출도 같은 queue를 쓴다. harness queue는 session마다 turn 입력을 담는 run-loop queue라 요청 종류를 실을 자리가 없어 그대로 둔다(계획 agent-surface가 확인, 2026-11-08). 창 IPC 직통이나 새 socket push 같은 다른 통로는 만들지 않는다.
- shell이 붙어 있지 않거나(standalone core) 그 workspace를 보이는 창이 없으면 요청은 대기한다. agent는 기다리지 않는다(`tab open`은 접수만 답한다). core가 다시 뜨면 대기 요청은 사라진다.
- browser 상태는 agent가 연 탭만 renderer가 core에 알려 둔다. 그 탭이 없으면 `browser read`는 `not_found`다.

## 정한 것

1. 팀 구조는 spawn tree이고 협업 단위(그리는 자리)는 desk다. layout group은 배치일 뿐 팀이 아니다. (사람, 2026-11-08: 단계는 group, 단계의 coordinator끼리 desk coordinator와 대화하는 모양을 tree가 그대로 낸다)
2. 규칙은 위 세 줄이다. (사람, 2026-11-08)
3. ACP·A2A는 lophn 규격을 넓힌다(`agent-platform.md` 정한 것 1 유지). A2A에 `team spawn`·`team read`와 `spawned_by`를, 탭은 `tab open`·`browser read` 명령으로 더한다. ACP는 바꾸지 않는다. (사람이 표준 아님을 확인, 2026-11-08)
4. `agent-platform.md`의 "agent도 client는 뺀다"는 탭을 열고 배치하고 agent가 연 browser 탭의 상태를 읽는 데까지만 연다. 앱 화면 읽기·조작은 계속 없다. (사람, 2026-11-08)
5. TUI는 harness agent session을 TUI로 여는 것이다. 아무 명령을 터미널에 띄우는 것은 하지 않는다. (사람, 2026-11-08)
6. spawn은 `team spawn`으로만 팀을 만든다. 지금 `call.send`의 `to: {agent, workspace}` 새 session은 팀 밖(`spawned_by` 없음)으로 그대로 둔다. (agent) home lophn이 project lophn에 넘기는 지금 흐름이 갑자기 팀 규칙(밖으로 call 못 함)에 묶이지 않게.
7. 상한: desk당 열린 팀원 수와 tree 깊이를 설정(`lophn-agent.team`, 기본 `max_members: 8`, `max_depth: 2`(root 0))으로 두고 넘으면 `conflict`다. 거절 글은 "직접 하거나 부모에게 청하라"를 담는다. core는 desk를 모르므로 팀원 수는 root session 아래 열린 자손 수로 센다. desk는 root가 있는 자리라 같은 뜻이다. (agent) agent 실수로 spawn이 되풀이되면 비용이 터진다(AGENTS.md "속도"). 기본값은 agent-team에서 3·16에서 2·8로 내렸다. 사람이 든 예(root → 번역 coordinator → 번역 셋)가 깊이 2다. (agent)
8. 일 나누기는 program이 하지 않는다. 새 worker에게 무엇을 줄지는 coordinator가 call 본문으로 정한다. (agent) workflow의 "program은 기록하고 전달만"과 같다.
9. 연락처는 prompt가 아니라 `team read`로 읽고 바뀌면 notice만 간다. (agent) 작업 중 팀원이 늘고 줄 때마다 prompt cache가 깨지지 않게(`architecture/agent-definition.md`의 prompt cache 규칙, 같은 재료는 같은 bytes).
10. TUI 탭이 열린 동안 그 session의 headless turn은 시작하지 않고 입력은 queue에 남는다(call은 accepted). TUI가 끝나면 이어 돈다. TUI에서 한 turn은 lophn 기록에 남지 않고, 다음 headless turn이 같은 CLI session을 resume하므로 agent는 기억한다. (agent) 한 CLI session에 두 process가 동시에 쓰지 않게. 기록에 남기기는 쓰는 곳이 생기면 한다.

11. spawn된 session의 `ask`(질문)와 shell 규칙 `ask`(승인)는 사람이 아니라 부모에게 가는 result call이다. 부모가 답하거나, 판단할 수 없으면 자기 `ask`를 써서 위로 올린다. root에서 사람에게 닿는다. 올리는 장치는 따로 없다. (사람, 2026-11-08: "cordinator든 leader든 걔가 먼저 답하고 걔 판단으로 안 되겠음 걔가 사용자한테 올리고")
12. attended와 unattended는 같은 길이다. unattended 사슬의 root가 받은 물음에는 root의 `ask`가 `unattended`를 돌려주고 root가 스스로 정한다. skip session의 shell `ask`는 지금처럼 그냥 돌고 부모에게 가지 않는다. 질문은 skip이어도 부모에게 간다. (agent, skip은 planner 2026-11-08) skip은 사람이 그 session에 정한 "묻지 마"라서 부모가 뒤집지 않는다.
13. 부모의 승인 답은 이번 한 번의 허락·거절뿐이고 글이 아니라 구조(`call reply --allow|--reject`)로 받는다. 규칙 더하기(`always`)는 사람만 하고 `deny`는 누구도 풀지 못한다. 자식 탭에는 승인 카드가 뜨지 않는다. 팀 밖 session의 `ask`는 지금 그대로다. (agent)
14. `team spawn`의 `--reply` 기본은 `result`이고 `team read`는 팀원마다 답하지 않은 call을 보인다. lophn 자식이 `call reply`를 잊으면 부모가 깨지 않아서다. (agent)
15. 팀 지시문(spawn한 뒤 turn을 끝낸다, poll하지 않는다, worker면 직접 한다, 모르면 `ask`)은 system prompt에 넣지 않고 `team spawn` help, 자식이 받는 첫 call의 고정 글, skill `lophn-agent`에 둔다. prompt cache를 깨지 않으려는 것이다. (agent)

## 단계

| 단계 | 하는 일 |
|---|---|
| 0 | agent definition 정리: Agents 목록·카드·편집기에 범위(전역 / `<name> · project` / `<name> · app`) 표시, workspace의 Agents 탭은 전역과 그 workspace 범위만, 새 agent 범위 고르기(기본은 연 workspace, home이면 전역. core user actor는 이미 `workspace`를 받는다), 카드 runtime이 harness를 `lophn`으로 보이는 bug(`renderer/workspace/agents/agent-card.tsx`), 문서 어긋남(`agent-definition.md`의 앱 삭제가 범위 agent를 지운다, 앱 tool이 `tools[]`에 있다는 옛 문장, `agent-call.md`의 지운 `coding_agent`) |
| 1 | host queue(harness queue와 같은 꼴로 새로)와 `tab open`(agent session, browser), `browser read` |
| 2 | `spawned_by`(ledger step), `team spawn|read|end`, 규칙 세 줄, 상한, `team_changed` notice, 자식을 부모 옆 group에 열기 |
| 3 | harness agent TUI 탭(정한 것 10 포함) |

0은 독립이라 먼저 해도 된다. 1~3은 `standalone-core` land 뒤에 연다. host queue가 control 연결·shell 재연결 위에 서기 때문이다.

## 하지 않는 것

- browser page 내용·screenshot·클릭(계획 browser-use가 더했다, changelog 0.22.0).
- 앱 화면을 agent가 읽거나 조작하기.
- 표준 Agent Client Protocol·A2A 맞추기, 외부 A2A endpoint.
- 아무 명령의 터미널 탭, 사람이 연 터미널에 메시지 넣기(coding session 층은 지웠다).
- workflow desk·참가자를 팀으로 옮기기. workflow는 지금 그대로 두고 팀을 써 본 뒤 정한다.
- 사람이 손으로 session을 팀에 넣고 빼기(`join`). 필요해지면 명령 하나로 더한다.
- 사람이 부모 session을 archive할 때 자식까지 닫기. 자식은 남는다.
- 자식 답 묶기(fan-in). program은 누가 답을 빚졌는지는 알지만 언제 올지는 모른다. 묶는다면 coordinator가 묶음을 선언하는 꼴로 하고, 그 전에 reply 잊음을 먼저 푼다. (사람, 2026-11-08)
- 팀원 격리(worktree)와 spawn cwd. 사용자가 자기 project context(skill, 지침)로 정하는 일이다. lophn은 강제하지 않고 그 skill도 내장으로 주지 않는다. (사람, 2026-11-08·09)
- agent끼리 steer. 도는 turn에 끼어드는 것은 사람 메시지만이다.
- harness runtime 자식의 승인을 부모에게 보내기. 그 CLI가 headless에서 스스로 처리한다.
- 사람이 자식 탭에서 바로 승인하기.
- home·앱 workspace session의 TUI 탭. home에는 터미널이 없고 앱 workspace의 headless cwd는 터미널 cwd 검사를 지나지 못한다. 이번에는 project workspace의 session만 연다. 첫 turn 전(CLI session id 없음)이거나 turn이 도는 중이면 `conflict`다.
- TUI에서 `/clear` 같은 것으로 CLI session id가 바뀌는 경우를 따라가기.
