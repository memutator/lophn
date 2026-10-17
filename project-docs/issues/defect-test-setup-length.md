---
kind: defect
modules: [packages/core/approvals, packages/core/apps]
---

# test 준비 코드가 길다

지금: test 수는 적다(task당 1~4개). 준비 코드가 길다: `apps/calls/calls_test.ts` 344줄(test 3개), `approvals/approvals_test.ts` 336줄, `apps/rewind/rewind_test.ts` 279줄, `approvals/gate/gate_test.ts` 250줄.

왜 문제: test 하나 더하기가 비싸다.

고치려면: 공용 ledger fixture 하나로 모은다.
