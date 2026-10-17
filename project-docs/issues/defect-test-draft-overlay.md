---
kind: defect
modules: [packages/core/projects]
---

# `bundle.test_draft`가 worker 유무에 따라 다르게 돈다

지금: `bundle.test_draft`가 worker가 있으면 overlay로 검사를 끝까지 돌리고, 없으면 `running`을 낸다.

왜 문제: 경로가 둘이다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
