# 상태

lead만 고친다. `tools/status.py failure-hardening build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `blob-gc` | core | 1 | 없음 | running | core/blob-gc |  |  |
| `core-lifetime` | core | 1 | 없음 | running | core/core-lifetime |  |  |
| `core-smalls` | core | 1 | 없음 | running | core/core-smalls |  |  |
| `runtime-children` | core | 1 | 없음 | running | core/runtime-children |  |  |
| `storage-errors` | core | 1 | 없음 | running | core/storage-errors |  |  |
| `gui-claude` | gui | 1 | 없음 | merged | gui/gui-claude | 7240da1ee |  |
| `gui-codex` | gui | 1 | 없음 | merged | gui/gui-codex | 0763abf41 |  |
| `gui-omp` | gui | 1 | 없음 | merged | gui/gui-omp | 939739d06 |  |
| `gui-opencode` | gui | 1 | 없음 | merged | gui/gui-opencode | 82858adfe |  |
| `loop-driver` | loop | 1 | 없음 | merged | loop/loop-driver | a46173062 |  |
| `loop-turn` | loop | 1 | 없음 | merged | loop/loop-turn | 4c64efc27 |  |
| `provider-error-text` | provider | 1 | 없음 | merged | provider/provider-error-text | 55ea4fd1a |  |
| `provider-failures` | provider | 1 | 없음 | merged | provider/provider-failures | 2ab41e81d |  |
| `ext-spawn` | shell | 1 | 없음 | running | shell/ext-spawn |  |  |
| `shell-core-connection` | shell | 1 | 없음 | running | shell/shell-core-connection |  |  |
| `hooks-install` | term | 1 | 없음 | running | term/hooks-install |  |  |
| `term-host` | term | 1 | 없음 | merged | term/term-host | 49d9a5562 |  |
| `term-supervisor` | term | 1 | 없음 | merged | term/term-supervisor | 53a1b0a9d |  |
| `mcp-failures` | tools | 1 | 없음 | running | tools/mcp-failures |  |  |
| `tools-file-write` | tools | 1 | 없음 | running | tools/tools-file-write |  |  |
| `tools-grep` | tools | 1 | 없음 | merged | tools/tools-grep | 30a229f67 |  |
| `loop-stop` | loop | 2 | loop-turn, provider-failures | todo |  |  |  |
