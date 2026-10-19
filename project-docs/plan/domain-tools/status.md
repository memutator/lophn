# 상태

lead만 고친다. `tools/status.py domain-tools build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `dt-call-route` | domain-tools | 1 | dt-decl | merged | domain-tools/dt-call-route | ce889f5b6 |  |
| `dt-decl` | domain-tools | 1 | 없음 | merged | domain-tools/dt-decl | 37280763a |  |
| `dt-agent-tools` | domain-tools | 2 | dt-call-route | todo |  |  |  |
| `dt-coding-text` | domain-tools | 2 | dt-call-route | running | domain-tools/dt-coding-text |  |  |
| `dt-examples` | domain-tools | 2 | dt-call-route | todo |  |  |  |
| `dt-invocation-project` | domain-tools | 2 | dt-call-route | running | domain-tools/dt-invocation-project |  |  |
| `dt-preview-call` | domain-tools | 2 | dt-invocation-project | todo |  |  |  |
| `dt-sdk` | domain-tools | 2 | dt-call-route | running | domain-tools/dt-sdk |  |  |
| `dt-shell-bridge` | domain-tools | 2 | dt-call-route | todo |  |  |  |
| `dt-mcp-endpoint` | domain-tools | 3 | 없음 | todo |  |  |  |
| `dt-mcp-harness` | domain-tools | 3 | dt-mcp-endpoint | todo |  |  |  |
