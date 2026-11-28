# 닿기 간소화: 할당을 지우고 skill 배포 하나로

상태: 로드맵 초안. 2026-11-28 사람이 방향을 세 번 냈고 "ㄱㄱ"로 진행을 말했다. planner가 썼고 사람의 검수 전이다. private은 하나도 남기지 않는다고 사람이 정했다(2026-11-28). 다른 컴퓨터의 앱 command 호출은 터미널 입력 허락에서 뗀다고 사람이 정했다(2026-11-28). 사람이 정할 것은 남지 않았다. `(agent)`로 적은 것은 planner가 근거를 적어 정한 것이라 검수에서 뒤집을 수 있다.
배경 문서: `project-docs/architecture/{agent-call,approval,agent-definition,app-call,machine-a2a,coding-agent,workspace-session,job,folder-sync,package}.md`, `project-docs/products/roadmap/{agent-platform,permission-architecture,a2a-access,multi-machine}.md`, `project-docs/PRODUCT.md` 3절.

## 사람의 말 (원문, 2026-11-28)

> private, public 설정이나 앱 할당에 대해서 마음에 안 들어 lophn 기능에 대한 사용자에게 추상화가 좀 잘 안 되어 있는 거 같아
> 사용자들은 그런 거 신경 안 쓰고 앱 만들고, 에이전트만들고 워크스페이스만들건데
> 게다가 멀티 머신까지 고려하면 경우의 수도 너무 많아져서
> 이걸 거의 다 덜어내고 간소하고 직관적으로 그리고 기본적으로 lophn agent가 알아서 다 할 수 있는 구조로 전환해야할 것 같아

> 근데 잘 들어봐 우리 모델의 메타인지의 한계를 잘 활용해보자 command가 있다하더라도 그게 지침에 안 들어가면 못 쓰거든? 있다는 걸 모르니까? 그러니까 굳이 할당을 신경 쓸 필요가 없이 스킬을 배포하는 걸로만하자
> 근데 스킬이 배포되어 있지 않았는데 agent가 쓴다면 permission을 띄우도록하고
> 그럼 스킬 원본은 해당 주인이 관리하고 그걸 복사한 걸 관리해서
> 의존성 관리도 되게끔하고

> skill을 배포하는 skill도 필요할 거 같아 그리고 기존의 skill 만드는 skill도 손봐야할 거 같고
> 그리고 lophn agent마다 스킬을 배포하거나 workspace 층에 배포하거나 전역적으로 배포하거나 선택적으로 가능하게끔 ㄱㄱ
> 왜냐하면 지금도 메모리라든가 mcp 설정이나 그런 것들이 층 별로 분리되어있어서 그걸 같이 쓰면 좋을 듯

## 왜

- 지금 lophn은 질문 둘을 섞어 사람에게 내민다.
  - **닿기**: 이 agent·앱이 저 workspace·앱·컴퓨터에 닿을 수 있나. call 정책(private, workspace 쌍, agent 쌍), 앱 할당(`apps`, `remote_apps`, `permissions.deny`), 공유 요청·승인, `coding-agent.shared_apps`.
  - **위험**: 이 동작을 지금 해도 되나. 권한 단계와 Gate, shell rules, activation 동의, 바깥 MCP trust.
- 닿기 쪽은 모두 사람만 바꾼다(설정은 `locked`, 할당은 actor `user`). agent가 앱을 지어도 다른 agent가 쓰려면 사람이 화면에서 할당해야 한다.
- 닿기 장치는 서로 곱해진다: private × 쌍 규칙 × agent 범위 × 할당 × command `public` × 기계 둘(부르는 쪽, 받는 쪽).
- 할당은 "허락"과 "알기"를 한 칸에 묶었다. 실제로 agent를 움직이는 것은 알기다. command가 있어도 지침에 없으면 agent는 있는 줄 몰라 쓰지 않는다. 그래서 알기(skill)만 관리하면 허락을 따로 관리할 일이 거의 없다.
- 쓰이지 않는다. 사람의 `~/.lophn`(2026-11-28, 읽기만): `lophn-agent.call_policy` 키 없음, `coding-agent.shared_apps` 키 없음, agent 정의 22개 가운데 `apps`가 있는 것 1개(1줄), `remote_apps` 0, `permissions` 0.

## 지금 코드 (main `1518a7259`, 조사 2026-11-28)

| 장치 | 사람이 만지는 자리 | 읽는 곳(test 제외) |
|---|---|---|
| `lophn-agent.call_policy` `{private, workspaces, agents}` | Settings › Agents › "Calls between workspaces" (`packages/shell/renderer/desktop/settings/agents/call-policy-section.tsx`) | `callPolicy` 88줄/28 file. 판정은 `packages/protocol/lophn-agent/call-policy.ts`의 `mayCall`, `mayReachWorkspace` |
| private의 번진 효과 | 같은 자리 | `isPrivate(` 50줄/28 file: Router, 다른 컴퓨터 목록·명함·mail, handoff note, project identity, job event 범위, 앱 source 내보내기, 앱이 보는 session |
| 앱 할당 `apps`, `permissions.deny` | workspace Agents 탭 › Sees (`packages/shell/renderer/workspace/agents/editor/grants-panel.tsx`), route `assignments/*` | `packages/core/apps/calls/gate.ts`의 `callAllowed`, `assignmentOf` 22줄/10 file |
| 다른 컴퓨터 앱 할당 `remote_apps` | 같은 panel의 "Computers" 절 | 26줄/13 file |
| command별 묻기 `permissions.ask` | 같은 panel의 "ask" 열 | Gate |
| 공유 요청 `lophn app share` → `share_request.decide` | 대기 목록 카드 | `share_request` 93줄/28 file |
| `coding-agent.shared_apps` | Settings › Coding agents › Shared apps | 19줄/8 file |
| 터미널 입력 허락(기기마다) | Settings › Remote › My devices | 받는 컴퓨터의 ledger. 다른 컴퓨터의 agent·앱이 이 컴퓨터 앱 command를 부르는 것도 이 스위치에 걸린다 |
| command·skill의 `public` | UI 없음. 앱을 짓는 agent가 선언에 적는다 | `packages/core/lophn-agent/tools/app-public.ts`, `gate.ts` |

skill이 지금 가는 길은 둘이고 꼴이 다르다(`architecture/agent-definition.md` 47·49, `architecture/coding-agent.md` 13~15).

- lophn agent: 할당한 앱의 public skill을 사본 없이 active release bundle에서 그때그때 읽는다(skill 층 "공유").
- coding agent: `shared_apps`의 앱 skill을 harness skill 폴더에 사본으로 깔고 표시 file `.lophn-shared`(`{app, release, files[]}`)로 lophn의 것만 덮고 지운다. activation마다 다시 맞춘다.

원본은 둘 다 앱 source의 `.lophn/skills/<name>/SKILL.md`이고 release와 같이 봉한다. 선언의 skill은 `{name, public, commands}`다.

## 모델

**앱을 쓰게 하는 길은 skill 배포 하나다.** 사람이 아는 말은 넷이다.

- **workspace**(project, 앱, home)는 일하는 자리다. 벽이 아니다.
- **agent**는 어느 workspace에 살거나 전역이다. 사는 자리는 목록에 어디서 보이는지만 정한다.
- **앱**은 command와, 그것을 쓰는 법인 skill을 내놓는다. 원본은 앱이 갖는다.
- **배포**는 앱의 skill을 어느 층에 사본으로 두는 일이다. 층은 lophn이 이미 쓰는 셋이다: 전역, workspace, agent. 사본이 닿는 agent는 그 앱을 알고, 묻지 않고 쓴다.

```
앱 source .lophn/skills/<name>   ← 원본. 앱 workspace의 agent가 고치고 release가 봉한다
        │ 배포 (agent나 사람)
        ▼
사본: 전역 층 | workspace 층 | agent 층 | coding agent의 harness   ← lophn이 쓰고, 덮고, 지운다. 읽기 전용
        │ 배포 기록 (어느 앱의 어느 skill이 어디에, 어느 release)
        ▼
의존: 앱이 skill·command를 지우거나 바꿀 때, 앱을 지울 때 누가 쓰는지 안다
```

- **층은 MCP와 memory의 층과 같다.** MCP server는 지금도 "설정 층이 곧 할당"이고 층이 전역, workspace, agent 정의 순이다(`architecture/agent-definition.md` 25). memory도 global, workspace, agent 셋이다(53). skill 배포가 같은 층에 서면 사람과 agent가 배울 말이 늘지 않는다: 전역에 두면 모든 workspace의 agent가, workspace에 두면 그 workspace에서 도는 agent가, agent에 두면 그 agent만 받는다. 끄기는 지금의 `skills_off`와 workspace·전역 층의 skill 끄기 그대로다.
- **배포는 agent가 한다.** 앱을 지은 agent와 Home의 lophn이 사람 승인 없이 배포한다. 사람도 화면에서 배포하고 거둔다. 배포한 것은 받는 workspace에 보인다(어느 앱에서 왔는지와 함께).
- **배포되지 않은 앱을 agent가 쓰면 묻는다.** 거절(`forbidden`)이 아니라 Gate의 ask다. 사람이 "늘 허락"을 고르면 skill이 배포된다(기본 층은 부른 session의 workspace). 묻는 카드가 받는 쪽에서 시작하는 배포 길이다. 앱 자기 workspace의 agent는 지금처럼 자기 앱을 묻지 않고 쓴다.
- **사본은 원본을 따른다.** 앱의 active release가 바뀌면 lophn이 사본을 그 판으로 맞춘다. 받는 쪽은 사본을 고치지 않는다. 자기에게 맞춘 글이 필요하면 자기 workspace의 skill로 쓴다.
- **다른 컴퓨터도 같은 말이다.** 다른 컴퓨터에 있는 앱의 skill을 이 컴퓨터의 자리에 배포하면 그 앱을 `--on`으로 부른다. `remote_apps`가 없어진다.

AGENTS.md "속도"와 맞다: 사용자 앱과 사람이 쓴 것은 공격자가 아니다. 막는 것은 AI가 만든 코드, agent의 실수, 인터넷에서 온 것이고 그 셋은 위험 쪽 장치(activation 동의, 권한 단계, Gate)가 본다.

## 무엇을 하나

### 1. skill 배포

- 배포 기록 하나: `{앱, skill, 층, release}`. 층은 전역, workspace 하나, agent 하나, coding agent harness다.
- 사본 꼴 하나: lophn agent 쪽 skill 층 "공유"(그때그때 읽기)와 harness 사본(`.lophn-shared`)을 한 꼴로 합친다.
- 맞추기: activation, 배포·거두기, 앱 archive·삭제 때 사본을 맞춘다. 지금 harness sync가 도는 때와 같다.
- 명령: agent와 사람이 배포하고, 거두고, 목록을 읽는다(이름은 계획에서 정한다).
- 화면: workspace의 skill 목록에 배포받은 skill이 온 앱과 함께 보이고 거둘 수 있다. 앱 쪽에는 그 앱의 skill을 받은 자리 목록이 보인다.

### 1a. 내장 skill 둘

- **새 내장 skill: skill 배포**(이름은 계획에서 정한다). 언제 배포하나(앱을 짓고 나서, 사람이 다른 자리에서 쓰겠다고 할 때), 어느 층을 고르나(한 agent만 쓰면 agent, 그 project의 일이면 workspace, 어디서나 쓰면 전역, 사람의 Claude Code·Codex가 쓰면 harness), 배포 전에 볼 것(skill이 public인가, 부르는 command가 public인가, 설명이 "언제 읽을지"를 말하나), 거두기, 누가 쓰는지 읽기를 가르친다. home, project, app에서 쓴다.
- **`write-skill`을 고친다**(`packages/core/agent-workspaces/skills/write-skill`). 지금은 skill을 만들고 고치고 정리하는 법만 말한다. 더할 것: 앱의 skill은 원본이 앱 source에 있고 다른 자리의 것은 사본이라 고치지 않는다(고칠 일은 원본의 앱 workspace로 넘긴다), 내놓는 skill은 다른 workspace의 agent가 읽는 글이라 그 앱의 내부를 몰라도 쓰게 쓴다, 다 쓴 뒤 배포는 배포 skill로 넘긴다.
- 앱 지침(`design-app`, 앱 template의 `AGENTS.md.tmpl`)의 공유 요청(`lophn app share`) 안내를 배포로 바꾼다. 앱 agent가 읽는 지침이 바뀌므로 `sdk-note`대로 `migrate-sdk` 메모와 Instruction diff를 쓴다.

### 2. 배포되지 않은 호출은 묻는다

- `callAllowed`의 할당 검사를 "부른 session에 닿는 층(전역, 그 workspace, 그 agent) 어디에든 그 앱의 skill이 배포돼 있나"로 바꾼다. 없으면 Gate ask(`once | always | reject`)이고 `always`는 배포다.
- 사람이 없는 호출(job, flow)과 권한 단계 `full`은 Gate의 지금 규칙을 따른다.

### 3. 의존 알리기

- `release.prepare`가 이미 내는 `removed_public_skills`, `removed_public_tools`에 그것을 배포받은 자리를 같이 싣는다. activation 동의 카드가 "이 변경으로 project X가 쓰던 skill이 없어진다"를 보인다.
- 앱을 archive하거나 지울 때 배포받은 자리를 보이고 사본을 거둔다.

### 4. 지우는 것

- 앱 할당: agent 정의의 `apps`, `remote_apps`, `permissions`(`deny`, `ask`), route `assignments/*`, Sees 탭의 Assign app과 Computers 절.
- 공유 요청: `lophn app share`, `share_request.decide`, 대기 목록의 공유 카드, activation 동의 카드에 합쳐진 공유 줄, `coding-agent.shared_apps`, Settings › Coding agents의 Shared apps.
- call 정책: 설정 `lophn-agent.call_policy`, `mayCall`·`mayReachWorkspace`·`isPrivate`와 읽는 곳 전부, Home lophn → private lophn handoff 예외, Settings › Agents의 "Calls between workspaces" 절, 기계 사이 private 규칙. agent 사이 call도 같은 원리에 선다: agent는 workspace 정보에 실린 agent(자기 workspace의 것과 전역)만 안다. Router는 명함 검사와 팀 규칙만 본다.

### 5. 남기는 것

- command·skill의 `public`. 사람의 설정이 아니라 앱의 계약이다. 배포할 수 있는 것은 public skill이고 밖에서 부를 수 있는 것은 public command다.
- agent 범위(전역, workspace)와 `skills_off`(받은 skill 가운데 끄기).
- 위험 쪽 전부: 권한 단계와 Gate, shell rules, file 범위, activation 동의, 바깥 MCP trust, secret은 기계를 넘지 않는다.
- 사람의 터미널이 다른 컴퓨터에 입력하는 터미널 입력 허락.

## 잃는 것

- 사람 승인 없이는 아무것도 다른 workspace의 prompt에 들어가지 않는다는 보장. agent가 배포하면 받는 workspace의 skill 목록에 이름과 설명이 실린다.
- skill 없는 앱은 밖에서 묻지 않고 쓰게 할 길이 없다. 앱을 짓는 agent가 내놓는 command마다 skill을 쓰게 지침을 고친다(`sdk-note`).
- workspace 하나를 떼어 놓는 길(private). 기밀 project의 내용을 다른 workspace의 agent가 call로 읽거나 handoff note·앱 source가 다른 컴퓨터로 나가는 것을 사람이 막지 못한다.

## 뒤집는 결정

- 2026-11-04 시야는 workspace 정책이 정하고 agent 정책이 예외로 덮는다(`agent-platform.md` 6번).
- 2026-11-05 private, 2026-11-07 Home lophn handoff 예외, 2026-11-17 private은 컴퓨터 사이에도 선다(`architecture/agent-call.md`).
- 2026-11-02 앱을 지은 agent가 공유를 제안하고 사람이 승인한다(`architecture/approval.md`). agent가 바로 배포한다로 바뀐다.
- "앱 skill 공유는 할당에 붙인다"(`architecture/app-call.md`). 거꾸로 된다: 허락이 skill 배포에 붙는다. 아는 것과 부를 수 있는 것이 한 칸이라는 뜻은 그대로다.
- 2026-10-20 "할당이 허락", 2026-11-25 command별 묻기(`permission-architecture.md`). "배포받은 앱은 묻지 않고, 배포받지 않은 앱은 묻는다"로 바뀐다.

## 정한 것 (사람)

- private을 하나도 남기지 않는다(2026-11-28 "private는 하나도 안 남길 듯"). call 정책 전체를 지운다.
- agent가 사람 승인 없이 배포한다(2026-11-28 "lophn agent가 알아서", "ㄱㄱ").
- 배포 층은 전역, workspace, agent 셋이고 MCP·memory의 층과 같이 쓴다(2026-11-28).
- skill을 배포하는 내장 skill을 새로 두고 `write-skill`을 고친다(2026-11-28).
- 다른 컴퓨터의 agent·앱이 이 컴퓨터 앱 command를 부르는 것을 터미널 입력 허락에서 뗀다(2026-11-28 "뗀다"). 짝지은 컴퓨터끼리 앱 `public` command는 늘 부르고, 스위치는 사람의 원격 터미널 입력에만 남는다. 잃는 것: 짝은 지었지만 그 컴퓨터의 agent는 내 앱을 못 부르게 하는 길(막으려면 짝을 끊는다).

## 정한 것 (agent)

- 묻지 않는 범위는 앱 단위다. 그 앱의 skill이 하나라도 닿는 session은 그 앱의 public command를 모두 묻지 않고 부른다. skill의 `commands` 목록으로 command마다 따지면 skill 글이 언급했지만 목록에 빠진 command에서 묻게 되고 경우가 는다.
- 층을 새로 만들지 않고 MCP·memory가 쓰는 전역, workspace, agent 셋을 그대로 쓴다(사람, 2026-11-28). harness는 lophn agent의 층이 아니라 coding agent로 가는 네 번째 자리다.
- agent 층 배포는 agent 정의에 선다(MCP의 `mcp_servers`와 같은 자리). 지금의 `apps` 칸이 "이 agent에게 배포한 skill"로 바뀌는 셈이라 옮기기가 곧다.
- 사본은 판을 고정하지 않고 active release를 따른다. package(`architecture/package.md`)는 판을 고정하지만 그것은 code가 소비 앱의 release에 봉해지기 때문이다. skill이 부르는 앱은 늘 active release 하나라 옛 판 skill은 없는 command를 가르친다.
- 받는 쪽은 사본을 고치지 못한다. 고치면 다음 맞추기가 덮는다.
- 할당을 "추천 앱 pin"이나 "모든 앱 목록을 prompt에 싣기"로 바꾸지 않는다. 사람의 말대로 모르는 것은 쓰지 않는다가 기본이다.
- 옮기기: data step이 `agents/*.md`의 `apps`를 그 agent 층의 배포 기록으로 바꾸고 `remote_apps`·`permissions`를 지운다. `settings.json`의 `lophn-agent.call_policy`·`coding-agent.shared_apps`를 지우고(`shared_apps`는 harness 배포 기록으로 바꾼다), ledger의 공유 요청 저장은 새 schema step으로 지운다.

## 구조 (agent, 조사 2026-11-28로 정함)

조사한 사실: MCP 층은 전역 `settings.json`의 `lophn-agent.extensions.mcp_servers`, workspace `extensions.json`, agent 정의 `mcp_servers` 셋에 적히고 `serversOf`가 차례로 합친다. skill 층에 agent 하나에만 닿는 층은 없다. 할당한 앱의 skill은 active release bundle(봉한 사본)에서 그때그때 읽는다. harness 사본은 `syncSkillCopies`가 쓴다. 호출 검사는 호출마다 `agents/<id>.md`를 읽는다(cache 없음). 할당하지 않은 앱은 `lophn <slug> <command>`가 `unknown command`로 끝나 Gate에 닿지 않는다. Gate의 `always`를 저장하는 효과는 shell 하나뿐이다. workspace 층 설정은 기계 사이에 맞춰지지 않는다(`architecture/project-identity.md` 비목표).

- **배포 기록의 정본은 층의 설정이다.** MCP와 같은 세 자리에 `{앱, skill}` 목록을 둔다: 전역 `settings.json`, workspace `extensions.json`, agent 정의(`apps` 칸이 이것으로 바뀐다). harness 배포는 `coding-agent.shared_apps`를 같은 꼴로 바꾼다. ledger 표를 따로 두지 않는다: 층 설정과 표가 두 벌이 되면 어긋난다. 읽는 비용은 호출마다 작은 file 셋이고 지금(agent 정의 하나)과 급이 같다.
- **이 컴퓨터의 앱은 사본 file을 층 폴더에 또 쓰지 않는다.** active release bundle이 이미 원본을 봉한 사본이고 lophn만 쓴다. 층의 기록이 그 bundle의 skill을 가리키면 "원본은 주인이, 사본은 lophn이 관리하고 active release를 따른다"가 맞추기(sync) 없이 선다. 층 폴더에 file로 또 쓰면 표시 file이 skill 검사·목록과 섞이고, Home session이 `<data>/skills`를 file tool로 쓸 수 있어 "사본은 고치지 못한다"를 따로 막아야 한다. file 사본은 lophn이 직접 읽어 줄 수 없는 두 곳에만 둔다: coding agent의 harness 폴더(지금 그대로)와 다른 컴퓨터 앱의 skill(이 컴퓨터에 bundle이 없어 받아 둔다).
- **의존은 층 설정을 훑어 계산한다.** package 사용처(`loadUsages`)가 release 선언을 그때그때 훑는 것과 같은 꼴이다.
- **주는 쪽은 묻지 않고, 끌어오는 쪽은 묻는다.** 앱 workspace의 agent(자기 앱의 skill)와 Home의 lophn(모든 앱)은 어느 층에든 배포한다. 그 밖의 agent가 자기에게 닿지 않는 앱을 부르거나 스스로 배포하려 하면 같은 Gate ask가 뜬다. 스스로 배포한 뒤 부르는 길이 열려 있으면 묻기가 뜻이 없다.
- **묻기의 선택지.** `once | session | always | reject`. `always`는 부른 session의 workspace 층에 그 앱의 public skill을 배포한다. public skill이 없는 앱은 `always`가 없다(배포할 것이 없다). 사람이 없는 호출(job, flow)은 지금 Gate 규칙대로 거절이고 문장이 먼저 배포하라고 알린다. ask를 띄울 수 없는 runtime의 agent도 같다.
- **배포하지 않은 앱도 이름으로 부르면 Gate까지 간다.** `lophn <slug> <command>`가 부른 slug를 그때 푼다. workspace 정보와 `lophn help`의 앱 command 목록에는 배포받은 앱만 싣는다.
- **배포는 층 설정처럼 기계마다다.** project에 한 배포는 다른 컴퓨터의 같은 project에 저절로 서지 않는다. MCP 설정과 memory도 지금 그렇다. 배포만 기계 사이에 맞추면 층이 하나라는 말이 깨진다. 잃는 것: 다른 컴퓨터에서 같은 project로 그 앱을 처음 부를 때 한 번 묻는다. 층 설정을 기계 사이에 맞추는 일은 층 전체의 일로 따로 연다.
- **다른 컴퓨터 앱의 skill.** 층의 기록에 컴퓨터를 같이 적는다(`remote_apps`가 이것으로 바뀐다). skill 글은 link로 받아 `<data>`에 둔다. 받는 길은 명단의 컴퓨터에게 앱 command 목록 읽기(`appTools`)가 열린 자리에 skill 읽기를 더한다. 그 컴퓨터가 꺼져 있으면 skill은 보이고 호출은 `unavailable`이다.
- **명령.** `lophn skill deploy|undeploy|deployments`. `lophn skill`은 이미 있는 명령 묶음이다. 새 내장 skill의 이름은 `deploy-skill`이다.
- **사람의 data.** `apps`가 있는 agent는 Home lophn 하나이고 그 앱은 public command 3개에 public skill이 0개다. 옮길 skill이 없어 그 줄은 지워지고, Home lophn이 그 앱을 부르면 묻는다. 그 앱의 lophn에게 skill을 쓰게 하고 배포하면 끝난다(land 뒤 사람에게 알린다). active 앱 9개 가운데 public skill을 가진 앱이 0개라 지금은 배포할 것이 하나도 없다. `write-skill`·`design-app` 지침이 내놓는 command마다 skill을 쓰게 해야 이 모델이 돈다.

## 일의 모양

한 줄이다. `gate.ts`, Router, agent 정의 schema, skill 발견, harness sync를 일들이 같이 고친다. 순서는 다음과 같고 일마다 architecture 문서·flows·change-log를 같이 고친다.

1. 층의 배포 기록과 읽기(세 층 합치기, `lophn skill deploy|undeploy|deployments`), 호출 검사를 배포로 바꾸기(Gate ask와 `always`), 할당(`apps`, `permissions`)과 공유 요청·`shared_apps` 지우기, data step과 schema step. 한 덩어리다: 할당을 읽는 자리와 배포를 읽는 자리가 같아 나누면 두 길이 같이 선다.
2. 내장 skill `deploy-skill`, `write-skill` 고치기, 앱 지침(`design-app`, `AGENTS.md.tmpl`, `prompts/*.md`, SDK guide)과 `sdk-note`.
3. 의존 알리기(`release.prepare`, activation 동의 카드, 앱 archive·삭제).
4. call 정책 지우기(`call_policy`, `isPrivate` 28 file).
5. 기계 사이: `remote_apps`를 컴퓨터가 적힌 배포 기록으로 바꾸고 다른 컴퓨터 앱의 skill 받기, 앱 command 호출을 터미널 입력 허락에서 떼기.

## 하지 않는 것

- 권한 단계, activation 동의, 바깥 MCP trust를 고치기(`permission-architecture.md`).
- 다른 사람과 나누기(여러 사용자).
- 팀 규칙(`lophn-agent.team`)과 명함 검사 고치기.
- skill 판 고정, 범위(`^`), 받는 쪽 사본 고치기.
- 앱이 아닌 것의 skill 배포(project의 skill을 다른 project로). 사람이 말하지 않았다.
