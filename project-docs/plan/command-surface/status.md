# 상태

lead만 고친다. `tools/status.py command-surface build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `app-commands` | apps | 1 | defer-remove, app-layers | running | apps/app-commands |  |  |
| `app-large-result` | apps | 1 | app-layers | running | apps/app-large-result |  |  |
| `app-layers` | apps | 1 | 없음 | merged | apps/app-layers | f8f543dfe |  |
| `cmd-apps` | cli | 1 | app-layers | running | cli/cmd-apps |  |  |
| `cmd-calls` | cli | 1 | cs-foundation | merged | cli/cmd-calls | 8eff7018f |  |
| `cmd-domains` | cli | 1 | cs-foundation | running | cli/cmd-domains |  |  |
| `cmd-release` | cli | 1 | app-layers | running | cli/cmd-release |  |  |
| `cmd-workflows` | cli | 1 | cs-foundation | merged | cli/cmd-workflows | b0732250e |  |
| `cs-foundation` | cli | 1 | 없음 | merged | cli/cs-foundation | 6bf90d488 |  |
| `defer-remove` | cli | 1 | cs-foundation | merged | cli/defer-remove | de91d807c |  |
| `e2e-rewrite` | text | 3 | 없음 | todo |  |  |  |
| `text-rewrite` | text | 3 | 없음 | todo |  |  |  |
