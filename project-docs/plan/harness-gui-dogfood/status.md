# 상태

lead만 고친다. `tools/status.py harness-gui-dogfood build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `claude-meta` | adapter | 1 | 없음 | merged | adapter/claude-meta | 5526cb0f1 |  |
| `chat-render-perf` | chat | 1 | 없음 | merged | chat/chat-render-perf | 56f5adade |  |
| `shell-stop` | adapter | 2 | chat-render-perf, claude-meta | todo |  |  |  |
