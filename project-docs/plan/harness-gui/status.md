# 상태

lead만 고친다. `tools/status.py harness-gui build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `gui-protocol` | gui | 1 | 없음 | merged | gui/gui-protocol | c04844eec |  |
| `gui-claude` | gui | 2 | gui-protocol | merged | gui/gui-claude | c5918b26a |  |
| `gui-window` | gui | 2 | gui-protocol | merged | gui/gui-window | 56c29b6f0 |  |
| `fix-gui-data-root` | fix | 3 | 없음 | todo |  |  |  |
| `fix-gui-dev-sandbox` | fix | 3 | 없음 | merged | fix/fix-gui-dev-sandbox | 6a761b281 |  |
| `gui-codex` | gui | 3 | gui-claude | merged | gui/gui-codex | 97c2f4a62 |  |
| `gui-opencode` | gui | 3 | gui-claude | merged | gui/gui-opencode | b9bc05b77 |  |
