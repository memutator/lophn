# tr-e2e-operator

`operator_test.ts`를 할당(assignment) 설계로 다시 쓴다. README "정한 것" 표의 `operator` 줄이 재는 것이다: 할당의 `removed_tools`로 뺀 tool이 보이지 않는다, domain 좁히기, 할당 없음, session 중 할당이 바뀌면 알림, `operator.create`는 묻지 않는다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/operator_test.ts`
  - `tests/support/app/patch-domain.ts`
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`activateTestApp`, `TestApp`), `deps.ts`(`appCoreEnv`); `packages/protocol/approvals/assignment.ts`(`agentAssignmentGet`, `agentAssignmentSet`), `packages/protocol/lophn-agent/input-tags.ts`(`tools_changed`)
  - 내놓는 것: 없음

## 할 일

grant·ask-reject·ask-allow 단계를 걷고 README 표의 `operator` 줄을 `agentAssignmentSet`과 새 helper로 다시 쓴다.
