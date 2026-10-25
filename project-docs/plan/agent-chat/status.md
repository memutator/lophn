# 상태

lead만 고친다. `tools/status.py agent-chat build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `chat-md` | chat-md | 1 | 없음 | merged | chat-md/chat-md | fbf6c3b28 |  |
| `chat-protocol` | chat-protocol | 1 | 없음 | merged | chat-protocol/chat-protocol | 14d5c437f |  |
| `chip-remove` | chip-remove | 1 | chat-protocol, chat-md | merged | chip-remove/chip-remove | 14cf6273d |  |
| `link` | link | 1 | 없음 | merged | link/link | abeb29a13 |  |
| `stream-redact` | stream | 1 | 없음 | merged | stream/stream-redact | 591ba2f24 |  |
| `clock-core` | clock | 2 | reasoning-core | merged | clock/clock-core | 0dcccf32a |  |
| `highlight` | highlight | 2 | chat-md | merged | highlight/highlight | fd072d4ab | Electron headless(CDP)에서 Worker가 뜨고 ts·sh grammar chunk를 불러온다(CSP 오류 없음). 설치 +9.1MB, .deb +0.9MB |
| `reasoning-core` | reasoning | 2 | stream-core | merged | reasoning/reasoning-core | d9c57b4b4 | 시간은 README대로 block 시작·끝. 중간 reasoning-only 응답은 modelAttempt가 저장. batch.ts도 reasoning을 나른다(lead 추가 소유) |
| `stream-core` | stream | 2 | 없음 | merged | stream/stream-core | d5572ac8c | message id는 msg_+mcl ULID. 마지막 응답은 빈 글도 저장하고 runs answer는 빈 글을 null로 본다. lead probe(fake): 중간 글+tool 뒤 run 답=마지막 응답, 빈 마지막=no_answer. workflow는 turn 상태만 본다 |
| `tool-title-core` | tool-title | 2 | 없음 | merged | tool-title/tool-title-core | 7b29e36ba |  |
| `clock-shell` | clock | 3 | reasoning-shell | todo |  |  |  |
| `reasoning-shell` | reasoning | 3 | stream-shell | running | reasoning/reasoning-shell |  |  |
| `stream-shell` | stream | 3 | 없음 | merged | stream/stream-shell | 0704eb55d |  |
| `tool-title-shell` | tool-title | 3 | clock-shell | todo |  |  |  |
