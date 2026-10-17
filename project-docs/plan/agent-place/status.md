# 상태

lead만 고친다. `tools/status.py agent-place build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `mcp-grants-contract` | mcp-grants | 1 | 없음 | merged | mcp-grants/mcp-grants-contract | 300144a31 |  |
| `mcp-grants-core` | mcp-grants | 1 | mcp-grants-contract | merged | mcp-grants/mcp-grants-core | 657cabdfb |  |
| `mcp-grants-screen` | mcp-grants | 1 | mcp-grants-contract | merged | mcp-grants/mcp-grants-screen | 72080bbe6 |  |
| `place-folders-draft` | place-folders | 1 | 없음 | merged | place-folders/place-folders-draft | c323a8da5 |  |
| `place-folders-rule` | place-folders | 1 | 없음 | merged | place-folders/place-folders-rule | 7fe99e8dc |  |
| `place-folders-wiring` | place-folders | 1 | place-folders-rule | merged | place-folders/place-folders-wiring | 59fb5ac20 |  |
| `question-path` | question-path | 1 | 없음 | merged | question-path/question-path | 72b3b0f07 |  |
| `role-rules-agent-files` | role-rules | 2 | role-rules-turn-agent, role-rules-data-folder | running | role-rules/role-rules-agent-files |  |  |
| `role-rules-data-folder` | role-rules | 2 | 없음 | merged | role-rules/role-rules-data-folder | 0a1a89beb |  |
| `role-rules-extensions` | role-rules | 2 | role-rules-agent-files, role-rules-data-folder | todo |  |  |  |
| `role-rules-instructions` | role-rules | 2 | role-rules-agent-files, role-rules-session-places | todo |  |  |  |
| `role-rules-session-places` | role-rules | 2 | 없음 | merged | role-rules/role-rules-session-places | 3d747aa77 |  |
| `role-rules-turn-agent` | role-rules | 2 | 없음 | merged | role-rules/role-rules-turn-agent | 09c255e49 |  |
