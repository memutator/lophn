---
type: guide
concerns: [platform, documents, apps, problems, lophn-agent, coding-agent, shell]
---
# lead와 worker

문서가 커서 한 세션이 전부를 읽을 수 없다. concern 경계가 잘려 있으니 작업 단위로 나눠 구현한다. lead가 직접 orchestration하고 worker를 띄운다. team member(2단)는 두지 않는다. 실제 병목은 선행의 직렬 사슬이라 팀 단위 중간 관리가 속도를 올리지 못했다.

## 2단 구조

| 단 | 누구 | model | 하는 일 | 고치는 것 |
|---|---|---|---|---|
| 1 | lead (주 세션) | Opus 5.5 | 선행이 열린 작업 고르기, worker 배정, review, PR 병합, 팀(concern) 사이 충돌 조정, 사람에게 묻기, 결정 기록 | `docs/plan/`, `docs/dev/`, open-issues.md |
| 2 | worker (lead가 띄우는 sub agent) | 아래 등급 | 작업 하나를 worktree에서 구현하고 PR을 올린다. 자기 sub agent는 띄우지 않는다 | 작업의 "자리"만 |

- concern 경계와 자리는 그대로다: contracts는 `packages/contracts/`·`packages/base/`, 최상위 concern은 `packages/<최상위>/`와 실행 entry, shell은 `apps/shell/`·`packages/design/`·`packages/sdk/ui-*`.
- worker는 작업 블록이 가리키는 자기 concern 문서와 관련 flow만 읽는다. 다른 최상위는 contract와 concern id로만 본다. contract가 바뀌어야 하면 lead에게 말한다.
- review는 lead가 diff를 직접 읽거나, 구현한 worker와 다른 model의 worker에게 맡긴다.

## worker 등급

| 등급 | model | 언제 |
|---|---|---|
| 기본 | glm-flash-max (`glm-flash-max`), hive-flash-max (`hive-flash-max`) | 대부분의 작업. 둘을 번갈아 쓴다 |
| 어려운 | grok 4.7 (`grok-4-7-xhigh`) | 설계 판단이 큰 작업, 보안·동시성·transaction 경계, 기본 등급이 실패한 작업, 큰 PR의 review |

- 실패하면 올린다: 기본 등급이 같은 작업을 한 번 실패하면 어려운 등급으로. 어려운 등급도 두 번 실패하면 lead가 작업을 더 잘게 나눈다.
- rate limit이 나면 그 model의 몫을 줄인다.
- harness는 동시에 20개까지 돌린다. full `deno task check`는 메모리 때문에 동시에 2개까지만 돌리고, worker는 평소 targeted test만 돌린다.

## 주고받기

- 작업을 넘길 때는 [tasks.md](tasks.md)의 작업 모양 그대로 넘긴다. 대화 전체를 넘기지 않는다.
- 끝난 worker는 짧게 보고한다: 바꾼 자리, 통과한 check, 테스트가 가리키는 요구, 남은 것.
- 정할 수 없는 것은 문서에 쓰지 않고 open-issues에 `<concern id>#Q<n>`으로 올리고 추천안으로 진행한다. 사람에게 올릴 것은 lead가 고른다(제품 방향, 비용, 되돌리기 비싼 것만).
- contract를 바꿔야 하면 worker나 다른 팀이 직접 고치지 않고 lead에게 요청한다.
- 두 작업이 같은 파일을 고쳐야 하면 lead가 순서를 정한다. 동시에 고치지 않는다.
