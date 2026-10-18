# 상태

lead만 고친다. `tools/status.py settings-mcp build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `sm-envelope-helper` | sm-envelope | 1 | 없음 | todo |  |  |  |
| `sm-envelope-sites` | sm-envelope | 2 | sm-envelope-helper | todo |  |  |  |
| `sm-mcp-settings-path` | sm-mcp | 3 | sm-envelope-helper | todo |  |  |  |
| `sm-mcp-operator-runtime` | sm-mcp | 4 | 없음 | todo |  |  |  |
| `sm-mcp-operator-secret-name` | sm-mcp | 5 | sm-envelope-sites, sm-mcp-operator-runtime | todo |  |  |  |
| `sm-mcp-operator-grants` | sm-mcp | 6 | sm-mcp-operator-secret-name, sm-mcp-operator-runtime, sm-envelope-sites | todo |  |  |  |
| `sm-chip` | sm-chip | 7 | sm-envelope-helper | todo |  |  |  |
