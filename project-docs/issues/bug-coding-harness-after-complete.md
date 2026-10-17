---
kind: bug
modules: [packages/core/apps, packages/coding-agent]
---

# coding 완료 뒤 core가 harness를 멈추지 않는다

지금: 완료 보고 뒤 core가 harness를 멈추지 않는다. harness 권한 물음은 `mcp_tool` intent를 빌려 담는다.

왜 문제: 완료한 harness가 계속 떠 있다.

고치려면: 추천: 첫 prompt에 "보고 뒤 종료"를 넣는다.
