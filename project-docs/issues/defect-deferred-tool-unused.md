---
kind: defect
modules: [packages/core/lophn-agent]
---

# deferred tool을 아무 tool에도 켜지 않는다

지금: assemble과 `tool.search`가 지원하지만 `run-loop/prepare.ts`가 어떤 tool에도 켜지 않는다.

왜 문제: 죽은 장치다.

고치려면: 지우거나 쓸 tool에 켠다.
