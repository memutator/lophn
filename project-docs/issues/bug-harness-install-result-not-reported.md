---
kind: bug
modules: [packages/coding-agent, packages/protocol, packages/core/apps]
---

# `harness install` 결과를 core에 알리지 않는다

지금: `harness install` 결과를 core에 알리지 않는다(`codingTerminalResult`에 칸이 없다).

왜 문제: core가 install 성공·실패를 모른다.

고치려면: `codingTerminalResult`에 결과 칸을 더한다.
