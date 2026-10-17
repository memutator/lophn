---
kind: bug
modules: [packages/core/main, packages/core/diagnostics]
---

# crash가 diagnostic log에 안 남는다

지금: daemon·agent runtime에 unhandled rejection listener가 없고 `createDiagnosticHost`를 만드는 곳이 없어 crash가 diagnostic log에 남지 않는다.

왜 문제: crash 원인을 나중에 볼 수 없다.

고치려면: 작은 fix 하나로 listener와 host 생성을 붙인다.
