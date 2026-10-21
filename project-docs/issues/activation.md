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

## App Engineer가 `deno.json`에 더한 의존이 앱 폴더의 `deno task check`·`test`에서 풀리지 않는다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금: 템플릿 `deno.json`(`packages/core/apps/packages/template/app/deno.json.tmpl`)의 `check`·`test`·`wording` task는 `--import-map=.lophn/import-map.json`으로 돌아 `deno.json`의 `imports`를 읽지 않는다. 그 map은 `scaffoldApp`(`packages/core/apps/packages/template/scaffold.ts`)이 쓰는데, 부르는 곳은 `app.create`가 source 폴더를 깔 때(`packages/core/apps/registration/source-folder.ts`, `packages/core/main/daemon/wiring/apps.ts`의 `withSourceFolder`) 하나다. App Engineer가 나중에 `deno.json`에 `npm:`·`jsr:` 의존을 더하면 map에 그 이름이 없어 `deno task check`와 `deno task test`가 "not in import map"으로 떨어진다. release 준비는 staging에서 map을 새로 만들어(`packages/core/apps/releases/prepare/from-source.ts`) 지나가므로 둘이 어긋난다. eval 되살리기는 재료의 `deno.json`을 얹은 뒤 `scaffoldApp`을 다시 불러 피한다(`tests/eval/restore/active-app.ts`).

영향: App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md` "Test")은 준비 전에 앱 폴더에서 `deno task check`·`deno task test`를 돌리게 한다. 의존을 더한 앱은 그 단계가 늘 떨어져 App Engineer가 map을 손으로 고치거나 test 없이 준비로 간다. map을 다시 쓸 tool도 없다.

고치려면:
- 템플릿 task가 돌기 전에 `deno.json`에서 dev map을 다시 쓴다. 설치 SDK 위치는 지금 map의 `lophn-sdk` 항목에서 읽는다(작음). **추천.** 사람과 agent 모두 같은 task로 돈다.
- core가 `shell.run`이나 file 쓰기 뒤 앱 source의 `deno.json`이 바뀌었으면 map을 다시 쓴다(중간. agent tool 길에 앱 일을 섞는다).
