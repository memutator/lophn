# 상태

lead만 고친다. `tools/status.py browser-use build`가 `tasks/*.md`에서 id, 단위, wave, 선행을 다시 읽어 표를 만들고, 상태, branch, commit, 기록 칸은 그대로 둔다.

| id | 단위 | wave | 선행 | 상태 | branch | commit | 기록 |
|---|---|---|---|---|---|---|---|
| `bu-preview` | bu-preview | 1 | 없음 | running | bu-preview/bu-preview |  |  |
| `bu-call` | bu-call | 2 | bu-preview | todo |  |  |  |
| `bu-cdp` | bu-cdp | 3 | bu-call | todo |  |  |  |
| `bu-device` | bu-device | 4 | bu-cdp | todo |  |  |  |
