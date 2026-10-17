---
kind: defect
modules: [packages/core/lophn-agent]
---

# 앱 rewind 요청(`rewind_apps` 표)이 wiring 없이 늘 rejected다

지금: 앱 rewind 요청(`rewind_apps` 표, background, accepted/applied/rejected)을 두었는데 지금은 wiring이 없어 늘 rejected. `core/lophn-agent/session/rewind/`.

왜 문제: 쓰이지 않는 표와 흐름이다.

고치려면: MVP는 앱 rewind를 빼고 파일·대화만 되돌린다(`apps` 입력과 표를 지움).
