# 상태

lead만 고친다. `tools/status.py app-folder-sync build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `folder-contract` | folder | 1 | 없음 | merged | folder/folder-contract | 999cdca0f |  |
| `folder-decl` | sdk | 1 | 없음 | merged | sdk/folder-decl | 54c866fac |  |
| `folder-engine` | sync | 1 | 없음 | merged | sync/folder-engine | 9d3be3196 |  |
| `folder-log` | sync | 1 | 없음 | merged | sync/folder-log | 4a46c10dd |  |
| `folder-approval` | approval | 2 | folder-contract | merged | approval/folder-approval | 50722567d |  |
| `folder-apps` | folder | 2 | folder-contract, folder-decl | running | folder/folder-apps |  |  |
| `folder-export` | folder | 2 | folder-contract, folder-log, folder-decl | merged | folder/folder-export | f4d044a8a |  |
| `folder-import` | folder | 2 | folder-contract, folder-engine, folder-decl | merged | folder/folder-import | ed308d30c |  |
| `folder-runtime` | sync | 2 | folder-contract, folder-engine, folder-log, folder-decl | running | sync/folder-runtime |  |  |
| `folder-surface` | folder | 3 | folder-export, folder-import, folder-apps, folder-runtime, folder-approval | todo |  |  |  |
| `folder-guidance` | sdk | 3 | folder-decl, folder-surface | todo |  |  |  |
