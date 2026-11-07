# 상태

lead만 고친다. `tools/status.py harness-gui-fixes build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `claude-fixes` | adapter | 1 | 없음 | todo |  |  |  |
| `harness-empty-resume` | adapter | 1 | 없음 | todo |  |  |  |
| `thread-index-bookmark` | chat | 1 | 없음 | todo |  |  |  |
| `gui-snapshot` | gui | 1 | 없음 | todo |  |  |  |
| `tab-title` | gui | 1 | gui-snapshot | todo |  |  |  |
| `received-messages` | adapter | 2 | claude-fixes, harness-empty-resume | todo |  |  |  |
