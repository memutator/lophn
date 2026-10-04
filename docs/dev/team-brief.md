---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# team member 지침

lophn을 구현하는 team member(2단, `gpt-6.1-sol-max`)가 따르는 지침이다. 사람은 "Team 띄워서 구현 계획 및 계획에 따라 구현 마무리까지 진행한다"고 맡겼다. lead는 주 세션이다(SendMessage `to: "main"`).

## 먼저 읽을 것

1. `AGENTS.md`, `docs/README.md`
2. `docs/dev/` 전부(code-map, architecture, contracts, stack, tasks, team, research, legacy)
3. `docs/plan/README.md`(slice와 순서)
4. 맡은 범위의 문서: `docs/intent/<최상위>.md`, `docs/requirements/<최상위>/`, `docs/domain-model/<최상위>/`, `docs/architecture/<최상위>.md`, 그 범위가 지나는 `docs/flows/`
5. `open-issues.md`의 "정한 원칙"(D1–D30)
6. 화면을 만드는 팀은 `docs/ui-ux/README.md`, agent 관련 팀은 `docs/research/`

다른 최상위의 문서는 contract와 concern id로만 본다. 읽기가 많으면 worker에게 요약을 맡기고 결과만 받는다. 자기 context를 아낀다.

## 1단계: 계획

- `docs/plan/<팀>.md`를 쓴다. metadata는 `type: plan`, `concerns: [<맡은 최상위>]`. 작업은 `docs/dev/tasks.md`의 모양 그대로, 작업마다 `slice:`, `등급:`, `요구:`, `자리:`, `쓰는 contract`, `내놓는 contract`, `선행:`, `완료:`를 적는다.
- **맡은 최상위의 요구가 모두 어느 작업의 `요구:`에 들어가야 한다.** 빠진 요구가 없게 한다. 문서 끝에 "## 요구 덮기"로 concern마다 요구 수와 덮은 수를 적는다.
- 작업 순서는 slice 순서(`docs/plan/README.md`)를 따르고, slice 안에서는 선행으로 잇는다.
- 다른 팀이 내놓는 contract가 필요하면 contracts 팀에 무엇이 필요한지 보낸다. 내가 내놓는 contract(architecture의 "내놓는 contract")도 contracts 팀에 보낸다.
- **lophn-agent 팀과 coding-agent 팀**: 계획 전에 주제마다 오픈소스 조사를 한다(`docs/dev/research.md`). 주제마다 3개 이상 프로젝트를 worker에게 나눠 코드로 읽히고 `docs/research/<주제>.md`에 남긴다. 작업은 그 문서를 `조사:`로 가리킨다.
- 정할 수 없는 것은 추천안으로 계획을 쓰고, 계획 문서 끝 "## 질문"에 적는다. 제품 방향을 바꾸는 것만 lead에게 바로 묻는다.
- 계획 단계에서는 commit하지 않는다. 다 쓰면 lead에게 보고한다: 작업 수, slice별 작업 수, 요구 덮기, 조사 문서, 질문 수.

## 2단계: 구현

lead가 "구현 시작"을 보내면 시작한다.

- 선행이 모두 main에 합쳐진 작업은 slice와 상관없이 시작해도 된다. slice 순서는 우선순위와 E2E의 순서다. 앞 slice 작업을 먼저 잡는다.
- 작업 하나마다: `git fetch origin && git worktree add .claude/worktrees/<branch> -b <branch> origin/main` → worker를 띄워 그 worktree에서 구현시킨다 → 결과를 review한다(직접 하거나 다른 model의 worker) → push, PR, rebase, check, `gh pr merge --squash --delete-branch` → `git worktree remove`.
- 같은 PR에서 계획 문서의 그 작업에 `- 상태: 완료 (#<PR 번호>)`를 단다.
- 병합 전에 review 기록을 PR에 남긴다(`gh pr review --comment`): 누가(model) 봤는지, 읽은 것, 찾아서 고친 것, rebase 뒤 돌린 check. 기록을 먼저 남기고 병합한다. 병합 직전에 origin/main이 움직였으면 다시 rebase하고 check를 돌린 뒤 합친다. 두 PR이 서로 모르고 합쳐지면 main이 깨진다. 병합이 permission에 막히면 다시 시도하지 않고 lead에게 알린다.
- 병합하면 그 작업을 `선행:`에 둔 다른 팀에 바로 알린다("<팀>#T<n> 병합됨, PR #<번호>"). 기다리는 팀은 이 알림으로 깨어난다. 할 수 있는 작업이 없으면 기다린다.
- slice의 마지막 작업에서 그 slice의 flow E2E를 돌린다.
- slice마다 lead에게 보고한다: 합친 PR, 도는 flow, 남은 것.
- 구현하다가 requirements가 틀렸다는 것이 드러나면 같은 PR에서 그 최상위 requirements를 고치고 "## 질문"에 남긴다. intent와 `docs/concerns.yaml`은 고치지 않는다(lead만).

## worker 띄우기

Agent tool로 띄운다. worker는 자기 sub agent를 띄우지 않는다.

- 선행이 허용하는 작업은 몫 안에서 모두 동시에 띄운다. harness가 team member를 포함해 동시에 20개까지만 돌리므로 worker 몫은 lead가 팀마다 나눈다. 몫이 모자라면 lead에게 말한다. 한 작업에 worker 하나, worktree 하나다. 문서 요약만 하는 worker는 쓰지 않는다.
- 같은 파일을 고치는 작업은 동시에 띄우지 않는다. 띄울 작업이 없으면 기다린다.
- Claude worker(frontend, 최상위)는 팀마다 동시에 2개까지다. Anthropic rate limit(429)이 나면 Claude worker부터 줄인다. grok, sol, space-bunny는 그 한도와 상관없다.
- worker의 Bash가 막히면 그 확인은 team member가 직접 돌린다.

| 등급 | Agent tool |
|---|---|
| 좁은 | `subagent_type: "space-bunny-max"` |
| 기본 | `subagent_type: "grok-4-7-xhigh"` 또는 `"sol-6-1-high"`(번갈아, rate limit이 나면 그쪽을 줄인다) |
| frontend | `subagent_type: "claude"`, `model: "opus"` |
| 최상위 | `subagent_type: "claude"`, `model: "sonnet"`. worker가 자기 model이 `claude-sonnet-5-5`인지 첫 줄에 말하게 하고, 아니면 lead에게 알린다 |

review는 diff를 직접 읽거나 다른 model worker에게 맡긴다. code-review Skill은 쓰지 않는다(worker를 따로 띄워 몫을 쓴다).

worker의 Bash는 명령마다 cwd가 main checkout으로 돌아갈 수 있다. 그래서 worker 프롬프트 맨 앞에 "모든 명령과 파일 경로는 worktree 절대 경로다(`git -C <worktree>`, `cd <worktree> && ...`). main checkout은 고치지 않는다"를 넣는다. 테스트의 fixture·Worker entry·temp 경로는 `import.meta.url`이나 temp dir 기준으로 잡는다.

worker 프롬프트에는 작업 블록 그대로, 읽을 파일(필요한 것만), worktree 경로, 지킬 규칙(`AGENTS.md`, `docs/dev/architecture.md`), 완료 기준, 보고 모양(바꾼 자리, 통과한 check, 테스트가 가리키는 요구, 남은 것)을 넣는다. 기본 등급이 같은 작업을 두 번 실패하면 최상위로 올린다.

## 팀 사이

- lead가 팀 명단(agent id)을 보낸다. 선행·contract는 그 팀에 직접 메시지를 보낸다.
- 다른 팀의 자리(코드, 계획 문서)는 고치지 않는다.
- contract를 바꿔야 하면 contracts 팀에 요청한다.
- 막히면 lead에게 짧게 묻는다.
