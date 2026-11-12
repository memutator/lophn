# 상태

lead만 고친다. `tools/status.py failure-hardening build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `blob-gc` | core | 1 | 없음 | merged | core/blob-gc | f34f1cbed |  |
| `core-lifetime` | core | 1 | 없음 | merged | core/core-lifetime | 1b8e36fe4 |  |
| `core-smalls` | core | 1 | 없음 | merged | core/core-smalls | 5bc600346 |  |
| `runtime-children` | core | 1 | 없음 | merged | core/runtime-children | a8b75712a |  |
| `storage-errors` | core | 1 | 없음 | merged | core/storage-errors | 95844d1cc |  |
| `gui-claude` | gui | 1 | 없음 | merged | gui/gui-claude | 7240da1ee |  |
| `gui-codex` | gui | 1 | 없음 | merged | gui/gui-codex | 0763abf41 |  |
| `gui-omp` | gui | 1 | 없음 | merged | gui/gui-omp | 939739d06 |  |
| `gui-opencode` | gui | 1 | 없음 | merged | gui/gui-opencode | 82858adfe |  |
| `loop-driver` | loop | 1 | 없음 | merged | loop/loop-driver | a46173062 |  |
| `loop-turn` | loop | 1 | 없음 | merged | loop/loop-turn | 4c64efc27 |  |
| `provider-error-text` | provider | 1 | 없음 | merged | provider/provider-error-text | 55ea4fd1a |  |
| `provider-failures` | provider | 1 | 없음 | merged | provider/provider-failures | 2ab41e81d |  |
| `ext-spawn` | shell | 1 | 없음 | merged | shell/ext-spawn | dceff2b37 | GUI 탭 아래 CLI kill 확인 대기(사람) |
| `shell-core-connection` | shell | 1 | 없음 | merged | shell/shell-core-connection | edf8ae689 |  |
| `hooks-install` | term | 1 | 없음 | merged | term/hooks-install | 44531c010 |  |
| `term-host` | term | 1 | 없음 | merged | term/term-host | 49d9a5562 |  |
| `term-supervisor` | term | 1 | 없음 | merged | term/term-supervisor | 53a1b0a9d |  |
| `mcp-failures` | tools | 1 | 없음 | merged | tools/mcp-failures | 30ba8d0e7 |  |
| `tools-file-write` | tools | 1 | 없음 | merged | tools/tools-file-write | 6609815ce |  |
| `tools-grep` | tools | 1 | 없음 | merged | tools/tools-grep | 30a229f67 |  |
| `loop-stop` | loop | 2 | loop-turn, provider-failures | merged | loop/loop-stop | 601dd01b7 |  |
