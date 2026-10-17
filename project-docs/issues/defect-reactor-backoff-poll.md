---
kind: defect
modules: [packages/core/events]
---

# Reactor의 backoff와 5초 poll 안전망, handler 이름 중복 검사

지금: Reactor의 backoff(1~30초)와 5초 poll 안전망, handler 이름 중복 검사를 둔다. 이유: spec의 "두 번 반응하지 않는다".

왜 문제: 가장 단순한 구현보다 무겁다.

고치려면: 추천: 남긴다. 이유를 코드 주석으로 옮기고 이 파일을 지운다.
