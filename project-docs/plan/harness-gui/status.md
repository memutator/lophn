# 상태

lead만 고친다. `tools/status.py harness-gui build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `gui-protocol` | gui | 1 | 없음 | merged | gui/gui-protocol | c04844eec |  |
| `gui-claude` | gui | 2 | gui-protocol | todo |  |  |  |
| `gui-window` | gui | 2 | gui-protocol | todo |  |  |  |
| `gui-codex` | gui | 3 | gui-claude | todo |  |  |  |
| `gui-opencode` | gui | 3 | gui-claude | todo |  |  |  |
