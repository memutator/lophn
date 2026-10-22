# 상태

lead만 고친다. `tools/status.py schedule-job build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `sj-jobs-contract` | jobs | 1 | 없음 | merged | jobs/sj-jobs-contract | 7d6ddcf38 |  |
| `sj-jobs-wireframe` | shell | 1 | 없음 | merged | shell/sj-jobs-wireframe | e09123a17 |  |
| `sj-apps-program-caller` | apps | 2 | sj-jobs-contract | merged | apps/sj-apps-program-caller | e793afc68 |  |
| `sj-jobs-store` | jobs | 2 | sj-jobs-contract | merged | jobs/sj-jobs-store | f3a0a9e5e |  |
| `sj-jobs-tools` | roles | 2 | sj-jobs-contract | merged | roles/sj-jobs-tools | b8fdcf070 |  |
| `sj-workflows-job-start` | workflows | 2 | sj-jobs-contract | merged | workflows/sj-workflows-job-start | 26b820ade |  |
| `sj-jobs-due` | jobs | 3 | sj-jobs-store | merged | jobs/sj-jobs-due | 5c080486d |  |
| `sj-runs-job-origin` | runs | 3 | sj-apps-program-caller | merged | runs/sj-runs-job-origin | e02731b26 |  |
| `sj-jobs-sidebar-wireframe` | shell | 3 | sj-jobs-wireframe | merged | shell/sj-jobs-sidebar-wireframe | 696657995 |  |
| `sj-shell-hold-card` | shell | 3 | sj-jobs-wireframe | merged | shell/sj-shell-hold-card | 910a7ef72 |  |
| `sj-shell-job-labels` | shell | 3 | sj-jobs-wireframe | merged | shell/sj-shell-job-labels | 16a843f09 |  |
| `sj-shell-jobs-screen` | shell | 3 | sj-jobs-wireframe | merged | shell/sj-shell-jobs-screen | a975e1723 |  |
| `sj-jobs-scheduler` | jobs | 4 | sj-jobs-due, sj-runs-job-origin, sj-workflows-job-start | merged | jobs/sj-jobs-scheduler | fafddad9f | 선행이 모두 merged이고 wave 3 화면 task와 소유가 겹치지 않아 wave 3 끝을 기다리지 않고 띄움 |
| `sj-shell-jobs-sidebar` | shell | 4 | sj-jobs-sidebar-wireframe, sj-shell-jobs-screen, sj-shell-job-labels | running | shell/sj-shell-jobs-sidebar |  |  |
