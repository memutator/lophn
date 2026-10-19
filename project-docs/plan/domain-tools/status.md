# 상태

lead만 고친다. `tools/status.py domain-tools build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `dt-call-route` | domain-tools | 1 | dt-decl | merged | domain-tools/dt-call-route | ce889f5b6 |  |
| `dt-decl` | domain-tools | 1 | 없음 | merged | domain-tools/dt-decl | 37280763a |  |
| `dt-agent-tools` | domain-tools | 2 | dt-call-route | merged | domain-tools/dt-agent-tools | a19f59a58 |  |
| `dt-coding-text` | domain-tools | 2 | dt-call-route | merged | domain-tools/dt-coding-text | 7b97f429b |  |
| `dt-invocation-project` | domain-tools | 2 | dt-call-route | merged | domain-tools/dt-invocation-project | 14ad22c6d |  |
| `dt-preview-call` | domain-tools | 2 | dt-invocation-project | merged | domain-tools/dt-preview-call | 5ac7b9e00 |  |
| `dt-sdk` | domain-tools | 2 | dt-call-route | merged | domain-tools/dt-sdk | 7b5c6992e |  |
| `dt-shell-bridge` | domain-tools | 2 | dt-call-route | merged | domain-tools/dt-shell-bridge | 8a15ba0c2 |  |
| `dt-examples` | domain-tools | 3 | dt-call-route | merged | domain-tools/dt-examples | 84eda3d1d |  |
| `dt-mcp-endpoint` | domain-tools | 3 | 없음 | merged | domain-tools/dt-mcp-endpoint | bc7b2bbfe |  |
| `dt-mcp-harness` | domain-tools | 3 | dt-mcp-endpoint | merged | domain-tools/dt-mcp-harness | 2046c6abe |  |
| `dt-preview-fix` | domain-tools | 4 | dt-mcp-harness | todo |  |  |  |
