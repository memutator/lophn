# 상태

lead만 고친다. `tools/status.py agent-io build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `coding-signal` | coding-signal | 1 | 없음 | todo |  |  |  |
| `context-chip` | context-chip | 1 | 없음 | todo |  |  |  |
| `model-catalog` | model-catalog | 1 | 없음 | todo |  |  |  |
| `model-catalog-source` | model-catalog | 1 | 없음 | todo |  |  |  |
| `provider-connect-attach` | provider-connect | 1 | provider-connect-handler | todo |  |  |  |
| `provider-connect-cleanup` | provider-connect | 1 | provider-connect-handler, provider-connect-attach, provider-connect-shell | todo |  |  |  |
| `provider-connect-handler` | provider-connect | 1 | 없음 | todo |  |  |  |
| `provider-connect-shell` | provider-connect | 1 | 없음 | todo |  |  |  |
| `tool-output-image` | tool-output | 1 | tool-output-untrusted | todo |  |  |  |
| `tool-output-shell` | tool-output | 1 | 없음 | todo |  |  |  |
| `tool-output-untrusted` | tool-output | 1 | 없음 | todo |  |  |  |
