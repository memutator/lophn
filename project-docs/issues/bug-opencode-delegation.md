---
kind: bug
modules: [packages/protocol, packages/coding-agent]
---

# OpenCode 맡기기에서 메시지가 늘 `state_unknown`으로 거절된다

지금: adapter가 `hook: null`인데 turn 끝 신호 표에는 `session.status idle`이 있어 메시지를 받을 수 있는 것으로 나온다. hook이 설치되지 않아 상태가 늘 unknown이고 메시지는 `state_unknown`으로 거절된다(`protocol/coding-agent/harness-adapter.ts`).

왜 문제: OpenCode에는 메시지를 못 보낸다.

고치려면: OpenCode hook을 설치하거나 신호 표에서 `session.status idle`을 뺀다.
