---
kind: defect
modules: [packages/shell/main]
---

# harness 감지 결과를 shell main 메모리에 쥔다

지금: harness 감지 결과를 shell main 메모리에 쥐고, 실패한 결과는 쥐지 않아 다음 읽기가 다시 감지한다. 가벼운 쪽이다.

왜 문제: 결함은 아니고 결정을 기록해 둔 것이다.

고치려면: 추천: 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
