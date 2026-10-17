---
kind: defect
modules: [packages/core/apps]
---

# 끊긴 activation 시도를 이어받는다

지금: 차례가 온 release가 `activating`이면 새로 시작하지 않고 `recoverActivation`으로 잇는다. 실패 code는 `start_failed`. `activation/recovery.ts`.

왜 문제: 이어받기 경로가 따로 있어 무겁다.

고치려면: 기동 때 `activating`은 모두 실패로 닫고 복구본으로 되돌린다.
