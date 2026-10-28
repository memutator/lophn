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
| `jobs-core` | jobs | 2 | runs-core, wireframe-sidebar | merged | jobs/jobs-core | 8f14de02e |  |
| `place-prompts` | places | 2 | place-scope | merged | places/place-prompts | be6f83d01 |  |
| `place-scope` | places | 2 | place-tools | merged | places/place-scope | 77310f564 |  |
| `place-tools` | places | 2 | sessions-core | merged | places/place-tools | e26d159bf |  |
| `router-core` | router | 2 | sessions-core | merged | router/router-core | 8ac4e6012 |  |
| `runs-core` | runs | 2 | router-core, place-tools | merged | runs/runs-core | 87890c965 |  |
| `sessions-core` | sessions | 2 | agents-core | merged | sessions/sessions-core | 166ec9f32 |  |
| `wireframe-agents` | wireframe | 2 | 없음 | merged | wireframe/wireframe-agents | 298875403 |  |
| `wireframe-sidebar` | wireframe | 2 | wireframe-agents | merged | wireframe/wireframe-sidebar | 6e964fc25 |  |
| `workflows-core` | workflows | 2 | runs-core | merged | workflows/workflows-core | 951fc1ba7 |  |
| `cli-run` | cli | 3 | 없음 | merged | cli/cli-run | fb7f5db82 |  |
| `e2e-agents` | e2e | 3 | shell-events | merged | e2e/e2e-agents | 8490ff257 |  |
| `e2e-apps` | e2e | 3 | e2e-agents | merged | e2e/e2e-apps | cb930b6b4 |  |
| `eval-scenarios` | eval | 3 | shell-events | merged | eval/eval-scenarios | cb930b6b4 |  |
| `shell-conversation` | shell | 3 | shell-events | merged | shell/shell-conversation | 0d686dbaf |  |
| `shell-desktop` | shell | 3 | shell-events, shell-workspace | merged | shell/shell-desktop | b9cda7ee3 |  |
| `shell-events` | shell | 3 | 없음 | merged | shell/shell-events | a21a5a22b |  |
| `shell-workspace` | shell | 3 | shell-events | merged | shell/shell-workspace | f6706525e |  |
| `cleanup-core` | cleanup | 4 | 없음 | running | cleanup/cleanup-core |  |  |
| `cleanup-protocol` | cleanup | 4 | cleanup-core, cleanup-shell | todo |  |  |  |
| `cleanup-shell` | cleanup | 4 | 없음 | running | cleanup/cleanup-shell |  |  |
