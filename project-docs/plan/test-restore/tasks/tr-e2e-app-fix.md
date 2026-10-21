# tr-e2e-app-fix

앱 data rewind와 앱 재시작 e2e를 새 app helper로 고친다. `reaction_test.ts`를 지우면서 그 안의 "앱이 계속 죽으면 `appRuntime`이 `unavailable/crash_loop`이고 Gateway가 `AppRestartHalted` 하나를 받는다"를 `app-restart_test.ts`의 단계로 옮긴다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/app-data-rewind_test.ts`
  - `tests/e2e/app-restart_test.ts`
  - `tests/e2e/reaction_test.ts` (지운다)
  - `tests/support/app/patch-rewind.ts`
  - `tests/support/app/patch-restart.ts`
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`activateTestApp`, `TestApp`, `waitRunning`), `deps.ts`(`appCoreEnv`), `patch-crash.ts`(`crashPatch`); `packages/protocol/approvals/assignment.ts`의 `agentAssignmentSet`(grant 대신); `packages/protocol/events/transient.ts`의 `AppRestartHalted`; `tests/support/gateway/mod.ts`(`connectGateway`)
  - 내놓는 것: 없음

## 할 일

두 file의 준비를 새 helper·`agentAssignmentSet`·옮긴 `deps.ts`로 바꾸고, crash loop 단계를 `app-restart_test.ts`에 더한 뒤 `reaction_test.ts`를 지운다.
