# problems

앱의 문제 보고(observation), problem의 묶기와 상태, App Engineer와 coding agent가 진단에 읽는 근거다. architecture 문서는 아직 없다.

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

정한 것: program이 막는다(사람). agent 자격의 resolved는 마지막 발생의 release보다 뒤에 activate된 active release가 있을 때만 받는다. 사람은 지금처럼 바꾼다. App Engineer 지침에는 같은 조건을 썼다(고친 release가 active가 된 뒤에만 resolved, 고친 release 없이 닫아야 하면 `ask`). program이 막는 것은 남았다.
