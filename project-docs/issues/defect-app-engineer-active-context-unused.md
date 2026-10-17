---
kind: defect
modules: [packages/core/lophn-agent]
---

# App Engineer active context 읽기가 쓰이지 않는다

지금: `agents/layers.ts`가 읽지만 `visibleContexts`가 App Engineer에 아무것도 보여 주지 않아 쓰이지 않는다.

왜 문제: 죽은 코드다.

고치려면: 읽기를 지우거나 `visibleContexts`와 맞춘다.
