# 상태

lead만 고친다. `tools/status.py settings-mcp build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `sm-envelope-helper` | sm-envelope | 1 | 없음 | merged | plan/settings-mcp | 278eefd1d |  |
| `sm-envelope-sites` | sm-envelope | 2 | sm-envelope-helper | merged | plan/settings-mcp | c38093714 |  |
| `sm-mcp-settings-path` | sm-mcp | 3 | sm-envelope-helper | merged | plan/settings-mcp | a167e114a |  |
| `sm-mcp-operator-runtime` | sm-mcp | 4 | 없음 | merged | plan/settings-mcp | f8021b487 |  |
| `sm-mcp-operator-secret-name` | sm-mcp | 5 | sm-envelope-sites, sm-mcp-operator-runtime | merged | plan/settings-mcp | 68a60af1e |  |
| `sm-mcp-operator-grants` | sm-mcp | 6 | sm-mcp-operator-secret-name, sm-mcp-operator-runtime, sm-envelope-sites | merged | plan/settings-mcp | aa37650c2 |  |
| `sm-chip` | sm-chip | 7 | sm-envelope-helper | merged | plan/settings-mcp | ae29d3bb2 |  |
