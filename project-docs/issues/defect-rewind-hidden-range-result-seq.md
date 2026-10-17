---
kind: defect
modules: [packages/core/lophn-agent]
---

# 숨김 구간을 `reverts.result_seq`로 잡는 규칙

지금: 숨김 구간을 `reverts.result_seq`(session 마지막 메시지 순번)로 잡는다.

왜 문제: 숨은 규칙이다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
