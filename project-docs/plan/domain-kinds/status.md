# 상태

lead만 고친다. `tools/status.py domain-kinds build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `dk-event` | event | 1 | 없음 | merged | event/dk-event | 6fb20e64b |  |
| `dk-kinds-contract` | kinds | 1 | 없음 | merged | kinds/dk-kinds-contract | d30670d52 |  |
| `dk-problem-contract` | problem | 1 | dk-kinds-contract | merged | problem/dk-problem-contract | bdc10e140 |  |
| `dk-agent-tools` | agent-tools | 2 | 없음 | merged | agent-tools/dk-agent-tools | 6e0c708b4 |  |
| `dk-kinds-host` | kinds | 2 | 없음 | merged | kinds/dk-kinds-host | 8b114a399 |  |
| `dk-kinds-worker` | kinds | 2 | 없음 | merged | kinds/dk-kinds-worker | 586630cf6 |  |
| `dk-problem-core` | problem | 2 | 없음 | merged | problem/dk-problem-core | af08a7c3a |  |
| `dk-prompt-place` | prompt | 2 | 없음 | merged | prompt/dk-prompt-place | b5ace21ab |  |
| `dk-chips-reactions` | chips | 3 | dk-shell-workspace | todo |  |  |  |
| `dk-delete-context-tools` | cleanup | 3 | dk-operator-contexts | merged | cleanup/dk-delete-context-tools | 723c20cbc |  |
| `dk-delete-core` | cleanup | 3 | dk-operator-contexts | merged | cleanup/dk-delete-core | 8803b16bd |  |
| `dk-delete-eval` | cleanup | 3 | 없음 | merged | cleanup/dk-delete-eval | 0720e0f5c |  |
| `dk-delete-protocol` | cleanup | 3 | dk-delete-core, dk-delete-context-tools, dk-shell-workspace, dk-chips-reactions, dk-delete-eval, dk-operator-contexts, dk-delete-wording | todo |  |  |  |
| `dk-operator-contexts` | operator-contexts | 3 | dk-delete-eval | merged | operator-contexts/dk-operator-contexts | d4b174f80 |  |
| `dk-shell-workspace` | shell | 3 | dk-wireframes, dk-operator-contexts | todo |  |  |  |
| `dk-skill` | skill | 3 | 없음 | merged | skill/dk-skill | 83c4bd887 |  |
| `dk-wireframes` | wireframes | 3 | dk-operator-contexts | merged | wireframes/dk-wireframes | cf45e1e8c |  |
| `dk-delete-wording` | wording | 3 | dk-shell-workspace, dk-chips-reactions, dk-operator-contexts, dk-wireframes | todo |  |  |  |
