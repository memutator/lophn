# 상태

lead만 고친다. `tools/status.py eval-coding build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ec-contract` | ec-contract | 1 | 없음 | todo |  |  |  |
| `ec-checks` | ec-checks | 2 | ec-contract | todo |  |  |  |
| `ec-driver` | ec-driver | 2 | ec-contract | todo |  |  |  |
| `ec-human` | ec-human | 2 | ec-contract | todo |  |  |  |
| `ec-metrics` | ec-metrics | 2 | ec-contract | todo |  |  |  |
| `ec-restore` | ec-restore | 2 | ec-contract | todo |  |  |  |
| `ec-calendar` | ec-calendar | 3 | ec-restore, ec-world | todo |  |  |  |
| `ec-runner` | ec-runner | 3 | ec-driver, ec-metrics, ec-human, ec-restore | todo |  |  |  |
| `ec-world` | ec-world | 3 | ec-restore | todo |  |  |  |
| `ec-scenarios` | ec-scenarios | 4 | ec-world, ec-calendar, ec-checks, ec-human | todo |  |  |  |
