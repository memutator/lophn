# 상태

lead만 고친다. `tools/status.py agent-place build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mcp-grants-contract` | mcp-grants | 1 | 없음 | todo |  |  |  |
| `mcp-grants-core` | mcp-grants | 1 | mcp-grants-contract | todo |  |  |  |
| `mcp-grants-screen` | mcp-grants | 1 | mcp-grants-contract | todo |  |  |  |
| `place-folders-draft` | place-folders | 1 | 없음 | todo |  |  |  |
| `place-folders-rule` | place-folders | 1 | 없음 | todo |  |  |  |
| `place-folders-wiring` | place-folders | 1 | place-folders-rule | todo |  |  |  |
| `question-path` | question-path | 1 | 없음 | todo |  |  |  |
| `role-rules-agent-files` | role-rules | 2 | role-rules-turn-agent, role-rules-data-folder | todo |  |  |  |
| `role-rules-data-folder` | role-rules | 2 | 없음 | todo |  |  |  |
| `role-rules-extensions` | role-rules | 2 | role-rules-agent-files, role-rules-data-folder | todo |  |  |  |
| `role-rules-instructions` | role-rules | 2 | role-rules-agent-files, role-rules-session-places | todo |  |  |  |
| `role-rules-session-places` | role-rules | 2 | 없음 | todo |  |  |  |
| `role-rules-turn-agent` | role-rules | 2 | 없음 | todo |  |  |  |
