---
kind: defect
modules: [packages/core/approvals, packages/core/main]
---

# Gate 물음과 ask 기다림을 core main thread 메모리 route 둘로 둔다

지금: Gate 물음과 ask 기다림을 core main thread 메모리 route 둘로 둔다(runtime은 긴 호출 한 번). 꺼졌다 켜지면 사라진다. 가벼운 쪽이다.

왜 문제: 꺼졌다 켜지면 사라진다.

고치려면: 추천: 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
