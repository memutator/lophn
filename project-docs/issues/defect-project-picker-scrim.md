---
kind: defect
modules: [packages/shell/renderer]
---

# project 고르기 scrim

지금: view를 project 없이 먼저 열고, state의 `project`가 null이면 scrim을 얹고 `useViewCover`로 native view를 숨긴다.

왜 문제: view를 먼저 열고 덮는 방식이라 무겁다.

고치려면: project를 고른 뒤에 view를 연다.
