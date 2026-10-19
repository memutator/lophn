# 상태

lead만 고친다. `tools/status.py rewind-check build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `rc-examples-restore` | rewind-check | 1 | rc-restore | todo |  |  |  |
| `rc-restore` | rewind-check | 1 | rc-wire | todo |  |  |  |
| `rc-unproven` | rewind-check | 1 | 없음 | todo |  |  |  |
| `rc-unproven-problem` | rewind-check | 1 | rc-unproven | todo |  |  |  |
| `rc-user-read` | rewind-check | 1 | 없음 | todo |  |  |  |
| `rc-wire` | rewind-check | 1 | 없음 | merged | rewind-check/rc-wire | dabcb96f6 |  |
