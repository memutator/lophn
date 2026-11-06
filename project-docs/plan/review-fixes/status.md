# 상태

lead만 고친다. `tools/status.py review-fixes build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `app-data-restore` | app-data | 1 | 없음 | merged | app-data/app-data-restore | f0786eab6 |  |
| `settings-keep` | config | 1 | 없음 | merged | config/settings-keep | 88e8cfcfe |  |
| `event-fanout` | events | 1 | session-list | todo |  |  |  |
| `ledger-freeze` | ledger | 1 | 없음 | running | ledger/ledger-freeze |  |  |
| `turn-loop` | run-loop | 1 | 없음 | running | run-loop/turn-loop |  |  |
| `turn-loop-perf` | run-loop | 1 | turn-loop | todo |  |  |  |
| `session-list` | sessions | 1 | 없음 | running | sessions/session-list |  |  |
| `shell-fixes` | shell | 1 | 없음 | merged | shell/shell-fixes | 49b3e47d4 |  |
