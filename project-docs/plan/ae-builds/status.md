# 상태

lead만 고친다. `tools/status.py ae-builds build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ab-cli` | cli | 1 | 없음 | running | cli/ab-cli |  |  |
| `ab-coding-move` | coding | 1 | 없음 | running | coding/ab-coding-move |  |  |
| `ab-coding-tab` | coding | 1 | 없음 | running | coding/ab-coding-tab |  |  |
| `ab-preview` | preview | 1 | ab-cli | todo |  |  |  |
| `ab-publish` | publish | 1 | ab-source | todo |  |  |  |
| `ab-reaction-screen` | reaction | 1 | 없음 | running | reaction/ab-reaction-screen |  |  |
| `ab-release-checks` | release | 1 | 없음 | running | release/ab-release-checks |  |  |
| `ab-router` | router | 1 | ab-coding-move | todo |  |  |  |
| `ab-runtime` | runtime | 1 | 없음 | running | runtime/ab-runtime |  |  |
| `ab-source` | source | 1 | ab-coding-move | todo |  |  |  |
| `ab-coding-detach` | coding | 2 | 없음 | todo |  |  |  |
| `ab-reaction-core` | reaction | 2 | 없음 | todo |  |  |  |
| `ab-release-activate` | release | 2 | ab-reaction-core | todo |  |  |  |
| `ab-release-prepare` | release | 3 | 없음 | todo |  |  |  |
| `ab-ticket-refs` | ticket | 3 | 없음 | todo |  |  |  |
| `ab-prompt` | prompt | 4 | 없음 | todo |  |  |  |
| `ab-runner-delete` | runner | 4 | ab-ticket-delete | todo |  |  |  |
| `ab-ticket-delete` | ticket | 4 | 없음 | todo |  |  |  |
