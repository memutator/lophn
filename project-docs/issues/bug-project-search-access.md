---
kind: bug
modules: [packages/core/projects]
---

# project 검색이 접근 권한을 안 본다

지금: apiRead가 port를 못 받아 project 접근 권한을 보지 않는다. user만 부르는 route다.

왜 문제: 접근 권한 없는 project도 검색에 나올 수 있다.

고치려면: apiRead가 port를 받게 해서 접근 권한을 본다.
