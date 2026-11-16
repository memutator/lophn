# 상태

lead만 고친다. `tools/status.py app-folder-sync build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `folder-contract` | folder | 1 | 없음 | todo |  |  |  |
| `folder-decl` | sdk | 1 | 없음 | todo |  |  |  |
| `folder-engine` | sync | 1 | 없음 | todo |  |  |  |
| `folder-log` | sync | 1 | 없음 | todo |  |  |  |
| `folder-approval` | approval | 2 | folder-contract | todo |  |  |  |
| `folder-apps` | folder | 2 | folder-contract, folder-decl | todo |  |  |  |
| `folder-export` | folder | 2 | folder-contract, folder-log, folder-decl | todo |  |  |  |
| `folder-import` | folder | 2 | folder-contract, folder-engine, folder-decl | todo |  |  |  |
| `folder-runtime` | sync | 2 | folder-contract, folder-engine, folder-log, folder-decl | todo |  |  |  |
| `folder-surface` | folder | 3 | folder-export, folder-import, folder-apps, folder-runtime, folder-approval | todo |  |  |  |
| `folder-guidance` | sdk | 3 | folder-decl, folder-surface | todo |  |  |  |
