# 상태

lead만 고친다. `tools/status.py eval-base build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ev-contracts` | ev | 1 | 없음 | todo |  |  |  |
| `ev-provider` | ev | 1 | 없음 | todo |  |  |  |
| `ev-checks` | ev | 2 | ev-contracts | todo |  |  |  |
| `ev-collect` | ev | 2 | ev-contracts | todo |  |  |  |
| `ev-material` | ev | 2 | ev-contracts | todo |  |  |  |
| `ev-steps` | ev | 2 | ev-contracts, ev-provider | todo |  |  |  |
| `ev-driver` | ev | 3 | ev-collect, ev-restore, ev-provider | todo |  |  |  |
| `ev-restore` | ev | 3 | ev-material, ev-steps, ev-provider | todo |  |  |  |
| `ev-run` | ev | 4 | ev-driver, ev-checks, ev-material | todo |  |  |  |
| `ev-world` | ev | 4 | ev-restore, ev-material | todo |  |  |  |
| `ev-cases-lophn` | ev-cases | 5 | ev-run, ev-world, ev-checks, ev-steps | todo |  |  |  |
| `ev-cases-operator` | ev-cases | 5 | ev-run, ev-world, ev-checks, ev-steps | todo |  |  |  |
| `ev-cases-roles` | ev-cases | 5 | ev-run, ev-world, ev-checks, ev-steps | todo |  |  |  |
| `ev-cases-seeded` | ev-cases | 5 | ev-run, ev-world, ev-checks, ev-steps | todo |  |  |  |
