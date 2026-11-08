# 상태

lead만 고친다. `tools/status.py standalone-core build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `score-control` | control | 1 | 없음 | merged | control/score-control | 3e0c6a065 |  |
| `score-idle` | idle | 2 | score-control | merged | idle/score-idle | 79859d6a3 |  |
| `score-shell` | shell | 3 | score-idle | merged | shell/score-shell | cb85d646e |  |
| `score-cli` | cli | 4 | score-shell | todo |  |  |  |
| `score-launchers` | launchers | 5 | score-cli | todo |  |  |  |
| `score-cleanup` | cleanup | 6 | score-launchers | todo |  |  |  |
