# 상태

lead만 고친다. `tools/status.py harness-gui-fixes build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `claude-fixes` | adapter | 1 | 없음 | merged | adapter/claude-fixes | 473844b47 |  |
| `harness-empty-resume` | adapter | 1 | 없음 | merged | adapter/harness-empty-resume | acbb2fa64 |  |
| `thread-index-bookmark` | chat | 1 | 없음 | merged | chat/thread-index-bookmark | 09b3b0862 |  |
| `gui-snapshot` | gui | 1 | 없음 | merged | gui/gui-snapshot | 4d9fba45b |  |
| `tab-title` | gui | 1 | gui-snapshot | running | gui/tab-title |  |  |
| `received-messages` | adapter | 2 | claude-fixes, harness-empty-resume | todo |  |  |  |
