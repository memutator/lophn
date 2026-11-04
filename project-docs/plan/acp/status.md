# 상태

lead만 고친다. `tools/status.py acp build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `acp-protocol` | acp | 1 | 없음 | merged | acp/acp-protocol | 48fc67dfd |  |
| `acp-core` | acp | 2 | acp-protocol | merged | acp/acp-core | 21fe1b3cf |  |
| `acp-chat-screen` | acp | 3 | acp-core | merged | acp/acp-chat-screen | 8586ae62c |  |
| `acp-input` | acp | 4 | acp-chat-screen | running | acp/acp-input |  |  |
