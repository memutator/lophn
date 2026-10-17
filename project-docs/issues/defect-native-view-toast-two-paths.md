---
kind: defect
modules: [packages/shell/renderer]
---

# native view 위 toast가 두 길이다

지금: `overlay`가 있으면 overlay `notification` 표면, 없으면 DOM `Toast`.

왜 문제: toast 길이 둘이다.

고치려면: overlay 하나로.
