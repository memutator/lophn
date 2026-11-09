# flows: 여럿을 다시 조사하는 절차

2026-11의 첫 전수 조사(area 19, flow 648, outcome 3,098)에서 쓴 방식이다. worker와의 대화는 영어로 한다(AGENTS.md "worker").

## 나누기

- worker 하나가 file 하나를 쓴다. 다른 file은 읽기만 한다. 겹침은 이것으로 막는다.
- entry는 `areas.yaml`의 path로 이미 area에 나뉘어 있다. worker는 `entries --area <a>`의 entry만 소유한다.
- `ui:`·`system:` flow는 그 area의 `owns`에 있는 mechanism만 쓴다. 밖의 것을 찾으면 쓰지 않고 "outside"로 보고한다.
- 아직 없는 다른 area의 flow는 entry ID로 가리킨다(`pre`, `uses`).

## 순서

1. domain area(entry가 route·tool·skill·control인 area와 shell 화면 area)를 모두 병렬로.
2. review: area 둘씩 묶어 sonnet-high. 아래 기준으로 재고 표본에서 찾은 것은 고친다.
3. fix pass: review가 찾은 반복 실수를 file 전체에서 훑는다(area마다 worker 하나).
4. gap fill: test 연결·surface·journey worker가 "missing"으로 보고한 동작을 그 area에 더한다. surface `links`와 test `covers`는 gap fill이 쓰지 않고 목록으로 넘긴다.
5. surface(cli, keys, ipc, sdk)는 domain flow가 있어야 하므로 1 뒤에. test 연결(`test_groups`마다)과 journey(`journey_groups`마다)도 1 뒤에 병렬로.
6. 마무리 셋을 병렬로, file 묶음을 나눠: areas(남은 `links`, 안 쓰인 event를 observe에), tests(넘겨받은 `covers`, 끊긴 참조), journeys(끊긴 참조, 이제 flow가 생긴 gap을 step으로).
7. `check` 전체와 `report`. 불합격 area는 새 seed로 다시 잰다.

규칙이 도중에 정해지면 README를 고치고 도는 worker 모두에게 알린다. 늦게 정한 규칙은 이미 끝난 area에 fix pass로 다시 건다.

## brief에 넣을 것

- AGENTS.md, README, `areas.yaml`의 자기 area(`owns`, `read`), 자기 file 하나만 고칠 것, code를 바꾸거나 commit하지 말 것.
- outcome은 code에서만. 확신이 없으면 `unclear`.
- 끝나기 전 `check --file <자기 file>` 통과.
- 숫자로 보고: entry 수·소유·ignore, flow, outcome, `ui:`·`system:` flow, risk flow, `unclear`, outside, 모호했던 README 규칙.

## review 기준

- precision: `sample --n 5 --seed <s>`로 고른 flow 5개를 code와 대조한다. entries, steps, outcomes(빠짐과 지어냄), observe, `crosses_process`, risk. 큰 오류가 없으면 1.
- recall: area handler의 실패 갈래(`err(`, 실패 상태, 거절) 가운데 무작위 3개를 골라 맞는 flow의 outcome에 있는지 본다.
- 통과: precision 4/5 이상이고 recall 2/3 이상.
- 보고: 점수, 고친 것(flow, 칸, 전→후, code path), 반복 실수 패턴. 패턴은 README 규칙과 fix pass brief로 간다.

첫 조사에서 첫 review는 15 area 가운데 8개가 통과했고, fix pass와 gap fill 뒤 다시 잰 6개 가운데 5개가 통과했다. 가장 흔한 실수는 위 SKILL.md "flow와 outcome을 쓸 때"의 목록이다.

## model

- 조사, fix pass, gap fill, test 연결, journey: 사람이 정하지 않으면 `sonnet-high`. 첫 조사는 사람이 정해 haiku-xhigh로 했다.
- review, bug 후보 검증, 마무리: `sonnet-high`.

## 조사가 남기는 것

- bug 후보는 worker 보고에서 모아 `issue` skill대로 code와 대조한 뒤 올린다. 첫 조사에서는 약 90건 중 16건이 남았다.
- `unclear` 줄은 정할 것의 목록이다. 많으면 원칙으로 묶어 정한다.
