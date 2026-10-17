---
kind: bug
modules: [packages/shell/renderer, packages/core/projects]
---

# 열린 PM session에 위반 chip이 안 붙는다

지금: 열린 session에는 chip을 붙일 계약이 없어, 비어 있는 draft에 위반 줄을 글로 채운다. 새 PM 탭은 chip이 붙는다.

왜 문제: 열린 PM session과 새 PM 탭의 위반 표시가 다르다.

고치려면: 열린 session에 chip을 붙이는 계약을 짓는다.
