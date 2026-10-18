# 상태

lead만 고친다. `tools/status.py eval-base build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ev-contract` | ev-contract | 1 | 없음 | merged | ev-contract/ev-contract | af3527145 |  |
| `ev-checks` | ev-checks | 2 | ev-contract | merged | ev-checks/ev-checks | b931dc1f5 |  |
| `ev-collect` | ev-collect | 2 | ev-contract | merged | ev-collect/ev-collect | bbdb1bb1f |  |
| `ev-judge` | ev-judge | 2 | ev-contract | merged | ev-judge/ev-judge | c9b558dc9 |  |
| `ev-provider` | ev-provider | 2 | ev-contract | merged | ev-provider/ev-provider | 1c8abfb95 |  |
| `ev-restore` | ev-restore | 2 | ev-contract | merged | ev-restore/ev-restore | fe19e3ae3 |  |
| `ev-versions` | ev-versions | 2 | ev-contract | running | ev-versions/ev-versions |  |  |
| `ev-cases-lophn` | ev-cases | 3 | ev-restore, ev-checks, ev-judge | todo |  |  |  |
| `ev-cases-roles` | ev-cases | 3 | ev-restore, ev-checks, ev-judge | todo |  |  |  |
| `ev-runner` | ev-runner | 3 | ev-versions, ev-restore, ev-provider, ev-collect, ev-checks, ev-judge | todo |  |  |  |
| `ev-scorecard` | ev-scorecard | 3 | ev-versions, ev-collect | todo |  |  |  |
