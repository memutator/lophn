# 계약 고정 전 고침

wave 2가 끝난 뒤 lead의 계약 review(reviewer 셋, 2026-10-16)에서 나온 고침이다. 여러 단위의 계약 file에 걸쳐 `tasks/`의 소유 규칙에 맞지 않아 여기에 둔다. `status.py`·`owned.py`는 이 brief를 보지 않는다. lead가 손으로 review하고 merge한다.

세 brief의 소유는 서로 겹치지 않는다. 같이 돈다.

- `fix-sessions.md`: 질문 읽기·답, 받은 message 모양, call·turn·rewind 이름, 허락 결정 말, CodingOptions
- `fix-agents.md`: agent 정의 읽기·저장 route, model·skill·MCP·instructions 이름, tool catalog의 ticket 입력, credential `{secret}`
- `fix-apps.md`: app-api 이름 한 벌, 앱 grant 읽기, activation 이름과 판정, coding CLI route, 제보 IPC, problems binding, 확인 IPC 사본

공통 규칙:
- 새 계약 file은 고친다. 옛 file(곧 지울 것)은 새 이름으로 바꾼 것을 가리키는 줄만 고친다.
- 이름을 바꾸면 core·shell·renderer·tools에서 그 이름을 쓰는 줄도 같이 고친다(그 줄만). 동작은 바꾸지 않는다.
- route를 `registry.ts`에 올리는 일은 lead가 한다. 새 route는 보고의 "등록할 것"에 적는다. 옛 route와 이름이 같으면 옛것을 지울 수 있을 때만 바꿔 끼우고, 아니면 보고한다.
- protocol 최상위 순환은 `deno run -A tools/check-deps.ts`로 본다.
