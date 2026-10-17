---
kind: bug
modules: [packages/shell/renderer, packages/core/lophn-agent]
---

# 새 session 첫 말의 context chip을 core가 무시한다

지금: core source가 chip을 무시한다(`attached: []`). 화면은 chip을 첫 글감으로만 쓴다.

왜 문제: chip이 session에 붙지 않는다.

고치려면: core source가 chip을 `attached`로 받는다.
