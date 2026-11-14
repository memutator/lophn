# 상태

lead만 고친다. `tools/status.py screen-sync build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `sync-core` | sync | 1 | 없음 | running | sync/sync-core |  |  |
| `sync-read` | sync | 2 | sync-core | todo |  |  |  |
| `sync-app-detail` | sync | 3 | sync-read | todo |  |  |  |
| `sync-lists` | sync | 3 | sync-read | todo |  |  |  |
| `sync-settings` | sync | 3 | sync-read | todo |  |  |  |
| `sync-fold` | sync | 4 | sync-lists, sync-app-detail, sync-settings | todo |  |  |  |
