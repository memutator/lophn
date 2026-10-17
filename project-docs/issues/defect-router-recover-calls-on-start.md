---
kind: defect
modules: [packages/core/router]
---

# 켤 때 `RecoverCalls`

지금: 켤 때 `RecoverCalls`가 `accepted`이고 아직 안 가져간 call을 `lophn_restarted`로 닫고 보낸 session에 알린다.

왜 문제: 별도 복구 command가 하나 더 있다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
