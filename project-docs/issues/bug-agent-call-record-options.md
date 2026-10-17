---
kind: bug
modules: [packages/core/router, packages/core/apps]
---

# `AgentCallRecord.options`가 메모리에만 있다

지금: 앱 줄에 선 coding 맡기기의 옵션은 transport 메모리에만 있다.

왜 문제: 재시작하면 옵션을 잃는다.

고치려면: 옵션을 record에 남긴다.
