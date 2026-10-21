# 상태

lead만 고친다. `tools/status.py problem-remove build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `pr-check-exclude` | check-exclude | 1 | 없음 | merged | check-exclude/pr-check-exclude | 7243fc574 |  |
| `pr-cli-problem` | cli-problem | 2 | pr-check-exclude | merged | cli-problem/pr-cli-problem | 52b031cfe |  |
| `pr-issues-ui-screen` | issues-ui | 2 | pr-check-exclude | merged | issues-ui/pr-issues-ui-screen | 8ad3e25bd |  |
| `pr-log-contract` | log | 2 | pr-check-exclude | merged | log/pr-log-contract | a12442dd1 |  |
| `pr-log-sdk` | log | 2 | pr-log-contract | merged | log/pr-log-sdk | 78693657e |  |
| `pr-reactions` | reactions | 2 | pr-check-exclude | merged | reactions/pr-reactions | fae21aad5 |  |
| `pr-test-runner-reports` | test-runner-reports | 2 | pr-check-exclude | merged | test-runner-reports/pr-test-runner-reports | 0b95127c5 |  |
| `pr-issues-ui-main` | issues-ui | 3 | pr-issues-ui-screen | merged | issues-ui/pr-issues-ui-main | 48b67ed5d |  |
| `pr-kinds-toast` | kinds-toast | 3 | pr-reactions | merged | kinds-toast/pr-kinds-toast | b29334a96 |  |
| `pr-log-exception` | log | 3 | pr-log-writer, pr-log-sdk, pr-test-runner-reports | merged | log/pr-log-exception | b7699c575 |  |
| `pr-log-writer` | log | 3 | pr-log-contract | merged | log/pr-log-writer | a00e54e3b |  |
| `pr-problem-refs` | problem-refs | 3 | pr-reactions | merged | problem-refs/pr-problem-refs | 5b22ff291 |  |
| `pr-log-read` | log | 4 | pr-log-writer, pr-problems-core | todo |  |  |  |
| `pr-problems-core` | problems-core | 4 | pr-reactions, pr-test-runner-reports, pr-cli-problem, pr-log-exception, pr-kinds-toast, pr-problem-refs, pr-issues-ui-main | todo |  |  |  |
| `pr-agent-tools` | agent-tools | 5 | pr-log-read, pr-problem-refs | todo |  |  |  |
| `pr-cleanup` | cleanup | 5 | pr-problems-core, pr-log-read, pr-log-view-error, pr-agent-tools, pr-role-prompts | todo |  |  |  |
| `pr-log-view-error` | log | 5 | pr-log-read, pr-log-exception, pr-issues-ui-main | todo |  |  |  |
| `pr-role-prompts` | role-prompts | 5 | pr-reactions, pr-log-contract | todo |  |  |  |
