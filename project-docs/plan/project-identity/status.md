# 상태

lead만 고친다. `tools/status.py project-identity build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `project-id-core` | project-id-core | 1 | 없음 | todo |  |  |  |
| `project-id-clone` | project-id-clone | 2 | project-id-core | todo |  |  |  |
| `project-id-screens` | project-id-screens | 2 | project-id-core | todo |  |  |  |
| `project-id-sync` | project-id-sync | 2 | project-id-core | todo |  |  |  |
| `project-id-remote-view` | project-id-remote-view | 3 | project-id-sync, project-id-clone, project-id-screens | todo |  |  |  |
