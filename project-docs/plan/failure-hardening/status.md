# 상태

lead만 고친다. `tools/status.py failure-hardening build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `blob-gc` | core | 1 | 없음 | todo |  |  |  |
| `core-lifetime` | core | 1 | 없음 | running | core/core-lifetime |  |  |
| `core-smalls` | core | 1 | 없음 | todo |  |  |  |
| `runtime-children` | core | 1 | 없음 | todo |  |  |  |
| `storage-errors` | core | 1 | 없음 | todo |  |  |  |
| `gui-claude` | gui | 1 | 없음 | running | gui/gui-claude |  |  |
| `gui-codex` | gui | 1 | 없음 | running | gui/gui-codex |  |  |
| `gui-omp` | gui | 1 | 없음 | running | gui/gui-omp |  |  |
| `gui-opencode` | gui | 1 | 없음 | running | gui/gui-opencode |  |  |
| `loop-driver` | loop | 1 | 없음 | running | loop/loop-driver |  |  |
| `loop-turn` | loop | 1 | 없음 | running | loop/loop-turn |  |  |
| `provider-error-text` | provider | 1 | 없음 | running | provider/provider-error-text |  |  |
| `provider-failures` | provider | 1 | 없음 | running | provider/provider-failures |  |  |
| `ext-spawn` | shell | 1 | 없음 | running | shell/ext-spawn |  |  |
| `shell-core-connection` | shell | 1 | 없음 | running | shell/shell-core-connection |  |  |
| `hooks-install` | term | 1 | 없음 | todo |  |  |  |
| `term-host` | term | 1 | 없음 | running | term/term-host |  |  |
| `term-supervisor` | term | 1 | 없음 | running | term/term-supervisor |  |  |
| `mcp-failures` | tools | 1 | 없음 | todo |  |  |  |
| `tools-file-write` | tools | 1 | 없음 | todo |  |  |  |
| `tools-grep` | tools | 1 | 없음 | merged | tools/tools-grep | 30a229f67 |  |
| `loop-stop` | loop | 2 | loop-turn, provider-failures | todo |  |  |  |
