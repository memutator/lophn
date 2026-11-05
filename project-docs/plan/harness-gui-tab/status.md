# 상태

lead만 고친다. `tools/status.py harness-gui-tab build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `acp-session` | acp | 1 | 없음 | merged | acp/acp-session | c81f6f6b5 |  |
| `acp-core` | acp | 2 | acp-session | merged | acp/acp-core | 20a6b0015 |  |
| `acp-screen` | acp | 2 | acp-session | running | acp/acp-screen |  |  |
| `tab-gui` | tab | 2 | acp-session | running | tab/tab-gui |  |  |
| `adapter-claude` | adapter | 3 | acp-core, acp-screen, tab-gui | todo |  |  |  |
| `adapter-codex` | adapter | 3 | acp-core, acp-screen, tab-gui | todo |  |  |  |
| `adapter-omp` | adapter | 3 | acp-core, acp-screen, tab-gui | todo |  |  |  |
| `adapter-opencode` | adapter | 3 | acp-core, acp-screen, tab-gui | todo |  |  |  |
| `gui-cleanup` | tab | 3 | tab-gui | todo |  |  |  |
