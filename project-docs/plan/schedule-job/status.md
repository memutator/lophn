# 상태

lead만 고친다. `tools/status.py schedule-job build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `sj-jobs-contract` | jobs | 1 | 없음 | todo |  |  |  |
| `sj-apps-program-caller` | apps | 2 | 없음 | todo |  |  |  |
| `sj-jobs-due` | jobs | 2 | sj-jobs-store | todo |  |  |  |
| `sj-jobs-store` | jobs | 2 | 없음 | todo |  |  |  |
| `sj-jobs-tools` | roles | 2 | 없음 | todo |  |  |  |
| `sj-runs-job-origin` | runs | 2 | sj-apps-program-caller | todo |  |  |  |
| `sj-shell-hold-card` | shell | 2 | 없음 | todo |  |  |  |
| `sj-shell-job-screen` | shell | 2 | 없음 | todo |  |  |  |
| `sj-jobs-scheduler` | jobs | 3 | 없음 | todo |  |  |  |
