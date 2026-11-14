# 상태

lead만 고친다. `tools/status.py phone-remote-web build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `touch-density` | design | 1 | 없음 | todo |  |  |  |
| `remote-bytes` | remote | 1 | 없음 | todo |  |  |  |
| `remote-web-base` | web | 2 | remote-bytes, touch-density | todo |  |  |  |
| `remote-ui-bundle` | remote | 3 | remote-web-base | todo |  |  |  |
| `remote-web-chat` | web | 3 | remote-web-base | todo |  |  |  |
