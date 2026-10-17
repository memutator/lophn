---
kind: defect
modules: [packages/shell/renderer, packages/protocol, packages/core/projects]
---

# project 등록 slug 재시도

지금: 화면은 이름만 받고 core-source가 slug를 만들어 `conflict`면 `-2`…`-5`로 다섯 번까지 다시 보낸다.

왜 문제: slug 충돌을 화면 쪽이 다시 보내며 푼다.

고치려면: `project.create`의 `name`을 core가 정하게 한다(계약 변경).
