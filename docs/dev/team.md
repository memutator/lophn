---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# team과 worker

문서가 커서 한 세션이 전부를 읽을 수 없다. concern 경계가 잘려 있으니 team agent로 나눠 계획하고 구현한다. lead 아래 team member가 있고, team member가 worker를 띄운다.

## 3단 구조

| 단 | 누구 | model | 하는 일 | 고치는 것 |
|---|---|---|---|---|
| 1 | lead (주 세션) | Opus 5.5 | slice 목록과 순서, 팀 배정, 팀 사이 충돌 조정, 사람에게 묻기, 결정 기록 | `docs/plan/README.md`, `docs/dev/`, open-issues.md |
| 2 | team member | Opus 5.5 medium (`subagent_type: "claude"`, `model: "opus"`) | 맡은 범위의 문서를 읽고 계획(작업)을 쓴다. 작업을 worker에게 나눠 주고, 결과를 review하고 PR로 main에 합치고 lead에게 보고한다 | `docs/plan/<slice>.md`의 자기 작업, 자기 범위의 코드 |
| 3 | worker (team member가 띄우는 sub agent) | 아래 등급 | 작업 하나를 구현하거나 조사한다. 자기 sub agent는 띄우지 않는다 | 작업의 "자리"만 |

팀은 최상위 concern 하나에 하나씩, 그리고 contracts 팀 하나다.

| 팀 | 맡는 범위 |
|---|---|
| contracts | `packages/contracts/`, `packages/base/`. integrator 역할: contract를 만들고, 다른 팀의 변경 요청을 받는다 |
| platform, documents, apps, problems, lophn-agent, coding-agent | 그 최상위 concern의 `packages/<최상위>/`와 실행 entry |
| shell | `apps/shell/`, `packages/design/`, `packages/sdk/ui-*`. 화면 작업은 frontend 등급 |

- team member는 자기 최상위 문서(intent, requirements, domain model, architecture)와 관련 flow만 읽는다. 다른 최상위는 contract와 concern id로만 본다.
- 다른 팀에 필요한 것은 그 team member에게 직접 요청하고, contract 변경은 contracts 팀에 요청한다.
- review는 team member가 직접 하거나, 구현한 worker와 다른 model의 worker를 띄워 맡긴다.
- lophn-agent 팀과 coding-agent 팀은 계획을 쓰기 전에 주제마다 오픈소스 조사를 worker에게 맡긴다([research.md](research.md)). 프로젝트마다 worker 하나를 두면 빠르다.

## worker 등급

두 등급이다. worker(3단)에 쓴다. 작업에는 등급을 적는다. 띄우는 worker의 7할은 기본, 3할은 좁은 등급이다.

| 등급 | model | 언제 |
|---|---|---|
| 기본 | grok 4.7 (`grok-4-7-xhigh`) | 대부분의 작업: 구현, 화면, contract, review. 기본값 |
| 좁은 | space-bunny-max (`space-bunny-max`) | 쉬운 작업: 범위가 좁고 지시가 분명한 것, 정해진 파일 몇 개, 정해진 바꿈, 정해진 확인 |

- 실패하면 올린다: 좁은 등급이 실패하면 기본. 기본에서 같은 작업이 두 번 실패하면 team member가 작업을 더 잘게 나누거나 직접 고친다.
- rate limit이 나면 그 model의 몫을 줄이고 lead에게 알린다.

## 주고받기

- 작업을 넘길 때는 [tasks.md](tasks.md)의 작업 모양 그대로 넘긴다. 대화 전체를 넘기지 않는다.
- 끝난 worker는 짧게 보고한다: 바꾼 자리, 통과한 check, 테스트가 가리키는 요구, 남은 것.
- 정할 수 없는 것은 문서에 쓰지 않고 open-issues에 `<concern id>#Q<n>`으로 올리고 추천안으로 진행한다. 사람에게 올릴 것은 lead가 고른다(제품 방향, 비용, 되돌리기 비싼 것만).
- contract를 바꿔야 하면 worker나 다른 팀이 직접 고치지 않고 contracts 팀에 요청한다.
- 두 팀이 같은 파일을 고쳐야 하면 lead가 순서를 정한다. 동시에 고치지 않는다.
- worker는 lead가 나눈 몫 안에서 선행이 허용하는 만큼 동시에 띄운다. harness는 team member를 포함해 동시에 20개까지 돌린다. Claude worker는 팀마다 2개까지이고, rate limit이 나면 Claude worker부터 줄인다.
