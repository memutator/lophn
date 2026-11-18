# 상태

lead만 고친다. `tools/status.py carry-paths build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `carry-contract` | carry | 1 | 없음 | todo |  |  |  |
| `carry-folder` | carry | 2 | carry-contract | todo |  |  |  |
| `carry-links` | carry | 2 | carry-contract | todo |  |  |  |
| `carry-notify` | carry | 2 | carry-contract | todo |  |  |  |
| `carry-phone` | carry | 2 | carry-contract | todo |  |  |  |
| `carry-settings` | carry | 3 | carry-links, carry-folder | todo |  |  |  |
| `carry-cleanup` | carry | 4 | carry-phone, carry-notify, carry-settings | todo |  |  |  |
