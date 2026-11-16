# 상태

lead만 고친다. `tools/status.py desktop-remote build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `remote-desk-screens` | desk-screens | 1 | 없음 | merged | desk-screens/remote-desk-screens | 66fad9b5e |  |
| `remote-desk-client` | remote-client | 1 | 없음 | todo |  |  |  |
| `remote-desk-viewer` | desk-viewer | 2 | remote-desk-client | todo |  |  |  |
| `remote-desk-stale-send` | stale-send | 2 | remote-desk-client | todo |  |  |  |
| `remote-desk-renderer` | desk-renderer | 3 | remote-desk-screens, remote-desk-viewer | todo |  |  |  |
| `remote-desk-windows` | desk-windows | 3 | remote-desk-viewer | todo |  |  |  |
