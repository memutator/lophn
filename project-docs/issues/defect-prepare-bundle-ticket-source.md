---
kind: defect
modules: [packages/core/apps, packages/protocol]
---

# `release.prepare_bundle`의 `ticket_source` 계약과 core가 다르다

지금: 계약은 optional인데 core가 필수로 막는다.

왜 문제: 계약과 구현이 어긋난다.

고치려면: 계약을 필수로 맞춘다.
