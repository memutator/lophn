# activation

App Engineer가 준비한 release를 운영 앱으로 올리는 순서와 실패 복구, 그 앞의 release 준비. `project-docs/architecture/activation.md`.

## release 준비의 handler 검사가 떨어지면 이유가 "probe was rejected (409)"뿐이다

```yaml
kind: bug
modules: [packages/core/apps, packages/core/main]
```

지금: blueprint가 선언한 tool과 앱이 등록한 handler가 다르면 `release.prepare`가 `{status: "failed", stage: "handlers", reason: "probe was rejected (409)"}`를 돌려준다. 앱 진입점의 `handleControl`(`packages/core/apps/runtime/entrypoint/control.ts`)이 `/probe`에서 `appToolsMatchBlueprint`로 먼저 비교해 409 "registered tool differ from the blueprint"로 거절하고, `packages/core/main/app-supervisor/assembly.ts`의 `probeChild`는 그 본문을 버리고 status만 reason에 싣는다. 그래서 빠진 tool과 더해진 tool의 이름을 싣는 preview launcher(`packages/core/apps/preview/launcher.ts`)의 비교는 probe가 200일 때만 돌아 이 경우에 닿지 않는다. test helper로 handler 없는 tool 하나를 선언한 앱을 준비해 이 글을 봤다.

영향: App Engineer는 어느 tool의 handler가 빠졌는지 모른 채 다시 짓는다. 앱 source를 다시 읽어 blueprint와 `src/tools.ts`를 손으로 대야 하고 그동안 release를 못 낸다.

고치려면:
- 진입점이 409 본문의 message에 빠진 tool과 더해진 tool의 이름(각 5개와 "and N more")을 싣고, `probeChild`가 거절 본문의 message를 reason에 붙인다(작음). **추천.** 두 번째로 고치는 bug라 그 reason을 보는 test를 같이 쓴다.
- 진입점이 preview mode에서는 비교를 launcher에 맡긴다(작음. live와 preview가 다른 길이 된다).

다시 생김: archived "release 준비가 떨어진 이유가 고칠 곳을 가리키지 않는다"의 handlers 갈래는 launcher가 두 목록 차이를 summary에 싣게 해 닫았다(guard `packages/core/apps/releases/prepare/checks_test.ts`). 같은 증상이 진입점의 앞선 거절로 다시 보인다. guard는 launcher를 가짜 probe로 돌려 진입점의 거절을 보지 못했다.
