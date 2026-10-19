# agent-call

agent 사이의 call(일 맡기기와 답하기)을 Router가 배달하는 길의 열린 이슈다. 흐름과 불변 조건은 `project-docs/architecture/agent-call.md`.

## App Engineer의 부를 수 있는 목록에 다른 앱의 App Engineer가 없다

```yaml
kind: bug
modules: [packages/core/agent-roles, packages/core/apps]
```

지금: place prompt의 "Agents you can call"(`packages/core/agent-roles/place/place-data.ts` `readPlaceData`)은 session 없는 App Engineer 후보를 그 agent 자격의 `appList`로 모은다. `appList`(`packages/core/apps/registration/reads.ts`)는 `authorizeApp`의 범위로 거르므로(`deniedByScope`) App Engineer에게는 자기 앱만 돌려준다. 그래서 App Engineer의 목록에는 다른 앱의 App Engineer가 없다. call 자체는 막히지 않는다(`resolveAgent`는 앱 이름으로 찾고 Gate는 grant만 본다).

영향: 다른 앱의 일을 그 앱 주인에게 넘겨야 하는 App Engineer가 넘길 상대를 못 보고 lophn에게 넘기거나 직접 한다. eval A14-other가 첫 experiment에서 이것으로 떨어졌다(`tests/eval/experiments/call-list-without-session/report.md`).

고치려면:
- 후보 모으기를 agent 자격의 place read가 아니라 core의 `session.list` read(`packages/core/router/reads.ts` `sendableRead`)로 옮긴다. wiring이 lophn, 활성 project의 Project Manager, 활성 앱의 App Engineer, 문제없는 Operator를 후보로 내고 Router가 지금처럼 `CallGate.visible`로 거른다(중간). 목록과 call이 같은 규칙 하나로 정해지고, place-data의 grant 읽기와 `agentGrantsGet`의 agent actor가 필요 없어져 `project-docs/issues/approval.md`의 `sessions` 직접 읽기도 같이 없어진다. 추천.
- App Engineer 자격의 `appList`가 다른 앱을 돌려주게 범위를 넓힌다(작음). 앱 목록 read의 범위 규칙을 이 목록 하나 때문에 바꾸고, grant 읽기는 남는다.
