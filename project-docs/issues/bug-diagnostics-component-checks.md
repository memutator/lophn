---
kind: bug
modules: [packages/core/diagnostics]
---

# Diagnostics 점검이 core·ledger 둘뿐이다

지금: Diagnostics 점검은 core·ledger 둘만 본다. events·앱·sandbox·agent runtime 점검은 각 wiring이 `componentChecks.push`로 더해야 한다.

왜 문제: 나머지 component는 점검에 안 잡힌다.

고치려면: 각 wiring이 `componentChecks.push`로 점검을 더한다.
