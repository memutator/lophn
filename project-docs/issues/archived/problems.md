# problems (닫음)

## 앱이 문제를 보고할 자리(observation)를 정하는 지침이 없다

```yaml
kind: bug
modules: [packages/core/agent-roles, packages/coding-agent, packages/sdk, packages/core/apps]
closed: fixed
guard: 없음
```

지금:
- 앱은 `@lophn/cap-problem`의 `reportProblem(name, message, details?)`로 자기 문제를 보고한다(`packages/sdk/cap-problem/guide.md`).
- 잡히지 않은 예외와 handler가 던진 `Error`는 진입점이 저절로 보고한다(`packages/core/apps/runtime/entrypoint/main.ts`, `packages/core/apps/runtime/entrypoint/invoke.ts`).
- 그 밖의 실패를 어디서 보고할지는 아무 지침에도 없다. 예: 거절로 끝나는 업무 분기, 외부 호출 실패, 조용히 넘어가는 fallback.
  - App Engineer 지침(`packages/core/agent-roles/roles/app-engineer/prompt.md`), coding agent skill `lophn-build-app`과 `lophn-repair`, blueprint, ticket schema에는 `reportProblem`이나 보고 자리에 대한 줄이 없다.
  - 앱 template의 한 줄과 예 하나뿐이다. 한 줄은 `packages/core/apps/packages/template/app/AGENTS.md.tmpl`의 "문제 보고는 `reportProblem(name, message)`만 부른다", 예는 `packages/core/apps/packages/template/app/src/app-api.ts.tmpl`의 `store_unavailable`이다.
- guide는 API만 말한다. 같은 이름의 보고는 한 problem으로 묶이므로 원인마다 이름을 나누라는 말이 없다.

영향:
- coding agent가 만든 앱이 실패해도 problem이 열리지 않는 분기가 생긴다. 그러면 program이 App Engineer를 부르지 않고(AGENT-ROLE E1), 사람도 문제 목록에서 그 실패를 보지 못한다.
- 원인이 다른 실패가 한 이름으로 보고되면 한 problem으로 섞여 진단이 흐려진다.

고치려면:
- 지침으로 둔다(작음).
  - App Engineer 지침: 앱을 만들거나 기능을 더하는 ticket에 보고할 실패 분기와 이름을 적는다.
  - `lophn-build-app` skill: 그 분기마다 `reportProblem`을 두고, 원인마다 이름을 나눈다.
  - cap-problem guide: 이름으로 묶는 규칙을 적는다.
- blueprint에 보고 이름을 선언하게 하고 `blueprint.check`가 본다(큼). 지금 guide는 이름을 선언하지 않는다고 정해 두어, 이 규칙부터 바꿔야 한다.
- 추천: 첫째.

정한 것: 보고 자리를 정하는 일은 App Engineer가 맡는다(사람). App Engineer는 code를 쓰지 않으므로 ticket에 적고, coding agent가 그 자리에 둔다.

닫음: App Engineer 지침이 앱을 만들거나 기능을 더하는 ticket에 보고할 실패 분기와 이름을 적게 하고(AGENT-ROLE A15), `lophn-build-app` skill이 그 분기마다 `reportProblem`을 두게 하며, cap-problem `guide.md`가 이름으로 묶는 규칙을 쓴다.

## 앱 template의 `withStore`가 업무 code의 예외까지 `store_unavailable`로 바꿔 원인을 지운다

```yaml
kind: bug
modules: [packages/core/apps]
closed: fixed
guard: 없음
```

지금:
- 앱 template `packages/core/apps/packages/template/app/src/app-api.ts.tmpl`의 `withStore`는 `openStore()`, `ensureSchema`, 업무 일 `work(store)`를 한 `try` 안에서 부른다.
- `AppApiRejection`이 아닌 예외는 무엇이든 `reportProblem("store_unavailable", "the item store could not be opened")`로 보고하고, `AppApiRejection("unavailable")`로 바꿔 던진다.
- 진입점(`packages/core/apps/runtime/entrypoint/invoke.ts`)은 거절을 보고 없이 돌려준다. stack과 함께 보고하는 것은 `Error`일 때뿐이다(`reportCaught`).
- 새 앱은 이 template에서 시작하므로, 이 꼴이 그대로 복사된다.

영향: 업무 code의 bug(SQL 오류, 잘못된 값 처리)가 모두 "저장소를 못 열었다"는 `store_unavailable` problem 하나로 묶이고, stack도 남지 않는다. App Engineer와 coding agent는 원인을 저장소로 잘못 읽고, 서로 다른 bug를 가르지 못한다.

고치려면: `try`를 `openStore()`와 `ensureSchema`에만 건다. `work(store)`의 예외는 그대로 던져, 진입점이 stack과 함께 보고하게 한다(작음). 추천: 이대로.

닫음: `app-api.ts.tmpl`의 `withStore`는 `try`를 `openStore()`와 `ensureSchema`에만 건다. 업무 일의 예외는 그대로 던져 진입점이 stack과 함께 보고한다.
