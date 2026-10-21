# tr-e2e-ask-fix

turn request를 기다리는 동안의 동작을 보는 e2e 여섯을 지금 설계로 고친다. 묻게 하던 `file_write LOPHN.md`(지금은 묻지 않는다)를 `shellAsk`로, `"allow"`를 `"once"`로, `permission_requests`·`PermissionRequested`·`approvalsDecideTurn`을 새 이름으로 바꾼다. 재는 것은 그대로다.

- 단위: e2e (wave 2)
- 선행: tr-e2e-approval.
- 소유(이 task만 고친다):
  - `tests/e2e/{gateway,restart,rewind,steer,stop,turn-fate}_test.ts`
- 계약:
  - 쓰는 것: tr-e2e-approval의 `tests/support/core/shell-ask.ts`(`shellAsk`, `ShellAsk`)와 옮긴 이름, `tests/support/core/human.ts`(`waitPermission`, `decide(…, "once" | "always" | "reject")`), `tests/support/gateway/mod.ts`(`connectGateway`), `packages/protocol/events/agent.ts`(`TurnRequestOpened`)
  - 내놓는 것: 없음

## 할 일

여섯 file에서 묻는 trigger를 `shellAsk`로 바꾸고 옛 이름을 새 이름으로 고쳐 file마다 `deno test --allow-all --no-check tests/e2e/<file>`이 통과하게 한다.
