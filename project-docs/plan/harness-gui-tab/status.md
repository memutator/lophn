# 상태

lead만 고친다. `tools/status.py harness-gui-tab build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `acp-session` | acp | 1 | 없음 | merged | acp/acp-session | c81f6f6b5 |  |
| `acp-core` | acp | 2 | acp-session | merged | acp/acp-core | 20a6b0015 |  |
| `acp-screen` | acp | 2 | acp-session | merged | acp/acp-screen | 10b093586 |  |
| `tab-gui` | tab | 2 | acp-session | merged | tab/tab-gui | 5fd845338 |  |
| `adapter-claude` | adapter | 3 | acp-core, acp-screen, tab-gui | merged | adapter/adapter-claude | 8bb09c0c3 |  |
| `adapter-codex` | adapter | 3 | acp-core, acp-screen, tab-gui | merged | adapter/adapter-codex | 130da4f88 |  |
| `adapter-omp` | adapter | 3 | acp-core, acp-screen, tab-gui | merged | adapter/adapter-omp | dd5eeb259 |  |
| `adapter-opencode` | adapter | 3 | acp-core, acp-screen, tab-gui | merged | adapter/adapter-opencode | 0b9e5c777 |  |
| `fix-acp-draft` | fix | 3 | acp-screen | merged | fix/fix-acp-draft | e02aaeda0 |  |
| `gui-cleanup` | tab | 3 | tab-gui | merged | tab/gui-cleanup | c00339464 |  |
| `acp-more` | acp | 4 | 없음 | merged | acp/acp-more | 10bd2fa85 |  |
| `core-commands` | acp | 5 | acp-more | merged | acp/core-commands | ecdb47f0e |  |
| `claude-fix` | adapter | 5 | acp-more | merged | adapter/claude-fix | 7a9d6579b |  |
| `codex-fix` | adapter | 5 | acp-more | merged | adapter/codex-fix | 1990345a8 |  |
| `omp-fix` | adapter | 5 | acp-more | merged | adapter/omp-fix | c9de801ce |  |
| `opencode-fix` | adapter | 5 | acp-more | merged | adapter/opencode-fix | f7800790d |  |
| `screen-thread` | screen | 5 | acp-more | merged | screen/screen-thread | 5e2855df5 |  |
| `screen-dock` | screen | 6 | screen-thread | todo |  |  |  |
| `thread-index` | screen | 7 | screen-dock | todo |  |  |  |
| `app-check` | check | 8 | thread-index | todo |  |  |  |
