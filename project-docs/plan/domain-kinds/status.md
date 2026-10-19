# 상태

lead만 고친다. `tools/status.py domain-kinds build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `dk-event` | event | 1 | 없음 | merged | event/dk-event | 6fb20e64b |  |
| `dk-kinds-contract` | kinds | 1 | 없음 | merged | kinds/dk-kinds-contract | d30670d52 |  |
| `dk-problem-contract` | problem | 1 | dk-kinds-contract | todo |  |  |  |
| `dk-agent-tools` | agent-tools | 2 | 없음 | todo |  |  |  |
| `dk-kinds-host` | kinds | 2 | 없음 | todo |  |  |  |
| `dk-kinds-worker` | kinds | 2 | 없음 | todo |  |  |  |
| `dk-problem-core` | problem | 2 | 없음 | todo |  |  |  |
| `dk-prompt-place` | prompt | 2 | 없음 | todo |  |  |  |
| `dk-chips-reactions` | chips | 3 | dk-shell-workspace | todo |  |  |  |
| `dk-delete-context-tools` | cleanup | 3 | dk-operator-contexts | todo |  |  |  |
| `dk-delete-core` | cleanup | 3 | dk-operator-contexts | todo |  |  |  |
| `dk-delete-eval` | cleanup | 3 | 없음 | todo |  |  |  |
| `dk-delete-protocol` | cleanup | 3 | dk-delete-core, dk-delete-context-tools, dk-shell-workspace, dk-chips-reactions, dk-delete-eval, dk-operator-contexts, dk-delete-wording | todo |  |  |  |
| `dk-operator-contexts` | operator-contexts | 3 | dk-delete-eval | todo |  |  |  |
| `dk-shell-workspace` | shell | 3 | dk-wireframes, dk-operator-contexts | todo |  |  |  |
| `dk-skill` | skill | 3 | 없음 | todo |  |  |  |
| `dk-wireframes` | wireframes | 3 | dk-operator-contexts | todo |  |  |  |
| `dk-delete-wording` | wording | 3 | dk-shell-workspace, dk-chips-reactions, dk-operator-contexts, dk-wireframes | todo |  |  |  |
