# tab owner: 탭이 agent의 시야와 책임을 보인다

상태: 로드맵 초안. 2026-11-21 사람이 방향을 냈고 planner가 썼다. 정할 것은 모두 정했다(2026-11-21). 사람의 검수 전이다. `(agent)`로 적은 것은 planner가 근거를 적어 정한 것이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/architecture/{workspace-layout,browser-tab,agent-call,attention,terminal-agent}.md`, `project-docs/products/roadmap/{agent-surface,agent-browser-lifetime,browser-profile,a2a-access,agent-profile}.md`.
조사: harness-lab `_report/cross-harness-orchestration/ui-ux-journeys.md`, `_report/browser-use/`, `_report/codex-multi-agent-report.md`.

## 사람의 말 (원문)

2026-11-08(`agent-surface.md`):

> 지금 desk, group, pane, tab 등의 개념이 단순하게 layout의 개념만이 아니라 agent 협업에도 적용되었으면 함

2026-11-21:

> 이 workspace tab이 단순한 layout의 관심사가 아니라는 점이야. agent의 시야, agent간의 책임을 representation이 될 수 있기를 기대하는데 현재는 그 부분에 대해서 많이 미흡한 것 같아

> browse use를 쓰는 agent가 연 탭만 쓰던데, 사용자가 쓰던 브라우즈 탭도 넘길 수 있으면 좋을 거 같다

> 묶음은 뭐가 묶음인데 group? 그럼 float, minimized는 어떻게 할건데

## 왜

- 탭에 누가 열었는지가 남지 않는다. 화면에서 어느 agent의 탭인지는 옆에 붙어 있다는 것으로만 안다.
- agent는 자기가 연 탭 말고는 무엇이 열려 있는지 모르고, 사람이 쓰던 탭을 받을 길이 없다.
- 팀(spawn tree)이 화면에 없다. 누가 누구에게 일을 맡겼는지는 call card를 따라가야 안다.

## 지금 코드

- **탭에 주인 칸이 없다.** `TabItem`(`packages/shell/renderer/workspace/model.ts:6`)의 칸은 key, kind, title, folder, app, screen, fields, readPosition, preview, transient, machine이다.
- **core는 주인을 메모리에만 든다.** `TabOwner = Id<"ses"> | "person"`과 `TabEntry`(`packages/core/host-queue/queue.ts:43,57`)다. `owned()`(`:328`)가 남의 탭의 close·show를 `forbidden`으로, browser 호출을 `not_found`로 막는 데만 쓴다. core가 꺼지면 사라진다.
- **표에 드는 것은 `tabs/open`으로 연 탭뿐이다.** 사람이 손으로 연 탭은 탭 id도 주인도 없어 agent가 가리킬 수 없다.
- **연 쪽의 뜻은 한 번 쓰고 버린다.** `tab_open` 요청에 `relation`과 `source`가 실리고(`packages/protocol/lophn-agent/host-queue.ts:117-119`), renderer의 `openAt()`(`packages/shell/renderer/workspace/open-policy.ts:48`)이 자리를 정하는 데 쓴 뒤 탭에 남기지 않는다.
- **agent의 탭 명령은 open, close, show 셋이다**(`packages/cli/commands/tab.ts:217`). 목록이 없다. 읽을 수 있는 것은 자기가 연 browser·preview·artifact·phone 탭이다(`architecture/browser-tab.md` 34).
- **팀이 화면에 없다.** `spawned_by`를 읽는 shell source가 없다. sidebar의 session 줄(`SidebarSession`, `packages/shell/renderer/shell/left-sidebar-model.ts:16`)은 desk마다 평평하다.
- **agent가 다루는 탭의 표시는 한 줄이다.** "Agent is controlling this tab"(`packages/design/i18n/catalog/browser.ts:35`)이고 어느 agent인지 말하지 않는다.
- **탭의 자리는 여섯이다**(`architecture/workspace-layout.md`): 탭 줄, split group의 칸(2~4칸), 펴진 desk float, 접힌 float, 전역 float, detached 창. agent가 여는 browser 탭의 기본 relation `work`는 접힌 float이라 탭 줄에 없다. 접힌 float의 chip은 전역 float 먼저, 그다음 이 desk의 float 순으로 서고 4개를 넘으면 +N이다. 전역 float의 제목 줄은 agent 아이콘과 상태 점을 읽지 못한다.
- **탭 kind는 17개다**(`packages/shell/renderer/workspace/kinds/`). Agent 탭은 저장하지 않는다(change-log `no-saved-agent-tabs`).
- **사람 화면을 agent가 읽는 relay는 부르는 곳이 없다**(이슈 `workspace-relay-unused-and-disconnected`, open. 만들지 지울지를 사람에게 묻고 있다).
- **browser 호출은 한 core 안의 일이다.** 기계를 건너지 못한다(`architecture/browser-tab.md`).

## 다른 harness

- **Claude in Chrome**: session마다 tab group이 있고 사람이 탭을 끌어 넣으면 agent가 본다. browser 탭에 한한다.
- **T3 Code**: 탭 주인은 (environment, provider session, thread)다. 주인 아닌 탭도 읽기는 되고 쓰기는 주인만 한다. 사람이 take·release control을 한다.
- **Paseo**: 탭은 workspace 것이고 같은 workspace의 agent 누구나 다룬다. 넘기는 장치가 없다.
- **GooeyPi**: 탭은 session 것이다. 접근이 바뀌면 기다리던 행동이 거부된다.
- **Orca**: 단위가 worktree다. sidebar에 계보 tree, 4칸 칸반이 있다.
- **Codex**: agent의 주소가 tree 안의 자리이고 이름은 띄울 때 맡은 일로 짓는다.

모든 탭 kind에 주인을 둔 제품은 없다.

## 무엇을 만드나

### 주인

- 탭마다 주인이 하나다: 사람 또는 session. core가 저장한다.
- 주인은 탭의 자리와 무관하다. 탭 줄, group의 칸, float, 접힌 float, 전역 float, detached 창 어디에 있어도 그대로다.
- agent가 연 탭의 주인은 연 session이고 사람이 연 탭의 주인은 사람이다.
- 배치(나눔, float의 자리, 순서)는 계속 shell의 것이고 core는 배치를 모른다.

### 화면이 주인을 그린다

- 탭 줄과 group 칸의 머리: 주인의 avatar.
- float bar와 detached 창의 제목: 주인.
- 접힌 float의 chip: 주인마다 chip 하나(avatar와 개수)이고 누르면 그 주인의 접힌 탭 목록이 펴진다. 사람의 chip은 지금처럼 따로 선다.
- 전역 float: 주인을 그대로 지닌다.
- sidebar: session 줄을 펴면 그 session의 탭이 자리와 상관없이 나온다. 누르면 그 탭으로 가고 접힌 float이면 편다. 팀 tree(`spawned_by`)를 desk 아래에 그린다.
- "Agent is controlling this tab"은 어느 agent인지 말한다.

### agent의 시야

- `lophn tab list`가 자기 탭을 낸다(kind, 제목, url이나 path, 상태). coordinator는 자기 밑 session의 탭까지 받는다.
- 읽고 조작하는 것은 지금처럼 browser, preview, artifact, phone 탭이다. 목록에는 그 session이 주인인 탭이 모두 선다.
- 앱 화면은 계속 뺀다. 사람이 지금 보는 탭은 agent가 스스로 알지 못한다.
- `team spawn`으로 연 자식의 시야는 부모를 넘지 못한다.

### 넘기기

- 사람이 browser 탭을 agent에게 넘긴다. 길은 셋이다: 탭을 sidebar의 session 줄에 끌어 놓기, 그 agent의 chip에 끌어 놓기, 탭 메뉴의 "Hand to".
- 넘겨도 탭의 자리는 그대로이고 주인만 바뀐다.
- 사람이 손으로 연 탭은 넘길 때 core 표에 오른다.
- 넘기면 주인이 바뀌고 agent가 그 탭을 조작한다.
- 넘겨받은 탭은 agent가 닫지 못한다. 사람은 Take control로 끼어들고 되찾는다.
- agent는 사람의 탭 목록을 보지 못한다. 말로 청하고 사람이 고른다.
- coordinator는 자기 탭을 자식에게 넘길 수 있다.
- 넘길 수 있는 상대는 그 탭이 있는 기계에서 도는 session이다.
- 넘긴 browser 탭은 자기 browser profile을 그대로 든다(`browser-profile.md`).

## 정한 것

1. 탭이 agent의 시야와 책임을 보여야 한다. (사람, 2026-11-21)
2. 사람이 쓰던 browser 탭을 agent에게 넘길 수 있어야 한다. (사람, 2026-11-21) `browser-tab.md` 지키는 것 34("사람이 손으로 연 탭은 다룰 수 없다")를 고친다.
3. split group은 주인의 단위가 아니다. (agent: 2~4칸이고 float, 접힌 float, 전역 float, detached를 담지 못한다)
4. 주인은 탭의 속성이고 자리와 무관하다. (agent: desk를 단위로 두면 전역 float을 담지 못하고, 그 desk에서 사람이 연 로그인된 탭이 자동으로 팀에 보인다. 2026-11-08의 "layout은 보이는 방식일 뿐"과 "core는 layout을 모른다"가 그대로 선다)
5. 넘기는 것은 browser 탭이고 넘기면 주인이 바뀐다. (agent: 사람이 청한 것이 이것이다. 터미널과 문서, 읽기만 넘기기, 한 번 보여 주기는 요구가 생기면 한다)
6. agent는 사람의 탭 목록을 보지 못한다. 말로 청하고 사람이 고른다. (agent: 탭이 있는지 새지 않게 하는 지금 규칙 그대로다)
7. 넘긴 탭에서 agent가 다른 site로 가는 것을 막지 않는다. (agent: 넘긴 것은 사람의 결정이고 주인 표시와 Take control이 있다. AGENTS.md "속도")
8. Agent 탭은 계속 저장하지 않는다. 앱을 다시 켜면 sidebar의 tree에서 연다. (agent: 지금 결정 그대로)

## 정할 것

없다. 화면 모양은 wireframe으로 검수받는다. 이슈 `workspace-relay-unused-and-disconnected`는 이 roadmap이 건드리지 않고 열린 채 둔다.

## 단계

| 단계 | 하는 일 |
|---|---|
| 1 | 주인 저장, 표시(탭, group 칸, float, chip, 전역 float, detached), sidebar의 탭 목록과 팀 tree, `lophn tab list` |
| 2 | 넘기기: 사람의 browser 탭을 core 표에 올리기, 끌기와 메뉴, 되찾기 |

1 → 2는 차례다.

## 하지 않는 것

- 탭의 자리로 시야를 정하기. 배치는 사람이 자유로 한다.
- 터미널과 문서 탭을 넘기기, 읽기만 넘기기, page의 snapshot만 대화에 붙이기. 요구가 생기면 한다.
- 앱 화면을 agent가 읽거나 조작하기.
- agent가 사람이 지금 보는 것을 스스로 알기.
- 탭을 다른 기계의 session에 넘기기.
- 칸마다 탭 줄이 있는 pane tree로 돌아가기.

## 확인하지 않은 것

- call이나 `team spawn`이 연 session 탭을 사람이 실제 창에서 본 적이 없다(`architecture/agent-call.md` "열린 것").
- 사람이 연 `<webview>` 탭을 core 표에 올릴 때 지금 driver가 그대로 붙는지는 돌려 보지 않았다.
