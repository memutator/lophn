---
kind: defect
modules: [packages/protocol]
---

# `protocol/apps/direct-socket.ts`의 흔적

지금: core를 지나지 않던 앱 직통 통로는 지웠는데, supervisor 제어 경로 상수를 re-export하는 파일이 남아 `protocol/apps/mod.ts`가 내보낸다.

왜 문제: 죽은 이름이 남아 헷갈린다.

고치려면: 쓰는 곳을 supervision protocol로 바로 잇고 지운다.
