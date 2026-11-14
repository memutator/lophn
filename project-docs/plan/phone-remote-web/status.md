# 상태

lead만 고친다. `tools/status.py phone-remote-web build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `touch-density` | design | 1 | 없음 | merged | design/touch-density | e638b5551 |  |
| `remote-bytes` | remote | 1 | 없음 | merged | remote/remote-bytes | f67046281 |  |
| `remote-web-base` | web | 2 | remote-bytes, touch-density | merged | web/remote-web-base | f42e446bb |  |
| `remote-ui-bundle` | remote | 3 | remote-web-base | merged | remote/remote-ui-bundle | 9b342147e |  |
| `remote-web-chat` | web | 3 | remote-web-base | running | web/remote-web-chat |  |  |
