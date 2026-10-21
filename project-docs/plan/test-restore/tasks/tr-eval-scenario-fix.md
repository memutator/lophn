# tr-eval-scenario-fix

지운 tool과 setup에 묶인 판단 시나리오를 고친다. L6은 `guide.read` 대신 `guide-*` skill의 `skill.read`, A1-ask와 A12는 지운 `ticket.create` check를 지금 tool로, O4와 calendar-api는 되살린 world와 할당으로 Operator가 돈다. L7은 lophn이 앱·status·logs·invocations를 읽고 아무것도 쓰지 않는 것으로 다시 쓴다.

- 단위: eval (wave 2)
- 선행: tr-eval-restore, tr-eval-human.
- 소유(이 task만 고친다):
  - `tests/eval/scenarios/lophn/{L6,L7}.scenario.ts`
  - `tests/eval/scenarios/app-engineer/{A1-ask,A12}.scenario.ts`
  - `tests/eval/scenarios/operator/O4.scenario.ts`
  - `tests/eval/scenarios/calendar/calendar-api.scenario.ts`
  - `tests/eval/checks/tools.ts`
  - `tests/eval/registry/scenario/{L6,L7,A1-ask,A12,O4,calendar-api}.json`
- 계약:
  - 쓰는 것: tr-eval-prune-checks의 `createCalendarOperator`(할당), tr-eval-restore의 재료 판, `packages/core/agent-roles/skills`(`guide-*`), App Engineer와 lophn tool `app.get`, `app.list`, `app.status`, `app.logs`, `app.invocations`
  - 내놓는 것: 없음

## 할 일

여섯 시나리오의 죽은 tool 이름과 setup을 지금 tool과 world로 바꾸고 n을 올려, 시나리오마다 fixture check와 world 되살리기가 통과하게 한다.
