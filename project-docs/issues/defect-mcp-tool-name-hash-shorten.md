---
kind: defect
modules: [packages/core/lophn-agent]
---

# MCP tool 이름이 wire 규칙에 안 맞거나 64자를 넘으면 hash 8자를 붙여 줄인다

지금: MCP tool 이름이 wire 규칙에 안 맞거나 64자를 넘으면 hash 8자를 붙여 줄인다.

왜 문제: 이름 변환 규칙이 하나 더 있다.

고치려면: 남길지 정한다. 남기면 이유를 코드 주석으로 옮기고 이 파일을 지운다.
