# 상태

lead만 고친다. `tools/status.py command-surface build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `app-layers` | apps | 1 | 없음 | running | apps/app-layers |  |  |
| `cmd-calls` | cli | 1 | cs-foundation | todo |  |  |  |
| `cmd-domains` | cli | 1 | cs-foundation | todo |  |  |  |
| `cmd-workflows` | cli | 1 | cs-foundation | todo |  |  |  |
| `cs-foundation` | cli | 1 | 없음 | merged | cli/cs-foundation | 6bf90d488 |  |
| `defer-remove` | cli | 1 | cs-foundation | todo |  |  |  |
| `app-commands` | apps | 2 | defer-remove, app-layers | todo |  |  |  |
| `app-large-result` | apps | 2 | app-layers | todo |  |  |  |
| `cmd-apps` | cli | 2 | app-layers | todo |  |  |  |
| `cmd-release` | cli | 2 | app-layers | todo |  |  |  |
| `text-rewrite` | text | 3 | 없음 | todo |  |  |  |
