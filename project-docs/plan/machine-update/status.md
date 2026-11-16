# 상태

lead만 고친다. `tools/status.py machine-update build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `update-follow` | follow | 1 | 없음 | merged | follow/update-follow | 6e5f71365 |  |
| `update-held` | held | 1 | 없음 | todo |  |  |  |
| `update-viewer` | viewer | 1 | 없음 | running | viewer/update-viewer |  |  |
| `update-status` | status | 2 | update-held, update-follow | todo |  |  |  |
