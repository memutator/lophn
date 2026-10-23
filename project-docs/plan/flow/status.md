# 상태

lead만 고친다. `tools/status.py flow build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `fl-contract` | contract | 1 | 없음 | merged | contract/fl-contract | cd2dd666e |  |
| `fl-runs` | runs | 2 | fl-contract | running | runs/fl-runs |  |  |
| `fl-sdk` | sdk | 2 | fl-contract | running | sdk/fl-sdk |  |  |
| `fl-shell` | shell | 2 | fl-contract | running | shell/fl-shell |  |  |
| `fl-workflows` | workflows | 2 | fl-contract | running | workflows/fl-workflows |  |  |
| `fl-check` | check | 3 | fl-workflows, fl-sdk | todo |  |  |  |
| `fl-host` | host | 3 | fl-workflows, fl-runs | todo |  |  |  |
