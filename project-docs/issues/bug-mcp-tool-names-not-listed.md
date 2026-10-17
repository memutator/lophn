---
kind: bug
modules: [packages/core/lophn-agent]
---

# 외부 MCP tool 이름을 못 읽는다

지금: 읽는 route가 없어 Grants의 "Tools from MCP servers"가 빈다.

왜 문제: 사람이 MCP tool별로 권한을 볼 수 없다.

고치려면: MCP tool 이름을 읽는 route를 짓는다.
