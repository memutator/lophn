# code-health

여러 module에 걸친 코드 건강 이슈다(죽은 이름, 긴 파일, test 준비 코드). 짝이 되는 architecture 문서는 없다.

## handler가 없거나 부르는 곳이 없는 route·command가 등록돼 있다

```yaml
kind: defect
modules: [packages/protocol, packages/core/lophn-agent, packages/core/main]
```

지금: 두 가지다.
- handler가 없는 route. 아래는 `ROUTES`나 runtime의 열린 목록(`RUNTIME_MACHINE_ROUTES`, `packages/core/lophn-agent/run-loop/runtime-access.ts`)에 있지만 core에 handler가 없어 dispatcher(`packages/core/server/dispatch.ts`)가 늘 `unavailable`을 낸다. `grep`으로 `route: <이름>` 정의가 없음을 확인했다.
  - `events/list`(`eventsList`, `packages/protocol/events/events.ts`). `architecture/event.md`는 기록 event를 읽는 곳으로 이 route를 적는다.
  - `identity/current`(`identityCurrent`, `packages/protocol/server/routes.ts`).
  - `messages/list`(`messagesList`)는 protocol registry에서 빼 두었지만 runtime 목록에는 남아 있다. `messages/receive`(`receiveMessage`)는 protocol에 등록돼 있고 입력 모양에 옛 assignment 칸이 남아 있다.
- handler는 있지만 부르는 곳이 없는 command(test 밖). `RecordReadToolCall`, `SupplementToolCall`(`packages/core/lophn-agent/tools/commands.ts`)과 `SupplementModelCall`(`packages/core/lophn-agent/usage/commands.ts`), `RecordProviderAvailability`(`packages/core/lophn-agent/providers/commands.ts`). 이 중 supplement 둘은 `tool_call_supplements`·`model_call_supplements` 표와 `ToolCallSupplemented` event까지 달고 있다.

영향: 어느 쪽도 사람이 보는 동작은 없다. 대신 새 route를 더하거나 고칠 때마다 protocol, 등록, 권한 목록, 문서, test를 따라가야 하고, 읽는 사람은 "core가 이 route를 제공한다"고 오해한다(예: runtime이 `events/list`를 부를 수 있다고 믿고 쓰면 늘 실패한다). supplement는 표와 event가 ledger schema에 영구히 남는다.

고치려면:
- handler 없는 route는 protocol 정의, `ROUTES`·runtime 목록, 문서 줄을 지운다. 작음. 부르는 곳이 없어 잃는 기능이 없다. 추천.
- 부르는 곳이 없는 command는 command와 route를 지운다. 표·event는 이미 낸 schema step을 고치지 않고 두거나, 비우는 새 step으로 지운다. 작음~중간. 다시 필요해지면 그때 만든다. 추천.
- 필요한 것이 있으면 handler를 만든다. 지금 쓰려는 곳이 없으므로 권하지 않는다.

## 쓰는 곳이 없는 감독·복구·해석 장치가 남아 있다

```yaml
kind: defect
modules: [packages/core/main, packages/core/apps, packages/core/storage, packages/core/lophn-agent, packages/core/supervision]
```

지금: 부르는 곳을 `grep`으로 찾은 것만 적는다(test 안에서만 쓰는 것은 부르는 곳으로 세지 않았다).
- 앱 restart 통로: `SupervisorLink.restart`(`packages/core/apps/runtime/supervisor-link.ts`), `SUPERVISOR_OPS.restart`(`control-protocol.ts`)와 그 처리기(`packages/core/main/app-supervisor/assembly.ts`), `supervisor.restart`(`packages/core/apps/runtime/supervisor/supervisor.ts`)가 한 줄로 이어져 있고 부르는 곳이 없다.
- 재시작 점검: `checkRestart`(`packages/core/storage/migration/restart.ts`)는 `core.ts`에서 부른 뒤 `restart.ok`만 보고 관측 목록(`observations`)은 쓰지 않는다. 소유 concern에서 모으는 `restartOwners`(`observeInvocations`, `observeReleaseActivations`)도 결과가 버려지고, 고정 관측("no_recovery_commands_registered")만 만든다. 실제 복구는 각 concern의 기동 때 sweep·recover가 한다.
- `resolveAgent`(`packages/core/lophn-agent/agents/resolve.ts`, 216줄): `agents/mod.ts`가 내보내고 test(`agent-tools_test.ts`)만 부른다. 타입 `ResolvedAgent`만 쓰인다.
- `driver.revokeServer`(`run-loop/driver.ts`)와 `refreshNow`(`packages/core/lophn-agent/models/work.ts`)는 부르는 곳이 없다.
- 감독 `onGiveUp`(`packages/core/supervision/responsiveness/slot.ts`)은 callback 칸만 있고 넘기는 곳이 없다.

영향: 읽는 사람과 AI가 "재시작 점검이 있다", "앱을 다시 띄우는 길이 있다"고 믿고 설계를 이어 간다(앞 이슈의 exit 0 앱은 이 restart 통로가 닿지 않아 안 뜬다). 장치마다 test와 문서 줄이 딸려 있어 고칠 때 같이 움직여야 한다.

고치려면: 위 항목을 test와 함께 지운다. 작음~중간. 앱 restart 통로는 앞 이슈(exit 0)를 고칠 때 supervisor 안에서 다시 띄우는 쪽이 낫고, 외부에서 부르는 restart는 필요해지면 만든다. 추천: 지운다.
