# tr-e2e-app-activation

`app-activation_test.ts`를 App Engineer가 직접 올리는 흐름으로 다시 쓴다. README "정한 것" 표의 `app-activation` 줄이 재는 것이다: migration이 실패하면 data와 앞 release가 남고 실패가 `release_activate` 결과의 `migration_failed`(단계와 SQLite 오류 글)와 release `failure`에 실린다. 선언을 넓히면 `waiting_consent`이고, 새 release가 나오면 옛 동의 줄이 닫힌다(늦은 동의는 `conflict`). 되돌리기, drain 동안 잡아 둔 호출, 재시작 뒤에도 남는 허락은 그대로 본다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/app-activation_test.ts`
  - `tests/support/app/patch-migration.ts`
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`startTestApp`, `aeLane`, `prepareRelease`, `activateRelease`, `deliverRelease`, `approveActivation`, `waitRunning`), `source.ts`(`amendAppSource`), `deps.ts`(`appCoreEnv`); `packages/protocol/apps/activation/consent.ts`(`activationConsents`, `activationConsent`), `packages/protocol/apps/activation/activation.ts`(release 기록과 `failure`), `packages/protocol/events/transient.ts`(`ActivationConsentRequested`, `ActivationConsentClosed`), `tests/support/gateway/mod.ts`
  - 내놓는 것: 없음

## 할 일

옛 ticket·reaction·`approvalsDecide`·`reportHarness` 단계를 `release_prepare`·`release_activate` lane과 `activation.consent`로 바꿔 README 표의 줄을 하나씩 다시 쓴다.
