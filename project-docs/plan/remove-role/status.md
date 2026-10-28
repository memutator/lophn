# 상태

lead만 고친다. `tools/status.py remove-role build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `agent-places-rename` | agent-places | 1 | 없음 | merged | agent-places/agent-places-rename | 69746990a |  |
| `coding-cli` | coding | 1 | 없음 | merged | coding/coding-cli | a7bb54541 |  |
| `coding-core` | coding | 1 | coding-shell, coding-cli | merged | coding/coding-core | 80a3bb591 |  |
| `coding-shell` | coding | 1 | 없음 | merged | coding/coding-shell | 8b15dc853 |  |
| `contract-agent` | contract | 1 | 없음 | merged | contract/contract-agent | f55de3390 |  |
| `contract-session` | contract | 1 | contract-agent | merged | contract/contract-session | ec8edb917 |  |
| `agents-core` | agents | 2 | 없음 | merged | agents/agents-core | c38a429f3 |  |
| `jobs-core` | jobs | 2 | runs-core, wireframe-sidebar | todo |  |  |  |
| `place-prompts` | places | 2 | place-scope | todo |  |  |  |
| `place-scope` | places | 2 | place-tools | todo |  |  |  |
| `place-tools` | places | 2 | sessions-core | todo |  |  |  |
| `router-core` | router | 2 | sessions-core | todo |  |  |  |
| `runs-core` | runs | 2 | router-core, place-tools | todo |  |  |  |
| `sessions-core` | sessions | 2 | agents-core | running | sessions/sessions-core |  |  |
| `wireframe-agents` | wireframe | 2 | 없음 | merged | wireframe/wireframe-agents | 298875403 |  |
| `wireframe-sidebar` | wireframe | 2 | wireframe-agents | merged | wireframe/wireframe-sidebar | 6e964fc25 |  |
| `workflows-core` | workflows | 2 | runs-core | todo |  |  |  |
| `cli-run` | cli | 3 | 없음 | todo |  |  |  |
| `e2e-agents` | e2e | 3 | shell-events | todo |  |  |  |
| `e2e-apps` | e2e | 3 | e2e-agents | todo |  |  |  |
| `eval-scenarios` | eval | 3 | shell-events | todo |  |  |  |
| `shell-conversation` | shell | 3 | shell-events | todo |  |  |  |
| `shell-desktop` | shell | 3 | shell-events, shell-workspace | todo |  |  |  |
| `shell-events` | shell | 3 | 없음 | todo |  |  |  |
| `shell-workspace` | shell | 3 | shell-events | todo |  |  |  |
| `cleanup-core` | cleanup | 4 | 없음 | todo |  |  |  |
| `cleanup-protocol` | cleanup | 4 | cleanup-core, cleanup-shell | todo |  |  |  |
| `cleanup-shell` | cleanup | 4 | 없음 | todo |  |  |  |
