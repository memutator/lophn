# 상태

lead만 고친다. `tools/status.py agent-io build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `coding-signal` | coding-signal | 1 | 없음 | merged | coding-signal/coding-signal | f9ef8ce6e |  |
| `context-chip` | context-chip | 1 | 없음 | merged | context-chip/context-chip | 51301f68d |  |
| `model-catalog` | model-catalog | 1 | 없음 | merged | model-catalog/model-catalog | 7ab628aac |  |
| `model-catalog-source` | model-catalog | 1 | 없음 | merged | model-catalog/model-catalog-source | 74f0f64a7 |  |
| `provider-connect-attach` | provider-connect | 1 | provider-connect-handler | merged | provider-connect/provider-connect-attach | 42a18c309 |  |
| `provider-connect-cleanup` | provider-connect | 1 | provider-connect-handler, provider-connect-attach, provider-connect-shell | running | provider-connect/provider-connect-cleanup |  |  |
| `provider-connect-handler` | provider-connect | 1 | 없음 | merged | provider-connect/provider-connect-handler | f97aaeb20 |  |
| `provider-connect-shell` | provider-connect | 1 | 없음 | merged | provider-connect/provider-connect-shell | 5ac1f8d7c |  |
| `tool-output-image` | tool-output | 1 | tool-output-untrusted | merged | tool-output/tool-output-image | 328d8b976 |  |
| `tool-output-shell` | tool-output | 1 | 없음 | merged | tool-output/tool-output-shell | d497bd5c7 |  |
| `tool-output-untrusted` | tool-output | 1 | 없음 | merged | tool-output/tool-output-untrusted | b57ac8dee |  |
