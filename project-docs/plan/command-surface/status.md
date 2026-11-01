# 상태

lead만 고친다. `tools/status.py command-surface build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `app-large-result` | apps | 1 | app-layers | todo |  |  |  |
| `app-layers` | apps | 1 | 없음 | merged | apps/app-layers | f8f543dfe |  |
| `cmd-apps` | cli | 1 | app-layers | todo |  |  |  |
| `cmd-calls` | cli | 1 | cs-foundation | running | cli/cmd-calls |  |  |
| `cmd-domains` | cli | 1 | cs-foundation | running | cli/cmd-domains |  |  |
| `cmd-release` | cli | 1 | app-layers | todo |  |  |  |
| `cmd-workflows` | cli | 1 | cs-foundation | running | cli/cmd-workflows |  |  |
| `cs-foundation` | cli | 1 | 없음 | merged | cli/cs-foundation | 6bf90d488 |  |
| `defer-remove` | cli | 1 | cs-foundation | running | cli/defer-remove |  |  |
| `app-commands` | apps | 2 | defer-remove, app-layers | todo |  |  |  |
| `text-rewrite` | text | 3 | 없음 | todo |  |  |  |
