# problems

앱의 문제 보고(observation), problem의 묶기와 상태, App Engineer와 coding agent가 진단에 읽는 근거다. architecture 문서는 아직 없다.

## 앱이 문제를 보고할 자리(observation)를 정하는 지침이 없다

```yaml
kind: bug
modules: [packages/core/agent-roles, packages/coding-agent, packages/sdk, packages/core/apps]
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

## 앱 template의 `withStore`가 업무 code의 예외까지 `store_unavailable`로 바꿔 원인을 지운다

```yaml
kind: bug
modules: [packages/core/apps]
```

지금:
- 앱 template `packages/core/apps/packages/template/app/src/app-api.ts.tmpl`의 `withStore`는 `openStore()`, `ensureSchema`, 업무 일 `work(store)`를 한 `try` 안에서 부른다.
- `AppApiRejection`이 아닌 예외는 무엇이든 `reportProblem("store_unavailable", "the item store could not be opened")`로 보고하고, `AppApiRejection("unavailable")`로 바꿔 던진다.
- 진입점(`packages/core/apps/runtime/entrypoint/invoke.ts`)은 거절을 보고 없이 돌려준다. stack과 함께 보고하는 것은 `Error`일 때뿐이다(`reportCaught`).
- 새 앱은 이 template에서 시작하므로, 이 꼴이 그대로 복사된다.

영향: 업무 code의 bug(SQL 오류, 잘못된 값 처리)가 모두 "저장소를 못 열었다"는 `store_unavailable` problem 하나로 묶이고, stack도 남지 않는다. App Engineer와 coding agent는 원인을 저장소로 잘못 읽고, 서로 다른 bug를 가르지 못한다.

고치려면: `try`를 `openStore()`와 `ensureSchema`에만 건다. `work(store)`의 예외는 그대로 던져, 진입점이 stack과 함께 보고하게 한다(작음). 추천: 이대로.

## agent가 보고의 message, details, stack, log 본문을 읽을 길이 없다

```yaml
kind: bug
modules: [packages/core/problems, packages/protocol, packages/coding-agent]
```

지금:
- App Engineer의 `problem.get` tool(`packages/core/problems/agent-tools.ts`)과 coding agent의 `problem show`(`packages/protocol/coding-agent/cli-commands.ts`)는 모두 route `problem.get`(`packages/protocol/problems/problem-views.ts`의 `problemGet`)을 읽는다.
- `reportProblem`으로 들어온 보고는 snapshot의 `error`가 `null`이다(`packages/core/problems/reporting/worker/collector.ts`). 그래서 이름만 보인다.
  - 앱이 쓴 message는 blob `report_text`에, details는 blob `report_details`에 있다.
  - log는 `snapshot.logs`에 blob hash와 줄 수만 있다(`packages/protocol/problems/snapshots.ts`).
- 본문을 주는 route는 둘이다: `problems.report_body`(`report_text`와 `snapshot_logs`, actors에 agent와 coding_agent)와 `GetSnapshotLogs`(사람만).
  - `problems.report_body`를 부르는 agent tool이나 CLI 명령은 없다.
  - `report_details`와 `snapshot_stack`은 읽는 route가 없다.
- coding agent의 `problem more logs`도 hash만 준다.
- 그런데 `problem.get` tool 설명은 "evidence (error, stack frames, invocation, logs)"를 준다고 한다.

영향: 앱이 `reportProblem`으로 남긴 원인 설명과 그때의 log를 App Engineer도 coding agent도 읽지 못해, problem 이름 하나로 ticket을 쓰고 수리한다. coding agent의 `app logs`는 지금의 buffer라 그 시각의 log가 이미 밀렸을 수 있다.

고치려면:
- `problem.get`의 latest에 보고 message 앞부분을 싣는다(작음). `problem.get_occurrence`가 이미 2,000자 preview를 만든다.
- log 본문을 읽는 길을 더한다(작음~중간). coding agent의 `problem more`와 App Engineer의 tool이 `problems.report_body`로 읽게 한다.
- details를 읽는 field를 `problems.report_body`에 더한다(작음).
- `problem.get` tool 설명을 실제로 주는 것에 맞춘다.
- 추천: 넷 다.

## 고친 release 없이 resolved로 바꾸면 같은 release의 새 발생이 묻힌다

```yaml
kind: bug
modules: [packages/core/problems, packages/core/agent-roles]
```

지금:
- `problem.set_state`(`packages/core/problems/grouping/commands.ts`, actors agent와 user)는 resolved로 바꿀 때 고친 release가 있는지 보지 않는다.
- 해결됨인 problem은 새 발생의 release가 해결 시각 뒤에 activate되었을 때만 다시 열린다(`packages/core/problems/reporting/model.ts`의 `reopenDecision`). 그보다 앞선 release의 발생은 쌓이기만 한다(`packages/core/problems/reporting/commands.ts`의 `reopenIfRecurred`).
- App Engineer 지침은 "Use `problem.set_state` only when the evidence supports the new state"라고만 한다.

영향: App Engineer가 고친 release 없이 problem을 resolved로 바꾸면, 같은 release에서 계속 나는 발생이 그 problem에 조용히 쌓인다. `ProblemReopened`가 없으니 program은 App Engineer를 다시 부르지 않고, 사람의 열린 문제 목록에서도 빠진다. 앱이 계속 실패하는데 아무도 모른다.

고치려면:
- agent 자격이 resolved로 바꿀 때는, 마지막 발생의 release보다 뒤에 activate된 active release가 있어야 받는다(작음). 사람은 지금처럼 바꿀 수 있다. 고친 release 없이 닫을 일(설정을 바꿔 고친 것)은 agent가 사람에게 묻는다.
- 해결됨 뒤의 발생은 release와 상관없이 다시 연다(작음). 다만 옛 release가 drain되는 동안의 발생에도 다시 열려, reaction이 되풀이된다.
- 지침에 "고친 release가 active가 된 뒤에만 resolved"를 쓴다(작음). program이 막지는 않는다.
- 추천: 첫째.

정할 것: agent가 problem을 닫는 조건을 program이 막을지(첫째), 지침에만 둘지(셋째).
