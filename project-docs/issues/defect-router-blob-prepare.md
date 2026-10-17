---
kind: defect
modules: [packages/core/main, packages/core/router]
---

# 본문과 고정 문구를 writer 앞 처리기에서 blob으로 미리 준비한다

지금: call 본문(redaction 포함), 실패 문구, 취소 알림, `receiver_ended` 문구를 writer 앞 처리기에서 blob으로 준비한다. `main/daemon/wiring/router.ts`. 이유: 받는 session 기록의 본문이 blob이어야 하고 tx 안에서 blob을 못 만든다.

왜 문제: 고정 문구까지 blob으로 만들어 무겁다.

고치려면: 고정 문구는 blob 대신 짧은 inline 글로 기록한다(계약 변경 필요).
