# 상태

lead만 고친다. `tools/status.py agent-chat build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `chat-md` | chat-md | 1 | 없음 | todo |  |  |  |
| `chat-protocol` | chat-protocol | 1 | 없음 | todo |  |  |  |
| `chip-remove` | chip-remove | 1 | chat-protocol, chat-md | todo |  |  |  |
| `link` | link | 1 | 없음 | todo |  |  |  |
| `stream-redact` | stream | 1 | 없음 | todo |  |  |  |
| `clock-core` | clock | 2 | reasoning-core | todo |  |  |  |
| `highlight` | highlight | 2 | chat-md | todo |  |  |  |
| `reasoning-core` | reasoning | 2 | stream-core | todo |  |  |  |
| `stream-core` | stream | 2 | 없음 | todo |  |  |  |
| `tool-title-core` | tool-title | 2 | 없음 | todo |  |  |  |
| `clock-shell` | clock | 3 | reasoning-shell | todo |  |  |  |
| `reasoning-shell` | reasoning | 3 | stream-shell | todo |  |  |  |
| `stream-shell` | stream | 3 | 없음 | todo |  |  |  |
| `tool-title-shell` | tool-title | 3 | clock-shell | todo |  |  |  |
