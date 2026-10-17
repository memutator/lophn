---
kind: defect
modules: [packages/core/lophn-agent]
---

# 끌 수 없는 내장 skill과 같은 이름의 사람 skill을 `skipped`에 남긴다

지금: 끌 수 없는 내장 skill과 같은 이름의 사람 skill은 `skipped`에 이유와 함께 남긴다.

왜 문제: skipped 기록이 하나 더 있다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
