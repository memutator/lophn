# 상태

lead만 고친다. `tools/status.py schedule-job build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `sj-jobs-contract` | jobs | 1 | 없음 | merged | jobs/sj-jobs-contract | 7d6ddcf38 |  |
| `sj-jobs-wireframe` | shell | 1 | 없음 | merged | shell/sj-jobs-wireframe | e09123a17 |  |
| `sj-apps-program-caller` | apps | 2 | sj-jobs-contract | todo |  |  |  |
| `sj-jobs-store` | jobs | 2 | sj-jobs-contract | todo |  |  |  |
| `sj-jobs-tools` | roles | 2 | sj-jobs-contract | todo |  |  |  |
| `sj-workflows-job-start` | workflows | 2 | sj-jobs-contract | todo |  |  |  |
| `sj-jobs-due` | jobs | 3 | sj-jobs-store | todo |  |  |  |
| `sj-runs-job-origin` | runs | 3 | sj-apps-program-caller | todo |  |  |  |
| `sj-shell-hold-card` | shell | 3 | sj-jobs-wireframe | todo |  |  |  |
| `sj-shell-job-labels` | shell | 3 | sj-jobs-wireframe | todo |  |  |  |
| `sj-shell-jobs-screen` | shell | 3 | sj-jobs-wireframe | todo |  |  |  |
| `sj-jobs-scheduler` | jobs | 4 | sj-jobs-due, sj-runs-job-origin, sj-workflows-job-start | todo |  |  |  |
