# 상태

lead만 고친다. `tools/status.py eval-coding build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ec-contract` | ec-contract | 1 | 없음 | merged | ec-contract/ec-contract | 543714263 |  |
| `ec-checks` | ec-checks | 2 | ec-contract | merged | ec-checks/ec-checks | 2573b5b89 |  |
| `ec-driver` | ec-driver | 2 | ec-contract | merged | ec-driver/ec-driver | 129c83391 |  |
| `ec-human` | ec-human | 2 | ec-contract | merged | ec-human/ec-human | c232aa80d |  |
| `ec-metrics` | ec-metrics | 2 | ec-contract | merged | ec-metrics/ec-metrics | e2e1ed6b4 |  |
| `ec-restore` | ec-restore | 2 | ec-contract | merged | ec-restore/ec-restore | 32ef4a99e |  |
| `ec-calendar` | ec-calendar | 3 | ec-restore, ec-world | merged | ec-calendar/ec-calendar | b17fd5d71 |  |
| `ec-fix-publish` | ec-fix-publish | 3 | 없음 | merged | ec-fix-publish/ec-fix-publish | 945279c30 |  |
| `ec-runner` | ec-runner | 3 | ec-driver, ec-metrics, ec-human, ec-restore | merged | ec-runner/ec-runner | fd1513173 |  |
| `ec-world` | ec-world | 3 | ec-restore, ec-fix-publish | merged | ec-world/ec-world | 84f1caf07 |  |
| `ec-scenarios` | ec-scenarios | 4 | ec-world, ec-calendar, ec-checks, ec-human | todo |  |  |  |
