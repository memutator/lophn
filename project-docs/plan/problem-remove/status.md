# 상태

lead만 고친다. `tools/status.py problem-remove build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `pr-check-exclude` | check-exclude | 1 | 없음 | merged | check-exclude/pr-check-exclude | 7243fc574 |  |
| `pr-cli-problem` | cli-problem | 2 | pr-check-exclude | todo |  |  |  |
| `pr-issues-ui-screen` | issues-ui | 2 | pr-check-exclude | todo |  |  |  |
| `pr-log-contract` | log | 2 | pr-check-exclude | todo |  |  |  |
| `pr-log-sdk` | log | 2 | pr-log-contract | todo |  |  |  |
| `pr-reactions` | reactions | 2 | pr-check-exclude | todo |  |  |  |
| `pr-test-runner-reports` | test-runner-reports | 2 | pr-check-exclude | todo |  |  |  |
| `pr-issues-ui-main` | issues-ui | 3 | pr-issues-ui-screen | todo |  |  |  |
| `pr-kinds-toast` | kinds-toast | 3 | pr-reactions | todo |  |  |  |
| `pr-log-exception` | log | 3 | pr-log-writer, pr-log-sdk, pr-test-runner-reports | todo |  |  |  |
| `pr-log-writer` | log | 3 | pr-log-contract | todo |  |  |  |
| `pr-problem-refs` | problem-refs | 3 | pr-reactions | todo |  |  |  |
| `pr-log-read` | log | 4 | pr-log-writer, pr-problems-core | todo |  |  |  |
| `pr-problems-core` | problems-core | 4 | pr-reactions, pr-test-runner-reports, pr-cli-problem, pr-log-exception, pr-kinds-toast, pr-problem-refs, pr-issues-ui-main | todo |  |  |  |
| `pr-agent-tools` | agent-tools | 5 | pr-log-read, pr-problem-refs | todo |  |  |  |
| `pr-cleanup` | cleanup | 5 | pr-problems-core, pr-log-read, pr-log-view-error, pr-agent-tools, pr-role-prompts | todo |  |  |  |
| `pr-log-view-error` | log | 5 | pr-log-read, pr-log-exception, pr-issues-ui-main | todo |  |  |  |
| `pr-role-prompts` | role-prompts | 5 | pr-reactions, pr-log-contract | todo |  |  |  |
