---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# team과 worker

문서가 커서 한 세션이 전부를 읽을 수 없다. concern 경계가 잘려 있으니 team agent와 workflow로 나눠 계획하고 구현한다.

## 역할

| 역할 | 하는 일 | 고치는 것 |
|---|---|---|
| lead | 계획 순서, 작업 배분, 병합, 사람에게 묻기, 결정 기록 | `docs/plan/README.md`, `docs/dev/`, open-issues.md |
| integrator | contracts와 base를 만들고 고친다. contract 변경 요청을 받는다 | `packages/contracts/`, `packages/base/` |
| planner | 최상위 하나의 문서를 읽고 slice 작업을 쓴다 | `docs/plan/<slice>.md`의 자기 최상위 작업 |
| implementer | 작업 하나를 구현한다 | 작업의 "자리"만 |
| reviewer | 다른 worker가 끝낸 작업을 요구 번호와 테스트로 확인한다 | 고치지 않고 의견만 |

- planner는 최상위 concern 하나만 맡고 그 최상위 문서(intent, requirements, domain model, architecture)와 관련 flow만 읽는다. 다른 최상위는 contract와 concern id로만 본다.
- reviewer는 implementer와 다른 model을 쓴다.

## worker 등급

| 등급 | model | 언제 |
|---|---|---|
| frontend | Opus 5.5 (`claude-opus-5-5`) | shell renderer, SDK UI 컴포넌트, ui-ux 규칙 같은 화면 작업 |
| 최상위 | Sonnet 5.5 (`claude-sonnet-5-5`) | 가장 어려운 문제와 아래 등급이 거듭 실패한 문제에만 |
| 상위 | gpt-6.1-sol (`sol-6-1-high`) | 판단이 큰 작업, 계획, contract, review |
| 기본 | grok 4.7 (`grok-4-7-xhigh`)와 space-bunny-max (`space-bunny-max`)를 1:1로 | 범위가 분명하고 구체적인 작업. 기본값 |

- 기본 등급의 두 model은 번갈아 배정한다. too many requests나 rate limit이 나면 그쪽 비율을 줄인다.
- 실패하면 올린다: 기본에서 같은 작업이 두 번 실패하면 상위, 상위에서도 실패하거나 처음부터 가장 어려운 문제면 최상위.
- workflow에서는 model을 alias(`sonnet`, `opus`)가 아니라 위의 정확한 이름이나 agent type으로 지정한다. alias는 다른 판으로 풀린 적이 있다.

## 주고받기

- 작업을 넘길 때는 [tasks.md](tasks.md)의 작업 모양 그대로 넘긴다. 대화 전체를 넘기지 않는다.
- 끝난 worker는 짧게 보고한다: 바꾼 자리, 통과한 check, 테스트가 가리키는 요구, 남은 것.
- 정할 수 없는 것은 문서에 쓰지 않고 open-issues에 `<concern id>#Q<n>`으로 올리고 추천안으로 진행한다. 사람에게 올릴 것은 lead가 고른다(제품 방향, 비용, 되돌리기 비싼 것만).
- contract를 바꿔야 하면 implementer가 직접 고치지 않고 integrator에게 요청한다.
- 두 팀이 같은 파일을 고쳐야 하면 lead가 순서를 정한다. 동시에 고치지 않는다.
