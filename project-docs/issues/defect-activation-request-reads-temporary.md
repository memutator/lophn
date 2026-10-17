---
kind: defect
modules: [packages/core/main, packages/core/apps]
---

# activation 요청 읽기(`approval-reads.ts`)가 임시 구현이다

지금: activation 요청 읽기(`approval-reads.ts`)를 approval 표를 직접 읽는 임시 구현으로 두었다(`core/main/daemon/wiring/`).

왜 문제: 다른 module의 표를 직접 읽는다.

고치려면: 임시 구현을 정식 읽기로 바꾼다.
