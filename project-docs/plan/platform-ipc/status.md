# 상태

lead만 고친다. `tools/status.py platform-ipc build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `pipc-socket-rule` | pipc-socket | 1 | 없음 | todo |  |  |  |
| `pipc-shell-ipc` | pipc-shell | 2 | pipc-socket-rule | todo |  |  |  |
| `pipc-powershell` | pipc-powershell | 3 | pipc-shell-ipc | todo |  |  |  |
