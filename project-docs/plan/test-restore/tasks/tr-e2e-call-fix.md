# tr-e2e-call-fix

agent call과 session 규칙, PM tool e2e를 지금 설계로 고친다. grant 준비를 걷고, B의 turn을 붙잡던 묻기를 `shellAsk`로, App Engineer lane을 `release_prepare`로 가르고, `operator_create` 허락 단계(지금은 묻지 않는다)를 뺀다. 묻지도 막지도 않는 agent call을 재던 `call-gate_test.ts`는 지운다(`architecture/approval.md`).

- 단위: e2e (wave 2)
- 선행: tr-e2e-approval.
- 소유(이 task만 고친다):
  - `tests/e2e/agent-call_test.ts`
  - `tests/e2e/session_test.ts`
  - `tests/e2e/pm-tools_test.ts`
  - `tests/e2e/call-gate_test.ts` (지운다)
- 계약:
  - 쓰는 것: tr-e2e-approval의 `tests/support/core/shell-ask.ts`와 옮긴 이름, `tests/support/core/human.ts`(`settle`: `app.create` 뒤 App Engineer session을 열기 전에 runtime child가 다시 뜨기를 기다린다), `packages/protocol/approvals/turn-request.ts`(`turnRequestDecide`)
  - 내놓는 것: 없음

## 할 일

세 file의 grant 준비·`file_write` 묻기·`ticket_create` lane·`"allow"`를 새 길로 바꾸고 `call-gate_test.ts`를 지운다.
