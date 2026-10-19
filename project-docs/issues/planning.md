# planning

계획을 열고 brief를 쓰고 lead에게 넘기는 흐름(planner skill, orchestrate skill, `project-docs/plan/tools/`)의 열린 이슈다.

## brief를 worker 하나가 써서 계획 하나에 30분 넘게 걸린다

```yaml
kind: defect
modules: [tools]
```

지금: planner skill(`.claude/skills/planner-persona/SKILL.md` "계획 열기" 3)은 "brief는 worker 하나에게 쓰게 한다(계획 하나의 task는 서로 얽혀 있으니 한 손으로)"고 정한다. worker 하나가 README·roadmap·architecture를 읽고, 실제 코드를 열어 path·export를 확인하며, task마다 brief를 쓰고, 소유가 겹치는지 본다.

2026-10-19 domain 개편에서 brief worker 한 명이 걸린 시간:

| 계획 | task | 시간 |
|---|---|---|
| `artifact` | 17 | 약 25분 |
| `domain-tools` | 11 | 약 28분 |
| `domain-place` | 23 | 약 35분 |
| `domain-kinds` | 18 | 약 38분 |
| `domain-split` | 11 | 약 35분(모델이 바뀌어 버림) |

네 계획을 같이 열 때는 계획마다 worker를 하나씩 두어 병렬로 돌았다. 계획 하나 안에서는 늘 직렬이다.

영향: 사람이 방향을 정한 뒤 lead가 일을 시작하기까지 30분 넘게 기다린다. 모델을 다시 정하면 그 시간을 처음부터 다시 쓴다(`domain-split` → `domain-entity`). 코드를 읽는 일이 대부분이라 한 사람 몫으로는 줄지 않는다.

고치려면:
- **뼈대와 살을 나눈다(중간).**
  - 1단계: 한 worker가 task id, 소유 path, wave·선행, 계약 모양만 짧게 정한다. 서로 맞물리는 것을 이 단계가 다 잡는다.
  - 2단계: 영역별 worker 여럿이 뼈대를 고정한 채 각자 맡은 brief의 할 일, 읽을 것, 실제 path, 위험 test를 코드를 읽으며 채운다. 다른 영역의 소유와 계약은 못 고친다.
  - planner skill 문장과 brief worker prompt를 고친다.
- **brief를 줄인다(작음).** planner skill 3이 이미 말하듯, 결정이 README에 다 있으면 brief 없이 lead가 worker prompt에 할 일과 소유만 쓴다. 큰 계획에는 맞지 않는다.
- **planner가 뼈대를 직접 쓰고, 살만 worker 여럿에게 맡긴다(중간).** planner의 context를 쓴다.

추천: 첫째. 일관성은 1단계가 지키고, 오래 걸리는 코드 읽기는 2단계에서 병렬로 돈다.

정할 것: 위 안을 planner skill에 넣을지(다음에 계획을 열 때 사람이 정한다).
