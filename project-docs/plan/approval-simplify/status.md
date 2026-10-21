# 상태

lead만 고친다. `tools/status.py approval-simplify build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ap-assign-store` | assign | 1 | ap-contract, ap-legacy | todo |  |  |  |
| `ap-call-judge` | call-judge | 1 | 없음 | todo |  |  |  |
| `ap-contract` | contract | 1 | 없음 | todo |  |  |  |
| `ap-gate` | gate | 1 | ap-contract | todo |  |  |  |
| `ap-legacy` | legacy | 1 | 없음 | todo |  |  |  |
| `ap-reaction` | reaction | 1 | 없음 | todo |  |  |  |
| `ap-settings-edit` | settings-edit | 1 | 없음 | todo |  |  |  |
| `ap-activation` | activation | 2 | 없음 | todo |  |  |  |
| `ap-app-call` | app-call | 2 | ap-activation | todo |  |  |  |
| `ap-ask-pending` | ask | 2 | ap-activation | todo |  |  |  |
| `ap-ask-turn` | ask | 2 | ap-ask-pending, ap-app-call | todo |  |  |  |
| `ap-assign-editor` | assign | 2 | 없음 | todo |  |  |  |
| `ap-assign-tools` | assign | 2 | ap-ask-turn | todo |  |  |  |
| `ap-conversation` | conversation | 2 | ap-waiting | todo |  |  |  |
| `ap-waiting` | waiting | 2 | ap-ask-turn, ap-activation | todo |  |  |  |
| `ap-mode-envelope` | mode | 3 | 없음 | todo |  |  |  |
| `ap-mode-turn` | mode | 3 | ap-mode-envelope, ap-skip-session | todo |  |  |  |
| `ap-shell-gate` | shell | 3 | ap-mode-turn | todo |  |  |  |
| `ap-shell-settings` | shell | 3 | ap-shell-gate | todo |  |  |  |
| `ap-skip-screens` | skip | 3 | ap-skip-session | todo |  |  |  |
| `ap-skip-session` | skip | 3 | 없음 | todo |  |  |  |
| `ap-cleanup` | cleanup | 4 | ap-waiting, ap-conversation, ap-assign-editor, ap-shell-settings, ap-skip-screens | todo |  |  |  |
