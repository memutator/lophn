# 상태

lead만 고친다. `tools/status.py ae-builds build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ab-cli` | cli | 1 | 없음 | merged | cli/ab-cli | 5a5c045a7 |  |
| `ab-coding-move` | coding | 1 | 없음 | merged | coding/ab-coding-move | 6bb240c7b |  |
| `ab-coding-tab` | coding | 1 | 없음 | merged | coding/ab-coding-tab | 35794b569 |  |
| `ab-preview` | preview | 1 | ab-cli | merged | preview/ab-preview | ebfe5f065 |  |
| `ab-publish` | publish | 1 | ab-source | merged | publish/ab-publish | e13e69b8c |  |
| `ab-reaction-screen` | reaction | 1 | 없음 | merged | reaction/ab-reaction-screen | bc0eb5cc1 |  |
| `ab-release-checks` | release | 1 | 없음 | merged | release/ab-release-checks | df5b686ea |  |
| `ab-router` | router | 1 | ab-coding-move | merged | router/ab-router | a03c8b649 |  |
| `ab-runtime` | runtime | 1 | 없음 | merged | runtime/ab-runtime | 554ed770e |  |
| `ab-source` | source | 1 | ab-coding-move | merged | source/ab-source | 106188735 |  |
| `ab-coding-detach` | coding | 2 | 없음 | merged | coding/ab-coding-detach | 176e7ad3d |  |
| `ab-reaction-core` | reaction | 2 | 없음 | merged | reaction/ab-reaction-core | 0347eb6c9 |  |
| `ab-release-activate` | release | 2 | ab-reaction-core | running | release/ab-release-activate |  |  |
| `ab-release-prepare` | release | 3 | 없음 | todo |  |  |  |
| `ab-ticket-refs` | ticket | 3 | 없음 | todo |  |  |  |
| `ab-prompt` | prompt | 4 | 없음 | todo |  |  |  |
| `ab-runner-delete` | runner | 4 | ab-ticket-delete | todo |  |  |  |
| `ab-ticket-delete` | ticket | 4 | 없음 | todo |  |  |  |
