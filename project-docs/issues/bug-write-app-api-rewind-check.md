---
kind: bug
modules: [packages/core/apps]
---

# write app-api의 rewind 검사가 fail로 나온다

지금: fixture 입력으로 앞선 상태를 못 만드는 write app-api는 fail로 나와 release 준비가 막힐 수 있다.

왜 문제: release 준비가 막힐 수 있다.

고치려면: 실제로 막히면 앱이 fixture를 주는 방식을 정한다.
