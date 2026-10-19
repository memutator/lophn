# agent-call

agent 사이의 call(일 맡기기와 답하기)을 Router가 배달하는 길의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/agent-call.md`.

## e2e의 Project Manager 줄이 PM 요청을 옛 App Engineer 줄로 보낸다

```yaml
kind: bug
modules: [tests]
```

지금: `tests/e2e/agent-call_test.ts`의 fake 대답 줄은 tool 목록으로 요청을 가른다. PM 줄은 `operator_create`가 있고 `app_create`·`ticket_create`가 없는 요청, `ae` 줄은 `ticket_create`가 있는 요청을 받는다. 이제 Project Manager가 옛 App Engineer의 tool(`ticket_create` 포함)을 가져 PM의 요청이 `ae` 줄로 간다. 계획 domain-place는 e2e를 돌리지도 고치지도 않아 type이 막는 입력 모양만 고쳤다.

영향: 이 e2e를 돌리면 PM이 받은 call에 엉뚱한 fake 대답이 와 떨어진다. 다른 e2e도 App Engineer를 전제로 짠 흐름이 남았을 수 있어, 돌리는 사람이 원인을 하나씩 찾아야 한다.

고치려면: e2e를 다시 돌리는 계획에서 PM 줄과 `ae` 줄을 하나로 합치고(PM은 `operator_create`가 있는 요청), App Engineer를 전제로 한 단계를 PM 단계로 다시 쓴다(중간). 추천.
