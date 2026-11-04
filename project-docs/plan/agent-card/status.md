# 상태

lead만 고친다. `tools/status.py agent-card build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `card-read` | card | 1 | 없음 | merged | card/card-read | 9b1bc7e9e |  |
| `card-check` | card | 2 | card-read | merged | card/card-check | e8ac72313 |  |
| `card-show` | card | 3 | card-check | merged | card/card-show | 7dde63db1 |  |
| `card-policy` | card | 4 | card-show | todo |  |  | worktree card-policy는 이미 있다(launch 뒤 harness-core와 소유가 겹쳐 멈춤) |
| `bare-skills` | card | 5 | card-policy | todo |  |  |  |
