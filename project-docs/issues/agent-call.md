# agent-call

agent 사이의 call(일 맡기기와 답하기)을 Router가 배달하는 길의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/agent-call.md`.

## e2e의 Project Manager 줄이 PM 요청을 옛 App Engineer 줄로 보낸다

```yaml
kind: bug
modules: [tests]
```

지금: `tests/e2e/agent-call_test.ts`의 fake 대답 줄은 tool 목록으로 요청을 가른다. PM 줄은 `operator_create`가 있고 `app_create`·`ticket_create`가 없는 요청, `ae` 줄은 `ticket_create`가 있는 요청을 받는다. 계획 domain-place에서는 Project Manager가 옛 App Engineer의 tool(`ticket_create` 포함)을 가져 PM의 요청이 `ae` 줄로 갔다. 계획 domain-entity가 App Engineer를 되살려 `ticket_create`는 다시 App Engineer에게만 있고, `tests/e2e/agent-call_test.ts`의 받는 쪽도 App Engineer(`{role: "app_engineer", app}`)로 바뀌었다. 그래서 두 줄이 다시 맞을 것이지만, 두 계획 모두 e2e를 돌리지 않아 확인하지 못했다.

영향: 이 e2e를 돌리면 PM이 받은 call에 엉뚱한 fake 대답이 와 떨어진다. 다른 e2e도 App Engineer를 전제로 짠 흐름이 남았을 수 있어, 돌리는 사람이 원인을 하나씩 찾아야 한다.

고치려면: e2e를 다시 돌리는 계획에서 이 test를 돌려 두 줄이 맞는지 보고, 틀리면 줄의 tool 조건을 지금 role 목록(`packages/core/agent-roles/tool-lists.ts`)에 맞춘다(작음). 추천.
