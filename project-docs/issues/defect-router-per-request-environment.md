---
kind: defect
modules: [packages/core/router, packages/core/main]
---

# Router·command·read를 요청마다 만들고 `RouterEnvironment`를 전역에 놓는다

지금: Router·command·read를 요청마다 만들고, Worker가 `router-registration.ts`를 import할 때 `RouterEnvironment`를 전역에 놓는다.

왜 문제: 전역 mutable 상태를 두지 않는 규칙(AGENTS.md)과 어긋난다.

고치려면: 환경을 인자로 받게 바꾼다.
