---
kind: bug
modules: [packages/core/apps, packages/core/lophn-agent, packages/core/main]
---

# 앱 rewind가 안 된다

지금: session rewind는 파일과 대화만 되돌린다. 앱 데이터 되돌리기 요청은 wiring(`ctx.peek.appRewind`)이 비어 늘 `unavailable`로 rejected가 남는다.

왜 문제: 앱 데이터는 rewind로 되돌릴 수 없다.

고치려면: 앱 rewind 계약을 짓고 wiring을 채운다.
