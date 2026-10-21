# 상태

lead만 고친다. `tools/status.py approval-simplify build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `ap-assign-store` | assign | 1 | ap-contract, ap-legacy | merged | assign/ap-assign-store | ea5a898a7 |  |
| `ap-call-judge` | call-judge | 1 | 없음 | merged | call-judge/ap-call-judge | abd6b0f4d |  |
| `ap-contract` | contract | 1 | 없음 | merged | contract/ap-contract | bdf4a25a5 |  |
| `ap-gate` | gate | 1 | ap-contract | merged | gate/ap-gate | 182023e9d |  |
| `ap-legacy` | legacy | 1 | 없음 | merged | legacy/ap-legacy | 65c016434 |  |
| `ap-reaction` | reaction | 1 | 없음 | merged | reaction/ap-reaction | ede903703 |  |
| `ap-settings-edit` | settings-edit | 1 | 없음 | merged | settings-edit/ap-settings-edit | ede53ee96 |  |
| `ap-activation` | activation | 2 | 없음 | merged | activation/ap-activation | 500987a2f |  |
| `ap-app-call` | app-call | 2 | ap-activation | merged | app-call/ap-app-call | 832b0e5e2 |  |
| `ap-ask-pending` | ask | 2 | ap-activation | merged | ask/ap-ask-pending | a4a28fc39 |  |
| `ap-ask-turn` | ask | 2 | ap-ask-pending, ap-app-call | merged | ask/ap-ask-turn | 63d33827f |  |
| `ap-assign-editor` | assign | 2 | 없음 | merged | assign/ap-assign-editor | 5b85e9769 |  |
| `ap-assign-tools` | assign | 2 | ap-ask-turn | merged | assign/ap-assign-tools | 9ca2338e8 |  |
| `ap-conversation` | conversation | 2 | ap-waiting | todo |  |  |  |
| `ap-waiting` | waiting | 2 | ap-ask-turn, ap-activation | running | waiting/ap-waiting |  |  |
| `ap-mode-envelope` | mode | 3 | 없음 | todo |  |  |  |
| `ap-mode-turn` | mode | 3 | ap-mode-envelope, ap-skip-session | todo |  |  |  |
| `ap-shell-gate` | shell | 3 | ap-mode-turn | todo |  |  |  |
| `ap-shell-settings` | shell | 3 | ap-shell-gate | todo |  |  |  |
| `ap-skip-screens` | skip | 3 | ap-skip-session | todo |  |  |  |
| `ap-skip-session` | skip | 3 | 없음 | todo |  |  |  |
| `ap-cleanup` | cleanup | 4 | ap-waiting, ap-conversation, ap-assign-editor, ap-shell-settings, ap-skip-screens | todo |  |  |  |
