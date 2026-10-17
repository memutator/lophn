---
kind: bug
modules: [packages/core/lophn-agent, packages/protocol]
---

# session 되살리기 handler가 없다

지금: protocol에 `unarchiveSession` route가 있는데 core handler가 없다.

왜 문제: 보관한 session을 되살릴 수 없다.

고치려면: core handler를 짓는다.
