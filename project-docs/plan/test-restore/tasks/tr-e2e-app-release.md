# tr-e2e-app-release

`app-release_test.ts`를 다시 쓴다. README "정한 것" 표의 `app-release` 줄이 재는 것이다: template 앱으로 `release.prepare` → App Engineer의 `preview.start`·`preview.call`·`preview.stop`(live ledger와 data는 그대로) → `release.activate` → 동의 allow·reject. bundle file 수, source map, 읽기 전용 sdk를 본다. 준비가 떨어지면 `{status:"failed", stage, reason}`이고 release 행이 없다. coding MCP와 ticket examples 단계는 지운다.

- 단위: e2e (wave 2)
- 선행: tr-support-app.
- 소유(이 task만 고친다):
  - `tests/e2e/app-release_test.ts`
- 계약:
  - 쓰는 것: tr-support-app의 `tests/support/app/activate.ts`(`startTestApp`, `aeLane`, `tool`, `prepareRelease`, `activateRelease`, `approveActivation`, `waitRunning`), `deps.ts`(`appCoreEnv`); `packages/core/apps/agent-tools/preview.ts`(wire `preview_start`, `preview_call`, `preview_stop`), `packages/protocol/apps/previews.ts`, `packages/protocol/apps/releases.ts`(`RELEASE_FILE_MAX_COUNT`, `ReleasePrepareOutput`), `packages/protocol/apps/invocations.ts`(live ledger)
  - 내놓는 것: 없음

## 할 일

coding CLI·MCP·ticket 단계를 지우고 README 표의 `app-release` 줄을 새 helper와 App Engineer lane 대본으로 다시 쓴다.
