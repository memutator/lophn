---
kind: bug
modules: [packages/core/projects, packages/protocol]
---

# md가 아닌 context 문서의 목차를 못 읽는다

지금: pdf·docs 개체는 늘 unreadable이다.

왜 문제: md 아닌 context 문서는 목차가 없다.

고치려면: `outlineSourceSchema.format`을 넓히고 context worker 요청에 저장 목차를 싣는 계약을 고친다(계약 고침 둘).
