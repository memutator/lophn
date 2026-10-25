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
| `clock-shell` | clock | 3 | reasoning-shell | merged | clock/clock-shell | 9ed9bcd52 | lead 앱 확인(ask로 13s 기다림): 답한 뒤 일하는 중 줄이 건너뛰지 않고(active 약 9s), 끝 줄 Stopped after 9s + tooltip Waited 13s for you |
| `reasoning-shell` | reasoning | 3 | stream-shell | merged | reasoning/reasoning-shell | 27af0d74e | lead 앱 확인(fake raw thinking SSE): thinking만 올 때 Thinking, 멈추면 Thought로 저장, 끝난 응답은 Thought for {d}와 펼친 요약 |
| `stream-shell` | stream | 3 | 없음 | merged | stream/stream-shell | 0704eb55d | lead 앱 확인(headless Electron+진짜 core+fake stall): live 글이 markdown으로 흐르고 열린 ts fence가 닫혀 highlight된다. Stop 뒤 본 글이 저장된 message로 남는다 |
| `tool-title-shell` | tool-title | 3 | clock-shell | merged | tool-title/tool-title-shell | f1673078b | lead 앱 확인(lophn file tool 셋): 중간 글 뒤 탐색 묶음 한 줄, 펼치면 call 제목·시간, call을 펼치면 Input/Output |
