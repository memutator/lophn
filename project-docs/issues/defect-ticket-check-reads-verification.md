---
kind: defect
modules: [packages/core/apps]
---

# check는 test를 다시 돌리지 않고 기록된 Verification만 읽는다

지금: check는 test를 다시 돌리지 않고 기록된 Verification만 읽는다. 가벼운 쪽으로 간 결정이다.

왜 문제: 결함은 아니고 결정을 기록해 둔 것이다.

고치려면: 추천: 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
