# 상태

lead만 고친다. `tools/status.py screen-sync build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `sync-core` | sync | 1 | 없음 | merged | sync/sync-core | d88489c4a |  |
| `sync-read` | sync | 2 | sync-core | merged | sync/sync-read | 50103295a |  |
| `sync-app-detail` | sync | 3 | sync-read | merged | sync/sync-app-detail | bb1ad4713 |  |
| `sync-lists` | sync | 3 | sync-read | merged | sync/sync-lists | 4de7ca9f5 |  |
| `sync-settings` | sync | 3 | sync-read | merged | sync/sync-settings | 8690e74fb |  |
| `sync-fold` | sync | 4 | sync-lists, sync-app-detail, sync-settings | merged | sync/sync-fold | dbd20f4bd |  |
