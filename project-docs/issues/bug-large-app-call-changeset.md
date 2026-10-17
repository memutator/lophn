---
kind: bug
modules: [packages/core/apps, packages/core/supervision]
---

# 큰 앱 호출 changeset이 supervisor control frame을 못 지난다

지금: 상한은 호출당 8MiB인데 changeset이 base64로 supervisor control frame(256KiB, `CONTROL_MAX_BYTES`)을 지난다. 약 190KiB를 넘으면 write는 일어났는데 "결과 모름, changeset 없음"으로 닫혀 rewind가 막힌다. `core/apps/calls`, `core/apps/runtime/supervisor/relay.ts`.

왜 문제: write는 됐는데 rewind가 막힌다.

고치려면: changeset을 frame 밖(blob, 파일)으로 넘기거나 상한을 frame에 맞춘다.
